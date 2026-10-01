# Bibit Reksadana

Raw data for Indonesian mutual funds (reksa dana). It comes from two sources: the public API behind [Bibit](https://app.bibit.id/), and the [Kontan pusatdata](https://pusatdata.kontan.co.id/reksadana) pages. The data lives in this repository, so you can read it without calling either site.

## Data

### Bibit (`data/bibit/`)

| Path | What it holds |
|---|---|
| `data/bibit/funds.csv` | One row per fund: symbol, name, type, investment manager, currency, latest NAV and AUM. Start here. |
| `data/bibit/funds/<symbol>.json` | Everything Bibit returns for one fund: fees, investment manager, custodian bank, asset allocation, top holdings, returns, drawdown, risk profile, and more. |
| `data/bibit/nav/<symbol>.csv` | Daily NAV per unit. `nav_adjusted` includes dividends. |
| `data/bibit/aum/<symbol>.csv` | Assets under management over time. |
| `data/bibit/dividends/<symbol>.json` | Dividend history, only for funds that pay dividends. |
| `data/bibit/documents/<symbol>.json` | Links to monthly factsheets and prospectus files (PDF or JPG). |
| `data/bibit/switchables/<symbol>.json` | Funds you can switch to in the app, only for funds you can buy in the app. |
| `data/bibit/types.json` | Fund type codes. |

### Kontan (`data/kontan/`)

| Path | What it holds |
|---|---|
| `data/kontan/funds.csv` | One row per Kontan fund: `kontan_id`, name, manager, category, latest NAV and its date, and `bibit_symbol`. `bibit_symbol` is the matching Bibit fund, or empty when there is no confident match. |
| `data/kontan/nav/<kontan_id>.csv` | Daily NAV per unit (`date,nav`). |

Kontan only serves the last 12 months of NAV per fund. Every run merges that window into the stored file by date, so the history grows over time.

A Kontan fund is matched to a Bibit fund only when its name, after lowercasing and removing punctuation and the words "reksa dana" and "RD", equals exactly one Bibit fund name (and one Kontan fund name), and the investment managers are compatible. Nothing fuzzier is used, so some funds stay unmatched.

Fund types (`type` column): `Pasar Uang` (money market), `Obligasi` (fixed income), `Saham` (equity), `Campuran` (balanced), `Terproteksi` (capital protected), and `Reksadana Global` (global).

### NAV history: buyable vs. other funds

The `tradeable` column is `1` for funds you can buy in the Bibit app.

- **Buyable funds:** `data/nav/` has the full daily history from the launch date.
- **Other funds:** Bibit does not give their NAV history, even to a logged-in user. The fund list still shows their latest NAV, so every scraper run adds that day's row. These rows have an empty `nav_adjusted`. History for these funds starts on the day this repository started collecting it (2026-10-01). When Kontan has a matching fund, its daily NAV for the last 12 months (and growing) is in `data/kontan/`, and the fund page charts it too.

## Website

An [Astro](https://astro.build/) site builds from `data/` into static files. It has a fund explorer, a page with charts for every fund, bulk downloads, and a read-only JSON API (see `/api/` on the site). It is served by Cloudflare Workers as static assets, so there is no server code.

You need Node.js 22.12 or newer. Cloudflare builds with Node 24 (see `.node-version`).

```bash
npm ci
npm run dev       # dev server at http://localhost:4321
npm run build     # writes dist/ and checks Cloudflare's free plan limits
npm run preview   # serves dist/ locally with wrangler
```

### Deploy

Cloudflare Workers Builds deploys the site from GitHub. In the Cloudflare dashboard, create a Worker from this repository (Workers & Pages, Create, Import a repository). Then check these settings under the Worker's Settings, Build:

| Setting | Value |
|---|---|
| Worker name | `bibit-reksadana` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` (the default) |

The Worker name must match `name` in `wrangler.toml`. If you use another name, change the file, or the build fails with a name mismatch warning.

The build image's default Node.js is already new enough. `.node-version` pins Node 24, so no build variables are needed. Every push to `main` then deploys, including the weekly data commit.

Cloudflare's own docs: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/).

The build fails if `dist/` has more than 19,000 files or a file over 24 MiB, because the free plan allows 20,000 files and 25 MiB per file.

## Update the data

The GitHub Actions workflow `.github/workflows/scrape.yml` runs both scrapers every Saturday at 23:00 UTC (Sunday 06:00 in Jakarta). It commits `data/` only when something changed. You can also start it by hand from the Actions tab. With Workers Builds connected, that commit deploys the new data.

To run the scrapers yourself, you need Node.js 22 or newer. They have no dependencies to install.

```bash
# Update both sources (Bibit first, because Kontan matching uses the Bibit fund names)
npm run scrape

# Update one source
npm run scrape:bibit
npm run scrape:kontan

# Update only some Bibit funds
node scrapers/bibit.js RD8807 RD216
```

`scrapers/bibit.js` and `scrapers/kontan.js` hold the source-specific code. `scrapers/lib.js` holds what both share (atomic file writes, CSV, retries, the worker pool).

**Bibit.** The first run downloads the full history and takes a few minutes. Later runs only download NAV and AUM rows that are newer than the last run, so they take less than a minute. The scraper decides what is new by comparing with `data/bibit/funds/<symbol>.json` from the last run. To download a fund's full history again, delete that file and its CSV files, then run the scraper.

**Kontan.** See "How the Kontan scraper works" below. It sends at most 2 requests at a time, with a short pause after each one.

## How the Bibit API works

- No login is needed for the endpoints this scraper uses.
- `GET https://api.bibit.id/products/filter?tradable=1&currency=all&limit=50&page=1` lists funds. `tradable=1` gives the funds you can buy in the app, and `tradable=0` gives all other funds.
- `GET /products/<symbol>/chart?period=ALL` gives the NAV history. Other periods: `1D`, `1W`, `1M`, `3M`, `YTD`, `1Y`, `3Y`, `5Y`, `10Y`.
- `GET /products/<symbol>/chart/aum?period=ALL` gives the AUM history.
- `GET /products/<symbol>/dividends`, `/factsheets`, `/prospectus`, and `/switchables` give the other per-fund data.
- Endpoints that need a login (`/products/<symbol>/history`, `/stats`, `/watchlist`) only describe the logged-in user's own account, so the scraper does not use them.
- Most responses put an encrypted string in `data`. The first 32 hex characters are the IV, the last 32 characters are the AES-256-CBC key, and the rest is the ciphertext. See `decrypt()` in `scrapers/bibit.js`.

## How the Kontan scraper works

- Kontan's category and manager list pages come back empty, so there is no fund list to read. The scraper finds funds by asking for each numeric fund ID.
- `GET https://pusatdata.kontan.co.id/reksadana/get_chart_product/?produk_id=<id>&select=nab&periode=12&start_date=&end_date=` returns an HTML page. Its inline script has one `pausecontent.push('<date>')` line per date and one `data1.push('<value>')` line per NAV. An unknown ID gives the same page with no points. Longer periods do not work.
- `GET /reksadana/produk/<id>` is the fund page. It is fetched once per fund, for the name, manager, and category.
- Fund IDs run from 1 to about 17,200, but only IDs up to about 1,500 and from about 14,200 hold funds. The first run scans every ID up to 18,000 and takes a long time. Later runs refresh the known funds and only look at the 500 IDs after the highest known one. To scan every ID again, delete `data/kontan/funds.csv`. The stored NAV files are kept and merged.
- Chart points with no price (`#N/A`, `0.00`) are skipped. A fund whose chart has two different NAVs on one date is skipped too, because it is not clear which one is right.
- A fund with a changed or broken chart fails on its own. The run still saves the other funds and exits non-zero.

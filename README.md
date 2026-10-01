# Bibit Reksadana

Raw data for Indonesian mutual funds (reksa dana). It comes from three sources: the public API behind [Bibit](https://app.bibit.id/), the [Kontan pusatdata](https://pusatdata.kontan.co.id/reksadana) pages, and [Bareksa](https://www.bareksa.com/id/data/reksadana/daftar). The data lives in this repository, so you can read it without calling any of the sites.

| Source | Folder | Funds | What it adds | Updated |
|---|---|---|---|---|
| Bibit | `data/bibit/` | 3,044 (the master list; the site has a page for each) | Fees, returns, documents, daily NAV for buyable funds, AUM | Weekly |
| Kontan | `data/kontan/` | 1,660 | Daily NAV for the last 12 months, growing every run | Weekly |
| Bareksa | `data/bareksa/` | 3,812 | Monthly AUM, units, and asset allocation, back to each fund's launch. Daily NAV from launch, loaded by hand | Monthly |

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

### Bareksa (`data/bareksa/`)

| Path | What it holds |
|---|---|
| `data/bareksa/funds.csv` | One row per fund in Bareksa's list of all funds: `bareksa_id`, name, `slug` (the end of its Bareksa URL), type, manager, launch date, and `bibit_symbol`. `bibit_symbol` is the matching Bibit fund, or empty when there is no confident match. |
| `data/bareksa/aum/<bareksa_id>.csv` | Monthly assets under management: `date,aum_idr,aum_usd`. |
| `data/bareksa/units/<bareksa_id>.csv` | Monthly units outstanding: `date,units`. |
| `data/bareksa/allocation/<bareksa_id>.csv` | Asset allocation in percent: `date,saham,obligasi,pasar_uang,lainnya` (equity, bonds, money market, other). Bareksa's own chart uses these four names in this order. Only some funds have it. |
| `data/bareksa/nav/<bareksa_id>.csv` | Daily NAV per unit: `date,nav`. See "Load the Bareksa daily NAV" below. |

The matching rules are the same as for Kontan. Bareksa shows the manager on each fund's page, so the managers are compared too.

Bareksa's list of all funds holds 3,812 funds. 3,656 of them have AUM data, and 1,719 are matched to a Bibit fund (1,603 of those are not buyable in the Bibit app). In a sample of 175 IDs outside the list, 39 still answered with AUM data, but they have no fund page, so there is no name to match or show. The scraper ignores them.

### NAV history: buyable vs. other funds

The `tradeable` column is `1` for funds you can buy in the Bibit app.

- **Buyable funds:** `data/nav/` has the full daily history from the launch date.
- **Other funds:** Bibit does not give their NAV history, even to a logged-in user. The fund list still shows their latest NAV, so every scraper run adds that day's row. These rows have an empty `nav_adjusted`. History for these funds starts on the day this repository started collecting it (2026-10-01). When Kontan has a matching fund, its daily NAV for the last 12 months (and growing) is in `data/kontan/`, and the fund page charts it too. When Bareksa has a matching fund, the page also charts its daily NAV (once loaded, see below). If no source has a daily NAV for a fund, the page draws a monthly NAV that it computes as Bareksa's AUM divided by its units. That line is computed in the browser and is not stored.

## Website

An [Astro](https://astro.build/) site builds from `data/` into static files. It has a fund explorer, a page with charts for every fund, bulk downloads, and a read-only JSON API (see `/api/` on the site). It is served by Cloudflare Workers as static assets, so there is no server code. The fund page has one NAV chart with up to five lines: Bibit, Bibit adjusted, Kontan, Bareksa, and the computed monthly NAV. Click a name in the chart legend to hide or show a line.

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

The build fails if `dist/` has more than 19,000 files or a file over 24 MiB, because the free plan allows 20,000 files and 25 MiB per file. That is why the download page has one zip per source, and Bareksa's daily NAV is split into several zips by size (see `src/lib/archives.js`).

## Update the data

The GitHub Actions workflow `.github/workflows/scrape.yml` has two schedules. It commits `data/` only when something changed. With Workers Builds connected, that commit deploys the new data.

| Schedule | What it runs |
|---|---|
| Every Saturday at 23:00 UTC (Sunday 06:00 in Jakarta) | Bibit and Kontan |
| The 1st of every month at 23:00 UTC | Bareksa (without the daily NAV) |

You can also start it by hand from the Actions tab. The `sources` input picks `bibit-kontan` (the default), `bareksa`, or `all`.

To run the scrapers yourself, you need Node.js 22 or newer. They have no dependencies to install.

```bash
# Update Bibit and Kontan (Bibit first, because Kontan matching uses the Bibit fund names)
npm run scrape

# Update one source (Bareksa matching uses the Bibit fund names too)
npm run scrape:bibit
npm run scrape:kontan
npm run scrape:bareksa

# Check the Bareksa parsers
npm test

# Update only some Bibit funds
node scrapers/bibit.js RD8807 RD216
```

`scrapers/bibit.js`, `scrapers/kontan.js`, and `scrapers/bareksa.js` hold the source-specific code. `scrapers/lib.js` holds what they share (atomic file writes, CSV, retries, the worker pool, and the name matching against Bibit).

**Bibit.** The first run downloads the full history and takes a few minutes. Later runs only download NAV and AUM rows that are newer than the last run, so they take less than a minute. The scraper decides what is new by comparing with `data/bibit/funds/<symbol>.json` from the last run. To download a fund's full history again, delete that file and its CSV files, then run the scraper.

**Kontan.** See "How the Kontan scraper works" below. It sends at most 2 requests at a time, with a short pause after each one.

**Bareksa.** See "How the Bareksa scraper works" below. The first full run made about 15,000 requests and took 100 minutes. A run after that asks only for rows newer than the stored ones, but it still asks once per fund, so it makes about 11,000 requests and takes about 40 minutes. The GitHub job has a 3 hour limit. It sends at most 2 requests at a time, with a short pause after each one.

### Load the Bareksa daily NAV

Bareksa shows a fund's daily NAV history only to logged-in members, so GitHub cannot collect it. You load it once by hand, from your laptop, with your own Bareksa login. This is a one-time step, and you can repeat it any time to catch up.

1. Log in to [bareksa.com](https://www.bareksa.com/) in your browser.
2. Open DevTools (F12) and go to the Network tab. Reload the page.
3. Click any request to `www.bareksa.com`. Under Request Headers, copy the whole value of the `cookie` header.
4. Run the scraper with that value in `BAREKSA_COOKIE`. Keep the quotes, because the value has spaces and semicolons:

```bash
BAREKSA_COOKIE='paste-the-cookie-value-here' npm run scrape:bareksa
```

5. Commit the new `data/bareksa/nav/` files and push.

With the cookie set, the run also asks for each fund's full daily NAV and merges it by date. It adds about 3,800 requests, and the answers are large. I have not measured it; expect one to three hours. If Bareksa does not accept the cookie (it is missing, wrong, or expired), the run stops at the first NAV request with the error `BAREKSA_COOKIE missing or expired`. Log in again and copy a new cookie. The cookie is never printed or written to a file. Do not put it in GitHub; the scheduled run never has it.

The NAV files you commit are public, because this repository is public.

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

## How the Bareksa scraper works

All requests go to `https://www.bareksa.com` with the header `X-Requested-With: XMLHttpRequest`. Some answers take 20 to 60 seconds, so the timeout is 90 seconds. `robots.txt` allows all of these paths.

- `GET /ajax/mutualfund/product/list?t=&ob=name&o=asc&ba=no&l=100&p=<page>` is the fund list behind the "all funds" table. `ba=no` includes funds that are not sold on Bareksa (without it you get only about 218). It answers with an HTML table, not JSON. The scraper reads the page until one comes back empty. The row links hold each fund's ID, slug, and name.
- `GET /id/data/reksadana/<id>/<slug>` is the fund page. It is fetched once per fund, for the type, the manager, and the launch date. Only a fund that is new in the list is fetched later.
- `GET /ajax/mutualfund/aum/product/?id=<id>&startdate=<date>&enddate=` gives the monthly AUM (`value_idr`, `value_usd`). `/ajax/mutualfund/aum/product_unit/` takes the same parameters and gives the monthly units. `startdate` is the last stored date after the first run. A fund with no data answers `{"status":false,"msg":"Empty"}`. When AUM is empty, the other two requests are skipped.
- `GET /ajax/mutualfund/alokasidana/?id=<id>&cperiod=all&startdate=&enddate=` gives the allocation. After the first run it uses `cperiod=custom` with the last stored date and today. Each row is `[date, saham, obligasi, pasar uang, lain-lain]`. A fund without allocation data gets HTTP 500 and a "Database Error" page every time, which about 60% of funds do (1,336 of 3,656 have allocation data). The scraper treats that as "no data" and does not retry it.
- `GET /ajax/mutualfund/nav/product1/?id=<id>&cperiod=all&startdate=&enddate=&requested_page=profile.graph` gives the daily NAV. Without a login it answers `{"data":{"auth":false}}`. It is only called when `BAREKSA_COOKIE` is set.
- Rows are merged into the stored files by date. A value for a date that is already stored replaces it, so a month that Bareksa corrects is corrected here too.
- A fund that fails (a timeout, a bad response) does not stop the run. The run saves the other funds and exits non-zero. The failed fund is tried again next run.

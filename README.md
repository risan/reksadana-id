# Bibit Reksadana

Raw data for Indonesian mutual funds (reksa dana), scraped from the public API behind [Bibit](https://app.bibit.id/). The data lives in this repository, so you can read it without calling Bibit.

## Data

| Path | What it holds |
|---|---|
| `data/funds.csv` | One row per fund: symbol, name, type, investment manager, currency, latest NAV and AUM. Start here. |
| `data/funds/<symbol>.json` | Everything Bibit returns for one fund: fees, investment manager, custodian bank, asset allocation, top holdings, returns, drawdown, risk profile, and more. |
| `data/nav/<symbol>.csv` | Daily NAV per unit. `nav_adjusted` includes dividends. |
| `data/aum/<symbol>.csv` | Assets under management over time. |
| `data/dividends/<symbol>.json` | Dividend history, only for funds that pay dividends. |
| `data/documents/<symbol>.json` | Links to monthly factsheets and prospectus files (PDF or JPG). |
| `data/switchables/<symbol>.json` | Funds you can switch to in the app, only for funds you can buy in the app. |
| `data/types.json` | Fund type codes. |

Fund types (`type` column): `Pasar Uang` (money market), `Obligasi` (fixed income), `Saham` (equity), `Campuran` (balanced), `Terproteksi` (capital protected), and `Reksadana Global` (global).

### NAV history: buyable vs. other funds

The `tradeable` column is `1` for funds you can buy in the Bibit app.

- **Buyable funds:** `data/nav/` has the full daily history from the launch date.
- **Other funds:** Bibit does not give their NAV history, even to a logged-in user. The fund list still shows their latest NAV, so every scraper run adds that day's row. These rows have an empty `nav_adjusted`. History for these funds starts on the day this repository started collecting it (2026-10-01).

## Website

An [Astro](https://astro.build/) site builds from `data/` into static files. It has a fund explorer, a page with charts for every fund, bulk downloads, and a read-only JSON API (see `/api/` on the site). It is served by Cloudflare Workers as static assets, so there is no server code.

You need Node.js 22.12 or newer.

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

The Worker name must match `name` in `wrangler.toml`. If you use another name, change the file, or the build fails with a name mismatch warning.

The build image's default Node.js is already new enough. `.node-version` pins Node 22 so builds do not change when the default changes. Every push to `main` then deploys, including the daily data commit.

Cloudflare's own docs: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/).

The build fails if `dist/` has more than 19,000 files or a file over 24 MiB, because the free plan allows 20,000 files and 25 MiB per file.

## Update the data

The GitHub Actions workflow `.github/workflows/scrape.yml` runs the scraper every day at 23:00 UTC. It commits `data/` only when something changed. You can also start it by hand from the Actions tab. With Workers Builds connected, that commit deploys the new data.

To run the scraper yourself, you need Node.js 22 or newer. The scraper has no dependencies to install.

```bash
# Update every fund
npm run scrape

# Update only some funds
node scrape.js RD8807 RD216
```

The first run downloads the full history and takes a few minutes. Later runs only download NAV and AUM rows that are newer than the last run, so they take less than a minute.

The scraper decides what is new by comparing with `data/funds/<symbol>.json` from the last run. To download a fund's full history again, delete that file and its CSV files, then run the scraper.

## How the API works

- No login is needed for the endpoints this scraper uses.
- `GET https://api.bibit.id/products/filter?tradable=1&currency=all&limit=50&page=1` lists funds. `tradable=1` gives the funds you can buy in the app, and `tradable=0` gives all other funds.
- `GET /products/<symbol>/chart?period=ALL` gives the NAV history. Other periods: `1D`, `1W`, `1M`, `3M`, `YTD`, `1Y`, `3Y`, `5Y`, `10Y`.
- `GET /products/<symbol>/chart/aum?period=ALL` gives the AUM history.
- `GET /products/<symbol>/dividends`, `/factsheets`, `/prospectus`, and `/switchables` give the other per-fund data.
- Endpoints that need a login (`/products/<symbol>/history`, `/stats`, `/watchlist`) only describe the logged-in user's own account, so the scraper does not use them.
- Most responses put an encrypted string in `data`. The first 32 hex characters are the IV, the last 32 characters are the AES-256-CBC key, and the rest is the ciphertext. See `decrypt()` in `scrape.js`.

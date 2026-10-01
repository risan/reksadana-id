# Bibit Reksadana

Raw data for Indonesian mutual funds (reksa dana), scraped from the public API behind [Bibit](https://app.bibit.id/). The data lives in this repository, so you can read it without calling Bibit.

## Data

| Path | What it holds |
|---|---|
| `data/funds.csv` | One row per fund: symbol, name, type, investment manager, currency, latest NAV and AUM. Start here. |
| `data/funds/<symbol>.json` | Everything Bibit returns for one fund: fees, investment manager, custodian bank, asset allocation, top holdings, returns, drawdown, risk profile, and more. |
| `data/nav/<symbol>.csv` | Daily NAV per unit from the launch date until today. `nav_adjusted` includes dividends. |
| `data/aum/<symbol>.csv` | Assets under management over time. |
| `data/dividends/<symbol>.json` | Dividend history, only for funds that pay dividends. |
| `data/types.json` | Fund type codes. |

Fund types (`type` column): `Pasar Uang` (money market), `Obligasi` (fixed income), `Saham` (equity), `Campuran` (balanced), `Terproteksi` (capital protected), and `Reksadana Global` (global).

The `tradeable` column is `1` for funds you can buy in the Bibit app. Bibit only has NAV history for some of the other funds, so not every fund has a file in `data/nav/`.

## Update the data

You need Node.js 22 or newer. There are no dependencies to install.

```bash
# Update every fund
npm run scrape

# Update only some funds
node scrape.js RD8807 RD216
```

The first run downloads the full history and takes a while. Later runs only download new NAV and AUM rows, so they are much faster.

## How the API works

- No login is needed for the endpoints this scraper uses.
- `GET https://api.bibit.id/products/filter?tradable=1&currency=all&limit=50&page=1` lists funds. `tradable=1` gives the funds you can buy in the app, and `tradable=0` gives all other funds.
- `GET /products/<symbol>/chart?period=ALL` gives the NAV history. Other periods: `1D`, `1W`, `1M`, `3M`, `YTD`, `1Y`, `3Y`, `5Y`, `10Y`.
- `GET /products/<symbol>/chart/aum?period=ALL` gives the AUM history.
- Most responses put an encrypted string in `data`. The first 32 hex characters are the IV, the last 32 characters are the AES-256-CBC key, and the rest is the ciphertext. See `decrypt()` in `scrape.js`.

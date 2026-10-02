# Reksadana ID

Raw data for Indonesian mutual funds (reksa dana). It comes from four sources: the public API behind [Bibit](https://app.bibit.id/), the [Kontan pusatdata](https://pusatdata.kontan.co.id/reksadana) pages, [Bareksa](https://www.bareksa.com/id/data/reksadana/daftar), and the public fund pages of [Makmur](https://www.makmur.id/). The data lives in this repository, so you can read it without calling any of the sites.

| Source | Folder | Funds | What it adds | Updated |
|---|---|---|---|---|
| Bibit | `data/bibit/` | 3,044 (the master list; the site has a page for each) | Fees, returns, documents, daily NAV for buyable funds, AUM | Daily |
| Kontan | `data/kontan/` | 1,660 | Daily NAV for the last 12 months, growing every run | Weekly |
| Makmur | `data/makmur/` | 141 | Latest price, returns, asset allocation, top holdings, and factsheet and prospectus links | Weekly |
| Bareksa | `data/bareksa/` | 3,812 | Monthly AUM, units, and asset allocation, back to each fund's launch. Daily NAV from launch, loaded by hand | Monthly |

## Data

### Bibit (`data/bibit/`)

| Path | What it holds |
|---|---|
| `data/bibit/funds.csv` | One row per fund: symbol, name, type, investment manager, currency, latest NAV and AUM. Start here. |
| `data/bibit/funds/<symbol>.json` | Everything Bibit returns for one fund: fees, investment manager, custodian bank, asset allocation, top holdings, returns, drawdown, risk profile, and more. |
| `data/bibit/nav/<symbol>.csv` | Daily NAV per unit. `nav_adjusted` is Bibit's dividend-adjusted NAV; its base can change between scrapes, so compare it only within one download. |
| `data/bibit/aum/<symbol>.csv` | Assets under management over time. |
| `data/bibit/dividends/<symbol>.json` | The latest dividend payouts (Bibit keeps up to five), only for funds that pay dividends. |
| `data/bibit/documents/<symbol>.json` | Links to monthly factsheets and prospectus files (PDF or JPG). |
| `data/bibit/switchables/<symbol>.json` | Funds you can switch to in the app, only for funds you can buy in the app. |
| `data/bibit/types.json` | Fund type codes. |

### Kontan (`data/kontan/`)

| Path | What it holds |
|---|---|
| `data/kontan/funds.csv` | One row per Kontan fund: `kontan_id`, name, manager, category, latest NAV and its date, and `bibit_symbol`. `bibit_symbol` is the matching Bibit fund, or empty when there is no confident match. |
| `data/kontan/nav/<kontan_id>.csv` | Daily NAV per unit (`date,nav`). |

Kontan only serves the last 12 months of NAV per fund. Every run merges that window into the stored file by date, so the history grows over time.

A Kontan fund is matched to a Bibit fund only when its name, after lowercasing and removing punctuation and the words "reksa dana" and "RD", equals one Bibit fund name (and one Kontan fund name), and exactly one Bibit fund with that name has the same investment manager. Nothing fuzzier is used, so some funds stay unmatched. Three more rules help:

- A trailing "Kelas A" is dropped when the full name finds nothing, because Bibit often lists that class without it. Other classes ("Kelas B") never match this way.
- A few managers are known by two names, for example after a rename (`MANAGER_ALIASES` in `scrapers/lib.js`). Each pair is the same company, with the same fund names under both names.
- `scrapers/fund-aliases.json` maps a fund to a Bibit symbol by hand (`"makmur:<makmur_id>": "RD123"`, also `kontan:` and `bareksa:`; `"bibit:RD2280": "RD1983"` joins a duplicate Bibit symbol to the fund it repeats). It is for renamed funds. An alias wins over the automatic match, and `null` blocks a wrong automatic match. Each alias has the same manager, type, and currency, and a NAV (or one-day return) that agrees with Bibit.

Fund types (`type` column): `Pasar Uang` (money market), `Obligasi` (fixed income), `Saham` (equity), `Campuran` (balanced), `Terproteksi` (capital protected), and `Reksadana Global` (global).

### Bareksa (`data/bareksa/`)

| Path | What it holds |
|---|---|
| `data/bareksa/funds.csv` | One row per fund in Bareksa's list of all funds: `bareksa_id`, name, `slug` (the end of its Bareksa URL), type, manager, launch date, and `bibit_symbol`. `bibit_symbol` is the matching Bibit fund, or empty when there is no confident match. The page columns are described below the table. |
| `data/bareksa/aum/<bareksa_id>.csv` | Monthly assets under management: `date,aum_idr,aum_usd`. |
| `data/bareksa/units/<bareksa_id>.csv` | Monthly units outstanding: `date,units`. |
| `data/bareksa/allocation/<bareksa_id>.csv` | Asset allocation in percent: `date,saham,obligasi,pasar_uang,lainnya` (equity, bonds, money market, other). Bareksa's own chart uses these four names in this order. Only some funds have it. |
| `data/bareksa/nav/<bareksa_id>.csv` | Daily NAV per unit: `date,nav`. See "Load the Bareksa daily NAV" below. |

`data/bareksa/funds.csv` also holds, from each fund's public Bareksa page: `currency`, `custodian`, `min_purchase`, `min_topup`, `min_redemption` (plain numbers, in the fund currency), `fee_purchase`, `fee_redemption`, `fee_switch` (maximum per prospectus, as `min-max` fractions: `-0.02` is at most 2%, `0.005-0.03` is 0.5% to 3%, `0` is free, empty is unknown) and `profile_date` (when the page was last fetched). `npm run scrape:bareksa:profiles` refreshes up to 400 fund pages per run, never-fetched first, then the oldest; `node scrapers/bareksa.js --profiles-all` fetches every page. The full Bareksa run also fills these fields when it fetches a profile.

The matching rules are the same as for Kontan. Bareksa shows the manager on each fund's page, so the managers are compared too.

Bareksa's list of all funds holds 3,812 funds. 3,656 of them have AUM data, and 1,847 are matched to a Bibit fund (1,726 of those are not buyable in the Bibit app). In a sample of 175 IDs outside the list, 39 still answered with AUM data, but they have no fund page, so there is no name to match or show. The scraper ignores them.

### Makmur (`data/makmur/`)

| Path | What it holds |
|---|---|
| `data/makmur/funds.csv` | One row per fund in Makmur's sitemap: `makmur_id`, name, manager, `category`, `route_category` (the folder in the fund's web address), `url` (the end of the address), currency, `last_price`, `as_of`, `last_aum`, `inception_date`, and `bibit_symbol`. `bibit_symbol` is the matching Bibit fund, or empty when there is no confident match. |
| `data/makmur/funds/<makmur_id>.json` | The fund record from Makmur's page, as it is, plus `routeCategory`. |

The scraper reads only Makmur's public website. The page of a fund holds the whole record as JSON in a `__NEXT_DATA__` script. The app API needs signed requests, so it is not used. A fund page is
`https://www.makmur.id/id/reksadana/<route_category>/<url>`.

**Makmur scales its numbers, and the data keeps them as they are.** Checked against the matching Bibit funds:

| Field | Scale | Example |
|---|---|---|
| `return1d` ... `returnsi`, `drawdown*`, `cagr*`, `expenseRatio` | hundredths of a percent | `481` is 4.81% |
| `assetAllocations[].weight` | hundredths of a percent (a fund adds up to 10000) | `5295` is 52.95% |
| `lastPrice` | NAV times 100 | `160228` is 1,602.28; for a USD fund `156` is 1.56 |
| `lastAum`, `minFirstBuy`, `minNextBuy` | the plain amount, in the fund's currency | `454585760000` |
| `asof`, `portfolioAsof`, `inceptionDate` | a number like `20260930` | 2026-09-30 |

In `funds.csv` the dates are ISO dates, and the other values are as in the JSON. `last_price` is a whole number, so it is rounded to 0.01 of the NAV. 128 of the 141 funds are matched to a Bibit fund. The matching rules are the same as for Kontan. The rest are not in Bibit under a name or NAV that matches.

### One record per fund (`data/funds.csv`)

The same fund appears in several sources, and Bibit lists some funds under more than one symbol or under a stale name. `scripts/link-funds.js` joins the records of all four sources into one fund each. It writes:

| File | Content |
|---|---|
| `data/funds.csv` | One row per fund: `id`, `name`, `other_names` (separated by `\|`), `manager`, `type` (Bibit's labels), `currency` and `sharia` (empty when no source says), `launch_date`, and the source IDs of `bibit`, `bareksa`, `kontan`, and `makmur` (space-separated, the best record first). |
| `data/fund-ids.csv` | Every fund ID ever published: `id`, `first_published`, `current_id`. A retired ID points at the fund that now holds its record (never at another retired ID: the linker follows chains to the live fund). IDs are only added, never removed. |

Records are joined by these rules, in this order. A merge is refused when two members of the joined group disagree (different currency, Kelas or series number, NAV far apart on the latest shared date, and for NAV evidence a NAV that differs on more than 5% of the shared dates). Refusals are listed in the report.

1. `scrapers/fund-aliases.json` (see above).
2. The `bibit_symbol` columns of the other sources.
3. The same normalized name and manager in two sources without Bibit (each name used once per source).
4. NAV evidence: equal NAV (to the precision of the coarser source) on at least 3 shared dates, with distinctive values (at least 5 digits, not 1, 10, 100, 1000 or 10000), the same manager, and a compatible currency. Kontan's NAV is also tried one day earlier, because it often carries the next day's date. Bibit keeps NAV history only for funds it sells, so a Bibit fund with one or two rows links this way only when those values have at least 7 digits, the manager is known and the same, and each side has no other candidate. Candidates that miss this are printed in the report.

The series number is the last word of the name when it is a Roman or Arabic numeral of up to three digits ("Gemilang I" and "Gemilang II", "Proteksi 69"). Roman and Arabic are the same number, a name without one conflicts with nothing, and "LQ45", "IDX30" or a year are not numbers. Different numbers refuse every automatic rule, checked across the whole merged group, so a third source cannot bridge two series. Aliases are not checked.

The short-history rule (`nav-short`) exists because Bibit keeps almost no NAV history for funds it does not sell, and about 200 renamed funds (for example Kisi to KIM Fixed Income Fund Plus) have only the latest few NAV values in common. Besides the conditions above, it needs that the two names do not conflict in series number or Kelas, and that neither record has a look-alike: another record of the same source, from a compatible manager and currency, with an equal value on the same date. Two unrelated funds of one manager that report the same long NAV on their only shared date, with names that carry no conflicting number, are still linked. That is an accepted risk; block such a pair with a `null` alias.

A fund keeps its ID: the Bibit symbol of the group, or `BRK<id>`, `KTN<id>`, `MKR<id>` for a fund Bibit does not list. When two published IDs end up in one fund, the one that was already live stays and the other becomes a redirect. The name is the current Bareksa name, then Makmur, Bibit, Kontan; the other names go to `other_names`. The type is Bibit's label (the explorer groups by it; Bareksa calls global funds "Saham"), then Bareksa's, Kontan's, and Makmur's mapped to the same labels. Types with no Bibit label (index funds, ETFs, DPLK) stay empty; the site marks such funds with `etf` and `index` flags, taken from Bibit, else from the name and the other sources' types.

```bash
npm run link   # rewrites both files and prints the report (about 10 seconds); the scheduled workflow runs it after the scrapers
```

`scripts/check-funds.js` checks the result in `npm run build`.

### NAV history: buyable vs. other funds

The `tradeable` column is `1` for funds you can buy in the Bibit app.

- **Buyable funds:** `data/nav/` has the full daily history from the launch date.
- **Other funds:** Bibit does not give their NAV history, even to a logged-in user. The fund list still shows their latest NAV, so every daily Bibit run adds that day's row. These rows have an empty `nav_adjusted`. History for these funds starts on the day this repository started collecting it (2026-10-01). When Kontan has a matching fund, its daily NAV for the last 12 months (and growing) is in `data/kontan/`. When Bareksa has a matching fund, its daily NAV is in `data/bareksa/nav/` (once loaded, see below). Makmur has no NAV history, only the latest price.

## Website

An [Astro](https://astro.build/) site builds from `data/` into static files. It has a fund explorer, a page with charts and a "Buy this fund" block for every fund, bulk downloads, and a read-only JSON API (see `/api/` on the site). It is served by Cloudflare Workers as static assets, plus one small Worker (`src/worker.js`) for the per-fund CSV files.

The site has one page per fund of `data/funds.csv` (see "One record per fund"), 4,781 of them. `loadFundRecord(id)` in `src/lib/data.js` loads every record of every source that belongs to the fund. For each source the records are joined by date, and on a date two records share, the one with the newest NAV wins. Bibit's detail files (documents, holdings, dividends, switchable funds, fees) come from the fund's first Bibit record, and fill any gap from its other Bibit records. A fund Bibit does not list has no such details, but still gets its profile data, charts, returns, sources, and a Makmur buy link when it has one. The explorer finds a fund by any of its names, and the fund page lists the other names.

Public endpoints use the fund IDs of `data/funds.csv`:

| Path | Content |
|---|---|
| `/api/funds.json` | One entry per fund: the row of `funds.csv` (source IDs as lists), the latest NAV and AUM, and the 1-year return. |
| `/csv/funds.csv` | A copy of `data/funds.csv`. |
| `/api/funds/<id>.json` | The record of `loadFundRecord`: the Bibit fields, the per-source `nav`, `aum`, `kontan`, `bareksa`, `makmur`, the new `fund` row, `history`, the NAV and AUM series the site draws, with the source of each point, and `costs`, the merged costs and minimums (below). |
| `/csv/nav/<id>.csv`, `/csv/aum/<id>.csv` | **Changed:** the chosen history, with columns `date,nav,source` and `date,aum,source` (they were copies of the Bibit files, with `nav_adjusted`). The raw source files are in the zip files. |
| `/fund-ids.json` | Retired IDs and the fund that replaced each. |

The per-fund CSV files are not built: they would add two files per fund, and Cloudflare's free plan allows 20,000 files per deployment. `src/worker.js` runs only for `/`, `/csv/nav/*` and `/csv/aum/*` (`run_worker_first` in `wrangler.toml`; the free plan allows 100,000 Worker requests a day, and static assets are free). It reads `/api/funds/<id>.json` through the `ASSETS` binding, resolves a retired ID with `/fund-ids.json`, converts `history` to CSV, and sends the same headers `public/_headers` gives the other CSV files. It answers `GET` and `HEAD` only, and 404 as text. `src/worker.test.js` tests it with a fake `ASSETS` binding.

A retired fund ID redirects to the fund that holds its record: `npm run build` writes `dist/_redirects` (`scripts/write-redirects.js`) with the page with and without the trailing slash, in both languages, and the JSON file. The build fails above 2,000 lines, Cloudflare's limit for static redirects.

### Languages

The site is in Indonesian (at `/`) and English (at `/en/`). The pages live in `src/pages/[...lang]/`, and Astro's `i18n` routing (`astro.config.mjs`) leaves the Indonesian ones unprefixed. Texts are in `messages/id.json` and `messages/en.json`, compiled by [Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs) into `src/paraglide/` when Vite starts (`astro build`, `astro dev`). That folder is generated and ignored by Git; do not edit it. To add a text, add the same key to both files and call it as `m.the_key()` (`import * as m from '../paraglide/messages.js'`). `npm test` fails when the two files differ, or when a key is unused or missing. The locale of a page is set at build time in `src/middleware.js`, and in the browser from `<html lang>`.

- Numbers and dates come from `src/lib/format.js`, which takes the locale: Indonesian `1.234,56` and `2 Okt 2026`, English `1,234.56` and `2 Oct 2026`.
- Links to pages go through `localizeHref` in `src/lib/i18n.js`, in the browser too. JSON, CSV, and zip URLs are the same in both languages.
- Each page has a self-canonical URL and `hreflang` links for `id`, `en`, and `x-default` (Indonesian). The header switcher keeps the query and hash, and sets a `lang` cookie (one year).
- `/` runs the Worker: crawlers get the Indonesian page; otherwise the `lang` cookie decides; with no cookie, a visitor whose `request.cf.country` is set and not `ID` gets a 302 to `/en/`, and everyone else the Indonesian page.
- `astro.config.mjs` moves `dist/en/404/index.html` to `dist/en/404.html`, so Cloudflare finds a 404 page in each language.


A fund is active when its latest NAV is within 31 days of the newest date of the source that supplied that NAV (for Bareksa, the newest date in all of `data/bareksa/nav`). Bareksa's daily NAV is loaded by hand and Kontan's and Makmur's rarely update, so the fund page says how far that source's data runs when it is not Bibit.

The site draws one NAV history per fund (`src/lib/series.js`, which runs at build time and in the browser):

- **Source.** Bibit's daily history for funds buyable on Bibit, else Bareksa's daily NAV, else Kontan's, else a monthly NAV computed as Bareksa's AUM divided by its units. Newer days from the other sources extend it. Where two sources overlap, they agree.
- **Clean-up.** A one-day spike that reverses the next day is dropped as a source error. A NAV that stops changing for more than a month is treated as the end of the fund: some sources keep listing a closed fund's last NAV every day.
- **Returns.** Every return, drawdown, and sparkline is computed from that history, so the list, the fund page, and its chart agree. Bibit's own return figures are not used: they can lag its NAV history. Its `nav_adjusted` is not used either: its base changes from one scrape to the next, and the dividend list only keeps the latest five payouts, so a total return cannot be rebuilt. Returns are therefore the change in NAV; funds that pay dividends are tagged.
- **Flags.** A fund with no NAV in the 31 days before its source's newest date is inactive and hidden by default. A one-day move over 20% is shown on the fund page, since it can be a real event or a source error.
- **Fund size.** Bibit's AUM, unless Bareksa's figure for the same month differs more than tenfold (a unit error), then Bareksa's.

The home page reads `/explorer.json`, a compact summary built by `loadFundSummaries()` in `src/lib/data.js`. It is not part of the public API.

You need Node.js 22.12 or newer. Cloudflare builds with Node 24 (see `.node-version`).

```bash
npm ci
npm run dev       # dev server at http://localhost:4321
npm run build     # writes dist/ and checks Cloudflare's free plan limits
npm run preview   # serves dist/ locally with wrangler, including the CSV Worker
```

### Deploy

Cloudflare Workers Builds deploys the site from GitHub. In the Cloudflare dashboard, create a Worker from this repository (Workers & Pages, Create, Import a repository). Then check these settings under the Worker's Settings, Build:

| Setting | Value |
|---|---|
| Worker name | `reksadana-id` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` (the default) |

The Worker name must match `name` in `wrangler.toml`. If you use another name, change the file, or the build fails with a name mismatch warning.

The build image's default Node.js is already new enough. `.node-version` pins Node 24, so no build variables are needed. Every push to `main` then deploys, including the daily data commit.

Cloudflare's own docs: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/).

The build fails if `dist/` has more than 19,000 files or a file over 24 MiB, because the free plan allows 20,000 files and 25 MiB per file. That is why the download page has one zip per source, and Bareksa's daily NAV is split into several zips by size (see `src/lib/archives.js`).

## Referral codes

**Costs and minimums.** `loadFundRecord` merges them into `costs`, and every value keeps its `source`. The expense ratio is Bibit's `expenseratio.percentage` when it is a fraction between 0 and 0.1 (a few funds carry a raw number such as 4343.1, which is rejected), else Makmur's `expenseRatio` divided by 10,000, else unknown. The minimum purchase is listed per distributor: Bibit's `minbuy` only when the fund is buyable on Bibit, Makmur's `minFirstBuy`, and Bareksa's `min_purchase` (the prospectus value). The next purchase and the redemption minimum are Bareksa's. The maximum fees are Bareksa's, as `{ min, max }` fractions; Bibit's `fee` values are placeholders and are ignored. The custodian is Bareksa's, else Bibit's `custodian_bank`. A value no source has is `null` or an empty list, never 0, and the pages say "Not in our sources".

The "Buy this fund" block on a fund page links to the fund on Bibit (only when it is buyable there) and on Makmur (only when it is matched), and shows the owner's referral code with a copy button. Neither app has a working referral link, so the code is shown, not linked. The codes and the link builders are in `src/lib/referrals.js`. Change the codes there. The site footer says that some links include the owner's referral codes.

## Update the data

The GitHub Actions workflow `.github/workflows/scrape.yml` runs once a day at 23:00 UTC (06:00 in Jakarta). `scripts/decide-sources.sh` picks the sources from the UTC date, so one trigger never starts two runs on the same day. The workflow commits `data/` only when something changed. With Workers Builds connected, that commit deploys the new data.

| When (UTC) | What it runs |
|---|---|
| Every day | Bibit |
| Every Saturday (Sunday morning in Jakarta) | Kontan and Makmur |
| The first Saturday of the month (day 1 to 7) | Kontan as a full rescan, instead of the normal Kontan run |
| Every day | Bareksa fund pages (`scrape:bareksa:profiles`, up to 400 pages) |
| The 1st of every month | Bareksa (without the daily NAV) |

You can also start it by hand from the Actions tab. The `sources` input picks one of `bibit` (the default), `kontan`, `kontan-full`, `makmur`, `bareksa`, `bareksa-profiles`, or `all` (everything except the Kontan full rescan).

To run the scrapers yourself, you need Node.js 22 or newer. They have no dependencies to install.

```bash
# Update Bibit, Kontan, and Makmur (Bibit first, because the others match against the Bibit fund names).
# It runs all three even if one fails, and exits non-zero if any failed.
npm run scrape

# Update one source (Bareksa matching uses the Bibit fund names too)
npm run scrape:bibit
npm run scrape:kontan
npm run scrape:kontan:full   # scan every Kontan ID again (about 30 minutes)
npm run scrape:makmur
npm run scrape:bareksa
npm run scrape:bareksa:profiles   # up to 400 Bareksa fund pages: custodian, minimums, fees

# Join the records of all sources into data/funds.csv (npm run scrape does this last)
npm run link

# Check the Bareksa parsers
npm test

# Update only some Bibit funds
node scrapers/bibit.js RD8807 RD216
```

`scrapers/bibit.js`, `scrapers/kontan.js`, `scrapers/makmur.js`, and `scrapers/bareksa.js` hold the source-specific code. `scrapers/lib.js` holds what they share (atomic file writes, CSV, retries, the worker pool, and the name matching against Bibit).

**Bibit.** The first run downloads the full history and takes a few minutes. Later runs only download NAV and AUM rows that are newer than the last run, so they take less than a minute. The scraper decides what is new by comparing with `data/bibit/funds/<symbol>.json` from the last run. To download a fund's full history again, delete that file and its CSV files, then run the scraper.

**Kontan.** See "How the Kontan scraper works" below. It sends at most 2 requests at a time, with a short pause after each one.

**Makmur.** Reads the sitemap, then each of the 141 fund pages (about 1 minute, at most 2 requests at a time). Every run fetches every page and rewrites the files; a run without a change in the data gives identical files.

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
- `GET https://pusatdata.kontan.co.id/reksadana/get_chart_product/?produk_id=<id>&select=nab&periode=12&start_date=&end_date=` returns an HTML page. Its inline script has one `pausecontent.push('<date>')` line per date and one `data1.push('<value>')` line per NAV. An unknown ID gives the same page with no pushes. The scraper requires both array declarations (`var pausecontent = new Array()` and `var data1 = new Array()`): a response without them is an error for that fund, not an empty chart. Longer periods do not work.
- `GET /reksadana/produk/<id>` is the fund page. It is fetched once per fund, for the name, manager, and category.
- Fund IDs run from 1 to about 17,200, but only IDs up to about 1,500 and from about 14,200 hold funds. The first run scans every ID up to 18,000 and takes a long time. Later runs refresh the known funds and only look at the 500 IDs after the highest known one. An ID that failed in an earlier scan, or a fund more than 500 IDs past the highest known one, is only found by a full rescan: `npm run scrape:kontan:full` (or `node scrapers/kontan.js --full`) asks for every ID again, skips the ones already known, and merges. The workflow does this on the first Saturday of every month. The stored NAV files are kept and merged.
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

# Phase B report: home page / fund explorer

Branch `worktree-agent-ac337f28a4afde2fd`, from `39843b77`. `npm test` (217 pass) and `npm run build` pass
(14,048 files, 640 redirects, funds check passes). Verified in a browser against `astro dev` and against the
built `dist/` served by `wrangler dev` (port 8792).

## What was built (spec section 3, all of it)

- **Hero** (kawung, serif h1, one-sentence lede, big search with "/" hint and clear button, stats: funds, active,
  data date, sources, plus a download link).
- **Type cards** (8 groups): icon tile in the type tone, name (EN page: English name + Bibit label beside it),
  one-line plain description in both languages, fund count, median 1Y. Selected = `--accent-wash` + accent border.
  4 columns at 1100px and up, 2 below; description hidden under 480px. No horizontal scroll.
- **Sticky toolbar** (under the header): currency pill, Filters (badge = number of advanced filters), Columns,
  CSV, and the Include-dividends switch with an info popover. The quick chips (Sharia, On Bibit, On Makmur,
  **Pays dividends** (new), Include inactive) sit in a row right under it. They are not in the sticky bar: with
  them the bar wraps to two rows below about 1300px and eats 110px of the screen while stuck (decision below).
- **Filters** `<dialog>`: right drawer on desktop, bottom sheet under 720px. Native modal, so focus is trapped,
  Esc closes, focus returns to the Filters button (checked). Fields: manager (searchable multi-select, chosen
  ones move to the top on open), 1Y return min/max, 3Y return per year min, worst fall 1Y (no worse than /
  worse than), fund size min (Rp billion), expense ratio max, minimum purchase max, launched in-or-after /
  before year, NAV history at least N years. Limits apply live (250ms debounce); "Reset" clears them; the primary
  button reads "Show N funds" and closes the panel.
- **Columns menu** (native popover): presets Simple / Returns / Risk / Costs / Everything, a checklist of all 19
  columns, a Comfortable / Compact density switch. Both persist in localStorage (`explorer-columns`,
  `explorer-density`, try/catch). A tiny inline script applies them before the table paints, so a returning
  reader sees no flash.
- **CSV**: the filtered and sorted rows, all pages, visible columns, built in the browser (UTF-8 BOM, CRLF,
  percent columns as plain numbers with `(%)` in the header, fund ID/name/manager/type/currency always first).
- **Active-filter chips**, each removable, plus "Clear all" (keeps sort and page size) and the result count.
- **Table**: type icon tile in the fund cell, name link, manager and ID, tag chips, sticky header, `aria-sort`,
  tabular numbers, row hover, compare checkbox column and sticky compare bar kept. Columns: NAV, 1M, 3M, 6M, YTD,
  1Y, chart, 3Y, 5Y, 3Y/yr, 5Y/yr, fall 1Y, fall 3Y, fund size, expense ratio (+source), min purchase, buy fee,
  sell fee, launched, buy on. All numeric ones sort.
- **Phones** (< 720px): rows become cards (tile + name + manager + tags; 1Y big, YTD, size, sparkline; NAV and
  date; buy chips), a Sort-by select with a direction button, 48px compare target, Columns button hidden.
- **Pager**: Previous / "Page x of y" / Next, range label, page-size select 25/50/100.
- **"How we compute this"** card (title changed, two new bullets: worst fall, costs and 3Y/yr).
- **Skeleton rows** when a shared link opens a filtered view (the build-time rows are the default view and would
  flash first). Measured layout shift with `explorer.json` delayed 2.5s: CLS 0.00005 at 1440px, 0.0001 at 390px.
  A plain visit to `/` has no swap at all.
- **No JS**: the first 50 rows and the hero render on the server. A `noscript` style hides the controls that need
  JS (toolbar, search, cards, pager). Checked with JS disabled.
- **URL state**: `q type currency sharia bibit makmur inactive sort dir page` kept; new: `div=1` (pays dividends),
  `manager` (repeated), `r1y_min r1y_max r3y_min dd_max dd_min aum_min er_max minbuy_max since before years`,
  `size`. Units: percent, Rp billion for `aum_min`, rupiah for `minbuy_max`, year for `since` (in or after) and
  `before` (strictly before). Unknown or malformed values fall back to defaults. Columns and density are not in
  the URL.

## Data

`loadFundSummaries()` still returns `{ date, usd_to_idr, funds: [objects] }` with every old field name and
value. It gained: `return_3m return_6m return_5y cagr_3y cagr_5y drawdown_1y drawdown_3y expense_ratio
expense_source min_purchase fee_subscription fee_redemption launch_date history_start`, and `total` now also holds
the 3M/6M/5Y returns and CAGRs. `dividends` (already there) is the pays-dividends flag (19 funds, equal to
Bibit's `is_has_dividend`). Notes:

- 6M is computed in `data.js` with `periodStartIndex(history, '6m')`; I did not touch `series.js`
  (`RETURN_PERIODS` has no `6m`, `periodStartDate` does).
- `min_purchase` is the lowest rupiah amount in `costs.min_purchase`; `expense_ratio` is `costs.expense_ratio`
  (value, source). If phase C changes the shape of `costs.expense_ratio` to a list, `buildFundSummaries` needs a
  one-line change.
- Drawdowns, CAGRs, and returns are null for inactive funds, like the old returns.

### Compact `explorer.json` (`src/lib/explorer-data.js`, used only by `src/pages/explorer.json.js`)

`{ date, usd_to_idr, columns, dictionaries, funds: [[...], ...] }`. Manager, type, currency, AUM currency, and
expense source become indexes into `dictionaries`; the 8 yes/no fields are one integer; Sharia stays
true/false/null (it can be unknown); dates are days since 2000-01-01; returns, CAGRs, and drawdowns are whole
tenths of a percent, expense ratio and fees whole hundredths; the sparkline is a 40-char base-36 string (36 steps
instead of 100); `total` is an array for the 19 dividend funds. `decodeSummaries()` gives back objects with the
old field names.

**Sizes** (`dist/explorer.json`):

| | raw | gzip |
|---|---|---|
| before (4,667 funds) | 2,472,434 B (2.47 MB) | 277,762 B |
| after | 961,159 B (0.96 MB) | 217,165 B |

(Brotli of the new file is about 158 KB.)

**Compatibility with phase C**: `prepareFunds(data)` in `explorer.js` accepts either shape (it decodes when it
sees `data.columns`), so `compare-page.js` keeps working unchanged: it fetches `/explorer.json`, calls
`prepareFunds`, `filterFunds`, `sortFunds`, `escapeHtml`, `DEFAULT_STATE`. All five are still exported. Checked:
the compare picker finds funds in the browser. `src/pages/api/funds.json.js` reads the same objects and is
unchanged.

## Files

New: `src/lib/explorer-data.js`, `explorer-columns.js`, `explorer-render.js`, `explorer-csv.js`,
`explorer-preferences.js`, `src/styles/explorer.css`, and tests `explorer-data.test.js`,
`explorer-filters.test.js`, `explorer-csv.test.js`. Rewritten: `src/lib/explorer.js`, `src/pages/[...lang]/index.astro`.
Edited: `src/lib/data.js` (inside `loadFundSummaries` and its helpers, plus one import), `src/pages/explorer.json.js`,
messages, README line. All explorer CSS is in `src/styles/explorer.css` (imported by the page), not `global.css`.

## Messages (orchestrator merge)

About 95 new keys in both files, inserted as one block right after `method_flag`. Existing keys whose text
changed (same key): `home_lede` (no params now), `home_lede_download`, `type_all_note`, `type_other_note`,
`method_title`, `filter_inactive` (now "Include inactive ({count})"), `search_placeholder` (shorter, so it fits at
360px; also used on the compare and 404 pages). No key was removed or renamed; the i18n test (same keys, same
params, every key used) passes.

## Decisions

- Default columns are the spec's Simple preset (Fund, 1Y, chart, Size). At 1440px that is a calm but airy table;
  one click gives Returns, Risk, Costs, or Everything.
- Column visibility is a `data-show` list on the table plus generated CSS (`.col-<key>`), so every row always
  carries every cell. Changing columns re-renders nothing, the choice applies before first paint, and the CSV
  and the phone cards do not depend on it.
- Sticky header vs wide tables: with few columns the frame is `overflow: clip` and the header sticks under the
  toolbar against the page. When the table is wider than the frame, a script adds `.is-wide`: the frame scrolls
  both ways (max height = viewport minus header and toolbar), the header and the Fund column stick inside it.
- A fund missing a figure fails a filter on that figure (stated in the panel).
- Include-dividends only swaps returns and CAGRs (the `total` block); drawdowns stay NAV-based.
- The filter panel's fields are filled when it opens, not on every change, so a half-typed "-" is never overwritten.

## Screenshots

Folder `/home/risan/.cache/claude-tmp/claude-1000/-home-risan-projects-code-reksadana-id/a14481e0-7cd8-4f16-a941-1017471ce1ac/scratchpad/ui-b/shots/`
(scripts next to it: `flow.mjs`, `behave.mjs`, `skeleton.mjs`). From the built site on port 8792:
`w360-light-id-*`, `w390-light-id-*`, `w390-dark-en-*`, `w1440-light-en-*`, `w1440-dark-id-*`, each with `top`
(hero and cards), `table`, `columns-menu`, `columns-everything` (desktop), `filtered`, `filters-dialog`.
Also `nojs.png`, `skeleton-d.png`, `skeleton-m.png`, and `t3-*` (820px).

Seen and fixed on the way: sticky header cells pushed down inside the frame (a global `.table-scroll` rule beat
mine, fixed with a compound selector); toolbar wrapping to two rows (quick chips moved out of the sticky bar);
phone toolbar showing the Columns button; clipped placeholder at 360px; pager wrapping on phones; skeleton bars
invisible in the Fund cell and a 0.08 layout shift (fixed, see above).

Behaviour checked in the browser: header sorting and `aria-sort`, type cards, currency and chips, search and the
clear button, Include dividends (changes the numbers), compare tray and bar, page size and paging, column
persistence across reload, CSV download (file name `reksadana-id-<date>.csv`), "/" focuses search, Filters opens
with Enter, Tab stays inside the dialog, Esc closes and returns focus, Columns popover opens with Enter and Esc
returns focus. No console errors; no horizontal page scroll at 360, 390, and 1440px in either theme or language.

## Known gaps and notes

- **Header at 768 to ~850px (phase A, `Base.astro`)**: the language pill is clipped and the page scrolls 5px
  sideways at 820px (`.header-actions` ends at 825px). Not mine; I left it.
- No volatility column or filter (not computed anywhere), so the Risk preset shows 1Y, chart, fall 1Y/3Y, 3Y/yr.
- Buy and sell fees come from Bareksa (the highest the prospectus allows) and exist for about 700 active funds;
  expense ratio for about 260; minimum purchase for about 870.
- The quick chips wrap to three rows on a 360px phone (44px targets); a horizontally scrolling row would save
  about 100px but the spec asks for no horizontal scroll.
- The kawung hero is about 380px tall on desktop; shrinking the h1 further would put the cards higher.
- Row click navigation still needs a mouse; keyboard users get the name link (focusable) and the compare box.
- The commit trailers asked for by the session reminder were not added (repo CLAUDE.md forbids them).

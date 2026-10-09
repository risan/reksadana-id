# Phase C report: fund page and compare page

Branch `worktree-agent-a89869cb2484cd89f`, from `39843b77`. `npm test` and `npm run build` pass (numbers at the end).

## Built

Fund page (`src/pages/[...lang]/funds/[id].astro`, rebuilt):

- Header band (`.card.kawung-bg`, pattern faded harder than the home hero so the title sits on calm paper):
  breadcrumb with chevrons, 56px type tile, serif h1, "also known as", manager as a link to `/?manager=<short name>`
  (phase B adds the filter), chips (type with icon and Bibit label, Sharia, USD, ETF, Index, Dividend, risk),
  actions: compare toggle, "open comparison", Share (Web Share API, falls back to copying the link, and says so
  when even that fails), "Buy" jump (phones only, shown when the fund is buyable).
- Key figures: 4 cards, each with an info button (`popovertarget`) and one plain sentence (NAV, return, worst
  fall, AUM). `src/lib/info-popover.js` places each popover under its button (clamped to the window, flips above
  near the bottom, closes on scroll). Without JS the native popover still opens, centered. The dividends view
  switching (`data-view`) is kept.
- At a glance: up to 4 sentences, each skipped when its data is missing (1Y return plus rank among the type,
  worst fall, expense ratios with sources, years of price history). Inactive funds get no 1Y sentences.
- Sticky section nav (only sections with data), in-view highlight (`aria-current="location"`), centers the
  current link, edge fade on phones driven by `--fade-start/--fade-end` set from the scroll position.
- Overview grid: glance, profile, buy card, details. Desktop: left column glance + profile, right rail buy +
  details. Phones: figures 2x2, buy card, glance, details, profile (`display: contents` + `order`).
- Performance: one chart card (range pills, readout, crosshair tooltip, NAV chart, AUM chart), returns table,
  dividends table. The returns table has ONE row path (`returnRows()` in the page): a row is
  `{ label, title, className, cells }`, so a benchmark row is one more array entry. Period columns with no data
  at all are dropped (the 10Y column was empty for most funds). A muted italic "Category median (<type>)" row.
- Portfolio: asset mix bar + legend + 24-month history card, holdings card in two columns.
- Costs card: every source's expense ratio as a tile with its source name ("1.22% Bibit", "1.26% Makmur") and a
  note when they differ; rows with data only; "Not in our sources: ..." once at the end.
- Documents (prospectus and factsheets card, switch-to card) and Data (downloads, sources, chart note) cards
  with icons. Every section without data is not rendered, and its nav link goes with it.
- Profile summary fix: first line with a letter or digit; the whole card is hidden when there is none (46 funds
  have just "-"); if the text is a single line there is no `<details>`.
- Referral-code copy button: error handling added. On failure it selects the code and says "Copy it by hand".
- The chart script no longer needs `nav-empty`/`aum-empty`: a chart with no data is not rendered, and one
  `#chart-error` message covers a failed fetch.

Compare page (`src/pages/[...lang]/compare/index.astro`, `src/lib/compare-page.js`):

- Search field (combobox, `aria-expanded`) with a results popover: type tile, name, manager, ID, Add/Added.
  Arrow keys move through results, Enter adds the first, Escape closes, outside click closes. Adding clears the
  field.
- Selected funds as chips with their series color dot, name link and remove button, "3 of 5 picked".
- Chart card (range pills, start/end text, chart, caption). The legend list is gone: the chips are the legend.
- Table: sticky first column (narrower on phones), each fund header has a type tile, a series-colored top
  border, name, ID and a remove button. Best value per row gets a gold dot with `role="img"` and an
  `aria-label` ("Best of the funds compared"): highest return and CAGR, smallest worst fall, lowest expense
  ratio (first-choice value). Ties are judged on the displayed value (0.1% for returns, 0.01% for the ratio),
  so equal-looking cells do not get one dot. Nothing is marked when fewer than two funds have a value or all
  tie. A note under the table explains the dot and says it is not an overall ranking. The lede still says funds
  of different types are not simply comparable. Expense ratio cells list every source.

Charts (`src/lib/fund-charts.js`, `compare-page.js`): cursor dot fills with `--surface`; NAV line and fill use
`--accent`, fund-size uses `--gold`; axis font is `--sans` at 12px (was Schibsted Grotesk at 11.5px, a font
that no longer exists); themechange redraw kept.

Data and logic:

- `src/lib/costs.js`: `expense_ratios` lists every valid source's value; `expense_ratio` is still the first
  choice. `costs-text.js` adds `expenseRatios` (identical figures from two sources share one line, "Bibit,
  Makmur"). README and the `api_fund_costs` message (both languages) describe it.
- `src/lib/fund-page.js` (new, pure): `peerReturns` (per type, sorted returns of active funds, memoized per
  `loadFundSummaries().funds` array, NAV and total views), `median`, `medianReturns`, `shareBeaten`,
  `profileSummary`, `TABLE_PERIODS`, `MIN_PEERS = 5` (a median or a rank among fewer funds is left out).
  Medians are read from `return_<period>` fields of the summaries, so when phase B adds `return_3m/6m/5y` the
  muted row fills in with no change here. Today only 1M, YTD, 1Y, 3Y have medians; other cells show a dash.
  The median row is hidden for an inactive fund (its returns end long ago, the medians are today's).
- `src/lib/compare.js`: `bestIds(entries, prefer)`.
- `src/lib/icons.js`: added `file-text`, `arrow-left-right`, `database` (Lucide 1.54.0, inserted in the middle of
  the list to ease merging with other branches).
- Tests: costs (every source, text grouping), fund-page (peers, medians, share beaten, profile summary),
  compare (`bestIds`). 211 tests pass.

## Decisions

- Type group = the exact Bibit type label of the fund. The percentile is the share of the OTHER funds in the
  type with a lower 1Y return, from the summary's own rounded value, so the fund never counts against itself.
- The sentence reads "better than 88% of similar funds (Obligasi)" or "worse than N%" when under half, so the
  template needs no type grammar in either language.
- Medians for the total-return view use `total.return_*` where a fund has dividends, else its NAV return.
- Buy card sits in the overview rail on desktop (not a sticky sidebar for the whole page): the page is now
  single column below the overview, so charts get the full width.
- `loadFundSummaries().funds` is used (the current shape: `{ date, usd_to_idr, funds }`). If phase B changes
  that return shape, two lines in `[id].astro` and one in `compare/index.astro` need the same change.
- `compare-page.js` still reads `explorer.json` through `prepareFunds` (needs `id, name, manager, type, active,
  fund.currency, nav, nav_date, aum, ...`). If phase B changes the file shape it must keep `prepareFunds`'s
  output; `type` is now also read for the type tile.
- `info-popover.js` is generic (`.info-pop` + `popovertarget`), so phase B can reuse it for the dividends switch.

## Screenshots

Playwright, outside the repo:
`/home/risan/.cache/claude-tmp/claude-1000/-home-risan-projects-code-reksadana-id/a14481e0-7cd8-4f16-a941-1017471ce1ac/scratchpad/ui-c/shots/`
(`<name>-<width>-<light|dark>[-<scroll>].png`; scripts `shoot.mjs`, `interact.mjs`, `picker.mjs` next to it).
Seen: rd3480 (rich, buyable, Bibit + Makmur, differing expense ratios) at 390 and 1440, light and dark, ID and
EN; BRK248 (not on Bibit, no holdings, no documents) and BRK3 (inactive, large moves) at 1440 and 360; RD142
(USD) at 390 dark and 360; RD214 (dividends, documents, switch-to) at 1440 and interaction test; compare
`?f=RD3480,RD124,RD870` at 1440 and 390, light and dark, ID and EN; the picker open at 1440 dark.
No horizontal page scroll at 360, 390 or 1440 on any of them. Interaction test (390): popover opens and Esc
closes it, share falls back to a message when the clipboard is blocked, a failed copy selects the code and
changes the label, the nav highlight follows scrolling (Costs, then Data at the page end), the dividends
switch flips `data-dividends`, no console errors. Picker: keyboard add works and the URL updates.

## Known gaps

- Median row: only the periods that `loadFundSummaries` has (1M, YTD, 1Y, 3Y) until phase B adds the others.
- Wide returns table on phones scrolls inside its card (columns are periods); the first column does not stick.
- The sticky section nav does not use scroll-spy for tiny sections at the page end (the last link is forced
  current at the bottom).
- Inactive funds still show returns computed to their last NAV (existing behavior); only the median row and
  the 1Y sentences are suppressed.
- Chart y-axis keeps 64px on phones, which narrows the plot a little.
- Dev toolbar of `astro dev` is visible in some screenshots (round pill at the bottom); it is not in the build.
- `src/lib/icons.js` and `messages/*.json` appends will conflict textually with the other branches (same last
  lines); resolve by keeping both sides.

## Phase D: benchmarks, OJK, freshness, API docs

Merged `worktree-overhaul-2026-10` twice (data enrichment first, then phase B and backend round 2): no conflicts.
`npm test` 293 pass, `npm run build` passes (9,228 pages, 13,891 files, 1,035 redirects, funds check passed).

Built (fund page `[id].astro`, `src/lib/fund-charts.js`):

- Returns table: one muted italic row per suggested index (short name, full localized name in the `title`),
  from `fundBenchmarks()`; same single `returnRows()` path as the median row (both use `.row-reference`). The
  BI-Rate is not a row: "BI-Rate 5.75% a year (as of 23 Sep 2026)" is a note under the table.
- Chart: "Compare with" pills (None + each index) under the range pills; they wrap on phones, since names such as
  "Bareksa Fixed Income Fund Index" are long. The chosen index is drawn dashed in `--gold`, rebased to the fund's
  NAV at the range start (`rebaseBenchmark` in `src/lib/benchmarks.js`, tested). Levels load from
  `/api/benchmarks/<id>.json` on first use and are cached in memory; a failed load shows a message and goes back
  to None; an index with no level at the range start (e.g. All) says so. The readout and the tooltip get the
  index's change over the range. The overlay follows the dividend toggle, the range pills, and `themechange`.
- At a glance: "Over the same year, IHSG moved -26.9%." after the fund's return sentence, from the first suggested
  index, skipped for inactive funds or when missing.
- OJK in Details: "OJK: Registered" and "Fund size per OJK: Rp 7.1T · Sep 2026" (rupiah, month), a month-end AUM
  sparkline (`linePath`, tested) with a caption; `zero_aum` shows a notice under the header ("OJK reports zero
  assets for this fund in Sep 2026: it may be dissolved, matured, or not launched yet") and a Details row;
  `not_listed` is a muted Details row with the last month listed.
- Freshness notice: only when the NAV source's newest date is more than 5 days behind the site's newest data
  date; wording "Latest NAV is from <date> (<source>)". RD3480 no longer shows it (checked at 390px).
- Returns table: the first column is sticky (also on desktop), with a width that keeps labels readable.
- API page: endpoint rows, TOC entries, field tables and examples for `/api/benchmarks.json` and
  `/api/benchmarks/<id>.json`; `ojk` in the funds.json fields; `ojk` and `benchmarks` in the one-fund table, with
  an example of both. `costs.expense_ratios` was already in the `costs` description (phase C). Download page:
  three more "What's in the data" blocks (Benchmarks, Bank Indonesia, OJK); the zip list was already generated.
- Chart tooltip names get an ellipsis (moved from the compare page's CSS to `global.css`) and the tooltip no
  longer runs off the left edge on phones.
- Tests: `rebaseBenchmark` (3), `shortBenchmarkName`, `linePath`. The explorer's `ojk_status` is untouched.

Screenshots (same folder as above; `d-*` and `overlay*` files): RD3480 (390, no freshness notice), RD870 (money
market, BI-Rate note, overlay with the Bareksa index, 390 and 1440 dark, ID and EN), RD216 (equity with IHSG,
overlay, OJK block, 1440 and 390 dark), RD493 (OJK zero_aum notice, 1440), API page at 360 (benchmarks section),
Download page at 360 dark. No horizontal scroll, no console errors; the overlay interaction was run at 1440 and
390 (index switch, 3Y and All ranges).

Known gaps: the cursor shows a point on the overlay line too; "All" on a fund older than its index shows the
"no data at the start of this range" message instead of a partial line (by design: the index must be rebased at
the range start).

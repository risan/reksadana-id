# UI overhaul spec

Goal: a site a first-time investor understands at a glance, that still gives a power user every number,
filter, and column. Beautiful and calm on a phone and on a desktop, in light and dark.

Read first: `README.md`, `src/styles/global.css`, `src/layouts/Base.astro`, the pages in `src/pages/[...lang]/`,
`src/lib/explorer.js`, `src/lib/fund-charts.js`, `src/lib/compare-page.js`, `messages/*.json`.
Follow `~/.claude/CLAUDE.md` code style: braces always, a blank line after a block, no comments that repeat
the code, no abstraction without a second caller. Every new text goes into BOTH `messages/id.json` and
`messages/en.json` (Indonesian is the default locale; write natural Indonesian, not a word-for-word copy).
`npm test` checks that the two files match and that every key is used.

## 1. Design system (global.css tokens)

Replace the ad-hoc values with tokens. Every page style uses tokens only; no new raw px values for
color, radius, spacing, or font size outside the token block (layout widths and chart sizes are fine).

### Color

Indonesian identity: deep batik indigo as the brand color, sogan/turmeric gold as the warm second color,
warm ivory paper. Light theme:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#f7f5ef` | `#0e1116` | page background |
| `--surface` | `#ffffff` | `#151922` | cards, table, inputs |
| `--panel` | `#f0ede4` | `#1b2029` | subtle fills, hover rows, code |
| `--ink` | `#12151c` | `#eceae4` | main text |
| `--ink-2` | `#3a3f4b` | `#c4c6cc` | secondary text |
| `--muted` | `#656a79` | `#9095a1` | labels, captions (must pass 4.5:1 on paper and surface) |
| `--faint` | `#9ca0ab` | `#646a76` | decorative only, never for text that matters |
| `--rule` | `#e6e1d5` | `#252b36` | hairlines |
| `--rule-strong` | `#cfc8b8` | `#353c49` | input borders, section rules |
| `--accent` | `#2440a8` | `#8ea2ff` | links, primary buttons, focus |
| `--accent-strong` | `#1a2f80` | `#b3c0ff` | hover/pressed |
| `--accent-wash` | `#e8ecfb` | `#1c2440` | selected chips, active filters |
| `--gold` | `#b97a12` | `#e2ae4a` | highlights, the logo mark, "best" markers |
| `--gold-wash` | `#fbf0d9` | `#2a2316` | notices |
| `--up` / `--up-wash` | `#0b7f55` / `#e3f4ec` | `#3dd08f` / `#12261d` | gains |
| `--down` / `--down-wash` | `#c2361f` / `#fbe7e2` | `#ff7a63` / `#2c1714` | losses |
| `--warn` / `--warn-wash` | keep current meaning, retune to match | | |

Keep `--alloc-*` and `--series-*` (chart colors), retuned so they sit well on the new paper and pass 3:1
against `--surface` in both themes. Add one color per fund type, used for the type icon tile and the
type chip: `--type-money` (teal), `--type-bond` (indigo-blue), `--type-equity` (vermilion), `--type-mixed`
(violet), `--type-global` (sky), `--type-protected` (slate), `--type-other` (warm gray); each with a `-wash`.

Theme switching (new): a header control cycles System / Light / Dark. Store it in `localStorage`
key `theme` (`light` | `dark`, absent = system), every access in try/catch. Set `data-theme` on `<html>`
from an inline script in `<head>` before CSS paints (no flash). CSS: light tokens on `:root`; dark tokens
under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` AND under
`:root[data-theme="dark"]`. `color-scheme` follows. The charts already redraw on `prefers-color-scheme`
change; make them also redraw on a `themechange` event the toggle dispatches.

### Type

- UI and numbers: **Plus Jakarta Sans Variable** (`@fontsource-variable/plus-jakarta-sans`, designed by
  Tokotype for Jakarta; fits the subject). All numbers use `font-variant-numeric: tabular-nums`. Verify the
  font has a `tnum` feature (e.g. render "1111" and "8888" in a test page and compare widths in the
  browser, or inspect with any tool available). If it does not, use **Manrope Variable** instead and say so.
- Display: keep **Newsreader Variable** for page titles (h1) and the hero only, optical size on.
- Mono: keep Spline Sans Mono for code, IDs, and the API page only. Drop Schibsted Grotesk.
- Scale (px): `--fs-xs 12`, `--fs-sm 13`, `--fs-base 15`, `--fs-md 16`, `--fs-lg 18`, `--fs-xl 22`,
  `--fs-2xl 28`, `--fs-3xl 36`, `--fs-4xl 46`. Body 15px / 1.55. Nothing that carries meaning below 12px.
  Inputs are 16px on phones (stops iOS zoom on focus).
- Weights: 400 body, 500 labels, 600 headings and key figures, 700 only the hero numbers.

### Space, radius, depth

- Spacing scale on a 4px grid: `--s-1 4`, `--s-2 8`, `--s-3 12`, `--s-4 16`, `--s-5 24`, `--s-6 32`,
  `--s-7 48`, `--s-8 64`. Page gutter 16px on phones, 24px on tablets, 32px on desktop. Max width 1280px.
- Radius: `--r-xs 6` (tags), `--r-sm 10` (inputs, buttons), `--r-md 14` (cards, table frame),
  `--r-lg 20` (hero, sheets, dialogs), `--r-pill 999px` (chips, segmented controls).
- Shadows, used sparingly: `--shadow-1` (cards: 1px hairline + very soft 0 1px 2px), `--shadow-2`
  (popovers, sheets, sticky bars). Dark theme uses lighter borders instead of darker shadows.
- Motion: 120–180ms ease-out for hover/press/open; none under `prefers-reduced-motion: reduce`.

### Pattern

A **kawung** batik motif (four ellipses around a point, repeated on a square grid) as an inline SVG
`background-image` tile, drawn with a 1px stroke. Used in: the home hero, the fund page header band,
the empty states, and the footer. Opacity about 6–8% of `--ink` in light, 8–10% in dark (two data-URIs or
a `mask-image` over a `--ink`-colored layer, whichever stays simple). Fade it out with a mask gradient so
text always sits on a calm area. Also redraw the favicon and the wordmark mark as a small gold kawung
glyph next to "Reksadana" (inline SVG, works in both themes).

### Icons

Lucide icons (ISC license; add a line to the README credits). Put the SVG markup of only the icons used
into `src/lib/icons.js` (one export, `icon(name, { size, label })` returning an SVG string with
`aria-hidden="true"` unless a label is given). Astro pages and the client renderers both use it, so there
is one source. Needed at least: search, sliders-horizontal (filters), columns-3 (columns), chevron-down,
chevron-right, arrow-up-right (external), arrow-up / arrow-down (sort), copy, check, x, info, sun, moon,
monitor, download, braces (API), git-compare (compare), plus, minus, filter-x (clear), table-2 / list
(view), share-2, calendar, and the fund types: wallet (money market), landmark (bonds), trending-up
(equity), chart-pie (mixed), globe (global), shield-check (protected), layers (other / ETF / index),
moon-star (sharia), coins (dividend). Type icons sit in a 28–32px rounded tile tinted with the type color.

## 2. Layout shell (Base.astro)

- Sticky header, `--surface` at ~85% with `backdrop-filter: blur`, hairline bottom. Left: logo mark +
  wordmark. Center/left: nav with icons + labels (Funds, Compare, Download, API). Right: data freshness
  (dot + "Data 8 Oct 2026", hidden on phones), theme toggle (icon button), language switch (ID/EN pill).
- Phones (< 720px): the top bar keeps logo, theme, language. The four nav items move to a fixed bottom
  tab bar (icon above label, 56px + safe-area inset) so they are in thumb reach. Pages get bottom padding
  so nothing hides behind it. The compare bar (explorer) sits above the tab bar.
- Footer: kawung band, disclaimer, links, source credits (Bibit, Bareksa, Kontan, Makmur, Lucide).
- Skip link to main content. Focus ring: 2px `--accent` + 2px offset everywhere.

## 3. Home / fund explorer

Two audiences on one page: the default view is simple; every power feature is one click away and lives
in the URL so a view can be shared.

1. **Hero** (kawung pattern, rounded `--r-lg`, `--surface`): serif h1, a one-sentence plain-language
   lede ("Compare every Indonesian mutual fund: price, growth, size, and costs, from four sources,
   updated daily"), a big search field (search icon, "/" hint, clear button), and a small stats row
   (number of funds, active funds, data date, 4 sources).
2. **Browse by type**: one card per type group (the existing 8 groups), with the type icon tile, the
   name (English page: English name + Indonesian label below in muted; Indonesian page: Indonesian name),
   a one-line plain description of what it is for and its risk ("Low risk, for money you need soon" /
   "Risiko rendah, untuk dana jangka pendek"), the fund count, and the median 1Y return. Selected card
   gets `--accent-wash` + accent border. Layout: 4 columns ≥1100px, 2 columns on tablets and phones
   (compact card: description hidden < 480px). **No horizontal scrolling.**
3. **Toolbar** (sticky under the header while the table is in view):
   - Currency segmented pill (All / IDR / USD).
   - Quick toggle chips: Sharia, On Bibit, On Makmur, Pays dividends (new filter), Include inactive.
     "Include dividends" (total return) stays, but as a labelled switch with an info popover that
     explains it in one sentence.
   - **Filters** button (badge with the count of active advanced filters) opens a panel: a right-side
     drawer on desktop, a bottom sheet on phones (`<dialog>`, focus trapped, Esc closes). Fields: manager
     (searchable multi-select of managers), 1Y return min/max, 3Y return per year min, max drawdown 1Y
     (worse than / better than), fund size (AUM) min, expense ratio max, minimum purchase max, launched
     before/after year, has NAV history ≥ N years. "Reset" and "Show N funds" buttons.
   - **Columns** button opens a menu of checkable columns + presets: *Simple* (Fund, 1Y, chart, Size),
     *Returns* (1M, 3M, 6M, YTD, 1Y, 3Y, 5Y), *Risk* (1Y, max drawdown 1Y/3Y, volatility if available),
     *Costs* (expense ratio, min purchase, fees), *Everything*. A density toggle (Comfortable / Compact).
     Columns + density persist in `localStorage` (`explorer-columns`, `explorer-density`, try/catch).
   - **Download CSV** of the current filtered and sorted rows (all pages, visible columns), built in the
     browser.
   - Under the toolbar: active filter chips (each removable) + "Clear all", and the result count.
4. **Table** (desktop and tablet): `--surface` card with `--r-md`, sticky header row, row hover with
   `--panel`, right-aligned tabular numbers, gains/losses colored with a sign and an arrow-free style.
   Fund cell: type icon tile, name (link), manager · ID in muted, tags (Sharia, ETF, Index, Dividend,
   Inactive) as small chips. Sort by clicking any numeric header (arrow icon shows direction; `aria-sort`).
   Keep the compare checkbox column and the sticky compare bar.
5. **Phones** (< 720px): rows become cards: type tile + name + manager on top; a 3-number line
   (1Y big, YTD, Size) and the sparkline; NAV + date in muted; buy chips. A "Sort by" select replaces
   header sorting. Compare checkbox stays as a 44px touch target.
6. Pagination: keep 50 per page, plus a page-size select (25/50/100) and "Page x of y".
7. "How we compute this" stays as a collapsible card at the bottom.

**URL state**: every filter, sort, page, and advanced filter is read from and written to the query
(keep the existing names `q,type,currency,sharia,bibit,makmur,inactive,sort,dir,page`; add short, readable
names for the new ones, e.g. `manager`, `r1y_min`, `r1y_max`, `dd_max`, `aum_min`, `er_max`, `minbuy_max`,
`since`, `before`, `div=1`, `years`). Columns are a per-viewer preference, not in the URL.

**Data for the new columns**: extend `loadFundSummaries()` (src/lib/data.js) with what the new columns
and filters need: returns 3M/6M/5Y, CAGR 3Y/5Y, max drawdown 1Y/3Y, expense ratio (value + source),
min purchase (the lowest across distributors, rupiah), launch date, history start date, pays-dividends.
**Size budget**: `dist/explorer.json` is 2.4 MB today. It must not grow; aim for under 1.5 MB raw. Use a
compact shape (a `columns` header + one array per fund, numbers rounded to what is shown, sparkline as
quantized integers 0–99 or a delta-encoded string). It is not a public API, so the shape can change;
update `explorer.js` to read it. Report the before/after size and gzip size.

## 4. Fund page

1. **Header band** (kawung pattern, `--r-lg`): breadcrumb; type icon tile; name (serif h1); manager
   (link to the explorer filtered by that manager: `/?manager=…`); chips (type, Sharia, USD, ETF, Index,
   Dividend, risk level); actions: Add to compare (toggle), Share (Web Share API, else copy link), Buy
   (scrolls to the buy card on phones).
2. **Key figures**: 4 cards (NAV + 1-day change, 1Y return, worst fall 1Y, fund size) with an info
   popover each (native `popover` + `popovertarget` button with the info icon) explaining the term in one
   plain sentence: NAV, return, drawdown, AUM.
3. **At a glance** (new): 2–4 plain-language sentences built from the data with message templates, e.g.
   "Over the last year this fund grew 4.1%, better than 68% of bond funds." "Its biggest drop in that
   year was 1.6%." "Costs: expense ratio 1.22% a year (Bibit)." "It has 6 years of daily prices." Compute
   the percentile within the fund's type group at build time (active funds with a 1Y return only). Skip a
   sentence when its data is missing.
4. **Section nav**: a sticky anchor bar (Overview, Performance, Portfolio, Costs, Documents, Data) that
   highlights the section in view. On phones it may scroll sideways (it is a nav strip, labels short) but
   must show a fade at the edge.
5. Performance: the chart card (range pills, readout, crosshair tooltip), the AUM chart, and the returns
   table. **Add the type median** as a muted row in the returns table ("Median of bond funds") so a reader
   can tell good from bad. Data: type medians per period, computed at build time once.
6. Portfolio: asset mix bar + history (as now), top holdings as a clean two-column list.
7. Costs card: show **every source's expense ratio** with its source name when they differ (Bibit and
   Makmur disagree by up to 2x on the same fund, and neither gives a date), not just the first one. Fees
   and minimums as now. Remove empty rows; say "Not in our sources" once at the end for the missing ones.
8. Documents, Switch to, Data/downloads: as now, restyled as cards with icons.
9. Profile: **fix** the summary. Use the first non-empty line that is not just punctuation; if the profile
   has no real text, hide the section.
10. Hide every section whose data is missing (no empty headings, no "-").
11. Phones: single column; key figures 2×2; the buy card moves right under the key figures.

## 5. Compare page

Restyle with the new system: picker as a search field with a results popover; selected funds as chips
with their series color; chart card; the table with a sticky first column and the type icon in each fund
header. Highlight the best value per row (highest return, smallest drawdown, lowest expense ratio) with a
gold dot and `aria-label`, but keep the existing text that says funds of different types are not simply
comparable. Phones: chart full width; the table scrolls sideways inside its card with the sticky first
column (that is fine for a comparison table).

## 6. Download, API, 404

Download: each archive as a card (icon, name, what it holds, size, download button). API: keep the
content; add a copy button to every code block; the left table of contents becomes a sticky side nav on
desktop and a collapsible "On this page" on phones. Localize the leftover hard-coded strings ("Zip",
"API" heading where a translation fits, the explorer's "RDPT, DIRE, ETF" note, the "USD · " prefix).
404: friendly empty state with the kawung pattern, a search field, and links.

## 7. Quality bar

- WCAG AA contrast for all text in both themes; 44×44px touch targets on phones; visible focus; every
  icon-only button has an accessible name; dialogs trap focus and restore it.
- No horizontal page scroll at 360px width on any page (tables scroll inside their own card only on the
  compare and API pages).
- No layout shift when `explorer.json` arrives: reserve the table height / show skeleton rows.
- Lighthouse-style hygiene: fonts `font-display: swap`, preload the main UI font file, no unused fonts.
- Everything works without JS where it did before (server-rendered first page of the explorer).
- `npm test` and `npm run build` pass; the build checks (file count, redirect count) still pass.
- Verify in a browser at 390px and 1440px, light and dark, both languages, and report what you saw.

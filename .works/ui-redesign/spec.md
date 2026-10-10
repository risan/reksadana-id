# UI redesign spec: compact, dense, with character

The owner's verdict on the current site (2026-10-10), verbatim:

> Your design looks like a total AI slop. Don't overuse overly rounded border radius. Don't waste space with
> big margins and paddings. Keep the UI compact without being overwhelming. Carefully choose icons that match
> the context. Use font families that are unique, not overused, while still being completely readable. Choose
> color palette that are unique, has character, and still pleasing and harmonious. Thoughtful design to the
> very little detail. Beautiful and easy to read charts. Carefully design table that are complete and
> detailed while still being scannable and not overwhelming. Remember, keep it compact to avoid long scroll
> while not being too overwhelming or too crowded.

What is wrong today, from screenshots at 1440px and 390px (`live/*.png` in the scratchpad `ui-polish/`):

- Every block is a white card with a 14–20px radius, a 1px ring, and 24px padding. There are cards inside cards
  (fund page "Biaya operasi" value sits in a beige rounded box inside a card). It reads as a template.
- Space: the home hero takes 450px; the 8 type cards take another 300px. On a 900px-tall desktop the fund
  table starts at y≈940, below the fold. The home page on a phone is 11,200px tall. The fund page aside ends
  halfway and leaves a tall empty column. Section headings sit outside cards with 48px gaps.
- Type: Plus Jakarta Sans + Newsreader serif headings: the default "tasteful startup" pairing.
- Color: cream paper + royal blue `#2440a8`: generic.
- Icons: a git icon (`git-compare`) for "Compare"; a chain-like icon for "pays dividends"; `landmark` for bonds.
- Tables: explorer rows are 60px with tags on their own line; the fund returns table uses italic gray rows for
  benchmarks that are hard to tell apart and has no link to the chart colors.
- Charts: a heavy saturated blue area, a 24-month composition chart that is one solid blue block, labels
  floating far from the plot.

## 0. Rules

- Read first: this spec, `src/styles/global.css`, `src/styles/explorer.css`, `src/layouts/Base.astro`, the
  pages in `src/pages/[...lang]/`, `src/lib/fund-charts.js`, `src/lib/explorer-render.js`, `src/lib/icons.js`,
  `src/lib/compare-page.js`, `messages/*.json`, `.works/ui-overhaul/spec.md` (the previous design: keep every
  feature and behavior it lists; this redesign changes the look and the density, not what the site does).
- Code style: `~/.claude/CLAUDE.md` "Code Style" (braces always, a blank line after a block, comments only for
  a non-obvious why, no abstraction without a second caller). Match the surrounding code.
- Every new text goes into BOTH `messages/id.json` and `messages/en.json`; `npm test` checks keys. Remove
  messages you stop using.
- No feature loss: search, filters, URL state, columns, presets, CSV, compare tray, theme toggle, language
  switch, popovers, sticky section nav, share, referral copy, every data point shown today.
- Commits: small, one per area, no `Co-Authored-By` or `Claude-Session` trailers. Do not push.
- `npm test` and `npm run build` must pass at every commit you hand back.

## 1. Tokens (global.css)

Replace the token block. Pages use tokens only (layout widths and chart geometry may be raw).

### 1.1 Type

- **Schibsted Grotesk** (`@fontsource-variable/schibsted-grotesk`, weights 400–900) for all UI text, headings,
  and numbers. A news-house grotesk (designed for the Schibsted newspapers): sturdy, compact, very legible at
  12–14px, and rarely seen on product sites. It has a real `tnum` feature (checked). All numbers in tables,
  key figures, chart axes, and tooltips use `font-variant-numeric: tabular-nums`.
- **Fragment Mono** (`@fontsource/fragment-mono`, 400) for fund IDs (RD853), codes, the referral code, API
  paths, and code blocks only.
- Remove Plus Jakarta Sans, Newsreader, and Spline Sans Mono (package.json, imports, preload). Preload the
  Schibsted latin woff2 like the current main font.
- Headings get character from weight and tight tracking, not from a second family: h1 700, `letter-spacing:
  -0.015em`; h2 650.

Scale (rem; 1rem = 16px). Body text on this site is 14px, tables 13px:

| Token | Size | Use |
|---|---|---|
| `--fs-2xs` | 0.6875rem (11px) | table header labels (uppercase, `letter-spacing: .04em`), tiny tags |
| `--fs-xs` | 0.75rem (12px) | captions, secondary lines, axis labels |
| `--fs-sm` | 0.8125rem (13px) | table cells, controls, chips |
| `--fs-base` | 0.875rem (14px) | body text |
| `--fs-md` | 1rem (16px) | card titles, section h2 |
| `--fs-lg` | 1.25rem (20px) | key-figure values |
| `--fs-xl` | 1.5rem (24px) | page h1 (fund name) |
| `--fs-2xl` | 1.75rem (28px) | home h1 on desktop only |

Line height: 1.45 body, 1.25 headings and table cells. Nothing smaller than 11px; 11px only for uppercase
header labels and tags.

### 1.2 Color: "nila and soga"

Named after the two classic batik dyes: *nila* (indigo) and *soga* (brown from soga bark), on unbleached
cotton. Indigo carries links, selection, and the main series; soga carries warm highlights and the second
series. Gains/losses keep green/red, tuned to sit with the earthy palette.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#f3f1ec` | `#121315` | page background |
| `--surface` | `#fbfaf7` | `#191a1d` | panels, table, inputs |
| `--panel` | `#ebe8e1` | `#212327` | table head, hover rows, chips, code |
| `--ink` | `#1b1a17` | `#ebe8e1` | main text |
| `--ink-2` | `#3f3c36` | `#c9c5bc` | secondary text |
| `--muted` | `#6a655c` | `#9b968c` | labels, captions (≥ 4.5:1 on paper and surface; check) |
| `--faint` | `#a29c91` | `#605c55` | decoration only, never text |
| `--rule` | `#e0dcd3` | `#2a2c30` | hairlines |
| `--rule-strong` | `#c8c2b5` | `#3b3e44` | input borders, table head rule, section rules |
| `--accent` (nila) | `#2e3a8c` | `#a3abf0` | links, primary button, focus ring, selection |
| `--accent-strong` | `#212a6b` | `#c4c9fa` | hover/pressed |
| `--accent-wash` | `#e6e7f2` | `#24274a` | selected chip/segment/row |
| `--soga` | `#8e4e24` | `#dc9a66` | highlights, "best" markers, the logo mark |
| `--soga-wash` | `#f3e6db` | `#2e2219` | notices |
| `--up` / `--up-wash` | `#17734a` / `#e0eee5` | `#57c48e` / `#16271e` | gains |
| `--down` / `--down-wash` | `#b2361f` / `#f5e2dc` | `#f07c64` / `#2e1a16` | losses |
| `--warn` / `--warn-wash` | `#875b00` / `#f6ead0` | `#e7bd62` / `#2b2415` | warnings |

Fund types (icon tile and type tag) and asset classes share one family so a color means the same thing
everywhere:

| Type token | Light / wash | Dark | Allocation token that uses it |
|---|---|---|---|
| `--type-money` | `#2d7a80` / `#dfeeee` | `#5fb8bd` | `--alloc-money` |
| `--type-bond` | `#3b4f9e` / `#e5e8f4` | `#8f9fe8` | `--alloc-bonds` |
| `--type-equity` | `#b04a22` / `#f5e3da` | `#e98a63` | `--alloc-equity` |
| `--type-mixed` | `#7b4a87` / `#efe5f1` | `#c497cf` | — |
| `--type-global` | `#2a6c93` / `#e0ecf3` | `#73b3d8` | — |
| `--type-protected` | `#56606b` / `#e7e9eb` | `#a3acb6` | — |
| `--type-other` | `#7d6b35` / `#efeadb` | `#c9b475` | `--alloc-other` |

Dark washes: the type color at ~14% over `--surface`; pick hex values, check text contrast on them.

Chart series (compare page, benchmarks): `--series-1 #2e3a8c` (nila), `--series-2 #c0662a` (soga orange),
`--series-3 #2d8a7c` (teal), `--series-4 #9a3e6c` (plum), `--series-5 #9c8420` (ochre). Dark: lighten each to
≥ 3:1 on `--surface` (`#a3abf0`, `#e79a62`, `#5cc2b1`, `#d17fa6`, `#d4bb55`).

Remove `--gold*` (replace uses with `--soga*`), `--marker`, `--kawung`, `--shadow-2` except for popovers.

### 1.3 Shape, space, depth

- Radius: `--r-1: 2px` (chips, tags, inputs, buttons, segmented controls, type tiles), `--r-2: 4px` (panels,
  popovers, dialogs, the table frame). Nothing else. No pill shapes except the toggle switch track and the
  status dot. Remove `--r-md`, `--r-lg`, `--r-pill` uses.
- Space scale: `--s-1 2px`, `--s-2 4px`, `--s-3 8px`, `--s-4 12px`, `--s-5 16px`, `--s-6 24px`, `--s-7 32px`.
  Panel padding 12px (desktop) / 10px (phone). Gap between sections 20px desktop, 16px phone. Nothing on the
  site uses more than 32px of space anywhere except the footer top margin.
- Controls: height 32px desktop; 36px on `(pointer: coarse)`. Touch targets stay ≥ 36px tall with ≥ 44px hit
  area via padding where it matters (checkbox, nav).
- Depth: flat. Panels are `--surface` with a 1px `--rule` border, no shadow. Only popovers, menus, dialogs, and
  the compare tray get one shadow `0 4px 16px rgb(0 0 0 / 12%)` (dark: 40%).
- Header 48px tall, `--surface`, bottom rule. Page max width 1360px, gutter 16px (phone 12px).
- The kawung pattern goes away from hero/header bands (it was decoration taking space). Keep the kawung logo
  mark (four ellipses) in the header, recolored `--soga`.

### 1.4 Icons (Lucide, keep `src/lib/icons.js`)

Pick each for its meaning. Copy paths from the Lucide version already used (scratchpad `lucide/` or
`node_modules`), size 14–16px, stroke 1.75 (set the stroke width in `icon()`; 1.5 for 14px if it looks thin).

| Place | Now | Use |
|---|---|---|
| Nav: Funds (explorer) | table-2 | `table-2` (keep) |
| Nav: Compare | git-compare | **`scale`** (weighing funds side by side) |
| Nav: Download | download | keep |
| Nav: API | braces | keep |
| Type: money market | wallet | **`banknote`** (cash-like, short term) |
| Type: bonds | landmark | **`scroll-text`** (a bond certificate) |
| Type: equity | trending-up | **`chart-candlestick`** |
| Type: mixed | chart-pie | `chart-pie` (keep: a mix) |
| Type: global | globe | **`earth`** (keep the globe idea) |
| Type: protected | shield-check | `shield-check` (keep) |
| Type: other (RDPT, property, gold ETF) | layers | **`blocks`** (mixed real assets) |
| Sharia | moon-star | `moon-star` (keep) |
| Pays dividends | (chain-like) | **`hand-coins`** |
| On Bibit / On Makmur chips | none | none (text only) |
| Include inactive | none | **`archive`** |
| Share | share-2 | keep |
| Documents / prospectus | file-text | keep; PDF links get a small `file-down` |
| Info popover trigger | info | keep, 13px, `--faint` until hover |
| Sort | arrow-up/down | **`chevron-up` / `chevron-down`** 12px next to the label |

Check every new name exists in Lucide; if one does not, pick the closest that does and note it.

## 2. Shell (Base.astro)

- Header 48px: logo (mark 20px + "Reksadana" 15px 700) · nav links 13px with 14px icons, the current page in
  `--ink` with a 2px `--accent` underline flush with the header's bottom rule (no filled pill) · right side:
  data date ("Data 9 Okt 2026", green status dot 6px), theme toggle (icon button 32px), language segmented
  control (ID | EN, 2px radius).
- Phones: logo + icon-only theme + language; the four nav links become a bottom tab bar (icon 18px + 11px
  label, 52px tall, `--surface`, top rule), as today if it exists; else keep the current phone nav pattern
  but restyled.
- Footer: one compact band (two lines max on desktop): disclaimer left in `--fs-xs` `--muted`, links right;
  sources line under it. Top margin 32px.

## 3. Home / explorer

Target at 1440×900: the first table row starts at y ≤ 330. At 390×844: the first fund card starts at
y ≤ 420. Measure and report both.

1. **Intro band** (no card, no pattern), one block ≈ 100px:
   - Row 1: h1 "Semua reksa dana Indonesia dalam satu tabel" 28px/700 on one line on desktop (22px phone), the
     lede beside or under it in 14px `--ink-2`, max 1 line on desktop (shorten it if needed in both languages).
   - Row 2: search field (480px wide desktop, full width phone, 36px tall, 2px radius, `/` key hint) and on
     the same line to the right the stats as one inline strip: "4.514 dana · 1.539 aktif · data 9 Okt 2026 ·
     4 sumber · ⤓ Unduh semua" in 13px, numbers 600 weight, separators `--faint`.
2. **Type strip** replaces the 8 cards: one bordered panel (`--surface`, 4px radius) divided into 8 equal
   segments by 1px rules, each 52px tall: row 1 = type icon (14px, type color) + name 13px 600 + count right
   aligned in `--muted`; row 2 = median 1Y return colored + "median 1 th" 11px muted. Selected segment:
   `--accent-wash` background, a 2px `--accent` top border, name in `--accent`. The description sentence of the
   selected type shows as one muted line under the strip (and as `title` on each segment). Phones: the strip
   scrolls sideways inside its own box with scroll-snap and an edge fade (this is the one allowed sideways
   scroll on home), segments 128px wide.
3. **Toolbar**: one row, 32px controls, no floating card and no shadow: result count "1.539 dana" (600) ·
   currency segmented (Semua/IDR/USD) · quick chips (Syariah, Ada di Bibit, Ada di Makmur, Membayar dividen,
   Termasuk tidak aktif) · spacer · "Termasuk dividen" switch with info · Filter · Kolom · CSV (icon + label;
   phones: icon only with aria-label). Chips are 28px tall, 2px radius, `--panel` fill when off, `--accent-wash`
   + `--accent` text and a check icon when on. Wraps to two rows below 1200px; on phones: count + Filter +
   Kolom + CSV on row 1, chips scroll sideways on row 2. Sticky under the header while the table is in view
   (keep), with a `--paper` background and a bottom rule when stuck.
4. **Table** (≥ 720px):
   - Frame: 1px `--rule`, 4px radius, `--surface`. Header 32px, `--panel`, labels 11px uppercase `--muted`,
     sticky, sorted column label in `--ink` with a chevron.
   - Rows ~44px: name 13.5px 550 weight `--ink` (link, underline on hover only) with the tags inline after the
     name (Syariah / ETF / Indeks / Dividen as 11px tags: 1px `--rule-strong` border, 2px radius, `--muted`
     text, 16px tall); line 2 = manager · `RD853` (Fragment Mono 11px) in `--muted` 12px.
   - Type tile 24px, 2px radius, type wash + type color icon 14px.
   - Numbers: 13px tabular, right aligned, gains `--up`, losses `--down`, zero/none `--muted` "—". The sorted
     column's cells are 600 weight. Aum cell: value on line 1, "Sep 2026" 11px muted on line 2 only when it is
     not the latest month (otherwise omit the date: less noise).
   - Sparkline 88×24: 1.25px line in `--up` or `--down` by 12-month sign, a faint baseline at the start value
     (1px dashed `--rule-strong`), a 2.5px dot at the end. No fill.
   - Hover: row `--panel`. Every 5th row gets no extra treatment (no zebra); scanning comes from the hairline
     rules (1px `--rule`) and the aligned columns.
   - Checkbox column 32px; custom 14px checkbox with 2px radius, accent fill when checked.
5. **Phone cards** (< 720px): one dense row per fund, no big cards: a list in one bordered panel with hairline
   separators, each item ≈ 64px: type tile 24px · name (2 lines max, 13.5px) + manager line · right side 1Y
   return (15px 650) over the 12-month sparkline (64×18). Under it one line of small numbers: YTD · 3Y/yr ·
   size, 12px muted labels. Compare checkbox at the far right with a 44px hit area.
6. Pagination bar: 32px controls, "1–50 dari 1.539" left, pages center, rows-per-page right; all on one line.
7. "Cara kami menghitung" stays as a collapsible `<details>` styled as a plain rule + chevron, not a card.

## 4. Fund page

Target at 1440×900: the price chart's top is visible without scrolling (y ≤ 560). The whole page at 1440 is
shorter than today (4,430px), aim ≤ 3,000px for RD853. At 390: aim ≤ 4,200px (today 5,988).

1. **Header** (no card, no pattern), ≈ 96px: breadcrumb 12px muted (Reksa dana › Saham › RD853 in Fragment
   Mono) · row: type tile 32px + h1 24px/700 + inline tags (type tag colored, Syariah, risk level) · line 2:
   manager link 13px · the actions on the right of the h1 row on desktop: Bandingkan (toggle), Bagikan, and
   the primary "Beli di Bibit ↗" (accent fill) — the aside buy card keeps the referral details.
2. **Key figures**: one bordered panel, 5 cells divided by vertical rules (NAV + 1-day change; 1Y return + 3Y
   per year; worst fall 1Y; fund size + month; audited operating expense + year), each: label 12px muted with
   the info popover icon, value 20px 650 tabular, sub-line 12px. ≈ 72px tall. Phones: 2-column grid of cells
   with hairlines (the 5th spans 2).
3. **Section nav**: sticky under the header, 36px, 13px labels, active = `--ink` + 2px accent underline;
   `--paper` background with a bottom rule.
4. **Two columns** ≥ 1024px: main (fluid) + aside 300px with 20px gap. The aside is sticky (`top: header + nav
   + 12px`) if it fits the viewport height, else static. Aside content: Buy panel (button, referral code in
   Fragment Mono with copy, one line of help), Details as a compact 2-column definition list (label 12px muted
   / value 13px, 28px rows, hairlines), the OJK AUM sparkline (full aside width, 48px tall) with its caption.
   No empty column: if the main column is shorter in a region, that is fine because the aside is sticky.
5. **Sections** in the main column are not cards. Each section = h2 (16px/650) on a line with an optional right
   side (e.g. "sampai 9 Okt 2026" muted, or the chart range control) + a 1px `--rule-strong` rule under it +
   content. 20px between sections. Panels (bordered `--surface`) only where a frame helps reading: the chart
   block, tables.
   - **Sekilas**: the bullet sentences as a compact list (13.5px, 4px between items, a 4px soga square bullet),
     two columns on ≥ 1200px if it has ≥ 4 items.
   - **Kinerja**: one panel holding: top bar (range segmented 1bl…Semua left, benchmark segmented right,
     readout "−13,88% 9 Okt 2025 – 9 Okt 2026" above the plot left-aligned), the price chart, and a slim AUM
     chart under it sharing the x axis (see §6). Then the returns table (§7).
   - **Portofolio**: the asset mix as one 10px bar (2px radius) with an inline legend (swatch 8px, name,
     percent tabular) in one line; the 24-month composition chart (§6); top holdings as a 2-column list of
     rows (name left, ticker in Fragment Mono `--muted` right), 28px rows with hairlines, date in the h2 right
     side.
   - **Biaya dan minimum**: one definition table, no value boxes. Rows: "Biaya operasi (diaudit)" →
     "**4,21%** per tahun · 2025 · Prospektus dari situs MI (PDF ⤓)" with the info popover; "Expense ratio" →
     "**4,22%** · Bibit" (and other sources on the same row when they differ); then minimums, fees, custodian
     as today. Value 13px, source/notes 12px `--muted` on the same line. The two notes at the bottom as one
     12px muted line each.
   - **Dokumen**: compact list, each row: `file-text` 14px · name link · date right aligned muted. "112
     dokumen lama" as a `<details>` row.
   - **Data**: the three download buttons inline (32px, secondary style) + the source lines as a 12px list.
6. Phones: single column; order: header, key figures, buy panel, section nav, sections, details at the end of
   Overview (as today).

## 5. Compare, download, API, 404

- **Compare**: picker = search input with results popover (4px radius, shadow); selected funds as chips with
  a 3px left border in their series color; the chart panel like the fund page; the table with sticky first
  column, fund headers carrying the series swatch, the best value per row marked with a small soga dot (keep
  the aria-label and the "different types" note).
- **Download**: a table, not cards: icon · name + what it holds · size (tabular) · format · download button
  (secondary, 28px). One row per archive.
- **API**: sticky side TOC on desktop (13px, active item `--accent` with a 2px left rule), content max 760px;
  endpoint headings in Fragment Mono; code blocks `--panel`, 2px radius, 12.5px Fragment Mono, copy button
  top-right (icon only, 24px).
- **404**: short: h1, one sentence, search, three links. No pattern.

## 6. Charts (fund-charts.js, compare-page.js, explorer sparklines)

- Plot area: no background; horizontal gridlines 1px `--rule` (solid, not dashed), 4–5 ticks with round
  values; y labels at the right edge inside the plot area, 11px `--muted` tabular, sitting just above their
  gridline; x labels 11px `--muted` under the axis, months as "Des", "Feb" and years when the range > 2y.
- Price line 1.5px `--accent`; area fill a vertical gradient from accent 10% opacity to 0. With a benchmark,
  the fund line stays accent and the benchmark uses `--series-2` 1.25px, no fill; both rebased to 0% and the
  y axis shows percent.
- Hover/touch: vertical crosshair 1px `--ink-2` at 40% opacity, a 3px dot on each line, a tooltip panel (4px
  radius, `--surface`, rule border, shadow) with the date (12px muted) and values (13px tabular, swatch per
  series). The tooltip flips side at the edges.
- AUM chart: 64px tall bars (monthly) in `--soga` at 70% opacity, 1px gaps, sharing the x range of the price
  chart; label "Dana kelolaan" + latest value at its top-left in 11px.
- Composition 24-month: stacked bars, one per month, 2px gaps, colors `--alloc-*` (matching the type colors
  above), 96px tall, legend inline in the h2 row, tooltip with the four percents.
- Asset mix bar: as §4.5.
- Explorer sparklines: §3.4.
- Redraw on theme change and on resize (keep), crisp at devicePixelRatio 2 (if canvas) or SVG.

## 7. Tables (shared rules)

- 13px tabular numbers right aligned; text left; header 11px uppercase `--muted` on `--panel`, 32px.
- Row height 32px (fund returns, compare, details) / 44px (explorer, 2-line cells). 1px `--rule` between
  rows, no zebra, no vertical rules except to separate groups (e.g. a rule before "3 th").
- Fund returns table: columns 1bl 3bl YTD 1th 3th 5th 10th Semua. Rows: "Imbal hasil" (600 weight,
  colored), "Per tahun" (`--muted` label, values colored), "Penurunan terdalam" (losses only, `--down`), then a
  group label row "Pembanding" (11px uppercase muted, `--panel` background, 24px) followed by "Median Saham",
  IHSG, JII, and the Bareksa index, each with a 8px swatch in its chart series color before the label, values
  13px in `--ink-2` (colored sign only: `--up`/`--down` text at 85% opacity is fine). No italics.
  Sticky first column on phones; the table scrolls inside its panel on phones only.
- Empty values: "—" in `--faint`.

## 8. Quality bar

- WCAG AA contrast for text in both themes (compute and list the pairs you checked); visible 2px focus ring
  (`--accent`, 2px offset); no horizontal page scroll at 360px on any page.
- No layout shift when `explorer.json` arrives (keep the server-rendered first page).
- Verify with Playwright (already installed in the scratchpad `ui-polish/`; launch Chromium with
  `executablePath: '/home/risan/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'`),
  serve with `npm run build` then `npx wrangler dev --port 8794 --ip 127.0.0.1` (kill it when done). Pages:
  home, `/funds/RD853/`, `/funds/RD870/`, `/funds/RD216/`, compare `?ids=RD853,RD870,RD216`, download, api,
  404 — at 390 and 1440, light and dark, ID and EN. READ the screenshots and fix what looks off. Report page
  heights and the y of the first table row / chart top versus the targets above.

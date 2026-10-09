# Phase A report: design system, shell, download/API/404

Branch `worktree-agent-a0e3efa2bae833f0d`, from `946dde05`. `npm test` (167 pass) and `npm run build` pass
(14,047 files, 640 redirects).

## What was built

- `src/styles/global.css`: all tokens, theme blocks, and the shared components (below).
- `src/lib/icons.js`: `icon(name, { size = 18, label })`, the 34 Lucide icons of the spec as plain strings
  (taken from `lucide-static` 1.54.0 in a scratch dir; no runtime dependency). Output has class `icon`,
  `aria-hidden="true"` unless `label` is given. Throws on an unknown name.
- `src/layouts/Base.astro`: skip link, sticky blurred header (logo, nav with icons, freshness, theme toggle,
  ID/EN pill), phone tab bar, footer with kawung band and credits (Bibit, Bareksa, Kontan, Makmur, Lucide).
  New prop `alternatePath` (the language switch target when the page path is not the page to switch to).
- Download, API, and 404 pages restyled; English plurals fixed; leftover strings localized.
- Charts redraw on a `themechange` window event (`fund-charts.js`, `compare-page.js`, 5-line edits each).
- README "Credits" section (Lucide, fonts).

## Font decision

**Plus Jakarta Sans Variable** (`@fontsource-variable/plus-jakarta-sans`). It has `tnum`. Evidence, headless
Chromium, 40px, latin subset file:

| text | width |
|---|---|
| "1111" default | 60px |
| "8888" default | 100px |
| "1111" `tabular-nums` | 96px |
| "8888" `tabular-nums` | 96px |

`body` sets `font-variant-numeric: tabular-nums`; `code`, `pre`, `kbd`, `.page-title` reset it to normal.
Quirk: its space is only 0.175em wide, so `body` has `word-spacing: 0.06em` (words ran together at weight 600).
Newsreader now loads `opsz.css` (optical size axis, per spec): the latin file is 132 KB against 58 KB for the
plain `wght` file. If that matters, switch the import in `Base.astro` to the default `index.css`.
The latin Plus Jakarta file is preloaded (`?url` import). Schibsted Grotesk is removed (package and import).

## Tokens (all in `global.css`)

- Color: `--paper --surface --panel --ink --ink-2 --muted --faint --rule --rule-strong --accent --accent-strong
  --accent-wash --on-accent --gold --gold-wash --up --up-wash --down --down-wash --warn --warn-wash --marker`,
  `--alloc-equity|bonds|money|other`, `--series-1..5`, `--type-money|bond|equity|mixed|global|protected|other`
  each with `-wash`, `--kawung` (the pattern tile as a data-URI, per theme).
- Type: `--sans --serif --mono`, `--fs-xs 12 .. --fs-4xl 46` (in rem), `--fw-body 400 --fw-label 500
  --fw-strong 600 --fw-hero 700`.
- Space and shape: `--s-1..--s-8`, `--r-xs --r-sm --r-md --r-lg --r-pill`, `--shadow-1 --shadow-2`,
  `--gutter` (16/24/32), `--page-max 1280px`, `--header-h 56px`, `--tabbar-h` (0 on desktop,
  56px + safe area under 720px), `--control-h` (40, 44 on phones), `--ease --t-fast --t-base` (0ms under
  reduced motion).
- Theme: light on `:root`; dark under `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`
  and under `:root[data-theme='dark']` (the dark block is duplicated; that is the cost of the spec's shape).
  Inline head script sets `data-theme` from `localStorage.theme` before paint. Toggle cycles
  system, light, dark; dispatches `themechange` on `window`. Verified in a browser: stored values, labels,
  reload persistence, 3 events for 3 clicks.
- Contrast checked by script: `--muted` 4.95 on paper, 5.40 on surface, 4.61 on panel (light). Light `--up`,
  `--down`, and the type colors are slightly darker than the spec's table so they pass 4.5:1 on their washes
  (`--up #097a4e`, `--down #bd321c`, `--type-equity #b83a16`, `--type-global #08699f`, `--type-other #6e5f4b`).
  Series and alloc colors are 3.3 to 7.5:1 on `--surface` in both themes (light `--series-4 #c28000`
  is the lowest, 3.29).
- Kawung opacity: I set the stroke at 12% (light) and 14% (dark) instead of the spec's 6 to 8%: a 1px line
  at 8% is nearly invisible on screen. Change `stroke-opacity` in the two `--kawung` values to tune.

## Shared components (global.css classes)

`.btn` (`.btn-primary` replaces `.btn-ink`, `.btn-sm`), `.icon-btn`, `.seg` (buttons or links; pressed or
`aria-current='true'` = white pill with `--shadow-1`; scrolls sideways when too wide), `.chip`
(`aria-pressed` or `:has(input:checked)`), `.tag` (`.tag-quiet`, `.tag-stale`, `.tag-type`), `.icon-tile`
plus `.type-money|bond|equity|mixed|global|protected|other` (set `--type-fg/--type-bg`; on a tile or a tag),
`.card`, `.card-title`, `.empty-state`, `.table-scroll` (now the framed surface card for tables; `.tbl`
header cells get `--panel`), `.notice` (flex, icon slot `> .icon`), `.kv`, `.search` (icon as first child,
input padded for icon and kbd), `[popover]` base style, `dialog` base style, `.chart-tip`, `.code-block` and
`.code-copy`, `.kawung-bg` (pattern fading to the left, for hero, fund header band, empty states),
`.kawung-band` (footer strip).

## Pages

- Download: featured funds.csv card, a grid of archive cards (icon, name, description, size, button), one
  framed table per source, notes card, types table. Removed messages `download_zip_holds`, `download_zip_size`.
- API: `<details class="api-toc">` open on wide screens (sticky, summary not clickable) and folded on phones
  (a script syncs `open` with `min-width: 1100px`); copy buttons are added by script to every `pre`
  (clipboard in try/catch, status span for screen readers); tables sit in `.table-scroll` with min-width 560px.
- 404: kawung empty state, search form (GET to the home page with `?q=`), links with icons. Language switch
  goes to the other language's home (`alternatePath="/"`): verified, `/` and `/en/` targets.
- Plurals use separate keys like the existing `count_fund_one`: `documents_older_one`,
  `asset_mix_history_one`, `dividends_aside_one`.
- Localized: "Zip" group (`api_group_zip`), explorer's other-types note (`type_other_note`: "RDPT, DIRE,
  ETF" / "Private placement, real estate, ETFs"), "API" heading now `m.nav_api()`. Left as is on purpose:
  the `'USD · '` prefix in `explorer.js` (a currency code, same in both languages).
- Explorer, fund, compare: only token migration (font sizes to the scale, radii, surfaces, `btn-primary`,
  fund-ID text from `--faint` to `--muted`, compare bar offset by `--tabbar-h`, sparkline column hidden under
  480px so names have room, search icon added to the explorer and compare search fields).

## Screenshots

Playwright (outside the repo), `/home/risan/.cache/claude-tmp/claude-1000/-home-risan-projects-code-reksadana-id/a14481e0-7cd8-4f16-a941-1017471ce1ac/scratchpad/ui-a/shots/`:
`<page>-<m|d>-<light|dark>.png` (top of the page; m = 390px, d = 1440px) and `...-end.png` (bottom of the
page, shows the footer and tab bar). Pages: home, home-en, fund, compare, download, api, 404 (404en from
dev). In a full-page capture the fixed tab bar shows up mid-image; that is a capture artifact.
Seen: no horizontal scroll at 360px on home, fund, compare, download, API, 404 in both languages; the
tab bar is 56px at the bottom; both themes read well; the toggle works.

## Notes for phases B and C

- Mapping fund type to `.type-*` class and icon (wallet, landmark, trending-up, chart-pie, globe,
  shield-check, layers) does not exist yet; add it to `fund-types.js` with the first caller.
- `[popover]` has no anchor positioning (it opens centered); position it with a `style` anchor or JS when
  the info popovers are built. Same for `dialog` (drawer and sheet layout are yours).
- `.table-scroll` is now a framed card. The explorer's sticky header rows still need a vertical scroll
  container or `position: sticky` against the page; `top` should be `var(--header-h)` plus the toolbar.
- The explorer type strip, phone table, and toolbar are unchanged in structure: on phones the table shows
  fund and 1Y only (existing behavior) and the strip scrolls sideways.
- Chart cursor dot uses `--paper` as fill (`fund-charts.js`, `compare-page.js`); chart cards on `--surface`
  would want `--surface`. I left the lib files alone to avoid conflicts with the backend branch.
- Client scripts that build markup get no Astro scope attribute: put their styles in `global.css` or use
  `:global()` (hit this with the copy button).
- The chart line color is `--ink`; the NAV area fill is `--ink` at 5% (both fine in dark).
- Dev toolbar of `astro dev` appears in screenshots taken from dev; ignore it.

// The markup of the explorer's type cards, table rows, and skeleton rows. The home page renders the first page
// with it at build time, and the browser script renders every later view, so both draw the same thing.
import * as m from '../paraglide/messages.js';
import { MAX_FUNDS } from './compare.js';
import { COLUMNS, renderSpark } from './explorer-columns.js';
import { escapeHtml, searchTerms, summarizeTypes, typeNames } from './explorer.js';
import { changeClass, formatChange, formatCount, formatMoney, formatNav, formatShortDate } from './format.js';
import { typeLook } from './fund-types.js';
import { icon } from './icons.js';
import { localizeHref } from './i18n.js';

export const SKELETON_ROW_COUNT = 12;

function typeTile(tone, iconName, size) {
  return `<span class="icon-tile ${tone ? `type-${tone}` : ''}">${icon(iconName, { size })}</span>`;
}

export function renderTypeCards(funds, state, locale) {
  return summarizeTypes(funds, state)
    .map(({ group, count, returnCount, median }) => {
      const { name, note } = typeNames(group, locale);
      const medianTitle = m.type_median_title({ count: formatCount(returnCount, locale) });

      return `<button type="button" class="type-card" data-type="${escapeHtml(group.key)}" aria-pressed="${state.type === group.key}">
        ${typeTile(group.tone, group.icon, 20)}
        <span class="type-card-body">
          <span class="type-name">${escapeHtml(name)}${note ? `<span class="type-note">${escapeHtml(note)}</span>` : ''}</span>
          <span class="type-desc">${escapeHtml(group.description())}</span>
        </span>
        <span class="type-count">${formatCount(count, locale)}</span>
        <span class="type-median ${changeClass(median)}" title="${escapeHtml(medianTitle)}">${median === null ? '&mdash;' : formatChange(median, locale, 1)}<small>${escapeHtml(m.type_median())}</small></span>
      </button>`;
    })
    .join('');
}

function highlight(text, terms) {
  if (terms.length === 0) {
    return escapeHtml(text);
  }

  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');

  return String(text)
    .split(pattern)
    .map((part, index) => (index % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join('');
}

function renderTags(fund) {
  const tag = (label, title, extraClass = 'tag-quiet') => `<span class="tag ${extraClass}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(label)}</span>`;

  return [
    fund.sharia && tag(m.tag_sharia(), m.tag_sharia_title()),
    fund.etf && tag('ETF'),
    fund.index && tag(m.tag_index()),
    fund.dividends && tag(m.tag_dividend(), m.tag_dividend_title()),
    !fund.active && tag(m.tag_inactive(), m.tag_inactive_title(), 'tag-stale'),
  ]
    .filter(Boolean)
    .join('');
}

// The same figures as the columns, laid out for a phone: the table turns into a list of cards there.
function renderCardStats(fund, { dataDate, locale }) {
  const figure = (value) => (value === null ? '<span class="nil">&mdash;</span>' : formatChange(value, locale, 1));
  const navDate = fund.nav_date ? formatShortDate(fund.nav_date, dataDate, locale) : '';
  const buy = [fund.bibit && '<span class="tag">Bibit</span>', fund.makmur && '<span class="tag">Makmur</span>'].filter(Boolean).join('');

  return `<div class="card-stats">
    <div class="card-figure card-figure-main ${changeClass(fund.return_1y)}"><b>${figure(fund.return_1y)}</b><small>${escapeHtml(m.period_1y())}</small></div>
    <div class="card-figure ${changeClass(fund.return_ytd)}"><b>${figure(fund.return_ytd)}</b><small>${escapeHtml(m.period_ytd())}</small></div>
    <div class="card-figure"><b>${formatMoney(fund.aum, locale, fund.aum_currency)}</b><small>${escapeHtml(m.col_aum())}</small></div>
    <div class="card-spark">${renderSpark(fund.spark, changeClass(fund.return_1y) || 'flat')}</div>
    <div class="card-meta"><span>${escapeHtml(m.col_nav())} ${formatNav(fund.nav, locale)}${navDate ? ` · ${navDate}` : ''}</span><span class="card-buy">${buy}</span></div>
  </div>`;
}

export function renderRow(fund, context) {
  const { terms, locale, comparedIds } = context;
  const href = localizeHref(`/funds/${encodeURIComponent(fund.id)}/`, locale);
  const { tone, icon: iconName } = typeLook(fund.type);
  const isCompared = comparedIds.has(fund.id);
  const compareDisabled = !isCompared && comparedIds.size >= MAX_FUNDS;
  const cells = COLUMNS.map((column) => `<td class="col-${column.key} ${column.numeric ? 'num' : ''} ${column.cellClass?.(fund) ?? ''}">${column.cell(fund, context)}</td>`).join('');

  return `<tr data-href="${href}">
    <td class="c-compare"><input type="checkbox" data-compare="${escapeHtml(fund.id)}" aria-label="${escapeHtml(m.compare_checkbox_label({ name: fund.name }))}"${compareDisabled ? ` disabled title="${escapeHtml(m.compare_full({ count: MAX_FUNDS }))}"` : ''}${isCompared ? ' checked' : ''} /></td>
    <td class="c-fund">
      <div class="fund-cell">
        ${typeTile(tone, iconName, 16)}
        <div class="fund-text">
          <a href="${href}">${highlight(fund.name, terms)}</a>
          <div class="sub">${highlight(fund.manager ?? m.unknown_manager(), terms)} · <span class="mono">${highlight(fund.id, terms)}</span></div>
          <div class="fund-tags">${renderTags(fund)}</div>
        </div>
      </div>
      ${renderCardStats(fund, context)}
    </td>
    ${cells}
  </tr>`;
}

export function renderRows(funds, state, dataDate, locale, comparedIds = new Set()) {
  const context = { terms: searchTerms(state.q), dataDate, locale, comparedIds };

  return funds
    .slice(state.page * state.size, (state.page + 1) * state.size)
    .map((fund) => renderRow(fund, context))
    .join('');
}

// Stands in for the rows until the fund list arrives, so the table keeps its height.
export function renderSkeletonRows(count = SKELETON_ROW_COUNT) {
  const bar = '<span class="skeleton-bar"></span>';
  const row = `<tr class="skeleton-row" aria-hidden="true"><td class="c-compare"></td><td class="c-fund"><div class="fund-cell"><span class="icon-tile"></span><div class="fund-text">${bar}<div class="sub">${bar}</div></div></div></td>${COLUMNS.map((column) => `<td class="col-${column.key}">${bar}</td>`).join('')}</tr>`;

  return row.repeat(count);
}

// The markup of the explorer's type strip, table rows, and skeleton rows. The home page renders the first page
// with it at build time, and the browser script renders every later view, so both draw the same thing.
import * as m from '../paraglide/messages.js';
import { MAX_FUNDS } from './compare.js';
import { COLUMNS, renderSpark } from './explorer-columns.js';
import { TYPE_GROUPS, escapeHtml, searchTerms, summarizeTypes, typeNames } from './explorer.js';
import { changeClass, formatChange, formatCount, formatMoney, tightenSeparators } from './format.js';
import { typeLook } from './fund-types.js';
import { icon } from './icons.js';
import { localizeHref } from './i18n.js';

const PHONE_SPARK_SIZE = { width: 64, height: 18 };

function typeTile(tone, iconName) {
  return `<span class="icon-tile ${tone ? `type-${tone}` : ''}">${icon(iconName, { size: 14 })}</span>`;
}

// The sentence under the strip: what the chosen type is for.
export function typeNote(state) {
  return TYPE_GROUPS.find((group) => group.key === state.type).description();
}

export function renderTypeSegments(funds, state, locale) {
  return summarizeTypes(funds, state)
    .map(({ group, count, returnCount, median }) => {
      const { name, note } = typeNames(group, locale);
      const medianTitle = m.type_median_title({ count: formatCount(returnCount, locale) });
      const title = [note && `${name} (${note})`, group.description()].filter(Boolean).join(': ');

      return `<button type="button" class="type-seg ${group.tone ? `type-${group.tone}` : ''}" data-type="${escapeHtml(group.key)}" aria-pressed="${state.type === group.key}" title="${escapeHtml(title)}">
        <span class="type-seg-top">
          ${icon(group.icon, { size: 14 })}
          <span class="type-name">${escapeHtml(name)}</span>
          <span class="type-count">${formatCount(count, locale)}</span>
        </span>
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
  const tag = (label, title, extraClass = '') => `<span class="tag ${extraClass}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(label)}</span>`;

  return [
    fund.sharia && tag(m.tag_sharia(), m.tag_sharia_title()),
    fund.etf && tag('ETF'),
    fund.index && tag(m.tag_index()),
    fund.dividends && tag(m.tag_dividend(), m.tag_dividend_title()),
    !fund.active && tag(m.tag_inactive(), m.tag_inactive_title(), 'tag-stale'),
    fund.ojk_status === 'zero_aum' && tag(m.tag_zero_aum(), m.tag_zero_aum_title(), 'tag-stale'),
  ]
    .filter(Boolean)
    .join('');
}

// The same figures as the columns, laid out for a phone: the table turns into a list there.
function renderCardStats(fund, { locale }) {
  const direction = changeClass(fund.return_1y);
  const change = (value) => (value === null ? '<span class="nil">&mdash;</span>' : `<b class="${changeClass(value)}">${formatChange(value, locale, 1)}</b>`);
  const buy = [fund.bibit && '<span class="tag">Bibit</span>', fund.makmur && '<span class="tag">Makmur</span>'].filter(Boolean).join('');

  return `<div class="card-return ${direction}">
      <b>${fund.return_1y === null ? '<span class="nil">&mdash;</span>' : formatChange(fund.return_1y, locale, 1)}</b>
      ${renderSpark(fund.spark, direction || 'flat', PHONE_SPARK_SIZE)}
      <span class="card-buy">${buy}</span>
    </div>
    <div class="card-line">
      <span><small>${escapeHtml(m.period_ytd())}</small> ${change(fund.return_ytd)}</span>
      <span><small>${escapeHtml(m.col_cagr_3y())}</small> ${change(fund.cagr_3y)}</span>
      <span>${formatMoney(fund.aum, locale, fund.aum_currency)}</span>
    </div>`;
}

export function renderRow(fund, context) {
  const { terms, locale, comparedIds } = context;
  const href = localizeHref(`/funds/${encodeURIComponent(fund.id)}/`, locale);
  const { tone, icon: iconName } = typeLook(fund.type);
  const isCompared = comparedIds.has(fund.id);
  const compareDisabled = !isCompared && comparedIds.size >= MAX_FUNDS;
  const cells = COLUMNS.map((column) => `<td class="col-${column.key} ${column.numeric ? 'num' : ''} ${column.cellClass?.(fund) ?? ''}">${column.numeric ? tightenSeparators(column.cell(fund, context)) : column.cell(fund, context)}</td>`).join('');

  return `<tr data-href="${href}">
    <td class="c-compare"><label class="compare-hit"><input type="checkbox" data-compare="${escapeHtml(fund.id)}" aria-label="${escapeHtml(m.compare_checkbox_label({ name: fund.name }))}"${compareDisabled ? ` disabled title="${escapeHtml(m.compare_full({ count: MAX_FUNDS }))}"` : ''}${isCompared ? ' checked' : ''} /></label></td>
    <td class="c-fund">
      <div class="fund-cell">
        ${typeTile(tone, iconName)}
        <div class="fund-text">
          <div class="fund-line"><a href="${href}">${highlight(fund.name, terms)}</a><span class="fund-tags">${renderTags(fund)}</span></div>
          <div class="sub"><span class="fund-manager">${highlight(fund.manager ?? m.unknown_manager(), terms)}</span><span class="mono fund-id">${highlight(fund.id, terms)}</span></div>
        </div>
      </div>
      ${renderCardStats(fund, context)}
    </td>
    ${cells}
  </tr>`;
}

export function renderRows(funds, state, dataDate, locale, comparedIds = new Set(), latestAumDate = '') {
  const context = { terms: searchTerms(state.q), dataDate, locale, comparedIds, latestAumDate };

  return funds
    .slice(state.page * state.size, (state.page + 1) * state.size)
    .map((fund) => renderRow(fund, context))
    .join('');
}

// Stands in for the rows until the fund list arrives, so the table keeps its height.
export function renderSkeletonRows(count) {
  const bar = '<span class="skeleton-bar"></span>';
  const row = `<tr class="skeleton-row" aria-hidden="true"><td class="c-compare"></td><td class="c-fund"><div class="fund-cell"><span class="icon-tile"></span><div class="fund-text">${bar}<div class="sub">${bar}</div></div></div></td>${COLUMNS.map((column) => `<td class="col-${column.key}">${bar}</td>`).join('')}</tr>`;

  return row.repeat(count);
}

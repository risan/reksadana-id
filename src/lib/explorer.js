// Shared by the home page's build-time render and its browser script, so both draw the same markup.
import * as m from '../paraglide/messages.js';
import { changeClass, formatChange, formatCount, formatMoney, formatNav, formatShortDate, formatMonth } from './format.js';
import { MAX_FUNDS } from './compare.js';
import { localizeHref } from './i18n.js';

export const PAGE_SIZE = 50;

const MAIN_TYPES = [
  { key: 'Pasar Uang', label: 'Pasar Uang', english: 'Money market' },
  { key: 'Obligasi', label: 'Obligasi', english: 'Bonds' },
  { key: 'Saham', label: 'Saham', english: 'Equity' },
  { key: 'Campuran', label: 'Campuran', english: 'Mixed' },
  { key: 'Reksadana Global', label: 'Global', english: 'Global' },
  { key: 'Terproteksi', label: 'Terproteksi', english: 'Protected' },
];

export const TYPE_GROUPS = [{ key: '' }, ...MAIN_TYPES, { key: 'other' }];

// Indonesian pages name a type as Bibit does. English pages name it in English and keep Bibit's name beneath.
function typeNames(group, locale) {
  if (group.key === '') {
    return { name: m.type_all(), note: m.type_all_note() };
  }

  if (group.key === 'other') {
    return { name: m.type_other(), note: 'RDPT, DIRE, ETF' };
  }

  return locale === 'en' ? { name: group.english, note: group.label } : { name: group.label, note: '' };
}

const MAIN_TYPE_KEYS = new Set(MAIN_TYPES.map((type) => type.key));

export const DEFAULT_STATE = {
  q: '',
  type: '',
  currency: '',
  sharia: false,
  bibit: false,
  makmur: false,
  inactive: false,
  sort: 'aum',
  dir: -1,
  page: 0,
};

export function fundCountLabel(count, locale) {
  return count === 1 ? m.count_fund_one() : m.count_funds({ count: formatCount(count, locale) });
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function searchTerms(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesType(fund, typeKey) {
  if (typeKey === '') {
    return true;
  }

  if (typeKey === 'other') {
    return !MAIN_TYPE_KEYS.has(fund.type);
  }

  return fund.type === typeKey;
}

export function filterFunds(funds, state, { ignoreType = false } = {}) {
  const terms = searchTerms(state.q);

  return funds.filter(
    (fund) =>
      (state.inactive || fund.active) &&
      (ignoreType || matchesType(fund, state.type)) &&
      (!state.currency || fund.currency === state.currency) &&
      (!state.sharia || fund.sharia) &&
      (!state.bibit || fund.bibit) &&
      (!state.makmur || fund.makmur) &&
      terms.every((term) => fund.search.includes(term)),
  );
}

// With dividends included, a fund that pays them shows its total return in place of the NAV change.
export function prepareFunds(data, includeDividends = false) {
  return data.funds.map((fund) => ({
    ...fund,
    ...(includeDividends && fund.total),
    search: `${fund.names.join(' ')} ${fund.id} ${fund.manager ?? ''}`.toLowerCase(),
    aum_idr: fund.aum === null ? null : fund.aum * (fund.aum_currency === 'USD' ? data.usd_to_idr : 1),
  }));
}

const SORT_KEYS = new Set(['name', 'return_1m', 'return_ytd', 'return_1y', 'return_3y', 'aum']);

// A sort key from a link the visitor may have edited; anything unknown sorts like the default.
export function parseSortKey(key) {
  return SORT_KEYS.has(key) ? key : DEFAULT_STATE.sort;
}

export function sortFunds(funds, key, direction) {
  const knownKey = parseSortKey(key);
  const sortKey = knownKey === 'aum' ? 'aum_idr' : knownKey;

  return [...funds].sort((a, b) => {
    const left = a[sortKey];
    const right = b[sortKey];

    // Missing values go last whichever way the column is sorted.
    if (left === null && right === null) {
      return 0;
    }

    if (left === null) {
      return 1;
    }

    if (right === null) {
      return -1;
    }

    if (typeof left === 'string') {
      return left.localeCompare(right) * direction;
    }

    return (left - right) * direction;
  });
}

function median(values) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;

  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Each type cell shows how many funds match the other filters and their median 1-year return.
export function renderTypeStrip(funds, state, locale) {
  const candidates = filterFunds(funds, state, { ignoreType: true });

  return TYPE_GROUPS.map((group) => {
    const members = candidates.filter((fund) => matchesType(fund, group.key));
    const returns = members.map((fund) => fund.return_1y).filter((value) => value !== null);
    const typical = median(returns);
    const selected = state.type === group.key;

    const { name, note } = typeNames(group, locale);
    const medianTitle = m.type_median_title({ count: formatCount(returns.length, locale) });

    return `<button type="button" class="type-cell" data-type="${escapeHtml(group.key)}" aria-pressed="${selected}">
      <span class="type-name">${escapeHtml(name)}<span class="type-count">${formatCount(members.length, locale)}</span></span>
      <span class="type-en">${escapeHtml(note)}</span>
      <span class="type-median ${changeClass(typical)}" title="${escapeHtml(medianTitle)}">${typical === null ? '&mdash;' : formatChange(typical, locale, 1)}<small>${escapeHtml(m.type_median())}</small></span>
    </button>`;
  }).join('');
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

const SPARK_WIDTH = 76;
const SPARK_HEIGHT = 22;

export function renderSpark(spark, direction) {
  if (!spark) {
    return '';
  }

  const step = SPARK_WIDTH / (spark.length - 1);
  const y = (value) => (1.5 + ((100 - value) / 100) * (SPARK_HEIGHT - 3)).toFixed(1);
  const points = spark.map((value, index) => `${(index * step).toFixed(1)},${y(value)}`).join(' ');

  return `<svg class="spark ${direction}" width="${SPARK_WIDTH}" height="${SPARK_HEIGHT}" viewBox="0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}" aria-hidden="true"><line x1="0" x2="${SPARK_WIDTH}" y1="${y(spark[0])}" y2="${y(spark[0])}" /><polyline points="${points}" /></svg>`;
}

function returnCell(value, className, locale, extra = '') {
  return `<td class="num ${className} ${changeClass(value)}">${value === null ? '<span class="nil">&mdash;</span>' : formatChange(value, locale, 1)}${extra}</td>`;
}

export function renderRow(fund, { terms, dataDate, locale, comparedIds }) {
  const href = localizeHref(`/funds/${encodeURIComponent(fund.id)}/`, locale);
  const tag = (label, title, extraClass = 'tag-quiet') => ` <span class="tag ${extraClass}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(label)}</span>`;
  const sharia = fund.sharia ? tag(m.tag_sharia(), m.tag_sharia_title()) : '';
  const kind = [fund.etf && 'ETF', fund.index && m.tag_index()].filter(Boolean).map((label) => tag(label)).join('');
  const stale = fund.active ? '' : tag(m.tag_inactive(), m.tag_inactive_title(), 'tag-stale');
  const dividends = fund.dividends ? tag(m.tag_dividend(), m.tag_dividend_title()) : '';
  const largeMove = fund.large_move ? `<span class="flag" title="${escapeHtml(m.flag_large_move())}">!</span>` : '';
  const buy = [fund.bibit && '<span class="tag">Bibit</span>', fund.makmur && '<span class="tag">Makmur</span>'].filter(Boolean).join(' ');
  const navDate = fund.nav_date ? formatShortDate(fund.nav_date, dataDate, locale) : '';

  const isCompared = comparedIds.has(fund.id);
  const compareDisabled = !isCompared && comparedIds.size >= MAX_FUNDS;

  return `<tr data-href="${href}">
    <td class="c-compare"><input type="checkbox" data-compare="${escapeHtml(fund.id)}" aria-label="${escapeHtml(m.compare_checkbox_label({ name: fund.name }))}"${compareDisabled ? ` disabled title="${escapeHtml(m.compare_full({ count: MAX_FUNDS }))}"` : ''}${isCompared ? ' checked' : ''} /></td>
    <td class="c-fund"><a href="${href}">${highlight(fund.name, terms)}</a>${sharia}${kind}${dividends}${stale}<div class="sub">${highlight(fund.manager ?? m.unknown_manager(), terms)} · <span class="mono">${highlight(fund.id, terms)}</span></div></td>
    <td class="num c-nav">${formatNav(fund.nav, locale)}<div class="sub">${fund.currency === 'USD' ? 'USD · ' : ''}${navDate}</div></td>
    ${returnCell(fund.return_1m, 'c-1m', locale)}
    ${returnCell(fund.return_ytd, 'c-ytd', locale)}
    ${returnCell(fund.return_1y, 'c-1y', locale, largeMove)}
    <td class="c-spark">${renderSpark(fund.spark, changeClass(fund.return_1y) || 'flat')}</td>
    ${returnCell(fund.return_3y, 'c-3y', locale)}
    <td class="num c-aum">${formatMoney(fund.aum, locale, fund.aum_currency)}<div class="sub">${fund.aum_date ? formatMonth(fund.aum_date, locale) : ''}</div></td>
    <td class="c-buy">${buy}</td>
  </tr>`;
}

export function renderRows(funds, state, dataDate, locale, comparedIds = new Set()) {
  const terms = searchTerms(state.q);
  const visible = funds.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

  if (visible.length === 0) {
    const hint = state.inactive ? m.empty_hint() : m.empty_hint_inactive();

    return `<tr class="empty-row"><td colspan="10">${escapeHtml(m.empty_text({ hint }))}</td></tr>`;
  }

  return visible.map((fund) => renderRow(fund, { terms, dataDate, locale, comparedIds })).join('');
}

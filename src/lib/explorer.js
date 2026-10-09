// What the home page's explorer shows and how: the view state (filters, sort, page), its form in the URL,
// and the filtering and sorting of the fund list. Runs at build time and in the browser.
import * as m from '../paraglide/messages.js';
import { decodeSummaries } from './explorer-data.js';
import { formatCount, formatNumber } from './format.js';
import { typeLook } from './fund-types.js';

export const PAGE_SIZES = [25, 50, 100];

const MAIN_TYPES = [
  { key: 'Pasar Uang', label: 'Pasar Uang', english: 'Money market', description: () => m.type_desc_money() },
  { key: 'Obligasi', label: 'Obligasi', english: 'Bonds', description: () => m.type_desc_bond() },
  { key: 'Saham', label: 'Saham', english: 'Equity', description: () => m.type_desc_equity() },
  { key: 'Campuran', label: 'Campuran', english: 'Mixed', description: () => m.type_desc_mixed() },
  { key: 'Reksadana Global', label: 'Global', english: 'Global', description: () => m.type_desc_global() },
  { key: 'Terproteksi', label: 'Terproteksi', english: 'Capital protected', description: () => m.type_desc_protected() },
].map((type) => ({ ...type, ...typeLook(type.key) }));

export const TYPE_GROUPS = [
  { key: '', tone: null, icon: 'table-2', description: () => m.type_all_note() },
  ...MAIN_TYPES,
  { key: 'other', ...typeLook(''), description: () => m.type_other_note() },
];

const TYPE_KEYS = new Set(TYPE_GROUPS.map((group) => group.key));
const MAIN_TYPE_KEYS = new Set(MAIN_TYPES.map((type) => type.key));

// Indonesian pages name a type as Bibit does. English pages name it in English and keep Bibit's name beneath.
export function typeNames(group, locale) {
  if (group.key === '') {
    return { name: m.type_all(), note: '' };
  }

  if (group.key === 'other') {
    return { name: m.type_other(), note: '' };
  }

  return locale === 'en' ? { name: group.english, note: group.label } : { name: group.label, note: '' };
}

const YES_NO_PARAMS = { sharia: 'sharia', bibit: 'bibit', makmur: 'makmur', dividends: 'div', inactive: 'inactive' };

// Limits typed in the filter panel, in the unit of the field: percent, rupiah billions, rupiah, a year, or years.
const NUMBER_PARAMS = ['r1y_min', 'r1y_max', 'r3y_min', 'dd_max', 'dd_min', 'aum_min', 'er_max', 'minbuy_max', 'since', 'before', 'years'];

export const DEFAULT_STATE = {
  q: '',
  type: '',
  currency: '',
  sharia: false,
  bibit: false,
  makmur: false,
  dividends: false,
  inactive: false,
  managers: [],
  ...Object.fromEntries(NUMBER_PARAMS.map((param) => [param, null])),
  sort: 'aum',
  dir: -1,
  page: 0,
  size: 50,
};

const SORT_KEYS = new Set([
  'name', 'return_1m', 'return_3m', 'return_6m', 'return_ytd', 'return_1y', 'return_3y', 'return_5y', 'cagr_3y', 'cagr_5y',
  'drawdown_1y', 'drawdown_3y', 'aum', 'expense_ratio', 'min_purchase', 'fee_subscription', 'fee_redemption', 'launch_date',
]);

// Names and costs read best from the smallest, everything else from the largest.
const ASCENDING_FIRST = new Set(['name', 'expense_ratio', 'min_purchase', 'fee_subscription', 'fee_redemption']);

export const defaultDirection = (key) => (ASCENDING_FIRST.has(key) ? 1 : -1);

// A sort key from a link the visitor may have edited; anything unknown sorts like the default.
export function parseSortKey(key) {
  return SORT_KEYS.has(key) ? key : DEFAULT_STATE.sort;
}

function parseNumber(text) {
  if (text === null || text.trim() === '') {
    return null;
  }

  const number = Number(text);

  return Number.isFinite(number) ? number : null;
}

export function parseState(search) {
  const params = new URLSearchParams(search);
  const sort = parseSortKey(params.get('sort'));
  const direction = { asc: 1, desc: -1 }[params.get('dir')] ?? defaultDirection(sort);
  const size = Number(params.get('size'));

  return {
    ...DEFAULT_STATE,
    q: params.get('q') ?? '',
    type: TYPE_KEYS.has(params.get('type')) ? params.get('type') : '',
    currency: ['IDR', 'USD'].includes(params.get('currency')) ? params.get('currency') : '',
    ...Object.fromEntries(Object.entries(YES_NO_PARAMS).map(([key, param]) => [key, params.get(param) === '1'])),
    managers: params.getAll('manager').filter(Boolean),
    ...Object.fromEntries(NUMBER_PARAMS.map((param) => [param, parseNumber(params.get(param))])),
    sort,
    dir: direction,
    page: Math.max(0, Math.floor(Number(params.get('page') ?? 1)) - 1) || 0,
    size: PAGE_SIZES.includes(size) ? size : DEFAULT_STATE.size,
  };
}

// The query string (without "?") that opens this view; a setting at its default is left out.
export function serializeState(state) {
  const params = new URLSearchParams();

  for (const key of ['q', 'type', 'currency']) {
    if (state[key] !== DEFAULT_STATE[key]) {
      params.set(key, state[key]);
    }
  }

  for (const [key, param] of Object.entries(YES_NO_PARAMS)) {
    if (state[key]) {
      params.set(param, '1');
    }
  }

  for (const manager of state.managers) {
    params.append('manager', manager);
  }

  for (const param of NUMBER_PARAMS) {
    if (state[param] !== null) {
      params.set(param, String(state[param]));
    }
  }

  if (state.sort !== DEFAULT_STATE.sort || state.dir !== DEFAULT_STATE.dir) {
    params.set('sort', state.sort);
    params.set('dir', state.dir === 1 ? 'asc' : 'desc');
  }

  if (state.page > 0) {
    params.set('page', String(state.page + 1));
  }

  if (state.size !== DEFAULT_STATE.size) {
    params.set('size', String(state.size));
  }

  return params.toString();
}

export function fundCountLabel(count, locale) {
  return count === 1 ? m.count_fund_one() : m.count_funds({ count: formatCount(count, locale) });
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function searchTerms(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

// The explorer's type filter for a Bibit type label: the label itself for a main type, "other" for the rest.
export function explorerTypeKey(label) {
  return MAIN_TYPE_KEYS.has(label) ? label : 'other';
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

// A limit that is not set lets every fund through; a fund without the value fails a limit that is set.
const atLeast = (value, limit, unit = 1) => limit === null || (value !== null && value >= limit * unit - 1e-9);
const atMost = (value, limit, unit = 1) => limit === null || (value !== null && value <= limit * unit + 1e-9);

const PERCENT = 0.01;
const RUPIAH_BILLION = 1e9;

const launchYear = (fund) => (fund.launch_date ? Number(fund.launch_date.slice(0, 4)) : null);

// A fall is stored as a negative fraction; the filters talk about how deep it is.
const fallDepth = (drawdown) => (drawdown === null ? null : -drawdown);

function matchesAdvanced(fund, state) {
  return (
    (state.managers.length === 0 || state.managers.includes(fund.manager)) &&
    atLeast(fund.return_1y, state.r1y_min, PERCENT) &&
    atMost(fund.return_1y, state.r1y_max, PERCENT) &&
    atLeast(fund.cagr_3y, state.r3y_min, PERCENT) &&
    atMost(fallDepth(fund.drawdown_1y), state.dd_max, PERCENT) &&
    atLeast(fallDepth(fund.drawdown_1y), state.dd_min, PERCENT) &&
    atLeast(fund.aum_idr, state.aum_min, RUPIAH_BILLION) &&
    atMost(fund.expense_ratio, state.er_max, PERCENT) &&
    atMost(fund.min_purchase, state.minbuy_max) &&
    atLeast(launchYear(fund), state.since) &&
    (state.before === null || (launchYear(fund) !== null && launchYear(fund) < state.before)) &&
    atLeast(fund.history_years, state.years)
  );
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
      (!state.dividends || fund.dividends) &&
      matchesAdvanced(fund, state) &&
      terms.every((term) => fund.search.includes(term)),
  );
}

const YEAR_DAYS = 365.25;
const DAY_MS = 24 * 60 * 60 * 1000;

// The data of explorer.json arrives compact; the build-time render passes the loaded summaries as they are.
// With dividends included, a fund that pays them shows its total return in place of the NAV change.
export function prepareFunds(data, includeDividends = false) {
  const { funds, date, usd_to_idr: usdToIdr } = data.columns ? decodeSummaries(data) : data;
  const today = Date.parse(date);

  return funds.map((fund) => ({
    ...fund,
    ...(includeDividends && fund.total),
    search: `${fund.names.join(' ')} ${fund.id} ${fund.manager ?? ''}`.toLowerCase(),
    aum_idr: fund.aum === null ? null : fund.aum * (fund.aum_currency === 'USD' ? usdToIdr : 1),
    history_years: fund.history_start === null ? null : (today - Date.parse(fund.history_start)) / DAY_MS / YEAR_DAYS,
  }));
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

// For each type group: how many funds match the other filters and their median 1-year return.
export function summarizeTypes(funds, state) {
  const candidates = filterFunds(funds, state, { ignoreType: true });

  return TYPE_GROUPS.map((group) => {
    const members = candidates.filter((fund) => matchesType(fund, group.key));
    const returns = members.map((fund) => fund.return_1y).filter((value) => value !== null);

    return { group, count: members.length, returnCount: returns.length, median: median(returns) };
  });
}

// Managers with at least one active fund, the biggest first.
export function managerOptions(funds) {
  const counts = new Map();

  for (const fund of funds) {
    if (fund.manager !== null && fund.active) {
      counts.set(fund.manager, (counts.get(fund.manager) ?? 0) + 1);
    }
  }

  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const percentText = (value, locale) => `${formatNumber(value, locale, 2)}%`;
const rupiahText = (value, locale) => `Rp ${formatNumber(value, locale, 0)}`;

function rangeLabel(name, min, max, format) {
  if (min !== null && max !== null) {
    return m.chip_range({ name, min: format(min), max: format(max) });
  }

  return min === null ? m.chip_at_most({ name, value: format(max) }) : m.chip_at_least({ name, value: format(min) });
}

// The panel's filters, in the order of the panel; each is shown as one chip, whichever of its limits are set.
const FILTER_GROUPS = [
  { fields: ['r1y_min', 'r1y_max'], label: (s, locale) => rangeLabel(m.filter_r1y(), s.r1y_min, s.r1y_max, (v) => percentText(v, locale)) },
  { fields: ['r3y_min'], label: (s, locale) => rangeLabel(m.filter_cagr3(), s.r3y_min, null, (v) => percentText(v, locale)) },
  { fields: ['dd_min', 'dd_max'], label: (s, locale) => rangeLabel(m.filter_dd1(), s.dd_min, s.dd_max, (v) => percentText(v, locale)) },
  { fields: ['aum_min'], label: (s, locale) => rangeLabel(m.filter_aum(), s.aum_min, null, (v) => m.chip_billion({ value: formatNumber(v, locale, 2) })) },
  { fields: ['er_max'], label: (s, locale) => rangeLabel(m.filter_er(), null, s.er_max, (v) => percentText(v, locale)) },
  { fields: ['minbuy_max'], label: (s, locale) => rangeLabel(m.filter_minbuy(), null, s.minbuy_max, (v) => rupiahText(v, locale)) },
  { fields: ['since', 'before'], label: (s) => rangeLabel(m.filter_launched(), s.since, s.before === null ? null : s.before - 1, String) },
  { fields: ['years'], label: (s, locale) => rangeLabel(m.filter_history(), s.years, null, (v) => m.chip_years({ years: formatNumber(v, locale, 1) })) },
];

const activeGroups = (state) => FILTER_GROUPS.filter((group) => group.fields.some((field) => state[field] !== null));

// How many filters of the panel are set; the Filters button shows it.
export function advancedFilterCount(state) {
  return activeGroups(state).length + (state.managers.length > 0 ? 1 : 0);
}

// The removable chips under the toolbar. `clear` holds the state changes that remove the chip.
export function activeFilters(state, locale) {
  const chips = [];

  if (state.q.trim() !== '') {
    chips.push({ label: m.chip_search({ query: state.q.trim() }), clear: { q: '' } });
  }

  if (state.type !== '') {
    const group = TYPE_GROUPS.find((candidate) => candidate.key === state.type);

    chips.push({ label: typeNames(group, locale).name, clear: { type: '' } });
  }

  for (const manager of state.managers) {
    chips.push({ label: manager, clear: { managers: state.managers.filter((name) => name !== manager) } });
  }

  for (const group of activeGroups(state)) {
    chips.push({ label: group.label(state, locale), clear: Object.fromEntries(group.fields.map((field) => [field, null])) });
  }

  return chips;
}

// Whether anything narrows the list beyond the default view; "Clear all" shows then.
export function hasActiveFilters(state) {
  const unchanged = (key) => JSON.stringify(state[key]) === JSON.stringify(DEFAULT_STATE[key]);

  return !['q', 'type', 'currency', 'sharia', 'bibit', 'makmur', 'dividends', 'inactive', 'managers', ...NUMBER_PARAMS].every(unchanged);
}

// Every filter back to its default; the sort and the page size stay.
export function clearedFilters(state) {
  return { ...DEFAULT_STATE, sort: state.sort, dir: state.dir, size: state.size };
}

// Shared by the home page's build-time render and its browser script, so both draw the same markup.
import { changeClass, formatChange, formatMoney, formatNav, formatShortDate, formatMonth } from './format.js';

export const PAGE_SIZE = 50;

const MAIN_TYPES = [
  { key: 'Pasar Uang', label: 'Pasar Uang', english: 'Money market' },
  { key: 'Obligasi', label: 'Obligasi', english: 'Bonds' },
  { key: 'Saham', label: 'Saham', english: 'Equity' },
  { key: 'Campuran', label: 'Campuran', english: 'Mixed' },
  { key: 'Reksadana Global', label: 'Global', english: 'Offshore' },
  { key: 'Terproteksi', label: 'Terproteksi', english: 'Protected' },
];

export const TYPE_GROUPS = [
  { key: '', label: 'All funds', english: 'Every type' },
  ...MAIN_TYPES,
  { key: 'other', label: 'Other', english: 'RDPT, DIRE, ETF' },
];

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

export function prepareFunds(data) {
  return data.funds.map((fund) => ({
    ...fund,
    search: `${fund.name} ${fund.symbol} ${fund.manager ?? ''}`.toLowerCase(),
    aum_idr: fund.aum === null ? null : fund.aum * (fund.currency === 'USD' ? data.usd_to_idr : 1),
  }));
}

export function sortFunds(funds, key, direction) {
  const sortKey = key === 'aum' ? 'aum_idr' : key;

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
export function renderTypeStrip(funds, state) {
  const candidates = filterFunds(funds, state, { ignoreType: true });

  return TYPE_GROUPS.map((group) => {
    const members = candidates.filter((fund) => matchesType(fund, group.key));
    const returns = members.map((fund) => fund.return_1y).filter((value) => value !== null);
    const typical = median(returns);
    const selected = state.type === group.key;

    return `<button type="button" class="type-cell" data-type="${escapeHtml(group.key)}" aria-pressed="${selected}">
      <span class="type-name">${escapeHtml(group.label)}<span class="type-count">${members.length.toLocaleString('en-US')}</span></span>
      <span class="type-en">${escapeHtml(group.english)}</span>
      <span class="type-median ${changeClass(typical)}" title="Median 1-year return of ${returns.length.toLocaleString('en-US')} funds with one">${typical === null ? '&mdash;' : formatChange(typical, 1)}<small>median 1Y</small></span>
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

function returnCell(value, className, extra = '') {
  return `<td class="num ${className} ${changeClass(value)}">${value === null ? '<span class="nil">&mdash;</span>' : formatChange(value, 1)}${extra}</td>`;
}

export function renderRow(fund, { terms, dataDate }) {
  const href = `/funds/${encodeURIComponent(fund.symbol)}/`;
  const sharia = fund.sharia ? ' <span class="tag tag-quiet" title="Sharia fund">Syariah</span>' : '';
  const stale = fund.active ? '' : ' <span class="tag tag-stale" title="No NAV in the last month">Inactive</span>';
  const dividends = fund.dividends ? ' <span class="tag tag-quiet" title="Pays cash dividends. Returns here count the NAV only, so its total return is higher.">Dividend</span>' : '';
  const largeMove = fund.large_move ? '<span class="flag" title="The NAV moved more than 20% in one day in the last year. See the fund page.">!</span>' : '';
  const buy = [fund.bibit && '<span class="tag">Bibit</span>', fund.makmur && '<span class="tag">Makmur</span>'].filter(Boolean).join(' ');
  const navDate = fund.nav_date ? formatShortDate(fund.nav_date, dataDate) : '';

  return `<tr data-href="${href}">
    <td class="c-fund"><a href="${href}">${highlight(fund.name, terms)}</a>${sharia}${dividends}${stale}<div class="sub">${highlight(fund.manager ?? 'Unknown manager', terms)} · <span class="mono">${highlight(fund.symbol, terms)}</span></div></td>
    <td class="num c-nav">${formatNav(fund.nav)}<div class="sub">${fund.currency === 'USD' ? 'USD · ' : ''}${navDate}</div></td>
    ${returnCell(fund.return_1m, 'c-1m')}
    ${returnCell(fund.return_ytd, 'c-ytd')}
    ${returnCell(fund.return_1y, 'c-1y', largeMove)}
    <td class="c-spark">${renderSpark(fund.spark, changeClass(fund.return_1y) || 'flat')}</td>
    ${returnCell(fund.return_3y, 'c-3y')}
    <td class="num c-aum">${formatMoney(fund.aum, fund.currency)}<div class="sub">${fund.aum_date ? formatMonth(fund.aum_date) : ''}</div></td>
    <td class="c-buy">${buy}</td>
  </tr>`;
}

export function renderRows(funds, state, dataDate) {
  const terms = searchTerms(state.q);
  const visible = funds.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

  if (visible.length === 0) {
    const hint = state.inactive ? 'Try fewer words or filters.' : 'Try fewer words or filters, or include inactive funds.';

    return `<tr class="empty-row"><td colspan="9">No fund matches. ${hint}</td></tr>`;
  }

  return visible.map((fund) => renderRow(fund, { terms, dataDate })).join('');
}

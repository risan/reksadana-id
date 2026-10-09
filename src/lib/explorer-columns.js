// The columns of the fund table: what each shows, how it sorts, and what it adds to a CSV download.
// The fund column itself (name, manager, tags) is always there and is drawn by explorer-render.js.
import * as m from '../paraglide/messages.js';
import { escapeHtml } from './explorer.js';
import { changeClass, formatChange, formatDate, formatMoney, formatNav, formatNumber, formatPercent, formatShortDate, formatMonth, withCurrency } from './format.js';

const SPARK_WIDTH = 76;
const SPARK_HEIGHT = 22;

export function renderSpark(spark, direction) {
  if (!spark) {
    return '';
  }

  const step = SPARK_WIDTH / (spark.length - 1);
  const y = (value) => (1.5 + ((100 - value) / 100) * (SPARK_HEIGHT - 3)).toFixed(1);
  const points = spark.map((value, index) => `${(index * step).toFixed(1)},${y(value)}`).join(' ');

  return `<svg class="spark ${direction}" width="${SPARK_WIDTH}" height="${SPARK_HEIGHT}" viewBox="0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${SPARK_WIDTH}" y1="${y(spark[0])}" y2="${y(spark[0])}" /><polyline points="${points}" /></svg>`;
}

const nil = '<span class="nil">&mdash;</span>';

const orNil = (text) => (text === null || text === '—' ? nil : text);

// A fraction as percent for a spreadsheet: 0.0412 is "4.1".
const percentNumber = (fraction, digits) => (fraction === null ? null : (fraction * 100).toFixed(digits));

// A change in percent, green or red. `extra` adds markup after the number.
function returnColumn(key, label, title, extra = () => '') {
  return {
    key,
    label,
    title,
    numeric: true,
    cellClass: (fund) => changeClass(fund[key]),
    cell: (fund, context) => `${orNil(formatChange(fund[key], context.locale, 1))}${extra(fund)}`,
    csv: [{ header: () => `${label()} (%)`, value: (fund) => percentNumber(fund[key], 1) }],
  };
}

function percentColumn(key, label, title, digits) {
  return {
    key,
    label,
    title,
    numeric: true,
    cell: (fund, { locale }) => (fund[key] === null ? nil : formatPercent(fund[key], locale, digits)),
    csv: [{ header: () => `${label()} (%)`, value: (fund) => percentNumber(fund[key], digits) }],
  };
}

export const COLUMNS = [
  {
    key: 'nav',
    label: () => m.col_nav(),
    numeric: true,
    sortable: false,
    cell: (fund, { locale, dataDate }) => `${formatNav(fund.nav, locale)}<div class="sub">${fund.currency === 'USD' ? 'USD · ' : ''}${fund.nav_date ? formatShortDate(fund.nav_date, dataDate, locale) : ''}</div>`,
    csv: [
      { header: () => m.col_nav(), value: (fund) => fund.nav },
      { header: () => m.csv_nav_date(), value: (fund) => fund.nav_date },
    ],
  },
  returnColumn('return_1m', () => m.period_1m(), () => m.col_1m_title()),
  returnColumn('return_3m', () => m.period_3m(), () => m.col_3m_title()),
  returnColumn('return_6m', () => m.period_6m(), () => m.col_6m_title()),
  returnColumn('return_ytd', () => m.period_ytd(), () => m.col_ytd_title()),
  returnColumn('return_1y', () => m.period_1y(), () => m.col_1y_title(), (fund) => (fund.large_move ? `<span class="flag" title="${escapeHtml(m.flag_large_move())}">!</span>` : '')),
  { key: 'spark', label: () => m.col_spark(), sortable: false, cell: (fund) => renderSpark(fund.spark, changeClass(fund.return_1y) || 'flat'), csv: [] },
  returnColumn('return_3y', () => m.period_3y(), () => m.col_3y_title()),
  returnColumn('return_5y', () => m.period_5y(), () => m.col_5y_title()),
  returnColumn('cagr_3y', () => m.col_cagr_3y(), () => m.col_cagr_3y_title()),
  returnColumn('cagr_5y', () => m.col_cagr_5y(), () => m.col_cagr_5y_title()),
  returnColumn('drawdown_1y', () => m.col_fall_1y(), () => m.col_fall_title({ period: m.period_1y() })),
  returnColumn('drawdown_3y', () => m.col_fall_3y(), () => m.col_fall_title({ period: m.period_3y() })),
  {
    key: 'aum',
    label: () => m.col_aum(),
    title: () => m.col_aum_title(),
    numeric: true,
    cell: (fund, { locale }) => `${formatMoney(fund.aum, locale, fund.aum_currency)}<div class="sub">${fund.aum_date ? formatMonth(fund.aum_date, locale) : ''}</div>`,
    csv: [
      { header: () => m.col_aum(), value: (fund) => fund.aum },
      { header: () => m.csv_aum_currency(), value: (fund) => fund.aum_currency },
    ],
  },
  {
    ...percentColumn('expense_ratio', () => m.col_expense(), () => m.col_expense_title(), 2),
    cell: (fund, { locale }) => (fund.expense_ratio === null ? nil : `${formatPercent(fund.expense_ratio, locale, 2)}<div class="sub">${fund.expense_source === 'makmur' ? 'Makmur' : 'Bibit'}</div>`),
  },
  {
    ...percentColumn('operating_expense', () => m.col_operating_expense(), () => m.col_operating_expense_title(), 2),
    cell: (fund, { locale }) => (fund.operating_expense === null ? nil : `${formatPercent(fund.operating_expense, locale, 2)}<div class="sub">${fund.operating_expense_year}</div>`),
    csv: [
      { header: () => `${m.col_operating_expense()} (%)`, value: (fund) => percentNumber(fund.operating_expense, 2) },
      { header: () => m.csv_operating_expense_year(), value: (fund) => fund.operating_expense_year },
    ],
  },
  {
    key: 'min_purchase',
    label: () => m.col_min_purchase(),
    title: () => m.col_min_purchase_title(),
    numeric: true,
    cell: (fund, { locale }) => (fund.min_purchase === null ? nil : withCurrency(formatNumber(fund.min_purchase, locale, 0), 'IDR')),
    csv: [{ header: () => `${m.col_min_purchase()} (Rp)`, value: (fund) => fund.min_purchase }],
  },
  percentColumn('fee_subscription', () => m.col_fee_buy(), () => m.col_fee_title(), 2),
  percentColumn('fee_redemption', () => m.col_fee_sell(), () => m.col_fee_title(), 2),
  {
    key: 'launch_date',
    label: () => m.col_launched(),
    numeric: false,
    cell: (fund, { locale }) => (fund.launch_date ? formatDate(fund.launch_date, locale) : nil),
    csv: [{ header: () => m.col_launched(), value: (fund) => fund.launch_date }],
  },
  {
    key: 'buy',
    label: () => m.col_buy(),
    sortable: false,
    cell: (fund) => [fund.bibit && '<span class="tag">Bibit</span>', fund.makmur && '<span class="tag">Makmur</span>'].filter(Boolean).join(' '),
    csv: [{ header: () => m.col_buy(), value: (fund) => [fund.bibit && 'Bibit', fund.makmur && 'Makmur'].filter(Boolean).join(' ') }],
  },
];

export const COLUMN_KEYS = COLUMNS.map((column) => column.key);

export const COLUMN_PRESETS = [
  { key: 'standard', label: () => m.preset_standard(), columns: ['return_ytd', 'return_1y', 'spark', 'cagr_3y', 'aum'] },
  { key: 'simple', label: () => m.preset_simple(), columns: ['return_1y', 'spark', 'aum'] },
  { key: 'returns', label: () => m.preset_returns(), columns: ['return_1m', 'return_3m', 'return_6m', 'return_ytd', 'return_1y', 'return_3y', 'return_5y'] },
  { key: 'risk', label: () => m.preset_risk(), columns: ['return_1y', 'spark', 'drawdown_1y', 'drawdown_3y', 'cagr_3y'] },
  { key: 'costs', label: () => m.preset_costs(), columns: ['operating_expense', 'expense_ratio', 'min_purchase', 'fee_subscription', 'fee_redemption', 'buy'] },
  { key: 'everything', label: () => m.preset_everything(), columns: COLUMN_KEYS },
];

export const DEFAULT_COLUMNS = COLUMN_PRESETS[0].columns;

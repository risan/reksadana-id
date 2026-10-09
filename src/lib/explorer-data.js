// Shrinks the fund summaries of loadFundSummaries() for the explorer's download and expands them again in the browser.
// Runs at build time and in the browser, so it must not import Node modules.
//
// A fund becomes one array, in the order of `columns`. Repeated text (manager, type) becomes an index into a list,
// yes/no fields become bits of one integer (Sharia stays as it is: it can be unknown), dates become days since
// 2000-01-01, returns become whole tenths of a percent, and the sparkline becomes a string with one base-36 digit
// per sample. Numbers are rounded to what the explorer shows, and the sparkline to 36 steps, so decoding gives
// back the same text on screen, not the same bits.

const COLUMNS = [
  'id', 'name', 'other_names', 'manager', 'type', 'currency', 'sharia', 'aum_currency', 'expense_source', 'flags',
  'nav', 'aum', 'min_purchase', 'nav_date', 'aum_date', 'launch_date', 'history_start',
  'return_1m', 'return_3m', 'return_6m', 'return_ytd', 'return_1y', 'return_3y', 'return_5y', 'cagr_3y', 'cagr_5y',
  'drawdown_1y', 'drawdown_3y', 'expense_ratio', 'fee_subscription', 'fee_redemption', 'spark', 'total',
];

const PLAIN_FIELDS = new Set(['id', 'name', 'sharia', 'nav', 'aum', 'min_purchase']);
const DICTIONARY_FIELDS = ['manager', 'type', 'currency', 'aum_currency', 'expense_source'];
const DATE_FIELDS = new Set(['nav_date', 'aum_date', 'launch_date', 'history_start']);
const FLAG_FIELDS = ['etf', 'index', 'bibit', 'makmur', 'large_move', 'dividends', 'active'];

const PERCENT_TENTHS = 1000;
const PERCENT_HUNDREDTHS = 10000;

const NUMBER_SCALES = {
  return_1m: PERCENT_TENTHS,
  return_3m: PERCENT_TENTHS,
  return_6m: PERCENT_TENTHS,
  return_ytd: PERCENT_TENTHS,
  return_1y: PERCENT_TENTHS,
  return_3y: PERCENT_TENTHS,
  return_5y: PERCENT_TENTHS,
  cagr_3y: PERCENT_TENTHS,
  cagr_5y: PERCENT_TENTHS,
  drawdown_1y: PERCENT_TENTHS,
  drawdown_3y: PERCENT_TENTHS,
  expense_ratio: PERCENT_HUNDREDTHS,
  fee_subscription: PERCENT_HUNDREDTHS,
  fee_redemption: PERCENT_HUNDREDTHS,
};

// The fields of a total-return block, which holds the returns of a fund that pays dividends.
const TOTAL_FIELDS = ['return_1m', 'return_3m', 'return_6m', 'return_ytd', 'return_1y', 'return_3y', 'return_5y', 'cagr_3y', 'cagr_5y', 'spark'];

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_DAY = Date.UTC(2000, 0, 1);
const SPARK_STEPS = 35;
const SPARK_TOP = 100;

const toDays = (isoDate) => (isoDate === null ? null : Math.round((Date.parse(isoDate) - FIRST_DAY) / DAY_MS));
const fromDays = (days) => (days === null ? null : new Date(FIRST_DAY + days * DAY_MS).toISOString().slice(0, 10));

const encodeSpark = (spark) => (spark === null ? null : spark.map((value) => Math.round((value * SPARK_STEPS) / SPARK_TOP).toString(36)).join(''));
const decodeSpark = (text) => (text === null ? null : [...text].map((digit) => Math.round((parseInt(digit, 36) * SPARK_TOP) / SPARK_STEPS)));

// As the number formatting does, and unlike Math.round, which takes -140.5 to -140.
const roundHalfAwayFromZero = (value) => Math.sign(value) * Math.round(Math.abs(value));

function encodeNumberOrSpark(field, value) {
  if (field === 'spark') {
    return encodeSpark(value);
  }

  return value === null ? null : roundHalfAwayFromZero(value * NUMBER_SCALES[field]);
}

function decodeNumberOrSpark(field, value) {
  if (field === 'spark') {
    return decodeSpark(value);
  }

  return value === null ? null : value / NUMBER_SCALES[field];
}

export function encodeSummaries(summaries) {
  const dictionaries = Object.fromEntries(DICTIONARY_FIELDS.map((field) => [field, []]));

  const indexOf = (field, value) => {
    if (value === null) {
      return null;
    }

    const words = dictionaries[field];
    const found = words.indexOf(value);

    if (found >= 0) {
      return found;
    }

    words.push(value);

    return words.length - 1;
  };

  const encodeColumn = (column, fund) => {
    if (PLAIN_FIELDS.has(column)) {
      return fund[column];
    }

    if (DICTIONARY_FIELDS.includes(column)) {
      return indexOf(column, fund[column]);
    }

    if (DATE_FIELDS.has(column)) {
      return toDays(fund[column]);
    }

    if (column === 'other_names') {
      return fund.names.length > 1 ? fund.names.slice(1).join('|') : null;
    }

    if (column === 'flags') {
      return FLAG_FIELDS.reduce((bits, field, position) => bits | (fund[field] ? 1 << position : 0), 0);
    }

    if (column === 'total') {
      return fund.total === null ? null : TOTAL_FIELDS.map((field) => encodeNumberOrSpark(field, fund.total[field]));
    }

    return encodeNumberOrSpark(column, fund[column]);
  };

  const funds = summaries.funds.map((fund) => COLUMNS.map((column) => encodeColumn(column, fund)));

  return { date: summaries.date, usd_to_idr: summaries.usd_to_idr, columns: COLUMNS, dictionaries, funds };
}

export function decodeSummaries(compact) {
  const { columns, dictionaries } = compact;

  const decodeFund = (row) => {
    const fund = {};

    columns.forEach((column, position) => {
      const value = row[position];

      if (PLAIN_FIELDS.has(column)) {
        fund[column] = value;
      } else if (DICTIONARY_FIELDS.includes(column)) {
        fund[column] = value === null ? null : dictionaries[column][value];
      } else if (DATE_FIELDS.has(column)) {
        fund[column] = fromDays(value);
      } else if (column === 'other_names') {
        fund.names = value === null ? [fund.name] : [fund.name, ...value.split('|')];
      } else if (column === 'flags') {
        FLAG_FIELDS.forEach((field, bit) => {
          fund[field] = (value & (1 << bit)) !== 0;
        });
      } else if (column === 'total') {
        fund.total = value === null ? null : Object.fromEntries(TOTAL_FIELDS.map((field, index) => [field, decodeNumberOrSpark(field, value[index])]));
      } else {
        fund[column] = decodeNumberOrSpark(column, value);
      }
    });

    return fund;
  };

  return { date: compact.date, usd_to_idr: compact.usd_to_idr, funds: compact.funds.map(decodeFund) };
}

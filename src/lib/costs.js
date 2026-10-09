// Runs both at build time and in the browser, so it must not import Node modules.
// The costs and minimums of a fund, merged from its sources. Every value keeps the source it came from.
import { formatNumber } from './format.js';

// Bibit stores the expense ratio as a fraction. A few funds carry a raw number that cannot be a ratio (RD1 has 4343.1).
const MAX_EXPENSE_RATIO = 0.1;

function isValidExpenseRatio(value) {
  return Number.isFinite(value) && value > 0 && value < MAX_EXPENSE_RATIO;
}

function isPositiveAmount(value) {
  return Number.isFinite(value) && value > 0;
}

// Bibit and Makmur can disagree by up to 2x on the same fund, and neither says as of when, so every valid one is kept.
function expenseRatiosOf({ bibit, makmur }) {
  const fromBibit = bibit.expenseratio?.percentage;
  // Makmur keeps hundredths of a percent: 206 is 2.06%.
  const fromMakmur = makmur?.expenseRatio / 10000;

  return [
    isValidExpenseRatio(fromBibit) && { value: fromBibit, source: 'bibit' },
    isValidExpenseRatio(fromMakmur) && { value: fromMakmur, source: 'makmur' },
  ].filter(Boolean);
}

function amountOf(amount, source, currency) {
  return isPositiveAmount(amount) ? { amount, currency, source } : null;
}

// Bareksa writes a fee as "min-max" fractions: "-0.02" is at most 2%, "0.005-0.03" is 0.5% to 3%, "0" is free.
// Empty is unknown.
export function parseFeeRange(text) {
  if (!text) {
    return null;
  }

  const [, minText, maxText] = text.match(/^(\d*\.?\d*)-(\d*\.?\d*)$/) ?? [];
  const toFraction = (part) => (part ? Number(part) : null);
  const range = minText === undefined ? { min: Number(text), max: Number(text) } : { min: toFraction(minText), max: toFraction(maxText) };

  if (Number.isNaN(range.min) || Number.isNaN(range.max) || (range.min === null && range.max === null)) {
    return null;
  }

  return { ...range, source: 'bareksa' };
}

function toNumberOrNull(text) {
  return text ? Number(text) : null;
}

// Bibit and Makmur sell in rupiah, also for the funds that are in USD (their minimums for those are of the
// same size as for rupiah funds). Bareksa states the currency of each amount. Rows scraped before it did have
// none, and then a rupiah fund's amount is rupiah: for any other fund the currency stays unknown.
function bareksaAmountOf(bareksa, field, fundCurrency) {
  const amount = toNumberOrNull(bareksa[field]);
  const currency = bareksa[`${field}_currency`] ?? (fundCurrency === 'IDR' ? 'IDR' : null);

  return amountOf(amount, 'bareksa', currency);
}

function custodianOf({ bibit, bareksa }) {
  if (bareksa.custodian) {
    return { name: bareksa.custodian, source: 'bareksa' };
  }

  if (bibit.custodian_bank?.name) {
    return { name: bibit.custodian_bank.name, source: 'bibit' };
  }

  return null;
}

// `bibit` is the fund's Bibit record ({} when Bibit does not list it), `makmur` its Makmur record data,
// `bareksa` its Bareksa row of funds.csv (profile columns).
export function buildCosts({ bibit, makmur, bareksa, currency }) {
  const buyableOnBibit = bibit.tradeable === 1;
  const expenseRatios = expenseRatiosOf({ bibit, makmur });

  return {
    currency,
    expense_ratio: expenseRatios[0] ?? null,
    expense_ratios: expenseRatios,
    min_purchase: [
      buyableOnBibit ? amountOf(bibit.minbuy, 'bibit', 'IDR') : null,
      amountOf(makmur?.minFirstBuy, 'makmur', 'IDR'),
      bareksaAmountOf(bareksa, 'min_purchase', currency),
    ].filter(Boolean),
    min_topup: bareksaAmountOf(bareksa, 'min_topup', currency),
    min_redemption: bareksaAmountOf(bareksa, 'min_redemption', currency),
    max_fees: {
      subscription: parseFeeRange(bareksa.fee_purchase),
      redemption: parseFeeRange(bareksa.fee_redemption),
      switch: parseFeeRange(bareksa.fee_switch),
    },
    custodian: custodianOf({ bibit, bareksa }),
  };
}

function percentText(fraction, locale) {
  return `${formatNumber(fraction * 100, locale, 2)}%`;
}

// `words` holds the translated parts: free, upTo(value), and from(value).
export function formatFeeRange(range, locale, words) {
  if (range.max === 0) {
    return words.free;
  }

  if (range.min === null) {
    return words.upTo(percentText(range.max, locale));
  }

  if (range.max === null) {
    return words.from(percentText(range.min, locale));
  }

  if (range.min === range.max) {
    return percentText(range.max, locale);
  }

  return `${formatNumber(range.min * 100, locale, 2)}–${percentText(range.max, locale)}`;
}

import { intlLocale } from './i18n.js';

// Every formatter takes the page locale ('id' or 'en') and stays pure.
const MINUS = '−';
const DASH = '—';

function isMissing(value) {
  return value === null || value === undefined || Number.isNaN(value);
}

function formatDecimal(value, locale, maximumFractionDigits, minimumFractionDigits = 0) {
  return value.toLocaleString(intlLocale(locale), { maximumFractionDigits, minimumFractionDigits });
}

export function formatPercent(fraction, locale, digits = 2) {
  if (isMissing(fraction)) {
    return DASH;
  }

  const text = formatDecimal(Math.abs(fraction * 100), locale, digits, digits);

  return `${fraction < 0 && Number(Math.abs(fraction * 100).toFixed(digits)) !== 0 ? MINUS : ''}${text}%`;
}

export function formatChange(fraction, locale, digits = 2) {
  if (isMissing(fraction)) {
    return DASH;
  }

  const text = formatDecimal(Math.abs(fraction * 100), locale, digits, digits);

  if (Number(Math.abs(fraction * 100).toFixed(digits)) === 0) {
    return `${text}%`;
  }

  return `${fraction > 0 ? '+' : MINUS}${text}%`;
}

export function formatNumber(value, locale, maximumFractionDigits = 2, minimumFractionDigits = 0) {
  if (isMissing(value)) {
    return DASH;
  }

  return formatDecimal(value, locale, maximumFractionDigits, minimumFractionDigits);
}

// NAVs run from about 1 (USD funds) to tens of thousands, so small ones keep four decimals.
export function formatNav(value, locale) {
  if (isMissing(value)) {
    return DASH;
  }

  return value < 100 ? formatNumber(value, locale, 4, 4) : formatNumber(value, locale, 2, 2);
}

export function formatCompact(value, locale) {
  if (isMissing(value)) {
    return DASH;
  }

  return new Intl.NumberFormat(intlLocale(locale), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function currencyPrefix(currency) {
  return currency === 'USD' ? 'US$' : 'Rp';
}

export function formatMoney(value, locale, currency = 'IDR') {
  if (isMissing(value)) {
    return DASH;
  }

  return `${currencyPrefix(currency)} ${formatCompact(value, locale)}`;
}

export function changeClass(value) {
  if (isMissing(value) || Math.abs(value) < 0.00005) {
    return '';
  }

  return value > 0 ? 'up' : 'down';
}

const MONTH_FORMATS = {
  id: new Intl.DateTimeFormat('id-ID', { month: 'short', timeZone: 'UTC' }),
  en: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }),
};

export function formatMonthName(year, month, locale) {
  return (MONTH_FORMATS[locale] ?? MONTH_FORMATS.id).format(Date.UTC(year, month - 1, 1));
}

export function formatDate(date, locale) {
  if (!date) {
    return DASH;
  }

  const [year, month, day] = date.split('-').map(Number);

  return `${day} ${formatMonthName(year, month, locale)} ${year}`;
}

// Drops the year when it matches the reference date's year, to keep table cells short.
export function formatShortDate(date, referenceDate, locale) {
  if (!date) {
    return DASH;
  }

  const [year, month, day] = date.split('-').map(Number);

  if (referenceDate && referenceDate.startsWith(String(year))) {
    return `${day} ${formatMonthName(year, month, locale)}`;
  }

  return `${formatMonthName(year, month, locale)} ${year}`;
}

export function formatMonth(date, locale) {
  if (!date) {
    return DASH;
  }

  const [year, month] = date.split('-').map(Number);

  return `${formatMonthName(year, month, locale)} ${year}`;
}

// A count of things, such as funds, with thousands separators.
export function formatCount(value, locale) {
  return formatDecimal(value, locale, 0);
}

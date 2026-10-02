const MINUS = '−';
const DASH = '—';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function isMissing(value) {
  return value === null || value === undefined || Number.isNaN(value);
}

export function formatPercent(fraction, digits = 2) {
  if (isMissing(fraction)) {
    return DASH;
  }

  const text = Math.abs(fraction * 100).toFixed(digits);

  return `${fraction < 0 && Number(text) !== 0 ? MINUS : ''}${text}%`;
}

export function formatChange(fraction, digits = 2) {
  if (isMissing(fraction)) {
    return DASH;
  }

  const text = Math.abs(fraction * 100).toFixed(digits);

  if (Number(text) === 0) {
    return `${text}%`;
  }

  return `${fraction > 0 ? '+' : MINUS}${text}%`;
}

export function formatNumber(value, maximumFractionDigits = 2, minimumFractionDigits = 0) {
  if (isMissing(value)) {
    return DASH;
  }

  return value.toLocaleString('en-US', { maximumFractionDigits, minimumFractionDigits });
}

// NAVs run from about 1 (USD funds) to tens of thousands, so small ones keep four decimals.
export function formatNav(value) {
  if (isMissing(value)) {
    return DASH;
  }

  return value < 100 ? formatNumber(value, 4, 4) : formatNumber(value, 2, 2);
}

export function formatCompact(value) {
  if (isMissing(value)) {
    return DASH;
  }

  return compactNumber.format(value);
}

export function currencyPrefix(currency) {
  return currency === 'USD' ? 'US$' : 'Rp';
}

export function formatMoney(value, currency = 'IDR') {
  if (isMissing(value)) {
    return DASH;
  }

  return `${currencyPrefix(currency)} ${formatCompact(value)}`;
}

export function changeClass(value) {
  if (isMissing(value) || Math.abs(value) < 0.00005) {
    return '';
  }

  return value > 0 ? 'up' : 'down';
}

export function formatDate(date) {
  if (!date) {
    return DASH;
  }

  const [year, month, day] = date.split('-').map(Number);

  return `${day} ${MONTHS[month - 1]} ${year}`;
}

// Drops the year when it matches the reference date's year, to keep table cells short.
export function formatShortDate(date, referenceDate) {
  if (!date) {
    return DASH;
  }

  const [year, month, day] = date.split('-').map(Number);

  if (referenceDate && referenceDate.startsWith(String(year))) {
    return `${day} ${MONTHS[month - 1]}`;
  }

  return `${MONTHS[month - 1]} ${year}`;
}

export function formatMonth(date) {
  if (!date) {
    return DASH;
  }

  const [year, month] = date.split('-').map(Number);

  return `${MONTHS[month - 1]} ${year}`;
}

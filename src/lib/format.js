const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });

export function formatPercent(fraction, digits = 2) {
  if (fraction === null || fraction === undefined) {
    return '-';
  }

  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatNumber(value, maximumFractionDigits = 2) {
  if (value === null || value === undefined) {
    return '-';
  }

  return value.toLocaleString('en-US', { maximumFractionDigits });
}

export function formatCompact(value) {
  if (value === null || value === undefined) {
    return '-';
  }

  return compactNumber.format(value);
}

export function signClass(value) {
  if (value === null || value === undefined || value === 0) {
    return '';
  }

  return value > 0 ? 'positive' : 'negative';
}

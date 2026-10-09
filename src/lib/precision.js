// Sources round NAVs differently: Kontan and Makmur keep two decimals, Bibit and Bareksa four. Two NAVs from
// different sources are the same when they agree at the coarser precision.

const MAX_DECIMALS = 5;

// The decimals a number was written with. A number read from a file loses its trailing zeros, so a source's
// precision is the most decimals any of its values shows (see `precisionOf`), not the decimals of one value.
export const decimalsOf = (value) => Math.min(MAX_DECIMALS, (String(value).split('.')[1] ?? '').length);

// The most decimals any of the values shows.
export const precisionOf = (values) => values.reduce((most, value) => Math.max(most, decimalsOf(value)), 0);

export const agreeAtPrecision = (x, y, decimals) => {
  const scale = 10 ** decimals;

  return Math.round(x * scale) === Math.round(y * scale);
};

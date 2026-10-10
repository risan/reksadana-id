import * as m from '../paraglide/messages.js';

// Bibit's type labels, in the order a reader looks for them, with an English name, a color tone (the
// `.type-<tone>` classes in global.css), and an icon (src/lib/icons.js) for each.
export const FUND_TYPES = [
  { label: 'Pasar Uang', english: 'Money market', tone: 'money', icon: 'banknote' },
  { label: 'Obligasi', english: 'Bonds', tone: 'bond', icon: 'scroll-text' },
  { label: 'Saham', english: 'Equity', tone: 'equity', icon: 'chart-candlestick' },
  { label: 'Campuran', english: 'Mixed', tone: 'mixed', icon: 'chart-pie' },
  { label: 'Reksadana Global', english: 'Global', tone: 'global', icon: 'earth' },
  { label: 'Terproteksi', english: 'Capital protected', tone: 'protected', icon: 'shield-check' },
  { label: 'Penyertaan Terbatas', english: 'Private placement', tone: 'other', icon: 'blocks' },
  { label: 'Dana Investasi Real Estate', english: 'Real estate (DIRE)', tone: 'other', icon: 'blocks' },
  { label: 'Benchmark', english: 'Gold ETFs', indonesian: 'ETF Emas', tone: 'other', icon: 'blocks' },
];

const OTHER_TYPE_LOOK = { tone: 'other', icon: 'blocks' };

// The tone and icon of a type label; an unknown or empty label looks like the "other" group.
export function typeLook(label) {
  const type = FUND_TYPES.find((candidate) => candidate.label === label);

  return type ? { tone: type.tone, icon: type.icon } : OTHER_TYPE_LOOK;
}

export function englishTypeName(label) {
  return FUND_TYPES.find((type) => type.label === label)?.english ?? null;
}

// Indonesian pages show Bibit's label, unless it means nothing to a reader ("Benchmark" is Bibit's label for its gold
// ETFs); English pages show the English name, and the label when there is none.
export function typeName(label, locale) {
  if (locale === 'en') {
    return englishTypeName(label) ?? label;
  }

  return FUND_TYPES.find((type) => type.label === label)?.indonesian ?? label;
}

// Sharia status is null when no source states it, which is not the same as "No".
export function shariaText(sharia) {
  if (sharia === null || sharia === undefined) {
    return m.detail_not_stated();
  }

  return sharia ? m.compare_yes() : m.compare_no();
}

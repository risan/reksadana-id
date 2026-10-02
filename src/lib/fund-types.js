// Bibit's type labels, in the order a reader looks for them, with an English name for each.
export const FUND_TYPES = [
  { label: 'Pasar Uang', english: 'Money market' },
  { label: 'Obligasi', english: 'Bonds' },
  { label: 'Saham', english: 'Equity' },
  { label: 'Campuran', english: 'Mixed' },
  { label: 'Reksadana Global', english: 'Global' },
  { label: 'Terproteksi', english: 'Capital protected' },
  { label: 'Penyertaan Terbatas', english: 'Private placement' },
  { label: 'Dana Investasi Real Estate', english: 'Real estate (DIRE)' },
  { label: 'Benchmark', english: 'Gold ETFs' },
];

export function englishTypeName(label) {
  return FUND_TYPES.find((type) => type.label === label)?.english ?? null;
}

// Indonesian pages show Bibit's label; English pages show the English name, and the label when there is none.
export function typeName(label, locale) {
  return locale === 'en' ? (englishTypeName(label) ?? label) : label;
}

export const manager = 'Schroder Investment Management Indonesia, PT';

// The fund centre of Schroders is a page that only shows its funds after a visitor accepts a disclaimer, and has no list
// to read. The prospectuses stand at addresses made of the fund's name, so the names are kept here. A new fund is
// added by its name as in "https://api.schroders.com/document-store/<Name-With-Hyphens>-SP-IDBA.pdf". A file that
// answers 404 is left out of the list.
const FUND_NAMES = [
  'Schroder 90 Plus Equity Fund',
  'Schroder Dana Andalan II',
  'Schroder Dana Campuran Progresif',
  'Schroder Dana Ekuitas Utama',
  'Schroder Dana Istimewa',
  'Schroder Dana Kombinasi',
  'Schroder Dana Likuid',
  'Schroder Dana Likuid Syariah',
  'Schroder Dana Mantap Plus II',
  'Schroder Dana Obligasi Mantap',
  'Schroder Dana Obligasi Utama',
  'Schroder Dana Pasar Uang',
  'Schroder Dana Prestasi',
  'Schroder Dana Prestasi Plus',
  'Schroder Dana Prestasi Prima',
  'Schroder Dana Terpadu II',
  'Schroder Dynamic Balanced Fund',
  'Schroder Global Sharia Equity Fund',
  'Schroder IDR Bond Fund II',
  'Schroder IDR Bond Fund III',
  'Schroder Indo Equity Fund',
  'Schroder Investa Obligasi',
  'Schroder USD Bond Fund',
  'Schroder USD Bond Fund II',
];

export const addressOf = (fundName) => `https://api.schroders.com/document-store/${fundName.replaceAll(' ', '-')}-SP-IDBA.pdf`;

export const listDocuments = async () => FUND_NAMES.map((name) => ({ name, url: addressOf(name) }));

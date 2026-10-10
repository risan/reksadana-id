import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCsv } from './explorer-csv.js';
import { COLUMN_KEYS, COLUMN_PRESETS, DEFAULT_COLUMNS, WIDE_COLUMNS, defaultColumns } from './explorer-columns.js';
import { parseColumns } from './explorer-preferences.js';

const funds = [
  {
    id: 'RD1',
    name: 'Alpha "Prime", Kelas A',
    manager: 'Alpha Asset',
    type: 'Obligasi',
    currency: 'IDR',
    nav: 1234.5,
    nav_date: '2026-10-09',
    return_1y: 0.0412,
    aum: 5e11,
    aum_currency: 'IDR',
    bibit: true,
    makmur: true,
    spark: [1, 2],
  },
  { id: 'RD2', name: 'Beta', manager: null, type: null, currency: 'USD', nav: null, nav_date: null, return_1y: null, aum: null, aum_currency: null, bibit: false, makmur: false, spark: null },
];

test('the CSV starts with a byte order mark and ends every line with CRLF', () => {
  const csv = buildCsv(funds, []);

  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.endsWith('\r\n'));
  assert.equal(csv.split('\r\n').length, 4);
});

test('the identity of each fund is always there, and a column adds its figures', () => {
  const [header, first, second] = buildCsv(funds, ['return_1y', 'aum', 'buy', 'spark']).replace('\uFEFF', '').trimEnd().split('\r\n');

  assert.ok(header.startsWith('ID,'));
  assert.ok(header.includes('(%)'));
  assert.equal(first, 'RD1,"Alpha ""Prime"", Kelas A",Alpha Asset,Obligasi,IDR,4.1,500000000000,IDR,Bibit Makmur');
  assert.equal(second, 'RD2,Beta,,,USD,,,,');
});

test('a column that is not showing is not in the file', () => {
  const [header] = buildCsv(funds, ['return_1y']).replace('\uFEFF', '').split('\r\n');

  assert.equal(header.split(',').length, 6);
});

test('every column that can be sorted or filtered has its figures in the CSV when it is showing', () => {
  const [header] = buildCsv(funds, COLUMN_KEYS).split('\r\n');

  assert.ok(header.split(',').length > COLUMN_KEYS.length);
});

test('stored columns come back in table order, unknown keys are dropped, and nothing valid means the default', () => {
  assert.deepEqual(parseColumns('aum return_1y bogus'), ['return_1y', 'aum']);
  assert.deepEqual(parseColumns('bogus'), DEFAULT_COLUMNS);
  assert.deepEqual(parseColumns(null), DEFAULT_COLUMNS);
  assert.deepEqual(parseColumns('none'), []);
});

test('every preset names only columns that exist, and the first one is the default', () => {
  for (const preset of COLUMN_PRESETS) {
    assert.ok(preset.columns.every((key) => COLUMN_KEYS.includes(key)), preset.key);
  }

  assert.equal(COLUMN_PRESETS[0].columns, DEFAULT_COLUMNS);
});

test('the wide default names only columns that exist, and a screen without a window gets the narrow default', () => {
  assert.ok(WIDE_COLUMNS.every((key) => COLUMN_KEYS.includes(key)));
  assert.equal(defaultColumns(), DEFAULT_COLUMNS);
});

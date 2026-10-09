import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SERIES, parseIndexRows } from './benchmarks.js';

const DATA_DIR = path.join(import.meta.dirname, '..', 'data', 'benchmarks');

// Trimmed from the answer of product_index for COMPOSITE and the money market category.
const ANSWER = {
  status: true,
  data: {
    auth: true,
    mfs: [{ pid: '131', nav: [{ id: '1', date: '2026-10-08', value: '29485.520000' }] }],
    sis: [{
      sector_code: 'COMPOSITE',
      index: [
        { sector_code: 'COMPOSITE', recdate: '2026-10-07', value: '6146.72' },
        { sector_code: 'COMPOSITE', recdate: '2026-10-08', value: '6031.28' },
        { sector_code: 'COMPOSITE', recdate: '2026-10-09', value: '0' },
      ],
    }],
    mfis: [{
      product_type_id: '1',
      product_type_name: 'Reksa Dana Pasar Uang',
      index: [{ product_type_id: '1', date: '2026-10-08', value: '1655.3042' }],
    }],
  },
};

test('a stock index is read from sis by its sector code, and a zero value is skipped', () => {
  assert.deepEqual(parseIndexRows(ANSWER, { id: 'ihsg', sectorCode: 'COMPOSITE' }), [
    ['2026-10-07', '6146.72'],
    ['2026-10-08', '6031.28'],
  ]);
});

test('a category index is read from mfis by its product type', () => {
  assert.deepEqual(parseIndexRows(ANSWER, { id: 'bareksa-money-market', productTypeId: '1' }), [['2026-10-08', '1655.3042']]);
});

test('an answer for another index is an error', () => {
  assert.throws(() => parseIndexRows(ANSWER, { id: 'lq45', sectorCode: 'LQ45' }), /no index for lq45/);
  assert.throws(() => parseIndexRows(ANSWER, { id: 'bareksa-equity', productTypeId: '3' }), /no index for bareksa-equity/);
});

test('an answer without a login is an error', () => {
  assert.throws(() => parseIndexRows({ status: true, data: { auth: false } }, { id: 'ihsg', sectorCode: 'COMPOSITE' }), /did not serve/);
});

test('benchmarks.json describes every scraped series, starting on the first date of its file', () => {
  const described = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'benchmarks.json'), 'utf8'));

  assert.deepEqual(described.map((series) => series.id).sort(), SERIES.map((series) => series.id).sort());

  for (const series of described) {
    const [, firstRow] = fs.readFileSync(path.join(DATA_DIR, `${series.id}.csv`), 'utf8').split('\n');

    assert.equal(firstRow.split(',')[0], series.start_date, series.id);
    assert.ok(series.name.id && series.name.en && series.description.id && series.description.en, series.id);
  }
});

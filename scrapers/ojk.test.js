import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chooseMonths, monthsInWindow, parseCallbackRows, parseItemCount } from './ojk.js';

const callback = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'ojk-callback.txt'), 'utf8');

test('the callback rows are manager, custodian, fund, type, currency, AUM and units as plain numbers', () => {
  const rows = parseCallbackRows(callback);

  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], [
    'Allianz Global Investors Asset Management Indonesia, PT',
    'BANK CENTRAL ASIA - CUSTODY, Tbk, PT',
    'REKSA DANA TERPROTEKSI ALLIANZ CAPITAL PROTECTED FUND 62',
    'Capital Protected Fund',
    'IDR',
    '514581765130.65',
    '500361000',
  ]);
});

test('a fund with no assets keeps its row with zeros, and a USD fund has its AUM in rupiah', () => {
  const [, dissolved, usd] = parseCallbackRows(callback);

  assert.deepEqual(dissolved.slice(4), ['IDR', '0', '0']);
  assert.deepEqual(usd.slice(4), ['USD', '155566692296.16', '7962715.85']);
});

test('HTML entities in a fund name are decoded', () => {
  assert.equal(parseCallbackRows(callback)[3][2], "REKSA DANA TERPROTEKSI ALLIANZ R&D FUND 'X'");
});

test('a row with the wrong number of cells is an error', () => {
  assert.throws(() => parseCallbackRows('<tr id="g_DXDataRow0" class="x"><td>a</td><td>b</td></tr>'), /cells/);
});

test('the item count comes from the page, and a month that is not published has none', () => {
  assert.equal(parseItemCount('<b>Page 1 of 214 (2136 items)</b>'), 2136);
  assert.equal(parseItemCount('<b>Page 1 of 0 (0 items)</b>'), 0);
  assert.throws(() => parseItemCount('<html>Error</html>'), /how many funds/);
});

test('the window is the 36 months that end last month', () => {
  const months = monthsInWindow(new Date('2026-10-09T00:00:00Z'));

  assert.equal(months.length, 36);
  assert.equal(months[0], '2023-10');
  assert.equal(months.at(-1), '2026-09');
});

test('a run fetches the months it does not have and the newest two it has', () => {
  const windowMonths = ['2026-06', '2026-07', '2026-08', '2026-09'];

  assert.deepEqual(chooseMonths(windowMonths, new Set()), windowMonths);
  assert.deepEqual(chooseMonths(windowMonths, new Set(['2026-06', '2026-07', '2026-08'])), ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(chooseMonths(windowMonths, new Set(windowMonths)), ['2026-08', '2026-09']);
});

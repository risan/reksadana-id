import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_PEERS, TABLE_PERIODS, linePath, median, medianReturns, peerReturns, profileSummary, shareBeaten, shortBenchmarkName } from './fund-page.js';

const fund = (type, return_1y, extra = {}) => ({ type, active: true, return_1y, total: null, ...extra });
const bondFunds = [0.01, 0.02, 0.03, 0.04, 0.05].map((value) => fund('Obligasi', value));

test('the peers of a type are its active funds with a return, sorted', () => {
  const peers = peerReturns([fund('Obligasi', 0.03), fund('Obligasi', 0.01), fund('Obligasi', null), fund('Obligasi', 0.5, { active: false }), fund('Saham', 0.2)]);

  assert.deepEqual(peers.get('Obligasi').nav['1y'], [0.01, 0.03]);
  assert.deepEqual(peers.get('Saham').nav['1y'], [0.2]);
  assert.deepEqual(peers.get('Obligasi').nav['5y'], []);
});

test('the total view of a fund without dividends is its NAV change, and the total of one with dividends replaces it', () => {
  const peers = peerReturns([fund('Obligasi', 0.01), fund('Obligasi', 0.02, { total: { return_1y: 0.05 } })]).get('Obligasi');

  assert.deepEqual(peers.nav['1y'], [0.01, 0.02]);
  assert.deepEqual(peers.total['1y'], [0.01, 0.05]);
});

test('peers are computed once per list of funds', () => {
  assert.equal(peerReturns(bondFunds), peerReturns(bondFunds));
});

test('a median needs enough funds, and is the average of the middle two for an even count', () => {
  assert.equal(median([1, 2, 3, 4, 5]), 3);
  assert.equal(median([1, 2, 3, 4, 5, 6]), 3.5);
  assert.equal(median([1, 2, 3, 4]), null);
  assert.equal(MIN_PEERS, 5);
});

test('medians come per table period, null where the type has too few returns or no peers', () => {
  const medians = medianReturns(peerReturns(bondFunds).get('Obligasi').nav);

  assert.equal(medians['1y'], 0.03);
  assert.equal(medians['3y'], null);
  assert.deepEqual(Object.keys(medians), TABLE_PERIODS);
  assert.equal(medianReturns(undefined)['1y'], null);
});

test('the share beaten is the share of the other funds with a lower return', () => {
  const values = [0.01, 0.02, 0.03, 0.04, 0.05];

  assert.equal(shareBeaten(values, 0.05), 1);
  assert.equal(shareBeaten(values, 0.03), 0.5);
  assert.equal(shareBeaten(values, 0.01), 0);
  assert.equal(shareBeaten(values.slice(0, 4), 0.04), null);
});

test('the profile summary is the first line with real text', () => {
  assert.equal(profileSummary('REKSA DANA X bertujuan tumbuh.\n\nLine two.'), 'REKSA DANA X bertujuan tumbuh.');
  assert.equal(profileSummary('-\n\nSecond line has words.'), 'Second line has words.');
  assert.equal(profileSummary('  \n . . \n100% saham'), '100% saham');
});

test('a profile with only punctuation or nothing has no summary', () => {
  assert.equal(profileSummary('-'), null);
  assert.equal(profileSummary(' - \n -- \n'), null);
  assert.equal(profileSummary(''), null);
  assert.equal(profileSummary(null), null);
  assert.equal(profileSummary(undefined), null);
});

test('a long summary is cut with an ellipsis', () => {
  const summary = profileSummary(`${'kata '.repeat(100)}`);

  assert.equal(summary.length, 221);
  assert.ok(summary.endsWith('…'));
});

test('a benchmark has a short name: the abbreviation, on either side of the brackets', () => {
  assert.equal(shortBenchmarkName('IHSG (Jakarta Composite Index)'), 'IHSG');
  assert.equal(shortBenchmarkName('IHSG (Indeks Harga Saham Gabungan)'), 'IHSG');
  assert.equal(shortBenchmarkName('Jakarta Islamic Index (JII)'), 'JII');
  assert.equal(shortBenchmarkName('BI-Rate (Bank Indonesia policy rate)'), 'BI-Rate');
  assert.equal(shortBenchmarkName('Bareksa Fixed Income Fund Index'), 'Bareksa Fixed Income Index');
  assert.equal(shortBenchmarkName('Indeks Reksa Dana Saham Bareksa'), 'Indeks Saham Bareksa');
  assert.equal(shortBenchmarkName('LQ45'), 'LQ45');
});

test('a line path fills its box from the lowest to the highest value, and needs two values', () => {
  assert.equal(linePath([1, 3, 2], 100, 10), 'M0.0 10.0L50.0 0.0L100.0 5.0');
  assert.equal(linePath([5, 5], 10, 10), 'M0.0 10.0L10.0 10.0');
  assert.equal(linePath([5], 10, 10), null);
});

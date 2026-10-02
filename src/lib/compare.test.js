import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFunds, chartRange, costsOf, indexedSeries, resolveSelection, returnsAtCommonEnd, selectionQuery, selectionText } from './compare.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function dailyHistory(startDate, count, firstValue = 100, primary = 'bibit') {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const points = Array.from({ length: count }, (_, index) => ({
    date: new Date(start + index * DAY_MS).toISOString().slice(0, 10),
    value: firstValue + index,
    source: primary,
  }));

  return { points, primary };
}

const known = new Set(['RD1', 'RD2', 'RD3', 'RD4', 'RD5', 'RD6', 'NEW1']);
const retired = { OLD1: 'NEW1' };

test('the URL wins over the saved tray, even when it is empty', () => {
  assert.equal(selectionText('?f=RD1,RD2', 'RD3'), 'RD1,RD2');
  assert.equal(selectionText('?f=', 'RD3'), '');
  assert.equal(selectionText('', 'RD3'), 'RD3');
  assert.equal(selectionText('', null), '');
});

test('a selection resolves retired IDs, collapses duplicates, and drops bad IDs', () => {
  const result = resolveSelection('RD1, OLD1,RD1,NEW1,XX9,<b>,__proto__,RD2', { knownIds: known, retiredIds: retired });

  assert.deepEqual(result.ids, ['RD1', 'NEW1', 'RD2']);
  assert.deepEqual(result.dropped, ['XX9', '<b>', '__proto__']);
});

test('a selection keeps the first five funds and drops the rest', () => {
  const result = resolveSelection('RD1,RD2,RD3,RD4,RD5,RD6', { knownIds: known, retiredIds: retired });

  assert.deepEqual(result.ids, ['RD1', 'RD2', 'RD3', 'RD4', 'RD5']);
  assert.deepEqual(result.dropped, ['RD6']);
});

test('the query lists the IDs in order', () => {
  assert.equal(selectionQuery(['RD1', 'RD2']), '?f=RD1,RD2');
  assert.equal(selectionQuery([]), '');
});

test('a stale fund is excluded and does not move the common end', () => {
  const analysis = analyzeFunds([
    { id: 'A', history: dailyHistory('2026-01-01', 270) },
    { id: 'B', history: dailyHistory('2026-01-01', 265) },
    { id: 'OLD', history: dailyHistory('2026-01-01', 100) },
  ]);

  assert.equal(analysis.commonEnd, '2026-09-22');
  assert.deepEqual(analysis.eligible.map((entry) => entry.id), ['A', 'B']);
  assert.deepEqual(analysis.excluded, [{ id: 'OLD', reason: 'stale', date: '2026-04-10' }]);
});

test('the common end is the earliest latest NAV among the eligible funds', () => {
  const analysis = analyzeFunds([
    { id: 'A', history: dailyHistory('2026-01-01', 270) },
    { id: 'B', history: dailyHistory('2026-01-01', 260) },
  ]);
  const longer = analysis.eligible[0];

  assert.equal(analysis.commonEnd, '2026-09-17');
  assert.equal(longer.history.points[longer.endIndex].date, '2026-09-17');
});

test('a fund with no NAV near the common end is excluded', () => {
  const sparse = {
    primary: 'bibit',
    points: [
      { date: '2026-01-01', value: 100 },
      { date: '2026-08-01', value: 105 },
      { date: '2026-09-25', value: 110 },
    ],
  };
  const analysis = analyzeFunds([
    { id: 'S', history: sparse },
    { id: 'A', history: dailyHistory('2026-01-01', 250) },
  ]);

  assert.equal(analysis.commonEnd, '2026-09-07');
  assert.deepEqual(analysis.eligible.map((entry) => entry.id), ['A']);
  assert.deepEqual(analysis.excluded, [{ id: 'S', reason: 'gap', date: '2026-09-07' }]);
});

test('a fund with fewer than two NAVs has no history to compare', () => {
  const analysis = analyzeFunds([
    { id: 'A', history: dailyHistory('2026-01-01', 30) },
    { id: 'E', history: { points: [], primary: null } },
  ]);

  assert.deepEqual(analysis.excluded, [{ id: 'E', reason: 'no-history' }]);
});

test('a monthly history tolerates a longer gap than a daily one', () => {
  const monthly = {
    primary: 'bareksa-monthly',
    points: [
      { date: '2025-01-31', value: 100 },
      { date: '2025-07-31', value: 110 },
      { date: '2026-08-31', value: 130 },
    ],
  };
  const analysis = analyzeFunds([
    { id: 'M', history: monthly },
    { id: 'D', history: dailyHistory('2025-06-01', 460) },
  ]);

  assert.equal(analysis.commonEnd, '2026-08-31');
  assert.equal(analysis.eligible.length, 2);

  const oneYear = chartRange('1y', analysis);

  assert.equal(oneYear.startDate, '2025-08-31');
  assert.equal(oneYear.startIndexById.M, 1);
});

test('a daily history with the same gap cannot start a range', () => {
  const daily = {
    primary: 'bibit',
    points: [
      { date: '2025-01-31', value: 100 },
      { date: '2025-07-31', value: 110 },
      { date: '2026-08-31', value: 130 },
    ],
  };
  const analysis = analyzeFunds([{ id: 'X', history: daily }]);

  assert.equal(chartRange('1y', analysis), null);
});

test('a range is not available when a fund has no NAV at its start', () => {
  const analysis = analyzeFunds([
    { id: 'A', history: dailyHistory('2026-01-01', 270) },
    { id: 'B', history: dailyHistory('2026-05-01', 150) },
  ]);

  assert.equal(chartRange('6m', analysis), null);
  assert.equal(chartRange('1y', analysis), null);
  assert.ok(chartRange('1m', analysis));
});

test('Max starts at the latest first NAV and every fund is indexed to 100 there', () => {
  const analysis = analyzeFunds([
    { id: 'A', history: dailyHistory('2026-01-01', 270, 50) },
    { id: 'B', history: dailyHistory('2026-05-01', 150, 200) },
  ]);
  const range = chartRange('all', analysis);

  assert.equal(range.startDate, '2026-05-01');

  const { dates, series } = indexedSeries(analysis, range);

  assert.equal(dates[0], '2026-05-01');
  assert.equal(series[0].values[0], 100);
  assert.equal(series[1].values[0], 100);
  assert.ok(Math.abs(series[0].values.at(-1) - ((50 + 269) / (50 + 120)) * 100) < 1e-9);
});

test('returns are measured back from the common end, not from each fund\'s own end', () => {
  const analysis = analyzeFunds([
    { id: 'A', history: dailyHistory('2025-09-01', 400, 100) },
    { id: 'B', history: dailyHistory('2025-09-01', 395, 100) },
  ]);
  const result = returnsAtCommonEnd(analysis.eligible[0], analysis.commonEnd);

  assert.equal(analysis.commonEnd, '2026-09-30');
  assert.ok(Math.abs(result.simplereturn['1m'] - (494 / 463 - 1)) < 1e-12);
});

test('costs read from record.costs, and a missing part stays missing', () => {
  assert.deepEqual(costsOf({}), { expenseRatio: null, minPurchases: [], maxFees: [], custodian: null });

  const costs = costsOf({ costs: { expense_ratio: 0.012, min_purchase: [{ distributor: 'Bibit', amount: 10000 }], max_fees: { subscription: 0.01, redemption: 0 }, custodian: 'Bank X' } });

  assert.equal(costs.expenseRatio, 0.012);
  assert.deepEqual(costs.maxFees, [['subscription', 0.01], ['redemption', 0]]);
});

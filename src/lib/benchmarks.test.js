import assert from 'node:assert/strict';
import { test } from 'node:test';
import { benchmarkAt, rebaseBenchmark, suggestBenchmarkIds } from './benchmarks.js';

test('each fund type is compared with its own category index', () => {
  assert.deepEqual(suggestBenchmarkIds({ type: 'Pasar Uang', currency: 'IDR', sharia: false }), ['bareksa-money-market', 'bi-rate']);
  assert.deepEqual(suggestBenchmarkIds({ type: 'Obligasi', currency: 'IDR', sharia: null }), ['bareksa-fixed-income']);
  assert.deepEqual(suggestBenchmarkIds({ type: 'Terproteksi', currency: 'IDR', sharia: null }), ['bareksa-fixed-income']);
  assert.deepEqual(suggestBenchmarkIds({ type: 'Campuran', currency: 'IDR', sharia: false }), ['bareksa-balanced', 'ihsg']);
});

test('an equity fund is compared with the IHSG, and a sharia one with the Jakarta Islamic Index too', () => {
  assert.deepEqual(suggestBenchmarkIds({ type: 'Saham', currency: 'IDR', sharia: false }), ['ihsg', 'bareksa-equity']);
  assert.deepEqual(suggestBenchmarkIds({ type: 'Saham', currency: 'IDR', sharia: true }), ['ihsg', 'jii', 'bareksa-equity']);
});

test('global funds, USD funds, and types without an index have no suggestion', () => {
  assert.deepEqual(suggestBenchmarkIds({ type: 'Reksadana Global', currency: 'IDR', sharia: null }), []);
  assert.deepEqual(suggestBenchmarkIds({ type: 'Saham', currency: 'USD', sharia: false }), []);
  assert.deepEqual(suggestBenchmarkIds({ type: null, currency: null, sharia: null }), []);
  assert.deepEqual(suggestBenchmarkIds({ type: 'Penyertaan Terbatas', currency: 'IDR', sharia: null }), []);
});

const dailyPoints = (startDate, values) => values.map((value, index) => ({ date: new Date(Date.parse(`${startDate}T00:00:00Z`) + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), value }));

test('an index is measured to the last day on or before the end date, with the same periods as a fund', () => {
  const series = { id: 'ihsg', kind: 'stock', points: dailyPoints('2026-01-01', Array.from({ length: 100 }, (_, day) => 1000 + day)) };
  const entry = benchmarkAt(series, '2026-03-01');

  assert.equal(entry.end_date, '2026-03-01');
  assert.equal(entry.value, 1059);
  assert.ok(Math.abs(entry.returns.simplereturn['1m'] - (1059 / 1031 - 1)) < 1e-12);
  assert.equal(entry.returns.simplereturn['1y'], undefined);
});

test('a rate has the value in force on the end date and no returns', () => {
  const series = { id: 'bi-rate', kind: 'rate', points: [{ date: '2026-06-18', value: 5.75 }, { date: '2026-09-23', value: 5.5 }] };

  assert.deepEqual(benchmarkAt(series, '2026-09-01'), { id: 'bi-rate', kind: 'rate', end_date: '2026-06-18', value: 5.75, returns: null });
});

test('a series that starts after the end date gives nothing', () => {
  assert.equal(benchmarkAt({ id: 'ihsg', kind: 'stock', points: [{ date: '2026-01-01', value: 1 }] }, '2025-12-31'), null);
});

test('an index drawn over a fund starts at the fund NAV of the range start and keeps its own growth', () => {
  const fund = dailyPoints('2026-01-01', [10, 11, 12, 13]);
  const levels = dailyPoints('2026-01-01', [100, 100, 150, 300]);

  assert.deepEqual(rebaseBenchmark(fund, levels, 1), [null, 11, 16.5, 33]);
});

test('an index uses its last level on or before a fund date, and has none when it stops long before', () => {
  const fund = dailyPoints('2026-01-01', [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  const levels = [{ date: '2026-01-01', value: 100 }, { date: '2026-01-02', value: 110 }];
  const rebased = rebaseBenchmark(fund, levels, 0);

  assert.equal(rebased[0], 10);
  assert.ok(Math.abs(rebased[3] - 11) < 1e-9);
  assert.equal(rebased[9], null);
  assert.equal(rebased[10], null);
});

test('an index with no level near the range start draws nothing', () => {
  const fund = dailyPoints('2026-03-01', [10, 11]);
  const levels = [{ date: '2026-03-15', value: 100 }];

  assert.deepEqual(rebaseBenchmark(fund, levels, 0), [null, null]);
});

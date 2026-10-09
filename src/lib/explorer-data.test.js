import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSummaries, encodeSummaries } from './explorer-data.js';

const returns = { return_1m: 0.0123, return_3m: -0.0456, return_6m: null, return_ytd: 0.0789, return_1y: 0.1234, return_3y: 0.3456, return_5y: null, cagr_3y: 0.0987, cagr_5y: null };

const fund = {
  id: 'RD1',
  name: 'Alpha Saham',
  names: ['Alpha Saham', 'Si Alpha', 'Alpha Equity'],
  manager: 'Alpha Asset Management',
  type: 'Saham',
  currency: 'IDR',
  sharia: true,
  etf: false,
  index: false,
  bibit: true,
  makmur: false,
  nav: 1234.5678,
  nav_date: '2026-10-09',
  aum: 553300000000,
  aum_currency: 'IDR',
  aum_date: '2026-09-01',
  ...returns,
  drawdown_1y: -0.0548,
  drawdown_3y: -0.1234,
  spark: [0, 50, 100, 7],
  total: { ...returns, return_1y: 0.2, spark: [100, 0, 20, 40] },
  expense_ratio: 0.0183,
  expense_source: 'bibit',
  min_purchase: 10000,
  fee_subscription: 0.02,
  fee_redemption: null,
  launch_date: '1999-12-31',
  history_start: '2010-03-05',
  large_move: false,
  dividends: true,
  active: true,
};

const bare = {
  ...Object.fromEntries(Object.keys(fund).map((key) => [key, null])),
  id: 'RD2',
  name: 'Beta Kas',
  names: ['Beta Kas'],
  sharia: null,
  etf: false,
  index: false,
  bibit: false,
  makmur: false,
  large_move: false,
  dividends: false,
  active: false,
};

const summaries = { date: '2026-10-09', usd_to_idr: 16000, funds: [fund, bare, { ...fund, id: 'RD3', currency: 'USD', aum_currency: 'USD' }] };

test('decoding gives back what was encoded, at the precision the explorer shows', () => {
  const decoded = decodeSummaries(JSON.parse(JSON.stringify(encodeSummaries(summaries))));
  const [first] = decoded.funds;

  assert.equal(decoded.date, '2026-10-09');
  assert.equal(decoded.usd_to_idr, 16000);
  assert.equal(first.id, 'RD1');
  assert.deepEqual(first.names, fund.names);
  assert.equal(first.manager, fund.manager);
  assert.equal(first.type, 'Saham');
  assert.equal(first.nav, fund.nav);
  assert.equal(first.aum, fund.aum);
  assert.equal(first.nav_date, '2026-10-09');
  assert.equal(first.aum_date, '2026-09-01');
  assert.equal(first.launch_date, '1999-12-31');
  assert.equal(first.history_start, '2010-03-05');
  assert.equal(first.return_1y, 0.123);
  assert.equal(first.return_3m, -0.046);
  assert.equal(first.return_6m, null);
  assert.equal(first.drawdown_3y, -0.123);
  assert.equal(first.expense_ratio, 0.0183);
  assert.equal(first.fee_subscription, 0.02);
  assert.equal(first.fee_redemption, null);
  assert.equal(first.expense_source, 'bibit');
  assert.equal(first.min_purchase, 10000);
  assert.equal(first.sharia, true);
  assert.equal(first.dividends, true);
  assert.equal(first.active, true);
  assert.equal(first.total.return_1y, 0.2);
  assert.equal(first.total.return_6m, null);
});

test('a fund without values keeps its nulls and yes/no fields', () => {
  const [, decoded] = decodeSummaries(encodeSummaries(summaries)).funds;

  assert.equal(decoded.names.length, 1);
  assert.equal(decoded.manager, null);
  assert.equal(decoded.nav, null);
  assert.equal(decoded.nav_date, null);
  assert.equal(decoded.spark, null);
  assert.equal(decoded.total, null);
  assert.equal(decoded.sharia, null);
  assert.equal(decoded.active, false);
});

test('a sparkline keeps its shape within one step of 36', () => {
  const [decoded] = decodeSummaries(encodeSummaries(summaries)).funds;

  assert.equal(decoded.spark.length, fund.spark.length);

  decoded.spark.forEach((value, index) => {
    assert.ok(Math.abs(value - fund.spark[index]) <= 2, `${value} vs ${fund.spark[index]}`);
  });

  assert.equal(decoded.spark[0], 0);
  assert.equal(decoded.spark[2], 100);
});

test('repeated names are stored once', () => {
  const compact = encodeSummaries(summaries);

  assert.deepEqual(compact.dictionaries.manager, ['Alpha Asset Management']);
  assert.deepEqual(compact.dictionaries.currency, ['IDR', 'USD']);
});

test('a decoded fund is encoded to the same row again', () => {
  const compact = JSON.parse(JSON.stringify(encodeSummaries(summaries)));

  assert.deepEqual(encodeSummaries(decodeSummaries(compact)).funds, compact.funds);
});

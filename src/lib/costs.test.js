import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCosts, formatFeeRange, parseFeeRange } from './costs.js';

const noProfile = {};
const build = (parts) => buildCosts({ bibit: {}, makmur: undefined, bareksa: noProfile, currency: 'IDR', ...parts });

test('the expense ratio is Bibit when valid, else Makmur, else unknown', () => {
  assert.deepEqual(build({ bibit: { expenseratio: { percentage: 0.0123 } } }).expense_ratio, { value: 0.0123, source: 'bibit' });
  assert.deepEqual(build({ bibit: { expenseratio: { percentage: 4343.1 } }, makmur: { expenseRatio: 206 } }).expense_ratio, { value: 0.0206, source: 'makmur' });
  assert.deepEqual(build({ bibit: { expenseratio: { percentage: null } }, makmur: { expenseRatio: 150 } }).expense_ratio, { value: 0.015, source: 'makmur' });
  assert.equal(build({ bibit: { expenseratio: { percentage: 0 } }, makmur: { expenseRatio: 0 } }).expense_ratio, null);
  assert.equal(build({ bibit: { expenseratio: { percentage: 4343.1 } }, makmur: { expenseRatio: 100000 } }).expense_ratio, null);
  assert.equal(build({}).expense_ratio, null);
});

test('the minimum purchase is listed per distributor, and Bibit counts only when the fund is buyable there', () => {
  const costs = build({ bibit: { tradeable: 1, minbuy: 10000 }, makmur: { minFirstBuy: 100000 }, bareksa: { min_purchase: '250000' } });

  assert.deepEqual(costs.min_purchase, [
    { amount: 10000, source: 'bibit' },
    { amount: 100000, source: 'makmur' },
    { amount: 250000, source: 'bareksa' },
  ]);
  assert.deepEqual(build({ bibit: { tradeable: 0, minbuy: 10000 } }).min_purchase, []);
  assert.deepEqual(build({ bibit: { tradeable: 1, minbuy: 0 }, bareksa: { min_purchase: '' } }).min_purchase, []);
});

test('the next purchase and the redemption minimum come from Bareksa', () => {
  const costs = build({ bareksa: { min_topup: '10000', min_redemption: '50000' } });

  assert.deepEqual(costs.min_topup, { amount: 10000, source: 'bareksa' });
  assert.deepEqual(costs.min_redemption, { amount: 50000, source: 'bareksa' });
  assert.equal(build({}).min_topup, null);
});

test('a fee range parses from the Bareksa notation, and empty is unknown', () => {
  assert.deepEqual(parseFeeRange('-0.02'), { min: null, max: 0.02, source: 'bareksa' });
  assert.deepEqual(parseFeeRange('0.005-0.03'), { min: 0.005, max: 0.03, source: 'bareksa' });
  assert.deepEqual(parseFeeRange('0'), { min: 0, max: 0, source: 'bareksa' });
  assert.equal(parseFeeRange(''), null);
  assert.equal(parseFeeRange(null), null);
  assert.equal(parseFeeRange('-'), null);
  assert.equal(parseFeeRange('abc'), null);
});

test('Bibit fee placeholders are ignored', () => {
  const costs = build({ bibit: { fee: { subscription: { value: 0, type: 'percent' } } } });

  assert.deepEqual(costs.max_fees, { subscription: null, redemption: null, switch: null });
});

test('the custodian is Bareksa, else Bibit', () => {
  const bibit = { custodian_bank: { name: 'BANK X' } };

  assert.deepEqual(build({ bibit, bareksa: { custodian: 'PT Bank Y' } }).custodian, { name: 'PT Bank Y', source: 'bareksa' });
  assert.deepEqual(build({ bibit }).custodian, { name: 'BANK X', source: 'bibit' });
  assert.equal(build({}).custodian, null);
});

test('a fee range reads as text', () => {
  const words = { free: 'Free', upTo: (value) => `Up to ${value}`, from: (value) => `From ${value}` };

  assert.equal(formatFeeRange({ min: null, max: 0.02 }, 'en', words), 'Up to 2%');
  assert.equal(formatFeeRange({ min: 0.005, max: 0.03 }, 'id', words), '0,5–3%');
  assert.equal(formatFeeRange({ min: 0.005, max: 0.03 }, 'en', words), '0.5–3%');
  assert.equal(formatFeeRange({ min: 0.01, max: null }, 'en', words), 'From 1%');
  assert.equal(formatFeeRange({ min: 0.01, max: 0.01 }, 'en', words), '1%');
  assert.equal(formatFeeRange({ min: 0, max: 0 }, 'en', words), 'Free');
});

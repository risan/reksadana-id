import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatChange, formatCompact, formatCount, formatDate, formatMoney, formatMonth, formatNav, formatNumber, formatPercent, formatShortDate } from './format.js';

test('numbers use the decimal and thousands separators of the page language', () => {
  assert.equal(formatNumber(1234.5, 'id'), '1.234,5');
  assert.equal(formatNumber(1234.5, 'en'), '1,234.5');
  assert.equal(formatCount(3045, 'id'), '3.045');
  assert.equal(formatCount(3045, 'en'), '3,045');
});

test('NAV keeps four decimals under 100 and two above', () => {
  assert.equal(formatNav(1.5, 'id'), '1,5000');
  assert.equal(formatNav(2587.7419, 'id'), '2.587,74');
  assert.equal(formatNav(2587.7419, 'en'), '2,587.74');
});

test('a change shows its sign, and a rounded zero shows none', () => {
  assert.equal(formatChange(0.0106, 'id'), '+1,06%');
  assert.equal(formatChange(0.0106, 'en'), '+1.06%');
  assert.equal(formatChange(-0.0106, 'en'), '−1.06%');
  assert.equal(formatChange(-0.000001, 'en'), '0.00%');
  assert.equal(formatPercent(-0.2, 'id', 1), '−20,0%');
  assert.equal(formatChange(null, 'id'), '—');
});

test('a small non-zero percentage keeps two decimals and never shows a minus on zero', () => {
  assert.equal(formatChange(0.0002, 'en', 1), '+0.02%');
  assert.equal(formatChange(-0.0002, 'id', 1), '−0,02%');
  assert.equal(formatPercent(0.0003, 'en', 1), '0.03%');
  assert.equal(formatPercent(-0.0003, 'en', 0), '−0.03%');
  assert.equal(formatChange(0.0006, 'en', 1), '+0.1%');
  assert.equal(formatChange(0, 'en', 1), '0.0%');
  assert.equal(formatChange(-0, 'en', 1), '0.0%');
  assert.equal(formatPercent(-0.0000001, 'en', 1), '0.00%');
  assert.equal(formatChange(-0.0000001, 'en', 1), '0.00%');
});

test('compact amounts use the short words of each language', () => {
  assert.equal(formatCompact(194240467107.88, 'id'), '194,2\u00a0M');
  assert.equal(formatCompact(194240467107.88, 'en'), '194.2B');
  assert.equal(formatMoney(1234567, 'id', 'IDR'), 'Rp 1,2\u00a0jt');
  assert.equal(formatMoney(1234567, 'en', null), '1.2M');
  assert.equal(formatMoney(1234567, 'en'), '1.2M');
  assert.equal(formatMoney(1234567, 'en', 'USD'), 'US$ 1.2M');
});

test('dates put the day first, with the month abbreviation of each language', () => {
  assert.equal(formatDate('2026-10-02', 'id'), '2 Okt 2026');
  assert.equal(formatDate('2026-10-02', 'en'), '2 Oct 2026');
  assert.equal(formatDate('2026-05-09', 'id'), '9 Mei 2026');
  assert.equal(formatDate('2026-09-09', 'en'), '9 Sep 2026');
  assert.equal(formatMonth('2026-08-01', 'id'), 'Agu 2026');
  assert.equal(formatMonth('2026-08-01', 'en'), 'Aug 2026');
  assert.equal(formatDate(null, 'en'), '—');
});

test('a short date drops the year only in the reference year', () => {
  assert.equal(formatShortDate('2026-10-01', '2026-10-02', 'id'), '1 Okt');
  assert.equal(formatShortDate('2025-12-31', '2026-10-02', 'en'), 'Dec 2025');
});

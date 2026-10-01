import assert from 'node:assert/strict';
import test from 'node:test';
import { matchBibitSymbols } from './lib.js';

const bibitRows = [['RD1', 'Alpha Fund', '', 'AAA Asset Management, PT']];

const matchOne = (fund, rows = bibitRows, aliases = {}) => matchBibitSymbols('source', [[1, fund]], rows, aliases).get(1);

test('a manager that only contains the other manager does not match', () => {
  const funds = [[1, { name: 'Reksa Dana Alpha Fund', manager: 'PT. AAA Asset Management Capital' }]];

  assert.equal(matchBibitSymbols('source', funds, bibitRows, {}).size, 0);
});

test('managers match when only punctuation and the pt token differ', () => {
  assert.equal(matchOne({ name: 'Reksa Dana Alpha Fund', manager: 'PT. AAA Asset Management' }), 'RD1');
});

test('a fund with an unknown manager does not match', () => {
  assert.equal(matchOne({ name: 'Alpha Fund', manager: '' }), undefined);
});

test('a fund with the same name from a different manager does not match', () => {
  assert.equal(matchOne({ name: 'Alpha Fund', manager: 'PT BBB Asset Management' }), undefined);
});

test('a trailing Kelas A is dropped when the full name finds nothing', () => {
  assert.equal(matchOne({ name: 'Alpha Fund Kelas A', manager: 'PT AAA Asset Management' }), 'RD1');
});

test('Kelas B is a different fund and never matches the fund without a class', () => {
  assert.equal(matchOne({ name: 'Alpha Fund Kelas B', manager: 'PT AAA Asset Management' }), undefined);
});

test('Kelas A does not match a Bibit fund of another class', () => {
  const rows = [['RD2', 'Alpha Fund Kelas B', '', 'AAA Asset Management, PT']];

  assert.equal(matchOne({ name: 'Alpha Fund Kelas A', manager: 'PT AAA Asset Management' }, rows), undefined);
});

test('Kelas A with another manager does not match', () => {
  assert.equal(matchOne({ name: 'Alpha Fund Kelas A', manager: 'PT BBB Asset Management' }), undefined);
});

test('Kelas A is not dropped when the source also lists the fund without a class', () => {
  const funds = [
    [1, { name: 'Alpha Fund', manager: 'PT AAA Asset Management' }],
    [2, { name: 'Alpha Fund Kelas A', manager: 'PT AAA Asset Management' }],
  ];
  const symbolsById = matchBibitSymbols('source', funds, bibitRows, {});

  assert.equal(symbolsById.get(1), 'RD1');
  assert.equal(symbolsById.has(2), false);
});

test('of several Bibit funds with one name, the one with the same manager is used', () => {
  const rows = [
    ['RD1', 'Alpha Fund', '', 'AAA Asset Management, PT'],
    ['RD2', 'Alpha Fund', '', ''],
    ['RD3', 'Alpha Fund', '', 'CCC Asset Management, PT'],
  ];

  assert.equal(matchOne({ name: 'Alpha Fund', manager: 'PT AAA Asset Management' }, rows), 'RD1');
});

test('two Bibit funds with the same name and the same manager stay unmatched', () => {
  const rows = [
    ['RD1', 'Alpha Fund', '', 'AAA Asset Management, PT'],
    ['RD2', 'Alpha Fund', '', 'PT AAA Asset Management'],
  ];

  assert.equal(matchOne({ name: 'Alpha Fund', manager: 'PT AAA Asset Management' }, rows), undefined);
});

test('a renamed manager matches, and a similar name does not', () => {
  const rows = [['RD9', 'Star Balanced', '', 'Surya Timur Alam Raya, PT']];

  assert.equal(matchOne({ name: 'STAR Balanced', manager: 'PT STAR Asset Management' }, rows), 'RD9');
  assert.equal(matchOne({ name: 'STAR Balanced', manager: 'PT Surya Timur Capital' }, rows), undefined);
});

test('an alias decides before the names are compared', () => {
  const rows = [...bibitRows, ['RD7', 'Totally Different Name', '', 'AAA Asset Management, PT']];

  assert.equal(matchOne({ name: 'Alpha Fund', manager: 'PT AAA Asset Management' }, rows, { 'source:1': 'RD7' }), 'RD7');
});

test('an alias to a fund Bibit does not list is ignored, and an alias of null blocks the match', () => {
  const fund = { name: 'Alpha Fund', manager: 'PT AAA Asset Management' };

  assert.equal(matchOne(fund, bibitRows, { 'source:1': 'RD404' }), undefined);
  assert.equal(matchOne(fund, bibitRows, { 'source:1': null }), undefined);
  assert.equal(matchOne(fund, bibitRows, { 'other:1': 'RD404' }), 'RD1');
});

test('Kelas A is not dropped when a Bibit fund has the full name with another manager', () => {
  const rows = [
    ['RD1', 'Alpha Fund', '', 'AAA Asset Management, PT'],
    ['RD2', 'Alpha Fund Kelas A', '', 'BBB Asset Management, PT'],
  ];

  assert.equal(matchOne({ name: 'Alpha Fund Kelas A', manager: 'PT AAA Asset Management' }, rows), undefined);
});

test('Kelas A is not dropped when two Bibit funds have the name without it', () => {
  const rows = [
    ['RD1', 'Alpha Fund', '', 'AAA Asset Management, PT'],
    ['RD2', 'Alpha Fund', '', ''],
  ];

  assert.equal(matchOne({ name: 'Alpha Fund Kelas A', manager: 'PT AAA Asset Management' }, rows), undefined);
});

test('a fund without a manager does not match and does not throw', () => {
  assert.equal(matchOne({ name: 'Alpha Fund', manager: undefined }), undefined);
  assert.equal(matchOne({ name: 'Alpha Fund Kelas A', manager: null }), undefined);
});

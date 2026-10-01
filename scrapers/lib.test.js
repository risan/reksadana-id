import assert from 'node:assert/strict';
import test from 'node:test';
import { matchBibitSymbols } from './lib.js';

const bibitRows = [['RD1', 'Alpha Fund', '', 'AAA Asset Management, PT']];

test('a manager that only contains the other manager does not match', () => {
  const funds = [[1, { name: 'Reksa Dana Alpha Fund', manager: 'PT. AAA Asset Management Capital' }]];

  assert.equal(matchBibitSymbols(funds, bibitRows).size, 0);
});

test('managers match when only punctuation and the pt token differ', () => {
  const funds = [[1, { name: 'Reksa Dana Alpha Fund', manager: 'PT. AAA Asset Management' }]];

  assert.equal(matchBibitSymbols(funds, bibitRows).get(1), 'RD1');
});

test('a fund with an unknown manager does not match', () => {
  const funds = [[1, { name: 'Alpha Fund', manager: '' }]];

  assert.equal(matchBibitSymbols(funds, bibitRows).size, 0);
});

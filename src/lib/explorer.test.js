import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STATE, explorerTypeKey, parseSortKey, parseState, sortFunds } from './explorer.js';

const funds = [
  { id: 'A', aum_idr: 10, return_1y: 0.1 },
  { id: 'B', aum_idr: 30, return_1y: 0.3 },
  { id: 'C', aum_idr: 20, return_1y: 0.2 },
];

test('a sort key the table does not have falls back to the default sort', () => {
  assert.equal(parseSortKey('foo'), DEFAULT_STATE.sort);
  assert.equal(parseSortKey(null), DEFAULT_STATE.sort);
  assert.equal(parseSortKey('return_1y'), 'return_1y');
});

test('sorting by an unknown key gives the same order as the default sort, whatever the input order', () => {
  const byDefault = sortFunds(funds, DEFAULT_STATE.sort, -1).map((fund) => fund.id);

  assert.deepEqual(byDefault, ['B', 'C', 'A']);
  assert.deepEqual(sortFunds(funds, 'foo', -1).map((fund) => fund.id), byDefault);
  assert.deepEqual(sortFunds([...funds].reverse(), 'foo', -1).map((fund) => fund.id), byDefault);
});

test('funds without a value sort last in either direction', () => {
  const withMissing = [...funds, { id: 'D', aum_idr: null, return_1y: null }];

  assert.equal(sortFunds(withMissing, 'return_1y', 1).at(-1).id, 'D');
  assert.equal(sortFunds(withMissing, 'return_1y', -1).at(-1).id, 'D');
});

test('a type link for a Bibit-only label opens the filter for the other types, and one for a main type its own', () => {
  assert.equal(explorerTypeKey('Saham'), 'Saham');
  assert.equal(explorerTypeKey('Benchmark'), 'other');
  assert.equal(explorerTypeKey('Penyertaan Terbatas'), 'other');
  assert.equal(parseState(`?type=${explorerTypeKey('Dana Investasi Real Estate')}`).type, 'other');
});

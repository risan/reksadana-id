import assert from 'node:assert/strict';
import test from 'node:test';
import { typeName } from './fund-types.js';

test('Bibit\'s Benchmark label is shown as gold ETFs in both languages, other labels as before', () => {
  assert.equal(typeName('Benchmark', 'id'), 'ETF Emas');
  assert.equal(typeName('Benchmark', 'en'), 'Gold ETFs');
  assert.equal(typeName('Saham', 'id'), 'Saham');
  assert.equal(typeName('Saham', 'en'), 'Equity');
  assert.equal(typeName('Something New', 'en'), 'Something New');
});

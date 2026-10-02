import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRedirects } from './write-redirects.js';

test('a retired ID redirects its page, with and without the slash, and its JSON', () => {
  assert.deepEqual(buildRedirects([{ id: 'RD1352', current_id: 'RD1983' }]), [
    '/funds/RD1352 /funds/RD1983/ 301',
    '/funds/RD1352/ /funds/RD1983/ 301',
    '/api/funds/RD1352.json /api/funds/RD1983.json 301',
  ]);
});

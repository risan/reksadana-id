import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRedirects } from './write-redirects.js';

test('a retired ID redirects its page in both languages, with and without the slash, and its JSON', () => {
  assert.deepEqual(buildRedirects([{ id: 'RD1352', current_id: 'RD1983' }]), [
    '/funds/RD1352 /funds/RD1983/ 301',
    '/funds/RD1352/ /funds/RD1983/ 301',
    '/en/funds/RD1352 /en/funds/RD1983/ 301',
    '/en/funds/RD1352/ /en/funds/RD1983/ 301',
    '/api/funds/RD1352.json /api/funds/RD1983.json 301',
  ]);
});

test('an ID with no current fund sends its page to the explorer searched by its old name, and has no JSON redirect', () => {
  assert.deepEqual(buildRedirects([{ id: 'KTN14438', current_id: '', name: 'Syariah CIMB Principal Islamic Asia Pacific Equity Syariah (USD)' }]), [
    '/funds/KTN14438 /?q=Syariah%20CIMB%20Principal%20Islamic%20Asia%20Pacific%20Equity%20Syariah%20USD 302',
    '/funds/KTN14438/ /?q=Syariah%20CIMB%20Principal%20Islamic%20Asia%20Pacific%20Equity%20Syariah%20USD 302',
    '/en/funds/KTN14438 /en/?q=Syariah%20CIMB%20Principal%20Islamic%20Asia%20Pacific%20Equity%20Syariah%20USD 302',
    '/en/funds/KTN14438/ /en/?q=Syariah%20CIMB%20Principal%20Islamic%20Asia%20Pacific%20Equity%20Syariah%20USD 302',
  ]);
});

test('punctuation in the old name is left out of the search, so it cannot end the query or match nothing', () => {
  assert.match(buildRedirects([{ id: 'KTN1', current_id: '', name: 'Bahana Likuid Dollar (US$) A&B?' }])[0], /\?q=Bahana%20Likuid%20Dollar%20US%20A%20B 302$/);
});

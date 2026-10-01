import assert from 'node:assert/strict';
import test from 'node:test';
import { keepFundsOfFailedPages, parseFundPage, toIsoDate } from './makmur.js';

const pageWith = (pageProps) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script></html>`;

test('the fund and its route category come from the embedded page data', () => {
  const html = pageWith({ routeCategory: 'saham', data: { _id: 'abc', name: 'Alpha Fund', url: 'alpha-fund-abc', lastPrice: 156 } });

  assert.deepEqual(parseFundPage(html), { _id: 'abc', name: 'Alpha Fund', url: 'alpha-fund-abc', lastPrice: 156, routeCategory: 'saham' });
});

test('a page without the embedded data is an error', () => {
  assert.throws(() => parseFundPage('<html>Maintenance</html>'), /no __NEXT_DATA__/);
});

test('a page whose data has no fund is an error', () => {
  assert.throws(() => parseFundPage(pageWith({ routeCategory: 'saham', data: null })), /no fund data/);
});

test('dates like 20260930 become ISO dates, and anything else becomes empty', () => {
  assert.equal(toIsoDate(20260930), '2026-09-30');
  assert.equal(toIsoDate(null), '');
});

test('a page with a name that is not text is an error, and a page without a manager is kept', () => {
  assert.throws(() => parseFundPage(pageWith({ routeCategory: 'saham', data: { _id: 'abc', name: 5, url: 'alpha-abc' } })), /no fund data/);
  assert.equal(parseFundPage(pageWith({ routeCategory: 'saham', data: { _id: 'abc', name: 'Alpha', url: 'alpha-abc' } })).name, 'Alpha');
});

test('stored funds leave the index unless their page failed this run', () => {
  const stored = new Map([
    ['a', ['a', 'Alpha', '', '', 'saham', 'alpha-aaa']],
    ['b', ['b', 'Beta', '', '', 'saham', 'beta-bbb']],
    ['c', ['c', 'Gamma', '', '', 'saham', 'gamma-ccc']],
  ]);
  const refreshed = new Map([['a', ['a', 'Alpha new', '', '', 'saham', 'alpha-aaa']]]);
  const rows = keepFundsOfFailedPages(refreshed, stored, ['https://www.makmur.id/reksadana/saham/beta-bbb']);

  assert.deepEqual([...rows.keys()].sort(), ['a', 'b']);
  assert.equal(rows.get('a')[1], 'Alpha new');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { rejectionFor, syncStartDate } from './bareksa-nav-sync.js';

const HOST = '127.0.0.1:8787';
const save = (headers) => ({ method: 'POST', url: '/save', headers: { host: HOST, origin: `http://${HOST}`, 'content-type': 'application/json', ...headers } });

test('a save from the receiver page, as JSON, is accepted', () => {
  assert.equal(rejectionFor(save({})), null);
});

test('a save from another site, or as text/plain, which needs no permission from the browser, is refused', () => {
  assert.equal(rejectionFor(save({ origin: 'https://evil.example', 'content-type': 'text/plain' })), 'Wrong origin');
  assert.equal(rejectionFor(save({ origin: 'https://evil.example' })), 'Wrong origin');
  assert.equal(rejectionFor(save({ origin: undefined })), 'Wrong origin');
  assert.equal(rejectionFor(save({ 'content-type': 'text/plain' })), 'Body must be JSON');
  assert.equal(rejectionFor(save({ 'content-type': undefined })), 'Body must be JSON');
});

test('a request under another host name, as in DNS rebinding, is refused, including the page and the fund list', () => {
  assert.equal(rejectionFor(save({ host: 'evil.example:8787' })), 'Wrong host');
  assert.equal(rejectionFor({ method: 'GET', url: '/funds', headers: { host: 'localhost:8787' } }), 'Wrong host');
  assert.equal(rejectionFor({ method: 'GET', url: '/', headers: {} }), 'Wrong host');
});

test('the receiver page and the fund list load from the receiver itself without an Origin header', () => {
  assert.equal(rejectionFor({ method: 'GET', url: '/', headers: { host: HOST } }), null);
  assert.equal(rejectionFor({ method: 'GET', url: '/funds', headers: { host: HOST } }), null);
});

test('a fund is asked from 30 days before its last row, or for its full history when that is missing or starts after launch', () => {
  const rows = [['2020-01-02', '1000'], ['2026-10-09', '1500']];

  assert.equal(syncStartDate(rows, '2020-01-01'), '2026-09-09');
  assert.equal(syncStartDate(rows, ''), '2026-09-09');
  assert.equal(syncStartDate([], '2020-01-01'), null);
  assert.equal(syncStartDate([['2025-10-09', '1400'], ['2026-10-09', '1500']], '2015-03-01'), null);
});

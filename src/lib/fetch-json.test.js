import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchFundRecord, getJson } from './fetch-json.js';

const CURRENT_RECORD = { fund: { id: 'RD1' }, costs: {} };

test('getJson gives null for a failed request, an error status, and a body that is not JSON', async (t) => {
  const answers = [() => Promise.reject(new TypeError('offline')), () => new Response('x', { status: 500 }), () => new Response('<html>')];

  t.mock.method(globalThis, 'fetch', async () => answers.shift()());

  assert.equal(await getJson('/a.json'), null);
  assert.equal(await getJson('/b.json'), null);
  assert.equal(await getJson('/c.json'), null);
});

test('a fund record cached from before a deploy is fetched again, bypassing the cache', async (t) => {
  const answers = [Response.json({ nav: [] }), Response.json(CURRENT_RECORD)];
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => answers.shift());

  assert.deepEqual(await fetchFundRecord('RD1'), CURRENT_RECORD);
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.deepEqual(fetchMock.mock.calls[1].arguments[1], { cache: 'reload' });
});

test('a fund record that never loads, or never has the current shape, is null', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Not found', { status: 404 }));

  assert.equal(await fetchFundRecord('NOPE'), null);

  t.mock.method(globalThis, 'fetch', async () => Response.json({ nav: [] }));

  assert.equal(await fetchFundRecord('OLD'), null);
});

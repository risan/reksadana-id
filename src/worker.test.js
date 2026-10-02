import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './worker.js';

const NAV_POINTS = [
  { date: '2026-09-30', value: 2587.2821, source: 'bareksa' },
  { date: '2026-10-01', value: 2587.7419, source: 'bibit' },
];

const ASSETS = {
  '/api/funds/RD1983.json': { history: { nav: NAV_POINTS, aum: [] } },
  '/api/funds/BRK9.json': { history: { nav: [], aum: [{ date: '2026-09-01', value: 5000, source: 'bareksa' }] } },
  '/fund-ids.json': { RD1352: 'RD1983', GONE: 'MISSING' },
};

const fakeAssets = (files, status = 200) => ({
  fetch: async (url) => {
    const file = files[new URL(url.url ?? url).pathname];

    if (!file) {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/html' } });
    }

    return Response.json(file, { status });
  },
});

const call = (path, { method = 'GET', files = ASSETS, headers = {}, country } = {}) => {
  const request = new Request(`https://example.test${path}`, { method, headers });

  if (country) {
    Object.defineProperty(request, 'cf', { value: { country } });
  }

  return worker.fetch(request, { ASSETS: fakeAssets(files) });
};

const HOME_ASSETS = { ...ASSETS, '/': { home: 'id' } };

test('serves a fund NAV history as CSV with the source of each point', async () => {
  const response = await call('/csv/nav/RD1983.csv');

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/csv; charset=utf-8');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600');
  assert.equal(await response.text(), 'date,nav,source\n2026-09-30,2587.2821,bareksa\n2026-10-01,2587.7419,bibit\n');
});

test('serves an AUM history', async () => {
  const response = await call('/csv/aum/BRK9.csv');

  assert.equal(await response.text(), 'date,aum,source\n2026-09-01,5000,bareksa\n');
});

test('a retired ID serves the CSV of the fund that replaced it', async () => {
  const response = await call('/csv/nav/RD1352.csv');

  assert.equal(response.status, 200);
  assert.match(await response.text(), /^date,nav,source\n2026-09-30,/);
});

test('an unknown fund, a retired ID without a record, and an empty history are 404 text', async () => {
  for (const path of ['/csv/nav/NOPE.csv', '/csv/nav/GONE.csv', '/csv/aum/RD1983.csv', '/csv/nav/BRK9.csv']) {
    const response = await call(path);

    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8', path);
  }
});

test('paths that are not a fund CSV are 404', async () => {
  for (const path of ['/csv/nav/..%2Fsecret.csv', '/csv/nav/RD1983.txt', '/csv/nav/a/b.csv', '/csv/other/RD1983.csv']) {
    assert.equal((await call(path)).status, 404, path);
  }
});

test('HEAD sends the headers without a body, and other methods are refused', async () => {
  const head = await call('/csv/nav/RD1983.csv', { method: 'HEAD' });

  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Type'), 'text/csv; charset=utf-8');
  assert.equal(await head.text(), '');

  const post = await call('/csv/nav/RD1983.csv', { method: 'POST' });

  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD');
});

test('an unusable asset answer is a 502, not a 404', async () => {
  const response = await worker.fetch(new Request('https://example.test/csv/nav/RD1983.csv'), {
    ASSETS: { fetch: async () => new Response('boom', { status: 500 }) },
  });

  assert.equal(response.status, 502);
});

test('a visitor from outside Indonesia is sent to the English home page, keeping the query', async () => {
  const response = await call('/?type=Saham', { files: HOME_ASSETS, country: 'US' });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), '/en/?type=Saham');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Vary'), 'Cookie');
});

test('a visitor from Indonesia, or from an unknown country, gets the Indonesian home page', async () => {
  for (const country of ['ID', undefined]) {
    const response = await call('/', { files: HOME_ASSETS, country });

    assert.equal(response.status, 200, String(country));
    assert.deepEqual(await response.json(), { home: 'id' });
    assert.equal(response.headers.get('Vary'), 'Cookie');
  }
});

test('the language cookie beats the country', async () => {
  const english = await call('/', { files: HOME_ASSETS, country: 'ID', headers: { Cookie: 'a=1; lang=en' } });
  const indonesian = await call('/', { files: HOME_ASSETS, country: 'US', headers: { Cookie: 'lang=id' } });

  assert.equal(english.status, 302);
  assert.equal(english.headers.get('Location'), '/en/');
  assert.equal(indonesian.status, 200);
});

test('a cookie with any other language is ignored', async () => {
  const response = await call('/', { files: HOME_ASSETS, country: 'US', headers: { Cookie: 'lang=fr' } });

  assert.equal(response.status, 302);
});

test('crawlers always get the Indonesian home page', async () => {
  for (const userAgent of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Bingbot', 'facebookexternalhit/1.1']) {
    const response = await call('/', { files: HOME_ASSETS, country: 'US', headers: { 'User-Agent': userAgent } });

    assert.equal(response.status, 200, userAgent);
  }
});

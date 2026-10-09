import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError, createTextFetcher, matchBibitSymbols, mergeRowsByDate, reportFailures, stopAfterForbidden, withRetries } from './lib.js';

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

const forbidden = () => new HttpError('https://example.test', 403, 'Forbidden');

test('stopAfterForbidden stops taking work after the limit of 403s in a row', async () => {
  const attempted = [];
  const { worker, hasStopped } = stopAfterForbidden(async (item) => {
    attempted.push(item);

    throw forbidden();
  }, 3);

  for (const item of [1, 2, 3, 4, 5]) {
    await worker(item).catch(() => {});
  }

  assert.deepEqual(attempted, [1, 2, 3]);
  assert.equal(hasStopped(), true);
});

test('stopAfterForbidden starts counting again after a success or another error', async () => {
  const outcomes = [forbidden(), forbidden(), null, forbidden(), new Error('timeout'), forbidden(), forbidden()];
  const { worker, hasStopped } = stopAfterForbidden(async (index) => {
    if (outcomes[index]) {
      throw outcomes[index];
    }
  }, 3);

  for (const index of outcomes.keys()) {
    await worker(index).catch(() => {});
  }

  assert.equal(hasStopped(), false);
});

test('a text fetcher gives the body, counts requests, and throws HttpError without retrying a 403', async (t) => {
  const responses = [new Response('hello'), new Response('no', { status: 403, statusText: 'Forbidden' })];
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => responses.shift());
  const { fetchText, getRequestCount } = createTextFetcher({ headers: { Accept: 'text/html' }, timeoutMs: 1000, delayMs: 0 });

  assert.equal(await fetchText('https://example.test/a'), 'hello');
  await assert.rejects(fetchText('https://example.test/b'), (error) => error instanceof HttpError && error.status === 403);
  assert.equal(getRequestCount(), 2);
  assert.deepEqual(fetchMock.mock.calls[0].arguments[1].headers, { Accept: 'text/html' });
});

const withLoggedOutput = (t) => {
  const logged = { log: [], error: [] };

  t.mock.method(console, 'log', (message) => logged.log.push(message));
  t.mock.method(console, 'error', (message) => logged.error.push(message));
  t.after(() => {
    process.exitCode = undefined;
  });

  return logged;
};

test('a few failures only warn, and the run stays green', (t) => {
  const logged = withLoggedOutput(t);

  reportFailures(['Fund 1: boom', 'Fund 2: boom'], 100);

  assert.equal(process.exitCode, undefined);
  assert.match(logged.log[0], /^::warning::2 of 100 funds failed/);
  assert.match(logged.log[1], /Fund 1: boom\nFund 2: boom/);
  assert.deepEqual(logged.error, []);
});

test('more than 5% failures fail the run', (t) => {
  const logged = withLoggedOutput(t);

  reportFailures(Array.from({ length: 6 }, (_, index) => `Fund ${index}: boom`), 100);

  assert.equal(process.exitCode, 1);
  assert.match(logged.error[0], /^6 of 100 funds failed:/);
});

test('exactly 5% failures still only warn, and no failures print nothing', (t) => {
  const logged = withLoggedOutput(t);

  reportFailures(Array.from({ length: 5 }, (_, index) => `Fund ${index}: boom`), 100);
  reportFailures([], 100);

  assert.equal(process.exitCode, undefined);
  assert.equal(logged.log.length, 2);
});

test('a new row replaces the stored row of its date, keeps older rows, and never erases a stored value with an empty one', () => {
  const stored = [['2026-01-01', '1', 'x'], ['2026-01-03', '3', 'z']];
  const added = [['2026-01-03', '4', ''], ['2026-01-02', '2', 'y']];

  assert.deepEqual(mergeRowsByDate(stored, added), [['2026-01-01', '1', 'x'], ['2026-01-02', '2', 'y'], ['2026-01-03', '4', 'z']]);
});

test('an error marked as not retryable is thrown at once', async () => {
  let attempts = 0;
  const error = Object.assign(new Error('logged out'), { retryable: false });

  await assert.rejects(withRetries(async () => {
    attempts++;

    throw error;
  }), /logged out/);
  assert.equal(attempts, 1);
});

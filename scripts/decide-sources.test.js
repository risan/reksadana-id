import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const decide = (requestedSource, moment) => {
  const output = execFileSync(path.join(import.meta.dirname, 'decide-sources.sh'), [requestedSource, moment], { encoding: 'utf8' });

  return Object.entries(Object.fromEntries(output.trim().split('\n').map((line) => line.split('='))))
    .filter(([, isOn]) => isOn === 'true')
    .map(([name]) => name);
};

// 2026-10-17 is a Saturday and 2026-10-03 is the first Saturday of October.
test('the cron run on Saturday evening scrapes Makmur and the weekly Kontan', () => {
  assert.deepEqual(decide('', '2026-10-17T22:17:00Z'), ['bibit', 'kontan', 'makmur', 'bareksa_profiles', 'benchmarks', 'macro']);
});

test('a run GitHub starts hours late still belongs to the evening it was scheduled for', () => {
  assert.deepEqual(decide('', '2026-10-18T02:45:00Z'), decide('', '2026-10-17T22:17:00Z'));
  assert.deepEqual(decide('', '2026-10-18T09:59:00Z'), decide('', '2026-10-17T22:17:00Z'));
});

test('the first Saturday of the month runs the full Kontan rescan instead', () => {
  assert.deepEqual(decide('', '2026-10-03T22:17:00Z'), ['bibit', 'kontan_full', 'makmur', 'bareksa_profiles', 'benchmarks', 'macro']);
});

test('a weekday scrapes Bibit, the Bareksa profiles, the benchmarks, and the macro data, plus OJK from the 8th to the 15th', () => {
  assert.deepEqual(decide('', '2026-10-14T22:17:00Z'), ['bibit', 'bareksa_profiles', 'benchmarks', 'macro', 'ojk']);
});

test('the first of the month also scrapes Bareksa, even when the run starts after midnight UTC', () => {
  assert.deepEqual(decide('', '2026-11-01T22:17:00Z'), ['bibit', 'bareksa', 'bareksa_profiles', 'benchmarks', 'macro']);
  assert.deepEqual(decide('', '2026-11-02T02:10:00Z'), ['bibit', 'bareksa', 'bareksa_profiles', 'benchmarks', 'macro']);
});

test('a requested source runs alone', () => {
  assert.deepEqual(decide('kontan', '2026-10-14T22:17:00Z'), ['kontan']);
});

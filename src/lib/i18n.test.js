import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { localizeHref, unlocalizedPath } from './i18n.js';

test('Indonesian links are left as they are', () => {
  assert.equal(localizeHref('/funds/RD1983/', 'id'), '/funds/RD1983/');
});

test('English page links get the prefix, with query and hash kept', () => {
  assert.equal(localizeHref('/', 'en'), '/en/');
  assert.equal(localizeHref('/?type=Saham', 'en'), '/en/?type=Saham');
  assert.equal(localizeHref('/funds/RD1983/', 'en'), '/en/funds/RD1983/');
  assert.equal(localizeHref('/api/#zip', 'en'), '/en/api/#zip');
  assert.equal(localizeHref('/download/', 'en'), '/en/download/');
  assert.equal(localizeHref('/compare/?f=RD1,RD2', 'en'), '/en/compare/?f=RD1,RD2');
});

test('data URLs, external links, and fragments are never prefixed', () => {
  for (const href of ['/api/funds.json', '/api/funds/RD1983.json', '/csv/funds.csv', '/csv/nav/RD1983.csv', '/download/bibit.zip', '/explorer.json', 'https://example.com/', '#zip']) {
    assert.equal(localizeHref(href, 'en'), href);
  }
});

test('the language prefix comes off a path', () => {
  assert.equal(unlocalizedPath('/en/'), '/');
  assert.equal(unlocalizedPath('/en'), '/');
  assert.equal(unlocalizedPath('/en/funds/RD1/'), '/funds/RD1/');
  assert.equal(unlocalizedPath('/funds/RD1/'), '/funds/RD1/');
  assert.equal(unlocalizedPath('/encore/'), '/encore/');
});

test('both languages have the same messages, none of them empty', () => {
  const read = (locale) => JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8'));
  const indonesian = read('id');
  const english = read('en');

  assert.deepEqual(Object.keys(english).sort(), Object.keys(indonesian).sort());

  for (const messages of [indonesian, english]) {
    for (const [key, text] of Object.entries(messages)) {
      assert.ok(typeof text === 'string' && text.trim() !== '', key);
    }
  }
});

test('a message uses the same parameters in both languages', () => {
  const read = (locale) => JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8'));
  const parameters = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  const indonesian = read('id');
  const english = read('en');

  for (const key of Object.keys(indonesian)) {
    assert.deepEqual(parameters(english[key] ?? ''), parameters(indonesian[key]), key);
  }
});

test('every message the code uses exists, and every message is used', () => {
  const sourceDirectory = new URL('../', import.meta.url);
  const files = readdirSync(sourceDirectory, { recursive: true }).filter((file) => /\.(astro|js)$/.test(file) && !file.startsWith('paraglide') && !file.endsWith('.test.js'));
  const used = new Set(files.flatMap((file) => [...readFileSync(new URL(file, sourceDirectory), 'utf8').matchAll(/\bm\.([a-z0-9_]+)\(/g)].map((match) => match[1])));
  const defined = new Set(Object.keys(JSON.parse(readFileSync(new URL('../../messages/id.json', import.meta.url), 'utf8'))));

  assert.deepEqual([...used].filter((key) => !defined.has(key)), []);
  assert.deepEqual([...defined].filter((key) => !used.has(key)), []);
});

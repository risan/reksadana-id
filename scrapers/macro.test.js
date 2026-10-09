import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { findNextPageTarget, parseBiRateRows, parseInflationRows, parseJisdorRows } from './macro.js';
import { readFormFields } from './lib.js';

const readFixture = (name) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

test('JISDOR rows are the sell rate per day, and a day without a rate is skipped', () => {
  assert.deepEqual(parseJisdorRows(readFixture('jisdor.xml')), [
    ['2026-10-09', '17884'],
    ['2026-10-08', '17890.5'],
  ]);
});

test('BI-Rate rows carry the decision date as an ISO date and the rate as a number', () => {
  assert.deepEqual(parseBiRateRows(readFixture('bi-rate.html')), [
    ['2026-09-23', '5.75'],
    ['2026-08-19', '5.75'],
    ['2026-07-22', '5.75'],
    ['2026-06-18', '5.75'],
  ]);
});

test('inflation rows are months, and the placeholder month before the series starts is dropped', () => {
  assert.deepEqual(parseInflationRows(readFixture('inflation.html')), [
    ['2003-01', '8.68'],
    ['2026-08', '3.19'],
    ['2026-07', '2.88'],
  ]);
});

test('the next page is the link with the next number, else the "..." link after the current number', () => {
  const firstWindow = readFixture('bi-rate.html');

  assert.match(findNextPageTarget(firstWindow), /DataPagerBI7DRR\$ctl01\$ctl01$/);
  assert.match(findNextPageTarget(readFixture('inflation.html')), /DataPagerDataInflasi\$ctl01\$ctl05$/);
});

test('the "..." link before the current number goes back, so it is never the next page', () => {
  const lastWindow = '<span class="pagination"><a href="javascript:__doPostBack(&#39;x$DataPager$ctl00$ctl00&#39;,&#39;&#39;)">...</a>&nbsp;<span class="page-link--custom active">15</span></span>';

  assert.equal(findNextPageTarget(lastWindow), null);
});

test('the form fields are the inputs a browser sends, without buttons', () => {
  const fields = readFormFields(readFixture('bi-rate.html'));

  assert.equal(fields.get('__VIEWSTATE'), 'abc+123');
  assert.equal(fields.get('__EVENTTARGET'), '');
  assert.equal(fields.has('ctl00$TextBoxDateStart'), true);
  assert.equal(fields.has('ctl00$ButtonSearch'), false);
});

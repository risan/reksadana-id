import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { CookieError, assertCookieIsValid, fetchProfile, fetchRecentNavRows, navPeriodFor, parseAllocationRows, parseAumRows, parseFundList, parseFundPage, parseNavRows, parseUnitsRows } from './bareksa.js';

// Built from the response shapes Bareksa sends for a logged-in and an anonymous request.
const LOGGED_IN_NAV = {
  status: true,
  data: {
    auth: true,
    startdate: '12-12-2019',
    enddate: '30-09-2026',
    datas: [{
      pid: '4044',
      ptype: 'mutualfund',
      idate: '2019-12-12',
      inav: '1000.000000',
      pname: 'KIM Fixed Income Fund',
      nav: [
        { id: '1', date: '2019-12-12', value: '1000.000000' },
        { id: '2', date: '2019-12-13', value: '1000.512300' },
        { id: '3', date: '2019-12-14', value: '0.000000' },
      ],
    }],
  },
};

test('parseNavRows reads the daily NAV of a logged-in response and skips empty prices', () => {
  assert.deepEqual(parseNavRows(LOGGED_IN_NAV), [
    ['2019-12-12', '1000'],
    ['2019-12-13', '1000.5123'],
  ]);
});

test('parseNavRows returns no rows for a logged-in fund without NAV', () => {
  assert.deepEqual(parseNavRows({ status: true, data: { auth: true, datas: [] } }), []);
});

test('parseNavRows stops with a cookie error for an anonymous response', () => {
  const anonymous = { status: true, data: { auth: false, redirect_url: 'https://www.bareksa.com/id/member/langganan' } };

  assert.throws(() => parseNavRows(anonymous), CookieError);
});

test('parseNavRows checks the login before anything else, even without a status or datas', () => {
  assert.throws(() => parseNavRows({ data: { auth: false } }), CookieError);
  assert.throws(() => parseNavRows({ status: false, data: { auth: false } }), CookieError);
});

test('parseNavRows fails on a response without data, and on a NAV that is not a number', () => {
  assert.throws(() => parseNavRows({ status: true }), /no data list/);
  assert.throws(() => parseNavRows({ status: false, data: {} }), /no data list/);
  assert.throws(() => parseNavRows({ data: { auth: true, datas: [] } }), /no data list/);
  assert.throws(() => parseNavRows({ status: true, data: { auth: true } }), /no data list/);
  assert.throws(() => parseNavRows({ status: true, data: { auth: true, datas: [{ pid: '1' }] } }), /no NAV list/);
  assert.deepEqual(parseNavRows({ status: true, data: { auth: true, datas: [{ pid: '1', nav: [] }] } }), []);
  assert.throws(() => parseNavRows({ status: true, data: { auth: true, datas: [{ nav: [{ date: '2019-12-12', value: 'abc' }] }] } }), /Invalid number/);
  assert.throws(() => parseNavRows({ status: true, data: { auth: true, datas: [{ nav: [{ date: '2019-02-31', value: '1' }] }] } }), /Invalid date/);
});

test('a cookie with a line break is refused without repeating the cookie', () => {
  const cookie = 'session=secret-value\nsecond-line=more';

  assert.throws(() => assertCookieIsValid(cookie), (error) => error.message === 'BAREKSA_COOKIE has a line break or invalid characters; copy it again');
  assert.doesNotThrow(() => assertCookieIsValid('session=abc; token=def%3D'));
});

test('parseAumRows and parseUnitsRows read the monthly rows and the empty answer', () => {
  const aum = { status: true, data: [{ id: '145876', date: '2019-12-01', value: '241287219502', value_idr: '241287219502.00', value_usd: '17142964.09' }] };
  const units = { status: true, data: [{ id: '145876', date: '2019-12-01', value: '41930724' }] };

  assert.deepEqual(parseAumRows(aum), [['2019-12-01', '241287219502', '17142964.09']]);
  assert.deepEqual(parseUnitsRows(units), [['2019-12-01', '41930724']]);
  assert.deepEqual(parseAumRows({ status: false, msg: 'Empty' }), []);
});

test('rows with a value that is not a number fail instead of becoming NaN', () => {
  assert.throws(() => parseAumRows({ data: [{ date: '2019-12-01', value_idr: 'abc', value_usd: '1' }] }), /Invalid number/);
  assert.throws(() => parseUnitsRows({ data: [{ date: '2019-12-01', value: 'NaN' }] }), /Invalid number/);
  assert.throws(() => parseUnitsRows({ data: [{ date: 'not a date', value: '1' }] }), /Invalid date/);
  assert.throws(() => parseAllocationRows({ data: [['2021-02-25', '0.00', '95.94', '4.06']] }), /expected 4/);
});

test('a missing value stays empty', () => {
  assert.deepEqual(parseUnitsRows({ data: [{ date: '2009-02-01', value: null }] }), [['2009-02-01', '']]);
});

test('parseAllocationRows keeps the four shares in order', () => {
  const allocation = { startdate: '30-02-2021', enddate: '30-08-2026', data: [['2021-02-25', '0.00', '95.94', '4.06', '0.00']] };

  assert.deepEqual(parseAllocationRows(allocation), [['2021-02-25', '0', '95.94', '4.06', '0']]);
});

test('parseFundList reads ids, slugs, and names', () => {
  const html = `<table id="nav-table"><tbody>
    <tr class="colTab"><td><input type="checkbox" value="2904" /></td>
    <td class="left"><a href="https://www.bareksa.com/id/data/mutualfund/2904/aberdeen-proteksi-income-reguler">Aberdeen Proteksi Income Reguler</a></td></tr>
    <tr class="colTab"><td><input type="checkbox" value="9" /></td>
    <td class="left"><a href="https://www.bareksa.com/id/data/mutualfund/9/a-b">A &amp; B Fund</a></td></tr>
  </tbody></table>`;

  assert.deepEqual(parseFundList(html), [
    { id: 2904, slug: 'aberdeen-proteksi-income-reguler', name: 'Aberdeen Proteksi Income Reguler' },
    { id: 9, slug: 'a-b', name: 'A & B Fund' },
  ]);
});

test('parseFundList tolerates line breaks and spaces between tags', () => {
  const html = `<table id="nav-table"><tbody>
    <tr><td><input type="checkbox" name="idc[]" value="7" /></td>
    <td
      class="left" >
      <a
        href="https://www.bareksa.com/id/data/mutualfund/7/some-fund" >
        Some Fund
      </a></td></tr>
  </tbody></table>`;

  assert.deepEqual(parseFundList(html), [{ id: 7, slug: 'some-fund', name: 'Some Fund' }]);
});

test('parseFundList stops on an empty page but fails when rows cannot be read', () => {
  assert.deepEqual(parseFundList('<table id="nav-table"><tbody></tbody></table>'), []);
  assert.throws(() => parseFundList('<table id="nav-table"><tr><td><input name="idc[]" value="7" /></td><td class="new-layout">x</td></tr></table>'), /none could be read/);
});

test('parseFundPage reads type, manager, and launch date', () => {
  const html = `<a itemprop="brand" itemscope href="x"><span itemprop="name">Korea Investment Management Indonesia, PT</span></a>
    <table class="profiletable"><tbody>
      <tr><td>Jenis Reksa Dana</td><td class="fr" style="text-align:right;">Pendapatan Tetap</td></tr>
      <tr><td>Tanggal Peluncuran</td><td class="fr" style="text-align:right;">2 Desember 2019</td></tr>
    </tbody></table>`;

  assert.deepEqual(parseFundPage(html), {
    type: 'Pendapatan Tetap',
    manager: 'Korea Investment Management Indonesia, PT',
    launchDate: '2019-12-02',
    currency: '',
    custodian: '',
    minPurchase: '',
    minPurchaseCurrency: '',
    minTopup: '',
    minTopupCurrency: '',
    minRedemption: '',
    minRedemptionCurrency: '',
    feePurchase: '',
    feeRedemption: '',
    feeSwitch: '',
  });
});

const readFixture = (name) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

test('parseFundPage reads the costs of a typical fund (440)', () => {
  assert.deepEqual(parseFundPage(readFixture('fund-440.html')), {
    type: 'Pendapatan Tetap',
    manager: 'Insight Investments Management, PT',
    launchDate: '2011-06-23',
    currency: 'IDR',
    custodian: 'PT Bank Negara Indonesia (Persero) Tbk',
    minPurchase: '100000',
    minPurchaseCurrency: 'IDR',
    minTopup: '',
    minTopupCurrency: '',
    minRedemption: '100000',
    minRedemptionCurrency: 'IDR',
    feePurchase: '-0.02',
    feeRedemption: '-0.02',
    feeSwitch: '-0.02',
  });
});

test('parseFundPage reads a minimum and a maximum fee, and collapses the double space in a custodian name (75)', () => {
  const fund = parseFundPage(readFixture('fund-75.html'));

  assert.equal(fund.custodian, 'The Hongkong And Shanghai Banking Corporation');
  assert.equal(fund.minPurchase, '250000000');
  assert.equal(fund.minRedemption, '10000');
  assert.equal(fund.feePurchase, '0.005-0.03');
  assert.equal(fund.feeRedemption, '-0.02');
});

test('parseFundPage leaves empty cells, dashes, and an unlaunched fund empty (1217, 5298)', () => {
  const { currency, custodian, ...costs } = parseFundPage(readFixture('fund-1217.html'));

  assert.equal(currency, 'IDR');
  assert.equal(custodian, 'Standard Chartered Bank');
  assert.deepEqual(Object.values(costs).slice(3), Array(9).fill(''));
  assert.equal(parseFundPage(readFixture('fund-5298.html')).currency, '');
});

test('parseFundPage handles a fee without a dot, a mixed fee cell, and a unit minimum (3148, 484)', () => {
  const protectedFund = parseFundPage(readFixture('fund-3148.html'));

  assert.equal(protectedFund.feePurchase, '-0.01');
  assert.equal(protectedFund.feeRedemption, '-0.1');
  assert.equal(protectedFund.feeSwitch, '');

  const mixedFund = parseFundPage(readFixture('fund-484.html'));

  assert.equal(mixedFund.minPurchase, '500000');
  assert.equal(mixedFund.minRedemption, '');
  assert.equal(mixedFund.feeRedemption, '-0.01');
  assert.equal(mixedFund.feeSwitch, '-0.005');
});

test('parseFundPage keeps an explicit zero fee, and an amount in another currency than the fund', () => {
  const html = `<table class="profiletable"><tr><td>Jenis Reksa Dana</td><td>Saham</td></tr>
    <tr><td>Dana Kelolaan</td><td>USD 1.250.000,50</td></tr>
    <tr><td>Min. Pembelian Awal</td><td>IDR 1.000.000,00</td></tr>
    <tr><td>Pembelian Selanjutnya</td><td>USD 100,25</td></tr></table>
    <table class="profiletable2"><tr><td>Biaya Pembelian</td><!--<td>0</td>--><td>0%</td></tr>
    <tr><td>Biaya Penjualan Kembali</td><td>-</td></tr></table>`;
  const fund = parseFundPage(html);

  assert.equal(fund.currency, 'USD');
  assert.equal(fund.minPurchase, '1000000');
  assert.equal(fund.minPurchaseCurrency, 'IDR');
  assert.equal(fund.minTopup, '100.25');
  assert.equal(fund.minTopupCurrency, 'USD');
  assert.equal(fund.feePurchase, '0');
  assert.equal(fund.feeRedemption, '');
});

test('a 200 page without a profile table is fetched again, and a good page is stamped with today', async (t) => {
  const pages = ['<html><title>Please wait</title></html>', readFixture('fund-440.html')];
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(pages.shift()));

  const profile = await fetchProfile({ id: 440, slug: 'x' });

  assert.equal(fetchMock.mock.callCount(), 2);
  assert.equal(profile.profileDate, new Date().toISOString().slice(0, 10));
  assert.equal(profile.type, parseFundPage(readFixture('fund-440.html')).type);
});

test('the profile error says what came back instead', () => {
  assert.throws(() => parseFundPage('<html><title>Please wait</title></html>'), /no profile table \(\d+ characters, title "Please wait"\)/);
});

test('a fund whose stored NAV ends within 25 days asks for the last month, an older one for the last year', () => {
  assert.equal(navPeriodFor('2026-10-08', '2026-10-09'), '1m');
  assert.equal(navPeriodFor('2026-09-14', '2026-10-09'), '1m');
  assert.equal(navPeriodFor('2026-09-13', '2026-10-09'), '1y');
  assert.equal(navPeriodFor('2026-08-11', '2026-10-09'), '1y');
});

test('the daily run skips a fund that stopped over 60 days ago, the run over all funds does not', () => {
  assert.equal(navPeriodFor('2026-08-09', '2026-10-09'), null);
  assert.equal(navPeriodFor('2020-01-02', '2026-10-09'), null);
  assert.equal(navPeriodFor('2026-08-09', '2026-10-09', { all: true }), '1y');
  assert.equal(navPeriodFor('2020-01-02', '2026-10-09', { all: true }), '1y');
});

test('a fund without a stored NAV asks for the last year', () => {
  assert.equal(navPeriodFor(undefined, '2026-10-09'), '1y');
});

test('an answer without a NAV list is asked again, and the last month is asked without a login', async (t) => {
  const answers = [
    { status: true, data: { auth: true, datas: [{ pid: '1', nav: false }] } },
    { status: true, data: { auth: true, datas: [{ pid: '1', nav: [{ date: '2026-10-08', value: '1768.1' }, { date: '2026-10-09', value: '1769.2' }] }] } },
  ];
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(answers.shift()));

  assert.deepEqual(await fetchRecentNavRows(1, '1m'), [['2026-10-08', '1768.1'], ['2026-10-09', '1769.2']]);
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.match(String(fetchMock.mock.calls[0].arguments[0]), /cperiod=1m/);
  assert.equal(fetchMock.mock.calls[0].arguments[1].headers.Cookie, undefined);
});

test('a login refusal is not retried', () => {
  assert.equal(new CookieError().retryable, false);
});

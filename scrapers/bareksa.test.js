import assert from 'node:assert/strict';
import test from 'node:test';
import { CookieError, assertCookieIsValid, parseAllocationRows, parseAumRows, parseFundList, parseFundPage, parseNavRows, parseUnitsRows } from './bareksa.js';

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
  assert.throws(() => parseNavRows({ status: true }), /no data/);
  assert.throws(() => parseNavRows({ data: { auth: true, datas: [{ nav: [{ date: '2019-12-12', value: 'abc' }] }] } }), /Invalid number/);
  assert.throws(() => parseNavRows({ data: { auth: true, datas: [{ nav: [{ date: '2019-02-31', value: '1' }] }] } }), /Invalid date/);
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

  assert.deepEqual(parseFundPage(html), { type: 'Pendapatan Tetap', manager: 'Korea Investment Management Indonesia, PT', launchDate: '2019-12-02' });
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError, decodeHtml, matchBibitSymbols, readCsvRows, reportMatches, runPool, sleep, toCsv, withRetries, writeFileAtomic } from './lib.js';

const BASE_URL = 'https://www.bareksa.com';
const DATA_DIR = path.join(import.meta.dirname, '..', 'data', 'bareksa');
const BIBIT_FUNDS_FILE = path.join(import.meta.dirname, '..', 'data', 'bibit', 'funds.csv');
const CONCURRENCY = 2;
const REQUEST_DELAY_MS = 100;
// Some Bareksa responses take 20 to 60 seconds.
const REQUEST_TIMEOUT_MS = 90 * 1000;
const LIST_PAGE_SIZE = 100;
const FIRST_DATE = '2000-01-01';
const PROFILES_PER_RUN = 400;
const FUND_HEADER = [
  'bareksa_id', 'name', 'slug', 'type', 'manager', 'launch_date', 'bibit_symbol',
  'currency', 'custodian', 'min_purchase', 'min_topup', 'min_redemption', 'fee_purchase', 'fee_redemption', 'fee_switch', 'profile_date',
];
// The order of the columns after bibit_symbol in funds.csv.
const STORED_PROFILE_FIELDS = ['currency', 'custodian', 'minPurchase', 'minTopup', 'minRedemption', 'feePurchase', 'feeRedemption', 'feeSwitch', 'profileDate'];
const EMPTY_PROFILE = {
  type: '',
  manager: '',
  launchDate: '',
  ...Object.fromEntries(STORED_PROFILE_FIELDS.map((field) => [field, ''])),
};
const AUM_HEADER = ['date', 'aum_idr', 'aum_usd'];
const UNITS_HEADER = ['date', 'units'];
// Bareksa's allocation chart (drawAlokasiDana in its chart.js) names these columns in this order.
const ALLOCATION_HEADER = ['date', 'saham', 'obligasi', 'pasar_uang', 'lainnya'];
const NAV_HEADER = ['date', 'nav'];

const INDONESIAN_MONTHS = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];

// The NAV history needs a logged-in session, copied from the browser by the owner.
const cookie = process.env.BAREKSA_COOKIE?.trim();

let requestCount = 0;

export class CookieError extends Error {
  constructor() {
    super('BAREKSA_COOKIE missing or expired: Bareksa did not accept the login for the NAV history');
  }
}

// A header value holds visible ASCII only. The message never repeats the cookie, which is a secret.
export const assertCookieIsValid = (value) => {
  if (/[^\t\x20-\x7e]/.test(value)) {
    throw new Error('BAREKSA_COOKIE has a line break or invalid characters; copy it again');
  }
};

const fetchText = (url, { sendCookie = false, acceptDatabaseError = false } = {}) => withRetries(async () => {
  requestCount++;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: '*/*',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        ...(sendCookie && { Cookie: cookie }),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();

    // A fund without allocation data gets HTTP 500 and a "Database Error" page, on every request.
    if (acceptDatabaseError && response.status === 500 && text.includes('Database Error')) {
      return null;
    }

    if (!response.ok) {
      throw new HttpError(url, response.status, response.statusText);
    }

    return text;
  } catch (error) {
    // The error message of an invalid header repeats the whole cookie.
    if (sendCookie && !(error instanceof HttpError)) {
      throw new Error(`GET ${url} failed (${error.name}); the details are hidden because the request carries the cookie`);
    }

    throw error;
  } finally {
    await sleep(REQUEST_DELAY_MS);
  }
});

// A missing value stays empty. A value that is not a finite number fails the fund, so it never replaces stored data.
const toNumberText = (value) => {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (!Number.isFinite(Number(value))) {
    throw new Error(`Invalid number: "${value}"`);
  }

  return String(Number(value));
};

const assertDate = (date) => {
  // Date.parse accepts 2019-02-31 and moves it to March, so the date must survive the round trip.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid date: "${date}"`);
  }

  return date;
};

// "12 Desember 2019" becomes "2019-12-12". Anything else is left empty.
const toIsoDate = (text) => {
  const match = text.match(/^(\d{1,2}) (\S+) (\d{4})$/);
  const month = INDONESIAN_MONTHS.indexOf(match?.[2].toLowerCase()) + 1;

  if (!match || month === 0) {
    return '';
  }

  return `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
};

export const parseFundList = (html) => {
  if (!html.includes('id="nav-table"')) {
    throw new Error('Fund list has no table');
  }

  const rows = html.matchAll(/<td\s+class="left"\s*>\s*<a\s+href="[^"]*\/mutualfund\/(\d+)\/([^"/]*)"\s*>([^<]*)<\/a>/g);
  const funds = [...rows].map(([, id, slug, name]) => ({ id: Number(id), slug, name: decodeHtml(name) }));

  // A page past the last one has the table and no rows. A page with rows that do not parse is a changed layout.
  if (funds.length === 0 && html.includes('name="idc[]"')) {
    throw new Error('Fund list has rows but none could be read');
  }

  return funds;
};

const PROFILE_AMOUNT = /(IDR|USD)\s*(\d+(?:\.\d{3})*)(?:,(\d+))?/;

// "IDR 100.000,00" becomes "100000". A text without a currency amount, such as "100 UP" or "-", is left empty.
// The amount is kept even when its currency differs from the fund's.
const toAmount = (text) => {
  const match = text.match(PROFILE_AMOUNT);

  return match ? String(Number(`${match[2].replaceAll('.', '')}.${match[3] ?? '0'}`)) : '';
};

const toFraction = (percentText) => String(Number((Number(percentText.replace(',', '.')) / 100).toFixed(8)));

// "Min. 0,5%, Maks. 3%" becomes "0.005-0.03", "Maks. 2%" becomes "-0.02", and a bare "0%" becomes "0".
// Anything else, such as "-" or an empty cell, is unknown and stays empty.
const toFeeRange = (text) => {
  const min = text.match(/Min\.?\s*(\d+(?:,\d+)?)\s*%/i)?.[1];
  const max = text.match(/Maks\.?\s*(\d+(?:,\d+)?)\s*%/i)?.[1];

  if (min !== undefined || max !== undefined) {
    return `${min === undefined ? '' : toFraction(min)}-${max === undefined ? '' : toFraction(max)}`;
  }

  const bare = text.match(/^(\d+(?:,\d+)?)\s*%$/)?.[1];

  return bare === undefined ? '' : toFraction(bare);
};

export const parseFundPage = (html) => {
  // A fee cell can hold a raw "<" ("Maks. 1% < 1 tahun"), and the fee rows have an HTML comment between the cells.
  const cellValue = (label) => html.match(new RegExp(`<td>${label}</td>\\s*(?:<!--.*?-->\\s*)?<td[^>]*>(.*?)</td>`, 's'))?.[1];
  const profileValue = (label) => decodeHtml(cellValue(label) ?? '');
  const type = cellValue('Jenis Reksa Dana');

  if (type === undefined) {
    throw new Error('Fund page has no profile table');
  }

  const manager = html.match(/<a itemprop="brand"[^>]*><span itemprop="name">([^<]*)<\/span>/)?.[1] ?? '';

  return {
    type: decodeHtml(type),
    manager: decodeHtml(manager),
    launchDate: toIsoDate(profileValue('Tanggal Peluncuran')),
    currency: profileValue('Dana Kelolaan').match(PROFILE_AMOUNT)?.[1] ?? '',
    custodian: profileValue('Bank Kustodian').replace(/\s+/g, ' '),
    minPurchase: toAmount(profileValue('Min. Pembelian Awal')),
    minTopup: toAmount(profileValue('Pembelian Selanjutnya')),
    minRedemption: toAmount(profileValue('Min. Penjualan Kembali')),
    feePurchase: toFeeRange(profileValue('Biaya Pembelian')),
    feeRedemption: toFeeRange(profileValue('Biaya Penjualan Kembali')),
    feeSwitch: toFeeRange(profileValue('Biaya Switching')),
  };
};

// An id without data answers {"status":false,"msg":"Empty"}.
const readDataRows = (json, toRow) => {
  if (Array.isArray(json.data)) {
    return json.data.map(toRow);
  }

  if (json.status === false && json.msg === 'Empty') {
    return [];
  }

  throw new Error('Response has no data list');
};

export const parseAumRows = (json) => readDataRows(json, (row) => [assertDate(row.date), toNumberText(row.value_idr), toNumberText(row.value_usd)]);

export const parseUnitsRows = (json) => readDataRows(json, (row) => [assertDate(row.date), toNumberText(row.value)]);

export const parseAllocationRows = (json) => readDataRows(json, ([date, ...shares]) => {
  if (shares.length !== ALLOCATION_HEADER.length - 1) {
    throw new Error(`Allocation row has ${shares.length} shares, expected ${ALLOCATION_HEADER.length - 1}`);
  }

  return [assertDate(date), ...shares.map(toNumberText)];
});

export const parseNavRows = (json) => {
  if (json.data?.auth === false) {
    throw new CookieError();
  }

  if (json.status !== true || !Array.isArray(json.data?.datas)) {
    throw new Error('NAV response has no data list');
  }

  const [fund] = json.data.datas;

  if (fund !== undefined && !Array.isArray(fund.nav)) {
    throw new Error('NAV response has no NAV list');
  }

  const points = fund?.nav ?? [];

  return points
    .map((point) => [assertDate(point.date), toNumberText(point.value)])
    .filter(([, nav]) => Number(nav) > 0);
};

// The list page of "all funds" shows every fund, not only the ones sold on Bareksa (`ba=no`).
const fetchFundList = async () => {
  const funds = new Map();

  for (let page = 1; ; page++) {
    const html = await fetchText(`${BASE_URL}/ajax/mutualfund/product/list?t=&ob=name&o=asc&ba=no&l=${LIST_PAGE_SIZE}&p=${page}`);
    const pageFunds = parseFundList(html);

    if (pageFunds.length === 0) {
      break;
    }

    if (pageFunds.every(({ id }) => funds.has(id))) {
      throw new Error(`Fund list page ${page} has no new funds; the paging may be broken`);
    }

    for (const { id, slug, name } of pageFunds) {
      funds.set(id, { name, slug });
    }
  }

  if (funds.size === 0) {
    throw new Error('Fund list is empty');
  }

  return funds;
};

const readStoredFunds = async () => {
  const rows = await readCsvRows(path.join(DATA_DIR, 'funds.csv'));

  return new Map(rows.map(([id, name, slug, type, manager, launchDate, , ...profile]) => [
    Number(id),
    { name, slug, type, manager, launchDate, ...Object.fromEntries(STORED_PROFILE_FIELDS.map((field, index) => [field, profile[index] ?? ''])) },
  ]));
};

const writeFundIndex = async (funds, bibitRows) => {
  const sortedFunds = [...funds].sort((a, b) => a[0] - b[0]);
  const symbolsById = matchBibitSymbols('bareksa', sortedFunds, bibitRows);

  const rows = sortedFunds.map(([id, fund]) => [
    id,
    fund.name,
    fund.slug,
    fund.type,
    fund.manager,
    fund.launchDate,
    symbolsById.get(id),
    ...STORED_PROFILE_FIELDS.map((field) => fund[field]),
  ]);

  await writeFileAtomic(path.join(DATA_DIR, 'funds.csv'), toCsv(FUND_HEADER, rows));

  return symbolsById;
};

// A new row replaces the stored row of the same date, column by column. A missing value in a new row
// never erases the stored value of that column.
export const mergeRowsByDate = (storedRows, newRows) => {
  const rowsByDate = new Map(storedRows.map((row) => [row[0], row]));

  for (const row of newRows) {
    const storedRow = rowsByDate.get(row[0]);

    rowsByDate.set(row[0], storedRow ? row.map((value, column) => (value === '' ? storedRow[column] ?? '' : value)) : row);
  }

  return [...rowsByDate.values()].sort((a, b) => a[0].localeCompare(b[0]));
};

// New rows replace stored ones on the same date. Returns how many rows the file holds.
const updateSeries = async (directory, header, id, fetchRows) => {
  const file = path.join(DATA_DIR, directory, `${id}.csv`);
  const storedRows = await readCsvRows(file);
  const newRows = await fetchRows(storedRows.at(-1)?.[0]);

  if (newRows.length === 0) {
    return storedRows.length;
  }

  const rows = mergeRowsByDate(storedRows, newRows);

  await writeFileAtomic(file, toCsv(header, rows));

  return rows.length;
};

const fetchJson = async (endpoint, options) => {
  const text = await fetchText(`${BASE_URL}${endpoint}`, options);

  return text === null ? null : JSON.parse(text);
};

const fetchAumRows = async (id, lastDate = FIRST_DATE) => parseAumRows(await fetchJson(`/ajax/mutualfund/aum/product/?id=${id}&startdate=${lastDate}&enddate=`));

const fetchUnitsRows = async (id, lastDate = FIRST_DATE) => parseUnitsRows(await fetchJson(`/ajax/mutualfund/aum/product_unit/?id=${id}&startdate=${lastDate}&enddate=`));

const fetchAllocationRows = async (id, lastDate) => {
  const range = lastDate === undefined
    ? 'cperiod=all&startdate=&enddate='
    : `cperiod=custom&startdate=${lastDate}&enddate=${new Date().toISOString().slice(0, 10)}`;
  // A fund with allocation history that answers "Database Error" is a failure, not a fund without data.
  const json = await fetchJson(`/ajax/mutualfund/alokasidana/?id=${id}&${range}`, { acceptDatabaseError: lastDate === undefined });

  return json === null ? [] : parseAllocationRows(json);
};

const fetchNavRows = async (id) => parseNavRows(await fetchJson(
  `/ajax/mutualfund/nav/product1/?id=${id}&cperiod=all&startdate=&enddate=&requested_page=profile.graph`,
  { sendCookie: true },
));

const today = () => new Date().toISOString().slice(0, 10);

const fetchProfile = async ({ id, slug }) => ({
  ...parseFundPage(await fetchText(`${BASE_URL}/id/data/reksadana/${id}/${slug}`)),
  profileDate: today(),
});

// Never-fetched funds first, then the oldest profile.
const byOldestProfile = ([idA, a], [idB, b]) => a.profileDate.localeCompare(b.profileDate) || idA - idB;

// Fund pages only, for the costs and minimums. A failed page gets today's date and keeps its old values,
// so it moves to the back of the queue and cannot starve the funds behind it.
const mainProfiles = async ({ all }) => {
  const startedAt = Date.now();
  const funds = await readStoredFunds();
  const queue = [...funds].sort(byOldestProfile).slice(0, all ? Infinity : PROFILES_PER_RUN);

  console.log(`Profiles: ${queue.length} of ${funds.size} funds`);

  const failures = await runPool({
    items: queue.map(([id]) => id),
    worker: async (id) => {
      try {
        funds.set(id, { ...funds.get(id), ...await fetchProfile({ id, slug: funds.get(id).slug }) });
      } catch (error) {
        funds.set(id, { ...funds.get(id), profileDate: today() });

        throw error;
      }
    },
    concurrency: CONCURRENCY,
    label: 'Profiles fetched',
    describeItem: (id) => `Bareksa ${id}`,
  });

  const bibitRows = await readCsvRows(BIBIT_FUNDS_FILE);
  const symbolsById = await writeFundIndex(funds, bibitRows);

  reportMatches('Bareksa', funds.size, symbolsById, bibitRows);
  console.log(`${requestCount} requests in ${Math.round((Date.now() - startedAt) / 1000)} seconds`);

  if (failures.length > 0) {
    console.error(`${failures.length} funds failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
};

const main = async () => {
  const startedAt = Date.now();

  if (cookie) {
    try {
      assertCookieIsValid(cookie);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }

  const storedFunds = await readStoredFunds();
  const listedFunds = await fetchFundList();
  const funds = new Map(storedFunds);
  const failures = [];
  let cookieError = null;
  let fundsWithData = 0;

  for (const [id, { name, slug }] of listedFunds) {
    funds.set(id, { ...EMPTY_PROFILE, ...funds.get(id), name, slug });
  }

  console.log(`Fund list: ${listedFunds.size} funds, ${funds.size - storedFunds.size} new`);

  for (const directory of ['aum', 'units', 'allocation', ...(cookie ? ['nav'] : [])]) {
    await fs.mkdir(path.join(DATA_DIR, directory), { recursive: true });
  }

  const scrapeFund = async (id) => {
    if (cookie) {
      await updateSeries('nav', NAV_HEADER, id, () => fetchNavRows(id));
    }

    const aumRowCount = await updateSeries('aum', AUM_HEADER, id, (lastDate) => fetchAumRows(id, lastDate));

    if (aumRowCount > 0) {
      fundsWithData++;
      await updateSeries('units', UNITS_HEADER, id, (lastDate) => fetchUnitsRows(id, lastDate));
      await updateSeries('allocation', ALLOCATION_HEADER, id, (lastDate) => fetchAllocationRows(id, lastDate));
    }

    // The profile page is fetched once per fund. It is saved only after the data, so a failed page is retried next run.
    if (funds.get(id).profileDate === '' || funds.get(id).type === '' || funds.get(id).manager === '') {
      funds.set(id, { ...funds.get(id), ...await fetchProfile({ id, slug: funds.get(id).slug }) });
    }
  };

  // A bad cookie fails every NAV request the same way, so stop at the first one.
  const scrapeFundUnlessLoggedOut = async (id) => {
    if (cookieError) {
      return;
    }

    try {
      await scrapeFund(id);
    } catch (error) {
      if (!(error instanceof CookieError)) {
        throw error;
      }

      cookieError = error;
    }
  };

  failures.push(...await runPool({
    items: [...funds.keys()],
    worker: scrapeFundUnlessLoggedOut,
    concurrency: CONCURRENCY,
    label: 'Funds scraped',
    describeItem: (id) => `Bareksa ${id}`,
  }));

  const bibitRows = await readCsvRows(BIBIT_FUNDS_FILE);
  const symbolsById = await writeFundIndex(funds, bibitRows);

  reportMatches('Bareksa', funds.size, symbolsById, bibitRows);
  console.log(`${fundsWithData} funds have AUM data`);
  console.log(`${requestCount} requests in ${Math.round((Date.now() - startedAt) / 1000)} seconds`);

  if (cookieError) {
    console.error(cookieError.message);
    process.exitCode = 1;
  }

  if (failures.length > 0) {
    console.error(`${failures.length} funds failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
};

if (process.argv[1] === import.meta.filename) {
  if (process.argv.includes('--profiles') || process.argv.includes('--profiles-all')) {
    await mainProfiles({ all: process.argv.includes('--profiles-all') });
  } else {
    await main();
  }
}

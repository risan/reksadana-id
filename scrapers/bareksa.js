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
const FUND_HEADER = ['bareksa_id', 'name', 'slug', 'type', 'manager', 'launch_date', 'bibit_symbol'];
const AUM_HEADER = ['date', 'aum_idr', 'aum_usd'];
const UNITS_HEADER = ['date', 'units'];
// Bareksa's allocation chart (drawAlokasiDana in its chart.js) names these columns in this order.
const ALLOCATION_HEADER = ['date', 'saham', 'obligasi', 'pasar_uang', 'lainnya'];
const NAV_HEADER = ['date', 'nav'];

const INDONESIAN_MONTHS = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];

// The NAV history needs a logged-in session, copied from the browser by the owner.
const cookie = process.env.BAREKSA_COOKIE;

let requestCount = 0;

export class CookieError extends Error {
  constructor() {
    super('BAREKSA_COOKIE missing or expired: Bareksa did not accept the login for the NAV history');
  }
}

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
  } finally {
    await sleep(REQUEST_DELAY_MS);
  }
});

const toNumberText = (value) => (value === null || value === undefined || value === '' ? '' : String(Number(value)));

const assertDate = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
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

  const rows = html.matchAll(/<td class="left"><a href="[^"]*\/mutualfund\/(\d+)\/([^"/]*)">([^<]*)<\/a>/g);

  return [...rows].map(([, id, slug, name]) => ({ id: Number(id), slug, name: decodeHtml(name) }));
};

export const parseFundPage = (html) => {
  const profileValue = (label) => html.match(new RegExp(`<td>${label}</td>\\s*<td[^>]*>([^<]*)</td>`))?.[1];
  const type = profileValue('Jenis Reksa Dana');

  if (type === undefined) {
    throw new Error('Fund page has no profile table');
  }

  const manager = html.match(/<a itemprop="brand"[^>]*><span itemprop="name">([^<]*)<\/span>/)?.[1] ?? '';

  return {
    type: decodeHtml(type),
    manager: decodeHtml(manager),
    launchDate: toIsoDate(decodeHtml(profileValue('Tanggal Peluncuran') ?? '')),
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

export const parseAllocationRows = (json) => readDataRows(json, ([date, ...shares]) => [assertDate(date), ...shares.map(toNumberText)]);

export const parseNavRows = (json) => {
  if (!json.status || !json.data) {
    throw new Error('NAV response has no data');
  }

  if (json.data.auth === false) {
    throw new CookieError();
  }

  const points = json.data.datas?.[0]?.nav ?? [];

  return points
    .filter((point) => Number(point.value) > 0)
    .map((point) => [assertDate(point.date), toNumberText(point.value)]);
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

  return new Map(rows.map(([id, name, slug, type, manager, launchDate]) => [Number(id), { name, slug, type, manager, launchDate }]));
};

const writeFundIndex = async (funds, bibitRows) => {
  const sortedFunds = [...funds].sort((a, b) => a[0] - b[0]);
  const symbolsById = matchBibitSymbols(sortedFunds, bibitRows);

  const rows = sortedFunds.map(([id, fund]) => [
    id,
    fund.name,
    fund.slug,
    fund.type,
    fund.manager,
    fund.launchDate,
    symbolsById.get(id),
  ]);

  await writeFileAtomic(path.join(DATA_DIR, 'funds.csv'), toCsv(FUND_HEADER, rows));

  return symbolsById;
};

// New rows replace stored ones on the same date. Returns how many rows the file holds.
const updateSeries = async (directory, header, id, fetchRows) => {
  const file = path.join(DATA_DIR, directory, `${id}.csv`);
  const storedRows = await readCsvRows(file);
  const newRows = await fetchRows(storedRows.at(-1)?.[0]);

  if (newRows.length === 0) {
    return storedRows.length;
  }

  const rowsByDate = new Map([...storedRows, ...newRows].map((row) => [row[0], row]));
  const rows = [...rowsByDate.values()].sort((a, b) => a[0].localeCompare(b[0]));

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
  const json = await fetchJson(`/ajax/mutualfund/alokasidana/?id=${id}&${range}`, { acceptDatabaseError: true });

  return json === null ? [] : parseAllocationRows(json);
};

const fetchNavRows = async (id) => parseNavRows(await fetchJson(
  `/ajax/mutualfund/nav/product1/?id=${id}&cperiod=all&startdate=&enddate=&requested_page=profile.graph`,
  { sendCookie: true },
));

const main = async () => {
  const startedAt = Date.now();
  const storedFunds = await readStoredFunds();
  const listedFunds = await fetchFundList();
  const funds = new Map(storedFunds);
  const failures = [];
  let cookieError = null;
  let fundsWithData = 0;

  for (const [id, { name, slug }] of listedFunds) {
    funds.set(id, { type: '', manager: '', launchDate: '', ...funds.get(id), name, slug });
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
    if (funds.get(id).type === '') {
      funds.set(id, { ...funds.get(id), ...parseFundPage(await fetchText(`${BASE_URL}/id/data/reksadana/${id}/${funds.get(id).slug}`)) });
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
  await main();
}

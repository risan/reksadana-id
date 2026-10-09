import path from 'node:path';
import { HttpError, mergeRowsByDate, readCsvRows, runPool, sleep, toCsv, withRetries, writeFileAtomic } from './lib.js';

const ENDPOINT = 'https://www.bareksa.com/ajax/mutualfund/nav/product_index/';
const DATA_DIR = path.join(import.meta.dirname, '..', 'data', 'benchmarks');
const HEADER = ['date', 'value'];
const CONCURRENCY = 2;
const REQUEST_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 90 * 1000;
// The request needs some fund id; the fund's own NAV in the answer is ignored.
const ANY_FUND_ID = 131;

// Without a login Bareksa serves the last year of every index, so a daily run keeps the files complete.
// The files were seeded with the full history by hand. A stock index is asked for by its `sid`, and a
// category index of Bareksa by its `mfid` (the product type); the other half of the request is a filler.
export const SERIES = [
  { id: 'ihsg', sectorCode: 'COMPOSITE' },
  { id: 'lq45', sectorCode: 'LQ45' },
  { id: 'jii', sectorCode: 'JII' },
  { id: 'idx30', sectorCode: 'IDX30' },
  { id: 'issi', sectorCode: 'ISSI' },
  { id: 'sri-kehati', sectorCode: 'SRI-KEHATI' },
  { id: 'bareksa-money-market', productTypeId: '1' },
  { id: 'bareksa-fixed-income', productTypeId: '2' },
  { id: 'bareksa-equity', productTypeId: '3' },
  { id: 'bareksa-balanced', productTypeId: '4' },
];

let requestCount = 0;

const buildUrl = ({ sectorCode = 'COMPOSITE', productTypeId = '1' }) => {
  const query = new URLSearchParams({ id: ANY_FUND_ID, sid: sectorCode, mfid: productTypeId, cperiod: '1y', startdate: '', enddate: '' });

  return `${ENDPOINT}?${query}`;
};

const fetchJson = (url) => withRetries(async () => {
  requestCount++;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json, text/javascript, */*',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) reksadana-id-scraper',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new HttpError(url, response.status, response.statusText);
    }

    return await response.json();
  } finally {
    await sleep(REQUEST_DELAY_MS);
  }
});

// A stock index has `recdate` on its rows; a category index has `date`.
export const parseIndexRows = (json, series) => {
  if (json.data?.auth !== true) {
    throw new Error('Bareksa did not serve the index history');
  }

  const index = series.sectorCode
    ? json.data.sis?.find((entry) => entry.sector_code === series.sectorCode)?.index
    : json.data.mfis?.find((entry) => entry.product_type_id === series.productTypeId)?.index;

  if (!Array.isArray(index)) {
    throw new Error(`The answer has no index for ${series.id}`);
  }

  return index
    .map((row) => [row.recdate ?? row.date, String(Number(row.value))])
    .filter(([date, value]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number(value) > 0);
};

const updateSeries = async (series) => {
  const file = path.join(DATA_DIR, `${series.id}.csv`);
  const storedRows = await readCsvRows(file);
  const newRows = parseIndexRows(await fetchJson(buildUrl(series)), series);

  if (newRows.length === 0) {
    throw new Error('The answer has no rows');
  }

  const rows = mergeRowsByDate(storedRows, newRows);

  await writeFileAtomic(file, toCsv(HEADER, rows));

  console.log(`${series.id}: ${rows.length - storedRows.length} new rows, ${rows.length} in total, newest ${rows.at(-1)[0]}`);
};

const main = async () => {
  const failures = await runPool({
    items: SERIES,
    worker: updateSeries,
    concurrency: CONCURRENCY,
    label: 'Series updated',
    describeItem: (series) => `Benchmark ${series.id}`,
  });

  console.log(`${requestCount} requests`);

  if (failures.length > 0) {
    console.error(`${failures.length} series failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
};

if (process.argv[1] === import.meta.filename) {
  await main();
}

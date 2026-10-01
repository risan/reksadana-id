import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError, decodeHtml, matchBibitSymbols, readCsvRows, reportMatches, runPool, sleep, toCsv, withRetries, writeFileAtomic } from './lib.js';

const BASE_URL = 'https://pusatdata.kontan.co.id';
const DATA_DIR = path.join(import.meta.dirname, '..', 'data', 'kontan');
const BIBIT_FUNDS_FILE = path.join(import.meta.dirname, '..', 'data', 'bibit', 'funds.csv');
const CONCURRENCY = 2;
const REQUEST_DELAY_MS = 100;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const FUND_HEADER = ['kontan_id', 'name', 'manager', 'category', 'nav_date', 'nav', 'bibit_symbol'];
const NAV_HEADER = ['date', 'nav'];

// Kontan's category and manager pages answer with an empty table, so there is no fund list to read.
// Funds are found by asking for each ID instead. IDs have a big gap (about 1,500 to 14,200 hold no
// funds), so the first run must scan through it. Later runs only look past the highest known ID.
const FIRST_SCAN_END_ID = 18000;
const LOOKAHEAD_IDS = 500;
const SCAN_CHUNK_SIZE = 1000;

let requestCount = 0;

const fetchText = (url) => withRetries(async () => {
  requestCount++;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) bibit-reksadana-scraper',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new HttpError(url, response.status, response.statusText);
    }

    return await response.text();
  } finally {
    await sleep(REQUEST_DELAY_MS);
  }
});

// The chart endpoint answers with a page whose inline script pushes every point into two arrays.
// An unknown fund ID gives the same page with no points.
const parseChart = (html) => {
  const dates = [...html.matchAll(/pausecontent\.push\('([^']*)'\)/g)].map((match) => match[1]);
  const values = [...html.matchAll(/data1\.push\('([^']*)'\)/g)].map((match) => match[1]);

  if (dates.length !== values.length) {
    throw new Error(`Chart has ${dates.length} dates but ${values.length} values`);
  }

  const navByDate = new Map();
  let hasConflict = false;

  dates.forEach((date, index) => {
    const nav = Number(values[index]);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Chart has an invalid date: "${date}"`);
    }

    // Days before a fund started, or without a price, come as "#N/A", "0.00", or an empty value.
    if (values[index] === '' || !(nav > 0)) {
      return;
    }

    // A few funds mix two different NAV series, so one date has two values.
    if (navByDate.has(date) && navByDate.get(date) !== nav) {
      hasConflict = true;
    }

    navByDate.set(date, nav);
  });

  return { rows: [...navByDate].map(([date, nav]) => [date, String(nav)]), hasConflict };
};

const parseFundPage = (html) => {
  const header = html.match(/<div class="wdt_perusahaan">\s*<div class="wrn_atas">([^<]*)<\/div>\s*<div class="wrn_tbal[^"]*"[^>]*>([^<]*)<\/div>/);
  const category = html.match(/<div class="wdt_jenis[^"]*">\s*<div class="wrn_atas">Kategori<\/div>\s*<div class="wrn_tbal[^"]*">([^<]*)<\/div>/);

  if (!header || !category) {
    throw new Error('Fund page has no manager, name, or category');
  }

  return { manager: decodeHtml(header[1]), name: decodeHtml(header[2]), category: decodeHtml(category[1]) };
};

const readStoredFunds = async () => {
  const rows = await readCsvRows(path.join(DATA_DIR, 'funds.csv'));

  return new Map(rows.map(([id, name, manager, category, navDate, nav]) => [Number(id), { name, manager, category, navDate, nav }]));
};

const writeFundIndex = async (funds, bibitRows) => {
  const sortedFunds = [...funds].sort((a, b) => a[0] - b[0]);
  const symbolsById = matchBibitSymbols(sortedFunds, bibitRows);

  const rows = sortedFunds.map(([id, fund]) => [
    id,
    fund.name,
    fund.manager,
    fund.category,
    fund.navDate,
    fund.nav,
    symbolsById.get(id),
  ]);

  await writeFileAtomic(path.join(DATA_DIR, 'funds.csv'), toCsv(FUND_HEADER, rows));

  return symbolsById;
};

const main = async () => {
  const startedAt = Date.now();
  const funds = await readStoredFunds();
  const isFirstRun = funds.size === 0;
  const conflictingIds = [];
  const failures = [];

  await fs.mkdir(path.join(DATA_DIR, 'nav'), { recursive: true });

  const highestId = () => Math.max(0, ...funds.keys());

  // New values replace stored ones on the same date; older stored rows are kept,
  // so the history grows past the 12 months Kontan serves.
  const scrapeFund = async (id) => {
    const chartUrl = `${BASE_URL}/reksadana/get_chart_product/?produk_id=${id}&select=nab&periode=12&start_date=&end_date=`;
    const { rows, hasConflict } = parseChart(await fetchText(chartUrl));

    if (rows.length === 0) {
      return;
    }

    if (hasConflict) {
      conflictingIds.push(id);

      return;
    }

    const navFile = path.join(DATA_DIR, 'nav', `${id}.csv`);
    const navByDate = new Map([...await readCsvRows(navFile), ...rows].map((row) => [row[0], row]));
    const mergedRows = [...navByDate.values()].sort((a, b) => a[0].localeCompare(b[0]));
    const [navDate, nav] = mergedRows.at(-1);

    await writeFileAtomic(navFile, toCsv(NAV_HEADER, mergedRows));

    // Saved before the page request, so a fund whose page failed is retried with its details next run.
    funds.set(id, { name: '', manager: '', category: '', ...funds.get(id), navDate, nav });

    if (funds.get(id).name === '') {
      funds.set(id, { ...funds.get(id), ...parseFundPage(await fetchText(`${BASE_URL}/reksadana/produk/${id}`)) });
    }
  };

  const scrapeAll = async (ids, label) => {
    failures.push(...await runPool({
      items: ids,
      worker: scrapeFund,
      concurrency: CONCURRENCY,
      label,
      describeItem: (id) => `Kontan ${id}`,
    }));
  };

  await scrapeAll([...funds.keys()], 'Known funds scraped');

  const scanEndId = () => Math.max(highestId() + LOOKAHEAD_IDS, isFirstRun ? FIRST_SCAN_END_ID : 0);

  for (let fromId = highestId() + 1; fromId <= scanEndId(); fromId += SCAN_CHUNK_SIZE) {
    const toId = Math.min(fromId + SCAN_CHUNK_SIZE - 1, scanEndId());
    const ids = Array.from({ length: toId - fromId + 1 }, (_, index) => fromId + index);

    await scrapeAll(ids, `New IDs ${fromId}-${toId} scanned`);
  }

  const bibitRows = await readCsvRows(BIBIT_FUNDS_FILE);
  const symbolsById = await writeFundIndex(funds, bibitRows);

  reportMatches('Kontan', funds.size, symbolsById, bibitRows);

  if (conflictingIds.length > 0) {
    console.log(`Skipped ${conflictingIds.length} funds with two different NAVs on one date: ${conflictingIds.sort((a, b) => a - b).join(', ')}`);
  }

  console.log(`${requestCount} requests in ${Math.round((Date.now() - startedAt) / 1000)} seconds`);

  if (failures.length > 0) {
    console.error(`${failures.length} funds failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
};

await main();

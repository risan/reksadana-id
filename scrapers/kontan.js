import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError, createTextFetcher, decodeHtml, matchBibitSymbols, readCsvRows, reportFailures, reportMatches, runPool, stopAfterForbidden, toCsv, writeFileAtomic } from './lib.js';

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
const MAX_FORBIDDEN_IN_A_ROW = 25;
const PROBE_ID = 8;

const { fetchText, getRequestCount } = createTextFetcher({
  headers: {
    Accept: 'text/html',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) reksadana-id-scraper',
  },
  timeoutMs: REQUEST_TIMEOUT_MS,
  delayMs: REQUEST_DELAY_MS,
});

const chartUrl = (id) => `${BASE_URL}/reksadana/get_chart_product/?produk_id=${id}&select=nab&periode=12&start_date=&end_date=`;

// GitHub's runners get HTTP 403 for every request, while a home connection works. Any other error means
// Kontan itself has a problem, which the run should not hide.
export const isBlockedByKontan = async (probeId) => {
  try {
    await fetchText(chartUrl(probeId));

    return false;
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) {
      return true;
    }

    throw error;
  }
};

// The chart endpoint answers with a page whose inline script declares two arrays and pushes every point
// into them. An unknown fund ID gives the same page with no pushes. A page without the declarations is
// something else (an error page, a changed template), so it fails instead of passing as an empty chart.
export const parseChart = (html) => {
  if (!/var\s+pausecontent\s*=\s*new Array\(\s*\)/.test(html) || !/var\s+data1\s*=\s*new Array\(\s*\)/.test(html)) {
    throw new Error('Response is not a Kontan chart page');
  }

  const pushedValues = (arrayName) => [...html.matchAll(new RegExp(`${arrayName}\\.push\\(\\s*(['"])(.*?)\\1\\s*\\)`, 'g'))].map((match) => match[2]);
  const dates = pushedValues('pausecontent');
  const values = pushedValues('data1');

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
  const symbolsById = matchBibitSymbols('kontan', sortedFunds, bibitRows);

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

  if (await isBlockedByKontan(PROBE_ID)) {
    console.log('::warning::Kontan refuses requests from this network (it blocks GitHub-hosted runners), so it was skipped and no data changed. Run `npm run scrape:kontan` from a home connection instead.');

    return;
  }

  const funds = await readStoredFunds();
  const isFullScan = funds.size === 0 || process.argv.includes('--full');
  const conflictingIds = [];
  const failures = [];

  await fs.mkdir(path.join(DATA_DIR, 'nav'), { recursive: true });

  const highestId = () => Math.max(0, ...funds.keys());

  // New values replace stored ones on the same date; older stored rows are kept,
  // so the history grows past the 12 months Kontan serves.
  const scrapeFund = async (id) => {
    const { rows, hasConflict } = parseChart(await fetchText(chartUrl(id)));

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

  // A block that starts in the middle of a run refuses every later request too.
  const { worker: scrapeFundUnlessBlocked, hasStopped: isBlocked } = stopAfterForbidden(scrapeFund, MAX_FORBIDDEN_IN_A_ROW);

  const scrapeAll = async (ids, label) => {
    failures.push(...await runPool({
      items: ids,
      worker: scrapeFundUnlessBlocked,
      concurrency: CONCURRENCY,
      label,
      describeItem: (id) => `Kontan ${id}`,
    }));
  };

  const knownIds = [...funds.keys()];
  let attemptedCount = knownIds.length;

  await scrapeAll(knownIds, 'Known funds scraped');

  const scanEndId = () => Math.max(highestId() + LOOKAHEAD_IDS, isFullScan ? FIRST_SCAN_END_ID : 0);

  for (let fromId = isFullScan ? 1 : highestId() + 1; fromId <= scanEndId() && !isBlocked(); fromId += SCAN_CHUNK_SIZE) {
    const toId = Math.min(fromId + SCAN_CHUNK_SIZE - 1, scanEndId());
    const ids = Array.from({ length: toId - fromId + 1 }, (_, index) => fromId + index).filter((id) => !funds.has(id));

    attemptedCount += ids.length;
    await scrapeAll(ids, `New IDs ${fromId}-${toId} scanned`);
  }

  const bibitRows = await readCsvRows(BIBIT_FUNDS_FILE);
  const symbolsById = await writeFundIndex(funds, bibitRows);

  reportMatches('Kontan', funds.size, symbolsById, bibitRows);

  if (conflictingIds.length > 0) {
    console.log(`Skipped ${conflictingIds.length} funds with two different NAVs on one date: ${conflictingIds.sort((a, b) => a - b).join(', ')}`);
  }

  console.log(`${getRequestCount()} requests in ${Math.round((Date.now() - startedAt) / 1000)} seconds`);

  if (isBlocked()) {
    console.error(`Kontan refused ${MAX_FORBIDDEN_IN_A_ROW} requests in a row with HTTP 403, so the run stopped early`);
    process.exitCode = 1;
  }

  reportFailures(failures, attemptedCount);
};

if (process.argv[1] === import.meta.filename) {
  await main();
}

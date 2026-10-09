import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError, decodeHtml, readFormFields, sleep, toCsv, withRetries, writeFileAtomic } from './lib.js';

const PAGE_URL = 'https://reksadana.ojk.go.id/Public/StatistikNABReksadanaPublicDetail.aspx';
const DATA_DIR = path.join(import.meta.dirname, '..', 'data', 'ojk', 'monthly');
const HEADER = ['manager', 'custodian', 'fund', 'type', 'currency', 'aum', 'units'];
const GRID_ID = 'ctl00$cpContent2$grdNABReksadana2';
// DevExpress callback arguments are length-prefixed: "PAGERONCLICK" (12 characters) with the argument
// "PSP-1" (5 characters), which asks the grid for a page size of -1, that is, all rows at once.
const SHOW_ALL_ROWS_COMMAND = '12|PAGERONCLICK5|PSP-1';
const HISTORY_MONTHS = 36;
// OJK revises the latest figures for a while, so the newest stored months are fetched again.
const REFRESHED_MONTHS = 2;
const REQUEST_PAUSE_MS = 3000;
const REQUEST_TIMEOUT_MS = 90 * 1000;

let requestCount = 0;

const fetchText = (url, options = {}) => withRetries(async () => {
  requestCount++;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'text/html,*/*',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) reksadana-id-scraper',
        ...options.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new HttpError(url, response.status, response.statusText);
    }

    return await response.text();
  } finally {
    await sleep(REQUEST_PAUSE_MS);
  }
});

// The page says "Page 1 of 214 (2136 items)", and "(0 items)" for a month OJK has not published yet.
export const parseItemCount = (html) => {
  const match = html.match(/\((\d+) items\)/);

  if (!match) {
    throw new Error('The page does not say how many funds it has');
  }

  return Number(match[1]);
};

// "514.581.765.130,65" is 514581765130.65.
const toNumberText = (text) => String(Number(text.replaceAll('.', '').replace(',', '.')));

// The callback answers with JavaScript that holds the grid's HTML in a string. Every fund is one table row
// of seven cells: manager, custodian, fund, type, currency, AUM, units.
export const parseCallbackRows = (callback) => [...callback.matchAll(/<tr id="[^"]*_DXDataRow\d+"[^>]*>(.*?)<\/tr>/gs)].map((row) => {
  const cells = [...row[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((cell) => decodeHtml(cell[1]));

  if (cells.length !== HEADER.length || !Number.isFinite(Number(toNumberText(cells[5]))) || !Number.isFinite(Number(toNumberText(cells[6])))) {
    throw new Error(`A fund row has ${cells.length} cells, or numbers that cannot be read`);
  }

  return [...cells.slice(0, 5), toNumberText(cells[5]), toNumberText(cells[6])];
});

// fetch() throws a TypeError("fetch failed") when no HTTP answer came back at all; the cause holds the reason.
const isNetworkError = (error) => error instanceof TypeError && error.message === 'fetch failed';

const describe = (error) => (error.cause?.code ? `${error.message} (${error.cause.code})` : error.message);

const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

// Returns null while OJK has not published the month.
const fetchMonth = async (year, month) => {
  const url = `${PAGE_URL}?year=${year}&month=${month}`;
  const page = await fetchText(url);
  const itemCount = parseItemCount(page);

  if (itemCount === 0) {
    return null;
  }

  const body = readFormFields(page);

  body.set('__CALLBACKID', GRID_ID);
  body.set('__CALLBACKPARAM', `c0:KV|2;[];GB|${SHOW_ALL_ROWS_COMMAND.length};${SHOW_ALL_ROWS_COMMAND};`);

  const rows = parseCallbackRows(await fetchText(url, { method: 'POST', body }));

  if (rows.length !== itemCount) {
    throw new Error(`${monthKey(year, month)}: the page lists ${itemCount} funds but the callback returned ${rows.length}`);
  }

  return rows;
};

// Funds sorted by name keep the file stable from one run to the next.
const sortRows = (rows) => rows.toSorted((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

// The months of the history window, oldest first. The newest month is last month: OJK publishes it after the 8th.
export const monthsInWindow = (today) => Array.from({ length: HISTORY_MONTHS }, (_, index) => {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - HISTORY_MONTHS + index, 1));

  return monthKey(date.getUTCFullYear(), date.getUTCMonth() + 1);
});

// A month is fetched when it is not stored yet, or is one of the newest stored months.
export const chooseMonths = (windowMonths, storedMonths) => {
  const refreshed = new Set([...storedMonths].sort().slice(-REFRESHED_MONTHS));

  return windowMonths.filter((month) => !storedMonths.has(month) || refreshed.has(month));
};

const main = async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const storedMonths = new Set((await fs.readdir(DATA_DIR)).filter((file) => file.endsWith('.csv')).map((file) => file.slice(0, -'.csv'.length)));
  const months = chooseMonths(monthsInWindow(new Date()), storedMonths);
  const failures = [];
  const networkFailures = [];

  // One month at a time: a month is about 1.8 MB, and OJK's server is slow.
  for (const month of months) {
    const [year, number] = month.split('-').map(Number);

    try {
      const rows = await fetchMonth(year, number);

      if (rows === null) {
        console.log(`${month}: not published yet`);
      } else {
        await writeFileAtomic(path.join(DATA_DIR, `${month}.csv`), toCsv(HEADER, sortRows(rows)));
        console.log(`${month}: ${rows.length} funds`);
      }
    } catch (error) {
      failures.push(`${month}: ${describe(error)}`);

      if (isNetworkError(error)) {
        networkFailures.push(month);
      }
    }
  }

  console.log(`${requestCount} requests`);

  // OJK's server does not answer GitHub's runners at all, while a home connection in Indonesia works.
  if (months.length > 0 && networkFailures.length === months.length) {
    console.log(`::warning::OJK did not answer from this network (${failures[0]}), so it was skipped and no data changed. Run \`npm run scrape:ojk\` from a home connection instead.`);

    return;
  }

  if (failures.length > 0) {
    console.error(`${failures.length} months failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
};

if (process.argv[1] === import.meta.filename) {
  await main();
}

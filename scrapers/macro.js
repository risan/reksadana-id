import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError, decodeHtml, mergeRowsByDate, readCsvRows, sleep, toCsv, withRetries, writeFileAtomic } from './lib.js';

const DATA_DIR = path.join(import.meta.dirname, '..', 'data', 'macro');
const JISDOR_URL = 'https://www.bi.go.id/biwebservice/wskursbi.asmx/getSubKursJisdor3';
const BI_RATE_URL = 'https://www.bi.go.id/id/statistik/indikator/bi-rate.aspx';
const INFLATION_URL = 'https://www.bi.go.id/id/statistik/indikator/data-inflasi.aspx';
const JISDOR_FIRST_DATE = '2013-01-01';
const JISDOR_RECENT_DAYS = 30;
const REQUEST_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 60 * 1000;
// The BI pages show 10 rows each, so the whole history is about 15 pages. The limit stops a pager that never ends.
const MAX_PAGES = 100;
// BI lists 0.00 % for 2002-12, before a year-on-year change exists; the real series starts a month later.
const INFLATION_FIRST_MONTH = '2003-01';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const INDONESIAN_MONTHS = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];

const USD_IDR = { file: 'usd-idr.csv', header: ['date', 'idr_per_usd'] };
const BI_RATE = { file: 'bi-rate.csv', header: ['date', 'rate'] };
const INFLATION = { file: 'inflation.csv', header: ['month', 'yoy_percent'] };

let requestCount = 0;

const fetchText = (url, options = {}) => withRetries(async () => {
  requestCount++;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'text/html,application/xml',
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
    await sleep(REQUEST_DELAY_MS);
  }
});

const toIsoDay = (date) => date.toISOString().slice(0, 10);

// JISDOR is the Jakarta Interbank Spot Dollar Rate. BI lists the buy and sell rate, and they are equal.
export const parseJisdorRows = (xml) => {
  const rows = [...xml.matchAll(/<Table [^>]*>(.*?)<\/Table>/gs)].map((table) => {
    const field = (name) => table[1].match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1].trim();

    return [field('tgl_subkursasing')?.slice(0, 10), Number(field('jual_subkursasing'))];
  });

  return rows.filter(([date, rate]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && rate > 0).map(([date, rate]) => [date, String(rate)]);
};

const fetchJisdorRows = async (startDate, endDate) => {
  const body = new URLSearchParams({ mts: 'USD', startDate, endDate });
  const xml = await fetchText(JISDOR_URL, { method: 'POST', body });
  const rows = parseJisdorRows(xml);

  if (rows.length === 0) {
    throw new Error('JISDOR answered without rows');
  }

  return rows;
};

// The cells of every table row that has data cells, as text.
export const parseTableRows = (html) => [...html.matchAll(/<tr>(.*?)<\/tr>/gs)]
  .map((row) => [...row[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((cell) => decodeHtml(cell[1].replace(/<[^>]*>/g, ''))))
  .filter((cells) => cells.length > 0);

const toMonthNumber = (name) => INDONESIAN_MONTHS.indexOf(name.toLowerCase()) + 1;

const toPercentText = (text) => {
  const percent = Number(text.replace('%', '').trim());

  return Number.isFinite(percent) && /\d/.test(text) ? String(percent) : null;
};

// The rows of the BI-Rate page: ["23 September 2026", "5.75 %", ...]. BI lists the day of the
// Board of Governors' decision, which is not always the day the rate took effect.
export const parseBiRateRows = (html) => parseTableRows(html).flatMap(([dateText, rateText]) => {
  const [day, monthName, year] = (dateText ?? '').split(' ');
  const month = toMonthNumber(monthName ?? '');
  const rate = toPercentText(rateText ?? '');

  if (!/^\d{1,2}$/.test(day) || !/^\d{4}$/.test(year) || month === 0 || rate === null) {
    return [];
  }

  return [[`${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`, rate]];
});

// The rows of the inflation page: ["Agustus 2026", "3.19 %"].
export const parseInflationRows = (html) => parseTableRows(html).flatMap(([monthText, rateText]) => {
  const [monthName, year] = (monthText ?? '').split(' ');
  const month = toMonthNumber(monthName ?? '');
  const percent = toPercentText(rateText ?? '');

  if (!/^\d{4}$/.test(year) || month === 0 || percent === null) {
    return [];
  }

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  return monthKey < INFLATION_FIRST_MONTH ? [] : [[monthKey, percent]];
});

// The pager of a BI table is an ASP.NET WebForms control: a page link posts the whole form back with
// `__EVENTTARGET` set. The next page is the link with the next number, or the "..." link after the current number.
export const findNextPageTarget = (html) => {
  const active = html.match(/<span class="page-link--custom active">(\d+)<\/span>/);

  if (!active) {
    return null;
  }

  const links = [...html.matchAll(/<a [^>]*href="javascript:__doPostBack\(&#39;([^&]*DataPager[^&]*)&#39;,&#39;&#39;\)"[^>]*>([^<]*)<\/a>/g)]
    .filter((link) => link.index > active.index)
    .map((link) => ({ target: link[1], text: link[2].trim() }));
  const nextNumber = String(Number(active[1]) + 1);

  return (links.find((link) => link.text === nextNumber) ?? links.findLast((link) => link.text === '...'))?.target ?? null;
};

// Every field of the page's form that a browser would send, except the buttons.
export const readFormFields = (html) => {
  const fields = new URLSearchParams();

  for (const [tag] of html.matchAll(/<input[^>]*>/g)) {
    const name = tag.match(/name="([^"]+)"/)?.[1];
    const type = tag.match(/type="([^"]+)"/)?.[1];

    if (name && !['submit', 'button', 'image', 'checkbox', 'radio'].includes(type)) {
      fields.set(name, decodeHtml(tag.match(/value="([^"]*)"/)?.[1] ?? ''));
    }
  }

  return fields;
};

// All the pages of the table when `allPages`, else only the first one (the newest rows).
const fetchPagedRows = async (url, parseRows, allPages) => {
  const rows = [];
  let html = await fetchText(url);

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageRows = parseRows(html);

    if (pageRows.length === 0) {
      throw new Error(`${url} page ${page} has no rows`);
    }

    rows.push(...pageRows);

    const target = allPages ? findNextPageTarget(html) : null;

    if (target === null) {
      return rows;
    }

    const body = readFormFields(html);

    body.set('__EVENTTARGET', target);
    body.set('__EVENTARGUMENT', '');
    html = await fetchText(url, { method: 'POST', body });
  }

  throw new Error(`${url} has more than ${MAX_PAGES} pages`);
};

const updateFile = async ({ file, header }, fetchRows) => {
  const filePath = path.join(DATA_DIR, file);
  const storedRows = await readCsvRows(filePath);
  const rows = mergeRowsByDate(storedRows, await fetchRows(storedRows.length === 0));

  await writeFileAtomic(filePath, toCsv(header, rows));

  console.log(`${file}: ${rows.length - storedRows.length} new rows, ${rows.length} in total, newest ${rows.at(-1)[0]}`);
};

const runTask = async (name, task) => {
  try {
    await task();

    return null;
  } catch (error) {
    return `${name}: ${error.message}`;
  }
};

const main = async () => {
  const today = new Date();
  const recentStart = toIsoDay(new Date(today.getTime() - JISDOR_RECENT_DAYS * DAY_IN_MS));

  await fs.mkdir(DATA_DIR, { recursive: true });

  const failures = [
    await runTask('USD/IDR', () => updateFile(USD_IDR, (isFirstRun) => fetchJisdorRows(isFirstRun ? JISDOR_FIRST_DATE : recentStart, toIsoDay(today)))),
    await runTask('BI-Rate', () => updateFile(BI_RATE, (isFirstRun) => fetchPagedRows(BI_RATE_URL, parseBiRateRows, isFirstRun))),
    await runTask('Inflation', () => updateFile(INFLATION, (isFirstRun) => fetchPagedRows(INFLATION_URL, parseInflationRows, isFirstRun))),
  ].filter(Boolean);

  console.log(`${requestCount} requests`);

  if (failures.length > 0) {
    console.error(`${failures.length} series failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
};

if (process.argv[1] === import.meta.filename) {
  await main();
}

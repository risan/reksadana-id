import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError, matchBibitSymbols, readCsvRows, reportMatches, runPool, sleep, toCsv, withRetries, writeFileAtomic } from './lib.js';

const BASE_URL = 'https://www.makmur.id';
const DATA_DIR = path.join(import.meta.dirname, '..', 'data', 'makmur');
const BIBIT_FUNDS_FILE = path.join(import.meta.dirname, '..', 'data', 'bibit', 'funds.csv');
const CONCURRENCY = 2;
const REQUEST_DELAY_MS = 200;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const FUND_HEADER = ['makmur_id', 'name', 'manager', 'category', 'route_category', 'url', 'currency', 'last_price', 'as_of', 'last_aum', 'inception_date', 'bibit_symbol'];

let requestCount = 0;

const fetchText = (url) => withRetries(async () => {
  requestCount++;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xml',
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

const parseSitemapUrls = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]);

// The fund pages are the only public source. The app API needs signed requests, so it is not used.
const fetchFundPageUrls = async () => {
  const sitemapUrls = parseSitemapUrls(await fetchText(`${BASE_URL}/sitemap-index.xml`));
  const fundSitemapUrl = sitemapUrls.find((url) => url.endsWith('/sitemap-all-reksadana.xml'));

  if (!fundSitemapUrl) {
    throw new Error('The sitemap index has no reksadana sitemap');
  }

  const pageUrls = parseSitemapUrls(await fetchText(fundSitemapUrl)).filter((url) => url.includes('/reksadana/'));

  if (pageUrls.length === 0) {
    throw new Error('The reksadana sitemap has no fund pages');
  }

  return pageUrls;
};

// Next.js renders the page from a JSON blob it embeds in the HTML. It holds the whole fund.
export const parseFundPage = (html) => {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);

  if (!match) {
    throw new Error('Fund page has no __NEXT_DATA__');
  }

  const { data, routeCategory } = JSON.parse(match[1]).props?.pageProps ?? {};

  if (!data?._id || !data.name || !data.url || !routeCategory) {
    throw new Error('Fund page has no fund data');
  }

  return { ...data, routeCategory };
};

// Dates come as numbers like 20260930.
export const toIsoDate = (yyyymmdd) => {
  const text = String(yyyymmdd ?? '');

  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : '';
};

const toFundRow = (fund, symbol) => [
  fund._id,
  fund.name,
  fund.manager?.name,
  fund.category,
  fund.routeCategory,
  fund.url,
  fund.currency,
  fund.lastPrice,
  toIsoDate(fund.asof),
  fund.lastAum,
  toIsoDate(fund.inceptionDate),
  symbol,
];

const readStoredFunds = async () => {
  const rows = await readCsvRows(path.join(DATA_DIR, 'funds.csv'));

  return new Map(rows.map((row) => [row[0], row]));
};

const main = async () => {
  const startedAt = Date.now();
  const rowsById = await readStoredFunds();
  const pageUrls = await fetchFundPageUrls();

  console.log(`Sitemap: ${pageUrls.length} fund pages`);

  await fs.mkdir(path.join(DATA_DIR, 'funds'), { recursive: true });

  // Every page is fetched every run: the page is the only place the latest price and returns are.
  const scrapeFund = async (pageUrl) => {
    const fund = parseFundPage(await fetchText(pageUrl));

    await writeFileAtomic(path.join(DATA_DIR, 'funds', `${fund._id}.json`), `${JSON.stringify(fund, null, 2)}\n`);
    rowsById.set(fund._id, toFundRow(fund, ''));
  };

  const failures = await runPool({
    items: pageUrls,
    worker: scrapeFund,
    concurrency: CONCURRENCY,
    label: 'Funds scraped',
    describeItem: (pageUrl) => `Makmur ${pageUrl}`,
  });

  const bibitRows = await readCsvRows(BIBIT_FUNDS_FILE);
  const sortedRows = [...rowsById.values()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const symbolsById = matchBibitSymbols(sortedRows.map((row) => [row[0], { name: row[1], manager: row[2] }]), bibitRows);
  const rows = sortedRows.map((row) => [...row.slice(0, -1), symbolsById.get(row[0])]);

  await writeFileAtomic(path.join(DATA_DIR, 'funds.csv'), toCsv(FUND_HEADER, rows));

  reportMatches('Makmur', rows.length, symbolsById, bibitRows);
  console.log(`${requestCount} requests in ${Math.round((Date.now() - startedAt) / 1000)} seconds`);

  if (failures.length > 0) {
    console.error(`${failures.length} funds failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
};

if (process.argv[1] === import.meta.filename) {
  await main();
}

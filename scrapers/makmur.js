import fs from 'node:fs/promises';
import path from 'node:path';
import { createTextFetcher, matchBibitSymbols, readCsvRows, reportFailures, reportMatches, runPool, toCsv, writeFileAtomic } from './lib.js';

const BASE_URL = 'https://www.makmur.id';
const DATA_DIR = path.join(import.meta.dirname, '..', 'data', 'makmur');
const BIBIT_FUNDS_FILE = path.join(import.meta.dirname, '..', 'data', 'bibit', 'funds.csv');
const CONCURRENCY = 2;
const REQUEST_DELAY_MS = 200;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const FUND_HEADER = ['makmur_id', 'name', 'manager', 'category', 'route_category', 'url', 'currency', 'last_price', 'as_of', 'last_aum', 'inception_date', 'bibit_symbol'];

const { fetchText, getRequestCount } = createTextFetcher({
  headers: {
    Accept: 'text/html,application/xml',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) reksadana-id-scraper',
  },
  timeoutMs: REQUEST_TIMEOUT_MS,
  delayMs: REQUEST_DELAY_MS,
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

  if (![data?._id, data?.name, data?.url, routeCategory].every((value) => typeof value === 'string' && value !== '')) {
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
  typeof fund.manager?.name === 'string' ? fund.manager.name : '',
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

// The index lists the funds in the sitemap. A stored fund that left the sitemap is dropped (its JSON file stays),
// but one whose page failed this run is kept, so a bad run does not make funds disappear.
export const keepFundsOfFailedPages = (refreshedRowsById, storedRowsById, failedPageUrls) => {
  const rowsById = new Map(refreshedRowsById);

  for (const [id, row] of storedRowsById) {
    if (!rowsById.has(id) && failedPageUrls.some((pageUrl) => pageUrl.endsWith(`/${row[5]}`))) {
      rowsById.set(id, row);
    }
  }

  return rowsById;
};

const main = async () => {
  const startedAt = Date.now();
  const storedRowsById = await readStoredFunds();
  const rowsById = new Map();
  const failedPageUrls = [];
  const pageUrls = await fetchFundPageUrls();

  console.log(`Sitemap: ${pageUrls.length} fund pages`);

  await fs.mkdir(path.join(DATA_DIR, 'funds'), { recursive: true });

  // Every page is fetched every run: the page is the only place the latest price and returns are.
  const scrapeFund = async (pageUrl) => {
    try {
      const fund = parseFundPage(await fetchText(pageUrl));

      await writeFileAtomic(path.join(DATA_DIR, 'funds', `${fund._id}.json`), `${JSON.stringify(fund, null, 2)}\n`);
      rowsById.set(fund._id, toFundRow(fund, ''));
    } catch (error) {
      failedPageUrls.push(pageUrl);

      throw error;
    }
  };

  const failures = await runPool({
    items: pageUrls,
    worker: scrapeFund,
    concurrency: CONCURRENCY,
    label: 'Funds scraped',
    describeItem: (pageUrl) => `Makmur ${pageUrl}`,
  });

  const bibitRows = await readCsvRows(BIBIT_FUNDS_FILE);
  const sortedRows = [...keepFundsOfFailedPages(rowsById, storedRowsById, failedPageUrls).values()].sort((a, b) => a[1].localeCompare(b[1], 'en') || a[0].localeCompare(b[0]));
  const symbolsById = matchBibitSymbols('makmur', sortedRows.map((row) => [row[0], { name: row[1], manager: row[2] }]), bibitRows);
  const rows = sortedRows.map((row) => [...row.slice(0, -1), symbolsById.get(row[0])]);

  await writeFileAtomic(path.join(DATA_DIR, 'funds.csv'), toCsv(FUND_HEADER, rows));

  reportMatches('Makmur', rows.length, symbolsById, bibitRows);
  console.log(`${getRequestCount()} requests in ${Math.round((Date.now() - startedAt) / 1000)} seconds`);

  reportFailures(failures, pageUrls.length);
};

if (process.argv[1] === import.meta.filename) {
  await main();
}

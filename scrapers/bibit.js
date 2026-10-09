import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError, readCsvRows, reportFailures, runPool, toCsv, withRetries, writeFileAtomic } from './lib.js';

const API_URL = 'https://api.bibit.id';
const DATA_DIR = path.join(import.meta.dirname, '..', 'data', 'bibit');
const PAGE_SIZE = 50;
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 60 * 1000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const NAV_HEADER = ['date', 'nav', 'nav_adjusted'];

// The API wraps most payloads as hex: a 16-byte IV, the AES-256-CBC ciphertext,
// and the 32-character key itself as the last 32 characters.
const decrypt = (payload) => {
  const iv = Buffer.from(payload.slice(0, 32), 'hex');
  const key = Buffer.from(payload.slice(-32), 'utf8');
  const encrypted = Buffer.from(payload.slice(32, -32), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return JSON.parse(decrypted.toString('utf8'));
};

const request = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Origin: 'https://app.bibit.id',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) reksadana-id-scraper',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    const message = text.startsWith('{') ? JSON.parse(text).message : response.statusText;

    throw new HttpError(url, response.status, message);
  }

  return response.json();
};

const get = async (pathname, params = {}) => {
  const url = new URL(pathname, API_URL);

  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  return withRetries(async () => {
    const body = await request(url);

    return {
      data: typeof body.data === 'string' ? decrypt(body.data) : body.data,
      meta: body.meta,
    };
  });
};

// Keep the API's default order: sorting by name or AUM has ties that repeat
// or skip funds across pages.
const fetchFundList = async (tradable) => {
  const funds = [];

  for (let page = 1; ; page++) {
    const { data, meta } = await get('/products/filter', {
      tradable,
      currency: 'all',
      limit: PAGE_SIZE,
      page,
    });

    funds.push(...data);
    console.log(`Fund list (tradable=${tradable}): ${funds.length}/${meta.total_rows}`);

    if (data.length < PAGE_SIZE) {
      const symbols = new Set(funds.map((fund) => fund.symbol));

      if (symbols.size !== meta.total_rows) {
        throw new Error(`Expected ${meta.total_rows} unique funds, got ${symbols.size}`);
      }

      return funds;
    }
  }
};

// The API has no "all funds" filter: tradable=1 lists the funds you can buy
// in the app, and tradable=0 lists every other fund. A fund that changes
// status between the two calls can show up in both.
const fetchAllFunds = async () => {
  const funds = [...await fetchFundList(1), ...await fetchFundList(0)];
  const fundsBySymbol = new Map(funds.map((fund) => [fund.symbol, fund]));

  return [...fundsBySymbol.values()];
};

const writeJson = (file, data) => writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n');

const readJson = async (file) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
};

// Pick the smallest chart period that still overlaps the rows we already have.
const chartPeriodSince = (lastDate) => {
  if (!lastDate) {
    return 'ALL';
  }

  const ageInDays = (Date.now() - Date.parse(lastDate)) / DAY_IN_MS;

  if (ageInDays < 25) {
    return '1M';
  }

  if (ageInDays < 350) {
    return '1Y';
  }

  return 'ALL';
};

const fetchChart = async (pathname, period) => {
  try {
    const { data } = await get(pathname, { period });

    return data.chart;
  } catch (error) {
    // A few delisted funds answer 422 "product not found" instead of an empty chart.
    if (error instanceof HttpError && error.status === 422 && error.message.includes('tidak ditemukan')) {
      return [];
    }

    throw error;
  }
};

// Each chart is stored as a CSV keyed by date. Rows from the API replace
// stored rows on the same date; older stored rows are kept.
const updateChart = async ({ file, pathname, header, toRow, forceFull }) => {
  const storedRows = await readCsvRows(file);
  const period = forceFull ? 'ALL' : chartPeriodSince(storedRows.at(-1)?.[0]);
  const chart = await fetchChart(pathname, period);

  if (chart.length === 0) {
    return false;
  }

  const rowsByDate = new Map(period === 'ALL' ? [] : storedRows.map((row) => [row[0], row]));

  for (const point of chart) {
    rowsByDate.set(point.formated_date, toRow(point));
  }

  const rows = [...rowsByDate.values()].sort((a, b) => a[0].localeCompare(b[0]));

  await writeFileAtomic(file, toCsv(header, rows));

  return true;
};

const fileExists = (file) => fs.access(file).then(() => true, () => false);

// Document links come in two shapes. The region form of the S3 host ("bibit.s3.ap-southeast-1.amazonaws.com") is
// what older files carry, and it now answers 403 while the same file is served from Bibit's CDN host. The plain
// form ("bibit.s3.amazonaws.com") is what newer files carry, and only that one serves them: the CDN host answers 403.
export const withWorkingUrl = (document) => {
  if (!document.file) {
    return document;
  }

  return { ...document, file: document.file.replace(/^https:\/\/bibit\.s3[.-][a-z0-9-]+\.amazonaws\.com\//, 'https://assets.bibit.id/') };
};

const DOCUMENT_CHECK_TIMEOUT_MS = 30 * 1000;

const statusOf = async (url) => {
  try {
    return (await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(DOCUMENT_CHECK_TIMEOUT_MS) })).status;
  } catch {
    return null;
  }
};

// A link that carries its folder as "%2F" (".../factsheets%2Fname.pdf") says nothing reliable about the host: the CDN
// host serves about half of those files and the S3 host the other half. So ask the CDN host, and move the link to the
// S3 host when the CDN host refuses and the S3 host serves the file. Anything else leaves the link as it is.
export const withServingHost = async (document) => {
  if (!document.file?.startsWith('https://assets.bibit.id/') || !document.file.includes('%2F')) {
    return document;
  }

  if (![403, 404].includes(await statusOf(document.file))) {
    return document;
  }

  const s3File = document.file.replace('https://assets.bibit.id/', 'https://bibit.s3.amazonaws.com/').replace('%2F', '/');

  return await statusOf(s3File) === 200 ? { ...document, file: s3File } : document;
};

const withWorkingUrls = async (documents) => {
  const working = [];

  for (const document of documents) {
    working.push(await withServingHost(withWorkingUrl(document)));
  }

  return working;
};

// Bibit has no NAV chart for most funds you cannot buy in the app, but the fund
// list still carries their latest NAV. Saving it on every run builds their history.
const saveNavFromList = async (file, nav) => {
  const storedRows = await readCsvRows(file);

  if (storedRows.some((row) => row[0] === nav.date)) {
    return;
  }

  const rows = [...storedRows, [nav.date, nav.value, '']].sort((a, b) => a[0].localeCompare(b[0]));

  await writeFileAtomic(file, toCsv(NAV_HEADER, rows));
};

// The fund file from the previous run tells us which charts have new data.
// It is written last, so a fund that failed halfway is retried in full next run.
const scrapeFund = async (fund) => {
  const { symbol } = fund;
  const { sort_value, ...fundData } = fund;
  const fundFile = path.join(DATA_DIR, 'funds', `${symbol}.json`);
  const navFile = path.join(DATA_DIR, 'nav', `${symbol}.csv`);
  const dividendsFile = path.join(DATA_DIR, 'dividends', `${symbol}.json`);
  const documentsFile = path.join(DATA_DIR, 'documents', `${symbol}.json`);
  const previous = await readJson(fundFile);

  let dividends = null;
  let dividendsChanged = false;

  if (fund.is_has_dividend) {
    ({ data: dividends } = await get(`/products/${symbol}/dividends`));
    dividendsChanged = JSON.stringify(dividends) !== JSON.stringify(await readJson(dividendsFile));
  }

  const navChanged = Boolean(fund.nav?.date) && (fund.nav.date !== previous?.nav?.date || !(await fileExists(navFile)));
  const hasListRows = (await readCsvRows(navFile)).some((row) => row[2] === '');
  let navUpdated = false;

  // A new dividend rescales every past adjusted NAV, and rows saved from the fund list
  // should give way to the full chart once Bibit has one, so both need the full history.
  if (dividendsChanged || navChanged) {
    navUpdated = await updateChart({
      file: navFile,
      pathname: `/products/${symbol}/chart`,
      header: NAV_HEADER,
      toRow: (point) => [point.formated_date, point.value, point.value_adjusted],
      forceFull: dividendsChanged || hasListRows,
    });
  }

  if (navChanged && !navUpdated && fund.nav.value !== null) {
    await saveNavFromList(navFile, fund.nav);
  }

  const aumChanged = fund.aum?.date !== previous?.aum?.date;

  // Factsheets come out monthly, like the AUM figure, so refresh documents on the same beat.
  if (aumChanged || !(await fileExists(documentsFile))) {
    const { data: factsheets } = await get(`/products/${symbol}/factsheets`);
    const { data: prospectus } = await get(`/products/${symbol}/prospectus`);

    await writeJson(documentsFile, {
      factsheets: await withWorkingUrls(factsheets),
      prospectus: await withWorkingUrls(prospectus),
    });
  }

  const switchablesFile = path.join(DATA_DIR, 'switchables', `${symbol}.json`);
  const switchablesStale = aumChanged || previous?.tradeable !== 1 || !(await fileExists(switchablesFile));

  if (fund.tradeable === 1 && switchablesStale) {
    const { data: switchables } = await get(`/products/${symbol}/switchables`);

    await writeJson(switchablesFile, switchables);
  }

  if (aumChanged) {
    await updateChart({
      file: path.join(DATA_DIR, 'aum', `${symbol}.csv`),
      pathname: `/products/${symbol}/chart/aum`,
      header: ['date', 'aum'],
      toRow: (point) => [point.formated_date, point.value],
      forceFull: false,
    });
  }

  // Save new dividends only once the full NAV refresh has landed, or the next run would skip it.
  if (dividendsChanged && navUpdated) {
    await writeJson(dividendsFile, dividends);
  }

  await writeJson(fundFile, fundData);
};

const writeFundIndex = (funds) => {
  const header = [
    'symbol', 'name', 'type', 'investment_manager', 'currency', 'sharia', 'etf', 'index',
    'tradeable', 'status', 'nav_first_date', 'nav_date', 'nav', 'aum', 'expense_ratio',
  ];

  // The API order shifts between runs, so sort to keep git diffs small.
  const sortedFunds = funds.toSorted((a, b) => a.symbol.localeCompare(b.symbol, 'en', { numeric: true }));

  const rows = sortedFunds.map((fund) => [
    fund.symbol,
    fund.name,
    fund.type,
    fund.investment_manager?.name,
    fund.currency_exchange?.currency,
    fund.sharia,
    fund.etf,
    fund.index,
    fund.tradeable,
    fund.status,
    fund.nav?.first_date,
    fund.nav?.date,
    fund.nav?.value,
    fund.aum?.value,
    fund.expenseratio?.percentage,
  ]);

  return writeFileAtomic(path.join(DATA_DIR, 'funds.csv'), toCsv(header, rows));
};

const main = async () => {
  for (const dir of ['funds', 'nav', 'aum', 'dividends', 'documents', 'switchables']) {
    await fs.mkdir(path.join(DATA_DIR, dir), { recursive: true });
  }

  const { data: types } = await get('/products/types');

  await writeJson(path.join(DATA_DIR, 'types.json'), types);

  const onlySymbols = process.argv.slice(2);
  const allFunds = await fetchAllFunds();
  const funds = onlySymbols.length > 0 ? allFunds.filter((fund) => onlySymbols.includes(fund.symbol)) : allFunds;

  await writeFundIndex(allFunds);

  const failures = await runPool({
    items: funds,
    worker: scrapeFund,
    concurrency: CONCURRENCY,
    label: 'Funds scraped',
    describeItem: (fund) => fund.symbol,
  });

  reportFailures(failures, funds.length);
};

if (process.argv[1] === import.meta.filename) {
  await main();
}

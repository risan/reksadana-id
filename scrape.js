import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const API_URL = 'https://api.bibit.id';
const DATA_DIR = path.join(import.meta.dirname, 'data');
const PAGE_SIZE = 50;
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 60 * 1000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class HttpError extends Error {
  constructor(url, status, message) {
    super(`GET ${url} failed with ${status}: ${message}`);
    this.status = status;
  }
}

const request = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Origin: 'https://app.bibit.id',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) bibit-reksadana-scraper',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new HttpError(url, response.status, body.message);
  }

  return body;
};

const get = async (pathname, params = {}) => {
  const url = new URL(pathname, API_URL);

  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  for (let attempt = 1; ; attempt++) {
    try {
      const body = await request(url);

      return {
        data: typeof body.data === 'string' ? decrypt(body.data) : body.data,
        meta: body.meta,
      };
    } catch (error) {
      // Timeouts, dropped connections, and truncated bodies are worth a retry too.
      const retryable = !(error instanceof HttpError) || error.status === 429 || error.status >= 500;

      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw error;
      }

      await sleep(2 ** attempt * 1000);
    }
  }
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

// Write to a temporary file first, so an interrupted run never leaves a half-written file.
const writeFileAtomic = async (file, text) => {
  const temporaryFile = `${file}.tmp`;

  await fs.writeFile(temporaryFile, text);
  await fs.rename(temporaryFile, file);
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

const toCsvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);

  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
};

const toCsv = (header, rows) => [header, ...rows].map((row) => row.map(toCsvCell).join(',')).join('\n') + '\n';

const readCsvRows = async (file) => {
  try {
    const text = await fs.readFile(file, 'utf8');

    return text.trim().split('\n').slice(1).map((line) => line.split(','));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
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
    if (error instanceof HttpError && error.status === 422) {
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
    return;
  }

  const rowsByDate = new Map(period === 'ALL' ? [] : storedRows.map((row) => [row[0], row]));

  for (const point of chart) {
    rowsByDate.set(point.formated_date, toRow(point));
  }

  const rows = [...rowsByDate.values()].sort((a, b) => a[0].localeCompare(b[0]));

  await writeFileAtomic(file, toCsv(header, rows));
};

// The fund file from the previous run tells us which charts have new data.
// It is written last, so a fund that failed halfway is retried in full next run.
const scrapeFund = async (fund) => {
  const { symbol } = fund;
  const { sort_value, ...fundData } = fund;
  const fundFile = path.join(DATA_DIR, 'funds', `${symbol}.json`);
  const dividendsFile = path.join(DATA_DIR, 'dividends', `${symbol}.json`);
  const previous = await readJson(fundFile);

  let dividends = null;
  let dividendsChanged = false;

  if (fund.is_has_dividend) {
    ({ data: dividends } = await get(`/products/${symbol}/dividends`));
    dividendsChanged = JSON.stringify(dividends) !== JSON.stringify(await readJson(dividendsFile));
  }

  // A new dividend rescales every past adjusted NAV, so it needs the full history again.
  if (dividendsChanged || fund.nav?.date !== previous?.nav?.date) {
    await updateChart({
      file: path.join(DATA_DIR, 'nav', `${symbol}.csv`),
      pathname: `/products/${symbol}/chart`,
      header: ['date', 'nav', 'nav_adjusted'],
      toRow: (point) => [point.formated_date, point.value, point.value_adjusted],
      forceFull: dividendsChanged,
    });
  }

  if (fund.aum?.date !== previous?.aum?.date) {
    await updateChart({
      file: path.join(DATA_DIR, 'aum', `${symbol}.csv`),
      pathname: `/products/${symbol}/chart/aum`,
      header: ['date', 'aum'],
      toRow: (point) => [point.formated_date, point.value],
      forceFull: false,
    });
  }

  if (dividendsChanged) {
    await writeJson(dividendsFile, dividends);
  }

  await writeJson(fundFile, fundData);
};

const runPool = async (items, worker) => {
  let next = 0;
  let done = 0;
  const failures = [];

  const runWorker = async () => {
    while (next < items.length) {
      const item = items[next++];

      try {
        await worker(item);
      } catch (error) {
        failures.push(`${item.symbol}: ${error.message}`);
      }

      done++;

      if (done % 100 === 0 || done === items.length) {
        console.log(`Funds scraped: ${done}/${items.length}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, runWorker));

  return failures;
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
  for (const dir of ['funds', 'nav', 'aum', 'dividends']) {
    await fs.mkdir(path.join(DATA_DIR, dir), { recursive: true });
  }

  const { data: types } = await get('/products/types');

  await writeJson(path.join(DATA_DIR, 'types.json'), types);

  const onlySymbols = process.argv.slice(2);
  const allFunds = await fetchAllFunds();
  const funds = onlySymbols.length > 0 ? allFunds.filter((fund) => onlySymbols.includes(fund.symbol)) : allFunds;

  await writeFundIndex(allFunds);

  const failures = await runPool(funds, scrapeFund);

  if (failures.length > 0) {
    console.error(`${failures.length} funds failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
};

await main();

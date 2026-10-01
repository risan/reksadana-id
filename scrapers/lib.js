import fs from 'node:fs/promises';

const MAX_ATTEMPTS = 5;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(url, status, message) {
    super(`GET ${url} failed with ${status}: ${message}`);
    this.status = status;
  }
}

// Timeouts, dropped connections, and truncated bodies are worth a retry too.
export const withRetries = async (task) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      const retryable = !(error instanceof HttpError) || error.status === 429 || error.status >= 500;

      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw error;
      }

      await sleep(2 ** attempt * 1000);
    }
  }
};

// Write to a temporary file first, so an interrupted run never leaves a half-written file.
export const writeFileAtomic = async (file, text) => {
  const temporaryFile = `${file}.tmp`;

  await fs.writeFile(temporaryFile, text);
  await fs.rename(temporaryFile, file);
};

const toCsvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);

  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
};

export const toCsv = (header, rows) => [header, ...rows].map((row) => row.map(toCsvCell).join(',')).join('\n') + '\n';

// Handles quoted fields with commas, escaped quotes, and line breaks.
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

// Rows without the header line. A missing file counts as no rows.
export const readCsvRows = async (file) => {
  try {
    return parseCsv(await fs.readFile(file, 'utf8')).slice(1);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
};

// Runs `worker` over `items` with a fixed number of parallel workers.
// Returns one message per item that threw, so one bad item never stops the run.
export const runPool = async ({ items, worker, concurrency, label, describeItem }) => {
  let next = 0;
  let done = 0;
  const failures = [];

  const runWorker = async () => {
    while (next < items.length) {
      const item = items[next++];

      try {
        await worker(item);
      } catch (error) {
        failures.push(`${describeItem(item)}: ${error.message}`);
      }

      done++;

      if (done % 100 === 0 || done === items.length) {
        console.log(`${label}: ${done}/${items.length}`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, runWorker));

  return failures;
};

export const decodeHtml = (text) => text
  .replaceAll('&quot;', '"')
  .replaceAll('&#039;', "'")
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&amp;', '&')
  .trim();

const BIBIT_SYMBOL_COLUMN = 0;
const BIBIT_NAME_COLUMN = 1;
const BIBIT_MANAGER_COLUMN = 3;
const BIBIT_TRADEABLE_COLUMN = 8;
const BIBIT_NAV_DATE_COLUMN = 11;
const RECENT_NAV_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Names differ in case, punctuation, and the "reksa dana" prefix. Nothing fuzzier is safe.
const normalizeName = (name) => name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(reksa dana|reksadana|rd)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Bibit writes "Name, PT" and Kontan writes "PT. Name".
const normalizeManager = (manager) => manager
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(pt|tbk|persero)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isSameManager = (otherManager, bibitManager) => {
  const other = normalizeManager(otherManager);
  const bibit = normalizeManager(bibitManager);

  if (other === '') {
    return true;
  }

  return bibit !== '' && (other.includes(bibit) || bibit.includes(other));
};

// `funds` is a list of [id, { name, manager }]. A fund matches a Bibit fund only when the
// normalized name is unique on both sides and the managers are compatible.
export const matchBibitSymbols = (funds, bibitRows) => {
  const bibitByName = Map.groupBy(bibitRows, (row) => normalizeName(row[BIBIT_NAME_COLUMN]));
  const fundsByName = Map.groupBy(funds, ([, fund]) => normalizeName(fund.name));
  const symbolsById = new Map();

  for (const [id, fund] of funds) {
    const name = normalizeName(fund.name);
    const candidates = bibitByName.get(name) ?? [];

    if (name !== '' && candidates.length === 1 && fundsByName.get(name).length === 1 && isSameManager(fund.manager, candidates[0][BIBIT_MANAGER_COLUMN])) {
      symbolsById.set(id, candidates[0][BIBIT_SYMBOL_COLUMN]);
    }
  }

  return symbolsById;
};

export const reportMatches = (sourceName, fundCount, symbolsById, bibitRows) => {
  const bibitBySymbol = new Map(bibitRows.map((row) => [row[BIBIT_SYMBOL_COLUMN], row]));
  const matchedRows = [...symbolsById.values()].map((symbol) => bibitBySymbol.get(symbol));
  const notTradeable = matchedRows.filter((row) => row[BIBIT_TRADEABLE_COLUMN] !== '1');
  const recentSince = new Date(Date.now() - RECENT_NAV_DAYS * DAY_IN_MS).toISOString().slice(0, 10);
  const recent = notTradeable.filter((row) => row[BIBIT_NAV_DATE_COLUMN] >= recentSince);

  console.log(`${sourceName} funds: ${fundCount}, matched to Bibit: ${symbolsById.size}, unmatched: ${fundCount - symbolsById.size}`);
  console.log(`Bibit funds with a ${sourceName} match: ${matchedRows.length} (${notTradeable.length} not buyable, ${recent.length} of those with a Bibit NAV in the last ${RECENT_NAV_DAYS} days)`);
};

import fs from 'node:fs/promises';
import FUND_ALIASES from './fund-aliases.json' with { type: 'json' };

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

// Rows as objects keyed by the header line. A missing file counts as no rows.
export const readCsvRecords = async (file) => {
  try {
    const [header, ...rows] = parseCsv(await fs.readFile(file, 'utf8'));

    return rows.map((row) => Object.fromEntries(header.map((column, index) => [column, row[index] ?? ''])));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
};

// A new row replaces the stored row of the same date, column by column. A missing value in a new row
// never erases the stored value of that column.
export const mergeRowsByDate = (storedRows, newRows) => {
  const rowsByDate = new Map(storedRows.map((row) => [row[0], row]));

  for (const row of newRows) {
    const storedRow = rowsByDate.get(row[0]);

    rowsByDate.set(row[0], storedRow ? row.map((value, column) => (value === '' ? storedRow[column] ?? '' : value)) : row);
  }

  return [...rowsByDate.values()].sort((a, b) => a[0].localeCompare(b[0]));
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

const BIBIT_SYMBOL_COLUMN = 0;
const BIBIT_NAME_COLUMN = 1;
const BIBIT_MANAGER_COLUMN = 3;
const BIBIT_TRADEABLE_COLUMN = 8;
const BIBIT_NAV_DATE_COLUMN = 11;
const RECENT_NAV_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Companies that changed their name, and spellings that differ between sources. Both sides map to one name.
// Each pair is the same company: the same fund names are listed under both names.
const MANAGER_ALIASES = {
  'surya timur alam raya asset management': 'surya timur alam raya',
  'star asset management': 'surya timur alam raya',
  'kisi asset management': 'korea investment management indonesia',
  'kim indonesia': 'korea investment management indonesia',
  'bnp paribas investment partners': 'bnp paribas asset management',
  'grow investment indonesia': 'grow investments indonesia',
  'mega capital investama': 'mega asset management',
  'danareksa investment management': 'bri manajemen investasi',
  'rhb asset management indonesia': 'allianz global investors asset management indonesia',
  'anargya aset manajemen': 'anargya asset management',
  'narada aset manajemen': 'narada kapital indonesia',
  'jarvis aset manajemen': 'jarvis asset management',
  'valbury capital management': 'kb valbury asset management',
  'aberdeen standard investments indonesia': 'aberdeen asset management',
};

// Names differ in case, punctuation, and the "reksa dana" prefix. Nothing fuzzier is safe.
export const normalizeName = (name) => name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(reksa dana|reksadana|rd)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Bibit writes "Name, PT" and Kontan writes "PT. Name", so "pt" and "tbk" are dropped wherever they appear.
export const normalizeManager = (manager) => {
  const normalized = (manager ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pt|tbk|persero)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return MANAGER_ALIASES[normalized] ?? normalized;
};

// Equality, not substring: "PT Alpha" and "PT Alpha Capital" are different managers.
export const isSameManager = (otherManager, bibitManager) => {
  const bibit = normalizeManager(bibitManager);

  return bibit !== '' && normalizeManager(otherManager) === bibit;
};

// `funds` is a list of [id, { name, manager }] from `source` ("kontan", "bareksa", "makmur").
// A fund matches a Bibit fund only when the normalized name is unique on the source side,
// exactly one Bibit fund with that name has the same manager, and no alias says otherwise.
// Makmur adds " Kelas A" to the name of a fund that Bibit lists without a class, so that suffix is dropped
// when no Bibit fund has the full name at all, and the name without it is held by exactly one Bibit fund.
// Other classes ("Kelas B") are different funds and never match this way.
export const matchBibitSymbols = (source, funds, bibitRows, aliases = FUND_ALIASES) => {
  const bibitByName = Map.groupBy(bibitRows, (row) => normalizeName(row[BIBIT_NAME_COLUMN]));
  const bibitSymbols = new Set(bibitRows.map((row) => row[BIBIT_SYMBOL_COLUMN]));
  const fundsByName = Map.groupBy(funds, ([, fund]) => normalizeName(fund.name ?? ''));
  const symbolsById = new Map();

  const findBibitRows = (name, manager) => (bibitByName.get(name) ?? []).filter((row) => isSameManager(manager, row[BIBIT_MANAGER_COLUMN]));

  for (const [id, fund] of funds) {
    const aliasKey = `${source}:${id}`;

    // An alias of null blocks the automatic match of a fund that is known to be a different fund.
    if (Object.hasOwn(aliases, aliasKey)) {
      if (bibitSymbols.has(aliases[aliasKey])) {
        symbolsById.set(id, aliases[aliasKey]);
      }

      continue;
    }

    const name = normalizeName(fund.name ?? '');

    if (name === '' || fundsByName.get(name).length !== 1) {
      continue;
    }

    let rows = findBibitRows(name, fund.manager);
    const nameWithoutClass = name.replace(/ kelas a$/, '');

    if (!bibitByName.has(name) && nameWithoutClass !== name && !fundsByName.has(nameWithoutClass) && bibitByName.get(nameWithoutClass)?.length === 1) {
      rows = findBibitRows(nameWithoutClass, fund.manager);
    }

    if (rows.length === 1) {
      symbolsById.set(id, rows[0][BIBIT_SYMBOL_COLUMN]);
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

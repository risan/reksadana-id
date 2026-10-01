import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve('data');

const BOOLEAN_COLUMNS = ['sharia', 'etf', 'index', 'tradeable'];
const NUMBER_COLUMNS = ['status', 'nav', 'aum', 'expense_ratio'];

function readText(...segments) {
  const file = path.join(DATA_DIR, ...segments);

  if (!existsSync(file)) {
    return null;
  }

  return readFileSync(file, 'utf8');
}

function readJson(fallback, ...segments) {
  const text = readText(...segments);

  if (text === null) {
    return fallback;
  }

  return JSON.parse(text);
}

// Handles quoted fields with commas, escaped quotes, and line breaks.
function parseCsv(text) {
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

      continue;
    }

    if (char === '"') {
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
}

function readCsvObjects(...segments) {
  const text = readText(...segments);

  if (text === null) {
    return [];
  }

  const [header, ...rows] = parseCsv(text);

  return rows.map((row) => Object.fromEntries(header.map((column, index) => [column, row[index]])));
}

function emptyToNull(value) {
  if (value === '' || value === undefined) {
    return null;
  }

  return value;
}

export function listFundSymbols() {
  return readdirSync(path.join(DATA_DIR, 'funds'))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length));
}

export function loadFundIndex() {
  return readCsvObjects('funds.csv').map((row) => {
    const record = {};

    for (const [column, raw] of Object.entries(row)) {
      const value = emptyToNull(raw);

      if (value === null) {
        record[column] = null;
      } else if (BOOLEAN_COLUMNS.includes(column)) {
        record[column] = value === 'true' || value === '1';
      } else if (NUMBER_COLUMNS.includes(column)) {
        record[column] = Number(value);
      } else {
        record[column] = value;
      }
    }

    record.return_1y = loadFund(record.symbol)?.simplereturn?.['1y'] ?? null;

    return record;
  });
}

export function loadFund(symbol) {
  return readJson(null, 'funds', `${symbol}.json`);
}

export function loadTypes() {
  return readJson(null, 'types.json');
}

export function loadFundDetails(symbol) {
  return {
    ...loadFund(symbol),
    documents: readJson(null, 'documents', `${symbol}.json`),
    switchables: readJson(null, 'switchables', `${symbol}.json`),
    dividends: readJson(null, 'dividends', `${symbol}.json`),
  };
}

export function loadNavSeries(symbol) {
  return readCsvObjects('nav', `${symbol}.csv`).map((row) => ({
    date: row.date,
    nav: Number(row.nav),
    nav_adjusted: row.nav_adjusted === '' || row.nav_adjusted === undefined ? null : Number(row.nav_adjusted),
  }));
}

export function loadAumSeries(symbol) {
  return readCsvObjects('aum', `${symbol}.csv`).map((row) => ({
    date: row.date,
    aum: Number(row.aum),
  }));
}

export function readDataFileText(...segments) {
  return readText(...segments);
}

export function listDataFiles(subdirectory) {
  return readdirSync(path.join(DATA_DIR, subdirectory));
}

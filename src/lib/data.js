import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { makmurFundUrl } from './referrals.js';
import { computeReturns, fundCurrency, largeMoves, periodStartDate, pickAumHistory, pickNavHistory, sparkline } from './series.js';

export const DATA_DIR = path.resolve('data');

const BIBIT_DIR = path.join(DATA_DIR, 'bibit');
const KONTAN_DIR = path.join(DATA_DIR, 'kontan');
const BAREKSA_DIR = path.join(DATA_DIR, 'bareksa');
const MAKMUR_DIR = path.join(DATA_DIR, 'makmur');

const BOOLEAN_COLUMNS = ['sharia', 'etf', 'index', 'tradeable'];
const NUMBER_COLUMNS = ['status', 'nav', 'aum', 'expense_ratio'];

function readText(directory, ...segments) {
  const file = path.join(directory, ...segments);

  if (!existsSync(file)) {
    return null;
  }

  return readFileSync(file, 'utf8');
}

function readJson(fallback, ...segments) {
  const text = readText(BIBIT_DIR, ...segments);

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

function readCsvObjects(directory, ...segments) {
  const text = readText(directory, ...segments);

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
  return readdirSync(path.join(BIBIT_DIR, 'funds'))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length));
}

export function loadFundIndex() {
  return readCsvObjects(BIBIT_DIR, 'funds.csv').map((row) => {
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
    record.makmur_url = loadMakmurFundsBySymbol().get(record.symbol)?.url ?? null;

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
  return readCsvObjects(BIBIT_DIR, 'nav', `${symbol}.csv`).map((row) => ({
    date: row.date,
    nav: Number(row.nav),
    nav_adjusted: row.nav_adjusted === '' || row.nav_adjusted === undefined ? null : Number(row.nav_adjusted),
  }));
}

export function loadAumSeries(symbol) {
  return readCsvObjects(BIBIT_DIR, 'aum', `${symbol}.csv`).map((row) => ({
    date: row.date,
    aum: Number(row.aum),
  }));
}

export function readDataFileText(...segments) {
  return readText(BIBIT_DIR, ...segments);
}

export function listDataFiles(subdirectory) {
  return readdirSync(path.join(BIBIT_DIR, subdirectory));
}

let kontanFundsBySymbol = null;

function loadKontanFundsBySymbol() {
  if (kontanFundsBySymbol === null) {
    const matchedRows = readCsvObjects(KONTAN_DIR, 'funds.csv').filter((row) => row.bibit_symbol !== '');

    kontanFundsBySymbol = new Map(matchedRows.map((row) => [row.bibit_symbol, { id: Number(row.kontan_id), name: row.name }]));
  }

  return kontanFundsBySymbol;
}

// The Kontan fund matched to a Bibit symbol, with its NAV history, or null when there is no match.
export function loadKontan(symbol) {
  const fund = loadKontanFundsBySymbol().get(symbol);

  if (!fund) {
    return null;
  }

  const nav = readCsvObjects(KONTAN_DIR, 'nav', `${fund.id}.csv`).map((row) => ({
    date: row.date,
    nav: Number(row.nav),
  }));

  return { ...fund, nav };
}

let bareksaFundsBySymbol = null;

function loadBareksaFundsBySymbol() {
  if (bareksaFundsBySymbol === null) {
    const matchedRows = readCsvObjects(BAREKSA_DIR, 'funds.csv').filter((row) => row.bibit_symbol !== '');

    bareksaFundsBySymbol = new Map(matchedRows.map((row) => [row.bibit_symbol, { id: Number(row.bareksa_id), name: row.name }]));
  }

  return bareksaFundsBySymbol;
}

function toNumberOrNull(value) {
  const text = emptyToNull(value);

  return text === null ? null : Number(text);
}

// The Bareksa fund matched to a Bibit symbol, with its NAV, AUM, units, and asset allocation, or null when there is no match.
export function loadBareksa(symbol) {
  const fund = loadBareksaFundsBySymbol().get(symbol);

  if (!fund) {
    return null;
  }

  const readSeries = (directory, toRecord) => readCsvObjects(BAREKSA_DIR, directory, `${fund.id}.csv`).map(toRecord);

  return {
    ...fund,
    nav: readSeries('nav', (row) => ({ date: row.date, nav: toNumberOrNull(row.nav) })),
    aum: readSeries('aum', (row) => ({ date: row.date, aum_idr: toNumberOrNull(row.aum_idr), aum_usd: toNumberOrNull(row.aum_usd) })),
    units: readSeries('units', (row) => ({ date: row.date, units: toNumberOrNull(row.units) })),
    allocation: readSeries('allocation', (row) => ({
      date: row.date,
      saham: toNumberOrNull(row.saham),
      obligasi: toNumberOrNull(row.obligasi),
      pasar_uang: toNumberOrNull(row.pasar_uang),
      lainnya: toNumberOrNull(row.lainnya),
    })),
  };
}

let makmurFundsBySymbol = null;

function loadMakmurFundsBySymbol() {
  if (makmurFundsBySymbol === null) {
    const matchedRows = readCsvObjects(MAKMUR_DIR, 'funds.csv').filter((row) => row.bibit_symbol !== '');

    makmurFundsBySymbol = new Map(matchedRows.map((row) => [row.bibit_symbol, {
      id: row.makmur_id,
      name: row.name,
      url: makmurFundUrl(row.route_category, row.url),
    }]));
  }

  return makmurFundsBySymbol;
}

// The Makmur fund matched to a Bibit symbol, with its raw Makmur record, or null when there is no match.
// The record's numbers are scaled: see "Makmur" in the README.
export function loadMakmur(symbol) {
  const fund = loadMakmurFundsBySymbol().get(symbol);

  if (!fund) {
    return null;
  }

  return { ...fund, data: JSON.parse(readText(MAKMUR_DIR, 'funds', `${fund.id}.json`)) };
}

// Everything about one fund, as served by /api/funds/<symbol>.json.
export function loadFundRecord(symbol) {
  return {
    ...loadFundDetails(symbol),
    nav: loadNavSeries(symbol),
    aum: loadAumSeries(symbol),
    kontan: loadKontan(symbol),
    bareksa: loadBareksa(symbol),
    makmur: loadMakmur(symbol),
  };
}

let latestDate = null;

// The newest NAV date of any fund: the date the whole dataset is current to.
export function latestNavDate() {
  if (latestDate === null) {
    latestDate = readCsvObjects(BIBIT_DIR, 'funds.csv').reduce((latest, row) => (row.nav_date > latest ? row.nav_date : latest), '');
  }

  return latestDate;
}

// A fund that has reported no NAV for this long is probably closed, merged, or no longer reported.
const ACTIVE_WITHIN_DAYS = 31;

export function isActive(navDate) {
  if (!navDate) {
    return false;
  }

  const ageDays = (Date.parse(latestNavDate()) - Date.parse(navDate)) / (24 * 60 * 60 * 1000);

  return ageDays <= ACTIVE_WITHIN_DAYS;
}

export function shortManagerName(name) {
  return name?.replace(/^PT\.?\s+/i, '').replace(/,?\s+PT\.?$/i, '').trim() ?? null;
}

// Every return is the change in NAV, computed here so the chart, the table, and the fund list agree.
// Bibit's own figures lag its NAV history, and its nav_adjusted changes base between scrapes. Its dividend
// list only keeps the latest five payouts, which is too short to rebuild a total return.
export function fundPerformance(record, history = pickNavHistory(record)) {
  return { source: history.primary, ...computeReturns(history) };
}

// Some funds have a latest AUM in their Bibit fund file but no AUM history.
export function latestAum(record) {
  const latest = pickAumHistory(record).points.at(-1);

  if (latest) {
    return latest;
  }

  const bibit = loadFund(record.symbol)?.aum;

  return bibit?.value > 0 ? { value: bibit.value, date: bibit.date } : null;
}

function roundTo(value, decimals) {
  if (value === null || value === undefined) {
    return null;
  }

  return Math.round(value * 10 ** decimals) / 10 ** decimals;
}

function roundSignificant(value, digits) {
  return value === null || value === undefined ? null : Number(value.toPrecision(digits));
}

function hasLargeMoveInLastYear(points) {
  if (points.length < 2) {
    return false;
  }

  const yearAgo = periodStartDate('1y', points.at(-1).date);

  return largeMoves(points).some((move) => move.date > yearAgo);
}

let fundSummaries = null;

// One compact row per fund for the fund explorer, plus the USD rate it needs to rank funds by size.
export function loadFundSummaries() {
  fundSummaries ??= buildFundSummaries();

  return fundSummaries;
}

function buildFundSummaries() {
  const makmur = loadMakmurFundsBySymbol();
  let usdToIdr = null;

  const funds = readCsvObjects(BIBIT_DIR, 'funds.csv').map((row) => {
    const record = loadFundRecord(row.symbol);
    const history = pickNavHistory(record);
    const last = history.points.at(-1);
    const navDate = history.frozenSince ?? last?.date ?? emptyToNull(row.nav_date);
    const active = isActive(navDate);
    const performance = fundPerformance(record, history);
    const aum = latestAum(record);
    const periodReturn = (period) => (active ? roundTo(performance.simplereturn[period], 5) : null);

    if (fundCurrency(record) === 'USD' && record.currency_exchange?.exchange_rate > 1) {
      usdToIdr = record.currency_exchange.exchange_rate;
    }

    return {
      symbol: row.symbol,
      name: row.name,
      manager: shortManagerName(row.investment_manager),
      type: emptyToNull(row.type),
      currency: fundCurrency(record),
      sharia: row.sharia === 'true',
      bibit: row.tradeable === '1',
      makmur: makmur.has(row.symbol),
      nav: roundSignificant(last?.value ?? toNumberOrNull(row.nav), 8),
      nav_date: navDate,
      aum: roundSignificant(aum?.value ?? null, 4),
      aum_date: aum?.date ?? null,
      return_1m: periodReturn('1m'),
      return_ytd: periodReturn('ytd'),
      return_1y: periodReturn('1y'),
      return_3y: periodReturn('3y'),
      spark: active ? sparkline(history.points) : null,
      large_move: active && hasLargeMoveInLastYear(history.points),
      dividends: (record.dividends?.length ?? 0) > 0,
      active,
    };
  });

  return { date: latestNavDate(), usd_to_idr: usdToIdr, funds };
}

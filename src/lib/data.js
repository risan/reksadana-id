import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { benchmarkAt, suggestBenchmarkIds } from './benchmarks.js';
import { buildCosts } from './costs.js';
import { makmurFundUrl } from './referrals.js';
import { computeReturns, dividendEvents, fundCurrency, largeMoves, periodStartDate, pickAumHistory, pickNavHistory, sparkline, withDividendsReinvested } from './series.js';

export const DATA_DIR = path.resolve('data');

const BIBIT_DIR = path.join(DATA_DIR, 'bibit');
const KONTAN_DIR = path.join(DATA_DIR, 'kontan');
const BAREKSA_DIR = path.join(DATA_DIR, 'bareksa');
const MAKMUR_DIR = path.join(DATA_DIR, 'makmur');
const OJK_DIR = path.join(DATA_DIR, 'ojk', 'monthly');
const BENCHMARKS_DIR = path.join(DATA_DIR, 'benchmarks');
const MACRO_DIR = path.join(DATA_DIR, 'macro');

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

const SOURCES = ['bibit', 'bareksa', 'kontan', 'makmur'];
const SOURCE_DIRECTORIES = { bibit: BIBIT_DIR, bareksa: BAREKSA_DIR, kontan: KONTAN_DIR, makmur: MAKMUR_DIR };
const SOURCE_ID_COLUMNS = { bibit: 'symbol', bareksa: 'bareksa_id', kontan: 'kontan_id', makmur: 'makmur_id' };

function toNumberOrNull(value) {
  const text = emptyToNull(value);

  return text === null ? null : Number(text);
}

function splitIds(text) {
  return text.split(' ').filter((id) => id !== '');
}

const sourceRowsCache = new Map();

// One source's fund list, by the source's own fund ID.
function sourceRows(source) {
  if (!sourceRowsCache.has(source)) {
    const rows = readCsvObjects(SOURCE_DIRECTORIES[source], 'funds.csv');

    sourceRowsCache.set(source, new Map(rows.map((row) => [row[SOURCE_ID_COLUMNS[source]], row])));
  }

  return sourceRowsCache.get(source);
}

const ETF_HINT = /\betf\b/i;
const INDEX_HINT = /\b(indeks|index)\b/i;

// Bibit flags its index funds and ETFs. For funds it does not list, the names and the other sources' types hint at it.
function indexFlags(sources, names) {
  const bibitRows = sources.bibit.map((symbol) => sourceRows('bibit').get(symbol));

  if (bibitRows.length > 0) {
    return { etf: bibitRows.some((row) => row.etf === 'true'), index: bibitRows.some((row) => row.index === 'true') };
  }

  const types = [
    ...sources.bareksa.map((id) => sourceRows('bareksa').get(id).type),
    ...sources.kontan.map((id) => sourceRows('kontan').get(id).category),
    ...sources.makmur.map((id) => sourceRows('makmur').get(id).category),
  ].map((type) => type.toLowerCase());
  const etf = ETF_HINT.test(names.join(' ')) || types.includes('etf');
  const isCombinedType = types.includes('indeks & etf');

  return { etf, index: INDEX_HINT.test(names.join(' ')) || types.includes('indeks') || (isCombinedType && !etf) };
}

function parseFund(row) {
  const otherNames = row.other_names === '' ? [] : row.other_names.split('|');
  const sources = Object.fromEntries(SOURCES.map((source) => [source, splitIds(row[source])]));

  return {
    id: row.id,
    name: row.name,
    other_names: otherNames,
    manager: emptyToNull(row.manager),
    type: emptyToNull(row.type),
    currency: emptyToNull(row.currency),
    sharia: row.sharia === '' ? null : row.sharia === 'true',
    launch_date: emptyToNull(row.launch_date),
    ojk: emptyToNull(row.ojk),
    ...indexFlags(sources, [row.name, ...otherNames]),
    sources,
  };
}

let fundsById = null;

function loadFundsById() {
  fundsById ??= new Map(readCsvObjects(DATA_DIR, 'funds.csv').map((row) => [row.id, parseFund(row)]));

  return fundsById;
}

export function listFundIds() {
  return [...loadFundsById().keys()];
}

// Every fund, as in data/funds.csv with the source IDs as lists.
export function listFunds() {
  return [...loadFundsById().values()];
}

// Retired fund IDs and the fund that holds their record now.
export function loadRetiredIds() {
  return readCsvObjects(DATA_DIR, 'fund-ids.csv')
    .filter((row) => row.id !== row.current_id)
    .map((row) => ({ id: row.id, current_id: row.current_id }));
}

let fundIdsByBibitSymbol = null;

// The fund a Bibit symbol belongs to now, which is not the symbol itself when the symbol was merged into another fund.
export function fundIdOfBibitSymbol(symbol) {
  fundIdsByBibitSymbol ??= new Map(listFunds().flatMap((fund) => fund.sources.bibit.map((bibitSymbol) => [bibitSymbol, fund.id])));

  return fundIdsByBibitSymbol.get(symbol) ?? symbol;
}

// Fields are taken from the first record that has a value, so the primary record wins and the others fill its gaps.
function mergeFirstValues(records) {
  const merged = {};

  for (const record of records.filter(Boolean)) {
    for (const [key, value] of Object.entries(record)) {
      if (merged[key] === null || merged[key] === undefined) {
        merged[key] = value;
      }
    }
  }

  return merged;
}

function firstBibitJson(symbols, directory) {
  for (const symbol of symbols) {
    const value = readJson(null, directory, `${symbol}.json`);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

// Records of one source can overlap in time (a fund that changed IDs). On a date two of them share,
// the first one listed, the one with the newest NAV, wins.
function unionByDate(rowLists) {
  const byDate = new Map();

  for (const row of rowLists.flat()) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, row);
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function readUnion(directory, subdirectory, ids, toRow) {
  return unionByDate(ids.map((id) => readCsvObjects(directory, subdirectory, `${id}.csv`).map(toRow)));
}

// The Kontan funds of one fund, with their NAV history, or null when there is none.
function loadKontan(ids) {
  if (ids.length === 0) {
    return null;
  }

  return {
    id: Number(ids[0]),
    name: sourceRows('kontan').get(ids[0]).name,
    nav: readUnion(KONTAN_DIR, 'nav', ids, (row) => ({ date: row.date, nav: Number(row.nav) })),
  };
}

// The Bareksa funds of one fund, with their NAV, AUM, units, and asset allocation, or null when there is none.
function loadBareksa(ids) {
  if (ids.length === 0) {
    return null;
  }

  return {
    id: Number(ids[0]),
    name: sourceRows('bareksa').get(ids[0]).name,
    nav: readUnion(BAREKSA_DIR, 'nav', ids, (row) => ({ date: row.date, nav: toNumberOrNull(row.nav) })),
    aum: readUnion(BAREKSA_DIR, 'aum', ids, (row) => ({ date: row.date, aum_idr: toNumberOrNull(row.aum_idr), aum_usd: toNumberOrNull(row.aum_usd) })),
    units: readUnion(BAREKSA_DIR, 'units', ids, (row) => ({ date: row.date, units: toNumberOrNull(row.units) })),
    allocation: readUnion(BAREKSA_DIR, 'allocation', ids, (row) => ({
      date: row.date,
      saham: toNumberOrNull(row.saham),
      obligasi: toNumberOrNull(row.obligasi),
      pasar_uang: toNumberOrNull(row.pasar_uang),
      lainnya: toNumberOrNull(row.lainnya),
    })),
  };
}

// The Bareksa row columns of a fund's Bareksa funds (custodian, minimums, fees), the first value found winning.
function loadBareksaProfile(ids) {
  const rows = ids.map((id) => Object.fromEntries(Object.entries(sourceRows('bareksa').get(id)).map(([column, value]) => [column, emptyToNull(value)])));

  return mergeFirstValues(rows);
}

// The first Makmur fund of one fund, with its raw Makmur record, or null when there is none.
// The record's numbers are scaled: see "Makmur" in the README.
function loadMakmur(ids) {
  if (ids.length === 0) {
    return null;
  }

  const row = sourceRows('makmur').get(ids[0]);
  const text = readText(MAKMUR_DIR, 'funds', `${row.makmur_id}.json`);

  return {
    id: row.makmur_id,
    name: row.name,
    url: makmurFundUrl(row.route_category, row.url),
    data: text === null ? {} : JSON.parse(text),
  };
}

let ojkMonthsByName = null;
let newestOjkMonth = '';

// Every fund OJK lists, by the name OJK writes, with one row per month (oldest first): the manager, custodian,
// type, currency, AUM in rupiah (also for a USD fund), and units in the fund's own currency.
function loadOjkMonthsByName() {
  if (ojkMonthsByName === null) {
    const files = existsSync(OJK_DIR) ? readdirSync(OJK_DIR).filter((file) => file.endsWith('.csv')).sort() : [];

    ojkMonthsByName = new Map();

    for (const file of files) {
      const month = file.slice(0, -'.csv'.length);

      newestOjkMonth = month;

      for (const row of readCsvObjects(OJK_DIR, file)) {
        const rows = ojkMonthsByName.get(row.fund) ?? [];

        if (rows.at(-1)?.month !== month) {
          rows.push({ month, manager: row.manager, custodian: row.custodian, type: row.type, currency: row.currency, aum: Number(row.aum), units: Number(row.units) });
          ojkMonthsByName.set(row.fund, rows);
        }
      }
    }
  }

  return ojkMonthsByName;
}

// What OJK's monthly statistics say about a fund, or null when the fund is not linked to an OJK fund.
// `status` is "zero_aum" when OJK's latest AUM is 0 (the fund is dissolved or not launched, per OJK),
// "not_listed" when OJK no longer lists the fund in its newest month, and "registered" otherwise.
function loadOjk(name) {
  const months = name === null ? undefined : loadOjkMonthsByName().get(name);

  if (months === undefined) {
    return null;
  }

  const latest = months.at(-1);
  let status = 'registered';

  if (latest.month !== newestOjkMonth) {
    status = 'not_listed';
  } else if (latest.aum === 0) {
    status = 'zero_aum';
  }

  return {
    name,
    manager: latest.manager,
    custodian: latest.custodian,
    type: latest.type,
    currency: latest.currency,
    status,
    months: months.map(({ month, aum, units }) => ({ month, aum, units })),
  };
}

// Everything about one fund, as served by /api/funds/<id>.json. The Bibit fields (profile, holdings, fees,
// documents) come from its Bibit records and are missing for a fund Bibit does not list.
export function loadFundRecord(id) {
  const fund = loadFundsById().get(id);
  const { bibit, bareksa, kontan, makmur } = fund.sources;
  const bibitRecord = mergeFirstValues(bibit.map((symbol) => readJson(null, 'funds', `${symbol}.json`)));
  const makmurFund = loadMakmur(makmur);

  return {
    ...bibitRecord,
    costs: buildCosts({ bibit: bibitRecord, makmur: makmurFund?.data, bareksa: loadBareksaProfile(bareksa), currency: fund.currency }),
    documents: firstBibitJson(bibit, 'documents'),
    switchables: firstBibitJson(bibit, 'switchables'),
    dividends: firstBibitJson(bibit, 'dividends'),
    fund,
    nav: readUnion(BIBIT_DIR, 'nav', bibit, (row) => ({ date: row.date, nav: Number(row.nav), nav_adjusted: toNumberOrNull(row.nav_adjusted) })),
    aum: readUnion(BIBIT_DIR, 'aum', bibit, (row) => ({ date: row.date, aum: Number(row.aum) })),
    kontan: loadKontan(kontan),
    bareksa: loadBareksa(bareksa),
    makmur: makmurFund,
    ojk: loadOjk(fund.ojk),
  };
}

export function loadTypes() {
  return readJson(null, 'types.json');
}

export function readFundsCsv() {
  return readText(DATA_DIR, 'funds.csv');
}

function lastDateInFile(file) {
  const descriptor = openSync(file, 'r');

  try {
    const { size } = fstatSync(descriptor);
    const length = Math.min(size, 128);
    const buffer = Buffer.alloc(length);

    readSync(descriptor, buffer, 0, length, size - length);

    const lastLine = buffer.toString('utf8').trimEnd().split('\n').at(-1);

    return /^\d{4}-\d{2}-\d{2}/.test(lastLine) ? lastLine.slice(0, 10) : '';
  } finally {
    closeSync(descriptor);
  }
}

const newestOf = (dates) => dates.reduce((latest, date) => (date > latest ? date : latest), '');

const sourceDates = new Map();

// The newest date a source has data for. A fund's latest NAV is compared with it, so that a source
// that is refreshed rarely does not make all its funds look closed.
export function latestSourceDate(source) {
  if (!sourceDates.has(source)) {
    let date;

    if (source === 'bareksa') {
      const directory = path.join(BAREKSA_DIR, 'nav');

      date = newestOf(readdirSync(directory).map((file) => lastDateInFile(path.join(directory, file))));
    } else {
      const dateColumn = source === 'makmur' ? 'as_of' : 'nav_date';

      date = newestOf([...sourceRows(source).values()].map((row) => row[dateColumn]));
    }

    sourceDates.set(source, date);
  }

  return sourceDates.get(source);
}

// The newest NAV date of Bibit, which updates daily: the date the whole dataset is current to.
export function latestNavDate() {
  return latestSourceDate('bibit');
}

// A fund that has reported no NAV for this long is probably closed, merged, or no longer reported.
const ACTIVE_WITHIN_DAYS = 31;

// The source whose newest date a history point is compared with.
function referenceSource(pointSource) {
  return pointSource === 'bareksa-monthly' ? 'bareksa' : pointSource;
}

export function isActive(navDate, pointSource) {
  if (!navDate) {
    return false;
  }

  const ageDays = (Date.parse(latestSourceDate(referenceSource(pointSource))) - Date.parse(navDate)) / (24 * 60 * 60 * 1000);

  return ageDays <= ACTIVE_WITHIN_DAYS;
}

// The newest date of the source that supplied a fund's NAV, or null when the source updates daily.
export function staleSourceDate(pointSource) {
  const source = referenceSource(pointSource);

  return source === 'bibit' || !source ? null : latestSourceDate(source);
}

export function shortManagerName(name) {
  return name?.replace(/^PT\.?\s+/i, '').replace(/,?\s+PT\.?$/i, '').trim() ?? null;
}

// Every return is computed here from one NAV history so the chart, the table, and the fund list agree.
// Bibit's own figures lag its NAV history. The returns are the change in NAV; for a fund with dividends
// `total` holds the same returns with each dividend reinvested on its ex-date, and is null for the others.
export function fundPerformance(record, history = pickNavHistory(record)) {
  const events = dividendEvents(record, history);
  const totalHistory = events.length > 0 ? withDividendsReinvested(history, events) : null;

  return { source: history.primary, ...computeReturns(history), events, total: totalHistory && computeReturns(totalHistory), totalHistory };
}

// Some funds have a latest AUM in their Bibit fund file but no AUM history.
export function latestAum(record) {
  const latest = pickAumHistory(record).points.at(-1);

  if (latest) {
    return latest;
  }

  for (const symbol of record.fund.sources.bibit) {
    const bibit = readJson(null, 'funds', `${symbol}.json`)?.aum;

    if (bibit?.value > 0) {
      return { value: bibit.value, date: bibit.date, currency: fundCurrency(record) };
    }
  }

  return null;
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

const BI_RATE_SERIES = {
  id: 'bi-rate',
  name: { id: 'BI-Rate (suku bunga acuan Bank Indonesia)', en: 'BI-Rate (Bank Indonesia policy rate)' },
  description: {
    id: 'Suku bunga acuan Bank Indonesia (BI 7-Day Reverse Repo Rate), dalam persen per tahun, pada tanggal keputusan Rapat Dewan Gubernur.',
    en: "Bank Indonesia's policy rate (BI 7-Day Reverse Repo Rate) in percent per year, on the date of the Board of Governors' decision.",
  },
  kind: 'rate',
  source: 'Bank Indonesia',
  publisher: 'Bank Indonesia',
  currency: 'IDR',
};

let benchmarkSeries = null;

// The series funds are compared with, each as its metadata and points ({ date, value }, oldest first):
// the stock and fund category indices in data/benchmarks/, and the BI-Rate from data/macro/.
export function loadBenchmarks() {
  if (benchmarkSeries === null) {
    const toPoints = (rows, valueColumn) => rows.map((row) => ({ date: row.date, value: Number(row[valueColumn]) }));
    const indexMetadata = JSON.parse(readText(BENCHMARKS_DIR, 'benchmarks.json'));
    const biRatePoints = toPoints(readCsvObjects(MACRO_DIR, 'bi-rate.csv'), 'rate');

    benchmarkSeries = [
      ...indexMetadata.map((metadata) => ({ ...metadata, points: toPoints(readCsvObjects(BENCHMARKS_DIR, `${metadata.id}.csv`), 'value') })),
      { ...BI_RATE_SERIES, start_date: biRatePoints[0].date, points: biRatePoints },
    ];
  }

  return benchmarkSeries;
}

// The benchmarks suggested for a fund, measured to the date of the fund's latest NAV so that the periods line up.
export function fundBenchmarks(fund, history) {
  const endDate = history.points.at(-1)?.date;
  const seriesById = new Map(loadBenchmarks().map((series) => [series.id, series]));

  if (!endDate) {
    return [];
  }

  return suggestBenchmarkIds(fund).map((id) => benchmarkAt(seriesById.get(id), endDate)).filter((entry) => entry !== null);
}

let fundSummaries = null;

// One compact row per fund for the fund explorer, plus the USD rate it needs to rank funds by size.
export function loadFundSummaries() {
  fundSummaries ??= buildFundSummaries();

  return fundSummaries;
}

function buildFundSummaries() {
  let usdToIdr = null;

  const funds = listFunds().map((fund) => {
    const record = loadFundRecord(fund.id);
    const history = pickNavHistory(record);
    const last = history.points.at(-1);
    const navDate = history.frozenSince ?? last?.date ?? null;
    const active = isActive(navDate, last?.source);
    const performance = fundPerformance(record, history);
    const aum = latestAum(record);
    const periodReturn = (period) => (active ? roundTo(performance.simplereturn[period], 5) : null);
    const totalReturn = (period) => (active ? roundTo(performance.total.simplereturn[period], 5) : null);

    if (fund.currency === 'USD' && record.currency_exchange?.exchange_rate > 1) {
      usdToIdr = record.currency_exchange.exchange_rate;
    }

    return {
      id: fund.id,
      name: fund.name,
      names: [fund.name, ...fund.other_names],
      manager: shortManagerName(fund.manager),
      type: fund.type,
      currency: fund.currency,
      sharia: fund.sharia,
      etf: fund.etf,
      index: fund.index,
      bibit: record.tradeable === 1,
      makmur: record.makmur !== null,
      nav: roundSignificant(last?.value ?? null, 8),
      nav_date: navDate,
      aum: roundSignificant(aum?.value ?? null, 4),
      aum_currency: aum?.currency ?? null,
      aum_date: aum?.date ?? null,
      return_1m: periodReturn('1m'),
      return_ytd: periodReturn('ytd'),
      return_1y: periodReturn('1y'),
      return_3y: periodReturn('3y'),
      spark: active ? sparkline(history.points) : null,
      total: performance.total && {
        return_1m: totalReturn('1m'),
        return_ytd: totalReturn('ytd'),
        return_1y: totalReturn('1y'),
        return_3y: totalReturn('3y'),
        spark: active ? sparkline(performance.totalHistory.points) : null,
      },
      large_move: active && hasLargeMoveInLastYear(history.points),
      dividends: (record.dividends?.length ?? 0) > 0,
      active,
      ...(record.ojk && { ojk_status: record.ojk.status }),
    };
  });

  return { date: latestNavDate(), usd_to_idr: usdToIdr, funds };
}

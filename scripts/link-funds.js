import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import ALIASES from '../scrapers/fund-aliases.json' with { type: 'json' };
import { dropSpikes } from '../src/lib/series.js';
import { isSameManager, normalizeManager, normalizeName, readCsvRecords, toCsv, writeFileAtomic } from '../scrapers/lib.js';

const DATA_DIR = 'data';
const FUNDS_FILE = `${DATA_DIR}/funds.csv`;
const FUND_IDS_FILE = `${DATA_DIR}/fund-ids.csv`;
const OJK_DIR = `${DATA_DIR}/ojk/monthly`;
const FUNDS_HEADER = ['id', 'name', 'other_names', 'manager', 'type', 'currency', 'sharia', 'launch_date', 'bibit', 'bareksa', 'kontan', 'makmur', 'ojk'];
const FUND_IDS_HEADER = ['id', 'first_published', 'current_id'];

const SOURCES = ['bibit', 'bareksa', 'kontan', 'makmur'];
const ID_PREFIXES = { bibit: '', bareksa: 'BRK', kontan: 'KTN', makmur: 'MKR' };
const NAME_PRIORITY = ['makmur', 'bibit'];
const MANAGER_PRIORITY = ['bareksa', 'bibit', 'kontan', 'makmur'];
const TYPE_PRIORITY = ['bibit', 'bareksa', 'kontan', 'makmur'];
const CURRENCY_PRIORITY = ['bibit', 'makmur', 'bareksa'];
const SHARIA_PRIORITY = ['bibit', 'makmur'];
const LAUNCH_DATE_PRIORITY = ['bareksa', 'bibit', 'kontan', 'makmur'];

const ACTIVE_DAYS = 31;
const MIN_AGREEING_TYPE_SOURCES = 2;
const GENERAL_TYPES = new Set(['Pasar Uang', 'Obligasi', 'Saham', 'Campuran', 'Terproteksi']);
const MIN_SHARED_EQUAL_DATES = 3;
const MIN_DISTINCTIVE_DIGITS = 5;
const MIN_SHORT_HISTORY_DIGITS = 7;
// Sources keep a manager's old name for years after it changed (Kontan still lists Danapathi funds under Shinhan),
// so a long equal history links two records under different managers when their names agree apart from the
// managers' own words. A fund renamed with its manager ("Demina Money Market Fund" to "Danapathi Money Market
// Fund") links only when the same two managers have such a pair at least twice.
const MIN_RENAMED_MANAGER_DATES = 10;
const MIN_RENAMED_FUNDS_PER_MANAGER_PAIR = 2;
const MIN_AGREEMENT = 0.95;
// One stray date is no disagreement: a source has a stale or odd day now and then, and few shared dates make one stray look large.
const MAX_STRAY_DATES = 1;
const MAX_LATEST_DIFFERENCE = 0.005;
const ROUND_NAV_TOLERANCE = 0.001;
const ROUND_NAVS = [1, 10, 100, 1000, 10000];
// Values that two NAVs may differ by and still be equal at two decimals (Kontan and Makmur round to two).
// A record with fewer decimals is coarser still, but its values carry too few digits to be evidence anyway.
const SORTED_SEARCH_WINDOW = 0.0051;
const SAME_DAY_IN_MS = 24 * 60 * 60 * 1000;

// Bibit's vocabulary (src/lib/fund-types.js). Index funds and ETFs, and DPLK, have no counterpart there.
const TYPES = {
  'pasar uang': 'Pasar Uang',
  moneymarket: 'Pasar Uang',
  obligasi: 'Obligasi',
  'pendapatan tetap': 'Obligasi',
  'berbasis sukuk': 'Obligasi',
  fixedincome: 'Obligasi',
  saham: 'Saham',
  equity: 'Saham',
  campuran: 'Campuran',
  mixed: 'Campuran',
  'reksadana global': 'Reksadana Global',
  'global fund': 'Reksadana Global',
  terproteksi: 'Terproteksi',
  capitalprotected: 'Terproteksi',
  'penyertaan terbatas': 'Penyertaan Terbatas',
  dire: 'Dana Investasi Real Estate',
  'dana investasi real estate': 'Dana Investasi Real Estate',
  benchmark: 'Benchmark',
};

const USD_IN_NAME = /\busd\b|\bus\$|\bdollar\b|\bdolar\b/i;
const SHARIA_IN_NAME = /\b(syariah|sharia|shariah|islamic)\b/i;

const toDateNumber = (isoDate) => Number(isoDate.replaceAll('-', ''));

const toDayNumber = (dateNumber) => Math.floor(Date.UTC(Math.floor(dateNumber / 10000), Math.floor(dateNumber / 100) % 100 - 1, dateNumber % 100) / SAME_DAY_IN_MS);

// `dates` are YYYYMMDD numbers, so they sort and compare as numbers.
const seriesFrom = (dates, values) => {
  const order = Array.from(dates.keys());

  if (order.some((index) => index > 0 && dates[index] < dates[index - 1])) {
    order.sort((a, b) => dates[a] - dates[b]);
  }

  return {
    dates: Int32Array.from(order, (index) => dates[index]),
    values: Float64Array.from(order, (index) => values[index]),
  };
};

// Rows are [isoDate, nav].
export const makeNavSeries = (rows) => withoutSpikes(seriesFrom(rows.map(([date]) => toDateNumber(date)), rows.map(([, value]) => value)));

const MAX_STALE_TAIL_ROWS = 10;

// Kontan repeats a fund's last value for the days it has not updated yet, while the other sources move on. Those
// days say nothing, and one of them as the latest shared date would refuse a link between two records of one fund.
// A longer run is a fund that really stopped, which other sources show the same way.
const withoutStaleTail = (series) => {
  const { dates, values } = series;
  let runLength = 1;

  while (runLength < values.length && values[values.length - 1 - runLength] === values.at(-1)) {
    runLength++;
  }

  if (runLength < 2 || runLength - 1 > MAX_STALE_TAIL_ROWS) {
    return series;
  }

  return { dates: dates.slice(0, dates.length - runLength + 1), values: values.slice(0, values.length - runLength + 1) };
};

const toIsoDate = (dateNumber) => `${String(dateNumber).slice(0, 4)}-${String(dateNumber).slice(4, 6)}-${String(dateNumber).slice(6)}`;

const SPIKE_SCREEN = 0.15;

// A source that served another fund's NAV for a few days would put wrong values into the evidence, so the
// series is cleaned as the site's history is. Only a series with a big jump can hold such a stretch.
const withoutSpikes = (series) => {
  const { dates, values } = series;
  const hasJump = values.some((value, index) => index > 0 && Math.abs(value / values[index - 1] - 1) > SPIKE_SCREEN);

  if (!hasJump) {
    return series;
  }

  const kept = dropSpikes(Array.from(dates, (date, index) => ({ date: toIsoDate(date), value: values[index] })));

  return seriesFrom(kept.map(({ date }) => toDateNumber(date)), kept.map(({ value }) => value));
};

const integerDigits = (value) => (value >= 1 ? Math.floor(Math.log10(value)) + 1 : 0);

const valueDecimals = (value) => {
  for (let decimals = 0; decimals < 5; decimals++) {
    const scaled = value * 10 ** decimals;

    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) {
      return decimals;
    }
  }

  return 5;
};

const isRoundNav = (value) => ROUND_NAVS.some((round) => Math.abs(value / round - 1) <= ROUND_NAV_TOLERANCE);

const digitsOf = (value) => integerDigits(value) + valueDecimals(value);

// The precision of a pair is that of the coarser value, as written: Kontan and Makmur keep two decimals,
// and older rows of the other sources have fewer decimals than newer ones.
const coarseDecimals = (x, y) => Math.min(valueDecimals(x), valueDecimals(y));

// Equal when the finer value, rounded to the coarser value's decimals, is the coarser value.
const valuesAgree = (x, y) => {
  const scale = 10 ** coarseDecimals(x, y);

  return Math.round(x * scale) === Math.round(y * scale);
};

// One unit in the last coarse decimal apart: some sources truncate where others round.
const valuesClose = (x, y) => Math.abs(x - y) <= 1.0001 * 10 ** -coarseDecimals(x, y);

const sharedDigits = (x, y) => integerDigits(x) + Math.min(valueDecimals(x), valueDecimals(y));

const valueOn = (record, date) => {
  const { dates, values } = record.nav;
  let low = 0;
  let high = dates.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;

    if (dates[middle] === date) {
      return values[middle];
    }

    if (dates[middle] < date) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return undefined;
};

// How far two values are apart beyond rounding: a source that keeps two decimals is not wrong by half a unit.
const differenceBeyondRounding = (x, y) => (valuesClose(x, y) ? 0 : Math.abs(x - y) / Math.max(x, y));

const compareSeries = (a, b) => {
  const comparison = { shared: 0, close: 0, distinctive: 0, strong: 0, latestDifference: 0 };
  let previousDifference = null;
  let i = 0;
  let j = 0;

  while (i < a.nav.dates.length && j < b.nav.dates.length) {
    if (a.nav.dates[i] < b.nav.dates[j]) {
      i++;
    } else if (a.nav.dates[i] > b.nav.dates[j]) {
      j++;
    } else {
      const x = a.nav.values[i];
      const y = b.nav.values[j];

      comparison.shared++;
      previousDifference = comparison.shared > 1 ? comparison.latestDifference : null;
      comparison.latestDifference = differenceBeyondRounding(x, y);

      if (valuesClose(x, y)) {
        comparison.close++;
      }

      if (valuesAgree(x, y)) {
        const digits = sharedDigits(x, y);

        if (digits >= MIN_DISTINCTIVE_DIGITS && !isRoundNav(x)) {
          comparison.distinctive++;

          if (digits >= MIN_SHORT_HISTORY_DIGITS) {
            comparison.strong++;
          }
        }
      }

      i++;
      j++;
    }
  }

  // One odd last day (a source's stale or wrong latest value) is not a different fund: both of the last two must differ.
  if (previousDifference !== null) {
    comparison.latestDifference = Math.min(comparison.latestDifference, previousDifference);
  }

  return comparison;
};

// Kontan often stamps a NAV with the next day's date, so its series is also compared moved back one observation.
const kontanMovedBack = new WeakMap();

const movedBack = (record) => {
  if (!kontanMovedBack.has(record)) {
    kontanMovedBack.set(record, { ...record, nav: { dates: record.nav.dates.slice(0, -1), values: record.nav.values.slice(1) } });
  }

  return kontanMovedBack.get(record);
};

// The comparison of two records on the date alignment that agrees best, with the records as aligned.
const alignNav = (a, b) => {
  const plain = { pair: [a, b], comparison: compareSeries(a, b) };

  if (a.source !== 'kontan' && b.source !== 'kontan' || a.source === b.source) {
    return plain;
  }

  const pair = a.source === 'kontan' ? [movedBack(a), b] : [a, movedBack(b)];
  const moved = { pair, comparison: compareSeries(...pair) };

  return moved.comparison.close > plain.comparison.close ? moved : plain;
};

const compareNav = (a, b) => alignNav(a, b).comparison;

const agreeOnDates = ({ shared, close }) => shared > 0 && (close / shared >= MIN_AGREEMENT || (shared >= MIN_SHARED_EQUAL_DATES && shared - close <= MAX_STRAY_DATES));

const shareClassOf = (record) => record.name.match(/\bkelas\s+([a-z0-9]+)\b/i)?.[1].toLowerCase() ?? '';

// Classes of one fund often hold the same NAV from the day they start, so NAV cannot tell them apart.
const hasConflictingClass = (a, b) => shareClassOf(a) !== '' && shareClassOf(b) !== '' && shareClassOf(a) !== shareClassOf(b);

const ROMAN_NUMERAL = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
const ROMAN_DIGITS = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

// A lone C, D or M is a share class ("Equity Indonesia D"), not 100, 500 or 1000.
const isRomanNumeral = (word) => ROMAN_NUMERAL.test(word) && (word.length > 1 || 'ivxl'.includes(word));

// Numbered series ("Gemilang I" and "Gemilang II", "Proteksi 69", "Proteksi LXIX") are distinct funds with
// different histories. Only the last word counts, so index names such as "LQ45" or "SRI-KEHATI" carry no
// number, and four-digit years are not one. Roman and Arabic numerals are the same number.
const identityNumberOf = (record) => {
  const words = normalizeName(record.name).replace(/\bkelas [a-z0-9]+\b/g, ' ').trim().split(/\s+/);
  const last = words.at(-1);

  if (words.length < 2) {
    return null;
  }

  if (/^\d{1,3}$/.test(last)) {
    return Number(last);
  }

  if (isRomanNumeral(last)) {
    return [...last].reduce((total, letter, index, letters) => total + (ROMAN_DIGITS[letters[index + 1]] > ROMAN_DIGITS[letter] ? -1 : 1) * ROMAN_DIGITS[letter], 0);
  }

  return null;
};

const hasConflictingIdentityNumber = (a, b) => {
  const numberA = identityNumberOf(a);
  const numberB = identityNumberOf(b);

  return numberA !== null && numberB !== null && numberA !== numberB;
};

const currencyOf = (record) => record.currency || (USD_IN_NAME.test(record.name) ? 'USD' : '');

const hasCompatibleCurrency = (a, b) => {
  const currencyA = currencyOf(a);
  const currencyB = currencyOf(b);

  return currencyA === '' || currencyB === '' || currencyA === currencyB;
};

const hasSameKnownManager = (a, b) => isSameManager(a.manager, b.manager);

const hasCompatibleManager = (a, b) => a.manager === '' || b.manager === '' || hasSameKnownManager(a, b);

const words = (text) => normalizeName(text).split(' ').filter((word) => word !== '');

// The name without the words of either manager: "CIMB Islamic Equity Growth Syariah" under CIMB Principal and
// "Principal Islamic Equity Growth Syariah" under Principal both leave "islamic equity growth syariah".
const nameWithoutManagers = (record, other) => {
  const managerWords = new Set([...words(record.manager), ...words(other.manager)]);

  return words(record.name).filter((word) => !managerWords.has(word)).join(' ');
};

const managerPairOf = (a, b) => [normalizeManager(a.manager), normalizeManager(b.manager)].sort().join(' | ');

const lastDateOf = (record) => record.nav.dates.at(-1) ?? 0;

// Newest NAV first, then the longest history, then the key, so the choice never depends on file order.
const byRank = (a, b) => lastDateOf(b) - lastDateOf(a) || b.nav.dates.length - a.nav.dates.length || (a.key < b.key ? -1 : 1);

const bySourceThenRank = (a, b) => SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source) || byRank(a, b);

// Pairs of records from different sources that hold the same NAV on a date, with how many dates they share.
const findEqualNavPairs = (records) => {
  const entriesByDate = new Map();

  records.forEach((record, index) => {
    record.nav.dates.forEach((date, position) => {
      const value = record.nav.values[position];

      if (digitsOf(value) < MIN_DISTINCTIVE_DIGITS || isRoundNav(value)) {
        return;
      }

      if (!entriesByDate.has(date)) {
        entriesByDate.set(date, { indexes: [], values: [] });
      }

      entriesByDate.get(date).indexes.push(index);
      entriesByDate.get(date).values.push(value);
    });
  });

  const pairs = new Map();

  for (const { indexes, values } of entriesByDate.values()) {
    const order = Array.from(values.keys()).sort((a, b) => values[a] - values[b]);

    for (let first = 0; first < order.length; first++) {
      for (let second = first + 1; second < order.length && values[order[second]] - values[order[first]] <= SORTED_SEARCH_WINDOW; second++) {
        const a = records[indexes[order[first]]];
        const b = records[indexes[order[second]]];

        if (a.source !== b.source && valuesAgree(values[order[first]], values[order[second]])) {
          const pair = [indexes[order[first]], indexes[order[second]]].sort((x, y) => x - y);
          const key = pair[0] * records.length + pair[1];

          pairs.set(key, (pairs.get(key) ?? 0) + 1);
        }
      }
    }
  }

  return [...pairs.entries()].map(([key, equalDates]) => ({
    a: records[Math.floor(key / records.length)],
    b: records[key % records.length],
    equalDates,
  }));
};

const candidateId = (record) => `${ID_PREFIXES[record.source]}${record.id}`;

export const SOURCE_ID_COLUMNS = { bibit: 'symbol', bareksa: 'bareksa_id', kontan: 'kontan_id', makmur: 'makmur_id' };

// The record a fund ID was made from: "KTN14357" is "kontan:14357", and a Bibit symbol is itself.
export const recordKeyOfId = (id) => {
  const source = Object.keys(ID_PREFIXES).find((name) => ID_PREFIXES[name] !== '' && id.startsWith(ID_PREFIXES[name])) ?? 'bibit';

  return `${source}:${id.slice(ID_PREFIXES[source].length)}`;
};

// Aliases name a Bibit symbol ("RD1983") or a record ("bareksa:440"). `null` blocks automatic links and keeps the
// record as a fund of its own. "exclude" drops a record that carries another fund's NAV: it joins no fund and gets no page.
export const EXCLUDED = 'exclude';

const resolveAliasTarget = (target) => (target.includes(':') ? target : `bibit:${target}`);

export const linkFunds = ({ records: inputRecords, aliases, registry, today }) => {
  const records = inputRecords
    .map((record) => ({ ...record, nav: record.source === 'kontan' ? withoutStaleTail(record.nav) : record.nav, key: `${record.source}:${record.id}` }))
    .filter((record) => aliases[record.key] !== EXCLUDED);
  const recordsByKey = new Map(records.map((record) => [record.key, record]));
  const parent = new Map(records.map((record) => [record.key, record.key]));
  const membersByRoot = new Map(records.map((record) => [record.key, [record]]));
  const blockedKeys = new Set(Object.entries(aliases).filter(([, target]) => target === null).map(([key]) => key));
  const linksByRule = {};
  const refused = [];

  const rootOf = (key) => {
    let root = key;

    while (parent.get(root) !== root) {
      root = parent.get(root);
    }

    return root;
  };

  const merge = (a, b, rule) => {
    const [bigger, smaller] = [rootOf(a.key), rootOf(b.key)].sort((x, y) => membersByRoot.get(y).length - membersByRoot.get(x).length);

    parent.set(smaller, bigger);
    membersByRoot.get(bigger).push(...membersByRoot.get(smaller));
    membersByRoot.delete(smaller);
    linksByRule[rule] = (linksByRule[rule] ?? 0) + 1;
  };

  // Records with the same name and manager are trusted to be one fund, and sources do have stale or odd days,
  // so for them only a clear difference on the latest shared date refuses the merge. NAV evidence needs the
  // agreement on all shared dates as well.
  const conflictBetween = (x, y, isTrustedLink) => {
    if (hasConflictingClass(x, y)) {
      return `Kelas ${shareClassOf(x).toUpperCase()} vs Kelas ${shareClassOf(y).toUpperCase()}`;
    }

    if (hasConflictingIdentityNumber(x, y)) {
      return `number ${identityNumberOf(x)} vs number ${identityNumberOf(y)}`;
    }

    if (!hasCompatibleCurrency(x, y)) {
      return `currency ${currencyOf(x)} vs ${currencyOf(y)}`;
    }

    const comparison = compareNav(x, y);

    if (comparison.shared > 0 && comparison.latestDifference > MAX_LATEST_DIFFERENCE) {
      return `NAV differs by ${(comparison.latestDifference * 100).toFixed(1)}% on their latest shared date`;
    }

    if (!isTrustedLink && comparison.shared >= MIN_SHARED_EQUAL_DATES && !agreeOnDates(comparison)) {
      return `NAV is close on only ${comparison.close} of ${comparison.shared} shared dates`;
    }

    return null;
  };

  const tryMerge = (a, b, rule) => {
    if (rootOf(a.key) === rootOf(b.key)) {
      return;
    }

    for (const x of membersByRoot.get(rootOf(a.key))) {
      for (const y of membersByRoot.get(rootOf(b.key))) {
        const conflict = conflictBetween(x, y, rule === 'column' || rule === 'name');

        if (conflict) {
          refused.push({ rule, a: a.key, b: b.key, reason: `${x.key} and ${y.key}: ${conflict}` });

          return;
        }
      }
    }

    merge(a, b, rule);
  };

  const isFree = (record) => !blockedKeys.has(record.key);

  for (const [key, target] of Object.entries(aliases)) {
    const a = recordsByKey.get(key);
    const b = target === null ? undefined : recordsByKey.get(resolveAliasTarget(target));

    if (a && b && rootOf(a.key) !== rootOf(b.key)) {
      merge(a, b, 'alias');
    }
  }

  for (const record of records.filter(isFree)) {
    const bibitRecord = record.bibitSymbol && recordsByKey.get(`bibit:${record.bibitSymbol}`);

    if (bibitRecord && isFree(bibitRecord)) {
      tryMerge(record, bibitRecord, 'column');
    }
  }

  const namedRecords = records.filter((record) => isFree(record) && record.source !== 'bibit' && normalizeName(record.name) !== '');

  for (const sameName of Map.groupBy(namedRecords, (record) => normalizeName(record.name)).values()) {
    const bySource = Map.groupBy(sameName, (record) => record.source);
    const unique = [...bySource.values()].filter((group) => group.length === 1).map(([record]) => record);

    for (let first = 0; first < unique.length; first++) {
      for (let second = first + 1; second < unique.length; second++) {
        if (hasSameKnownManager(unique[first], unique[second])) {
          tryMerge(unique[first], unique[second], 'name');
        }
      }
    }
  }

  // Bibit lists about 65 old funds twice as empty shells: no manager, no NAV, and a fund file that is the same
  // apart from the symbol. Nothing tells the two apart, so they are one fund.
  const areEmptyShells = (a, b) => a.manager === '' && b.manager === '' && a.nav.dates.length === 0 && b.nav.dates.length === 0;

  // Bibit gives a fund a new symbol when it lists it again (RD846 and RD3820 are both Mandiri Dana Optima).
  // A manager never runs two funds of one name, so these merge unless their NAVs disagree.
  const namedBibitRecords = records.filter((record) => isFree(record) && record.source === 'bibit' && normalizeName(record.name) !== '');

  for (const sameName of Map.groupBy(namedBibitRecords, (record) => normalizeName(record.name)).values()) {
    for (let first = 0; first < sameName.length; first++) {
      for (let second = first + 1; second < sameName.length; second++) {
        if (hasSameKnownManager(sameName[first], sameName[second]) || areEmptyShells(sameName[first], sameName[second])) {
          tryMerge(sameName[first], sameName[second], 'bibit-relisted');
        }
      }
    }
  }

  const candidates = findEqualNavPairs(records)
    .filter(({ a, b }) => isFree(a) && isFree(b) && hasCompatibleCurrency(a, b))
    .sort((x, y) => y.equalDates - x.equalDates || (x.a.key + x.b.key < y.a.key + y.b.key ? -1 : 1));

  const shortCandidates = [];
  const renamedManagerCandidates = [];
  const otherManagerMatches = [];

  for (const { a, b } of candidates) {
    const comparison = compareNav(a, b);
    const agrees = agreeOnDates(comparison) && comparison.latestDifference <= MAX_LATEST_DIFFERENCE;

    if (!hasCompatibleManager(a, b)) {
      if (comparison.distinctive >= MIN_RENAMED_MANAGER_DATES && agrees) {
        const remainder = nameWithoutManagers(a, b);

        if (remainder !== '' && remainder === nameWithoutManagers(b, a)) {
          renamedManagerCandidates.push({ a, b, sameName: normalizeName(a.name) === normalizeName(b.name) });
        } else {
          otherManagerMatches.push({ a, b });
        }
      }
    } else if (comparison.distinctive >= MIN_SHARED_EQUAL_DATES && agrees) {
      tryMerge(a, b, 'nav');
    } else if (comparison.shared < MIN_SHARED_EQUAL_DATES && comparison.strong === comparison.shared && agrees && a.manager !== '' && b.manager !== '') {
      shortCandidates.push({ a, b });
    }
  }

  // Another record of the same source that could equally be the match, because it holds an equal value on a date
  // the two records share, makes that equal value a coincidence. Dates are aligned as in the matching itself.
  const hasLookalike = (record, other) => {
    const [alignedRecord, alignedOther] = alignNav(record, other).pair;
    const sharedValues = Array.from(alignedRecord.nav.dates)
      .map((date, position) => ({ date, value: alignedRecord.nav.values[position] }))
      .filter(({ date }) => valueOn(alignedOther, date) !== undefined);

    return records.some((candidate) => {
      if (candidate.source !== record.source || rootOf(candidate.key) === rootOf(record.key) || !hasCompatibleManager(candidate, other) || !hasCompatibleCurrency(candidate, other)) {
        return false;
      }

      // Both alignments count: the one that agrees best overall can hide an equal value on the other.
      const candidateAlignments = candidate.source === 'kontan' && other.source !== 'kontan' ? [candidate, movedBack(candidate)] : [candidate];

      return candidateAlignments.some((alignedCandidate) => sharedValues.some(({ date, value }) => {
        const candidateValue = valueOn(alignedCandidate, date);

        return candidateValue !== undefined && valuesAgree(candidateValue, value) && sharedDigits(candidateValue, value) >= MIN_DISTINCTIVE_DIGITS;
      }));
    });
  };

  // One or two equal dates are a coincidence unless the values are long, the managers are known and the same,
  // and nothing else in the other source could be the match. The conflict checks of tryMerge still apply.
  const renamedFundsPerManagerPair = Map.groupBy(renamedManagerCandidates, ({ a, b }) => managerPairOf(a, b));

  for (const { a, b, sameName } of renamedManagerCandidates) {
    if (sameName || renamedFundsPerManagerPair.get(managerPairOf(a, b)).length >= MIN_RENAMED_FUNDS_PER_MANAGER_PAIR) {
      tryMerge(a, b, 'nav-renamed-manager');
    } else {
      otherManagerMatches.push({ a, b });
    }
  }

  // Partners are counted as funds when the pair is decided, since earlier merges (a relisted Bibit fund's old and
  // new symbol, or a link made in this loop) can turn two candidates into one fund.
  const partnerFundsOf = (record, otherSource) => {
    const partners = new Set();

    for (const { a, b } of shortCandidates) {
      for (const [side, other] of [[a, b], [b, a]]) {
        if (rootOf(side.key) === rootOf(record.key) && other.source === otherSource) {
          partners.add(rootOf(other.key));
        }
      }
    }

    return partners;
  };

  const unlinkedShortCandidates = [];

  for (const { a, b } of shortCandidates) {
    if (partnerFundsOf(a, b.source).size === 1 && partnerFundsOf(b, a.source).size === 1 && !hasLookalike(a, b) && !hasLookalike(b, a)) {
      tryMerge(a, b, 'nav-short');
    } else {
      unlinkedShortCandidates.push(`${a.key} ~ ${b.key}`);
    }
  }

  const registryEntries = registry.length > 0
    ? registry.map((entry) => ({ ...entry }))
    : records.filter((record) => record.source === 'bibit').map((record) => ({ id: record.id, first_published: today, current_id: record.id }));
  const registryById = new Map(registryEntries.map((entry) => [entry.id, entry]));
  const recordByCandidateId = new Map(records.map((record) => [candidateId(record), record]));
  const unmappedTypes = new Map();

  const firstFrom = (members, priority, field) => priority
    .flatMap((source) => members.filter((member) => member.source === source))
    .map((member) => member[field])
    .find((value) => value !== '' && value !== undefined) ?? '';

  const chooseId = (members) => {
    const ordered = members.toSorted(bySourceThenRank);
    const published = ordered.map(candidateId).filter((id) => registryById.has(id));

    if (published.length === 0) {
      return candidateId(ordered[0]);
    }

    const live = published.filter((id) => registryById.get(id).current_id === id);
    let pool = live.length > 0 ? live : published;

    const primaryBibit = ordered.find((member) => member.source === 'bibit');

    if (pool.length > 1 && primaryBibit && pool.includes(candidateId(primaryBibit))) {
      return candidateId(primaryBibit);
    }

    const bibitDerived = pool.filter((id) => recordByCandidateId.get(id).source === 'bibit');

    pool = bibitDerived.length > 0 ? bibitDerived : pool;

    return pool.toSorted((a, b) => registryById.get(a).first_published.localeCompare(registryById.get(b).first_published) || (a < b ? -1 : 1))[0];
  };

  const newestBareksaDate = Math.max(0, ...records.filter((record) => record.source === 'bareksa').map(lastDateOf));
  const isActiveInBareksa = (record) => toDayNumber(newestBareksaDate) - toDayNumber(lastDateOf(record)) <= ACTIVE_DAYS;
  const newestDate = Math.max(0, ...records.map(lastDateOf));

  const buildFund = (members) => {
    const ordered = members.toSorted(bySourceThenRank);
    const bareksaMembers = ordered.filter((member) => member.source === 'bareksa');
    const nameOrder = [
      ...bareksaMembers.filter(isActiveInBareksa),
      ...NAME_PRIORITY.flatMap((source) => ordered.filter((member) => member.source === source)),
      ...bareksaMembers.filter((member) => !isActiveInBareksa(member)),
      // Kontan often writes names in capitals, so it names a fund only when no other source does.
      ...ordered.filter((member) => member.source === 'kontan'),
    ];
    const names = nameOrder.map((member) => member.name).filter((name) => name !== '');
    const knownNames = new Set([normalizeName(names[0] ?? '')]);
    const otherNames = [];

    for (const name of names) {
      if (!knownNames.has(normalizeName(name))) {
        knownNames.add(normalizeName(name));
        otherNames.push(name);
      }
    }

    const mappedTypes = TYPE_PRIORITY
      .flatMap((source) => ordered.filter((member) => member.source === source))
      .map((member) => ({ source: member.source, raw: member.type, mapped: TYPES[member.type.toLowerCase()] }))
      .filter(({ raw }) => raw !== '');

    for (const { raw, mapped } of mappedTypes) {
      if (!mapped) {
        unmappedTypes.set(raw, (unmappedTypes.get(raw) ?? 0) + 1);
      }
    }

    // Bibit's label wins unless two other sources agree on a different one. Its specialised labels (global, private
    // placement, real estate, gold ETF) have no counterpart elsewhere, so only a general label can be overruled.
    const typeBySource = new Map();

    for (const { source, mapped } of mappedTypes) {
      if (mapped && !typeBySource.has(source)) {
        typeBySource.set(source, mapped);
      }
    }

    const agreedOtherType = [...Map.groupBy([...typeBySource].filter(([source]) => source !== 'bibit'), ([, type]) => type)]
      .find(([type, votes]) => votes.length >= MIN_AGREEING_TYPE_SOURCES && type !== typeBySource.get('bibit'))?.[0];
    const bibitType = typeBySource.get('bibit');
    const overrulingType = bibitType === undefined || GENERAL_TYPES.has(bibitType) ? agreedOtherType : undefined;

    const launchSource = LAUNCH_DATE_PRIORITY.find((source) => ordered.some((member) => member.source === source && member.launchDate !== ''));
    const launchDates = ordered.filter((member) => member.source === launchSource && member.launchDate !== '').map((member) => member.launchDate);
    const allNames = names.join(' ');

    return {
      name: names[0] ?? '',
      otherNames,
      manager: firstFrom(ordered, MANAGER_PRIORITY, 'manager'),
      type: overrulingType ?? mappedTypes.find(({ mapped }) => mapped)?.mapped ?? '',
      currency: firstFrom(ordered, CURRENCY_PRIORITY, 'currency') || (USD_IN_NAME.test(allNames) ? 'USD' : ''),
      sharia: firstFrom(ordered, SHARIA_PRIORITY, 'sharia') || (SHARIA_IN_NAME.test(allNames) ? 'true' : ''),
      launchDate: launchDates.sort()[0] ?? '',
      sources: Object.fromEntries(SOURCES.map((source) => [source, ordered.filter((member) => member.source === source).map((member) => member.id)])),
      lastDate: Math.max(0, ...ordered.map(lastDateOf)),
    };
  };

  const groups = [...membersByRoot.values()].sort((a, b) => (a.map((member) => member.key).sort()[0] < b.map((member) => member.key).sort()[0] ? -1 : 1));
  const funds = groups.map((members) => ({ id: chooseId(members), ...buildFund(members), members }));
  const fundIdByKey = new Map(funds.flatMap((fund) => fund.members.map((member) => [member.key, fund.id])));
  const liveIds = new Set(funds.map((fund) => fund.id));

  for (const fund of funds) {
    if (!registryById.has(fund.id)) {
      const entry = { id: fund.id, first_published: today, current_id: fund.id };

      registryEntries.push(entry);
      registryById.set(fund.id, entry);
    }
  }

  for (const entry of registryEntries) {
    const record = recordByCandidateId.get(entry.id);

    if (liveIds.has(entry.id)) {
      entry.current_id = entry.id;
    } else if (record) {
      entry.current_id = fundIdByKey.get(record.key);
    }
  }

  // An entry whose record vanished keeps its old target, which may itself have been merged away since.
  for (const entry of registryEntries) {
    const seen = new Set([entry.id]);

    while (!liveIds.has(entry.current_id) && registryById.has(entry.current_id)) {
      if (seen.has(entry.current_id)) {
        throw new Error(`Redirect cycle in ${FUND_IDS_FILE} at ${entry.current_id}`);
      }

      seen.add(entry.current_id);
      entry.current_id = registryById.get(entry.current_id).current_id;
    }
  }

  const withBibit = funds.filter((fund) => fund.sources.bibit.length > 0);
  const nameDuplicates = [...Map.groupBy(funds, (fund) => `${normalizeName(fund.name)}|${fund.manager.toLowerCase()}`).values()]
    .filter((sameName) => sameName.length > 1 && normalizeName(sameName[0].name) !== '')
    .map((sameName) => sameName.map((fund) => fund.id).join(' '));

  return {
    funds: funds.map(({ members, lastDate, ...fund }) => fund),
    registry: registryEntries,
    report: {
      groups: funds.length,
      withBibit: withBibit.length,
      withoutBibit: funds.length - withBibit.length,
      linksByRule,
      refused,
      retiredIds: registryEntries.filter((entry) => entry.current_id !== entry.id).length,
      activeWithoutBibit: funds.filter((fund) => fund.sources.bibit.length === 0 && toDayNumber(newestDate) - toDayNumber(fund.lastDate) <= ACTIVE_DAYS && fund.lastDate > 0).map((fund) => fund.id),
      unmappedTypes,
      unlinkedShortCandidates,
      // A long equal history under different managers whose names disagree: a mislabelled record or a renamed fund, for a person to settle with an alias.
      unlinkedOtherManagerMatches: otherManagerMatches
        .filter(({ a, b }) => rootOf(a.key) !== rootOf(b.key))
        .map(({ a, b }) => `${a.key} ${a.name} (${a.manager}) ~ ${b.key} ${b.name} (${b.manager})`),
      nameDuplicates,
    },
  };
};

// OJK names a fund type right after "Reksa Dana" ("REKSA DANA INDEKS BAHANA IDX30"), which the other sources leave out.
const OJK_TYPE_WORD = /^(terproteksi|indeks|campuran|saham|pasar uang|pendapatan tetap) /;

// OJK lists every registered fund by name and manager, with no ID. A fund takes the OJK name that has the same
// normalized name and manager as one of its own names, when both sides are unique: the fund has one such OJK name,
// the OJK name has one such fund, and OJK itself lists the name once. The fund's own name counts before its other
// names, and OJK's name as written before the name without its type word. `ojkFunds` are the newest OJK rows as
// { name, manager, currency, count }, with `count` the number of rows with that name in its month.
export const matchOjkFunds = (funds, ojkFunds) => {
  const keyOf = (name, manager) => `${normalizeName(name)}|${normalizeManager(manager)}`;
  const usable = ojkFunds.filter((ojk) => ojk.count === 1 && normalizeManager(ojk.manager) !== '');
  const indexes = [
    Map.groupBy(usable, (ojk) => keyOf(ojk.name, ojk.manager)),
    Map.groupBy(usable, (ojk) => keyOf(normalizeName(ojk.name).replace(OJK_TYPE_WORD, ''), ojk.manager)),
  ];

  const findCandidates = (fund) => {
    for (const index of indexes) {
      for (const name of [fund.name, ...fund.otherNames]) {
        const candidates = (index.get(keyOf(name, fund.manager)) ?? []).filter((ojk) => fund.currency === '' || ojk.currency === fund.currency);

        if (candidates.length > 0) {
          return candidates;
        }
      }
    }

    return [];
  };

  const ojkNamesByFundId = new Map();

  for (const fund of funds) {
    const candidates = normalizeManager(fund.manager) === '' ? [] : findCandidates(fund);

    if (candidates.length === 1) {
      ojkNamesByFundId.set(fund.id, candidates[0].name);
    }
  }

  const fundsByOjkName = Map.groupBy(ojkNamesByFundId, ([, ojkName]) => ojkName);

  return new Map([...ojkNamesByFundId].filter(([, ojkName]) => fundsByOjkName.get(ojkName).length === 1));
};

const readNavSeries = (file, valueColumn) => {
  let text;

  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return makeNavSeries([]);
    }

    throw error;
  }

  const dates = [];
  const values = [];

  for (const line of text.split('\n').slice(1)) {
    const cells = line.split(',');
    const value = Number(cells[valueColumn]);

    if (cells[valueColumn] && value > 0) {
      dates.push(toDateNumber(cells[0]));
      values.push(value);
    }
  }

  return withoutSpikes(seriesFrom(dates, values));
};

const readMakmurSharia = (id) => {
  try {
    const { isSyariah } = JSON.parse(fs.readFileSync(`${DATA_DIR}/makmur/funds/${id}.json`, 'utf8'));

    return typeof isSyariah === 'boolean' ? String(isSyariah) : '';
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
};

// Makmur's price is the NAV times 100 (see README, "Makmur").
const makmurNav = (row) => {
  const price = Number(row.last_price);

  return row.as_of && price > 0 ? makeNavSeries([[row.as_of, price / 100]]) : makeNavSeries([]);
};

const loadRecords = async () => {
  const [bibit, bareksa, kontan, makmur] = await Promise.all(SOURCES.map((source) => readCsvRecords(`${DATA_DIR}/${source}/funds.csv`)));

  return [
    ...bibit.map((row) => ({
      source: 'bibit',
      id: row.symbol,
      name: row.name,
      manager: row.investment_manager,
      type: row.type,
      currency: row.currency,
      sharia: row.sharia,
      launchDate: row.nav_first_date,
      bibitSymbol: '',
      nav: readNavSeries(`${DATA_DIR}/bibit/nav/${row.symbol}.csv`, 1),
    })),
    ...bareksa.map((row) => ({
      source: 'bareksa',
      id: row.bareksa_id,
      name: row.name,
      manager: row.manager,
      type: row.type,
      // Bareksa can show a USD fund's AUM in Rp, so an IDR the name contradicts is not taken as the fund's currency.
      currency: row.currency === 'IDR' && USD_IN_NAME.test(row.name) ? '' : row.currency,
      sharia: '',
      launchDate: row.launch_date,
      bibitSymbol: row.bibit_symbol,
      nav: readNavSeries(`${DATA_DIR}/bareksa/nav/${row.bareksa_id}.csv`, 1),
    })),
    ...kontan.map((row) => ({
      source: 'kontan',
      id: row.kontan_id,
      name: row.name,
      manager: row.manager,
      type: row.category,
      currency: '',
      sharia: '',
      launchDate: '',
      bibitSymbol: row.bibit_symbol,
      nav: readNavSeries(`${DATA_DIR}/kontan/nav/${row.kontan_id}.csv`, 1),
    })),
    ...makmur.map((row) => ({
      source: 'makmur',
      id: row.makmur_id,
      name: row.name,
      manager: row.manager,
      type: row.category,
      currency: row.currency,
      sharia: readMakmurSharia(row.makmur_id),
      launchDate: row.inception_date,
      bibitSymbol: row.bibit_symbol,
      nav: makmurNav(row),
    })),
  ];
};

// The newest row of every OJK fund name, from the monthly files, oldest month first.
const loadOjkFunds = async () => {
  const months = fs.existsSync(OJK_DIR) ? fs.readdirSync(OJK_DIR).filter((file) => file.endsWith('.csv')).sort() : [];
  const latestByName = new Map();

  for (const file of months) {
    const month = file.slice(0, -'.csv'.length);

    for (const row of await readCsvRecords(`${OJK_DIR}/${file}`)) {
      const known = latestByName.get(row.fund);

      latestByName.set(row.fund, { name: row.fund, manager: row.manager, currency: row.currency, month, count: known?.month === month ? known.count + 1 : 1 });
    }
  }

  return [...latestByName.values()];
};

const printReport = ({ groups, withBibit, withoutBibit, linksByRule, refused, retiredIds, activeWithoutBibit, unmappedTypes, unlinkedShortCandidates, unlinkedOtherManagerMatches, nameDuplicates }) => {
  console.log(`Funds: ${groups} (${withBibit} with Bibit, ${withoutBibit} without)`);
  console.log(`Links by rule: ${JSON.stringify(linksByRule)}`);
  console.log(`Retired IDs: ${retiredIds}`);
  console.log(`Active funds without Bibit: ${activeWithoutBibit.length}`);
  console.log(`Merges refused: ${refused.length}`);

  for (const { rule, a, b, reason } of refused) {
    console.log(`  refused (${rule}) ${a} + ${b}: ${reason}`);
  }

  console.log(`Short-history NAV candidates not linked: ${unlinkedShortCandidates.length}`);

  for (const candidate of unlinkedShortCandidates.slice(0, 20)) {
    console.log(`  ${candidate}`);
  }

  console.log(`Long NAV matches not linked because both the names and the managers differ: ${unlinkedOtherManagerMatches.length}`);

  for (const match of unlinkedOtherManagerMatches) {
    console.log(`  ${match}`);
  }

  console.log(`Funds that share a name and manager but were not merged: ${nameDuplicates.length}`);

  for (const duplicate of nameDuplicates.slice(0, 20)) {
    console.log(`  ${duplicate}`);
  }

  for (const [type, count] of unmappedTypes) {
    console.log(`Unmapped type "${type}": ${count}`);
  }
};

const toFundsCsv = (funds) => toCsv(FUNDS_HEADER, funds.map((fund) => [
  fund.id,
  fund.name,
  fund.otherNames.join('|'),
  fund.manager,
  fund.type,
  fund.currency,
  fund.sharia,
  fund.launchDate,
  ...SOURCES.map((source) => fund.sources[source].join(' ')),
  fund.ojk ?? '',
]));

const main = async () => {
  const registry = await readCsvRecords(FUND_IDS_FILE);
  const today = new Date().toISOString().slice(0, 10);
  const result = linkFunds({ records: await loadRecords(), aliases: ALIASES, registry, today });

  const ojkFunds = await loadOjkFunds();
  const ojkNamesByFundId = matchOjkFunds(result.funds, ojkFunds);
  const sortedFunds = result.funds.map((fund) => ({ ...fund, ojk: ojkNamesByFundId.get(fund.id) })).toSorted((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

  await writeFileAtomic(FUNDS_FILE, toFundsCsv(sortedFunds));
  await writeFileAtomic(FUND_IDS_FILE, toCsv(FUND_IDS_HEADER, result.registry.map((entry) => FUND_IDS_HEADER.map((column) => entry[column]))));
  printReport(result.report);
  console.log(`OJK funds: ${ojkFunds.length}, linked to a fund: ${ojkNamesByFundId.size}`);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import ALIASES from '../scrapers/fund-aliases.json' with { type: 'json' };
import { isSameManager, normalizeName, readCsvRecords, toCsv, writeFileAtomic } from '../scrapers/lib.js';

const DATA_DIR = 'data';
const FUNDS_FILE = `${DATA_DIR}/funds.csv`;
const FUND_IDS_FILE = `${DATA_DIR}/fund-ids.csv`;
const FUNDS_HEADER = ['id', 'name', 'other_names', 'manager', 'type', 'currency', 'sharia', 'launch_date', 'bibit', 'bareksa', 'kontan', 'makmur'];
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
const MIN_SHARED_EQUAL_DATES = 3;
const MIN_DISTINCTIVE_DIGITS = 5;
const MIN_SHORT_HISTORY_DIGITS = 7;
const MIN_AGREEMENT = 0.95;
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
export const makeNavSeries = (rows) => seriesFrom(rows.map(([date]) => toDateNumber(date)), rows.map(([, value]) => value));

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

const compareSeries = (a, b) => {
  const comparison = { shared: 0, close: 0, distinctive: 0, strong: 0, latestDifference: 0 };
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
      comparison.latestDifference = Math.abs(x - y) / Math.max(x, y);

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

const compareNav = (a, b) => {
  const comparison = compareSeries(a, b);

  if (a.source !== 'kontan' && b.source !== 'kontan' || a.source === b.source) {
    return comparison;
  }

  const moved = a.source === 'kontan' ? compareSeries(movedBack(a), b) : compareSeries(a, movedBack(b));

  return moved.close > comparison.close ? moved : comparison;
};

const shareClassOf = (record) => record.name.match(/\bkelas\s+([a-z0-9]+)\b/i)?.[1].toLowerCase() ?? '';

// Classes of one fund often hold the same NAV from the day they start, so NAV cannot tell them apart.
const hasConflictingClass = (a, b) => shareClassOf(a) !== '' && shareClassOf(b) !== '' && shareClassOf(a) !== shareClassOf(b);

const ROMAN_NUMERAL = /^(x{0,2})(ix|iv|v?i{0,3})$/;
const ROMAN_DIGITS = { i: 1, v: 5, x: 10 };

// Numbered series ("Gemilang I" and "Gemilang II", "Proteksi 69") are distinct funds with different histories.
// Only the last word counts, so index names such as "LQ45" or "SRI-KEHATI" carry no number, and four-digit
// years are not one. Roman and Arabic numerals are the same number.
const identityNumberOf = (record) => {
  const words = normalizeName(record.name).replace(/\bkelas [a-z0-9]+\b/g, ' ').trim().split(/\s+/);
  const last = words.at(-1);

  if (words.length < 2) {
    return null;
  }

  if (/^\d{1,3}$/.test(last)) {
    return Number(last);
  }

  if (last !== '' && ROMAN_NUMERAL.test(last)) {
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

// Aliases name a Bibit symbol ("RD1983") or a record ("bareksa:440"). `null` blocks automatic links.
const resolveAliasTarget = (target) => (target.includes(':') ? target : `bibit:${target}`);

export const linkFunds = ({ records: inputRecords, aliases, registry, today }) => {
  const records = inputRecords.map((record) => ({ ...record, key: `${record.source}:${record.id}` }));
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

    if (!isTrustedLink && comparison.shared >= MIN_SHARED_EQUAL_DATES && comparison.close / comparison.shared < MIN_AGREEMENT) {
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

  const candidates = findEqualNavPairs(records)
    .filter(({ a, b }) => isFree(a) && isFree(b) && hasCompatibleManager(a, b) && hasCompatibleCurrency(a, b))
    .sort((x, y) => y.equalDates - x.equalDates || (x.a.key + x.b.key < y.a.key + y.b.key ? -1 : 1));

  const shortCandidates = [];

  for (const { a, b } of candidates) {
    const comparison = compareNav(a, b);
    const agrees = comparison.close / comparison.shared >= MIN_AGREEMENT && comparison.latestDifference <= MAX_LATEST_DIFFERENCE;

    if (comparison.distinctive >= MIN_SHARED_EQUAL_DATES && agrees) {
      tryMerge(a, b, 'nav');
    } else if (comparison.shared < MIN_SHARED_EQUAL_DATES && comparison.strong === comparison.shared && agrees && a.manager !== '' && b.manager !== '') {
      shortCandidates.push({ a, b });
    }
  }

  // Another record of the same source that could equally be the match, because it holds an equal value on a date
  // the two records share, makes that equal value a coincidence.
  const hasLookalike = (record, other) => {
    const otherDates = new Set(other.nav.dates);

    return Array.from(record.nav.dates).some((date, position) => otherDates.has(date) && records.some((candidate) => {
      const value = valueOn(candidate, date);

      return candidate.source === record.source && candidate.key !== record.key && hasCompatibleManager(candidate, other) && hasCompatibleCurrency(candidate, other) && value !== undefined && valuesAgree(value, record.nav.values[position]) && sharedDigits(value, record.nav.values[position]) >= MIN_DISTINCTIVE_DIGITS;
    }));
  };

  // One or two equal dates are a coincidence unless the values are long, the managers are known and the same,
  // and nothing else in the other source could be the match. The conflict checks of tryMerge still apply.
  const partnersOf = new Map();

  for (const { a, b } of shortCandidates) {
    for (const [record, other] of [[a, b], [b, a]]) {
      const partnerKey = `${record.key}>${other.source}`;

      partnersOf.set(partnerKey, [...(partnersOf.get(partnerKey) ?? []), other]);
    }
  }

  const unlinkedShortCandidates = [];

  for (const { a, b } of shortCandidates) {
    if (partnersOf.get(`${a.key}>${b.source}`).length === 1 && partnersOf.get(`${b.key}>${a.source}`).length === 1 && !hasLookalike(a, b) && !hasLookalike(b, a)) {
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
      .map((member) => ({ raw: member.type, mapped: TYPES[member.type.toLowerCase()] }))
      .filter(({ raw }) => raw !== '');

    for (const { raw, mapped } of mappedTypes) {
      if (!mapped) {
        unmappedTypes.set(raw, (unmappedTypes.get(raw) ?? 0) + 1);
      }
    }

    const launchSource = LAUNCH_DATE_PRIORITY.find((source) => ordered.some((member) => member.source === source && member.launchDate !== ''));
    const launchDates = ordered.filter((member) => member.source === launchSource && member.launchDate !== '').map((member) => member.launchDate);
    const allNames = names.join(' ');

    return {
      name: names[0] ?? '',
      otherNames,
      manager: firstFrom(ordered, MANAGER_PRIORITY, 'manager'),
      type: mappedTypes.find(({ mapped }) => mapped)?.mapped ?? '',
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
      nameDuplicates,
    },
  };
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

  return seriesFrom(dates, values);
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

const printReport = ({ groups, withBibit, withoutBibit, linksByRule, refused, retiredIds, activeWithoutBibit, unmappedTypes, unlinkedShortCandidates, nameDuplicates }) => {
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
]));

const main = async () => {
  const registry = await readCsvRecords(FUND_IDS_FILE);
  const today = new Date().toISOString().slice(0, 10);
  const result = linkFunds({ records: await loadRecords(), aliases: ALIASES, registry, today });

  const sortedFunds = result.funds.toSorted((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

  await writeFileAtomic(FUNDS_FILE, toFundsCsv(sortedFunds));
  await writeFileAtomic(FUND_IDS_FILE, toCsv(FUND_IDS_HEADER, result.registry.map((entry) => FUND_IDS_HEADER.map((column) => entry[column]))));
  printReport(result.report);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

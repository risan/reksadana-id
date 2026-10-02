// Runs both at build time and in the browser, so it must not import Node modules.
// Every function takes a fund in the shape of /api/funds/<symbol>.json.

const DAY_MS = 24 * 60 * 60 * 1000;

export const RETURN_PERIODS = ['1d', '1m', '3m', 'ytd', '1y', '3y', '5y', '10y', 'all'];

export const SOURCE_LABELS = {
  bibit: 'Bibit',
  bareksa: 'Bareksa',
  kontan: 'Kontan',
  'bareksa-monthly': 'Bareksa (monthly AUM ÷ units)',
};

function toTime(date) {
  return Date.parse(`${date}T00:00:00Z`);
}

function toDate(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function cleanPoints(rows, key, source, currency) {
  return rows
    .filter((row) => row[key] !== null && row[key] !== undefined && row[key] > 0)
    .map((row) => ({ date: row.date, value: row[key], source, ...(currency !== undefined && { currency }) }));
}

function monthlyNavFromBareksa(fund) {
  const unitsByDate = new Map(fund.bareksa.units.map((row) => [row.date, row.units]));
  // Bareksa reports a USD fund's AUM in both currencies; divide the one that matches the fund's NAV.
  const aumKey = fundCurrency(fund) === 'USD' ? 'aum_usd' : 'aum_idr';

  return fund.bareksa.aum
    .filter((row) => row[aumKey] > 0 && unitsByDate.get(row.date) > 0)
    .map((row) => ({ date: row.date, value: row[aumKey] / unitsByDate.get(row.date), source: 'bareksa-monthly' }));
}

// Which sources the history uses, each with its first and last date, from the points left after clean-up.
function sourceRuns(points) {
  const runs = new Map();

  for (const point of points) {
    const run = runs.get(point.source);

    if (run) {
      run.to = point.date;
    } else {
      runs.set(point.source, { source: point.source, from: point.date, to: point.date });
    }
  }

  return [...runs.values()];
}

export function daysBetween(fromDate, toDateText) {
  return (toTime(toDateText) - toTime(fromDate)) / DAY_MS;
}

// Consecutive NAVs further apart than this (a long weekend plus a holiday) are a gap in the history.
const NEXT_DAY_MAX_DAYS = 7;

function areNeighbours(earlier, later) {
  return daysBetween(earlier.date, later.date) <= NEXT_DAY_MAX_DAYS;
}

const SPIKE_MOVE = 0.15;
const SPIKE_RETURN = 0.05;

// A point far from both neighbours while the neighbours agree is a source error, not a market move.
// Across a gap in the history nothing is known about the days between, so nothing is dropped there.
function dropSpikes(points) {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    const next = points[index + 1];

    if (!previous || !next || !areNeighbours(previous, point) || !areNeighbours(point, next)) {
      return true;
    }

    const moveIn = point.value / previous.value - 1;
    const moveOut = next.value / point.value - 1;
    const netMove = next.value / previous.value - 1;

    return !(Math.abs(moveIn) > SPIKE_MOVE && Math.abs(moveOut) > SPIKE_MOVE && Math.abs(netMove) < SPIKE_RETURN);
  });
}

const FROZEN_AFTER_DAYS = 31;

// The date the series' final value first appeared, counting only the unbroken run at its end.
function startOfFinalRun(points) {
  let index = points.length - 1;

  while (index > 0 && points[index - 1].value === points.at(-1).value) {
    index--;
  }

  return points[index].date;
}

// Some sources keep listing a closed fund's last NAV every day. A real fund's NAV changes within a month,
// so a NAV unchanged for longer means the fund stopped when that NAV first appeared. Another source can
// show it earlier, as long as the chosen history has no other value after that date.
// Returns the point the history ends on, or null.
function frozenEnd(points, sourceLists) {
  if (points.length < 2) {
    return null;
  }

  const finalValue = points.at(-1).value;
  const lastChange = startOfFinalRun(points);

  if (daysBetween(lastChange, points.at(-1).date) <= FROZEN_AFTER_DAYS) {
    return null;
  }

  const candidates = [points.find((point) => point.date === lastChange)];

  for (const list of sourceLists) {
    if (list.length === 0 || list.at(-1).value !== finalValue) {
      continue;
    }

    const start = startOfFinalRun(list);

    if (points.every((point) => point.date < start || point.value === finalValue)) {
      candidates.push(list.find((point) => point.date === start));
    }
  }

  return candidates.sort((a, b) => a.date.localeCompare(b.date))[0];
}

const LARGE_MOVE = 0.2;

// Moves from one trading day to the next big enough that a reader should know: a real event or a source
// error. A change across a gap in the history is not a one-day move, so it is not listed.
export function largeMoves(points) {
  const moves = [];

  for (let index = 1; index < points.length; index++) {
    const change = points[index].value / points[index - 1].value - 1;

    if (Math.abs(change) > LARGE_MOVE && areNeighbours(points[index - 1], points[index])) {
      moves.push({ from: points[index - 1].date, date: points[index].date, change });
    }
  }

  return moves;
}

const SCALE_MISMATCH = 3;
const NEXT_DAY_MISMATCH = 0.2;

// Newer rows from another source join only if they continue the history: the same scale (a match to the
// wrong fund or unit is off by far more), and no jump over 20% from a NAV a few days earlier.
function continues(lastPoint, firstNewPoint) {
  const ratio = firstNewPoint.value / lastPoint.value;

  if (ratio > SCALE_MISMATCH || ratio < 1 / SCALE_MISMATCH) {
    return false;
  }

  return !areNeighbours(lastPoint, firstNewPoint) || Math.abs(ratio - 1) <= NEXT_DAY_MISMATCH;
}

// The canonical currency of data/funds.csv: 'IDR', 'USD', or null when no source says.
export function fundCurrency(fund) {
  return fund.fund?.currency || null;
}

// Bibit only gives a daily history (with nav_adjusted) for funds you can buy in its app. For the others it
// has one row per scrape, so a longer daily source wins, and newer rows from any source extend it.
export function pickNavHistory(fund) {
  const bibitRows = fund.nav ?? [];
  // Only Bibit's daily history fills nav_adjusted, so it tells a daily history from one row per scrape.
  const bibitIsDaily = bibitRows.some((row) => row.nav_adjusted !== null);
  const sources = {
    bibit: cleanPoints(bibitRows, 'nav', 'bibit'),
    bareksa: cleanPoints(fund.bareksa?.nav ?? [], 'nav', 'bareksa'),
    kontan: cleanPoints(fund.kontan?.nav ?? [], 'nav', 'kontan'),
  };

  let primary = null;

  if (bibitIsDaily && sources.bibit.length > 1) {
    primary = 'bibit';
  } else if (sources.bareksa.length > 1) {
    primary = 'bareksa';
  } else if (sources.kontan.length > 1) {
    primary = 'kontan';
  } else if (fund.bareksa && monthlyNavFromBareksa(fund).length > 1) {
    primary = 'bareksa-monthly';
    sources['bareksa-monthly'] = monthlyNavFromBareksa(fund);
  } else if (sources.bibit.length > 0) {
    primary = 'bibit';
  }

  if (primary === null) {
    return { points: [], primary: null, used: [], droppedSpikes: 0, frozenSince: null };
  }

  const base = sources[primary];
  const baseEnd = base.at(-1);
  const newerByDate = new Map();

  // Every source may fill days after the primary history ends; on a date two sources share, the first wins.
  for (const name of ['bibit', 'kontan', 'bareksa']) {
    const newer = sources[name].filter((point) => point.date > baseEnd.date);

    if (name === primary || newer.length === 0 || !continues(baseEnd, newer[0])) {
      continue;
    }

    for (const point of newer) {
      if (!newerByDate.has(point.date)) {
        newerByDate.set(point.date, point);
      }
    }
  }

  const points = [...base, ...[...newerByDate.values()].sort((a, b) => a.date.localeCompare(b.date))];
  const cleaned = dropSpikes(points);
  const end = frozenEnd(cleaned, Object.values(sources));
  const final = end ? [...cleaned.filter((point) => point.date < end.date), end] : cleaned;

  return {
    points: final,
    primary,
    used: sourceRuns(final),
    droppedSpikes: points.length - cleaned.length,
    frozenSince: end?.date ?? null,
  };
}

const UNIT_ERROR_RATIO = 10;

function isFarOff(value, reference) {
  const ratio = value / reference;

  return ratio > UNIT_ERROR_RATIO || ratio < 1 / UNIT_ERROR_RATIO;
}

// Some Bibit AUM figures are in the wrong unit: a USD fund in rupiah, a figure 1,000 times too big, or the
// NAV in place of the AUM. Bareksa's figure for the same month catches those; smaller differences are real.
function hasUnitError(bibitPoint, bareksaByMonth) {
  const sameMonth = bareksaByMonth.get(bibitPoint.date.slice(0, 7));

  return sameMonth !== undefined && isFarOff(bibitPoint.value, sameMonth);
}

// Every point knows its currency: Bareksa's column names it, and Bibit's figure is in the currency of the fund
// (null when no source states it, which the pages then show without a currency).
export function pickAumHistory(fund) {
  const key = fundCurrency(fund) === 'USD' ? 'aum_usd' : 'aum_idr';
  const bareksa = cleanPoints(fund.bareksa?.aum ?? [], key, 'bareksa', key === 'aum_usd' ? 'USD' : 'IDR');
  const bareksaByMonth = new Map(bareksa.map((point) => [point.date.slice(0, 7), point.value]));
  const bibitAll = cleanPoints(fund.aum ?? [], 'aum', 'bibit', fundCurrency(fund));
  const bibit = bibitAll.filter((point) => !hasUnitError(point, bareksaByMonth));
  const latestIsWrong = bibitAll.length > 0 && hasUnitError(bibitAll.at(-1), bareksaByMonth);

  if ((bibit.length > 1 && !latestIsWrong) || bareksa.length === 0) {
    return { points: bibit, source: bibit.length > 0 ? 'bibit' : null };
  }

  return { points: bareksa, source: 'bareksa' };
}

function shiftDate(date, { years = 0, months = 0, days = 0 }) {
  const [year, month, day] = date.split('-').map(Number);

  if (days) {
    return toDate(toTime(date) - days * DAY_MS);
  }

  const target = new Date(Date.UTC(year - years, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();

  target.setUTCDate(Math.min(day, lastDay));

  return toDate(target.getTime());
}

export function periodStartDate(period, endDate) {
  switch (period) {
    case '1m':
      return shiftDate(endDate, { months: 1 });
    case '3m':
      return shiftDate(endDate, { months: 3 });
    case '6m':
      return shiftDate(endDate, { months: 6 });
    case 'ytd':
      return `${Number(endDate.slice(0, 4)) - 1}-12-31`;
    case '1y':
      return shiftDate(endDate, { years: 1 });
    case '3y':
      return shiftDate(endDate, { years: 3 });
    case '5y':
      return shiftDate(endDate, { years: 5 });
    case '10y':
      return shiftDate(endDate, { years: 10 });
    default:
      return null;
  }
}

// Index of the last point on or before the date, or -1.
export function indexAtOrBefore(points, date) {
  let low = 0;
  let high = points.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;

    if (points[middle].date <= date) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}

function maxDrawdown(points, fromIndex) {
  let peak = points[fromIndex].value;
  let worst = 0;

  for (let index = fromIndex; index < points.length; index++) {
    peak = Math.max(peak, points[index].value);
    worst = Math.min(worst, points[index].value / peak - 1);
  }

  return worst;
}

// A start point further than this from the period's start date means the history has a gap there.
export function maxStartGapDays(primary) {
  return primary === 'bareksa-monthly' ? 40 : 10;
}

// Index of the NAV a period is measured from, or -1 when the history does not cover the period's start.
// The returns table and the chart's range buttons both use it, so they never disagree.
// `endDate` measures the period back from that date instead of the history's last NAV; the caller cuts the history there.
export function periodStartIndex(history, period, endDate) {
  const { points, primary } = history;
  const end = points.at(-1);

  if (points.length < 2) {
    return -1;
  }

  if (period === 'all') {
    return 0;
  }

  if (period === '1d') {
    return areNeighbours(points.at(-2), end) ? points.length - 2 : -1;
  }

  const targetDate = periodStartDate(period, endDate ?? end.date);
  const index = indexAtOrBefore(points, targetDate);

  if (index < 0 || index >= points.length - 1 || daysBetween(points[index].date, targetDate) > maxStartGapDays(primary)) {
    return -1;
  }

  return index;
}

const PERIOD_YEARS = { '1y': 1, '3y': 3, '5y': 5, '10y': 10 };

// Simple return, annualised return (CAGR), and max drawdown for each period, ending at the latest NAV,
// or at the last NAV on or before `endDate` when one is given.
export function computeReturns(fullHistory, endDate) {
  const history = endDate ? { ...fullHistory, points: fullHistory.points.slice(0, indexAtOrBefore(fullHistory.points, endDate) + 1) } : fullHistory;
  const { points } = history;
  const result = { simplereturn: {}, cagr: {}, maxdrawdown: {} };

  for (const period of RETURN_PERIODS) {
    const startIndex = periodStartIndex(history, period, endDate);

    if (startIndex < 0) {
      continue;
    }

    const start = points[startIndex];
    const end = points.at(-1);
    const simple = end.value / start.value - 1;
    const years = PERIOD_YEARS[period] ?? daysBetween(start.date, end.date) / 365.25;

    result.simplereturn[period] = simple;
    result.maxdrawdown[period] = maxDrawdown(points, startIndex);

    if (years >= 1) {
      result.cagr[period] = (1 + simple) ** (1 / years) - 1;
    }
  }

  return result;
}

// Evenly spaced samples of the last year, scaled to 0..100, for a sparkline.
export function sparkline(points, sampleCount = 40) {
  if (points.length < 2) {
    return null;
  }

  const endTime = toTime(points.at(-1).date);
  const startTime = toTime(shiftDate(points.at(-1).date, { years: 1 }));

  if (toTime(points[0].date) > startTime + 14 * DAY_MS) {
    return null;
  }

  const samples = [];

  for (let step = 0; step < sampleCount; step++) {
    const time = startTime + ((endTime - startTime) * step) / (sampleCount - 1);
    const index = indexAtOrBefore(points, toDate(time));

    samples.push(points[Math.max(index, 0)].value);
  }

  const low = Math.min(...samples);
  const high = Math.max(...samples);
  const span = high - low || 1;

  return samples.map((value) => Math.round(((value - low) / span) * 100));
}

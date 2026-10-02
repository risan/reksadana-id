// Runs both at build time and in the browser, so it must not import Node modules.
// The rules of the compare page. Every history is the object pickNavHistory returns.
import { computeReturns, daysBetween, indexAtOrBefore, maxStartGapDays, periodStartDate } from './series.js';

export const MIN_FUNDS = 2;
export const MAX_FUNDS = 5;
export const CHART_RANGES = ['1m', '6m', 'ytd', '1y', '3y', '5y', 'all'];

// A fund whose latest NAV is older than this, compared with the newest selected fund, has stopped or is not updated.
const STALE_AFTER_DAYS = 31;
const FUND_ID_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;

// The `f` parameter of the URL wins, even when empty; the saved tray only fills in when the URL has none.
export function selectionText(search, trayText) {
  const params = new URLSearchParams(search);

  return params.has('f') ? params.get('f') : (trayText ?? '');
}

// Turns "RD1,RD2" into fund IDs: retired IDs become the fund that holds them now, duplicates collapse, and
// anything malformed, unknown, or beyond the limit is returned in `dropped` as typed.
export function resolveSelection(text, { knownIds, retiredIds }) {
  const ids = [];
  const dropped = [];

  for (const typed of text.split(',').map((part) => part.trim()).filter(Boolean)) {
    const wellFormed = FUND_ID_PATTERN.test(typed);
    const current = wellFormed && Object.hasOwn(retiredIds, typed) ? retiredIds[typed] : typed;

    if (!wellFormed || !knownIds.has(current)) {
      dropped.push(typed);
    } else if (!ids.includes(current)) {
      if (ids.length < MAX_FUNDS) {
        ids.push(current);
      } else {
        dropped.push(typed);
      }
    }
  }

  return { ids, dropped };
}

export function selectionQuery(ids) {
  return ids.length === 0 ? '' : `?f=${ids.map(encodeURIComponent).join(',')}`;
}

// Index of the last NAV on or before the date, or -1 when there is none close enough to stand for that date.
export function observationAtOrBefore(history, date) {
  const index = indexAtOrBefore(history.points, date);

  if (index < 0 || daysBetween(history.points[index].date, date) > maxStartGapDays(history.primary)) {
    return -1;
  }

  return index;
}

// Splits the funds into those the chart and the period returns can use and those they cannot.
// The common end is the earliest latest-NAV date among the usable funds, so no fund is carried past its data.
// A stale fund is left out before the end is chosen, so it cannot pull the end back.
export function analyzeFunds(entries) {
  const excluded = [];
  const withHistory = [];

  for (const entry of entries) {
    if (entry.history.points.length < 2) {
      excluded.push({ id: entry.id, reason: 'no-history' });
    } else {
      withHistory.push({ ...entry, latest: entry.history.points.at(-1).date });
    }
  }

  const newest = withHistory.map((entry) => entry.latest).sort().at(-1);
  const fresh = [];

  for (const entry of withHistory) {
    if (daysBetween(entry.latest, newest) > STALE_AFTER_DAYS) {
      excluded.push({ id: entry.id, reason: 'stale', date: entry.latest });
    } else {
      fresh.push(entry);
    }
  }

  const commonEnd = fresh.map((entry) => entry.latest).sort()[0] ?? null;
  const eligible = [];

  for (const entry of fresh) {
    const endIndex = observationAtOrBefore(entry.history, commonEnd);

    if (endIndex < 0) {
      excluded.push({ id: entry.id, reason: 'gap', date: commonEnd });
    } else {
      eligible.push({ id: entry.id, history: entry.history, endIndex });
    }
  }

  return { commonEnd, eligible, excluded };
}

// Returns, CAGR, and max drawdown of an eligible fund, measured back from the common end.
export function returnsAtCommonEnd(entry, commonEnd) {
  return computeReturns(entry.history, commonEnd);
}

// Where a chart range starts, and the NAV each eligible fund is indexed from: its last NAV on or before the start.
// Null when the range cannot be drawn for every fund. Max starts at the latest first NAV among the funds.
export function chartRange(period, analysis) {
  const { commonEnd, eligible } = analysis;

  if (eligible.length === 0) {
    return null;
  }

  const startDate = period === 'all' ? eligible.map((entry) => entry.history.points[0].date).sort().at(-1) : periodStartDate(period, commonEnd);

  if (startDate >= commonEnd) {
    return null;
  }

  const startIndexById = {};

  for (const entry of eligible) {
    const startIndex = observationAtOrBefore(entry.history, startDate);

    if (startIndex < 0 || startIndex >= entry.endIndex) {
      return null;
    }

    startIndexById[entry.id] = startIndex;
  }

  return { startDate, startIndexById };
}

// One shared date axis for uPlot: every date any fund has a NAV on, and each fund's value indexed to 100 or null.
export function indexedSeries(analysis, range) {
  const dates = new Set();

  for (const entry of analysis.eligible) {
    for (let index = range.startIndexById[entry.id]; index <= entry.endIndex; index++) {
      dates.add(entry.history.points[index].date);
    }
  }

  const sortedDates = [...dates].sort();
  const series = analysis.eligible.map((entry) => {
    const startIndex = range.startIndexById[entry.id];
    const base = entry.history.points[startIndex].value;
    const indexByDate = new Map();

    for (let index = startIndex; index <= entry.endIndex; index++) {
      const point = entry.history.points[index];

      indexByDate.set(point.date, (point.value / base) * 100);
    }

    return { id: entry.id, values: sortedDates.map((date) => indexByDate.get(date) ?? null) };
  });

  return { dates: sortedDates, series };
}

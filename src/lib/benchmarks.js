import { computeReturns, daysBetween, indexAtOrBefore } from './series.js';

// The series a fund is usually compared with, by its type. A global or USD fund has no suitable series here:
// they are all in rupiah and track the Indonesian market.
export function suggestBenchmarkIds({ type, currency, sharia }) {
  if (currency === 'USD' || type === 'Reksadana Global') {
    return [];
  }

  switch (type) {
    case 'Pasar Uang':
      return ['bareksa-money-market', 'bi-rate'];
    case 'Obligasi':
    case 'Terproteksi':
      return ['bareksa-fixed-income'];
    case 'Saham':
      return sharia ? ['ihsg', 'jii', 'bareksa-equity'] : ['ihsg', 'bareksa-equity'];
    case 'Campuran':
      return ['bareksa-balanced', 'ihsg'];
    default:
      return [];
  }
}

// A series as of a date: the figures a fund page compares with the fund's own. An index gets its returns over
// the periods computeReturns knows, ending on the last day on or before `endDate`, so they line up with the
// fund's. A rate (the BI-Rate) has no return, only the value in force on that day.
export function benchmarkAt(series, endDate, startDate = '') {
  const endIndex = indexAtOrBefore(series.points, endDate);

  if (endIndex < 0) {
    return null;
  }

  const entry = { id: series.id, kind: series.kind, end_date: series.points[endIndex].date, value: series.points[endIndex].value };

  if (series.kind === 'rate') {
    return { ...entry, returns: null };
  }

  // The index is measured over the fund's own window: from the day the fund's history starts, "all" is the same stretch.
  const firstIndex = Math.max(0, indexAtOrBefore(series.points, startDate));

  return { ...entry, returns: computeReturns({ points: series.points.slice(firstIndex), primary: 'benchmark' }, endDate) };
}

// A series that stops more than this many days before a date has nothing to say about that date.
const MAX_LEVEL_GAP_DAYS = 7;

// The level of a series on a date, or -1 when it has none close enough.
function levelIndexOn(levels, date) {
  const index = indexAtOrBefore(levels, date);

  return index >= 0 && daysBetween(levels[index].date, date) <= MAX_LEVEL_GAP_DAYS ? index : -1;
}

// An index drawn over a fund's NAV chart: for each fund point from `startIndex` on, the index's level on that day
// scaled to start at the fund's NAV at the start, so the two lines show the same growth from the same point.
// Null before the start, and wherever the index has no level.
export function rebaseBenchmark(fundPoints, levels, startIndex) {
  const start = fundPoints[startIndex];
  const startLevelIndex = levelIndexOn(levels, start.date);

  if (startLevelIndex < 0) {
    return fundPoints.map(() => null);
  }

  const scale = start.value / levels[startLevelIndex].value;

  return fundPoints.map((point, index) => {
    const levelIndex = index < startIndex ? -1 : levelIndexOn(levels, point.date);

    return levelIndex < 0 ? null : levels[levelIndex].value * scale;
  });
}

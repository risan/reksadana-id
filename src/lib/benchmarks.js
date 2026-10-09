import { computeReturns, indexAtOrBefore } from './series.js';

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
export function benchmarkAt(series, endDate) {
  const endIndex = indexAtOrBefore(series.points, endDate);

  if (endIndex < 0) {
    return null;
  }

  const entry = { id: series.id, kind: series.kind, end_date: series.points[endIndex].date, value: series.points[endIndex].value };

  if (series.kind === 'rate') {
    return { ...entry, returns: null };
  }

  return { ...entry, returns: computeReturns({ points: series.points, primary: 'benchmark' }, endDate) };
}

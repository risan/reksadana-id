import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeReturns, dividendEvents, largeMoves, periodStartDate, pickAumHistory, pickNavHistory, withDividendsReinvested } from './series.js';

function dailyRows(startDate, values) {
  const start = Date.parse(`${startDate}T00:00:00Z`);

  return values.map((value, index) => ({
    date: new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    nav: value,
    nav_adjusted: value,
  }));
}

test('periodStartDate clamps to the end of a shorter month', () => {
  assert.equal(periodStartDate('1m', '2026-03-31'), '2026-02-28');
  assert.equal(periodStartDate('1y', '2024-02-29'), '2023-02-28');
  assert.equal(periodStartDate('ytd', '2026-10-01'), '2025-12-31');
});

test('pickNavHistory prefers Bibit daily history, then extends it with newer days from other sources', () => {
  const history = pickNavHistory({
    nav: dailyRows('2026-01-01', [100, 101, 102]),
    kontan: { nav: [{ date: '2026-01-03', nav: 102 }, { date: '2026-01-04', nav: 103 }] },
    bareksa: null,
  });

  assert.equal(history.primary, 'bibit');
  assert.deepEqual(history.points.map((point) => point.value), [100, 101, 102, 103]);
  assert.deepEqual(history.used.map((part) => part.source), ['bibit', 'kontan']);
});

test('pickNavHistory uses Bareksa before Kontan when Bibit has no daily history', () => {
  const history = pickNavHistory({
    nav: [{ date: '2026-01-05', nav: 105, nav_adjusted: null }],
    kontan: { nav: [{ date: '2026-01-01', nav: 100 }, { date: '2026-01-02', nav: 101 }] },
    bareksa: { nav: [{ date: '2026-01-01', nav: 100 }, { date: '2026-01-02', nav: 101 }], aum: [], units: [] },
  });

  assert.equal(history.primary, 'bareksa');
  assert.deepEqual(history.points.map((point) => point.date), ['2026-01-01', '2026-01-02', '2026-01-05']);
});

test('a one-day spike that reverses is dropped, a lasting move is kept and reported', () => {
  const spike = pickNavHistory({ nav: dailyRows('2026-01-01', [100, 100.1, 160, 100.2, 100.3]) });

  assert.deepEqual(spike.points.map((point) => point.value), [100, 100.1, 100.2, 100.3]);
  assert.equal(spike.droppedSpikes, 1);

  const lasting = pickNavHistory({ nav: dailyRows('2026-01-01', [100, 100, 50, 50, 50.1]) });

  assert.equal(lasting.points.length, 5);
  assert.deepEqual(largeMoves(lasting.points).map((move) => move.date), ['2026-01-03']);
});

test('a NAV unchanged for over a month is frozen from when any source first showed it', () => {
  const frozenValues = Array.from({ length: 40 }, () => 1049.22);
  const history = pickNavHistory({
    nav: [{ date: '2018-09-25', nav: 1049.22, nav_adjusted: null }],
    kontan: { nav: dailyRows('2025-10-02', frozenValues).map(({ date, nav }) => ({ date, nav })) },
  });

  assert.equal(history.frozenSince, '2018-09-25');
  assert.deepEqual(history.points.map((point) => point.date), ['2018-09-25']);
  assert.deepEqual(history.used.map((part) => part.source), ['bibit']);

  const moving = pickNavHistory({ nav: dailyRows('2026-01-01', Array.from({ length: 40 }, (_, index) => 100 + index)) });

  assert.equal(moving.frozenSince, null);
});

test('a frozen NAV first shown by another source between two observations ends the history on it', () => {
  const frozenTail = Array.from({ length: 45 }, (_, index) => ({
    date: new Date(Date.parse('2026-01-05T00:00:00Z') + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    nav: 110,
  }));
  const history = pickNavHistory({
    bareksa: { nav: [{ date: '2026-01-02', nav: 100 }, ...frozenTail], aum: [], units: [] },
    kontan: { nav: [{ date: '2026-01-03', nav: 110 }] },
  });

  assert.equal(history.frozenSince, '2026-01-03');
  assert.deepEqual(history.points.map((point) => [point.date, point.value]), [['2026-01-02', 100], ['2026-01-03', 110]]);
});

test('computeReturns measures from the last NAV on or before the period start', () => {
  const points = [
    { date: '2025-09-30', value: 90 },
    { date: '2025-10-01', value: 100 },
    { date: '2026-09-30', value: 109 },
    { date: '2026-10-01', value: 110 },
  ];
  const result = computeReturns({ points, primary: 'bibit' });

  assert.ok(Math.abs(result.simplereturn['1y'] - 0.1) < 1e-12);
  assert.ok(Math.abs(result.simplereturn['1d'] - (110 / 109 - 1)) < 1e-12);
  assert.equal(result.simplereturn['3y'], undefined);
});

test('computeReturns with an end date measures back from that date and ignores later NAVs', () => {
  const points = [
    { date: '2025-09-30', value: 90 },
    { date: '2025-10-01', value: 100 },
    { date: '2026-03-01', value: 70 },
    { date: '2026-09-30', value: 109 },
    { date: '2026-10-01', value: 110 },
  ];
  const result = computeReturns({ points, primary: 'bibit' }, '2026-09-30');

  assert.ok(Math.abs(result.simplereturn['1y'] - (109 / 90 - 1)) < 1e-12);
  assert.ok(Math.abs(result.maxdrawdown['1y'] - (70 / 100 - 1)) < 1e-12);
  assert.equal(result.simplereturn['1d'], undefined);
});

test('computeReturns skips a period whose start falls in a gap in the history', () => {
  const points = [
    { date: '2025-06-01', value: 100 },
    { date: '2026-09-01', value: 105 },
    { date: '2026-10-01', value: 110 },
  ];
  const result = computeReturns({ points, primary: 'bareksa' });

  assert.equal(result.simplereturn['1y'], undefined);
  assert.ok(Math.abs(result.simplereturn['1m'] - (110 / 105 - 1)) < 1e-12);
});

test('newer rows from another source fill every day after the primary history, by date', () => {
  const history = pickNavHistory({
    nav: [{ date: '2026-01-05', nav: 105, nav_adjusted: null }],
    bareksa: { nav: [{ date: '2026-01-01', nav: 100 }, { date: '2026-01-02', nav: 101 }], aum: [], units: [] },
    kontan: { nav: [{ date: '2026-01-03', nav: 102 }, { date: '2026-01-04', nav: 104 }, { date: '2026-01-05', nav: 105 }] },
  });

  assert.deepEqual(history.points.map((point) => point.date), ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']);
  assert.ok(Math.abs(computeReturns(history).simplereturn['1d'] - (105 / 104 - 1)) < 1e-12);
});

test('newer rows on a different scale, such as another fund, are not joined', () => {
  const history = pickNavHistory({
    nav: dailyRows('2026-01-01', [1.01, 1.0123]),
    kontan: { nav: [{ date: '2026-01-03', nav: 1303.62 }, { date: '2026-01-04', nav: 1304.22 }] },
  });

  assert.deepEqual(history.points.map((point) => point.value), [1.01, 1.0123]);
});

test('across a gap in the history, nothing is dropped as a spike or listed as a one-day move', () => {
  const points = [
    { date: '2022-12-23', nav: 1017.46, nav_adjusted: null },
    { date: '2025-11-12', nav: 1229.84, nav_adjusted: null },
    { date: '2026-04-27', nav: 1001.51, nav_adjusted: null },
  ];
  const history = pickNavHistory({ bareksa: { nav: points, aum: [], units: [] } });

  assert.equal(history.points.length, 3);
  assert.deepEqual(largeMoves(history.points), []);
});

test('a one-year return also has a per-year figure', () => {
  const points = [
    { date: '2025-10-01', value: 100 },
    { date: '2026-10-01', value: 110 },
  ];

  assert.ok(Math.abs(computeReturns({ points, primary: 'bibit' }).cagr['1y'] - 0.1) < 1e-12);
});

test('pickAumHistory drops single Bibit figures that are far off Bareksa for the same month', () => {
  const fund = {
    aum: [{ date: '2018-08-01', aum: 1.6e12 }, { date: '2018-09-26', aum: 11597.2 }, { date: '2018-10-01', aum: 1.62e12 }],
    bareksa: { aum: [{ date: '2018-09-28', aum_idr: 1.63e12, aum_usd: 1.1e8 }], units: [], nav: [] },
  };
  const history = pickAumHistory(fund);

  assert.equal(history.source, 'bibit');
  assert.deepEqual(history.points.map((point) => point.date), ['2018-08-01', '2018-10-01']);
});

test('pickAumHistory switches to Bareksa when Bibit is off by more than tenfold for the same month', () => {
  const fund = {
    fund: { currency: 'USD' },
    aum: [{ date: '2026-07-01', aum: 330_000_000_000 }, { date: '2026-08-01', aum: 337_400_000_000 }],
    bareksa: { aum: [{ date: '2026-08-01', aum_idr: 6_114_335_031_558, aum_usd: 338_219_661 }], units: [], nav: [] },
  };

  assert.equal(pickAumHistory(fund).source, 'bareksa');

  fund.aum[1].aum = 330_000_000;
  fund.aum[0].aum = 320_000_000;

  assert.equal(pickAumHistory(fund).source, 'bibit');
});

test('every AUM point carries its own currency: Bareksa by column, Bibit by the fund, null when unknown', () => {
  const bareksa = { aum: [{ date: '2026-08-01', aum_idr: 418_000_000, aum_usd: 25_000 }], units: [], nav: [] };

  assert.equal(pickAumHistory({ fund: { currency: 'USD' }, bareksa }).points[0].currency, 'USD');
  assert.equal(pickAumHistory({ fund: { currency: 'IDR' }, bareksa }).points[0].currency, 'IDR');
  assert.equal(pickAumHistory({ fund: { currency: null }, bareksa }).points[0].currency, 'IDR');
  assert.equal(pickAumHistory({ fund: { currency: null }, aum: [{ date: '2026-08-01', aum: 5e9 }] }).points[0].currency, null);
  assert.equal(pickAumHistory({ fund: { currency: 'USD' }, aum: [{ date: '2026-08-01', aum: 5e6 }] }).points[0].currency, 'USD');
});

// Rows whose nav_adjusted is nav times a factor that steps up at each ex-date, as in one Bibit download.
function adjustedRows(startDate, navs, factors) {
  return dailyRows(startDate, navs).map((row, index) => ({ ...row, nav_adjusted: row.nav * factors[index] }));
}

test('dividendEvents reads a dividend from a step up in nav_adjusted over nav', () => {
  // The payout is the step times the previous NAV: 100 * 0.01 = 1, reinvested at the ex-date NAV of 99.
  const fund = { nav: adjustedRows('2026-01-01', [100, 100, 99, 99], [1, 1, 1.01, 1.01]) };
  const events = dividendEvents(fund, pickNavHistory(fund));

  assert.equal(events.length, 1);
  assert.equal(events[0].date, '2026-01-03');
  assert.ok(Math.abs(events[0].factor - (1 + 1 / 99)) < 1e-9);
});

test('dividendEvents ignores a re-anchored nav_adjusted, which steps down, and rows without nav_adjusted', () => {
  const rows = adjustedRows('2026-01-01', [100, 100, 100, 100], [1.5, 1.5, 1, 1]);

  rows.push({ date: '2026-01-05', nav: 100, nav_adjusted: null }, { date: '2026-01-06', nav: 90, nav_adjusted: 130 });

  const fund = { nav: rows };

  assert.deepEqual(dividendEvents(fund, pickNavHistory(fund)), []);
});

test('dividendEvents adds a listed payout the nav_adjusted steps do not cover, reinvested at the ex-date NAV', () => {
  const fund = {
    nav: adjustedRows('2026-01-01', [100, 100, 98, 98], [1, 1, 1, 1]),
    dividends: [{ value: 2, date: '2026-01-02T17:00:00.000Z' }],
  };
  const events = dividendEvents(fund, pickNavHistory(fund));

  assert.deepEqual(events, [{ date: '2026-01-03', factor: 1 + 2 / 98 }]);
});

test('dividendEvents counts a payout once when a step already covers it', () => {
  const fund = {
    nav: adjustedRows('2026-01-01', [100, 100, 99, 99], [1, 1, 1.01, 1.01]),
    dividends: [{ value: 1, date: '2026-01-02T17:00:00.000Z' }],
  };

  assert.equal(dividendEvents(fund, pickNavHistory(fund)).length, 1);
});

test('dividendEvents skips a listed payout whose scale is off, or whose ex-date has no NAV yet', () => {
  const nav = adjustedRows('2026-01-01', [100, 100, 100], [1, 1, 1]);

  assert.deepEqual(dividendEvents({ nav, dividends: [{ value: 50, date: '2026-01-02T17:00:00.000Z' }] }, pickNavHistory({ nav })), []);
  assert.deepEqual(dividendEvents({ nav, dividends: [{ value: 2, date: '2026-02-01T17:00:00.000Z' }] }, pickNavHistory({ nav })), []);
});

test('dividendEvents skips a listed payout when the history has no NAV on its ex-date', () => {
  const nav = [
    { date: '2026-01-01', nav: 100, nav_adjusted: null },
    { date: '2026-01-05', nav: 80, nav_adjusted: null },
  ];
  const fund = { nav, dividends: [{ value: 10, date: '2026-01-02T17:00:00.000Z' }] };

  assert.deepEqual(dividendEvents(fund, pickNavHistory(fund)), []);
});

test('withDividendsReinvested lowers the points before an event so the series ends at the latest NAV', () => {
  const history = pickNavHistory({ nav: dailyRows('2026-01-01', [100, 100, 99, 99]) });
  const total = withDividendsReinvested(history, [{ date: '2026-01-03', factor: 1.01 }]);

  assert.equal(total.primary, 'bibit');
  assert.deepEqual(total.used, history.used);
  assert.deepEqual(total.points.map((point) => point.value), [100 / 1.01, 100 / 1.01, 99, 99]);
  assert.deepEqual(history.points.map((point) => point.value), [100, 100, 99, 99]);
});

test('a dividend that drops the NAV from 100 to 90 for a payout of 10 leaves the total return at zero', () => {
  const fund = { nav: adjustedRows('2026-01-01', [100, 100, 90, 90], [1, 1, 1.1, 1.1]) };
  const history = pickNavHistory(fund);
  const total = withDividendsReinvested(history, dividendEvents(fund, history));

  assert.ok(Math.abs(computeReturns(history).simplereturn.all - -0.1) < 1e-9);
  assert.ok(Math.abs(computeReturns(total).simplereturn.all) < 1e-9);
});

test('a real step (RD1544, 2026-03-27) gives the same total-return day as its listed payout', () => {
  const nav = [
    { date: '2026-03-25', nav: 2882.72, nav_adjusted: 3624.608700379537 },
    { date: '2026-03-26', nav: 2884.22, nav_adjusted: 3626.494736154974 },
    { date: '2026-03-27', nav: 2816.05, nav_adjusted: 3629.354844300881 },
  ];
  const dividends = [{ value: 72.15, date: '2026-03-26T17:00:00.000Z' }];
  const fromStep = dividendEvents({ nav }, pickNavHistory({ nav }));
  const fromList = dividendEvents({ nav: nav.map((row) => ({ ...row, nav_adjusted: null })), dividends }, pickNavHistory({ nav }));

  assert.equal(fromStep.length, 1);
  assert.deepEqual(fromList.map((event) => event.date), ['2026-03-27']);
  assert.ok(Math.abs(fromStep[0].factor - fromList[0].factor) < 1e-4);
  // The total return of that day is about the NAV change plus the payout over the previous NAV, not a loss of 2.4%.
  assert.ok(Math.abs(2816.05 * fromList[0].factor / 2884.22 - 1) < 5e-3);
});

const plainRows = (startDate, values) => dailyRows(startDate, values).map(({ date, nav }) => ({ date, nav }));

test('older days from Bareksa join a shorter Bibit history when they agree where both have a NAV', () => {
  const bareksa = plainRows('2026-01-01', [90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102]);
  const history = pickNavHistory({
    nav: dailyRows('2026-01-10', [99, 100, 101, 102]),
    bareksa: { nav: bareksa, aum: [], units: [] },
  });

  assert.equal(history.primary, 'bibit');
  assert.equal(history.primaryFrom, '2026-01-10');
  assert.equal(history.points[0].date, '2026-01-01');
  assert.equal(history.points.length, 13);
  assert.deepEqual(history.points.slice(8, 10).map((point) => point.source), ['bareksa', 'bibit']);
  assert.deepEqual(history.used.map((part) => part.source), ['bareksa', 'bibit']);
});

test('a long Bareksa history gives a short Bibit history its 3-year return', () => {
  const growing = (count, from) => Array.from({ length: count }, (_, index) => from * 1.0002 ** index);
  const bareksa = plainRows('2021-01-01', growing(1800, 1000));
  const sharedStart = bareksa[1500];
  const history = pickNavHistory({
    nav: dailyRows(sharedStart.date, growing(300, sharedStart.nav)),
    bareksa: { nav: bareksa, aum: [], units: [] },
  });
  const { simplereturn } = computeReturns(history);

  assert.ok(history.points.length > 1790);
  assert.ok(simplereturn['3y'] > 0);
  assert.ok(simplereturn['1y'] > 0);
});

test('older days that disagree with the primary history, or never overlap it, are not joined', () => {
  const nav = dailyRows('2026-01-10', [99, 100, 101, 102]);
  const disagreeing = plainRows('2026-01-01', [90, 91, 92, 93, 94, 95, 96, 97, 98, 149, 150, 151, 152]);
  const apart = plainRows('2026-01-01', [90, 91, 92, 93, 94, 95, 96, 97, 98]);

  assert.equal(pickNavHistory({ nav, bareksa: { nav: disagreeing, aum: [], units: [] } }).points[0].date, '2026-01-10');
  assert.equal(pickNavHistory({ nav, bareksa: { nav: apart, aum: [], units: [] } }).points[0].date, '2026-01-10');
});

test('older days that do not continue into the primary history are not joined', () => {
  const nav = dailyRows('2026-01-10', [99, 100, 101, 102]);
  const jumps = [{ date: '2026-01-05', nav: 60 }, { date: '2026-01-09', nav: 61 }, { date: '2026-01-10', nav: 99 }, { date: '2026-01-11', nav: 100 }];

  assert.equal(pickNavHistory({ nav, bareksa: { nav: jumps, aum: [], units: [] } }).points[0].date, '2026-01-10');
});

test('a total return covers only the days of the primary history, since older dividends are unknown', () => {
  const bareksa = plainRows('2026-01-01', [85, 85, 85, 85, 85, 85, 85, 85, 85, 100, 100, 90, 90]);
  const fund = {
    nav: adjustedRows('2026-01-10', [100, 100, 90, 90], [1, 1, 1.1, 1.1]),
    bareksa: { nav: bareksa, aum: [], units: [] },
  };
  const history = pickNavHistory(fund);
  const total = withDividendsReinvested(history, dividendEvents(fund, history));

  assert.equal(history.points[0].date, '2026-01-01');
  assert.equal(total.points[0].date, '2026-01-10');
  assert.ok(Math.abs(computeReturns(total).simplereturn.all) < 1e-9);
});

test('Kontan rows dated one trading day late are moved back to the day they belong to', () => {
  const bareksa = plainRows('2026-01-01', [100, 101, 103, 102, 104, 107, 106, 108]);
  const kontanLate = plainRows('2026-01-02', [100, 101, 103, 102, 104, 107, 106, 108, 109, 111]);
  const history = pickNavHistory({ bareksa: { nav: bareksa, aum: [], units: [] }, kontan: { nav: kontanLate } });

  assert.deepEqual(history.points.slice(-3).map((point) => [point.date, point.value, point.source]), [
    ['2026-01-08', 108, 'bareksa'],
    ['2026-01-09', 109, 'kontan'],
    ['2026-01-10', 111, 'kontan'],
  ]);
});

test('Kontan rows dated on the right day are left alone', () => {
  const bareksa = plainRows('2026-01-01', [100, 101, 103, 102, 104, 107, 106, 108]);
  const kontan = plainRows('2026-01-01', [100, 101, 103, 102, 104, 107, 106, 108, 109, 111]);
  const history = pickNavHistory({ bareksa: { nav: bareksa, aum: [], units: [] }, kontan: { nav: kontan } });

  assert.deepEqual(history.points.slice(-2).map((point) => [point.date, point.value]), [['2026-01-09', 109], ['2026-01-10', 111]]);
});

const farRun = (length) => Array.from({ length }, (_, index) => 1600 + index);

test('a stretch of up to ten rows far from the NAV, then back to it, is dropped as a source error', () => {
  const values = [1.02, 1.02, ...farRun(8), 1.02, 1.03];
  const history = pickNavHistory({ nav: dailyRows('2026-04-20', values) });

  assert.deepEqual(history.points.map((point) => point.value), [1.02, 1.02, 1.02, 1.03]);
  assert.equal(history.droppedSpikes, 8);
});

test('a far stretch longer than ten rows, or one that never returns, is a real move and stays', () => {
  const longRun = pickNavHistory({ nav: dailyRows('2026-04-01', [100, 100, ...farRun(11), 100, 100]) });
  const noReturn = pickNavHistory({ nav: dailyRows('2026-04-01', [100, 100, ...farRun(4), 130, 131]) });

  assert.equal(longRun.points.length, 15);
  assert.equal(noReturn.points.length, 8);
});

test('a stretch with a row near the NAV, or with a gap inside it, is not treated as an excursion', () => {
  const nearRow = pickNavHistory({ nav: dailyRows('2026-04-01', [100, 100, 150, 110, 112, 111, 100]) });
  const withGap = pickNavHistory({
    nav: [
      { date: '2026-04-01', nav: 100, nav_adjusted: null },
      { date: '2026-04-02', nav: 150, nav_adjusted: null },
      { date: '2026-05-02', nav: 150, nav_adjusted: null },
      { date: '2026-05-03', nav: 100, nav_adjusted: null },
    ],
  });

  assert.equal(nearRow.points.length, 7);
  assert.equal(withGap.points.length, 4);
});

test('two excursions in a row are both dropped', () => {
  const history = pickNavHistory({ nav: dailyRows('2026-04-01', [100, 100.5, 500, 501, 100.2, 800, 100.4, 100.6]) });

  assert.deepEqual(history.points.map((point) => point.value), [100, 100.5, 100.2, 100.4, 100.6]);
});

test('a source that starts over a year after the history ended joins only when it agrees where they overlap', () => {
  const ended = plainRows('2021-01-01', [100, 101, 102, 103, 104]);
  const later = plainRows('2025-01-01', [105, 106, 107, 108]);
  const overlapping = [...ended, ...plainRows('2025-01-01', [105, 106, 107, 108])];

  const unvouched = pickNavHistory({ bareksa: { nav: ended, aum: [], units: [] }, kontan: { nav: later } });
  const vouched = pickNavHistory({ bareksa: { nav: ended, aum: [], units: [] }, kontan: { nav: overlapping } });

  assert.equal(unvouched.points.length, 5);
  assert.equal(vouched.points.length, 9);
});

test('a source that starts within a year of the end of the history still joins without overlap', () => {
  const ended = plainRows('2025-06-01', [100, 101, 102, 103, 104]);
  const later = plainRows('2026-01-01', [105, 106, 107, 108]);
  const history = pickNavHistory({ bareksa: { nav: ended, aum: [], units: [] }, kontan: { nav: later } });

  assert.equal(history.points.length, 9);
});

test('a NAV that Kontan holds at two decimals for months and Bibit later lists at four is frozen from its first day', () => {
  const kontan = plainRows('2026-01-01', Array.from({ length: 60 }, () => 1268.36));
  const history = pickNavHistory({
    nav: [{ date: '2026-03-02', nav: 1268.3561, nav_adjusted: null }, { date: '2026-03-03', nav: 1268.3561, nav_adjusted: null }],
    kontan: { nav: kontan },
  });

  assert.equal(history.frozenSince, '2026-01-01');
  assert.equal(history.points.at(-1).date, '2026-01-01');
});

test('a money-market NAV that moves a little each day is not frozen, at two decimals or four', () => {
  const fourDecimals = pickNavHistory({ nav: dailyRows('2026-01-01', Array.from({ length: 60 }, (_, day) => 1000 + day * 0.0123)).map((row) => ({ ...row, nav_adjusted: null })) });
  const twoDecimals = pickNavHistory({ kontan: { nav: plainRows('2026-01-01', Array.from({ length: 60 }, (_, day) => Number((1000 + day * 0.07).toFixed(2)))) } });

  assert.equal(fourDecimals.frozenSince, null);
  assert.equal(twoDecimals.frozenSince, null);
});

test('a fund whose Bareksa NAV stopped moving long ago is frozen even if a re-dated Bibit row repeats it', () => {
  const bareksa = plainRows('2026-01-01', [1268.3561, 1268.3561, 1268.3561, 1268.3561, 1268.3561, 1268.3561, 1268.3561].concat(Array.from({ length: 50 }, () => 1268.3561)));
  const history = pickNavHistory({
    nav: [{ date: '2026-03-10', nav: 1268.36, nav_adjusted: null }],
    bareksa: { nav: bareksa, aum: [], units: [] },
  });

  assert.equal(history.frozenSince, '2026-01-01');
});

const monthlyAum = (values) => values.map((aum, index) => ({ date: `2026-${String(index + 1).padStart(2, '0')}-01`, aum }));

test('a month far from both neighbours, which agree with each other, is dropped from the fund size', () => {
  const history = pickAumHistory({ aum: monthlyAum([8.87e6, 527.37, 6.57e6, 77.7e9, 5.22e6, 5.5e6]) });

  assert.deepEqual(history.points.map((point) => point.value), [8.87e6, 6.57e6, 5.22e6, 5.5e6]);
});

test('a latest figure of a few rupiah after months in the billions is dropped, a real change is kept', () => {
  const absurd = pickAumHistory({ aum: monthlyAum([3.0e9, 3.05e9, 3.1e9, 1.38]) });
  const halved = pickAumHistory({ aum: monthlyAum([3.0e9, 3.05e9, 3.1e9, 1.1e9]) });

  assert.deepEqual(absurd.points.map((point) => point.value), [3.0e9, 3.05e9, 3.1e9]);
  assert.equal(halved.points.length, 4);
});

test('a fund that is small all along, or two odd months in a row, keeps its figures', () => {
  const small = pickAumHistory({ fund: { currency: 'USD' }, aum: monthlyAum([4.5e5, 4.7e5, 4.9e5]) });
  const twoMonths = pickAumHistory({ aum: monthlyAum([1e9, 1.1e9, 5e10, 5.1e10, 1.2e9]) });

  assert.equal(small.points.length, 3);
  assert.equal(twoMonths.points.length, 5);
});

test('a growing four-decimal NAV that ends on 1.05 is not frozen by the zeros it lost when it was stored as a number', () => {
  const values = Array.from({ length: 80 }, (_, day) => Number((1.0404 + day * 0.00012).toFixed(4)));

  values[values.length - 1] = 1.05;
  values[values.length - 2] = 1.0495;

  const history = pickNavHistory({ bareksa: { nav: plainRows('2026-01-01', values), aum: [], units: [] } });

  assert.equal(history.frozenSince, null);
  assert.equal(history.points.length, 80);
});

test('Kontan rows a day late are found when Kontan keeps two decimals and Bareksa four', () => {
  const bareksaValues = [2.3012, 2.3187, 2.3301, 2.3256, 2.3412, 2.3598, 2.3501, 2.3744, 2.3902];
  const kontanValues = ['2.30', '2.32', '2.33', '2.33', '2.34', '2.36', '2.35', '2.37', '2.39', '2.41'].map(Number);
  const history = pickNavHistory({
    bareksa: { nav: plainRows('2026-01-01', bareksaValues), aum: [], units: [] },
    kontan: { nav: plainRows('2026-01-02', kontanValues) },
  });

  assert.equal(history.points.at(-1).source, 'kontan');
  assert.equal(history.points.at(-1).date, '2026-01-10');
});

test('on a day Bareksa and Kontan both have after the primary history, the four-decimal NAV wins', () => {
  const history = pickNavHistory({
    nav: dailyRows('2026-01-01', [2.0001, 2.0099, 2.0195]),
    bareksa: { nav: [{ date: '2026-01-04', nav: 2.0638 }], aum: [], units: [] },
    kontan: { nav: [{ date: '2026-01-04', nav: 2.1 }] },
  });

  assert.equal(history.points.at(-1).value, 2.0638);
  assert.equal(history.points.at(-1).source, 'bareksa');
});

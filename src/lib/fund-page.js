// The rules of the fund page that need no markup: how a fund compares with the others of its type, and the profile text.
import { RETURN_PERIODS } from './series.js';

export const TABLE_PERIODS = RETURN_PERIODS.filter((period) => period !== '1d');

// A median or a rank among fewer funds than this says little, so the page leaves it out.
export const MIN_PEERS = 5;

const MAX_SUMMARY_LENGTH = 220;

function sortedByValue(values) {
  return values.sort((a, b) => a - b);
}

function addValue(valuesByPeriod, period, value) {
  if (value !== null && value !== undefined) {
    valuesByPeriod[period].push(value);
  }
}

function newValuesByPeriod() {
  return Object.fromEntries(TABLE_PERIODS.map((period) => [period, []]));
}

const peerReturnsCache = new WeakMap();

// For each fund type, the sorted returns of its active funds per period, as `nav` (the change in NAV) and `total`
// (dividends reinvested, which for a fund without dividends is the NAV change). `funds` are the rows of loadFundSummaries().
export function peerReturns(funds) {
  if (!peerReturnsCache.has(funds)) {
    const byType = new Map();

    for (const fund of funds) {
      if (!fund.active || !fund.type) {
        continue;
      }

      if (!byType.has(fund.type)) {
        byType.set(fund.type, { nav: newValuesByPeriod(), total: newValuesByPeriod() });
      }

      const peers = byType.get(fund.type);

      for (const period of TABLE_PERIODS) {
        const navReturn = fund[`return_${period}`];

        addValue(peers.nav, period, navReturn);
        addValue(peers.total, period, fund.total?.[`return_${period}`] ?? navReturn);
      }
    }

    for (const peers of byType.values()) {
      for (const view of [peers.nav, peers.total]) {
        for (const values of Object.values(view)) {
          sortedByValue(values);
        }
      }
    }

    peerReturnsCache.set(funds, byType);
  }

  return peerReturnsCache.get(funds);
}

// The middle of sorted values, or null when there are too few funds to call it a typical return.
export function median(sortedValues) {
  if (sortedValues.length < MIN_PEERS) {
    return null;
  }

  const middle = Math.floor(sortedValues.length / 2);

  return sortedValues.length % 2 === 1 ? sortedValues[middle] : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

// The median return in each period of one view (`nav` or `total`) of a type's funds, null where there are too few.
// `view` is undefined for a fund of no known type.
export function medianReturns(view) {
  return Object.fromEntries(TABLE_PERIODS.map((period) => [period, view ? median(view[period]) : null]));
}

// The share of the other funds in the group that this one beat, 0 to 1. The value must be one of the sorted values.
// Null when the group is too small to rank in.
export function shareBeaten(sortedValues, value) {
  if (sortedValues.length < MIN_PEERS) {
    return null;
  }

  const lower = sortedValues.filter((other) => other < value).length;

  return lower / (sortedValues.length - 1);
}

// The first line of the profile with a letter or a digit in it. Bibit stores "-" for a missing profile.
// Null when there is no real text, so the page can leave the section out.
export function profileSummary(profile) {
  const summary = (profile ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /[\p{L}\p{N}]/u.test(line));

  if (summary === undefined) {
    return null;
  }

  return summary.length > MAX_SUMMARY_LENGTH ? `${summary.slice(0, MAX_SUMMARY_LENGTH)}…` : summary;
}

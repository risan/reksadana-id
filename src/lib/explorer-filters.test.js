import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeSummaries } from './explorer-data.js';
import { DEFAULT_STATE, activeFilters, advancedFilterCount, clearedFilters, filterFunds, hasActiveFilters, parseState, prepareFunds, serializeState } from './explorer.js';

const TODAY = '2026-10-09';

function fund(overrides) {
  return {
    id: 'X',
    name: 'Fund X',
    names: ['Fund X'],
    manager: 'Manager A',
    type: 'Obligasi',
    currency: 'IDR',
    active: true,
    sharia: false,
    etf: false,
    index: false,
    bibit: true,
    makmur: false,
    dividends: false,
    large_move: false,
    total: null,
    spark: null,
    nav: 1,
    nav_date: TODAY,
    aum: 100e9,
    aum_currency: 'IDR',
    aum_date: TODAY,
    return_1y: 0.05,
    cagr_3y: 0.04,
    drawdown_1y: -0.02,
    expense_ratio: 0.01,
    min_purchase: 10000,
    launch_date: '2015-06-01',
    history_start: '2015-06-01',
    ...overrides,
  };
}

const prepare = (funds) => prepareFunds({ date: TODAY, usd_to_idr: 16000, funds });

test('a state with nothing set has an empty query string, and a query string gives the state back', () => {
  assert.equal(serializeState(DEFAULT_STATE), '');
  assert.deepEqual(parseState(''), DEFAULT_STATE);

  const state = {
    ...DEFAULT_STATE,
    q: 'bibit dana',
    type: 'Saham',
    currency: 'USD',
    sharia: true,
    dividends: true,
    managers: ['Manager A', 'Manager, B & C'],
    r1y_min: -5,
    r1y_max: 12.5,
    dd_max: 10,
    aum_min: 100,
    er_max: 1.5,
    minbuy_max: 100000,
    since: 2010,
    before: 2020,
    years: 3,
    sort: 'expense_ratio',
    dir: -1,
    page: 2,
    size: 100,
  };

  assert.deepEqual(parseState(serializeState(state)), state);
});

test('the existing parameter names and the new short ones are used', () => {
  const state = { ...DEFAULT_STATE, q: 'a', type: 'Saham', sharia: true, bibit: true, makmur: true, inactive: true, dividends: true, managers: ['M'], r1y_min: 1, er_max: 2, sort: 'name', dir: 1, page: 1 };
  const query = new URLSearchParams(serializeState(state));

  assert.deepEqual([...query.keys()], ['q', 'type', 'sharia', 'bibit', 'makmur', 'div', 'inactive', 'manager', 'r1y_min', 'er_max', 'sort', 'dir', 'page']);
  assert.equal(query.get('page'), '2');
  assert.equal(query.get('div'), '1');
});

test('an edited link falls back to defaults instead of breaking the page', () => {
  const state = parseState('?type=Nonsense&currency=EUR&sort=foo&page=-4&size=7&r1y_min=abc&er_max=&dir=sideways');

  assert.equal(state.type, '');
  assert.equal(state.currency, '');
  assert.equal(state.sort, DEFAULT_STATE.sort);
  assert.equal(state.dir, DEFAULT_STATE.dir);
  assert.equal(state.page, 0);
  assert.equal(state.size, DEFAULT_STATE.size);
  assert.equal(state.r1y_min, null);
  assert.equal(state.er_max, null);
});

test('a sort on a name or a cost starts with the smallest, any other with the largest', () => {
  assert.equal(parseState('?sort=name').dir, 1);
  assert.equal(parseState('?sort=expense_ratio').dir, 1);
  assert.equal(parseState('?sort=return_1y').dir, -1);
  assert.equal(parseState('?sort=name&dir=desc').dir, -1);
});

test('the pays-dividends filter keeps only funds that pay dividends', () => {
  const funds = prepare([fund({ id: 'A', dividends: true }), fund({ id: 'B' })]);

  assert.deepEqual(filterFunds(funds, { ...DEFAULT_STATE, dividends: true }).map((f) => f.id), ['A']);
});

test('the limits of the filter panel narrow the list, and a fund without the figure fails a limit on it', () => {
  const funds = prepare([
    fund({ id: 'A' }),
    fund({ id: 'B', return_1y: 0.2, drawdown_1y: -0.15, expense_ratio: 0.025, min_purchase: 1000000, aum: 5e9, manager: 'Manager B', launch_date: '2024-01-01', history_start: '2024-01-01' }),
    fund({ id: 'C', return_1y: null, cagr_3y: null, drawdown_1y: null, expense_ratio: null, min_purchase: null, launch_date: null, history_start: null }),
  ]);
  const ids = (changes) => filterFunds(funds, { ...DEFAULT_STATE, ...changes }).map((f) => f.id);

  assert.deepEqual(ids({}), ['A', 'B', 'C']);
  assert.deepEqual(ids({ r1y_min: 10 }), ['B']);
  assert.deepEqual(ids({ r1y_max: 10 }), ['A']);
  assert.deepEqual(ids({ r3y_min: 3 }), ['A', 'B']);
  assert.deepEqual(ids({ dd_max: 5 }), ['A']);
  assert.deepEqual(ids({ dd_min: 10 }), ['B']);
  assert.deepEqual(ids({ aum_min: 50 }), ['A', 'C']);
  assert.deepEqual(ids({ er_max: 2 }), ['A']);
  assert.deepEqual(ids({ minbuy_max: 100000 }), ['A']);
  assert.deepEqual(ids({ since: 2020 }), ['B']);
  assert.deepEqual(ids({ before: 2020 }), ['A']);
  assert.deepEqual(ids({ years: 5 }), ['A']);
  assert.deepEqual(ids({ managers: ['Manager B'] }), ['B']);
});

test('the fund size limit counts US dollar funds in rupiah', () => {
  const funds = prepare([fund({ id: 'USD', aum: 10e6, aum_currency: 'USD' }), fund({ id: 'IDR', aum: 10e6 })]);

  assert.deepEqual(filterFunds(funds, { ...DEFAULT_STATE, aum_min: 100 }).map((f) => f.id), ['USD']);
});

test('each set limit is one removable chip, and the count and the clear-all follow', () => {
  const state = { ...DEFAULT_STATE, q: ' dana ', type: 'Saham', managers: ['M1', 'M2'], r1y_min: 5, r1y_max: 20, er_max: 1.5 };
  const chips = activeFilters(state, 'en');

  assert.equal(chips.length, 6);
  assert.deepEqual(chips[0].clear, { q: '' });
  assert.deepEqual(chips[2].clear, { managers: ['M2'] });
  assert.deepEqual(chips[4].clear, { r1y_min: null, r1y_max: null });
  assert.equal(advancedFilterCount(state), 3);
  assert.equal(hasActiveFilters(state), true);
  assert.equal(hasActiveFilters({ ...DEFAULT_STATE, sort: 'name', page: 3 }), false);
  assert.deepEqual(clearedFilters({ ...state, sort: 'name', dir: 1, size: 25 }), { ...DEFAULT_STATE, sort: 'name', dir: 1, size: 25 });
});

test('data in the compact shape of explorer.json is prepared like the loaded summaries', () => {
  const compact = JSON.parse(JSON.stringify(encodeSummaries({ date: TODAY, usd_to_idr: 16000, funds: [fund({ id: 'A' })] })));
  const fromCompact = prepareFunds(compact);

  assert.equal(fromCompact[0].id, 'A');
  assert.equal(fromCompact[0].aum_idr, 100e9);
  assert.equal(Math.round(fromCompact[0].history_years), 11);
});

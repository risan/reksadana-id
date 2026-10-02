import assert from 'node:assert/strict';
import test from 'node:test';
import { linkFunds, makeNavSeries } from './link-funds.js';

const TODAY = '2026-10-02';
const MANAGER = 'Alpha Asset Management, PT';

const isoDay = (offset) => new Date(Date.UTC(2026, 8, 1 + offset)).toISOString().slice(0, 10);

// Distinctive NAVs with four decimals, one per day.
const fourDecimalNav = (days, start = 1500.1234) => Array.from({ length: days }, (_, day) => [isoDay(day), Number((start + day * 1.2345).toFixed(4))]);

const roundTo = (rows, decimals) => rows.map(([date, value]) => [date, Number(value.toFixed(decimals))]);

const record = (source, id, fields = {}) => ({
  source,
  id,
  name: `Fund ${id}`,
  manager: MANAGER,
  type: '',
  currency: '',
  sharia: '',
  launchDate: '',
  bibitSymbol: '',
  ...fields,
  nav: makeNavSeries(fields.nav ?? []),
});

const link = (records, { aliases = {}, registry = [] } = {}) => linkFunds({ records, aliases, registry, today: TODAY });

const findFund = (result, key) => {
  const [source, id] = key.split(':');

  return result.funds.find((fund) => fund.sources[source].includes(id));
};

test('a renamed fund links to Bibit by NAV and takes the active Bareksa name', () => {
  const nav = fourDecimalNav(5);
  const result = link([
    record('bibit', 'RD6436', { name: 'Kisi Fixed Income Fund Plus', manager: 'Kisi Asset Management, PT', nav }),
    record('bareksa', '4831', { name: 'KIM Fixed Income Fund Plus', manager: 'Korea Investment Management Indonesia, PT', nav }),
  ]);

  assert.equal(result.funds.length, 1);
  assert.equal(result.funds[0].id, 'RD6436');
  assert.equal(result.funds[0].name, 'KIM Fixed Income Fund Plus');
  assert.deepEqual(result.funds[0].otherNames, ['Kisi Fixed Income Fund Plus']);
  assert.equal(result.report.linksByRule['nav'], 1);
});

test('Bibit duplicates are merged through the Bareksa history and the placeholder alias', () => {
  const history = fourDecimalNav(30);
  const result = link(
    [
      record('bibit', 'RD1352', { nav: history.slice(0, 10) }),
      record('bibit', 'RD1983', { nav: history.slice(8) }),
      record('bibit', 'RD2280', { manager: '' }),
      record('bareksa', '440', { nav: history }),
    ],
    {
      aliases: { 'bibit:RD2280': 'RD1983' },
      registry: [
        { id: 'RD1352', first_published: '2026-09-01', current_id: 'RD1352' },
        { id: 'RD1983', first_published: '2026-09-01', current_id: 'RD1983' },
        { id: 'RD2280', first_published: '2026-09-01', current_id: 'RD2280' },
      ],
    },
  );

  assert.equal(result.funds.length, 1);
  assert.equal(result.funds[0].id, 'RD1983');
  assert.deepEqual(result.funds[0].sources.bibit, ['RD1983', 'RD1352', 'RD2280']);
  assert.deepEqual(result.funds[0].sources.bareksa, ['440']);

  const currentIds = Object.fromEntries(result.registry.map((entry) => [entry.id, entry.current_id]));

  assert.deepEqual(currentIds, { RD1352: 'RD1983', RD1983: 'RD1983', RD2280: 'RD1983' });
});

test('one equal NAV on one date is a coincidence, not a link', () => {
  const result = link([
    record('bibit', 'RD390', { nav: [['2019-01-07', 1002.3]] }),
    record('bareksa', '2369', { nav: [['2019-01-07', 1002.3], ['2019-01-08', 1003.1]] }),
  ]);

  assert.equal(result.funds.length, 2);
  assert.equal(result.report.linksByRule['nav'] ?? 0, 0);
});

test('USD funds with NAVs near 1.0 and two decimals are not linked', () => {
  const nearOne = Array.from({ length: 5 }, (_, day) => [isoDay(day), 1 + (day % 2) * 0.01]);
  const result = link([
    record('kontan', '1', { nav: nearOne, currency: 'USD' }),
    record('bareksa', '2', { nav: nearOne, currency: 'USD' }),
  ]);

  assert.equal(result.funds.length, 2);
});

test('funds that all sit at the 1000 launch NAV are not linked', () => {
  const launch = Array.from({ length: 5 }, (_, day) => [isoDay(day), 1000]);
  const result = link([
    record('bibit', 'RD1', { nav: launch }),
    record('bareksa', '2', { nav: launch }),
  ]);

  assert.equal(result.funds.length, 2);
});

test('Kontan with two decimals links to Bareksa with four decimals', () => {
  const bareksaNav = fourDecimalNav(10);
  const result = link([
    record('kontan', '15297', { nav: roundTo(bareksaNav, 2) }),
    record('bareksa', '440', { nav: bareksaNav }),
  ]);

  assert.equal(result.funds.length, 1);
});

test('share classes with the same NAV stay separate funds', () => {
  const nav = fourDecimalNav(5);
  const result = link([
    record('bibit', 'RD10885', { name: 'Grow Obligasi Kelas M', nav }),
    record('bibit', 'RD10886', { name: 'Grow Obligasi Kelas Q', nav }),
    record('bareksa', '5259', { name: 'Grow Obligasi Kelas M', nav }),
  ]);

  assert.deepEqual(result.funds.map((fund) => fund.id).sort(), ['RD10885', 'RD10886']);
  assert.deepEqual(findFund(result, 'bareksa:5259').sources.bibit, ['RD10885']);
});

test('equal NAVs from different managers are not linked', () => {
  const nav = fourDecimalNav(5);
  const result = link([
    record('bibit', 'RD1', { nav }),
    record('bareksa', '2', { nav, manager: 'Beta Asset Management, PT' }),
  ]);

  assert.equal(result.funds.length, 2);
});

test('a long equal history links across a renamed manager when the names mostly agree', () => {
  const nav = fourDecimalNav(12);
  const renamed = link([
    record('bareksa', '6', { name: 'Danapathi Equity Growth', manager: 'Danapathi Asset Management, PT', nav }),
    record('kontan', '16626', { name: 'DEMINA EQUITY GROWTH', manager: 'PT Shinhan Asset Management Indonesia.', nav }),
  ]);
  const shortHistory = link([
    record('bareksa', '6', { name: 'Danapathi Equity Growth', manager: 'Danapathi Asset Management, PT', nav: nav.slice(0, 9) }),
    record('kontan', '16626', { name: 'DEMINA EQUITY GROWTH', manager: 'PT Shinhan Asset Management Indonesia.', nav: nav.slice(0, 9) }),
  ]);

  assert.equal(renamed.funds.length, 1);
  assert.equal(renamed.report.linksByRule['nav-renamed-manager'], 1);
  assert.equal(shortHistory.funds.length, 2);
});

test('a long equal history under a different name and manager is reported, not linked', () => {
  const nav = fourDecimalNav(12);
  const result = link([
    record('bareksa', '3728', { name: 'Avrist Bond Fund', manager: 'Avrist Asset Management, PT', nav }),
    record('kontan', '15950', { name: 'Batavia Obligasi Negara 2', manager: 'PT. Batavia Prosperindo Aset Manajemen', nav }),
  ]);

  assert.equal(result.funds.length, 2);
  assert.equal(result.report.unlinkedOtherManagerMatches.length, 1);
});

test('a fund Bibit listed again under a new symbol is one fund', () => {
  const result = link([
    record('bibit', 'RD846', { name: 'Mandiri Dana Optima', manager: 'Mandiri Manajemen Investasi, PT', nav: [['2020-03-23', 1465.887]] }),
    record('bibit', 'RD3820', { name: 'Mandiri Dana Optima', manager: 'PT Mandiri Manajemen Investasi', nav: [['2021-02-15', 1483.5541]] }),
  ]);

  assert.equal(result.funds.length, 1);
  assert.equal(result.funds[0].id, 'RD3820');
  assert.equal(result.report.linksByRule['bibit-relisted'], 1);
});

test('Bibit records of one name stay apart when their NAVs differ or their managers are unknown', () => {
  const result = link([
    record('bibit', 'RD1', { name: 'Same Name Fund', nav: [['2026-09-30', 1500.1234]] }),
    record('bibit', 'RD2', { name: 'Same Name Fund', nav: [['2026-09-30', 1700.1234]] }),
    record('bibit', 'RD3', { name: 'Same Name Fund', manager: '' }),
  ]);

  assert.equal(result.funds.length, 3);
});

test('a short NAV match links when the other side is one relisted Bibit fund under two symbols', () => {
  const result = link([
    record('bibit', 'RD1961', { name: 'Minna Padi Hastinapura Saham', nav: [['2019-12-20', 812.3456]] }),
    record('bibit', 'RD10162', { name: 'Minna Padi Hastinapura Saham', nav: [['2026-09-30', 1587.7419], ['2026-10-01', 1588.1234]] }),
    record('bareksa', '3665', { name: 'Minna Padi Hastinapura Saham Baru', nav: [['2019-12-20', 812.3456], ['2026-09-30', 1587.7419], ['2026-10-01', 1588.1234]] }),
  ]);

  assert.equal(result.funds.length, 1);
  assert.equal(result.report.linksByRule['nav-short'], 1);
});

test('equal NAVs in different currencies are not linked', () => {
  const nav = fourDecimalNav(5);
  const result = link([
    record('bibit', 'RD1', { nav, currency: 'IDR' }),
    record('bareksa', '2', { nav, currency: 'USD' }),
  ]);

  assert.equal(result.funds.length, 2);
});

test('a short history links only on long, equal values from a known manager', () => {
  const recent = [['2026-09-30', 2587.7419], ['2026-10-01', 2588.1234]];
  const bareksaNav = [['2026-09-29', 2586.1], ...recent];
  const linked = link([
    record('bibit', 'RD1', { nav: recent }),
    record('bareksa', '2', { nav: bareksaNav }),
  ]);
  const otherManager = link([
    record('bibit', 'RD1', { nav: recent }),
    record('bareksa', '2', { nav: bareksaNav, manager: 'Beta Asset Management, PT' }),
  ]);

  assert.equal(linked.funds.length, 1);
  assert.equal(linked.report.linksByRule['nav-short'], 1);
  assert.equal(otherManager.funds.length, 2);
});

test('two sources with the same name and manager link when no Bibit fund is involved', () => {
  const result = link([
    record('kontan', '16548', { name: 'Reksa Dana Panin Global Sharia Equity Fund' }),
    record('bareksa', '4695', { name: 'Panin Global Sharia Equity Fund' }),
  ]);

  assert.equal(result.funds.length, 1);
  assert.equal(result.report.linksByRule['name'], 1);
});

test('a name shared by two funds of one source is not linked by name', () => {
  const result = link([
    record('kontan', '1', { name: 'Same Name Fund' }),
    record('kontan', '2', { name: 'Same Name Fund' }),
    record('bareksa', '3', { name: 'Same Name Fund' }),
  ]);

  assert.equal(result.funds.length, 3);
});

test('the bibit_symbol column links a record to its Bibit fund', () => {
  const result = link([
    record('bibit', 'RD7'),
    record('kontan', '5', { bibitSymbol: 'RD7' }),
  ]);

  assert.equal(result.funds.length, 1);
  assert.equal(result.report.linksByRule['column'], 1);
});

test('an alias of null blocks every automatic link of that record', () => {
  const nav = fourDecimalNav(5);
  const result = link(
    [
      record('bibit', 'RD1', { nav, name: 'Alpha Fund' }),
      record('bareksa', '2', { nav, name: 'Alpha Fund', bibitSymbol: 'RD1' }),
    ],
    { aliases: { 'bareksa:2': null } },
  );

  assert.equal(result.funds.length, 2);
});

test('an alias links a record whatever the evidence says', () => {
  const result = link(
    [
      record('bibit', 'RD1', { name: 'Old Name' }),
      record('bareksa', '440', { name: 'New Name', manager: 'Other, PT' }),
    ],
    { aliases: { 'bareksa:440': 'RD1' } },
  );

  assert.equal(result.funds.length, 1);
  assert.equal(result.report.linksByRule['alias'], 1);
});

test('a merge is refused when the members disagree on their NAV', () => {
  const kontanNav = fourDecimalNav(5);
  const bareksaNav = fourDecimalNav(5, 1700.5);
  const result = link([
    record('kontan', '1', { name: 'Alpha Fund', nav: kontanNav }),
    record('bareksa', '2', { name: 'Alpha Fund', nav: bareksaNav }),
  ]);

  assert.equal(result.funds.length, 2);
  assert.equal(result.report.refused.length, 1);
  assert.equal(result.report.refused[0].rule, 'name');
});

test('the ID of a fund stays stable across successive runs', () => {
  const olderNav = fourDecimalNav(5);
  const newerNav = fourDecimalNav(8);
  const bibitRecords = (nav2) => [record('bibit', 'RD1', { nav: olderNav }), record('bibit', 'RD2', { nav: nav2 })];
  const ids = (result) => result.funds.map((fund) => fund.id).sort();
  const currentId = (result, id) => result.registry.find((entry) => entry.id === id).current_id;

  const first = link(bibitRecords(newerNav));

  assert.deepEqual(ids(first), ['RD1', 'RD2']);
  assert.deepEqual(first.registry.map((entry) => entry.id).sort(), ['RD1', 'RD2']);

  const merged = link(bibitRecords(newerNav), { aliases: { 'bibit:RD1': 'RD2' }, registry: first.registry });

  assert.deepEqual(ids(merged), ['RD2']);
  assert.equal(currentId(merged, 'RD1'), 'RD2');

  const stillMerged = link(
    [record('bibit', 'RD1', { nav: fourDecimalNav(12, 1500.1234) }), record('bibit', 'RD2', { nav: newerNav })],
    { aliases: { 'bibit:RD1': 'RD2' }, registry: merged.registry },
  );

  assert.deepEqual(ids(stillMerged), ['RD2']);

  const split = link(bibitRecords(newerNav), { registry: stillMerged.registry });

  assert.deepEqual(ids(split), ['RD1', 'RD2']);
  assert.equal(currentId(split, 'RD1'), 'RD1');
  assert.equal(currentId(split, 'RD2'), 'RD2');
});

test('a group without Bibit takes a prefixed ID and registers it', () => {
  const result = link([record('bareksa', '37'), record('kontan', '9', { name: 'Other Fund' })]);

  assert.deepEqual(result.funds.map((fund) => fund.id).sort(), ['BRK37', 'KTN9']);
  assert.deepEqual(result.registry.map((entry) => entry.first_published), [TODAY, TODAY]);
});

test('types map to the Bibit vocabulary and the first source with a known type wins', () => {
  const result = link([
    record('bareksa', '1', { type: 'Pendapatan Tetap' }),
    record('kontan', '2', { name: 'Other', type: 'PASAR UANG' }),
    record('makmur', 'a', { name: 'Third', type: 'Indeks & ETF' }),
  ]);
  const typeOf = (key) => findFund(result, key).type;

  assert.equal(typeOf('bareksa:1'), 'Obligasi');
  assert.equal(typeOf('kontan:2'), 'Pasar Uang');
  assert.equal(typeOf('makmur:a'), '');
  assert.deepEqual([...result.report.unmappedTypes.keys()], ['Indeks & ETF']);
});

test('the Bibit type wins over the Bareksa type of the same fund', () => {
  const nav = fourDecimalNav(5);
  const result = link([
    record('bibit', 'RD7', { type: 'Reksadana Global', nav }),
    record('bareksa', '7', { type: 'Saham', nav }),
  ]);

  assert.equal(result.funds[0].type, 'Reksadana Global');
});

test('currency and sharia fall back to the name when no source states them', () => {
  const result = link([
    record('kontan', '1', { name: 'Schroder Dollar Syariah Fund' }),
    record('kontan', '2', { name: 'Plain Fund' }),
  ]);
  const fund = findFund(result, 'kontan:1');
  const plain = findFund(result, 'kontan:2');

  assert.equal(fund.currency, 'USD');
  assert.equal(fund.sharia, 'true');
  assert.equal(plain.currency, '');
  assert.equal(plain.sharia, '');
});

const SEQUIS = 'Sequis Aset Manajemen, PT';

test('numbered series of one manager stay apart even when a third source matches both by name and NAV', () => {
  const recent = [['2026-10-01', 969.8812], ['2026-09-30', 969.1234], ['2026-09-29', 968.5123]];
  const result = link([
    record('bareksa', '3569', { name: 'Sequis Proteksi Gemilang I', manager: SEQUIS, nav: [['2019-03-08', 1014.7355]] }),
    record('bareksa', '3727', { name: 'Reksa Dana Terproteksi Sequis Proteksi Gemilang II', manager: SEQUIS, nav: recent }),
    record('kontan', '15447', { name: 'SEQUIS PROTEKSI GEMILANG I', manager: 'PT. Sequis Aset Manajemen', nav: recent }),
  ]);

  assert.equal(result.funds.length, 2);
  assert.notEqual(findFund(result, 'bareksa:3727'), findFund(result, 'kontan:15447'));
  assert.ok(result.report.refused.some(({ reason }) => /number \d vs number \d/.test(reason)));
});

const latestNavDate = (result, records, key) => {
  const fund = findFund(result, key);

  return records
    .filter((member) => fund.sources[member.source].includes(member.id))
    .flatMap((member) => Array.from(member.nav.dates))
    .reduce((latest, date) => Math.max(latest, date), 0);
};

test('an alias moves a mislabelled Kontan record to its fund, and each history ends where it should', () => {
  const recent = [['2026-10-01', 969.8812], ['2026-09-30', 969.1234], ['2026-09-29', 968.5123]];
  const kontanRecent = roundTo(recent, 2);
  const records = [
    record('bareksa', '3569', { name: 'Sequis Proteksi Gemilang I', manager: SEQUIS, nav: [['2019-03-08', 1014.7355]] }),
    record('bareksa', '3727', { name: 'Reksa Dana Terproteksi Sequis Proteksi Gemilang II', manager: SEQUIS, nav: recent }),
    record('kontan', '15447', { name: 'SEQUIS PROTEKSI GEMILANG I', manager: 'PT. Sequis Aset Manajemen', nav: kontanRecent }),
  ];
  const result = link(records, { aliases: { 'kontan:15447': 'bareksa:3727' } });

  assert.equal(result.funds.length, 2);
  assert.equal(findFund(result, 'kontan:15447'), findFund(result, 'bareksa:3727'));
  assert.equal(latestNavDate(result, records, 'bareksa:3569'), makeNavSeries([['2019-03-08', 1]]).dates[0]);
  assert.equal(latestNavDate(result, records, 'bareksa:3727'), makeNavSeries([['2026-10-01', 1]]).dates[0]);
});

test('Roman and Arabic numbers are the same number, and a name without a trailing number conflicts with nothing', () => {
  const nav = fourDecimalNav(5);
  const result = link([
    record('kontan', '1', { name: 'Alpha Money Market Fund 5', nav }),
    record('bareksa', '2', { name: 'Alpha Money Market Fund V', nav }),
    record('makmur', 'm1', { name: 'Alpha Money Market Fund', nav }),
  ]);

  assert.equal(result.funds.length, 1);
});

test('Roman numbers above 29 are series numbers, and Arabic equals Roman', () => {
  const nav = fourDecimalNav(5);
  const conflict = link([
    record('kontan', '1', { name: 'Alpha Proteksi XXX', nav }),
    record('bareksa', '2', { name: 'Alpha Proteksi XXXI', nav }),
  ]);
  const same = link([
    record('kontan', '1', { name: 'Alpha Proteksi LXIX', nav }),
    record('bareksa', '2', { name: 'Alpha Proteksi 69', nav }),
  ]);

  assert.equal(conflict.funds.length, 2);
  assert.equal(same.funds.length, 1);
});

test('a single shared date is no link between Roman numbers above 29', () => {
  const recent = [['2026-10-01', 2588.1234]];
  const result = link([
    record('bibit', 'RD1', { name: 'Alpha Proteksi XXX', nav: recent }),
    record('bareksa', '2', { name: 'Alpha Proteksi XXXI', nav: recent }),
  ]);

  assert.equal(result.funds.length, 2);
});

test('a lone share-class letter and words that only look Roman are not numbers', () => {
  for (const [first, second] of [['Alpha Equity D', 'Alpha Equity C'], ['Alpha Cimb', 'Alpha Plus']]) {
    const nav = fourDecimalNav(5);
    const result = link([
      record('kontan', '1', { name: first, nav }),
      record('bareksa', '2', { name: second, nav }),
    ]);

    assert.equal(result.funds.length, 1, `${first} / ${second}`);
  }
});

test('a third source cannot bridge two numbered series above 29', () => {
  const nav = fourDecimalNav(5);
  const result = link([
    record('kontan', '1', { name: 'Alpha Proteksi XXXIV', nav }),
    record('bareksa', '2', { name: 'Alpha Proteksi XXXV', nav }),
    record('makmur', 'm1', { name: 'Alpha Proteksi', nav }),
  ]);

  assert.equal(result.funds.length, 2);
});

test('numbers that are not a series identity do not block a link', () => {
  for (const name of ['Danareksa Indeks LQ45', 'Alpha IDX30', 'Alpha Indeks SRI-KEHATI', 'Alpha Fund 2024']) {
    const nav = fourDecimalNav(5);
    const result = link([
      record('kontan', '1', { name, nav }),
      record('bareksa', '2', { name: `${name} Syariah`, nav }),
    ]);

    assert.equal(result.funds.length, 1, name);
  }
});

test('the same numbered fund from two sources links, and the next number stays apart', () => {
  const nav = fourDecimalNav(5);
  const result = link([
    record('kontan', '1', { name: 'Danareksa Proteksi 69', nav }),
    record('bareksa', '2', { name: 'BRI Proteksi 69', nav }),
    record('bareksa', '3', { name: 'Danareksa Proteksi 70', nav }),
  ]);

  assert.equal(findFund(result, 'kontan:1'), findFund(result, 'bareksa:2'));
  assert.notEqual(findFund(result, 'bareksa:3'), findFund(result, 'kontan:1'));
});

test('an alias still links numbered funds that the guard would refuse', () => {
  const result = link([
    record('kontan', '1', { name: 'Alpha Fund I' }),
    record('bareksa', '2', { name: 'Alpha Fund II' }),
  ], { aliases: { 'kontan:1': 'bareksa:2' } });

  assert.equal(result.funds.length, 1);
});

test('a single shared date is no link when the names carry different numbers', () => {
  const recent = [['2026-10-01', 2588.1234]];
  const result = link([
    record('bibit', 'RD1', { name: 'Alpha Proteksi 1', nav: recent }),
    record('bareksa', '2', { name: 'Alpha Proteksi 2', nav: recent }),
  ]);

  assert.equal(result.funds.length, 2);
  assert.equal(result.report.linksByRule['nav-short'], undefined);
});

test('a short NAV match is no link when another record of the same source holds the same value on that date', () => {
  const recent = [['2026-10-01', 2588.1234]];
  const result = link([
    record('bibit', 'RD1', { name: 'Alpha Satu', nav: recent }),
    record('bareksa', '2', { name: 'Alpha Dua', nav: recent }),
    record('bareksa', '3', { name: 'Alpha Tiga', manager: '', nav: recent }),
  ]);

  assert.equal(result.funds.length, 3);
});

test('a short NAV match is no link when a Kontan record matches the same Bibit value on shifted dates', () => {
  const result = link([
    record('bibit', 'RD1', { name: 'Alpha Satu', nav: [['2026-09-30', 2588.1234], ['2026-10-01', 2589.5678]] }),
    record('kontan', '2', { name: 'Alpha Dua', nav: [['2026-09-30', 2588.1234], ['2026-10-01', 2588.1234], ['2026-10-02', 2589.5678]] }),
    record('kontan', '3', { name: 'Alpha Tiga', nav: [['2026-10-01', 2456.4321], ['2026-10-02', 2589.5678]] }),
  ]);

  assert.equal(result.funds.length, 3);
});

test('a short NAV match is no link when a Kontan record matches on raw dates but agrees better shifted', () => {
  const result = link([
    record('bibit', 'RD1', { name: 'Alpha Satu', nav: [['2026-09-30', 25888.12], ['2026-10-01', 25889.56]] }),
    record('kontan', '2', { name: 'Alpha Dua', nav: [['2026-09-30', 25888.12], ['2026-10-01', 25889.56]] }),
    record('kontan', '3', { name: 'Alpha Tiga', nav: [['2026-09-30', 25888.12], ['2026-10-01', 25888.11], ['2026-10-02', 25889.55]] }),
  ]);

  assert.equal(result.funds.length, 3);
});

test('a short NAV match between records of one manager with no number conflict stays linked (accepted risk)', () => {
  const recent = [['2026-10-01', 2588.1234]];
  const result = link([
    record('bibit', 'RD1', { name: 'Alpha Satu', nav: recent }),
    record('bareksa', '2', { name: 'Alpha Dua', nav: recent }),
  ]);

  assert.equal(result.funds.length, 1);
});

test('a redirect to a record that vanished follows the fund that absorbed its target', () => {
  const registry = [
    { id: 'RD1', first_published: '2026-01-01', current_id: 'RD1' },
    { id: 'RD2', first_published: '2025-01-01', current_id: 'RD2' },
    { id: 'BRK9', first_published: '2026-01-01', current_id: 'RD1' },
  ];
  const result = link([
    record('bibit', 'RD1', { name: 'Alpha Satu' }),
    record('bibit', 'RD2', { name: 'Alpha Dua', nav: [['2026-10-01', 1500.1234]] }),
  ], { registry, aliases: { 'bibit:RD1': 'bibit:RD2' } });
  const targets = Object.fromEntries(result.registry.map((entry) => [entry.id, entry.current_id]));

  assert.equal(targets.BRK9, 'RD2');
  assert.equal(targets.RD1, 'RD2');
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import ALIASES from '../scrapers/fund-aliases.json' with { type: 'json' };
import { readCsvRecords } from '../scrapers/lib.js';
import { EXCLUDED } from './link-funds.js';

const SOURCES = ['bibit', 'bareksa', 'kontan', 'makmur'];
const SOURCE_ID_COLUMNS = { bibit: 'symbol', bareksa: 'bareksa_id', kontan: 'kontan_id', makmur: 'makmur_id' };

const funds = await readCsvRecords('data/funds.csv');
const registry = await readCsvRecords('data/fund-ids.csv');
const fundById = new Map(funds.map((fund) => [fund.id, fund]));

assert.equal(fundById.size, funds.length, 'fund IDs are not unique');

for (const entry of registry) {
  assert.ok(fundById.has(entry.current_id), `fund-ids.csv: ${entry.id} points at ${entry.current_id}, which is not a fund`);
}

const ojkNames = funds.map((fund) => fund.ojk).filter((name) => name !== '');

assert.equal(ojkNames.length, new Set(ojkNames).size, 'an OJK fund is in two funds');

for (const source of SOURCES) {
  // A record the aliases exclude (it carries another fund's NAV) is in no fund.
  const sourceIds = (await readCsvRecords(`data/${source}/funds.csv`))
    .map((row) => row[SOURCE_ID_COLUMNS[source]])
    .filter((id) => ALIASES[`${source}:${id}`] !== EXCLUDED);
  const linkedIds = funds.flatMap((fund) => fund[source].split(' ').filter((id) => id !== ''));

  assert.equal(linkedIds.length, new Set(linkedIds).size, `a ${source} record is in two funds`);
  assert.deepEqual([...linkedIds].sort(), [...sourceIds].sort(), `data/funds.csv and data/${source}/funds.csv list different records`);
}

const firstNavDate = (source, id) => {
  try {
    return fs.readFileSync(`data/${source}/nav/${id}.csv`, 'utf8').split('\n')[1]?.split(',')[0] || null;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
};

const insight = fundById.get('RD1983');
const insightMembers = SOURCES.flatMap((source) => insight[source].split(' ').filter((id) => id !== '').map((id) => ({ source, id })));
const insightKeys = insightMembers.map(({ source, id }) => `${source}:${id}`);

for (const key of ['bareksa:440', 'bibit:RD1352', 'bibit:RD2280', 'bibit:RD2348']) {
  assert.ok(insightKeys.includes(key), `RD1983 must include ${key}`);
}

const insightFirstDate = insightMembers.map(({ source, id }) => firstNavDate(source, id)).filter(Boolean).sort()[0];

assert.ok(insightFirstDate?.startsWith('2011-'), `RD1983 history must start in 2011, it starts ${insightFirstDate}`);

const kim = fundById.get('RD6436');

assert.equal(kim.name, 'KIM Fixed Income Fund Plus');
assert.ok(kim.other_names.split('|').includes('Kisi Fixed Income Fund Plus'), 'RD6436 must list the Kisi name');

const fundHolding = (source, id) => funds.find((fund) => fund[source].split(' ').includes(id));

assert.notEqual(fundHolding('bibit', 'RD390'), fundHolding('bareksa', '2369'), 'RD390 and Bareksa 2369 are different funds');

const gemilangOne = fundHolding('bareksa', '3569');
const gemilangOneLastDate = fs.readFileSync('data/bareksa/nav/3569.csv', 'utf8').trim().split('\n').at(-1).split(',')[0];

assert.ok(gemilangOne.kontan === '', 'Gemilang I must not hold the Kontan record of Gemilang II');
assert.ok(gemilangOneLastDate.startsWith('2019-'), `BRK3569 latest NAV must be in 2019, it is ${gemilangOneLastDate}`);

// Kontan still lists these under the managers' old names (Shinhan, Demina, CIMB Principal).
assert.equal(fundHolding('bareksa', '6'), fundHolding('kontan', '16626'), 'Danapathi Equity Growth must hold its Kontan record');
assert.equal(fundHolding('bareksa', '2733'), fundHolding('kontan', '17042'), 'Danapathi Money Market Fund must hold the Demina Kontan record');
assert.equal(fundHolding('bareksa', '37'), fundHolding('kontan', '160'), 'Principal Islamic Equity Growth Syariah must hold the CIMB Kontan record');

assert.equal(fundHolding('bareksa', '3332'), fundHolding('bibit', 'RD3769'), 'Ashmore IDX30 Index Equity Fund must hold the Fwd Asset Bibit record');

// These Kontan records carry another fund's NAV under their own name.
assert.notEqual(fundHolding('bareksa', '3355'), fundHolding('kontan', '15637'), 'BRI MI Proteksi 60 and the Pinnacle Kontan record are different funds');
assert.notEqual(fundHolding('bareksa', '3728'), fundHolding('kontan', '15950'), 'Avrist Bond Fund and the Batavia Kontan record are different funds');

assert.equal(fundHolding('bibit', 'RD846'), fundHolding('bibit', 'RD3820'), 'RD846 and RD3820 are both Mandiri Dana Optima');
assert.equal(fundHolding('bibit', 'RD630'), fundHolding('bibit', 'RD3508'), 'RD630 and RD3508 are both Eastspring IDR High Grade Kelas A');

console.log(`data/funds.csv: ${funds.length} funds, ${registry.length} published IDs, checks passed.`);

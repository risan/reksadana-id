import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readCsvRecords } from '../scrapers/lib.js';

const SOURCES = ['bibit', 'bareksa', 'kontan', 'makmur'];
const SOURCE_ID_COLUMNS = { bibit: 'symbol', bareksa: 'bareksa_id', kontan: 'kontan_id', makmur: 'makmur_id' };

const funds = await readCsvRecords('data/funds.csv');
const registry = await readCsvRecords('data/fund-ids.csv');
const fundById = new Map(funds.map((fund) => [fund.id, fund]));

assert.equal(fundById.size, funds.length, 'fund IDs are not unique');

for (const entry of registry) {
  assert.ok(fundById.has(entry.current_id), `fund-ids.csv: ${entry.id} points at ${entry.current_id}, which is not a fund`);
}

for (const source of SOURCES) {
  const sourceIds = (await readCsvRecords(`data/${source}/funds.csv`)).map((row) => row[SOURCE_ID_COLUMNS[source]]);
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

console.log(`data/funds.csv: ${funds.length} funds, ${registry.length} published IDs, checks passed.`);

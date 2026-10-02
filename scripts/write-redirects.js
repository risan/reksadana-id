import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readCsvRecords } from '../scrapers/lib.js';

// URL prefixes of the HTML pages, one per language. The default language has none.
const PAGE_PREFIXES = [''];

export const buildRedirects = (retiredIds) => retiredIds.flatMap(({ id, current_id }) => [
  ...PAGE_PREFIXES.flatMap((prefix) => [
    `${prefix}/funds/${id} ${prefix}/funds/${current_id}/ 301`,
    `${prefix}/funds/${id}/ ${prefix}/funds/${current_id}/ 301`,
  ]),
  `/api/funds/${id}.json /api/funds/${current_id}.json 301`,
]);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const registry = await readCsvRecords('data/fund-ids.csv');
  const lines = buildRedirects(registry.filter((entry) => entry.id !== entry.current_id));

  await writeFile('dist/_redirects', `${lines.join('\n')}\n`);
  console.log(`dist/_redirects: ${lines.length} redirects.`);
}

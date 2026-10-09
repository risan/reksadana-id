import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readCsvRecords } from '../scrapers/lib.js';
import { SOURCE_ID_COLUMNS, recordKeyOfId } from './link-funds.js';

// URL prefixes of the HTML pages, one per language. The default language has none.
const PAGE_PREFIXES = ['', '/en'];

// Cloudflare redirects /funds/X to /funds/X/ only when that page exists, so a retired ID needs both forms.
// An ID with no current fund (its record carried another fund's NAV) sends its page to the explorer searched by
// its old name, as a temporary redirect, and its JSON is simply gone.
export const buildRedirects = (retiredIds) => retiredIds.flatMap(({ id, current_id, name }) => {
  if (current_id === '') {
    // The explorer searches word by word, so punctuation such as "(USD)" would match nothing.
    const query = encodeURIComponent(name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim());

    return PAGE_PREFIXES.flatMap((prefix) => [
      `${prefix}/funds/${id} ${prefix}/?q=${query} 302`,
      `${prefix}/funds/${id}/ ${prefix}/?q=${query} 302`,
    ]);
  }

  return [
    ...PAGE_PREFIXES.flatMap((prefix) => [
      `${prefix}/funds/${id} ${prefix}/funds/${current_id}/ 301`,
      `${prefix}/funds/${id}/ ${prefix}/funds/${current_id}/ 301`,
    ]),
    `/api/funds/${id}.json /api/funds/${current_id}.json 301`,
  ];
});

const nameOfRecord = async (id) => {
  const [source, recordId] = recordKeyOfId(id).split(':');
  const records = await readCsvRecords(`data/${source}/funds.csv`);

  return records.find((record) => record[SOURCE_ID_COLUMNS[source]] === recordId).name;
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const registry = await readCsvRecords('data/fund-ids.csv');
  const retired = registry.filter((entry) => entry.id !== entry.current_id);
  const lines = buildRedirects(await Promise.all(retired.map(async (entry) => (entry.current_id === '' ? { ...entry, name: await nameOfRecord(entry.id) } : entry))));

  await writeFile('dist/_redirects', `${lines.join('\n')}\n`);
  console.log(`dist/_redirects: ${lines.length} redirects.`);
}

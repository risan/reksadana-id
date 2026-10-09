import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError, isSameManager, normalizeName, readCsvRecords, reportFailures, runPool, stopAfterForbidden, toCsv, writeFileAtomic } from './lib.js';
import { UnreadableFileError, downloadPdf, evaluateFund, fetchWithPause, readPdfBytes } from './prospectus.js';
import * as allianz from './prospectus-managers/allianz.js';
import * as bahana from './prospectus-managers/bahana.js';
import * as batavia from './prospectus-managers/batavia.js';
import * as bni from './prospectus-managers/bni.js';
import * as bnpParibas from './prospectus-managers/bnp-paribas.js';
import * as bri from './prospectus-managers/bri.js';
import * as eastspring from './prospectus-managers/eastspring.js';
import * as mandiri from './prospectus-managers/mandiri.js';
import * as hpam from './prospectus-managers/hpam.js';
import * as indoPremier from './prospectus-managers/indo-premier.js';
import * as manulife from './prospectus-managers/manulife.js';
import * as panin from './prospectus-managers/panin.js';
import * as samuel from './prospectus-managers/samuel.js';
import * as schroders from './prospectus-managers/schroders.js';
import * as sinarmas from './prospectus-managers/sinarmas.js';
import * as star from './prospectus-managers/star.js';
import * as syailendra from './prospectus-managers/syailendra.js';
import * as trimegah from './prospectus-managers/trimegah.js';
import * as uob from './prospectus-managers/uob.js';

// Each adapter exports the manager's name as in data/funds.csv, `listDocuments()` (the prospectuses on the manager's
// website, as { name, url, link?, shareClass?, version? }), and maybe `downloadDocument(url)` for a file that a plain
// GET of its address does not give.
const ADAPTERS = [manulife, trimegah, mandiri, syailendra, bri, bahana, bni, batavia, bnpParibas, eastspring, star, panin, allianz, samuel, uob, indoPremier, sinarmas, hpam, schroders];

const DATA_DIR = path.join(import.meta.dirname, '..', 'data');
const FUNDS_FILE = path.join(DATA_DIR, 'funds.csv');
const BAREKSA_PROSPECTUS_FILE = path.join(DATA_DIR, 'bareksa', 'prospectus.csv');
const PROSPECTUS_FILE = path.join(DATA_DIR, 'managers', 'prospectus.csv');
const HEADER = ['fund_id', 'manager', 'url', 'link', 'version', 'status', 'year', 'operating_expense_pct', 'checked'];
const CONCURRENCY = 2;
// A server that gives no version of its files is asked again after this many days.
const RECHECK_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

// A file of fewer pages is a fact sheet that a manager put under the prospectus label.
const MIN_PROSPECTUS_PAGES = 5;
// A manager that answers 403 this many times in a row blocks this network.
const FORBIDDEN_LIMIT = 3;

const CLASS_SUFFIX_PATTERN = / (?:kelas|class) (?:[a-z][a-z]?\d?|\d)$/;

const classSuffixOf = (normalizedName) => normalizedName.match(CLASS_SUFFIX_PATTERN)?.[0] ?? '';

// Managers write "Reksa Dana Syariah Bahana Sukuk" on one site and "Bahana Sukuk Syariah" on another. The kind of fund
// before the brand is left out of both names.
const LEADING_KIND_PATTERN = /^(?:(?:syariah|indeks|index|pendapatan tetap|campuran|saham|pasar uang|terproteksi|etf|rdpt|rdt|rds) )+(?=.)/;

const keyOf = (name) => normalizeName(name).replace(LEADING_KIND_PATTERN, '');

const namesOf = (fund) => [fund.name, ...fund.other_names.split('|')].map(keyOf).filter((name) => name !== '');

const addTo = (map, key, value) => {
  map.set(key, [...(map.get(key) ?? []), value]);
};

// The funds each document is about, by name. A document named with a class ("... Kelas B") is about the fund of that
// name. A document without a class is about the funds of that name and its classes, because one prospectus covers all
// the classes of a fund. A name is never matched loosely. A fund that two different files claim has none.
// Returns the documents `byFund` (fund id to document), those that matched no fund, and the funds claimed twice.
export const matchDocuments = (documents, funds) => {
  const fundsByName = new Map();
  const fundsByNameWithoutClass = new Map();

  for (const fund of funds) {
    for (const name of new Set(namesOf(fund))) {
      addTo(fundsByName, name, fund);
      addTo(fundsByNameWithoutClass, name.slice(0, name.length - classSuffixOf(name).length), fund);
    }
  }

  const claims = new Map();
  const unmatched = [];

  for (const document of documents) {
    const name = keyOf(document.shareClass ? `${document.name} kelas ${document.shareClass}` : document.name);
    const candidates = classSuffixOf(name) === '' ? fundsByNameWithoutClass.get(name) : fundsByName.get(name);

    if (candidates === undefined) {
      unmatched.push(document);
    }

    for (const fund of new Set(candidates)) {
      addTo(claims, fund.id, document);
    }
  }

  const byFund = new Map();
  const ambiguous = [];

  for (const [fundId, claimingDocuments] of claims) {
    if (new Set(claimingDocuments.map((document) => document.url)).size === 1) {
      byFund.set(fundId, claimingDocuments[0]);
    } else {
      ambiguous.push({ fundId, urls: [...new Set(claimingDocuments.map((document) => document.url))] });
    }
  }

  return { byFund, unmatched, ambiguous };
};

// What a server says about the version of a file: the ETag, else the modification time, else the size. Empty when
// it says nothing (or does not answer a HEAD request), and the file is then read again after RECHECK_DAYS.
const fetchVersion = async (url) => {
  try {
    const response = await fetchWithPause(url, { method: 'HEAD' });
    await response.body?.cancel();

    if (!response.ok) {
      return '';
    }

    const etag = response.headers.get('etag');
    const modified = response.headers.get('last-modified');
    const length = response.headers.get('content-length');

    return etag ? `etag ${etag}` : modified ? `modified ${modified}` : length ? `length ${length}` : '';
  } catch {
    return '';
  }
};

const daysBetween = (earlierDate, laterDate) => (Date.parse(laterDate) - Date.parse(earlierDate)) / DAY_IN_MS;

export const needsReading = ({ row, url, version, today }) => row === undefined
  || row.url !== url
  || (version === '' ? daysBetween(row.checked, today) >= RECHECK_DAYS : version !== row.version);

const today = () => new Date().toISOString().slice(0, 10);

const percentOf = (row) => (row?.status === 'parsed' ? Number(row.operating_expense_pct) : null);

// Funds whose value in the manager's prospectus differs from the one in Bareksa's copy for the same year.
const findDisagreements = (funds, managerRows, bareksaRows) => funds.flatMap((fund) => {
  const managerRow = managerRows.get(fund.id);
  const bareksaRow = fund.bareksa.split(' ').map((id) => bareksaRows.get(id)).find((row) => row?.status === 'parsed');

  if (percentOf(managerRow) === null || !bareksaRow || managerRow.year !== bareksaRow.year || percentOf(managerRow) === Number(bareksaRow.operating_expense_pct)) {
    return [];
  }

  return [`${fund.id} ${fund.name}: ${managerRow.year} manager ${managerRow.operating_expense_pct}% Bareksa ${bareksaRow.operating_expense_pct}%`];
});

const main = async () => {
  const startedAt = Date.now();
  const rereadAll = process.argv.includes('--all');
  const onlyManager = process.argv.find((argument) => argument.startsWith('--manager='))?.slice('--manager='.length);
  const todayDate = today();
  const lastYear = new Date().getUTCFullYear() - 1;
  const funds = await readCsvRecords(FUNDS_FILE);
  const fundIds = new Set(funds.map((fund) => fund.id));
  const rows = new Map((await readCsvRecords(PROSPECTUS_FILE)).filter((row) => fundIds.has(row.fund_id)).map((row) => [row.fund_id, row]));
  const readFailures = [];
  const blockedManagers = [];
  const report = [];
  let attemptedFileCount = 0;

  const save = () => writeFileAtomic(PROSPECTUS_FILE, toCsv(
    HEADER,
    [...rows.values()].sort((a, b) => a.fund_id.localeCompare(b.fund_id)).map((row) => HEADER.map((column) => row[column])),
  ));

  for (const adapter of ADAPTERS.filter((candidate) => !onlyManager || candidate.manager.toLowerCase().includes(onlyManager.toLowerCase()))) {
    const managerName = adapter.manager;
    let documents;

    try {
      documents = await adapter.listDocuments();

      if (documents.length === 0) {
        throw new Error('the website lists no prospectus');
      }
    } catch (error) {
      blockedManagers.push(managerName);
      console.log(`::warning::${managerName}: prospectuses could not be listed (${error.message}); its stored rows are kept`);

      continue;
    }

    const managerFunds = funds.filter((fund) => isSameManager(fund.manager, managerName));
    const { byFund, unmatched, ambiguous } = matchDocuments(documents, managerFunds);
    const documentsToRead = new Map();

    for (const fund of managerFunds.filter((candidate) => byFund.has(candidate.id))) {
      const document = byFund.get(fund.id);
      const entry = documentsToRead.get(document.url) ?? { document, funds: [] };

      entry.funds.push(fund);
      documentsToRead.set(document.url, entry);
    }

    const filesToRead = [];

    for (const entry of documentsToRead.values()) {
      const version = entry.document.version ?? await fetchVersion(entry.document.url);

      entry.version = version;

      if (rereadAll || entry.funds.some((fund) => needsReading({ row: rows.get(fund.id), url: entry.document.url, version, today: todayDate }))) {
        filesToRead.push(entry);
      }
    }

    attemptedFileCount += filesToRead.length;

    const readFile = async ({ document, funds: documentFunds, version }) => {
      const setRows = (result) => {
        for (const fund of documentFunds) {
          const evaluation = typeof result === 'function' ? result(fund) : result;

          rows.set(fund.id, {
            fund_id: fund.id,
            manager: managerName,
            url: document.url,
            link: document.link && document.link !== document.url ? document.link : '',
            version,
            status: evaluation.status,
            year: evaluation.year ?? '',
            operating_expense_pct: evaluation.percent?.toFixed(2) ?? '',
            checked: todayDate,
          });
        }
      };

      try {
        const bytes = await (adapter.downloadDocument ?? downloadPdf)(document.url);
        const pdf = await readPdfBytes(document.url, bytes);

        setRows(pdf.pageCount < MIN_PROSPECTUS_PAGES ? { status: 'no_row' } : (fund) => evaluateFund(pdf, fund, lastYear));
      } catch (error) {
        if (error instanceof UnreadableFileError) {
          setRows({ status: 'unreadable' });
        } else if (error instanceof HttpError && error.status === 404) {
          console.log(`${managerName}: ${document.url} is gone`);
        } else {
          throw error;
        }
      }
    };

    const { worker, hasStopped } = stopAfterForbidden(readFile, FORBIDDEN_LIMIT);
    const failures = await runPool({
      items: filesToRead,
      worker,
      concurrency: CONCURRENCY,
      label: `${managerName} read`,
      describeItem: ({ document }) => document.url,
    });

    if (hasStopped()) {
      blockedManagers.push(managerName);
      console.log(`::warning::${managerName}: its files answer 403 to this network; the stored rows are kept`);
    } else {
      readFailures.push(...failures);
    }

    await save();

    const parsedCount = managerFunds.filter((fund) => rows.get(fund.id)?.status === 'parsed' && byFund.has(fund.id)).length;

    report.push({ manager: managerName, listed: documents.length, matched: byFund.size, read: filesToRead.length, parsed: parsedCount, unmatched, ambiguous });
  }

  await save();

  for (const { manager, listed, matched, read, parsed, unmatched, ambiguous } of report) {
    console.log(`${manager}: ${listed} documents listed, ${matched} funds matched, ${read} files read, ${parsed} funds with a value`);

    if (unmatched.length > 0) {
      console.log(`  no fund of the name: ${unmatched.map((document) => document.name).join('; ')}`);
    }

    if (ambiguous.length > 0) {
      console.log(`  claimed by two different files, skipped: ${ambiguous.map(({ fundId }) => fundId).join(' ')}`);
    }
  }

  const bareksaRows = new Map((await readCsvRecords(BAREKSA_PROSPECTUS_FILE)).map((row) => [row.bareksa_id, row]));
  const disagreements = findDisagreements(funds, rows, bareksaRows);
  const counts = Object.entries(Object.groupBy(rows.values(), (row) => row.status)).map(([status, group]) => `${status} ${group.length}`);

  console.log(`${rows.size} rows: ${counts.join(', ')}`);
  console.log(`Disagreements with Bareksa's copy for the same year: ${disagreements.length}`);

  if (disagreements.length > 0) {
    console.log(disagreements.join('\n'));
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      `Manager prospectuses: ${rows.size} funds with a row, ${[...rows.values()].filter((row) => row.status === 'parsed').length} with a value, ${disagreements.length} disagreeing with Bareksa's copy of the same year.`,
      blockedManagers.length > 0 ? `Not listed this run: ${blockedManagers.join(', ')}.` : '',
    ];

    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.filter((line) => line !== '').join('\n')}\n`);
  }

  console.log(`Done in ${Math.round((Date.now() - startedAt) / 1000)} seconds`);

  reportFailures(readFailures, attemptedFileCount);
};

if (process.argv[1] === import.meta.filename) {
  await main();
}

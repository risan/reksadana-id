import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { HttpError, readCsvRecords, reportFailures, runPool, sleep, toCsv, withRetries, writeFileAtomic } from './lib.js';

const BASE_URL = 'https://www.bareksa.com';
const DATA_DIR = path.join(import.meta.dirname, '..', 'data', 'bareksa');
const FUNDS_FILE = path.join(DATA_DIR, 'funds.csv');
const PROSPECTUS_FILE = path.join(DATA_DIR, 'prospectus.csv');
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CONCURRENCY = 3;
const REQUEST_DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 120 * 1000;
const MAX_PDF_BYTES = 80 * 1024 * 1024;
const SAVE_EVERY = 50;
const HEADER = ['bareksa_id', 'url', 'uploaded', 'status', 'year', 'operating_expense_pct', 'checked'];

// A prospectus prints one ratio per calendar year, and a fund's ratio is never close to this.
const MAX_PLAUSIBLE_PERCENT = 15;
const FIRST_PLAUSIBLE_YEAR = 2000;
// A scanned prospectus has no text layer, only a few stray characters per page.
const MIN_CHARACTERS_PER_PAGE = 200;
// Some prospectuses are scanned in part. When the table is not found and this share of the pages has no text,
// the table is probably a picture.
const BLANK_PAGE_CHARACTERS = 50;
const MIN_BLANK_PAGE_SHARE = 0.25;
// A fund launched after this day of a year did not exist for the whole year.
const LAST_PARTIAL_YEAR_START = '01-10';
const LINE_TOLERANCE = 3.5;
// Text that pdf.js splits into pieces ("B" and "eban") has no gap between the pieces; a space is about 2 to 3 units wide.
const JOIN_GAP = 1;
// How far above the label row its year headers can be.
const HEADER_REACH = 320;

const LABEL_PAGE_PATTERN = /(biaya|beban)\s*operasi|operating\s*(expenses?|charges?)/i;
const NUMBER_PATTERN = /^\(?-?\d{1,3}(?:[.,]\d{1,4})?\)?%?$/;
const YEAR_PATTERN = /^\(?(20\d\d)[),.:*]*$/;
const CLASS_PATTERN = /\b(?:[Kk][Ee][Ll][Aa][Ss]|[Cc][Ll][Aa][Ss][Ss])\s+([A-Z0-9])\b/;
// "Kelas/Class" over the columns of an audited table, whose letters stand on the next line.
const CLASS_MENTION_PATTERN = new RegExp(`${CLASS_PATTERN.source}|[Kk]elas\\s*/\\s*[Cc]lass`);
const CLASS_PATTERN_EVERYWHERE = new RegExp(CLASS_PATTERN, 'g');
const FUND_CLASS_PATTERN = /\b(?:kelas|class)\s+([a-z0-9])\s*$/i;

const splitIntoWords = (item) => {
  const characterWidth = item.str.length === 0 ? 0 : item.width / item.str.length;
  const words = [];

  for (const match of item.str.matchAll(/\S+/g)) {
    words.push({
      text: match[0],
      x0: item.x + match.index * characterWidth,
      x1: item.x + (match.index + match[0].length) * characterWidth,
      y: item.y,
      startsItem: match.index === 0,
      endsItem: match.index + match[0].length === item.str.length,
    });
  }

  return words;
};

// Words of one page, in reading order per line. Pieces of one word that pdf.js split are joined again.
const toLines = (items) => {
  const rawWords = items.flatMap(splitIntoWords).sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const lines = [];

  for (const word of rawWords) {
    const line = lines.find((candidate) => Math.abs(candidate.y - word.y) <= LINE_TOLERANCE);

    if (line) {
      line.words.push(word);
    } else {
      lines.push({ y: word.y, words: [word] });
    }
  }

  for (const line of lines) {
    line.words.sort((a, b) => a.x0 - b.x0);
    line.words = line.words.reduce((joined, word) => {
      const previous = joined.at(-1);

      if (previous && previous.endsItem && word.startsItem && word.x0 - previous.x1 < JOIN_GAP && word.x0 >= previous.x1 - JOIN_GAP) {
        joined[joined.length - 1] = { ...previous, text: previous.text + word.text, x1: word.x1, endsItem: word.endsItem };
      } else {
        joined.push(word);
      }

      return joined;
    }, []);
  }

  return lines.sort((a, b) => b.y - a.y);
};

const center = (word) => (word.x0 + word.x1) / 2;

const isLabelAt = (words, index) => {
  const [first, second] = [words[index]?.text.toLowerCase(), words[index + 1]?.text.toLowerCase()];

  return ((first === 'biaya' || first === 'beban') && second === 'operasi') || (first === 'operating' && /^(expenses?|charges?)$/.test(second ?? ''));
};

// The calendar years at the end of a run of years: each is the previous one plus one (or minus one, all the way),
// as in "2025 2024 2023". A header can start with other years, such as the "2021 2021 2021 2021" of period columns.
const calendarYearsAtEnd = (run) => {
  const end = [run.at(-1)];
  const step = run.length > 1 ? run.at(-1).year - run.at(-2).year : 0;

  if (Math.abs(step) !== 1) {
    return end;
  }

  for (let index = run.length - 2; index >= 0 && run[index + 1].year - run[index].year === step; index--) {
    end.unshift(run[index]);
  }

  return end;
};

// The year header of a line: the years that sit next to each other, each in a cell of its own ("2025 2024 2023").
// A sentence such as "31 Desember 2025 dan 2024" has other words between its years, and the year in "Desember 2025",
// the heading of another column, is not a cell of its own. Null when the line has no header.
// The header is `ambiguous` when its years cannot be told from columns of periods or share classes: a year that
// comes twice ("2024 2024 2023 2023"), or one that starts a run and comes again in its calendar years.
const readYearHeader = (words) => {
  const runs = [];
  let run = [];

  for (const word of words) {
    const year = word.startsItem && word.endsItem ? word.text.match(YEAR_PATTERN)?.[1] : undefined;

    if (year) {
      run.push({ year: Number(year), word });
    } else {
      runs.push(run);
      run = [];
    }
  }

  runs.push(run);

  const headerRuns = runs.filter((candidate) => new Set(candidate.map(({ year }) => year)).size >= 2);

  if (headerRuns.length === 0) {
    return null;
  }

  const calendarRuns = headerRuns.map(calendarYearsAtEnd);
  const isAmbiguous = headerRuns.some((candidate, index) => {
    const calendarYears = new Set(calendarRuns[index].map(({ year }) => year));

    return calendarRuns[index].length < 2 || candidate.slice(0, candidate.length - calendarRuns[index].length).some(({ year }) => calendarYears.has(year));
  });

  return { runs: calendarRuns.filter((candidate) => candidate.length >= 2), ambiguous: isAmbiguous };
};

const toPercent = (text) => {
  const negative = text.startsWith('(') || text.startsWith('-');

  return (negative ? -1 : 1) * Number(text.replace(/[()%-]/g, '').replace(',', '.'));
};

const median = (numbers) => [...numbers].sort((x, y) => x - y)[Math.floor(numbers.length / 2)];

// Columns that are not evenly spaced, such as years that each span several share classes, cannot be matched to cells.
const MAX_SPACING_RATIO = 1.6;

// Maps each year of the header to the cell right under it. A year without a cell stays out (so does a stray year
// of a neighbouring column's text), and so does a cell without a year, because a shifted column would put a wrong
// value under a year. The columns are `ambiguous` when a year is paired twice, as in the periods "2024 2024 2023
// 2023", or when the paired headers are not evenly spaced.
const pairYearsWithCells = (runs, cells) => {
  const years = runs.flat();
  const pitch = median(runs.flatMap((run) => run.slice(1).map((entry, index) => Math.abs(center(entry.word) - center(run[index].word)))));
  const nearest = (from, others) => others.reduce((best, other) => (Math.abs(center(other) - center(from)) < Math.abs(center(best) - center(from)) ? other : best));
  const paired = [];

  for (const entry of years) {
    const cell = nearest(entry.word, cells);

    if (Math.abs(center(cell) - center(entry.word)) <= pitch / 2 && nearest(cell, years.map(({ word }) => word)) === entry.word) {
      paired.push({ year: entry.year, percent: toPercent(cell.text), x: center(entry.word) });
    }
  }

  const spacings = paired.slice(1).map((entry, index) => Math.abs(entry.x - paired[index].x));
  const ambiguous = new Set(paired.map(({ year }) => year)).size < paired.length
    || (spacings.length > 0 && Math.max(...spacings) > Math.min(...spacings) * MAX_SPACING_RATIO);

  return { pairs: paired.map(({ year, percent }) => ({ year, percent })), ambiguous };
};

const findClassTitle = (lines, fromIndex, boundaryY) => {
  for (let index = fromIndex - 1; index >= 0 && lines[index].y < boundaryY; index--) {
    const match = lines[index].words.map((word) => word.text).join(' ').match(CLASS_PATTERN);

    if (match) {
      return match[1];
    }
  }

  return null;
};

// Every row labelled "Biaya operasi" on the pages that have one. Each is one table row with the (year, percent)
// pairs that sit under a year header, the share class named in the title above its table, and whether the
// table lays out several share classes side by side.
export const findOperatingExpenseRows = (pages) => {
  const rows = [];

  for (const page of pages) {
    const lines = toLines(page.items);
    const mentionsClass = lines.some((line) => CLASS_MENTION_PATTERN.test(line.words.map((word) => word.text).join(' ')));
    let boundaryY = Infinity;

    // Lines run from the top of the page down, and a table's title lies above the table's header.
    lines.forEach((line, lineIndex) => {
      line.words.forEach((word, wordIndex) => {
        // The label starts its row. "Jumlah Beban Operasi" (a line of the financial statements, in thousands) and
        // "Persentase Terhadap Jumlah Beban Operasi" (a share of the expenses) are other rows.
        if (!isLabelAt(line.words, wordIndex) || line.words.slice(0, wordIndex).some((before) => /[A-Za-z]{3,}/.test(before.text))) {
          return;
        }

        const nextLabelIndex = line.words.findIndex((other, index) => index > wordIndex + 1 && isLabelAt(line.words, index));
        const cells = line.words
          .slice(wordIndex + 2, nextLabelIndex === -1 ? undefined : nextLabelIndex)
          .filter((other) => NUMBER_PATTERN.test(other.text));

        if (cells.length === 0) {
          return;
        }

        const headerIndex = lines.findLastIndex((other, index) => index < lineIndex && other.y - line.y <= HEADER_REACH && readYearHeader(other.words) !== null);
        const row = { page: page.number, cells: cells.map((cell) => cell.text), pairs: [], classTitle: null, hasYearHeader: false, hasClassColumns: false, hasUnevenColumns: false, mentionsClass };

        if (headerIndex !== -1) {
          const header = readYearHeader(lines[headerIndex].words);
          // Share classes side by side: their names stand in a line between the years and the row, or in the years' line.
          const headerRegionLines = lines.slice(Math.max(headerIndex - 1, 0), lineIndex);

          row.hasYearHeader = true;
          row.hasClassColumns = headerRegionLines.some((other) => [...other.words.map((candidate) => candidate.text).join(' ').matchAll(CLASS_PATTERN_EVERYWHERE)].length >= 2);
          row.classTitle = findClassTitle(lines, headerIndex, boundaryY);

          const { pairs, ambiguous } = header.runs.length > 0 ? pairYearsWithCells(header.runs, cells) : { pairs: [], ambiguous: true };

          row.hasUnevenColumns = header.ambiguous || ambiguous;

          if (!row.hasClassColumns && !row.hasUnevenColumns) {
            row.pairs = pairs;
          }
        }

        rows.push(row);
        boundaryY = line.y;
      });
    });
  }

  return rows;
};

const roundPercent = (percent) => Math.round(percent * 100) / 100;

// The newest calendar year's operating expense ratio of one fund, when the prospectus gives exactly one.
// `fundClass` is the share class in the fund's name ("A" for "... Kelas A"), or null.
// A status other than "parsed" says why there is no value: the prospectus has share classes we cannot tell apart
// ("share_classes"), its tables disagree ("conflict"), or no table gives a usable figure ("no_row").
export const chooseOperatingExpense = (rows, { fundClass, lastYear }) => {
  // A page of the ratios that names share classes anywhere makes an untitled table one we cannot assign to a class.
  const hasClassEvidence = rows.some((row) => row.classTitle !== null || row.hasClassColumns || row.mentionsClass);
  let pool = rows.filter((row) => !row.hasClassColumns);

  if (hasClassEvidence) {
    pool = fundClass === null ? [] : pool.filter((row) => row.classTitle === fundClass);

    if (pool.length === 0) {
      return { status: 'share_classes' };
    }
  }

  const pairs = pool
    .flatMap((row) => row.pairs)
    .filter(({ year }) => year >= FIRST_PLAUSIBLE_YEAR && year <= lastYear);

  if (pairs.length === 0) {
    return { status: 'no_row' };
  }

  const year = Math.max(...pairs.map((pair) => pair.year));
  const percents = new Set(pairs.filter((pair) => pair.year === year).map((pair) => roundPercent(pair.percent)));

  if (percents.size > 1) {
    return { status: 'conflict' };
  }

  const [percent] = percents;

  // A figure that cannot be a ratio is more likely a misread column than a fund that was this costly or free,
  // and an older year would not stand in for it.
  if (percent <= 0 || percent >= MAX_PLAUSIBLE_PERCENT) {
    return { status: 'no_row' };
  }

  // The audited report has the same ratio in a table without a year header (the year is in its text). When the
  // prospectus has such tables and none shows this figure, one of the two readings is wrong.
  const reportPercents = rows.filter((row) => !row.hasYearHeader).flatMap((row) => row.cells.map((cell) => roundPercent(toPercent(cell))));

  if (reportPercents.length > 0 && !reportPercents.includes(percent)) {
    return { status: 'conflict' };
  }

  return { status: 'parsed', year, percent };
};

export const fundClassOf = (fundName) => fundName.match(FUND_CLASS_PATTERN)?.[1].toUpperCase() ?? null;

// Reads the text of the pages that mention the label, with positions. `text` is the whole document in lower case
// without punctuation, to check that the prospectus is about the fund.
export const readPdf = async (bytes) => {
  const loadingTask = getDocument({ data: bytes, isEvalSupported: false, verbosity: 0, disableFontFace: true });
  const document = await loadingTask.promise;
  const pages = [];
  const textParts = [];
  let characterCount = 0;
  let blankPageCount = 0;

  try {
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const { items } = await page.getTextContent();
      const strings = items.map((item) => item.str);
      const pageText = strings.join(' ');

      characterCount += pageText.trim().length;
      blankPageCount += pageText.trim().length < BLANK_PAGE_CHARACTERS ? 1 : 0;
      textParts.push(pageText);

      if (LABEL_PAGE_PATTERN.test(pageText) || LABEL_PAGE_PATTERN.test(strings.join(''))) {
        pages.push({
          number,
          items: items
            .filter((item) => item.str.trim() !== '')
            .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width })),
        });
      }

      page.cleanup();
    }

    return { pageCount: document.numPages, characterCount, blankPageCount, pages, text: normalizeText(textParts.join(' ')) };
  } finally {
    await loadingTask.destroy();
  }
};

const normalizeText = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Names differ in the "Reksa Dana" prefix and the share class, which the prospectus does not repeat. A manager that
// changed its name also changed the first word of its funds ("Henan Ultima Obligasi Plus" is now "HPAM Ultima ...").
const coreNameOf = (fundName) => normalizeText(fundName).replace(/^(reksa dana|reksadana|rd) /, '').replace(/ (kelas|class) [a-z0-9]$/, '');

export const isAboutFund = (documentText, fundName) => {
  const coreName = coreNameOf(fundName);
  const withoutFirstWord = coreName.split(' ').slice(1);

  return documentText.includes(coreName) || (withoutFirstWord.length >= 2 && documentText.includes(withoutFirstWord.join(' ')));
};

export const evaluateFund = (pdf, fund, lastYear) => {
  if (pdf.characterCount < pdf.pageCount * MIN_CHARACTERS_PER_PAGE) {
    return { status: 'scanned' };
  }

  if (!isAboutFund(pdf.text, fund.name)) {
    return { status: 'no_row' };
  }

  const rows = findOperatingExpenseRows(pdf.pages);

  if (rows.length === 0 && pdf.blankPageCount >= pdf.pageCount * MIN_BLANK_PAGE_SHARE) {
    return { status: 'scanned' };
  }

  const result = chooseOperatingExpense(rows, { fundClass: fundClassOf(fund.name), lastYear });

  // A fund that started during the year has a ratio for the part of the year it existed, which the prospectus prints
  // as it is and which is not comparable with a full year.
  if (result.status === 'parsed' && fund.launch_date > `${result.year}-${LAST_PARTIAL_YEAR_START}`) {
    return { status: 'partial_year' };
  }

  return result;
};

const fetchWithPause = async (url, options) => {
  try {
    return await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...options });
  } finally {
    await sleep(REQUEST_DELAY_MS);
  }
};

// Bareksa answers 302 with the PDF's address, or 404 for a fund without a prospectus. Null when there is none.
const resolvePdfUrl = ({ bareksa_id: id, slug }) => withRetries(async () => {
  const url = `${BASE_URL}/id/data/mutualfund/prospectus/${id}/${slug}`;
  const response = await fetchWithPause(url, { redirect: 'manual' });

  await response.body?.cancel();

  if (response.status === 404) {
    return null;
  }

  const location = response.headers.get('location');

  if (response.status !== 302 || !location) {
    throw new HttpError(url, response.status, 'expected a redirect to the prospectus');
  }

  const pdfUrl = new URL(location, BASE_URL);

  // A fund without a file is sometimes redirected to the empty folder "https://media.bareksa.com/uploads/0/".
  return pdfUrl.pathname.endsWith('/') ? null : pdfUrl.href;
});

// A file we got but cannot read as a prospectus. Asking again would give the same file.
class UnreadableFileError extends Error {
  constructor(url, reason) {
    super(`GET ${url} ${reason}`);
    this.retryable = false;
  }
}

const downloadPdf = (url) => withRetries(async () => {
  const response = await fetchWithPause(url);

  if (!response.ok) {
    throw new HttpError(url, response.status, response.statusText);
  }

  if (Number(response.headers.get('content-length')) > MAX_PDF_BYTES) {
    throw new UnreadableFileError(url, `is larger than ${MAX_PDF_BYTES} bytes`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
    throw new UnreadableFileError(url, 'is not a PDF');
  }

  return bytes;
});

const downloadAndReadPdf = async (url) => {
  const bytes = await downloadPdf(url);

  try {
    return await readPdf(bytes);
  } catch (error) {
    throw new UnreadableFileError(url, `cannot be read: ${error.message}`);
  }
};

// "https://media.bareksa.com/uploads//file_doc/2026/08/AAKESSS_prospectus.pdf" was uploaded in 2026-08.
export const uploadMonthOf = (url) => url.match(/\/file_doc\/(\d{4})\/(\d{2})\//)?.slice(1).join('-') ?? '';

const today = () => new Date().toISOString().slice(0, 10);

const main = async () => {
  const startedAt = Date.now();
  const rereadAll = process.argv.includes('--all');
  const onlyIds = process.argv.find((argument) => argument.startsWith('--ids='))?.slice('--ids='.length).split(',');
  const todayDate = today();
  const lastYear = new Date().getUTCFullYear() - 1;
  const allFunds = await readCsvRecords(FUNDS_FILE);
  const funds = onlyIds ? allFunds.filter((fund) => onlyIds.includes(fund.bareksa_id)) : allFunds;
  const storedRecords = await readCsvRecords(PROSPECTUS_FILE);
  const knownIds = new Set(allFunds.map((fund) => fund.bareksa_id));
  const rows = new Map(storedRecords.filter((record) => knownIds.has(record.bareksa_id)).map((record) => [record.bareksa_id, record]));
  const urls = new Map();

  const setRow = (id, { url = '', status, year = '', percent }) => {
    rows.set(id, { bareksa_id: id, url, uploaded: uploadMonthOf(url), status, year, operating_expense_pct: percent?.toFixed(2) ?? '', checked: todayDate });
  };

  const save = () => writeFileAtomic(PROSPECTUS_FILE, toCsv(
    HEADER,
    [...rows.values()].sort((a, b) => Number(a.bareksa_id) - Number(b.bareksa_id)).map((row) => HEADER.map((column) => row[column])),
  ));

  const resolveFailures = await runPool({
    items: funds,
    worker: async (fund) => {
      urls.set(fund.bareksa_id, await resolvePdfUrl(fund));
    },
    concurrency: CONCURRENCY,
    label: 'Prospectus links resolved',
    describeItem: (fund) => `Bareksa ${fund.bareksa_id}`,
  });

  // A fund whose link answers is read again only when its file is another one than last time, or failed last time.
  const fundsToRead = [];

  for (const fund of funds) {
    const url = urls.get(fund.bareksa_id);
    const row = rows.get(fund.bareksa_id);

    if (url === null && row?.status !== 'not_found') {
      setRow(fund.bareksa_id, { status: 'not_found' });
    } else if (url && (rereadAll || row === undefined || row.url !== url || row.status === 'error')) {
      fundsToRead.push(fund);
    }
  }

  const fundsByUrl = Map.groupBy(fundsToRead, (fund) => urls.get(fund.bareksa_id));
  let readCount = 0;

  console.log(`Prospectuses: ${funds.length} funds, ${fundsToRead.length} to read in ${fundsByUrl.size} files`);

  const readFailures = await runPool({
    items: [...fundsByUrl],
    worker: async ([url, urlFunds]) => {
      try {
        const pdf = await downloadAndReadPdf(url);

        for (const fund of urlFunds) {
          setRow(fund.bareksa_id, { url, ...evaluateFund(pdf, fund, lastYear) });
        }
      } catch (error) {
        const isUnreadable = error instanceof UnreadableFileError;
        const isMissing = error instanceof HttpError && error.status === 404;

        // A missing file is stored without its address, so the next run asks for it again.
        for (const fund of urlFunds) {
          setRow(fund.bareksa_id, isMissing ? { status: 'not_found' } : { url, status: isUnreadable ? 'unreadable' : 'error' });
        }

        if (!isUnreadable && !isMissing) {
          throw error;
        }
      }

      if (++readCount % SAVE_EVERY === 0) {
        await save();
      }
    },
    concurrency: CONCURRENCY,
    label: 'Prospectuses read',
    describeItem: ([url]) => url,
  });

  await save();

  const counts = Object.entries(Object.groupBy(rows.values(), (row) => row.status)).map(([status, group]) => `${status} ${group.length}`);

  console.log(`${rows.size} rows: ${counts.join(', ')}`);
  console.log(`Done in ${Math.round((Date.now() - startedAt) / 1000)} seconds`);

  reportFailures([...resolveFailures, ...readFailures], funds.length);
};

if (process.argv[1] === import.meta.filename) {
  await main();
}

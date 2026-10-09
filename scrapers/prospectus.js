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
// A share class is named with a letter or two and maybe a digit: "A", "B1", "IB", "RK1".
const CLASS_NAME = '[A-Z][A-Z]?\\d?|\\d';
const CLASS_PATTERN = new RegExp(`\\b(?:[Kk][Ee][Ll][Aa][Ss]|[Cc][Ll][Aa][Ss][Ss])\\s+(${CLASS_NAME})\\b`);
// "Kelas/Class" over the columns of an audited table, whose letters stand on the next line.
const CLASS_MENTION_PATTERN = new RegExp(`${CLASS_PATTERN.source}|[Kk]elas\\s*/\\s*[Cc]lass`);
const CLASS_PATTERN_EVERYWHERE = new RegExp(CLASS_PATTERN, 'g');
const FUND_CLASS_PATTERN = /\b(?:kelas|class)\s+([a-z][a-z]?\d?|\d)\s*$/i;
const CLASS_KEYWORD_PATTERN = /^(?:kelas|class)\/?$/i;
const JOINED_CLASS_KEYWORD_PATTERN = /^(.+\/)(kelas|class)$/i;
const CLASS_NAME_PATTERN = new RegExp(`^(?:${CLASS_NAME})[/,.]?$`);
const PLACEHOLDER_PATTERN = /^(?:-|\u2013|\u2014|n\/a)$/i;

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

// "Kelas/Class" or "Kelas G/Class G" in two languages leaves no gap between the slash and the second language, so the
// reader joins them into one word.
const splitJoinedClassKeyword = (word) => {
  const [, before, keyword] = word.text.match(JOINED_CLASS_KEYWORD_PATTERN) ?? [];

  if (before === undefined) {
    return [word];
  }

  const characterWidth = (word.x1 - word.x0) / word.text.length;
  const boundary = word.x0 + before.length * characterWidth;

  return [{ ...word, text: before, x1: boundary, endsItem: false }, { ...word, text: keyword, x0: boundary, startsItem: false }];
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
    }, []).flatMap(splitJoinedClassKeyword);
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

// How far from the line of the class names its neighbours still belong to the header (the letter under "Kelas", the
// years above the names).
const CLASS_HEADER_REACH = 30;
const YEAR_LINE_REACH = 60;
// A line of running text that mentions a class is not a header.
const MAX_HEADER_LINE_WORDS = 16;
// "Kelas A/ Class A" side by side names one column twice; two columns of one class are further apart.
const BILINGUAL_HEADER_GAP = 20;
// The "Class" of "Kelas/ Class" starts where "Kelas/" ends.
const TOUCHING_GAP = 2;

// The share classes named in the header lines of a table, left to right: "Kelas A" or "Class A" side by side, or
// "Kelas/ Class" with the letters in a line below. Each is { name, center }; a class named in both languages comes once.
const readClassHeaders = (headerLines) => {
  const headers = [];
  const usedNames = new Set();

  for (const line of headerLines) {
    line.words.forEach((word, index) => {
      const next = line.words[index + 1];

      if (CLASS_KEYWORD_PATTERN.test(word.text) && next && CLASS_NAME_PATTERN.test(next.text) && next.x0 - word.x1 < 12) {
        usedNames.add(next);
        headers.push({ name: next.text.replace(/[/,.]$/, ''), x0: word.x0, x1: next.x1, center: (word.x0 + next.x1) / 2 });
      }
    });
  }

  for (const line of headerLines) {
    line.words.forEach((word, index) => {
      const previous = line.words[index - 1];
      const next = line.words[index + 1];
      const isPartOfPair = next && usedNames.has(next);
      const isSecondOfBilingualPair = previous && CLASS_KEYWORD_PATTERN.test(previous.text) && word.x0 - previous.x1 < TOUCHING_GAP;

      if (!CLASS_KEYWORD_PATTERN.test(word.text) || isPartOfPair || isSecondOfBilingualPair) {
        return;
      }

      const letter = headerLines
        .filter((other) => other.y < line.y)
        .flatMap((other) => other.words)
        .filter((candidate) => CLASS_NAME_PATTERN.test(candidate.text) && !usedNames.has(candidate) && candidate.x0 >= word.x0 - 8 && candidate.x0 <= word.x0 + 45)
        .sort((a, b) => Math.abs(a.x0 - word.x0) - Math.abs(b.x0 - word.x0))[0];

      if (letter) {
        usedNames.add(letter);
        headers.push({ name: letter.text.replace(/[/,.]$/, ''), x0: letter.x0, x1: letter.x1, center: center(letter) });
      }
    });
  }

  headers.sort((a, b) => a.center - b.center);

  return headers.filter((header, index) => !(index > 0 && headers[index - 1].name === header.name && header.x0 - headers[index - 1].x1 < BILINGUAL_HEADER_GAP));
};

const standaloneYearsOf = (line) => line.words
  .filter((word) => word.startsItem && word.endsItem && YEAR_PATTERN.test(word.text))
  .map((word) => ({ year: Number(word.text.match(YEAR_PATTERN)[1]), center: center(word) }));

// Reads one row of a table whose columns are share classes, maybe under years: a table of one year with the classes
// side by side, or a table of several years with the classes repeated under each. `columns` are the cells of the row
// (numbers and "-"). Null when the table has no class header. Otherwise `classCount` is the number of classes in the
// header, and `pairs` the { class, year, percent } of every cell that sits under a class and a year with certainty
// (`percent` is null for a "-": the class has no ratio that year), or none at all when any cell cannot be placed: a
// shifted column would put a wrong value under a class.
const readClassColumns = (lines, lineIndex, columns) => {
  const rowY = lines[lineIndex].y;
  const classLineIndex = lines.findLastIndex((other, index) => index < lineIndex && other.y - rowY <= HEADER_REACH && other.words.length <= MAX_HEADER_LINE_WORDS && other.words.some((word) => CLASS_KEYWORD_PATTERN.test(word.text)));

  if (classLineIndex === -1) {
    return null;
  }

  const classLineY = lines[classLineIndex].y;
  const headerLines = lines.filter((other, index) => index < lineIndex && Math.abs(other.y - classLineY) <= CLASS_HEADER_REACH && other.words.length <= MAX_HEADER_LINE_WORDS);
  const headers = readClassHeaders(headerLines);

  if (headers.length === 0) {
    return null;
  }

  const result = { classCount: headers.length, pairs: [] };
  const bottomY = headerLines.at(-1).y;
  const topY = headerLines[0].y;

  // Another year or another row of the ratio between the header and the row means the row has a header of its own,
  // which this one is not.
  if (lines.some((other, index) => index < lineIndex && other.y < bottomY && (standaloneYearsOf(other).length > 0 || other.words.some((word, wordIndex) => isLabelAt(other.words, wordIndex))))) {
    return result;
  }

  const yearLines = lines.filter((other, index) => index < lineIndex && other.y <= topY + YEAR_LINE_REACH && standaloneYearsOf(other).length > 0);
  const yearsInHeader = headerLines.flatMap(standaloneYearsOf);
  const years = yearsInHeader.length > 0 ? yearsInHeader : yearLines.slice(-1).flatMap(standaloneYearsOf);
  const spacings = headers.slice(1).map((header, index) => header.center - headers[index].center);
  const smallestSpacing = spacings.length > 0 ? Math.min(...spacings) : 60;
  const tolerance = Math.max(smallestSpacing / 2, 12);

  if (years.length === 0 || columns.length === 0 || smallestSpacing < 8) {
    return result;
  }

  // The cell under each class: the nearest, and the class is that cell's nearest too.
  const nearest = (position, candidates) => candidates.reduce((best, candidate) => (Math.abs(candidate.center - position) < Math.abs(best.center - position) ? candidate : best));
  const cells = columns.map((column) => ({ ...column, center: center(column) }));
  const cellOfHeader = headers.map((header) => nearest(header.center, cells));
  const placed = headers.map((header, index) => Math.abs(cellOfHeader[index].center - header.center) <= tolerance && nearest(cellOfHeader[index].center, headers) === header);
  const placedCells = cellOfHeader.filter((cell, index) => placed[index]);
  const firstCenter = headers[0].center - tolerance;

  // A class without a cell has no figure. A number that no class claims could belong to any of them.
  if (cells.some((cell) => !placedCells.includes(cell) && cell.center >= firstCenter && NUMBER_PATTERN.test(cell.text))) {
    return result;
  }

  // The year over each class: the year header nearest to it. Every year must have classes under it, and sit over
  // the middle of them.
  const yearOfHeader = headers.map((header) => nearest(header.center, years));
  const groups = Map.groupBy(headers.map((header, index) => ({ header, year: yearOfHeader[index] })), ({ year }) => year);
  const isCentered = [...groups].every(([year, group]) => Math.abs(year.center - group.reduce((sum, { header }) => sum + header.center, 0) / group.length) <= tolerance);

  if (groups.size !== years.length || !isCentered || new Set(years.map(({ year }) => year)).size !== years.length) {
    return result;
  }

  headers.forEach((header, index) => {
    if (placed[index]) {
      result.pairs.push({ class: header.name, year: yearOfHeader[index].year, percent: NUMBER_PATTERN.test(cellOfHeader[index].text) ? toPercent(cellOfHeader[index].text) : null });
    }
  });

  return result;
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
        const columns = line.words
          .slice(wordIndex + 2, nextLabelIndex === -1 ? undefined : nextLabelIndex)
          .filter((other) => NUMBER_PATTERN.test(other.text) || PLACEHOLDER_PATTERN.test(other.text));
        const classColumns = readClassColumns(lines, lineIndex, columns);
        const row = {
          page: page.number,
          cells: cells.map((cell) => cell.text),
          pairs: [],
          classPairs: classColumns?.pairs ?? [],
          classTitle: null,
          hasYearHeader: false,
          hasClassColumns: (classColumns?.classCount ?? 0) >= 2,
          hasUnevenColumns: false,
          mentionsClass,
        };

        if (headerIndex !== -1) {
          const header = readYearHeader(lines[headerIndex].words);
          // Share classes side by side: their names stand in a line between the years and the row, or in the years' line.
          const headerRegionLines = lines.slice(Math.max(headerIndex - 1, 0), lineIndex);

          row.hasYearHeader = true;
          row.hasClassColumns ||= headerRegionLines.some((other) => [...other.words.map((candidate) => candidate.text).join(' ').matchAll(CLASS_PATTERN_EVERYWHERE)].length >= 2);
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
  let classColumnPairs = [];

  if (hasClassEvidence) {
    const allClassColumnPairs = rows.flatMap((row) => row.classPairs);
    const newestClassYear = Math.max(...allClassColumnPairs.map(({ year }) => year).filter((year) => year <= lastYear));
    const ownClassColumnPairs = fundClass === null ? [] : allClassColumnPairs.filter((pair) => pair.class === fundClass);

    pool = fundClass === null ? [] : pool.filter((row) => row.classTitle === fundClass);

    if (pool.length === 0 && ownClassColumnPairs.length === 0) {
      return { status: 'share_classes' };
    }

    // A "-" under the newest year of the tables says the class had no ratio then, and an older year would not stand in.
    classColumnPairs = ownClassColumnPairs.filter(({ year, percent }) => year === newestClassYear && percent !== null);
  }

  const pairs = [...pool.flatMap((row) => row.pairs), ...classColumnPairs]
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
  // prospectus has such tables and none shows this figure, one of the two readings is wrong. The tables of share
  // classes check each other instead, in the figures of one class and year above.
  const reportPercents = rows.filter((row) => !row.hasYearHeader).flatMap((row) => row.cells.map((cell) => roundPercent(toPercent(cell))));

  if (classColumnPairs.length === 0 && reportPercents.length > 0 && !reportPercents.includes(percent)) {
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
const coreNameOf = (fundName) => normalizeText(fundName).replace(/^(reksa dana|reksadana|rd) /, '').replace(/ (kelas|class) ([a-z][a-z]?\d?|\d)$/, '');

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
  // After the reader learned something new, the funds it gave up on are worth another look: --status=share_classes,no_row
  const rereadStatuses = process.argv.find((argument) => argument.startsWith('--status='))?.slice('--status='.length).split(',');
  const todayDate = today();
  const lastYear = new Date().getUTCFullYear() - 1;
  const allFunds = await readCsvRecords(FUNDS_FILE);
  const storedRecords = await readCsvRecords(PROSPECTUS_FILE);
  const knownIds = new Set(allFunds.map((fund) => fund.bareksa_id));
  const rows = new Map(storedRecords.filter((record) => knownIds.has(record.bareksa_id)).map((record) => [record.bareksa_id, record]));
  const funds = allFunds.filter((fund) => (!onlyIds || onlyIds.includes(fund.bareksa_id)) && (!rereadStatuses || rereadStatuses.includes(rows.get(fund.bareksa_id)?.status)));
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
    } else if (url && (rereadAll || rereadStatuses || row === undefined || row.url !== url || row.status === 'error')) {
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

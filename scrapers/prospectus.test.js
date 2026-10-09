import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chooseOperatingExpense, evaluateFund, findOperatingExpenseRows, fundClassOf, isAboutFund, uploadMonthOf } from './prospectus.js';

// The pages of real prospectuses that hold the row "Biaya operasi", as text items with positions.
const readPages = (name) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', `prospectus-${name}.json`), 'utf8')).pages;

const operatingExpenseOf = (name, fundClass = null) => chooseOperatingExpense(findOperatingExpenseRows(readPages(name)), { fundClass, lastYear: 2025 });

test('the figures printed in the prospectuses we read by hand come out as printed', () => {
  assert.deepEqual(operatingExpenseOf('schroder-prestasi-plus'), { status: 'parsed', year: 2025, percent: 2.03 });
  assert.deepEqual(operatingExpenseOf('bnp-rupiah-plus'), { status: 'parsed', year: 2025, percent: 0.71 });
  assert.deepEqual(operatingExpenseOf('sucorinvest-maxi'), { status: 'parsed', year: 2025, percent: 5.17 });
});

test('every year of the table is read from the column under its year', () => {
  const [row] = findOperatingExpenseRows(readPages('schroder-prestasi-plus'));

  assert.deepEqual(row.pairs, [{ year: 2025, percent: 2.03 }, { year: 2024, percent: 2.12 }, { year: 2023, percent: 2.07 }]);
});

test('years in ascending order are read by column too, not by their order', () => {
  const [row] = findOperatingExpenseRows(readPages('insight-government'));

  assert.deepEqual(row.pairs, [{ year: 2023, percent: 0.84 }, { year: 2024, percent: 1 }, { year: 2025, percent: 0.84 }]);
  assert.deepEqual(operatingExpenseOf('insight-government'), { status: 'parsed', year: 2025, percent: 0.84 });
});

test('the label split into pieces, and the English label next to the numbers, still give the row', () => {
  assert.deepEqual(operatingExpenseOf('batavia-saham-syariah'), { status: 'parsed', year: 2025, percent: 6 });
});

test('the columns of the year-to-date and 12, 36 and 60 month periods are never taken for a year', () => {
  const rows = findOperatingExpenseRows(readPages('pnm-dana-tunai'));

  assert.deepEqual(rows[0].pairs, [{ year: 2025, percent: 0.55 }, { year: 2024, percent: 0.59 }, { year: 2023, percent: 0.96 }]);
  assert.deepEqual(operatingExpenseOf('henan-smart-growth'), { status: 'no_row' });
});

test('a table of periods whose start years repeat is not read, while the audited table of years is', () => {
  const rows = findOperatingExpenseRows(readPages('bnp-obligasi-berlian'));

  assert.equal(rows.filter((row) => row.pairs.length === 0 && row.hasYearHeader).length, 1);
  assert.deepEqual(operatingExpenseOf('bnp-obligasi-berlian'), { status: 'parsed', year: 2024, percent: 0.45 });
});

test('period columns before the calendar years do not hide them, and their years are not taken', () => {
  assert.deepEqual(operatingExpenseOf('garuda-satu'), { status: 'parsed', year: 2020, percent: 2.64 });
});

test('a table with a column per share class and year gives no value', () => {
  assert.deepEqual(operatingExpenseOf('mandiri-investa-dana-utama'), { status: 'share_classes' });
  assert.deepEqual(operatingExpenseOf('mandiri-investa-dana-utama', 'D'), { status: 'share_classes' });
});

test('each share class takes the table titled with its own class, and a fund without a class gets none', () => {
  assert.deepEqual(operatingExpenseOf('sucorinvest-equity', 'A'), { status: 'parsed', year: 2025, percent: 3.85 });
  assert.deepEqual(operatingExpenseOf('sucorinvest-equity', 'B'), { status: 'parsed', year: 2025, percent: 2.13 });
  assert.deepEqual(operatingExpenseOf('sucorinvest-equity', 'C'), { status: 'share_classes' });
  assert.deepEqual(operatingExpenseOf('sucorinvest-equity'), { status: 'share_classes' });
});

const row = (pairs, overrides = {}) => ({ page: 1, cells: pairs.map(({ percent }) => String(percent)), pairs, classTitle: null, hasYearHeader: true, hasClassColumns: false, hasUnevenColumns: false, mentionsClass: false, ...overrides });

test('the newest year up to last year wins, and a year after it is ignored', () => {
  const rows = [row([{ year: 2026, percent: 9 }, { year: 2025, percent: 1.5 }, { year: 2024, percent: 1.4 }])];

  assert.deepEqual(chooseOperatingExpense(rows, { fundClass: null, lastYear: 2025 }), { status: 'parsed', year: 2025, percent: 1.5 });
  assert.deepEqual(chooseOperatingExpense(rows, { fundClass: null, lastYear: 2024 }), { status: 'parsed', year: 2024, percent: 1.4 });
});

test('a value that cannot be an operating expense ratio is not stored, and the year before does not stand in for it', () => {
  const tooHigh = [row([{ year: 2025, percent: 53.61 }, { year: 2024, percent: 1.4 }])];
  const zero = [row([{ year: 2025, percent: 0 }])];

  assert.deepEqual(chooseOperatingExpense(tooHigh, { fundClass: null, lastYear: 2025 }), { status: 'no_row' });
  assert.deepEqual(chooseOperatingExpense(zero, { fundClass: null, lastYear: 2025 }), { status: 'no_row' });
});

test('two tables that give different figures for the newest year give no value', () => {
  const rows = [row([{ year: 2025, percent: 1.5 }]), row([{ year: 2025, percent: 1.6 }])];

  assert.deepEqual(chooseOperatingExpense(rows, { fundClass: null, lastYear: 2025 }), { status: 'conflict' });
});

test('two tables that agree give the value, and a report table without a year that shows another figure gives none', () => {
  const summary = row([{ year: 2025, percent: 1.5 }, { year: 2024, percent: 1.4 }]);
  const report = row([], { cells: ['1,50%', '1,40%'], hasYearHeader: false });
  const otherReport = row([], { cells: ['2,50%'], hasYearHeader: false });

  assert.deepEqual(chooseOperatingExpense([summary, row([{ year: 2025, percent: 1.5 }]), report], { fundClass: null, lastYear: 2025 }), { status: 'parsed', year: 2025, percent: 1.5 });
  assert.deepEqual(chooseOperatingExpense([summary, otherReport], { fundClass: null, lastYear: 2025 }), { status: 'conflict' });
});

test('a prospectus whose class table has no year header, next to a table without a class, gives no value', () => {
  const rows = [row([{ year: 2025, percent: 1.5 }], { mentionsClass: true }), row([], { cells: ['1,50%', '2,13%'], hasYearHeader: false, mentionsClass: true })];

  assert.deepEqual(chooseOperatingExpense(rows, { fundClass: null, lastYear: 2025 }), { status: 'share_classes' });
});

test('an untitled table on a page that names share classes is not given to a fund of one class', () => {
  const rows = [row([{ year: 2025, percent: 2.02 }], { mentionsClass: true })];

  assert.deepEqual(chooseOperatingExpense(rows, { fundClass: 'B', lastYear: 2025 }), { status: 'share_classes' });
  assert.deepEqual(chooseOperatingExpense(rows, { fundClass: null, lastYear: 2025 }), { status: 'share_classes' });
  assert.deepEqual(chooseOperatingExpense([row([{ year: 2025, percent: 2.02 }])], { fundClass: 'B', lastYear: 2025 }), { status: 'parsed', year: 2025, percent: 2.02 });
});

test('the share class comes from the end of the fund name', () => {
  assert.equal(fundClassOf('Reksa Dana Sucorinvest Equity Fund Kelas A'), 'A');
  assert.equal(fundClassOf('Manulife Dana Kas II Kelas D1'), null);
  assert.equal(fundClassOf('Eastspring IDR Fixed Income Fund Class b'), 'B');
  assert.equal(fundClassOf('Schroder Dana Prestasi Plus'), null);
});

test('a prospectus is about a fund when it names it, without "Reksa Dana" or the class, or after a manager renamed itself', () => {
  const text = 'ikhtisar keuangan singkat sucorinvest equity fund hpam ultima obligasi plus';

  assert.equal(isAboutFund(text, 'Reksa Dana Sucorinvest Equity Fund Kelas A'), true);
  assert.equal(isAboutFund(text, 'Henan Ultima Obligasi Plus Kelas A'), true);
  assert.equal(isAboutFund(text, 'Sucorinvest Maxi Fund'), false);
  assert.equal(isAboutFund(text, 'Alpha Bond'), false);
});

test('a prospectus without a text layer is scanned, and one about another fund has no row for this fund', () => {
  const scanned = { pageCount: 100, characterCount: 500, blankPageCount: 99, pages: [], text: '' };
  const otherFund = { pageCount: 10, characterCount: 20000, blankPageCount: 0, pages: [], text: 'sucorinvest maxi fund' };
  const partlyScanned = { pageCount: 10, characterCount: 20000, blankPageCount: 4, pages: [], text: 'alpha bond' };

  assert.deepEqual(evaluateFund(scanned, { name: 'Alpha Bond' }, 2025), { status: 'scanned' });
  assert.deepEqual(evaluateFund(otherFund, { name: 'Alpha Bond' }, 2025), { status: 'no_row' });
  assert.deepEqual(evaluateFund(partlyScanned, { name: 'Alpha Bond' }, 2025), { status: 'scanned' });
});

test('a row that does not start with the label is another row', () => {
  const [statementRow] = findOperatingExpenseRows([{
    number: 1,
    items: [
      { str: '2022', x: 300, y: 500, width: 20 },
      { str: '2021', x: 340, y: 500, width: 20 },
      { str: 'Jumlah Beban Operasi', x: 50, y: 480, width: 90 },
      { str: '12.906', x: 300, y: 480, width: 20 },
      { str: '12.230', x: 340, y: 480, width: 20 },
    ],
  }]) ?? [];

  assert.equal(statementRow, undefined);
});

test('a ratio of the year the fund was launched in is not stored, because it covers part of the year', () => {
  const pdf = { pageCount: 1, characterCount: 5000, blankPageCount: 0, text: 'sucorinvest equity fund', pages: readPages('sucorinvest-equity') };

  assert.deepEqual(evaluateFund(pdf, { name: 'Sucorinvest Equity Fund Kelas B', launch_date: '2025-12-15' }, 2025), { status: 'partial_year' });
  assert.deepEqual(evaluateFund(pdf, { name: 'Sucorinvest Equity Fund Kelas B', launch_date: '2025-01-02' }, 2025), { status: 'parsed', year: 2025, percent: 2.13 });
  assert.deepEqual(evaluateFund(pdf, { name: 'Sucorinvest Equity Fund Kelas A', launch_date: '2019-08-16' }, 2025), { status: 'parsed', year: 2025, percent: 3.85 });
  assert.deepEqual(evaluateFund(pdf, { name: 'Sucorinvest Equity Fund Kelas A', launch_date: '' }, 2025), { status: 'parsed', year: 2025, percent: 3.85 });
});

test('the upload month is in the address of the file', () => {
  assert.equal(uploadMonthOf('https://media.bareksa.com/uploads//file_doc/2026/08/AAKESSS_prospectus.pdf'), '2026-08');
  assert.equal(uploadMonthOf('https://media.bareksa.com/uploads/0/'), '');
});

// The rows of the explorer as a CSV file, for a spreadsheet. Built in the browser from the filtered and sorted list.
import * as m from '../paraglide/messages.js';
import { COLUMNS } from './explorer-columns.js';

const FUND_COLUMNS = [
  { header: () => m.csv_id(), value: (fund) => fund.id },
  { header: () => m.col_fund(), value: (fund) => fund.name },
  { header: () => m.detail_manager(), value: (fund) => fund.manager },
  { header: () => m.detail_type(), value: (fund) => fund.type },
  { header: () => m.detail_currency(), value: (fund) => fund.currency },
];

// Excel reads a file as UTF-8 only when it starts with a byte order mark.
const BYTE_ORDER_MARK = '\uFEFF';

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);

  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// `columnKeys` are the table columns that are showing; the fund's identity columns come first.
export function buildCsv(funds, columnKeys) {
  const columns = [...FUND_COLUMNS, ...COLUMNS.filter((column) => columnKeys.includes(column.key)).flatMap((column) => column.csv)];
  const lines = [columns.map((column) => csvCell(column.header())), ...funds.map((fund) => columns.map((column) => csvCell(column.value(fund))))];

  return `${BYTE_ORDER_MARK}${lines.map((line) => line.join(',')).join('\r\n')}\r\n`;
}

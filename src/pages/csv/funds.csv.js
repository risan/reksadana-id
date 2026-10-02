import { readFundsCsv } from '../../lib/data.js';

export function GET() {
  return new Response(readFundsCsv(), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  });
}

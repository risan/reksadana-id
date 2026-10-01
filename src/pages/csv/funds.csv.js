import { readDataFileText } from '../../lib/data.js';

export function GET() {
  return new Response(readDataFileText('funds.csv'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  });
}

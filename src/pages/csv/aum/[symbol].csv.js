import { listDataFiles, readDataFileText } from '../../../lib/data.js';

export function getStaticPaths() {
  return listDataFiles('aum').map((file) => ({ params: { symbol: file.slice(0, -'.csv'.length) } }));
}

export function GET({ params }) {
  return new Response(readDataFileText('aum', `${params.symbol}.csv`), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  });
}

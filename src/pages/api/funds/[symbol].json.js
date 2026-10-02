import { listFundSymbols, loadFundRecord } from '../../../lib/data.js';

export function getStaticPaths() {
  return listFundSymbols().map((symbol) => ({ params: { symbol } }));
}

export function GET({ params }) {
  return Response.json(loadFundRecord(params.symbol));
}

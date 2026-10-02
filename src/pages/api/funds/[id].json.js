import { listFundIds, loadFundRecord } from '../../../lib/data.js';
import { pickAumHistory, pickNavHistory } from '../../../lib/series.js';

export function getStaticPaths() {
  return listFundIds().map((id) => ({ params: { id } }));
}

// `history` is the NAV and AUM series the site draws, with the source of each point. The per-fund CSV Worker serves it.
export function GET({ params }) {
  const record = loadFundRecord(params.id);

  return Response.json({
    ...record,
    history: { nav: pickNavHistory(record).points, aum: pickAumHistory(record).points },
  });
}

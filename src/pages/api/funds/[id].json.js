import { listFundIds, loadFundRecord } from '../../../lib/data.js';
import { dividendEvents, pickAumHistory, pickNavHistory } from '../../../lib/series.js';

export function getStaticPaths() {
  return listFundIds().map((id) => ({ params: { id } }));
}

// `history` is the NAV and AUM series the site draws, with the source of each point, and the dividends the site
// reinvests for its total returns. The per-fund CSV Worker serves the series.
export function GET({ params }) {
  const record = loadFundRecord(params.id);
  const navHistory = pickNavHistory(record);

  return Response.json({
    ...record,
    history: { nav: navHistory.points, aum: pickAumHistory(record).points, dividend_events: dividendEvents(record, navHistory) },
  });
}

import { listFunds, loadFundSummaries } from '../../lib/data.js';

export function GET() {
  const summaries = new Map(loadFundSummaries().funds.map((summary) => [summary.id, summary]));

  return Response.json(listFunds().map((fund) => {
    const summary = summaries.get(fund.id);

    return {
      ...fund,
      active: summary.active,
      nav: summary.nav,
      nav_date: summary.nav_date,
      aum: summary.aum,
      aum_date: summary.aum_date,
      return_1y: summary.return_1y,
    };
  }));
}

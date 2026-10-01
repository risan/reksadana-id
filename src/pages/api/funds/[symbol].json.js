import { listFundSymbols, loadAumSeries, loadBareksa, loadFundDetails, loadKontan, loadMakmur, loadNavSeries } from '../../../lib/data.js';

export function getStaticPaths() {
  return listFundSymbols().map((symbol) => ({ params: { symbol } }));
}

export function GET({ params }) {
  const { symbol } = params;

  return Response.json({
    ...loadFundDetails(symbol),
    nav: loadNavSeries(symbol),
    aum: loadAumSeries(symbol),
    kontan: loadKontan(symbol),
    bareksa: loadBareksa(symbol),
    makmur: loadMakmur(symbol),
  });
}

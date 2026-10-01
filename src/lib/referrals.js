// Neither app has a working referral link, so a new user types the code in the app.
export const REFERRALS = {
  bibit: { name: 'Bibit', code: 'risanb' },
  makmur: { name: 'Makmur', code: 'RISANB' },
};

export function bibitFundUrl(symbol) {
  return `https://bibit.id/reksadana/${encodeURIComponent(symbol)}`;
}

export function makmurFundUrl(routeCategory, slug) {
  return `https://www.makmur.id/id/reksadana/${routeCategory}/${slug}`;
}

import { fetchJson } from './fetcher.js';

export const manager = 'BRI Manajemen Investasi, PT';

// The address is the one the site's own pages ask; the server needs an `ipaddress` and answers all funds at once.
const FUNDS_URL = 'https://bri-mi.co.id:9443/api-frontend/web/content/id/produk/reksa-dana?ipaddress=1.1.1.1&page=1&limit=10';

// Each fund lists its documents under a label ("Prospectus", "Prospektus", "Fund Fact Sheet"). A few funds put a fact sheet
// under the prospectus label; the reader skips a file of fewer pages than a prospectus has. Some titles leave out "BRI",
// which the fund's name has.
export const parseDocuments = (response) => response.data.relation.posts.flatMap((post) => {
  const prospectus = (post.relation?.galeries?.media ?? []).map((media) => media.document).find((document) => /^prospe[kc]/i.test(document?.name ?? '') && document.default);

  return prospectus ? [{ name: /\bBRI\b/i.test(post.title) ? post.title : `BRI ${post.title}`, url: prospectus.default }] : [];
});

export const listDocuments = async () => parseDocuments(await fetchJson(FUNDS_URL));

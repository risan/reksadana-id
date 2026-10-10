import { fetchJson } from './fetcher.js';

export const manager = 'Manulife Aset Manajemen Indonesia, PT';

const SITE = 'https://www.manulifeim.co.id';
const FUNDS_URL = `${SITE}/informasi/dokumen/_jcr_content/root/responsivegrid_641029165/funddocuments.resources-filters.html`;

// The site answers with every share class and the kinds of documents it has. The address of a prospectus is made of
// the umbrella's code, and one file covers all the classes of an umbrella. The site blocks some networks (Akamai).
export const parseDocuments = (response) => JSON.parse(response.all)
  .filter((fund) => fund.documents?.latest?.some((document) => document.aemKey === 'prospectus'))
  .map((fund) => ({ name: fund.fundName, url: `${SITE}/content/dam/wam/id/id/funds/prospectus/${fund.fundUmbrellaCode}-prospectus.pdf` }));

export const listDocuments = async () => parseDocuments(await fetchJson(FUNDS_URL));

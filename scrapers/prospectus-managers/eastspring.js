import { fetchText } from './fetcher.js';

export const manager = 'Eastspring Investments Indonesia, PT';

const BASE_URL = 'https://www.eastspring.com';
const LISTING_URL = `${BASE_URL}/id/funds/nav`;

export const parseFundLinks = (html) => [...new Set([...html.matchAll(/href="(\/id\/funddetails\/[^"/]+\/[^"]+)"/g)].map((match) => match[1]))];

// "/id/funddetails/eastspring-idr-fixed-income-fund-kelas-a/idn000193802" is the class A of a fund.
export const nameOfFundLink = (link) => link.split('/')[3].replaceAll('-', ' ');

// One prospectus covers every class of a fund, and every class page links it.
export const parsePageProspectus = (html) => html.match(/href='?"?([^'"\s>]*iddocs\/PRO\/[^'"\s>]+\.pdf)/i)?.[1] ?? '';

export const listDocuments = async () => {
  const documents = [];

  for (const link of parseFundLinks(await fetchText(LISTING_URL))) {
    const url = parsePageProspectus(await fetchText(`${BASE_URL}${link}`));

    if (url !== '') {
      documents.push({ name: nameOfFundLink(link), url: new URL(url, BASE_URL).href });
    }
  }

  return documents;
};

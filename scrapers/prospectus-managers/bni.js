import { decodeEntities, fetchText } from './fetcher.js';

export const manager = 'BNI Asset Management, PT';

const SITE = 'https://www.bni-am.co.id/';
const CATEGORIES = [
  'reksa-dana-pasar-uang', 'reksa-dana-konvensional', 'reksa-dana-pasar-uang-syariah', 'reksa-dana-pendapatan-tetap',
  'reksa-dana-pendapatan-tetap-konvensional', 'reksa-dana-pendapatan-tetap-konvensional-1', 'reksa-dana-pendapatan-tetap-syariah',
  'reksa-dana-campuran', 'reksa-dana-saham', 'reksa-dana-saham-konvensional', 'reksa-dana-indeks', 'reksa-dana-indeks-1',
  'reksa-dana-indeks-pendapatan-tetap',
];

// A category page lists its funds as a heading with a link; the funds are in several categories.
export const parseFundLinks = (html) => [...html.matchAll(/<div class="post-heading">\s*<a href="(https:\/\/www\.bni-am\.co\.id\/[^"]+)">\s*<h3>([^<]+)<\/h3>/g)]
  .map((match) => ({ url: match[1], name: decodeEntities(match[2]).replace(/\s*\([^)]*\)/g, '') }));

// A fund's page links its documents, labelled with the text of the link ("Lembar Fakta Dana", "Prospektus").
export const parseProspectusLink = (html) => [...html.matchAll(/<a href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/g)]
  .find((match) => match[2].replace(/<[^>]+>|\s+/g, ' ').trim() === 'Prospektus')?.[1] ?? '';

export const listDocuments = async () => {
  const funds = new Map();

  for (const category of CATEGORIES) {
    for (const fund of parseFundLinks(await fetchText(`${SITE}${category}`))) {
      funds.set(fund.url, fund);
    }
  }

  const documents = [];

  for (const { url, name } of funds.values()) {
    const prospectus = parseProspectusLink(await fetchText(url));

    if (prospectus !== '') {
      documents.push({ name, url: prospectus });
    }
  }

  return documents;
};

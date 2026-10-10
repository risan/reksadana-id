import { decodeEntities, fetchText } from './fetcher.js';

export const manager = 'Trimegah Asset Management, PT';

const LISTING_URL = 'https://www.trimegah-am.com/id/reksadana';

export const parseFundLinks = (html) => [...new Set([...html.matchAll(/href="(https:\/\/www\.trimegah-am\.com\/id\/reksadana\/detail\/[^"]+)"/g)].map((match) => match[1]))];

// The page title is the fund's name ("REKSA DANA TRAM ALPHA"); the prospectus is the third download button.
export const parseFundPage = (html) => ({
  name: decodeEntities(html.match(/<title>([^<]+)<\/title>/)?.[1] ?? ''),
  url: html.match(/href="([^"]+\.pdf)"[^>]*>\s*<img[^>]*>\s*<span>Prospektus<\/span>/i)?.[1] ?? '',
});

export const listDocuments = async () => {
  const documents = [];

  for (const link of parseFundLinks(await fetchText(LISTING_URL))) {
    const { name, url } = parseFundPage(await fetchText(link));

    if (name !== '' && url !== '') {
      documents.push({ name, url });
    }
  }

  return documents;
};

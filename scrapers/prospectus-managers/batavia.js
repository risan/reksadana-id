import { decodeEntities, fetchText } from './fetcher.js';

export const manager = 'Batavia Prosperindo Aset Manajemen, PT';

const LISTING_URL = 'https://bpam.co.id/produk';

export const parseProductLinks = (html) => [...new Set([...html.matchAll(/href="(https:\/\/bpam\.co\.id\/product\/[a-z_-]+\/[^"]+)"/gi)].map((match) => match[1]))];

// A fund's page names the fund in its banner and links its prospectus ("PROSP-SDS-ID.pdf").
export const parseProductPage = (html) => ({
  name: decodeEntities(html.match(/<h1 class="banner-title">([^<]+)<\/h1>/)?.[1] ?? ''),
  url: html.match(/href="(https:\/\/bpam\.co\.id\/userfiles\/uploads\/files\/PROSP-[^"]+\.pdf)"/i)?.[1] ?? '',
});

export const listDocuments = async () => {
  const documents = [];

  for (const link of parseProductLinks(await fetchText(LISTING_URL))) {
    const { name, url } = parseProductPage(await fetchText(link));

    if (name !== '' && url !== '') {
      documents.push({ name, url });
    }
  }

  return documents;
};

import { decodeEntities, fetchText } from './fetcher.js';

export const manager = 'Syailendra Capital, PT';

const TYPE_PAGES = ['saham', 'campuran', 'pasar-uang', 'pendapatan-tetap', 'index', 'lainnya'].map((type) => `https://www.syailendracapital.com/product/reksa-dana-${type}`);

export const parseFundLinks = (html) => [...html.matchAll(/href="(https:\/\/www\.syailendracapital\.com\/product\/reksa-dana-[^"/]+\/[^"]+)"/g)].map((match) => match[1]);

// "Syailendra Equity Opportunity Fund (SEOF) Kelas A | Syailendra Capital": the abbreviation is not part of the fund's name.
export const parseFundPage = (html) => ({
  name: decodeEntities(html.match(/<title>([^<|]+)/)?.[1] ?? '').replace(/\s*\([A-Z0-9 ]+\)/, ''),
  url: html.match(/href="([^"]+\.pdf)"[^>]*>\s*<img[^>]*>\s*<h3>\s*Prospektus/i)?.[1] ?? '',
});

export const listDocuments = async () => {
  const links = new Set();

  for (const page of TYPE_PAGES) {
    for (const link of parseFundLinks(await fetchText(page))) {
      links.add(link);
    }
  }

  const documents = [];

  for (const link of links) {
    const { name, url } = parseFundPage(await fetchText(link));

    if (name !== '' && url !== '') {
      documents.push({ name, url });
    }
  }

  return documents;
};

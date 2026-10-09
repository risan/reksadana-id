import { decodeEntities, fetchJson, fetchText } from './fetcher.js';

export const manager = 'Surya Timur Alam Raya Asset Management, PT';

const PRODUCTS_URL = 'https://star-am.com/wp-json/wp/v2/star-product?per_page=100';

export const parseProducts = (products) => products.map((product) => ({ name: decodeEntities(product.title.rendered), page: product.link }));

// A product page lists its files as a title and a link; the prospectus is the one titled "Prospektus" (or "Pembaharuan
// Prospektus ...", with the typos the manager makes), next to the fact sheet.
export const parseProspectusLink = (html) => [...html.matchAll(/<div class="item-title">([^<]*)<\/div>\s*<div class="item-file">\s*<a href="([^"]+)"/g)]
  .find((match) => /ospek/i.test(match[1]))?.[2] ?? '';

export const listDocuments = async () => {
  const documents = [];

  for (const { name, page } of parseProducts(await fetchJson(PRODUCTS_URL))) {
    const url = parseProspectusLink(await fetchText(page));

    if (url !== '') {
      documents.push({ name, url: url.replaceAll(' ', '%20') });
    }
  }

  return documents;
};

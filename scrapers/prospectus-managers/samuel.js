import { decodeEntities, fetchText } from './fetcher.js';

export const manager = 'Samuel Aset Manajemen, PT';

const PROSPECTUS_PAGE = 'https://www.sam.co.id/produk/prospektus/';

// Each link is labelled with the fund's name and its code: "SAM Dana Kas (SDK)".
export const parseDocuments = (html) => [...html.matchAll(/<a href="(https:\/\/www\.sam\.co\.id\/[^"]+\.pdf)"[^>]*>\s*<i[^>]*><\/i>\s*([^<]+?)\s*<\/a>/g)]
  .map((match) => ({ name: decodeEntities(match[2]).replace(/\s*\([A-Za-z0-9 ]+\)\s*$/, ''), url: match[1] }));

export const listDocuments = async () => parseDocuments(await fetchText(PROSPECTUS_PAGE));

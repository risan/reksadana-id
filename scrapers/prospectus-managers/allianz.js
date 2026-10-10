import { decodeEntities, fetchText } from './fetcher.js';

export const manager = 'Allianz Global Investors Asset Management Indonesia, PT';

const DOWNLOADS_URL = 'https://id.allianzgi.com/id-id/downloads';

// The folder of the files holds the date of the prospectuses ("31-03-2026"), so the page is read each time. The
// "?rev=...&hash=..." after the address is not needed.
export const parseDocuments = (html) => [...html.matchAll(/href="(https:\/\/id\.allianzgi\.com\/-\/media\/[^"?]*\/prospectus\/[^"?]+\.pdf)[^"]*"[^>]*>[\s\S]*?<span class="c-link__text">([^<]+)<\/span>/g)]
  .map((match) => ({ name: decodeEntities(match[2]).replace(/\s+[–-]\s+Prospektus$/, ''), url: match[1] }));

export const listDocuments = async () => parseDocuments(await fetchText(DOWNLOADS_URL));

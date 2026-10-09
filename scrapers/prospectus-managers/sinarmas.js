import { HttpError } from '../lib.js';
import { USER_AGENT, fetchWithPause } from '../prospectus.js';

export const manager = 'Sinarmas Asset Management, PT';

const SITE = 'https://www.sinarmas-am.co.id';
// The site is a Next.js app and asks its server through "server actions", named by ids that are made when the site is
// built. The ids below are the ones of today; after a new build the answer is no longer the data, the adapter throws,
// and the manager is skipped with a warning and keeps its rows until the ids are read again from the site's scripts.
const LIST_ACTION = '00cc4578ca9e2f7dc5fb59d51cbdba02c99040653a';
const DETAIL_ACTION = '40a41461e3c661b64589c59a017bc4d35f2b27ba1a';

// A server action answers in lines of "<number>:<JSON>"; the data is in the line numbered 1.
export const parseActionResponse = (text) => {
  const line = text.split('\n').find((candidate) => candidate.startsWith('1:'));

  if (line === undefined) {
    throw new Error('the server action did not answer with data');
  }

  return JSON.parse(line.slice(2)).rawdata.data;
};

const callAction = async (path, action, body) => {
  const response = await fetchWithPause(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Next-Action': action, 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'text/x-component' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new HttpError(`${SITE}${path}`, response.status, response.statusText);
  }

  return parseActionResponse(await response.text());
};

export const listDocuments = async () => {
  const documents = [];

  for (const { id, name } of await callAction('/mutual-funds/equity', LIST_ACTION, [])) {
    const { url_pdf_prospectus: url } = await callAction('/simas-satu', DETAIL_ACTION, [id]);

    if (url) {
      documents.push({ name, url });
    }
  }

  return documents;
};

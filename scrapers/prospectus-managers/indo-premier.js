import { HttpError } from '../lib.js';
import { USER_AGENT, fetchWithPause } from '../prospectus.js';

export const manager = 'Indo Premier Investment Management, PT';

const API = 'https://ipim.indopremier.com/xdata';
const SITE = 'https://indopremierinvestment.com/';

const postJson = (url, body) => fetchWithPause(url, { method: 'POST', headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// A fund is in the lists of its kind and in the list of all funds; the ticker tells them apart.
export const parseFunds = (response) => [...new Map(Object.values(response.data).flat().map((fund) => [fund.ticker, fund])).values()];

// The prospectus is not a file with an address: the site's API answers a POST with the PDF. The address kept for it
// is made up, the same every time for one fund, and the user is sent to the manager's site. The API says nothing of the
// version of the file, so it is read again after a month.
export const addressOf = (ticker) => `${API}/download_pdf?filetype=prospektus&fundcode=${encodeURIComponent(ticker)}`;

export const listDocuments = async () => {
  const response = await postJson(`${API}/product_list`, { type: 'all' });

  if (!response.ok) {
    throw new HttpError(`${API}/product_list`, response.status, response.statusText);
  }

  return parseFunds(await response.json()).map((fund) => ({ name: fund.title, url: addressOf(fund.ticker), link: SITE, version: '' }));
};

export const downloadDocument = async (url) => {
  const response = await postJson(`${API}/download_pdf`, { filetype: 'prospektus', fundcode: new URL(url).searchParams.get('fundcode') });

  if (!response.ok) {
    throw new HttpError(url, response.status, response.statusText);
  }

  return new Uint8Array(await response.arrayBuffer());
};

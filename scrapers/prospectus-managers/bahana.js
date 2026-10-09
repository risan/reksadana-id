import { fetchJson } from './fetcher.js';

export const manager = 'Bahana TCW Investment Management, PT';

const PRODUCTS_URL = 'https://bahanatcw.com/api/products';
const ATTACHMENT_URL = 'https://bahanatcw.com/api/tcw/attachment/';
const PRODUCTS_PAGE = 'https://bahanatcw.com/product/reksadana';

// The file has no address of its own: the site's API answers with the PDF inside a data address. Its token holds the
// file name and the upload time, so a replaced file has another token and another URL.
export const parseProducts = (json) => json.Data
  .filter((product) => product.Prospectus)
  .map((product) => ({ name: product.PortfolioName, url: `${ATTACHMENT_URL}${product.Prospectus}`, link: PRODUCTS_PAGE }));

export const listDocuments = async () => parseProducts(await fetchJson(PRODUCTS_URL));

export const decodeAttachment = (json) => {
  const [, base64] = (json.fileUrl ?? '').match(/^data:application\/pdf;base64,(.+)$/) ?? [];

  if (base64 === undefined) {
    throw new Error(json.error ?? 'the attachment is not a PDF');
  }

  return new Uint8Array(Buffer.from(base64, 'base64'));
};

export const downloadDocument = async (url) => decodeAttachment(await fetchJson(url));

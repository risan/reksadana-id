import { HttpError } from '../lib.js';
import { fetchJson } from './fetcher.js';

export const manager = 'Henan Putihrai Asset Management, PT';

const API = 'https://api2.myhero.id/produk';
// The funds have no list in the API, only a number each. These are the numbers up to 30 today; a number without a fund answers 400.
const LAST_PRODUCT_NUMBER = 30;

// The prospectus is a file shared on Google Drive: "https://drive.google.com/file/d/<id>/view?usp=sharing".
export const downloadAddressOf = (shareLink) => {
  const id = shareLink.match(/\/file\/d\/([^/]+)/)?.[1];

  return id === undefined ? '' : `https://drive.google.com/uc?export=download&id=${id}`;
};

export const parseProduct = (response) => ({ name: response.data.produk.nama_produk, link: response.data.produk.file_propektus ?? '' });

export const listDocuments = async () => {
  const documents = [];

  for (let number = 1; number <= LAST_PRODUCT_NUMBER; number++) {
    let product;

    try {
      product = parseProduct(await fetchJson(`${API}/${number}`));
    } catch (error) {
      if (error instanceof HttpError && error.status === 400) {
        continue;
      }

      throw error;
    }

    const url = downloadAddressOf(product.link);

    if (product.name && url !== '') {
      documents.push({ name: product.name, url, link: product.link, version: '' });
    }
  }

  return documents;
};

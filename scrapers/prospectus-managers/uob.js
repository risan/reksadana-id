import { decodeEntities, fetchText } from './fetcher.js';

export const manager = 'UOB Asset Management Indonesia, PT';

const SITE = 'https://www.uobam.co.id';
const LISTING_URL = `${SITE}/products-and-services/index.html`;

export const parseFundLinks = (html) => [...new Set([...html.matchAll(/href="(\/products-and-services\/[^"/]+\.html)"/g)].map((match) => match[1]))]
  .filter((link) => !link.endsWith('/mutual-forms.html') && !link.endsWith('/index.html'));

// A fund's page links its prospectus in Indonesian ("...-bh.pdf", "PROSPEKTUS-BAHASA.pdf") and often one in English
// ("...-en.pdf"). A page of several funds, such as the one of the protected funds, has several prospectuses and no
// name for each, so it gives none.
export const parseFundPage = (html, pageUrl) => {
  const files = [...new Set([...html.matchAll(/href="([^"]*prospe[^"]*\.pdf)"/gi)].map((match) => match[1]))].filter((file) => !/-en\.pdf$|english/i.test(file));

  return {
    name: decodeEntities(html.match(/<title>([^<|]+)/)?.[1] ?? ''),
    url: files.length === 1 ? new URL(files[0], pageUrl).href.replaceAll(' ', '%20') : '',
  };
};

export const listDocuments = async () => {
  const documents = [];

  for (const link of parseFundLinks(await fetchText(LISTING_URL))) {
    const page = `${SITE}${link}`;
    const { name, url } = parseFundPage(await fetchText(page), page);

    if (name !== '' && url !== '') {
      documents.push({ name, url });
    }
  }

  return documents;
};

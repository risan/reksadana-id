import { fetchJson } from './fetcher.js';

export const manager = 'BNP Paribas Asset Management, PT';

const DOCUMENTS_URL = 'https://api.bnpparibas-am.com/push/doclib/AM_ID-FSE';
// "BNP PARIBAS PRIMA II [RK1, C]" is the class RK1 of the fund; "[CLASSIC, C]" and the like are a fund without classes.
const NO_CLASS_NAMES = new Set(['CLASSIC', 'NOT APPLICABLE', 'CAPITALISATION']);

export const parseDocuments = (rows) => {
  const documents = new Map();

  for (const row of rows.filter((candidate) => candidate.type === 'DOC_FP' && candidate.language === 'IND')) {
    const className = row.share_name.match(/\[([^,\]]+)/)?.[1].trim();
    const shareClass = className === undefined || NO_CLASS_NAMES.has(className) ? undefined : className;

    documents.set(`${row.compart_name}|${shareClass}|${row.direct_url}`, { name: row.compart_name, shareClass, url: row.direct_url });
  }

  return [...documents.values()];
};

export const listDocuments = async () => parseDocuments(await fetchJson(DOCUMENTS_URL));

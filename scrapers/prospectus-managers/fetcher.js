import { createTextFetcher } from '../lib.js';
import { USER_AGENT } from '../prospectus.js';

const { fetchText } = createTextFetcher({ headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, timeoutMs: 60 * 1000, delayMs: 400 });

export { fetchText };

export const fetchJson = async (url) => JSON.parse(await fetchText(url));

export const decodeEntities = (text) => text.replaceAll('&amp;', '&').replaceAll('&#039;', "'").replaceAll('&quot;', '"').replaceAll('&nbsp;', ' ').trim();

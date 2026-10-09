import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { withServingHost, withWorkingUrl } from './bibit.js';

const linkTo = (file) => withWorkingUrl({ name: 'x.pdf', file }).file;

test('the region form of the S3 host moves to the CDN host, which serves those older files', () => {
  assert.equal(linkTo('https://bibit.s3.ap-southeast-1.amazonaws.com/prospectus/a.pdf'), 'https://assets.bibit.id/prospectus/a.pdf');
  assert.equal(linkTo('https://bibit.s3-ap-southeast-1.amazonaws.com/factsheets/a.pdf'), 'https://assets.bibit.id/factsheets/a.pdf');
});

test('the plain S3 host stays, because the CDN host answers 403 for the newer files on it', () => {
  assert.equal(linkTo('https://bibit.s3.amazonaws.com/prospectus/Prospektus_Trim_Kas_USD_Maret_2026.pdf'), 'https://bibit.s3.amazonaws.com/prospectus/Prospektus_Trim_Kas_USD_Maret_2026.pdf');
});

test('a link on the CDN host, and a document without a link, stay as they are', () => {
  assert.equal(linkTo('https://assets.bibit.id/prospectus/a.pdf'), 'https://assets.bibit.id/prospectus/a.pdf');
  assert.deepEqual(withWorkingUrl({ name: 'x.pdf', file: null }), { name: 'x.pdf', file: null });
});

const SLASH_LINK = 'https://assets.bibit.id/factsheets%2FA_2021.pdf';
const S3_LINK = 'https://bibit.s3.amazonaws.com/factsheets/A_2021.pdf';

// A URL that is not in the list cannot be reached.
const answerWith = (statusByUrl) => mock.method(globalThis, 'fetch', async (url) => {
  if (!(url in statusByUrl)) {
    throw new Error('unreachable');
  }

  return { status: statusByUrl[url] };
});

test('a link with an encoded slash moves to the S3 host when only that host serves the file', async (context) => {
  context.after(() => mock.restoreAll());
  answerWith({ [SLASH_LINK]: 403, [S3_LINK]: 200 });

  assert.deepEqual(await withServingHost({ name: 'a', file: SLASH_LINK }), { name: 'a', file: S3_LINK });
});

test('a link with an encoded slash stays when the CDN host serves it, when neither host does, and when the S3 host cannot be reached', async (context) => {
  context.after(() => mock.restoreAll());

  answerWith({ [SLASH_LINK]: 200 });
  assert.equal((await withServingHost({ file: SLASH_LINK })).file, SLASH_LINK);

  mock.restoreAll();
  answerWith({ [SLASH_LINK]: 403, [S3_LINK]: 403 });
  assert.equal((await withServingHost({ file: SLASH_LINK })).file, SLASH_LINK);

  mock.restoreAll();
  answerWith({ [SLASH_LINK]: 403 });
  assert.equal((await withServingHost({ file: SLASH_LINK })).file, SLASH_LINK);
});

test('a link without an encoded slash is not asked about', async (context) => {
  context.after(() => mock.restoreAll());
  const fetchMock = answerWith({});

  assert.equal((await withServingHost({ file: 'https://assets.bibit.id/factsheets/A_2021.pdf' })).file, 'https://assets.bibit.id/factsheets/A_2021.pdf');
  assert.equal((await withServingHost({ file: null })).file, null);
  assert.equal(fetchMock.mock.callCount(), 0);
});

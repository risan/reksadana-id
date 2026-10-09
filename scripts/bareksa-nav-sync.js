// Loads Bareksa's daily NAV (members only) through the owner's logged-in browser tab, so no cookie is ever copied.
//
// 1. `npm run sync:bareksa-nav` starts a receiver on http://127.0.0.1:8787 and prints a snippet.
// 2. Paste the snippet into the DevTools console of a logged-in bareksa.com tab, then click the button it adds.
//
// The button opens the receiver in a small window. Browsers block a public page from calling localhost
// directly, so the two windows talk with postMessage, and the receiver posts each answer to its own server.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { CookieError, NAV_HEADER, parseNavRows } from '../scrapers/bareksa.js';
import { mergeRowsByDate, readCsvRecords, readCsvRows, toCsv, writeFileAtomic } from '../scrapers/lib.js';

const PORT = 8787;
const RECEIVER_ORIGIN = `http://127.0.0.1:${PORT}`;
const BAREKSA_ORIGIN = 'https://www.bareksa.com';
const DATA_DIR = path.join(import.meta.dirname, '..', 'data', 'bareksa');
const NAV_DIR = path.join(DATA_DIR, 'nav');
const MAX_BODY_BYTES = 20 * 1024 * 1024;

// Bareksa corrects recent days now and then, so each fund is asked again from this many days before its last stored row.
const OVERLAP_DAYS = 30;

const RECEIVER_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Bareksa NAV receiver</title>
<body style="font: 14px system-ui, sans-serif; margin: 16px">
<p id="status">Waiting for the Bareksa tab…</p>
<script>
  const status = document.getElementById('status');
  let saved = 0;

  window.addEventListener('message', async (event) => {
    if (event.origin !== '${BAREKSA_ORIGIN}' || event.data?.type !== 'nav') {
      return;
    }

    let reply;

    try {
      const response = await fetch('/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: event.data.id, json: event.data.json }),
      });

      reply = await response.json();
    } catch (error) {
      reply = { error: String(error) };
    }

    saved++;
    status.textContent = 'Saved ' + saved + ' funds';
    event.source.postMessage({ type: 'saved', id: event.data.id, ...reply }, '${BAREKSA_ORIGIN}');
  });

  fetch('/funds')
    .then((response) => response.json())
    .then((funds) => window.opener.postMessage({ type: 'funds', funds }, '${BAREKSA_ORIGIN}'));
</script>`;

const BROWSER_SNIPPET = `(() => {
  const RECEIVER = '${RECEIVER_ORIGIN}';
  const CONCURRENCY = 2;
  const sync = (window.__navSync = { total: 0, done: 0, failed: [], finished: false });
  const button = document.createElement('button');

  button.textContent = 'Sync NAV to reksadana-id';
  button.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;padding:12px 16px;font:600 14px system-ui;background:#1d3b8f;color:#fff;border:0;border-radius:10px;cursor:pointer';
  document.body.append(button);

  const waiting = new Map();

  window.addEventListener('message', (event) => {
    if (event.origin !== RECEIVER) {
      return;
    }

    if (event.data?.type === 'funds') {
      run(event.data.funds, event.source);
    }

    if (event.data?.type === 'saved') {
      waiting.get(event.data.id)?.(event.data);
      waiting.delete(event.data.id);
    }
  });

  const navUrl = (id, startDate) => startDate
    ? '/ajax/mutualfund/nav/product1/?id=' + id + '&cperiod=custom&startdate=' + startDate + '&enddate=' + new Date().toISOString().slice(0, 10) + '&requested_page=profile.graph'
    : '/ajax/mutualfund/nav/product1/?id=' + id + '&cperiod=all&startdate=&enddate=&requested_page=profile.graph';

  const run = async (funds, receiver) => {
    sync.total = funds.length;
    const queue = [...funds];

    const worker = async () => {
      while (queue.length > 0 && !sync.finished) {
        const [id, startDate] = queue.shift();

        try {
          const response = await fetch(navUrl(id, startDate), { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
          const json = await response.json();
          const reply = await new Promise((resolve) => {
            waiting.set(id, resolve);
            receiver.postMessage({ type: 'nav', id, json }, RECEIVER);
          });

          if (reply.error === 'cookie') {
            sync.finished = true;
            sync.failed.push(id + ': not logged in');
          } else if (reply.error) {
            sync.failed.push(id + ': ' + reply.error);
          }
        } catch (error) {
          sync.failed.push(id + ': ' + error);
        }

        sync.done++;
        button.textContent = 'Synced ' + sync.done + ' / ' + sync.total + (sync.failed.length ? ' (' + sync.failed.length + ' failed)' : '');
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    sync.finished = true;
    button.textContent += ' — done';
  };

  button.addEventListener('click', () => {
    window.open(RECEIVER, 'reksadana-nav-receiver', 'width=420,height=200');
  });
})();`;

const daysBefore = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00Z`);

  date.setUTCDate(date.getUTCDate() - days);

  return date.toISOString().slice(0, 10);
};

// One [id, startDate] per fund; a fund with no stored NAV gets a null start date, which asks for its full history.
const listFunds = async () => {
  const funds = await readCsvRecords(path.join(DATA_DIR, 'funds.csv'));

  return Promise.all(funds.map(async ({ bareksa_id: id }) => {
    const lastDate = (await readCsvRows(path.join(NAV_DIR, `${id}.csv`))).at(-1)?.[0];

    return [id, lastDate ? daysBefore(lastDate, OVERLAP_DAYS) : null];
  }));
};

const saveNav = async (id, json) => {
  const file = path.join(NAV_DIR, `${id}.csv`);
  const storedRows = await readCsvRows(file);
  const newRows = parseNavRows(json);

  if (newRows.length === 0) {
    return { rows: storedRows.length, added: 0 };
  }

  const rows = mergeRowsByDate(storedRows, newRows);

  await writeFileAtomic(file, toCsv(NAV_HEADER, rows));

  return { rows: rows.length, added: rows.length - storedRows.length };
};

const readBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;

  request.on('data', (chunk) => {
    size += chunk.length;

    if (size > MAX_BODY_BYTES) {
      reject(new Error('Body too large'));
      request.destroy();

      return;
    }

    chunks.push(chunk);
  });
  request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  request.on('error', reject);
});

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

// Any web page can send a request to localhost, and a text/plain POST needs no permission from the browser. So a
// request is served only for the receiver's own host name (against DNS rebinding), and a save only from the
// receiver's own page, as JSON.
export const rejectionFor = ({ method, url, headers }) => {
  if (headers.host !== `127.0.0.1:${PORT}`) {
    return 'Wrong host';
  }

  if (method === 'POST' && url === '/save') {
    if (headers.origin !== RECEIVER_ORIGIN) {
      return 'Wrong origin';
    }

    if (!headers['content-type']?.startsWith('application/json')) {
      return 'Body must be JSON';
    }
  }

  return null;
};

let savedCount = 0;
let addedRows = 0;

const server = http.createServer(async (request, response) => {
  try {
    const rejection = rejectionFor(request);

    if (rejection) {
      sendJson(response, 403, { error: rejection });

      return;
    }

    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(RECEIVER_PAGE);

      return;
    }

    if (request.method === 'GET' && request.url === '/funds') {
      sendJson(response, 200, await listFunds());

      return;
    }

    if (request.method === 'POST' && request.url === '/save') {
      const { id, json } = JSON.parse(await readBody(request));

      if (!/^\d+$/.test(String(id))) {
        sendJson(response, 400, { error: 'Invalid id' });

        return;
      }

      const result = await saveNav(String(id), json);

      savedCount++;
      addedRows += result.added;

      if (savedCount % 100 === 0) {
        console.log(`${savedCount} funds saved, ${addedRows} new rows`);
      }

      sendJson(response, 200, result);

      return;
    }

    response.writeHead(404);
    response.end();
  } catch (error) {
    sendJson(response, 200, { error: error instanceof CookieError ? 'cookie' : error.message });
  }
});

if (process.argv[1] === import.meta.filename) {
  await fs.mkdir(NAV_DIR, { recursive: true });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Receiver ready on ${RECEIVER_ORIGIN}. Paste this into the console of a logged-in bareksa.com tab, then click its button:\n`);
    console.log(BROWSER_SNIPPET);
    console.log('\nPress Ctrl+C when the button says "done".');
  });

  process.on('SIGINT', () => {
    console.log(`\n${savedCount} funds saved, ${addedRows} new rows.`);
    process.exit(0);
  });
}

// Does two jobs, and everything else is served as a static asset without running this Worker (see
// `run_worker_first` in wrangler.toml).
// 1. Sends a first-time visitor of "/" to the English page when Cloudflare says they are outside Indonesia.
// 2. Serves the per-fund CSV files. They are not built as files (that would be two more files per fund, and
//    Cloudflare's free plan allows 20,000 per deployment). Each one is made from the fund's JSON record,
//    whose `history` holds the series the site draws.

const CSV_PATH = /^\/csv\/(nav|aum)\/([A-Za-z0-9_-]+)\.csv$/;

// The same headers public/_headers gives the other CSV files, which static asset headers cannot add here.
const CSV_HEADERS = {
  'Content-Type': 'text/csv; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=3600',
};

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
};

const CRAWLER_USER_AGENT = /bot|crawl|spider|slurp|preview|facebookexternalhit|lighthouse/i;

// The language the visitor chose with the switcher, if any. Only the two languages of the site count.
function chosenLanguage(request) {
  const cookie = /(?:^|;\s*)lang=(id|en)(?:;|$)/.exec(request.headers.get('Cookie') ?? '');

  return cookie ? cookie[1] : null;
}

function prefersEnglish(request) {
  const language = chosenLanguage(request);

  if (language) {
    return language === 'en';
  }

  const country = request.cf?.country;

  return Boolean(country) && country !== 'ID';
}

async function serveHome(request, env) {
  const userAgent = request.headers.get('User-Agent') ?? '';

  if (!CRAWLER_USER_AGENT.test(userAgent) && prefersEnglish(request)) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/en/${new URL(request.url).search}`, 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
    });
  }

  const response = await env.ASSETS.fetch(request);
  const home = new Response(response.body, response);

  home.headers.append('Vary', 'Cookie');

  return home;
}

const textResponse = (message, status, method) => new Response(method === 'HEAD' ? null : `${message}\n`, { status, headers: TEXT_HEADERS });

const fetchAsset = (env, request, pathname) => env.ASSETS.fetch(new URL(pathname, request.url));

// An asset that is not there is a 404 for the caller. Anything else that is not JSON is a server problem.
async function readJsonAsset(env, request, pathname) {
  const response = await fetchAsset(env, request, pathname);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok || !response.headers.get('Content-Type')?.includes('json')) {
    throw new Error(`${pathname} answered ${response.status}`);
  }

  return response.json();
}

// A retired ID gives the fund that holds its record now.
async function readFundRecord(env, request, id) {
  const record = await readJsonAsset(env, request, `/api/funds/${id}.json`);

  if (record) {
    return record;
  }

  const retiredIds = await readJsonAsset(env, request, '/fund-ids.json');
  const currentId = retiredIds?.[id];

  return currentId ? readJsonAsset(env, request, `/api/funds/${currentId}.json`) : null;
}

const toCsv = (kind, points) => `date,${kind},source\n${points.map((point) => `${point.date},${point.value},${point.source}`).join('\n')}\n`;

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed\n', { status: 405, headers: { ...TEXT_HEADERS, Allow: 'GET, HEAD' } });
    }

    const { pathname } = new URL(request.url);

    if (pathname === '/') {
      return serveHome(request, env);
    }

    const match = CSV_PATH.exec(pathname);

    if (!match) {
      return textResponse('Not found', 404, request.method);
    }

    const [, kind, id] = match;
    let record;

    try {
      record = await readFundRecord(env, request, id);
    } catch {
      return textResponse('The fund data is not available right now', 502, request.method);
    }

    const points = record?.history?.[kind] ?? [];

    if (points.length === 0) {
      return textResponse(record ? `No ${kind.toUpperCase()} history for ${id}` : `Unknown fund ${id}`, 404, request.method);
    }

    return new Response(request.method === 'HEAD' ? null : toCsv(kind, points), { headers: CSV_HEADERS });
  },
};

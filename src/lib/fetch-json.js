// JSON from this site's own files, for the browser scripts. Both functions give null instead of throwing,
// so a caller shows a message when the data does not load.

export async function getJson(url, options) {
  try {
    const response = await fetch(url, options);

    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

const hasCurrentShape = (record) => Boolean(record?.fund && record.costs);

export async function fetchFundRecord(id) {
  const url = `/api/funds/${encodeURIComponent(id)}.json`;
  let record = await getJson(url);

  // The browser may hold a record from before a deploy for an hour; it lacks the fields added since.
  if (record !== null && !hasCurrentShape(record)) {
    record = await getJson(url, { cache: 'reload' });
  }

  return hasCurrentShape(record) ? record : null;
}

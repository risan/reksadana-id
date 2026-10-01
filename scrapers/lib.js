import fs from 'node:fs/promises';

const MAX_ATTEMPTS = 5;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(url, status, message) {
    super(`GET ${url} failed with ${status}: ${message}`);
    this.status = status;
  }
}

// Timeouts, dropped connections, and truncated bodies are worth a retry too.
export const withRetries = async (task) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      const retryable = !(error instanceof HttpError) || error.status === 429 || error.status >= 500;

      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw error;
      }

      await sleep(2 ** attempt * 1000);
    }
  }
};

// Write to a temporary file first, so an interrupted run never leaves a half-written file.
export const writeFileAtomic = async (file, text) => {
  const temporaryFile = `${file}.tmp`;

  await fs.writeFile(temporaryFile, text);
  await fs.rename(temporaryFile, file);
};

const toCsvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);

  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
};

export const toCsv = (header, rows) => [header, ...rows].map((row) => row.map(toCsvCell).join(',')).join('\n') + '\n';

// Handles quoted fields with commas, escaped quotes, and line breaks.
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

// Rows without the header line. A missing file counts as no rows.
export const readCsvRows = async (file) => {
  try {
    return parseCsv(await fs.readFile(file, 'utf8')).slice(1);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
};

// Runs `worker` over `items` with a fixed number of parallel workers.
// Returns one message per item that threw, so one bad item never stops the run.
export const runPool = async ({ items, worker, concurrency, label, describeItem }) => {
  let next = 0;
  let done = 0;
  const failures = [];

  const runWorker = async () => {
    while (next < items.length) {
      const item = items[next++];

      try {
        await worker(item);
      } catch (error) {
        failures.push(`${describeItem(item)}: ${error.message}`);
      }

      done++;

      if (done % 100 === 0 || done === items.length) {
        console.log(`${label}: ${done}/${items.length}`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, runWorker));

  return failures;
};

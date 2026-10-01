import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { DATA_DIR } from '../../lib/data.js';

function collectFiles(directory, prefix) {
  const files = {};

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      Object.assign(files, collectFiles(entryPath, `${prefix}${entry.name}/`));
    } else {
      files[`${prefix}${entry.name}`] = readFileSync(entryPath);
    }
  }

  return files;
}

export function GET() {
  return new Response(zipSync(collectFiles(DATA_DIR, 'data/'), { level: 9 }), {
    headers: { 'Content-Type': 'application/zip' },
  });
}

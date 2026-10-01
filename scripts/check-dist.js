import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Cloudflare's free plan allows 20,000 files per deployment and 25 MiB per file.
const MAX_FILES = 19000;
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const DIST_DIR = 'dist';

function listFiles(dir) {
  const files = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

const files = listFiles(DIST_DIR);
const oversized = files.filter((file) => statSync(file).size > MAX_FILE_BYTES);

console.log(`${DIST_DIR}/ has ${files.length} files (limit ${MAX_FILES}).`);

if (files.length > MAX_FILES) {
  console.error(`Too many files: ${files.length} > ${MAX_FILES}. Cloudflare's free plan allows 20,000 files per deployment.`);
  process.exit(1);
}

if (oversized.length > 0) {
  console.error(`Files over 24 MiB (Cloudflare's limit is 25 MiB per file):\n${oversized.join('\n')}`);
  process.exit(1);
}

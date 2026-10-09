import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Cloudflare's free plan allows 20,000 files per deployment and 25 MiB per file.
const MAX_FILES = 19000;
const MAX_FILE_BYTES = 24 * 1024 * 1024;
// Cloudflare allows 2,000 static redirects in _redirects.
const MAX_REDIRECTS = 2000;
const WARN_REDIRECTS = 1800;
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

const redirectCount = readFileSync(path.join(DIST_DIR, '_redirects'), 'utf8').split('\n').filter((line) => line.trim() !== '').length;

console.log(`${DIST_DIR}/_redirects has ${redirectCount} redirects (limit ${MAX_REDIRECTS}).`);

if (redirectCount > MAX_REDIRECTS) {
  console.error(`Too many redirects: ${redirectCount} > ${MAX_REDIRECTS}.`);
  process.exit(1);
}

if (redirectCount > WARN_REDIRECTS) {
  console.warn(`Close to the redirect limit: ${redirectCount} of ${MAX_REDIRECTS}. Each retired ID costs up to five lines.`);
}

// Cloudflare serves the nearest 404.html up the path, one per language.
for (const notFoundPage of ['404.html', 'en/404.html']) {
  if (!existsSync(path.join(DIST_DIR, notFoundPage))) {
    console.error(`${DIST_DIR}/${notFoundPage} is missing.`);
    process.exit(1);
  }
}

if (oversized.length > 0) {
  console.error(`Files over 24 MiB (Cloudflare's limit is 25 MiB per file):\n${oversized.join('\n')}`);
  process.exit(1);
}

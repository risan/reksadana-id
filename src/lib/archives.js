import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { DATA_DIR } from './data.js';

// Cloudflare's free plan allows 25 MiB per file. These CSV files compress to about a fifth of their size,
// so a zip stays well under 20 MB when the files inside add up to less than this.
const MAX_NAV_ARCHIVE_BYTES = 60 * 1000 * 1000;

function collectFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

// Bareksa's daily NAV is the biggest part of its data, so it is split into zips of similar size.
function splitBySize(files) {
  const groups = [];
  let currentBytes = 0;

  for (const file of files) {
    const bytes = statSync(file).size;

    if (groups.length === 0 || currentBytes + bytes > MAX_NAV_ARCHIVE_BYTES) {
      groups.push([]);
      currentBytes = 0;
    }

    groups.at(-1).push(file);
    currentBytes += bytes;
  }

  return groups;
}

export function listArchives() {
  const bareksaNavDirectory = path.join(DATA_DIR, 'bareksa', 'nav');
  const bareksaNavFiles = existsSync(bareksaNavDirectory) ? collectFiles(bareksaNavDirectory).sort() : [];
  const bareksaOtherFiles = collectFiles(path.join(DATA_DIR, 'bareksa')).filter((file) => !bareksaNavFiles.includes(file));

  return [
    { name: 'bibit', description: 'Everything in data/bibit/', files: collectFiles(path.join(DATA_DIR, 'bibit')) },
    { name: 'kontan', description: 'Everything in data/kontan/', files: collectFiles(path.join(DATA_DIR, 'kontan')) },
    { name: 'makmur', description: 'Everything in data/makmur/', files: collectFiles(path.join(DATA_DIR, 'makmur')) },
    { name: 'bareksa', description: 'data/bareksa/ without the daily NAV: fund list, AUM, units, and asset allocation', files: bareksaOtherFiles },
    ...splitBySize(bareksaNavFiles).map((files, index, groups) => ({
      name: `bareksa-nav-${index + 1}`,
      description: `data/bareksa/nav/, part ${index + 1} of ${groups.length}: daily NAV`,
      files,
    })),
  ];
}

const zipsByName = new Map();

// Paths inside the zip are relative to the repository root, like `data/bibit/funds.csv`.
export function zipArchive(archive) {
  if (!zipsByName.has(archive.name)) {
    const entries = archive.files.map((file) => [path.relative(path.dirname(DATA_DIR), file).split(path.sep).join('/'), readFileSync(file)]);

    zipsByName.set(archive.name, zipSync(Object.fromEntries(entries), { level: 9 }));
  }

  return zipsByName.get(archive.name);
}

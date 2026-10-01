import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { DATA_DIR } from './data.js';

// Cloudflare's free plan allows 25 MiB per file. A group of NAV files is first cut by raw size, which
// usually gives a zip well under the limit, since these CSV files compress to about a fifth of their size.
const MAX_NAV_ARCHIVE_BYTES = 60 * 1000 * 1000;
// A zip over the split size is cut in half and rebuilt. A zip over the hard limit is a build error.
const SPLIT_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_BYTES = 24 * 1024 * 1024;

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

// Paths inside the zip are relative to the repository root, like `data/bibit/funds.csv`.
function zipFiles(files) {
  const entries = files.map((file) => [path.relative(path.dirname(DATA_DIR), file).split(path.sep).join('/'), readFileSync(file)]);

  return zipSync(Object.fromEntries(entries), { level: 9 });
}

function assertFitsLimit(zip, files) {
  if (zip.length > MAX_ZIP_BYTES) {
    throw new Error(`Zip of ${files.length} files is ${zip.length} bytes, over the ${MAX_ZIP_BYTES} byte limit (first file: ${files[0]})`);
  }
}

// Returns groups of { files, zip } whose zips are all small enough to deploy.
function splitUntilZipFits(files) {
  const zip = zipFiles(files);

  if (zip.length <= SPLIT_ZIP_BYTES) {
    return [{ files, zip }];
  }

  if (files.length === 1) {
    assertFitsLimit(zip, files);

    return [{ files, zip }];
  }

  const middle = Math.ceil(files.length / 2);

  return [...splitUntilZipFits(files.slice(0, middle)), ...splitUntilZipFits(files.slice(middle))];
}

let archives = null;

export function listArchives() {
  archives ??= buildArchives();

  return archives;
}

function buildArchives() {
  const bareksaNavDirectory = path.join(DATA_DIR, 'bareksa', 'nav');
  const bareksaNavFiles = existsSync(bareksaNavDirectory) ? collectFiles(bareksaNavDirectory).sort() : [];
  const bareksaOtherFiles = collectFiles(path.join(DATA_DIR, 'bareksa')).filter((file) => !bareksaNavFiles.includes(file));

  return [
    { name: 'bibit', description: 'Everything in data/bibit/', files: collectFiles(path.join(DATA_DIR, 'bibit')) },
    { name: 'kontan', description: 'Everything in data/kontan/', files: collectFiles(path.join(DATA_DIR, 'kontan')) },
    { name: 'makmur', description: 'Everything in data/makmur/', files: collectFiles(path.join(DATA_DIR, 'makmur')) },
    { name: 'bareksa', description: 'data/bareksa/ without the daily NAV: fund list, AUM, units, and asset allocation', files: bareksaOtherFiles },
    ...splitBySize(bareksaNavFiles).flatMap(splitUntilZipFits).map(({ files, zip }, index, groups) => ({
      name: `bareksa-nav-${index + 1}`,
      description: `data/bareksa/nav/, part ${index + 1} of ${groups.length}: daily NAV`,
      files,
      zip,
    })),
  ];
}

const zipsByName = new Map();

export function zipArchive(archive) {
  if (archive.zip) {
    return archive.zip;
  }

  if (!zipsByName.has(archive.name)) {
    const zip = zipFiles(archive.files);

    assertFitsLimit(zip, archive.files);
    zipsByName.set(archive.name, zip);
  }

  return zipsByName.get(archive.name);
}

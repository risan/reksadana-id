import { spawnSync } from 'node:child_process';

// Bibit goes first because the other scrapers match their funds against Bibit's fund list.
// A failing scraper does not stop the next one: they still save the funds that succeeded.
const SCRAPERS = ['bibit', 'kontan', 'makmur'];

let hasFailure = false;

for (const scraper of SCRAPERS) {
  const { status } = spawnSync('node', [`scrapers/${scraper}.js`], { stdio: 'inherit' });

  if (status !== 0) {
    console.error(`${scraper} scraper failed with exit code ${status}`);
    hasFailure = true;
  }
}

// The linker rebuilds data/funds.csv from whatever the scrapers saved, so it runs last even after a failure.
const { status: linkStatus } = spawnSync('node', ['scripts/link-funds.js'], { stdio: 'inherit' });

if (linkStatus !== 0) {
  console.error(`link-funds failed with exit code ${linkStatus}`);
  hasFailure = true;
}

process.exitCode = hasFailure ? 1 : 0;

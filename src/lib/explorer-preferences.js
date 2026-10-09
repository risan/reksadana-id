// Which columns the table shows and how dense its rows are, kept per viewer in localStorage.
// Storage can be blocked or full, so a failure falls back to the defaults rather than breaking the page.
// The inline script in index.astro reads the same two keys before the table paints; keep them in step.
import { COLUMN_KEYS, DEFAULT_COLUMNS } from './explorer-columns.js';

const COLUMNS_KEY = 'explorer-columns';
const DENSITY_KEY = 'explorer-density';

export const DENSITIES = ['comfortable', 'compact'];

const NO_COLUMNS = 'none';

// Stored as the column keys separated by spaces. Keys that no longer exist are dropped.
export function parseColumns(text) {
  if (text === NO_COLUMNS) {
    return [];
  }

  const keys = (text ?? '').split(' ').filter((key) => COLUMN_KEYS.includes(key));

  return keys.length > 0 ? COLUMN_KEYS.filter((key) => keys.includes(key)) : DEFAULT_COLUMNS;
}

function readValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice still applies to this page view; it just is not remembered.
  }
}

export const readColumns = () => parseColumns(readValue(COLUMNS_KEY));
export const writeColumns = (keys) => writeValue(COLUMNS_KEY, keys.length > 0 ? keys.join(' ') : NO_COLUMNS);

export function readDensity() {
  const density = readValue(DENSITY_KEY);

  return DENSITIES.includes(density) ? density : DENSITIES[0];
}

export const writeDensity = (density) => writeValue(DENSITY_KEY, density);

// The funds picked on the explorer or a fund page, waiting for the compare page.
// Storage can be blocked or full, so a failure leaves the tray empty rather than breaking the page.
import { MAX_FUNDS } from './compare.js';

const STORAGE_KEY = 'compare-tray';

export function readTrayText() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function readTray() {
  return (readTrayText() ?? '').split(',').filter(Boolean).slice(0, MAX_FUNDS);
}

export function writeTray(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, ids.join(','));
  } catch {
    // The selection still works for this page view; it just is not remembered.
  }
}

export function toggleInTray(id) {
  const tray = readTray();
  const next = tray.includes(id) ? tray.filter((trayId) => trayId !== id) : [...tray, id].slice(0, MAX_FUNDS);

  writeTray(next);

  return next;
}

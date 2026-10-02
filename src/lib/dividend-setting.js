// Whether returns include reinvested dividends, shared by every page.
// Storage can be blocked or full, so a failure leaves the setting off rather than breaking the page.
const STORAGE_KEY = 'include-dividends';

export function readIncludeDividends() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeIncludeDividends(include) {
  try {
    localStorage.setItem(STORAGE_KEY, include ? '1' : '0');
  } catch {
    // The choice still applies to this page view; it just is not remembered.
  }
}

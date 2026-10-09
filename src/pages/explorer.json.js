import { loadFundSummaries } from '../lib/data.js';
import { encodeSummaries } from '../lib/explorer-data.js';

// Feeds the fund explorer on the home page. Not part of the public API, so its shape can change.
// The browser expands it with decodeSummaries().
export function GET() {
  return Response.json(encodeSummaries(loadFundSummaries()));
}

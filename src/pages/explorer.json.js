import { loadFundSummaries } from '../lib/data.js';

// Feeds the fund explorer on the home page. Not part of the public API, so its shape can change.
export function GET() {
  return Response.json(loadFundSummaries());
}

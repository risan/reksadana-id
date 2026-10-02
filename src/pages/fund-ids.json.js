import { loadRetiredIds } from '../lib/data.js';

// Retired fund IDs and the fund that holds their record now. The per-fund CSV Worker reads it.
export function GET() {
  return Response.json(Object.fromEntries(loadRetiredIds().map(({ id, current_id }) => [id, current_id])));
}

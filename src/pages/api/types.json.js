import { loadTypes } from '../../lib/data.js';

export function GET() {
  return Response.json(loadTypes());
}

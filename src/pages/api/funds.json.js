import { loadFundIndex } from '../../lib/data.js';

export function GET() {
  return Response.json(loadFundIndex());
}

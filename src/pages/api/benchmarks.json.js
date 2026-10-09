import { loadBenchmarks } from '../../lib/data.js';

// The series a fund is compared with: the metadata of each, and the date range and latest value. The points are
// at /api/benchmarks/<id>.json.
export function GET() {
  return Response.json(loadBenchmarks().map(({ points, ...series }) => ({
    ...series,
    end_date: points.at(-1).date,
    latest_value: points.at(-1).value,
    points_count: points.length,
  })));
}

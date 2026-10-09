import { loadBenchmarks } from '../../../lib/data.js';

export function getStaticPaths() {
  return loadBenchmarks().map((series) => ({ params: { id: series.id }, props: { series } }));
}

// One series: its metadata and every point as { date, value }, oldest first.
export function GET({ props }) {
  return Response.json(props.series);
}

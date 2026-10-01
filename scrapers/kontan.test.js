import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChart } from './kontan.js';

const chartPage = (pushes) => `<script>
  var pausecontent = new Array();
  var data1 = new Array();
  ${pushes}
  Chart.defaults.LineWithLine = Chart.defaults.line;
</script>`;

test('a chart page with points gives one row per date', () => {
  const html = chartPage(`pausecontent.push('2026-09-30'); data1.push('1500.25');
    pausecontent.push('2026-10-01'); data1.push('1501.5');`);

  assert.deepEqual(parseChart(html).rows, [['2026-09-30', '1500.25'], ['2026-10-01', '1501.5']]);
});

test('a chart page without points is an empty chart', () => {
  assert.deepEqual(parseChart(chartPage('')).rows, []);
});

test('double quotes and spacing in the pushes are accepted', () => {
  const html = chartPage('pausecontent.push( "2026-10-01" );\n data1.push( "1501.5" );');

  assert.deepEqual(parseChart(html).rows, [['2026-10-01', '1501.5']]);
});

test('an HTTP 200 page that is not the chart template is an error, not an empty chart', () => {
  assert.throws(() => parseChart('<html><body>Service temporarily unavailable</body></html>'), /not a Kontan chart page/);
});

test('different counts of dates and values are an error', () => {
  assert.throws(() => parseChart(chartPage("pausecontent.push('2026-10-01');")), /1 dates but 0 values/);
});

test('days without a price are skipped', () => {
  const html = chartPage(`pausecontent.push('2026-09-30'); data1.push('#N/A');
    pausecontent.push('2026-10-01'); data1.push('1501.5');`);

  assert.deepEqual(parseChart(html).rows, [['2026-10-01', '1501.5']]);
});

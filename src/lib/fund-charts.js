import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import * as m from '../paraglide/messages.js';
import { setLocale } from '../paraglide/runtime.js';
import { rebaseBenchmark } from './benchmarks.js';
import { fetchFundRecord, getJson } from './fetch-json.js';
import { changeClass, escapeHtml, formatChange, formatCompact, formatDate, formatMoney, formatMonth, formatMonthName, formatNav, formatNumber, tightenSeparators } from './format.js';
import { dividendEvents, periodStartIndex, pickAumHistory, pickNavHistory, withDividendsReinvested } from './series.js';

const RANGE_PERIODS = { '1M': '1m', '3M': '3m', '6M': '6m', YTD: 'ytd', '1Y': '1y', '3Y': '3y', '5Y': '5y', All: 'all' };
const DEFAULT_RANGE = '1Y';
const DAY_SECONDS = 24 * 60 * 60;
const PRICE_HEIGHT = 280;
const AUM_HEIGHT = 92;

export function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function withAlpha(hexColor, alpha) {
  const hex = hexColor.replace('#', '');
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function toSeconds(date) {
  return Date.parse(`${date}T00:00:00Z`) / 1000;
}

export function toDate(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

// Month names inside a year, the year alone over several years, and the day within a month.
// A label too close to an edge of the plot would be cut off, so it is left out.
function dateTicks(locale) {
  const EDGE_PIXELS = 20;

  return (chart, ticks) => {
    if (ticks.length === 0) {
      return [];
    }

    const spanDays = (ticks.at(-1) - ticks[0]) / DAY_SECONDS;
    const plotWidth = chart.bbox.width / uPlot.pxRatio;

    return ticks.map((tick) => {
      const position = chart.valToPos(tick, 'x');

      if (position < EDGE_PIXELS || plotWidth - position < EDGE_PIXELS) {
        return null;
      }

      const date = new Date(tick * 1000);
      const month = formatMonthName(date.getUTCFullYear(), date.getUTCMonth() + 1, locale);

      if (spanDays > 2 * 365) {
        return date.getUTCMonth() === 0 ? String(date.getUTCFullYear()) : null;
      }

      if (spanDays > 75) {
        return date.getUTCMonth() === 0 ? `${month} ${date.getUTCFullYear()}` : month;
      }

      return `${date.getUTCDate()} ${month}`;
    });
  };
}

function dateAxis(locale, show) {
  return {
    show,
    stroke: () => cssColor('--muted'),
    grid: { show: false },
    ticks: { show: false },
    border: { show: true, stroke: () => cssColor('--rule-strong'), width: 1 },
    font: `11px ${cssColor('--sans')}`,
    values: dateTicks(locale),
    space: 56,
    size: 22,
    gap: 4,
  };
}

const TICK_STEPS = [1, 2, 5, 10];
const TICK_SPACE_PIXELS = 56;

// Round values between `min` and `max`, about one per `TICK_SPACE_PIXELS` of height.
function roundTicks(min, max, heightPixels) {
  const rawStep = (max - min) / Math.max(2, Math.round(heightPixels / TICK_SPACE_PIXELS));
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = TICK_STEPS.map((factor) => factor * magnitude).find((candidate) => candidate >= rawStep);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const ticks = [];

  for (let tick = Math.ceil(min / step) * step; tick <= max; tick += step) {
    ticks.push(Number(tick.toFixed(decimals)));
  }

  return { ticks, decimals };
}

// The value axis sits inside the plot: each label is right-aligned at the plot's edge, just above its gridline.
// `valueFormatter` gets a value and the decimals its step needs. When `percentBase()` gives a number, the ticks are
// round percents of that base instead, so a chart of rebased lines reads in percent.
export function axes(valueFormatter, locale, { showDates = true, percentBase = () => null } = {}) {
  const font = `11px ${cssColor('--sans')}`;
  let decimals = 0;

  return [
    dateAxis(locale, showDates),
    {
      side: 1,
      size: 0,
      gap: -6,
      align: 2,
      lineGap: -0.62,
      stroke: () => cssColor('--muted'),
      grid: { stroke: () => cssColor('--rule'), width: 1 },
      ticks: { show: false },
      font,
      splits: (chart, _axis, min, max) => {
        const heightPixels = chart.bbox.height / uPlot.pxRatio;
        const base = percentBase();

        if (base === null) {
          const rounded = roundTicks(min, max, heightPixels);

          decimals = rounded.decimals;

          return rounded.ticks;
        }

        const rounded = roundTicks((min / base - 1) * 100, (max / base - 1) * 100, heightPixels);

        decimals = rounded.decimals;

        return rounded.ticks.map((percent) => base * (1 + percent / 100));
      },
      // The leading line break puts the label on the line above its gridline.
      values: (_, values) => values.map((value) => `\n${percentBase() === null ? valueFormatter(value, decimals) : formatChange(value / percentBase() - 1, locale, decimals)}`),
    },
  ];
}

export function chartHeight(base) {
  return window.matchMedia('(max-width: 640px)').matches ? Math.round(base * 0.72) : base;
}

// The tooltip belongs to the chart under the pointer; the other chart only shows its synced crosshair.
export function attachTooltip(chart, container, renderTooltip) {
  const tip = document.createElement('div');
  let hovering = false;

  tip.className = 'chart-tip';
  tip.hidden = true;
  // A chart redrawn in the same container leaves its old tip behind, since uPlot only removes its own root.
  container.querySelector('.chart-tip')?.remove();
  container.append(tip);

  chart.over.addEventListener('mouseenter', () => {
    hovering = true;
  });

  chart.over.addEventListener('mouseleave', () => {
    hovering = false;
    tip.hidden = true;
  });

  return () => {
    const index = chart.cursor.idx;

    if (!hovering || index === null || index === undefined) {
      tip.hidden = true;

      return;
    }

    tip.innerHTML = tightenSeparators(renderTooltip(index));
    tip.hidden = false;

    const left = chart.cursor.left + chart.over.offsetLeft;
    const flip = left + tip.offsetWidth + 16 > container.clientWidth;

    tip.style.left = `${Math.max(flip ? left - tip.offsetWidth - 10 : left + 10, 0)}px`;
    tip.style.top = `${chart.over.offsetTop + 4}px`;
  };
}

export function observeWidth(chart, container, height) {
  new ResizeObserver(() => {
    chart.setSize({ width: container.clientWidth, height: height() });
  }).observe(container);
}

// The monthly asset mix is drawn by the server; this adds a tooltip with the shares of the month under the pointer.
export function mountMixTooltip(figure) {
  const svg = figure.querySelector('svg');
  const columns = [...svg.querySelectorAll('[data-tip]')];
  const tip = document.createElement('div');
  let active = null;

  tip.className = 'chart-tip';
  tip.hidden = true;
  figure.append(tip);

  function show(event) {
    const bounds = svg.getBoundingClientRect();
    const index = Math.min(columns.length - 1, Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * columns.length)));

    if (columns[index] !== active) {
      active?.classList.remove('is-active');
      active = columns[index];
      active.classList.add('is-active');
      tip.innerHTML = tightenSeparators(active.dataset.tip);
    }

    tip.hidden = false;

    const left = event.clientX - figure.getBoundingClientRect().left;
    const flip = left + tip.offsetWidth + 16 > figure.clientWidth;

    tip.style.left = `${Math.max(flip ? left - tip.offsetWidth - 10 : left + 10, 0)}px`;
    tip.style.top = `${svg.offsetTop}px`;
  }

  function hide() {
    active?.classList.remove('is-active');
    active = null;
    tip.hidden = true;
  }

  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}

const swatch = (color) => `<i class="key-box" style="background: ${color}"></i>`;

// `includeToggle` is the page's "Include dividends" checkbox, present only for a fund with dividends.
export async function mountFundCharts(symbol, includeToggle) {
  const locale = document.documentElement.lang;

  setLocale(locale, { reload: false });

  const navContainer = document.getElementById('nav-chart');
  const aumContainer = document.getElementById('aum-chart');
  const rangeButtons = [...document.querySelectorAll('[data-range]')];
  const readout = document.getElementById('range-readout');

  const fund = await fetchFundRecord(symbol);

  if (fund === null) {
    const message = document.getElementById('chart-error');

    message.textContent = m.chart_load_failed();
    message.hidden = false;

    for (const button of rangeButtons) {
      button.disabled = true;
    }

    return;
  }

  const navHistory = pickNavHistory(fund);
  const events = dividendEvents(fund, navHistory);
  const totalHistory = includeToggle && events.length > 0 ? withDividendsReinvested(navHistory, events) : null;
  const aumHistory = pickAumHistory(fund);
  const aumCurrency = aumHistory.points.at(-1)?.currency ?? null;
  const chosenHistory = () => (totalHistory && includeToggle.checked ? totalHistory : navHistory);
  const sync = { key: `fund-${symbol}` };
  let history = chosenHistory();
  let points = history.points;
  let data = null;
  let range = DEFAULT_RANGE;
  let startIndex = 0;
  let navChart = null;
  let aumChart = null;
  // An index drawn over the NAV, chosen with the "Compare with" pills. Its levels load on first use.
  const benchmarkButtons = [...document.querySelectorAll('[data-benchmark]')];
  const benchmarkError = document.getElementById('benchmark-error');
  const benchmarks = new Map(JSON.parse(navContainer?.closest('.chart-card').dataset.benchmarks ?? '[]').map((benchmark) => [benchmark.id, benchmark]));
  const benchmarkLevels = new Map();
  let benchmarkId = '';

  const hasBenchmarkLine = () => benchmarkId !== '' && data[2].at(-1) !== null;
  const benchmarkColor = () => cssColor(benchmarks.get(benchmarkId)?.color ?? '--series-2');
  const hasAumChart = aumContainer !== null && aumHistory.points.length >= 2;

  // The page leaves out a chart it has no data for, so a missing container means there is nothing to draw.
  if (navContainer && points.length >= 2) {
    data = [points.map((point) => toSeconds(point.date)), points.map((point) => point.value), points.map(() => null)];

    // The dates are written under the size chart when there is one, so the two read as one figure.
    navChart = new uPlot(
      {
        width: navContainer.clientWidth,
        height: chartHeight(PRICE_HEIGHT),
        padding: [8, 0, 0, 0],
        legend: { show: false },
        cursor: {
          sync,
          points: { size: 6, width: 1.5, stroke: () => cssColor('--surface'), fill: (_, seriesIndex) => (seriesIndex === 1 ? cssColor('--accent') : benchmarkColor()) },
          drag: { x: false, y: false },
        },
        scales: { x: { time: true } },
        series: [
          {},
          {
            label: m.chart_series_nav(),
            stroke: () => cssColor('--accent'),
            width: 1.5,
            fill: (chart) => {
              const gradient = chart.ctx.createLinearGradient(0, chart.bbox.top, 0, chart.bbox.top + chart.bbox.height);

              gradient.addColorStop(0, withAlpha(cssColor('--accent'), 0.12));
              gradient.addColorStop(1, withAlpha(cssColor('--accent'), 0));

              return gradient;
            },
            points: { show: false },
          },
          { label: m.chart_compare_with(), show: false, stroke: () => benchmarkColor(), width: 1.25, points: { show: false } },
        ],
        axes: axes((value, decimals) => (value >= 100000 ? formatCompact(value, locale) : formatNumber(value, locale, decimals, decimals)), locale, {
          showDates: !hasAumChart,
          percentBase: () => (hasBenchmarkLine() ? points[startIndex].value : null),
        }),
        tzDate: (seconds) => uPlot.tzDate(new Date(seconds * 1000), 'UTC'),
        hooks: {
          // A hairline at the range's starting NAV shows at a glance whether the fund is above or below it.
          draw: [
            (chart) => {
              const startValue = points[startIndex]?.value;

              if (startValue === undefined) {
                return;
              }

              const y = Math.round(chart.valToPos(startValue, 'y', true)) + 0.5;
              const { ctx, bbox } = chart;

              ctx.save();
              ctx.strokeStyle = cssColor('--rule-strong');
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(bbox.left, y);
              ctx.lineTo(bbox.left + bbox.width, y);
              ctx.stroke();
              ctx.restore();
            },
          ],
          setCursor: [],
        },
      },
      data,
      navContainer,
    );

    const updateNavTip = attachTooltip(navChart, navContainer, (index) => {
      const value = data[1][index];
      const change = value / points[startIndex].value - 1;
      const benchmarkValue = data[2][index];
      const benchmarkChange = benchmarkValue === null ? null : benchmarkValue / points[startIndex].value - 1;
      const benchmarkRow =
        benchmarkChange === null
          ? ''
          : `<div class="tip-row">${swatch(benchmarkColor())}<span class="tip-label">${escapeHtml(benchmarks.get(benchmarkId).shortName)}</span><span class="tip-change ${changeClass(benchmarkChange)}">${formatChange(benchmarkChange, locale)}</span></div>`;

      return `<div class="tip-date">${formatDate(toDate(data[0][index]), locale)}</div>
        <div class="tip-row">${swatch('var(--accent)')}<span class="tip-label">${escapeHtml(m.chart_series_nav())}</span><b>${formatNav(value, locale)}</b><span class="tip-change ${changeClass(change)}">${formatChange(change, locale)}</span></div>
        ${benchmarkRow}
        <div class="tip-note">${escapeHtml(m.chart_tip_since({ date: formatDate(points[startIndex].date, locale) }))}</div>`;
    });

    navChart.hooks.setCursor.push(updateNavTip);
    observeWidth(navChart, navContainer, () => chartHeight(PRICE_HEIGHT));
  }

  if (hasAumChart) {
    const aumData = [aumHistory.points.map((point) => toSeconds(point.date)), aumHistory.points.map((point) => point.value)];

    aumChart = new uPlot(
      {
        width: aumContainer.clientWidth,
        height: AUM_HEIGHT,
        padding: [6, 0, 0, 0],
        legend: { show: false },
        cursor: { sync, points: { show: false }, drag: { x: false, y: false } },
        scales: { x: { time: true }, y: { range: (_, __, max) => [0, max * 1.05] } },
        series: [
          {},
          {
            label: m.figure_aum(),
            fill: () => withAlpha(cssColor('--soga'), 0.7),
            paths: uPlot.paths.bars({ size: [1, 40], gap: 1 }),
            points: { show: false },
          },
        ],
        axes: [dateAxis(locale, true), { show: false }],
        tzDate: (seconds) => uPlot.tzDate(new Date(seconds * 1000), 'UTC'),
        hooks: { setCursor: [] },
      },
      aumData,
      aumContainer,
    );

    const updateAumTip = attachTooltip(aumChart, aumContainer, (index) => `<div class="tip-date">${formatMonth(toDate(aumData[0][index]), locale)}</div>
      <div class="tip-row">${swatch('var(--soga)')}<span class="tip-label">${escapeHtml(m.figure_aum())}</span><b>${escapeHtml(formatMoney(aumData[1][index], locale, aumCurrency))}</b></div>`);

    aumChart.hooks.setCursor.push(updateAumTip);
    observeWidth(aumChart, aumContainer, () => AUM_HEIGHT);
  }

  function applyRange(chosenRange) {
    if (!navChart) {
      return;
    }

    range = chosenRange;

    startIndex = periodStartIndex(history, RANGE_PERIODS[range]);

    const end = points.at(-1);
    const start = points[startIndex];
    const min = toSeconds(start.date);
    const max = toSeconds(end.date);
    const change = end.value / start.value - 1;

    const levels = benchmarkLevels.get(benchmarkId);

    data[2] = levels ? rebaseBenchmark(points, levels, startIndex) : points.map(() => null);

    const benchmarkEnd = data[2].at(-1);
    const hasBenchmark = benchmarkEnd !== null;
    const benchmarkChange = hasBenchmark ? benchmarkEnd / start.value - 1 : null;

    if (levels) {
      benchmarkError.hidden = hasBenchmark;
      benchmarkError.textContent = hasBenchmark ? '' : m.benchmark_no_range();
    }

    readout.innerHTML = tightenSeparators(`<b class="${changeClass(change)}">${formatChange(change, locale)}</b> <span class="muted">${formatDate(start.date, locale)} – ${formatDate(end.date, locale)}</span>${
      hasBenchmark ? ` <span class="benchmark-readout">${swatch(benchmarkColor())}${escapeHtml(benchmarks.get(benchmarkId).shortName)} <b class="${changeClass(benchmarkChange)}">${formatChange(benchmarkChange, locale)}</b></span>` : ''
    }`);
    navChart.setSeries(2, { show: hasBenchmark });
    navChart.setData(data);

    // On "All" the size chart keeps its own full history, which can start or end outside the NAV's, so both charts
    // show the stretch that holds either, and their dates stay in line.
    const aumDates = aumChart?.data[0];
    const xMin = range === 'All' && aumChart ? Math.min(min, aumDates[0]) : min;
    const xMax = range === 'All' && aumChart ? Math.max(max, aumDates.at(-1)) : max;

    navChart.setScale('x', { min: xMin, max: xMax });
    aumChart?.setScale('x', { min: xMin, max: xMax });

    for (const button of rangeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.range === range));
    }
  }

  // A range is offered only when the history being drawn reaches back that far.
  const disableUnavailableRanges = () => {
    for (const button of rangeButtons) {
      button.disabled = periodStartIndex(history, RANGE_PERIODS[button.dataset.range]) < 0;
    }
  };

  if (navChart) {
    disableUnavailableRanges();

    for (const button of rangeButtons) {
      button.addEventListener('click', () => applyRange(button.dataset.range));
    }

    applyRange(periodStartIndex(history, RANGE_PERIODS[DEFAULT_RANGE]) < 0 ? 'All' : DEFAULT_RANGE);

    for (const button of benchmarkButtons) {
      button.addEventListener('click', async () => {
        const chosenId = button.dataset.benchmark;

        benchmarkId = chosenId;
        benchmarkError.hidden = true;

        for (const other of benchmarkButtons) {
          other.setAttribute('aria-pressed', String(other === button));
        }

        if (chosenId !== '' && !benchmarkLevels.has(chosenId)) {
          const series = await getJson(`/api/benchmarks/${encodeURIComponent(chosenId)}.json`);

          if (benchmarkId !== chosenId) {
            return;
          }

          if (series === null) {
            benchmarkId = '';
            benchmarkError.textContent = m.benchmark_load_failed();
            benchmarkError.hidden = false;

            for (const other of benchmarkButtons) {
              other.setAttribute('aria-pressed', String(other.dataset.benchmark === ''));
            }
          } else {
            benchmarkLevels.set(chosenId, series.points);
          }
        }

        applyRange(range);
      });
    }

    // The total return starts where the primary history does, which can be later than the NAV history, so it
    // brings its own dates and its own ranges.
    includeToggle?.addEventListener('change', () => {
      history = chosenHistory();
      points = history.points;
      data[0] = points.map((point) => toSeconds(point.date));
      data[1] = points.map((point) => point.value);
      disableUnavailableRanges();
      applyRange(periodStartIndex(history, RANGE_PERIODS[range]) < 0 ? 'All' : range);
    });
  }

  const redrawCharts = () => {
    navChart?.redraw(false);
    aumChart?.redraw(false);
  };

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawCharts);
  window.addEventListener('themechange', redrawCharts);
}

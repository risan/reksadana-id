import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import * as m from '../paraglide/messages.js';
import { setLocale } from '../paraglide/runtime.js';
import { changeClass, formatChange, formatCompact, formatDate, formatMoney, formatMonth, formatMonthName, formatNav, formatNumber } from './format.js';
import { dividendEvents, periodStartIndex, pickAumHistory, pickNavHistory, withDividendsReinvested } from './series.js';

const RANGE_PERIODS = { '1M': '1m', '3M': '3m', '6M': '6m', YTD: 'ytd', '1Y': '1y', '3Y': '3y', '5Y': '5y', All: 'all' };
const DEFAULT_RANGE = '1Y';
const DAY_SECONDS = 24 * 60 * 60;

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

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function dateTicks(locale) {
  return (_, ticks) => {
    if (ticks.length === 0) {
      return [];
    }

    const spanDays = (ticks.at(-1) - ticks[0]) / DAY_SECONDS;

    return ticks.map((tick) => {
      const date = new Date(tick * 1000);
      const month = formatMonthName(date.getUTCFullYear(), date.getUTCMonth() + 1, locale);

      if (spanDays > 3 * 365) {
        return String(date.getUTCFullYear());
      }

      if (spanDays > 75) {
        return date.getUTCMonth() === 0 ? `${month} ${date.getUTCFullYear()}` : month;
      }

      return `${date.getUTCDate()} ${month}`;
    });
  };
}

export function axes(valueFormatter, locale) {
  const grid = { stroke: () => cssColor('--rule'), width: 1 };
  const ticks = { show: false };
  const font = '11.5px "Schibsted Grotesk Variable", sans-serif';

  return [
    { stroke: () => cssColor('--muted'), grid: { show: false }, ticks: { show: true, stroke: () => cssColor('--rule-strong'), width: 1, size: 4 }, font, values: dateTicks(locale), space: 64, gap: 4 },
    { side: 1, stroke: () => cssColor('--muted'), grid, ticks, font, size: 64, gap: 6, values: (_, values) => values.map(valueFormatter) },
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

    tip.innerHTML = renderTooltip(index);
    tip.hidden = false;

    const left = chart.cursor.left + chart.over.offsetLeft;
    const flip = left + tip.offsetWidth + 16 > container.clientWidth;

    tip.style.left = `${flip ? left - tip.offsetWidth - 10 : left + 10}px`;
    tip.style.top = `${chart.over.offsetTop + 4}px`;
  };
}

export function observeWidth(chart, container, baseHeight) {
  new ResizeObserver(() => {
    chart.setSize({ width: container.clientWidth, height: chartHeight(baseHeight) });
  }).observe(container);
}

// `includeToggle` is the page's "Include dividends" checkbox, present only for a fund with dividends.
export async function mountFundCharts(symbol, includeToggle) {
  const locale = document.documentElement.lang;

  setLocale(locale, { reload: false });

  const navContainer = document.getElementById('nav-chart');
  const aumContainer = document.getElementById('aum-chart');
  const rangeButtons = [...document.querySelectorAll('[data-range]')];
  const readout = document.getElementById('range-readout');

  const fund = await (await fetch(`/api/funds/${encodeURIComponent(symbol)}.json`)).json();
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

  if (points.length < 2) {
    document.getElementById('nav-empty').hidden = false;

    for (const button of rangeButtons) {
      button.disabled = true;
      button.setAttribute('aria-pressed', 'false');
    }
  } else {
    data = [points.map((point) => toSeconds(point.date)), points.map((point) => point.value)];

    navChart = new uPlot(
      {
        width: navContainer.clientWidth,
        height: chartHeight(300),
        padding: [8, 0, 0, 16],
        legend: { show: false },
        cursor: { sync, points: { size: 7, width: 2, fill: () => cssColor('--paper') }, drag: { x: false, y: false } },
        scales: { x: { time: true } },
        series: [
          {},
          { label: m.chart_series_nav(), stroke: () => cssColor('--ink'), width: 1.6, fill: () => withAlpha(cssColor('--ink'), 0.05) },
        ],
        axes: axes((value) => (value >= 100000 ? formatCompact(value, locale) : formatNumber(value, locale, value < 10 ? 4 : 2)), locale),
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

      return `<div class="tip-date">${formatDate(toDate(data[0][index]), locale)}</div>
        <div class="tip-row"><b>${formatNav(value, locale)}</b><span class="${changeClass(change)}">${formatChange(change, locale)}</span></div>
        <div class="tip-note">${escapeHtml(m.chart_tip_since({ date: formatDate(points[startIndex].date, locale) }))}</div>`;
    });

    navChart.hooks.setCursor.push(updateNavTip);
    observeWidth(navChart, navContainer, 300);
  }

  if (aumHistory.points.length < 2) {
    document.getElementById('aum-empty').hidden = false;
  } else {
    const aumData = [aumHistory.points.map((point) => toSeconds(point.date)), aumHistory.points.map((point) => point.value)];

    aumChart = new uPlot(
      {
        width: aumContainer.clientWidth,
        height: chartHeight(130),
        padding: [6, 0, 0, 16],
        legend: { show: false },
        cursor: { sync, points: { show: false }, drag: { x: false, y: false } },
        scales: { x: { time: true }, y: { range: (_, __, max) => [0, max * 1.05] } },
        series: [
          {},
          { label: m.figure_aum(), stroke: () => cssColor('--ink-2'), fill: () => withAlpha(cssColor('--ink-2'), 0.1), width: 1.4, points: { show: false } },
        ],
        axes: axes((value) => formatCompact(value, locale), locale),
        tzDate: (seconds) => uPlot.tzDate(new Date(seconds * 1000), 'UTC'),
        hooks: { setCursor: [] },
      },
      aumData,
      aumContainer,
    );

    const updateAumTip = attachTooltip(aumChart, aumContainer, (index) => `<div class="tip-date">${formatMonth(toDate(aumData[0][index]), locale)}</div>
      <div class="tip-row"><b>${escapeHtml(formatMoney(aumData[1][index], locale, aumCurrency))}</b></div>`);

    aumChart.hooks.setCursor.push(updateAumTip);
    observeWidth(aumChart, aumContainer, 130);
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

    readout.innerHTML = `<b class="${changeClass(change)}">${formatChange(change, locale)}</b> <span class="muted">${formatDate(start.date, locale)} – ${formatDate(end.date, locale)}</span>`;
    navChart.setScale('x', { min, max });

    if (aumChart) {
      const aumDates = aumChart.data[0];

      // On "All" the size chart keeps its own full history, which can start or end outside the NAV's.
      aumChart.setScale('x', range === 'All' ? { min: Math.min(min, aumDates[0]), max: Math.max(max, aumDates.at(-1)) } : { min, max });
    }

    for (const button of rangeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.range === range));
    }
  }

  if (navChart) {
    for (const button of rangeButtons) {
      button.disabled = periodStartIndex(history, RANGE_PERIODS[button.dataset.range]) < 0;
      button.addEventListener('click', () => applyRange(button.dataset.range));
    }

    applyRange(periodStartIndex(history, RANGE_PERIODS[DEFAULT_RANGE]) < 0 ? 'All' : DEFAULT_RANGE);

    // Both histories share their dates, so the range buttons and the x axis stay as they are.
    includeToggle?.addEventListener('change', () => {
      history = chosenHistory();
      points = history.points;
      data[1] = points.map((point) => point.value);
      navChart.setData(data);
      applyRange(range);
    });
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    navChart?.redraw(false);
    aumChart?.redraw(false);
  });
}

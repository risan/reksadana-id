// The browser side of the compare page: picker, selection in the URL, chart, and table.
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import * as m from '../paraglide/messages.js';
import { setLocale } from '../paraglide/runtime.js';
import { CHART_RANGES, MAX_FUNDS, MIN_FUNDS, analyzeFunds, chartRange, costsOf, indexedSeries, resolveSelection, returnsAtCommonEnd, selectionQuery, selectionText } from './compare.js';
import { readTrayText, writeTray } from './compare-tray.js';
import { DEFAULT_STATE, escapeHtml, filterFunds, prepareFunds, sortFunds } from './explorer.js';
import { attachTooltip, axes, chartHeight, cssColor, toSeconds } from './fund-charts.js';
import { changeClass, currencyPrefix, formatChange, formatDate, formatMoney, formatMonth, formatNav, formatNumber, formatPercent } from './format.js';
import { typeName } from './fund-types.js';
import { anchor, localizeHref } from './i18n.js';
import { indexAtOrBefore, pickNavHistory } from './series.js';

const PICKER_RESULT_LIMIT = 8;
const RETURN_PERIODS = ['1m', 'ytd', '1y', '3y', '5y'];
const CAGR_PERIODS = ['3y', '5y'];
const DRAWDOWN_PERIODS = ['1y', '3y'];
const DEFAULT_RANGE = '1y';
const CHART_HEIGHT = 320;

const FEE_LABELS = {
  subscription: () => m.detail_fee_subscription(),
  redemption: () => m.detail_fee_redemption(),
  switch: () => m.detail_fee_switch(),
};

async function getJson(url) {
  try {
    const response = await fetch(url);

    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function mountComparePage() {
  const locale = document.documentElement.lang;

  setLocale(locale, { reload: false });

  const periodLabels = { '1m': m.period_1m(), '6m': m.period_6m(), ytd: m.period_ytd(), '1y': m.period_1y(), '3y': m.period_3y(), '5y': m.period_5y(), all: m.period_all() };
  const pickerInput = document.getElementById('picker-input');
  const pickerResults = document.getElementById('picker-results');
  const pickerNote = document.getElementById('picker-note');
  const notices = document.getElementById('compare-notices');
  const emptyState = document.getElementById('compare-empty');
  const chartSection = document.getElementById('compare-chart-section');
  const chartContainer = document.getElementById('compare-chart');
  const chartMessage = document.getElementById('chart-message');
  const chartStart = document.getElementById('chart-start');
  const legend = document.getElementById('compare-legend');
  const rangeButtons = [...document.querySelectorAll('[data-range]')];
  const tableSection = document.getElementById('compare-table-section');
  const table = document.getElementById('compare-table');
  const tableEnd = document.getElementById('table-end');

  const explorerData = await getJson('/explorer.json');

  if (explorerData === null) {
    pickerNote.textContent = m.compare_picker_failed();
    emptyState.hidden = true;

    return;
  }

  const funds = prepareFunds(explorerData);
  const fundsById = new Map(funds.map((fund) => [fund.id, fund]));
  const retiredIds = (await getJson('/fund-ids.json')) ?? {};
  const { ids: initialIds, dropped } = resolveSelection(selectionText(location.search, readTrayText()), { knownIds: new Set(fundsById.keys()), retiredIds });

  const loaded = new Map();
  let ids = initialIds;
  let chosenRange = DEFAULT_RANGE;
  let chart = null;

  const fundName = (id) => fundsById.get(id).name;
  const fundHref = (id) => localizeHref(`/funds/${encodeURIComponent(id)}/`, locale);
  const keyHtml = (slot) => `<i class="key-line" style="background: var(--series-${slot + 1})"></i>`;
  const missing = '<span class="nil">&mdash;</span>';
  const notInSources = `<span class="nil">${escapeHtml(m.compare_not_in_sources())}</span>`;

  async function load(id) {
    if (loaded.has(id)) {
      return;
    }

    loaded.set(id, { status: 'loading' });

    const record = await getJson(`/api/funds/${encodeURIComponent(id)}.json`);

    loaded.set(id, record === null ? { status: 'failed' } : { status: 'ready', record, history: pickNavHistory(record) });
    render();
  }

  function commit() {
    writeTray(ids);
    history.replaceState(null, '', `${location.pathname}${selectionQuery(ids)}`);

    for (const id of ids) {
      load(id);
    }

    render();
    renderPicker();
  }

  function renderPicker() {
    const query = pickerInput.value.trim();
    const isFull = ids.length >= MAX_FUNDS;

    pickerNote.textContent = isFull ? m.compare_full({ count: MAX_FUNDS }) : '';

    if (query === '') {
      pickerResults.hidden = true;
      pickerResults.innerHTML = '';

      return;
    }

    const matches = sortFunds(filterFunds(funds, { ...DEFAULT_STATE, q: query, inactive: true }), 'aum', -1).slice(0, PICKER_RESULT_LIMIT);

    pickerResults.hidden = false;
    pickerResults.innerHTML =
      matches.length === 0
        ? `<li class="nil">${escapeHtml(m.compare_no_match())}</li>`
        : matches
            .map((fund) => {
              const isSelected = ids.includes(fund.id);

              return `<li><span><b>${escapeHtml(fund.name)}</b><span class="sub">${escapeHtml(fund.manager ?? m.unknown_manager())} · <span class="mono">${escapeHtml(fund.id)}</span>${fund.active ? '' : ` · ${escapeHtml(m.tag_inactive())}`}</span></span><button type="button" class="btn" data-add="${escapeHtml(fund.id)}"${isSelected || isFull ? ' disabled' : ''}>${escapeHtml(isSelected ? m.compare_added() : m.compare_add())}</button></li>`;
            })
            .join('');
  }

  function exclusionNotice({ id, reason, date }) {
    const name = fundName(id);

    if (reason === 'stale') {
      return m.compare_excluded_stale({ name, date: formatDate(date, locale) });
    }

    if (reason === 'gap') {
      return m.compare_excluded_gap({ name, date: formatDate(date, locale) });
    }

    return m.compare_excluded_no_history({ name });
  }

  function renderLegend(analysis) {
    legend.innerHTML = analysis.eligible.map((entry) => `<li>${keyHtml(ids.indexOf(entry.id))} ${escapeHtml(fundName(entry.id))}</li>`).join('');
  }

  function rangeFor(ranges) {
    return [chosenRange, DEFAULT_RANGE, ...CHART_RANGES].find((period) => ranges[period]) ?? null;
  }

  function drawChart(analysis, period, range) {
    chart?.destroy();

    const { dates, series } = indexedSeries(analysis, range);
    const data = [dates.map(toSeconds), ...series.map((one) => one.values)];
    const valueAt = (seriesIndex, dateIndex) => {
      const entry = analysis.eligible[seriesIndex];
      const startIndex = range.startIndexById[entry.id];
      const pointIndex = indexAtOrBefore(entry.history.points, dates[dateIndex]);

      if (pointIndex < startIndex) {
        return null;
      }

      const point = entry.history.points[pointIndex];

      return { index: (point.value / entry.history.points[startIndex].value) * 100, date: point.date };
    };

    chart = new uPlot(
      {
        width: chartContainer.clientWidth,
        height: chartHeight(CHART_HEIGHT),
        padding: [8, 0, 0, 16],
        legend: { show: false },
        cursor: { points: { size: 7, width: 2, fill: () => cssColor('--paper') }, drag: { x: false, y: false } },
        scales: {
          x: { time: true },
          y: {
            range: (_, low, high) => {
              const lower = Math.min(low, 100);
              const upper = Math.max(high, 100);
              const padding = (upper - lower) * 0.08 || 1;

              return [lower - padding, upper + padding];
            },
          },
        },
        series: [
          {},
          ...analysis.eligible.map((entry) => ({ label: entry.id, stroke: () => cssColor(`--series-${ids.indexOf(entry.id) + 1}`), width: 1.6, spanGaps: true, points: { show: false } })),
        ],
        axes: axes((value) => formatNumber(value, locale, 0), locale),
        tzDate: (seconds) => uPlot.tzDate(new Date(seconds * 1000), 'UTC'),
        hooks: {
          // The hairline at 100 shows which funds are above or below where they all started.
          draw: [
            (plot) => {
              const y = Math.round(plot.valToPos(100, 'y', true)) + 0.5;
              const { ctx, bbox } = plot;

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
      chartContainer,
    );

    chart.setScale('x', { min: toSeconds(range.startDate), max: toSeconds(analysis.commonEnd) });

    const updateTooltip = attachTooltip(chart, chartContainer, (dateIndex) => {
      const rows = analysis.eligible
        .map((entry, seriesIndex) => {
          const value = valueAt(seriesIndex, dateIndex);

          return `<div class="tip-row">${keyHtml(ids.indexOf(entry.id))}<b>${escapeHtml(fundName(entry.id))}</b><span>${value === null ? '&mdash;' : formatNumber(value.index, locale, 1, 1)}</span></div>
            ${value === null ? '' : `<div class="tip-note">${escapeHtml(m.compare_tip_date({ date: formatDate(value.date, locale) }))}</div>`}`;
        })
        .join('');

      return `<div class="tip-date">${formatDate(dates[dateIndex], locale)}</div>${rows}`;
    });

    chart.hooks.setCursor.push(updateTooltip);
    chartStart.textContent = m.compare_chart_start({ start: formatDate(range.startDate, locale), end: formatDate(analysis.commonEnd, locale) });

    for (const button of rangeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.range === period));
    }
  }

  function renderChart(analysis) {
    const ranges = Object.fromEntries(CHART_RANGES.map((period) => [period, analysis.eligible.length < MIN_FUNDS ? null : chartRange(period, analysis)]));
    const period = rangeFor(ranges);

    for (const button of rangeButtons) {
      button.disabled = ranges[button.dataset.range] === null;
      button.title = button.disabled ? m.compare_range_unavailable() : '';
    }

    chart?.destroy();
    chart = null;
    chartStart.textContent = '';
    legend.innerHTML = '';

    if (analysis.eligible.length < MIN_FUNDS || period === null) {
      chartMessage.textContent = analysis.eligible.length < MIN_FUNDS ? m.compare_chart_few() : m.compare_chart_none();
      chartMessage.hidden = false;
      chartContainer.hidden = true;

      return;
    }

    chartMessage.hidden = true;
    chartContainer.hidden = false;
    renderLegend(analysis);
    drawChart(analysis, period, ranges[period]);
  }

  function costRows(column) {
    if (column.status !== 'ready') {
      return { expense: missing, minimum: missing, fees: missing, custodian: missing };
    }

    const costs = costsOf(column.record);
    const currency = column.fund.currency;
    const lines = (items) => (items.length === 0 ? notInSources : items.map((item) => `<div>${item}</div>`).join(''));

    return {
      expense: costs.expenseRatio === null ? notInSources : formatPercent(costs.expenseRatio, locale),
      minimum: lines(costs.minPurchases.map((purchase) => `${escapeHtml(purchase.distributor)} <span class="mono">${currencyPrefix(currency)} ${formatNumber(purchase.amount, locale)}</span>`)),
      fees: lines(costs.maxFees.map(([kind, value]) => `${escapeHtml(FEE_LABELS[kind]())} ${formatPercent(value, locale)}`)),
      custodian: costs.custodian === null ? notInSources : escapeHtml(costs.custodian),
    };
  }

  function renderTable(analysis) {
    const eligibleById = new Map(analysis?.eligible.map((entry) => [entry.id, entry]));
    const columns = ids.map((id, slot) => {
      const entry = loaded.get(id) ?? { status: 'loading' };
      const returns = eligibleById.has(id) ? returnsAtCommonEnd(eligibleById.get(id), analysis.commonEnd) : null;

      return { id, slot, fund: fundsById.get(id), returns, inChart: eligibleById.has(id), ...entry };
    });

    const headCell = (column) => {
      const state =
        column.status === 'loading'
          ? `<div class="sub">${escapeHtml(m.compare_loading())}</div>`
          : column.status === 'failed'
            ? `<div class="sub down">${escapeHtml(m.compare_load_failed())}</div>`
            : column.inChart
              ? ''
              : `<div class="sub"><span class="tag tag-quiet">${escapeHtml(m.compare_not_in_chart())}</span></div>`;

      return `<th scope="col" class="c-fund">
        <div class="col-head">${column.inChart ? keyHtml(column.slot) : ''}<a href="${fundHref(column.id)}">${escapeHtml(column.fund.name)}</a><button type="button" class="remove" data-remove="${escapeHtml(column.id)}" aria-label="${escapeHtml(m.compare_remove({ name: column.fund.name }))}">&times;</button></div>
        <div class="sub mono">${escapeHtml(column.id)}</div>${state}
      </th>`;
    };

    const group = (label) => `<tr class="group"><th colspan="${columns.length + 1}" scope="colgroup">${escapeHtml(label)}</th></tr>`;
    const row = (label, cell, { title = '', className = '' } = {}) => `<tr><th scope="row"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(label)}</th>${columns.map((column) => `<td class="${className}">${cell(column)}</td>`).join('')}</tr>`;
    const returnCell = (read, format, colored) => (column) => {
      const value = column.returns ? (read(column.returns) ?? null) : null;

      return value === null ? missing : `<span class="${colored ? changeClass(value) : ''}">${format(value, locale, 1)}</span>`;
    };
    const costs = new Map(columns.map((column) => [column.id, costRows(column)]));
    const buyOn = (column) =>
      [column.fund.bibit && '<span class="tag">Bibit</span>', column.fund.makmur && '<span class="tag">Makmur</span>'].filter(Boolean).join(' ') || missing;

    table.innerHTML = `<thead><tr><th scope="col"></th>${columns.map(headCell).join('')}</tr></thead>
      <tbody>
        ${group(m.compare_group_profile())}
        ${row(m.detail_type(), (column) => (column.fund.type ? escapeHtml(typeName(column.fund.type, locale)) : missing))}
        ${row(m.detail_manager(), (column) => (column.fund.manager ? escapeHtml(column.fund.manager) : missing))}
        ${row(m.detail_currency(), (column) => escapeHtml(column.fund.currency ?? m.detail_not_stated()))}
        ${row(m.detail_launched(), (column) => (column.status === 'ready' ? formatDate(column.record.fund.launch_date ?? column.record.released_date ?? null, locale) : missing))}
        ${row(m.compare_row_sharia(), (column) => escapeHtml(column.fund.sharia ? m.compare_yes() : m.compare_no()))}
        ${row(m.compare_row_nav(), (column) => `${formatNav(column.fund.nav, locale)}${column.fund.currency === 'USD' ? ' USD' : ''}<div class="sub">${formatDate(column.fund.nav_date, locale)}</div>`)}
        ${row(m.figure_aum(), (column) => `${formatMoney(column.fund.aum, locale, column.fund.currency)}<div class="sub">${column.fund.aum_date ? formatMonth(column.fund.aum_date, locale) : ''}</div>`)}
        ${analysis?.commonEnd ? group(m.compare_group_returns({ date: formatDate(analysis.commonEnd, locale) })) : ''}
        ${analysis ? RETURN_PERIODS.map((period) => row(`${m.returns_row_return()} ${periodLabels[period]}`, returnCell((returns) => returns.simplereturn[period], formatChange, true), { className: 'num' })).join('') : ''}
        ${analysis ? CAGR_PERIODS.map((period) => row(`${m.returns_row_per_year()} ${periodLabels[period]}`, returnCell((returns) => returns.cagr[period], formatChange, true), { title: m.returns_row_per_year_title(), className: 'num' })).join('') : ''}
        ${analysis ? DRAWDOWN_PERIODS.map((period) => row(`${m.returns_row_worst_fall()} ${periodLabels[period]}`, returnCell((returns) => returns.maxdrawdown[period], formatPercent, false), { title: m.returns_row_worst_fall_title(), className: 'num' })).join('') : ''}
        ${group(m.compare_group_costs())}
        ${row(m.detail_expense_ratio(), (column) => costs.get(column.id).expense)}
        ${row(m.compare_row_min_purchase(), (column) => costs.get(column.id).minimum)}
        ${row(m.compare_row_max_fees(), (column) => costs.get(column.id).fees)}
        ${row(m.detail_custodian(), (column) => costs.get(column.id).custodian)}
        ${row(m.col_buy(), buyOn)}
      </tbody>`;

    tableEnd.textContent = analysis?.commonEnd ? m.compare_returns_note({ date: formatDate(analysis.commonEnd, locale) }) : '';
  }

  function render() {
    const enough = ids.length >= MIN_FUNDS;
    const settled = ids.every((id) => loaded.get(id)?.status !== 'loading');
    const noticeLines = [];

    if (dropped.length > 0) {
      noticeLines.push(m.compare_dropped({ ids: dropped.join(', ') }));
    }

    emptyState.hidden = enough;
    emptyState.innerHTML = enough
      ? ''
      : `${m.compare_empty({ link: anchor(localizeHref('/', locale), escapeHtml(m.compare_empty_link())) })}${ids.map((id) => ` <span class="chosen">${escapeHtml(m.compare_selected_one({ name: fundName(id) }))} <button type="button" class="remove" data-remove="${escapeHtml(id)}" aria-label="${escapeHtml(m.compare_remove({ name: fundName(id) }))}">&times;</button></span>`).join('')}`;
    chartSection.hidden = !enough;
    tableSection.hidden = !enough;

    if (!enough) {
      chart?.destroy();
      chart = null;
      notices.innerHTML = noticeLines.map((line) => `<p class="notice">${escapeHtml(line)}</p>`).join('');

      return;
    }

    const analysis = settled ? analyzeFunds(ids.filter((id) => loaded.get(id).status === 'ready').map((id) => ({ id, history: loaded.get(id).history }))) : null;

    if (analysis) {
      noticeLines.push(...analysis.excluded.map(exclusionNotice));
      renderChart(analysis);
    } else {
      chartMessage.textContent = m.compare_loading();
      chartMessage.hidden = false;
      chartContainer.hidden = true;
    }

    notices.innerHTML = noticeLines.map((line) => `<p class="notice">${escapeHtml(line)}</p>`).join('');
    renderTable(analysis);
  }

  function addFund(id) {
    if (!ids.includes(id) && ids.length < MAX_FUNDS) {
      ids = [...ids, id];
      commit();
    }
  }

  function removeFund(id) {
    ids = ids.filter((selectedId) => selectedId !== id);
    commit();
  }

  pickerInput.addEventListener('input', renderPicker);
  pickerResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add]');

    if (button) {
      addFund(button.dataset.add);
    }
  });

  for (const container of [emptyState, table]) {
    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove]');

      if (button) {
        removeFund(button.dataset.remove);
      }
    });
  }

  for (const button of rangeButtons) {
    button.addEventListener('click', () => {
      chosenRange = button.dataset.range;
      render();
    });
  }

  new ResizeObserver(() => {
    chart?.setSize({ width: chartContainer.clientWidth, height: chartHeight(CHART_HEIGHT) });
  }).observe(chartContainer);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => chart?.redraw(false));

  commit();
}

// Shared chart builders for the PJM case study and the U.S. demand page.
import { Chart, registerables } from 'chart.js';
import { FUEL_COLOR, TIME, SECTOR_COLOR } from './fuels.js';
import { esc, nf0, nf1, pct, pp, ymLabel, ymIndex, sum } from './format.js';

Chart.register(...registerables);
Chart.defaults.font.family = "'Instrument Sans', system-ui, sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#3f5c68';
Chart.defaults.animation = false;
Object.assign(Chart.defaults.plugins.tooltip, {
  backgroundColor: '#15323d', titleColor: '#ffffff', bodyColor: '#e6eef0', cornerRadius: 8, padding: 10, boxPadding: 4,
  titleFont: { weight: '600' },
});

export const GRID = '#e6eef0';
export const INK = '#15323d';
const BOLD = "600 12px 'Instrument Sans', sans-serif";

export const f1 = (v) => Math.abs(v).toFixed(1);
export const sgn = (v) => `${v >= 0 ? '+' : '−'}${f1(v)}`;
export const dem = (x, y) => (100 * (y - x)) / x;
export const twhOf = (w) => w.twh ?? (w.avg_mw * w.hours) / 1e6;

export function table(headers, rows) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row" style="font-weight:500">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

// A figure that can show several views of the same data, plus a table. Each view is
// { id, label, note, legend, height, draw(canvas) -> Chart } or { id, label, note, table }.
export function figure(host, { title, lead = '', callout = '', views, foot }) {
  const el = document.createElement('section');
  el.className = 'fig';
  el.innerHTML = `<div class="fig__head"><h3>${esc(title)}</h3><p class="fig__note"></p></div>
    ${callout ? `<div class="callout" style="margin-top:14px">${callout}</div>` : ''}${lead}
    ${views.length > 1 ? `<div class="fig__bar"><div class="seg" role="group" aria-label="Choose a view">${views.map((v, i) => `<button type="button" data-v="${v.id}" aria-pressed="${i === 0}">${esc(v.label)}</button>`).join('')}</div></div>` : ''}
    <div class="fig__body"><div class="legend" hidden></div><div class="fig__canvas"><canvas role="img"></canvas></div><div class="fig__table" hidden></div></div>
    ${foot ? `<div class="fig__foot">${foot}</div>` : ''}`;
  host.appendChild(el);
  const box = el.querySelector('.fig__canvas'), cv = el.querySelector('canvas'), tb = el.querySelector('.fig__table'), lg = el.querySelector('.legend'), note = el.querySelector('.fig__note');
  let chart = null;
  function show(id) {
    const v = views.find((x) => x.id === id) || views[0];
    el.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v.id)));
    chart?.destroy(); chart = null;
    note.innerHTML = v.note || '';
    note.hidden = !v.note;
    if (v.table) {
      box.hidden = true; lg.hidden = true; tb.hidden = false; tb.innerHTML = v.table;
    } else {
      tb.hidden = true; box.hidden = false; box.style.height = `${v.height || 360}px`;
      lg.innerHTML = v.legend || ''; lg.hidden = !v.legend;
      cv.setAttribute('aria-label', `${title}: ${v.label}`);
      chart = v.draw(cv);
    }
  }
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) show(b.dataset.v); });
  show(views[0].id);
  return { el, destroy: () => chart?.destroy() };
}

export const simple = (host, o) => figure(host, {
  title: o.title, foot: o.foot, lead: o.lead, callout: o.callout,
  views: [{ id: 'chart', label: 'Chart', note: o.note, legend: o.legend, height: o.height, draw: o.draw }, { id: 'table', label: 'Table', note: o.note, table: o.tableHtml }],
});

export const yearTicks = (labels) => ({
  autoSkip: false, maxRotation: 0,
  callback(v) { const l = labels[v]; return l && l.endsWith('-01') ? l.slice(0, 4) : ''; },
});

// vertical dashed marker at the ChatGPT release month
export const releaseMarker = (labels, key, where = 'top') => ({
  id: 'release',
  afterDatasetsDraw(chart) {
    const i = labels.indexOf(key);
    if (i < 0) return;
    const { ctx, chartArea: a, scales } = chart;
    const x = scales.x.getPixelForValue(i);
    ctx.save();
    ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = INK; ctx.font = "600 11px 'Instrument Sans', sans-serif";
    ctx.fillText('ChatGPT released, Nov 30, 2022', x + 6, where === 'top' ? a.top + 12 : a.bottom - 8);
    ctx.restore();
  },
});

// value tags on a few chosen points: [{ ds, i, text, dy, align }]
export const pointTags = (tags) => ({
  id: 'ptags',
  afterDatasetsDraw(chart) {
    const { ctx, scales } = chart;
    ctx.save(); ctx.font = BOLD; ctx.fillStyle = INK;
    tags.forEach((t) => {
      const v = chart.data.datasets[t.ds].data[t.i];
      if (v == null) return;
      ctx.textAlign = t.align || 'left';
      ctx.fillText(t.text, scales.x.getPixelForValue(t.i) + (t.dx || 0), scales.y.getPixelForValue(v) + (t.dy || -9));
    });
    ctx.restore();
  },
});

// value text at the end of horizontal bars (fmt(index, value, datasetIndex))
export const barEndLabels = (fmt) => ({
  id: 'barEnd',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save(); ctx.font = BOLD; ctx.fillStyle = INK; ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((ds, d) => chart.getDatasetMeta(d).data.forEach((bar, i) => {
      const v = ds.data[i];
      if (v == null) return;
      ctx.textAlign = v >= 0 ? 'left' : 'right';
      ctx.fillText(fmt(i, v, d), v >= 0 ? bar.x + 8 : bar.x - 8, bar.y);
    }));
    ctx.restore();
  },
});

// one or two lines of text above each vertical bar of the last dataset drawn
export const barTopLabels = (lines) => ({
  id: 'barTop',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save(); ctx.font = BOLD; ctx.fillStyle = INK; ctx.textAlign = 'center';
    const meta = chart.getDatasetMeta(chart.data.datasets.length - 1);
    meta.data.forEach((bar, i) => {
      const t = lines(i); if (!t) return;
      const arr = Array.isArray(t) ? t : [t];
      arr.forEach((line, k) => ctx.fillText(line, bar.x, bar.y - 6 - (arr.length - 1 - k) * 15));
    });
    ctx.restore();
  },
});

// ---------------------------------------------------------------- electricity demand
// ctx: { meta, demand, dm, scope, series }
//   demand  = demand json; dm = meta block for that series; scope = 'PJM' or 'U.S.'.
const WORD = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };
const Cap = (w) => w[0].toUpperCase() + w.slice(1);
const perYear = (x, y, n) => 100 * (Math.pow(y / x, 1 / n) - 1);

export function demandFigure(host, { meta, demand, dm, scope, series }) {
  const M = demand.monthly;
  const cmp = demand.comparison;
  const b = cmp.baseline, l = cmp.latest;
  const ye = cmp.years_earlier || {};
  const five = ye['5'];
  const nOld = Math.max(0, ...Object.keys(ye).map(Number));      // oldest window available, up to 10 years back
  const old = nOld >= 6 ? ye[String(nOld)] : null;
  const span = (w) => `${ymLabel(w.from)} to ${ymLabel(w.to)}`;
  const thr = dm.min_coverage ?? 0.97;
  const okM = M.months.map((_, i) => M.coverage[i] >= thr);
  const days = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
  const hrs = M.months.map((m) => days(m) * 24);
  const years = [...new Set(M.months.filter((_, i) => okM[i]).map((m) => Number(m.slice(0, 4))))];

  // ---- comparison tiles
  const tile = (key, rows, deltaText, down, sub = '') => {
    const mx = Math.max(...rows.map((r) => r.v));
    return `<div class="cmp"><div class="cmp__k"><span>${key}</span><span class="cmp__d ${down ? 'down' : ''}">${deltaText}</span></div>${rows.map((r) =>
      `<div class="cmp__row"><span>${r.label}</span><div class="track"><i class="${r.cls}" style="width:${(100 * r.v) / mx}%"></i></div><b>${r.fmt(r.v)}</b></div>`).join('')}${sub ? `<div class="cmp__sub">${sub}</div>` : ''}</div>`;
  };
  const gwf = (v) => `${nf1.format(v / 1000)} GW`;
  const twf = (v) => `${nf0.format(v)} TWh`;
  const tiles = [];
  if (five) {
    const d5 = dem(twhOf(five), twhOf(l));
    tiles.push(tile('Last five years', [{ label: '5 yrs ago', v: twhOf(five), cls: 'old', fmt: twf }, { label: 'Latest', v: twhOf(l), cls: 'after', fmt: twf }], pct(d5), d5 < 0,
      `${pct(perYear(twhOf(five), twhOf(l), 5))} a year, compounded. Energy used in 12 months: ${esc(span(five))} against ${esc(span(l))}.`));
  }
  if (old && five) {
    const k = nOld - 5;
    const dO = dem(twhOf(old), twhOf(five));
    tiles.push(tile(`${Cap(WORD[k] || String(k))} years before that`,
      [{ label: `${nOld} yrs ago`, v: twhOf(old), cls: 'before', fmt: twf }, { label: '5 yrs ago', v: twhOf(five), cls: 'old', fmt: twf }], pct(dO), dO < 0,
      `${pct(perYear(twhOf(old), twhOf(five), k))} a year, compounded. ${esc(span(old))} against ${esc(span(five))}.`));
  }
  const dB = dem(twhOf(b), twhOf(l));
  tiles.push(tile('Since ChatGPT', [{ label: 'Before', v: twhOf(b), cls: 'before', fmt: twf }, { label: 'Latest', v: twhOf(l), cls: 'after', fmt: twf }], pct(dB), dB < 0, `Energy used: ${esc(span(b))} against ${esc(span(l))}.`));
  for (const [k, x, y] of [['Average hour', b.avg_mw, l.avg_mw], ['Highest hour', b.peak_mw, l.peak_mw]]) {
    tiles.push(tile(`${k}, since ChatGPT`, [{ label: 'Before', v: x, cls: 'before', fmt: gwf }, { label: 'Latest', v: y, cls: 'after', fmt: gwf }], pct(dem(x, y)), y < x));
  }
  const lead = `<div class="cmps">${tiles.join('')}</div>`;

  // ---- callout: the ten years, split into the two halves, then the ChatGPT comparison
  const parts = [];
  if (old && five) {
    parts.push(`<b>${Cap(WORD[nOld] || String(nOld))}-year view.</b> Energy used in 12 months went from ${nf0.format(twhOf(old))} TWh (${esc(span(old))}) to ${nf0.format(twhOf(l))} TWh (${esc(span(l))}), <b>${pct(dem(twhOf(old), twhOf(l)))}</b> in ${nOld} years, or ${pct(perYear(twhOf(old), twhOf(l), nOld))} a year.`
      + ` The first ${WORD[nOld - 5]} of those ${nOld} years went ${pct(dem(twhOf(old), twhOf(five)))} (${pct(perYear(twhOf(old), twhOf(five), nOld - 5))} a year) and the last five went <b>${pct(dem(twhOf(five), twhOf(l)))}</b> (${pct(perYear(twhOf(five), twhOf(l), 5))} a year).`);
  } else if (five) {
    parts.push(`<b>Last five years.</b> Energy used in 12 months went from ${nf0.format(twhOf(five))} TWh (${esc(span(five))}) to ${nf0.format(twhOf(l))} TWh (${esc(span(l))}), <b>${pct(dem(twhOf(five), twhOf(l)))}</b>, or ${pct(perYear(twhOf(five), twhOf(l), 5))} a year.`);
  }
  parts.push(`<b>Since ChatGPT's release.</b> Average hourly demand in the latest 12 months is <b>${pct(dem(b.avg_mw, l.avg_mw))}</b> against the 12 months before the release (${esc(span(b))}): ${nf1.format(b.avg_mw / 1000)} GW to ${nf1.format(l.avg_mw / 1000)} GW.`);
  if (five && five.from >= '2020-07') parts.push('Spring 2020 had a pandemic dip in demand; the five-years-earlier window starts after it, so it is the base for the last-five-years change.');
  const callout = parts.join('<br>');

  const dailyNote = demand.daily ? ` Daily values use days with at least ${dm.daily_min_hours ?? 20} hours of data.` : '';
  const foot = `Source: EIA Open Data API, route <code>electricity/rto/region-data</code> (EIA-930, type D, ${esc(series)}). EIA-930 demand data begin in July 2015. Hours with a non-positive value were dropped (${nf0.format(dm.non_positive_rows_dropped)} of ${nf0.format(dm.hourly_rows)}), and so were ${nf0.format(dm.outlier_hours_dropped_pjm ?? 0)} hours that are more than 1.5 times or under half the median of the surrounding 7 days (EIA-930 contains impossible values; see Sources and method). Months with under ${Math.round(thr * 100)}% of expected hours are left out${dm.partial_months.length ? ` (${esc(dm.partial_months.join(', '))})` : ''}. Months and days are in Eastern time. Energy used is the sum of hourly demand.${dailyNote}`;

  const views = [];
  const isAfter = (m) => m >= '2022-11';
  const release = M.months.indexOf('2022-11');

  // ---- yearly totals: every 12-month window back to the oldest the data allow, newest last
  const wins = [];
  for (let k = nOld; k >= 1; k--) if (ye[String(k)]) wins.push(ye[String(k)]);
  wins.push(l);
  if (wins.length >= 3) {
    const lab = (w) => `${ymLabel(w.from)} – ${ymLabel(w.to)}`;
    const warm = (w) => w.to > '2022-10';
    views.push({
      id: 'annual', label: 'Yearly totals', height: 400,
      note: `Total electricity demand in each 12-month window ending ${ymLabel(l.to).split(' ')[0]}, in TWh, back to the oldest window the data cover. The bars start at zero, so a few percent looks small; the labels give the change from the window before.${wins.some((w) => w.hours > 8770) ? ' A window that includes February 29 has one extra day (about 0.3% more hours).' : ''}`,
      legend: `<span><i style="background:${TIME.cool}"></i>Windows ending before ChatGPT's release</span><span><i style="background:${TIME.warm}"></i>Windows ending after</span>`,
      draw: (cv) => new Chart(cv, {
        type: 'bar',
        data: { labels: wins.map((w) => [ymLabel(w.from), `to ${ymLabel(w.to)}`]), datasets: [{ data: wins.map(twhOf), backgroundColor: wins.map((w) => (warm(w) ? TIME.warm : TIME.cool)), borderRadius: 6, maxBarThickness: 70 }] },
        options: {
          maintainAspectRatio: false, layout: { padding: { top: 38 } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => lab(wins[it[0].dataIndex]), label: (c) => { const i = c.dataIndex; return [`${nf1.format(c.parsed.y)} TWh`, i ? `${pct(dem(twhOf(wins[i - 1]), twhOf(wins[i])))} vs the window before` : '']; } } } },
          scales: { x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, font: { size: 11 } } }, y: { min: 0, grid: { color: GRID }, title: { display: true, text: 'TWh in 12 months' }, ticks: { callback: (v) => nf0.format(v) } } },
        },
        plugins: [barTopLabels((i) => [`${nf0.format(twhOf(wins[i]))}`, ...(i ? [pct(dem(twhOf(wins[i - 1]), twhOf(wins[i])))] : [])])],
      }),
    });
  }

  // ---- rolling 12 months
  const roll = M.months.map((_, i) => {
    if (i < 11) return null;
    let hw = 0, h = 0;
    for (let k = i - 11; k <= i; k++) { if (!okM[k]) return null; hw += M.avg_mw[k] * hrs[k]; h += hrs[k]; }
    return hw / h;
  });
  const first = roll.findIndex((r) => r);
  const rl = M.months.slice(first);
  const ravg = roll.slice(first);
  const rrel = rl.indexOf('2022-11');
  const lastR = rl.length - 1;
  views.push({
    id: 'rolling', label: 'Rolling 12 months',
    note: 'Each point is the average hour over the 12 months ending in that month, so seasons cancel out and the trend shows. The line is cool up to ChatGPT\'s release and warm after. The axis does not start at zero.',
    legend: `<span><i class="line" style="background:${TIME.cool}"></i>Before the release</span><span><i class="line" style="background:${TIME.warm}"></i>After</span>`,
    draw: (cv) => new Chart(cv, {
      type: 'line',
      data: { labels: rl, datasets: [{ label: 'Average hour, 12 months', data: ravg, borderColor: TIME.cool, borderWidth: 4, pointRadius: 0, pointHoverRadius: 5, tension: 0.2, segment: { borderColor: (c) => (c.p1.parsed.x >= rrel ? TIME.warm : TIME.cool) } }] },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, layout: { padding: { right: 12 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => `12 months to ${ymLabel(it[0].label)}`, label: (c) => `Average hour: ${nf0.format(c.parsed.y)} MW` } } },
        scales: { x: { grid: { display: false }, ticks: yearTicks(rl) }, y: { title: { display: true, text: 'Average hourly demand (MW)' }, grid: { color: GRID }, ticks: { callback: (v) => nf0.format(v) }, grace: '12%' } },
      },
      plugins: [releaseMarker(rl, '2022-11', 'top'), pointTags([
        { ds: 0, i: 0, text: `${nf0.format(ravg[0])} MW`, align: 'left', dy: -12 },
        { ds: 0, i: lastR, text: `${nf0.format(ravg[lastR])} MW`, align: 'right', dy: -12 },
      ])],
    }),
  });

  // ---- every month, in one continuous line
  const mAvg = M.months.map((_, i) => (okM[i] ? M.avg_mw[i] : null));
  const mPk = M.months.map((_, i) => (okM[i] ? M.peak_mw[i] : null));
  views.push({
    id: 'months', label: 'Every month',
    note: `Every month in the data, in order, from ${ymLabel(M.months.find((_, i) => okM[i]))} to ${ymLabel(M.months[M.months.length - 1 - [...okM].reverse().findIndex(Boolean)])}: the average hour (orange after ChatGPT's release, blue before) and the highest hour of the month. The rise and fall each year is the seasons. The axis does not start at zero.`,
    legend: `<span><i class="line" style="background:${TIME.cool}"></i>Average hour, before the release</span><span><i class="line" style="background:${TIME.warm}"></i>Average hour, after</span><span><i class="line" style="background:#8798a1"></i>Highest hour of the month</span>`,
    draw: (cv) => new Chart(cv, {
      type: 'line',
      data: { labels: M.months, datasets: [
        { label: 'Average hour', data: mAvg, borderColor: TIME.cool, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.15, segment: { borderColor: (c) => (c.p1.parsed.x >= release ? TIME.warm : TIME.cool) } },
        { label: 'Highest hour', data: mPk, borderColor: '#8798a1', borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.15 },
      ] },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => ymLabel(it[0].label), label: (c) => `${c.dataset.label}: ${nf0.format(c.parsed.y)} MW` } } },
        scales: { x: { grid: { display: false }, ticks: yearTicks(M.months) }, y: { title: { display: true, text: 'Demand (MW)' }, grid: { color: GRID }, ticks: { callback: (v) => nf0.format(v) }, grace: '8%' } },
      },
      plugins: [releaseMarker(M.months, '2022-11', 'bottom')],
    }),
  });

  // ---- every day
  const D = demand.daily;
  if (D && D.avg_mw?.length > 60) {
    const t0 = Date.UTC(Number(D.start.slice(0, 4)), Number(D.start.slice(5, 7)) - 1, Number(D.start.slice(8, 10)));
    const dl = D.avg_mw.map((_, i) => new Date(t0 + i * 86400000).toISOString().slice(0, 10));
    const drel = dl.indexOf('2022-11-30');
    views.push({
      id: 'daily', label: 'Every day',
      note: `The average hour of every day in the data, ${esc(D.start)} to ${esc(dl[dl.length - 1])}, with the highest hour of each day in grey.${dailyNote} The yearly rise and fall is the seasons, and short spikes are heat or cold. The axis does not start at zero.`,
      legend: `<span><i class="line" style="background:${TIME.cool}"></i>Daily average hour, before the release</span><span><i class="line" style="background:${TIME.warm}"></i>Daily average hour, after</span><span><i class="line" style="background:#c3ccd1"></i>Highest hour of the day</span>`,
      height: 400,
      draw: (cv) => new Chart(cv, {
        type: 'line',
        data: { labels: dl, datasets: [
          { label: 'Highest hour', data: D.peak_mw, borderColor: '#c3ccd1', borderWidth: 1, pointRadius: 0, pointHoverRadius: 3, tension: 0 },
          { label: 'Average hour', data: D.avg_mw, borderColor: TIME.cool, borderWidth: 1.4, pointRadius: 0, pointHoverRadius: 3, tension: 0, segment: { borderColor: (c) => (c.p1.parsed.x >= drel ? TIME.warm : TIME.cool) } },
        ] },
        options: {
          maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { itemSort: (a, c) => c.datasetIndex - a.datasetIndex, callbacks: { title: (it) => it[0].label, label: (c) => `${c.dataset.label}: ${nf0.format(c.parsed.y)} MW` } } },
          scales: { x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, callback(v) { const s = dl[v]; return s && s.endsWith('-01-01') ? s.slice(0, 4) : ''; } } }, y: { title: { display: true, text: 'Demand (MW)' }, grid: { color: GRID }, ticks: { callback: (v) => nf0.format(v) }, grace: '6%' } },
        },
        plugins: [releaseMarker(dl, '2022-11-30', 'bottom')],
      }),
    });
  }

  // ---- highest hour per calendar year
  const pk = years.map((y) => ({ y, v: Math.max(...M.months.map((m, i) => (okM[i] && Number(m.slice(0, 4)) === y ? M.peak_mw[i] : 0))), n: M.months.filter((m, i) => okM[i] && Number(m.slice(0, 4)) === y).length }));
  views.push({
    id: 'peak', label: 'Highest hour',
    note: 'The single highest hour of demand in each calendar year. A year with fewer than 12 months of data is marked with the months covered.',
    legend: `<span><i style="background:${TIME.cool}"></i>2022 and earlier</span><span><i style="background:${TIME.warm}"></i>2023 on</span>`,
    draw: (cv) => new Chart(cv, {
      type: 'bar',
      data: { labels: pk.map((r) => (r.n < 12 ? `${r.y} (${r.n} mo)` : String(r.y))), datasets: [{ data: pk.map((r) => r.v), backgroundColor: pk.map((r) => (r.y <= 2022 ? TIME.cool : TIME.warm)), borderRadius: 6, maxBarThickness: 56 }] },
      options: {
        maintainAspectRatio: false, layout: { padding: { top: 22 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `Highest hour: ${nf0.format(c.parsed.y)} MW` } } },
        scales: { x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, font: { size: 11 } } }, y: { min: 0, title: { display: true, text: 'MW' }, grid: { color: GRID }, ticks: { callback: (v) => nf0.format(v) } } },
      },
      plugins: [barTopLabels((i) => nf0.format(pk[i].v))],
    }),
  });

  const rows = M.months.map((m, i) => (okM[i] ? [m, nf0.format(M.avg_mw[i]), nf0.format(M.peak_mw[i]), nf0.format(M.min_mw[i]), nf1.format(M.twh[i])] : null)).filter(Boolean);
  views.push({ id: 'table', label: 'Table', table: table(['Month', 'Average hour (MW)', 'Highest hour (MW)', 'Lowest hour (MW)', 'Energy (TWh)'], rows) });

  const tw = (w) => twhOf(w);
  const dir = (x) => (x >= 0 ? 'grew' : 'fell');
  const title = old && five
    ? `${scope} electricity demand ${dir(dem(tw(old), tw(l)))} ${f1(dem(tw(old), tw(l)))}% over ${WORD[nOld] || nOld} years: ${sgn(dem(tw(old), tw(five)))}% in the first ${WORD[nOld - 5]} and ${sgn(dem(tw(five), tw(l)))}% in the last five`
    : five
      ? `${scope} electricity demand ${dir(dem(tw(five), tw(l)))} ${f1(dem(tw(five), tw(l)))}% over five years`
      : `${scope} electricity demand is ${f1(dem(b.avg_mw, l.avg_mw))}% ${dem(b.avg_mw, l.avg_mw) >= 0 ? 'higher' : 'lower'} than in the year before ChatGPT's release`;
  return figure(host, { title, callout, lead, views, foot });
}

// ---------------------------------------------------------------- generation by fuel
// ctx: { meta, fuel, fm, scope }
export function fuelFigure(host, { meta, fuel, fm, scope }) {
  const groups = meta.groups;
  const gl = Object.fromEntries(groups.map((g) => [g.key, g.label]));
  const fb = fuel.comparison.baseline, fl = fuel.comparison.latest;
  const fMin = fm.min_coverage ?? 0.97;
  const okF = fuel.months.map((_, i) => fuel.coverage[i] >= fMin);
  // A fuel is listed when the series carries any value for it. PJM's EIA-930 series has no storage codes, so Storage is absent for PJM.
  const keys = groups.map((g) => g.key).filter((k) => (fuel.gwh[k] || []).some((v) => v));
  const hasStorage = keys.includes('storage');
  const skeys = keys.filter((k) => k !== 'storage');          // storage can be negative, so it is left out of share-of-total views
  const tot = (o) => sum(keys.map((k) => o.gwh[k] || 0));
  const stot = (o) => sum(skeys.map((k) => o.gwh[k] || 0));
  const share = (o, k) => (100 * o.gwh[k]) / stot(o);
  const dTot = (tot(fl) - tot(fb)) / 1000;
  const delta = keys.map((k) => ({ k, d: (fl.gwh[k] - fb.gwh[k]) / 1000, p: fb.gwh[k] ? dem(fb.gwh[k], fl.gwh[k]) : null }));
  const byDelta = delta.slice().sort((a, c) => c.d - a.d);
  const pc = (p) => (p == null ? 'n/a' : pct(p));
  const title = `${scope} net generation was ${nf1.format(tot(fl) / 1000)} TWh in the latest 12 months, ${pct(dem(tot(fb), tot(fl)))} on the 12 months before ChatGPT's release`;

  let callout = '';
  if (hasStorage) {
    const si = fuel.gwh.storage.findIndex((v) => v);
    callout = `<b>Storage.</b> Storage is battery and pumped-storage net generation as balancing authorities report it, and it is negative in hours when storage is charging. This series has storage values from ${esc(ymLabel(fuel.months[si]))} on; before that it has none, so a change in the Storage bar can reflect when reporting began.`;
  } else {
    callout = `<b>Storage.</b> PJM's EIA-930 series carries no storage fuel codes, so there is no Storage bar here. The generator-capacity chart below does list storage, because it comes from EIA's generator inventory (EIA-860M) and not from EIA-930.`;
  }

  const rows1 = byDelta.concat([{ k: 'all', d: dTot, p: dem(tot(fb), tot(fl)) }]);
  const legendKeys = keys.map((k) => `<span><i style="background:${FUEL_COLOR[k]}"></i>${esc(gl[k])}</span>`).join('');
  const v1 = {
    id: 'change', label: 'What changed', height: 60 + rows1.length * 40,
    note: `Change in net generation by fuel, latest 12 months against the 12 months before ChatGPT's release, in TWh. The last bar is all fuels together.`,
    legend: legendKeys + `<span><i style="background:${INK}"></i>All fuels shown</span>`,
    draw: (cv) => new Chart(cv, {
      type: 'bar',
      data: { labels: rows1.map((r) => (r.k === 'all' ? 'All fuels' : gl[r.k])), datasets: [{ data: rows1.map((r) => r.d), backgroundColor: rows1.map((r) => (r.k === 'all' ? INK : FUEL_COLOR[r.k])), borderRadius: 5, barThickness: 24 }] },
      options: {
        indexAxis: 'y', maintainAspectRatio: false, layout: { padding: { right: 24 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const r = rows1[c.dataIndex]; return `${sgn(r.d)} TWh (${pc(r.p)})`; } } } },
        scales: { x: { grace: '22%', grid: { color: GRID }, title: { display: true, text: 'Change in generation (TWh)' } }, y: { grid: { display: false } } },
      },
      plugins: [barEndLabels((i, v) => `${sgn(v)} TWh  (${pc(rows1[i].p)})`)],
    }),
  };

  const v2 = {
    id: 'sidebyside', label: 'Two years side by side', height: 230,
    note: 'Net generation by fuel in each 12-month window, in TWh.',
    legend: legendKeys,
    draw: (cv) => new Chart(cv, {
      type: 'bar',
      data: { labels: [`Before: ${ymLabel(fb.from)} to ${ymLabel(fb.to)}`, `Latest: ${ymLabel(fl.from)} to ${ymLabel(fl.to)}`], datasets: keys.map((k) => ({ label: gl[k], data: [fb.gwh[k] / 1000, fl.gwh[k] / 1000], backgroundColor: FUEL_COLOR[k], borderColor: '#ffffff', borderWidth: 2, borderRadius: 3 })) },
      options: {
        indexAxis: 'y', maintainAspectRatio: false, layout: { padding: { right: 80 } },
        plugins: { legend: { display: false }, tooltip: { itemSort: (a, c) => a.datasetIndex - c.datasetIndex, callbacks: { label: (c) => `${c.dataset.label}: ${nf1.format(c.parsed.x)} TWh` } } },
        scales: { x: { stacked: true, grid: { color: GRID }, title: { display: true, text: 'TWh' } }, y: { stacked: true, grid: { display: false } } },
      },
      plugins: [{
        id: 'totlabels',
        afterDatasetsDraw(chart) {
          const { ctx, scales } = chart;
          ctx.save(); ctx.font = BOLD; ctx.textBaseline = 'middle';
          const m0 = chart.getDatasetMeta(0);
          [fb, fl].forEach((o, i) => { ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.fillText(`${(tot(o) / 1000).toFixed(1)} TWh`, scales.x.getPixelForValue(tot(o) / 1000) + 8, m0.data[i].y); });
          ctx.restore();
        },
      }],
    }),
  };

  const rollF = fuel.months.map((_, i) => {
    if (i < 11) return null;
    for (let k = i - 11; k <= i; k++) if (!okF[k]) return null;
    return Object.fromEntries(keys.map((kk) => [kk, sum(fuel.gwh[kk].slice(i - 11, i + 1)) / 1000]));
  });
  const f0 = rollF.findIndex((r) => r);
  const fl2 = fuel.months.slice(f0);
  const v3 = {
    id: 'rolling', label: 'Rolling 12 months',
    note: 'Each point is the total generation of the 12 months ending in that month, so seasons cancel out.',
    legend: keys.map((k) => `<span><i class="line" style="background:${FUEL_COLOR[k]}"></i>${esc(gl[k])}</span>`).join(''),
    draw: (cv) => new Chart(cv, {
      type: 'line',
      data: { labels: fl2, datasets: keys.map((k) => ({ label: gl[k], data: rollF.slice(f0).map((r) => (r ? r[k] : null)), borderColor: FUEL_COLOR[k], backgroundColor: FUEL_COLOR[k], borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.2 })) },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { itemSort: (a, c) => c.parsed.y - a.parsed.y, callbacks: { title: (it) => `12 months to ${ymLabel(it[0].label)}`, label: (c) => `${c.dataset.label}: ${nf1.format(c.parsed.y)} TWh` } } },
        scales: { x: { grid: { display: false }, ticks: yearTicks(fl2) }, y: { beginAtZero: true, grid: { color: GRID }, title: { display: true, text: 'TWh in the 12 months' } } },
      },
      plugins: [releaseMarker(fl2, '2022-11', 'top')],
    }),
  };

  const fi = fuel.months.map((_, i) => i).filter((i) => okF[i]);
  const flab = fi.map((i) => fuel.months[i]);
  const gwhOf = (k) => fi.map((i) => fuel.gwh[k][i]);
  const totals = fi.map((_, j) => sum(skeys.map((k) => gwhOf(k)[j])));
  const v4 = {
    id: 'share', label: 'Share over time',
    note: `Each fuel's share of monthly net generation${hasStorage ? ', without storage, which can be negative when charging' : ''}.`,
    legend: skeys.map((k) => `<span><i style="background:${FUEL_COLOR[k]}"></i>${esc(gl[k])}</span>`).join(''),
    draw: (cv) => new Chart(cv, {
      type: 'line',
      data: { labels: flab, datasets: skeys.map((k) => ({ label: gl[k], data: gwhOf(k).map((v, j) => (100 * v) / totals[j]), backgroundColor: FUEL_COLOR[k], borderColor: '#ffffff', borderWidth: 0.8, fill: true, pointRadius: 0, pointHoverRadius: 3, tension: 0, stack: 'mix' })) },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { itemSort: (a, c) => c.datasetIndex - a.datasetIndex, callbacks: { title: (it) => ymLabel(it[0].label), label: (c) => `${c.dataset.label}: ${nf1.format(c.parsed.y)}%` } } },
        scales: { x: { grid: { display: false }, ticks: yearTicks(flab) }, y: { stacked: true, min: 0, max: 100, grid: { color: GRID }, title: { display: true, text: 'Share of generation (%)' } } },
      },
      plugins: [releaseMarker(flab, '2022-11')],
    }),
  };

  const sh = hasStorage ? ' (without storage)' : '';
  const v5 = {
    id: 'table', label: 'Table',
    table: table(['Fuel', `TWh ${ymLabel(fb.from)}–${ymLabel(fb.to)}`, `TWh ${ymLabel(fl.from)}–${ymLabel(fl.to)}`, 'Change (TWh)', 'Change (%)', `Share before${sh}`, `Share latest${sh}`],
      keys.map((k) => [gl[k], nf1.format(fb.gwh[k] / 1000), nf1.format(fl.gwh[k] / 1000), sgn((fl.gwh[k] - fb.gwh[k]) / 1000), fb.gwh[k] ? pct(dem(fb.gwh[k], fl.gwh[k])) : 'n/a', k === 'storage' ? 'n/a' : `${nf1.format(share(fb, k))}%`, k === 'storage' ? 'n/a' : `${nf1.format(share(fl, k))}%`])
        .concat([['All fuels shown', nf1.format(tot(fb) / 1000), nf1.format(tot(fl) / 1000), sgn(dTot), pct(dem(tot(fb), tot(fl))), '', '']])),
  };

  const names = fuel.code_names && Object.keys(fuel.code_names).length ? fuel.codes_seen.map((c) => `${c}${fuel.code_names[c] ? ` (${fuel.code_names[c]})` : ''}`).join(', ') : fuel.codes_seen.join(', ');
  return figure(host, {
    title, callout, views: [v1, v2, v3, v4, v5],
    foot: `Source: EIA Open Data API, route <code>electricity/rto/fuel-type-data</code> (EIA-930, ${esc(scope === 'PJM' ? 'respondent PJM' : 'respondent US48')}). EIA-930 generation is not the same series as EIA-923 plant generation, so the two should not be mixed. EIA fuel codes in this series: ${esc(names)}; grouped as listed on the Sources page.`,
  });
}

// ---------------------------------------------------------------- generator additions by quarter
export function additionsFigure(host, { meta, units, winUnits, removed, snapshot, removedBaseline, scopeNote, retired, scopeLabel }) {
  const groups = meta.groups;
  const gl = Object.fromEntries(groups.map((g) => [g.key, g.label]));
  const lastIdx = ymIndex(snapshot);
  const startIdx = ymIndex('2019-01');
  const useNet = !!retired && meta.retired?.capacity_basis === 'net summer capacity' && units.some((u) => u.msum != null);
  const mwOf = (u) => (useNet ? u.msum : u.mw) || 0;
  const q = (ym) => { const [y, m] = ym.split('-').map(Number); return `${y} Q${Math.ceil(m / 3)}`; };
  const qs = []; for (let y = 2019; y <= Math.floor(lastIdx / 12); y++) for (let k = 1; k <= 4; k++) { if (y * 12 + (k - 1) * 3 <= lastIdx) qs.push(`${y} Q${k}`); }
  const zero = () => Object.fromEntries(groups.map((g) => [g.key, Object.fromEntries(qs.map((x) => [x, 0]))]));
  const by = zero(), byRet = zero();
  units.filter((u) => u.state_cls === 'operating' && u.online && ymIndex(u.online) >= startIdx && ymIndex(u.online) <= lastIdx)
    .forEach((u) => { const k = q(u.online); if (by[u.group] && k in by[u.group]) by[u.group][k] += mwOf(u); });
  (retired || []).filter((r) => r.ret && ymIndex(r.ret) >= startIdx && ymIndex(r.ret) <= lastIdx)
    .forEach((r) => { const k = q(r.ret); if (byRet[r.group] && k in byRet[r.group]) byRet[r.group][k] += r.mw || 0; });
  const addMw = Object.fromEntries(groups.map((g) => [g.key, sum(winUnits.filter((u) => u.group === g.key).map(mwOf))]));
  const retMw = Object.fromEntries(groups.map((g) => [g.key, sum((retired || []).filter((r) => r.group === g.key).map((r) => r.mw))]));
  const added = sum(Object.values(addMw)), gone = sum(Object.values(retMw));
  const legend = groups.map((g) => `<span><i style="background:${FUEL_COLOR[g.key]}"></i>${esc(g.label)}</span>`).join('');
  const basisTxt = useNet ? 'net summer capacity' : 'nameplate capacity';

  if (!retired) {
    const top = groups.map((g) => g.key).sort((a, c) => addMw[c] - addMw[a])[0];
    const remMw = removed.mw;
    return simple(host, {
      title: `${gl[top]} is the largest block of new generator capacity since December 2022: ${nf0.format(addMw[top])} MW of ${nf0.format(added)} MW`,
      note: 'Nameplate MW of EIA operating generators' + (scopeNote || '') + ', by the quarter they reached operation. Nameplate is the maximum rating, not what a unit produced.',
      legend,
      foot: `Source: EIA Open Data API, route <code>electricity/operating-generator-capacity</code> (EIA-860M), snapshot ${esc(snapshot)}. Units absent from the latest snapshot but present in the ${esc(removedBaseline)} snapshot (${nf0.format(removed.n)} units, ${nf0.format(sum(Object.values(remMw)))} MW) are not netted out here; they may be retired or reclassified.`,
      tableHtml: table(['Fuel', 'MW online since Dec 2022', 'MW listed in baseline snapshot but not latest'], groups.map((g) => [g.label, nf0.format(addMw[g.key]), nf0.format(remMw[g.key] || 0)])),
      draw: (cv) => new Chart(cv, {
        type: 'bar',
        data: { labels: qs, datasets: groups.map((g) => ({ label: g.label, data: qs.map((x) => by[g.key][x]), backgroundColor: FUEL_COLOR[g.key], borderColor: '#ffffff', borderWidth: 1, borderRadius: 2, stack: 's' })) },
        options: {
          maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { itemSort: (a, c) => c.datasetIndex - a.datasetIndex, filter: (it) => it.parsed.y > 0, callbacks: { label: (c) => `${c.dataset.label}: ${nf0.format(c.parsed.y)} MW` } } },
          scales: { x: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, callback(v) { const t = qs[v]; return t.endsWith('Q1') ? t.slice(0, 4) : ''; } } }, y: { stacked: true, grid: { color: GRID }, title: { display: true, text: 'MW (nameplate)' }, ticks: { callback: (v) => nf0.format(v) } } },
        },
        plugins: [releaseMarker(qs, '2022 Q4')],
      }),
    });
  }

  const net = added - gone;
  const rows = groups.map((g) => ({ k: g.key, a: addMw[g.key], r: retMw[g.key], n: addMw[g.key] - retMw[g.key] })).sort((x, y) => y.n - x.n);
  const xc = meta.retired?.crosscheck?.[scopeLabel] || null;
  const title = `${scopeLabel === 'pjm' ? 'PJM' : 'U.S.'} generators added ${nf0.format(added)} MW and retired ${nf0.format(gone)} MW since December 2022, a net ${net >= 0 ? '+' : '−'}${nf0.format(Math.abs(net))} MW`;
  const callout = `<b>Net by fuel.</b> `
    + rows.filter((r) => r.a || r.r).slice().sort((x, y) => Math.abs(y.n) - Math.abs(x.n)).slice(0, 4).map((r) => `${gl[r.k]} ${r.n >= 0 ? '+' : '−'}${nf0.format(Math.abs(r.n))} MW (${nf0.format(r.a)} added, ${nf0.format(r.r)} retired)`).join('; ')
    + `. Capacity is ${basisTxt}. Added and retired capacity say what is installed, not how much any unit ran. They are not comparable with the TWh changes in the fuel-mix chart above: that chart counts the output of every unit, new and existing, and a MW of solar or wind produces far fewer TWh in a year than a MW of a unit that can run around the clock. Storage adds MW but moves energy rather than making it.`;
  const v1 = {
    id: 'quarter', label: 'Added and retired by quarter', height: 400,
    note: `${esc(basisTxt[0].toUpperCase() + basisTxt.slice(1))} of generators${scopeNote || ''} by the quarter they reached operation (above zero) or retired (below zero). EIA lists retirements by month; operating months come from the generator inventory.`,
    legend,
    draw: (cv) => new Chart(cv, {
      type: 'bar',
      data: { labels: qs, datasets: groups.map((g) => ({ label: g.label, data: qs.map((x) => by[g.key][x]), backgroundColor: FUEL_COLOR[g.key], borderColor: '#ffffff', borderWidth: 1, borderRadius: 2, stack: 's' }))
        .concat(groups.map((g) => ({ label: `${g.label} retired`, data: qs.map((x) => -byRet[g.key][x]), backgroundColor: FUEL_COLOR[g.key], borderColor: '#ffffff', borderWidth: 1, borderRadius: 2, stack: 's' }))) },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { filter: (it) => it.parsed.y !== 0, callbacks: { label: (c) => `${c.dataset.label}: ${nf0.format(Math.abs(c.parsed.y))} MW` } } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, callback(v) { const t = qs[v]; return t.endsWith('Q1') ? t.slice(0, 4) : ''; } } }, y: { stacked: true, grid: { color: GRID }, title: { display: true, text: `MW (${useNet ? 'net summer' : 'nameplate'})` }, ticks: { callback: (v) => (v < 0 ? `−${nf0.format(-v)}` : nf0.format(v)) } } },
      },
      plugins: [releaseMarker(qs, '2022 Q4')],
    }),
  };
  const v2 = {
    id: 'net', label: 'Net change by fuel', height: 360,
    note: `Capacity added minus capacity retired since December 2022, by fuel, in MW (${basisTxt}). The last bar is all fuels.`,
    legend: legend + `<span><i style="background:${INK}"></i>All fuels</span>`,
    draw: (cv) => {
      const all = rows.concat([{ k: 'all', a: added, r: gone, n: net }]);
      return new Chart(cv, {
        type: 'bar',
        data: { labels: all.map((r) => (r.k === 'all' ? 'All fuels' : gl[r.k])), datasets: [{ data: all.map((r) => r.n), backgroundColor: all.map((r) => (r.k === 'all' ? INK : FUEL_COLOR[r.k])), borderRadius: 5, barThickness: 24 }] },
        options: {
          indexAxis: 'y', maintainAspectRatio: false, layout: { padding: { right: 24 } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const r = all[c.dataIndex]; return [`Net ${r.n >= 0 ? '+' : '−'}${nf0.format(Math.abs(r.n))} MW`, `${nf0.format(r.a)} added, ${nf0.format(r.r)} retired`]; } } } },
          scales: { x: { grace: '25%', grid: { color: GRID }, title: { display: true, text: 'Net change in capacity (MW)' }, ticks: { callback: (v) => nf0.format(v) } }, y: { grid: { display: false } } },
        },
        plugins: [barEndLabels((i, v) => `${v >= 0 ? '+' : '−'}${nf0.format(Math.abs(v))} MW`)],
      });
    },
  };
  const v3 = {
    id: 'table', label: 'Table',
    table: table(['Fuel', 'MW added since Dec 2022', 'MW retired since Dec 2022', 'Net MW'], rows.map((r) => [gl[r.k], nf0.format(r.a), nf0.format(r.r), `${r.n >= 0 ? '+' : '−'}${nf0.format(Math.abs(r.n))}`]).concat([['All fuels', nf0.format(added), nf0.format(gone), `${net >= 0 ? '+' : '−'}${nf0.format(Math.abs(net))}`]])),
  };
  const rm = meta.retired;
  return figure(host, {
    title, callout, views: [v1, v2, v3],
    foot: `Sources: EIA Open Data API, route <code>electricity/operating-generator-capacity</code> (EIA-860M), snapshot ${esc(snapshot)}, for additions; the "Retired" tab of EIA's monthly generator file (Form EIA-860M), for retirements dated ${esc(ymLabel(rm.retirement_months[0]))} to ${esc(ymLabel(rm.retirement_months[1]))}.${scopeLabel === 'pjm' ? " A retired unit counts as PJM when EIA's balancing authority code on the Retired tab says PJM (a plant ID match to the PJM snapshots where the code is blank)." : ''} ${xc ? `Between the ${esc(removedBaseline)} and ${esc(snapshot)} snapshots, ${nf0.format(xc.left_inventory_units)} units left the operating inventory; ${nf0.format(xc.of_which_on_retired_tab)} of them are on the Retired tab and ${nf0.format(xc.left_inventory_not_on_retired_tab_units)} (${nf0.format(xc.left_inventory_not_on_retired_tab_nameplate_mw)} MW nameplate) are not, so they may have been reclassified or renumbered and are not counted as retirements here.` : ''}`,
  });
}

export { SECTOR_COLOR, TIME, FUEL_COLOR, Chart };

// ---------------------------------------------------------------- capacity added next to the change in energy produced
// Two different measures: MW is what was installed, TWh is what the grid produced. Each row shows both, plus the most
// the new MW could have produced in a year (MW x 8,760 hours), so a reader can see whether the new units could be the whole change.
export function capacityGenFigure(host, { meta, fuel, winUnits, retired, scope, scopeLabel }) {
  const groups = meta.groups;
  const fb = fuel.comparison.baseline, fl = fuel.comparison.latest;
  const useNet = !!retired && meta.retired?.capacity_basis === 'net summer capacity' && winUnits.some((u) => u.msum != null);
  const mwOf = (u) => (useNet ? u.msum : u.mw) || 0;
  const basis = useNet ? 'net summer capacity' : 'nameplate capacity';
  const has = (k) => (fuel.gwh[k] || []).some((v) => v);
  const rows = groups.map((g) => {
    const add = sum(winUnits.filter((u) => u.group === g.key).map(mwOf));
    const ret = sum((retired || []).filter((r) => r.group === g.key).map((r) => r.mw || 0));
    const gen = has(g.key) ? (fl.gwh[g.key] - fb.gwh[g.key]) / 1000 : null;
    const ceil = (add * 8760) / 1e6;
    return { k: g.key, label: g.label, add, ret, gen, ceil, ratio: gen != null && ceil > 0 ? (100 * gen) / ceil : null };
  }).filter((r) => r.add || r.ret || r.gen != null).sort((a, c) => c.add - a.add);
  if (!rows.length) return null;
  const maxCap = Math.max(...rows.map((r) => Math.max(r.add, r.ret)), 1);
  const maxGen = Math.max(...rows.map((r) => Math.abs(r.gen ?? 0)), 1);
  const cap = (v, color) => `<span class="cg__bar"><i style="width:${(100 * v) / maxCap}%;background:${color}"></i></span>`;
  const gbar = (g, color) => {
    if (g == null) return '<span class="cg__na">not reported</span>';
    const w = (50 * Math.abs(g)) / maxGen;
    return `<span class="cg__gen"><i style="width:${w}%;left:${g >= 0 ? 50 : 50 - w}%;background:${color}"></i></span>`;
  };
  const body = rows.map((r) => {
    const over = r.ratio != null && r.ratio > 100;
    return `<tr><th scope="row"><i class="cg__dot" style="background:${FUEL_COLOR[r.k]}"></i>${esc(r.label)}</th>
      <td>${cap(r.add, FUEL_COLOR[r.k])}<b>${nf0.format(r.add)} MW</b></td>
      <td>${cap(r.ret, '#8d9aa2')}<b>${nf0.format(r.ret)} MW</b></td>
      <td>${gbar(r.gen, FUEL_COLOR[r.k])}<b>${r.gen == null ? '' : `${sgn(r.gen)} TWh`}</b></td>
      <td class="cg__n">${r.add ? `${nf0.format(r.ceil)} TWh` : '–'}</td>
      <td class="cg__n ${over ? 'cg__flag' : ''}">${r.ratio == null ? '–' : `${nf0.format(r.ratio)}%`}${over ? '<small>more than the new units could make</small>' : ''}</td></tr>`;
  }).join('');
  const html = `<div class="tbl-wrap"><table class="cg"><thead><tr>
    <th scope="col">Fuel</th>
    <th scope="col">Capacity added<small>MW installed (${esc(basis)})</small></th>
    <th scope="col">Capacity retired<small>MW removed</small></th>
    <th scope="col">Change in energy produced<small>TWh, latest 12 months vs the 12 before ChatGPT</small></th>
    <th scope="col">Most the added MW could make in a year<small>MW × 8,760 hours, if it never stopped</small></th>
    <th scope="col">Energy change as a share of that<small>above 100% means other units changed too</small></th></tr></thead><tbody>${body}</tbody></table></div>`;
  const ex = rows.filter((r) => r.add > 0 && r.ratio != null && r.k !== 'storage').slice(0, 3)
    .map((r) => `<b>${esc(r.label)}</b>: ${nf0.format(r.add)} MW added could make at most ${nf0.format(r.ceil)} TWh in a year; the energy produced changed ${sgn(r.gen)} TWh, ${nf0.format(r.ratio)}% of that maximum.`).join(' ');
  const over = rows.filter((r) => r.ratio != null && r.ratio > 100);
  const callout = `<b>Read each row as two separate facts.</b> Megawatts say how much was installed. Terawatt-hours say how much the grid produced, and that counts every unit, new and old, after retirements. ${ex}`
    + (over.length ? ` Where the change is above 100% (${over.map((r) => esc(r.label)).join(', ')}), the new units cannot be all of it: units that were already operating produced more in total, after retirements.` : '')
    + (rows.some((r) => r.k === 'storage' && r.gen == null) ? ' Storage has no generation figure here because EIA-930 carries no storage codes for this series.' : '')
    + (rows.some((r) => r.k === 'storage' && r.add) ? ' Storage moves energy rather than making it, so a large storage capacity does not mean a large energy change.' : '');
  return figure(host, {
    title: `${scope}: capacity added since December 2022 next to the change in energy produced`,
    callout,
    views: [{ id: 'rows', label: 'By fuel', note: `The first two bars show what was built or removed (MW). The next shows what the grid produced (TWh). The last two columns give a ceiling for how much of that the new units could account for. These are different units answering different questions, so the bars are not on one scale.`, table: html }],
    foot: `Sources: capacity from EIA's generator inventory (EIA-860M, ${esc(basis)}) and, for retirements, its Retired tab; energy from EIA-930 net generation by fuel. The ceiling assumes a unit runs every hour of a year; units that started partway through the window could make less, and it is only a bound, not an estimate of what any unit produced.`,
  });
}


// ---- capacity factor and what added capacity produced ---------------------------------------------------------
const pc = (v, d = 1) => (v == null ? 'n/a' : `${(100 * v).toFixed(d)}%`);
const monthHours = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate() * 24;

export function yieldFigure(host, { meta, cg, scope }) {
  if (!cg?.months?.length) return null;
  const label = Object.fromEntries(meta.groups.map((g) => [g.key, g.label]));
  const fuels = cg.groups.filter((g) => cg.cf[g].some((v) => v != null));
  const months = cg.months, hrs = months.map(monthHours);
  // rolling 12 months: energy produced / energy the capacity could have produced running every hour
  const roll = (g) => months.map((_, i) => {
    if (i < 11) return null;
    let e = 0, c = 0;
    for (let k = i - 11; k <= i; k++) {
      const gv = cg.gen_avg_mw[g][k];
      if (gv == null || !(cg.cap_mw[g][k] > 0)) return null;
      e += gv * hrs[k]; c += cg.cap_mw[g][k] * hrs[k];
    }
    return e / c;
  });
  const latest = cg.windows[cg.windows.length - 1], base = cg.baseline;
  const st = cg.steps?.baseline_to_latest || {};
  const rel = months.indexOf('2022-11');
  const lineDs = (series) => fuels.map((g) => ({ label: label[g], data: series(g), borderColor: FUEL_COLOR[g], backgroundColor: FUEL_COLOR[g], borderWidth: 2.2, pointRadius: 0, pointHoverRadius: 4, tension: 0, spanGaps: false }));
  const lineOpts = (title) => ({
    maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    scales: { x: { grid: { display: false }, ticks: yearTicks(months) }, y: { min: 0, max: 1, title: { display: true, text: title }, grid: { color: GRID }, ticks: { callback: (v) => `${Math.round(v * 100)}%` } } },
    plugins: { legend: { display: false }, tooltip: { itemSort: (a, b) => b.parsed.y - a.parsed.y, callbacks: { title: (it) => ymLabel(months[it[0].dataIndex]), label: (c) => `${c.dataset.label}: ${pc(c.parsed.y)}` } } },
  });
  const legend = `<div class="legend__row">${fuels.map((g) => `<span><i style="background:${FUEL_COLOR[g]}"></i>${esc(label[g])}</span>`).join('')}</div>`;

  const views = [
    { id: 'roll', label: 'Rolling 12 months', legend, note: 'For each month, the energy produced over the 12 months ending then, divided by what that fuel\'s capacity in service could have produced running every hour of those 12 months. 100% would mean every unit ran flat out all year.',
      draw: (cv) => new Chart(cv, { type: 'line', data: { labels: months, datasets: lineDs(roll) }, options: lineOpts('Capacity factor, 12 months'), plugins: [releaseMarker(months, '2022-11', 'bottom')] }) },
    { id: 'month', label: 'Every month', legend, note: 'The same ratio for each single month. Solar and wind swing with the seasons, so read the rolling view for the trend.',
      draw: (cv) => new Chart(cv, { type: 'line', data: { labels: months, datasets: lineDs((g) => cg.cf[g]) }, options: lineOpts('Capacity factor, month'), plugins: [releaseMarker(months, '2022-11', 'bottom')] }) },
  ];

  // what the added capacity went with
  const grow = fuels.filter((g) => st[g] && st[g].implied_cf != null);
  if (base && latest && grow.length) {
    const bars = grow.map((g) => ({ g, a: base.groups[g]?.cf, b: latest.groups[g]?.cf, c: st[g].implied_cf }));
    views.push({
      id: 'added', label: 'Added capacity', height: Math.max(220, 120 * bars.length + 80),
      legend: `<div class="legend__row"><span><i style="background:${TIME.cool}"></i>All capacity, 12 months to ${esc(ymLabel(base.to))}</span><span><i style="background:${TIME.warm}"></i>All capacity, 12 months to ${esc(ymLabel(latest.to))}</span><span><i style="background:#15323d"></i>Only the capacity added in between</span></div>`,
      note: `For fuels whose capacity grew by at least 10%: the capacity factor over all capacity in each window, and the capacity factor of the <b>added</b> capacity alone, which is the change in average energy produced (MW) divided by the change in average capacity (MW) between the two windows. It counts every unit, new and old, so it is arithmetic on EIA's totals, not a measurement of any new unit.`,
      draw: (cv) => new Chart(cv, {
        type: 'bar',
        data: { labels: bars.map((b) => label[b.g]), datasets: [
          { label: 'Earlier window', data: bars.map((b) => b.a), backgroundColor: TIME.cool, borderRadius: 4, barPercentage: 0.9 },
          { label: 'Latest window', data: bars.map((b) => b.b), backgroundColor: TIME.warm, borderRadius: 4, barPercentage: 0.9 },
          { label: 'Added capacity', data: bars.map((b) => b.c), backgroundColor: '#15323d', borderRadius: 4, barPercentage: 0.9 }] },
        options: { indexAxis: 'y', maintainAspectRatio: false, layout: { padding: { right: 70 } },
          scales: { x: { min: 0, max: 1, grid: { color: GRID }, ticks: { callback: (v) => `${Math.round(v * 100)}%` }, title: { display: true, text: 'Capacity factor' } }, y: { grid: { display: false } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${pc(c.parsed.x)}` } } } },
        plugins: [barEndLabels((i, v) => pc(v))],
      }),
    });
  }

  // each 12-month window as a point: capacity against energy
  const fit = fuels.filter((g) => cg.corr?.[g]?.measurable);
  if (fit.length) {
    const gw = (v) => v / 1000;
    const ds = [];
    fit.forEach((g) => {
      const pts = cg.windows.filter((w) => w.groups[g]).map((w) => ({ x: gw(w.groups[g].cap_mw), y: gw(w.groups[g].gen_mw), to: w.to }));
      ds.push({ label: label[g], data: pts, backgroundColor: FUEL_COLOR[g], borderColor: FUEL_COLOR[g], pointRadius: 5, pointHoverRadius: 7 });
      const c = cg.corr[g], xs = pts.map((p) => p.x), lo = Math.min(...xs), hi = Math.max(...xs);
      ds.push({ label: `${label[g]} fit`, type: 'line', data: [{ x: lo, y: gw(c.slope * lo * 1000 + c.intercept_mw) }, { x: hi, y: gw(c.slope * hi * 1000 + c.intercept_mw) }], borderColor: FUEL_COLOR[g], borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0 });
    });
    views.push({
      id: 'scatter', label: 'Each 12 months', height: 380,
      legend: `<div class="legend__row">${fit.map((g) => `<span><i style="background:${FUEL_COLOR[g]}"></i>${esc(label[g])}</span>`).join('')}</div>`,
      note: `Each dot is one 12-month window (Nov to Oct blocks counted back from the latest data): average capacity in service on the x axis, average power produced on the y axis, both in GW. ${fit.map((g) => { const c = cg.corr[g]; return `<b>${esc(label[g])}</b>: r = ${c.r.toFixed(3)}, so ${nf0.format(100 * c.r2)}% of the year-to-year variation in average output lines up with capacity; each extra GW went with ${nf0.format(1000 * c.slope)} MW more average output (n = ${c.n} windows).`; }).join(' ')} Only fuels whose capacity moved by at least 10% are fitted; for fuels with steady capacity the line would only show weather and demand.`,
      draw: (cv) => new Chart(cv, { type: 'scatter', data: { datasets: ds }, options: { maintainAspectRatio: false,
        scales: { x: { title: { display: true, text: 'Average capacity in service (GW)' }, grid: { color: GRID }, ticks: { callback: (v) => nf0.format(v) } }, y: { title: { display: true, text: 'Average power produced (GW)' }, grid: { color: GRID }, ticks: { callback: (v) => nf0.format(v) } } },
        plugins: { legend: { display: false }, tooltip: { filter: (it) => !String(it.dataset.label).endsWith('fit'), callbacks: { title: (it) => `12 months to ${ymLabel(it[0].raw.to)}`, label: (c) => `${c.dataset.label}: ${nf1.format(c.raw.x)} GW capacity, ${nf1.format(c.raw.y)} GW produced (${pc(c.raw.y / c.raw.x)})` } } } } }),
    });
  }

  // table: every window, every fuel
  const rows = [];
  fuels.forEach((g) => cg.windows.forEach((w) => { const v = w.groups[g]; if (v) rows.push([label[g], `${ymLabel(w.from)} to ${ymLabel(w.to)}`, `${nf1.format(v.cap_mw / 1000)} GW`, `${nf1.format(v.twh)} TWh`, pc(v.cf)]); }));
  views.push({ id: 'table', label: 'Table', note: 'Average capacity in service, energy produced and capacity factor for each 12-month window.', table: table(['Fuel', '12 months', 'Capacity in service', 'Energy produced', 'Capacity factor'], rows) });

  // a plain-language lead: the fuels that grew, in numbers
  const bit = grow.map((g) => {
    const s = st[g], l = latest.groups[g];
    return `<b>${esc(label[g])}</b>: ${nf1.format(s.d_cap_mw / 1000)} GW more capacity in service on average and ${nf1.format(s.d_twh)} TWh more energy in the latest 12 months than in the 12 before ChatGPT, which is a capacity factor of ${pc(s.implied_cf)} on the added capacity against ${pc(l.cf)} for all of it.`;
  });
  const callout = bit.length
    ? `<b>How much of the added capacity shows up as energy.</b> Capacity factor is energy produced divided by what the capacity could make running every hour of the year. ${bit.join(' ')}`
    : '<b>How much capacity shows up as energy.</b> Capacity factor is energy produced divided by what the capacity could make running every hour of the year.';
  const sk = cg.caveats?.units_skipped || {};
  return figure(host, {
    title: `${scope}: how much of each fuel's capacity shows up as energy`,
    callout, views,
    foot: `Capacity: net summer capacity of the generators operating for the whole month, which is EIA's time-adjusted definition of capacity for capacity factors. It comes from EIA's monthly generator inventory (EIA-860M) through the API for units operating now, plus every unit on its Retired tab since 2015, each at its latest reported capacity, so uprates and derates are not tracked. Energy: ${esc(cg.method.generation)}. The inventory lists utility-scale generators of 1 MW or more, so small-scale solar is in neither the capacity nor the energy. ${scope === 'U.S.' ? `${nf0.format(sk.pumped_storage_excluded_from_us_hydro || 0)} pumped-storage units are left out of hydro capacity because EIA-923 hydro excludes pumped storage. ` : 'PJM hydro capacity includes pumped storage because EIA-930 reports hydro and pumped storage together. '}${sk.no_capacity ? `${nf0.format(sk.no_capacity)} units with no reported capacity are not counted. ` : ''}A capacity factor describes a fuel's total output relative to its total capacity; it does not say why units ran or did not run.`,
  });
}

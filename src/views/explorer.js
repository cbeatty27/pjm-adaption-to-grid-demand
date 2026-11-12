// All the data: demand and net generation by fuel at every interval EIA provides, with no comparison or conclusion drawn.
import { Chart, GRID, releaseMarker } from '../lib/figs.js';
import { FUEL_COLOR } from '../lib/fuels.js';
import { esc, nf0, nf1 } from '../lib/format.js';
import { loadAll, loadExplorer, loadHourly } from '../lib/data.js';

const TZ = 'America/New_York';
const DEMAND_COLOR = '#17404e';
const BAND = '#9fb3bd';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
const etParts = (ms) => { const p = {}; for (const x of etFmt.formatToParts(ms)) p[x.type] = x.value; return p; };
const etStr = (ms) => { const p = etParts(ms); return `${p.year}-${p.month}-${p.day} ${p.hour}:00`; };
const utcMs = (iso) => Date.parse(`${iso}:00:00Z`);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
function etMidnightUtc(d) {            // the UTC instant at which an Eastern-time date begins
  const [y, m, dd] = d.split('-').map(Number);
  for (const off of [5, 4]) { const ms = Date.UTC(y, m - 1, dd, off); const p = etParts(ms); if (Number(p.day) === dd && Number(p.hour) === 0 && Number(p.month) === m) return ms; }
  return Date.UTC(y, m - 1, dd, 5);
}
const dayLabel = (d) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
const monLabel = (m) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

const SPANS = {
  all: { label: 'All data', days: null }, y10: { label: '10 years', days: 3653 }, y5: { label: '5 years', days: 1826 }, y1: { label: '1 year', days: 366 },
  m3: { label: '3 months', days: 92 }, m1: { label: '1 month', days: 31 }, w1: { label: '1 week', days: 7 }, d1: { label: '1 day', days: 1 },
};
const ALLOWED = { year: ['all'], month: ['all', 'y5', 'y1'], day: ['all', 'y5', 'y1', 'm3', 'm1'], hour: ['y1', 'm3', 'm1', 'w1', 'd1'] };
const DEFAULT_SPAN = { year: 'all', month: 'all', day: 'all', hour: 'm1' };
const INTERVALS = [['hour', 'Hour'], ['day', 'Day'], ['month', 'Month'], ['year', 'Year']];

export async function mount(root, data) {
  const { meta } = data;
  const gl = Object.fromEntries(meta.groups.map((g) => [g.key, g.label]));
  const scopes = [['us', 'U.S. Lower 48']].filter(() => meta.has_us).concat([['pjm', 'PJM']]);
  const state = { scope: scopes[0][0], interval: 'day', span: 'all', start: null, overlay: false };
  const charts = [];
  let token = 0;

  root.innerHTML = `<div class="doc">
    <div class="doc__intro">
      <h2>All the data</h2>
      <p>Every hour, day, month and year of electricity demand and net generation by fuel that EIA publishes for the Lower 48 states and for PJM, since EIA began collecting it. Nothing here is compared, adjusted or explained: it is the data, so you can look at it first.</p>
      <p>Hours are as EIA reports them, apart from the impossible values listed under Sources and method. Days, months and years are the average of the hours present, in Eastern time, and every value is in megawatts so the intervals share one scale. Energy is that average times the hours (the table gives both).</p>
    </div>
    <dl class="ledger" id="xl"></dl>
    <section class="fig xctl" aria-label="Choose what to show">
      <div class="xctl__row"><span class="xctl__k">Place</span><div class="seg" id="xPlace" role="group" aria-label="Place"></div></div>
      <div class="xctl__row"><span class="xctl__k">Interval</span><div class="seg" id="xInt" role="group" aria-label="Interval"></div></div>
      <div class="xctl__row"><span class="xctl__k">Show</span><div class="seg" id="xSpan" role="group" aria-label="Length of time"></div>
        <label class="xctl__date">Starting <input type="date" id="xStart"></label>
        <div class="xctl__pan"><button type="button" id="xPrev" aria-label="Earlier">&larr;</button><button type="button" id="xNext" aria-label="Later">&rarr;</button><button type="button" id="xLatest">Latest</button></div>
      </div>
      <p class="xctl__note" id="xNote"></p>
    </section>
    <div id="xFigs"></div>
    <section class="fig"><div class="fig__head"><h3>Table and download</h3><p class="fig__note" id="xTblNote"></p></div>
      <div class="xdl"><button type="button" class="btn" id="xCsv">Download what is shown (CSV)</button><button type="button" class="btn" id="xCsvAll">Download this interval for all years (CSV)</button><button type="button" class="btn" id="x923" hidden>Download EIA-923 monthly (CSV)</button></div>
      <div class="fig__table" id="xTbl"></div></section>
  </div>`;
  const $ = (id) => root.querySelector(`#${id}`);

  const mkFig = (id, title) => {
    const el = document.createElement('section');
    el.className = 'fig'; el.id = id;
    el.innerHTML = `<div class="fig__head"><h3>${esc(title)}</h3><p class="fig__note"></p></div><div class="fig__body"><div class="legend"></div><div class="fig__canvas" style="height:360px"><canvas role="img" aria-label="${esc(title)}"></canvas></div></div><div class="fig__foot"></div>`;
    $('xFigs').appendChild(el);
    return { el, cv: el.querySelector('canvas'), note: el.querySelector('.fig__note'), legend: el.querySelector('.legend'), foot: el.querySelector('.fig__foot'), box: el.querySelector('.fig__canvas') };
  };
  const fDem = mkFig('fDem', 'Electricity demand');
  const fGen = mkFig('fGen', 'Net generation by fuel');
  const f923 = mkFig('f923', 'Net generation by fuel, EIA-923 monthly');

  // ---------------------------------------------------------------- building the selected view
  async function explorer() { return loadExplorer(state.scope); }
  const bounds = (ex) => {
    const d = ex.daily.demand.avg_mw;
    const a = d.findIndex((v) => v != null);
    let b = d.length - 1; while (b > 0 && d[b] == null) b--;
    return { first: addDays(ex.daily.start, a), last: addDays(ex.daily.start, b) };
  };
  function currentRange(ex) {
    const { first, last } = bounds(ex);
    const sp = SPANS[state.span];
    if (!sp.days) return { start: first, end: last, first, last };
    let start = state.start || addDays(last, -(sp.days - 1));
    if (start < first) start = first;
    let end = addDays(start, sp.days - 1);
    if (end > last) { end = last; if (state.start == null || addDays(end, -(sp.days - 1)) >= first) start = addDays(end, -(sp.days - 1)); if (start < first) start = first; }
    return { start, end, first, last };
  }

  async function buildView(ex, interval, start, end) {
    const groups = ex.groups;
    if (interval === 'year') {
      const b = ex.yearly;
      return { interval, labels: b.years, demand: { avg: b.demand.avg_mw, max: b.demand.max_mw, min: b.demand.min_mw }, dHours: b.demand.hours, dCov: b.demand.coverage, gen: b.gen?.avg_mw || {}, gHours: b.gen?.hours || [], gCov: b.gen?.coverage || [], expect: null };
    }
    if (interval === 'month') {
      const b = ex.monthly;
      const i0 = Math.max(0, b.months.findIndex((m) => m >= start.slice(0, 7)));
      let i1 = b.months.length - 1; while (i1 > 0 && b.months[i1] > end.slice(0, 7)) i1--;
      const cut = (a) => a.slice(i0, i1 + 1);
      return { interval, labels: cut(b.months), demand: { avg: cut(b.demand.avg_mw), max: cut(b.demand.max_mw), min: cut(b.demand.min_mw) }, dHours: cut(b.demand.hours), dCov: cut(b.demand.coverage),
        gen: Object.fromEntries(Object.entries(b.gen?.avg_mw || {}).map(([k, v]) => [k, cut(v)])), gHours: b.gen ? cut(b.gen.hours) : [], gCov: b.gen ? cut(b.gen.coverage) : [] };
    }
    if (interval === 'day') {
      const b = ex.daily;
      const i0 = Math.max(0, daysBetween(b.start, start)), i1 = Math.min(b.n - 1, daysBetween(b.start, end));
      const cut = (a) => a.slice(i0, i1 + 1);
      const labels = []; for (let i = i0; i <= i1; i++) labels.push(addDays(b.start, i));
      return { interval, labels, demand: { avg: cut(b.demand.avg_mw), max: cut(b.demand.max_mw), min: cut(b.demand.min_mw) }, dHours: cut(b.demand.hours),
        gen: Object.fromEntries(Object.entries(b.gen?.avg_mw || {}).map(([k, v]) => [k, cut(v)])), gHours: b.gen ? cut(b.gen.hours) : [] };
    }
    // hour: assemble from the yearly files that overlap the range
    const t0 = etMidnightUtc(start), t1 = etMidnightUtc(addDays(end, 1));
    const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1 - 1).getUTCFullYear();
    const labels = [], avg = [], gen = Object.fromEntries(groups.map((g) => [g, []]));
    for (let y = y0; y <= y1; y++) {
      if (!ex.hourly_years.includes(y)) continue;
      const sh = await loadHourly(state.scope, y);
      if (!sh) continue;
      const s0 = utcMs(sh.start_utc);
      const a = Math.max(0, Math.ceil((t0 - s0) / 36e5)), b = Math.min(sh.n, Math.ceil((t1 - s0) / 36e5));
      for (let i = a; i < b; i++) {
        labels.push(etStr(s0 + i * 36e5));
        avg.push(sh.demand_mw[i]);
        for (const g of groups) gen[g].push(sh.gen_mw?.[g] ? sh.gen_mw[g][i] : null);
      }
    }
    const hasGen = groups.some((g) => gen[g].some((v) => v != null));
    return { interval, labels, demand: { avg }, gen: hasGen ? gen : {}, hourly: true };
  }

  // ---------------------------------------------------------------- drawing
  const fmtTitle = (view, label) => (view.interval === 'hour' ? `${dayLabel(label.slice(0, 10))}, ${label.slice(11)} ET` : view.interval === 'day' ? dayLabel(label) : view.interval === 'month' ? monLabel(label) : label);
  // long series: one tick per January so the labels sit on real year boundaries
  const yearStart = (view, l) => (view.interval === 'day' ? l.endsWith('-01-01') : view.interval === 'month' ? l.endsWith('-01') : false);
  const tickFmt = (view) => {
    const n = view.labels.length;
    const longDay = view.interval === 'day' && n > 700, longMon = view.interval === 'month' && n > 60;
    return (v) => {
      const l = view.labels[v]; if (!l) return '';
      if (longDay || longMon) return yearStart(view, l) ? l.slice(0, 4) : '';
      if (view.interval === 'hour') return n <= 72 ? `${MON[Number(l.slice(5, 7)) - 1]} ${Number(l.slice(8, 10))} ${l.slice(11)}` : dayLabel(l.slice(0, 10));
      if (view.interval === 'day') return dayLabel(l);
      if (view.interval === 'month') return monLabel(l);
      return l;
    };
  };
  const relKey = (view) => ({ hour: '2022-11-30 00:00', day: '2022-11-30', month: '2022-11', year: '2022' }[view.interval]);
  const covNote = (view, i) => {
    if (view.interval === 'hour') return '';
    if (view.dCov && view.dCov[i] != null && view.dCov[i] < 0.95) return `Partial: ${Math.round(100 * view.dCov[i])}% of the hours present`;
    if (view.interval === 'day' && view.dHours && view.dHours[i] != null && view.dHours[i] < 24 && view.dHours[i] > 0) return `${view.dHours[i]} hours present`;
    return '';
  };
  const baseOpts = (view, ytitle) => ({
    maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, spanGaps: false,
    scales: { x: { grid: { display: false }, ticks: { autoSkip: !((view.interval === 'day' && view.labels.length > 700) || (view.interval === 'month' && view.labels.length > 60)), maxTicksLimit: 12, maxRotation: 0, callback: tickFmt(view) } }, y: { title: { display: true, text: ytitle }, grid: { color: GRID }, ticks: { callback: (v) => nf0.format(v) } } },
  });

  function drawDemand(view) {
    const d = view.demand, hour = view.hourly || view.interval === 'hour';
    const ds = [];
    if (!hour) {
      ds.push({ label: 'Highest hour', data: d.max, borderColor: BAND, borderWidth: 1, pointRadius: 0, pointHoverRadius: 3, tension: 0 });
      ds.push({ label: 'Lowest hour', data: d.min, borderColor: BAND, borderWidth: 1, pointRadius: 0, pointHoverRadius: 3, tension: 0 });
    }
    ds.push({ label: hour ? 'Demand' : 'Average', data: d.avg, borderColor: DEMAND_COLOR, borderWidth: view.labels.length > 2000 ? 1.2 : 2, pointRadius: view.labels.length <= 40 ? 3 : 0, pointHoverRadius: 4, tension: 0 });
    const o = baseOpts(view, 'Demand (MW)');
    o.plugins = { legend: { display: false }, tooltip: { itemSort: (a, b) => b.parsed.y - a.parsed.y, callbacks: { title: (it) => fmtTitle(view, it[0].label), label: (c) => `${c.dataset.label}: ${nf0.format(c.parsed.y)} MW`, afterBody: (it) => covNote(view, it[0].dataIndex) } } };
    o.scales.y.grace = '6%';
    charts.push(new Chart(fDem.cv, { type: 'line', data: { labels: view.labels, datasets: ds }, options: o, plugins: [releaseMarker(view.labels, relKey(view), 'bottom')] }));
    fDem.legend.innerHTML = `<span><i class="line" style="background:${DEMAND_COLOR}"></i>${hour ? 'Demand in the hour' : 'Average over the interval'}</span>${hour ? '' : `<span><i class="line" style="background:${BAND}"></i>Highest and lowest hour in it</span>`}`;
    fDem.note.textContent = ({ hour: 'Demand in each hour, as reported to EIA-930, in MW. Times are Eastern.', day: 'Average, highest and lowest hour of each day, in MW. Days with fewer than 20 hours of data are blank.', month: 'Average, highest and lowest hour of each month, in MW. A month with under 95% of its hours is marked partial in the tooltip.', year: 'Average, highest and lowest hour of each calendar year, in MW. A year with under 95% of its hours is marked partial in the tooltip.' })[view.interval];
  }

  function drawGen(view, ex) {
    const keys = ex.groups.filter((k) => view.gen[k] && view.gen[k].some((v) => v != null));
    const stack = keys.filter((k) => k !== 'storage');
    if (!keys.length) {
      fGen.box.hidden = true; fGen.legend.innerHTML = '';
      fGen.note.textContent = 'EIA-930 has no net generation by fuel for this period. It starts in July 2018. The EIA-923 monthly chart below goes further back for the U.S.';
      return;
    }
    fGen.box.hidden = false;
    const ds = stack.map((k) => ({ label: gl[k], data: view.gen[k], backgroundColor: FUEL_COLOR[k], borderColor: FUEL_COLOR[k], borderWidth: 0.6, fill: true, pointRadius: 0, pointHoverRadius: 3, tension: 0, stack: 'mix' }));
    if (keys.includes('storage')) ds.push({ label: `${gl.storage} (net, can be negative)`, data: view.gen.storage, borderColor: FUEL_COLOR.storage, backgroundColor: FUEL_COLOR.storage, borderWidth: 1.5, fill: false, pointRadius: 0, pointHoverRadius: 3, tension: 0, stack: 'storage' });
    if (state.overlay) ds.push({ label: 'Demand', data: view.demand.avg, borderColor: DEMAND_COLOR, borderWidth: 1.6, borderDash: [5, 3], fill: false, pointRadius: 0, pointHoverRadius: 3, tension: 0, stack: 'demand' });
    const o = baseOpts(view, 'Net generation (MW)');
    o.scales.y.stacked = true;
    o.plugins = { legend: { display: false }, tooltip: { itemSort: (a, b) => b.datasetIndex - a.datasetIndex, callbacks: { title: (it) => fmtTitle(view, it[0].label), label: (c) => `${c.dataset.label}: ${nf0.format(c.parsed.y)} MW`, afterBody: (it) => (view.gHours && view.gHours[it[0].dataIndex] != null && view.interval !== 'hour' && view.gCov && view.gCov[it[0].dataIndex] != null && view.gCov[it[0].dataIndex] < 0.95 ? `Partial: ${Math.round(100 * view.gCov[it[0].dataIndex])}% of the hours present` : '') } } };
    charts.push(new Chart(fGen.cv, { type: 'line', data: { labels: view.labels, datasets: ds }, options: o, plugins: [releaseMarker(view.labels, relKey(view), 'bottom')] }));
    fGen.legend.innerHTML = keys.map((k) => `<span><i style="background:${FUEL_COLOR[k]}"></i>${esc(gl[k])}</span>`).join('') + (state.overlay ? `<span><i class="line" style="background:${DEMAND_COLOR}"></i>Demand</span>` : '')
      + `<label class="xctl__check"><input type="checkbox" id="xOverlay" ${state.overlay ? 'checked' : ''}> Show demand on this chart</label>`;
    fGen.legend.querySelector('#xOverlay').addEventListener('change', (e) => { state.overlay = e.target.checked; refresh(); });
    fGen.note.textContent = `Net generation by fuel, ${({ hour: 'each hour', day: 'average of each day', month: 'average of each month', year: 'average of each calendar year' })[view.interval]}, in MW, stacked${keys.includes('storage') ? '; storage is a separate line because it is negative while charging' : ''}. Generation is not the same as demand: power also moves in and out of the area, and the two series are reported separately.`;
  }

  function draw923(view, ex) {
    const m = ex.monthly_923;
    if (!m || !['month', 'year'].includes(view.interval)) {
      f923.el.hidden = true; return;
    }
    f923.el.hidden = false;
    const hoursOf = (mm) => new Date(Number(mm.slice(0, 4)), Number(mm.slice(5, 7)), 0).getDate() * 24;
    const keys = Object.keys(m.gwh);
    let labels, series;
    if (view.interval === 'month') {
      const sel = m.months.map((mm, i) => i).filter((i) => view.labels.includes(m.months[i]) || (view.labels.length && m.months[i] >= view.labels[0] && m.months[i] <= view.labels[view.labels.length - 1]));
      labels = sel.map((i) => m.months[i]);
      series = Object.fromEntries(keys.map((k) => [k, sel.map((i) => (m.gwh[k][i] == null ? null : (m.gwh[k][i] * 1000) / hoursOf(m.months[i])))]));
    } else {
      const ys = [...new Set(m.months.map((x) => x.slice(0, 4)))];
      labels = ys;
      series = Object.fromEntries(keys.map((k) => [k, ys.map((y) => {
        const ix = m.months.map((x, i) => i).filter((i) => m.months[i].startsWith(y) && m.gwh[k][i] != null);
        const h = ix.reduce((a, i) => a + hoursOf(m.months[i]), 0);
        return h ? (ix.reduce((a, i) => a + m.gwh[k][i], 0) * 1000) / h : null;
      })]));
    }
    const stack = keys.filter((k) => k !== 'storage');
    const ds = stack.map((k) => ({ label: gl[k], data: series[k], backgroundColor: FUEL_COLOR[k], borderColor: FUEL_COLOR[k], borderWidth: 0.6, fill: true, pointRadius: 0, pointHoverRadius: 3, tension: 0, stack: 'mix' }));
    if (keys.includes('storage')) ds.push({ label: `${gl.storage} (pumped storage, net)`, data: series.storage, borderColor: FUEL_COLOR.storage, borderWidth: 1.5, fill: false, pointRadius: 0, pointHoverRadius: 3, tension: 0, stack: 'storage' });
    const v2 = { interval: view.interval, labels };
    const o = baseOpts(v2, 'Net generation (MW)');
    o.scales.y.stacked = true;
    o.plugins = { legend: { display: false }, tooltip: { itemSort: (a, b) => b.datasetIndex - a.datasetIndex, callbacks: { title: (it) => fmtTitle(v2, it[0].label), label: (c) => `${c.dataset.label}: ${nf0.format(c.parsed.y)} MW` } } };
    charts.push(new Chart(f923.cv, { type: 'line', data: { labels, datasets: ds }, options: o, plugins: [releaseMarker(labels, view.interval === 'month' ? '2022-11' : '2022', 'bottom')] }));
    f923.legend.innerHTML = keys.map((k) => `<span><i style="background:${FUEL_COLOR[k]}"></i>${esc(gl[k])}</span>`).join('');
    f923.note.textContent = 'Monthly net generation by fuel from EIA-923 (what plants report), for all 50 states and DC, shown as average MW so it sits on the same scale as the chart above. It is a different survey from EIA-930, covers more than the Lower 48, and reaches back before July 2018. "Other" is the all-fuels total minus the fuels listed.';
  }

  // ---------------------------------------------------------------- table and CSV
  function tableData(view, ex) {
    const keys = ex.groups.filter((k) => view.gen[k] && view.gen[k].some((v) => v != null));
    const hour = view.interval === 'hour';
    const head = [hour ? 'Hour (Eastern)' : 'Period', hour ? 'Demand (MW)' : 'Demand, average (MW)'].concat(hour ? [] : ['Demand, highest hour (MW)', 'Demand, lowest hour (MW)', 'Demand hours present'])
      .concat(keys.map((k) => `${gl[k]} (MW)`)).concat(!hour && keys.length ? ['Generation hours present'] : []);
    const rows = view.labels.map((l, i) => [l, view.demand.avg[i]].concat(hour ? [] : [view.demand.max[i], view.demand.min[i], view.dHours?.[i] ?? null])
      .concat(keys.map((k) => view.gen[k][i])).concat(!hour && keys.length ? [view.gHours?.[i] ?? null] : []));
    return { head, rows };
  }
  const csv = (t) => [t.head.join(',')].concat(t.rows.map((r) => r.map((v) => (v == null ? '' : v)).join(','))).join('\n');
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  let lastView = null, lastEx = null;

  // ---------------------------------------------------------------- controls
  function syncControls(ex, rng) {
    $('xPlace').innerHTML = scopes.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === state.scope}">${esc(l)}</button>`).join('');
    $('xInt').innerHTML = INTERVALS.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === state.interval}">${l}</button>`).join('');
    $('xSpan').innerHTML = ALLOWED[state.interval].map((k) => `<button type="button" data-k="${k}" aria-pressed="${k === state.span}">${SPANS[k].label}</button>`).join('');
    const all = state.span === 'all';
    $('xStart').value = rng.start; $('xStart').min = rng.first; $('xStart').max = rng.last; $('xStart').disabled = all;
    $('xPrev').disabled = all || rng.start <= rng.first; $('xNext').disabled = all || rng.end >= rng.last; $('xLatest').disabled = all || rng.end >= rng.last;
    $('xNote').textContent = state.interval === 'hour' ? 'Hourly data are shown up to a year at a time (about 8,800 points). Choose a start date and a length of time.' : '';
  }

  async function refresh() {
    const my = ++token;
    charts.splice(0).forEach((c) => c.destroy());
    const ex = await explorer();
    if (!ex) {
      root.querySelector('#xFigs').innerHTML = `<div class="errorbox"><h2>The explorer data has not been built yet</h2><p>Run <code>python3 -m pipeline.fetch_eia</code> and then <code>python3 -m pipeline.build_site_data</code>.</p></div>`;
      return;
    }
    const rng = currentRange(ex);
    state.start = state.span === 'all' ? null : rng.start;
    syncControls(ex, rng);
    fDem.note.textContent = fGen.note.textContent = 'Loading…';
    const view = await buildView(ex, state.interval, rng.start, rng.end);
    if (my !== token) return;
    lastView = view; lastEx = ex;
    if (!view.labels.length) { fDem.note.textContent = 'No data in this range.'; return; }
    drawDemand(view); drawGen(view, ex); draw923(view, ex);
    const label = Object.fromEntries(scopes)[state.scope];
    fDem.foot.innerHTML = `Source: EIA Open Data API, <code>electricity/rto/region-data</code> (EIA-930, type D, respondent ${esc(ex.series)}). Outliers screened as described on Sources and method. Nothing is filled in.`;
    fGen.foot.innerHTML = `Source: EIA Open Data API, <code>electricity/rto/fuel-type-data</code> (EIA-930, respondent ${esc(ex.series)}), grouped by the fuel lookup on Sources and method. ${state.scope === 'pjm' ? 'PJM reports no storage codes to EIA-930, so there is no storage line.' : ''}`;
    f923.foot.innerHTML = `Source: EIA Open Data API, <code>electricity/electric-power-operational-data</code> (EIA-923), U.S., all sectors.`;
    $('x923').hidden = !ex.monthly_923;
    const t = tableData(view, ex);
    const cap = 500;
    $('xTblNote').textContent = `${label}, by ${state.interval}: ${nf0.format(view.labels.length)} rows${view.labels.length > cap ? `; the first ${cap} are shown here, and the download has every row` : ''}.`;
    $('xTbl').innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr>${t.head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.slice(0, cap).map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row" style="font-weight:500;white-space:nowrap">${esc(c)}</th>` : `<td>${c == null ? '' : nf0.format(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (b) {
      const par = b.parentElement.id, k = b.dataset.k;
      if (par === 'xPlace') { state.scope = k; state.start = null; }
      else if (par === 'xInt') { state.interval = k; if (!ALLOWED[k].includes(state.span)) state.span = DEFAULT_SPAN[k]; state.start = null; if (k === 'hour' && state.span === 'all') state.span = 'm1'; }
      else if (par === 'xSpan') { state.span = k; state.start = null; }
      refresh();
      return;
    }
    if (e.target.id === 'xPrev' || e.target.id === 'xNext') {
      const sp = SPANS[state.span]; if (!sp.days) return;
      state.start = addDays(state.start, (e.target.id === 'xPrev' ? -1 : 1) * sp.days); refresh();
    } else if (e.target.id === 'xLatest') { state.start = null; refresh(); }
    else if (e.target.id === 'xCsv' && lastView) download(`${state.scope}_${state.interval}_shown.csv`, csv(tableData(lastView, lastEx)));
    else if (e.target.id === 'xCsvAll' && lastEx) {
      e.target.disabled = true; e.target.textContent = 'Preparing…';
      buildView(lastEx, state.interval, bounds(lastEx).first, bounds(lastEx).last).then((v) => {
        download(`${state.scope}_${state.interval}_all.csv`, csv(tableData(v, lastEx)));
      }).finally(() => { e.target.disabled = false; e.target.textContent = 'Download this interval for all years (CSV)'; });
    } else if (e.target.id === 'x923' && lastEx?.monthly_923) {
      const m = lastEx.monthly_923, keys = Object.keys(m.gwh);
      download('us_eia923_monthly_gwh.csv', ['month,all fuels (GWh),' + keys.map((k) => `${gl[k]} (GWh)`).join(',')].concat(m.months.map((mm, i) => [mm, m.total_gwh[i]].concat(keys.map((k) => m.gwh[k][i])).map((v) => (v == null ? '' : v)).join(','))).join('\n'));
    }
  });
  root.querySelector('#xStart').addEventListener('change', (e) => { if (e.target.value) { state.start = e.target.value; refresh(); } });

  // what the data hold, so nothing is hidden
  (async () => {
    const parts = [];
    for (const [k, l] of scopes) {
      const ex = await loadExplorer(k);
      if (!ex) continue;
      const ft = (iso) => (iso ? `${monLabel(iso.slice(0, 7))}` : 'n/a');
      parts.push([`${l}: demand`, `${ft(ex.hourly_start_utc)} to ${ft(ex.hourly_end_utc)}`, `${nf0.format(meta.explorer?.[k]?.demand_hours_present ?? 0)} hours`]);
      parts.push([`${l}: generation by fuel`, `${ft(ex.gen_first_hour_utc)} to ${ft(ex.hourly_end_utc)}`, ex.groups.map((g) => gl[g]).join(', ')]);
      if (ex.monthly_923) parts.push([`${l}: EIA-923 monthly generation`, `${monLabel(ex.monthly_923.months[0])} to ${monLabel(ex.monthly_923.months[ex.monthly_923.months.length - 1])}`, 'plant-reported, 50 states and DC']);
    }
    $('xl').innerHTML = parts.map(([k, v, s], i) => `<div style="--ledger:${['#17404e', '#e0903f', '#7aa6b8', '#35aa76', '#6f97b3', '#ce5d89'][i % 6]}"><dt>${esc(k)}</dt><dd>${esc(v)}<small>${esc(s)}</small></dd></div>`).join('');
  })();

  await refresh();
  return () => { token++; charts.splice(0).forEach((c) => c.destroy()); };
}

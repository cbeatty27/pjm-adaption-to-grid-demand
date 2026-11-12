import { Chart, registerables } from 'chart.js';
import { FUEL_COLOR, TIME } from '../lib/fuels.js';
import { esc, nf0, nf1, pct, pp, ymLabel, ymIndex, sum } from '../lib/format.js';

Chart.register(...registerables);
Chart.defaults.font.family = "'Instrument Sans', system-ui, sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#3f5c68';
Chart.defaults.animation = false;
Object.assign(Chart.defaults.plugins.tooltip, {
  backgroundColor: '#15323d', titleColor: '#ffffff', bodyColor: '#e6eef0', cornerRadius: 8, padding: 10, boxPadding: 4,
  titleFont: { weight: '600' },
});

const GRID = '#e6eef0';
const INK = '#15323d';
const DC_COLOR = '#17404e';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function table(headers, rows) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row" style="font-weight:500">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

// A figure that can show several views of the same data, plus a table. Each view is
// { id, label, note, legend, height, draw(canvas) -> Chart } or { id, label, note, table }.
function figure(host, { title, lead = '', callout = '', views, foot }) {
  const el = document.createElement('section');
  el.className = 'fig';
  el.innerHTML = `<div class="fig__head"><h3>${esc(title)}</h3><p class="fig__note"></p></div>
    ${lead}${callout ? `<div class="callout" style="margin-top:14px">${callout}</div>` : ''}
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

const simple = (host, o) => figure(host, {
  title: o.title, foot: o.foot, lead: o.lead,
  views: [{ id: 'chart', label: 'Chart', note: o.note, legend: o.legend, height: o.height, draw: o.draw }, { id: 'table', label: 'Table', note: o.note, table: o.tableHtml }],
});

const yearTicks = (labels) => ({
  autoSkip: false, maxRotation: 0,
  callback(v) { const l = labels[v]; return l && l.endsWith('-01') ? l.slice(0, 4) : ''; },
});

// vertical dashed marker at the ChatGPT release month
const releaseMarker = (labels, key, where = 'top') => ({
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
const pointTags = (tags) => ({
  id: 'ptags',
  afterDatasetsDraw(chart) {
    const { ctx, scales } = chart;
    ctx.save(); ctx.font = "600 12px 'Instrument Sans', sans-serif"; ctx.fillStyle = INK;
    tags.forEach((t) => {
      const v = chart.data.datasets[t.ds].data[t.i];
      if (v == null) return;
      ctx.textAlign = t.align || 'left';
      ctx.fillText(t.text, scales.x.getPixelForValue(t.i) + (t.dx || 0), scales.y.getPixelForValue(v) + (t.dy || -9));
    });
    ctx.restore();
  },
});

// value text at the end of horizontal bars
const barEndLabels = (fmt) => ({
  id: 'barEnd',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save(); ctx.font = "600 12px 'Instrument Sans', sans-serif"; ctx.fillStyle = INK; ctx.textBaseline = 'middle';
    chart.getDatasetMeta(0).data.forEach((bar, i) => {
      const v = chart.data.datasets[0].data[i];
      if (v == null) return;
      ctx.textAlign = v >= 0 ? 'left' : 'right';
      ctx.fillText(fmt(i, v), v >= 0 ? bar.x + 8 : bar.x - 8, bar.y);
    });
    ctx.restore();
  },
});

export function mount(root, data) {
  const { meta, demand, fuel, units, dcs } = data;
  const groups = meta.groups;
  const gl = Object.fromEntries(groups.map((g) => [g.key, g.label]));
  const parts = [];
  const cmp = demand.comparison;
  const b = cmp.baseline, l = cmp.latest;
  const fb = fuel.comparison.baseline, fl = fuel.comparison.latest;
  const tot = (o) => sum(Object.entries(o.gwh).filter(([k]) => k !== 'storage').map(([, v]) => v));
  const share = (o, k) => (100 * o.gwh[k]) / tot(o);
  const dem = (x, y) => (100 * (y - x)) / x;
  const f1 = (v) => Math.abs(v).toFixed(1);
  const sgn = (v) => `${v >= 0 ? '+' : '−'}${f1(v)}`;
  const dMin = meta.demand.min_coverage ?? 0.97;
  const fMin = meta.fuel.min_coverage ?? 0.97;

  root.innerHTML = `<div class="doc">
    <div class="doc__intro">
      <h2>PJM's demand, supply and fuel mix since ChatGPT's release</h2>
      <p>This page compares two 12-month windows: <strong>${esc(ymLabel(b.from))} to ${esc(ymLabel(b.to))}</strong>, the year before ChatGPT's public release on November 30, 2022, and <strong>${esc(ymLabel(l.from))} to ${esc(ymLabel(l.to))}</strong>, the latest 12 complete months in the data. Demand and fuel mix are EIA-930 figures for the PJM balancing authority. Generator additions are from EIA's generator inventory.</p>
      <p>The figures show what changed and when. They do not attribute any change to data centers or to any other cause.</p>
    </div>
    <dl class="ledger" id="ledger"></dl>
    <div id="figs"></div></div>`;

  // ---- ledger ----
  const winUnits = units.filter((u) => u.state_cls === 'operating' && u.online && ymIndex(u.online) > ymIndex(meta.window_start.slice(0, 7)) && ymIndex(u.online) <= ymIndex(meta.plants.snapshot_period));
  const addedMw = sum(winUnits.map((u) => u.mw));
  const dTot = (tot(fl) - tot(fb)) / 1000;
  root.querySelector('#ledger').innerHTML = [
    ['Average hourly demand', `${nf0.format(l.avg_mw)} MW`, `${pct(dem(b.avg_mw, l.avg_mw))} vs ${nf0.format(b.avg_mw)} MW the year before`, TIME.warm],
    ['Generation, all fuels', `${nf1.format(tot(fl) / 1000)} TWh`, `${sgn(dTot)} TWh (${pct(dem(tot(fb), tot(fl)))}) vs the year before`, '#7aa6b8'],
    ['Natural gas share of generation', `${nf1.format(share(fl, 'gas'))}%`, `${pp(share(fl, 'gas') - share(fb, 'gas'))} vs ${nf1.format(share(fb, 'gas'))}% the year before`, FUEL_COLOR.gas],
    ['Generators online since Dec 2022', `${nf0.format(addedMw)} MW`, `${nf0.format(winUnits.length)} units, nameplate (EIA)`, '#1f7a8c'],
  ].map(([k, v, s, c]) => `<div style="--ledger:${c}"><dt>${esc(k)}</dt><dd>${esc(v)}<small>${esc(s)}</small></dd></div>`).join('');

  const figs = root.querySelector('#figs');
  const push = (f) => parts.push(f);

  // ---- 1. demand ----
  {
    const M = demand.monthly;
    const okM = M.months.map((_, i) => M.coverage[i] >= dMin);
    const days = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
    const hrs = M.months.map((m) => days(m) * 24);
    const years = [...new Set(M.months.filter((_, i) => okM[i]).map((m) => Number(m.slice(0, 4))))];
    const yearColor = (y) => (y <= 2022 ? TIME.coolRamp[Math.min(3, Math.max(0, y - 2019))] : TIME.warmRamp[Math.min(3, y - 2023)]);

    // before / after tiles
    const tiles = [['Average hour', b.avg_mw, l.avg_mw], ['Highest hour', b.peak_mw, l.peak_mw], ['Lowest hour', b.min_mw, l.min_mw]];
    const lead = `<div class="cmps">${tiles.map(([k, x, y]) => {
      const mx = Math.max(x, y), d = dem(x, y);
      return `<div class="cmp"><div class="cmp__k"><span>${k}</span><span class="cmp__d ${d < 0 ? 'down' : ''}">${pct(d)}</span></div>
        <div class="cmp__row"><span>Before</span><div class="track"><i class="before" style="width:${(100 * x) / mx}%"></i></div><b>${nf1.format(x / 1000)} GW</b></div>
        <div class="cmp__row"><span>Latest</span><div class="track"><i class="after" style="width:${(100 * y) / mx}%"></i></div><b>${nf1.format(y / 1000)} GW</b></div></div>`;
    }).join('')}</div>`;

    const foot = `Source: EIA Open Data API, route <code>electricity/rto/region-data</code> (EIA-930, type D, respondent PJM). Hours with a non-positive value were dropped (${nf0.format(meta.demand.non_positive_rows_dropped)} of ${nf0.format(meta.demand.hourly_rows)}), and so were ${nf0.format(meta.demand.outlier_hours_dropped_pjm ?? 0)} PJM-wide hours that are more than 1.5 times or under half the median of the surrounding 7 days (EIA-930 contains impossible values; see Sources and method). Months with under ${Math.round(dMin * 100)}% of expected hours are left out${meta.demand.partial_months.length ? ` (${esc(meta.demand.partial_months.join(', '))})` : ''}. Months are grouped in Eastern time.`;

    // view 1: each year by month
    const byYear = years.map((y) => {
      const arr = Array(12).fill(null);
      M.months.forEach((m, i) => { if (okM[i] && Number(m.slice(0, 4)) === y) arr[Number(m.slice(5, 7)) - 1] = M.avg_mw[i]; });
      return { y, arr };
    });
    const latestY = years[years.length - 1];
    const v1 = {
      id: 'years', label: 'Each year by month',
      note: 'Average hourly demand in each calendar month, one line per year. Cool lines are 2019 to 2022 and warm lines are 2023 on, darker for later years, so a line sitting above the one before it means more demand in that month.',
      legend: byYear.map(({ y }) => `<span><i class="line" style="background:${yearColor(y)}"></i>${y}</span>`).join(''),
      draw: (cv) => new Chart(cv, {
        type: 'line',
        data: { labels: MONTHS, datasets: byYear.map(({ y, arr }) => ({ label: String(y), data: arr, borderColor: yearColor(y), backgroundColor: yearColor(y), borderWidth: y === latestY ? 3.5 : 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, spanGaps: false })) },
        options: {
          maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { itemSort: (a, c) => c.parsed.y - a.parsed.y, callbacks: { label: (c) => `${c.dataset.label}: ${nf0.format(c.parsed.y)} MW` } } },
          scales: { x: { grid: { display: false } }, y: { title: { display: true, text: 'Average hourly demand (MW)' }, grid: { color: GRID }, ticks: { callback: (v) => nf0.format(v) } } },
        },
      }),
    };

    // view 2: rolling 12 months
    const roll = M.months.map((_, i) => {
      if (i < 11) return null;
      let hw = 0, h = 0, pk = 0;
      for (let k = i - 11; k <= i; k++) { if (!okM[k]) return null; hw += M.avg_mw[k] * hrs[k]; h += hrs[k]; pk = Math.max(pk, M.peak_mw[k]); }
      return { avg: hw / h, peak: pk };
    });
    const first = roll.findIndex((r) => r);
    const rl = M.months.slice(first);
    const ravg = roll.slice(first).map((r) => (r ? r.avg : null));
    const rrel = rl.indexOf('2022-11');
    const lastR = rl.length - 1;
    const v2 = {
      id: 'rolling', label: 'Rolling 12 months',
      note: 'Each point is the average hour over the 12 months ending in that month, so seasons cancel out and the trend shows. The line is cool up to ChatGPT\'s release and warm after. The axis does not start at zero.',
      legend: `<span><i class="line" style="background:${TIME.cool}"></i>Before the release</span><span><i class="line" style="background:${TIME.warm}"></i>After</span>`,
      draw: (cv) => new Chart(cv, {
        type: 'line',
        data: { labels: rl, datasets: [
          { label: 'Average hour, 12 months', data: ravg, borderColor: TIME.cool, borderWidth: 4, pointRadius: 0, pointHoverRadius: 5, tension: 0.2, segment: { borderColor: (c) => (c.p1.parsed.x >= rrel ? TIME.warm : TIME.cool) } },
        ] },
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
    };

    // peak hour per calendar year
    const pk = years.map((y) => ({ y, v: Math.max(...M.months.map((m, i) => (okM[i] && Number(m.slice(0, 4)) === y ? M.peak_mw[i] : 0))), n: M.months.filter((m, i) => okM[i] && Number(m.slice(0, 4)) === y).length }));
    const vPeak = {
      id: 'peak', label: 'Highest hour',
      note: 'The single highest hour of demand in each calendar year. A year with fewer than 12 months of data is marked with the months covered.',
      legend: `<span><i style="background:${TIME.cool}"></i>2022 and earlier</span><span><i style="background:${TIME.warm}"></i>2023 on</span>`,
      draw: (cv) => new Chart(cv, {
        type: 'bar',
        data: { labels: pk.map((r) => (r.n < 12 ? `${r.y} (${r.n} mo)` : String(r.y))), datasets: [{ data: pk.map((r) => r.v), backgroundColor: pk.map((r) => (r.y <= 2022 ? TIME.cool : TIME.warm)), borderRadius: 6, maxBarThickness: 56 }] },
        options: {
          maintainAspectRatio: false, layout: { padding: { top: 22 } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `Highest hour: ${nf0.format(c.parsed.y)} MW` } } },
          scales: { x: { grid: { display: false } }, y: { min: 0, title: { display: true, text: 'MW' }, grid: { color: GRID }, ticks: { callback: (v) => nf0.format(v) } } },
        },
        plugins: [{
          id: 'topvals',
          afterDatasetsDraw(chart) {
            const { ctx } = chart; ctx.save(); ctx.font = "600 12px 'Instrument Sans', sans-serif"; ctx.fillStyle = INK; ctx.textAlign = 'center';
            chart.getDatasetMeta(0).data.forEach((bar, i) => ctx.fillText(nf0.format(pk[i].v), bar.x, bar.y - 6));
            ctx.restore();
          },
        }],
      }),
    };

    // view 3: year over year
    const yl = M.months.slice(12);
    const yv = yl.map((_, j) => { const i = j + 12; return okM[i] && okM[i - 12] ? dem(M.avg_mw[i - 12], M.avg_mw[i]) : null; });
    const v3 = {
      id: 'yoy', label: 'Versus a year earlier',
      note: 'Average hourly demand in each month compared with the same month one year before. Cool bars are months up to ChatGPT\'s release, warm bars are after. Weather moves single months, so look at the run of bars rather than any one.',
      legend: `<span><i style="background:${TIME.cool}"></i>Up to Nov 2022</span><span><i style="background:${TIME.warm}"></i>Dec 2022 on</span>`,
      draw: (cv) => new Chart(cv, {
        type: 'bar',
        data: { labels: yl, datasets: [{ data: yv, backgroundColor: yl.map((m) => (m < '2022-12' ? TIME.cool : TIME.warm)), borderRadius: 2, maxBarThickness: 12 }] },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => `${ymLabel(it[0].label)} vs ${ymLabel(`${Number(it[0].label.slice(0, 4)) - 1}${it[0].label.slice(4)}`)}`, label: (c) => `Change: ${pct(c.parsed.y)}` } } },
          scales: { x: { grid: { display: false }, ticks: yearTicks(yl) }, y: { title: { display: true, text: 'Change vs same month a year earlier (%)' }, grid: { color: GRID }, ticks: { callback: (v) => `${v}%` } } },
        },
      }),
    };

    const rows = M.months.map((m, i) => (okM[i] ? [m, nf0.format(M.avg_mw[i]), nf0.format(M.peak_mw[i]), nf0.format(M.min_mw[i])] : null)).filter(Boolean);
    const v4 = { id: 'table', label: 'Table', table: table(['Month', 'Average hour (MW)', 'Highest hour (MW)', 'Lowest hour (MW)'], rows) };

    push(figure(figs, {
      title: `Demand is ${f1(dem(b.avg_mw, l.avg_mw))}% ${l.avg_mw >= b.avg_mw ? 'higher' : 'lower'} than in the year before ChatGPT's release`,
      lead, views: [v2, v1, v3, vPeak, v4], foot,
    }));
  }

  // ---- 2. zones ----
  {
    const zs = Object.entries(cmp.zones).map(([z, v]) => ({ z, name: demand.zones[z]?.name || z, base: v.baseline.avg_mw, last: v.latest.avg_mw, ch: dem(v.baseline.avg_mw, v.latest.avg_mw) })).sort((a, c) => c.ch - a.ch);
    if (zs.length) {
      const top = zs[0];
      push(simple(figs, {
        title: `${top.name} grew fastest among PJM zones: ${pct(top.ch)} in average hourly demand`,
        note: 'Change in average hourly demand by EIA-930 subregion, latest 12 months against the 12 months before ChatGPT\'s release. Warm bars grew, cool bars shrank. Subregions are the zones PJM reports to EIA; boundaries are not drawn here.',
        foot: 'Source: EIA Open Data API, route <code>electricity/rto/region-sub-ba-data</code> (parent PJM). Zone totals can differ slightly from the PJM-wide series. The same hour-screening rule as the PJM-wide series is applied to each zone.',
        tableHtml: table(['Zone', `Avg MW ${ymLabel(b.from)}–${ymLabel(b.to)}`, `Avg MW ${ymLabel(l.from)}–${ymLabel(l.to)}`, 'Change'], zs.map((r) => [`${r.name} (${r.z})`, nf0.format(r.base), nf0.format(r.last), pct(r.ch)])),
        height: Math.max(260, zs.length * 26 + 70),
        draw: (cv) => new Chart(cv, {
          type: 'bar',
          data: { labels: zs.map((r) => r.z), datasets: [{ data: zs.map((r) => r.ch), backgroundColor: zs.map((r) => (r.ch >= 0 ? TIME.warm : TIME.cool)), borderRadius: 4, barThickness: 14 }] },
          options: {
            indexAxis: 'y', maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => { const r = zs[it[0].dataIndex]; return `${r.name} (${r.z})`; }, label: (c) => { const r = zs[c.dataIndex]; return [`Change: ${pct(r.ch)}`, `${nf0.format(r.base)} MW to ${nf0.format(r.last)} MW`]; } } } },
            scales: { x: { grid: { color: GRID }, title: { display: true, text: 'Change in average hourly demand (%)' }, ticks: { callback: (v) => `${v}%` } }, y: { grid: { display: false } } },
          },
        }),
      }));
    }
  }

  // ---- 3. fuel mix and natural gas ----
  {
    const idx = fuel.months.map((_, i) => i);
    const okF = fuel.months.map((_, i) => fuel.coverage[i] >= fMin);
    const keys = groups.map((g) => g.key).filter((k) => k !== 'storage');
    const delta = keys.map((k) => ({ k, d: (fl.gwh[k] - fb.gwh[k]) / 1000, p: dem(fb.gwh[k], fl.gwh[k]) }));
    const byDelta = delta.slice().sort((a, c) => c.d - a.d);
    const gas = delta.find((x) => x.k === 'gas');
    const coal = delta.find((x) => x.k === 'coal');
    const grossUp = sum(delta.filter((x) => x.d > 0).map((x) => x.d));
    const topUp = byDelta[0];
    const gasUnits = winUnits.filter((u) => u.group === 'gas');
    const title = topUp.k === 'gas'
      ? `Natural gas supplied the largest increase in PJM generation: ${sgn(gas.d)} TWh`
      : `${gl[topUp.k]} grew most in PJM generation (${sgn(topUp.d)} TWh); natural gas changed ${sgn(gas.d)} TWh`;
    const callout = `<b>Natural gas:</b> ${nf1.format(fl.gwh.gas / 1000)} TWh in the latest 12 months against ${nf1.format(fb.gwh.gas / 1000)} TWh before, ${sgn(gas.d)} TWh (${pct(gas.p)}).`
      + (gas.d > 0 && grossUp > 0 ? ` That is ${nf0.format((100 * gas.d) / grossUp)}% of the combined increase across the fuels that grew (${nf1.format(grossUp)} TWh).` : '')
      + (coal && coal.d < 0 ? ` Coal fell ${f1(coal.d)} TWh.` : '')
      + ` Gas supplied ${nf1.format(share(fl, 'gas'))}% of generation, ${pp(share(fl, 'gas') - share(fb, 'gas'))} on the year before. EIA lists ${nf0.format(gasUnits.length)} gas units (${nf0.format(sum(gasUnits.map((u) => u.mw)))} MW nameplate) reaching operation since Dec 2022; the generation figures cover every gas unit, new and existing.`;

    // view 1: change by fuel
    const rows1 = byDelta.concat([{ k: 'all', d: dTot, p: dem(tot(fb), tot(fl)) }]);
    const v1 = {
      id: 'change', label: 'What changed', height: 360,
      note: `Change in net generation by fuel, latest 12 months against the 12 months before ChatGPT's release, in TWh. The last bar is all fuels together.`,
      legend: keys.map((k) => `<span><i style="background:${FUEL_COLOR[k]}"></i>${esc(gl[k])}</span>`).join('') + `<span><i style="background:${INK}"></i>All fuels shown</span>`,
      draw: (cv) => new Chart(cv, {
        type: 'bar',
        data: { labels: rows1.map((r) => (r.k === 'all' ? 'All fuels' : gl[r.k])), datasets: [{ data: rows1.map((r) => r.d), backgroundColor: rows1.map((r) => (r.k === 'all' ? INK : FUEL_COLOR[r.k])), borderRadius: 5, barThickness: 24 }] },
        options: {
          indexAxis: 'y', maintainAspectRatio: false, layout: { padding: { right: 24 } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const r = rows1[c.dataIndex]; return `${sgn(r.d)} TWh (${pct(r.p)})`; } } } },
          scales: { x: { grace: '22%', grid: { color: GRID }, title: { display: true, text: 'Change in generation (TWh)' } }, y: { grid: { display: false } } },
        },
        plugins: [barEndLabels((i, v) => `${sgn(v)} TWh  (${pct(rows1[i].p)})`)],
      }),
    };

    // view 2: the two years side by side
    const v2 = {
      id: 'sidebyside', label: 'Two years side by side', height: 230,
      note: 'Net generation by fuel in each 12-month window, in TWh. Gas is the first segment of each bar.',
      legend: keys.map((k) => `<span><i style="background:${FUEL_COLOR[k]}"></i>${esc(gl[k])}</span>`).join(''),
      draw: (cv) => new Chart(cv, {
        type: 'bar',
        data: { labels: [`Before: ${ymLabel(fb.from)} to ${ymLabel(fb.to)}`, `Latest: ${ymLabel(fl.from)} to ${ymLabel(fl.to)}`], datasets: keys.map((k) => ({ label: gl[k], data: [fb.gwh[k] / 1000, fl.gwh[k] / 1000], backgroundColor: FUEL_COLOR[k], borderColor: '#ffffff', borderWidth: 2, borderRadius: 3 })) },
        options: {
          indexAxis: 'y', maintainAspectRatio: false, layout: { padding: { right: 70 } },
          plugins: { legend: { display: false }, tooltip: { itemSort: (a, c) => a.datasetIndex - c.datasetIndex, callbacks: { label: (c) => `${c.dataset.label}: ${nf1.format(c.parsed.x)} TWh` } } },
          scales: { x: { stacked: true, grid: { color: GRID }, title: { display: true, text: 'TWh' } }, y: { stacked: true, grid: { display: false } } },
        },
        plugins: [{
          id: 'seglabels',
          afterDatasetsDraw(chart) {
            const { ctx, scales } = chart;
            ctx.save(); ctx.font = "600 12px 'Instrument Sans', sans-serif"; ctx.textBaseline = 'middle';
            const gasMeta = chart.getDatasetMeta(0);
            gasMeta.data.forEach((bar, i) => {
              const v = chart.data.datasets[0].data[i];
              if (bar.width > 48) { ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.fillText(nf1.format(v), bar.base + bar.width / 2, bar.y); }
            });
            [fb, fl].forEach((o, i) => { const x = scales.x.getPixelForValue(tot(o) / 1000) + 8; const y = gasMeta.data[i].y; ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.fillText(`${(tot(o) / 1000).toFixed(1)} TWh`, x, y); });
            ctx.restore();
          },
        }],
      }),
    };

    // view 3: rolling 12 months by fuel
    const rollF = fuel.months.map((_, i) => {
      if (i < 11) return null;
      for (let k = i - 11; k <= i; k++) if (!okF[k]) return null;
      return Object.fromEntries(keys.map((kk) => [kk, sum(fuel.gwh[kk].slice(i - 11, i + 1)) / 1000]));
    });
    const f0 = rollF.findIndex((r) => r);
    const fl2 = fuel.months.slice(f0);
    const v3 = {
      id: 'rolling', label: 'Rolling 12 months',
      note: 'Each point is the total generation of the 12 months ending in that month, so seasons cancel out. Natural gas is drawn thicker.',
      legend: keys.map((k) => `<span><i class="line" style="background:${FUEL_COLOR[k]}"></i>${esc(gl[k])}</span>`).join(''),
      draw: (cv) => new Chart(cv, {
        type: 'line',
        data: { labels: fl2, datasets: keys.map((k) => ({ label: gl[k], data: rollF.slice(f0).map((r) => (r ? r[k] : null)), borderColor: FUEL_COLOR[k], backgroundColor: FUEL_COLOR[k], borderWidth: k === 'gas' ? 4 : 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2 })) },
        options: {
          maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { itemSort: (a, c) => c.parsed.y - a.parsed.y, callbacks: { title: (it) => `12 months to ${ymLabel(it[0].label)}`, label: (c) => `${c.dataset.label}: ${nf1.format(c.parsed.y)} TWh` } } },
          scales: { x: { grid: { display: false }, ticks: yearTicks(fl2) }, y: { min: 0, grid: { color: GRID }, title: { display: true, text: 'TWh in the 12 months' } } },
        },
        plugins: [releaseMarker(fl2, '2022-11', 'top')],
      }),
    };

    // view 4: share over time
    const fi = idx.filter((i) => okF[i]);
    const flab = fi.map((i) => fuel.months[i]);
    const gwhOf = (k) => fi.map((i) => fuel.gwh[k][i]);
    const totals = fi.map((_, j) => sum(keys.map((k) => gwhOf(k)[j])));
    const v4 = {
      id: 'share', label: 'Share over time',
      note: 'Each fuel\'s share of PJM\'s monthly net generation. Storage is left out of the stack because it can be negative when charging.',
      legend: keys.map((k) => `<span><i style="background:${FUEL_COLOR[k]}"></i>${esc(gl[k])}</span>`).join(''),
      draw: (cv) => new Chart(cv, {
        type: 'line',
        data: { labels: flab, datasets: keys.map((k) => ({ label: gl[k], data: gwhOf(k).map((v, j) => (100 * v) / totals[j]), backgroundColor: FUEL_COLOR[k], borderColor: '#ffffff', borderWidth: 0.8, fill: true, pointRadius: 0, pointHoverRadius: 3, tension: 0, stack: 'mix' })) },
        options: {
          maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { itemSort: (a, c) => c.datasetIndex - a.datasetIndex, callbacks: { title: (it) => ymLabel(it[0].label), label: (c) => `${c.dataset.label}: ${nf1.format(c.parsed.y)}%` } } },
          scales: { x: { grid: { display: false }, ticks: yearTicks(flab) }, y: { stacked: true, min: 0, max: 100, grid: { color: GRID }, title: { display: true, text: 'Share of generation (%)' } } },
        },
        plugins: [releaseMarker(flab, '2022-11')],
      }),
    };

    const v5 = {
      id: 'table', label: 'Table',
      table: table(['Fuel', `TWh ${ymLabel(fb.from)}–${ymLabel(fb.to)}`, `TWh ${ymLabel(fl.from)}–${ymLabel(fl.to)}`, 'Change (TWh)', 'Change (%)', 'Share before', 'Share latest'],
        keys.map((k) => [gl[k], nf1.format(fb.gwh[k] / 1000), nf1.format(fl.gwh[k] / 1000), sgn((fl.gwh[k] - fb.gwh[k]) / 1000), pct(dem(fb.gwh[k], fl.gwh[k])), `${nf1.format(share(fb, k))}%`, `${nf1.format(share(fl, k))}%`])
          .concat([['All fuels shown', nf1.format(tot(fb) / 1000), nf1.format(tot(fl) / 1000), sgn(dTot), pct(dem(tot(fb), tot(fl))), '100%', '100%']])),
    };

    push(figure(figs, {
      title, callout, views: [v1, v2, v3, v4, v5],
      foot: `Source: EIA Open Data API, route <code>electricity/rto/fuel-type-data</code> (EIA-930, respondent PJM). EIA-930 generation is not the same series as EIA-923 plant generation, so the two should not be mixed. EIA fuel codes: ${esc(fuel.codes_seen.join(', '))}; grouped as listed on the Sources page. Gas capacity is from <code>electricity/operating-generator-capacity</code> (EIA-860M).`,
    }));
  }

  // ---- 4. generator additions ----
  {
    const lastIdx = ymIndex(meta.plants.snapshot_period);
    const startIdx = ymIndex('2019-01');
    const ops = units.filter((u) => u.state_cls === 'operating' && u.online && ymIndex(u.online) >= startIdx && ymIndex(u.online) <= lastIdx);
    const q = (ym) => { const [y, m] = ym.split('-').map(Number); return `${y} Q${Math.ceil(m / 3)}`; };
    const qs = []; for (let y = 2019; y <= Math.floor(lastIdx / 12); y++) for (let k = 1; k <= 4; k++) { if (y * 12 + (k - 1) * 3 <= lastIdx) qs.push(`${y} Q${k}`); }
    const by = Object.fromEntries(groups.map((g) => [g.key, Object.fromEntries(qs.map((x) => [x, 0]))]));
    ops.forEach((u) => { const k = q(u.online); if (by[u.group] && k in by[u.group]) by[u.group][k] += u.mw || 0; });
    const winMw = Object.fromEntries(groups.map((g) => [g.key, sum(winUnits.filter((u) => u.group === g.key).map((u) => u.mw))]));
    const top = groups.map((g) => g.key).sort((a, c) => winMw[c] - winMw[a])[0];
    const rem = data.removed;
    const remMw = Object.fromEntries(groups.map((g) => [g.key, sum(rem.filter((u) => u.group === g.key).map((u) => u.mw))]));
    push(simple(figs, {
      title: `${gl[top]} is the largest block of new generator capacity since December 2022: ${nf0.format(winMw[top])} MW of ${nf0.format(addedMw)} MW`,
      note: 'Nameplate MW of EIA operating generators in the PJM balancing authority, by the quarter they reached operation. Nameplate is the maximum rating, not what a unit produced.',
      legend: groups.map((g) => `<span><i style="background:${FUEL_COLOR[g.key]}"></i>${esc(g.label)}</span>`).join(''),
      foot: `Source: EIA Open Data API, route <code>electricity/operating-generator-capacity</code> (EIA-860M), snapshot ${esc(meta.plants.snapshot_period)}. Units absent from the latest snapshot but present in the ${esc(data.removedBaseline)} snapshot (${nf0.format(rem.length)} units, ${nf0.format(sum(Object.values(remMw)))} MW) are not netted out here; they may be retired or reclassified.`,
      tableHtml: table(['Fuel', 'MW online since Dec 2022', 'MW listed in baseline snapshot but not latest'], groups.map((g) => [g.label, nf0.format(winMw[g.key]), nf0.format(remMw[g.key])])),
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
    }));
  }

  // ---- 5. data center records by state ----
  {
    const pj = new Set(meta.pjm_states_with_eia_plants);
    const rows = {};
    dcs.filter((d) => pj.has(d.state_abb)).forEach((d) => { (rows[d.state_abb] ??= { building: 0, campus: 0, point: 0 })[d.type] += 1; });
    const list = Object.entries(rows).map(([s, v]) => ({ s, ...v, n: v.building + v.campus + v.point })).sort((a, c) => c.n - a.n);
    if (list.length) {
      push(simple(figs, {
        title: `${list[0].s} has the most IM3 data center records among states where EIA lists PJM generators: ${nf0.format(list[0].n)}`,
        note: 'IM3 records per state. A campus and the buildings inside it are separate records, so these are not facility counts, and IM3 carries no online dates or power figures. States are counted whole even where only part of the state is in PJM.',
        foot: `Source: IM3 Open Source Data Center Atlas, file version 2026.11.02 (${nf0.format(data.dcMeta.rows)} records; ${nf0.format(data.dcMeta.multi_county_rows_merged)} records listed once per county were merged). Licensed ODbL; derived from OpenStreetMap.`,
        tableHtml: table(['State', 'Building', 'Campus', 'Point', 'All records'], list.map((r) => [r.s, nf0.format(r.building), nf0.format(r.campus), nf0.format(r.point), nf0.format(r.n)])),
        draw: (cv) => new Chart(cv, {
          type: 'bar',
          data: { labels: list.map((r) => r.s), datasets: [{ data: list.map((r) => r.n), backgroundColor: DC_COLOR, borderRadius: 5, maxBarThickness: 30 }] },
          options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const r = list[c.dataIndex]; return [`${nf0.format(r.n)} records`, `${r.building} building, ${r.campus} campus, ${r.point} point`]; } } } },
            scales: { x: { grid: { display: false } }, y: { grid: { color: GRID }, title: { display: true, text: 'IM3 records' } } },
          },
        }),
      }));
    }
  }

  return () => parts.forEach((p) => p.destroy());
}

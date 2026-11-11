import { Chart, registerables } from 'chart.js';
import { FUEL_COLOR } from '../lib/fuels.js';
import { esc, nf0, nf1, pct, pp, ymLabel, ymIndex, sum } from '../lib/format.js';

Chart.register(...registerables);
Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#44505f';
Chart.defaults.animation = false;

const GRID = '#e1e6ec';
const INK = '#0e1b2b';

function table(headers, rows) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row" style="font-weight:500">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

// A figure with a chart/table switch. `draw(canvas)` returns a Chart; `tableHtml` the same data as a table.
function figure(host, { title, note, foot, draw, tableHtml, legend }) {
  const el = document.createElement('section');
  el.className = 'fig';
  el.innerHTML = `<div class="fig__head"><div><h3>${esc(title)}</h3>${note ? `<p>${note}</p>` : ''}</div>
    <div class="seg" role="group" aria-label="View"><button type="button" aria-pressed="true" data-v="chart">Chart</button><button type="button" aria-pressed="false" data-v="table">Table</button></div></div>
    <div class="fig__body">${legend ? `<div class="legend">${legend}</div>` : ''}<div class="fig__canvas"><canvas role="img" aria-label="${esc(title)}"></canvas></div><div class="fig__table" hidden>${tableHtml}</div></div>
    ${foot ? `<div class="fig__foot">${foot}</div>` : ''}`;
  host.appendChild(el);
  const chart = draw(el.querySelector('canvas'));
  el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.v === 'table';
    el.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    el.querySelector('.fig__canvas').hidden = t;
    el.querySelector('.fig__table').hidden = !t;
    if (legend) el.querySelector('.legend').hidden = t;
    if (!t) chart.resize();
  }));
  return { el, chart };
}

const yearTicks = (labels) => ({
  autoSkip: false, maxRotation: 0,
  callback(v) { const l = labels[v]; return l && l.endsWith('-01') ? l.slice(0, 4) : ''; },
});

// vertical marker at the ChatGPT release month
const releaseMarker = (labels, key) => ({
  id: 'release',
  afterDatasetsDraw(chart) {
    const i = labels.indexOf(key);
    if (i < 0) return;
    const { ctx, chartArea: a, scales } = chart;
    const x = scales.x.getPixelForValue(i) + (scales.x.options.offset ? 0 : 0);
    ctx.save();
    ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = INK; ctx.font = "500 11px 'IBM Plex Sans Condensed', sans-serif";
    ctx.fillText('ChatGPT released, Nov 30, 2022', x + 6, a.top + 12);
    ctx.restore();
  },
});

export function mount(root, data) {
  const { meta, demand, fuel, units, dcs } = data;
  const groups = meta.groups;
  const gl = Object.fromEntries(groups.map((g) => [g.key, g.label]));
  const charts = [];
  const cmp = demand.comparison;
  const b = cmp.baseline, l = cmp.latest;
  const fb = fuel.comparison.baseline, fl = fuel.comparison.latest;
  const tot = (o) => sum(Object.entries(o.gwh).filter(([k]) => k !== 'storage').map(([, v]) => v));
  const share = (o, k) => (100 * o.gwh[k]) / tot(o);
  const dem = (x, y) => (100 * (y - x)) / x;
  const cleanIdx = demand.monthly.months.map((m, i) => (demand.monthly.coverage[i] >= 0.97 ? i : -1)).filter((i) => i >= 0);

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
  root.querySelector('#ledger').innerHTML = [
    ['Average hourly demand', `${nf0.format(l.avg_mw)} MW`, `${pct(dem(b.avg_mw, l.avg_mw))} vs ${nf0.format(b.avg_mw)} MW before`],
    ['Highest hour', `${nf0.format(l.peak_mw)} MW`, `${pct(dem(b.peak_mw, l.peak_mw))} vs ${nf0.format(b.peak_mw)} MW before`],
    ['Lowest hour', `${nf0.format(l.min_mw)} MW`, `${pct(dem(b.min_mw, l.min_mw))} vs ${nf0.format(b.min_mw)} MW before`],
    ['Natural gas share of generation', `${nf1.format(share(fl, 'gas'))}%`, `${pp(share(fl, 'gas') - share(fb, 'gas'))} vs ${nf1.format(share(fb, 'gas'))}% before`],
    ['Generators online since Dec 2022', `${nf0.format(addedMw)} MW`, `${nf0.format(winUnits.length)} units, nameplate (EIA)`],
  ].map(([k, v, s]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}<small>${esc(s)}</small></dd></div>`).join('');

  const figs = root.querySelector('#figs');
  const push = (f) => charts.push(f.chart);

  // ---- 1. demand over time ----
  {
    const M = demand.monthly;
    const labels = cleanIdx.map((i) => M.months[i]);
    const pick = (arr) => cleanIdx.map((i) => arr[i]);
    const series = [
      { label: 'Highest hour', data: pick(M.peak_mw), color: INK },
      { label: 'Average hour', data: pick(M.avg_mw), color: '#5d6b7c' },
      { label: 'Lowest hour', data: pick(M.min_mw), color: '#9aa5b3' },
    ];
    push(figure(figs, {
      title: `Average hourly demand was ${pct(Math.abs(dem(b.avg_mw, l.avg_mw)), 1).replace('+', '')} ${l.avg_mw >= b.avg_mw ? 'higher' : 'lower'} in the latest 12 months than in the 12 months before ChatGPT's release`,
      note: 'Monthly highest, average and lowest hourly demand for the PJM balancing authority, in MW. Months are grouped in Eastern time. The lowest hour is a rough read on the demand that never switches off.',
      legend: series.map((s) => `<span><i class="line" style="background:${s.color}"></i>${esc(s.label)}</span>`).join(''),
      foot: `Source: EIA Open Data API, route <code>electricity/rto/region-data</code> (EIA-930, type D, respondent PJM). Hours with a non-positive value were dropped (${nf0.format(meta.demand.non_positive_rows_dropped)} of ${nf0.format(meta.demand.hourly_rows)}), and so were ${nf0.format(meta.demand.outlier_hours_dropped_pjm ?? 0)} PJM-wide hours that are more than 1.5 times or under half the median of the surrounding 7 days (EIA-930 contains impossible values; see Sources and method). Months with under 97% of expected hours are left out${meta.demand.partial_months.length ? ` (${esc(meta.demand.partial_months.join(', '))})` : ''}.`,
      tableHtml: table(['Month', 'Highest hour (MW)', 'Average hour (MW)', 'Lowest hour (MW)'], labels.map((m, i) => [m, nf0.format(series[0].data[i]), nf0.format(series[1].data[i]), nf0.format(series[2].data[i])])),
      draw: (cv) => new Chart(cv, {
        type: 'line',
        data: { labels, datasets: series.map((s) => ({ label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.15 })) },
        options: {
          maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => ymLabel(it[0].label), label: (c) => `${c.dataset.label}: ${nf0.format(c.parsed.y)} MW` } } },
          scales: { x: { grid: { display: false }, ticks: yearTicks(labels) }, y: { title: { display: true, text: 'MW' }, grid: { color: GRID }, ticks: { callback: (v) => nf0.format(v) } } },
        },
        plugins: [releaseMarker(labels, '2022-11')],
      }),
    }));
  }

  // ---- 2. zones ----
  {
    const zs = Object.entries(cmp.zones).map(([z, v]) => ({ z, name: demand.zones[z]?.name || z, base: v.baseline.avg_mw, last: v.latest.avg_mw, ch: dem(v.baseline.avg_mw, v.latest.avg_mw) })).sort((a, c) => c.ch - a.ch);
    if (zs.length) {
      const top = zs[0];
      const f = figure(figs, {
        title: `${top.name} grew fastest among PJM zones: ${pct(top.ch)} in average hourly demand`,
        note: 'Change in average hourly demand by EIA-930 subregion, latest 12 months against the 12 months before ChatGPT\'s release. Subregions are the zones PJM reports to EIA; boundaries are not drawn here.',
        foot: `Source: EIA Open Data API, route <code>electricity/rto/region-sub-ba-data</code> (parent PJM). Zone totals can differ slightly from the PJM-wide series.`,
        tableHtml: table(['Zone', `Avg MW ${ymLabel(b.from)}–${ymLabel(b.to)}`, `Avg MW ${ymLabel(l.from)}–${ymLabel(l.to)}`, 'Change'], zs.map((r) => [`${r.name} (${r.z})`, nf0.format(r.base), nf0.format(r.last), pct(r.ch)])),
        draw: (cv) => { cv.parentElement.style.height = `${Math.max(240, zs.length * 26 + 70)}px`; return new Chart(cv, {
          type: 'bar',
          data: { labels: zs.map((r) => r.z), datasets: [{ data: zs.map((r) => r.ch), backgroundColor: INK, borderRadius: { topRight: 4, bottomRight: 4 }, barThickness: 14 }] },
          options: {
            indexAxis: 'y', maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => { const r = zs[it[0].dataIndex]; return `${r.name} (${r.z})`; }, label: (c) => { const r = zs[c.dataIndex]; return [`Change: ${pct(r.ch)}`, `${nf0.format(r.base)} MW to ${nf0.format(r.last)} MW`]; } } } },
            scales: { x: { grid: { color: GRID }, title: { display: true, text: 'Change in average hourly demand (%)' }, ticks: { callback: (v) => `${v}%` } }, y: { grid: { display: false } } },
          },
        }); },
      });
      push(f);
    }
  }

  // ---- 3. fuel mix ----
  {
    const idx = fuel.months.map((m, i) => (fuel.coverage[i] >= 0.97 ? i : -1)).filter((i) => i >= 0);
    const labels = idx.map((i) => fuel.months[i]);
    const keys = groups.map((g) => g.key).filter((k) => k !== 'storage');
    const gwh = (k) => idx.map((i) => fuel.gwh[k][i]);
    const totals = idx.map((_, j) => sum(keys.map((k) => gwh(k)[j])));
    let shareMode = true;
    const mkData = () => keys.map((k) => ({
      label: gl[k], data: gwh(k).map((v, j) => (shareMode ? (100 * v) / totals[j] : v / 1000)), backgroundColor: FUEL_COLOR[k], borderColor: '#ffffff', borderWidth: 0.8, fill: true, pointRadius: 0, pointHoverRadius: 3, tension: 0, stack: 'mix',
    }));
    const gasDelta = share(fl, 'gas') - share(fb, 'gas');
    const biggest = keys.map((k) => ({ k, d: share(fl, k) - share(fb, k) })).sort((a, c) => Math.abs(c.d) - Math.abs(a.d))[0];
    const f = figure(figs, {
      title: `${gl[biggest.k]} had the largest shift in PJM's generation mix: ${pp(biggest.d)} of total generation`,
      note: 'Monthly net generation by fuel for the PJM balancing authority. Switch between each fuel\'s share of the month and TWh per month. Storage is left out of the stack because it can be negative when charging.',
      legend: keys.map((k) => `<span><i style="background:${FUEL_COLOR[k]}"></i>${esc(gl[k])}</span>`).join(''),
      foot: `Source: EIA Open Data API, route <code>electricity/rto/fuel-type-data</code> (EIA-930, respondent PJM). EIA-930 generation is not the same series as EIA-923 plant generation, so the two should not be mixed. EIA fuel codes: ${esc(fuel.codes_seen.join(', '))}; grouped as listed on the Sources page.`,
      tableHtml: table(['Fuel', `Share ${ymLabel(fb.from)}–${ymLabel(fb.to)}`, `Share ${ymLabel(fl.from)}–${ymLabel(fl.to)}`, 'Change', `TWh before`, `TWh latest`],
        keys.map((k) => [gl[k], `${nf1.format(share(fb, k))}%`, `${nf1.format(share(fl, k))}%`, pp(share(fl, k) - share(fb, k)), nf1.format(fb.gwh[k] / 1000), nf1.format(fl.gwh[k] / 1000)])
          .concat([['All fuels shown', '100%', '100%', '', nf1.format(tot(fb) / 1000), nf1.format(tot(fl) / 1000)]])),
      draw: (cv) => new Chart(cv, {
        type: 'line',
        data: { labels, datasets: mkData() },
        options: {
          maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { itemSort: (a, c) => c.datasetIndex - a.datasetIndex, callbacks: { title: (it) => ymLabel(it[0].label), label: (c) => `${c.dataset.label}: ${shareMode ? nf1.format(c.parsed.y) + '%' : nf1.format(c.parsed.y) + ' TWh'}` } } },
          scales: { x: { grid: { display: false }, ticks: yearTicks(labels) }, y: { stacked: true, min: 0, max: 100, grid: { color: GRID }, title: { display: true, text: 'Share of generation (%)' } } },
        },
        plugins: [releaseMarker(labels, '2022-11')],
      }),
    });
    // toggle
    const seg = document.createElement('div');
    seg.className = 'seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Units');
    seg.innerHTML = '<button type="button" aria-pressed="true" data-u="share">Share</button><button type="button" aria-pressed="false" data-u="abs">TWh per month</button>';
    f.el.querySelector('.fig__body').prepend(seg); seg.style.marginBottom = '8px';
    seg.addEventListener('click', (e) => {
      const bt = e.target.closest('[data-u]'); if (!bt) return;
      shareMode = bt.dataset.u === 'share';
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === bt)));
      f.chart.data.datasets = mkData();
      f.chart.options.scales.y.title.text = shareMode ? 'Share of generation (%)' : 'TWh per month';
      f.chart.options.scales.y.max = shareMode ? 100 : undefined;
      f.chart.update();
    });
    push(f);
    void gasDelta;
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
    push(figure(figs, {
      title: `${gl[top]} is the largest block of new generator capacity since December 2022: ${nf0.format(winMw[top])} MW of ${nf0.format(addedMw)} MW`,
      note: 'Nameplate MW of EIA operating generators in the PJM balancing authority, by the quarter they reached operation.',
      legend: groups.map((g) => `<span><i style="background:${FUEL_COLOR[g.key]}"></i>${esc(g.label)}</span>`).join(''),
      foot: `Source: EIA Open Data API, route <code>electricity/operating-generator-capacity</code> (EIA-860M), snapshot ${esc(meta.plants.snapshot_period)}. Nameplate capacity is not output. Units absent from the latest snapshot but present in the ${esc(data.removedBaseline)} snapshot (${nf0.format(rem.length)} units, ${nf0.format(sum(Object.values(remMw)))} MW) are not netted out here; they may be retired or reclassified.`,
      tableHtml: table(['Fuel', 'MW online since Dec 2022', 'MW listed in baseline snapshot but not latest'], groups.map((g) => [g.label, nf0.format(winMw[g.key]), nf0.format(remMw[g.key])])),
      draw: (cv) => new Chart(cv, {
        type: 'bar',
        data: { labels: qs, datasets: groups.map((g) => ({ label: g.label, data: qs.map((x) => by[g.key][x]), backgroundColor: FUEL_COLOR[g.key], borderColor: '#ffffff', borderWidth: 1, stack: 's' })) },
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
      push(figure(figs, {
        title: `${list[0].s} has the most IM3 data center records among states where EIA lists PJM generators: ${nf0.format(list[0].n)}`,
        note: 'IM3 records per state. A campus and the buildings inside it are separate records, so these are not facility counts, and IM3 carries no online dates or power figures. States are counted whole even where only part of the state is in PJM.',
        foot: `Source: IM3 Open Source Data Center Atlas, file version 2026.11.02 (${nf0.format(data.dcMeta.rows)} records; ${nf0.format(data.dcMeta.multi_county_rows_merged)} records listed once per county were merged). Licensed ODbL; derived from OpenStreetMap.`,
        tableHtml: table(['State', 'Building', 'Campus', 'Point', 'All records'], list.map((r) => [r.s, nf0.format(r.building), nf0.format(r.campus), nf0.format(r.point), nf0.format(r.n)])),
        draw: (cv) => new Chart(cv, {
          type: 'bar',
          data: { labels: list.map((r) => r.s), datasets: [{ data: list.map((r) => r.n), backgroundColor: INK, borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 28 }] },
          options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const r = list[c.dataIndex]; return [`${nf0.format(r.n)} records`, `${r.building} building, ${r.campus} campus, ${r.point} point`]; } } } },
            scales: { x: { grid: { display: false } }, y: { grid: { color: GRID }, title: { display: true, text: 'IM3 records' } } },
          },
        }),
      }));
    }
  }

  return () => charts.forEach((c) => c.destroy());
}

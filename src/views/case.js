import { esc, nf0, nf1, pct, pp, ymLabel, ymIndex, sum } from '../lib/format.js';
import { TIME } from '../lib/fuels.js';
import { Chart, GRID, table, simple, demandFigure, fuelFigure, additionsFigure, capacityGenFigure, dem, sgn, twhOf } from '../lib/figs.js';

export function mount(root, data) {
  const { meta, demand, fuel, units } = data;
  const parts = [];
  const cmp = demand.comparison;
  const b = cmp.baseline, l = cmp.latest;
  const fb = fuel.comparison.baseline, fl = fuel.comparison.latest;
  const tot = (o) => sum(Object.values(o.gwh));
  const ye = cmp.years_earlier || {};
  const five = ye['5'];
  const nOld = Math.max(0, ...Object.keys(ye).map(Number));
  const old = nOld >= 6 ? ye[String(nOld)] : null;
  const WORD_N = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };

  root.innerHTML = `<div class="doc">
    <div class="doc__intro">
      <h2>PJM's demand, supply and fuel mix since ChatGPT's release</h2>
      <p>PJM is one of the grid operators inside the U.S. total shown on the first tab. Demand is followed month by month and day by day since EIA's data began in July 2015. The headline comparison is between two 12-month windows: <strong>${esc(ymLabel(b.from))} to ${esc(ymLabel(b.to))}</strong>, the year before ChatGPT's public release on November 30, 2022, and <strong>${esc(ymLabel(l.from))} to ${esc(ymLabel(l.to))}</strong>, the latest 12 complete months in the data. Demand and fuel mix are EIA-930 figures for the PJM balancing authority. Generator additions are from EIA's generator inventory.</p>
      <p>The figures show what changed and when. They do not attribute any change to data centers or to any other cause.</p>
    </div>
    <dl class="ledger" id="ledger"></dl>
    <div id="figs"></div></div>`;

  const winUnits = units.filter((u) => u.state_cls === 'operating' && u.online && ymIndex(u.online) > ymIndex(meta.window_start.slice(0, 7)) && ymIndex(u.online) <= ymIndex(meta.plants.snapshot_period));
  const addedMw = sum(winUnits.map((u) => u.mw));
  const pjmRetired = data.retired ? data.retired.filter((r) => r.pjm) : null;
  const retiredMw = pjmRetired ? sum(pjmRetired.map((r) => r.mw)) : null;
  const dTot = (tot(fl) - tot(fb)) / 1000;
  root.querySelector('#ledger').innerHTML = [
    ['Average hourly demand', `${nf0.format(l.avg_mw)} MW`, `${pct(dem(b.avg_mw, l.avg_mw))} vs ${nf0.format(b.avg_mw)} MW the year before`, TIME.warm],
    ['Generation, all fuels', `${nf1.format(tot(fl) / 1000)} TWh`, `${sgn(dTot)} TWh (${pct(dem(tot(fb), tot(fl)))}) vs the year before`, '#7aa6b8'],
    ...(old ? [[`Energy used, change over ${WORD_N[nOld] || nOld} years`, pct(dem(twhOf(old), twhOf(l))), `${nf0.format(twhOf(old))} TWh in ${ymLabel(old.from)} to ${ymLabel(old.to)}`, TIME.cool]] : []),
    ...(five ? [['Energy used, change over five years', pct(dem(twhOf(five), twhOf(l))), `${nf0.format(twhOf(five))} TWh in ${ymLabel(five.from)} to ${ymLabel(five.to)}`, '#9db7c4']] : []),
    ['Generators online since Dec 2022', `${nf0.format(addedMw)} MW`, `${nf0.format(winUnits.length)} units, nameplate (EIA)`, '#1f7a8c'],
    ...(pjmRetired ? [['Generators retired since Dec 2022', `${nf0.format(retiredMw)} MW`, `${nf0.format(pjmRetired.length)} units, ${meta.retired.capacity_basis} (EIA)`, '#8a5a83']] : []),
  ].map(([k, v, s, c]) => `<div style="--ledger:${c}"><dt>${esc(k)}</dt><dd>${esc(v)}<small>${esc(s)}</small></dd></div>`).join('');

  const figs = root.querySelector('#figs');
  const push = (f) => f && parts.push(f);
  const gl = Object.fromEntries(meta.groups.map((g) => [g.key, g.label]));

  push(demandFigure(figs, { meta, demand, dm: meta.demand, scope: 'PJM', series: 'respondent PJM' }));

  // ---- 2. zones ----
  {
    const zs = Object.entries(cmp.zones).map(([z, v]) => ({ z, name: demand.zones[z]?.name || z, base: v.baseline.avg_mw, last: v.latest.avg_mw, ch: dem(v.baseline.avg_mw, v.latest.avg_mw) })).sort((a, c) => c.ch - a.ch);
    if (zs.length) {
      const top = zs[0];
      push(simple(figs, {
        title: `${top.name} grew fastest among PJM zones: ${pct(top.ch)} in average hourly demand`,
        note: 'Change in average hourly demand by EIA-930 subregion, latest 12 months against the 12 months before ChatGPT\'s release. Warm bars grew, cool bars shrank. Subregions are the zones PJM reports to EIA; boundaries are not drawn here.',
        foot: 'Source: EIA Open Data API, route <code>electricity/rto/region-sub-ba-data</code> (parent PJM). Zone totals can differ slightly from the PJM-wide series. A wider hour-screening band is applied to each zone than to the PJM-wide series, because small zones have larger real swings (see Sources and method).',
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

  push(fuelFigure(figs, { meta, fuel, fm: meta.fuel, scope: 'PJM' }));
  push(additionsFigure(figs, { meta, units, winUnits, removed: data.removed, snapshot: meta.plants.snapshot_period, removedBaseline: data.removedBaseline, scopeNote: ' in the PJM balancing authority', retired: pjmRetired, scopeLabel: 'pjm' }));
  push(capacityGenFigure(figs, { meta, fuel, winUnits, retired: pjmRetired, scope: 'PJM', scopeLabel: 'pjm' }));

  return () => parts.forEach((p) => p.destroy());
}

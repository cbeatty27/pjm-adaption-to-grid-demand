import { esc, nf0, nf1, pct, ymLabel, ymIndex, sum } from '../lib/format.js';
import { SECTOR_COLOR, TIME, FUEL_COLOR } from '../lib/fuels.js';
import { Chart, GRID, INK, table, figure, demandFigure, fuelFigure, additionsFigure, dcFigure, barEndLabels, barTopLabels, dem, sgn, twhOf } from '../lib/figs.js';

const SECTORS = ['RES', 'COM', 'IND', 'TRA', 'OTH'];

// Retail electricity sales by customer sector (EIA-861M via the retail-sales route).
function retailFigure(host, retail, meta) {
  const months = retail.months;
  const last = months.length - 1;
  const ids = SECTORS.filter((k) => retail.sectors[k]?.gwh.some((v) => v > 0)); // EIA reports 0 for the "other" class
  if (last < 23 || !ids.length) return null;
  const win = (k) => ({ lo: last - 11 - 12 * k, hi: last - 12 * k });
  const ks = []; for (let k = 5; k >= 0; k--) if (win(k).lo >= 0) ks.push(k);
  const sumW = (id, k) => { const { lo, hi } = win(k); const a = retail.sectors[id].gwh.slice(lo, hi + 1); return a.some((v) => v == null) ? null : sum(a) / 1000; };
  const lab = (k) => `${ymLabel(months[win(k).lo])} – ${ymLabel(months[win(k).hi])}`;
  const first = ks[0];
  const name = (id) => retail.sectors[id].name.replace(/^./, (c) => c.toUpperCase());
  const tot = (k) => sum(ids.map((id) => sumW(id, k)));
  const rows = ids.map((id) => ({ id, a: sumW(id, first), b: sumW(id, 0) })).map((r) => ({ ...r, d: r.b - r.a, p: dem(r.a, r.b) })).sort((x, y) => y.d - x.d);
  const total = { a: tot(first), b: tot(0) }; total.d = total.b - total.a; total.p = dem(total.a, total.b);
  const yrs = first;
  const legend = ids.map((id) => `<span><i style="background:${SECTOR_COLOR[id]}"></i>${esc(name(id))}</span>`).join('');
  const top = rows[0];
  const v1 = {
    id: 'change', label: `Change over ${yrs} year${yrs === 1 ? '' : 's'}`, height: 60 + rows.length * 46,
    note: `Change in electricity sold to customers, ${esc(lab(0))} against ${esc(lab(first))}, in TWh. Sectors are EIA's customer classes.`,
    legend,
    draw: (cv) => new Chart(cv, {
      type: 'bar',
      data: { labels: rows.map((r) => name(r.id)), datasets: [{ data: rows.map((r) => r.d), backgroundColor: rows.map((r) => SECTOR_COLOR[r.id]), borderRadius: 5, barThickness: 24 }] },
      options: {
        indexAxis: 'y', maintainAspectRatio: false, layout: { padding: { right: 20 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const r = rows[c.dataIndex]; return [`${sgn(r.d)} TWh (${pct(r.p)})`, `${nf0.format(r.a)} TWh to ${nf0.format(r.b)} TWh`]; } } } },
        scales: { x: { grace: '26%', grid: { color: GRID }, title: { display: true, text: 'Change in sales (TWh)' } }, y: { grid: { display: false } } },
      },
      plugins: [barEndLabels((i, v) => `${sgn(v)} TWh  (${pct(rows[i].p)})`)],
    }),
  };
  const v2 = {
    id: 'totals', label: '12-month totals', height: 380,
    note: 'Electricity sold to customers in each 12-month window, stacked by sector, in TWh. The bars start at zero.',
    legend,
    draw: (cv) => new Chart(cv, {
      type: 'bar',
      data: { labels: ks.map((k) => [ymLabel(months[win(k).lo]), `to ${ymLabel(months[win(k).hi])}`]), datasets: ids.map((id) => ({ label: name(id), data: ks.map((k) => sumW(id, k)), backgroundColor: SECTOR_COLOR[id], borderColor: '#ffffff', borderWidth: 2, borderRadius: 3, stack: 's' })) },
      options: {
        maintainAspectRatio: false, layout: { padding: { top: 28 } },
        plugins: { legend: { display: false }, tooltip: { itemSort: (a, c) => c.datasetIndex - a.datasetIndex, callbacks: { title: (it) => lab(ks[it[0].dataIndex]), label: (c) => `${c.dataset.label}: ${nf0.format(c.parsed.y)} TWh` } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: GRID }, title: { display: true, text: 'TWh sold in 12 months' } } },
      },
      plugins: [barTopLabels((i) => `${nf0.format(tot(ks[i]))} TWh`)],
    }),
  };
  const v3 = {
    id: 'table', label: 'Table',
    table: table(['Sector', `TWh ${lab(first)}`, `TWh ${lab(0)}`, 'Change (TWh)', 'Change (%)'],
      rows.map((r) => [name(r.id), nf1.format(r.a), nf1.format(r.b), sgn(r.d), pct(r.p)]).concat([['All sectors shown', nf1.format(total.a), nf1.format(total.b), sgn(total.d), pct(total.p)]])),
  };
  return figure(host, {
    title: `Electricity sold to U.S. customers ${total.d >= 0 ? 'rose' : 'fell'} ${Math.abs(total.p).toFixed(1)}% over ${yrs} year${yrs === 1 ? '' : 's'}; ${name(top.id).toLowerCase()} changed most in TWh (${sgn(top.d)} TWh)`,
    callout: `<b>A second measure of demand.</b> Retail sales come from a different EIA survey than the hourly demand above and do not depend on which grid operators report to EIA-930, so they are a check on the direction of the trend. They are lower than hourly demand because they leave out line losses and power that producers use themselves. EIA files each customer under one sector and does not publish a separate data center sector, so this chart cannot say how much of any change is data centers.`,
    views: [v1, v2, v3],
    foot: `Source: EIA Open Data API, route <code>electricity/retail-sales</code> (EIA-861M), U.S. total including Alaska and Hawaii, data through ${esc(ymLabel(months[last]))}, in million kilowatt-hours (GWh) converted to TWh. The latest window ends earlier than the hourly demand because the retail survey is published with a lag.`,
  });
}

export function mount(root, data, us) {
  const { meta } = data;
  const parts = [];
  const push = (f) => f && parts.push(f);
  const demand = us.demand, fuel = us.fuel;
  const cmp = demand.comparison, b = cmp.baseline, l = cmp.latest;
  const ye = cmp.years_earlier || {};
  const five = ye['5'];
  const WIN = ymIndex(meta.window_start.slice(0, 7));
  const LAST = ymIndex(meta.plants_us.snapshot_period);
  const winUnits = us.units.filter((u) => u.state_cls === 'operating' && u.online && ymIndex(u.online) > WIN && ymIndex(u.online) <= LAST);
  const fb = fuel.comparison.baseline, fl = fuel.comparison.latest;
  const fTot = (o) => sum(Object.entries(o.gwh).filter(([k]) => k !== 'storage').map(([, v]) => v));
  const gasShare = (o) => (100 * o.gwh.gas) / fTot(o);

  root.innerHTML = `<div class="doc">
    <div class="doc__intro">
      <h2>U.S. electricity demand since ChatGPT's release</h2>
      <p>This page covers the Lower 48 states as one system, using EIA's hourly grid data (EIA-930). It looks at the latest 12 complete months against the 12 months before ChatGPT's public release on November 30, 2022${five ? ' and against the same 12 months five years earlier' : ''}. Alaska and Hawaii are not in the series.</p>
      <p>The figures show what changed and when. They do not attribute any change to data centers or to any other cause. The PJM case study and the PJM map are the next tabs.</p>
    </div>
    <dl class="ledger" id="ledger"></dl>
    <div id="figs"></div></div>`;

  const tiles = [
    ['Electricity used, latest 12 months', `${nf0.format(twhOf(l))} TWh`, `${ymLabel(l.from)} to ${ymLabel(l.to)}`, TIME.warm],
  ];
  if (five) tiles.push([`Change since ${ymLabel(five.from)} to ${ymLabel(five.to)}`, pct(dem(twhOf(five), twhOf(l))), `${nf0.format(twhOf(five))} TWh five years earlier`, TIME.cool]);
  tiles.push(['Change since the year before ChatGPT', pct(dem(twhOf(b), twhOf(l))), `${nf0.format(twhOf(b))} TWh in ${ymLabel(b.from)} to ${ymLabel(b.to)}`, '#7aa6b8']);
  tiles.push(['Natural gas share of generation', `${nf1.format(gasShare(fl))}%`, `${nf1.format(gasShare(fb))}% in the year before ChatGPT`, FUEL_COLOR.gas]);
  root.querySelector('#ledger').innerHTML = tiles.map(([k, v, s, c]) => `<div style="--ledger:${c}"><dt>${esc(k)}</dt><dd>${esc(v)}<small>${esc(s)}</small></dd></div>`).join('');

  const figs = root.querySelector('#figs');
  push(demandFigure(figs, { meta, demand, dm: meta.demand_us, scope: 'U.S.', series: 'respondent US48, the Lower 48 total' }));
  if (us.retail) push(retailFigure(figs, us.retail, meta));
  push(fuelFigure(figs, { meta, fuel, fm: meta.fuel_us, scope: 'U.S.', winUnits }));
  push(additionsFigure(figs, { meta, units: us.units, winUnits, removed: us.removed, snapshot: meta.plants_us.snapshot_period, removedBaseline: us.removedBaseline, scopeNote: ' in the 50 states' }));
  push(dcFigure(figs, { dcs: data.dcs, dcMeta: data.dcMeta, states: null, scopeText: 'in the U.S.' }));
  return () => parts.forEach((p) => p.destroy());
}

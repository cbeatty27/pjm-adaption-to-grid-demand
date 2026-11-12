import { esc, nf0, nf1, pct, ymLabel, ymIndex, sum } from '../lib/format.js';
import { SECTOR_COLOR, TIME } from '../lib/fuels.js';
import { Chart, GRID, table, figure, demandFigure, fuelFigure, additionsFigure, barEndLabels, barTopLabels, dem, sgn, twhOf } from '../lib/figs.js';

const SECTORS = ['RES', 'COM', 'IND', 'TRA', 'OTH'];
const WORD_N = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };

// Retail electricity sales by customer sector (EIA-861M via the retail-sales route).
function retailFigure(host, retail, meta) {
  const months = retail.months;
  const last = months.length - 1;
  const ids = SECTORS.filter((k) => retail.sectors[k]?.gwh.some((v) => v > 0)); // EIA reports 0 for the "other" class
  if (last < 23 || !ids.length) return null;
  const win = (k) => ({ lo: last - 11 - 12 * k, hi: last - 12 * k });
  const ks = []; for (let k = 10; k >= 0; k--) if (win(k).lo >= 0) ks.push(k);   // up to ten years back, oldest first
  const sumW = (id, k) => { const { lo, hi } = win(k); const a = retail.sectors[id].gwh.slice(lo, hi + 1); return a.some((v) => v == null) ? null : sum(a) / 1000; };
  const lab = (k) => `${ymLabel(months[win(k).lo])} – ${ymLabel(months[win(k).hi])}`;
  const first = ks[0];
  const split = first >= 8 && ks.includes(5);   // ten (or nine, eight...) years of data: show the earlier years and the last five side by side
  const name = (id) => retail.sectors[id].name.replace(/^./, (c) => c.toUpperCase());
  const tot = (k) => sum(ids.map((id) => sumW(id, k)));
  const rows = ids.map((id) => ({ id, a: sumW(id, first), m: sumW(id, 5), b: sumW(id, 0) })).map((r) => ({ ...r, d: r.b - r.a, p: dem(r.a, r.b), de: r.m - r.a, pe: dem(r.a, r.m), dl: r.b - r.m, pl: dem(r.m, r.b) })).sort((x, y) => y.d - x.d);
  const total = { a: tot(first), m: ks.includes(5) ? tot(5) : null, b: tot(0) };
  total.d = total.b - total.a; total.p = dem(total.a, total.b);
  if (total.m != null) { total.de = total.m - total.a; total.pe = dem(total.a, total.m); total.dl = total.b - total.m; total.pl = dem(total.m, total.b); }
  const yrs = first;
  const legend = ids.map((id) => `<span><i style="background:${SECTOR_COLOR[id]}"></i>${esc(name(id))}</span>`).join('');
  const top = rows[0];
  const earlyYrs = first - 5;
  const early = WORD_N[earlyYrs] || earlyYrs;
  const v1 = split ? {
    id: 'change', label: `Earlier years and last five`, height: 80 + rows.length * 70,
    note: `Change in electricity sold to customers, in TWh, in two steps: from ${esc(lab(first))} to ${esc(lab(5))} (the first ${early} years, blue) and from ${esc(lab(5))} to ${esc(lab(0))} (the last five years, orange). Sectors are EIA's customer classes.`,
    legend: `<span><i style="background:${TIME.cool}"></i>First ${early} years</span><span><i style="background:${TIME.warm}"></i>Last five years</span>`,
    draw: (cv) => new Chart(cv, {
      type: 'bar',
      data: { labels: rows.map((r) => name(r.id)), datasets: [
        { label: `First ${early} years`, data: rows.map((r) => r.de), backgroundColor: TIME.cool, borderRadius: 4, barThickness: 18 },
        { label: 'Last five years', data: rows.map((r) => r.dl), backgroundColor: TIME.warm, borderRadius: 4, barThickness: 18 },
      ] },
      options: {
        indexAxis: 'y', maintainAspectRatio: false, layout: { padding: { right: 20 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const r = rows[c.dataIndex]; return c.datasetIndex === 0 ? `${sgn(r.de)} TWh (${pct(r.pe)}): ${nf0.format(r.a)} to ${nf0.format(r.m)} TWh` : `${sgn(r.dl)} TWh (${pct(r.pl)}): ${nf0.format(r.m)} to ${nf0.format(r.b)} TWh`; } } } },
        scales: { x: { grace: '28%', grid: { color: GRID }, title: { display: true, text: 'Change in sales (TWh)' } }, y: { grid: { display: false } } },
      },
      plugins: [barEndLabels((i, v, d) => `${sgn(v)} TWh  (${pct(d === 0 ? rows[i].pe : rows[i].pl)})`)],
    }),
  } : {
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
    id: 'totals', label: '12-month totals', height: 400,
    note: 'Electricity sold to customers in each 12-month window, stacked by sector, in TWh. The bars start at zero.',
    legend,
    draw: (cv) => new Chart(cv, {
      type: 'bar',
      data: { labels: ks.map((k) => [ymLabel(months[win(k).lo]), `to ${ymLabel(months[win(k).hi])}`]), datasets: ids.map((id) => ({ label: name(id), data: ks.map((k) => sumW(id, k)), backgroundColor: SECTOR_COLOR[id], borderColor: '#ffffff', borderWidth: 2, borderRadius: 3, stack: 's' })) },
      options: {
        maintainAspectRatio: false, layout: { padding: { top: 28 } },
        plugins: { legend: { display: false }, tooltip: { itemSort: (a, c) => c.datasetIndex - a.datasetIndex, callbacks: { title: (it) => lab(ks[it[0].dataIndex]), label: (c) => `${c.dataset.label}: ${nf0.format(c.parsed.y)} TWh` } } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, font: { size: 11 } } }, y: { stacked: true, grid: { color: GRID }, title: { display: true, text: 'TWh sold in 12 months' } } },
      },
      plugins: [barTopLabels((i) => `${nf0.format(tot(ks[i]))}`)],
    }),
  };
  const chg = (d, p) => `${sgn(d)} (${pct(p)})`;
  const v3 = {
    id: 'table', label: 'Table',
    table: split
      ? table(['Sector', `TWh ${lab(first)}`, `TWh ${lab(5)}`, `TWh ${lab(0)}`, `Change, first ${early} years (TWh)`, 'Change, last five years (TWh)'],
        rows.map((r) => [name(r.id), nf1.format(r.a), nf1.format(r.m), nf1.format(r.b), chg(r.de, r.pe), chg(r.dl, r.pl)]).concat([['All sectors shown', nf1.format(total.a), nf1.format(total.m), nf1.format(total.b), chg(total.de, total.pe), chg(total.dl, total.pl)]]))
      : table(['Sector', `TWh ${lab(first)}`, `TWh ${lab(0)}`, 'Change (TWh)', 'Change (%)'],
        rows.map((r) => [name(r.id), nf1.format(r.a), nf1.format(r.b), sgn(r.d), pct(r.p)]).concat([['All sectors shown', nf1.format(total.a), nf1.format(total.b), sgn(total.d), pct(total.p)]])),
  };
  const splitTitle = split ? `, ${pct(total.pe)} in the first ${early} years and ${pct(total.pl)} in the last five` : '';
  return figure(host, {
    title: `Electricity sold to U.S. customers ${total.d >= 0 ? 'rose' : 'fell'} ${Math.abs(total.p).toFixed(1)}% over ${WORD_N[yrs] || yrs} year${yrs === 1 ? '' : 's'}${splitTitle}`,
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
  const nOld = Math.max(0, ...Object.keys(ye).map(Number));
  const old = nOld >= 6 ? ye[String(nOld)] : null;
  const WIN = ymIndex(meta.window_start.slice(0, 7));
  const LAST = ymIndex(meta.plants_us.snapshot_period);
  const winUnits = us.units.filter((u) => u.state_cls === 'operating' && u.online && ymIndex(u.online) > WIN && ymIndex(u.online) <= LAST);

  root.innerHTML = `<div class="doc">
    <div class="doc__intro">
      <h2>U.S. electricity demand since ChatGPT's release</h2>
      <p>This page covers the Lower 48 states as one system, using EIA's hourly grid data (EIA-930). It follows every month and day of EIA's data since it began in July 2015, and compares the latest 12 complete months with the 12 months before ChatGPT's public release on November 30, 2022${five ? `, and with the same 12 months ${old ? `five and ${WORD_N[nOld] || nOld}` : 'five'} years earlier` : ''}. Alaska and Hawaii are not in the series.</p>
      <p>The figures show what changed and when. They do not attribute any change to data centers or to any other cause. The PJM case study and the PJM map are the next tabs.</p>
    </div>
    <dl class="ledger" id="ledger"></dl>
    <div id="figs"></div></div>`;

  const tiles = [
    ['Electricity used, latest 12 months', `${nf0.format(twhOf(l))} TWh`, `${ymLabel(l.from)} to ${ymLabel(l.to)}`, TIME.warm],
  ];
  if (old) tiles.push([`Change over ${WORD_N[nOld] || nOld} years`, pct(dem(twhOf(old), twhOf(l))), `${nf0.format(twhOf(old))} TWh in ${ymLabel(old.from)} to ${ymLabel(old.to)}`, TIME.cool]);
  if (five) tiles.push(['Change over five years', pct(dem(twhOf(five), twhOf(l))), `${nf0.format(twhOf(five))} TWh in ${ymLabel(five.from)} to ${ymLabel(five.to)}`, '#7aa6b8']);
  tiles.push(['Change since the year before ChatGPT', pct(dem(twhOf(b), twhOf(l))), `${nf0.format(twhOf(b))} TWh in ${ymLabel(b.from)} to ${ymLabel(b.to)}`, '#9db7c4']);
  root.querySelector('#ledger').innerHTML = tiles.map(([k, v, s, c]) => `<div style="--ledger:${c}"><dt>${esc(k)}</dt><dd>${esc(v)}<small>${esc(s)}</small></dd></div>`).join('');

  const figs = root.querySelector('#figs');
  push(demandFigure(figs, { meta, demand, dm: meta.demand_us, scope: 'U.S.', series: 'respondent US48, the Lower 48 total' }));
  if (us.retail) push(retailFigure(figs, us.retail, meta));
  push(fuelFigure(figs, { meta, fuel, fm: meta.fuel_us, scope: 'U.S.' }));
  push(additionsFigure(figs, { meta, units: us.units, winUnits, removed: us.removed, snapshot: meta.plants_us.snapshot_period, removedBaseline: us.removedBaseline, scopeNote: ' in the 50 states', retired: data.retired, scopeLabel: 'us' }));
  return () => parts.forEach((p) => p.destroy());
}

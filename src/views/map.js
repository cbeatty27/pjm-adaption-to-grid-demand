import maplibregl from 'maplibre-gl';
import { FUEL_COLOR } from '../lib/fuels.js';
import { esc, nf0, mw as fmtMw, ymIndex, indexYm, ymLabel, sum } from '../lib/format.js';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const BLANK = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dfe5ea' } }] };

async function pickStyle() {
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('basemap') === 'none') return { style: BLANK, ok: false };
  try {
    const r = await fetch(STYLE_URL, { method: 'GET' });
    if (r.ok) return { style: STYLE_URL, ok: true };
  } catch { /* fall through */ }
  return { style: BLANK, ok: false };
}

function squareIcon() {
  const s = 24, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
  g.fillStyle = '#0e1b2b'; g.fillRect(3, 3, s - 6, s - 6);
  return g.getImageData(0, 0, s, s);
}

export async function mount(root, data) {
  const { meta, units, dcs } = data;
  const groups = meta.groups; // [{key,label}]
  const WIN = ymIndex(meta.window_start.slice(0, 7)); // month containing the ChatGPT release
  const LATEST = ymIndex(meta.plants.snapshot_period);
  const N = LATEST - WIN; // months on the timeline: WIN+1 .. LATEST
  const pjmStates = new Set(meta.pjm_states_with_eia_plants);

  // ---- classify units (EIA's own status text; nothing inferred) ----
  const op = units.filter((u) => u.state_cls === 'operating');
  op.forEach((u) => { u.t = u.online ? ymIndex(u.online) : null; });
  const winUnits = op.filter((u) => u.t != null && u.t > WIN && u.t <= LATEST);
  const fleetUnits = op.filter((u) => u.t != null && u.t <= WIN);
  const undated = op.filter((u) => u.t == null).length;
  const planned = units.filter((u) => u.state_cls === 'planned').length;

  // monthly additions by group, for the ruler and the panel
  const monthly = Array.from({ length: N }, () => Object.fromEntries(groups.map((g) => [g.key, 0])));
  winUnits.forEach((u) => { monthly[u.t - WIN - 1][u.group] += u.mw || 0; });
  const maxMonth = Math.max(1, ...monthly.map((m) => sum(Object.values(m))));

  const state = { s: N - 1, mode: 'cum', playing: false, fuels: new Set(groups.map((g) => g.key)), showFleet: false, showDc: true, dcPjmOnly: true, dcTypes: new Set(['building', 'campus', 'point']) };

  root.innerHTML = `
    <div class="mapview">
      <div class="mapview__map"><div id="map" role="application" aria-label="Map of PJM-area generators and IM3 data center records"></div><div class="map-note" id="mapnote" hidden></div></div>
      <aside class="mapview__side" aria-label="Summary and layers">
        <section class="side__section" aria-live="polite">
          <h2 id="sumTitle"></h2>
          <div class="side__big num"><span id="sumMw"></span><small>MW nameplate</small></div>
          <p class="side__sub" id="sumSub"></p>
          <ul class="fuelrows" id="fuelRows"></ul>
        </section>
        <section class="side__section">
          <h2>Layers</h2>
          <div class="toggles">
            <label class="check"><input type="checkbox" id="lyFleet"><span>Generators online before the window<small>EIA operating units with an operating month up to ${esc(ymLabel(indexYm(WIN)))}, drawn faintly for context.</small></span></label>
            <label class="check"><input type="checkbox" id="lyDc" checked><span><svg class="key" width="12" height="12"><rect width="12" height="12" fill="#0e1b2b"/></svg>Data center records (IM3, static)<small>IM3 has no online date, so these do not move with the slider. Footprint area sets symbol size.</small></span></label>
            <div class="chips" id="dcTypes" role="group" aria-label="IM3 record types"></div>
            <label class="check"><input type="checkbox" id="dcPjm" checked><span>Only states where EIA lists PJM generators<small>State level, so it includes parts of states outside PJM. No boundary file is used.</small></span></label>
          </div>
          <p class="side__sub" id="dcCount"></p>
        </section>
        <section class="side__section side__fine">
          <p><strong>What the dots show.</strong> Each generator is one EIA-860M unit reporting PJM as its balancing authority, placed at the plant's EIA coordinates. EIA does not report whether a generator serves the grid or a particular customer, so this map does not label that.</p>
          <p id="sideCaveats"></p>
        </section>
      </aside>
      <div class="mapview__dock">
        <div class="dock__row">
          <button class="btn" id="play" type="button">Play</button>
          <div class="dock__date num" id="dockDate"></div>
          <div class="seg" role="group" aria-label="Timeline mode">
            <button type="button" data-mode="cum" aria-pressed="true">Cumulative</button>
            <button type="button" data-mode="month" aria-pressed="false">Selected month</button>
          </div>
          <div class="seg" role="group" aria-label="Play speed">
            <button type="button" data-speed="900" aria-pressed="false">Slow</button>
            <button type="button" data-speed="450" aria-pressed="true">Normal</button>
            <button type="button" data-speed="180" aria-pressed="false">Fast</button>
          </div>
          <span class="dock__hint">Bars: MW of generators reaching operation each month, by fuel (tallest bar ${nf0.format(maxMonth)} MW). Drag, or use the arrow keys.</span>
        </div>
        <div class="ruler" id="ruler" tabindex="0" role="slider" aria-label="Timeline month" aria-valuemin="0" aria-valuemax="${N - 1}"><svg id="rulerSvg" aria-hidden="true"></svg></div>
      </div>
    </div>`;

  const $ = (id) => root.querySelector(`#${id}`);
  $('sideCaveats').innerHTML = `Source: EIA Open Data API, generator inventory snapshot ${esc(meta.plants.snapshot_period)}. ${nf0.format(undated)} operating units report no operating month and ${nf0.format(planned)} units are planned or under construction; neither appears on the timeline.`;

  // ---- map ----
  const { style, ok } = await pickStyle();
  const map = new maplibregl.Map({ container: 'map', style, center: [-79.5, 39.8], zoom: 5.2, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  if (!ok) { const n = $('mapnote'); n.hidden = false; n.textContent = 'The basemap could not be loaded. Data layers still work.'; }

  const toFc = (arr, props) => ({ type: 'FeatureCollection', features: arr.map((u, i) => ({ type: 'Feature', id: i, properties: props(u, i), geometry: { type: 'Point', coordinates: [u.lon, u.lat] } })) });
  const winFc = toFc(winUnits, (u) => ({ group: u.group, mw: u.mw || 0, t: u.t, k: `${u.plant}|${u.gen}` }));
  const fleetFc = toFc(fleetUnits, (u) => ({ group: u.group, mw: u.mw || 0, k: `${u.plant}|${u.gen}` }));
  const dcFc = toFc(dcs, (u, i) => ({ type: u.type, st: u.state_abb, sqft: u.sqft ?? 0, i }));
  const byWin = new Map(winUnits.map((u) => [`${u.plant}|${u.gen}`, u]));
  const byFleet = new Map(fleetUnits.map((u) => [`${u.plant}|${u.gen}`, u]));

  const colorExpr = ['match', ['get', 'group'], ...groups.flatMap((g) => [g.key, FUEL_COLOR[g.key] || FUEL_COLOR.other]), FUEL_COLOR.other];
  const radius = (k) => ['interpolate', ['linear'], ['sqrt', ['max', ['get', 'mw'], 0]], 0, 2.5 * k, 12, 6 * k, 32, 12 * k];

  function applyFilters() {
    if (!map.getLayer('win')) return;
    const T = WIN + 1 + state.s;
    const fuel = ['in', ['get', 'group'], ['literal', [...state.fuels]]];
    const time = state.mode === 'cum' ? ['<=', ['get', 't'], T] : ['==', ['get', 't'], T];
    map.setFilter('win', ['all', time, fuel]);
    map.setFilter('fleet', fuel);
    map.setLayoutProperty('fleet', 'visibility', state.showFleet ? 'visible' : 'none');
    const dcF = ['all', ['in', ['get', 'type'], ['literal', [...state.dcTypes]]]];
    if (state.dcPjmOnly) dcF.push(['in', ['get', 'st'], ['literal', [...pjmStates]]]);
    map.setFilter('dc', dcF);
    map.setLayoutProperty('dc', 'visibility', state.showDc ? 'visible' : 'none');
  }

  map.on('load', () => {
    map.addImage('dcsq', squareIcon());
    map.addSource('fleet', { type: 'geojson', data: fleetFc });
    map.addSource('win', { type: 'geojson', data: winFc });
    map.addSource('dc', { type: 'geojson', data: dcFc });
    map.addLayer({ id: 'fleet', type: 'circle', source: 'fleet', paint: { 'circle-color': colorExpr, 'circle-opacity': 0.28, 'circle-radius': radius(0.8) } });
    map.addLayer({
      id: 'dc', type: 'symbol', source: 'dc',
      layout: { 'icon-image': 'dcsq', 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['sqrt', ['max', ['get', 'sqft'], 0]], 0, 0.34, 500, 0.46, 2000, 0.62, 6000, 0.9] },
    });
    map.addLayer({ id: 'win', type: 'circle', source: 'win', paint: { 'circle-color': colorExpr, 'circle-opacity': 0.92, 'circle-radius': radius(1), 'circle-stroke-color': '#0e1b2b', 'circle-stroke-width': 0.8 } });

    const pts = units.filter((u) => u.lat != null && u.lon != null);
    if (pts.length) {
      const b = new maplibregl.LngLatBounds();
      pts.forEach((u) => b.extend([u.lon, u.lat]));
      map.fitBounds(b, { padding: { top: 30, left: 30, right: 30, bottom: 50 }, animate: false, maxZoom: 8 });
    }
    applyFilters();

    const pop = new maplibregl.Popup({ closeButton: true, maxWidth: '340px' });
    const show = (e, html) => pop.setLngLat(e.lngLat).setHTML(html).addTo(map);
    const unitHtml = (u) => `<div class="pop"><h4>${esc(u.name || `Plant ${u.plant}`)}</h4><table>
      <tr><td>Generator</td><td>${esc(u.gen)} (EIA plant ${esc(u.plant)})</td></tr>
      <tr><td>Energy source</td><td>${esc(u.src)} (${esc(groups.find((g) => g.key === u.group)?.label)})</td></tr>
      <tr><td>Nameplate</td><td>${esc(fmtMw(u.mw))}</td></tr>
      <tr><td>Operating month</td><td>${esc(u.online ? ymLabel(u.online) : 'not reported')}</td></tr>
      <tr><td>EIA status</td><td>${esc(u.statusdesc || u.status)}</td></tr>
      <tr><td>EIA sector</td><td>${esc(u.sector || 'n/a')}</td></tr>
      <tr><td>Owner</td><td>${esc(u.entity || 'n/a')}</td></tr>
      <tr><td>Location</td><td>${esc([u.county, u.state].filter(Boolean).join(', '))}</td></tr></table>
      <div class="fine">EIA-860M via the EIA Open Data API. EIA does not report whether this generator serves a data center.</div></div>`;
    for (const [id, lookup] of [['win', byWin], ['fleet', byFleet]]) {
      map.on('click', id, (e) => { const u = lookup.get(e.features[0].properties.k); if (u) show(e, unitHtml(u)); });
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    }
    map.on('click', 'dc', (e) => {
      const d = dcs[e.features[0].properties.i];
      show(e, `<div class="pop"><h4>${esc(d.name || 'Unnamed record')}</h4><table>
        <tr><td>Operator</td><td>${esc(d.operator || 'not given')}</td></tr>
        <tr><td>County</td><td>${esc(d.county)}, ${esc(d.state_abb)}</td></tr>
        <tr><td>IM3 record type</td><td>${esc(d.type)}</td></tr>
        <tr><td>Footprint</td><td>${d.sqft ? `${nf0.format(d.sqft)} sq ft` : 'not given (point record)'}</td></tr>
        <tr><td>IM3 id</td><td>${esc(d.id)}</td></tr></table>
        <div class="fine">IM3 Open Source Data Center Atlas v2026.11.02, derived from OpenStreetMap. IM3 gives no online date and no power figure.</div></div>`);
    });
    map.on('mouseenter', 'dc', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'dc', () => (map.getCanvas().style.cursor = ''));
    updateDcCount();
  });

  // ---- side panel ----
  function renderSummary() {
    const T = WIN + 1 + state.s;
    const tot = Object.fromEntries(groups.map((g) => [g.key, { mw: 0, n: 0 }]));
    for (const u of winUnits) {
      if (state.mode === 'cum' ? u.t <= T : u.t === T) { tot[u.group].mw += u.mw || 0; tot[u.group].n += 1; }
    }
    const all = groups.filter((g) => state.fuels.has(g.key));
    const mwTot = sum(all.map((g) => tot[g.key].mw));
    const nTot = sum(all.map((g) => tot[g.key].n));
    $('sumTitle').textContent = state.mode === 'cum'
      ? `Online from Dec 2022 through ${ymLabel(indexYm(T))}`
      : `Reaching operation in ${ymLabel(indexYm(T))}`;
    $('sumMw').textContent = nf0.format(mwTot);
    $('sumSub').textContent = `${nf0.format(nTot)} generator units. Click a fuel to hide or show it.`;
    const max = Math.max(1, ...groups.map((g) => tot[g.key].mw));
    $('fuelRows').innerHTML = groups.map((g) => `<li><button class="fuelrow" type="button" data-fuel="${g.key}" aria-pressed="${state.fuels.has(g.key)}">
        <i style="background:${FUEL_COLOR[g.key]}"></i><span>${esc(g.label)}</span>
        <span class="bar"><b style="width:${(100 * tot[g.key].mw) / max}%;background:${FUEL_COLOR[g.key]}"></b></span>
        <span class="v">${nf0.format(tot[g.key].mw)}</span></button></li>`).join('');
  }
  $('fuelRows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fuel]'); if (!b) return;
    const k = b.dataset.fuel;
    state.fuels.has(k) ? state.fuels.delete(k) : state.fuels.add(k);
    renderSummary(); drawRuler(); applyFilters();
  });

  function updateDcCount() {
    const n = dcs.filter((d) => state.dcTypes.has(d.type) && (!state.dcPjmOnly || pjmStates.has(d.state_abb))).length;
    $('dcCount').textContent = state.showDc ? `${nf0.format(n)} IM3 records shown (of ${nf0.format(dcs.length)}). A campus and the buildings inside it are separate records, so this is not a count of facilities.` : '';
  }
  $('dcTypes').innerHTML = ['building', 'campus', 'point'].map((t) => `<button class="chip" type="button" data-type="${t}" aria-pressed="true">${t}</button>`).join('');
  $('dcTypes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    const t = b.dataset.type; state.dcTypes.has(t) ? state.dcTypes.delete(t) : state.dcTypes.add(t);
    b.setAttribute('aria-pressed', String(state.dcTypes.has(t))); applyFilters(); updateDcCount();
  });
  $('lyFleet').addEventListener('change', (e) => { state.showFleet = e.target.checked; applyFilters(); });
  $('lyDc').addEventListener('change', (e) => { state.showDc = e.target.checked; applyFilters(); updateDcCount(); });
  $('dcPjm').addEventListener('change', (e) => { state.dcPjmOnly = e.target.checked; applyFilters(); updateDcCount(); });

  // ---- ruler (timeline) ----
  const ruler = $('ruler'), svg = $('rulerSvg');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent) => { const el = document.createElementNS(SVGNS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); (parent || svg).appendChild(el); return el; };
  let W = 0;
  const H = 92, padL = 6, padR = 6, barTop = 6, barBase = 62;
  function xOf(i) { return padL + ((i + 0.5) * (W - padL - padR)) / N; }
  function drawRuler() {
    if (!W) return;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    const bw = Math.max(1, (W - padL - padR) / N - 1.5);
    const scale = (barBase - barTop) / maxMonth;
    for (let i = 0; i < N; i++) {
      let y = barBase;
      const faded = i > state.s;
      for (const g of groups) {
        if (!state.fuels.has(g.key)) continue;
        const h = monthly[i][g.key] * scale;
        if (h <= 0) continue;
        mk('rect', { x: xOf(i) - bw / 2, y: y - h, width: bw, height: h, fill: FUEL_COLOR[g.key], opacity: faded ? 0.22 : 1, stroke: '#fff', 'stroke-width': 0.6 });
        y -= h;
      }
      mk('rect', { x: xOf(i) - bw / 2, y: barBase, width: bw, height: 2, fill: i <= state.s ? '#0e1b2b' : '#cbd3dc' });
    }
    // axis: tick per month, label per January and the first month
    for (let i = 0; i < N; i++) {
      const ym = indexYm(WIN + 1 + i);
      const jan = ym.endsWith('-01');
      mk('line', { x1: xOf(i), x2: xOf(i), y1: barBase + 2, y2: barBase + (jan ? 9 : 5), stroke: '#6b7685', 'stroke-width': 1 });
      if (i === 0) { const t = mk('text', { x: padL, y: barBase + 22, 'text-anchor': 'start' }); t.textContent = ymLabel(ym); }
      else if (jan && i > 4) { const t = mk('text', { x: xOf(i), y: barBase + 22, 'text-anchor': 'middle' }); t.textContent = ym.slice(0, 4); }
    }
    // playhead
    const x = xOf(state.s);
    mk('line', { x1: x, x2: x, y1: 0, y2: barBase + 10, stroke: '#0e1b2b', 'stroke-width': 2 });
    mk('path', { d: `M${x - 6},${barBase + 10} L${x + 6},${barBase + 10} L${x},${barBase + 2} Z`, fill: '#0e1b2b' });
  }
  new ResizeObserver(() => { W = ruler.clientWidth; drawRuler(); }).observe(ruler);

  function setS(s, { fromPlay = false } = {}) {
    state.s = Math.max(0, Math.min(N - 1, s));
    const ym = indexYm(WIN + 1 + state.s);
    $('dockDate').textContent = ymLabel(ym);
    ruler.setAttribute('aria-valuenow', String(state.s));
    ruler.setAttribute('aria-valuetext', ymLabel(ym));
    if (!fromPlay && state.playing) stop();
    renderSummary(); drawRuler(); applyFilters();
  }
  const sFromEvent = (e) => { const r = ruler.getBoundingClientRect(); return Math.round(((e.clientX - r.left - padL) / (r.width - padL - padR)) * N - 0.5); };
  let dragging = false;
  ruler.addEventListener('pointerdown', (e) => { dragging = true; ruler.setPointerCapture(e.pointerId); setS(sFromEvent(e)); ruler.focus(); });
  ruler.addEventListener('pointermove', (e) => { if (dragging) setS(sFromEvent(e)); });
  ruler.addEventListener('pointerup', () => { dragging = false; });
  ruler.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 12 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { setS(state.s - step); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { setS(state.s + step); e.preventDefault(); }
    else if (e.key === 'Home') { setS(0); e.preventDefault(); }
    else if (e.key === 'End') { setS(N - 1); e.preventDefault(); }
    else if (e.key === ' ') { state.playing ? stop() : play(); e.preventDefault(); }
  });

  // ---- play ----
  let timer = null, speed = 450;
  function stop() { state.playing = false; clearInterval(timer); $('play').textContent = 'Play'; }
  function play() {
    if (state.s >= N - 1) setS(0, { fromPlay: true });
    state.playing = true; $('play').textContent = 'Pause';
    timer = setInterval(() => { if (state.s >= N - 1) { stop(); return; } setS(state.s + 1, { fromPlay: true }); }, speed);
  }
  $('play').addEventListener('click', () => (state.playing ? stop() : play()));
  root.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    speed = Number(b.dataset.speed);
    root.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (state.playing) { stop(); play(); }
  }));
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    root.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderSummary(); applyFilters();
  }));

  setS(N - 1);
  return () => { stop(); map.remove(); };
}

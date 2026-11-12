import './styles.css';
import { loadAll, loadUS } from './lib/data.js';
import { esc } from './lib/format.js';

const view = document.getElementById('view');
// needsUS routes read the U.S. files, which exist only when the data build included the U.S. pulls.
const routes = {
  us: { load: () => import('./views/usdemand.js'), title: 'U.S. demand', needsUS: true },
  usmap: { load: () => import('./views/usmap.js'), title: 'U.S. map and timeline', needsUS: true },
  map: { load: () => import('./views/map.js'), title: 'PJM map and timeline' },
  case: { load: () => import('./views/case.js'), title: 'PJM case study' },
  data: { load: () => import('./views/explorer.js'), title: 'All the data' },
  sources: { load: () => import('./views/sources.js'), title: 'Sources and method' },
};
let cleanup = null;

function setTab(name) {
  document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.tab === name)));
  document.title = `${routes[name].title} | Grid demand since ChatGPT`;
}

async function render() {
  const { meta } = await loadAll().catch(() => ({ meta: null }));
  const fallback = meta?.has_us ? 'us' : 'map';
  const asked = (location.hash.replace(/^#\//, '') || fallback).split('?')[0];
  const key = routes[asked] ? asked : fallback;
  setTab(key);
  if (cleanup) { cleanup(); cleanup = null; }
  view.innerHTML = '<p class="loading">Loading data…</p>';
  try {
    const data = await loadAll();
    const r = routes[key];
    let us = null;
    if (r.needsUS) {
      us = await loadUS();
      if (!us) {
        view.innerHTML = `<div class="errorbox"><h2>The U.S. data has not been built yet</h2>
          <p>This tab needs EIA's national hourly demand, fuel mix and generator inventory. They are added when the data pipeline runs with the U.S. pulls: <code>python3 -m pipeline.fetch_eia</code>, then <code>python3 -m pipeline.build_site_data</code>. The PJM tabs work without them.</p></div>`;
        return;
      }
    }
    const mod = await r.load();
    view.innerHTML = '';
    cleanup = (await mod.mount(view, data, us)) || null;
    view.focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="errorbox"><h2>The data could not be loaded</h2><p>${esc(e.message)}</p>
      <p>If you are running the site locally, run the data pipeline first (see the README), or start it with <code>npm run dev:fixtures</code> to preview the layout with synthetic data.</p></div>`;
  }
}

async function chrome() {
  try {
    const { meta } = await loadAll();
    const banner = document.getElementById('banner');
    if (meta.synthetic) {
      banner.hidden = false;
      banner.textContent = 'SYNTHETIC DEVELOPMENT DATA. Every EIA-shaped number on this page is invented for layout testing.';
      document.documentElement.style.setProperty('--banner-h', `${banner.offsetHeight}px`);
    }
    const v = document.getElementById('vintage');
    const rows = [
      ['EIA generators', meta.plants?.snapshot_period ?? 'n/a'],
      ['EIA-930 through', meta.demand?.last_month ?? 'n/a'],
      ['IM3 atlas', 'v2026.11.02'],
    ];
    v.innerHTML = rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('');
  } catch { /* the view shows the error */ }
}

addEventListener('hashchange', render);
chrome();
render();

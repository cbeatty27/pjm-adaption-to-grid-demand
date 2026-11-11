import './styles.css';
import { loadAll } from './lib/data.js';
import { esc } from './lib/format.js';

const view = document.getElementById('view');
const routes = {
  map: () => import('./views/map.js'),
  case: () => import('./views/case.js'),
  sources: () => import('./views/sources.js'),
};
let cleanup = null;

function setTab(name) {
  document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.tab === name)));
  const titles = { map: 'Map and timeline', case: 'PJM case study', sources: 'Sources and method' };
  document.title = `${titles[name]} | PJM's Adaption to Grid Demand`;
}

async function render() {
  const name = (location.hash.replace(/^#\//, '') || 'map').split('?')[0];
  const key = routes[name] ? name : 'map';
  setTab(key);
  if (cleanup) { cleanup(); cleanup = null; }
  view.innerHTML = '<p class="loading">Loading data…</p>';
  try {
    const data = await loadAll();
    const mod = await routes[key]();
    view.innerHTML = '';
    cleanup = (await mod.mount(view, data)) || null;
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

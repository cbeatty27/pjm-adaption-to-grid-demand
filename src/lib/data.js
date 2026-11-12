const get = async (name, optional = false) => {
  const r = await fetch(new URL(`data/${name}`, document.baseURI));
  if (!r.ok) {
    if (optional) return null;
    throw new Error(`${name}: HTTP ${r.status}`);
  }
  return r.json();
};
const unpack = (o) => o.rows.map((r) => Object.fromEntries(o.columns.map((c, i) => [c, r[i]])));

// Removed-from-inventory summary, in one shape for both scopes: { n, mw: {group: MW} }.
function removedSummary(rem, groups) {
  if (Array.isArray(rem.rows)) {
    const rows = unpack(rem);
    const mw = Object.fromEntries(groups.map((g) => [g.key, 0]));
    rows.forEach((u) => { mw[u.group] = (mw[u.group] || 0) + (u.mw || 0); });
    return { n: rows.length, mw };
  }
  const mw = Object.fromEntries(groups.map((g) => [g.key, rem.by_group?.[g.key]?.mw || 0]));
  return { n: rem.total || 0, mw };
}

let cache, usCache;
export function loadAll() {
  cache ??= (async () => {
    const [meta, plantsRaw, demand, fuel, dcRaw] = await Promise.all([
      get('meta.json'), get('plants.json'), get('demand.json'), get('fuelmix.json'), get('datacenters.json'),
    ]);
    return {
      meta, demand, fuel,
      units: unpack({ columns: plantsRaw.columns, rows: plantsRaw.units }),
      removed: removedSummary(plantsRaw.removed_since_baseline, meta.groups),
      removedBaseline: plantsRaw.removed_since_baseline.baseline_period,
      dcs: unpack(dcRaw),
      dcMeta: dcRaw.meta,
    };
  })();
  return cache;
}

// The U.S. files are larger, so they load only when a U.S. tab is opened. Returns null when the
// data build did not include U.S. pulls.
export function loadUS() {
  usCache ??= (async () => {
    const { meta } = await loadAll();
    if (!meta.has_us) return null;
    const [plantsRaw, demand, fuel, retail] = await Promise.all([
      get('plants_us.json'), get('demand_us.json'), get('fuelmix_us.json'), get('retail_us.json', true),
    ]);
    return {
      demand, fuel, retail,
      units: unpack({ columns: plantsRaw.columns, rows: plantsRaw.units }),
      removed: removedSummary(plantsRaw.removed_since_baseline, meta.groups),
      removedBaseline: plantsRaw.removed_since_baseline.baseline_period,
      statusNames: meta.status_names || {},
    };
  })();
  return usCache;
}

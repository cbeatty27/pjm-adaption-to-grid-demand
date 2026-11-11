const get = async (name) => {
  const r = await fetch(new URL(`data/${name}`, document.baseURI));
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
};
let cache;
export function loadAll() {
  cache ??= (async () => {
    const [meta, plantsRaw, demand, fuel, dcRaw] = await Promise.all([
      get('meta.json'), get('plants.json'), get('demand.json'), get('fuelmix.json'), get('datacenters.json'),
    ]);
    const unpack = (o) => o.rows.map((r) => Object.fromEntries(o.columns.map((c, i) => [c, r[i]])));
    return {
      meta, demand, fuel,
      units: unpack({ columns: plantsRaw.columns, rows: plantsRaw.units }),
      removed: unpack(plantsRaw.removed_since_baseline),
      removedBaseline: plantsRaw.removed_since_baseline.baseline_period,
      dcs: unpack(dcRaw),
      dcMeta: dcRaw.meta,
    };
  })();
  return cache;
}

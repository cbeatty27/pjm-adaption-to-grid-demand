import { esc, nf0, ymLabel } from '../lib/format.js';

const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;

export function mount(root, { meta, dcMeta }) {
  const r = meta.routes || {};
  const p = meta.plants || {};
  const retrieved = meta.retrieved_at_utc ? esc(meta.retrieved_at_utc.replace('T', ' ').replace(/\+.*/, ' UTC')) : 'n/a';
  root.innerHTML = `<div class="doc">
    <div class="doc__intro">
      <h2>Sources and method</h2>
      <p>Two datasets drive everything on this site: the U.S. Energy Information Administration (EIA) and the IM3 Open Source Data Center Atlas. Nothing else supplies data. Each source below says exactly what was taken and how it was used, so you can check it independently.</p>
    </div>

    <section class="src"><h3>1. EIA Open Data API, generator inventory</h3><dl>
      ${row('What it is', 'EIA\'s monthly generator inventory, based on Form EIA-860M, which supplements the annual Form EIA-860.')}
      ${row('Route', `<code>${esc(r.generators?.route || 'electricity/operating-generator-capacity')}</code> at <code>https://api.eia.gov/v2/</code>`)}
      ${row('Filter', 'Balancing authority code = PJM. Two monthly snapshots: ' + esc(meta.generators_latest?.period || 'latest') + ' and ' + esc(meta.generators_baseline?.period || 'baseline') + '.')}
      ${row('Fields used', 'Plant ID, generator ID, plant name, owner, state, county, EIA sector, status, energy source code, prime mover, nameplate MW, latitude, longitude, operating month.')}
      ${row('How it is used', 'Map and timeline: a generator appears in the month EIA gives as its operating month, if EIA\'s status shows it operating. Energy source codes are grouped into fuels with a fixed lookup (below). Units present in the baseline snapshot but missing from the latest are reported as a count, not netted out.')}
      ${row('Not done', 'No generator is labelled as serving the grid, a data center or any other customer. EIA does not report that, and this site does not guess it. EIA\'s own "sector" label is shown in the pop-up as reported.')}
      ${row('This build', `${nf0.format(p.units ?? 0)} units with coordinates from the ${esc(p.snapshot_period || '')} snapshot; ${nf0.format(p.units_without_coordinates_excluded ?? 0)} without coordinates left off the map. Retrieved ${retrieved}.`)}
    </dl></section>

    <section class="src"><h3>2. EIA Open Data API, PJM demand and fuel mix (EIA-930)</h3><dl>
      ${row('What it is', 'Hourly operating data that balancing authorities, including PJM, report to EIA on Form EIA-930.')}
      ${row('Routes', `<code>electricity/rto/region-data</code> (demand, type D); <code>electricity/rto/region-sub-ba-data</code> (PJM subregions); <code>electricity/rto/fuel-type-data</code> (net generation by fuel). Respondent or parent: PJM.`)}
      ${row('Period', `Hourly from 2019-01-01. Demand months ${esc(meta.demand?.first_month || '')} to ${esc(meta.demand?.last_month || '')}.`)}
      ${row('How it is used', 'Hours are grouped into months in Eastern time. Demand: monthly highest, average and lowest hour. Fuel mix: monthly GWh per fuel group. The case study compares two 12-month windows (' + esc((meta.baseline_window || []).join(' to ')) + ' and the latest 12 complete months).')}
      ${row('Cleaning', `Hours with a non-positive demand value are dropped and counted (${nf0.format(meta.demand?.non_positive_rows_dropped ?? 0)}). Duplicate hours are removed. Months with under 97% of expected hours are excluded from charts. Nothing is filled in or estimated.`)}
      ${row('Why not PJM directly', 'PJM\'s own Data Miner service was not used. PJM figures here are PJM\'s reports to EIA.')}
    </dl></section>

    <section class="src"><h3>3. IM3 Open Source Data Center Atlas</h3><dl>
      ${row('What it is', 'A national set of data center footprints and points from the U.S. Department of Energy\'s IM3 project at Pacific Northwest National Laboratory, derived from OpenStreetMap.')}
      ${row('Citation', 'Mongird, K., Thurber, T., Vernon, C., Burleyson, C., Akdemir, K. Z., Rice, J. IM3 Open Source Data Center Atlas. MSD-LIVE Data Repository. DOI 10.57931/2550666. Also at <a href="https://www.osti.gov/biblio/2550666">osti.gov/biblio/2550666</a>.')}
      ${row('File used', `<code>${esc(dcMeta.file)}</code>, version 2026.11.02, supplied by the site owner. SHA-256 <code>${esc(dcMeta.sha256.slice(0, 16))}…</code>`)}
      ${row('Fields used', 'id, state, county, operator, name, sqft, lat, lon, type (point, building or campus). Nothing is added to a record.')}
      ${row('How it is used', 'Shown as a static layer. The atlas has no online date and no power figure, so the layer does not move with the timeline and the footprint area is never converted to MW.')}
      ${row('Handling', `${nf0.format(dcMeta.rows_in_file)} rows in the file; ${nf0.format(dcMeta.multi_county_rows_merged)} appear twice with the same id (one row per county the footprint crosses) and are shown once with both counties, leaving ${nf0.format(dcMeta.rows)} records. A campus and the buildings inside it are separate records, so counts are of records, not facilities.`)}
      ${row('License', 'Open Database License (ODbL) 1.0. © OpenStreetMap contributors.')}
    </dl></section>

    <h2 class="sec">Supporting components, not data sources</h2>
    <ul>
      <li><strong>Basemap tiles:</strong> OpenFreeMap vector tiles (OpenMapTiles, data from OpenStreetMap), loaded in your browser for the map background only. OpenFreeMap states its public service is free, needs no API key and is provided as-is. Attribution is shown on the map.</li>
      <li><strong>Software, bundled into the site:</strong> MapLibre GL JS (map), Chart.js (charts), Vite (build), IBM Plex fonts via Fontsource. Python with pandas and requests runs the data pipeline.</li>
      <li><strong>Hosting and automation:</strong> GitHub Pages and GitHub Actions. The EIA API key is stored as an Actions secret and appears nowhere in the code or the site.</li>
      <li><strong>Documentation read to learn field names, not used as data:</strong> EIA's API documentation and the OSTI record for the IM3 atlas.</li>
    </ul>

    <h2 class="sec">Fuel groups</h2>
    <p>EIA energy source codes in the generator inventory map to groups as follows. Everything not listed falls in Other, including oil, biomass, geothermal and waste heat.</p>
    <ul>
      <li>Natural gas: <code>NG</code>. Coal: <code>BIT, SUB, LIG, ANT, RC, WC, SGC</code>. Nuclear: <code>NUC</code>. Solar: <code>SUN</code>. Wind: <code>WND</code>. Hydro: <code>WAT</code>. Storage: <code>MWH</code>.</li>
      <li>EIA-930 fuel types: <code>NG, COL, NUC, SUN, WND, WAT</code> map to the groups above; <code>BAT, PS, ESS</code> to Storage; <code>OIL, OTH, GEO, BIO, UNK</code> to Other.</li>
    </ul>

    <h2 class="sec">Limits to keep in mind</h2>
    <ul>
      <li>Nameplate capacity is the maximum rating, not output or load. A new generator's MW is not a measure of how much it runs.</li>
      <li>The study window opens after ChatGPT's public release on November 30, 2022. EIA reports operating months, so a generator reported for November 2022 counts as before the window.</li>
      <li>IM3 comes from OpenStreetMap, which is crowd-sourced. Absence of a site on the map is not evidence that no data center exists there, and IM3 may include non-operating or mislabeled sites.</li>
      <li>"States where EIA lists PJM generators" is a state-level filter and includes parts of states outside PJM. No PJM boundary file is used.</li>
      <li>EIA-930 data are as reported by balancing authorities and can be revised. EIA-930 generation and EIA-923 plant generation are different series and are not mixed.</li>
      <li>The charts show changes over time and do not attribute them to data centers or any other cause.</li>
    </ul>

    <h2 class="sec">Reproduce it</h2>
    <p>The repository holds the pipeline and the processed data. With your own EIA API key: <code>EIA_API_KEY=… python -m pipeline.fetch_eia</code>, then <code>python -m pipeline.build_datacenters</code> and <code>python -m pipeline.build_site_data</code>. A scheduled GitHub Action does this and redeploys the site.</p>
    <p class="side__fine">Built ${esc(meta.built_at_utc || '')}. Generator snapshot ${esc(p.snapshot_period ? ymLabel(p.snapshot_period) : 'n/a')}.</p>
  </div>`;
}

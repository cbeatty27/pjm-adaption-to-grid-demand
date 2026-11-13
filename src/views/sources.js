import { esc, nf0, ymLabel } from '../lib/format.js';

const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
// EIA's own names for the EIA-930 fuel codes, as returned by the API in this build
function codeNameList(meta) {
  const one = (label, b) => (b?.code_names && Object.keys(b.code_names).length
    ? `<li>${label} fuel codes as EIA names them: ${Object.entries(b.code_names).map(([c, n]) => `<code>${esc(c)}</code> ${esc(n)} (${esc(b.code_groups?.[c] || 'other')})`).join('; ')}.</li>` : '');
  return one('PJM', meta.fuel) + one('U.S.', meta.fuel_us);
}

export function mount(root, { meta, dcMeta }) {
  const r = meta.routes || {};
  const US = !!meta.has_us;
  const pu = meta.plants_us || {};
  const du = meta.demand_us || {};
  const rr = meta.demand?.outlier_rule || {};
  const rule = {
    series: rr.series || { high_x_median: rr.high_x_median ?? 1.5, low_x_median: rr.low_x_median ?? 0.5 },
    zones: rr.zones || { high_x_median: 3, low_x_median: 0.25 },
  };
  const p = meta.plants || {};
  const retrieved = meta.retrieved_at_utc ? esc(meta.retrieved_at_utc.replace('T', ' ').replace(/\+.*/, ' UTC')) : 'n/a';
  root.innerHTML = `<div class="doc">
    <div class="doc__intro">
      <h2>Sources and method</h2>
      <p>Two organizations supply the data on this site: the U.S. Energy Information Administration (EIA) and the IM3 Open Source Data Center Atlas. Nothing else supplies data. Each source below says exactly what was taken and how it was used, so you can check it independently.</p>
    </div>

    <section class="src"><h3>1. EIA Open Data API, generator inventory</h3><dl>
      ${row('What it is', 'EIA\'s monthly generator inventory, based on Form EIA-860M, which supplements the annual Form EIA-860.')}
      ${row('Route', `<code>${esc(r.generators?.route || 'electricity/operating-generator-capacity')}</code> at <code>https://api.eia.gov/v2/</code>`)}
      ${row('Filter', 'PJM tabs: balancing authority code = PJM. U.S. tabs: no balancing authority filter, so every operating-status generator in the 50 states. Two monthly snapshots: ' + esc(meta.generators_latest?.period || 'latest') + ' and ' + esc(meta.generators_baseline?.period || 'baseline') + '.')}
      ${row('Fields used', 'Plant ID, generator ID, plant name, owner, state, county, EIA sector, status, energy source code, prime mover, nameplate MW, latitude, longitude, operating month.')}
      ${row('How it is used', 'Map and timeline: a generator appears in the month EIA gives as its operating month, if EIA\'s status shows it operating. Energy source codes are grouped into fuels with a fixed lookup (below). Units present in the baseline snapshot but missing from the latest are reported as a count, not netted out.')}
      ${row('Not done', 'No generator is labelled as serving the grid, a data center or any other customer. EIA does not report that, and this site does not guess it. EIA\'s own "sector" label is shown in the pop-up as reported.')}
      ${row('Status values', 'The route returns only EIA status codes OP (operating), OS, SB and OA. Planned and under-construction units are not in it, so the maps show no future generators.')}
      ${row('This build', `PJM: ${nf0.format(p.units ?? 0)} units with coordinates from the ${esc(p.snapshot_period || '')} snapshot; ${nf0.format(p.units_without_coordinates_excluded ?? 0)} without coordinates left off the map.${US ? ` U.S.: ${nf0.format(pu.units ?? 0)} units, ${nf0.format(pu.units_without_coordinates_excluded ?? 0)} left off.` : ''} Retrieved ${retrieved}.`)}
    </dl></section>

    <section class="src"><h3>2. EIA Open Data API, demand and fuel mix (EIA-930), PJM and the U.S. Lower 48</h3><dl>
      ${row('What it is', 'Hourly operating data that balancing authorities, including PJM, report to EIA on Form EIA-930.')}
      ${row('Routes', `<code>electricity/rto/region-data</code> (demand, type D); <code>electricity/rto/region-sub-ba-data</code> (PJM subregions); <code>electricity/rto/fuel-type-data</code> (net generation by fuel). Respondent: PJM for the PJM tabs and US48 (EIA's Lower 48 total) for the U.S. tabs. Subregions: parent PJM.`)}
      ${row('Period', `The API serves hourly demand and fuel mix from 2019-01-01. Hours before that come from EIA's six-month Balance files (next section): demand from July 2015, when EIA-930 began, and fuel mix from July 2018, the start of that series. Demand on this site covers months ${esc(meta.demand?.first_month || '')} to ${esc(meta.demand?.last_month || '')}; fuel mix ${esc(meta.fuel?.first_month || '')} to ${esc(meta.fuel?.last_month || '')}. PJM subregions (zones): hourly from 2019-01-01.`)}
      ${row('How it is used', 'Hours are grouped into months in Eastern time. Demand: monthly highest, average and lowest hour. Fuel mix: monthly GWh per fuel group. Daily values are the mean and maximum of each Eastern-time day that has at least ' + esc(String(meta.demand?.daily_min_hours ?? 20)) + ' hours of data. Both demand pages compare the latest 12 complete months with the 12 months before ChatGPT (' + esc((meta.baseline_window || []).join(' to ')) + ') and with the same 12 months one to ten years earlier, as far back as the data allow. The charts plot every month and day in order and do not line up one calendar month against the same month in other years. Energy used is the sum of hourly demand in the window, in TWh.')}
      ${row('Cleaning', `Hours with a non-positive demand value are dropped and counted (${nf0.format(meta.demand?.non_positive_rows_dropped ?? 0)} for PJM${US ? `, ${nf0.format(du.non_positive_rows_dropped ?? 0)} for the U.S.` : ''}). EIA-930 also contains impossible reported values (one hour reads 2,147,480,000 MW). An hour is dropped when it is more than ${rule.series.high_x_median} times or less than ${rule.series.low_x_median} times the median of the surrounding 7 days of the same series. Zone series use a wider band (above ${rule.zones.high_x_median} times or below ${rule.zones.low_x_median} times) because small zones have larger real swings. These are rules of this site and not EIA flags. ${nf0.format(meta.demand?.outlier_hours_dropped_pjm ?? 0)} PJM-wide hours${US ? ` and ${nf0.format(du.outlier_hours_dropped_pjm ?? 0)} U.S. hours` : ''} were dropped, ${nf0.format(meta.demand?.outlier_hours_dropped ?? 0)} counting zones, and the first 400 are listed in <code>data/meta.json</code>. Duplicate hours are removed. Months with under ${Math.round((meta.demand?.min_coverage ?? 0.95) * 100)}% of expected hours are excluded from charts. Nothing is filled in or estimated.`)}
      ${row('Caution', 'The Lower 48 total adds up the balancing authorities that report to EIA-930, which began collecting in July 2015, so the oldest windows come from the survey\'s first year or so. If which authorities report, or how they report, changed over the period, that would show up in the total. The retail sales series (source 3) comes from a different survey and is a separate check.')}
      ${row('Why not PJM directly', 'PJM\'s own Data Miner service was not used. PJM figures here are PJM\'s reports to EIA.')}
    </dl></section>

    <section class="src"><h3>Capacity factors: capacity in service against energy produced</h3><dl>
      ${row('What it shows', 'For each fuel, how much of the energy its capacity could have produced (every unit running every hour) was actually produced, month by month, in rolling 12-month windows, and for the capacity added between two windows. Nothing is inferred about why a unit ran or did not.')}
      ${row('Capacity', 'Net summer capacity of generators in service for the entire month, which is how EIA defines the capacity behind its own capacity factors (it leaves out units that started or retired during the month). A unit counts from the month after its operating date to the month before its retirement month. Operating units come from the EIA generator inventory API route (<code>electricity/operating-generator-capacity</code>, the same data as the EIA-860M Operating tab); retired units come from the EIA-860M Retired tab for every retirement since January 2015 (<code>retired_history.json</code>). Each unit is taken at its latest reported capacity, so uprates, derates and re-ratings are not tracked.')}
      ${row('Energy', 'U.S.: EIA-923 monthly net generation (source above). PJM: EIA-930 net generation by fuel, months with at least 95% of hours. The two surveys differ in scope, and the generator inventory lists utility-scale units of 1 MW or more, so small-scale solar is not in the capacity or the energy.')}
      ${row('Measures', 'Capacity factor = average generation (MW) divided by capacity in service (MW). Added-capacity factor = change in average generation divided by change in average capacity between two 12-month windows, shown only where capacity grew by at least 10%. The fitted lines use one point per 12-month window (average capacity, average generation) and are shown only where capacity moved by at least 10% across the windows. All of it is arithmetic on EIA totals, so it counts every unit, old and new.')}
      ${row('Caution', 'If a unit was missing from, or double counted between, the Operating and Retired tabs, capacity in that month is off by that unit. The validation step stops the build if solar, wind or nuclear capacity factors fall outside 0 to 130%, which would signal an incomplete capacity history. PJM capacity is the units EIA lists in the PJM balancing authority (or, where blank, whose plant ID appears in the PJM snapshots), compared with PJM\'s own EIA-930 generation, so a difference between those two footprints shows up in the ratio.')}
    </dl></section>

    <section class="src"><h3>EIA-930 bulk Balance files (hours before 2019)</h3><dl>
      ${row('What it is', 'EIA\'s downloadable six-month "Balance" CSV files for Form EIA-930, from eia.gov/electricity/gridmonitor. They hold the hourly demand and net generation by energy source for every balancing authority, back to July 2015 (demand) and July 2018 (generation by energy source). The API does not serve these hours.')}
      ${row('Files', 'EIA930_BALANCE_YYYY_Jan_Jun and EIA930_BALANCE_YYYY_Jul_Dec, July 2015 through June 2019 (the last one only overlaps the API and is used to check the others). Step: <code>python3 -m pipeline.fetch_eia930_bulk</code>.')}
      ${row('How it is used', 'Only hours before the API\'s first hour (2019-01-01 00 UTC) are taken from the files, so no hour is counted twice. PJM is its own balancing authority and is taken as published. EIA energy-source names are mapped to the same fuel codes the API uses.')}
      ${row('Checks', 'Time alignment: PJM demand in the Jan-Jun 2019 file is compared with the same hours from the API, and the importer uses the hour offset under which at least 90% of them match, and otherwise writes nothing. U.S. Lower 48: if the files carry a U.S. row it is used; if not, it is the sum of every balancing authority\'s value in the hour, kept only for hours in which at least 90% of the usual reporters reported, and it is used only if its median ratio to EIA\'s own U.S. series over the Jan-Jun 2019 overlap is within 2% of 1. Which of these applied is recorded in <code>data/meta.json</code> under bulk930.')}
      ${row('Caution', 'These are the same survey but a different delivery of it, and EIA cleaned its published series over time, so the oldest hours can be less clean than recent ones. The usual outlier screens apply, and nothing is filled in.')}
    </dl></section>

    ${meta.retired?.rows_kept != null ? `<section class="src"><h3>EIA-860M monthly generator file, Retired tab</h3><dl>
      ${row('What it is', 'The same Form EIA-860M inventory as source 1, published as a monthly Excel file. Its Retired tab lists generators that have retired, with their retirement month. The API route in source 1 lists only generators that are operating, so it cannot show retirements.')}
      ${row('How obtained', `The pipeline reads the file linked from <a href="https://www.eia.gov/electricity/data/eia860m/">eia.gov/electricity/data/eia860m</a> (${esc(String(meta.retired.source || ''))}), keeps the Retired sheet, and records its SHA-256 (<code>${esc(String(meta.retired.sha256 || '').slice(0, 16))}…</code>). It is a direct file download, not an API call.`)}
      ${row('Fields used', `Plant ID, generator ID, plant name, state, energy source code, ${esc(meta.retired.capacity_basis || 'capacity')} (column <code>${esc(meta.retired.capacity_column || '')}</code>), operating month and year, retirement month and year, and latitude and longitude where the tab gives them (otherwise the plant's coordinates from the generator inventory).`)}
      ${row('How it is used', `Units whose retirement month is after November 2022 and not after the generator snapshot month (${nf0.format(meta.retired.rows_kept)} units; ${nf0.format(meta.retired.rows_after_snapshot_period_excluded ?? 0)} later ones left out) are shown as hollow rings on the maps and as negative bars in the added-and-retired chart. The comparison with additions uses ${esc(meta.retired.capacity_basis || 'capacity')} for both sides.`)}
      ${row('PJM subset', `A retired unit is counted as PJM when the tab's own Balancing Authority Code column says PJM (${nf0.format(meta.retired.pjm_rows_by_ba_code ?? 0)} units). Where that code is blank, a plant ID found in the PJM snapshots from the API is used (${nf0.format(meta.retired.pjm_rows_by_plant_id ?? 0)} units). Both are EIA's own fields. Neither says who the unit served.`)}
      ${row('Cross-check', 'Units that left the operating inventory between the two API snapshots but are not on the Retired tab are reported separately and not counted as retirements, because they may have been reclassified or renumbered.')}
    </dl></section>` : ''}

    ${US ? `<section class="src"><h3>3. EIA Open Data API, retail electricity sales</h3><dl>
      ${row('What it is', 'Electricity sold to customers by sector, from EIA\'s monthly electric power survey (Form EIA-861M).')}
      ${row('Route', '<code>electricity/retail-sales</code>, U.S. total (state id US), sectors residential, commercial, industrial, transportation and other where EIA reports them. Unit: million kilowatt-hours (GWh), shown as TWh.')}
      ${row('How it is used', 'A second measure of demand growth on the U.S. demand page: 12-month totals by sector, back as far as ten years from the latest window, and the change over the first five and the last five of those years. It is published later than hourly data, so its latest window ends earlier.')}
      ${row('Not done', 'EIA has no data center sector. The chart does not allocate any sales to data centers.')}
    </dl></section>` : ''}

    <section class="src"><h3>All the data tab: intervals, EIA-923 and screening</h3><dl>
      ${row('What it shows', 'Every hour of EIA-930 demand (from July 2015) and net generation by fuel (from July 2018), for PJM and the Lower 48, with day, month and year summaries built from those hours. No comparison or explanation is added.')}
      ${row('How intervals are built', 'Days are Eastern-time calendar days with at least 20 hourly values; months and years are the average of the hours present, with coverage (hours present divided by hours in the period) shown in the tooltip and table. Nothing is filled in. Hourly files are split by year (<code>hourly_*_YYYY.json</code>) and loaded when a year is opened.')}
      ${row('Screening', 'Demand: a day or hour is dropped when it is above 1.5 or below 0.5 times its rolling 7-day median (3.0 and 0.25 for PJM zones). Generation: an hourly fuel-code value is dropped when above 5 times that code\'s 99.9th percentile of absolute values. The counts dropped are in <code>meta.json</code>.')}
      ${row('EIA-923 (U.S. only)', 'Route <code>electricity/electric-power-operational-data</code>, monthly net generation in thousand MWh (GWh), U.S., all sectors, fuel ids coal, natural gas, nuclear, hydro, pumped storage, solar, wind and all fuels; "Other" is the total minus those. It is plant-reported, covers 50 states and DC and starts before 2018, so it is a different series from EIA-930 and the two are not added together. It is only pulled when <code>fetch_eia</code> runs, and the site works without it.')}
    </dl></section>

    <section class="src"><h3>${US ? '4' : '3'}. IM3 Open Source Data Center Atlas</h3><dl>
      ${row('What it is', 'A national set of data center footprints and points from the U.S. Department of Energy\'s IM3 project at Pacific Northwest National Laboratory, derived from OpenStreetMap.')}
      ${row('Citation', 'Mongird, K., Thurber, T., Vernon, C., Burleyson, C., Akdemir, K. Z., Rice, J. IM3 Open Source Data Center Atlas. MSD-LIVE Data Repository. DOI 10.57931/2550666. Also at <a href="https://www.osti.gov/biblio/2550666">osti.gov/biblio/2550666</a>.')}
      ${row('File used', `<code>${esc(dcMeta.file)}</code>, version 2026.11.02, supplied by the site owner. SHA-256 <code>${esc(dcMeta.sha256.slice(0, 16))}…</code>`)}
      ${row('Fields used', 'id, state, county, operator, name, sqft, lat, lon, type (point, building or campus). Nothing is added to a record.')}
      ${row('How it is used', 'Shown as a static layer on both maps. The atlas has no online date and no power figure, so the layer does not move with the timeline and the footprint area is never converted to MW.')}
      ${row('Handling', `${nf0.format(dcMeta.rows_in_file)} rows in the file; ${nf0.format(dcMeta.multi_county_rows_merged)} appear twice with the same id (one row per county the footprint crosses) and are shown once with both counties, leaving ${nf0.format(dcMeta.rows)} records. A campus and the buildings inside it are separate records, so counts are of records, not facilities.`)}
      ${row('License', 'Open Database License (ODbL) 1.0. © OpenStreetMap contributors.')}
    </dl></section>

    <h2 class="sec">Supporting components, not data sources</h2>
    <ul>
      <li><strong>Basemap tiles:</strong> OpenFreeMap vector tiles (OpenMapTiles, data from OpenStreetMap), loaded in your browser for the map background only. OpenFreeMap states its public service is free, needs no API key and is provided as-is. Attribution is shown on the map.</li>
      <li><strong>Software, bundled into the site:</strong> MapLibre GL JS (map), Chart.js (charts), Vite (build), Instrument Sans via Fontsource. Python with pandas and requests runs the data pipeline.</li>
      <li><strong>Hosting and automation:</strong> GitHub Pages and GitHub Actions. The EIA API key is stored as an Actions secret and appears nowhere in the code or the site.</li>
      <li><strong>Documentation read to learn field names, not used as data:</strong> EIA's API documentation, EIA's description of the EIA-860M workbook tabs, and the OSTI record for the IM3 atlas.</li>
    </ul>

    <h2 class="sec">Fuel groups</h2>
    <p>EIA energy source codes in the generator inventory map to groups as follows. Everything not listed falls in Other, including oil, biomass, geothermal and waste heat.</p>
    <ul>
      <li>Natural gas: <code>NG</code>. Coal: <code>BIT, SUB, LIG, ANT, RC, WC, SGC</code>. Nuclear: <code>NUC</code>. Solar: <code>SUN</code>. Wind: <code>WND</code>. Hydro: <code>WAT</code>. Storage: <code>MWH</code>.</li>
      <li>EIA-930 fuel types: <code>NG, COL, NUC, SUN, WND, WAT</code> map to the groups above; <code>BAT, PS, ESS</code> to Storage; <code>OIL, OTH, GEO, BIO, UNK</code> to Other. Four codes EIA added in 2025 follow EIA's own names: <code>OES</code> (other energy storage) and <code>UES</code> (unknown energy storage) to Storage, <code>SNB</code> (solar with integrated battery storage) to Solar and <code>WNB</code> (wind with integrated battery storage) to Wind. A code not in this list falls in Other and is listed in <code>data/meta.json</code>.</li>
      <li>Storage in generation charts: the PJM series carries no storage codes, so the PJM fuel-mix charts have no Storage bar. The U.S. series has storage values from mid-2024 and shows them as net generation, negative when storage charges. Storage in the generator-capacity charts and maps comes from EIA-860M (<code>MWH</code>), a different source, and is listed for both PJM and the U.S.</li>
      ${codeNameList(meta)}
    </ul>

    <h2 class="sec">Limits to keep in mind</h2>
    <ul>
      <li>Nameplate capacity is the maximum rating, not output or load. A new generator's MW is not a measure of how much it runs.</li>
      <li>The study window opens after ChatGPT's public release on November 30, 2022. EIA reports operating months, so a generator reported for November 2022 counts as before the window.</li>
      <li>IM3 comes from OpenStreetMap, which is crowd-sourced. Absence of a site on the map is not evidence that no data center exists there, and IM3 may include non-operating or mislabeled sites.</li>
      <li>On the PJM map, data center records are limited by default to states where EIA lists PJM generators. That is a state-level filter: it includes parts of states outside PJM and hides every record in other states (New York, including Manhattan, has IM3 records that are hidden this way). Untick the box to see all records, or use the U.S. map. No PJM boundary file is used.</li>
      <li>The U.S. series is the Lower 48 only (EIA-930 respondent US48); retail sales include Alaska and Hawaii.</li>
      <li>EIA-930 data are as reported by balancing authorities and can be revised. EIA-930 generation and EIA-923 plant generation are different series and are not mixed.</li>
      <li>The charts show changes over time and do not attribute them to data centers or any other cause.</li>
    </ul>

    <h2 class="sec">Reproduce it</h2>
    <p>The repository holds the pipeline and the processed data. With your own EIA API key: <code>EIA_API_KEY=… python -m pipeline.fetch_eia</code> (which also downloads the EIA-860M workbook for retirements), then <code>python -m pipeline.build_datacenters</code> and <code>python -m pipeline.build_site_data</code>. A scheduled GitHub Action does this and redeploys the site.</p>
    <p class="side__fine">Built ${esc(meta.built_at_utc || '')}. Generator snapshot ${esc(p.snapshot_period ? ymLabel(p.snapshot_period) : 'n/a')}.</p>
  </div>`;
}

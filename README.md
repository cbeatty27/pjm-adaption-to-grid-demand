# PJM's Adaption to Grid Demand

A study of how the PJM Interconnection's generation and demand changed from the public release of ChatGPT (November 30, 2022) to today, alongside the locations of data centers in the IM3 atlas.

The site has three tabs: a map with a timeline slider, a PJM case study (demand, zone growth, fuel mix, generator additions) and a sources and method page.

## Data sources

Only two datasets supply data. Details, fields and limits are on the site's Sources tab.

1. **EIA Open Data API v2** (`api.eia.gov`): generator inventory (`electricity/operating-generator-capacity`, EIA-860M based) and EIA-930 PJM demand, subregion demand and fuel mix (`electricity/rto/*`).
2. **IM3 Open Source Data Center Atlas** (PNNL, DOI 10.57931/2550666, ODbL), file version 2026.11.02, in `data/raw/im3/`.

Also used, but not data: OpenFreeMap vector tiles for the map background; MapLibre GL JS, Chart.js, Vite and IBM Plex (bundled); GitHub Actions and Pages.

## What this does not do

* It does not label any generator as serving the grid or a data center. EIA does not report that, and nothing is inferred.
* IM3 has no online dates or power figures, so data centers are a static layer and footprint area is never converted to MW.
* It does not attribute changes in demand or fuel mix to any cause.

## Run it

```bash
pip install -r pipeline/requirements.txt
export EIA_API_KEY=...            # never commit this
python -m pipeline.fetch_eia      # pulls EIA data into pipeline/cache (git-ignored)
python -m pipeline.build_datacenters
python -m pipeline.build_site_data
python -m pipeline.validate
npm install && npm run dev
```

`npm run dev:fixtures` previews the layout with **synthetic** data built by `scripts/make_dev_fixtures.py`. That data is invented, is stamped synthetic and shows a red banner, and is never deployed.

## Deploy

`.github/workflows/site.yml` pulls EIA data (weekly, or on demand), validates it, commits `public/data`, builds the site and publishes to GitHub Pages. Add the key as a repository secret named `EIA_API_KEY` and set Pages to deploy from GitHub Actions.

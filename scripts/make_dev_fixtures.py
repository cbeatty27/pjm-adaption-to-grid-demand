"""Create SYNTHETIC, EIA-shaped files so the website UI can be developed without API access.

Everything here is invented. Output goes to .dev/ (git-ignored) and meta.json is stamped
synthetic=true, which makes the site show a red banner. This must never be deployed.
"""
import gzip, json, os, shutil, sys
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEV = ROOT / ".dev"
CACHE = DEV / "cache"
OUT = DEV / "public/data"
CACHE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(7)

# ---- generators -------------------------------------------------------------------
boxes = {"VA": (36.8, 39.0, -80.5, -76.8), "PA": (39.8, 41.8, -80.4, -75.2), "OH": (38.6, 41.5, -84.6, -80.6),
         "NJ": (39.2, 40.9, -75.4, -74.1), "MD": (38.2, 39.6, -79.2, -75.9), "IL": (41.2, 42.2, -88.5, -87.6),
         "WV": (37.4, 40.5, -82.5, -78.0), "IN": (40.8, 41.6, -87.4, -85.5)}
src_w = [("NG", .38), ("SUN", .22), ("WND", .08), ("MWH", .12), ("BIT", .05), ("NUC", .02), ("WAT", .05), ("DFO", .08)]
codes = [c for c, _ in src_w]; w = np.array([x for _, x in src_w]); w /= w.sum()
rows = []
for i in range(900):
    st = rng.choice(list(boxes)); b = boxes[st]
    src = rng.choice(codes, p=w)
    y = int(rng.choice([2005, 2012, 2018, 2020, 2022, 2023, 2024, 2025, 2026], p=[.18, .15, .15, .08, .1, .1, .1, .1, .04]))
    mo = int(rng.integers(1, 13))
    planned = y == 2026 and mo > 9
    rows.append({"period": "2026-10", "plantid": str(1000 + i // 2), "plantName": f"SYNTHETIC PLANT {1000 + i // 2}",
                 "generatorid": f"G{i % 2 + 1}", "entityName": "SYNTHETIC ENTITY", "stateid": st, "county": "Synthetic",
                 "sectorName": rng.choice(["Electric Utility", "IPP Non-CHP", "Industrial CHP"]),
                 "status": "P" if planned else "OP", "statusDescription": "Planned" if planned else "Operating",
                 "energy_source_code": src, "prime_mover_code": "XX", "technology": "synthetic",
                 "nameplate-capacity-mw": str(round(float(rng.lognormal(4, 1)), 1)), "net-summer-capacity-mw": "1", "net-winter-capacity-mw": "1",
                 "latitude": str(round(rng.uniform(b[0], b[1]), 4)), "longitude": str(round(rng.uniform(b[2], b[3]), 4)),
                 "operating-year-month": f"{y}-{mo:02d}", "balancing_authority_code": "PJM"})
gen = pd.DataFrame(rows)
gen.to_csv(CACHE / "generators_latest.csv.gz", index=False, compression="gzip")
base = gen.sample(frac=0.97, random_state=1); base["period"] = "2022-11"
base.to_csv(CACHE / "generators_baseline.csv.gz", index=False, compression="gzip")

# ---- hourly series ---------------------------------------------------------------
idx = pd.date_range("2019-01-01", "2026-10-31 23:00", freq="h", tz="UTC")
t = np.arange(len(idx)); yrs = t / 8760
hod = idx.tz_convert("America/New_York").hour.values
doy = idx.dayofyear.values
load = 88000 + 2500 * yrs + 9000 * np.cos((doy - 200) / 365 * 2 * np.pi) ** 2 + 6000 * np.sin((hod - 9) / 24 * 2 * np.pi) + rng.normal(0, 1500, len(idx))
per = idx.strftime("%Y-%m-%dT%H")
pd.DataFrame({"period": per, "respondent": "PJM", "type": "D", "value": load.round(0).astype(int).astype(str)}).to_csv(CACHE / "demand_hourly.csv.gz", index=False, compression="gzip")

mix = {"NG": .38, "NUC": .33, "COL": .20, "WND": .04, "SUN": .01, "WAT": .02, "OIL": .005, "OTH": .015}
frames = []
for k, v in mix.items():
    drift = {"NG": .02, "SUN": .03, "COL": -.02, "NUC": -.002}.get(k, 0) * yrs
    val = load * (v + drift) * (1 + rng.normal(0, .02, len(idx)))
    frames.append(pd.DataFrame({"period": per, "respondent": "PJM", "fueltype": k, "value": val.round(0).astype(int).astype(str)}))
pd.concat(frames).to_csv(CACHE / "fuel_hourly.csv.gz", index=False, compression="gzip")

zf = []
for z, share, gr in [("DOM", .20, .045), ("COMED", .16, .0), ("AEP", .18, .01), ("PSEG", .09, -.005), ("PPL", .06, .02)]:
    zf.append(pd.DataFrame({"period": per, "subba": z, "subba-name": f"SYNTHETIC {z}", "parent": "PJM",
                            "value": (load * share * (1 + gr * yrs) * (1 + rng.normal(0, .02, len(idx)))).round(0).astype(int).astype(str)}))
pd.concat(zf).to_csv(CACHE / "subba_hourly.csv.gz", index=False, compression="gzip")

(CACHE / "provenance_eia.json").write_text(json.dumps({
    "retrieved_at_utc": "SYNTHETIC", "routes": {k: {"route": "synthetic"} for k in ("demand", "subba", "fuel")},
    "generators_latest": {"period": "2026-10", "rows": len(gen)}, "generators_baseline": {"period": "2022-11", "rows": len(base)}}))

shutil.copy(ROOT / "public/data/datacenters.json", OUT / "datacenters.json")
env = dict(os.environ, PJM_CACHE=str(CACHE), PJM_OUT=str(OUT), PJM_SYNTHETIC="1")
os.execvpe(sys.executable, [sys.executable, "-m", "pipeline.build_site_data"], env)

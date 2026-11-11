"""Turn the IM3 Open Source Data Center Atlas CSV into compact site JSON.

Nothing is inferred: every value is copied from the IM3 file. Exact duplicate rows are
removed and counted. `sqft` is IM3's footprint area; it is NOT converted to power.
"""
from __future__ import annotations
import hashlib, json, sys
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/im3/im3_open_source_data_center_atlas_v2026.11.02.csv"
OUT = ROOT / "public/data/datacenters.json"
COLS = ["id", "state_abb", "county", "operator", "name", "ref", "sqft", "lat", "lon", "type"]


def main() -> int:
    raw = RAW.read_bytes()
    df = pd.read_csv(RAW, dtype=str, keep_default_na=False)
    n_raw = len(df)
    # A footprint that crosses a county line appears once per county with the same id and
    # otherwise identical values. Show it once, listing both counties.
    n_ids = df["id"].nunique()
    counties = df.groupby("id", sort=False)["county"].agg(lambda s: " / ".join(dict.fromkeys(s)))
    df = df.drop_duplicates(subset="id", keep="first").copy()
    df["county"] = df["id"].map(counties)
    n_dupes = n_raw - len(df)
    assert len(df) == n_ids
    df["lat"] = df["lat"].astype(float).round(6)
    df["lon"] = df["lon"].astype(float).round(6)
    rows = []
    for r in df.itertuples(index=False):
        rows.append([
            r.id, r.state_abb, r.county, r.operator, r.name, r.ref,
            float(r.sqft) if r.sqft else None, r.lat, r.lon, r.type,
        ])
    meta = {
        "source": "IM3 Open Source Data Center Atlas (PNNL / MSD-LIVE), file version 2026.11.02",
        "file": RAW.name,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "rows_in_file": n_raw,
        "multi_county_rows_merged": n_dupes,
        "rows": len(rows),
        "by_type": df["type"].value_counts().to_dict(),
        "license": "ODbL 1.0 (derived from OpenStreetMap contributors)",
    }
    OUT.write_text(json.dumps({"columns": COLS, "rows": rows, "meta": meta}, separators=(",", ":")))
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

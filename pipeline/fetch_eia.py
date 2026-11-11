"""Pull EIA data for the PJM balancing authority.

Outputs raw pulls into pipeline/cache/ (git-ignored) and a provenance record into
pipeline/cache/provenance_eia.json. Run:  python -m pipeline.fetch_eia

Routes used (all EIA Open Data API v2):
  electricity/operating-generator-capacity   generator inventory (EIA-860M based)
  electricity/rto/region-data                EIA-930 PJM demand (type D)
  electricity/rto/region-sub-ba-data         EIA-930 PJM subregion demand
  electricity/rto/fuel-type-data             EIA-930 PJM net generation by fuel
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import sys
from pathlib import Path

import pandas as pd

from . import eia

CACHE = Path(__file__).resolve().parent / "cache"
CACHE.mkdir(exist_ok=True)

ROUTE_GEN = "electricity/operating-generator-capacity"
ROUTE_DEMAND = "electricity/rto/region-data"
ROUTE_SUBBA = "electricity/rto/region-sub-ba-data"
ROUTE_FUEL = "electricity/rto/fuel-type-data"

HOURLY_START = dt.date(2019, 1, 1)  # EIA-930 history used for context
BASELINE_PERIOD = "2022-11"  # month of ChatGPT's public release (2022-11-30)


def quarters(start: dt.date, end: dt.date):
    y, q = start.year, (start.month - 1) // 3
    while True:
        qs = dt.date(y, q * 3 + 1, 1)
        if qs > end:
            return
        nm = qs.month + 3
        qe = (dt.date(qs.year + (nm > 12), (nm - 1) % 12 + 1, 1) - dt.timedelta(days=1))
        yield max(qs, start), min(qe, end)
        q += 1
        if q == 4:
            y, q = y + 1, 0


def pull_hourly(route: str, facets: dict, tag: str) -> pd.DataFrame:
    """Pull hourly rows for a route, one quarter at a time, caching finished quarters."""
    today = dt.date.today()
    frames = []
    for qs, qe in quarters(HOURLY_START, today):
        f = CACHE / f"{tag}_{qs:%Y%m%d}.csv.gz"
        stable = qe < today - dt.timedelta(days=60)
        if f.exists() and stable:
            frames.append(pd.read_csv(f, dtype=str, keep_default_na=False))
            continue
        params = {
            "frequency": "hourly",
            "data[]": ["value"],
            "start": f"{qs:%Y-%m-%d}T00",
            "end": f"{qe:%Y-%m-%d}T23",
            "sort[0][column]": "period",
            "sort[0][direction]": "asc",
        }
        for k, v in facets.items():
            params[f"facets[{k}][]"] = v
        rows = eia.fetch_all(route, params)
        df = pd.DataFrame(rows)
        print(f"  {tag} {qs}..{qe}: {len(df):,} rows", flush=True)
        if stable and len(df):
            df.astype(str).to_csv(f, index=False, compression="gzip")
        frames.append(df.astype(str))
    out = pd.concat([x for x in frames if len(x)], ignore_index=True) if frames else pd.DataFrame()
    return out


def pull_generators(prov: dict) -> None:
    meta = eia.metadata(ROUTE_GEN)
    data_cols = list(meta["data"].keys())
    facet_ids = [f["id"] for f in meta.get("facets", [])]
    prov["generators_meta"] = {
        "startPeriod": meta.get("startPeriod"),
        "endPeriod": meta.get("endPeriod"),
        "frequency": [f.get("id") for f in meta.get("frequency", [])],
        "data_columns": data_cols,
        "facets": facet_ids,
    }
    print("generator data columns:", data_cols)
    print("generator facets:", facet_ids)
    if "balancing_authority_code" not in facet_ids:
        raise eia.EIAError(f"balancing_authority_code facet missing; facets are {facet_ids}")
    prov["generators_status_facet"] = eia.facet_values(ROUTE_GEN, "status")

    latest = meta["endPeriod"]
    base = BASELINE_PERIOD if BASELINE_PERIOD >= meta["startPeriod"] else meta["startPeriod"]
    for label, period in (("latest", latest), ("baseline", base)):
        params = {
            "frequency": "monthly",
            "data[]": data_cols,
            "start": period,
            "end": period,
            "facets[balancing_authority_code][]": "PJM",
            "sort[0][column]": "plantid",
            "sort[0][direction]": "asc",
        }
        rows = eia.fetch_all(ROUTE_GEN, params)
        df = pd.DataFrame(rows)
        df.to_csv(CACHE / f"generators_{label}.csv.gz", index=False, compression="gzip")
        prov[f"generators_{label}"] = {"period": period, "rows": len(df)}
        print(f"generators {label} ({period}): {len(df):,} rows")


def main() -> int:
    prov: dict = {"retrieved_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "routes": {}}
    pull_generators(prov)

    # EIA-930 metadata (start/end periods + facets) for the record
    for name, route in (("demand", ROUTE_DEMAND), ("subba", ROUTE_SUBBA), ("fuel", ROUTE_FUEL)):
        m = eia.metadata(route)
        prov["routes"][name] = {
            "route": route,
            "startPeriod": m.get("startPeriod"),
            "endPeriod": m.get("endPeriod"),
            "facets": [f["id"] for f in m.get("facets", [])],
        }
        print(name, prov["routes"][name])

    demand = pull_hourly(ROUTE_DEMAND, {"respondent": "PJM", "type": "D"}, "demand")
    demand.to_csv(CACHE / "demand_hourly.csv.gz", index=False, compression="gzip")
    prov["routes"]["demand"]["rows"] = len(demand)

    fuel = pull_hourly(ROUTE_FUEL, {"respondent": "PJM"}, "fuel")
    fuel.to_csv(CACHE / "fuel_hourly.csv.gz", index=False, compression="gzip")
    prov["routes"]["fuel"]["rows"] = len(fuel)

    sub = pull_hourly(ROUTE_SUBBA, {"parent": "PJM"}, "subba")
    sub.to_csv(CACHE / "subba_hourly.csv.gz", index=False, compression="gzip")
    prov["routes"]["subba"]["rows"] = len(sub)

    (CACHE / "provenance_eia.json").write_text(json.dumps(prov, indent=2))
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())

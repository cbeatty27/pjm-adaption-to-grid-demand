"""Pull EIA data for the PJM balancing authority and for the United States.

Outputs raw pulls into pipeline/cache/ (git-ignored) and a provenance record into
pipeline/cache/provenance_eia.json. Run:  python -m pipeline.fetch_eia

Routes used (all EIA Open Data API v2):
  electricity/operating-generator-capacity   generator inventory (EIA-860M based)
  electricity/rto/region-data                EIA-930 PJM demand (type D)
  electricity/rto/region-sub-ba-data         EIA-930 PJM subregion demand
  electricity/rto/fuel-type-data             EIA-930 PJM net generation by fuel
  electricity/operating-generator-capacity   (again, no balancing-authority filter) every U.S. generator
  electricity/rto/region-data                EIA-930 U.S. Lower 48 demand (respondent US48)
  electricity/rto/fuel-type-data             EIA-930 U.S. Lower 48 net generation by fuel (respondent US48)
  electricity/retail-sales                   EIA retail electricity sales, U.S. total, by sector (optional)
  electricity/electric-power-operational-data  EIA-923 monthly net generation by fuel, U.S. total, all sectors (optional)

Also downloaded (not an API route): EIA's monthly generator file (Form EIA-860M, XLSX) from
https://www.eia.gov/electricity/data/eia860m/ , whose "Retired" tab lists generators that retired.
Run only that step with:  python -m pipeline.fetch_eia --retired-only
If the download is blocked, save the latest XLSX yourself and run
  EIA860M_XLSX=/path/to/file.xlsx python -m pipeline.fetch_eia --retired-only
"""
from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import json
import os
import re
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
ROUTE_RETAIL = "electricity/retail-sales"
ROUTE_OPS = "electricity/electric-power-operational-data"  # EIA-923 monthly net generation by fuel, by state and sector

DEMAND_START = dt.date(2015, 7, 1)  # EIA-930 demand data begin in July 2015: every month EIA has is pulled
FUEL_START = dt.date(2018, 7, 1)    # EIA-930 net generation by fuel begins in July 2018 (quarters before it return no rows)
HOURLY_START = dt.date(2019, 1, 1)  # PJM subregion (zone) series; only the baseline and latest windows use it
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


def pull_hourly(route: str, facets: dict, tag: str, start: dt.date = HOURLY_START) -> pd.DataFrame:
    """Pull hourly rows for a route, one quarter at a time, caching finished quarters."""
    today = dt.date.today()
    frames = []
    for qs, qe in quarters(start, today):
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


def pull_generators(prov: dict, scope: str = "pjm") -> None:
    """scope 'pjm' filters to balancing authority PJM; scope 'us' pulls every generator."""
    meta = eia.metadata(ROUTE_GEN)
    data_cols = list(meta["data"].keys())
    facet_ids = [f["id"] for f in meta.get("facets", [])]
    pre = "generators" if scope == "pjm" else "generators_us"
    if scope == "pjm":
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
            "sort[0][column]": "plantid",
            "sort[0][direction]": "asc",
            "sort[1][column]": "generatorid",
            "sort[1][direction]": "asc",
        }
        if scope == "pjm":
            params["facets[balancing_authority_code][]"] = "PJM"
        rows = eia.fetch_all(ROUTE_GEN, params)
        df = pd.DataFrame(rows)
        df.to_csv(CACHE / f"{pre}_{label}.csv.gz", index=False, compression="gzip")
        prov[f"{pre}_{label}"] = {"period": period, "rows": len(df)}
        print(f"{pre} {label} ({period}): {len(df):,} rows", flush=True)


def check_respondent(route: str, code: str) -> None:
    ids = [str(v.get("id")) for v in eia.facet_values(route, "respondent")]
    if code not in ids:
        raise eia.EIAError(f"respondent {code} not listed for {route}; ids containing 'US': {[i for i in ids if 'US' in i]}")


def pull_retail(prov: dict) -> None:
    """Optional cross-check series: U.S. retail electricity sales by sector. Never stops the run."""
    try:
        params = {
            "frequency": "monthly", "data[]": ["sales"], "start": "2019-01",
            "facets[stateid][]": "US",
            "sort[0][column]": "period", "sort[0][direction]": "asc",
        }
        rows = eia.fetch_all(ROUTE_RETAIL, params)
        df = pd.DataFrame(rows)
        df.to_csv(CACHE / "retail_us.csv.gz", index=False, compression="gzip")
        prov["retail_us"] = {"route": ROUTE_RETAIL, "rows": len(df), "columns": list(df.columns)}
        print(f"retail sales (US): {len(df):,} rows; columns {list(df.columns)}")
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: retail sales pull skipped: {e}", file=sys.stderr)
        prov["retail_us"] = {"error": str(e)[:300]}


OPS_START = "2015-01"
OPS_FUELS = ["ALL", "COL", "NG", "NUC", "HYC", "HPS", "SUN", "WND"]  # ids asked for; only ids the route lists are requested


def pull_ops923(prov: dict) -> None:
    """Optional: EIA-923 monthly net generation by fuel for the whole U.S. (all sectors), back to 2015, so generation
    can be followed further back than EIA-930 (which has fuel data only from July 2018). Never stops the run."""
    try:
        listed = eia.facet_values(ROUTE_OPS, "fueltypeid")
        have = {f.get("id"): f.get("name") for f in listed}
        use = [f for f in OPS_FUELS if f in have]
        if "ALL" not in use or len(use) < 4:
            raise eia.EIAError(f"fuel ids not as expected; route lists {sorted(have)[:40]}")
        params = {
            "frequency": "monthly", "data[]": ["generation"], "start": OPS_START,
            "facets[location][]": "US", "facets[sectorid][]": "99", "facets[fueltypeid][]": use,
            "sort[0][column]": "period", "sort[0][direction]": "asc",
        }
        rows = eia.fetch_all(ROUTE_OPS, params)
        df = pd.DataFrame(rows)
        df.to_csv(CACHE / "gen923_us.csv.gz", index=False, compression="gzip")
        prov["gen923_us"] = {"route": ROUTE_OPS, "rows": len(df), "columns": list(df.columns), "fuel_ids_requested": use,
                             "fuel_ids_listed_by_route": have}
        print(f"EIA-923 generation (US, all sectors): {len(df):,} rows; fuel ids {use}")
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: EIA-923 generation pull skipped: {e}", file=sys.stderr)
        prov["gen923_us"] = {"error": str(e)[:300]}


EIA860M_PAGE = "https://www.eia.gov/electricity/data/eia860m/"
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]


def norm_col(c) -> str:
    return re.sub(r"[^a-z0-9]", "", str(c).lower())


def find_860m_url() -> str:
    import requests

    r = requests.get(EIA860M_PAGE, timeout=60, headers={"User-Agent": "Mozilla/5.0 (pjm-adaption-to-grid-demand data pipeline)"})
    r.raise_for_status()
    best = None
    for href in re.findall(r'href="([^"]+_generator\d{4}\.xlsx?)"', r.text, flags=re.I):
        m = re.search(r"/([a-z]+)_generator(\d{4})\.xlsx?$", href, flags=re.I)
        if not m or m.group(1).lower() not in MONTHS or "/archive/" in href.lower():
            continue
        key = (int(m.group(2)), MONTHS.index(m.group(1).lower()))
        if best is None or key > best[0]:
            best = (key, href)
    if not best:
        raise RuntimeError("no *_generator<year>.xlsx link found on the EIA-860M page")
    href = best[1]
    return href if href.startswith("http") else "https://www.eia.gov" + (href if href.startswith("/") else "/electricity/data/eia860m/" + href)


def pull_retired(prov: dict) -> None:
    """Download the latest EIA-860M workbook and keep its 'Retired' tab. Never stops the run."""
    try:
        local = os.environ.get("EIA860M_XLSX", "").strip()
        if local:
            path, url = Path(local), f"local file {Path(local).name}"
        else:
            import requests

            url = find_860m_url()
            path = CACHE / "eia860m_latest.xlsx"
            with requests.get(url, timeout=300, stream=True, headers={"User-Agent": "Mozilla/5.0 (pjm-adaption-to-grid-demand data pipeline)"}) as r:
                r.raise_for_status()
                with open(path, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
        head = path.read_bytes()[:8]
        if not (head.startswith(b"PK") or head.startswith(b"\xd0\xcf\x11\xe0")):
            raise RuntimeError(f"{path.name} is not an Excel file (starts with {head[:40]!r}); EIA probably refused the scripted download")
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        sheets = pd.read_excel(path, sheet_name=None, header=None, dtype=str)
        name = next((k for k in sheets if k.strip().lower() == "retired"), None) or next((k for k in sheets if "retired" in k.lower() and "pr" not in k.lower().split("_")), None)
        if not name:
            raise RuntimeError(f"no Retired sheet; sheets are {list(sheets)}")
        raw = sheets[name]
        hdr = next((i for i in range(min(15, len(raw))) if "plantid" in [norm_col(x) for x in raw.iloc[i]]), None)
        if hdr is None:
            raise RuntimeError("could not find the header row (a cell named Plant ID) in the Retired sheet")
        df = raw.iloc[hdr + 1 :].copy()
        df.columns = [str(x).strip() for x in raw.iloc[hdr]]
        df = df.dropna(how="all")
        df = df[df.iloc[:, 0].notna()].fillna("")
        df.to_csv(CACHE / "retired_raw.csv.gz", index=False, compression="gzip")
        prov["retired"] = {"source": url, "sheet": name, "header_row": int(hdr), "rows": int(len(df)), "columns": list(df.columns), "sha256": sha,
                           "other_sheets": [k for k in sheets if k != name]}
        print(f"retired tab: {len(df):,} rows from {url}; columns {list(df.columns)}")
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: retirements download skipped: {e}", file=sys.stderr)
        print("  Save the latest XLSX from https://www.eia.gov/electricity/data/eia860m/ and run:\n"
              "  EIA860M_XLSX=/path/to/file.xlsx python3 -m pipeline.fetch_eia --retired-only", file=sys.stderr)
        prov["retired"] = {"error": str(e)[:300]}


def main() -> int:
    if "--gen923-only" in sys.argv:
        pf = CACHE / "provenance_eia.json"
        prov = json.loads(pf.read_text()) if pf.exists() else {"retrieved_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "routes": {}}
        pull_ops923(prov)
        pf.write_text(json.dumps(prov, indent=2))
        return 0 if "error" not in prov.get("gen923_us", {}) else 1
    if "--retired-only" in sys.argv:
        pf = CACHE / "provenance_eia.json"
        prov = json.loads(pf.read_text()) if pf.exists() else {"retrieved_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "routes": {}}
        pull_retired(prov)
        pf.write_text(json.dumps(prov, indent=2))
        return 0 if "error" not in prov.get("retired", {}) else 1
    prov: dict = {"retrieved_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "routes": {}}
    pull_generators(prov, "pjm")
    pull_generators(prov, "us")

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

    demand = pull_hourly(ROUTE_DEMAND, {"respondent": "PJM", "type": "D"}, "demand", DEMAND_START)
    demand.to_csv(CACHE / "demand_hourly.csv.gz", index=False, compression="gzip")
    prov["routes"]["demand"]["rows"] = len(demand)

    fuel = pull_hourly(ROUTE_FUEL, {"respondent": "PJM"}, "fuel", FUEL_START)
    fuel.to_csv(CACHE / "fuel_hourly.csv.gz", index=False, compression="gzip")
    prov["routes"]["fuel"]["rows"] = len(fuel)

    sub = pull_hourly(ROUTE_SUBBA, {"parent": "PJM"}, "subba")
    sub.to_csv(CACHE / "subba_hourly.csv.gz", index=False, compression="gzip")
    prov["routes"]["subba"]["rows"] = len(sub)

    # United States (Lower 48) series
    check_respondent(ROUTE_DEMAND, "US48")
    demand_us = pull_hourly(ROUTE_DEMAND, {"respondent": "US48", "type": "D"}, "demandus", DEMAND_START)
    demand_us.to_csv(CACHE / "demand_us_hourly.csv.gz", index=False, compression="gzip")
    prov["routes"]["demand_us"] = {"route": ROUTE_DEMAND, "respondent": "US48", "rows": len(demand_us)}

    check_respondent(ROUTE_FUEL, "US48")
    fuel_us = pull_hourly(ROUTE_FUEL, {"respondent": "US48"}, "fuelus", FUEL_START)
    fuel_us.to_csv(CACHE / "fuel_us_hourly.csv.gz", index=False, compression="gzip")
    prov["routes"]["fuel_us"] = {"route": ROUTE_FUEL, "respondent": "US48", "rows": len(fuel_us)}

    pull_retail(prov)
    pull_ops923(prov)
    pull_retired(prov)

    (CACHE / "provenance_eia.json").write_text(json.dumps(prov, indent=2))
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())

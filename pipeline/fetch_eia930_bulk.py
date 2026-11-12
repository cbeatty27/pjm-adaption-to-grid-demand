"""EIA-930 bulk files: the hours the API does not serve.

EIA's API serves hourly demand and net generation by fuel only from 2019-01-01. EIA's own downloadable
six-month "Balance" files go back to July 2015 (demand) and July 2018 (net generation by energy source).
This step reads those files and writes the missing pre-2019 hours into pipeline/cache/ in exactly the
shape the API pulls use, and build_site_data.py appends them in front of the API hours.

    python3 -m pipeline.fetch_eia930_bulk              # download from eia.gov, then convert
    EIA930_DIR=~/Downloads/eia930 python3 -m pipeline.fetch_eia930_bulk   # use files you saved yourself

Nothing is filled in or estimated. Three guards decide whether the files are used at all:
  1. Time alignment. The file for Jan-Jun 2019 overlaps the API, so the script compares PJM hours in
     both and uses the hour offset that matches. If fewer than 90% of hours match under any offset it stops.
  2. Reporting authority. PJM is one balancing authority (BA) and is taken as published. If the files have
     a U.S. Lower 48 row it is used. If not, the U.S. series is the sum of every BA's value for the hour,
     kept only for hours where at least 90% of the BAs that report in that file reported, and it is used only
     if, over the Jan-Jun 2019 overlap, its median ratio to EIA's own U.S. series is within 2% of 1.
  3. The usual outlier screens in build_site_data.py apply afterwards.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import os
import re
import sys
import zipfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("PJM_CACHE", ROOT / "pipeline/cache"))
BULK = CACHE / "bulk930"
BASE_URL = "https://www.eia.gov/electricity/gridmonitor/sixMonthFiles/EIA930_BALANCE_{y}_{h}"
HALVES = ("Jan_Jun", "Jul_Dec")
FIRST = (2015, "Jul_Dec")             # first file EIA published
API_START = "2019-01-01T00"           # the API serves hours from here
OVERLAP = (2019, "Jan_Jun")           # used only to check alignment and the U.S. sum
UA = {"User-Agent": "pjm-adaption-study (research; contact: repo owner)"}

# EIA's names in the bulk files -> the API's fuel codes (same codes build_site_data.py groups)
SOURCE_CODE = [("natural gas", "NG"), ("coal", "COL"), ("nuclear", "NUC"), ("hydro", "WAT"), ("solar", "SUN"),
               ("wind", "WND"), ("oil", "OIL"), ("other", "OTH"), ("unknown", "UNK"), ("battery", "BAT"),
               ("pumped", "PS")]
CODE_NAME = {"NG": "Natural gas", "COL": "Coal", "NUC": "Nuclear", "WAT": "Hydro", "SUN": "Solar", "WND": "Wind",
             "OIL": "Petroleum", "OTH": "Other", "UNK": "Unknown energy source", "BAT": "Battery storage", "PS": "Pumped storage"}


def files_needed() -> list[tuple[int, str]]:
    out, (y, h) = [], FIRST
    while (y, h) <= OVERLAP:
        out.append((y, h))
        y, h = (y, "Jul_Dec") if h == "Jan_Jun" else (y + 1, "Jan_Jun")
    return out


def _from_dir(y: int, h: str) -> Path | None:
    d = os.environ.get("EIA930_DIR", "").strip()
    if not d:
        return None
    for p in sorted(Path(d).expanduser().iterdir()):
        n = p.name.lower()
        if "balance" in n and str(y) in n and h.lower() in n and n.endswith((".csv", ".zip")):
            return p
    return None


def _download(y: int, h: str) -> Path | None:
    import requests
    BULK.mkdir(parents=True, exist_ok=True)
    for ext in (".csv", ".zip"):
        dest = BULK / f"EIA930_BALANCE_{y}_{h}{ext}"
        if dest.exists() and dest.stat().st_size > 1_000_000:
            return dest
        url = BASE_URL.format(y=y, h=h) + ext
        try:
            r = requests.get(url, headers=UA, timeout=300, stream=True)
            if r.status_code != 200:
                print(f"  {url}: HTTP {r.status_code}")
                continue
            with open(dest, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
            print(f"  downloaded {url} ({dest.stat().st_size / 1e6:.0f} MB)")
            return dest
        except Exception as e:  # noqa: BLE001
            print(f"  {url}: {e}")
    return None


def _read(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
            raw = z.read(name)
        return pd.read_csv(io.BytesIO(raw), dtype=str, keep_default_na=False, thousands=",")
    return pd.read_csv(path, dtype=str, keep_default_na=False, thousands=",")


def _pick(cols: list[str], must: tuple[str, ...], prefer: tuple[str, ...] = (), forbid: tuple[str, ...] = ()) -> str | None:
    low = {c: c.lower() for c in cols}
    ok = [c for c, l in low.items() if all(m in l for m in must) and not any(f in l for f in forbid)]
    for p in prefer:
        hit = [c for c in ok if p in low[c]]
        if hit:
            return hit[0]
    return ok[0] if ok else None


def parse(df: pd.DataFrame, label: str) -> dict:
    """One balance file -> long frames keyed by BA. Returns the columns used so they can be printed."""
    cols = list(df.columns)
    ba = _pick(cols, ("balancing authority",), forbid=("name",)) or _pick(cols, ("balancing", "authority"))
    utc = _pick(cols, ("utc", "time"))
    dem = (_pick(cols, ("demand (mw)",), prefer=("adjusted",), forbid=("forecast", "imputed"))
           or _pick(cols, ("demand (mw)",), forbid=("forecast",)))
    if not (ba and utc and dem):
        raise ValueError(f"{label}: could not find balancing authority / UTC time / demand columns in {cols}")
    t = pd.to_datetime(df[utc], format="%m/%d/%Y %I:%M:%S %p", utc=True, errors="coerce")
    if t.isna().mean() > 0.5:  # a different layout: let pandas read each stamp
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            t = pd.to_datetime(df[utc], utc=True, errors="coerce")
    base = pd.DataFrame({"ba": df[ba].str.strip(), "end_utc": t, "demand": pd.to_numeric(df[dem], errors="coerce")})
    srcs = {}
    for c in cols:
        m = re.match(r"^net generation \(mw\) from (.+?)(?: \((adjusted|imputed)\))?$", c.strip(), re.I)
        if m:
            srcs.setdefault(m.group(1).strip().lower(), {})[(m.group(2) or "raw").lower()] = c
    gen_cols = {}
    for s, variants in srcs.items():
        code = next((cd for k, cd in SOURCE_CODE if k in s), None)
        if code is None:
            continue
        use = variants.get("adjusted") or variants.get("raw") or next(iter(variants.values()))
        gen_cols.setdefault(code, []).append(use)
    for code, cs in gen_cols.items():
        base[code] = pd.concat([pd.to_numeric(df[c], errors="coerce") for c in cs], axis=1).sum(axis=1, min_count=1)
    return {"frame": base.dropna(subset=["end_utc"]), "used": {"ba": ba, "utc": utc, "demand": dem, "gen": {k: v for k, v in gen_cols.items()}}}


def _period(end: pd.Series, offset_h: int) -> pd.Series:
    return (end + pd.to_timedelta(offset_h, unit="h")).dt.strftime("%Y-%m-%dT%H")


def _api(name: str) -> pd.DataFrame | None:
    p = CACHE / name
    return pd.read_csv(p, dtype=str, keep_default_na=False) if p.exists() else None


def _pick_offset(pjm_overlap: pd.DataFrame, api_dem: pd.DataFrame) -> tuple[int, dict]:
    a = api_dem[api_dem["respondent"] == "PJM"].copy()
    a["v"] = pd.to_numeric(a["value"], errors="coerce")
    a = a.set_index("period")["v"]
    res = {}
    for off in (-1, 0, 1):
        s = pd.Series(pjm_overlap["demand"].values, index=_period(pjm_overlap["end_utc"], off).values)
        j = pd.concat([s.rename("b"), a.rename("a")], axis=1, join="inner").dropna()
        res[off] = float(((j["a"] - j["b"]).abs() <= 1).mean()) if len(j) else 0.0
    best = max(res, key=res.get)
    return best, res


def _tot(frame: pd.DataFrame, codes: list[str]) -> pd.Series:
    return frame[codes].sum(axis=1, min_count=1)


def _us_sum(frame: pd.DataFrame, value_cols: list[str]) -> pd.DataFrame:
    """Sum every BA for each hour; keep hours where >= 90% of the file's usual reporter count reported."""
    g = frame.groupby("end_utc")
    s = g[value_cols].sum(min_count=1)
    n = g["ba"].nunique()
    usual = n.quantile(0.9)
    return s[n >= 0.9 * usual]


def main() -> int:
    CACHE.mkdir(exist_ok=True)
    frames, used, notes = [], {}, {}
    for y, h in files_needed():
        path = _from_dir(y, h) or _download(y, h)
        if path is None:
            print(f"\nCould not get EIA930_BALANCE_{y}_{h}. Download the six-month Balance files from the Hourly Electric Grid Monitor\n"
                  "(eia.gov/electricity/gridmonitor, Download data tab), save them in one folder, and run:\n"
                  "  EIA930_DIR=/path/to/folder python3 -m pipeline.fetch_eia930_bulk", file=sys.stderr)
            return 1
        p = parse(_read(path), f"{y}_{h}")
        used[f"{y}_{h}"] = p["used"]
        print(f"{y} {h}: {len(p['frame']):,} rows; BA col '{p['used']['ba']}', demand col '{p['used']['demand']}', fuels {sorted(p['used']['gen'])}")
        frames.append((y, h, p["frame"]))

    over = next(f for y, h, f in frames if (y, h) == OVERLAP)
    api_dem = _api("demand_hourly.csv.gz")
    if api_dem is None:
        print("run fetch_eia first (the API pull is needed to check alignment)", file=sys.stderr)
        return 1
    off, res = _pick_offset(over[over["ba"] == "PJM"], api_dem)
    print(f"alignment check, PJM demand Jan-Jun 2019, share of hours equal to the API within 1 MW: {res}")
    if res[off] < 0.90:
        print(f"STOPPED: best offset {off:+d} h matches only {res[off]:.0%} of hours. The files and the API disagree, so no bulk hours are written.", file=sys.stderr)
        return 1
    print(f"using offset {off:+d} h: API period = file's 'UTC time at end of hour' {off:+d} h")

    data = pd.concat([f for y, h, f in frames], ignore_index=True)  # the overlap file adds the last hour(s) of 2018
    data = data[_period(data["end_utc"], off) < API_START]
    ov = over.copy()
    gen_codes = sorted({c for f in [data, ov] for c in f.columns if c in CODE_NAME})
    prov = {"files": [f"EIA930_BALANCE_{y}_{h}" for y, h, _ in frames], "offset_hours": off, "alignment": res, "columns_used": used}

    # PJM: one balancing authority, taken as published
    pj = data[data["ba"] == "PJM"]
    d_pjm = pd.DataFrame({"period": _period(pj["end_utc"], off), "respondent": "PJM", "type": "D", "value": pj["demand"]}).dropna(subset=["value"])
    f_rows = []
    for c in gen_codes:
        if c in pj.columns:
            x = pj[["end_utc", c]].dropna()
            f_rows.append(pd.DataFrame({"period": _period(x["end_utc"], off), "respondent": "PJM", "fueltype": c, "type-name": CODE_NAME[c], "value": x[c]}))
    f_pjm = pd.concat(f_rows, ignore_index=True) if f_rows else pd.DataFrame(columns=["period", "respondent", "fueltype", "type-name", "value"])

    # U.S. Lower 48
    us_row = data["ba"].str.upper().eq("US48").any()
    if us_row:
        d_us = data[data["ba"].str.upper() == "US48"]
        prov["us"] = "US48 rows in the file"
        sub, subo = d_us, ov[ov["ba"].str.upper() == "US48"]
        agg = lambda fr, cols: fr.set_index("end_utc")[cols]  # noqa: E731
    else:
        prov["us"] = "sum of balancing authorities, hours with >=90% of usual reporters"
        agg = _us_sum
        sub, subo = data, ov
    cols = ["demand"] + [c for c in gen_codes if c in sub.columns]
    us_new, us_ov = agg(sub, cols), agg(subo, cols)
    api_us = _api("demand_us_hourly.csv.gz")
    ok_us = False
    if api_us is not None and len(us_ov):
        a = pd.to_numeric(api_us.set_index("period")["value"], errors="coerce")
        s = pd.Series(us_ov["demand"].values, index=_period(pd.Series(us_ov.index), off).values)
        j = pd.concat([s.rename("b"), a.rename("a")], axis=1, join="inner").dropna()
        ratio = float((j["b"] / j["a"]).median()) if len(j) else float("nan")
        prov["us_overlap_ratio_median"] = ratio
        ok_us = bool(len(j) > 1000 and abs(ratio - 1) <= 0.02)
        print(f"U.S. overlap check: median(file U.S. / API U.S.) = {ratio:.4f} over {len(j):,} hours -> {'used' if ok_us else 'NOT used'}")
    d_us_out = f_us_out = None
    if ok_us:
        per = _period(pd.Series(us_new.index), off).values
        d_us_out = pd.DataFrame({"period": per, "respondent": "US48", "type": "D", "value": us_new["demand"].values}).dropna(subset=["value"])
        rows = []
        for c in gen_codes:
            if c in us_new.columns:
                v = us_new[c]
                rows.append(pd.DataFrame({"period": per, "respondent": "US48", "fueltype": c, "type-name": CODE_NAME[c], "value": v.values}).dropna(subset=["value"]))
        f_us_out = pd.concat(rows, ignore_index=True) if rows else None
    else:
        print("U.S. pre-2019 hours are not written; the U.S. series starts in 2019 from the API.")

    for name, df in (("bulk930_demand_hourly.csv.gz", d_pjm), ("bulk930_fuel_hourly.csv.gz", f_pjm),
                     ("bulk930_demand_us_hourly.csv.gz", d_us_out), ("bulk930_fuel_us_hourly.csv.gz", f_us_out)):
        p = CACHE / name
        if df is None or not len(df):
            p.unlink(missing_ok=True)
            continue
        df.astype(str).to_csv(p, index=False, compression="gzip")
        print(f"wrote {name}: {len(df):,} rows, {df['period'].min()} to {df['period'].max()}")
    prov["written_at_utc"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    (CACHE / "provenance_bulk930.json").write_text(json.dumps(prov, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

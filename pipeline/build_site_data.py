"""Aggregate cached EIA pulls into the JSON the website reads.

Reads  pipeline/cache/*.csv.gz  (from fetch_eia.py)
Writes public/data/{plants,demand,fuelmix,meta}.json

No plant is labelled by who it serves. Fields are EIA's own; groups are a lookup of
EIA's energy-source codes (see groups.py).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from . import groups as G

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("PJM_CACHE", ROOT / "pipeline/cache"))
OUT = Path(os.environ.get("PJM_OUT", ROOT / "public/data"))
SYNTHETIC = os.environ.get("PJM_SYNTHETIC") == "1"  # dev fixtures only; never deployed
TZ = "America/New_York"
WINDOW_START = "2022-11-30"           # ChatGPT public release
BASE_WINDOW = ("2021-11", "2022-10")  # 12 full months before the release month


def norm(c: str) -> str:
    return re.sub(r"[^a-z0-9]", "", c.lower())


def resolve(df: pd.DataFrame, **want) -> dict[str, str | None]:
    """Map logical names -> actual columns using normalised-name candidates."""
    by = {norm(c): c for c in df.columns}
    out = {}
    for logical, cands in want.items():
        out[logical] = next((by[c] for c in cands if c in by), None)
    return out


def read(name: str) -> pd.DataFrame:
    return pd.read_csv(CACHE / name, dtype=str, keep_default_na=False)


def classify_status(code: str, desc: str) -> str:
    d = (desc or "").lower()
    if "operating" in d or code == "OP":
        return "operating"
    if any(k in d for k in ("standby", "out of service", "backup")):
        return "operating"  # still an installed unit; popup shows EIA's own text
    if any(k in d for k in ("planned", "construction", "testing", "regulatory", "approved", "pending")):
        return "planned"
    if any(k in d for k in ("retire", "cancel", "postpone")):
        return "retired"
    return "other"


def to_ym(v: str) -> str | None:
    v = (v or "").strip()
    m = re.match(r"^(\d{4})-(\d{1,2})", v)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
    return None


def build_plants(meta: dict) -> set[str]:
    latest = read("generators_latest.csv.gz")
    base = read("generators_baseline.csv.gz")
    c = resolve(
        latest,
        plant=["plantid"], plantname=["plantname"], gen=["generatorid"], entity=["entityname"],
        state=["stateid"], county=["county"], sector=["sectorname", "sector"],
        status=["status"], statusdesc=["statusdescription", "statusdesc"],
        src=["energysourcecode"], srcdesc=["energysourcedesc", "energysourcedescription"],
        pm=["primemovercode"], tech=["technology"],
        mw=["nameplatecapacitymw"], msum=["netsummercapacitymw"], mwin=["netwintercapacitymw"],
        lat=["latitude"], lon=["longitude"],
        ym=["operatingyearmonth"], oy=["operatingyear"], om=["operatingmonth"],
        ret=["plannedretirementyearmonth"],
    )
    need = ["plant", "gen", "src", "mw", "lat", "lon"]
    missing = [k for k in need if not c[k]]
    if missing:
        raise SystemExit(f"Required generator columns not found: {missing}. Columns present: {list(latest.columns)}")
    if not c["ym"] and not (c["oy"] and c["om"]):
        raise SystemExit(f"No operating-month column. Columns present: {list(latest.columns)}")

    def g(row_col, df):  # safe column getter
        return df[row_col] if row_col else pd.Series([""] * len(df), index=df.index)

    def online(df):
        if c["ym"]:
            return g(c["ym"], df).map(to_ym)
        return (g(c["oy"], df).str.strip() + "-" + g(c["om"], df).str.strip().str.zfill(2)).map(to_ym)

    def grp(df):
        return g(c["src"], df).map(lambda s: G.GEN_SOURCE.get(s.strip(), "other"))

    def fnum(s):
        return pd.to_numeric(s, errors="coerce")

    u = pd.DataFrame({
        "plant": g(c["plant"], latest), "gen": g(c["gen"], latest),
        "name": g(c["plantname"], latest), "entity": g(c["entity"], latest),
        "state": g(c["state"], latest), "county": g(c["county"], latest),
        "sector": g(c["sector"], latest),
        "status": g(c["status"], latest), "statusdesc": g(c["statusdesc"], latest),
        "src": g(c["src"], latest), "group": grp(latest),
        "pm": g(c["pm"], latest), "mw": fnum(g(c["mw"], latest)),
        "msum": fnum(g(c["msum"], latest)), "mwin": fnum(g(c["mwin"], latest)),
        "lat": fnum(g(c["lat"], latest)), "lon": fnum(g(c["lon"], latest)),
        "online": online(latest),
    })
    u["state_cls"] = [classify_status(a, b) for a, b in zip(u["status"], u["statusdesc"])]
    no_loc = int(u[["lat", "lon"]].isna().any(axis=1).sum())
    u = u.dropna(subset=["lat", "lon"])

    # Inventory change between EIA snapshots (units listed in the baseline but not the latest)
    bkey = set(zip(base[c["plant"]], base[c["gen"]]))
    lkey = set(zip(latest[c["plant"]], latest[c["gen"]]))
    gone = base[[(p, q) not in lkey for p, q in zip(base[c["plant"]], base[c["gen"]])]]
    removed = [[r[c["plant"]], r[c["gen"]], r[c["plantname"]] if c["plantname"] else "", r[c["state"]] if c["state"] else "",
                G.GEN_SOURCE.get(r[c["src"]].strip(), "other"),
                float(r[c["mw"]] or 0)] for _, r in gone.iterrows()]

    cols = ["plant", "gen", "name", "entity", "state", "county", "sector", "status", "statusdesc", "state_cls",
            "src", "group", "pm", "mw", "msum", "mwin", "lat", "lon", "online"]
    rows = []
    for r in u[cols].itertuples(index=False):
        rows.append([None if (isinstance(x, float) and np.isnan(x)) else x for x in r])
    payload = {
        "columns": cols,
        "units": rows,
        "removed_since_baseline": {
            "columns": ["plant", "gen", "name", "state", "group", "mw"],
            "rows": removed,
            "baseline_period": meta["generators_baseline"]["period"],
        },
    }
    (OUT / "plants.json").write_text(json.dumps(payload, separators=(",", ":")))
    meta["plants"] = {
        "snapshot_period": meta["generators_latest"]["period"],
        "units": int(len(u)),
        "units_without_coordinates_excluded": no_loc,
        "status_counts": u.groupby(["status", "statusdesc", "state_cls"]).size().reset_index(name="n").to_dict("records"),
        "source_codes_unmapped_to_named_group": sorted(set(u.loc[u.group == "other", "src"])),
        "baseline_units": len(bkey),
        "latest_units": len(lkey),
        "removed_since_baseline": len(removed),
    }
    return set(u["state"].dropna().unique())


def hourly_et(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["ts"] = pd.to_datetime(df["period"], format="%Y-%m-%dT%H", utc=True).dt.tz_convert(TZ)
    df["val"] = pd.to_numeric(df["value"], errors="coerce")
    return df


def expected_hours(month: str) -> int:
    start = pd.Timestamp(month + "-01", tz=TZ)
    end = (start + pd.offsets.MonthBegin(1))
    return int((end.tz_convert("UTC") - start.tz_convert("UTC")).total_seconds() // 3600)


def month_key(ts: pd.Series) -> pd.Series:
    return ts.dt.strftime("%Y-%m")


# Reporting-error screen for hourly demand. EIA-930 contains impossible values (for example
# 2,147,480,000 MW, the largest 32-bit integer). An hour is dropped when it is more than
# OUT_HI times or less than OUT_LO times the median of the surrounding 7 days of the same
# series. Dropped hours are listed in meta.json; nothing is filled in or estimated.
OUT_HI, OUT_LO, OUT_WINDOW = 1.5, 0.5, "7D"
# A month is used in charts and 12-month windows only when at least this share of its hours is present.
MIN_COVERAGE = 0.95


def drop_outlier_hours(df: pd.DataFrame, label: str) -> tuple[pd.DataFrame, list[dict]]:
    """df has unique `ts` (tz-aware) and numeric `val`. Returns (kept rows, dropped-hour records)."""
    df = df.sort_values("ts").reset_index(drop=True)
    s = pd.Series(df["val"].to_numpy(), index=df["ts"].dt.tz_convert("UTC"))
    med = s.rolling(OUT_WINDOW, center=True, min_periods=24).median()
    bad = ((s > OUT_HI * med) | (s < OUT_LO * med)).to_numpy()
    dropped = [
        {"series": label, "hour_et": df["ts"].iloc[i].strftime("%Y-%m-%d %H:00"),
         "value_mw": round(float(df["val"].iloc[i]), 1), "week_median_mw": round(float(med.iloc[i]), 1)}
        for i in bad.nonzero()[0]
    ]
    return df.loc[~bad].copy(), dropped


def build_demand(meta: dict) -> None:
    d = hourly_et(read("demand_hourly.csv.gz"))
    n_all = len(d)
    d = d.dropna(subset=["val"])
    nonpos = int((d["val"] <= 0).sum())
    d = d[d["val"] > 0].drop_duplicates(subset="ts")
    d, dropped = drop_outlier_hours(d, "PJM")
    d["m"] = month_key(d["ts"])
    agg = d.groupby("m")["val"].agg(avg="mean", peak="max", low="min", n="count", total="sum").reset_index()
    agg["exp"] = agg["m"].map(expected_hours)
    agg["cov"] = (agg["n"] / agg["exp"]).round(4)
    months = agg["m"].tolist()
    monthly = {
        "months": months,
        "avg_mw": agg["avg"].round(1).tolist(),
        "peak_mw": agg["peak"].round(1).tolist(),
        "min_mw": agg["low"].round(1).tolist(),
        "twh": (agg["total"] / 1e6).round(4).tolist(),
        "coverage": agg["cov"].tolist(),
    }

    # subregions (zones)
    s = read("subba_hourly.csv.gz")
    zones = {}
    if len(s):
        s = hourly_et(s).dropna(subset=["val"])
        s = s[s["val"] > 0].drop_duplicates(subset=["ts", "subba"])
        kept = []
        for z, gz in s.groupby("subba"):
            gz, dz = drop_outlier_hours(gz, str(z))
            kept.append(gz)
            dropped += dz
        s = pd.concat(kept, ignore_index=True)
        s["m"] = month_key(s["ts"])
        za = s.groupby(["subba", "m"])["val"].agg(avg="mean", peak="max", n="count").reset_index()
        names = s.drop_duplicates("subba").set_index("subba")["subba-name"].to_dict() if "subba-name" in s else {}
        for z, gz in za.groupby("subba"):
            gz = gz.set_index("m").reindex(months)
            zones[z] = {
                "name": names.get(z, z),
                "avg_mw": [None if pd.isna(v) else round(float(v), 1) for v in gz["avg"]],
                "peak_mw": [None if pd.isna(v) else round(float(v), 1) for v in gz["peak"]],
                "hours": [0 if pd.isna(v) else int(v) for v in gz["n"]],
            }

    def window_stats(frame: pd.DataFrame, lo: str, hi: str):
        w = frame[(frame["m"] >= lo) & (frame["m"] <= hi)]
        return {"avg_mw": round(float(w["val"].mean()), 1), "peak_mw": round(float(w["val"].max()), 1),
                "min_mw": round(float(w["val"].min()), 1), "hours": int(len(w))}

    full = agg[agg["cov"] >= MIN_COVERAGE]["m"].tolist()
    latest_hi = full[-1]
    latest_lo = (pd.Period(latest_hi) - 11).strftime("%Y-%m")
    comparison = {
        "baseline": {"from": BASE_WINDOW[0], "to": BASE_WINDOW[1], **window_stats(d, *BASE_WINDOW)},
        "latest": {"from": latest_lo, "to": latest_hi, **window_stats(d, latest_lo, latest_hi)},
        "zones": {},
    }
    if len(s):
        for z, gz in s.groupby("subba"):
            b = window_stats(gz, *BASE_WINDOW) if (gz["m"].between(*BASE_WINDOW)).any() else None
            l = window_stats(gz, latest_lo, latest_hi) if (gz["m"].between(latest_lo, latest_hi)).any() else None
            if b and l:
                comparison["zones"][z] = {"baseline": b, "latest": l}

    out = {"monthly": monthly, "zones": zones, "comparison": comparison, "tz": TZ}
    (OUT / "demand.json").write_text(json.dumps(out, separators=(",", ":")))
    meta["demand"] = {
        "hourly_rows": n_all, "non_positive_rows_dropped": nonpos, "months": len(months),
        "min_coverage": MIN_COVERAGE,
        "outlier_rule": {"high_x_median": OUT_HI, "low_x_median": OUT_LO, "window": "centered 7 days, same series"},
        "outlier_hours_dropped": len(dropped),
        "outlier_hours_dropped_pjm": sum(1 for r in dropped if r["series"] == "PJM"),
        "outlier_hours": dropped[:400],
        "first_month": months[0], "last_month": months[-1], "zones": sorted(zones),
        "partial_months": [m for m, c in zip(months, monthly["coverage"]) if c < MIN_COVERAGE],
    }


def build_fuel(meta: dict) -> None:
    f = hourly_et(read("fuel_hourly.csv.gz")).dropna(subset=["val"])
    f = f.drop_duplicates(subset=["ts", "fueltype"])
    f["group"] = f["fueltype"].map(lambda c: G.FUEL930.get(c, "other"))
    unmapped = sorted(set(f.loc[~f["fueltype"].isin(G.FUEL930), "fueltype"]))
    f["m"] = month_key(f["ts"])
    mg = f.groupby(["m", "group"])["val"].sum().unstack(fill_value=0.0)
    mg = mg.reindex(columns=[k for k, _ in G.GROUPS], fill_value=0.0)
    hours = f.groupby("m")["ts"].nunique()
    months = mg.index.tolist()
    cov = [round(float(hours.get(m, 0)) / expected_hours(m), 4) for m in months]
    out = {
        "months": months,
        "groups": [k for k, _ in G.GROUPS],
        "gwh": {k: (mg[k] / 1000).round(1).tolist() for k in mg.columns},
        "coverage": cov,
        "codes_seen": sorted(set(f["fueltype"])),
        "codes_unmapped": unmapped,
    }
    full = [m for m, c in zip(months, cov) if c >= MIN_COVERAGE]
    hi = full[-1]
    lo = (pd.Period(hi) - 11).strftime("%Y-%m")

    def win(a, b):
        w = mg.loc[(mg.index >= a) & (mg.index <= b)].sum()
        return {k: round(float(w[k]) / 1000, 1) for k in mg.columns}

    out["comparison"] = {
        "baseline": {"from": BASE_WINDOW[0], "to": BASE_WINDOW[1], "gwh": win(*BASE_WINDOW)},
        "latest": {"from": lo, "to": hi, "gwh": win(lo, hi)},
    }
    (OUT / "fuelmix.json").write_text(json.dumps(out, separators=(",", ":")))
    meta["fuel"] = {"min_coverage": MIN_COVERAGE, "hourly_rows": int(len(f)), "codes_unmapped": unmapped, "first_month": months[0], "last_month": months[-1]}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    meta = json.loads((CACHE / "provenance_eia.json").read_text())
    meta["generators_latest"] = meta.pop("generators_latest")
    states = build_plants(meta)
    build_demand(meta)
    build_fuel(meta)
    dc = json.loads((OUT / "datacenters.json").read_text())["meta"]
    meta.update({
        "built_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "window_start": WINDOW_START,
        "baseline_window": list(BASE_WINDOW),
        "groups": [{"key": k, "label": v} for k, v in G.GROUPS],
        "pjm_states_with_eia_plants": sorted(states),
        "im3": dc,
        "synthetic": SYNTHETIC,
    })
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2))
    print("wrote", [p.name for p in OUT.iterdir()])
    return 0


if __name__ == "__main__":
    sys.exit(main())

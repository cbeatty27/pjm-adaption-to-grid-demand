"""Aggregate cached EIA pulls into the JSON the website reads.

Reads  pipeline/cache/*.csv.gz  (from fetch_eia.py)
Writes public/data/{plants,demand,fuelmix,meta}.json for PJM and, when the U.S. pulls are cached,
       public/data/{plants_us,demand_us,fuelmix_us,retail_us}.json

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


def build_plants(meta: dict, scope: str = "pjm") -> set[str]:
    us = scope == "us"
    pre = "generators_us" if us else "generators"
    latest = read(f"{pre}_latest.csv.gz")
    base = read(f"{pre}_baseline.csv.gz")
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

    # The U.S. file is slimmed: no net-capacity columns, rounded coordinates, and EIA's status wording
    # is kept once in meta.status_names instead of on every row.
    cols = ["plant", "gen", "name", "entity", "state", "county", "sector", "status", "statusdesc", "state_cls",
            "src", "group", "pm", "mw", "msum", "mwin", "lat", "lon", "online"]
    if us:
        cols = [k for k in cols if k not in ("mwin", "statusdesc")]
        u = u.assign(lat=u["lat"].round(4), lon=u["lon"].round(4), mw=u["mw"].round(1))
        meta["status_names"] = {k: v for k, v in zip(latest[c["status"]], latest[c["statusdesc"]] if c["statusdesc"] else latest[c["status"]])}
    rows = []
    for r in u[cols].itertuples(index=False):
        rows.append([None if (isinstance(x, float) and np.isnan(x)) else x for x in r])
    bp = meta[f"{pre}_baseline"]["period"]
    if us:
        summ: dict[str, dict] = {}
        for r in removed:
            e = summ.setdefault(r[4], {"n": 0, "mw": 0.0})
            e["n"] += 1; e["mw"] = round(e["mw"] + r[5], 1)
        rem = {"baseline_period": bp, "total": len(removed), "by_group": summ}
    else:
        rem = {"columns": ["plant", "gen", "name", "state", "group", "mw"], "rows": removed, "baseline_period": bp}
    payload = {"columns": cols, "units": rows, "removed_since_baseline": rem}
    (OUT / ("plants_us.json" if us else "plants.json")).write_text(json.dumps(payload, separators=(",", ":")))
    meta["plants_us" if us else "plants"] = {
        "snapshot_period": meta[f"{pre}_latest"]["period"],
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
# hi times or less than lo times the median of the surrounding 7 days of the same series.
# PJM-wide and U.S. series are smooth, so they use a tight band; single zones swing more
# (a small zone's hot-afternoon peak can reach 2.5 times its weekly median), so zones use a wide band.
# Dropped hours are listed in meta.json; nothing is filled in or estimated.
OUT_HI, OUT_LO, OUT_WINDOW = 1.5, 0.5, "7D"
ZONE_HI, ZONE_LO = 3.0, 0.25
# A month is used in charts and 12-month windows only when at least this share of its hours is present.
MIN_COVERAGE = 0.95


def drop_outlier_hours(df: pd.DataFrame, label: str, hi: float = OUT_HI, lo: float = OUT_LO) -> tuple[pd.DataFrame, list[dict]]:
    """df has unique `ts` (tz-aware) and numeric `val`. Returns (kept rows, dropped-hour records)."""
    df = df.sort_values("ts").reset_index(drop=True)
    s = pd.Series(df["val"].to_numpy(), index=df["ts"].dt.tz_convert("UTC"))
    med = s.rolling(OUT_WINDOW, center=True, min_periods=24).median()
    bad = ((s > hi * med) | (s < lo * med)).to_numpy()
    dropped = [
        {"series": label, "hour_et": df["ts"].iloc[i].strftime("%Y-%m-%d %H:00"),
         "value_mw": round(float(df["val"].iloc[i]), 1), "week_median_mw": round(float(med.iloc[i]), 1)}
        for i in bad.nonzero()[0]
    ]
    return df.loc[~bad].copy(), dropped


def shift_month(ym: str, n: int) -> str:
    return (pd.Period(ym) + n).strftime("%Y-%m")


def build_demand(meta: dict, scope: str = "pjm") -> None:
    us = scope == "us"
    label = "US48" if us else "PJM"
    d = hourly_et(read("demand_us_hourly.csv.gz" if us else "demand_hourly.csv.gz"))
    n_all = len(d)
    d = d.dropna(subset=["val"])
    nonpos = int((d["val"] <= 0).sum())
    d = d[d["val"] > 0].drop_duplicates(subset="ts")
    d, dropped = drop_outlier_hours(d, label)
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

    # subregions (zones) exist for PJM only
    zones = {}
    s = pd.DataFrame()
    if not us:
        s = read("subba_hourly.csv.gz")
    if len(s):
        s = hourly_et(s).dropna(subset=["val"])
        s = s[s["val"] > 0].drop_duplicates(subset=["ts", "subba"])
        kept = []
        for z, gz in s.groupby("subba"):
            gz, dz = drop_outlier_hours(gz, str(z), ZONE_HI, ZONE_LO)
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
                "min_mw": round(float(w["val"].min()), 1), "hours": int(len(w)),
                "twh": round(float(w["val"].sum()) / 1e6, 2)}

    full = agg[agg["cov"] >= MIN_COVERAGE]["m"].tolist()
    latest_hi = full[-1]
    latest_lo = shift_month(latest_hi, -11)
    comparison = {
        "baseline": {"from": BASE_WINDOW[0], "to": BASE_WINDOW[1], **window_stats(d, *BASE_WINDOW)},
        "latest": {"from": latest_lo, "to": latest_hi, **window_stats(d, latest_lo, latest_hi)},
        "zones": {},
    }
    # the same 12-month window one to five years earlier, when the data reach that far back
    five = {}
    for k in range(1, 6):
        lo_k, hi_k = shift_month(latest_lo, -12 * k), shift_month(latest_hi, -12 * k)
        if lo_k >= months[0] and agg[(agg["m"] >= lo_k) & (agg["m"] <= hi_k)]["cov"].ge(MIN_COVERAGE).all() and \
                len(agg[(agg["m"] >= lo_k) & (agg["m"] <= hi_k)]) == 12:
            five[str(k)] = {"from": lo_k, "to": hi_k, **window_stats(d, lo_k, hi_k)}
    comparison["years_earlier"] = five
    if len(s):
        for z, gz in s.groupby("subba"):
            b = window_stats(gz, *BASE_WINDOW) if (gz["m"].between(*BASE_WINDOW)).any() else None
            l = window_stats(gz, latest_lo, latest_hi) if (gz["m"].between(latest_lo, latest_hi)).any() else None
            if b and l:
                comparison["zones"][z] = {"baseline": b, "latest": l}

    out = {"monthly": monthly, "zones": zones, "comparison": comparison, "tz": TZ}
    (OUT / ("demand_us.json" if us else "demand.json")).write_text(json.dumps(out, separators=(",", ":")))
    meta["demand_us" if us else "demand"] = {
        "hourly_rows": n_all, "non_positive_rows_dropped": nonpos, "months": len(months),
        "min_coverage": MIN_COVERAGE,
        "outlier_rule": {
            "series": {"high_x_median": OUT_HI, "low_x_median": OUT_LO},
            "zones": {"high_x_median": ZONE_HI, "low_x_median": ZONE_LO},
            "window": "centered 7 days, same series",
        },
        "outlier_hours_dropped": len(dropped),
        "outlier_hours_dropped_pjm": sum(1 for r in dropped if r["series"] == label),
        "outlier_hours": dropped[:400],
        "first_month": months[0], "last_month": months[-1], "zones": sorted(zones),
        "partial_months": [m for m, c in zip(months, monthly["coverage"]) if c < MIN_COVERAGE],
    }


def build_fuel(meta: dict, scope: str = "pjm") -> None:
    us = scope == "us"
    f = hourly_et(read("fuel_us_hourly.csv.gz" if us else "fuel_hourly.csv.gz")).dropna(subset=["val"])
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
    lo = shift_month(hi, -11)

    def win(a, b):
        w = mg.loc[(mg.index >= a) & (mg.index <= b)].sum()
        return {k: round(float(w[k]) / 1000, 1) for k in mg.columns}

    out["comparison"] = {
        "baseline": {"from": BASE_WINDOW[0], "to": BASE_WINDOW[1], "gwh": win(*BASE_WINDOW)},
        "latest": {"from": lo, "to": hi, "gwh": win(lo, hi)},
    }
    (OUT / ("fuelmix_us.json" if us else "fuelmix.json")).write_text(json.dumps(out, separators=(",", ":")))
    meta["fuel_us" if us else "fuel"] = {"min_coverage": MIN_COVERAGE, "hourly_rows": int(len(f)), "codes_unmapped": unmapped, "first_month": months[0], "last_month": months[-1]}


def build_retail(meta: dict) -> None:
    """EIA retail electricity sales, U.S. total, by sector (monthly, million kWh = GWh). Optional."""
    if not (CACHE / "retail_us.csv.gz").exists():
        return
    df = read("retail_us.csv.gz")
    if not len(df):
        return
    c = resolve(df, period=["period"], sid=["sectorid"], sname=["sectorname"], sales=["sales"])
    if not (c["period"] and c["sid"] and c["sales"]):
        print(f"retail sales skipped: columns not recognised ({list(df.columns)})")
        return
    df["v"] = pd.to_numeric(df[c["sales"]], errors="coerce")
    pv = df.pivot_table(index=c["period"], columns=c["sid"], values="v", aggfunc="sum").sort_index()
    names = df.drop_duplicates(c["sid"]).set_index(c["sid"])[c["sname"]].to_dict() if c["sname"] else {}
    out = {
        "months": pv.index.tolist(),
        "sectors": {k: {"name": names.get(k, k), "gwh": [None if pd.isna(v) else round(float(v), 1) for v in pv[k]]} for k in pv.columns},
        "unit": "million kilowatthours (GWh)",
    }
    (OUT / "retail_us.json").write_text(json.dumps(out, separators=(",", ":")))
    meta["retail_us"] = {"route": "electricity/retail-sales", "first_month": out["months"][0], "last_month": out["months"][-1], "sectors": sorted(pv.columns)}


def pid(v) -> str:
    v = str(v).strip()
    return v[:-2] if re.fullmatch(r"\d+\.0", v) else v


def build_retired(meta: dict) -> None:
    """Generators on the 'Retired' tab of EIA's monthly generator file that retired after the ChatGPT release month.

    Capacity is net summer capacity as EIA lists it. A unit is flagged PJM when its plant ID appears in the PJM
    balancing-authority snapshots pulled from the API (a plant-ID match, nothing inferred)."""
    f = CACHE / "retired_raw.csv.gz"
    if not f.exists() or "error" in meta.get("retired", {}) or "retired" not in meta:
        print("retirements not in the cache; skipping retired.json (run: python3 -m pipeline.fetch_eia --retired-only)")
        return
    df = read("retired_raw.csv.gz")
    c = resolve(
        df, plant=["plantid"], gen=["generatorid"], name=["plantname"], state=["plantstate", "stateid", "state"],
        src=["energysourcecode", "energysource1"], msum=["netsummercapacitymw"], mw=["nameplatecapacitymw"],
        om=["operatingmonth"], oy=["operatingyear"], rm=["retirementmonth"], ry=["retirementyear"],
        lat=["latitude"], lon=["longitude"],
    )
    need = ["plant", "gen", "src", "rm", "ry"]
    if not all(c[k] for k in need) or not (c["msum"] or c["mw"]):
        print(f"retired tab columns not recognised ({list(df.columns)}); skipping retired.json")
        meta["retired"]["skipped"] = f"columns not recognised: {list(df.columns)}"
        return
    basis_col = c["msum"] or c["mw"]
    basis = "net summer capacity" if c["msum"] else "nameplate capacity"
    num = lambda col: pd.to_numeric(df[col], errors="coerce") if col else pd.Series(np.nan, index=df.index)  # noqa: E731
    ret = (df[c["ry"]].astype(str).str.replace(r"\.0$", "", regex=True).str.strip() + "-"
           + df[c["rm"]].astype(str).str.replace(r"\.0$", "", regex=True).str.strip().str.zfill(2))
    ret = ret.where(ret.str.fullmatch(r"\d{4}-\d{2}"))
    onl = pd.Series(None, index=df.index, dtype=object)
    if c["oy"] and c["om"]:
        o = (df[c["oy"]].astype(str).str.replace(r"\.0$", "", regex=True).str.strip() + "-"
             + df[c["om"]].astype(str).str.replace(r"\.0$", "", regex=True).str.strip().str.zfill(2))
        onl = o.where(o.str.fullmatch(r"\d{4}-\d{2}"))
    latest_period = meta["plants_us"]["snapshot_period"] if "plants_us" in meta else meta["plants"]["snapshot_period"]
    t = pd.DataFrame({
        "plant": df[c["plant"]].map(pid), "gen": df[c["gen"]].astype(str).str.strip(),
        "name": df[c["name"]] if c["name"] else "", "state": df[c["state"]] if c["state"] else "",
        "src": df[c["src"]].astype(str).str.strip(), "mw": num(basis_col), "ret": ret, "online": onl,
        "lat": num(c["lat"]), "lon": num(c["lon"]),
    })
    t["group"] = t["src"].map(lambda s: G.GEN_SOURCE.get(s, "other"))
    in_tab = int(len(t))
    after_release = t[t["ret"].notna() & (t["ret"] > WINDOW_START[:7])]
    kept = after_release[after_release["ret"] <= latest_period].copy()
    beyond = int(len(after_release) - len(kept))

    # plant IDs that report PJM as their balancing authority in the API snapshots
    pjm_ids: set[str] = set()
    for nm in ("generators_baseline.csv.gz", "generators_latest.csv.gz"):
        if (CACHE / nm).exists():
            d = read(nm)
            col = resolve(d, plant=["plantid"])["plant"]
            if col:
                pjm_ids |= {pid(x) for x in d[col]}
    kept["pjm"] = kept["plant"].isin(pjm_ids)

    # coordinates: the tab's own when present, else the plant's coordinates in the baseline snapshot
    base_us = CACHE / "generators_us_baseline.csv.gz"
    bsrc = read("generators_us_baseline.csv.gz") if base_us.exists() else read("generators_baseline.csv.gz")
    bc = resolve(bsrc, plant=["plantid"], lat=["latitude"], lon=["longitude"])
    coords = {}
    if bc["plant"] and bc["lat"] and bc["lon"]:
        b2 = bsrc[[bc["plant"], bc["lat"], bc["lon"]]].copy()
        b2[bc["lat"]] = pd.to_numeric(b2[bc["lat"]], errors="coerce"); b2[bc["lon"]] = pd.to_numeric(b2[bc["lon"]], errors="coerce")
        b2 = b2.dropna().drop_duplicates(bc["plant"])
        coords = {pid(p): (la, lo) for p, la, lo in zip(b2[bc["plant"]], b2[bc["lat"]], b2[bc["lon"]])}
    from_tab = int(kept[["lat", "lon"]].notna().all(axis=1).sum())
    for i, r in kept.iterrows():
        if pd.isna(r["lat"]) or pd.isna(r["lon"]):
            la_lo = coords.get(r["plant"])
            if la_lo:
                kept.at[i, "lat"], kept.at[i, "lon"] = la_lo
    no_xy = int(kept[["lat", "lon"]].isna().any(axis=1).sum())

    # cross-check against units that left the API's operating inventory between the two snapshots
    xc = {}
    for scope, pre in (("pjm", "generators"), ("us", "generators_us")):
        if not (CACHE / f"{pre}_latest.csv.gz").exists():
            continue
        lat_, bas_ = read(f"{pre}_latest.csv.gz"), read(f"{pre}_baseline.csv.gz")
        k = resolve(bas_, plant=["plantid"], gen=["generatorid"], mw=["nameplatecapacitymw"])
        lk = {(pid(a), str(b).strip()) for a, b in zip(lat_[k["plant"]], lat_[k["gen"]])}
        gone = [(pid(a), str(b).strip(), float(m or 0)) for a, b, m in zip(bas_[k["plant"]], bas_[k["gen"]], bas_[k["mw"]]) if (pid(a), str(b).strip()) not in lk]
        rk = set(zip(kept["plant"], kept["gen"]))
        hit = [g for g in gone if (g[0], g[1]) in rk]
        xc[scope] = {"left_inventory_units": len(gone), "of_which_on_retired_tab": len(hit),
                     "left_inventory_not_on_retired_tab_units": len(gone) - len(hit),
                     "left_inventory_not_on_retired_tab_nameplate_mw": round(sum(g[2] for g in gone if (g[0], g[1]) not in rk), 1)}

    cols = ["plant", "gen", "name", "state", "src", "group", "mw", "ret", "online", "lat", "lon", "pjm"]
    rows = []
    for r in kept[cols].itertuples(index=False):
        rows.append([None if (isinstance(x, float) and np.isnan(x)) else (bool(x) if isinstance(x, (np.bool_, bool)) else (round(float(x), 4) if isinstance(x, (float, np.floating)) else x)) for x in r])
    (OUT / "retired.json").write_text(json.dumps({"columns": cols, "rows": rows}, separators=(",", ":")))
    meta["retired"].update({
        "capacity_basis": basis, "capacity_column": basis_col, "rows_on_tab": in_tab,
        "rows_after_release_month": int(len(after_release)), "rows_kept": int(len(kept)),
        "rows_after_snapshot_period_excluded": beyond, "pjm_rows": int(kept["pjm"].sum()),
        "coordinates_from_tab": from_tab, "rows_without_coordinates": no_xy,
        "retirement_months": [str(kept["ret"].min()), str(kept["ret"].max())] if len(kept) else [],
        "pjm_rule": "plant ID appears in the PJM balancing-authority snapshots from the generator-inventory API route",
        "crosscheck": xc,
    })


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    meta = json.loads((CACHE / "provenance_eia.json").read_text())
    states = build_plants(meta, "pjm")
    build_demand(meta, "pjm")
    build_fuel(meta, "pjm")
    has_us = (CACHE / "generators_us_latest.csv.gz").exists() and (CACHE / "demand_us_hourly.csv.gz").exists()
    if has_us:
        build_plants(meta, "us")
        build_demand(meta, "us")
        build_fuel(meta, "us")
        build_retail(meta)
    else:
        print("U.S. pulls not in the cache; building PJM files only. Run fetch_eia again to add the U.S. tabs.")
    build_retired(meta)
    dc = json.loads((OUT / "datacenters.json").read_text())["meta"]
    meta.update({
        "built_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "window_start": WINDOW_START,
        "baseline_window": list(BASE_WINDOW),
        "groups": [{"key": k, "label": v} for k, v in G.GROUPS],
        "pjm_states_with_eia_plants": sorted(states),
        "has_us": has_us,
        "im3": dc,
        "synthetic": SYNTHETIC,
    })
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2))
    print("wrote", sorted(p.name for p in OUT.iterdir()))
    return 0


if __name__ == "__main__":
    sys.exit(main())

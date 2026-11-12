"""Sanity gates run after the build. A failure stops the workflow so bad data is never deployed.
Bounds are deliberately wide; they catch broken pulls, not real-world surprises."""
from __future__ import annotations
import json, sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public/data"


def main() -> int:
    errs = []
    meta = json.loads((OUT / "meta.json").read_text())
    plants = json.loads((OUT / "plants.json").read_text())
    dem = json.loads((OUT / "demand.json").read_text())
    fuel = json.loads((OUT / "fuelmix.json").read_text())
    if meta.get("synthetic"):
        errs.append("meta.json is stamped synthetic; refusing to deploy")
    if len(plants["units"]) < 300:
        errs.append(f"only {len(plants['units'])} PJM generator units")
    cols = plants["columns"]
    online = [r[cols.index("online")] for r in plants["units"] if r[cols.index("state_cls")] == "operating"]
    if sum(1 for o in online if o and o >= "2022-12") < 20:
        errs.append("fewer than 20 operating units dated Dec 2022 or later")
    m = dem["monthly"]
    if len(m["months"]) < 60:
        errs.append(f"only {len(m['months'])} demand months")
    good = [a for mo, a, c in zip(m["months"], m["avg_mw"], m["coverage"]) if c >= 0.97 and mo >= "2019-01"]
    if not good or not all(50_000 < a < 200_000 for a in good):
        errs.append("monthly average demand outside 50-200 GW")
    early = [mo for mo, a, c in zip(m["months"], m["avg_mw"], m["coverage"]) if c >= 0.95 and mo < "2019-01" and not 50_000 < a < 200_000]
    if early:
        print(f"note: PJM monthly average demand outside 50-200 GW in {len(early)} months before 2019 ({early[0]} to {early[-1]}); check them on the chart")
    for k in ("baseline", "latest"):
        if not 50_000 < dem["comparison"][k]["avg_mw"] < 200_000:
            errs.append(f"{k} average demand outside 50-200 GW")
    if max(p for p in m["peak_mw"] if p is not None) > 250_000:
        errs.append("a monthly peak above 250 GW survived cleaning")
    if not dem["zones"]:
        errs.append("no PJM subregion (zone) data")
    gs = fuel["comparison"]["latest"]["gwh"]
    total = sum(gs.values())
    if not 400_000 < total < 1_200_000:
        errs.append(f"latest 12-month PJM generation {total/1000:.0f} TWh outside 400-1200 TWh")
    if gs.get("gas", 0) <= 0:
        errs.append("no natural gas generation found")
    if meta.get("has_us"):
        us_plants = json.loads((OUT / "plants_us.json").read_text())
        us_dem = json.loads((OUT / "demand_us.json").read_text())
        us_fuel = json.loads((OUT / "fuelmix_us.json").read_text())
        if len(us_plants["units"]) < 5000:
            errs.append(f"only {len(us_plants['units'])} U.S. generator units")
        ucols = us_plants["columns"]
        uon = [r[ucols.index("online")] for r in us_plants["units"] if r[ucols.index("state_cls")] == "operating"]
        if sum(1 for o in uon if o and o >= "2022-12") < 500:
            errs.append("fewer than 500 U.S. operating units dated Dec 2022 or later")
        um = us_dem["monthly"]
        ugood = [a for mo, a, c in zip(um["months"], um["avg_mw"], um["coverage"]) if c >= 0.95 and mo >= "2019-01"]
        if not ugood or not all(250_000 < a < 800_000 for a in ugood):
            errs.append("U.S. monthly average demand outside 250-800 GW")
        uearly = [mo for mo, a, c in zip(um["months"], um["avg_mw"], um["coverage"]) if c >= 0.95 and mo < "2019-01" and not 250_000 < a < 800_000]
        if uearly:
            print(f"note: U.S. monthly average demand outside 250-800 GW in {len(uearly)} months before 2019 ({uearly[0]} to {uearly[-1]}); check them on the chart")
        if max(p for p in um["peak_mw"] if p is not None) > 1_000_000:
            errs.append("a U.S. monthly peak above 1,000 GW survived cleaning")
        ug = us_fuel["comparison"]["latest"]["gwh"]
        utot = sum(ug.values())
        if not 2_500_000 < utot < 6_000_000:
            errs.append(f"latest 12-month U.S. generation {utot/1000:.0f} TWh outside 2500-6000 TWh")
    rt = meta.get("retired", {})
    if rt.get("rows_kept") is not None:
        ret = json.loads((OUT / "retired.json").read_text())
        rc = ret["columns"]
        tot = sum((r[rc.index("mw")] or 0) for r in ret["rows"])
        if not 3_000 < tot < 150_000:
            errs.append(f"U.S. capacity retired since Dec 2022 is {tot:,.0f} MW, outside 3-150 GW")
        if not any(r[rc.index("pjm")] for r in ret["rows"]):
            errs.append("no retired unit matched a PJM plant ID")
    for scope, info in (meta.get("explorer") or {}).items():
        for f in [f"explorer_{scope}.json"] + info.get("hourly_files", []):
            if not (OUT / f).exists():
                errs.append(f"explorer file {f} is listed in meta but missing")
        if (OUT / f"explorer_{scope}.json").exists():
            ex = json.loads((OUT / f"explorer_{scope}.json").read_text())
            vals = [v for v in ex["daily"]["demand"]["avg_mw"] if v is not None]
            if len(vals) < 365 * 3:
                errs.append(f"explorer {scope}: only {len(vals)} days of demand")
            elif not 1_000 < min(vals) and scope == "pjm":
                errs.append(f"explorer {scope}: a daily demand value is implausibly low")
    if errs:
        print("VALIDATION FAILED:\n - " + "\n - ".join(errs))
        return 1
    print("validation passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

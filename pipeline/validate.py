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
    good = [a for a, c in zip(m["avg_mw"], m["coverage"]) if c >= 0.97]
    if not good or not all(50_000 < a < 200_000 for a in good):
        errs.append("monthly average demand outside 50-200 GW")
    for k in ("baseline", "latest"):
        if not 50_000 < dem["comparison"][k]["avg_mw"] < 200_000:
            errs.append(f"{k} average demand outside 50-200 GW")
    if not dem["zones"]:
        errs.append("no PJM subregion (zone) data")
    gs = fuel["comparison"]["latest"]["gwh"]
    total = sum(v for k, v in gs.items() if k != "storage")
    if not 400_000 < total < 1_200_000:
        errs.append(f"latest 12-month PJM generation {total/1000:.0f} TWh outside 400-1200 TWh")
    if gs.get("gas", 0) <= 0:
        errs.append("no natural gas generation found")
    if errs:
        print("VALIDATION FAILED:\n - " + "\n - ".join(errs))
        return 1
    print("validation passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

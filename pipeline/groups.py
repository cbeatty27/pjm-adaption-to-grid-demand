"""Fuel grouping. Pure lookup tables from EIA's own code lists - no judgement about plant use.

GROUPS is the display order; the front end reads it from meta.json so the two never drift.
"""
GROUPS = [
    ("gas", "Natural gas"),
    ("coal", "Coal"),
    ("nuclear", "Nuclear"),
    ("solar", "Solar"),
    ("wind", "Wind"),
    ("hydro", "Hydro"),
    ("storage", "Storage"),
    ("other", "Other"),
]

# EIA-860 / 860M energy_source_code -> group
GEN_SOURCE = {
    "NG": "gas",
    "BIT": "coal", "SUB": "coal", "LIG": "coal", "ANT": "coal", "RC": "coal", "WC": "coal", "SGC": "coal",
    "NUC": "nuclear",
    "SUN": "solar",
    "WND": "wind",
    "WAT": "hydro",
    "MWH": "storage",
}  # everything else (oil, biomass, geothermal, waste heat, other gases, ...) -> "other"

# EIA-930 fuel-type-data fueltype code -> group
FUEL930 = {
    "NG": "gas", "COL": "coal", "NUC": "nuclear", "SUN": "solar", "WND": "wind", "WAT": "hydro",
    "BAT": "storage", "PS": "storage", "ESS": "storage",
    "OIL": "other", "OTH": "other", "GEO": "other", "BIO": "other", "UNK": "other",
}

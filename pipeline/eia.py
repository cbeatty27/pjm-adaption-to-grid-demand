"""Minimal EIA Open Data API v2 client.

The API key is read from the EIA_API_KEY environment variable only. It is never
written to disk, logged, or included in provenance output.
"""
from __future__ import annotations

import os
import sys
import time
from typing import Any

import requests

BASE = "https://api.eia.gov/v2/"
PAGE = 5000  # EIA maximum rows per request


class EIAError(RuntimeError):
    pass


def _key() -> str:
    k = os.environ.get("EIA_API_KEY", "").strip()
    if not k:
        raise EIAError("EIA_API_KEY is not set")
    return k


def _redact(text: str) -> str:
    k = os.environ.get("EIA_API_KEY", "")
    return text.replace(k, "***") if k else text


def get(route: str, params: dict[str, Any] | None = None, retries: int = 6) -> dict:
    """GET one EIA v2 route (metadata or data). Retries on 429/5xx with backoff."""
    url = BASE + route.strip("/")
    q = dict(params or {})
    q["api_key"] = _key()
    delay = 2.0
    last = ""
    for attempt in range(retries):
        try:
            r = requests.get(url, params=q, timeout=120)
        except requests.RequestException as e:  # network error
            last = _redact(str(e))
        else:
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}: {_redact(r.text[:300])}"
            if r.status_code not in (429, 500, 502, 503, 504):
                break
        time.sleep(delay)
        delay = min(delay * 2, 60)
    raise EIAError(f"{route}: {last}")


def metadata(route: str) -> dict:
    return get(route)["response"]


def facet_values(route: str, facet: str) -> list[dict]:
    return get(f"{route}/facet/{facet}")["response"].get("facets", [])


def fetch_all(route: str, params: dict[str, Any], log: bool = True) -> list[dict]:
    """Page through <route>/data until every row is fetched."""
    rows: list[dict] = []
    offset = 0
    total = None
    while True:
        p = dict(params)
        p["offset"] = offset
        p["length"] = PAGE
        resp = get(f"{route}/data", p)["response"]
        if total is None:
            total = int(resp.get("total", 0))
            warnings = resp.get("warnings")
            if warnings and log:
                print(f"  warnings for {route}: {warnings}", file=sys.stderr)
        data = resp.get("data", [])
        rows.extend(data)
        offset += len(data)
        if not data or offset >= total:
            break
        time.sleep(0.15)
    if total is not None and len(rows) != total:
        raise EIAError(f"{route}: expected {total} rows, got {len(rows)}")
    return rows

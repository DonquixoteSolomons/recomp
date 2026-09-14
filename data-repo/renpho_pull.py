"""Pull every Renpho Health measurement into body.json. Runs on GitHub Actions.

    RENPHO_EMAIL=... RENPHO_PASSWORD=... python renpho_pull.py

Idempotent: merges on ext_id, keeps the file sorted by time. The PWA reads
this file from the repo through the GitHub API.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

SGT = timezone(timedelta(hours=8))
OUT = Path(__file__).resolve().parent / "body.json"


def _f(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _ts(m: dict) -> datetime | None:
    ts = m.get("timeStamp") or m.get("time_stamp")
    if ts is None:
        return None
    ts = float(ts)
    if ts > 1e11:
        ts /= 1000
    return datetime.fromtimestamp(ts, tz=SGT)


def main() -> int:
    email, password = os.environ.get("RENPHO_EMAIL"), os.environ.get("RENPHO_PASSWORD")
    if not email or not password:
        print("RENPHO_EMAIL / RENPHO_PASSWORD not set", file=sys.stderr)
        return 1
    from renpho import RenphoClient
    client = RenphoClient(email, password)
    client.login()
    records = client.get_all_measurements()

    existing = {}
    if OUT.exists():
        for r in json.loads(OUT.read_text(encoding="utf-8")):
            existing[r["ext_id"]] = r

    new = 0
    for m in records:
        when, w = _ts(m), _f(m.get("weight"))
        if when is None or w is None:
            continue
        ext = f"renpho:{m.get('id')}" if m.get("id") is not None else f"renpho:{int(when.timestamp())}"
        if ext in existing:
            continue
        muscle_pct = _f(m.get("muscle"))
        existing[ext] = dict(
            ext_id=ext, day=when.date().isoformat(), at=when.isoformat(timespec="minutes"),
            weight_kg=round(w, 2), bodyfat_pct=_f(m.get("bodyfat")),
            muscle_kg=round(w * muscle_pct / 100, 2) if muscle_pct and muscle_pct < 100 else None,
            water_pct=_f(m.get("water")), source="renpho",
        )
        new += 1

    rows = sorted(existing.values(), key=lambda r: r["at"])
    OUT.write_text(json.dumps(rows, indent=0, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"fetched {len(records)}, new {new}, total {len(rows)}; latest "
          f"{rows[-1]['weight_kg'] if rows else '-'} kg on {rows[-1]['day'] if rows else '-'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Pull every measurement from the Renpho Health cloud into the body table.

Unofficial API (renpho-api on PyPI). It will break one day; nothing else in
the app depends on this module, and a failure returns a stats dict with an
error instead of raising.

Credentials come from the environment or a .env file in the project root:

    RENPHO_EMAIL=you@example.com
    RENPHO_PASSWORD=...

The .env file is gitignored. Nothing here ever writes the password anywhere.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from recomp import env

SGT = ZoneInfo("Asia/Singapore")
ROOT = Path(__file__).resolve().parent.parent.parent


def _ts(m: dict) -> datetime | None:
    ts = m.get("timeStamp") or m.get("time_stamp")
    if ts is None:
        return None
    ts = float(ts)
    if ts > 1e11:                       # milliseconds
        ts /= 1000
    return datetime.fromtimestamp(ts, tz=SGT)


def _f(v) -> float | None:
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def pull(conn: sqlite3.Connection) -> dict:
    """Fetch all measurements and upsert. Idempotent on (source, ext_id)."""
    env.load()
    email, password = os.environ.get("RENPHO_EMAIL"), os.environ.get("RENPHO_PASSWORD")
    if not email or not password:
        return dict(ok=False, error="RENPHO_EMAIL / RENPHO_PASSWORD not set (put them in .env)")
    try:
        from renpho import RenphoClient
        client = RenphoClient(email, password)
        client.login()
        records = client.get_all_measurements()
    except Exception as e:                       # noqa: BLE001 — isolate the unofficial API
        return dict(ok=False, error=f"{type(e).__name__}: {e}")

    new = skipped = 0
    for m in records:
        when = _ts(m)
        w = _f(m.get("weight"))
        if when is None or w is None:
            skipped += 1
            continue
        muscle_pct = _f(m.get("muscle"))
        muscle_kg = round(w * muscle_pct / 100, 2) if muscle_pct and muscle_pct < 100 else None
        ext = f"renpho:{m.get('id')}" if m.get("id") is not None else f"renpho:{int(when.timestamp())}"
        cur = conn.execute(
            "INSERT OR IGNORE INTO body(day,at,weight_kg,bodyfat_pct,muscle_kg,water_pct,source,ext_id) "
            "VALUES(?,?,?,?,?,?,'renpho',?)",
            (when.date().isoformat(), when.isoformat(timespec="minutes"), round(w, 2),
             _f(m.get("bodyfat")), muscle_kg, _f(m.get("water")), ext))
        new += cur.rowcount
    conn.commit()
    latest = conn.execute("SELECT day, weight_kg, bodyfat_pct FROM body WHERE source='renpho' "
                          "ORDER BY at DESC LIMIT 1").fetchone()
    return dict(ok=True, fetched=len(records), new=new, skipped=skipped,
                latest=dict(latest) if latest else None)

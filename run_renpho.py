"""Pull Renpho measurements and recompute the expenditure estimate.

    python run_renpho.py

Needs RENPHO_EMAIL and RENPHO_PASSWORD in .env (gitignored). Safe to run on
a schedule; re-runs only add measurements not seen before.
"""
from __future__ import annotations

import sys

from recomp import db, engine
from recomp.ingest import renpho


def main() -> int:
    conn = db.get_conn()
    stats = renpho.pull(conn)
    print(stats)
    if not stats.get("ok"):
        return 1
    e = engine.recompute(conn)
    print(f"expenditure: {e.confidence} — {e.note}")
    if e.tdee:
        print(f"  tdee {e.tdee} ({e.tdee_lo}-{e.tdee_hi})  target {e.target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

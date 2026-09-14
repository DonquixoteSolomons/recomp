"""Dump the local SQLite (chat backfill, products, settings) to data-repo/seed.json
for a one-time import into the phone app.

    .venv/Scripts/python tools/export_seed.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from recomp import db  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "data-repo" / "seed.json"


def main() -> int:
    conn = db.get_conn()
    rows = lambda sql: [dict(r) for r in conn.execute(sql)]  # noqa: E731
    seed = dict(
        version=1,
        meals=rows("SELECT day,at,label,kcal,kcal_lo,kcal_hi,protein_g,source,share_frac,venue,detail,needs_review FROM meals ORDER BY at"),
        workouts=rows("SELECT day,at,kind,detail,source FROM workouts ORDER BY at"),
        body=rows("SELECT day,at,weight_kg,bodyfat_pct,muscle_kg,water_pct,source,ext_id FROM body ORDER BY at"),
        products=rows("SELECT kind,label,per,kcal,protein_g,is_default,active FROM products"),
        settings={r["key"]: r["value"] for r in conn.execute("SELECT key,value FROM settings")},
    )
    OUT.write_text(json.dumps(seed, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"wrote {OUT.name}: {len(seed['meals'])} meals, {len(seed['workouts'])} workouts, "
          f"{len(seed['body'])} weigh-ins, {len(seed['products'])} products")
    return 0


if __name__ == "__main__":
    sys.exit(main())

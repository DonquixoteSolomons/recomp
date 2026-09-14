"""Seed the database from the claude.ai export.

    python run_backfill.py --export "C:/Users/ASUS/Downloads/conversations-000.zip"
    python run_backfill.py --export ".../conversations.json" --dry-run
    python run_backfill.py --export "..." --until 2026-09-14     # stop before app-logged days

Reads the two food-log chats, writes meals + workouts with source='backfill'.
Re-running replaces the previous backfill; hand-entered rows are untouched.
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

from recomp import backfill, db


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", type=Path, required=True, help="conversations-000.zip or conversations.json")
    ap.add_argument("--until", default=None, help="Last day to import (YYYY-MM-DD). Set this to the day before you started logging in the app.")
    ap.add_argument("--dry-run", action="store_true", help="Parse and print per-day totals, do not write")
    args = ap.parse_args()

    conn = db.get_conn()
    msgs = backfill.load_messages(args.export)
    meals, workouts = backfill.parse(conn, msgs, until=args.until)

    by_day: dict[str, dict] = defaultdict(lambda: dict(kcal=0.0, protein=0.0, n=0, miss=0, w=[]))
    for m in meals:
        d = by_day[m["day"]]
        if m["found"]:
            d["kcal"] += m["kcal"]; d["protein"] += m["protein"]; d["n"] += 1
        else:
            d["miss"] += 1
    for w in workouts:
        by_day[w["day"]]["w"].append(w["kind"])

    print(f"{'day':<12}{'meals':>6}{'unval':>6}{'protein':>9}{'kcal':>7}   workouts")
    for day in sorted(by_day):
        d = by_day[day]
        print(f"{day:<12}{d['n']:>6}{d['miss']:>6}{d['protein']:>8.0f}g{d['kcal']:>7.0f}   {', '.join(d['w'])}")
    print(f"\n{len(meals)} meal messages ({sum(1 for m in meals if not m['found'])} without numbers), "
          f"{len(workouts)} workouts, {len(by_day)} days")

    if args.dry_run:
        print("\ndry run: nothing written")
        return 0
    stats = backfill.write(conn, meals, workouts)
    print(f"\nwritten: {stats}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

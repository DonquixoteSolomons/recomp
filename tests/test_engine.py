"""The engine must never use a formula, and must be honest about confidence."""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from recomp import db, engine


@pytest.fixture
def conn(tmp_path):
    c = db.get_conn(tmp_path / "t.db")
    db.set_setting(c, "creatine_start", "2000-01-01")     # far away: no exclusion
    db.set_setting(c, "recomp_deficit_kcal", "250")
    return c


def _seed(conn, start: date, days: int, kcal: float, w0: float, slope_per_day: float):
    """`days` complete days of flat intake and a linear weight drift."""
    for i in range(days):
        d = start + timedelta(days=i)
        conn.execute("INSERT INTO meals(day,at,label,kcal,kcal_lo,kcal_hi,protein_g,source) "
                     "VALUES(?,?,?,?,?,?,?,'manual')",
                     (d.isoformat(), f"{d}T12:00", "x", kcal, kcal * 0.9, kcal * 1.1, 150))
        conn.execute("INSERT INTO body(day,at,weight_kg,source) VALUES(?,?,?,'manual')",
                     (d.isoformat(), f"{d}T07:00", w0 + slope_per_day * i))
    conn.commit()


def test_no_estimate_below_min_days(conn):
    _seed(conn, date(2026, 9, 1), 5, 2400, 74.0, 0)
    e = engine.estimate(conn, as_of=date(2026, 9, 7))
    assert e.confidence == "none" and e.tdee is None
    assert engine.current_target(conn)["source"] == "provisional"


def test_flat_weight_means_tdee_equals_intake(conn):
    _seed(conn, date(2026, 9, 1), 21, 2400, 74.0, 0)
    e = engine.recompute(conn, as_of=date(2026, 9, 22))
    assert e.confidence == "good"
    assert e.tdee == 2400
    assert e.target == 2150
    assert e.tdee_lo < 2400 < e.tdee_hi
    assert engine.current_target(conn)["source"] == "measured"


def test_gaining_weight_lowers_tdee_below_intake(conn):
    # +1 kg over 20 days at 2,900/day: ~385 kcal/day stored, so tdee ~ 2,515
    _seed(conn, date(2026, 9, 1), 21, 2900, 73.5, 1 / 20)
    e = engine.estimate(conn, as_of=date(2026, 9, 22))
    assert 2450 < e.tdee < 2580, e.note
    assert e.tdee < 2900


def test_losing_weight_raises_tdee_above_intake(conn):
    _seed(conn, date(2026, 9, 1), 21, 2200, 75.0, -1 / 20)
    e = engine.estimate(conn, as_of=date(2026, 9, 22))
    assert e.tdee > 2200


def test_today_is_excluded(conn):
    _seed(conn, date(2026, 9, 1), 21, 2400, 74.0, 0)
    # a half-logged "today" must not drag the average down
    conn.execute("INSERT INTO meals(day,at,label,kcal,kcal_lo,kcal_hi,protein_g,source) "
                 "VALUES('2026-09-22','2026-09-22T09:00','breakfast',400,380,420,20,'manual')")
    conn.commit()
    e = engine.estimate(conn, as_of=date(2026, 9, 22))
    assert e.intake_avg == 2400


def test_incomplete_days_are_skipped(conn):
    _seed(conn, date(2026, 9, 1), 21, 2400, 74.0, 0)
    conn.execute("UPDATE meals SET kcal=300, kcal_lo=280, kcal_hi=320 WHERE day='2026-09-10'")
    conn.commit()
    e = engine.estimate(conn, as_of=date(2026, 9, 22))
    assert e.days_with_intake == 20 and e.intake_avg == 2400


def test_creatine_window_excluded_from_weight_side(conn):
    db.set_setting(conn, "creatine_start", "2026-09-01")
    db.set_setting(conn, "creatine_settle_days", "28")
    _seed(conn, date(2026, 9, 1), 21, 2400, 74.0, 0.05)      # all inside the window
    e = engine.estimate(conn, as_of=date(2026, 9, 22))
    assert e.confidence == "none"
    assert "creatine" in e.note


def test_trend_is_smoothed(conn):
    _seed(conn, date(2026, 9, 1), 10, 2400, 74.0, 0)
    conn.execute("INSERT INTO body(day,at,weight_kg,source) VALUES('2026-09-11','2026-09-11T07:00',76.5,'manual')")
    conn.commit()
    pts = engine.weight_trend(conn)
    assert pts[-1].weight == 76.5
    assert pts[-1].trend < 74.5           # one salty dinner barely moves the trend

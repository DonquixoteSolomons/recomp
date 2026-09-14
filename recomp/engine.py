"""Adaptive expenditure engine.

The formula route (BMR x activity multiplier, then netting workouts off it)
is what produced a double-counted 2,500 ceiling. This module never uses a
formula. It back-calculates expenditure from what actually happened:

    tdee ~= mean(logged intake) - (delta trend_kg x 7700) / days

Weight is smoothed with an exponential moving average so a single salty
dinner does not move the estimate. Confidence grows with days of data, and
the first weeks after starting creatine are excluded because water retention
inflates the trend.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, asdict
from datetime import date, timedelta

from recomp import db

KCAL_PER_KG = 7700          # energy content of a kilogram of body-mass change (rough, standard)
EMA_ALPHA = 0.10            # ~10-day time constant on daily readings
MIN_DAYS = 7                # below this: no estimate, provisional target is used
INCOMPLETE_KCAL = 1000      # a "day" logged below this is a forgotten day, not a fast


# ------------------------------------------------------------------ trend
@dataclass
class TrendPoint:
    day: str
    weight: float           # raw (mean of that day's readings)
    trend: float            # EMA
    bodyfat: float | None
    creatine_window: bool


def _day(d: str | date) -> date:
    return d if isinstance(d, date) else date.fromisoformat(d)


def creatine_window(conn: sqlite3.Connection) -> tuple[date, date] | None:
    start = db.get_setting(conn, "creatine_start")
    if not start:
        return None
    settle = int(db.get_setting_f(conn, "creatine_settle_days", 28))
    s = _day(start)
    return s, s + timedelta(days=settle)


def weight_trend(conn: sqlite3.Connection, start: str | None = None,
                 end: str | None = None, alpha: float = EMA_ALPHA) -> list[TrendPoint]:
    """Daily weight (mean of readings) with an EMA trend line."""
    sql = "SELECT day, AVG(weight_kg) w, AVG(bodyfat_pct) bf FROM body WHERE 1=1"
    params: list = []
    if start:
        sql += " AND day>=?"
        params.append(start)
    if end:
        sql += " AND day<=?"
        params.append(end)
    sql += " GROUP BY day ORDER BY day"
    rows = conn.execute(sql, params).fetchall()
    cw = creatine_window(conn)
    out: list[TrendPoint] = []
    ema: float | None = None
    for r in rows:
        w = float(r["w"])
        ema = w if ema is None else ema + alpha * (w - ema)
        d = _day(r["day"])
        in_cw = bool(cw and cw[0] <= d <= cw[1])
        out.append(TrendPoint(r["day"], round(w, 2), round(ema, 2),
                              round(r["bf"], 1) if r["bf"] is not None else None, in_cw))
    return out


# ------------------------------------------------------------------ intake
def daily_intake(conn: sqlite3.Connection, start: str, end: str) -> dict[str, dict]:
    rows = conn.execute(
        "SELECT day, SUM(kcal) kcal, SUM(kcal_lo) lo, SUM(kcal_hi) hi, "
        "SUM(protein_g) protein, COUNT(*) n FROM meals "
        "WHERE day>=? AND day<=? GROUP BY day ORDER BY day", (start, end)).fetchall()
    return {r["day"]: dict(kcal=r["kcal"], lo=r["lo"], hi=r["hi"],
                           protein=r["protein"], n=r["n"]) for r in rows}


# ------------------------------------------------------------------ estimate
@dataclass
class Estimate:
    as_of: str
    window_days: int
    days_with_intake: int
    intake_avg: float | None
    trend_start: float | None
    trend_end: float | None
    tdee: float | None
    tdee_lo: float | None
    tdee_hi: float | None
    target: float | None
    confidence: str
    note: str


def _slope_per_day(points: list[TrendPoint]) -> float:
    """Ordinary least squares of raw weight against day index."""
    if len(points) < 2:
        return 0.0
    d0 = _day(points[0].day)
    xs = [(_day(p.day) - d0).days for p in points]
    ys = [p.weight for p in points]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx


def _confidence(n_days: int) -> tuple[str, float]:
    """Label and +/- fraction applied on top of intake uncertainty."""
    if n_days < MIN_DAYS:
        return "none", 0.0
    if n_days < 14:
        return "low", 0.12
    if n_days < 21:
        return "medium", 0.08
    return "good", 0.05


def estimate(conn: sqlite3.Connection, as_of: str | date | None = None,
             window: int = 21) -> Estimate:
    """Back-calculate expenditure over the `window` days ending the day before as_of.

    Today is excluded because it is still being logged. Days logged under
    INCOMPLETE_KCAL are treated as forgotten and skipped. Days inside the
    creatine settling window are skipped for the weight side.
    """
    today = _day(as_of) if as_of else date.today()
    end = today - timedelta(days=1)
    start = end - timedelta(days=window - 1)
    deficit = db.get_setting_f(conn, "recomp_deficit_kcal", 250)

    intake = daily_intake(conn, start.isoformat(), end.isoformat())
    good_days = {d: v for d, v in intake.items() if v["kcal"] >= INCOMPLETE_KCAL}

    trend = [p for p in weight_trend(conn, start.isoformat(), end.isoformat())
             if not p.creatine_window]

    base = Estimate(today.isoformat(), window, len(good_days), None, None, None,
                    None, None, None, None, "none", "")

    if len(good_days) < MIN_DAYS:
        base.note = f"{len(good_days)} usable days of intake; need {MIN_DAYS}."
        return base
    if len(trend) < 2:
        base.note = "Not enough weigh-ins outside the creatine window to read a trend."
        base.intake_avg = round(sum(v["kcal"] for v in good_days.values()) / len(good_days))
        return base

    # weight side: least-squares slope of the raw readings. An EMA endpoint
    # difference lags a steady drift by ~1/alpha days and under-reads it;
    # a fitted slope has no lag and averages out day-to-day water noise.
    t0, t1 = trend[0], trend[-1]
    span_days = max(1, (_day(t1.day) - _day(t0.day)).days)
    delta_kg = _slope_per_day(trend) * span_days
    stored_per_day = delta_kg * KCAL_PER_KG / span_days

    # intake side
    n = len(good_days)
    avg = sum(v["kcal"] for v in good_days.values()) / n
    avg_lo = sum(v["lo"] for v in good_days.values()) / n
    avg_hi = sum(v["hi"] for v in good_days.values()) / n

    tdee = avg - stored_per_day
    conf, band = _confidence(min(n, span_days + 1))
    # intake range propagates directly; confidence band widens it further
    lo = (avg_lo - stored_per_day) * (1 - band)
    hi = (avg_hi - stored_per_day) * (1 + band)

    base.intake_avg = round(avg)
    base.trend_start, base.trend_end = t0.trend, t1.trend
    base.tdee, base.tdee_lo, base.tdee_hi = round(tdee), round(lo), round(hi)
    base.target = round(tdee - deficit)
    base.confidence = conf
    base.note = (f"{n} days intake, trend {t0.trend} to {t1.trend} kg over {span_days} d "
                 f"({delta_kg:+.2f} kg, {stored_per_day:+.0f} kcal/d stored).")
    return base


def recompute(conn: sqlite3.Connection, as_of: str | date | None = None) -> Estimate:
    e = estimate(conn, as_of)
    conn.execute(
        "INSERT INTO expenditure(as_of,window_days,days_with_intake,intake_avg,"
        "trend_start,trend_end,tdee,tdee_lo,tdee_hi,target,confidence,note) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(as_of) DO UPDATE SET "
        "window_days=excluded.window_days, days_with_intake=excluded.days_with_intake, "
        "intake_avg=excluded.intake_avg, trend_start=excluded.trend_start, "
        "trend_end=excluded.trend_end, tdee=excluded.tdee, tdee_lo=excluded.tdee_lo, "
        "tdee_hi=excluded.tdee_hi, target=excluded.target, confidence=excluded.confidence, "
        "note=excluded.note, computed_at=datetime('now')",
        (e.as_of, e.window_days, e.days_with_intake, e.intake_avg, e.trend_start,
         e.trend_end, e.tdee, e.tdee_lo, e.tdee_hi, e.target, e.confidence, e.note))
    conn.commit()
    return e


def current_target(conn: sqlite3.Connection) -> dict:
    """What today's calorie band should be, and where it came from."""
    row = conn.execute("SELECT * FROM expenditure WHERE confidence!='none' "
                       "ORDER BY as_of DESC LIMIT 1").fetchone()
    provisional = db.get_setting_f(conn, "provisional_kcal", 2350)
    deficit = db.get_setting_f(conn, "recomp_deficit_kcal", 250)
    if row is None:
        return dict(source="provisional", target=provisional,
                    lo=provisional - 100, hi=provisional + 100,
                    tdee=None, confidence="none",
                    note="Formula-free estimate needs about 7 logged days with weigh-ins. "
                         "Until then this is a conservative guess.")
    return dict(source="measured", target=row["target"],
                lo=row["tdee_lo"] - deficit, hi=row["tdee_hi"] - deficit,
                tdee=row["tdee"], confidence=row["confidence"],
                as_of=row["as_of"], note=row["note"])


def to_dict(e: Estimate) -> dict:
    return asdict(e)

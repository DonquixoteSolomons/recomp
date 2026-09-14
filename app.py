"""Recomp — local API + phone UI.

    .venv\\Scripts\\uvicorn app:app --host 0.0.0.0 --port 8765

Binds to all interfaces so the phone can reach it over Tailscale. Everything
runs against data/recomp.db. The only outbound call is the Renpho pull, and
only when you trigger it.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from recomp import db, engine, estimate, foods
from recomp.ingest import renpho

SGT = ZoneInfo("Asia/Singapore")
STATIC = Path(__file__).resolve().parent / "static"

app = FastAPI(title="Recomp", docs_url="/api/docs", redoc_url=None)
conn = db.get_conn()


def now() -> datetime:
    return datetime.now(SGT)


def today() -> str:
    return now().date().isoformat()


def _at(at: str | None) -> tuple[str, str]:
    """(day, iso-minute) for a supplied local time or now."""
    dt = datetime.fromisoformat(at).astimezone(SGT) if at else now()
    return dt.date().isoformat(), dt.isoformat(timespec="minutes")


# ------------------------------------------------------------------ models
class QuickIn(BaseModel):
    id: str
    at: str | None = None
    share_frac: float = Field(1.0, gt=0, le=1)
    count: int = Field(1, ge=1, le=10)


class ShakeIn(BaseModel):
    whey_g: float = Field(ge=0, le=200)
    milk_ml: float = Field(ge=0, le=1000)
    milk_id: int | None = None
    whey_id: int | None = None
    creatine_g: float = Field(0, ge=0, le=20)
    at: str | None = None


class ProductIn(BaseModel):
    kind: str
    label: str
    per: str
    kcal: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    make_default: bool = False


class ManualIn(BaseModel):
    label: str
    kcal: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    kcal_lo: float | None = None
    kcal_hi: float | None = None
    share_frac: float = Field(1.0, gt=0, le=1)
    venue: str | None = None
    at: str | None = None


class WorkoutIn(BaseModel):
    kind: str
    detail: str | None = None
    at: str | None = None


class BodyIn(BaseModel):
    weight_kg: float = Field(gt=30, lt=200)
    bodyfat_pct: float | None = Field(None, gt=0, lt=70)
    at: str | None = None


class SettingsIn(BaseModel):
    values: dict[str, str]


# ------------------------------------------------------------------ helpers
def _insert_meal(day: str, at: str, label: str, kcal: float, lo: float, hi: float,
                 protein: float, source: str, share: float = 1.0,
                 venue: str | None = None, detail: dict | None = None) -> int:
    cur = conn.execute(
        "INSERT INTO meals(day,at,label,kcal,kcal_lo,kcal_hi,protein_g,source,share_frac,venue,detail) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (day, at, label, round(kcal * share), round(lo * share), round(hi * share),
         round(protein * share, 1), source, share, venue,
         json.dumps(detail, ensure_ascii=False) if detail else None))
    conn.commit()
    return cur.lastrowid


def _day_payload(day: str) -> dict:
    s = db.all_settings(conn)
    pf, pc = float(s["protein_floor_g"]), float(s["protein_ceiling_g"])
    meals = [dict(r) for r in conn.execute(
        "SELECT id,at,label,kcal,kcal_lo,kcal_hi,protein_g,source,share_frac,venue,needs_review "
        "FROM meals WHERE day=? ORDER BY at", (day,))]
    workouts = [dict(r) for r in conn.execute(
        "SELECT id,at,kind,detail,source FROM workouts WHERE day=? ORDER BY at", (day,))]
    kcal = sum(m["kcal"] for m in meals)
    lo = sum(m["kcal_lo"] for m in meals)
    hi = sum(m["kcal_hi"] for m in meals)
    protein = sum(m["protein_g"] for m in meals)
    whey_p = sum(m["protein_g"] for m in meals
                 if m["source"] == "shake" or "whey" in (m["label"] or "").lower())

    target = engine.current_target(conn)
    t_lo, t_hi = target["lo"], target["hi"]

    # verdict: the question you asked seven times, answered every time
    if protein < pf:
        p_state, p_msg = "short", f"{pf - protein:.0f}g short of the {pf:.0f}g floor"
    elif protein <= pc:
        p_state, p_msg = "hit", "protein floor hit"
    else:
        p_state, p_msg = "over", f"{protein - pc:.0f}g over the {pc:.0f}g ceiling — not a problem"
    if not meals:
        k_state, k_msg = "under", "nothing logged yet"
    elif kcal < t_lo:
        k_state, k_msg = "under", f"{t_lo - kcal:.0f} under the band — fine if protein is hit"
    elif kcal <= t_hi:
        k_state, k_msg = "in", "calories in band"
    else:
        k_state, k_msg = "over", f"{kcal - t_hi:.0f} over the band"
    ok_to_end = bool(meals) and p_state != "short" and k_state != "over"

    # weight context
    trend = engine.weight_trend(conn)
    latest = trend[-1] if trend else None
    cw = engine.creatine_window(conn)
    wl, wh = float(s["weight_lo_kg"]), float(s["weight_hi_kg"])
    body = None
    if latest:
        body = dict(day=latest.day, weight=latest.weight, trend=latest.trend,
                    bodyfat=latest.bodyfat, in_creatine_window=latest.creatine_window,
                    out_of_bounds=not (wl <= latest.trend <= wh))

    return dict(
        day=day, is_today=day == today(), meals=meals, workouts=workouts,
        totals=dict(kcal=round(kcal), lo=round(lo), hi=round(hi), protein=round(protein, 1),
                    whey_protein=round(whey_p, 1),
                    whey_share=round(whey_p / protein, 2) if protein else 0),
        targets=dict(protein_floor=pf, protein_ceiling=pc, kcal=target,
                     weight_lo=wl, weight_hi=wh),
        verdict=dict(protein=p_state, protein_msg=p_msg, kcal=k_state, kcal_msg=k_msg,
                     ok_to_end=ok_to_end),
        body=body,
        creatine_window=[cw[0].isoformat(), cw[1].isoformat()] if cw else None,
    )


# ------------------------------------------------------------------ routes
@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/day")
def get_day(day: str | None = None):
    return _day_payload(day or today())


@app.get("/api/foods")
def get_foods():
    return dict(quick=foods.QUICK, milks=foods.products(conn, "milk"), wheys=foods.products(conn, "whey"))


@app.get("/api/shake/preview")
def shake_preview(whey_g: float, milk_ml: float, milk_id: int | None = None,
                  whey_id: int | None = None, creatine_g: float = 0):
    try:
        return foods.shake(conn, whey_g, milk_ml, milk_id, creatine_g, whey_id)
    except LookupError as e:
        raise HTTPException(404, str(e))


# ------------------------------------------------------------------ products
@app.get("/api/products")
def get_products(kind: str | None = None):
    return foods.products(conn, kind)


@app.post("/api/products")
def add_product(body: ProductIn):
    try:
        return foods.add_product(conn, body.kind, body.label, body.per, body.kcal, body.protein_g, body.make_default)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/products/{pid}/default")
def default_product(pid: int):
    try:
        foods.set_default(conn, pid)
    except KeyError:
        raise HTTPException(404)
    return foods.products(conn)


@app.delete("/api/products/{pid}")
def retire_product(pid: int):
    foods.retire_product(conn, pid)
    return foods.products(conn)


# ------------------------------------------------------------------ estimates
@app.post("/api/estimate")
async def run_estimate(photos: list[UploadFile] = File(default=[]), text: str = Form(""),
                       share_frac: float = Form(1.0), parent_id: int | None = Form(None)):
    if not photos and not text.strip() and not parent_id:
        raise HTTPException(400, "Give a photo, a description, or both")
    raw = [await f.read() for f in photos if f.filename]
    try:
        row = estimate.estimate(conn, raw, text, share_frac, parent_id)
    except Exception as e:                       # noqa: BLE001 — surface the real reason on the phone
        raise HTTPException(502, f"{type(e).__name__}: {e}")
    row["cost_usd"] = estimate.cost_usd(row["usage"], row["model"])
    return row


@app.get("/api/estimate/{est_id}")
def get_estimate(est_id: int):
    try:
        row = estimate.get(conn, est_id)
    except KeyError:
        raise HTTPException(404)
    row["cost_usd"] = estimate.cost_usd(row["usage"], row["model"])
    return row


@app.post("/api/estimate/{est_id}/add")
def add_estimate_to_log(est_id: int):
    try:
        row = estimate.get(conn, est_id)
    except KeyError:
        raise HTTPException(404)
    if row["meal_id"]:
        raise HTTPException(409, "already added")
    r = row["result"]
    mid = _insert_meal(row["day"], row["at"], r["dish"], r["kcal"], r["kcal_lo"], r["kcal_hi"],
                       r["protein_g"], "photo", 1.0, None,
                       dict(estimate_id=est_id, confidence=r["confidence"], photos=row["photos"]))
    conn.execute("UPDATE estimates SET meal_id=? WHERE id=?", (mid, est_id))
    conn.commit()
    return dict(id=mid, **_day_payload(row["day"]))


@app.get("/api/photos/{name}")
def get_photo(name: str):
    p = estimate.PHOTO_DIR / Path(name).name
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/jpeg")


@app.post("/api/meals/quick")
def add_quick(body: QuickIn):
    q = foods.QUICK_BY_ID.get(body.id)
    if not q:
        raise HTTPException(404, "unknown quick-add id")
    day, at = _at(body.at)
    n = body.count
    mid = _insert_meal(day, at, q["label"] + (f" ×{n}" if n > 1 else ""),
                       q["kcal"] * n, q["lo"] * n, q["hi"] * n, q["protein"] * n,
                       "quick", body.share_frac, detail=dict(quick_id=body.id, count=n))
    return dict(id=mid, **_day_payload(day))


@app.post("/api/meals/shake")
def add_shake(body: ShakeIn):
    try:
        s = foods.shake(conn, body.whey_g, body.milk_ml, body.milk_id, body.creatine_g, body.whey_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    day, at = _at(body.at)
    mid = _insert_meal(day, at, s["label"], s["kcal"], s["kcal_lo"], s["kcal_hi"],
                       s["protein_g"], "shake", detail=body.model_dump() | dict(breakdown=s["breakdown"]))
    return dict(id=mid, **_day_payload(day))


@app.post("/api/meals/manual")
def add_manual(body: ManualIn):
    day, at = _at(body.at)
    lo = body.kcal_lo if body.kcal_lo is not None else body.kcal * 0.85
    hi = body.kcal_hi if body.kcal_hi is not None else body.kcal * 1.15
    mid = _insert_meal(day, at, body.label.strip(), body.kcal, lo, hi, body.protein_g,
                       "manual", body.share_frac, body.venue)
    return dict(id=mid, **_day_payload(day))


@app.delete("/api/meals/{meal_id}")
def delete_meal(meal_id: int):
    row = conn.execute("SELECT day FROM meals WHERE id=?", (meal_id,)).fetchone()
    if not row:
        raise HTTPException(404)
    conn.execute("DELETE FROM meals WHERE id=?", (meal_id,))
    conn.commit()
    return _day_payload(row["day"])


@app.post("/api/workouts")
def add_workout(body: WorkoutIn):
    day, at = _at(body.at)
    conn.execute("INSERT INTO workouts(day,at,kind,detail,source) VALUES(?,?,?,?,'manual')",
                 (day, at, body.kind, body.detail))
    conn.commit()
    return _day_payload(day)


@app.delete("/api/workouts/{wid}")
def delete_workout(wid: int):
    row = conn.execute("SELECT day FROM workouts WHERE id=?", (wid,)).fetchone()
    if not row:
        raise HTTPException(404)
    conn.execute("DELETE FROM workouts WHERE id=?", (wid,))
    conn.commit()
    return _day_payload(row["day"])


@app.post("/api/body")
def add_body(body: BodyIn):
    day, at = _at(body.at)
    conn.execute("INSERT INTO body(day,at,weight_kg,bodyfat_pct,source) VALUES(?,?,?,?,'manual')",
                 (day, at, body.weight_kg, body.bodyfat_pct))
    conn.commit()
    engine.recompute(conn)
    return _day_payload(day)


@app.get("/api/trend")
def get_trend(days: int = 90):
    start = (now().date() - timedelta(days=days)).isoformat()
    points = [dict(day=p.day, weight=p.weight, trend=p.trend, bodyfat=p.bodyfat,
                   creatine=p.creatine_window)
              for p in engine.weight_trend(conn, start)]
    intake = engine.daily_intake(conn, start, today())
    history = [dict(r) for r in conn.execute(
        "SELECT as_of,tdee,tdee_lo,tdee_hi,target,confidence,days_with_intake,intake_avg,note "
        "FROM expenditure WHERE as_of>=? ORDER BY as_of", (start,))]
    s = db.all_settings(conn)
    return dict(points=points, intake=intake, history=history,
                current=engine.current_target(conn),
                weight_lo=float(s["weight_lo_kg"]), weight_hi=float(s["weight_hi_kg"]),
                creatine_window=[c.isoformat() for c in engine.creatine_window(conn) or []])


@app.post("/api/engine/recompute")
def recompute():
    return engine.to_dict(engine.recompute(conn))


@app.post("/api/ingest/renpho")
def ingest_renpho():
    stats = renpho.pull(conn)
    if stats.get("ok"):
        engine.recompute(conn)
    return stats


@app.get("/api/settings")
def get_settings():
    return db.all_settings(conn)


@app.put("/api/settings")
def put_settings(body: SettingsIn):
    for k, v in body.values.items():
        db.set_setting(conn, k, v)
    return db.all_settings(conn)


app.mount("/static", StaticFiles(directory=STATIC), name="static")

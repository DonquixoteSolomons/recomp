"""Seed the database from the claude.ai chat export.

The 27-day log lived in two chats. Each of your messages is a meal, a
workout, or a question. Meals are valued the same way the app values them
going forward: matched against the quick-add library, or computed exactly
for shakes. Where neither applies, the reply's running-total table is used.
Anything else lands with zero kcal and needs_review=1 so it is visible but
does not pollute the trend.
"""
from __future__ import annotations

import json
import re
import sqlite3
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from recomp import foods

CHATS = {
    "Daily protein intake for muscle building and fat loss",
    "Current situation and past possessions",
}
SGT = ZoneInfo("Asia/Singapore")

# ---- what counts as a meal / workout in your own words
FOOD_WORDS = re.compile(
    r"\b(had|ate|eating|drank|drink|having|finished the day with|made|did \d+|"
    r"whey|shake|yakult|rokeby|egg|bread|toast|rice|mee|noodle|chicken|"
    r"burger|mcmuffin|tuna|yogurt|yoghurt|milk|mala|curry|kopi|teh|coffee|"
    r"americano|coconut|beer|pau|bak kut|ayam|nasi|porridge|omelet|"
    r"meatball|quesadilla|dumpling|pizza|steak|fries|sandwich|cheese)\b", re.I)
NOT_A_MEAL = re.compile(
    r"\?\s*$|^\s*(how|what|is|should|can|does|do|where|which|why|am i|isnt|what if|how much would)\b"
    r"|planning to|plan to|if i (was|were)|would (it|that|they)|can i go get|dont you", re.I | re.S)
WORKOUT = [
    (re.compile(r"\bswim", re.I), "swim"),
    (re.compile(r"perform\s*(upper|lower)|revl\s*perform", re.I), "revl_perform"),
    (re.compile(r"calf|calves", re.I), "lift"),
    (re.compile(r"move\s*(total|session|sprint|spring)|revl\s*move", re.I), "revl_move"),
    (re.compile(r"sweat|sprint", re.I), "revl_sweat"),
    (re.compile(r"(ran|run|running).{0,40}vest|vest.{0,40}(ran|run)", re.I), "run_vest"),
    (re.compile(r"\b(ran|run)\b", re.I), "run"),
    (re.compile(r"3rm|back squat|deadlift|bench", re.I), "lift"),
]
REVL_GENERIC = re.compile(r"\brevl\b|\bsession\b", re.I)

# ---- your fixed foods, in the words you use for them
QUICK_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"(half|soft)\s*boil.*kaya|kaya.*(half|soft)\s*boil", re.I | re.S), "kaya_set"),
    (re.compile(r"4\s*(half|soft)?\s*boil\w*\s*eggs?.{0,40}(2|two)\s*(white\s*)?bread", re.I), "eggs4_bread2"),
    (re.compile(r"omelet\w*.{0,20}(3|three)\s*eggs?|3\s*eggs?.{0,20}omelet", re.I), "omelette3"),
    (re.compile(r"omelet\w*.{0,20}(4|four)\s*eggs?|4\s*eggs?.{0,20}omelet", re.I), "omelette4"),
    (re.compile(r"tuna.{0,30}cheese.{0,30}bread", re.I), "tuna_cheese"),
    (re.compile(r"chicken rice.{0,30}(extra|\$8)|(\$8|extra).{0,30}chicken rice", re.I), "cr925_extra"),
    (re.compile(r"chicken rice", re.I), "cr925_reg"),
    (re.compile(r"double cheeseburger|double cheese burger", re.I), "mcd_dcb"),
    (re.compile(r"sausage mcmuffin", re.I), "mcd_smm"),
    (re.compile(r"chicken (mc)?muffin", re.I), "mcd_cmm"),
    (re.compile(r"big breakfast", re.I), "mcd_bigbrk"),
    (re.compile(r"cheesy tuna bread|tuna bread", re.I), "tuna_bread"),
    (re.compile(r"americano", re.I), "americano"),
    (re.compile(r"coconut (water|drink)", re.I), "coconut"),
    (re.compile(r"teh o peng", re.I), "teh_o_peng"),
    (re.compile(r"teh peng", re.I), "teh_peng"),
]
YAKULT = re.compile(r"(\d+|two|three)?\s*yakults?", re.I)
COKE = re.compile(r"(\d{3})\s*ml\s*(?:of\s*)?coke|coke", re.I)
KOPI = re.compile(r"kopi o peng", re.I)
PAU = re.compile(r"(\d+|one|two|three)\s*char siew pau", re.I)
GREEK = re.compile(r"(\d{2,3})\s*g(?:ram)?s?\s*(?:of\s*)?(greek\s*)?yo(?:g|gh)urt", re.I)
SHAKE_WHEY = re.compile(r"(\d{2,3})\s*g(?:ram)?s?\s*(?:of\s*)?whey", re.I)
SHAKE_MILK = re.compile(r"(\d{2,3})\s*(?:ml|g)\s*(?:of\s*)?(?:meiji|marigold|fit)?\s*milk|(?:meiji|marigold|fit)?\s*milk\s*(\d{2,3})\s*(?:ml|g)", re.I)
SHAKE_CREATINE = re.compile(r"(\d)\s*g(?:ram)?s?\s*(?:of\s*)?creat", re.I)
ROKEBY = re.compile(r"rokeby\s*(\d{2})\s*g", re.I)
WORDNUM = {"one": 1, "two": 2, "three": 3}

# ---- the assistant's running-total table, as a fallback
ROW = re.compile(
    r"^\|\s*(?P<label>[^|]+?)\s*\|\s*\**~?(?P<p>\d+(?:\.\d+)?)\s*g?\**\s*\|\s*\**~?(?P<k>[\d,]+)\s*kcal",
    re.I | re.M)
RUNNING = re.compile(r"running|previous|so far|before", re.I)
NEWTOTAL = re.compile(r"new total|corrected total|updated total|^total$|day total", re.I)
RECAP_KCAL = 1500


def _text(m: dict) -> str:
    t = m.get("text") or ""
    if not t:
        t = "\n".join(c.get("text", "") for c in (m.get("content") or [])
                      if isinstance(c, dict) and c.get("type") == "text")
    return t.strip()


def _answer_part(t: str) -> str:
    """Exports glue the model's reasoning onto the reply; keep the reply."""
    parts = re.split(r"(?<=[.!?)])—(?=[A-Z*|#])", t)
    return parts[-1] if len(parts) > 1 else t


def load_messages(path: Path) -> list[dict]:
    """Accept the export zip or the extracted conversations.json."""
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.endswith("conversations.json"))
            data = json.loads(z.read(name).decode("utf-8"))
    else:
        data = json.loads(path.read_text(encoding="utf-8"))
    msgs = []
    for c in data:
        if (c.get("name") or "").strip() not in CHATS:
            continue
        for m in c.get("chat_messages", []):
            msgs.append(dict(at=m.get("created_at") or "", who=m.get("sender"), text=_text(m)))
    msgs.sort(key=lambda m: m["at"])
    return msgs


def _local(ts: str) -> datetime:
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return dt.astimezone(SGT)


def _num(s: str) -> float:
    return float(s.replace(",", ""))


# ------------------------------------------------------------------ valuing
def value_from_text(conn: sqlite3.Connection, text: str) -> tuple[float, float, float, float, str] | None:
    """(protein, kcal, lo, hi, method) from your own words, or None."""
    protein = kcal = lo = hi = 0.0
    hits: list[str] = []

    if m := SHAKE_WHEY.search(text):
        whey = float(m.group(1))
        mm = SHAKE_MILK.search(text)
        milk = float(mm.group(1) or mm.group(2)) if mm else 0.0
        cm = SHAKE_CREATINE.search(text)
        s = foods.shake(conn, whey, milk, None, float(cm.group(1)) if cm else 0.0)
        protein += s["protein_g"]; kcal += s["kcal"]; lo += s["kcal_lo"]; hi += s["kcal_hi"]
        hits.append("shake")
    for m in ROKEBY.finditer(text):
        g = float(m.group(1))                       # Rokeby protein milk: ~9.5 kcal per g protein
        protein += g; kcal += g * 9.5; lo += g * 9; hi += g * 10
        hits.append("rokeby")

    matched_kaya = False
    for rx, qid in QUICK_PATTERNS:
        if rx.search(text):
            q = foods.QUICK_BY_ID[qid]
            protein += q["protein"]; kcal += q["kcal"]; lo += q["lo"]; hi += q["hi"]
            hits.append(qid)
            matched_kaya = matched_kaya or qid == "kaya_set"
            if qid in ("cr925_extra",):
                break
    if m := YAKULT.search(text):
        n = WORDNUM.get((m.group(1) or "").lower(), None) or (int(m.group(1)) if (m.group(1) or "").isdigit() else 1)
        q = foods.QUICK_BY_ID["yakult"]
        protein += n * q["protein"]; kcal += n * q["kcal"]; lo += n * q["lo"]; hi += n * q["hi"]
        hits.append(f"yakult x{n}" if n > 1 else "yakult")
    if m := COKE.search(text):
        ml = float(m.group(1)) if m.group(1) else 330.0
        q = foods.QUICK_BY_ID["coke"]; f = ml / 500
        kcal += f * q["kcal"]; lo += f * q["lo"]; hi += f * q["hi"]; hits.append(f"coke {ml:g}ml")
    if KOPI.search(text) and not matched_kaya:
        q = foods.QUICK_BY_ID["kopi_o_peng"]
        protein += q["protein"]; kcal += q["kcal"]; lo += q["lo"]; hi += q["hi"]; hits.append("kopi")
    if m := PAU.search(text):
        n = WORDNUM.get(m.group(1).lower(), None) or int(m.group(1))
        q = foods.QUICK_BY_ID["csp_pau"]
        protein += n * q["protein"]; kcal += n * q["kcal"]; lo += n * q["lo"]; hi += n * q["hi"]
        hits.append(f"pau x{n}")
    if m := GREEK.search(text):
        g = float(m.group(1)); f = g / 125
        q = foods.QUICK_BY_ID["greek125"]
        protein += f * q["protein"]; kcal += f * q["kcal"]; lo += f * q["lo"]; hi += f * q["hi"]
        hits.append(f"greek {g:g}g")

    if not hits:
        return None
    return round(protein, 1), round(kcal), round(lo), round(hi), "+".join(hits)


def value_from_reply(reply: str) -> tuple[float, float, float, float, str] | None:
    """Delta between the running-total and new-total rows of the reply's table."""
    ans = _answer_part(reply)
    running = new = None
    for m in ROW.finditer(ans):
        label = m.group("label").strip(" *")
        p, k = _num(m.group("p")), _num(m.group("k"))
        if RUNNING.search(label):
            running = (p, k)
        elif NEWTOTAL.search(label):
            new = (p, k)
    if running and new and 0 <= new[1] - running[1] < RECAP_KCAL and new[0] >= running[0]:
        k = new[1] - running[1]
        return new[0] - running[0], k, round(k * 0.8), round(k * 1.2), "reply-delta"
    return None


# ------------------------------------------------------------------ parse
def parse(conn: sqlite3.Connection, msgs: list[dict], until: str | None = None) -> tuple[list[dict], list[dict]]:
    """`until` (YYYY-MM-DD, inclusive) stops the import before days you logged in the app."""
    meals: list[dict] = []
    workouts: list[dict] = []
    seen_w: set[tuple[str, str]] = set()
    for i, m in enumerate(msgs):
        if m["who"] != "human" or not m["text"]:
            continue
        text = m["text"]
        local = _local(m["at"])
        day, at = local.date().isoformat(), local.isoformat(timespec="minutes")
        if until and day > until:
            continue

        # workouts (a message can carry both a workout and a meal)
        kind = None
        for rx, k in WORKOUT:
            if rx.search(text):
                kind = k
                break
        if kind is None and REVL_GENERIC.search(text) and not NOT_A_MEAL.search(text):
            kind = "revl_move"
        if kind and (day, kind) not in seen_w:
            seen_w.add((day, kind))
            detail = "white scale" if re.search(r"white scale", text, re.I) else None
            if kind == "lift" and re.search(r"calf|calves", text, re.I):
                detail = "calves, weighted vest"
            if kind == "revl_perform":
                m2 = re.search(r"perform\s*(upper|lower)", text, re.I)
                detail = m2.group(1).lower() if m2 else None
            if kind == "swim":
                m2 = re.search(r"(\d+)\s*min", text, re.I)
                detail = f"{m2.group(1)} min" if m2 else None
            if kind == "run_vest":
                km = re.search(r"(\d(?:\.\d)?)\s*km", text)
                detail = (f"{km.group(1)}km " if km else "") + "10kg vest"
            workouts.append(dict(day=day, at=at, kind=kind, detail=detail))

        # meals
        if NOT_A_MEAL.search(text) or not FOOD_WORDS.search(text):
            continue
        got = value_from_text(conn, text)
        if got is None:
            reply = msgs[i + 1]["text"] if i + 1 < len(msgs) and msgs[i + 1]["who"] == "assistant" else ""
            got = value_from_reply(reply)
        protein, kcal, lo, hi, method = got if got else (0.0, 0.0, 0.0, 0.0, "none")
        label = re.sub(r"\s+", " ", text)
        label = re.sub(r"^(its a new day\.?|new day\.?|a new day\.?|this is a new day\.?)\s*", "", label, flags=re.I).strip()
        meals.append(dict(day=day, at=at, label=label[:90] or text[:90], kcal=kcal, lo=lo, hi=hi,
                          protein=protein, method=method, raw=text, found=got is not None))
    return meals, workouts


def write(conn: sqlite3.Connection, meals: list[dict], workouts: list[dict]) -> dict:
    conn.execute("DELETE FROM meals WHERE source='backfill'")
    conn.execute("DELETE FROM workouts WHERE source='backfill'")
    for m in meals:
        conn.execute(
            "INSERT INTO meals(day,at,label,kcal,kcal_lo,kcal_hi,protein_g,source,detail,needs_review) "
            "VALUES(?,?,?,?,?,?,?,'backfill',?,?)",
            (m["day"], m["at"], m["label"], m["kcal"], m["lo"], m["hi"], m["protein"],
             json.dumps(dict(raw=m["raw"], method=m["method"]), ensure_ascii=False),
             0 if m["method"] not in ("none", "reply-delta") else 1))
    for w in workouts:
        conn.execute("INSERT INTO workouts(day,at,kind,detail,source) VALUES(?,?,?,?,'backfill')",
                     (w["day"], w["at"], w["kind"], w["detail"]))
    conn.commit()
    return dict(meals=len(meals), meals_unvalued=sum(1 for m in meals if not m["found"]),
                workouts=len(workouts))

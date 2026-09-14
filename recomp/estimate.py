"""Photo and/or text -> protein and calories, via Claude with vision.

This replaces the "send a photo to the chat and hope" step. One structured
call per estimate; the model is told to think like a Singapore dietitian,
to classify the dish before it estimates, to prefer HPB reference values
for local food, to search the web when a venue is named, and to return an
honest range rather than a single confident number.

Every estimate is stored in full (`estimates` table) so it can be
re-checked, refined, and later calibrated against the weight trend.
"""
from __future__ import annotations

import base64
import io
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from recomp import db, env

SGT = ZoneInfo("Asia/Singapore")
ROOT = Path(__file__).resolve().parent.parent
PHOTO_DIR = ROOT / "data" / "photos"
MAX_EDGE = 1568                 # Claude's vision sweet spot; larger costs tokens, not accuracy
MAX_CONTINUATIONS = 3

# Reference values the model is anchored on. Typical Singapore hawker
# portions, approximate, in the same range as HPB's published figures.
# The model is told to treat these as anchors, not answers.
REFERENCE = """
dish | typical portion | kcal | protein g
Hainanese chicken rice (roasted or steamed), regular plate | 1 plate | 600-700 | 30-35
Chicken rice with extra chicken | 1 plate | 800-950 | 45-55
Char kway teow | 1 plate | 700-780 | 20-25
Fried carrot cake (black) | 1 plate | 450-500 | 10-12
Hokkien mee | 1 plate | 600-650 | 25-30
Laksa | 1 bowl | 550-620 | 20-25
Mee siam | 1 plate | 500-560 | 15-20
Mee rebus | 1 plate | 550-600 | 18-22
Wanton mee, dry, regular | 1 plate | 400-450 | 18-22
Lor mee | 1 bowl | 550-620 | 18-22
Bak chor mee, dry | 1 bowl | 500-560 | 22-26
Fishball noodle soup | 1 bowl | 350-400 | 18-22
Prawn mee soup | 1 bowl | 300-350 | 20-25
Bak kut teh (soup with ribs), no rice | 1 bowl | 300-350 | 25-30
Nasi lemak with fried chicken wing and egg | 1 plate | 600-700 | 22-28
Ayam penyet with rice | 1 plate | 750-850 | 35-45
Nasi padang, rice + 1 meat + 2 veg | 1 plate | 650-800 | 25-35
Chicken cutlet rice (western stall) | 1 plate | 750-850 | 35-40
Economy rice, rice + 1 meat + 2 veg | 1 plate | 550-700 | 20-30
Roti prata, plain | 1 piece | 200-230 | 5
Thosai, plain | 1 piece | 120-150 | 3
Kaya butter toast set (2 slices, 2 half-boiled eggs, kopi) | 1 set | 450-560 | 18-20
Half-boiled egg | 1 egg | 70-75 | 6
Kopi o (black with sugar) | 1 cup | 60-100 | 0
Kopi (with condensed milk) | 1 cup | 120-150 | 2-3
Teh (with condensed milk) | 1 cup | 130-160 | 3
Satay, chicken/mutton, with sauce | 1 stick | 45-60 | 4-5
BBQ chicken wing (hawker) | 1 wing | 130-170 | 9-12
Char siew pau | 1 piece | 190-250 | 6-8
Curry puff (Old Chang Kee style) | 1 piece | 200-250 | 4-5
Chwee kueh | 1 piece | 50-70 | 1
Mala xiang guo (dry mala), typical individual portion | 1 portion | 700-1100 | 25-45
Yong tau foo, 6 pieces, soup, no noodles | 1 bowl | 250-350 | 18-25
McDonald's SG double cheeseburger | 1 | 430-470 | 25
McDonald's SG sausage McMuffin with egg | 1 | 360-400 | 19
McDonald's SG double quarter pounder | 1 | 740-800 | 45
Coke, regular | 500 ml | 210 | 0
Yakult | 1 bottle | 50 | 0.8
""".strip()

SYSTEM = f"""You estimate protein and calories for one person's meals in Singapore.

Method, in order:
1. Identify the dish and each visible component (rice, protein, sauce, vegetables, drink). Singapore hawker food hides calories in oil, gravy, coconut milk and sugar; count them.
2. Estimate the portion from plate/bowl size and typical hawker serving norms. Standard hawker plates are ~25 cm, bowls ~15-17 cm.
3. Anchor on the reference table below and on Singapore HPB Food Insights Database values for local dishes. If a venue or brand is named, use web search to find its actual menu or nutrition information, and say what you found.
4. If the person says they shared the dish, ate part of it, or skipped a component, estimate ONLY what they ate.
5. Give a point estimate and an honest range. Say what you assumed and what one detail would tighten the range most.

Reference values (typical Singapore portions, approximate):
{REFERENCE}

Rules:
- Never invent precision. A plate of mixed food is +/-20% at best; say so with the range.
- Weights stated by the person (e.g. "239 g rice") override your visual estimate.
- Protein matters most to this person; be especially careful with it.
- Return only the structured result.
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "dish": {"type": "string", "description": "Short name for what was eaten"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "portion": {"type": "string", "description": "e.g. '1 plate, ~250 g rice', '5 wings'"},
                    "protein_g": {"type": "number"},
                    "kcal": {"type": "number"},
                    "kcal_lo": {"type": "number"},
                    "kcal_hi": {"type": "number"},
                    "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
                },
                "required": ["name", "portion", "protein_g", "kcal", "kcal_lo", "kcal_hi", "confidence"],
                "additionalProperties": False,
            },
        },
        "protein_g": {"type": "number", "description": "Total protein for what was eaten"},
        "kcal": {"type": "number"},
        "kcal_lo": {"type": "number"},
        "kcal_hi": {"type": "number"},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "grounding": {"type": "array", "items": {"type": "string"},
                      "description": "What the numbers are based on: HPB value, venue menu found by search, label, visual estimate"},
        "tighten": {"type": "string", "description": "The one detail that would narrow the range most"},
    },
    "required": ["dish", "items", "protein_g", "kcal", "kcal_lo", "kcal_hi", "confidence",
                 "assumptions", "grounding", "tighten"],
    "additionalProperties": False,
}

WEB_SEARCH = {
    "type": "web_search_20260209", "name": "web_search", "max_uses": 3,
    "user_location": {"type": "approximate", "city": "Singapore", "country": "SG",
                      "timezone": "Asia/Singapore"},
}


# ------------------------------------------------------------------ images
def prepare_image(raw: bytes) -> tuple[bytes, str]:
    """Downscale to MAX_EDGE and re-encode as JPEG. Returns (bytes, media_type)."""
    from PIL import Image, ImageOps
    im = Image.open(io.BytesIO(raw))
    im = ImageOps.exif_transpose(im)            # phones store rotation in EXIF
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    w, h = im.size
    scale = MAX_EDGE / max(w, h)
    if scale < 1:
        im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "JPEG", quality=85, optimize=True)
    return out.getvalue(), "image/jpeg"


def save_photo(data: bytes, when: datetime) -> str:
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    name = when.strftime("%Y%m%d-%H%M%S-%f") + ".jpg"
    (PHOTO_DIR / name).write_bytes(data)
    return name


# ------------------------------------------------------------------ call
def _client():
    env.load()
    import os
    import anthropic
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        raise RuntimeError("ANTHROPIC_API_KEY is not set. Put it in .env (see .env.example) and restart start.bat.")
    return anthropic.Anthropic()


def _final_text(response) -> str:
    return next((b.text for b in response.content if b.type == "text"), "")


def estimate(conn: sqlite3.Connection, photos: list[bytes], text: str = "",
             share_frac: float = 1.0, parent_id: int | None = None) -> dict:
    """Run one estimate and store it. Returns the stored row as a dict.

    photos: raw uploaded bytes (any format). text: what the person said.
    parent_id: refine an earlier estimate with a correction.
    """
    import anthropic

    model = db.get_setting(conn, "estimate_model", "claude-opus-5")
    effort = db.get_setting(conn, "estimate_effort", "high")
    use_search = db.get_setting(conn, "estimate_web_search", "1") == "1"
    now = datetime.now(SGT)

    content: list[dict] = []
    saved: list[str] = []
    for raw in photos:
        data, mt = prepare_image(raw)
        saved.append(save_photo(data, now))
        content.append({"type": "image", "source": {"type": "base64", "media_type": mt,
                                                     "data": base64.standard_b64encode(data).decode()}})

    parent = None
    if parent_id:
        parent = conn.execute("SELECT * FROM estimates WHERE id=?", (parent_id,)).fetchone()
        if parent and not photos and parent["photos"]:
            # re-attach the original photos so the correction is judged against them
            for name in json.loads(parent["photos"]):
                p = PHOTO_DIR / name
                if p.exists():
                    content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                                 "data": base64.standard_b64encode(p.read_bytes()).decode()}})
            saved = json.loads(parent["photos"])

    prompt = []
    if parent:
        prompt.append("Earlier estimate for this same meal:\n" + parent["result"])
        prompt.append("Correction from the person: " + (text or "(none)"))
        prompt.append("Re-estimate taking the correction into account.")
    else:
        prompt.append("What I ate: " + (text.strip() or "(see photo)"))
    if share_frac < 1:
        prompt.append(f"I ate {share_frac:.0%} of what is shown; estimate my share only.")
    prompt.append(f"Local time: {now.strftime('%a %H:%M')}.")
    content.append({"type": "text", "text": "\n\n".join(prompt)})

    client = _client()
    messages = [{"role": "user", "content": content}]
    kwargs = dict(
        model=model, max_tokens=8000,
        system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
        thinking={"type": "adaptive"},
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=messages,
    )
    if use_search:
        kwargs["tools"] = [WEB_SEARCH]

    response = client.messages.create(**kwargs)
    # server-side search loop can pause; resume by resending, never by adding a message
    for _ in range(MAX_CONTINUATIONS):
        if response.stop_reason != "pause_turn":
            break
        messages.append({"role": "assistant", "content": response.content})
        response = client.messages.create(**{**kwargs, "messages": messages})

    if response.stop_reason == "refusal":
        raise RuntimeError("The model declined this request"
                           + (f": {response.stop_details.explanation}" if response.stop_details else ""))
    if response.stop_reason == "max_tokens":
        raise RuntimeError("Response was cut off (max_tokens); try again")

    result = json.loads(_final_text(response))
    usage = dict(input=response.usage.input_tokens, output=response.usage.output_tokens,
                 cache_read=getattr(response.usage, "cache_read_input_tokens", 0) or 0,
                 cache_write=getattr(response.usage, "cache_creation_input_tokens", 0) or 0)

    cur = conn.execute(
        "INSERT INTO estimates(day,at,text,photos,share_frac,parent_id,model,result,usage) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (now.date().isoformat(), now.isoformat(timespec="minutes"), text or None,
         json.dumps(saved), share_frac, parent_id, model,
         json.dumps(result, ensure_ascii=False), json.dumps(usage)))
    conn.commit()
    return get(conn, cur.lastrowid)


def get(conn: sqlite3.Connection, est_id: int) -> dict:
    r = conn.execute("SELECT * FROM estimates WHERE id=?", (est_id,)).fetchone()
    if not r:
        raise KeyError(est_id)
    d = dict(r)
    d["result"] = json.loads(d["result"])
    d["photos"] = json.loads(d["photos"] or "[]")
    d["usage"] = json.loads(d["usage"] or "{}")
    return d


def cost_usd(usage: dict, model: str) -> float:
    """Rough spend for the receipt line in the UI. Rates per 1M tokens."""
    rates = {"claude-opus-5": (5.0, 25.0), "claude-sonnet-5": (2.0, 10.0),
             "claude-haiku-4-5": (1.0, 5.0)}.get(model, (5.0, 25.0))
    inp = usage.get("input", 0) + usage.get("cache_write", 0) * 1.25 + usage.get("cache_read", 0) * 0.1
    return round((inp * rates[0] + usage.get("output", 0) * rates[1]) / 1e6, 4)

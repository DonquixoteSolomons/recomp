"""Best-guess values for the chat rows the parser could not value, and the
rows that were never meals. Keyed by the SQLite row id in data/recomp.db.

    .venv/Scripts/python tools/chat_fixes.py           # apply to SQLite, write data-repo/chat_fixes.json

Sources: the assistant's photo identifications and item tables in the chat
export, sanity-checked against docs/js/foods.js reference portions. Ranges
are honest: mixed plates are +/-15-20%.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from recomp import db  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "data-repo" / "chat_fixes.json"

# id: (label, kcal, lo, hi, protein_g)
VALUES: dict[int, tuple[str, int, int, int, float]] = {
    2:   ("Rokeby protein smoothie 30g (2nd)", 287, 270, 300, 30),
    3:   ("2× Marigold Greek yoghurt", 244, 230, 260, 16.4),
    5:   ("Wanton mee, dry, half the noodles", 300, 260, 350, 17),
    7:   ("Kola curry (≈12 meatballs), rice, cabbage poriyal, salad", 1290, 1050, 1500, 63),
    12:  ("IKEA 16 meatballs, mash, veg, lingonberry", 984, 880, 1100, 42),
    13:  ("Farmers Union Greek yogurt 125g", 70, 60, 85, 10.5),
    15:  ("100PLUS + Greek yogurt 105g", 123, 110, 140, 8.7),
    17:  ("Luncheon meat (200g can) spicy filling + 4 white bread", 960, 850, 1100, 36),
    19:  ("Meiji High Protein Chocolate 350ml", 179, 175, 185, 30.1),
    20:  ("Wong Coco coconut juice 520ml", 125, 110, 140, 0.5),
    23:  ("Meiji High Protein Chocolate 350ml", 179, 175, 185, 30.1),
    24:  ("Omelette slice, green beans, chicken cutlet, rice, curry", 955, 820, 1100, 50),
    26:  ("Meiji High Protein Chocolate 350ml (2nd)", 179, 175, 185, 30.1),
    28:  ("Nomzy egg mayo sandwich + coconut water", 384, 340, 430, 11),
    31:  ("Meiji High Protein Chocolate 350ml", 179, 175, 185, 30.1),
    32:  ("Mee siam with fried chicken (≈5 pieces)", 884, 750, 1000, 51),
    33:  ("2 more fried chicken pieces", 200, 170, 240, 16),
    34:  ("Yakult", 50, 45, 55, 0.8),
    40:  ("Meiji High Protein Chocolate + coconut water", 238, 230, 250, 30.1),
    41:  ("Lor mee (half noodles, half broth, ½ egg) + chicken cutlet", 542, 470, 640, 37.3),
    49:  ("Thai basil minced meat rice + fried egg", 574, 520, 680, 34),
    50:  ("Meiji High Protein Chocolate 350ml", 179, 175, 185, 30.1),
    51:  ("4 boiled eggs + 3 toasted white bread + americano", 530, 480, 600, 32),
    57:  ("GYG spicy grilled chicken Quesadilla Plus + handful of fries", 682, 620, 760, 33.7),
    58:  ("McDonald's Double Smoky Beef meal (L seaweed fries, iced Milo)", 1170, 1050, 1300, 36),
    61:  ("Porridge, ikan bilis sambal, tofu, 1 salted egg", 580, 480, 680, 34),
    63:  ("Dried chilli chicken rice + sunny side up", 815, 720, 920, 41),
    65:  ("Wok Hey Shanghai fried rice, chicken + Chinese sausage", 700, 620, 800, 34),
    66:  ("Shake: 34g whey, 152ml Marigold", 230, 220, 240, 31.4),
    68:  ("Mala dry, half of $31 (Monster Chilli) + rice", 775, 650, 1000, 31),
    75:  ("Home nasi lemak: 5 fish, 4 chicken, omelette, ikan bilis sambal", 1535, 1300, 1750, 104),
    79:  ("Coconut water 330ml", 59, 50, 70, 0),
    80:  ("Popcorn chicken ×11 + garlic chilli sauce", 297, 270, 330, 15.4),
    81:  ("Chobani 15g protein Greek yogurt", 93, 90, 100, 15.5),
    83:  ("Luckin dark roast americano", 5, 0, 10, 0),
    85:  ("Salted fish fried rice + egg + coconut water 500ml", 730, 640, 830, 32),
    90:  ("Steak & eggs, pint of Sapporo Black, ½ cheese pizza slice, fries", 1170, 1050, 1300, 84),
    91:  ("Whale Tea fresh mango tea, less sugar", 130, 100, 170, 0.5),
    93:  ("Roasted Delights: char siew + roast pork (60% share), egg, rice, veg, lime juice", 877, 780, 1000, 31),
    97:  ("Arla protein pudding + Cheers triple deck sandwich", 484, 450, 520, 38.4),
    101: ("Mala, half of shared pool + 3 luncheon meat", 905, 780, 1050, 41),
    102: ("Yumi's roasted garlic hummus + Torres jamon chips (half)", 380, 260, 500, 7),
    103: ("Lean Body chocolate protein shake 500ml", 270, 265, 275, 40),
    106: ("239g rice + tau pok, cuttlefish sambal, 4 tempeh, soup (276g)", 857, 760, 960, 39.9),
    107: ("Ayam penyet set + Lean Body shake + Yakult jasmine tea + 2 Curry'O", 1592, 1400, 1800, 86.5),
    108: ("Greek yogurt 250g with walnuts and honey", 285, 240, 340, 23),
    112: ("2 plates home mee goreng with nuggets + hotdogs", 2220, 1900, 2500, 84),
    114: ("llaollao with chocolate sauce + watermelon", 378, 320, 440, 8.9),
    116: ("McDonald's Double Filet-O-Fish + coconut water", 640, 590, 700, 26),
    119: ("Seafood hotplate, sambal stingray, french beans (half) + rice", 1012, 880, 1150, 50.5),
    120: ("Mee rebus + Luckin black + Encik Tan cutlet rice, extra cutlet", 1605, 1400, 1800, 75),
    123: ("Red Bull Yellow Edition", 120, 115, 125, 0),
    124: ("Song Fa bak kut teh lunch set: ribs, peanuts, you tiao, rice", 841, 720, 950, 49),
    127: ("Arla protein pudding + Treats roasted chicken sandwich + Pokka green tea", 473, 440, 520, 40.6),
    128: ("Mala, quarter of $86 (beef, luncheon meat) + rice", 1048, 850, 1250, 51),
    130: ("Chive & pork dumplings ×10 set, sauces, broccoli, barley", 930, 800, 1050, 35),
    132: ("Chicken cutlet fried rice", 750, 650, 850, 32),
    133: ("Ayam penyet, no rice + Coke can", 509, 450, 580, 30.5),
    137: ("McDonald's Double Quarter Pounder meal (L seaweed fries, lemon tea)", 1340, 1250, 1450, 56),
    140: ("5 BBQ chicken wings + 7 satay with sauce", 1100, 950, 1250, 80),
    142: ("Ayam merah, sambal goreng, bagedil, rice + gravy, kopi o peng", 900, 780, 1020, 36),
    144: ("Ayam Brand chilli tuna (can) + 4 white bread + 2 cheese", 700, 620, 780, 44),
    145: ("Arla protein hazelnut latte pudding", 146, 140, 150, 20),
    149: ("Mala, half of shared pool + 2 luncheon meat + ¾ rice", 910, 780, 1050, 39),
    151: ("Amigos (Gangsa Rd) grilled lamb chop with spaghetti", 1200, 1000, 1400, 60),
    152: ("French toast 4½ slices (share of 4-egg batter) + 4 bacon + coffee with milk", 800, 700, 900, 31),
}

# Rows logged in the chat AFTER the seed export (Sep 14 evening -> Sep 17). Added, not fixed.
# Shakes are exact from the tub/carton constants (0.78 g protein & 3.9 kcal per g whey;
# Meiji full cream 3.2 g & 64 kcal per 100 ml). Values with a displayed-calorie source say so.
# (day, HH:MM, label, kcal, lo, hi, protein_g, raw)
ADDS: list[tuple[str, str, str, int, int, int, float, str]] = [
    ("2026-09-14", "18:07", "Shake: 65g whey, 303ml Meiji", 448, 430, 465, 60.4, "Had a shake of 303ml meiji milk, 65g whey and 6g creatine."),
    ("2026-09-14", "22:22", "Salted fish fried rice + Cheers triple deck sandwich", 938, 820, 1050, 38.0, "Had salted fish fried rice and the sandwich"),
    ("2026-09-14", "22:56", "Arla protein hazelnut latte pudding", 146, 140, 150, 20.0, "Had this as well"),
    ("2026-09-15", "13:30", "Sakura Thai: rice, omelette slice, salted egg chicken, bagedil", 880, 780, 1000, 38.5, "New day. Had rice with a triangle omelette slice, salted egg chicken and bagadel from sakura thai, a malay/indo fusion shop near changi city point"),
    ("2026-09-15", "17:50", "Luckin americano + Ultrabakes egg & ham sandwich + teh o peng", 565, 500, 640, 24.0, "Had a dark roast americano from luckin and this egg and ham sandwich from ultrabakes from chang city point along with a teh o peng."),
    ("2026-09-15", "19:33", "Shake: 70g whey, 313ml Meiji", 473, 455, 490, 64.6, "Went for a revl move sprint session and had a shake of 313ml meiji milk and 70g whey and 8g creatine."),
    ("2026-09-15", "20:14", "Rice 122g, fish sambal 182g, sothi with 2 tahu 111g", 692, 620, 780, 40.5, "172g of ricel, 182g of fish sambal, 111g of gravy(sothi) with 2 tahu. (didn't eat 50g of the rice)"),
    ("2026-09-16", "14:18", "Kaya toast set", 500, 450, 560, 19.0, "New day. Had 2 half boiled eggs with white pepper snd soy sauce, 2 white bread toast(kaya and butter), and kopi o peng."),
    ("2026-09-16", "14:26", "Luncheon meat 137g, spiced (oily) + 2 white bread", 620, 540, 720, 24.0, "Had 137g of canned luncheon meat with onion garlic and indian spices, curry leaves as well. Was on the oilier side. Had it with 2 white bread."),
    ("2026-09-16", "15:53", "Shake: 72g whey, 252ml Meiji", 442, 425, 460, 64.3, "Had a shake of 252ml meiji milk 72g whey and 6g creatine."),
    ("2026-09-16", "20:54", "Basil chicken rice with egg (343 displayed) + half mango sticky rice (221/2)", 453, 430, 480, 28.0, "Went for a revl move session. Also had these 2 only had half of the mango sticky rice. The shop had the calories displayed 343 calories for the basil chicken rice with egg and 221 calories for the mango sticky rice"),
    ("2026-09-16", "23:30", "Arla protein hazelnut latte pudding", 146, 140, 150, 20.0, "Had this"),   # typed 09-17 14:14 before "New day"
    ("2026-09-17", "14:16", "Kaya toast set", 500, 450, 560, 19.0, "New day. Had 2 half boiled eggs with white pepper snd soy sauce, 2 white bread toast(kaya and butter), and kopi o peng."),
    ("2026-09-17", "14:20", "Rice 180g, 2 eggs in curry 205g, fried tahu 53g", 610, 540, 690, 28.1, "180g of rice, 205g of 2eggs and curry, 53g fried tahu."),
]
# (day, HH:MM, kind, detail)
WORKOUT_ADDS: list[tuple[str, str, str, str | None]] = [
    ("2026-09-15", "19:33", "revl_move", "sprint"),
    ("2026-09-16", "20:54", "revl_move", None),
]

# ---------------------------------------------------------------- v3: audit against the original messages
# id: fields to change. day/at present = the row moves (typed before "New day" = previous evening).
EDITS: dict[int, dict] = {
    1:   dict(label="McD breakfast wrap sausage meal + chicken muffin + Rokeby 30g + 3 boiled eggs & 4 bread egg mayo", kcal=1696, kcal_lo=1550, kcal_hi=1850, protein_g=98),
    11:  dict(label="McD breakfast wrap sausage meal ($8.15) + chicken muffin", kcal=879, kcal_lo=820, kcal_hi=940, protein_g=38),
    29:  dict(label="925 chicken rice ($8) + egg + teh peng less sweet + 10 cashews", kcal=1145, kcal_lo=1000, kcal_hi=1300, protein_g=57),
    55:  dict(label="McD double cheeseburger + Chicken Samurai burger", kcal=990, kcal_lo=920, kcal_hi=1060, protein_g=50),
    56:  dict(label="Tuna + 2 cheese + 4 bread + Shake: 34g whey, 257ml Fit milk", kcal=937, kcal_lo=850, kcal_hi=1030, protein_g=80.7),
    64:  dict(label="Shake: 59g whey, 160ml Fit milk + 95ml Marigold", kcal=380, kcal_lo=365, kcal_hi=395, protein_g=54.5),
    72:  dict(label="Cheesy tuna bread + ice lemon tea", kcal=440, kcal_lo=390, kcal_hi=500, protein_g=12),
    78:  dict(label="Shake: 45g whey, 255ml milk", kcal=339, kcal_lo=325, kcal_hi=350, protein_g=43.3),
    79:  dict(label="Coconut water 330ml", kcal=59, kcal_lo=50, kcal_hi=70, protein_g=0),          # same-day "Had this as well" x2 had collided
    81:  dict(label="Chobani 15g protein Greek yogurt", kcal=93, kcal_lo=90, kcal_hi=100, protein_g=15.5),
    82:  dict(label="McD Big Breakfast + hash brown + iced Milo + Sausage McMuffin", kcal=1180, kcal_lo=1080, kcal_hi=1280, protein_g=44.5),
    96:  dict(label="Roasted chicken rice with egg + coconut water", kcal=785, kcal_lo=690, kcal_hi=880, protein_g=38),
    117: dict(label="Kaya set (butter-sugar toast, coffee w/ condensed milk) + Shake: 48g whey, 251ml", kcal=848, kcal_lo=780, kcal_hi=920, protein_g=62.5),
    123: dict(day="2026-09-06", at="2026-09-06T23:30+08:00"),                                          # Red Bull, typed 01:40 before "New day"
    129: dict(label="Shake: 60g whey, 261ml Meiji", kcal=401, kcal_lo=385, kcal_hi=415, protein_g=55.2),
    138: dict(label="Kaya toast set + Wok Hey $12.50 bowl", kcal=1200, kcal_lo=1050, kcal_hi=1350, protein_g=53),
    143: dict(label="Shake: 69g whey, 301ml Meiji", kcal=462, kcal_lo=445, kcal_hi=480, protein_g=63.4),
    146: dict(day="2026-09-12", at="2026-09-12T23:30+08:00"),                                          # 2 yakults, typed before "New day"
    164: dict(day="2026-09-16", at="2026-09-16T23:30+08:00"),                                          # hazelnut pudding, typed before "New day"
}
DELETE_V3: list[int] = [36, 45, 100, 86]
# Original day|HH:MM|raw of rows the laptop DB has already moved or deleted — the phone still has
# them at these positions, so the fix file must be keyed here regardless of local DB state.
ORIG_KEYS: dict[int, str] = {
    36:  "2026-08-20|10:27|Had 2 soft boil eggs, with white pepper and soy sauce. Kaya butter toast of 2 bread and kopi o peng. Its a new day.",
    45:  "2026-08-21|09:49|Had 2 half boiled eggs with white pepper and soy sauce. kaya butter toast bread, which is 2 white breads and one kopi o peng. Its a new day",
    100: "2026-09-01|11:41|253ml milk, 44g whey, 6g creatine. And the previous input started a new day.",
    86:  "2026-08-29|21:30|I had 35g of whey instead and a yakult",
    123: "2026-09-07|01:40|Had a red bull can as well, the golden one",
    146: "2026-09-13|13:26|Had 2 yakults",
    164: "2026-09-17|14:14|Had this",
}     # re-sent breakfasts (Aug 20, Aug 21, Sep 1) and a superseded shake (Aug 29 21:30)
# meals missed entirely
ADDS_V3: list[tuple[str, str, str, int, int, int, float, str]] = [
    ("2026-08-17", "14:30", "Rasam with rice, green beans, half chicken breast + wing", 660, 560, 780, 48.0, "What I am eating for lunch. Rasam with rice and green beans. And a chicken in the top photo. Half a chicken breast and 1 wing together."),
]
# workouts: (id, action, to_day, to_at). The Sep 9 and Sep 11 "calves" rows came from questions, not sessions.
WORKOUT_EDITS: list[tuple[int, str, str | None, str | None]] = [
    (21, "delete", None, None),
    (24, "delete", None, None),
    (25, "move", "2026-09-11", "2026-09-11T23:20+08:00"),
]

# rows that were questions, corrections or duplicates of the row above them
DELETE: list[int] = [10, 14, 16, 18, 30, 39, 43, 52, 60, 69, 76, 95, 105, 113]


def main() -> int:
    conn = db.get_conn()
    raw_of = lambda r: (json.loads(r["detail"]) if r["detail"] else {}).get("raw") or r["label"]  # noqa: E731
    key = lambda r: f"{r['day']}|{r['at'][11:16]}|{raw_of(r)}"  # noqa: E731
    fixes: dict[str, dict | str] = {}
    n_val = n_del = 0
    for rid, (label, kcal, lo, hi, protein) in VALUES.items():
        r = conn.execute("SELECT id, day, at, label, detail FROM meals WHERE id=? AND source LIKE 'backfill%'", (rid,)).fetchone()
        if not r:
            print(f"  ! row {rid} not found, skipped"); continue
        fixes[key(r)] = dict(label=label, kcal=kcal, kcal_lo=lo, kcal_hi=hi, protein_g=protein)
        conn.execute("UPDATE meals SET label=?, kcal=?, kcal_lo=?, kcal_hi=?, protein_g=?, source='backfill-est', needs_review=0 WHERE id=?",
                     (label, kcal, lo, hi, protein, rid))
        n_val += 1
    for rid in DELETE:
        r = conn.execute("SELECT id, day, at, label, detail FROM meals WHERE id=? AND source LIKE 'backfill%'", (rid,)).fetchone()
        if not r:
            continue
        fixes[key(r)] = "delete"
        conn.execute("DELETE FROM meals WHERE id=?", (rid,))
        n_del += 1
    # v3 edits: key by the row's original (day, time, raw) so the phone matches before it mutates
    wfix = []
    for rid, ch in EDITS.items():
        r = conn.execute("SELECT id, day, at, label, kcal, kcal_lo, kcal_hi, protein_g, detail FROM meals WHERE id=?", (rid,)).fetchone()
        if not r:
            print(f"  ! edit {rid} not found"); continue
        k = ORIG_KEYS.get(rid) or key(r)
        v = dict(label=ch.get("label", r["label"]), kcal=ch.get("kcal", r["kcal"]), kcal_lo=ch.get("kcal_lo", r["kcal_lo"]),
                 kcal_hi=ch.get("kcal_hi", r["kcal_hi"]), protein_g=ch.get("protein_g", r["protein_g"]))
        if "day" in ch: v["day"], v["at"] = ch["day"], ch["at"]
        fixes[k] = v
        conn.execute("UPDATE meals SET label=?, kcal=?, kcal_lo=?, kcal_hi=?, protein_g=?, day=?, at=?, source='backfill-est', needs_review=0 WHERE id=?",
                     (v["label"], v["kcal"], v["kcal_lo"], v["kcal_hi"], v["protein_g"], v.get("day", r["day"]), v.get("at", r["at"]), rid))
    for rid in DELETE_V3:
        fixes[ORIG_KEYS[rid]] = "delete"
        conn.execute("DELETE FROM meals WHERE id=?", (rid,))
    WORKOUT_ORIG = {21: ("2026-09-09", "2026-09-09T19:33+08:00", "lift"), 24: ("2026-09-11", "2026-09-11T19:35+08:00", "lift"), 25: ("2026-09-12", "2026-09-12T01:12+08:00", "lift")}
    for wid, action, to_day, to_at in WORKOUT_EDITS:
        day0, at0, kind0 = WORKOUT_ORIG[wid]
        wfix.append(dict(day=day0, at=at0, kind=kind0, action=action, to_day=to_day, to_at=to_at))
        w = conn.execute("SELECT id FROM workouts WHERE id=?", (wid,)).fetchone()
        if not w:
            continue
        if action == "delete": conn.execute("DELETE FROM workouts WHERE id=?", (wid,))
        else: conn.execute("UPDATE workouts SET day=?, at=? WHERE id=?", (to_day, to_at, wid))
    # additions: idempotent on (day, at, label)
    adds, wadds, n_add = [], [], 0
    for day, hm, label, kcal, lo, hi, protein, raw in ADDS + ADDS_V3:
        at = f"{day}T{hm}+08:00"
        adds.append(dict(day=day, at=at, label=label, kcal=kcal, kcal_lo=lo, kcal_hi=hi, protein_g=protein,
                         source="backfill-est", share_frac=1.0, venue=None, needs_review=0, detail=dict(raw=raw, chatfix=2)))
        if not conn.execute("SELECT 1 FROM meals WHERE day=? AND at=? AND label=?", (day, at, label)).fetchone():
            conn.execute("INSERT INTO meals(day,at,label,kcal,kcal_lo,kcal_hi,protein_g,source,share_frac,detail,needs_review) "
                         "VALUES(?,?,?,?,?,?,?,'backfill-est',1.0,?,0)", (day, at, label, kcal, lo, hi, protein, json.dumps(dict(raw=raw), ensure_ascii=False)))
            n_add += 1
    for day, hm, kind, detail in WORKOUT_ADDS:
        at = f"{day}T{hm}+08:00"
        wadds.append(dict(day=day, at=at, kind=kind, detail=detail, source="backfill"))
        if not conn.execute("SELECT 1 FROM workouts WHERE day=? AND kind=?", (day, kind)).fetchone():
            conn.execute("INSERT INTO workouts(day,at,kind,detail,source) VALUES(?,?,?,?,'backfill')", (day, at, kind, detail))
    conn.commit()
    # keep deletion keys from the previous file: those rows are gone from SQLite but a re-imported seed could bring them back
    if OUT.exists():
        for k, v in json.loads(OUT.read_text(encoding="utf-8")).get("fixes", {}).items():
            if v == "delete" and k not in fixes:
                fixes[k] = "delete"
    OUT.write_text(json.dumps(dict(version=3, fixes=fixes, adds=adds, workouts_add=wadds, workouts_fix=wfix), ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"added {n_add} new meal rows to SQLite")
    left = conn.execute("SELECT COUNT(*) FROM meals WHERE needs_review=1").fetchone()[0]
    print(f"valued {n_val}, deleted {n_del}; {left} rows still flagged; wrote {OUT.name} ({len(fixes)} keys)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

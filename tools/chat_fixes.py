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

# rows that were questions, corrections or duplicates of the row above them
DELETE: list[int] = [10, 14, 16, 18, 30, 39, 43, 52, 60, 69, 76, 95, 105, 113]


def main() -> int:
    conn = db.get_conn()
    key = lambda r: f"{r['day']}|{(json.loads(r['detail']) if r['detail'] else {}).get('raw') or r['label']}"  # noqa: E731
    fixes: dict[str, dict | str] = {}
    n_val = n_del = 0
    for rid, (label, kcal, lo, hi, protein) in VALUES.items():
        r = conn.execute("SELECT id, day, label, detail FROM meals WHERE id=? AND source LIKE 'backfill%'", (rid,)).fetchone()
        if not r:
            print(f"  ! row {rid} not found, skipped"); continue
        fixes[key(r)] = dict(label=label, kcal=kcal, kcal_lo=lo, kcal_hi=hi, protein_g=protein)
        conn.execute("UPDATE meals SET label=?, kcal=?, kcal_lo=?, kcal_hi=?, protein_g=?, source='backfill-est', needs_review=0 WHERE id=?",
                     (label, kcal, lo, hi, protein, rid))
        n_val += 1
    for rid in DELETE:
        r = conn.execute("SELECT id, day, label, detail FROM meals WHERE id=? AND source LIKE 'backfill%'", (rid,)).fetchone()
        if not r:
            continue
        fixes[key(r)] = "delete"
        conn.execute("DELETE FROM meals WHERE id=?", (rid,))
        n_del += 1
    conn.commit()
    OUT.write_text(json.dumps(dict(version=1, fixes=fixes), ensure_ascii=False, indent=0), encoding="utf-8")
    left = conn.execute("SELECT COUNT(*) FROM meals WHERE needs_review=1").fetchone()[0]
    print(f"valued {n_val}, deleted {n_del}; {left} rows still flagged; wrote {OUT.name} ({len(fixes)} keys)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Quick-add library, ingredient products, and the shake calculator.

Quick-add values are Singapore-context estimates with an honest range.
Products (milks, wheys) live in the database so a new carton or a new tub
is a row you add from the phone, with the numbers off its label.
"""
from __future__ import annotations

import sqlite3

# id, label, sub, kcal, lo, hi, protein_g
QUICK: list[dict] = [
    dict(id="kaya_set",     label="Kaya toast set",            sub="2 half-boiled eggs, kaya butter toast, kopi o peng", kcal=500, lo=450, hi=560, protein=19),
    dict(id="eggs4_bread2", label="4 half-boiled eggs + 2 bread", sub="white pepper, soy sauce",                       kcal=460, lo=410, hi=520, protein=30),
    dict(id="omelette3",    label="3-egg omelette + 2 bread",  sub="with chilli sauce",                                kcal=460, lo=400, hi=520, protein=26),
    dict(id="omelette4",    label="4-egg omelette + 4 bread",  sub="with chilli sauce",                                kcal=700, lo=620, hi=800, protein=38),
    dict(id="tuna_cheese",  label="Tuna + 2 cheese + 4 bread", sub="one can, drained",                                 kcal=640, lo=560, hi=720, protein=46),
    dict(id="cr925_reg",    label="925 chicken rice ($5)",     sub="roasted, regular",                                 kcal=650, lo=550, hi=750, protein=32),
    dict(id="cr925_extra",  label="925 chicken rice ($8)",     sub="extra chicken",                                    kcal=850, lo=720, hi=980, protein=48),
    dict(id="yakult",       label="Yakult",                    sub="1 bottle",                                         kcal=50,  lo=45,  hi=55,  protein=0.8),
    dict(id="yakult2",      label="Yakult ×2",                 sub="",                                                 kcal=100, lo=90,  hi=110, protein=1.6),
    dict(id="kopi_o_peng",  label="Kopi o peng",               sub="",                                                 kcal=80,  lo=60,  hi=100, protein=0),
    dict(id="teh_peng",     label="Teh peng",                  sub="",                                                 kcal=130, lo=100, hi=160, protein=3),
    dict(id="teh_o_peng",   label="Teh o peng",                sub="",                                                 kcal=60,  lo=40,  hi=80,  protein=0),
    dict(id="americano",    label="Americano",                 sub="Luckin, black",                                    kcal=5,   lo=0,   hi=10,  protein=0),
    dict(id="coconut",      label="Coconut water",             sub="bottle",                                           kcal=60,  lo=45,  hi=80,  protein=0),
    dict(id="coke",         label="Coke 500ml",                sub="regular",                                          kcal=210, lo=200, hi=220, protein=0),
    dict(id="greek125",     label="Greek yogurt 125g",         sub="Farmers Union high-protein",                       kcal=70,  lo=60,  hi=80,  protein=10),
    dict(id="mcd_dcb",      label="Double cheeseburger",       sub="McDonald's SG",                                    kcal=440, lo=420, hi=470, protein=25),
    dict(id="mcd_smm",      label="Sausage McMuffin",          sub="",                                                 kcal=300, lo=280, hi=320, protein=13),
    dict(id="mcd_smm_egg",  label="Sausage McMuffin with egg", sub="",                                                 kcal=380, lo=360, hi=400, protein=19),
    dict(id="mcd_cmm",      label="Chicken McMuffin",          sub="",                                                 kcal=320, lo=300, hi=340, protein=15),
    dict(id="mcd_bigbrk",   label="Big Breakfast",             sub="McDonald's SG",                                    kcal=550, lo=500, hi=600, protein=25),
    dict(id="csp_pau",      label="Char siew pau",             sub="1 piece",                                          kcal=220, lo=190, hi=250, protein=7),
    dict(id="tuna_bread",   label="Cheesy tuna bread",         sub="bakery",                                           kcal=320, lo=280, hi=380, protein=12),
]
QUICK_BY_ID = {q["id"]: q for q in QUICK}


# ------------------------------------------------------------------ products
def products(conn: sqlite3.Connection, kind: str | None = None, active_only: bool = True) -> list[dict]:
    sql = "SELECT id,kind,label,per,kcal,protein_g,is_default,active FROM products WHERE 1=1"
    params: list = []
    if kind:
        sql += " AND kind=?"
        params.append(kind)
    if active_only:
        sql += " AND active=1"
    sql += " ORDER BY is_default DESC, id"
    return [dict(r) for r in conn.execute(sql, params)]


def default_product(conn: sqlite3.Connection, kind: str) -> dict:
    rows = products(conn, kind)
    if not rows:
        raise LookupError(f"no active {kind} product")
    return rows[0]


def add_product(conn: sqlite3.Connection, kind: str, label: str, per: str,
                kcal: float, protein_g: float, make_default: bool = False) -> dict:
    if kind not in ("milk", "whey"):
        raise ValueError("kind must be milk or whey")
    if per not in ("100ml", "g"):
        raise ValueError("per must be 100ml or g")
    if make_default:
        conn.execute("UPDATE products SET is_default=0 WHERE kind=?", (kind,))
    cur = conn.execute(
        "INSERT INTO products(kind,label,per,kcal,protein_g,is_default) VALUES(?,?,?,?,?,?)",
        (kind, label.strip(), per, kcal, protein_g, 1 if make_default else 0))
    conn.commit()
    return dict(conn.execute("SELECT * FROM products WHERE id=?", (cur.lastrowid,)).fetchone())


def set_default(conn: sqlite3.Connection, product_id: int) -> None:
    row = conn.execute("SELECT kind FROM products WHERE id=?", (product_id,)).fetchone()
    if not row:
        raise KeyError(product_id)
    conn.execute("UPDATE products SET is_default=0 WHERE kind=?", (row["kind"],))
    conn.execute("UPDATE products SET is_default=1, active=1 WHERE id=?", (product_id,))
    conn.commit()


def retire_product(conn: sqlite3.Connection, product_id: int) -> None:
    """Hide it from pickers. Old shakes keep their stored numbers."""
    conn.execute("UPDATE products SET active=0, is_default=0 WHERE id=?", (product_id,))
    conn.commit()


# ------------------------------------------------------------------ shake
def shake(conn: sqlite3.Connection, whey_g: float, milk_ml: float,
          milk_id: int | None = None, creatine_g: float = 0.0,
          whey_id: int | None = None) -> dict:
    """Deterministic. Same inputs, same answer, every time.

    Uses the chosen (or default) whey and milk products, so changing tub or
    carton is a product change, never a code change.
    """
    whey = (dict(conn.execute("SELECT * FROM products WHERE id=?", (whey_id,)).fetchone() or {})
            if whey_id else default_product(conn, "whey"))
    milk = (dict(conn.execute("SELECT * FROM products WHERE id=?", (milk_id,)).fetchone() or {})
            if milk_id else default_product(conn, "milk"))
    if not whey or not milk:
        raise LookupError("unknown product")

    # whey products are stored per gram of powder; milks per 100 ml
    whey_p = whey_g * whey["protein_g"]
    whey_k = whey_g * whey["kcal"]
    milk_p = milk_ml / 100 * milk["protein_g"]
    milk_k = milk_ml / 100 * milk["kcal"]
    protein = whey_p + milk_p
    kcal = whey_k + milk_k
    label = f"Shake: {whey_g:g}g {whey['label']}, {milk_ml:g}ml {milk['label']}"
    if creatine_g:
        label += f", {creatine_g:g}g creatine"
    return dict(
        label=label,
        protein_g=round(protein, 1),
        kcal=round(kcal), kcal_lo=round(kcal * 0.96), kcal_hi=round(kcal * 1.04),
        breakdown=dict(whey_protein=round(whey_p, 1), whey_kcal=round(whey_k),
                       milk_protein=round(milk_p, 1), milk_kcal=round(milk_k),
                       whey=whey, milk=milk),
    )

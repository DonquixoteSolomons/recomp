"""Shake arithmetic is deterministic and follows the chosen products."""
from __future__ import annotations

import pytest

from recomp import db, foods


@pytest.fixture
def conn(tmp_path):
    return db.get_conn(tmp_path / "t.db")


def test_shake_is_pure_arithmetic(conn):
    # default whey 0.78 g protein / 3.9 kcal per g; default milk Meiji full cream 3.2 g / 64 kcal per 100 ml
    s = foods.shake(conn, 44, 250, None, 6)
    assert s["protein_g"] == 42.3          # 44 x 0.78 + 2.5 x 3.2
    assert s["kcal"] == 332                # 44 x 3.9 + 2.5 x 64
    assert s["kcal_lo"] < s["kcal"] < s["kcal_hi"]
    assert "6g creatine" in s["label"]


def test_same_inputs_same_answer(conn):
    assert foods.shake(conn, 35, 155) == foods.shake(conn, 35, 155)


def test_new_whey_product_changes_result(conn):
    base = foods.shake(conn, 40, 0, whey_id=None)["protein_g"]
    new = foods.add_product(conn, "whey", "Isolate 90", "g", 3.7, 0.90, make_default=True)
    assert foods.shake(conn, 40, 0)["protein_g"] == 36.0 != base
    # the old tub is still selectable explicitly
    old = [p for p in foods.products(conn, "whey") if p["id"] != new["id"]][0]
    assert foods.shake(conn, 40, 0, whey_id=old["id"])["protein_g"] == base


def test_new_milk_product(conn):
    m = foods.add_product(conn, "milk", "Fit milk", "100ml", 45, 5.0)
    s = foods.shake(conn, 0, 200, milk_id=m["id"])
    assert s["protein_g"] == 10.0 and s["kcal"] == 90


def test_retired_product_hidden_but_usable(conn):
    m = foods.add_product(conn, "milk", "Old carton", "100ml", 60, 3.0)
    foods.retire_product(conn, m["id"])
    assert all(p["id"] != m["id"] for p in foods.products(conn, "milk"))
    assert foods.shake(conn, 0, 100, milk_id=m["id"])["kcal"] == 60


def test_creatine_adds_nothing(conn):
    assert foods.shake(conn, 40, 200)["kcal"] == foods.shake(conn, 40, 200, creatine_g=5)["kcal"]


def test_quick_library_is_consistent():
    for q in foods.QUICK:
        assert q["lo"] <= q["kcal"] <= q["hi"], q["id"]
        assert q["protein"] >= 0
    assert len(foods.QUICK_BY_ID) == len(foods.QUICK)

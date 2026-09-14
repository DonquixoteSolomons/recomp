import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateExpenditure, currentTarget, weightTrend, verdict, addDays } from "../js/engine.js";
import { shake, computeFromIdentification, REFERENCE, QUICK, DEFAULT_PRODUCTS } from "../js/foods.js";

const S = { creatine_start: "2000-01-01", creatine_settle_days: "28", recomp_deficit_kcal: "250",
            provisional_kcal: "2350", protein_floor_g: "150", protein_ceiling_g: "160" };

function seed(start, days, kcal, w0, slope) {
  const meals = [], body = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    meals.push({ day, at: `${day}T12:00`, kcal, kcal_lo: kcal * 0.9, kcal_hi: kcal * 1.1, protein_g: 150 });
    body.push({ day, at: `${day}T07:00`, weight_kg: w0 + slope * i });
  }
  return { meals, body };
}

test("no estimate below min days -> provisional", () => {
  const { meals, body } = seed("2026-09-01", 5, 2400, 74, 0);
  const e = estimateExpenditure(meals, body, S, "2026-09-07");
  assert.equal(e.confidence, "none");
  assert.equal(currentTarget(e, S).source, "provisional");
});

test("flat weight means tdee equals intake", () => {
  const { meals, body } = seed("2026-09-01", 21, 2400, 74, 0);
  const e = estimateExpenditure(meals, body, S, "2026-09-22");
  assert.equal(e.confidence, "good");
  assert.equal(e.tdee, 2400);
  assert.equal(e.target, 2150);
  assert.ok(e.tdee_lo < 2400 && 2400 < e.tdee_hi);
  assert.equal(currentTarget(e, S).source, "measured");
});

test("gaining 1 kg over 20 days at 2900 -> tdee ~2515 (no EMA lag)", () => {
  const { meals, body } = seed("2026-09-01", 21, 2900, 73.5, 1 / 20);
  const e = estimateExpenditure(meals, body, S, "2026-09-22");
  assert.ok(e.tdee > 2450 && e.tdee < 2580, e.note);
});

test("losing weight raises tdee above intake", () => {
  const { meals, body } = seed("2026-09-01", 21, 2200, 75, -1 / 20);
  assert.ok(estimateExpenditure(meals, body, S, "2026-09-22").tdee > 2200);
});

test("today and incomplete days are excluded", () => {
  const { meals, body } = seed("2026-09-01", 21, 2400, 74, 0);
  meals.push({ day: "2026-09-22", at: "2026-09-22T09:00", kcal: 400, kcal_lo: 380, kcal_hi: 420, protein_g: 20 });
  const m10 = meals.find(m => m.day === "2026-09-10"); m10.kcal = 300; m10.kcal_lo = 280; m10.kcal_hi = 320;
  const e = estimateExpenditure(meals, body, S, "2026-09-22");
  assert.equal(e.days_with_intake, 20);
  assert.equal(e.intake_avg, 2400);
});

test("creatine window excluded from the weight side", () => {
  const { meals, body } = seed("2026-09-01", 21, 2400, 74, 0.05);
  const e = estimateExpenditure(meals, body, { ...S, creatine_start: "2026-09-01" }, "2026-09-22");
  assert.equal(e.confidence, "none");
  assert.match(e.note, /creatine/);
});

test("trend is smoothed", () => {
  const { body } = seed("2026-09-01", 10, 2400, 74, 0);
  body.push({ day: "2026-09-11", at: "2026-09-11T07:00", weight_kg: 76.5 });
  const pts = weightTrend(body, S);
  assert.equal(pts.at(-1).weight, 76.5);
  assert.ok(pts.at(-1).trend < 74.5);
});

test("verdict answers the recurring question", () => {
  const t = { lo: 2250, hi: 2450 };
  assert.equal(verdict({ protein: 0, kcal: 0 }, false, S, t).kcal_msg, "nothing logged yet");
  const v = verdict({ protein: 155, kcal: 2300 }, true, S, t);
  assert.equal(v.protein, "hit"); assert.equal(v.kcal, "in"); assert.equal(v.ok_to_end, true);
  assert.equal(verdict({ protein: 120, kcal: 2300 }, true, S, t).ok_to_end, false);
  assert.equal(verdict({ protein: 170, kcal: 2600 }, true, S, t).kcal, "over");
});

test("shake is pure arithmetic", () => {
  const whey = DEFAULT_PRODUCTS.find(p => p.kind === "whey"), milk = DEFAULT_PRODUCTS[0];
  const s = shake(44, 250, whey, milk, 6);
  assert.equal(s.protein_g, 42.3); assert.equal(s.kcal, 332);
  assert.match(s.label, /6g creatine/);
  assert.deepEqual(shake(35, 155, whey, milk), shake(35, 155, whey, milk));
  assert.equal(shake(40, 0, { label: "Iso", protein_g: 0.9, kcal: 3.7 }, milk).protein_g, 36);
});

test("identification -> reference arithmetic wins, model figures flagged", () => {
  const ident = { dish: "Chicken rice, extra chicken, teh peng", confidence: "medium", assumptions: ["standard plate"],
    components: [
      { name: "chicken rice extra", ref: "chicken_rice_extra", quantity: 1 },
      { name: "teh", ref: "teh", quantity: 1 },
      { name: "mystery sauce", ref: null, quantity: 1, kcal: 100, protein_g: 1 },
    ] };
  const r = computeFromIdentification(ident, 1);
  assert.equal(r.kcal, 870 + 145 + 100);
  assert.equal(r.protein_g, 50 + 3 + 1);
  assert.equal(r.items[0].basis, "reference"); assert.equal(r.items[2].basis, "model");
  assert.ok(r.items[2].kcal_lo < 100 && r.items[2].kcal_hi > 100);
  const half = computeFromIdentification(ident, 0.5);
  assert.equal(half.kcal, Math.round((870 + 145 + 100) * 0.5));
});

test("tables are consistent", () => {
  for (const r of REFERENCE) assert.ok(r.lo <= r.kcal && r.kcal <= r.hi, r.id);
  for (const q of QUICK) assert.ok(q.lo <= q.kcal && q.kcal <= q.hi, q.id);
  assert.equal(new Set(REFERENCE.map(r => r.id)).size, REFERENCE.length);
});

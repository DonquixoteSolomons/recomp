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

// ---- sessions: move calories between days, never inflate the week
const B = { ...S, burn_revl_move: "450", burn_revl_sweat: "500", burn_other: "200", provisional_kcal: "2000" };
const week = (start, kinds) => kinds.map((k, i) => ({ day: addDays(start, i), at: `${addDays(start, i)}T18:00`, kind: k })).filter(w => w.kind);

test("measured: rest base = tdee minus the sessions actually logged", () => {
  const { meals, body } = seed("2026-09-01", 21, 2400, 74, 0);
  // 5 REVL Move sessions a week for 3 weeks = 15 x 450 over 21 days
  const workouts = [];
  for (let wk = 0; wk < 3; wk++) workouts.push(...week(addDays("2026-09-01", wk * 7), ["revl_move", "revl_move", "revl_move", "revl_move", "revl_move", null, null]));
  const e = estimateExpenditure(meals, body, B, "2026-09-22", 21, workouts);
  assert.equal(e.tdee, 2400);
  assert.equal(e.sessions_in_window, 15);
  assert.equal(e.session_avg, Math.round(15 * 450 / 21));      // 321
  assert.equal(e.rest_base, 2400 - 321);
  const rest = currentTarget(e, B, []);
  const train = currentTarget(e, B, [{ kind: "revl_move" }]);
  assert.equal(rest.target, 2400 - 321 - 250);
  assert.equal(train.target, rest.target + 450);
});

test("a 5-day week and a 3-day week sum to the same measured expenditure", () => {
  const { meals, body } = seed("2026-09-01", 21, 2400, 74, 0);
  const workouts = [];
  for (let wk = 0; wk < 3; wk++) workouts.push(...week(addDays("2026-09-01", wk * 7), ["revl_move", "revl_sweat", "revl_move", "revl_sweat", "revl_move", null, null]));
  const e = estimateExpenditure(meals, body, B, "2026-09-22", 21, workouts);
  const restT = currentTarget(e, B, []).target;
  const sum = (kinds) => kinds.reduce((a, k) => a + currentTarget(e, B, k ? [{ kind: k }] : []).target, 0);
  const five = sum(["revl_move", "revl_sweat", "revl_move", "revl_sweat", "revl_move", null, null]);
  const three = sum(["revl_move", null, "revl_sweat", null, "revl_move", null, null]);
  // the week you actually trained less, you are told to eat less — by exactly the sessions you skipped
  assert.equal(five - three, 500 + 450);
  // and a week trained like the measured window sums to 7 x (tdee - deficit): no inflation, no double count
  assert.ok(Math.abs(five - 7 * (e.tdee - 250)) <= 7, `five=${five} vs ${7 * (e.tdee - 250)}`);
  assert.ok(restT < e.tdee - 250);
});

test("provisional: rest base plus today's sessions, nothing assumed", () => {
  const rest = currentTarget(null, B, []);
  assert.equal(rest.source, "provisional"); assert.equal(rest.target, 2000);
  assert.equal(currentTarget(null, B, [{ kind: "revl_move" }]).target, 2450);
  assert.equal(currentTarget(null, B, [{ kind: "revl_move" }, { kind: "other" }]).target, 2650);
  assert.equal(currentTarget(null, B, [{ kind: "unknown_kind" }]).target, 2200);   // falls back to burn_other
});

// ---- v2: measured burn, recents, lifts, week summary
import { recentFoods, e1rm, liftProgress } from "../js/foods.js";
import { sessionKcal, weekSummary } from "../js/engine.js";

test("measured kcal on a workout beats the per-kind default", () => {
  assert.equal(sessionKcal({ kind: "run" }, B), 200);            // B has no burn_run -> other
  assert.equal(sessionKcal({ kind: "run", kcal: 312 }, B), 312);
  assert.equal(sessionKcal({ kind: "run", kcal: 0 }, B), 200);
});

test("recent foods: frequency with recency decay, shakes excluded, latest values win", () => {
  const meals = [
    { day: "2026-09-01", at: "2026-09-01T08:00", label: "Kaya toast set", kcal: 500, kcal_lo: 450, kcal_hi: 560, protein_g: 19, source: "quick" },
    { day: "2026-09-10", at: "2026-09-10T08:00", label: "Kaya toast set", kcal: 520, kcal_lo: 470, kcal_hi: 580, protein_g: 20, source: "quick" },
    { day: "2026-09-14", at: "2026-09-14T13:00", label: "Amigos lamb chop", kcal: 1200, kcal_lo: 1000, kcal_hi: 1400, protein_g: 60, source: "photo" },
    { day: "2026-09-14", at: "2026-09-14T18:00", label: "Shake: 44g whey", kcal: 332, kcal_lo: 318, kcal_hi: 345, protein_g: 42, source: "shake" },
    { day: "2026-08-01", at: "2026-08-01T18:00", label: "Old thing", kcal: 300, kcal_lo: 250, kcal_hi: 350, protein_g: 10, source: "manual" },
  ];
  const r = recentFoods(meals, "2026-09-15");
  assert.equal(r[0].label, "Kaya toast set"); assert.equal(r[0].kcal, 520); assert.equal(r[0].n, 2);
  assert.ok(!r.some(x => /Shake/.test(x.label)));
  assert.ok(r.findIndex(x => x.label === "Old thing") > r.findIndex(x => x.label === "Amigos lamb chop"));
});

test("e1rm and lift progress", () => {
  assert.equal(e1rm(100, 1), 100);
  assert.equal(e1rm(90, 3), 99);
  const p = liftProgress([
    { day: "2026-09-04", kind: "lift", sets: [{ exercise: "Back squat", weight: 90, reps: 3 }, { exercise: "Back squat", weight: 80, reps: 5 }] },
    { day: "2026-09-11", kind: "lift", sets: [{ exercise: "Back squat", weight: 85, reps: 5 }, { exercise: "Calf raise (vest)", weight: 10, reps: 20 }] },
  ]);
  const sq = p.find(x => x.exercise === "Back squat");
  assert.equal(sq.best, 99.2); assert.equal(sq.best_day, "2026-09-11"); assert.equal(sq.best_set, "85 kg × 5"); assert.equal(sq.last_set, "85 kg × 5"); assert.equal(sq.goal, 100); assert.equal(sq.sessions, 2);
  assert.equal(p[0].exercise, "Back squat");                      // goal lifts sort first
});

test("week summary", () => {
  const { meals, body } = seed("2026-09-08", 7, 2400, 74, -0.02);
  const w = [{ day: "2026-09-09", kind: "revl_move" }, { day: "2026-09-11", kind: "run", kcal: 300 }];
  const s = weekSummary(meals, w, body, { ...B, protein_floor_g: "150" }, "2026-09-14");
  assert.equal(s.complete_days, 7); assert.equal(s.kcal_avg, 2400); assert.equal(s.protein_days, 7);
  assert.equal(s.sessions, 2); assert.equal(s.session_kcal, 750);
  assert.ok(s.weight_to < s.weight_from);
});

import { cleanBackfillLabel } from "../js/foods.js";
test("chat rows matched by pattern get clean labels", () => {
  const raw = "Had 2 half boiled egg with white pepper and soy sauce, kaya butter toast of 2 white bread. And kopi peng. Also had a yakult";
  assert.equal(cleanBackfillLabel({ label: raw, detail: JSON.stringify({ raw, method: "kaya_set+yakult" }) }), "Kaya toast set + Yakult");
  assert.equal(cleanBackfillLabel({ label: "Had a shake of 304ml meiji milk 62g whey and 6g creatine.", detail: { raw: "Had a shake of 304ml meiji milk 62g whey and 6g creatine.", method: "shake" } }), "Shake: 62g whey, 304ml milk");
  assert.equal(cleanBackfillLabel({ label: "x", detail: { raw: "x", method: "none" } }), null);
  assert.equal(cleanBackfillLabel({ label: "Had 2 yakults", detail: { raw: "Had 2 yakults", method: "yakult x2" } }), "Yakult ×2");
});

test("a long gap restarts the trend instead of dragging months-old readings into it", () => {
  const body = [
    { day: "2026-04-28", at: "2026-04-28T07:00", weight_kg: 72.5 }, { day: "2026-04-29", at: "2026-04-29T07:00", weight_kg: 72.6 },
    { day: "2026-09-09", at: "2026-09-09T07:00", weight_kg: 75.05 }, { day: "2026-09-15", at: "2026-09-15T07:00", weight_kg: 75.5 },
    { day: "2026-09-16", at: "2026-09-16T07:00", weight_kg: 74.85 },
  ];
  const pts = weightTrend(body, S);
  assert.equal(pts[2].trend, 75.05);
  assert.ok(pts.at(-1).trend > 74.9, String(pts.at(-1).trend));
});

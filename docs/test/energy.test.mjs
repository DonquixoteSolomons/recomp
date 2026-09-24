// Session burn from the 2024 Adult Compendium of Physical Activities: (MET − 1) × kg × hours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { workoutKcal, parseWorkoutText, setCategory, COMPENDIUM } from "../js/workout.js";
import { sessionKcal } from "../js/engine.js";

const ME = { body_kg: "75.6", burn_revl_move: "450", burn_lift: "250", burn_run: "300", burn_other: "200" };
const SESSION = parseWorkoutText(`Push-ups: 3 x 15
Pike push-ups: 3 x 8
Dips: 3 x 8
Pull-ups: 3 x 6
Bodyweight squats: 3 x 15
Walking lunges: 3 x 10 per leg
Dead bugs: 3 x 10 per side
Bird-dogs: 3 x 10 per side
Side planks: 3 x 30 sec per side
Calf work with 10kg vest:
Single-leg standing calf raise: 3 x 15 per leg
Seated bent-knee calf raise: 3 x 20`).sets;

test("the Compendium values the app uses are the published ones", () => {
  assert.deepEqual([COMPENDIUM.calisthenics.easy, COMPENDIUM.calisthenics.moderate, COMPENDIUM.calisthenics.hard], [2.8, 3.8, 7.5]);   // 02024 / 02022 / 02020
  assert.deepEqual([COMPENDIUM.weights.easy, COMPENDIUM.weights.moderate, COMPENDIUM.weights.hard], [3.5, 5.0, 6.0]);             // 02054 / 02052 / 02050
});

test("sets are sorted into the right Compendium rows", () => {
  assert.equal(setCategory({ exercise: "Push-up", weight: 0 }), "calisthenics");
  assert.equal(setCategory({ exercise: "Side plank", weight: 0 }), "light");
  assert.equal(setCategory({ exercise: "Single-leg standing calf raise", weight: 10 }), "light");
  assert.equal(setCategory({ exercise: "Back squat", weight: 80 }), "weights");
  assert.equal(setCategory({ exercise: "Pull-up", weight: 10 }), "calisthenics");   // a weighted pull-up is still a pull-up
});

test("a calisthenics session: duration from the sets, effort sets the MET, net of resting", () => {
  const mod = workoutKcal({ kind: "lift", sets: SESSION }, ME);
  assert.equal(mod.source, "estimate"); assert.equal(mod.minutes, 57); assert.equal(mod.estimated_minutes, true);
  assert.ok(mod.kcal > 150 && mod.kcal < 180, mod.kcal);                              // ~165, not a flat 250
  const hard = workoutKcal({ kind: "lift", sets: SESSION, effort: "hard" }, ME);
  assert.ok(hard.kcal > 2 * mod.kcal - 10, hard.kcal);                                // vigorous calisthenics is 7.5 MET, not 3.8
  const timed = workoutKcal({ kind: "lift", sets: SESSION, duration_min: 40 }, ME);
  assert.equal(timed.minutes, 40); assert.equal(timed.estimated_minutes, false);
  assert.match(mod.why, /57 min \(estimated from your sets\) × 3\.3 MET \(moderate: calisthenics 3\.8, core & calf work 2\.8\) × 75\.6 kg/);
});

test("runs, walks and cycling by speed; a measured figure always wins; your own class figure stays yours", () => {
  const run = workoutKcal({ kind: "run", duration_min: 20, distance_km: 3.04 }, ME);                 // 9.1 km/h ≈ 5.7 mph → 9.0 MET (12045)
  assert.equal(run.met, 9); assert.equal(run.kcal, Math.round(8 * 75.6 * 20 / 60));
  assert.equal(workoutKcal({ kind: "walk", duration_min: 60, distance_km: 5 }, ME).met, 3.8);        // 3.1 mph → 17190
  assert.equal(workoutKcal({ kind: "run", kcal: 276, duration_min: 39 }, ME).kcal, 276);
  const revl = workoutKcal({ kind: "revl_move", duration_min: 45 }, ME);
  assert.deepEqual([revl.kcal, revl.source], [450, "default"]);
  const noTime = workoutKcal({ kind: "run" }, ME);
  assert.deepEqual([noTime.kcal, noTime.source], [300, "default"]); assert.match(noTime.why, /add minutes/);
  assert.equal(sessionKcal({ kind: "lift", sets: SESSION }, ME), workoutKcal({ kind: "lift", sets: SESSION }, ME).kcal);   // the engine uses the same number
});

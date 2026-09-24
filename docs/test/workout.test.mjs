// Sets: reading a pasted session, grouping, progress; and the rough meal guess used when the AI is down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkoutText, groupSets, setsSummary, canonicalExercise, liftProgress, EXERCISES } from "../js/workout.js";
import { roughGuess, words, dishWords } from "../js/guess.js";

const SESSION = `Calisthenics:
Push-ups: 3 x 15
Pike push-ups: 3 x 8
Dips: 3 x 8
Pull-ups: 3 x 6
Bodyweight squats: 3 x 15
Walking lunges: 3 x 10 per leg
Core:
Dead bugs: 3 x 10 per side
Bird-dogs: 3 x 10 per side
Side planks: 3 x 30 sec per side
Calf work with 10kg vest:
Single-leg standing calf raise: 3 x 15 per leg
Seated bent-knee calf raise: 3 x 20`;

test("the whole pasted session reads: 11 exercises, 33 sets, bodyweight, timed, per side, and the vest heading", () => {
  const { sets, unparsed } = parseWorkoutText(SESSION);
  assert.deepEqual(unparsed, []);
  assert.equal(sets.length, 33);
  const g = groupSets(sets);
  assert.equal(g.length, 11);
  assert.deepEqual(g[0], { exercise: "Push-up", weight: 0, reps: 15, secs: null, side: false, n: 3 });
  assert.equal(g.find(x => x.exercise === "Pull-up").reps, 6);                                  // "Pull-ups" is the Pull-up already in use
  assert.deepEqual(g.find(x => x.exercise === "Side plank"), { exercise: "Side plank", weight: 0, reps: null, secs: 30, side: true, n: 3 });
  assert.equal(g.find(x => x.exercise === "Walking lunge").side, true);
  const calf = g.find(x => x.exercise === "Single-leg standing calf raise");
  assert.deepEqual([calf.weight, calf.reps, calf.side], [10, 15, true]);                        // the heading's 10 kg vest carries down
  assert.equal(g.find(x => x.exercise === "Seated bent-knee calf raise").weight, 10);
  assert.equal(g.find(x => x.exercise === "Dead bug").weight, 0);                               // a new heading resets it
  assert.match(setsSummary(sets), /^Push-up 3×15 · Pike push-up 3×8 · Dip 3×8 · Pull-up 3×6/);
  assert.match(setsSummary(sets), /Side plank 3×30 s\/side/);
  assert.match(setsSummary(sets), /Single-leg standing calf raise 3×15\/side @10 kg/);
});

test("other ways people write sets", () => {
  const { sets, unparsed } = parseWorkoutText("- Back squat 3x5 @ 80kg\n2. Bench press: 4 sets of 8 60 kg\nPlank 2 x 1 min\nGoblet squat: 3 × 12 35 lb\nfelt great today 10/10");
  assert.equal(setsSummary(sets), "Back squat 3×5 @80 kg · Bench press 4×8 @60 kg · Plank 2×60 s · Goblet squat 3×12 @15.9 kg");
  assert.deepEqual(unparsed, ["felt great today 10/10"]);                                      // shown back, never guessed
});

test("exercise names fold onto the ones already in use", () => {
  assert.equal(canonicalExercise("pull ups"), "Pull-up");
  assert.equal(canonicalExercise("Lunges"), "Lunge");
  assert.equal(canonicalExercise("archer push-ups", [...EXERCISES]), "Archer push-ups");       // new ones keep their name
});

test("progress: barbell lifts by estimated 1RM, bodyweight and vest work by best set", () => {
  const p = liftProgress([
    { day: "2026-09-20", kind: "lift", sets: parseWorkoutText("Push-ups: 3 x 12\nSide planks: 2 x 25 s per side\nBack squat 1 x 5 @ 80kg").sets },
    { day: "2026-09-24", kind: "lift", sets: parseWorkoutText(SESSION).sets },
  ]);
  const push = p.find(x => x.exercise === "Push-up"), plank = p.find(x => x.exercise === "Side plank"), calf = p.find(x => x.exercise === "Single-leg standing calf raise");
  assert.deepEqual([push.metric, push.best_set, push.sessions], ["best", "15 reps", 2]);
  assert.equal(plank.best_set, "30 s/side");
  assert.equal(calf.best_set, "10 kg × 15/side");
  assert.equal(p[0].exercise, "Back squat"); assert.equal(p[0].metric, "e1rm");                 // the goal lift first
});

const meal = (label, kcal, protein, extra = {}) => ({ day: "2026-09-10", at: "2026-09-10T20:00:00+08:00", label, kcal, kcal_lo: kcal * 0.85, kcal_hi: kcal * 1.15, protein_g: protein, source: "backfill-est", share_frac: 1, ...extra });
const HISTORY = [
  meal("Mala, half of shared pool + 3 luncheon meat", 905, 41),
  meal("Mala, half of shared pool + 2 luncheon meat + ¾ rice", 910, 39),
  meal("Mala dry, half of $31 (Monster Chilli) + rice", 775, 31),
  meal("Luncheon meat (200g can) spicy filling + 4 white bread", 960, 36),
  meal("Chicken rice", 600, 30, { source: "photo" }),
  meal("Kaya toast set", 500, 19, { source: "repeat" }),
];

test("rough guess: your own past meals like it, matched on the rare words", () => {
  const g = roughGuess("Had mala from dragonfly at bangkit. Ate all the luncheon meat.", HISTORY, 0.5);
  assert.equal(g.basis, "history");
  assert.deepEqual(g.from.sort(), ["Mala, half of shared pool + 2 luncheon meat + ¾ rice", "Mala, half of shared pool + 3 luncheon meat"]);
  assert.deepEqual([g.kcal, g.protein_g], [908, 40]);                                           // chat rows already hold his half: not halved again
  assert.ok(g.kcal_lo < g.kcal && g.kcal < g.kcal_hi);
});

test("rough guess: a past meal only counts if it is the same dish — side ingredients don't make a match", () => {
  assert.deepEqual(dishWords("Had mala from dragonfly at bangkit. Ate all the luncheon meat."), ["mala"]);
  assert.deepEqual(dishWords("chicken rice, extra meat"), ["chicken", "rice"]);
  assert.deepEqual(dishWords("At Bangkit, had mala with rice"), ["mala"]);
  const g = roughGuess("chicken rice, extra meat", HISTORY.filter(m => m.label !== "Chicken rice"), 1);
  assert.equal(g.basis, "reference");                                                          // not the mala rows that also have rice and meat
  assert.equal(g.from.length, 1); assert.match(g.from[0], /chicken rice/i);                    // and "extra meat" doesn't drag in another dish
  assert.equal(roughGuess("chicken rice", HISTORY, 1).kcal, 600);
});

test("rough guess: app-logged rows are rescaled to today's share", () => {
  const hist = [meal("Chicken rice", 300, 15, { source: "photo", share_frac: 0.5 })];
  assert.equal(roughGuess("chicken rice", hist, 1).kcal, 600);
});

test("rough guess: nothing in your log → the reference table, then nothing", () => {
  const g = roughGuess("mala with luncheon meat", [], 0.5);
  assert.equal(g.basis, "reference");
  assert.ok(g.from.some(n => /Mala/.test(n)) && g.from.some(n => /Luncheon/.test(n)));
  assert.equal(roughGuess("zxqv", [], 1), null);
  assert.equal(roughGuess("", HISTORY, 1), null);
  assert.deepEqual(words("Had the Walking lunges"), ["walking", "lunge"]);
});

/* Sets: reading a typed or pasted session, grouping for display, progress per exercise.
   A set is { exercise, weight (added load in kg; 0 = bodyweight), reps | null, secs | null, side (per side / leg) }. */

export const EXERCISES = [
  "Back squat", "Bench press", "Deadlift", "Overhead press", "Barbell row", "Romanian deadlift", "Dumbbell press",
  "Pull-up", "Chin-up", "Push-up", "Pike push-up", "Dip", "Bodyweight squat", "Walking lunge", "Lunge",
  "Plank", "Side plank", "Dead bug", "Bird-dog", "Hanging leg raise",
  "Calf raise", "Calf raise (vest)", "Single-leg standing calf raise", "Seated bent-knee calf raise",
];
export const GOAL_LIFTS = { "Back squat": 100, "Bench press": 100, "Deadlift": 100 };
/** Epley estimated one-rep max. reps=1 returns the weight itself. */
export const e1rm = (weight, reps) => (reps <= 1 ? weight : Math.round(weight * (1 + reps / 30) * 10) / 10);
// an estimated 1RM means something for barbell and dumbbell lifts, not for a vest on a calf raise
const USES_E1RM = /squat|bench|deadlift|overhead press|military press|barbell|dumbbell|\brow\b|clean|snatch|hip thrust|leg press/i;
const NOT_E1RM = /bodyweight|pike|push-?up|pistol|jump|calf/i;
export const usesE1rm = (ex) => USES_E1RM.test(ex) && !NOT_E1RM.test(ex);

/** "Pull-ups", "pull ups", "Pullup" → the name already in use, so a history is one exercise, not three. */
const keys = (s) => { const k = String(s).toLowerCase().replace(/[^a-z0-9]/g, ""); return [k, k.replace(/s$/, ""), k.replace(/es$/, "")]; };
export function canonicalExercise(name, known = EXERCISES) {
  const raw = String(name || "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  const mine = new Set(keys(raw));
  const hit = known.find(k => keys(k).some(x => mine.has(x)));
  return hit || raw[0].toUpperCase() + raw.slice(1);
}

/** Lines like "Push-ups: 3 x 15", "Side planks: 3 x 30 sec per side", "Squat 3x5 @ 80kg", "Dips - 3 sets of 8".
    A line with no set scheme that ends in ":" (or carries no number but a weight) is a heading; a weight in
    it ("Calf work with 10kg vest:") is the added load for the lines under it. Returns { sets, unparsed }. */
export function parseWorkoutText(text, known = EXERCISES) {
  const sets = [], unparsed = [];
  let sectionKg = 0;
  const kgOf = (s) => { const kg = s.match(/(\d+(?:\.\d+)?)\s*kg\b/i); if (kg) return parseFloat(kg[1]); const lb = s.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs)\b/i); return lb ? Math.round(parseFloat(lb[1]) / 2.20462 * 10) / 10 : null; };
  for (const raw of String(text || "").split(/\r?\n|;/)) {
    const line = raw.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, "").trim();
    if (!line) continue;
    const scheme = line.match(/(\d+)\s*(?:sets?\s*(?:of|x|×)|[x×*])\s*(\d+(?:\.\d+)?)\s*(s|secs?|seconds?|mins?|minutes?)?\b/i);
    if (!scheme) {
      const withoutLoad = line.replace(/(\d+(?:\.\d+)?)\s*(kg|lbs?)\b/gi, "");
      if (/:\s*$/.test(line) || !/\d/.test(withoutLoad)) { sectionKg = kgOf(line) ?? 0; continue; }
      unparsed.push(raw.trim()); continue;
    }
    let name = line.includes(":") && line.indexOf(":") < scheme.index ? line.slice(0, line.indexOf(":")) : line.slice(0, scheme.index);
    name = name.replace(/@?\s*\d+(?:\.\d+)?\s*(kg|lbs?)\b/gi, "").replace(/[-–—:@,]+\s*$/, "").trim();
    if (!name) { unparsed.push(raw.trim()); continue; }
    const n = Math.min(20, parseInt(scheme[1], 10)), amount = parseFloat(scheme[2]), unit = (scheme[3] || "").toLowerCase();
    const secs = /^s|^sec/.test(unit) ? amount : /^min/.test(unit) ? amount * 60 : null;
    const side = /\b(?:per|each|a)\s+(?:side|leg|arm)\b|\/\s*(?:side|leg|arm)\b/i.test(line);
    const weight = kgOf(line) ?? sectionKg;
    const exercise = canonicalExercise(name, known);
    for (let i = 0; i < n; i++) sets.push({ exercise, weight: weight || 0, reps: secs == null ? amount : null, secs, side });
  }
  return { sets, unparsed };
}

/** Consecutive identical sets → one group with a count. */
export function groupSets(sets = []) {
  const out = [];
  for (const s of sets) {
    const last = out.at(-1), same = last && last.exercise === s.exercise && (+last.weight || 0) === (+s.weight || 0) && last.reps === s.reps && last.secs === s.secs && !!last.side === !!s.side;
    if (same) last.n++; else out.push({ ...s, weight: +s.weight || 0, reps: s.reps ?? null, secs: s.secs ?? null, side: !!s.side, n: 1 });
  }
  return out;
}
export const amountText = (s) => (s.secs ? `${s.secs} s` : `${s.reps}`) + (s.side ? "/side" : "");
export const groupText = (g) => `${g.n > 1 ? `${g.n}×` : ""}${amountText(g)}${g.weight ? ` @${g.weight} kg` : ""}`;
/** "Push-up 3×15 · Side plank 3×30 s/side · Back squat 5 @80 kg, 3 @85 kg" */
export function setsSummary(sets = []) {
  const by = new Map();
  for (const g of groupSets(sets)) { if (!by.has(g.exercise)) by.set(g.exercise, []); by.get(g.exercise).push(groupText(g)); }
  return [...by].map(([e, gs]) => `${e} ${gs.join(", ")}`).join(" · ");
}
const setLabel = (s) => s.weight ? `${s.weight} kg × ${amountText(s)}` : s.secs ? amountText(s) : `${s.reps} reps${s.side ? " per side" : ""}`;

/** Per exercise: barbell-type lifts by best estimated 1RM, everything else by best set
    (more added load first, then more reps or seconds). */
export function liftProgress(workouts) {
  const by = new Map();
  for (const w of workouts) {
    for (const s of (w.sets || [])) {
      const ex = s.exercise || "Other", wt = parseFloat(s.weight) || 0, reps = parseInt(s.reps, 10) || 0, secs = parseInt(s.secs, 10) || 0;
      const e1 = usesE1rm(ex);
      if (e1 ? !(wt && reps) : !(reps || secs)) continue;
      const score = e1 ? e1rm(wt, reps) : wt * 1000 + (reps || secs);
      const label = e1 ? `${wt} kg × ${reps}` : setLabel({ weight: wt, reps, secs, side: s.side });
      const p = by.get(ex) || { exercise: ex, metric: e1 ? "e1rm" : "best", best: 0, best_day: "", best_set: "", last_day: "", last_set: "", sessions: new Set() };
      p.sessions.add(w.day);
      if (score > p.best) { p.best = score; p.best_day = w.day; p.best_set = label; }
      if (w.day >= p.last_day) { p.last_day = w.day; p.last_set = label; }
      by.set(ex, p);
    }
  }
  return [...by.values()].map(p => ({ ...p, sessions: p.sessions.size, goal: GOAL_LIFTS[p.exercise] || null }))
    .sort((a, b) => (b.goal ? 1 : 0) - (a.goal ? 1 : 0) || (a.metric === "e1rm" ? 0 : 1) - (b.metric === "e1rm" ? 0 : 1) || (a.metric === "e1rm" ? b.best - a.best : b.sessions - a.sessions));
}

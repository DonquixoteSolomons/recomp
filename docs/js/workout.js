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

/* ---------------------------------------------------------------- energy
   Every figure here is from the 2024 Adult Compendium of Physical Activities (pacompendium.com),
   the standard reference for the energy cost of activities, by activity code.
   kcal = (MET − 1) × body kg × hours: net of the ~1 MET you would have burned sitting, because the
   day's rest base already counts that hour. A measured figure (watch, Strava) always wins. */
export const COMPENDIUM = {
  calisthenics: { easy: 2.8, moderate: 3.8, hard: 7.5, label: "calisthenics", codes: "02024 / 02022 / 02020" },
  light:        { easy: 2.3, moderate: 2.8, hard: 3.8, label: "core & calf work", codes: "02101 / 02024 / 02022" },
  weights:      { easy: 3.5, moderate: 5.0, hard: 6.0, label: "weights", codes: "02054 / 02052 / 02050" },
  class:        { easy: 5.0, moderate: 7.0, hard: 11.0, label: "HIIT class", codes: "02008 / 02210 / 02214" },
  cycle:        { easy: 4.0, moderate: 7.0, hard: 10.0, label: "cycling", codes: "01010 / 01014 / 01040" },
  swim:         { easy: 5.3, moderate: 5.8, hard: 9.8, label: "swimming laps", codes: "18265 / 18240 / 18230" },
  run:          { easy: 7.5, moderate: 9.0, hard: 10.5, label: "running", codes: "12020 / 12045 / 12145" },
  walk:         { easy: 2.8, moderate: 3.8, hard: 4.8, label: "walking", codes: "17152 / 17190 / 17200" },
};
// by speed, mph → MET (codes 12026–12135 and 17151–17231; 01010–01050 for cycling)
const RUN_MPH = [[2.6, 3.3], [4.1, 6.5], [4.55, 7.8], [5.1, 8.5], [5.65, 9.0], [6.15, 9.3], [6.7, 10.5], [7, 11.0], [7.5, 11.8], [8, 12.0], [8.6, 12.5], [9, 13.0], [9.45, 14.8], [10, 14.8], [11, 16.8], [12, 18.5], [13, 19.8], [14, 23.0]];
const WALK_MPH = [[1.8, 2.3], [2.2, 2.8], [2.5, 3.0], [3.1, 3.8], [3.7, 4.8], [4.2, 5.5], [4.7, 7.0], [5.25, 8.5]];
const CYCLE_MPH = [[9, 4.0], [11, 6.8], [13, 8.0], [15, 10.0], [17.5, 12.0]];
const interp = (table, x) => {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) if (x <= table[i][0]) { const [x0, y0] = table[i - 1], [x1, y1] = table[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return table.at(-1)[1];
};
export const EFFORTS = ["easy", "moderate", "hard"];
const CORE = /plank|dead ?bug|bird|crunch|sit-?up|hollow|leg raise|\babs?\b|core|superman|glute bridge|bridge|stretch|mobility|calf/i;
/** Which Compendium row a set belongs to. */
export function setCategory(s) {
  if (usesE1rm(s.exercise || "") || (+s.weight > 0 && !/vest|calf|pull|chin|dip|push/i.test(s.exercise || ""))) return "weights";
  return CORE.test(s.exercise || "") ? "light" : "calisthenics";
}
// time a set takes including the rest after it: ~3 s a rep (per side doubles it), holds as stated
const REST = { weights: 120, calisthenics: 60, light: 45 };
export const setSeconds = (s, cat = setCategory(s)) => ((s.secs || (s.reps || 0) * 3) * (s.side ? 2 : 1)) + REST[cat];

const BUILTIN = /^(run|run_vest|walk|cycle|swim|class|lift)$/;
/** { kcal, source: "measured" | "estimate" | "default", minutes, met, estimated_minutes, why } for one logged session. */
export function workoutKcal(w, settings = {}) {
  const measured = parseFloat(w.kcal);
  if (Number.isFinite(measured) && measured > 0) return { kcal: measured, source: "measured", why: "measured (watch / Strava / typed)" };
  const kg = parseFloat(settings.body_kg) > 0 ? parseFloat(settings.body_kg) : 70;
  const effort = EFFORTS.includes(w.effort) ? w.effort : "moderate";
  const minIn = parseFloat(w.duration_min) > 0 ? parseFloat(w.duration_min) : null, km = parseFloat(w.distance_km) > 0 ? parseFloat(w.distance_km) : null;
  const net = (met, minutes) => Math.max(0, Math.round((met - 1) * kg * minutes / 60));
  const r1 = (x) => Math.round(x * 10) / 10;
  if (w.sets?.length) {
    const parts = new Map(); let secs = 0;
    for (const s of w.sets) { const c = setCategory(s), t = setSeconds(s, c); secs += t; parts.set(c, (parts.get(c) || 0) + t); }
    const minutes = minIn ?? Math.max(1, Math.round(secs / 60));
    const met = [...parts].reduce((a, [c, t]) => a + COMPENDIUM[c][effort] * t, 0) / secs;
    const mix = [...parts].sort((a, b) => b[1] - a[1]).map(([c]) => `${COMPENDIUM[c].label} ${COMPENDIUM[c][effort]}`).join(", ");
    return { kcal: net(met, minutes), source: "estimate", minutes, met: r1(met), estimated_minutes: minIn == null, effort,
      why: `${minutes} min${minIn == null ? " (estimated from your sets)" : ""} × ${r1(met)} MET (${effort}: ${mix}) × ${r1(kg)} kg, net of resting` };
  }
  const k = String(w.kind || ""), builtin = BUILTIN.test(k);
  if (builtin && minIn) {
    let met, what;
    const mph = km ? km / 1.60934 / (minIn / 60) : null;
    if (/run/.test(k)) { met = mph ? interp(RUN_MPH, mph) : COMPENDIUM.run[effort]; what = mph ? `running ${r1(km / (minIn / 60))} km/h` : `running, ${effort}`; }
    else if (k === "walk") { met = mph ? interp(WALK_MPH, mph) : COMPENDIUM.walk[effort]; what = mph ? `walking ${r1(km / (minIn / 60))} km/h` : `walking, ${effort}`; }
    else if (k === "cycle") { met = mph ? interp(CYCLE_MPH, mph) : COMPENDIUM.cycle[effort]; what = mph ? `cycling ${r1(km / (minIn / 60))} km/h` : `cycling, ${effort}`; }
    else if (k === "swim") { met = COMPENDIUM.swim[effort]; what = `swimming laps, ${effort}`; }
    else if (k === "class") { met = COMPENDIUM.class[effort]; what = `HIIT / class, ${effort}`; }
    else { met = COMPENDIUM.weights[effort]; what = `weights, ${effort}`; }
    return { kcal: net(met, minIn), source: "estimate", minutes: minIn, met: r1(met), estimated_minutes: false, effort, why: `${minIn} min × ${r1(met)} MET (${what}) × ${r1(kg)} kg, net of resting` };
  }
  const v = parseFloat(settings["burn_" + k]);
  const kcal = Number.isFinite(v) ? v : parseFloat(settings.burn_other || "0") || 0;
  return { kcal, source: "default", why: builtin ? "a fixed default — add minutes for a Compendium estimate" : "your figure for this kind (Settings)" };
}

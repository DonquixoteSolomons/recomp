/* Adaptive expenditure engine. Pure functions over arrays — no DOM, no DB.

   Never a formula. Expenditure is back-calculated from what happened:
       tdee ≈ mean(logged intake) − (Δweight_kg × 7700) / days
   Weight is smoothed with an EMA for display; the *rate* uses a least-squares
   slope on raw readings (an EMA endpoint lags a steady drift by ~1/alpha days).
   Days inside the creatine settling window are excluded from the weight side. */

export const KCAL_PER_KG = 7700;
export const EMA_ALPHA = 0.10;
export const MIN_DAYS = 7;
export const INCOMPLETE_KCAL = 1000;   // a day logged under this is a forgotten day, not a fast
export const TREND_GAP_DAYS = 14;      // a gap longer than this restarts the trend at the next reading

const dayOf = (d) => (d instanceof Date ? d : new Date(d + "T00:00:00"));
const isoDay = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = dayOf(iso); d.setDate(d.getDate() + n); return isoDay(new Date(d.getTime() - d.getTimezoneOffset() * 60000)); };
const daysBetween = (a, b) => Math.round((dayOf(b) - dayOf(a)) / 864e5);

export function creatineWindow(settings) {
  const start = settings.creatine_start;
  if (!start) return null;
  const settle = parseInt(settings.creatine_settle_days || "28", 10);
  return [start, addDays(start, settle)];
}

/** body rows → one point per day: the LAST reading of the day (a re-weigh replaces the first,
    which is also what the Renpho app shows), an EMA trend, and that reading's body fat. */
export function weightTrend(bodyRows, settings, alpha = EMA_ALPHA) {
  const byDay = new Map();
  for (const r of [...bodyRows].sort((x, y) => (x.at || "").localeCompare(y.at || ""))) {
    const b = byDay.get(r.day) || { w: [], bf: [] };
    b.w = [r.weight_kg]; if (r.bodyfat_pct != null) b.bf = [r.bodyfat_pct];
    byDay.set(r.day, b);
  }
  const cw = creatineWindow(settings);
  const out = []; let ema = null, prevDay = null;
  for (const day of [...byDay.keys()].sort()) {
    const b = byDay.get(day);
    const w = b.w.reduce((a, x) => a + x, 0) / b.w.length;
    if (prevDay && daysBetween(prevDay, day) > TREND_GAP_DAYS) ema = null;   // April readings must not shape September's trend
    ema = ema == null ? w : ema + alpha * (w - ema);
    prevDay = day;
    out.push({ day, weight: Math.round(w * 100) / 100, trend: Math.round(ema * 100) / 100,
      bodyfat: b.bf.length ? Math.round(b.bf.reduce((a, x) => a + x, 0) / b.bf.length * 10) / 10 : null,
      creatine: !!(cw && day >= cw[0] && day <= cw[1]) });
  }
  return out;
}

/** Estimated burn of one logged session, from settings (per workout kind). */
export function sessionKcal(workout, settings) {
  const measured = parseFloat(workout.kcal);
  if (Number.isFinite(measured) && measured > 0) return measured;     // from a watch / Strava screenshot
  const v = parseFloat(settings["burn_" + workout.kind]);
  return Number.isFinite(v) ? v : parseFloat(settings.burn_other || "0") || 0;
}

/** Last 7 days at a glance. */
export function weekSummary(meals, workouts, bodyRows, settings, asOf) {
  const start = addDays(asOf, -6);
  const intake = dailyIntake(meals.filter(m => m.day >= start && m.day <= asOf));
  const pf = parseFloat(settings.protein_floor_g || "0");
  const complete = [...intake.values()].filter(v => v.kcal >= INCOMPLETE_KCAL);
  const proteinDays = [...intake.values()].filter(v => v.protein >= pf).length;
  const sessions = workouts.filter(w => w.day >= start && w.day <= asOf);
  const trend = weightTrend(bodyRows.filter(b => b.day >= addDays(start, -7) && b.day <= asOf), settings);
  const t0 = trend.find(p => p.day >= start) || trend[0], t1 = trend.at(-1);
  return {
    days_logged: intake.size, complete_days: complete.length,
    kcal_avg: complete.length ? Math.round(complete.reduce((a, v) => a + v.kcal, 0) / complete.length) : null,
    protein_avg: intake.size ? Math.round([...intake.values()].reduce((a, v) => a + v.protein, 0) / intake.size) : null,
    protein_days: proteinDays, sessions: sessions.length, session_kcal: Math.round(sessionsKcal(sessions, settings)),
    weight_from: t0?.trend ?? null, weight_to: t1?.trend ?? null, bodyfat: t1?.bodyfat ?? null,
  };
}
export const sessionsKcal = (workouts, settings) => workouts.reduce((a, w) => a + sessionKcal(w, settings), 0);

/** First-week targets from a few facts, until the engine can measure. Mifflin-St Jeor for the
    resting side; the activity factor covers the day's non-training movement only, because logged
    sessions are added on top per day. Goal moves the base and the protein range. */
export function provisionalTargets({ sex = "male", age = 30, height_cm = 170, weight_kg = 70, activity = "desk", goal = "recomp" }) {
  const bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + (sex === "female" ? -161 : 5);
  const factor = { desk: 1.2, mixed: 1.35, feet: 1.5 }[activity] ?? 1.2;
  const adjust = { recomp: -250, cut: -500, maintain: 0, gain: 250 }[goal] ?? -250;
  const perKg = goal === "recomp" || goal === "cut" ? [1.8, 2.2] : [1.6, 2.0];
  const r5 = (x) => Math.round(x / 5) * 5, r50 = (x) => Math.round(x / 50) * 50;
  return {
    provisional_kcal: Math.max(r50(bmr), r50(bmr * factor + adjust)),   // never below resting needs on a rest day, whatever the goal
    recomp_deficit_kcal: Math.abs(Math.min(0, adjust)) || 250,
    protein_floor_g: r5(weight_kg * perKg[0]), protein_ceiling_g: r5(weight_kg * perKg[1]),
    weight_lo_kg: goal === "recomp" || goal === "maintain" ? Math.round((weight_kg - 2) * 10) / 10 : null,
    weight_hi_kg: goal === "recomp" || goal === "maintain" ? Math.round((weight_kg + 2) * 10) / 10 : null,
    bmr: Math.round(bmr),
  };
}

/** Consecutive logged days ending today (or yesterday, if today is not complete yet).
    A day counts when its intake reaches INCOMPLETE_KCAL — the same bar the engine uses.
    { days, today: whether today already counts } */
export function streak(meals, asOf, minKcal = INCOMPLETE_KCAL) {
  const intake = dailyIntake(meals);
  const counts = (d) => (intake.get(d)?.kcal || 0) >= minKcal;
  const today = counts(asOf);
  let d = today ? asOf : addDays(asOf, -1), days = 0;
  while (counts(d)) { days++; d = addDays(d, -1); }
  return { days, today };
}

export function dailyIntake(meals) {
  const m = new Map();
  for (const r of meals) {
    const d = m.get(r.day) || { kcal: 0, lo: 0, hi: 0, protein: 0, n: 0 };
    d.kcal += r.kcal; d.lo += r.kcal_lo; d.hi += r.kcal_hi; d.protein += r.protein_g; d.n++;
    m.set(r.day, d);
  }
  return m;
}

function slopePerDay(points) {
  if (points.length < 2) return 0;
  const d0 = points[0].day;
  const xs = points.map(p => daysBetween(d0, p.day)), ys = points.map(p => p.weight);
  const n = xs.length, mx = xs.reduce((a, x) => a + x, 0) / n, my = ys.reduce((a, y) => a + y, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (!sxx) return 0;
  return xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
}

const confidence = (n) => n < MIN_DAYS ? ["none", 0] : n < 14 ? ["low", 0.12] : n < 21 ? ["medium", 0.08] : ["good", 0.05];

/** Estimate over the `window` days ending the day before `asOf`. */
export function estimateExpenditure(meals, bodyRows, settings, asOf, window = 21, workouts = []) {
  const end = addDays(asOf, -1), start = addDays(end, -(window - 1));
  const deficit = parseFloat(settings.recomp_deficit_kcal || "250");
  const intake = dailyIntake(meals.filter(m => m.day >= start && m.day <= end));
  const good = [...intake.entries()].filter(([, v]) => v.kcal >= INCOMPLETE_KCAL);
  const trend = weightTrend(bodyRows.filter(b => b.day >= start && b.day <= end), settings).filter(p => !p.creatine);

  const base = { as_of: asOf, window_days: window, days_with_intake: good.length, intake_avg: null,
    trend_start: null, trend_end: null, tdee: null, tdee_lo: null, tdee_hi: null, target: null, confidence: "none", note: "",
    session_avg: null, rest_base: null, sessions_in_window: 0 };
  if (good.length < MIN_DAYS) { base.note = `${good.length} usable days of intake; need ${MIN_DAYS}.`; return base; }
  base.intake_avg = Math.round(good.reduce((a, [, v]) => a + v.kcal, 0) / good.length);
  if (trend.length < 2) { base.note = "Not enough weigh-ins outside the creatine window to read a trend."; return base; }

  const t0 = trend[0], t1 = trend[trend.length - 1];
  const span = Math.max(1, daysBetween(t0.day, t1.day));
  const deltaKg = slopePerDay(trend) * span;
  const storedPerDay = deltaKg * KCAL_PER_KG / span;
  const n = good.length;
  const avg = good.reduce((a, [, v]) => a + v.kcal, 0) / n;
  const avgLo = good.reduce((a, [, v]) => a + v.lo, 0) / n, avgHi = good.reduce((a, [, v]) => a + v.hi, 0) / n;
  const tdee = avg - storedPerDay;
  const [conf, band] = confidence(Math.min(n, span + 1));
  // the measured average contains whatever training happened; take it back out to get a rest-day base
  const inWindow = workouts.filter(w => w.day >= start && w.day <= end);
  const sessionAvg = sessionsKcal(inWindow, settings) / window;
  Object.assign(base, {
    trend_start: t0.trend, trend_end: t1.trend,
    tdee: Math.round(tdee), tdee_lo: Math.round((avgLo - storedPerDay) * (1 - band)), tdee_hi: Math.round((avgHi - storedPerDay) * (1 + band)),
    target: Math.round(tdee - deficit), confidence: conf,
    session_avg: Math.round(sessionAvg), rest_base: Math.round(tdee - sessionAvg), sessions_in_window: inWindow.length,
    note: `${n} days intake, trend ${t0.trend} to ${t1.trend} kg over ${span} d (${deltaKg >= 0 ? "+" : ""}${deltaKg.toFixed(2)} kg, ${storedPerDay >= 0 ? "+" : ""}${Math.round(storedPerDay)} kcal/d stored).`,
  });
  return base;
}

/** Today's calorie band: a rest-day base plus whatever sessions were logged today.
    Sessions move calories between days; they never change the week's total, which is
    anchored to the measured expenditure (or, before that, to provisional_kcal as the base). */
export function currentTarget(estimate, settings, todaysWorkouts = []) {
  const deficit = parseFloat(settings.recomp_deficit_kcal || "250");
  const today = sessionsKcal(todaysWorkouts, settings);
  if (!estimate || estimate.confidence === "none") {
    const base = parseFloat(settings.provisional_kcal || "2000");
    return { source: "provisional", base, sessions: today, target: base + today, lo: base + today - 100, hi: base + today + 100,
      tdee: null, confidence: "none",
      note: "Formula-free estimate needs about 7 logged days with weigh-ins. Until then provisional_kcal is the rest-day base." };
  }
  const restTarget = estimate.rest_base - deficit;
  const spread = (estimate.tdee_hi - estimate.tdee_lo) / 2;
  return { source: "measured", base: restTarget, sessions: today, target: Math.round(restTarget + today),
    lo: Math.round(restTarget + today - spread), hi: Math.round(restTarget + today + spread),
    tdee: estimate.tdee, rest_base: estimate.rest_base, session_avg: estimate.session_avg,
    confidence: estimate.confidence, as_of: estimate.as_of, note: estimate.note };
}

/** The question asked seven times in the chat, answered every time. */
export function verdict(totals, hasMeals, settings, target) {
  const pf = parseFloat(settings.protein_floor_g || "150"), pc = parseFloat(settings.protein_ceiling_g || "160");
  const p = totals.protein, k = totals.kcal;
  let protein, protein_msg, kcal, kcal_msg;
  if (p < pf) { protein = "short"; protein_msg = `${Math.round(pf - p)}g short of the ${pf}g floor`; }
  else if (p <= pc) { protein = "hit"; protein_msg = "protein floor hit"; }
  else { protein = "over"; protein_msg = `${Math.round(p - pc)}g over the ${pc}g ceiling — not a problem`; }
  if (!hasMeals) { kcal = "under"; kcal_msg = "nothing logged yet"; }
  else if (k < target.lo) { kcal = "under"; kcal_msg = `${Math.round(target.lo - k)} under the band — fine if protein is hit`; }
  else if (k <= target.hi) { kcal = "in"; kcal_msg = "calories in band"; }
  else { kcal = "over"; kcal_msg = `${Math.round(k - target.hi)} over the band`; }
  return { protein, protein_msg, kcal, kcal_msg, ok_to_end: hasMeals && protein !== "short" && kcal !== "over" };
}

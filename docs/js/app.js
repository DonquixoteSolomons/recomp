/* Recomp — phone UI. No server: IndexedDB for data, Gemini for photos, GitHub for durability.
   Today = status + log. Inputs live in bottom sheets opened from the action bar. */
import * as db from "./db.js";
import { DEFAULT_PRODUCTS, shake, recentFoods, normFoodLabel, EXERCISES, e1rm, liftProgress, cleanBackfillLabel } from "./foods.js";
import * as eng from "./engine.js";
import { estimate as runGemini, readLabel, readWorkout, prepareImage, DEFAULT_MODEL, RETIRED_MODELS } from "./estimate.js";
import * as sync from "./sync.js";
import { detectBarcode, lookupBarcode, unitFor, normalizeServing } from "./barcode.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (n, d = 0) => Number(n || 0).toLocaleString("en-SG", { maximumFractionDigits: d, minimumFractionDigits: d });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const SGT = "Asia/Singapore";
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: SGT });
const nowHM = () => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: SGT, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); return p === "24:00" ? "00:00" : p; };
/** Timestamp for an entry on the viewed day at the given HH:MM (defaults: now if today, 12:00 otherwise). */
const atFor = (hm) => `${state.day}T${hm || (state.day === todayStr() ? nowHM() : "12:00")}+08:00`;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// weight is stored in kg; shown and typed in the person's unit
const unit = () => (state.settings.units === "lb" ? "lb" : "kg");
const toUnit = (kg) => unit() === "lb" ? kg * 2.20462 : kg;
const fromUnit = (x) => unit() === "lb" ? x / 2.20462 : x;
const wfmt = (kg, dp = 1) => `${fmt(toUnit(kg), dp)} ${unit()}`;

const state = { day: todayStr(), settings: {}, data: null, tab: "today", trend: null, products: [],
  est: null, estFiles: [], fixing: null, fixImages: [], share: 1, items: [], wo: { kind: null, sets: [], shot: null } };

let toastT;
function toast(msg, ms = 1800, kind = null) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  kind ??= /^(added|valued|saved|logged|shake added|weight logged|.* logged)/i.test(msg) ? "good" : /couldn't|failed|didn't answer/i.test(msg) ? "bad" : "";
  t.className = "toast " + kind; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
}
// a short tick on every press, like a game (Android; a no-op elsewhere)
document.addEventListener("pointerdown", (e) => { if (e.target.closest(".btn,.nav button,.opt,.seg button,.chip,.stat,.icon,.log li")) navigator.vibrate?.(8); }, { passive: true });
const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;

// ------------------------------------------------------------ sheets
const sheet = (name) => $(`#sheet-${name}`);
function openSheet(name) {
  const d = sheet(name); if (!d.open) d.showModal();
  if (name === "meal") renderRecent();
  if (name === "shake") { applyLastShake(); previewShake(); }
  if (name === "workout") renderWorkoutSheet();
}
const closeSheets = () => $$("dialog.sheet").forEach(d => d.open && d.close());
$$("#actionbar [data-sheet]").forEach(b => b.onclick = () => openSheet(b.dataset.sheet));
$$("dialog.sheet [data-close]").forEach(b => b.onclick = () => b.closest("dialog").close());
$$("dialog.sheet").forEach(d => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));   // tap the backdrop
// closing the meal sheet with nothing in progress forgets the share choice (photos and text stay for an accidental close)
sheet("meal").addEventListener("close", () => {
  if (state.fixing) resetEstimate();                                                                       // a hand-valuing abandoned: the row goes back to the retry queue
  else if (!state.est) { state.share = 1; $$("#est-share button").forEach(x => x.classList.toggle("on", x.dataset.v === "1")); }
});

// ------------------------------------------------------------ backup: dirty flag, flush on hide and on next open
let backupT = null;
async function markDirty() { await db.setSetting("dirty", "1"); scheduleBackup(5000); }
function scheduleBackup(ms = 5000) {
  if (state.settings.backup_auto !== "1" || !state.settings.gh_token || !state.settings.gh_repo) return;
  clearTimeout(backupT); backupT = setTimeout(flushBackup, ms);
}
async function flushBackup() {
  if ((await db.setting("dirty")) !== "1") return;
  if (!state.settings.gh_token || !state.settings.gh_repo) return;
  try {
    await sync.pushBackup(); await db.setSetting("dirty", "0");
    $("#backup-state").textContent = "backed up " + new Date().toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" }); await syncOk();
  } catch (e) { $("#backup-state").textContent = "backup failed: " + e.message; await syncFailed("Backup", e); }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { clearTimeout(backupT); flushBackup(); } else { retryPending(); maybePullBody(); } });
// the Renpho job runs every 3 h; a morning weigh-in should show up on the next open after it lands, not tomorrow
let pulling = false;
async function maybePullBody() {
  const s = state.settings; if (pulling || !s.gh_token || !s.gh_repo) return;
  if (s.last_pull_at && Date.now() - new Date(s.last_pull_at).getTime() < 60 * 60_000) return;
  pulling = true;
  try {
    const r = await sync.pullBody();
    if (r.ok) { await db.setSetting("last_pull_at", new Date().toISOString()); state.settings.last_pull_at = new Date().toISOString(); await syncOk(); if (r.added) { toast(`${r.added} new weigh-in${r.added > 1 ? "s" : ""}`); await loadDay(); } }
  } catch (e) { await syncFailed("Weigh-in pull", e); } finally { pulling = false; }
}
setInterval(() => document.visibilityState === "visible" && retryPending(), 120_000);
window.addEventListener("online", () => retryPending({ force: true }));
async function changed() { await loadDay(); await markDirty(); }

async function syncFailed(what, e) { await db.setSetting("gh_error", `${what} failed — ${e.message}${e.auth ? ". Fix the token or repo in ⚙ Settings." : ""}`); showSyncWarn(); }
async function syncOk() { if (await db.setting("gh_error")) { await db.setSetting("gh_error", ""); showSyncWarn(); } }
async function showSyncWarn() { const msg = await db.setting("gh_error", ""); const el = $("#sync-warn"); el.hidden = !msg; el.textContent = msg ? "⚠ " + msg : ""; }

const backupStateText = () => state.settings.last_backup ? "last backup " + new Date(state.settings.last_backup).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : (state.settings.gh_token ? "never backed up" : "no GitHub token — not backing up");

// ------------------------------------------------------------ day model
async function loadDay(day = state.day) {
  state.day = day;
  state.settings = await db.allSettings();
  const s = state.settings;
  const meals = (await db.byIndex("meals", "day", day)).sort((a, b) => a.at.localeCompare(b.at));
  const workouts = (await db.byIndex("workouts", "day", day)).sort((a, b) => a.at.localeCompare(b.at));
  const allMeals = await db.all("meals"), allBody = await db.all("body"), allWorkouts = await db.all("workouts");
  const totals = { kcal: 0, lo: 0, hi: 0, protein: 0, whey: 0 };
  for (const m of meals) { totals.kcal += m.kcal; totals.lo += m.kcal_lo; totals.hi += m.kcal_hi; totals.protein += m.protein_g; if (m.source === "shake" || /whey/i.test(m.label || "")) totals.whey += m.protein_g; }
  const exp = eng.estimateExpenditure(allMeals, allBody, s, todayStr(), 21, allWorkouts);
  const target = eng.currentTarget(exp, s, workouts);
  const v = eng.verdict(totals, meals.length > 0, s, target);
  const trend = eng.weightTrend(allBody.filter(b => b.day >= eng.addDays(todayStr(), -120)), s), latest = trend.at(-1) || null;
  const wl = parseFloat(s.weight_lo_kg), wh = parseFloat(s.weight_hi_kg), bounded = Number.isFinite(wl) && Number.isFinite(wh);
  const week = eng.weekSummary(allMeals, allWorkouts, allBody, s, todayStr());
  const streak = eng.streak(allMeals, todayStr(), eng.incompleteKcal(s));
  state.all = { meals: allMeals, workouts: allWorkouts, body: allBody };
  state.data = { day, is_today: day === todayStr(), meals, workouts, totals, target, verdict: v, exp, week, streak,
    weighed_today: allBody.some(b => b.day === day),
    body: latest ? { ...latest, out_of_bounds: bounded && !(wl <= latest.trend && latest.trend <= wh) } : null,
    pf: parseFloat(s.protein_floor_g), pc: parseFloat(s.protein_ceiling_g) };
  render();
}

/** The person's workout kinds (Settings). Strength (key "lift") is always there: it is the one with sets. */
function kinds() {
  let list = []; try { list = JSON.parse(state.settings.workout_kinds || "[]"); } catch {}
  list = list.filter(k => k && k.key && k.label);
  if (!list.some(k => k.key === "lift")) list.push({ key: "lift", label: "Strength" });
  return list;
}
const LEGACY_KINDS = { revl_move: "REVL Move", revl_sweat: "REVL Sweat", revl_perform: "REVL Perform", run_vest: "Vest run", calves: "Calves", run: "Run", lift: "Strength", swim: "Swim", cycle: "Cycle", walk: "Walk", class: "Class", other: "Workout" };
const labelKind = (k) => kinds().find(x => x.key === k)?.label || LEGACY_KINDS[k] || k;
const workoutLine = (w, { kcal = true } = {}) => {
  if (w.sets?.length) { const by = {}; for (const s of w.sets) (by[s.exercise] ||= []).push(`${s.weight}×${s.reps}`); return Object.entries(by).map(([e, ss]) => `${e} ${ss.join(", ")}`).join(" · "); }
  return [w.duration_min ? `${w.duration_min} min` : null, w.distance_km ? `${w.distance_km} km` : null, kcal && w.kcal ? `${w.kcal} kcal` : null, w.detail].filter(Boolean).join(" · ");
};

let lastVerdictOk = null;
function render() {
  const d = state.data; if (!d) return;
  const dt = new Date(d.day + "T12:00:00+08:00");
  $("#day-label b").textContent = d.is_today ? "Today" : dt.toLocaleDateString("en-SG", { weekday: "long" });
  $("#day-sub").textContent = dt.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: d.is_today ? undefined : "numeric" });
  $("#day-next").disabled = d.is_today;

  // top strip: streak (lit once today counts) and the latest weigh-in
  const st = $("#streak"); st.querySelector("b").textContent = d.streak.days; st.classList.toggle("on", d.streak.today && d.streak.days > 0);
  st.title = (d.streak.today ? `${d.streak.days} day${d.streak.days === 1 ? "" : "s"} logged in a row` : "Log today to keep it going") + " · one missed day a week doesn't break it";
  const chip = $("#weight-chip");
  if (d.body) {
    chip.hidden = false; chip.classList.toggle("oob", !!d.body.out_of_bounds);
    // one short line: "74.9 kg · 25.9%" today, or the date instead of the fat when the reading is older
    const stale = d.body.day !== todayStr();
    chip.querySelector("b").textContent = wfmt(d.body.weight, 1);
    chip.querySelector("small").textContent = stale ? d.body.day.slice(5).replace("-", "/") : (d.body.bodyfat != null ? `${fmt(d.body.bodyfat, 1)}%` : "");
    chip.title = `${wfmt(d.body.weight, 2)}${d.body.bodyfat != null ? ` · ${fmt(d.body.bodyfat, 1)}% fat` : ""} · ${stale ? d.body.day : "today"}`;
    chip.onclick = () => showTab("trend");
  } else chip.hidden = true;

  const t = d.totals, v = d.verdict, k = d.target, pending = d.meals.filter(m => m.source === "pending").length;
  $("#p-val").textContent = fmt(t.protein, 0); $("#p-range").textContent = `${fmt(d.pf)}–${fmt(d.pc)}`;
  const pmax = d.pc * 1.25;
  $("#p-fill").style.width = Math.min(100, t.protein / pmax * 100) + "%"; $("#p-fill").className = "fill " + v.protein;
  $("#p-floor").style.left = d.pf / pmax * 100 + "%"; $("#p-ceil").style.left = d.pc / pmax * 100 + "%";
  $("#p-foot").textContent = v.protein_msg + (t.whey ? ` · ${Math.round(t.whey / t.protein * 100)}% from whey` : "");
  const kmax = k.hi * 1.2;
  $("#k-val").textContent = fmt(t.kcal); $("#k-range").textContent = `${fmt(k.lo)}–${fmt(k.hi)}`;
  $("#k-fill").style.width = Math.min(100, t.kcal / kmax * 100) + "%"; $("#k-fill").className = "fill " + v.kcal;
  $("#k-band").style.left = k.lo / kmax * 100 + "%"; $("#k-band").style.width = (k.hi - k.lo) / kmax * 100 + "%";
  const sessionNote = k.sessions ? `rest base ${fmt(k.base)} + sessions ${fmt(k.sessions)}` : `rest day · base ${fmt(k.base)}`;
  $("#k-foot").textContent = `${sessionNote} · ${k.source === "measured" ? `measured, ${k.confidence} confidence` : "provisional until the engine has data"}` + (t.kcal ? ` · range ${fmt(t.lo)}–${fmt(t.hi)}` : "");

  const vd = $("#verdict"), tone = v.kcal === "over" || v.protein === "short" ? "warn" : "ok";
  const head = !d.meals.length ? "Nothing logged yet." : v.ok_to_end ? "Day complete." : v.protein === "short" ? "Protein first." : "Over the band today.";
  const weekNote = v.kcal === "over" && d.week.kcal_avg != null ? ` · the week is what counts: ${fmt(d.week.kcal_avg)} kcal/day so far` : "";
  vd.className = "verdict " + (d.meals.length ? tone : "") + (tone === "ok" && lastVerdictOk === false && d.is_today ? " pop" : "");
  lastVerdictOk = d.is_today ? tone === "ok" : lastVerdictOk;
  vd.innerHTML = `<span class="lamp"></span><div><b>${head}</b><small>${pending ? `${pending} meal${pending > 1 ? "s" : ""} waiting for AI — totals are short · ` : ""}${v.protein_msg} · ${v.kcal_msg}${weekNote}</small></div>`;

  // daily goals, Duolingo-quest style
  const goals = [
    { label: `Protein ${fmt(d.pf)} g`, done: v.protein !== "short" },
    { label: "Calories", done: d.meals.length > 0 && v.kcal !== "over" && (t.kcal >= k.lo || !d.is_today) },
    { label: "Weigh-in", done: d.weighed_today },
    { label: "Session", done: d.workouts.length > 0, opt: true },
  ];
  $("#goals").innerHTML = goals.map(g => `<li class="${g.done ? "done" : ""}${g.opt && !g.done ? " opt" : ""}"><span class="box">${g.done ? icon("check") : ""}</span>${esc(g.label)}</li>`).join("");

  const rows = [...d.meals.map(m => ({ ...m, _t: "meal" })), ...d.workouts.map(w => ({ ...w, _t: "workout" }))].sort((a, b) => a.at.localeCompare(b.at));
  $("#log-count").textContent = `${d.meals.length} meal${d.meals.length === 1 ? "" : "s"} · ${d.workouts.length} workout${d.workouts.length === 1 ? "" : "s"}`;
  const log = $("#log"); log.innerHTML = rows.length ? "" : `<li class="empty">Nothing logged yet — Meal, Shake or Workout below.</li>`;
  for (const r of rows) {
    const li = document.createElement("li"), time = (r.at || "").slice(11, 16);
    if (r._t === "meal") {
      const parked = r.source === "pending", isShake = r.source === "shake";
      li.className = parked ? "pending" : isShake ? "shake" : "";
      const sub = [time, parked ? "waiting for AI · retries on its own" : r.source === "backfill" ? "from chat" : r.source === "backfill-ai" || r.source === "backfill-est" ? "from chat · valued" : r.source === "photo" ? "estimated" : r.source === "label" ? "label" : r.source === "barcode" ? "barcode" : null,
        r.share_frac < 1 ? `${Math.round(r.share_frac * 100)}% share` : null, r.venue].filter(Boolean).join(" · ");
      li.innerHTML = `<span class="ic">${icon(isShake ? "shake" : "meal")}</span><span class="l"><b>${esc(r.label)}</b><small>${esc(sub)}</small></span><span class="n"><b>${parked ? "?" : fmt(r.protein_g, 0) + " g"}</b><small>${parked ? "?" : fmt(r.kcal) + " kcal"}</small></span>`;
      li.onclick = () => openRow(r, "meal");
    } else {
      li.className = "workout";
      li.innerHTML = `<span class="ic">${icon("lift")}</span><span class="l"><b>${labelKind(r.kind)}</b><small>${esc([time, workoutLine(r, { kcal: false })].filter(Boolean).join(" · "))}</small></span><span class="n"><b>${r.kcal ? fmt(r.kcal) : fmt(eng.sessionKcal(r, state.settings))}</b><small>${r.kcal ? "kcal" : "kcal · default"}</small></span>`;
      li.onclick = () => openRow(r, "workout");
    }
    log.appendChild(li);
  }

  const w = d.week;
  $("#week").innerHTML = `<div class="card-head"><h2>This week</h2><span class="muted">${w.days_logged} day${w.days_logged === 1 ? "" : "s"} logged</span></div>
    <div class="week">
      <div class="stat-tile"><b>${w.kcal_avg != null ? fmt(w.kcal_avg) : "—"}</b><span>kcal / complete day</span></div>
      <div class="stat-tile"><b>${w.protein_days}/${w.days_logged || 0}</b><span>days protein hit</span></div>
      <div class="stat-tile"><b>${w.sessions}</b><span>sessions · ${fmt(w.session_kcal)} kcal</span></div>
      <div class="stat-tile"><b>${w.weight_to != null ? fmt(toUnit(w.weight_to), 1) : "—"}</b><span>${w.weight_from != null && w.weight_to != null ? `trend ${w.weight_to - w.weight_from >= 0 ? "+" : ""}${fmt(toUnit(w.weight_to - w.weight_from), 2)} ${unit()}` : "weight trend"}${w.bodyfat != null ? ` · ${fmt(w.bodyfat, 1)}% fat` : ""}</span></div>
    </div>`;
  $("#est-hint").hidden = !!state.settings.gemini_key;
  showSyncWarn();
}
function showTab(name) { const t = $$(".tab").find(x => x.dataset.tab === name); if (t) t.click(); }

// ------------------------------------------------------------ meals
/** share scales the numbers; share_frac is what the row shows (defaults to share; pass it when the numbers are already scaled). */
async function insertMeal({ label, kcal, lo, hi, protein, source, share = 1, share_frac = share, venue = null, detail = null, needs_review = 0, hm = null }) {
  const at = atFor(hm);
  return db.add("meals", { day: at.slice(0, 10), at, label, kcal: Math.round(kcal * share), kcal_lo: Math.round(lo * share), kcal_hi: Math.round(hi * share),
    protein_g: Math.round(protein * share * 10) / 10, source, share_frac, venue, detail, needs_review });
}

// recents: what you actually repeat
function hiddenRecents() { try { return JSON.parse(state.settings.recent_hidden || "[]"); } catch { return []; } }
function renderRecent() {
  const wrap = $("#recent-wrap"), box = $("#recent"); box.innerHTML = "";
  const list = recentFoods(state.all?.meals || [], todayStr(), 8, { minCount: 3, hidden: hiddenRecents() });
  wrap.hidden = !list.length;
  for (const f of list) {
    const w = document.createElement("div"); w.className = "rchip";
    w.innerHTML = `<button class="chip">${esc(f.label)}<small>${fmt(f.protein_g, 0)} g · ${fmt(f.kcal)} kcal · ×${f.n}</small></button><button class="rx" aria-label="Hide">${icon("close")}</button>`;
    w.querySelector(".chip").onclick = async (e) => { e.currentTarget.disabled = true; await insertMeal({ label: f.label, kcal: f.kcal, lo: f.kcal_lo, hi: f.kcal_hi, protein: f.protein_g, source: "repeat" }); toast(`Added ${f.label}`); closeSheets(); changed(); };
    w.querySelector(".rx").onclick = async () => { const list = hiddenRecents(); list.push(normFoodLabel(f.label)); await db.setSetting("recent_hidden", JSON.stringify(list)); state.settings.recent_hidden = JSON.stringify(list); renderRecent(); toast("Hidden from regulars"); };
    box.appendChild(w);
  }
}

// your own past entries as you type — MFP's "doesn't retain foods you've entered" complaint; regulars stay 3+, this is the search
function renderRecall() {
  const q = normFoodLabel($("#est-text").value); const box = $("#recall"); box.innerHTML = "";
  if (q.length < 2 || state.fixing) return;
  const seen = new Set(), hits = [];
  for (const m of [...(state.all?.meals || [])].sort((a, b) => b.at.localeCompare(a.at))) {
    if (m.source === "shake" || m.source === "pending" || !m.kcal) continue;
    const k = normFoodLabel(m.label); if (!k.includes(q) || seen.has(k)) continue;
    seen.add(k); hits.push(m); if (hits.length === 4) break;
  }
  for (const m of hits) {
    const b = document.createElement("button"); b.className = "chip recall";
    b.innerHTML = `${esc(m.label)}<small>${fmt(m.protein_g, 0)} g · ${fmt(m.kcal)} kcal · ${m.day.slice(5).replace("-", "/")}</small>`;
    b.onclick = async () => { b.disabled = true; await insertMeal({ label: m.label, kcal: m.kcal, lo: m.kcal_lo, hi: m.kcal_hi, protein: m.protein_g, source: "repeat" }); toast(`Added ${m.label}`); resetEstimate(); closeSheets(); changed(); };
    box.appendChild(b);
  }
}
$("#est-text").addEventListener("input", renderRecall);

// share segmented
$$("#est-share button").forEach(b => b.onclick = () => { $$("#est-share button").forEach(x => x.classList.toggle("on", x === b)); state.share = parseFloat(b.dataset.v); });

// photos
function onPhotos(e) {
  state.estFiles = [...state.estFiles, ...e.target.files].slice(0, 4);
  const t = $("#est-thumbs"); t.innerHTML = "";
  for (const f of state.estFiles) { const img = document.createElement("img"); img.src = URL.createObjectURL(f); img.alt = ""; t.appendChild(img); }
  e.target.value = "";
}
$("#est-photo").addEventListener("change", (e) => { onPhotos(e); setMealFoot(); });

// the sticky footer holds the one primary action for the current step:
//   an estimate on screen → Discard / Add to log (adds the items too)
//   only scanned items     → Add N items
//   something to estimate  → Estimate
function setMealFoot() {
  const n = state.items.length, more = state.estFiles.length || state.fixImages.length || $("#est-text").value.trim();
  $("#meal-foot").innerHTML = state.est
    ? `<button class="btn ghost" id="est-discard">Discard</button><button class="btn primary" id="est-add">Add to log</button>`
    : n && !more ? `<button class="btn ghost" id="est-discard">Discard</button><button class="btn primary" id="items-add">Add ${n} item${n === 1 ? "" : "s"}</button>`
    : `<button class="btn primary block" id="est-go">Estimate${n ? ` + ${n} item${n === 1 ? "" : "s"}` : ""}</button>`;
}
$("#meal-foot").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "est-go") { if (!state.estFiles.length && !state.fixImages.length && !$("#est-text").value.trim()) return toast("Add a photo or describe it"); runEstimate(); }
  else if (b.id === "est-discard") resetEstimate();
  else if (b.id === "est-add") addEstimate();
  else if (b.id === "items-add") addItems({ close: true });
};
$("#est-text").addEventListener("input", setMealFoot);

// ---- items: scanned packages, each counted in the unit a person thinks in (slices, cans, eggs …)
//      it.unit = { name, grams, source: "pack" | "typical", step } or null (grams only); it.count in units; it.grams overrides
/* count is in units (slices, cans …); a typed gram figure overrides it.
   per-serving numbers scale by servings = grams / serving weight when both are known, else count / units-per-serving;
   per-100 numbers scale by grams, which needs a unit weight (or a typed figure). */
const itemGrams = (it) => it.grams ?? (it.unit?.grams ? it.count * it.unit.grams : (it.basis === "serving" && it.serving_g_or_ml ? it.count / (it.unit?.perServing || 1) * it.serving_g_or_ml : null));
const itemLine = (it) => {
  const g = itemGrams(it);
  const mult = it.basis === "serving" ? (it.serving_g_or_ml && g != null ? g / it.serving_g_or_ml : it.count / (it.unit?.perServing || 1)) : (g ?? 0) / 100;
  return { kcal: it.kcal * mult, protein: it.protein_g * mult, grams: g, count: it.count };
};
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : (w === "patty" ? "patties" : "s")}`;
/** Two facts, kept apart on purpose: the nutrition (always known, or the item would not exist) and
    what one unit weighs (from the pack, typical for the kind of food, or not known at all). */
function unitMeta(it) {
  const u = it.unit, ml = it.basis === "100ml", src = it.via === "barcode" ? "Open Food Facts" : "the label";
  const per = it.basis === "serving" ? `Per serving${it.serving_size ? ` (${it.serving_size})` : ""}: ${fmt(it.kcal)} kcal · ${fmt(it.protein_g, 1)} g protein — ${src}`
                                     : `Per 100 ${ml ? "ml" : "g"}: ${fmt(it.kcal)} kcal · ${fmt(it.protein_g, 1)} g protein — ${src}`;
  const printed = u?.printed && !/^\d+(?:[.,]\d+)?\s*(g|ml)$/i.test(u.printed.trim()) ? ` (pack: ${u.printed})` : "";
  const unitLine = !u ? `Serving size not on record — type the ${ml ? "ml" : "grams"}, or read the pack's label.`
    : u.source === "typical" ? `1 ${u.name} ≈ ${u.grams} g is a typical weight; the pack's serving size isn't on record${u.printed ? ` (it lists ${u.printed} without a weight)` : ""} — read the label to use the real one.`
    : u.grams ? `1 ${u.name} = ${fmt(u.grams, u.grams % 1 ? 1 : 0)} ${ml ? "ml" : "g"}${printed}`
    : `1 ${u.name} = ${u.perServing === 1 ? "1 serving" : `1/${u.perServing} serving`}${printed}; weight not printed`;
  return { per, unitLine, uncertain: !u || u.source === "typical" };
}
function renderItems() {
  const box = $("#items"); box.innerHTML = "";
  state.items.forEach((it, i) => {
    const { kcal, protein, grams } = itemLine(it), u = it.unit, ml = it.basis === "100ml";
    const el = document.createElement("div"); el.className = "item";
    const meta = unitMeta(it);
    el.innerHTML = `<div class="name">${esc(it.product)}<small>${esc(meta.per)}</small><small class="${meta.uncertain ? "warn" : ""}">${esc(meta.unitLine)}</small></div><button class="x" aria-label="Remove">${icon("close")}</button>
      <div class="qty${u ? "" : " g-only"}">
        ${u ? `<button class="step" data-d="-1" aria-label="Fewer">−</button>
        <label class="lbl">${esc(u.name)}s <input class="num" data-f="count" type="number" min="0" step="${u.step}" value="${it.count}" inputmode="decimal"></label>` : ""}
        ${!u || u.grams || it.serving_g_or_ml ? `<label class="lbl">${ml ? "ml" : "g"} <input class="num" data-f="grams" type="number" min="0" step="any" value="${grams != null ? Math.round(grams) : ""}" inputmode="decimal" placeholder="${u ? "" : "how much?"}"></label>` : ""}
        ${u ? `<button class="step" data-d="1" aria-label="More">+</button>` : ""}
      </div>
      ${meta.uncertain ? `<label class="btn ghost small"><input type="file" accept="image/*" hidden data-f="label"><svg><use href="#i-tag"/></svg><span>Read the label</span></label><small class="cardstatus"></small>` : ""}
      <div class="out"><span class="p">${fmt(protein, 1)} g</span> · ${fmt(kcal)} kcal</div>`;
    el.querySelector(".x").onclick = () => { state.items.splice(i, 1); renderItems(); setMealFoot(); };
    el.querySelector('[data-f="label"]')?.addEventListener("change", async (ev) => {
      const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
      const btn = ev.target.closest("label"), note = el.querySelector(".cardstatus");
      const status = (m) => { note.textContent = m; btn.querySelector("span").textContent = "Reading…"; };
      btn.classList.add("busy"); status("reading the panel…");
      try {
        const { data: L, model } = await withModelFallback(() => readLabel({ apiKey: state.settings.gemini_key, model: modelToUse(), image: f, onStatus: status }));
        await rememberModel(model);
        // the pack is the source of truth: its serving size always, its numbers when the panel was read with confidence
        Object.assign(it, { serving_size: L.serving_size ? normalizeServing(L.serving_size) : it.serving_size, serving_g_or_ml: L.serving_g_or_ml || it.serving_g_or_ml, servings_per_pack: L.servings_per_pack ?? it.servings_per_pack });
        if (L.confidence !== "low" && L.kcal > 0) Object.assign(it, { basis: L.basis, kcal: L.kcal, protein_g: L.protein_g, via: "label" });
        it.unit = unitFor(it); it.count = 1; it.grams = it.unit ? null : (it.serving_g_or_ml || null);
        renderItems();
        toast(`Label read: ${L.serving_size ? `serving ${normalizeServing(L.serving_size)}, ` : ""}${fmt(L.kcal)} kcal · ${fmt(L.protein_g, 1)} g ${L.basis === "serving" ? "per serving" : "per 100 " + (L.basis === "100ml" ? "ml" : "g")}`, 3500);
      } catch (err) { btn.classList.remove("busy"); btn.querySelector("span").textContent = "Read the label"; note.textContent = "Couldn't read that label — " + err.message; }
    });
    el.querySelectorAll(".step").forEach(b => b.onclick = () => { const d = Number(b.dataset.d), st = u.step; it.count = Math.max(0, Math.round((it.count + d * st) / st) * st); it.grams = null; renderItems(); });
    el.querySelector('[data-f="count"]')?.addEventListener("input", (ev) => { it.count = parseFloat(ev.target.value) || 0; it.grams = null; refreshItem(el, it); });
    el.querySelector('[data-f="grams"]')?.addEventListener("input", (ev) => {
      const g = parseFloat(ev.target.value); it.grams = Number.isFinite(g) ? g : null;
      if (u && it.grams != null) { const per = u.grams || (it.serving_g_or_ml ? it.serving_g_or_ml / (u.perServing || 1) : null); if (per) it.count = Math.round(it.grams / per * 100) / 100; }
      refreshItem(el, it);
    });
    if (!u) el.querySelector('[data-f="grams"]')?.focus();
    box.appendChild(el);
  });
}
function refreshItem(el, it) {   // live numbers without re-rendering the input the person is typing in
  const { kcal, protein, grams, count } = itemLine(it);
  el.querySelector(".out").innerHTML = `<span class="p">${fmt(protein, 1)} g</span> · ${fmt(kcal)} kcal`;
  const cv = el.querySelector('[data-f="count"]'), gr = el.querySelector('[data-f="grams"]');
  if (cv && document.activeElement !== cv) cv.value = count; if (gr && document.activeElement !== gr && grams != null) gr.value = Math.round(grams);
}
function addItem(L, via) {
  L = { ...L, serving_size: L.serving_size ? normalizeServing(L.serving_size) : L.serving_size };   // "1 แผ่น (21 กรัม)" reads as "1 slice (21 g)" everywhere
  const unit = unitFor(L);
  state.items.push({ ...L, via, unit, count: 1, grams: unit ? null : (L.serving_g_or_ml || null) });
  renderItems(); setMealFoot();
}
/** Log every item as its own row, at the same time, so each is editable and learnable on its own. */
async function addItems({ close = false } = {}) {
  let n = 0;
  for (const it of state.items) {
    const { kcal, protein, grams, count } = itemLine(it); if (!(kcal > 0 || protein > 0)) continue;
    const unitPart = it.unit ? plural(count, it.unit.name) : null, gramsPart = grams != null ? `${Math.round(grams)} ${it.basis === "100ml" ? "ml" : "g"}` : null;
    const amount = [unitPart, unitPart && gramsPart ? gramsPart : (gramsPart || (it.basis === "serving" ? plural(count, "serving") : ""))].filter(Boolean).join(" · ");
    await insertMeal({ label: `${it.product} (${amount})`, kcal, lo: kcal * 0.97, hi: kcal * 1.03, protein, source: it.via, share: 1, detail: { label: it, count, grams, unit: it.unit } }); n++;
  }
  state.items = []; renderItems();
  if (close) { toast(`Added ${n} item${n === 1 ? "" : "s"}`); resetEstimate(); closeSheets(); changed(); }
  return n;
}

/** One photo of a package: the barcode when the phone can read one and Open Food Facts knows it,
    otherwise the model reads the printed nutrition panel. Same result shape either way. */
async function readPackage(file, onStatus) {
  onStatus("looking for a barcode…");
  const code = await detectBarcode(file);
  if (code) {
    onStatus(`barcode ${code} — looking it up…`);
    let missing = false;
    try { const L = await lookupBarcode(code); if (L) { const { thumb } = await prepareImage(file); return { data: L, thumb, via: "barcode" }; } missing = true; onStatus(`${code} isn't in Open Food Facts — trying to read a nutrition panel in this photo…`); }
    catch { onStatus("Open Food Facts didn't answer — reading the label…"); }
    if (missing) {
      try { const r = await withModelFallback(() => readLabel({ apiKey: state.settings.gemini_key, model: modelToUse(), image: file, onStatus })); await rememberModel(r.model); if (r.data.confidence !== "low" && r.data.kcal > 0) return { data: r.data, thumb: r.thumb, via: "label" }; } catch {}
      throw new Error(`${code} isn't in Open Food Facts. Take a photo of the nutrition panel instead (Scan again).`);
    }
  } else onStatus("reading label…");
  const { data, thumb, model } = await withModelFallback(() => readLabel({ apiKey: state.settings.gemini_key, model: modelToUse(), image: file, onStatus }));
  await rememberModel(model);
  return { data, thumb, via: "label" };
}

// package photos -> items with exact values; how much of each is set on the item
$("#est-label").addEventListener("change", async (e) => {
  const files = [...e.target.files]; e.target.value = ""; if (!files.length) return;
  for (const [i, f] of files.entries()) {
    const tag = files.length > 1 ? `${i + 1}/${files.length} · ` : "";
    try {
      const { data: L, via } = await readPackage(f, (m) => $("#est-status").textContent = tag + m);
      addItem(L, via); $("#est-status").textContent = tag + (via === "barcode" ? `Open Food Facts · ${L.code}` : `label read · ${L.confidence}`);
    } catch (err) { $("#est-status").textContent = tag + "couldn't read that package — " + err.message; }
  }
});

// Google retires a model -> switch and retry once
async function withModelFallback(fn) {
  try { return await fn(); }
  catch (e) {
    if (!e.suggestedModel) throw e;
    await db.setSetting("ai_model", e.suggestedModel); state.settings.ai_model = e.suggestedModel;
    await db.setSetting("ai_model_ok", ""); state.settings.ai_model_ok = ""; toast(`Switched model to ${e.suggestedModel}`);
    return fn();
  }
}
// the model that last answered goes first, so a model that is down for days costs one failed call, not one per meal
const modelToUse = () => state.settings.ai_model_ok || state.settings.ai_model || DEFAULT_MODEL;
async function rememberModel(m) { if (m && m !== modelToUse()) { await db.setSetting("ai_model_ok", m); state.settings.ai_model_ok = m; } }

const rawText = (m) => { let d = m.detail; if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = null; } } return d?.raw || m.label; };
const looksPartial = (m) => m.source === "backfill" && m.kcal < 150 && rawText(m).length > 25;

async function runEstimate(correction = null) {
  const prior = correction != null ? state.est : null;
  const text = correction ?? $("#est-text").value;
  $("#est-status").textContent = prior ? "refining…" : "estimating…"; if ($("#est-go")) $("#est-go").disabled = true;
  try {
    const args = { apiKey: state.settings.gemini_key, images: prior ? [] : state.estFiles, text, share: state.share,
      prior, priorImages: prior ? prior.images : state.fixImages, known: state.items.map(it => it.product), onStatus: (m) => $("#est-status").textContent = m };
    const out = await withModelFallback(() => runGemini({ ...args, model: modelToUse() }));
    await rememberModel(out.model);
    const at = state.fixing ? ((await db.get("meals", state.fixing))?.at || atFor()) : atFor();
    const row = { day: at.slice(0, 10), at, text, share: state.share, model: out.model, ident: out.ident, result: out.result,
      thumb: out.thumbs[0] || (prior?.thumb ?? null), usage: out.usage, parent_id: prior?.id ?? null, meal_id: null };
    row.id = await db.add("estimates", row);
    state.est = { ...row, images: out.images.length ? out.images : (prior ? prior.images : state.fixImages) };
    renderEstimate();
    const u = out.usage; $("#est-status").textContent = `${row.model} · ${fmt((u.promptTokenCount || 0) + (u.candidatesTokenCount || 0))} tokens · free tier`;
    if (!state.fixing) retryPending({ force: true });                // Gemini answers again: settle anything parked
  } catch (e) {
    if (prior) { renderEstimate(); $("#est-status").textContent = "Refine failed — " + e.message; return; }   // the earlier estimate stands
    if (e.config) {
      $("#est-status").textContent = ""; $("#est-result").hidden = false;
      $("#est-result").innerHTML = `<div class="estcard err"><b>Couldn't estimate.</b><small>${esc(e.message)}</small></div>`;
      return;
    }
    await parkEstimate(text, e);
  } finally { if ($("#est-go")) $("#est-go").disabled = false; }
}

/* Gemini failed, so the meal goes into the log NOW as an unvalued row, with its text and photos kept.
   retryPending() values it when Gemini answers again; tapping the row lets the person type it in. */
async function parkEstimate(text, err) {
  const logged = await addItems();                                   // the scanned items are exact: they go in now
  const shots = [];
  for (const f of state.estFiles) { try { shots.push(await prepareImage(f)); } catch {} }
  const images = [...shots.map(s => s.data), ...state.fixImages], thumb = shots[0]?.thumb || null;
  let mealId = state.fixing, at;
  if (mealId) {
    const m = await db.get("meals", mealId); at = m?.at || atFor();
    if (m) await db.put("meals", { ...m, needs_review: 1 });
  } else {
    at = atFor();
    mealId = await insertMeal({ label: text.trim().slice(0, 80) || "Photo — waiting for AI", kcal: 0, lo: 0, hi: 0, protein: 0, source: "pending", share: state.share, needs_review: 1, detail: { raw: text } });
  }
  await db.add("estimates", { day: at.slice(0, 10), at, text, share: state.share, status: "pending", images, thumb, meal_id: mealId, attempts: 1, last_error: err.message,
    model: null, ident: null, result: null, usage: null, parent_id: null });
  toast(`Gemini didn't answer — ${logged ? `${logged} item${logged === 1 ? "" : "s"} added, the rest is ` : "it's "}in the log unvalued. The app keeps retrying; tap the row to type it in.`, 5000);
  resetEstimate(); closeSheets(); changed();
}

// values parked meals when Gemini is back: on open, on return to the app, every 2 min while open, after any success
let retrying = false, lastRetry = 0;
async function retryPending({ force = false } = {}) {
  if (retrying || !state.settings.gemini_key) return;
  if (!force && Date.now() - lastRetry < 90_000) return;
  const parked = (await db.all("estimates")).filter(p => p.status === "pending").sort((a, b) => a.at.localeCompare(b.at));
  if (!parked.length) return;
  retrying = true; lastRetry = Date.now();
  try {
    for (const p of parked) {
      const meal = await db.get("meals", p.meal_id);
      if (!meal || !meal.needs_review) { await db.put("estimates", { ...p, status: meal ? "manual" : "dropped", images: [] }); continue; }   // typed in or removed meanwhile
      try {
        const out = await withModelFallback(() => runGemini({ apiKey: state.settings.gemini_key, model: modelToUse(), images: [], text: p.text, share: p.share, priorImages: p.images || [] }));
        await rememberModel(out.model);
        await db.put("estimates", { ...p, status: "done", images: [], model: out.model, ident: out.ident, result: out.result, usage: out.usage });
        await valueRow(meal, out.result, p.id, meal.source === "pending" ? "photo" : undefined);
        toast(`Valued: ${out.result.dish} — ${fmt(out.result.protein_g, 0)} g · ${fmt(out.result.kcal)} kcal`, 4000);
        await changed();
      } catch (e) {
        await db.put("estimates", { ...p, attempts: (p.attempts || 0) + 1, last_error: e.message });
        break;                                                        // still down: try again later, don't hammer
      }
    }
  } finally { retrying = false; }
}
async function settlePending(mealId, status, from = null) {
  for (const p of await db.all("estimates")) if (p.meal_id === mealId && (from ? p.status === from : (p.status === "pending" || p.status === "fixing"))) await db.put("estimates", { ...p, status, images: status === "pending" ? p.images : [] });
}

function renderEstimate() {
  const e = state.est, r = e.result, box = $("#est-result"); box.hidden = false;
  const items = r.items.map(i => `<li><span>${esc(i.name)}<small>${esc(i.portion)} · ${i.basis === "reference" ? "table" : "model"} · ${i.confidence}</small></span><span class="mono p">${fmt(i.protein_g, 0)}g</span><span class="mono">${fmt(i.kcal)}</span></li>`).join("");
  const pill = r.confidence === "high" ? "good" : r.confidence === "medium" ? "medium" : "low";
  box.innerHTML = `<div class="estcard">
    <div class="dish"><b>${esc(r.dish)}</b><span class="pill ${pill}">${r.confidence}</span></div>
    <div class="big"><span class="p">${fmt(r.protein_g, 0)} g</span> · ${fmt(r.kcal)} kcal <small>${fmt(r.kcal_lo)}–${fmt(r.kcal_hi)}</small></div>
    ${e.thumb ? `<div class="thumbs"><img src="data:image/jpeg;base64,${e.thumb}" alt=""></div>` : ""}
    <ul class="items">${items}</ul>
    ${r.model_share > 0.5 ? `<p><b>Note:</b> most of this came from the model's own figures, not the reference table — treat as rough.</p>` : ""}
    ${r.assumptions?.length ? `<p><b>Assumed:</b> ${esc(r.assumptions.join("; "))}</p>` : ""}
    ${r.grounding?.length ? `<p><b>Based on:</b> ${esc(r.grounding.join("; "))}</p>` : ""}
    ${r.tighten ? `<p><b>Would tighten it:</b> ${esc(r.tighten)}</p>` : ""}
    <div class="refine"><input class="text" id="est-refine" placeholder="Correct it — “only ate half the rice”"><button class="btn" id="est-refine-go">Refine</button></div>
  </div>`;
  $("#est-refine-go").onclick = () => { const c = $("#est-refine").value.trim(); if (c) runEstimate(c); };
  setMealFoot();
  box.scrollIntoView({ block: "start", behavior: "smooth" });
}
async function addEstimate() {
  const e = state.est, r = e?.result; if (!r) return;
  const n = await addItems();
  if (!r.items?.length && !(r.kcal > 0)) {                            // the model found nothing beyond the packages
    toast(n ? `Added ${n} item${n === 1 ? "" : "s"}` : "Nothing to add"); resetEstimate(); closeSheets(); changed(); return;
  }
  let id = null;
  if (state.fixing) { const meal = await db.get("meals", state.fixing); if (meal) { await settlePending(meal.id, "done"); await valueRow(meal, r, e.id, /^(pending|photo)$/.test(meal.source) ? "photo" : "backfill-ai"); id = meal.id; } }
  if (id == null) id = await insertMeal({ label: r.dish, kcal: r.kcal, lo: r.kcal_lo, hi: r.kcal_hi, protein: r.protein_g, source: "photo", share: 1, share_frac: r.share ?? 1, detail: { estimate_id: e.id, confidence: r.confidence, model_share: r.model_share } });
  await db.put("estimates", { ...(await db.get("estimates", e.id)), meal_id: id });
  toast((state.fixing ? "Valued: " : "Added ") + r.dish + (n ? ` + ${n} item${n === 1 ? "" : "s"}` : "")); resetEstimate(); closeSheets(); changed();
}
function resetEstimate() {
  if (state.fixing) settlePending(state.fixing, "pending", "fixing");                                   // sheet gave up on it: back to the retry queue (no-op once settled)
  state.est = null; state.estFiles = []; state.fixing = null; state.fixImages = []; state.items = []; state.share = 1; $("#items").innerHTML = "";
  $$("#est-share button").forEach(x => x.classList.toggle("on", x.dataset.v === "1"));
  $$("#est-thumbs img").forEach(i => i.src.startsWith("blob:") && URL.revokeObjectURL(i.src));
  $("#est-fixing").hidden = true; $("#est-thumbs").innerHTML = ""; $("#est-text").value = ""; $("#recall").innerHTML = "";
  $("#est-result").hidden = true; $("#est-result").innerHTML = ""; $("#est-status").textContent = ""; setMealFoot();
}
async function startFix(meal) {
  resetEstimate(); state.fixing = meal.id; openSheet("meal");
  const p = (await db.all("estimates")).find(x => x.meal_id === meal.id && (x.status === "pending" || x.status === "fixing"));   // a parked meal brings its photos back
  if (p) await db.put("estimates", { ...p, status: "fixing" });                                        // not the background retry's job while the sheet has it
  state.fixImages = p?.images || []; state.share = p?.share ?? meal.share_frac ?? 1;
  $$("#est-share button").forEach(x => x.classList.toggle("on", parseFloat(x.dataset.v) === state.share));
  if (p?.thumb) $("#est-thumbs").innerHTML = `<img src="data:image/jpeg;base64,${p.thumb}" alt="">`;
  $("#est-text").value = p?.text ?? rawText(meal); $("#est-fixing").hidden = false;
  $("#est-fixing").textContent = `Valuing the row from ${meal.at.slice(11, 16)} — Add to log will replace it.`;
}
async function valueRow(meal, computed, estId, source = "backfill-ai") {
  let d = meal.detail; if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = { raw: meal.label }; } }
  await db.put("meals", { ...meal, label: computed.dish, kcal: computed.kcal, kcal_lo: computed.kcal_lo, kcal_hi: computed.kcal_hi, protein_g: computed.protein_g,
    source, needs_review: 0, detail: { ...(d || {}), estimate_id: estId, confidence: computed.confidence, model_share: computed.model_share } });
}
$("#manual").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target), kcal = +f.get("kcal");
  await insertMeal({ label: String(f.get("label")).trim(), kcal, lo: kcal * 0.85, hi: kcal * 1.15, protein: +f.get("protein_g"), source: "manual" });
  e.target.reset(); toast("Added"); resetEstimate(); closeSheets(); changed();
};

// ------------------------------------------------------------ row sheet: edit / log again / delete
function openRow(r, kind) {
  const d = sheet("row"), body = $("#row-body");
  $("#row-title").textContent = kind === "meal" ? "Meal" : labelKind(r.kind);
  if (kind === "meal") {
    body.innerHTML = `<div class="rowsheet">
      <p class="meta">${r.at.slice(0, 10)} · ${esc(r.source === "pending" ? "waiting for AI" : r.source)}${r.needs_review || looksPartial(r) ? " · not valued yet" : ""}</p>
      <label class="lbl">label <input class="text" id="rw-label" value="${esc(r.label)}"></label>
      <div class="row gap">
        <label class="lbl">kcal <input class="num" id="rw-kcal" type="number" step="any" value="${r.kcal}" inputmode="decimal"></label>
        <label class="lbl">protein g <input class="num" id="rw-p" type="number" step="any" value="${r.protein_g}" inputmode="decimal"></label>
        <label class="lbl">time <input class="num" id="rw-time" type="time" value="${r.at.slice(11, 16)}"></label>
      </div>
      <div class="row gap"><button class="btn" id="rw-again">Log again</button>${(r.source || "").startsWith("backfill") || r.needs_review ? `<button class="btn" id="rw-ai">Value with AI</button>` : ""}</div>
      <div class="row gap"><button class="btn danger" id="rw-del">Delete</button><button class="btn primary grow" id="rw-save">Save</button></div>
    </div>`;
    $("#rw-save").onclick = async () => {
      const kcal = parseFloat($("#rw-kcal").value) || 0, ratio = r.kcal ? kcal / r.kcal : 1;
      await db.put("meals", { ...r, label: $("#rw-label").value.trim() || r.label, kcal, kcal_lo: Math.round(r.kcal ? r.kcal_lo * ratio : kcal * 0.85), kcal_hi: Math.round(r.kcal ? r.kcal_hi * ratio : kcal * 1.15),
        protein_g: parseFloat($("#rw-p").value) || 0, at: `${r.day}T${$("#rw-time").value || r.at.slice(11, 16)}+08:00`, needs_review: 0, source: r.needs_review ? "manual" : r.source });
      if (r.needs_review) await settlePending(r.id, "manual");
      d.close(); toast("Saved"); changed();
    };
    $("#rw-again").onclick = async () => { await insertMeal({ label: r.label, kcal: r.kcal, lo: r.kcal_lo, hi: r.kcal_hi, protein: r.protein_g, source: "repeat" }); d.close(); toast(`Added ${r.label}`); changed(); };
    $("#rw-del").onclick = async () => { await db.del("meals", r.id); await settlePending(r.id, "dropped"); d.close(); toast("Removed"); changed(); };
    if ($("#rw-ai")) $("#rw-ai").onclick = () => { d.close(); startFix(r); };
  } else {
    body.innerHTML = `<div class="rowsheet">
      <p class="meta">${r.at.slice(0, 10)} · ${esc(workoutLine(r) || "—")}</p>
      <div class="row gap">
        <label class="lbl">kcal <input class="num" id="rw-kcal" type="number" step="1" value="${r.kcal || ""}" placeholder="default" inputmode="decimal"></label>
        <label class="lbl">time <input class="num" id="rw-time" type="time" value="${r.at.slice(11, 16)}"></label>
      </div>
      <label class="lbl">note <input class="text" id="rw-note" value="${esc(r.detail || "")}"></label>
      <div class="row gap"><button class="btn danger" id="rw-del">Delete</button><button class="btn primary grow" id="rw-save">Save</button></div>
    </div>`;
    $("#rw-save").onclick = async () => {
      const kcal = parseFloat($("#rw-kcal").value);
      await db.put("workouts", { ...r, kcal: Number.isFinite(kcal) && kcal > 0 ? kcal : null, detail: $("#rw-note").value.trim() || null, at: `${r.day}T${$("#rw-time").value || r.at.slice(11, 16)}+08:00` });
      d.close(); toast("Saved"); changed();
    };
    $("#rw-del").onclick = async () => { await db.del("workouts", r.id); d.close(); toast("Removed"); changed(); };
  }
  d.showModal();
}

// ------------------------------------------------------------ shake / products
async function loadProducts() {
  state.products = (await db.all("products")).filter(p => p.active);
  for (const [sel, kind] of [["#whey-id", "whey"], ["#milk-id", "milk"]]) {
    const s = $(sel), cur = s.value, list = state.products.filter(p => p.kind === kind).sort((a, b) => b.is_default - a.is_default || a.id - b.id);
    s.innerHTML = "";
    for (const p of list) { const o = document.createElement("option"); o.value = p.id; o.textContent = p.label + (p.is_default ? " ★" : ""); s.appendChild(o); }
    const def = list.find(p => p.is_default) || list[0];
    s.value = list.some(p => String(p.id) === cur) ? cur : (def ? def.id : "");
  }
  previewShake();
}
const product = (id) => state.products.find(p => p.id === +id);
function applyLastShake() {
  let last = null; try { last = JSON.parse(state.settings.shake_last || "null"); } catch {}
  if (!last) return;
  if (last.whey) $("#whey").value = last.whey; if (last.milk) $("#milk").value = last.milk; if (last.creatine != null) $("#creatine").value = last.creatine;
  if (product(last.whey_id)) $("#whey-id").value = last.whey_id; if (product(last.milk_id)) $("#milk-id").value = last.milk_id;
}
function previewShake() {
  const w = product($("#whey-id").value), m = product($("#milk-id").value);
  if (!w || !m) { $("#shake-result").textContent = "—"; return; }
  const s = shake(+$("#whey").value || 0, +$("#milk").value || 0, w, m, +$("#creatine").value || 0);
  $("#shake-result").textContent = `${fmt(s.protein_g, 1)} g · ${fmt(s.kcal)} kcal`;
}
["whey", "milk", "milk-id", "whey-id", "creatine"].forEach(id => $("#" + id).addEventListener("input", previewShake));
$("#btn-shake").onclick = async () => {
  const w = product($("#whey-id").value), m = product($("#milk-id").value); if (!w || !m) return toast("Pick a whey and a milk");
  const s = shake(+$("#whey").value || 0, +$("#milk").value || 0, w, m, +$("#creatine").value || 0);
  await insertMeal({ label: s.label, kcal: s.kcal, lo: s.kcal_lo, hi: s.kcal_hi, protein: s.protein_g, source: "shake", detail: { whey_g: +$("#whey").value, milk_ml: +$("#milk").value, whey_id: w.id, milk_id: m.id, breakdown: s.breakdown } });
  await db.setSetting("shake_last", JSON.stringify({ whey: +$("#whey").value, milk: +$("#milk").value, creatine: +$("#creatine").value, whey_id: w.id, milk_id: m.id }));   // next time opens on this
  toast("Shake added"); closeSheets(); changed();
};
const openProduct = () => { $("#product-form").reset(); $("#prod-status").textContent = ""; syncPer(); $("#product").showModal(); };
$("#btn-product").onclick = openProduct;
const syncPer = () => { const per = $("#product-kind").value === "whey" ? "/g" : "/100ml"; $("#product-per").textContent = per; $("#product-per2").textContent = per; };
$("#product-kind").addEventListener("change", syncPer);
$("#prod-label").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const { data: L } = await readPackage(f, (m) => $("#prod-status").textContent = m);
    const form = $("#product-form");
    form.kind.value = L.kind === "whey" ? "whey" : "milk"; syncPer();
    form.label.value = L.product;
    if (form.kind.value === "whey") {
      // per gram of powder: from per-100g, or per-serving / serving grams
      const g = L.basis === "100g" ? 100 : (L.serving_g_or_ml || 0);
      form.kcal.value = g ? (L.kcal / g).toFixed(3) : ""; form.protein_g.value = g ? (L.protein_g / g).toFixed(3) : "";
      $("#prod-status").textContent = g ? `${L.basis === "100g" ? "per 100 g" : `serving ${L.serving_size}`} → per gram` : "couldn't find grams — type it";
    } else {
      const ml = L.basis === "100ml" || L.basis === "100g" ? 100 : (L.serving_g_or_ml || 0);
      form.kcal.value = ml ? (L.kcal * 100 / ml).toFixed(1) : ""; form.protein_g.value = ml ? (L.protein_g * 100 / ml).toFixed(2) : "";
      $("#prod-status").textContent = ml ? `read as per ${L.basis}` : "couldn't find ml — type it";
    }
  } catch (err) { $("#prod-status").textContent = err.message; }
});
$("#product-form").onsubmit = async (e) => {
  if (e.submitter?.value !== "save") return;
  e.preventDefault();
  const f = new FormData(e.target), kind = f.get("kind"), makeDefault = !!f.get("make_default");
  if (makeDefault) for (const p of state.products.filter(p => p.kind === kind && p.is_default)) await db.put("products", { ...p, is_default: 0 });
  await db.add("products", { kind, label: String(f.get("label")).trim(), per: kind === "whey" ? "g" : "100ml", kcal: +f.get("kcal"), protein_g: +f.get("protein_g"), is_default: makeDefault ? 1 : 0, active: 1 });
  $("#product").close(); toast("Saved"); await loadProducts(); await markDirty();
};

// ------------------------------------------------------------ workouts
function renderWorkoutSheet() {
  const list = kinds();
  if (!list.some(k => k.key === state.wo.kind)) state.wo.kind = list[0].key;
  const kbox = $("#wo-kinds");
  if (kbox.dataset.keys !== list.map(k => k.key).join(",")) {                      // rebuilt only when the set changes
    kbox.innerHTML = list.map(k => `<button class="opt" data-kind="${esc(k.key)}">${esc(k.label)}</button>`).join("");
    kbox.dataset.keys = list.map(k => k.key).join(",");
    $$("#wo-kinds .opt").forEach(c => c.onclick = () => { state.wo.kind = c.dataset.kind; renderWorkoutSheet(); });
  }
  $$("#wo-kinds .opt").forEach(c => c.classList.toggle("on", c.dataset.kind === state.wo.kind));
  const strength = state.wo.kind === "lift";
  $("#wo-cardio").hidden = strength; $("#wo-strength").hidden = !strength;
  $("#wo-km").parentElement.hidden = !/run|swim|cycle|walk|ride|hike|row/i.test(state.wo.kind + " " + labelKind(state.wo.kind));
  const dflt = parseFloat(state.settings["burn_" + state.wo.kind] || state.settings.burn_other || 0);
  $("#wo-burn-note").textContent = `Without a kcal figure, ${labelKind(state.wo.kind)} counts as ${fmt(dflt)} kcal (change it in Settings). A screenshot with calories overrides it.`;
  if (!$("#wo-exercise").options.length) for (const x of EXERCISES) { const o = document.createElement("option"); o.value = x; o.textContent = x; $("#wo-exercise").appendChild(o); }
  const box = $("#wo-sets"); box.innerHTML = "";
  state.wo.sets.forEach((s, i) => {
    const el = document.createElement("div"); el.className = "set";
    el.innerHTML = `<span>${i + 1}</span><span>${esc(s.exercise)}</span><span>${s.weight} kg × ${s.reps}<span class="e1">e1RM ${e1rm(s.weight, s.reps)}</span></span><button class="x" aria-label="Remove">${icon("close")}</button>`;
    el.querySelector(".x").onclick = () => { state.wo.sets.splice(i, 1); renderWorkoutSheet(); };
    box.appendChild(el);
  });
}
$("#wo-addset").onclick = () => {
  const w = parseFloat($("#wo-w").value), r = parseInt($("#wo-r").value, 10);
  if (!Number.isFinite(w) || !r) return toast("Weight and reps");
  state.wo.sets.push({ exercise: $("#wo-exercise").value, weight: w, reps: r }); $("#wo-r").value = ""; renderWorkoutSheet();
};
$("#wo-shot").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  $("#wo-shot-status").textContent = "reading…";
  try {
    const { data: W, model: usedW } = await withModelFallback(() => readWorkout({ apiKey: state.settings.gemini_key, model: modelToUse(), image: f, onStatus: (m) => $("#wo-shot-status").textContent = m }));
    await rememberModel(usedW);
    if (W.duration_min) $("#wo-min").value = Math.round(W.duration_min);
    if (W.distance_km) $("#wo-km").value = W.distance_km;
    if (W.calories) $("#wo-kcal").value = Math.round(W.calories);
    const sport = (W.sport || "").toLowerCase();
    if (/run/.test(sport)) state.wo.kind = "run"; else if (/swim/.test(sport)) state.wo.kind = "swim";
    const bits = [W.app, W.title, W.pace_or_speed, W.avg_hr ? `avg HR ${W.avg_hr}` : null].filter(Boolean).join(" · ");
    $("#wo-note").value = bits; state.wo.shot = W; renderWorkoutSheet();
    $("#wo-shot-status").textContent = `${W.app || "screenshot"} · ${W.confidence}${W.date && W.date !== state.day ? ` · dated ${W.date}` : ""}`;
  } catch (err) { $("#wo-shot-status").textContent = err.message; }
});
$("#wo-log").onclick = async () => {
  const kind = state.wo.kind, at = atFor();
  const row = { day: at.slice(0, 10), at, kind, detail: $("#wo-note").value.trim() || null, source: "manual" };
  if (kind === "lift") { if (!state.wo.sets.length) return toast("Add at least one set"); row.sets = state.wo.sets.slice(); }
  else {
    const kcal = parseFloat($("#wo-kcal").value), min = parseFloat($("#wo-min").value), km = parseFloat($("#wo-km").value);
    if (Number.isFinite(kcal) && kcal > 0) row.kcal = kcal;
    if (Number.isFinite(min) && min > 0) row.duration_min = min;
    if (Number.isFinite(km) && km > 0) row.distance_km = km;
    if (state.wo.shot) row.shot = state.wo.shot;
  }
  await db.add("workouts", row);
  state.wo = { kind, sets: [], shot: null }; ["wo-min", "wo-km", "wo-kcal", "wo-note", "wo-w", "wo-r"].forEach(id => ($("#" + id).value = "")); $("#wo-shot-status").textContent = "";
  toast(`${labelKind(kind)} logged`); closeSheets(); changed();
};

// ------------------------------------------------------------ weigh-in by hand
$("#bw-log").onclick = async () => {
  const w = fromUnit(parseFloat($("#bw-kg").value)); if (!w) return toast("Weight?");
  const bf = parseFloat($("#bw-bf").value), at = atFor(state.day === todayStr() ? nowHM() : "07:00");
  try {
    await db.add("body", { day: at.slice(0, 10), at, weight_kg: w, bodyfat_pct: Number.isFinite(bf) ? bf : null, muscle_kg: null, water_pct: null, source: "manual", ext_id: `manual:${at}:${Date.now()}` });
  } catch (e) { return toast("Couldn't save the weigh-in: " + (e?.message || e?.name || "unknown error"), 4000); }
  $("#bw-kg").value = ""; $("#bw-bf").value = ""; toast("Weight logged"); closeSheets(); changed();
};

// ------------------------------------------------------------ day nav
const shift = (n) => loadDay(eng.addDays(state.day, n));
$("#day-prev").onclick = () => shift(-1); $("#day-next").onclick = () => shift(1); $("#day-label").onclick = () => loadDay(todayStr());

// ------------------------------------------------------------ trend
async function loadTrend() {
  await loadDay();
  const s = state.settings, body = state.all.body;
  const start = eng.addDays(todayStr(), -120);
  const wl = parseFloat(s.weight_lo_kg), wh = parseFloat(s.weight_hi_kg), bounded = Number.isFinite(wl) && Number.isFinite(wh);
  state.trend = { points: eng.weightTrend(body.filter(b => b.day >= start), s), current: state.data.target,
    weight_lo: bounded ? wl : null, weight_hi: bounded ? wh : null, creatine_window: eng.creatineWindow(s) };
  drawChart(); renderExpenditure(); renderLifts();
  const last = state.trend.points.at(-1);
  $("#trend-latest").textContent = last ? wfmt(last.weight, 2) : "no weigh-ins yet";
  $("#bw-unit").textContent = unit();
  $("#btn-fixall").hidden = !state.all.meals.some(m => m.needs_review || looksPartial(m));
  $("#backup-state").textContent = backupStateText();
  // how current the scale data is — answers "why isn't today's weigh-in here"
  const lastBody = state.all.body.slice().sort((x, y) => x.at.localeCompare(y.at)).at(-1);
  const el = $("#body-fresh");
  if (lastBody) {
    const days = Math.round((new Date(todayStr()) - new Date(lastBody.day)) / 864e5);
    el.textContent = days === 0 ? `Latest weigh-in: today, ${wfmt(lastBody.weight_kg, 2)}.`
      : `Latest weigh-in: ${lastBody.day} (${days} day${days > 1 ? "s" : ""} ago), ${wfmt(lastBody.weight_kg, 2)}.${state.settings.gh_token ? " The scale job runs every 3 hours — Fetch scale now asks it to run now." : ""}`;
    el.className = days >= 2 ? "note warn" : "note";
  } else el.textContent = "";
}
function setupCanvas(c, H) {
  const dpr = window.devicePixelRatio || 1, W = c.clientWidth || 320;
  c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  return { ctx, W, H, col: (v) => css.getPropertyValue(v).trim() };
}
/** One clear series: dots for readings, a line for the smoothed trend, optional target band, a few date ticks. */
function drawSeries(c, H, pts, key, trendKey, opts) {
  const { ctx, W, col } = setupCanvas(c, H);
  ctx.clearRect(0, 0, W, H);
  if (!pts.length) { ctx.fillStyle = col("--faint"); ctx.font = "13px " + col("--font"); ctx.textAlign = "center"; ctx.fillText(opts.empty, W / 2, H / 2); return; }
  const pad = { l: 40, r: 48, t: 16, b: 24 };
  const day0 = new Date(pts[0].day), day1 = new Date(todayStr()), span = Math.max(6, (day1 - day0) / 864e5);
  const x = (d) => pad.l + ((new Date(d) - day0) / 864e5) / span * (W - pad.l - pad.r);
  const vals = pts.flatMap(p => [p[key], trendKey ? p[trendKey] : p[key]]).concat(opts.band ? opts.band : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const room = Math.max(opts.minRange, (hi - lo) * 0.25); lo -= room; hi += room;
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  if (opts.band) {
    ctx.fillStyle = col("--green"); ctx.globalAlpha = 0.14; ctx.fillRect(pad.l, y(opts.band[1]), W - pad.l - pad.r, y(opts.band[0]) - y(opts.band[1])); ctx.globalAlpha = 1;
    ctx.fillStyle = col("--green-ink"); ctx.font = "10px " + col("--font"); ctx.textAlign = "left";
    ctx.fillText(String(opts.band[1]), W - pad.r + 4, y(opts.band[1]) + 3); ctx.fillText(String(opts.band[0]), W - pad.r + 4, y(opts.band[0]) + 3);
  }
  if (opts.creatine) {
    const x0 = Math.max(pad.l, x(opts.creatine[0])), x1 = Math.min(W - pad.r, x(opts.creatine[1]));
    if (x1 > x0) { ctx.strokeStyle = col("--faint"); ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x0, 6); ctx.lineTo(x1, 6); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col("--faint"); ctx.font = "9px " + col("--font"); ctx.textAlign = "center"; ctx.fillText("creatine settling", (x0 + x1) / 2, 14); }
  }
  const step = opts.step; ctx.font = "10px " + col("--font"); ctx.strokeStyle = col("--line"); ctx.lineWidth = 1; ctx.fillStyle = col("--faint"); ctx.textAlign = "right";
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) { ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(W - pad.r, y(v)); ctx.stroke(); ctx.fillText(opts.fmt(v), pad.l - 6, y(v) + 3); }
  ctx.textAlign = "left"; ctx.fillText(pts[0].day.slice(5).replace("-", "/"), pad.l, H - 6);
  const mid = new Date((day0.getTime() + day1.getTime()) / 2).toLocaleDateString("en-CA", { timeZone: SGT });
  ctx.textAlign = "center"; ctx.fillText(mid.slice(5).replace("-", "/"), (pad.l + W - pad.r) / 2, H - 6);
  ctx.textAlign = "right"; ctx.fillText("today", W - pad.r, H - 6);
  if (trendKey) { ctx.strokeStyle = col(opts.color); ctx.lineWidth = 2.2; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(x(p.day), y(p[trendKey])) : ctx.moveTo(x(p.day), y(p[trendKey]))); ctx.stroke(); }
  ctx.fillStyle = col("--ink"); ctx.globalAlpha = 0.7;
  for (const p of pts) { ctx.beginPath(); ctx.arc(x(p.day), y(p[key]), 3, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1;
  const last = pts.at(-1), lv = trendKey ? last[trendKey] : last[key];
  ctx.fillStyle = col(opts.color); ctx.beginPath(); ctx.arc(x(last.day), y(lv), 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.font = "11px " + col("--font"); ctx.textAlign = "left"; ctx.fillText(opts.fmt(lv), x(last.day) + 8, y(lv) - 6);
}
function drawChart() {
  const lb = unit() === "lb", cv = (x) => x == null ? null : Math.round(toUnit(x) * 100) / 100;
  const pts = state.trend.points.map(p => ({ ...p, weight: cv(p.weight), trend: cv(p.trend) })), wl = cv(state.trend.weight_lo), wh = cv(state.trend.weight_hi);
  drawSeries($("#chart"), 200, pts, "weight", "trend", { band: wl != null ? [wl, wh] : null, creatine: state.trend.creatine_window, step: lb ? 2 : 1, minRange: lb ? 2 : 1,
    fmt: (v) => Number(v).toFixed(Math.abs(v % 1) > 0.01 ? 1 : 0), color: "--blue", empty: "No weigh-ins yet. Weigh in by hand below, or set up a scale." });
  const note = $("#chart-note");
  if (pts.length >= 2) {
    const a1 = pts.at(-1), a0 = pts.find(p => new Date(a1.day) - new Date(p.day) <= 7 * 864e5) || pts[0];
    const dlt = a1.trend - a0.trend, dir = Math.abs(dlt) < (lb ? 0.33 : 0.15) ? "flat" : dlt > 0 ? "up " + fmt(dlt, 1) + " " + unit() : "down " + fmt(-dlt, 1) + " " + unit();
    note.textContent = "Dots are each weigh-in. The line is the smoothed trend and is the number to believe: single readings swing about " + (lb ? "2 lb" : "1 kg") + " with water. Trend " + fmt(a1.trend, 1) + " " + unit() + ", " + dir + " over the last week." + (wl != null ? " Green band is your " + wl + "–" + wh + " " + unit() + " range." : "")
      + (state.trend.creatine_window && a1.day <= state.trend.creatine_window[1] ? " Creatine is still settling, so some of this is water, not fat." : "");
  } else note.textContent = pts.length ? "One reading so far. The trend needs a few mornings." : "";
  const bf = pts.filter(p => p.bodyfat != null);
  $("#bf-block").hidden = bf.length < 2;
  if (bf.length >= 2) {
    drawSeries($("#bfchart"), 140, bf, "bodyfat", null, { band: null, creatine: null, step: 0.5, minRange: 0.6, fmt: (v) => Number(v).toFixed(1) + "%", color: "--green", empty: "" });
    const b0 = bf[0], b1 = bf.at(-1);
    $("#bf-latest").textContent = fmt(b1.bodyfat, 1) + "% · " + b1.day.slice(5).replace("-", "/");
    $("#bf-note").textContent = "This is the recomp signal: weight can stay flat while this falls. " + fmt(b0.bodyfat, 1) + "% on " + b0.day.slice(5).replace("-", "/") + " to " + fmt(b1.bodyfat, 1) + "% now. Scale body-fat readings are noisy day to day; watch the direction over weeks.";
  }
}
function renderExpenditure() {
  const cur = state.trend.current, el = $("#expenditure");
  const pill = `<span class="pill ${cur.confidence}">${cur.confidence === "none" ? "provisional" : cur.confidence + " confidence"}</span>`;
  el.innerHTML = cur.source === "provisional"
    ? `<div class="card-head"><h2>Expenditure</h2>${pill}</div><div class="exp"><div class="big">${fmt(cur.base)} <small>kcal rest-day base · provisional</small></div><p>${esc(cur.note)}</p><p>After ~7 complete days with weigh-ins outside the creatine window, this comes from your own intake and weight trend, not a formula.</p></div>`
    : `<div class="card-head"><h2>Expenditure</h2>${pill}</div><div class="exp"><div class="big">${fmt(cur.tdee)} <small>kcal/day measured average</small></div>
      <p>Of that, ~${fmt(cur.session_avg)}/day was the training you logged in the window, so rest-day expenditure is ~${fmt(cur.rest_base)}. Minus the deficit: <b>${fmt(cur.base)} on a rest day</b>, plus each session's burn on the days you train.</p>
      <p>${esc(cur.note)}</p><p>As of ${cur.as_of}. Recomputed on every load.</p></div>`;
}
function renderLifts() {
  const el = $("#lifts"), rows = liftProgress(state.all.workouts);
  el.hidden = !rows.length;
  if (!rows.length) return;
  el.innerHTML = `<div class="card-head"><h2>Lifts</h2><span class="muted">e1RM vs goal</span></div>` + rows.map(r => `<div class="lift">
    <div>${esc(r.exercise)}<small>best ${esc(r.best_set)} on ${r.best_day} · last ${esc(r.last_set)} · ${r.sessions} session${r.sessions > 1 ? "s" : ""}</small></div>
    <div class="val"><b>${fmt(r.best, 1)}</b><small>e1RM${r.goal ? ` / ${r.goal}` : ""}</small></div>
    ${r.goal ? `<div class="goalbar"><i style="width:${Math.min(100, r.best / r.goal * 100)}%"></i></div>` : ""}
  </div>`).join("");
}

// ------------------------------------------------------------ data actions
const dataMsg = (m) => { $("#data-msg").textContent = m; };
async function guarded(btn, fn) { btn.disabled = true; try { await fn(); await syncOk(); } catch (e) { dataMsg(e.message); if (e.auth) await syncFailed("GitHub", e); } finally { btn.disabled = false; } }
$("#btn-pull").onclick = (e) => guarded(e.target, async () => {
  // The scale only reaches GitHub when the Actions job runs, so ask it to run now.
  let triggered = false;
  try { const t = await sync.refreshFromRenpho({ onStatus: dataMsg }); triggered = true; if (!t.changed) dataMsg("Job ran — nothing new on the scale since last time."); }
  catch (err) {
    if (err.noActions) dataMsg("Can't trigger the job (token needs Actions: Read and write). Reading what's already there…");
    else throw err;
  }
  const r = await sync.pullBody();
  const tail = r.ok ? `${r.added} new of ${r.total}. Latest ${r.latest ? `${r.latest.weight_kg} kg on ${r.latest.day}` : "—"}.` : r.error;
  dataMsg((triggered ? "" : "") + tail);
  await loadTrend();
});
$("#btn-fixall").onclick = (e) => guarded(e.target, async () => {
  if (!state.settings.gemini_key) throw new Error("Add your Gemini key in ⚙ first.");
  const rows = (await db.all("meals")).filter(m => m.needs_review || looksPartial(m)).sort((a, b) => a.at.localeCompare(b.at));
  if (!rows.length) { dataMsg("No ? rows left."); return; }
  if (!confirm(`Value ${rows.length} rows with AI from their text? About ${Math.ceil(rows.length * 7 / 60)} min, free tier.`)) return;
  let done = 0, failed = 0;
  for (const m of rows) {
    dataMsg(`Valuing ${done + 1}/${rows.length}: ${rawText(m).slice(0, 50)}…`);
    try {
      const out = await withModelFallback(() => runGemini({ apiKey: state.settings.gemini_key, model: modelToUse(), images: [], text: rawText(m), share: 1, onStatus: dataMsg }));
      await rememberModel(out.model);
      const estId = await db.add("estimates", { day: m.day, at: m.at, text: rawText(m), share: 1, model: out.model, ident: out.ident, result: out.result, thumb: null, usage: out.usage, parent_id: null, meal_id: m.id });
      await valueRow(m, out.result, estId); done++;
    } catch (err) { failed++; if (err.rateLimited) { dataMsg(`Stopped after ${done}: ${err.message}`); break; } else if (failed > 3) { dataMsg(`Stopped after ${done}: ${err.message}`); break; } }
    await wait(7000);
  }
  dataMsg(`Valued ${done} of ${rows.length}${failed ? `, ${failed} failed` : ""}.`); await loadTrend(); await markDirty();
});
$("#btn-backup").onclick = (e) => guarded(e.target, async () => { dataMsg("Backing up…"); const r = await sync.pushBackup(); await db.setSetting("dirty", "0"); dataMsg(`Backed up ${r.meals} meals, ${r.body} weigh-ins.`); await loadTrend(); });
$("#btn-restore").onclick = (e) => guarded(e.target, async () => { if (!confirm("Replace everything on this phone with the GitHub backup?")) return; const r = await sync.restoreBackup(); dataMsg(r.ok ? `Restored ${r.meals} meals from ${r.exported_at}.` : r.error); await loadProducts(); await loadTrend(); });
async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
$("#btn-export").onclick = async () => { await saveFile(`recomp-${todayStr()}.json`, JSON.stringify(await db.dump()), "application/json"); await db.setSetting("last_export", new Date().toISOString()); };
$("#btn-csv").onclick = async () => {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["type", "day", "time", "label", "kcal", "protein_g", "detail"]];
  for (const m of (await db.all("meals")).sort((a, b) => a.at.localeCompare(b.at))) rows.push(["meal", m.day, m.at.slice(11, 16), m.label, m.kcal, m.protein_g, m.source]);
  for (const w of (await db.all("workouts")).sort((a, b) => a.at.localeCompare(b.at))) rows.push(["workout", w.day, w.at.slice(11, 16), labelKind(w.kind), eng.sessionKcal(w, state.settings), "", workoutLine(w)]);
  for (const b of (await db.all("body")).sort((a, b) => a.at.localeCompare(b.at))) rows.push(["weight", b.day, b.at.slice(11, 16), `${b.weight_kg} kg`, "", "", b.bodyfat_pct != null ? `${b.bodyfat_pct}% fat` : ""]);
  await saveFile(`recomp-${todayStr()}.csv`, rows.map(r => r.map(q).join(",")).join("\n"), "text/csv");
};
$("#import-file").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return; const data = JSON.parse(await f.text());
  if (data.version && data.meals && data.settings && !Array.isArray(data.settings)) { const r = await sync.importSeedData(data); dataMsg(`Imported seed: ${r.meals} meals.`); }
  else { if (!confirm("Replace everything on this phone with this file?")) return; await db.restore(data); dataMsg("Restored from file."); }
  e.target.value = ""; await loadProducts(); await loadTrend(); await markDirty();
});

// ------------------------------------------------------------ settings
const SETTINGS = [
  ["gemini_key", "Gemini API key (free, aistudio.google.com)", "password"], ["ai_model", "Gemini model", "text"],
  ["gh_repo", "GitHub data repo (owner/name)", "text"], ["gh_token", "GitHub token (Contents read/write)", "password"], ["backup_auto", "Auto-backup after changes (1/0)", "text"],
  ["protein_floor_g", "Protein floor (g)", "text"], ["protein_ceiling_g", "Protein ceiling (g)", "text"],
  ["weight_lo_kg", "Weight low (kg)", "text"], ["weight_hi_kg", "Weight high (kg)", "text"],
  ["provisional_kcal", "Provisional rest-day base (kcal)", "text"], ["recomp_deficit_kcal", "Recomp deficit (kcal)", "text"],
  ["creatine_start", "Creatine start (YYYY-MM-DD)", "text"], ["creatine_settle_days", "Creatine settle (days)", "text"],
  ["units", "Weight unit (kg / lb)", "text"],
];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "kind";
function renderKindsEditor(list) {
  $("#kinds-editor").innerHTML = list.map(k => `<div class="kind-row" data-key="${esc(k.key)}">
      <input class="text" name="kl_${esc(k.key)}" value="${esc(k.label)}" aria-label="name" ${k.key === "lift" ? "readonly" : ""}>
      <input class="num" name="kb_${esc(k.key)}" type="number" min="0" step="10" value="${esc(state.settings["burn_" + k.key] ?? "")}" placeholder="kcal" inputmode="numeric">
      ${k.key === "lift" ? "<span></span>" : `<button class="x" type="button" aria-label="Remove">${icon("close")}</button>`}
    </div>`).join("");
  $$("#kinds-editor .x").forEach(b => b.onclick = () => b.closest(".kind-row").remove());
}
$("#btn-addkind").onclick = () => {
  const name = (prompt("Name of the workout kind — e.g. HIIT class, Football, Hike") || "").trim(); if (!name) return;
  let key = slug(name); const taken = $$("#kinds-editor .kind-row").map(r => r.dataset.key); while (taken.includes(key)) key += "_";
  const row = document.createElement("div"); row.className = "kind-row"; row.dataset.key = key;
  row.innerHTML = `<input class="text" name="kl_${esc(key)}" value="${esc(name)}"><input class="num" name="kb_${esc(key)}" type="number" min="0" step="10" value="300" inputmode="numeric"><button class="x" type="button" aria-label="Remove">${icon("close")}</button>`;
  row.querySelector(".x").onclick = () => row.remove();
  $("#kinds-editor").insertBefore(row, $("#kinds-editor .kind-row[data-key=lift]"));
};
$("#btn-setup").onclick = () => { $("#settings").close(); openSetup(); };
$("#btn-wipe").onclick = async () => {
  if (!confirm("Delete every meal, workout, weigh-in, estimate and setting on this phone? Your GitHub backup, if any, is not touched.")) return;
  if (!confirm("Last check — this cannot be undone here. Delete everything?")) return;
  for (const store of ["meals", "workouts", "body", "estimates", "products", "settings"]) await db.clear(store);
  location.reload();
};
$("#btn-settings").onclick = async () => {
  const s = await db.allSettings();
  $("#settings-fields").innerHTML = SETTINGS.map(([k, l, type]) => `<label class="lbl ${k.startsWith("g") || k === "ai_model" ? "wide" : ""}">${l.replace("(kg)", `(${unit()})`)}<input class="num" type="${type}" name="${k}" value="${esc(k.startsWith("weight_") && s[k] ? fmt(toUnit(parseFloat(s[k])), 1) : (s[k] ?? ""))}" autocomplete="off"></label>`).join("");
  renderKindsEditor(kinds());
  $("#settings").showModal();
};
$("#settings-form").onsubmit = async (e) => {
  if (e.submitter?.value !== "save") return;
  const f = new FormData(e.target);
  if (String(f.get("ai_model") ?? "").trim() !== (state.settings.ai_model || "")) await db.setSetting("ai_model_ok", "");
  const units = /lb/i.test(String(f.get("units") || "")) ? "lb" : "kg", wasLb = unit() === "lb";
  for (const [k] of SETTINGS) {
    let v = String(f.get(k) ?? "").trim();
    if (k === "units") v = units;
    else if (k.startsWith("weight_") && v) { const n = parseFloat(v); v = Number.isFinite(n) ? String(Math.round((wasLb ? n / 2.20462 : n) * 100) / 100) : ""; }   // typed in the old unit, stored in kg
    await db.setSetting(k, v);
  }
  const list = $$("#kinds-editor .kind-row").map(r => ({ key: r.dataset.key, label: String(f.get("kl_" + r.dataset.key) || "").trim() || r.dataset.key })).filter(k => k.label);
  await db.setSetting("workout_kinds", JSON.stringify(list));
  for (const k of list) { const b = String(f.get("kb_" + k.key) ?? "").trim(); if (b !== "") await db.setSetting("burn_" + k.key, b); }
  toast("Saved"); await loadDay(); if (state.tab === "trend") await loadTrend();
};

// ------------------------------------------------------------ first run: a minute of facts -> first-week targets
const optPick = (sel) => { $$(sel + " .opt").forEach(b => b.onclick = () => { $$(sel + " .opt").forEach(x => x.classList.toggle("on", x === b)); setupPreview(); }); };
optPick("#setup-activity"); optPick("#setup-goal");
const setupVals = () => {
  const f = $("#setup-form"), lb = f.units.value === "lb", w = parseFloat(f.weight.value);
  return { sex: f.sex.value, age: parseInt(f.age.value, 10), height_cm: parseFloat(f.height_cm.value), weight_kg: lb ? w / 2.20462 : w, units: f.units.value,
    activity: $("#setup-activity .opt.on")?.dataset.v || "desk", goal: $("#setup-goal .opt.on")?.dataset.v || "recomp", gemini_key: f.gemini_key.value.trim() };
};
function setupPreview() {
  const v = setupVals(); $("#setup-unit").textContent = v.units;
  if (!(v.age > 0 && v.height_cm > 0 && v.weight_kg > 0)) { $("#setup-preview").textContent = ""; return; }
  const t = eng.provisionalTargets(v);
  $("#setup-preview").textContent = `First-week target: about ${fmt(t.provisional_kcal)} kcal on a rest day (sessions add on top), protein ${t.protein_floor_g}–${t.protein_ceiling_g} g. The app replaces this with your measured expenditure once it has a week of data.`;
}
["input", "change"].forEach(ev => $("#setup-form").addEventListener(ev, setupPreview));
function openSetup() {
  const f = $("#setup-form"), s = state.settings;
  f.units.value = unit(); f.sex.value = s.sex || "male"; f.age.value = s.age || ""; f.height_cm.value = s.height_cm || "";
  f.weight.value = state.data?.body ? fmt(toUnit(state.data.body.weight), 1) : ""; f.gemini_key.value = s.gemini_key || "";
  $$("#setup-activity .opt").forEach(b => b.classList.toggle("on", b.dataset.v === (s.activity || "desk")));
  $$("#setup-goal .opt").forEach(b => b.classList.toggle("on", b.dataset.v === (s.goal || "recomp")));
  setupPreview(); $("#setup").showModal();
}
$("#setup-skip").onclick = async () => { await db.setSetting("setup_done", "1"); $("#setup").close(); await loadDay(); };
$("#setup-form").onsubmit = async (e) => {
  e.preventDefault();
  const v = setupVals(); if (!(v.age > 0 && v.height_cm > 0 && v.weight_kg > 0)) return toast("Age, height and weight, please");
  const t = eng.provisionalTargets(v);
  const put = { units: v.units, sex: v.sex, age: v.age, height_cm: v.height_cm, activity: v.activity, goal: v.goal, setup_done: "1",
    provisional_kcal: t.provisional_kcal, recomp_deficit_kcal: t.recomp_deficit_kcal, protein_floor_g: t.protein_floor_g, protein_ceiling_g: t.protein_ceiling_g,
    weight_lo_kg: t.weight_lo_kg ?? "", weight_hi_kg: t.weight_hi_kg ?? "" };
  for (const [k, val] of Object.entries(put)) await db.setSetting(k, val);
  if (v.gemini_key) await db.setSetting("gemini_key", v.gemini_key);
  const at = atFor(nowHM());   // the weight typed here is the first weigh-in
  if (!state.all?.body?.some(b => b.day === todayStr())) await db.add("body", { day: at.slice(0, 10), at, weight_kg: Math.round(v.weight_kg * 100) / 100, bodyfat_pct: null, muscle_kg: null, water_pct: null, source: "manual", ext_id: `manual:${at}:${Date.now()}` });
  $("#setup").close(); toast(`Set: ${fmt(t.provisional_kcal)} kcal rest-day base, protein ${t.protein_floor_g}–${t.protein_ceiling_g} g`, 4000); await changed();
};

// ------------------------------------------------------------ tabs / boot
$$(".tab").forEach(t => t.onclick = async () => {
  state.tab = t.dataset.tab; $$(".tab").forEach(x => x.classList.toggle("is-on", x === t));
  $("#view-today").hidden = state.tab !== "today"; $("#view-trend").hidden = state.tab !== "trend";
  if (state.tab === "trend") await loadTrend();
});
window.addEventListener("resize", () => state.tab === "trend" && state.trend && drawChart());

(async () => {
  try {
    await db.ensureDefaults();
    if (!(await db.all("products")).length) await db.bulkAdd("products", DEFAULT_PRODUCTS);
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    await loadProducts(); await loadDay();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
    if ((await db.setting("relabel_v1")) !== "1") {              // chat rows matched by pattern get clean names, once
      let n = 0; for (const m of await db.all("meals")) { if (m.source !== "backfill") continue; const l = cleanBackfillLabel(m); if (l && l !== m.label) { await db.put("meals", { ...m, label: l }); n++; } }
      await db.setSetting("relabel_v1", "1"); if (n) { await loadDay(); await markDirty(); }
    }
    if (RETIRED_MODELS.includes(state.settings.ai_model)) { await db.setSetting("ai_model", DEFAULT_MODEL); state.settings.ai_model = DEFAULT_MODEL; }
    if ((await db.setting("kinds_v1")) !== "1") {                 // a phone set up before kinds were the person's own keeps its REVL classes
      const s0 = state.settings;
      if (s0.burn_revl_move || s0.burn_revl_sweat || s0.burn_revl_perform) {
        await db.setSetting("workout_kinds", JSON.stringify([{ key: "revl_move", label: "REVL Move" }, { key: "revl_sweat", label: "REVL Sweat" }, { key: "revl_perform", label: "REVL Perform" }, { key: "run", label: "Run" }, { key: "swim", label: "Swim" }, { key: "lift", label: "Strength" }]));
      }
      await db.setSetting("kinds_v1", "1"); await loadDay();
    }
    if (state.settings.setup_done !== "1") {
      if (state.all.meals.length || state.all.body.length) await db.setSetting("setup_done", "1");   // an existing phone already has its targets
      else openSetup();
    }
    retryPending({ force: true });
    const s = state.settings, today = todayStr();
    if (s.gh_token && s.gh_repo) {
      if ((await db.setting("dirty")) === "1") flushBackup();                      // a backup that never got out last time
      sync.applyChatFixes().then(async r => { if (r.ok && !r.skipped) { toast(`Chat: ${r.valued} valued, ${r.added || 0} added`); await loadDay(); await markDirty(); } }).catch(() => {});
      maybePullBody();
    }
  } catch (e) { toast("Startup failed: " + e.message, 6000); console.error(e); }
})();

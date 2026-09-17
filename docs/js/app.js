/* Recomp — phone UI. No server: IndexedDB for data, Gemini for photos, GitHub for durability.
   Today = status + log. Inputs live in bottom sheets opened from the action bar. */
import * as db from "./db.js";
import { DEFAULT_PRODUCTS, shake, recentFoods, EXERCISES, e1rm, liftProgress, cleanBackfillLabel } from "./foods.js";
import * as eng from "./engine.js";
import { estimate as runGemini, readLabel, readWorkout, DEFAULT_MODEL, RETIRED_MODELS } from "./estimate.js";
import * as sync from "./sync.js";

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

const state = { day: todayStr(), settings: {}, data: null, tab: "today", trend: null, products: [],
  est: null, estFiles: [], fixing: null, share: 1, label: null, wo: { kind: "revl_move", sets: [], shot: null } };

let toastT;
function toast(msg, ms = 1800) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); }

// ------------------------------------------------------------ sheets
const sheet = (name) => $(`#sheet-${name}`);
function openSheet(name) {
  const d = sheet(name); if (!d.open) d.showModal();
  if (name === "meal") { renderRecent(); $("#est-time").value = state.day === todayStr() ? nowHM() : "12:00"; }
  if (name === "shake") { $("#shake-time").value = state.day === todayStr() ? nowHM() : "12:00"; previewShake(); }
  if (name === "workout") { $("#wo-time").value = state.day === todayStr() ? nowHM() : "12:00"; renderWorkoutSheet(); }
  if (name === "more") { $("#backup-state2").textContent = $("#backup-state").textContent; }
}
const closeSheets = () => $$("dialog.sheet").forEach(d => d.open && d.close());
$$("#actionbar button").forEach(b => b.onclick = () => openSheet(b.dataset.sheet));
$$("dialog.sheet [data-close]").forEach(b => b.onclick = () => b.closest("dialog").close());
$$("dialog.sheet").forEach(d => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));   // tap the backdrop

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
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { clearTimeout(backupT); flushBackup(); } });
async function changed() { await loadDay(); await markDirty(); }

async function syncFailed(what, e) { await db.setSetting("gh_error", `${what} failed — ${e.message}${e.auth ? ". Fix the token or repo in ⚙ Settings." : ""}`); showSyncWarn(); }
async function syncOk() { if (await db.setting("gh_error")) { await db.setSetting("gh_error", ""); showSyncWarn(); } }
async function showSyncWarn() { const msg = await db.setting("gh_error", ""); const el = $("#sync-warn"); el.hidden = !msg; el.textContent = msg ? "⚠ " + msg : ""; }

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
  const trend = eng.weightTrend(allBody, s), latest = trend.at(-1) || null;
  const wl = parseFloat(s.weight_lo_kg), wh = parseFloat(s.weight_hi_kg), bounded = Number.isFinite(wl) && Number.isFinite(wh);
  const week = eng.weekSummary(allMeals, allWorkouts, allBody, s, todayStr());
  state.all = { meals: allMeals, workouts: allWorkouts, body: allBody };
  state.data = { day, is_today: day === todayStr(), meals, workouts, totals, target, verdict: v, exp, week,
    body: latest ? { ...latest, out_of_bounds: bounded && !(wl <= latest.trend && latest.trend <= wh) } : null,
    pf: parseFloat(s.protein_floor_g), pc: parseFloat(s.protein_ceiling_g) };
  render();
}

const labelKind = (k) => ({ revl_move: "REVL Move", revl_sweat: "REVL Sweat", revl_perform: "REVL Perform",
  run_vest: "Vest run", calves: "Calves", run: "Run", lift: "Strength", swim: "Swim", other: "Workout" }[k] || k);
const workoutLine = (w) => {
  if (w.sets?.length) { const by = {}; for (const s of w.sets) (by[s.exercise] ||= []).push(`${s.weight}×${s.reps}`); return Object.entries(by).map(([e, ss]) => `${e} ${ss.join(", ")}`).join(" · "); }
  return [w.duration_min ? `${w.duration_min} min` : null, w.distance_km ? `${w.distance_km} km` : null, w.kcal ? `${w.kcal} kcal` : null, w.detail].filter(Boolean).join(" · ");
};

function render() {
  const d = state.data; if (!d) return;
  const dt = new Date(d.day + "T12:00:00+08:00");
  $("#day-label").textContent = d.is_today ? "Today" : dt.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
  $("#day-next").disabled = d.is_today;
  const chip = $("#weight-chip");
  if (d.body) {
    chip.hidden = false; chip.className = "weightchip mono" + (d.body.out_of_bounds ? " oob" : "");
    const arrow = d.body.trend > d.body.weight ? "↘" : d.body.trend < d.body.weight ? "↗" : "→";
    chip.innerHTML = `${fmt(d.body.trend, 1)} kg ${arrow}` + (d.body.bodyfat != null ? ` · ${fmt(d.body.bodyfat, 1)}%` : "") + (d.body.creatine ? ` <span class="cw">creatine</span>` : "");
  } else chip.hidden = true;

  const t = d.totals, v = d.verdict, k = d.target;
  $("#p-val").textContent = fmt(t.protein, 0); $("#p-range").textContent = `${fmt(d.pf)}–${fmt(d.pc)}`;
  const pmax = d.pc * 1.25;
  $("#p-fill").style.width = Math.min(100, t.protein / pmax * 100) + "%"; $("#p-fill").className = "fill " + v.protein;
  $("#p-floor").style.left = d.pf / pmax * 100 + "%"; $("#p-ceil").style.left = d.pc / pmax * 100 + "%";
  $("#p-foot").textContent = v.protein_msg + (t.whey ? ` · ${Math.round(t.whey / t.protein * 100)}% from whey` : "");
  const kmax = k.hi * 1.2;
  $("#k-val").textContent = fmt(t.kcal); $("#k-range").textContent = `${fmt(k.lo)}–${fmt(k.hi)}`;
  $("#k-fill").style.width = Math.min(100, t.kcal / kmax * 100) + "%"; $("#k-fill").className = "fill " + v.kcal;
  $("#k-band").style.left = k.lo / kmax * 100 + "%"; $("#k-band").style.width = (k.hi - k.lo) / kmax * 100 + "%";
  const sessionNote = k.sessions ? ` · rest base ${fmt(k.base)} + sessions ${fmt(k.sessions)}` : ` · rest day, base ${fmt(k.base)}`;
  $("#k-foot").textContent = `${v.kcal_msg}${sessionNote} · ${k.source === "measured" ? `measured, ${k.confidence} confidence` : "provisional until the engine has data"}` + (t.kcal ? ` · range ${fmt(t.lo)}–${fmt(t.hi)}` : "");

  const vd = $("#verdict");
  vd.className = "verdict " + (v.kcal === "over" ? "crit" : v.protein === "short" ? "warn" : "ok");
  const head = v.ok_to_end ? "Fine to end the day here." : v.protein === "short" ? "Protein first." : "Over the calorie band.";
  vd.innerHTML = `<span class="lamp"></span><div><b>${head}</b><small>${v.protein_msg} · ${v.kcal_msg}</small></div>`;

  const rows = [...d.meals.map(m => ({ ...m, _t: "meal" })), ...d.workouts.map(w => ({ ...w, _t: "workout" }))].sort((a, b) => a.at.localeCompare(b.at));
  $("#log-count").textContent = `${d.meals.length} meals · ${d.workouts.length} workouts`;
  const log = $("#log"); log.innerHTML = rows.length ? "" : `<li class="empty">Nothing logged yet — use the bar below.</li>`;
  for (const r of rows) {
    const li = document.createElement("li"), time = (r.at || "").slice(11, 16);
    if (r._t === "meal") {
      li.className = r.needs_review ? "review" : "";
      const sub = [r.source === "backfill" ? "from chat" : r.source === "backfill-ai" ? "from chat · AI" : r.source === "backfill-est" ? "from chat · est." : r.source === "photo" ? "estimated" : r.source === "label" ? "label" : null,
        r.share_frac < 1 ? `${Math.round(r.share_frac * 100)}% share` : null, r.venue].filter(Boolean).join(" · ");
      li.innerHTML = `<span class="t">${time}</span><span class="l">${esc(r.label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="n p">${fmt(r.protein_g, 0)}g</span><span class="n">${fmt(r.kcal)}</span><span></span>`;
      li.onclick = () => openRow(r, "meal");
    } else {
      li.className = "workout";
      li.innerHTML = `<span class="t">${time}</span><span class="l">${labelKind(r.kind)}<small>${esc(workoutLine(r))}</small></span><span class="n"></span><span class="n">${r.kcal ? fmt(r.kcal) + " kcal" : ""}</span><span></span>`;
      li.onclick = () => openRow(r, "workout");
    }
    log.appendChild(li);
  }

  // week card
  const w = d.week;
  $("#week").innerHTML = `<div class="row between"><h2 class="eyebrow">This week</h2><span class="mono muted">${w.days_logged} days logged</span></div>
    <div class="week">
      <div class="stat"><b>${w.kcal_avg != null ? fmt(w.kcal_avg) : "—"}</b><span>kcal / complete day</span></div>
      <div class="stat"><b>${w.protein_days}/${w.days_logged || 0}</b><span>days protein hit</span></div>
      <div class="stat"><b>${w.sessions}</b><span>sessions · ${fmt(w.session_kcal)} kcal</span></div>
      <div class="stat"><b>${w.weight_to != null ? fmt(w.weight_to, 1) : "—"}</b><span>${w.weight_from != null && w.weight_to != null ? `trend ${w.weight_to - w.weight_from >= 0 ? "+" : ""}${fmt(w.weight_to - w.weight_from, 2)} kg` : "weight trend"}${w.bodyfat != null ? ` · ${fmt(w.bodyfat, 1)}% fat` : ""}</span></div>
    </div>`;
  $("#est-hint").hidden = !!state.settings.gemini_key;
  showSyncWarn();
}

// ------------------------------------------------------------ meals
async function insertMeal({ label, kcal, lo, hi, protein, source, share = 1, venue = null, detail = null, needs_review = 0, hm = null }) {
  const at = atFor(hm);
  return db.add("meals", { day: at.slice(0, 10), at, label, kcal: Math.round(kcal * share), kcal_lo: Math.round(lo * share), kcal_hi: Math.round(hi * share),
    protein_g: Math.round(protein * share * 10) / 10, source, share_frac: share, venue, detail, needs_review });
}

// recents: what you actually repeat
function renderRecent() {
  const wrap = $("#recent-wrap"), box = $("#recent"); box.innerHTML = "";
  const list = recentFoods(state.all?.meals || [], todayStr(), 8);
  wrap.hidden = !list.length;
  for (const f of list) {
    const b = document.createElement("button"); b.className = "chip";
    b.innerHTML = `${esc(f.label)}<small>${fmt(f.protein_g, 0)}g · ${fmt(f.kcal)} kcal${f.n > 1 ? ` · ×${f.n}` : ""}</small>`;
    b.onclick = async () => { b.disabled = true; await insertMeal({ label: f.label, kcal: f.kcal, lo: f.kcal_lo, hi: f.kcal_hi, protein: f.protein_g, source: "repeat", hm: $("#est-time").value }); toast(`Added ${f.label}`); closeSheets(); changed(); };
    box.appendChild(b);
  }
}

// share segmented
$$("#est-share button").forEach(b => b.onclick = () => { $$("#est-share button").forEach(x => x.classList.toggle("on", x === b)); state.share = parseFloat(b.dataset.v); });

// photos
function onPhotos(e) {
  state.estFiles = [...state.estFiles, ...e.target.files].slice(0, 4);
  const t = $("#est-thumbs"); t.innerHTML = "";
  for (const f of state.estFiles) { const img = document.createElement("img"); img.src = URL.createObjectURL(f); img.alt = ""; t.appendChild(img); }
  e.target.value = "";
}
$("#est-camera").addEventListener("change", onPhotos);
$("#est-gallery").addEventListener("change", onPhotos);

// label photo -> exact values -> servings -> add
$("#est-label").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  $("#est-status").textContent = "reading label…";
  try {
    const { data: L, thumb } = await withModelFallback(() => readLabel({ apiKey: state.settings.gemini_key, model: state.settings.ai_model || DEFAULT_MODEL, image: f }));
    state.label = L; $("#est-status").textContent = `label · ${L.confidence}`;
    const per = L.basis === "serving" ? `per serving (${esc(L.serving_size)})` : `per ${L.basis}`;
    const box = $("#est-result"); box.hidden = false;
    box.innerHTML = `<div class="estcard">
      <div class="row between"><b>${esc(L.product)}</b><span class="pill ${L.confidence === "high" ? "good" : L.confidence === "medium" ? "medium" : "low"}">label</span></div>
      <div class="thumbs"><img src="data:image/jpeg;base64,${thumb}" alt=""></div>
      <p><b>${per}:</b> ${fmt(L.kcal)} kcal · ${fmt(L.protein_g, 1)} g protein${L.servings_per_pack ? ` · ${L.servings_per_pack} servings per pack` : ""}</p>
      <div class="row gap">
        <label class="lbl">${L.basis === "serving" ? "servings eaten" : L.basis === "100ml" ? "ml eaten" : "g eaten"} <input class="num" id="label-qty" type="number" min="0" step="any" value="${L.basis === "serving" ? 1 : (L.serving_g_or_ml || 100)}" inputmode="decimal"></label>
        <span class="mono result" id="label-calc"></span>
      </div>
      <div class="row gap end"><button class="btn" id="label-discard">Discard</button><button class="btn primary" id="label-add">Add to log</button></div>
    </div>`;
    const calc = () => { const q = parseFloat($("#label-qty").value) || 0, mult = L.basis === "serving" ? q : q / 100;
      const kc = L.kcal * mult, p = L.protein_g * mult; $("#label-calc").textContent = `${fmt(p, 1)} g · ${fmt(kc)} kcal`; return { kc, p, q }; };
    calc(); $("#label-qty").addEventListener("input", calc);
    $("#label-discard").onclick = resetEstimate;
    $("#label-add").onclick = async () => {
      const { kc, p, q } = calc();
      await insertMeal({ label: `${L.product} (${q}${L.basis === "serving" ? " serving" + (q === 1 ? "" : "s") : L.basis === "100ml" ? " ml" : " g"})`, kcal: kc, lo: kc * 0.97, hi: kc * 1.03, protein: p, source: "label", share: 1, hm: $("#est-time").value, detail: { label: L } });
      toast(`Added ${L.product}`); resetEstimate(); closeSheets(); changed();
    };
  } catch (err) { $("#est-status").textContent = ""; $("#est-result").hidden = false; $("#est-result").innerHTML = `<div class="estcard err"><b>Couldn't read the label.</b><small>${esc(err.message)}</small></div>`; }
});

// Google retires a model -> switch and retry once
async function withModelFallback(fn) {
  try { return await fn(); }
  catch (e) {
    if (!e.suggestedModel) throw e;
    await db.setSetting("ai_model", e.suggestedModel); state.settings.ai_model = e.suggestedModel; toast(`Switched model to ${e.suggestedModel}`);
    return fn();
  }
}

const rawText = (m) => { let d = m.detail; if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = null; } } return d?.raw || m.label; };
const looksPartial = (m) => m.source === "backfill" && m.kcal < 150 && rawText(m).length > 25;

async function runEstimate(correction = null) {
  const prior = correction != null ? state.est : null;
  const text = correction ?? $("#est-text").value;
  $("#est-status").textContent = prior ? "refining…" : "estimating…"; $("#est-go").disabled = true;
  try {
    const args = { apiKey: state.settings.gemini_key, model: state.settings.ai_model || DEFAULT_MODEL, images: prior ? [] : state.estFiles, text, share: state.share,
      lookupMode: state.settings.ai_lookup || "auto", prior, priorImages: prior ? prior.images : [] };
    const out = await withModelFallback(() => runGemini({ ...args, model: state.settings.ai_model || DEFAULT_MODEL }));
    const at = state.fixing ? ((await db.get("meals", state.fixing))?.at || atFor($("#est-time").value)) : atFor($("#est-time").value);
    const row = { day: at.slice(0, 10), at, text, share: state.share, model: state.settings.ai_model || DEFAULT_MODEL, ident: out.ident, result: out.result,
      thumb: out.thumbs[0] || (prior?.thumb ?? null), notes: out.notes, usage: out.usage, parent_id: prior?.id ?? null, meal_id: null };
    row.id = await db.add("estimates", row);
    state.est = { ...row, images: out.images.length ? out.images : (prior?.images || []) };
    renderEstimate();
    const u = out.usage; $("#est-status").textContent = `${row.model} · ${fmt(u.promptTokenCount || 0)} in / ${fmt(u.candidatesTokenCount || 0)} out · free tier`;
  } catch (e) {
    $("#est-status").textContent = ""; $("#est-result").hidden = false;
    $("#est-result").innerHTML = `<div class="estcard err"><b>Couldn't estimate.</b><small>${esc(e.message)}</small></div>`;
  } finally { $("#est-go").disabled = false; }
}
$("#est-go").onclick = () => { if (!state.estFiles.length && !$("#est-text").value.trim()) return toast("Add a photo or describe it"); runEstimate(); };

function renderEstimate() {
  const e = state.est, r = e.result, box = $("#est-result"); box.hidden = false;
  const items = r.items.map(i => `<li><span>${esc(i.name)}<small>${esc(i.portion)} · ${i.basis === "reference" ? "table" : "model"} · ${i.confidence}</small></span><span class="mono p">${fmt(i.protein_g, 0)}g</span><span class="mono">${fmt(i.kcal)}</span></li>`).join("");
  const pill = r.confidence === "high" ? "good" : r.confidence === "medium" ? "medium" : "low";
  box.innerHTML = `<div class="estcard">
    <div class="row between"><b>${esc(r.dish)}</b><span class="pill ${pill}">${r.confidence}</span></div>
    <div class="big mono"><span class="p">${fmt(r.protein_g, 0)} g</span> · ${fmt(r.kcal)} kcal <small>${fmt(r.kcal_lo)}–${fmt(r.kcal_hi)}</small></div>
    ${e.thumb ? `<div class="thumbs"><img src="data:image/jpeg;base64,${e.thumb}" alt=""></div>` : ""}
    <ul class="items">${items}</ul>
    ${r.model_share > 0.5 ? `<p><b>Note:</b> most of this came from the model's own figures, not the reference table — treat as rough.</p>` : ""}
    ${r.assumptions?.length ? `<p><b>Assumed:</b> ${esc(r.assumptions.join("; "))}</p>` : ""}
    ${r.grounding?.length ? `<p><b>Based on:</b> ${esc(r.grounding.join("; "))}</p>` : ""}
    ${e.notes ? `<p><b>Lookup:</b> ${esc(e.notes)}</p>` : ""}
    ${r.tighten ? `<p><b>Would tighten it:</b> ${esc(r.tighten)}</p>` : ""}
    <div class="row gap"><input class="text grow" id="est-refine" placeholder="Correct it — “only ate half the rice”, “2 wings not 5”"><button class="btn" id="est-refine-go">Refine</button></div>
    <div class="row gap end"><button class="btn" id="est-discard">Discard</button><button class="btn primary" id="est-add">Add to log</button></div>
  </div>`;
  $("#est-refine-go").onclick = () => { const c = $("#est-refine").value.trim(); if (c) runEstimate(c); };
  $("#est-discard").onclick = resetEstimate;
  $("#est-add").onclick = async () => {
    let id = null;
    if (state.fixing) { const meal = await db.get("meals", state.fixing); if (meal) { await valueRow(meal, r, e.id); id = meal.id; } }
    if (id == null) id = await insertMeal({ label: r.dish, kcal: r.kcal, lo: r.kcal_lo, hi: r.kcal_hi, protein: r.protein_g, source: "photo", share: 1, hm: $("#est-time").value, detail: { estimate_id: e.id, confidence: r.confidence, model_share: r.model_share } });
    await db.put("estimates", { ...(await db.get("estimates", e.id)), meal_id: id });
    toast((state.fixing ? "Valued: " : "Added ") + r.dish); resetEstimate(); closeSheets(); changed();
  };
}
function resetEstimate() {
  state.est = null; state.estFiles = []; state.fixing = null; state.label = null; state.share = 1;
  $$("#est-share button").forEach(x => x.classList.toggle("on", x.dataset.v === "1"));
  $("#est-fixing").hidden = true; $("#est-thumbs").innerHTML = ""; $("#est-text").value = "";
  $("#est-result").hidden = true; $("#est-result").innerHTML = ""; $("#est-status").textContent = "";
}
function startFix(meal) {
  resetEstimate(); state.fixing = meal.id; openSheet("meal");
  $("#est-text").value = rawText(meal); $("#est-fixing").hidden = false;
  $("#est-fixing").textContent = `Valuing the row from ${meal.at.slice(11, 16)} — Add to log will replace it.`;
}
async function valueRow(meal, computed, estId) {
  let d = meal.detail; if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = { raw: meal.label }; } }
  await db.put("meals", { ...meal, label: computed.dish, kcal: computed.kcal, kcal_lo: computed.kcal_lo, kcal_hi: computed.kcal_hi, protein_g: computed.protein_g,
    source: "backfill-ai", needs_review: 0, detail: { ...(d || {}), estimate_id: estId, confidence: computed.confidence, model_share: computed.model_share } });
}
$("#manual").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target), kcal = +f.get("kcal");
  await insertMeal({ label: String(f.get("label")).trim(), kcal, lo: kcal * 0.85, hi: kcal * 1.15, protein: +f.get("protein_g"), source: "manual", share: state.share, hm: $("#est-time").value });
  e.target.reset(); toast("Added"); closeSheets(); changed();
};

// ------------------------------------------------------------ row sheet: edit / log again / delete
function openRow(r, kind) {
  const d = sheet("row"), body = $("#row-body");
  $("#row-title").textContent = kind === "meal" ? "Meal" : labelKind(r.kind);
  if (kind === "meal") {
    body.innerHTML = `<div class="rowsheet">
      <p class="meta">${r.at.slice(0, 10)} · ${esc(r.source)}${r.needs_review || looksPartial(r) ? " · not valued yet" : ""}</p>
      <label class="lbl">label <input class="text" id="rw-label" value="${esc(r.label)}"></label>
      <div class="row gap">
        <label class="lbl">kcal <input class="num" id="rw-kcal" type="number" step="1" value="${r.kcal}" inputmode="decimal"></label>
        <label class="lbl">protein g <input class="num" id="rw-p" type="number" step="0.1" value="${r.protein_g}" inputmode="decimal"></label>
        <label class="lbl">time <input class="num" id="rw-time" type="time" value="${r.at.slice(11, 16)}"></label>
      </div>
      <div class="row gap"><button class="btn" id="rw-again">Log again now</button>${(r.source || "").startsWith("backfill") || r.needs_review ? `<button class="btn" id="rw-ai">Value with AI</button>` : ""}</div>
      <div class="row gap"><button class="btn danger" id="rw-del">Delete</button><button class="btn primary" id="rw-save">Save</button></div>
    </div>`;
    $("#rw-save").onclick = async () => {
      const kcal = parseFloat($("#rw-kcal").value) || 0, ratio = r.kcal ? kcal / r.kcal : 1;
      await db.put("meals", { ...r, label: $("#rw-label").value.trim() || r.label, kcal, kcal_lo: Math.round(r.kcal ? r.kcal_lo * ratio : kcal * 0.85), kcal_hi: Math.round(r.kcal ? r.kcal_hi * ratio : kcal * 1.15),
        protein_g: parseFloat($("#rw-p").value) || 0, at: `${r.day}T${$("#rw-time").value || r.at.slice(11, 16)}+08:00`, needs_review: 0, source: r.needs_review ? "manual" : r.source });
      d.close(); toast("Saved"); changed();
    };
    $("#rw-again").onclick = async () => { await insertMeal({ label: r.label, kcal: r.kcal, lo: r.kcal_lo, hi: r.kcal_hi, protein: r.protein_g, source: "repeat" }); d.close(); toast(`Added ${r.label}`); changed(); };
    $("#rw-del").onclick = async () => { await db.del("meals", r.id); d.close(); toast("Removed"); changed(); };
    if ($("#rw-ai")) $("#rw-ai").onclick = () => { d.close(); startFix(r); };
  } else {
    body.innerHTML = `<div class="rowsheet">
      <p class="meta">${r.at.slice(0, 10)} · ${esc(workoutLine(r) || "—")}</p>
      <div class="row gap">
        <label class="lbl">kcal <input class="num" id="rw-kcal" type="number" step="1" value="${r.kcal || ""}" placeholder="default" inputmode="decimal"></label>
        <label class="lbl">time <input class="num" id="rw-time" type="time" value="${r.at.slice(11, 16)}"></label>
      </div>
      <label class="lbl">note <input class="text" id="rw-note" value="${esc(r.detail || "")}"></label>
      <div class="row gap"><button class="btn danger" id="rw-del">Delete</button><button class="btn primary" id="rw-save">Save</button></div>
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
  await insertMeal({ label: s.label, kcal: s.kcal, lo: s.kcal_lo, hi: s.kcal_hi, protein: s.protein_g, source: "shake", hm: $("#shake-time").value, detail: { whey_g: +$("#whey").value, milk_ml: +$("#milk").value, whey_id: w.id, milk_id: m.id, breakdown: s.breakdown } });
  toast("Shake added"); closeSheets(); changed();
};
const openProduct = () => { $("#product-form").reset(); $("#prod-status").textContent = ""; syncPer(); $("#product").showModal(); };
$("#btn-product").onclick = openProduct; $("#btn-product2").onclick = openProduct;
const syncPer = () => { const per = $("#product-kind").value === "whey" ? "/g" : "/100ml"; $("#product-per").textContent = per; $("#product-per2").textContent = per; };
$("#product-kind").addEventListener("change", syncPer);
$("#prod-label").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  $("#prod-status").textContent = "reading…";
  try {
    const { data: L } = await withModelFallback(() => readLabel({ apiKey: state.settings.gemini_key, model: state.settings.ai_model || DEFAULT_MODEL, image: f }));
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
const CARDIO = new Set(["revl_move", "revl_sweat", "revl_perform", "run", "swim"]);
function renderWorkoutSheet() {
  $$("#wo-kinds .chip").forEach(c => c.classList.toggle("on", c.dataset.kind === state.wo.kind));
  const strength = state.wo.kind === "lift";
  $("#wo-cardio").hidden = strength; $("#wo-strength").hidden = !strength;
  $("#wo-km").parentElement.hidden = !["run", "swim"].includes(state.wo.kind);
  const dflt = parseFloat(state.settings["burn_" + state.wo.kind] || state.settings.burn_other || 0);
  $("#wo-burn-note").textContent = `Without a kcal figure, ${labelKind(state.wo.kind)} counts as ${fmt(dflt)} kcal (⚙ to change). A screenshot with calories overrides it.`;
  if (!$("#wo-exercise").options.length) for (const x of EXERCISES) { const o = document.createElement("option"); o.value = x; o.textContent = x; $("#wo-exercise").appendChild(o); }
  const box = $("#wo-sets"); box.innerHTML = "";
  state.wo.sets.forEach((s, i) => {
    const el = document.createElement("div"); el.className = "set";
    el.innerHTML = `<span>${i + 1}</span><span>${esc(s.exercise)}</span><span>${s.weight} kg × ${s.reps} <span class="e1">e1RM ${e1rm(s.weight, s.reps)}</span></span><button class="x" aria-label="Remove">×</button>`;
    el.querySelector(".x").onclick = () => { state.wo.sets.splice(i, 1); renderWorkoutSheet(); };
    box.appendChild(el);
  });
}
$$("#wo-kinds .chip").forEach(c => c.onclick = () => { state.wo.kind = c.dataset.kind; renderWorkoutSheet(); });
$("#wo-addset").onclick = () => {
  const w = parseFloat($("#wo-w").value), r = parseInt($("#wo-r").value, 10);
  if (!Number.isFinite(w) || !r) return toast("Weight and reps");
  state.wo.sets.push({ exercise: $("#wo-exercise").value, weight: w, reps: r }); $("#wo-r").value = ""; renderWorkoutSheet();
};
$("#wo-shot").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  $("#wo-shot-status").textContent = "reading…";
  try {
    const { data: W } = await withModelFallback(() => readWorkout({ apiKey: state.settings.gemini_key, model: state.settings.ai_model || DEFAULT_MODEL, image: f }));
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
  const kind = state.wo.kind, at = atFor($("#wo-time").value);
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
  const w = parseFloat($("#bw-kg").value); if (!w) return toast("Weight?");
  const bf = parseFloat($("#bw-bf").value), at = atFor("07:00");
  await db.add("body", { day: at.slice(0, 10), at, weight_kg: w, bodyfat_pct: Number.isFinite(bf) ? bf : null, muscle_kg: null, water_pct: null, source: "manual", ext_id: `manual:${at}` });
  $("#bw-kg").value = ""; $("#bw-bf").value = ""; toast("Weight logged"); closeSheets(); changed();
};
$("#btn-backup2").onclick = (e) => { closeSheets(); $("#btn-backup").click(); };

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
  $("#legend-band").textContent = bounded ? `${wl}–${wh} target` : "target range (set in ⚙)";
  drawChart(); renderExpenditure(); renderLifts();
  const last = state.trend.points.at(-1);
  $("#trend-latest").textContent = last ? `${last.weight} kg · trend ${last.trend}` + (last.bodyfat != null ? ` · ${last.bodyfat}% fat` : "") : "no weigh-ins yet";
  $("#btn-fixall").hidden = !state.all.meals.some(m => m.needs_review || looksPartial(m));
  $("#backup-state").textContent = s.last_backup ? "last backup " + new Date(s.last_backup).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never backed up";
  // how current the scale data is — answers "why isn't today's weigh-in here"
  const lastBody = state.all.body.slice().sort((x, y) => x.at.localeCompare(y.at)).at(-1);
  const el = $("#body-fresh");
  if (lastBody) {
    const days = Math.round((new Date(todayStr()) - new Date(lastBody.day)) / 864e5);
    el.textContent = days === 0 ? `Latest weigh-in: today, ${lastBody.weight_kg} kg.`
      : `Latest weigh-in: ${lastBody.day} (${days} day${days > 1 ? "s" : ""} ago), ${lastBody.weight_kg} kg. The Renpho job runs every 3 hours — Pull weigh-ins asks it to run now.`;
    el.className = days >= 2 ? "note warn" : "note";
  } else el.textContent = "";
}
function drawChart() {
  const c = $("#chart"), dpr = window.devicePixelRatio || 1, W = c.clientWidth || 320, H = 220;
  c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), col = (v) => css.getPropertyValue(v).trim();
  ctx.clearRect(0, 0, W, H);
  const pts = state.trend.points;
  if (!pts.length) { ctx.fillStyle = col("--faint"); ctx.font = "13px " + col("--mono"); ctx.textAlign = "center"; ctx.fillText("No weigh-ins yet — pull from GitHub or log one under More", W / 2, H / 2); return; }
  const pad = { l: 38, r: 34, t: 10, b: 22 }, day0 = new Date(pts[0].day), nDays = Math.max(7, (new Date() - day0) / 864e5);
  const x = (d) => pad.l + ((new Date(d) - day0) / 864e5) / nDays * (W - pad.l - pad.r);
  const ws = pts.flatMap(p => [p.weight, p.trend]).concat(state.trend.weight_lo != null ? [state.trend.weight_lo, state.trend.weight_hi] : []);
  const ymin = Math.min(...ws) - 0.5, ymax = Math.max(...ws) + 0.5, y = (v) => pad.t + (1 - (v - ymin) / (ymax - ymin)) * (H - pad.t - pad.b);
  if (state.trend.weight_lo != null) { ctx.fillStyle = col("--ok"); ctx.globalAlpha = 0.14; ctx.fillRect(pad.l, y(state.trend.weight_hi), W - pad.l - pad.r, y(state.trend.weight_lo) - y(state.trend.weight_hi)); ctx.globalAlpha = 1; }
  const cw = state.trend.creatine_window;
  if (cw) { const x0 = Math.max(pad.l, x(cw[0])), x1 = Math.min(W - pad.r, x(cw[1])); if (x1 > x0) { ctx.save(); ctx.beginPath(); ctx.rect(x0, pad.t, x1 - x0, H - pad.t - pad.b); ctx.clip(); ctx.strokeStyle = col("--faint"); ctx.globalAlpha = 0.5; for (let i = -H; i < W; i += 7) { ctx.beginPath(); ctx.moveTo(x0 + i, H); ctx.lineTo(x0 + i + H, 0); ctx.stroke(); } ctx.restore(); } }
  ctx.font = "10px " + col("--mono"); ctx.fillStyle = col("--faint"); ctx.textAlign = "right"; ctx.strokeStyle = col("--line"); ctx.lineWidth = 1;
  for (let v = Math.ceil(ymin); v <= ymax; v += 1) { ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(W - pad.r, y(v)); ctx.stroke(); ctx.fillText(v, pad.l - 6, y(v) + 3); }
  ctx.textAlign = "left"; ctx.fillText(pts[0].day.slice(5), pad.l, H - 6); ctx.textAlign = "right"; ctx.fillText(todayStr().slice(5), W - pad.r, H - 6);
  // body fat on its own right-hand scale
  const bf = pts.filter(p => p.bodyfat != null);
  if (bf.length > 1) {
    const bmin = Math.min(...bf.map(p => p.bodyfat)) - 1, bmax = Math.max(...bf.map(p => p.bodyfat)) + 1, yb = (v) => pad.t + (1 - (v - bmin) / (bmax - bmin)) * (H - pad.t - pad.b);
    ctx.strokeStyle = col("--accent-2"); ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.beginPath();
    bf.forEach((p, i) => i ? ctx.lineTo(x(p.day), yb(p.bodyfat)) : ctx.moveTo(x(p.day), yb(p.bodyfat))); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col("--accent-2"); ctx.textAlign = "left"; ctx.fillText(`${bf.at(-1).bodyfat}%`, W - pad.r + 4, yb(bf.at(-1).bodyfat) + 3);
  }
  ctx.fillStyle = col("--ink"); ctx.globalAlpha = 0.55; for (const p of pts) { ctx.beginPath(); ctx.arc(x(p.day), y(p.weight), 2.5, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1;
  ctx.strokeStyle = col("--accent"); ctx.lineWidth = 2.2; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(x(p.day), y(p.trend)) : ctx.moveTo(x(p.day), y(p.trend))); ctx.stroke();
  const last = pts.at(-1); ctx.fillStyle = col("--accent"); ctx.beginPath(); ctx.arc(x(last.day), y(last.trend), 4, 0, Math.PI * 2); ctx.fill();
}
function renderExpenditure() {
  const cur = state.trend.current, el = $("#expenditure");
  const pill = `<span class="pill ${cur.confidence}">${cur.confidence === "none" ? "provisional" : cur.confidence + " confidence"}</span>`;
  el.innerHTML = cur.source === "provisional"
    ? `<h2 class="eyebrow">Expenditure</h2><div class="exp"><div class="big">${fmt(cur.base)} <small>kcal rest-day base · provisional</small></div>${pill}<p>${esc(cur.note)}</p><p>After ~7 complete days with weigh-ins outside the creatine window, this comes from your own intake and weight trend, not a formula.</p></div>`
    : `<h2 class="eyebrow">Expenditure</h2><div class="exp"><div class="big">${fmt(cur.tdee)} <small>kcal/day measured average</small></div>${pill}
      <p>Of that, ~${fmt(cur.session_avg)}/day was the training you logged in the window, so rest-day expenditure is ~${fmt(cur.rest_base)}. Minus the deficit: <b>${fmt(cur.base)} on a rest day</b>, plus each session's burn on the days you train.</p>
      <p>${esc(cur.note)}</p><p>As of ${cur.as_of}. Recomputed on every load.</p></div>`;
}
function renderLifts() {
  const el = $("#lifts"), rows = liftProgress(state.all.workouts);
  el.hidden = !rows.length;
  if (!rows.length) return;
  el.innerHTML = `<h2 class="eyebrow">Lifts</h2>` + rows.map(r => `<div class="lift">
    <div>${esc(r.exercise)}<small>best ${esc(r.best_set)} on ${r.best_day} · last ${esc(r.last_set)} · ${r.sessions} session${r.sessions > 1 ? "s" : ""}</small></div>
    <div class="mono"><b>${fmt(r.best, 1)}</b> <small>e1RM${r.goal ? ` / ${r.goal}` : ""}</small></div>
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
      const model = state.settings.ai_model || DEFAULT_MODEL;
      const out = await withModelFallback(() => runGemini({ apiKey: state.settings.gemini_key, model: state.settings.ai_model || model, images: [], text: rawText(m), share: 1, lookupMode: "off" }));
      const estId = await db.add("estimates", { day: m.day, at: m.at, text: rawText(m), share: 1, model, ident: out.ident, result: out.result, thumb: null, notes: null, usage: out.usage, parent_id: null, meal_id: m.id });
      await valueRow(m, out.result, estId); done++;
    } catch (err) { failed++; if (/rate limit/i.test(err.message)) { dataMsg(`Rate limit after ${done}. Waiting 60 s…`); await wait(60000); } else if (failed > 3) { dataMsg(`Stopped after ${done}: ${err.message}`); break; } }
    await wait(7000);
  }
  dataMsg(`Valued ${done} of ${rows.length}${failed ? `, ${failed} failed` : ""}.`); await loadTrend(); await markDirty();
});
$("#btn-backup").onclick = (e) => guarded(e.target, async () => { dataMsg("Backing up…"); const r = await sync.pushBackup(); await db.setSetting("dirty", "0"); dataMsg(`Backed up ${r.meals} meals, ${r.body} weigh-ins.`); await loadTrend(); });
$("#btn-restore").onclick = (e) => guarded(e.target, async () => { if (!confirm("Replace everything on this phone with the GitHub backup?")) return; const r = await sync.restoreBackup(); dataMsg(r.ok ? `Restored ${r.meals} meals from ${r.exported_at}.` : r.error); await loadProducts(); await loadTrend(); });
$("#btn-export").onclick = async () => { const blob = new Blob([JSON.stringify(await db.dump())], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `recomp-${todayStr()}.json`; a.click(); };
$("#import-file").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return; const data = JSON.parse(await f.text());
  if (data.version && data.meals && data.settings && !Array.isArray(data.settings)) { const r = await sync.importSeedData(data); dataMsg(`Imported seed: ${r.meals} meals.`); }
  else { if (!confirm("Replace everything on this phone with this file?")) return; await db.restore(data); dataMsg("Restored from file."); }
  e.target.value = ""; await loadProducts(); await loadTrend(); await markDirty();
});

// ------------------------------------------------------------ settings
const SETTINGS = [
  ["gemini_key", "Gemini API key (free, aistudio.google.com)", "password"], ["ai_model", "Gemini model", "text"], ["ai_lookup", "Venue lookup: auto / on / off", "text"],
  ["gh_repo", "GitHub data repo (owner/name)", "text"], ["gh_token", "GitHub token (Contents read/write)", "password"], ["backup_auto", "Auto-backup after changes (1/0)", "text"],
  ["protein_floor_g", "Protein floor (g)", "text"], ["protein_ceiling_g", "Protein ceiling (g)", "text"],
  ["weight_lo_kg", "Weight low (kg)", "text"], ["weight_hi_kg", "Weight high (kg)", "text"],
  ["provisional_kcal", "Provisional rest-day base (kcal)", "text"], ["recomp_deficit_kcal", "Recomp deficit (kcal)", "text"],
  ["creatine_start", "Creatine start (YYYY-MM-DD)", "text"], ["creatine_settle_days", "Creatine settle (days)", "text"],
  ["burn_revl_move", "Burn: REVL Move (kcal)", "text"], ["burn_revl_sweat", "Burn: REVL Sweat", "text"], ["burn_revl_perform", "Burn: REVL Perform", "text"],
  ["burn_run", "Burn: Run (no kcal given)", "text"], ["burn_swim", "Burn: Swim (no kcal given)", "text"], ["burn_lift", "Burn: Strength session", "text"], ["burn_other", "Burn: other", "text"],
];
$("#btn-settings").onclick = async () => {
  const s = await db.allSettings();
  $("#settings-fields").innerHTML = SETTINGS.map(([k, l, type]) => `<label class="lbl ${k.startsWith("g") ? "wide" : ""}">${l}<input class="num" type="${type}" name="${k}" value="${esc(s[k] ?? "")}" autocomplete="off"></label>`).join("");
  $("#settings").showModal();
};
$("#settings-form").onsubmit = async (e) => {
  if (e.submitter?.value !== "save") return;
  const f = new FormData(e.target);
  for (const [k] of SETTINGS) await db.setSetting(k, String(f.get(k) ?? "").trim());
  toast("Saved"); await loadDay(); if (state.tab === "trend") await loadTrend();
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
    const s = state.settings, today = todayStr();
    if (s.gh_token && s.gh_repo) {
      if ((await db.setting("dirty")) === "1") flushBackup();                      // a backup that never got out last time
      sync.applyChatFixes().then(async r => { if (r.ok && !r.skipped) { toast(`Chat: ${r.valued} valued, ${r.added || 0} added`); await loadDay(); await markDirty(); } }).catch(() => {});
      if (s.last_pull !== today) sync.pullBody().then(async r => { if (r.ok) { await db.setSetting("last_pull", today); await syncOk(); if (r.added) { toast(`${r.added} new weigh-in${r.added > 1 ? "s" : ""}`); await loadDay(); } } }).catch(e => syncFailed("Weigh-in pull", e));
    }
  } catch (e) { toast("Startup failed: " + e.message, 6000); console.error(e); }
})();

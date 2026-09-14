/* Recomp — phone UI. No server: IndexedDB for data, Gemini for photos, GitHub for durability. */
import * as db from "./db.js";
import { QUICK, QUICK_BY_ID, DEFAULT_PRODUCTS, shake } from "./foods.js";
import * as eng from "./engine.js";
import { estimate as runGemini, DEFAULT_MODEL } from "./estimate.js";
import * as sync from "./sync.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (n, d = 0) => Number(n || 0).toLocaleString("en-SG", { maximumFractionDigits: d, minimumFractionDigits: d });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const SGT = "Asia/Singapore";
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: SGT });
function nowIso() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: SGT, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}+08:00`;
}

const state = { day: todayStr(), settings: {}, data: null, tab: "today", est: null, estFiles: [], trend: null, products: [] };

let toastT;
function toast(msg, ms = 1800) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); }
const atFor = () => (state.day === todayStr() ? nowIso() : `${state.day}T12:00+08:00`);

// ------------------------------------------------------------ backup (debounced)
let backupT = null;
function scheduleBackup() {
  if (state.settings.backup_auto !== "1" || !state.settings.gh_token || !state.settings.gh_repo) return;
  clearTimeout(backupT);
  backupT = setTimeout(async () => {
    try { await sync.pushBackup(); $("#backup-state").textContent = "backed up " + new Date().toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" }); }
    catch (e) { $("#backup-state").textContent = "backup failed: " + e.message; }
  }, 60000);
}
async function changed() { await loadDay(); scheduleBackup(); }

// ------------------------------------------------------------ day model
async function loadDay(day = state.day) {
  state.day = day;
  state.settings = await db.allSettings();
  const s = state.settings;
  const meals = (await db.byIndex("meals", "day", day)).sort((a, b) => a.at.localeCompare(b.at));
  const workouts = (await db.byIndex("workouts", "day", day)).sort((a, b) => a.at.localeCompare(b.at));
  const allMeals = await db.all("meals"), allBody = await db.all("body");

  const totals = { kcal: 0, lo: 0, hi: 0, protein: 0, whey: 0 };
  for (const m of meals) {
    totals.kcal += m.kcal; totals.lo += m.kcal_lo; totals.hi += m.kcal_hi; totals.protein += m.protein_g;
    if (m.source === "shake" || /whey/i.test(m.label || "")) totals.whey += m.protein_g;
  }
  const exp = eng.estimateExpenditure(allMeals, allBody, s, todayStr());
  const target = eng.currentTarget(exp, s);
  const v = eng.verdict(totals, meals.length > 0, s, target);
  const trend = eng.weightTrend(allBody, s), latest = trend.at(-1) || null;
  const wl = parseFloat(s.weight_lo_kg), wh = parseFloat(s.weight_hi_kg);
  state.data = { day, is_today: day === todayStr(), meals, workouts, totals, target, verdict: v, exp,
    body: latest ? { ...latest, out_of_bounds: !(wl <= latest.trend && latest.trend <= wh) } : null,
    pf: parseFloat(s.protein_floor_g), pc: parseFloat(s.protein_ceiling_g) };
  render();
}

const labelKind = (k) => ({ revl_move: "REVL Move", revl_sweat: "REVL Sweat", revl_perform: "REVL Perform",
  run_vest: "Vest run", run: "Run", lift: "Lift", swim: "Swim", other: "Workout" }[k] || k);

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
  $("#p-val").textContent = fmt(t.protein, 0);
  $("#p-range").textContent = `${fmt(d.pf)}–${fmt(d.pc)}`;
  const pmax = d.pc * 1.25;
  $("#p-fill").style.width = Math.min(100, t.protein / pmax * 100) + "%"; $("#p-fill").className = "fill " + v.protein;
  $("#p-floor").style.left = d.pf / pmax * 100 + "%"; $("#p-ceil").style.left = d.pc / pmax * 100 + "%";
  $("#p-foot").textContent = v.protein_msg + (t.whey ? ` · ${Math.round(t.whey / t.protein * 100)}% from whey` : "");
  const kmax = k.hi * 1.2;
  $("#k-val").textContent = fmt(t.kcal); $("#k-range").textContent = `${fmt(k.lo)}–${fmt(k.hi)}`;
  $("#k-fill").style.width = Math.min(100, t.kcal / kmax * 100) + "%"; $("#k-fill").className = "fill " + v.kcal;
  $("#k-band").style.left = k.lo / kmax * 100 + "%"; $("#k-band").style.width = (k.hi - k.lo) / kmax * 100 + "%";
  $("#k-foot").textContent = `${v.kcal_msg} · ${k.source === "measured" ? `measured, ${k.confidence} confidence` : "provisional until the engine has data"}` + (t.kcal ? ` · range ${fmt(t.lo)}–${fmt(t.hi)}` : "");

  const vd = $("#verdict");
  vd.className = "verdict " + (v.kcal === "over" ? "crit" : v.protein === "short" ? "warn" : "ok");
  const head = v.ok_to_end ? "Fine to end the day here." : v.protein === "short" ? "Protein first." : "Over the calorie band.";
  vd.innerHTML = `<span class="lamp"></span><div><b>${head}</b><small>${v.protein_msg} · ${v.kcal_msg}</small></div>`;

  const kinds = new Set(d.workouts.map(w => w.kind));
  $$("#workouts .chip").forEach(c => c.classList.toggle("done", kinds.has(c.dataset.kind)));

  const rows = [...d.meals.map(m => ({ ...m, _t: "meal" })), ...d.workouts.map(w => ({ ...w, _t: "workout" }))].sort((a, b) => a.at.localeCompare(b.at));
  $("#log-count").textContent = `${d.meals.length} meals · ${d.workouts.length} workouts`;
  const log = $("#log"); log.innerHTML = rows.length ? "" : `<li class="empty">Nothing logged yet.</li>`;
  for (const r of rows) {
    const li = document.createElement("li"), time = (r.at || "").slice(11, 16);
    if (r._t === "meal") {
      li.className = r.needs_review ? "review" : "";
      const sub = [r.source === "backfill" ? "from chat" : r.source === "photo" ? "estimated" : null, r.share_frac < 1 ? `${Math.round(r.share_frac * 100)}% share` : null, r.venue].filter(Boolean).join(" · ");
      li.innerHTML = `<span class="t">${time}</span><span class="l">${esc(r.label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="n p">${fmt(r.protein_g, 0)}g</span><span class="n">${fmt(r.kcal)}</span><button class="x" aria-label="Delete">×</button>`;
      $(".x", li).onclick = async () => { await db.del("meals", r.id); toast("Removed"); changed(); };
    } else {
      li.className = "workout";
      li.innerHTML = `<span class="t">${time}</span><span class="l">${labelKind(r.kind)}${r.detail ? `<small>${esc(r.detail)}</small>` : ""}</span><span class="n"></span><span class="n"></span><button class="x" aria-label="Delete">×</button>`;
      $(".x", li).onclick = async () => { await db.del("workouts", r.id); toast("Removed"); changed(); };
    }
    log.appendChild(li);
  }
  $("#est-hint").hidden = !!state.settings.gemini_key;
}

// ------------------------------------------------------------ meals
async function insertMeal({ label, kcal, lo, hi, protein, source, share = 1, venue = null, detail = null, needs_review = 0 }) {
  const at = atFor();
  return db.add("meals", { day: at.slice(0, 10), at, label, kcal: Math.round(kcal * share), kcal_lo: Math.round(lo * share), kcal_hi: Math.round(hi * share),
    protein_g: Math.round(protein * share * 10) / 10, source, share_frac: share, venue, detail, needs_review });
}

// ------------------------------------------------------------ estimate
$("#est-files").addEventListener("change", (e) => {
  state.estFiles = [...e.target.files];
  const t = $("#est-thumbs"); t.innerHTML = "";
  for (const f of state.estFiles) { const img = document.createElement("img"); img.src = URL.createObjectURL(f); img.alt = ""; t.appendChild(img); }
});
async function runEstimate(correction = null) {
  const prior = correction != null ? state.est : null;
  const text = correction ?? $("#est-text").value;
  const share = parseFloat($("#est-share").value) || 1;
  $("#est-status").textContent = prior ? "refining…" : "estimating…"; $("#est-go").disabled = true;
  try {
    const out = await runGemini({ apiKey: state.settings.gemini_key, model: state.settings.ai_model || DEFAULT_MODEL,
      images: prior ? [] : state.estFiles, text, share, lookupMode: state.settings.ai_lookup || "auto",
      prior, priorImages: prior ? prior.images : [] });
    const at = atFor();
    const row = { day: at.slice(0, 10), at, text, share, model: state.settings.ai_model || DEFAULT_MODEL,
      ident: out.ident, result: out.result, thumb: out.thumbs[0] || (prior?.thumb ?? null), notes: out.notes, usage: out.usage, parent_id: prior?.id ?? null, meal_id: null };
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
    <div class="row gap"><input class="text grow" id="est-refine" placeholder="Correct it — “only ate half the rice”, “it was 2 wings not 5”"><button class="btn" id="est-refine-go">Refine</button></div>
    <div class="row gap end"><button class="btn" id="est-discard">Discard</button><button class="btn primary" id="est-add">Add to log</button></div>
  </div>`;
  $("#est-refine-go").onclick = () => { const c = $("#est-refine").value.trim(); if (c) runEstimate(c); };
  $("#est-discard").onclick = resetEstimate;
  $("#est-add").onclick = async () => {
    const id = await insertMeal({ label: r.dish, kcal: r.kcal, lo: r.kcal_lo, hi: r.kcal_hi, protein: r.protein_g, source: "photo", share: 1,
      detail: { estimate_id: e.id, confidence: r.confidence, model_share: r.model_share } });
    await db.put("estimates", { ...(await db.get("estimates", e.id)), meal_id: id });
    toast(`Added ${r.dish}`); resetEstimate(); changed();
  };
}
function resetEstimate() {
  state.est = null; state.estFiles = [];
  $("#est-files").value = ""; $("#est-thumbs").innerHTML = ""; $("#est-text").value = ""; $("#est-share").value = "1";
  $("#est-result").hidden = true; $("#est-result").innerHTML = ""; $("#est-status").textContent = "";
}

// ------------------------------------------------------------ quick add / shake / products
function renderQuick() {
  const q = $("#quick"); q.innerHTML = "";
  for (const f of QUICK) {
    const b = document.createElement("button"); b.className = "chip";
    b.innerHTML = `${esc(f.label)}<small>${fmt(f.protein, 0)}g · ${fmt(f.kcal)} kcal</small>`;
    b.onclick = async () => { b.disabled = true; try { await insertMeal({ label: f.label, kcal: f.kcal, lo: f.lo, hi: f.hi, protein: f.protein, source: "quick", detail: { quick_id: f.id } }); toast(`Added ${f.label}`); changed(); } finally { b.disabled = false; } };
    q.appendChild(b);
  }
}
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
  await insertMeal({ label: s.label, kcal: s.kcal, lo: s.kcal_lo, hi: s.kcal_hi, protein: s.protein_g, source: "shake", detail: { whey_g: +$("#whey").value, milk_ml: +$("#milk").value, whey_id: w.id, milk_id: m.id, breakdown: s.breakdown } });
  toast("Shake added"); changed();
};
$("#btn-product").onclick = () => { $("#product-form").reset(); syncPer(); $("#product").showModal(); };
const syncPer = () => { const per = $("#product-kind").value === "whey" ? "/g" : "/100ml"; $("#product-per").textContent = per; $("#product-per2").textContent = per; };
$("#product-kind").addEventListener("change", syncPer);
$("#product-form").onsubmit = async (e) => {
  if (e.submitter?.value !== "save") return;
  e.preventDefault();
  const f = new FormData(e.target), kind = f.get("kind"), makeDefault = !!f.get("make_default");
  if (makeDefault) for (const p of state.products.filter(p => p.kind === kind && p.is_default)) await db.put("products", { ...p, is_default: 0 });
  await db.add("products", { kind, label: String(f.get("label")).trim(), per: kind === "whey" ? "g" : "100ml", kcal: +f.get("kcal"), protein_g: +f.get("protein_g"), is_default: makeDefault ? 1 : 0, active: 1 });
  $("#product").close(); toast("Saved"); await loadProducts(); scheduleBackup();
};

// ------------------------------------------------------------ workouts / manual
$$("#workouts .chip").forEach(c => c.onclick = async () => {
  let detail = null;
  if (c.dataset.kind === "lift") detail = prompt("What did you lift? e.g. 3RM back squat 100kg, or calves") || null;
  if (c.dataset.kind === "revl_perform") detail = prompt("Upper or lower?", "upper") || null;
  if (c.dataset.kind === "run_vest") detail = (prompt("Distance? e.g. 3km", "3km") || "") + " 10kg vest";
  const at = atFor();
  await db.add("workouts", { day: at.slice(0, 10), at, kind: c.dataset.kind, detail, source: "manual" });
  toast(`${labelKind(c.dataset.kind)} logged`); changed();
});
$("#manual").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target), kcal = +f.get("kcal");
  await insertMeal({ label: String(f.get("label")).trim(), kcal, lo: kcal * 0.85, hi: kcal * 1.15, protein: +f.get("protein_g"), source: "manual", share: +f.get("share_frac") || 1 });
  e.target.reset(); toast("Added"); changed();
};

// ------------------------------------------------------------ day nav
const shift = (n) => loadDay(eng.addDays(state.day, n));
$("#day-prev").onclick = () => shift(-1); $("#day-next").onclick = () => shift(1); $("#day-label").onclick = () => loadDay(todayStr());

// ------------------------------------------------------------ trend
async function loadTrend() {
  await loadDay();                                   // fresh expenditure + target
  const s = state.settings, body = await db.all("body");
  const start = eng.addDays(todayStr(), -120);
  state.trend = { points: eng.weightTrend(body.filter(b => b.day >= start), s), current: state.data.target,
    weight_lo: parseFloat(s.weight_lo_kg), weight_hi: parseFloat(s.weight_hi_kg), creatine_window: eng.creatineWindow(s) };
  drawChart(); renderExpenditure();
  const last = state.trend.points.at(-1);
  $("#trend-latest").textContent = last ? `${last.weight} kg · trend ${last.trend}` + (last.bodyfat != null ? ` · ${last.bodyfat}% fat` : "") : "no weigh-ins yet";
  $("#backup-state").textContent = s.last_backup ? "last backup " + new Date(s.last_backup).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never backed up";
}
function drawChart() {
  const c = $("#chart"), dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = 220;
  c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), col = (v) => css.getPropertyValue(v).trim();
  ctx.clearRect(0, 0, W, H);
  const pts = state.trend.points;
  if (!pts.length) { ctx.fillStyle = col("--faint"); ctx.font = "13px " + col("--mono"); ctx.textAlign = "center"; ctx.fillText("No weigh-ins yet — pull from GitHub or log one by hand", W / 2, H / 2); return; }
  const pad = { l: 38, r: 10, t: 10, b: 22 }, day0 = new Date(pts[0].day), nDays = Math.max(7, (new Date() - day0) / 864e5);
  const x = (d) => pad.l + ((new Date(d) - day0) / 864e5) / nDays * (W - pad.l - pad.r);
  const ws = pts.flatMap(p => [p.weight, p.trend]).concat([state.trend.weight_lo, state.trend.weight_hi]);
  const ymin = Math.min(...ws) - 0.5, ymax = Math.max(...ws) + 0.5, y = (v) => pad.t + (1 - (v - ymin) / (ymax - ymin)) * (H - pad.t - pad.b);
  ctx.fillStyle = col("--ok"); ctx.globalAlpha = 0.14; ctx.fillRect(pad.l, y(state.trend.weight_hi), W - pad.l - pad.r, y(state.trend.weight_lo) - y(state.trend.weight_hi)); ctx.globalAlpha = 1;
  const cw = state.trend.creatine_window;
  if (cw) { const x0 = Math.max(pad.l, x(cw[0])), x1 = Math.min(W - pad.r, x(cw[1])); if (x1 > x0) { ctx.save(); ctx.beginPath(); ctx.rect(x0, pad.t, x1 - x0, H - pad.t - pad.b); ctx.clip(); ctx.strokeStyle = col("--faint"); ctx.globalAlpha = 0.5; for (let i = -H; i < W; i += 7) { ctx.beginPath(); ctx.moveTo(x0 + i, H); ctx.lineTo(x0 + i + H, 0); ctx.stroke(); } ctx.restore(); } }
  ctx.font = "10px " + col("--mono"); ctx.fillStyle = col("--faint"); ctx.textAlign = "right"; ctx.strokeStyle = col("--line"); ctx.lineWidth = 1;
  for (let v = Math.ceil(ymin); v <= ymax; v += 1) { ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(W - pad.r, y(v)); ctx.stroke(); ctx.fillText(v, pad.l - 6, y(v) + 3); }
  ctx.textAlign = "left"; ctx.fillText(pts[0].day.slice(5), pad.l, H - 6); ctx.textAlign = "right"; ctx.fillText(todayStr().slice(5), W - pad.r, H - 6);
  ctx.fillStyle = col("--ink"); ctx.globalAlpha = 0.55; for (const p of pts) { ctx.beginPath(); ctx.arc(x(p.day), y(p.weight), 2.5, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1;
  ctx.strokeStyle = col("--accent"); ctx.lineWidth = 2.2; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(x(p.day), y(p.trend)) : ctx.moveTo(x(p.day), y(p.trend))); ctx.stroke();
  const last = pts.at(-1); ctx.fillStyle = col("--accent"); ctx.beginPath(); ctx.arc(x(last.day), y(last.trend), 4, 0, Math.PI * 2); ctx.fill();
}
function renderExpenditure() {
  const cur = state.trend.current, el = $("#expenditure");
  const pill = `<span class="pill ${cur.confidence}">${cur.confidence === "none" ? "provisional" : cur.confidence + " confidence"}</span>`;
  el.innerHTML = cur.source === "provisional"
    ? `<h2 class="eyebrow">Expenditure</h2><div class="exp"><div class="big">${fmt(cur.target)} <small>kcal/day target</small></div>${pill}<p>${esc(cur.note)}</p><p>Log complete days and weigh in each morning. After ~7 complete days this number comes from your own intake and weight trend, not a formula.</p></div>`
    : `<h2 class="eyebrow">Expenditure</h2><div class="exp"><div class="big">${fmt(cur.tdee)} <small>kcal/day measured · ${fmt(cur.tdee - cur.target)} deficit → target ${fmt(cur.target)}</small></div>${pill}<p>Band ${fmt(cur.lo)}–${fmt(cur.hi)} kcal. ${esc(cur.note)}</p><p>As of ${cur.as_of}. Recomputed on every load.</p></div>`;
}

// ------------------------------------------------------------ data actions
const dataMsg = (m) => { $("#data-msg").textContent = m; };
async function guarded(btn, fn) { btn.disabled = true; try { await fn(); } catch (e) { dataMsg(e.message); } finally { btn.disabled = false; } }
$("#btn-pull").onclick = (e) => guarded(e.target, async () => {
  dataMsg("Pulling weigh-ins from GitHub…");
  const r = await sync.pullBody();
  dataMsg(r.ok ? `${r.added} new of ${r.total}. Latest ${r.latest ? `${r.latest.weight_kg} kg on ${r.latest.day}` : "—"}.` : r.error);
  await loadDay(); await loadTrend();
});
$("#btn-seed").onclick = (e) => guarded(e.target, async () => {
  if ((await db.setting("seed_imported")) === "1" && !confirm("Chat log already imported. Import again (duplicates)?")) return;
  dataMsg("Importing chat log…");
  const r = await sync.importSeed({ force: true });
  dataMsg(r.ok ? `Imported ${r.meals} meals, ${r.workouts} workouts.` : r.error);
  await loadProducts(); await loadDay(); await loadTrend(); scheduleBackup();
});
$("#btn-backup").onclick = (e) => guarded(e.target, async () => { dataMsg("Backing up…"); const r = await sync.pushBackup(); dataMsg(`Backed up ${r.meals} meals, ${r.body} weigh-ins.`); await loadTrend(); });
$("#btn-restore").onclick = (e) => guarded(e.target, async () => {
  if (!confirm("Replace everything on this phone with the GitHub backup?")) return;
  const r = await sync.restoreBackup(); dataMsg(r.ok ? `Restored ${r.meals} meals from ${r.exported_at}.` : r.error);
  await loadProducts(); await loadDay(); await loadTrend();
});
$("#btn-export").onclick = async () => {
  const blob = new Blob([JSON.stringify(await db.dump())], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `recomp-${todayStr()}.json`; a.click();
};
$("#import-file").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const data = JSON.parse(await f.text());
  if (data.version && data.meals && data.settings && !Array.isArray(data.settings)) { const r = await sync.importSeedData(data); dataMsg(`Imported seed: ${r.meals} meals.`); }
  else { if (!confirm("Replace everything on this phone with this file?")) return; await db.restore(data); dataMsg("Restored from file."); }
  e.target.value = ""; await loadProducts(); await loadDay(); await loadTrend();
});
$("#btn-weight").onclick = async () => {
  const w = parseFloat(prompt("Weight this morning (kg)?")); if (!w) return;
  const bf = parseFloat(prompt("Body fat % (optional)") || "");
  const at = atFor();
  await db.add("body", { day: at.slice(0, 10), at, weight_kg: w, bodyfat_pct: isNaN(bf) ? null : bf, muscle_kg: null, water_pct: null, source: "manual", ext_id: `manual:${at}` });
  toast("Weight logged"); await loadDay(); await loadTrend(); scheduleBackup();
};

// ------------------------------------------------------------ settings
const SETTINGS = [
  ["gemini_key", "Gemini API key (free, aistudio.google.com)", "password"], ["ai_model", "Gemini model", "text"], ["ai_lookup", "Venue lookup: auto / on / off", "text"],
  ["gh_repo", "GitHub data repo (owner/name)", "text"], ["gh_token", "GitHub token (Contents read/write)", "password"], ["backup_auto", "Auto-backup after changes (1/0)", "text"],
  ["protein_floor_g", "Protein floor (g)", "text"], ["protein_ceiling_g", "Protein ceiling (g)", "text"],
  ["weight_lo_kg", "Weight low (kg)", "text"], ["weight_hi_kg", "Weight high (kg)", "text"],
  ["provisional_kcal", "Provisional kcal", "text"], ["recomp_deficit_kcal", "Recomp deficit (kcal)", "text"],
  ["creatine_start", "Creatine start (YYYY-MM-DD)", "text"], ["creatine_settle_days", "Creatine settle (days)", "text"],
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
    renderQuick(); await loadProducts(); await loadDay();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
    // once a day, quietly pick up new weigh-ins
    const s = state.settings, today = todayStr();
    if (s.gh_token && s.gh_repo && s.last_pull !== today) {
      sync.pullBody().then(async r => { if (r.ok) { await db.setSetting("last_pull", today); if (r.added) { toast(`${r.added} new weigh-in${r.added > 1 ? "s" : ""}`); await loadDay(); } } }).catch(() => {});
    }
  } catch (e) { toast("Startup failed: " + e.message, 6000); console.error(e); }
})();

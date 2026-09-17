/* GitHub as the durable store: a private repo holds body.json (written nightly by the
   Renpho workflow), seed.json (the chat import, once) and backup.json (written by this app).
   Fine-grained token, Contents permission on that one repo only. */

import * as db from "./db.js";

const API = "https://api.github.com";

const utf8ToB64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64ToUtf8 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), c => c.charCodeAt(0)));

async function creds() {
  const token = await db.setting("gh_token", ""), repo = await db.setting("gh_repo", "");
  if (!token || !repo || !repo.includes("/")) throw new Error("GitHub token and repo (owner/name) are not set in ⚙ Settings.");
  return { token, repo };
}

/** Any repo-scoped endpoint. `sub` is everything after /repos/{owner}/{repo}/ */
async function ghApi(sub, { method = "GET", body = null } = {}) {
  const { token, repo } = await creds();
  const r = await fetch(`${API}/repos/${repo}/${sub}`, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : null,
  });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const why = r.status === 403 ? "the token can't do this — add Actions: Read and write to it, or wait for the scheduled run"
      : r.status === 401 ? "token invalid or expired" : (j.message || r.statusText);
    const e = new Error(`GitHub ${r.status}: ${why}`); e.status = r.status; e.auth = r.status === 401; e.noActions = r.status === 403 || r.status === 404;
    throw e;
  }
  return j;
}

async function gh(path, { method = "GET", body = null } = {}) {
  const { token, repo } = await creds();
  const r = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : null,
  });
  if (r.status === 404 && method === "GET") return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const why = r.status === 401 ? "token invalid or expired"
      : r.status === 403 ? "token lacks Contents read/write on this repo (or rate-limited)"
      : r.status === 404 ? "repo not found — check owner/name and that the token can see it"
      : (j.message || r.statusText);
    const e = new Error(`GitHub ${r.status}: ${why}`); e.status = r.status; e.auth = r.status === 401 || r.status === 403 || r.status === 404;
    throw e;
  }
  return j;
}

/** Read a JSON file from the repo → { data, sha } or null. */
export async function readJson(path) {
  const j = await gh(path);
  if (!j) return null;
  return { data: JSON.parse(b64ToUtf8(j.content)), sha: j.sha };
}

export async function writeJson(path, data, message) {
  const existing = await gh(path);
  const body = { message, content: utf8ToB64(JSON.stringify(data)) };
  if (existing?.sha) body.sha = existing.sha;
  return gh(path, { method: "PUT", body });
}

/** How old the weigh-in file is, and what the newest reading in it is. */
export async function bodyFreshness() {
  const got = await readJson("body.json");
  if (!got) return null;
  const last = got.data.at(-1);
  return { last_at: last?.at || null, last_day: last?.day || null, count: got.data.length };
}

/** Ask the Actions workflow to run now, then wait for body.json to change.
    Needs Actions: Read and write on the token; without it this throws with noActions
    and the caller falls back to just reading whatever is already in the repo. */
export async function refreshFromRenpho({ timeoutMs = 90000, onStatus = () => {} } = {}) {
  const before = (await gh("body.json"))?.sha || null;
  onStatus("asking GitHub to run the Renpho job…");
  await ghApi("actions/workflows/renpho.yml/dispatches", { method: "POST", body: { ref: "main" } });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise(r => setTimeout(r, 6000));
    onStatus(`running… ${Math.round((Date.now() - started) / 1000)}s`);
    const now = (await gh("body.json"))?.sha || null;
    if (now && now !== before) return { ok: true, changed: true };
  }
  return { ok: true, changed: false };     // ran, but nothing new on the scale
}

/** Merge body.json (Renpho) into the local body store. Returns counts. */
export async function pullBody() {
  const got = await readJson("body.json");
  if (!got) return { ok: false, error: "body.json not in the repo yet — run the Renpho workflow once (Actions tab)." };
  const have = new Set((await db.all("body")).map(r => r.ext_id).filter(Boolean));
  let added = 0;
  for (const r of got.data) {
    if (!r.ext_id || have.has(r.ext_id)) continue;
    await db.add("body", { day: r.day, at: r.at, weight_kg: r.weight_kg, bodyfat_pct: r.bodyfat_pct ?? null,
      muscle_kg: r.muscle_kg ?? null, water_pct: r.water_pct ?? null, source: "renpho", ext_id: r.ext_id });
    added++;
  }
  const latest = got.data.at(-1);
  return { ok: true, total: got.data.length, added, latest };
}

/** One-time import of the chat log. Idempotent via a setting flag. */
export async function importSeed({ force = false } = {}) {
  if (!force && (await db.setting("seed_imported")) === "1") return { ok: true, skipped: true };
  const got = await readJson("seed.json");
  if (!got) return { ok: false, error: "seed.json not in the repo." };
  return importSeedData(got.data);
}
export async function importSeedData(seed) {
  const s = seed || {};
  let meals = 0, workouts = 0, body = 0;
  if (Array.isArray(s.meals)) { await db.bulkAdd("meals", s.meals.map(m => ({ ...m, needs_review: m.needs_review ? 1 : 0 }))); meals = s.meals.length; }
  if (Array.isArray(s.workouts)) { await db.bulkAdd("workouts", s.workouts); workouts = s.workouts.length; }
  if (Array.isArray(s.body) && s.body.length) { await db.bulkAdd("body", s.body); body = s.body.length; }
  if (Array.isArray(s.products) && !(await db.all("products")).length) await db.bulkAdd("products", s.products);
  // the seed carries the person's real targets; they beat the public placeholders
  for (const [k, v] of Object.entries(s.settings || {}))
    if (k in db.DEFAULT_SETTINGS && !db.CREDENTIAL_KEYS.includes(k)) await db.setSetting(k, v);
  await db.setSetting("seed_imported", "1");
  return { ok: true, meals, workouts, body };
}

/** Apply chat_fixes.json (values for chat rows the parser could not read; deletions of
    rows that were never meals). Keyed by day|original text, so ids don't matter. */
const rawOf = (m) => { let d = m.detail; if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = null; } } return d?.raw || m.label; };
export async function applyChatFixes({ force = false } = {}) {
  const got = await readJson("chat_fixes.json");
  if (!got) return { ok: false, error: "chat_fixes.json not in the repo yet." };
  const version = String(got.data.version || 1);
  if (!force && (await db.setting("chatfix_version")) === version) return { ok: true, skipped: true, version };
  const fixes = got.data.fixes || {};
  let valued = 0, deleted = 0, moved = 0;
  for (const m of await db.all("meals")) {
    if (!/^backfill/.test(m.source || "")) continue;
    // keys: day|HH:MM|raw (v3, unambiguous) first, then the older day|raw
    const raw = rawOf(m);
    const f = fixes[m.day + "|" + m.at.slice(11, 16) + "|" + raw] ?? fixes[m.day + "|" + raw];
    if (!f) continue;
    if (f === "delete") { await db.del("meals", m.id); deleted++; continue; }
    let d = m.detail; if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = { raw: m.label }; } }
    const row = { ...m, label: f.label, kcal: f.kcal, kcal_lo: f.kcal_lo, kcal_hi: f.kcal_hi, protein_g: f.protein_g,
      source: "backfill-est", needs_review: 0, detail: { ...(d || {}), raw, chatfix: version } };
    if (f.day && f.at) { row.day = f.day; row.at = f.at; moved++; }     // typed before "New day" -> previous evening
    await db.put("meals", row);
    valued++;
  }
  // workouts: rows that were questions, or done the evening before they were typed
  for (const w of got.data.workouts_fix || []) {
    const hit = (await db.all("workouts")).find(x => x.day === w.day && x.kind === w.kind && x.at.slice(11, 16) === w.at.slice(11, 16));
    if (!hit) continue;
    if (w.action === "delete") { await db.del("workouts", hit.id); deleted++; }
    else if (w.action === "move") { await db.put("workouts", { ...hit, day: w.to_day, at: w.to_at }); moved++; }
  }
  // additions: meals and workouts logged in the chat after the seed; idempotent on day + time + label / kind
  let added = 0;
  const have = new Set((await db.all("meals")).map(m => m.day + "|" + m.at.slice(11, 16) + "|" + m.label));
  for (const r of got.data.adds || []) {
    if (have.has(r.day + "|" + r.at.slice(11, 16) + "|" + r.label)) continue;
    await db.add("meals", { day: r.day, at: r.at, label: r.label, kcal: r.kcal, kcal_lo: r.kcal_lo, kcal_hi: r.kcal_hi, protein_g: r.protein_g,
      source: r.source || "backfill-est", share_frac: r.share_frac ?? 1, venue: r.venue ?? null, detail: r.detail || null, needs_review: 0 });
    added++;
  }
  const haveW = new Set((await db.all("workouts")).map(w => w.day + "|" + w.kind));
  for (const w of got.data.workouts_add || []) {
    if (haveW.has(w.day + "|" + w.kind)) continue;
    await db.add("workouts", { day: w.day, at: w.at, kind: w.kind, detail: w.detail ?? null, source: w.source || "backfill" });
    added++;
  }
  await db.setSetting("chatfix_version", version);
  return { ok: true, valued, deleted, added, moved, version };
}

/** Push a full snapshot. Debounced auto-backup lives in app.js. */
export async function pushBackup() {
  const snap = await db.dump();
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  await writeJson("backup.json", snap, `backup ${day}`);
  await db.setSetting("last_backup", new Date().toISOString());
  return { ok: true, meals: snap.meals.length, body: snap.body.length };
}

export async function restoreBackup() {
  const got = await readJson("backup.json");
  if (!got) return { ok: false, error: "No backup.json in the repo." };
  await db.restore(got.data, { replace: true });
  return { ok: true, exported_at: got.data.exported_at, meals: (got.data.meals || []).length };
}

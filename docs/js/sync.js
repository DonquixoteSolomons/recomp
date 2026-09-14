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

async function gh(path, { method = "GET", body = null } = {}) {
  const { token, repo } = await creds();
  const r = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : null,
  });
  if (r.status === 404 && method === "GET") return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${j.message || r.statusText}`);
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
  const have = await db.allSettings();
  for (const [k, v] of Object.entries(s.settings || {})) if (!(k in have) && k in db.DEFAULT_SETTINGS) await db.setSetting(k, v);
  await db.setSetting("seed_imported", "1");
  return { ok: true, meals, workouts, body };
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

/* IndexedDB, promise-wrapped. One database, one store per table, `day` indexed. */

const NAME = "recomp", VERSION = 1;
const STORES = {
  meals:     { key: "id", auto: true,  index: ["day", "at"] },
  workouts:  { key: "id", auto: true,  index: ["day", "at"] },
  body:      { key: "id", auto: true,  index: ["day", "at", "ext_id"] },
  estimates: { key: "id", auto: true,  index: ["day", "at"] },
  products:  { key: "id", auto: true,  index: ["kind"] },
  settings:  { key: "key", auto: false, index: [] },
};

let dbp = null;
export function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [name, s] of Object.entries(STORES)) {
        if (d.objectStoreNames.contains(name)) continue;
        const st = d.createObjectStore(name, { keyPath: s.key, autoIncrement: s.auto });
        for (const ix of s.index) st.createIndex(ix, ix, { unique: ix === "ext_id" });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbp;
}

const tx = async (store, mode, fn) => {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), st = t.objectStore(store);
    let out;
    try { out = fn(st); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out?.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const put    = (store, obj)  => tx(store, "readwrite", st => st.put(obj));
export const add    = (store, obj)  => tx(store, "readwrite", st => st.add(obj));
export const del    = (store, key)  => tx(store, "readwrite", st => st.delete(key));
export const get    = (store, key)  => tx(store, "readonly",  st => st.get(key));
export const all    = (store)       => tx(store, "readonly",  st => st.getAll());
export const clear  = (store)       => tx(store, "readwrite", st => st.clear());
export async function byIndex(store, index, value) {
  const d = await open();
  return req(d.transaction(store).objectStore(store).index(index).getAll(value));
}
export async function range(store, index, lo, hi) {
  const d = await open();
  return req(d.transaction(store).objectStore(store).index(index).getAll(IDBKeyRange.bound(lo, hi)));
}
export async function bulkAdd(store, rows) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, "readwrite"), st = t.objectStore(store);
    for (const r of rows) st.add(r);
    t.oncomplete = () => res(rows.length);
    t.onerror = () => rej(t.error);
  });
}

// settings: string values, like the SQLite version
export async function setting(key, fallback = null) {
  const r = await get("settings", key);
  return r ? r.value : fallback;
}
export const settingNum = async (key, fallback) => { const v = await setting(key); const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };
export const setSetting = (key, value) => put("settings", { key, value: String(value) });
export async function allSettings() {
  const rows = await all("settings"); const o = {};
  for (const r of rows) o[r.key] = r.value;
  return o;
}

// Neutral placeholders only — this file is public. Your own targets live in
// settings on the phone (and in seed.json / backup.json in the private repo).
export const DEFAULT_SETTINGS = {
  protein_floor_g: "120", protein_ceiling_g: "150",
  weight_lo_kg: "", weight_hi_kg: "",              // empty = no bounds
  provisional_kcal: "2000", recomp_deficit_kcal: "250",   // provisional = rest-day base; sessions add on top
  burn_revl_move: "450", burn_revl_sweat: "500", burn_revl_perform: "350",
  burn_run: "300", burn_swim: "250", burn_calves: "80", burn_lift: "250", burn_other: "200",
  creatine_start: "", creatine_settle_days: "28",  // empty = no creatine window
  ai_model: "gemini-3.6-flash",
  gh_repo: "", backup_auto: "1",
};
// Never written to backup.json — a backup must not carry the token that protects it.
export const CREDENTIAL_KEYS = ["gh_token", "gemini_key"];
export async function ensureDefaults() {
  const have = await allSettings();
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (!(k in have)) await setSetting(k, v);
}

// dump / restore — the backup format
export async function dump() {
  const out = { version: 1, exported_at: new Date().toISOString() };
  for (const s of Object.keys(STORES)) {
    out[s] = await all(s);
    if (s === "estimates") out[s] = out[s].map(({ thumb, images, ...rest }) => rest);   // thumbnails and parked photos stay on the phone
    if (s === "settings") out[s] = out[s].filter(r => !CREDENTIAL_KEYS.includes(r.key));
  }
  return out;
}
/** Replace every store from a backup. Credentials on this phone are kept. */
export async function restore(data, { replace = true } = {}) {
  const keep = [];
  for (const k of CREDENTIAL_KEYS) { const v = await setting(k); if (v) keep.push({ key: k, value: v }); }
  for (const s of Object.keys(STORES)) {
    if (!Array.isArray(data[s])) continue;
    if (replace) await clear(s);
    await bulkAdd(s, s === "settings" ? data[s].filter(r => !CREDENTIAL_KEYS.includes(r.key)) : data[s]);
  }
  for (const r of keep) await put("settings", r);
}

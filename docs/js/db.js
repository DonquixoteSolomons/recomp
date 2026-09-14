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

export const DEFAULT_SETTINGS = {
  protein_floor_g: "150", protein_ceiling_g: "160",
  weight_lo_kg: "70", weight_hi_kg: "75",
  provisional_kcal: "2350", recomp_deficit_kcal: "250",
  creatine_start: "2026-08-22", creatine_settle_days: "28",
  ai_model: "gemini-2.5-flash", ai_lookup: "auto",
  gh_repo: "", backup_auto: "1",
};
export async function ensureDefaults() {
  const have = await allSettings();
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (!(k in have)) await setSetting(k, v);
}

// dump / restore — the backup format
export async function dump() {
  const out = { version: 1, exported_at: new Date().toISOString() };
  for (const s of Object.keys(STORES)) {
    out[s] = await all(s);
    if (s === "estimates") out[s] = out[s].map(({ thumb, ...rest }) => rest);   // thumbnails stay on the phone
  }
  return out;
}
export async function restore(data, { replace = true } = {}) {
  for (const s of Object.keys(STORES)) {
    if (!Array.isArray(data[s])) continue;
    if (replace) await clear(s);
    await bulkAdd(s, data[s]);
  }
}

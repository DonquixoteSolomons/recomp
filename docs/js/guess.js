/* A rough number for a meal the AI can't value right now, so the log never says "?" when something
   sensible can be said. Your own past meals first — what you actually eat when you say "mala" —
   then the reference table. Always shown as rough; the AI replaces it when it answers again. */
import { REFERENCE } from "./foods.js";

const STOP = new Set(("a an and the of with from at in on for my i had ate eat eaten have has some all half one two three four five " +
  "bit little no not but it its this that was were is to also plus then just got only about around ate today tonight lunch dinner " +
  "breakfast supper meal new day extra plate plates bowl bowls large small big normal portion serving").split(" "));
/** Content words, lower-case, crude singular. The same function reads the query and the history. */
export const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9À-ɏ ]+/g, " ").split(/\s+/)
  .filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).map(w => w.length > 4 ? w.replace(/s$/, "") : w);

/** The dish itself: the first clause, without the venue ("from Dragonfly at Bangkit") or what came with it.
    "Had mala from dragonfly at bangkit. Ate all the luncheon meat." → ["mala"]; "chicken rice, extra meat" → ["chicken", "rice"]. */
export function dishWords(text) {
  const first = String(text || "").split(/[.!?\n]/).find(x => words(x).length) || "";
  for (const seg of first.split(/[,;+]|\b(?:with|and|plus)\b/i)) {
    const w = words(seg.replace(/\b(?:from|at)\b.*$|@.*$/i, ""));
    if (w.length) return w;
  }
  return [];
}
const rawOf = (m) => { let d = m.detail; if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = null; } } return d?.raw || ""; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

/** { kcal, kcal_lo, kcal_hi, protein_g, basis: "history" | "reference", from: [labels] } or null. */
export function roughGuess(text, meals = [], share = 1) {
  const q = [...new Set(words(text))]; if (!q.length) return null;

  // 1. your past meals of the same dish (every dish word present; two of three for longer names),
  //    ranked by the rest of the words, weighted by how rare they are in your own log
  const dish = dishWords(text), need = dish.length >= 3 ? Math.ceil(dish.length * 2 / 3) : dish.length;
  const docs = meals.filter(m => m.kcal > 0 && m.source !== "pending" && m.source !== "shake")
    .map(m => ({ m, w: new Set([...words(m.label), ...words(rawOf(m))]) }))
    .filter(d => need && dish.filter(w => d.w.has(w)).length >= need);
  const df = new Map(); for (const d of docs) for (const w of d.w) df.set(w, (df.get(w) || 0) + 1);
  const idf = (w) => Math.log(1 + docs.length / df.get(w));
  const known = q.filter(w => df.has(w));
  if (known.length) {
    const total = known.reduce((a, w) => a + idf(w), 0);
    const scored = docs.map(d => ({ m: d.m, s: known.filter(w => d.w.has(w)).reduce((a, w) => a + idf(w), 0) / total }))
      .filter(x => x.s > 0).sort((a, b) => b.s - a.s || String(b.m.at).localeCompare(String(a.m.at)));
    const best = scored[0]?.s || 0;
    if (best > 0) {
      const top = scored.filter(x => x.s >= best * 0.8).slice(0, 5).map(x => x.m);
      // rows from the chat already hold your portion in their numbers; app rows are rescaled to today's share
      const scale = (m) => /^backfill/.test(m.source || "") ? 1 : share / (m.share_frac || 1);
      const kc = median(top.map(m => m.kcal * scale(m))), pr = median(top.map(m => (m.protein_g || 0) * scale(m)));
      const lo = Math.min(kc * 0.8, ...top.map(m => (m.kcal_lo || m.kcal * 0.8) * scale(m)));
      const hi = Math.max(kc * 1.2, ...top.map(m => (m.kcal_hi || m.kcal * 1.2) * scale(m)));
      return { kcal: Math.round(kc), kcal_lo: Math.round(lo), kcal_hi: Math.round(hi), protein_g: Math.round(pr * 10) / 10, basis: "history", from: top.map(m => m.label) };
    }
  }

  // 2. the reference table: cover the words greedily, one portion per component, at most three
  //    after the first (the dish), a component is added only when a leftover word names it — "luncheon" names
  //    luncheon meat; "meat" alone names nothing, so "chicken rice, extra meat" stays chicken rice
  const refs = REFERENCE.map(r => ({ r, w: new Set(words(r.name + " " + r.id.replace(/_/g, " "))), head: words(r.name)[0] }));
  const left = new Set(q), picked = [];
  while (picked.length < 3) {
    let pick = null, most = 0;
    for (const x of refs) {
      if (picked.includes(x.r) || (picked.length && !left.has(x.head))) continue;
      const n = [...left].filter(w => x.w.has(w)).length;
      if (n > most) { most = n; pick = x; }
    }
    if (!pick) break;
    picked.push(pick.r); for (const w of pick.w) left.delete(w);
  }
  if (!picked.length) return null;
  const sum = (f) => picked.reduce((a, r) => a + r[f], 0);
  return { kcal: Math.round(sum("kcal") * share), kcal_lo: Math.round(sum("lo") * share), kcal_hi: Math.round(sum("hi") * share),
    protein_g: Math.round(sum("protein") * share * 10) / 10, basis: "reference", from: picked.map(r => r.name) };
}

/* Photo / text -> identification via Gemini (free tier), numbers via the reference table.

   One structured call: JSON schema, no tools. Google Search grounding is "not available" on
   the free tier for the 3.x Flash models (ai.google.dev/gemini-api/docs/pricing), so venue
   figures come from what the model already knows about published chain nutrition, flagged.
   The model never does arithmetic that matters: it maps components to reference ids and
   quantities; foods.computeFromIdentification does the sums.

   Free-tier quotas are per model per day (reset midnight Pacific) and per minute. callModel()
   waits out a per-minute limit once, and moves to the next model when a day is used up or the
   model is overloaded (503, seen for days at a time on older Flash models). Errors carry
   .transient (worth retrying later — the app parks the meal and retries on its own) or
   .config (key missing or rejected — only the person can fix that). */

import { REFERENCE, computeFromIdentification } from "./foods.js";

const API = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_MODEL = "gemini-3.6-flash";
// models Google has closed to new keys; a stored setting naming one is migrated to DEFAULT_MODEL
export const RETIRED_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
// each model has its own free-tier quota; tried in order when the chosen model's day is used up
export const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
export const timers = { sleep: (ms) => new Promise(r => setTimeout(r, ms)) };   // stubbed by the tests
const MAX_EDGE = 1280, THUMB_EDGE = 320;

const REF_LINES = REFERENCE.map(r => `${r.id} | ${r.name} | ${r.portion}`).join("\n");

const SYSTEM = `You identify what one person in Singapore ate, for a nutrition log. You do NOT compute totals; the app does that from a reference table.

Method:
1. Name the dish. List every component the person actually ate: the carbohydrate base, each protein, sauces/gravy/oil that matter, vegetables, drinks. Singapore hawker food hides calories in oil, gravy, coconut milk and sugar — include them as components.
2. For each component, map it to the closest id in the reference table below and give "quantity" = how many of that reference portion the person ate. Standard hawker plates are ~25 cm and bowls 15-17 cm; a heaped or large plate is 1.3-1.5, a small one 0.7. Apply statements like "left half the rice" or "only ate 2 of the 5 wings" to the quantity.
3. If nothing in the table fits, set ref to null and give your own kcal, kcal_lo, kcal_hi and protein_g for the portion eaten, and mark confidence low.
4. Weights the person states (e.g. "239 g rice") override what you see: rice 100 g ≈ 130 kcal, 2.7 g protein; cooked lean meat 100 g ≈ 165-230 kcal, 25-31 g protein.
5. If the person says they shared with others, do NOT reduce for that — the app applies their share separately. Only apply explicit "I ate X of it" statements about components.
6. Chains and packaged products publish nutrition figures (McDonald's, KFC, Subway, Guzman y Gomez, Luckin, Yakult, Meiji, supermarket brands). When the venue or product is one you know published figures for, use those via ref: null, say so in "grounding", and mark confidence medium unless the item is unambiguous.

Reference table (id | name | one portion):
${REF_LINES}

Be specific in "assumptions" (what you inferred) and "tighten" (the single detail that would narrow the estimate most). Never invent precision.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    dish: { type: "STRING", description: "Short name for what was eaten" },
    components: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          ref: { type: "STRING", nullable: true, description: "reference table id, or null" },
          quantity: { type: "NUMBER", description: "multiples of the reference portion eaten" },
          portion: { type: "STRING", description: "what was eaten, e.g. '1 plate, large', '3 wings'" },
          kcal: { type: "NUMBER", nullable: true }, kcal_lo: { type: "NUMBER", nullable: true },
          kcal_hi: { type: "NUMBER", nullable: true }, protein_g: { type: "NUMBER", nullable: true },
          confidence: { type: "STRING", enum: ["low", "medium", "high"] },
        },
        required: ["name", "ref", "quantity", "portion", "confidence"],
      },
    },
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
    assumptions: { type: "ARRAY", items: { type: "STRING" } },
    grounding: { type: "ARRAY", items: { type: "STRING" }, description: "what the identification is based on" },
    tighten: { type: "STRING" },
  },
  required: ["dish", "components", "confidence", "assumptions", "grounding", "tighten"],
};

// ------------------------------------------------------------ images
async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    return img;
  } finally { URL.revokeObjectURL(url); }
}
function drawScaled(img, maxEdge, quality) {
  const s = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality).split(",")[1];   // base64 without the prefix
}
/** Returns { data (base64 jpeg for the model), thumb (small base64 jpeg for the log) }. */
export async function prepareImage(blob) {
  const img = await loadImage(blob);   // browsers apply EXIF orientation on decode
  return { data: drawScaled(img, MAX_EDGE, 0.85), thumb: drawScaled(img, THUMB_EDGE, 0.7) };
}

// ------------------------------------------------------------ calls
const CALL_TIMEOUT_MS = 60_000;
const configError = (msg) => { const e = new Error(msg); e.config = true; return e; };

async function generate(apiKey, model, body) {
  let r;
  try {
    r = await fetch(`${API}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(CALL_TIMEOUT_MS) : undefined,
    });
  } catch (err) {                                                  // no answer at all: offline, DNS, timeout
    const e = new Error(`${model}: ${err.name === "TimeoutError" ? "no answer in 60 s" : "no connection"}`);
    e.transient = true; e.status = 0; throw e;
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || r.statusText, details = j?.error?.details || [];
    let e;
    if (r.status >= 500) {                                         // "high demand", internal error, bad gateway
      e = new Error(`${model}: overloaded (${r.status})`); e.transient = true;
    } else if (r.status === 429) {
      // google.rpc.QuotaFailure names the bucket (…PerDay… / …PerMinute…); RetryInfo says how long to wait
      const q = details.find(d => /QuotaFailure/.test(d["@type"] || ""))?.violations?.[0] || {};
      const daily = /PerDay/i.test(q.quotaId || "");
      e = new Error(daily ? `${model}: free-tier day used up${q.quotaValue ? ` (${q.quotaValue} requests)` : ""}` : `${model}: free-tier busy`);
      e.rateLimited = true; e.transient = true; e.daily = daily;
      e.retryAfter = parseFloat(details.find(d => /RetryInfo/.test(d["@type"] || ""))?.retryDelay) || 0;
    } else if ((r.status === 400 || r.status === 403) && /API key|permission/i.test(msg)) {
      e = configError("Gemini rejected the API key. Check it in ⚙ Settings.");
    } else {
      e = new Error(`Gemini ${r.status}: ${msg}`);
      // "This model ... is no longer available ... use models/gemini-X" — carry the hint so the caller can switch
      const hint = r.status === 404 && msg.match(/use models\/([\w.-]+)/i);
      if (hint) e.suggestedModel = hint[1];
    }
    e.status = r.status; throw e;
  }
  const cand = j.candidates?.[0];
  if (!cand) throw new Error("Gemini returned no candidates" + (j.promptFeedback?.blockReason ? ` (blocked: ${j.promptFeedback.blockReason})` : ""));
  if (cand.finishReason && cand.finishReason !== "STOP" && cand.finishReason !== "MAX_TOKENS") {
    throw new Error(`Gemini stopped: ${cand.finishReason}`);
  }
  const text = (cand.content?.parts || []).filter(p => p.text).map(p => p.text).join("");
  return { text, usage: j.usageMetadata || {}, grounding: cand.groundingMetadata || null };
}

/** generate() with the free tier's failure modes handled: a per-minute 429 waits and retries once;
 *  a per-day 429, a 5xx or a second per-minute 429 moves on to the next model, which has its own
 *  quota and capacity. onStatus(text) tells the UI what is happening. Returns the model that answered. */
async function callModel(apiKey, model, body, onStatus = () => {}) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) { const e = new Error("You're offline"); e.transient = true; throw e; }
  const chain = [model, ...FALLBACK_MODELS.filter(m => m !== model)];
  let daily = false, overloaded = false;
  for (const m of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return { ...(await generate(apiKey, m, body)), model: m }; }
      catch (e) {
        if (e.status === 404 && m !== model) break;                       // a fallback Google no longer serves
        if (!e.transient) throw e;
        daily ||= !!e.daily; overloaded ||= !e.rateLimited;
        if (!e.rateLimited || e.daily || attempt) { onStatus(`${e.message} — trying the next model`); break; }
        const s = Math.min(60, Math.max(5, Math.ceil(e.retryAfter || 20)));
        onStatus(`${m} is busy — retrying in ${s} s`); await timers.sleep(s * 1000);
      }
    }
  }
  const e = new Error(overloaded && !daily
    ? "Every Gemini model is overloaded or unreachable right now."
    : daily ? "Gemini's free tier is used up for today on every model it tries — it resets at midnight Pacific (3–4 pm Singapore)."
    : "Gemini's free tier is busy on every model it tries.");
  e.transient = true; e.rateLimited = !overloaded || daily; throw e;
}

/**
 * Run one estimate.
 * @param {object} o  { apiKey, model, images: Blob[], text, share, prior, priorImages, onStatus }
 *   prior: an earlier estimate result to refine (its raw identification + the correction in `text`)
 * @returns {object} { result (computed), ident (raw), thumbs[], images[], usage, model (the one that answered) }
 */
export async function estimate({ apiKey, model = DEFAULT_MODEL, images = [], text = "", share = 1, prior = null, priorImages = [], known = [], onStatus }) {
  if (!apiKey) throw configError("No Gemini API key. Add your free key in ⚙ Settings (aistudio.google.com → Get API key).");
  const prepared = [];
  for (const b of images) prepared.push(await prepareImage(b));
  const imageParts = prepared.map(p => ({ inline_data: { mime_type: "image/jpeg", data: p.data } }));
  for (const d of priorImages) imageParts.push({ inline_data: { mime_type: "image/jpeg", data: d } });

  const prompt = [];
  if (prior) {
    prompt.push("Earlier identification of this same meal:\n" + JSON.stringify(prior.ident));
    prompt.push("Correction from the person: " + (text || "(none)"));
    prompt.push("Re-identify, taking the correction into account.");
  } else {
    prompt.push("What I ate: " + (text.trim() || "(see photo)"));
  }
  if (known.length) prompt.push("Packaged items already counted separately from their labels — do NOT include these or anything that is clearly them: " + known.join("; ") + ". Identify only what else was eaten. If nothing else was eaten, return an empty components list.");
  prompt.push(`Local time: ${new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", weekday: "short", hour: "2-digit", minute: "2-digit" })}.`);

  const body = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [...imageParts, { text: prompt.join("\n\n") }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2, maxOutputTokens: 2000 },
  };

  let ident, usage, raw, used;
  for (let attempt = 0; attempt < 2; attempt++) {
    ({ text: raw, usage, model: used } = await callModel(apiKey, model, body, onStatus));
    try { ident = JSON.parse(raw); break; }
    catch { if (attempt) { const err = new Error("Gemini returned malformed JSON twice: " + raw.slice(0, 200)); err.transient = true; throw err; } }
  }
  const result = computeFromIdentification(ident, share);
  return { result, ident, thumbs: prepared.map(p => p.thumb), images: prepared.map(p => p.data), usage, model: used };
}


// ------------------------------------------------------------ other readers
async function extract(apiKey, model, blob, instruction, schema, onStatus) {
  if (!apiKey) throw configError("No Gemini API key. Add your free key in ⚙ Settings.");
  const img = await prepareImage(blob);
  const { text, model: used } = await callModel(apiKey, model, {
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: img.data } }, { text: instruction }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.1, maxOutputTokens: 800 },
  }, onStatus);
  return { data: JSON.parse(text), thumb: img.thumb, model: used };
}

const LABEL_SCHEMA = { type: "OBJECT", properties: {
  product: { type: "STRING", description: "brand and product name as printed" },
  kind: { type: "STRING", enum: ["milk", "whey", "food", "drink"] },
  basis: { type: "STRING", enum: ["100ml", "100g", "serving"], description: "what the kcal/protein numbers below are per" },
  serving_size: { type: "STRING", description: "the printed serving in English, ALWAYS with its weight or volume when the panel prints one, e.g. '1 slice (21 g)', '32 g (1 scoop)', '350 ml'. Translate units: กรัม/克/グラム = g, มล./毫升 = ml" },
  serving_g_or_ml: { type: "NUMBER", nullable: true },
  kcal: { type: "NUMBER" }, protein_g: { type: "NUMBER" },
  servings_per_pack: { type: "NUMBER", nullable: true },
  confidence: { type: "STRING", enum: ["low", "medium", "high"] },
}, required: ["product", "kind", "basis", "serving_size", "serving_g_or_ml", "kcal", "protein_g", "servings_per_pack", "confidence"] };

/** Read a nutrition label. Returns per-100ml/100g values when printed, else per serving. */
export async function readLabel({ apiKey, model = DEFAULT_MODEL, image, onStatus }) {
  return extract(apiKey, model, image,
    "This is a food or drink package. Read the nutrition information panel exactly as printed, in any language or script (Thai, Chinese, Malay, Japanese...). Prefer the per-100 ml or per-100 g column when it exists; otherwise give per-serving values and the serving size. The serving weight in g or ml is important: put it in serving_g_or_ml and in serving_size whenever the panel prints it, e.g. 'หนึ่งหน่วยบริโภค: 1 แผ่น (21 กรัม)' → serving_size '1 slice (21 g)', serving_g_or_ml 21. Energy in kcal (convert from kJ if only kJ is printed: kJ / 4.184). If it is a milk, kind=milk; a protein powder, kind=whey; otherwise food or drink.",
    LABEL_SCHEMA, onStatus);
}

const WORKOUT_SCHEMA = { type: "OBJECT", properties: {
  app: { type: "STRING", description: "which app the screenshot is from, e.g. Strava, Garmin, REVL, Apple Fitness, unknown" },
  sport: { type: "STRING", description: "run, swim, ride, walk, HIIT, strength, class, other" },
  title: { type: "STRING", nullable: true },
  date: { type: "STRING", nullable: true, description: "YYYY-MM-DD if shown" },
  duration_min: { type: "NUMBER", nullable: true }, distance_km: { type: "NUMBER", nullable: true },
  calories: { type: "NUMBER", nullable: true }, avg_hr: { type: "NUMBER", nullable: true },
  pace_or_speed: { type: "STRING", nullable: true },
  confidence: { type: "STRING", enum: ["low", "medium", "high"] },
}, required: ["app", "sport", "title", "date", "duration_min", "distance_km", "calories", "avg_hr", "pace_or_speed", "confidence"] };

/** Read a workout summary screenshot (Strava, Garmin, REVL, ...). */
export async function readWorkout({ apiKey, model = DEFAULT_MODEL, image, onStatus }) {
  return extract(apiKey, model, image,
    "This is a screenshot of a workout summary from a fitness app. Extract exactly what is shown: duration in minutes, distance in km, calories (kcal), average heart rate, the date if visible, and which app it is. Do not estimate values that are not shown; leave them null.",
    WORKOUT_SCHEMA, onStatus);
}

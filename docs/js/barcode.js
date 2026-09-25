/* Barcodes, free and offline-first: the phone's own BarcodeDetector reads the code from a photo,
   Open Food Facts (open data, no key, no account) supplies the label. Nothing is paywalled and
   no request leaves the phone until a code has actually been found. Falls back to the model
   reading the printed panel when the browser has no detector or the product is not in the base. */

const OFF = "https://world.openfoodfacts.org/api/v2/product/";
const FIELDS = "product_name,product_name_en,brands,quantity,serving_size,serving_quantity,nutriments";

/** The barcode in a still photo, or null. Chrome on Android has BarcodeDetector; others return null fast. */
export async function detectBarcode(blob) {
  if (typeof BarcodeDetector === "undefined") return null;
  try {
    const want = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
    const have = typeof BarcodeDetector.getSupportedFormats === "function" ? await BarcodeDetector.getSupportedFormats() : want;
    const formats = want.filter(f => have.includes(f));
    if (!formats.length) return null;
    const det = new BarcodeDetector({ formats });
    const bmp = await createImageBitmap(blob);
    try { const found = await det.detect(bmp); return found.find(b => b.rawValue)?.rawValue || null; }
    finally { bmp.close?.(); }
  } catch { return null; }
}

/** Open Food Facts product → the same shape the label reader returns, or null when not found / no energy. */
export function parseOff(json) {
  const p = json?.product; if (!json || json.status === 0 || !p) return null;
  const n = p.nutriments || {};
  const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
  const kcal100 = num(n["energy-kcal_100g"]) ?? (num(n["energy_100g"]) != null && /kj/i.test(n["energy_unit"] || "kJ") ? num(n["energy_100g"]) / 4.184 : num(n["energy_100g"]));
  const prot100 = num(n["proteins_100g"]);
  const kcalServ = num(n["energy-kcal_serving"]), protServ = num(n["proteins_serving"]);
  const liquid = /\b(ml|cl|l)\b/i.test(`${p.quantity || ""} ${p.serving_size || ""}`);
  const name = [p.brands?.split(",")[0]?.trim(), p.product_name_en || p.product_name].filter(Boolean).join(" ").trim();
  const servingQty = num(p.serving_quantity);
  const packQty = num(String(p.quantity || "").match(/[\d.]+/)?.[0]);
  const perPack = servingQty && packQty && servingQty > 0 ? Math.round(packQty / servingQty * 10) / 10 : null;
  if (kcal100 != null) {
    return { product: name || `Barcode ${json.code || ""}`.trim(), kind: liquid ? "drink" : "food", basis: liquid ? "100ml" : "100g",
      serving_size: p.serving_size || null, serving_g_or_ml: servingQty, quantity: p.quantity || null, kcal: kcal100 < 10 ? Math.round(kcal100 * 10) / 10 : Math.round(kcal100), protein_g: Math.round((prot100 ?? 0) * 10) / 10,
      servings_per_pack: perPack, confidence: "high", via: "barcode", code: json.code || null };
  }
  if (kcalServ != null) {
    return { product: name || `Barcode ${json.code || ""}`.trim(), kind: liquid ? "drink" : "food", basis: "serving",
      serving_size: p.serving_size || "1 serving", serving_g_or_ml: servingQty, quantity: p.quantity || null, kcal: Math.round(kcalServ), protein_g: Math.round((protServ ?? 0) * 10) / 10,
      servings_per_pack: perPack, confidence: "medium", via: "barcode", code: json.code || null };
  }
  return null;
}

/* The unit a person counts in. "Servings" is what labels say; nobody eats 1.5 servings of bread,
   they eat three slices. The pack's own serving text is best ("2 slices (57 g)" → a slice is
   28.5 g); a fraction of a pack ("40 g (1/4 can)") makes the pack the unit; otherwise a typical
   weight for the kind of food, flagged as typical; otherwise grams only. */
const TYPICAL = [
  [/cheese|fromage|queso|cheddar|mozzarella/i, "slice", 20],
  [/bread|loaf|toast|\bbuns?\b/i, "slice", 30],
  [/\beggs?\b/i, "egg", 50],
  [/cracker/i, "cracker", 8],
  [/biscuit|cookie|digestive/i, "piece", 12],
  [/tortilla|wrap|chapati|roti|prata|naan|pita/i, "piece", 50],
  [/sausage|hot ?dog|frankfurter/i, "piece", 45],
  [/nugget|meatball|dumpling|siu ?mai|wonton/i, "piece", 20],
  [/tuna|sardine|mackerel|\bcanned\b|\btinned\b|\bcan\b|\btin\b|soup|baked beans/i, "can", null],
  [/noodle|ramen|instant/i, "pack", null],
  [/milk|juice|soda|cola|coke|pepsi|sprite|fanta|100 ?plus|red ?bull|monster|drink|\btea\b|coffee|water|yakult|beer|kombucha|isotonic/i, "bottle", null],
  [/yog(h)?urt|pudding|dessert/i, "cup", null],
  [/\bbar\b/i, "bar", null],
];
const NOUNS = /(\d+(?:[.,]\d+)?)\s*(slices?|pieces?|cans?|bars?|cups?|eggs?|biscuits?|cookies?|crackers?|packs?|packets?|bottles?|sachets?|scoops?|tablets?|squares?|sticks?|wraps?|patties|patty|nuggets?|servings?)\b/i;
/* Serving text as printed on packs sold here comes in Thai, Chinese, Malay, Japanese as often as
   English, and the model does not always translate it. Units and unit nouns are mapped to English
   before parsing, so "1 แผ่น (21 กรัม)" reads as "1 slice (21 g)". */
const WORDS = [
  [/กรัม|กรัม\.|กก\.?|克|公克|グラム|\bgrams?\b|\bgramm?\b|\bgramos\b|\bgm\b|\bgr\b/gi, "g"],
  [/มล\.?|มิลลิลิตร|毫升|ミリリットル|\bmillilit(?:re|er)s?\b|\bcc\b/gi, "ml"],
  [/แผ่น|片|枚|\bkeping\b|\bhirisan\b|\btranche\b|\brebanada\b/gi, "slice"],
  [/ชิ้น|块|塊|个|個|\bbiji\b|\bketul\b|\bpcs?\b|\bpièce\b|\bstück\b/gi, "piece"],
  [/กระป๋อง|罐|缶|\btin\b|\blata\b|\bdose\b/gi, "can"],
  [/ขวด|瓶|本|\bbotol\b|\bbotella\b|\bflasche\b/gi, "bottle"],
  [/ถ้วย|杯|カップ|\bcawan\b|\btaza\b|\bbecher\b/gi, "cup"],
  [/ซอง|包|袋|\bpaket\b|\bbungkus\b|\bsachet\b|\bpeket\b/gi, "pack"],
  [/ฟอง|\bbiji telur\b|\bhuevos?\b|\beier\b|\bei\b/gi, "egg"],
  [/แท่ง|条|條|\bbatang\b|\bbarra\b|\briegel\b/gi, "bar"],
  [/ช้อน(?:โต๊ะ)?|勺|\bsudu\b|\bscoops?\b/gi, "scoop"],
  [/หน่วยบริโภค|份|人份|\bhidangan\b|\bsajian\b|\bporción\b|\bportion\b/gi, "serving"],
];
export const normalizeServing = (s) => WORDS.reduce((t, [re, w]) => t.replace(re, w), String(s || "")).replace(/\s+/g, " ").trim();

export function unitFor(L) {
  const num = (v) => parseFloat(String(v).replace(",", "."));
  const ss = normalizeServing(L?.serving_size), name = String(L?.product || "");
  const grams = ss.match(/(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i), noun = ss.match(NOUNS);
  const frac = ss.match(/(\d+)\s*\/\s*(\d+)\s*(can|pack|packet|bottle|bar|cup|loaf|tub|jar|box|tin)\b/i);
  const qty = String(L?.quantity || "").match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
  const packG = qty ? num(qty[1]) * (/^(kg|l)$/i.test(qty[2]) ? 1000 : 1) : null;
  const servG = grams ? num(grams[1]) : (Number(L?.serving_g_or_ml) > 0 ? Number(L.serving_g_or_ml) : null);
  const one = (w) => w.toLowerCase().replace(/ies$/, "y").replace(/s$/, "");
  // perServing: how many of the unit make one printed serving ("2 slices (57 g)" → 2), so per-serving numbers scale by count / perServing
  if (frac && servG) return { name: frac[3].toLowerCase(), grams: Math.round(servG * num(frac[2]) / num(frac[1])), perServing: num(frac[1]) / num(frac[2]), source: "pack", step: 0.25, printed: ss };
  if (noun && servG && num(noun[1]) > 0) return { name: one(noun[2]), grams: Math.round(servG / num(noun[1]) * 10) / 10, perServing: num(noun[1]), source: "pack", step: 1, printed: ss };
  // "1 slice" with no weight printed is still a unit when the numbers are per serving: a slice is a serving
  if (noun && !servG && num(noun[1]) > 0 && L?.basis === "serving") return { name: one(noun[2]), grams: null, perServing: num(noun[1]), source: "pack", step: 1, printed: ss };
  for (const [re, unit, typical] of TYPICAL) {
    if (!re.test(name)) continue;
    if (typical == null) { if (packG && packG <= 600) return { name: unit === "bottle" && packG <= 355 && !/yakult|milk/i.test(name) ? "can" : unit, grams: packG, source: "pack", step: 0.25, printed: ss }; continue; }
    return { name: unit, grams: typical, perServing: null, source: "typical", step: 1, printed: ss };
  }
  if (servG) return { name: "serving", grams: servG, perServing: 1, source: "pack", step: 0.5, printed: ss };
  if (L?.basis === "serving") return { name: "serving", grams: null, perServing: 1, source: "pack", step: 0.5, printed: ss };
  if (packG && packG <= 300) return { name: "pack", grams: packG, perServing: null, source: "pack", step: 0.25, printed: ss };
  return null;   // grams only
}

/** Look a code up. Returns the parsed product or null (not in the base); throws only on network trouble. */
export async function lookupBarcode(code, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${OFF}${encodeURIComponent(code)}?fields=${FIELDS}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Open Food Facts ${r.status}`);
  return parseOff(await r.json());
}

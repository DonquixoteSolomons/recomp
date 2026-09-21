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
      serving_size: p.serving_size || null, serving_g_or_ml: servingQty, kcal: Math.round(kcal100), protein_g: Math.round((prot100 ?? 0) * 10) / 10,
      servings_per_pack: perPack, confidence: "high", via: "barcode", code: json.code || null };
  }
  if (kcalServ != null) {
    return { product: name || `Barcode ${json.code || ""}`.trim(), kind: liquid ? "drink" : "food", basis: "serving",
      serving_size: p.serving_size || "1 serving", serving_g_or_ml: servingQty, kcal: Math.round(kcalServ), protein_g: Math.round((protServ ?? 0) * 10) / 10,
      servings_per_pack: perPack, confidence: "medium", via: "barcode", code: json.code || null };
  }
  return null;
}

/** Look a code up. Returns the parsed product or null (not in the base); throws only on network trouble. */
export async function lookupBarcode(code, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${OFF}${encodeURIComponent(code)}?fields=${FIELDS}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Open Food Facts ${r.status}`);
  return parseOff(await r.json());
}

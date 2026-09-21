// Open Food Facts parsing and lookup. fetch is mocked; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOff, lookupBarcode, detectBarcode, unitFor } from "../js/barcode.js";

const nutella = { code: "3017624010701", status: 1, product: { product_name: "Nutella", brands: "Ferrero", quantity: "400 g", serving_size: "15 g", serving_quantity: 15,
  nutriments: { "energy-kcal_100g": 539, "proteins_100g": 6.3, "energy-kcal_serving": 80.9, "proteins_serving": 0.9 } } };

test("a packaged food comes back per 100 g with the pack's serving count", () => {
  const p = parseOff(nutella);
  assert.equal(p.product, "Ferrero Nutella"); assert.equal(p.basis, "100g"); assert.equal(p.kcal, 539); assert.equal(p.protein_g, 6.3);
  assert.equal(p.serving_g_or_ml, 15); assert.equal(p.servings_per_pack, 26.7); assert.equal(p.confidence, "high"); assert.equal(p.via, "barcode");
});

test("a drink is per 100 ml; kJ-only energy is converted", () => {
  const p = parseOff({ code: "1", status: 1, product: { product_name: "Meiji Fresh Milk", quantity: "950 ml", nutriments: { energy_100g: 268, energy_unit: "kJ", proteins_100g: 3.2 } } });
  assert.equal(p.basis, "100ml"); assert.equal(p.kind, "drink"); assert.equal(p.kcal, 64); assert.equal(p.protein_g, 3.2);
});

test("serving-only data falls back to per serving at medium confidence", () => {
  const p = parseOff({ code: "2", status: 1, product: { product_name: "Bar", serving_size: "1 bar (45 g)", serving_quantity: 45, nutriments: { "energy-kcal_serving": 210, proteins_serving: 20 } } });
  assert.equal(p.basis, "serving"); assert.equal(p.kcal, 210); assert.equal(p.protein_g, 20); assert.equal(p.confidence, "medium");
});

test("not found and no-energy products are null, not garbage", () => {
  assert.equal(parseOff({ status: 0, status_verbose: "product not found" }), null);
  assert.equal(parseOff({ status: 1, product: { product_name: "Mystery", nutriments: {} } }), null);
  assert.equal(parseOff(null), null);
});

test("lookup: 404 is null, other failures throw, success parses", async () => {
  assert.equal(await lookupBarcode("000", { fetchImpl: async () => ({ status: 404, ok: false }) }), null);
  await assert.rejects(() => lookupBarcode("000", { fetchImpl: async () => ({ status: 503, ok: false }) }), /Open Food Facts 503/);
  const p = await lookupBarcode("3017624010701", { fetchImpl: async (url) => { assert.match(url, /product\/3017624010701\?fields=/); return { status: 200, ok: true, json: async () => nutella }; } });
  assert.equal(p.kcal, 539);
});

test("no BarcodeDetector (this runtime) → null, quickly, without throwing", async () => {
  assert.equal(await detectBarcode(new Blob(["x"])), null);
});

test("the unit people count in: from the pack's serving text, a fraction of the pack, or a typical weight", () => {
  assert.deepEqual(unitFor({ product: "Gardenia Enriched White Bread", serving_size: "2 slices (57 g)", serving_g_or_ml: 57 }), { name: "slice", grams: 28.5, source: "pack", step: 1, printed: "2 slices (57 g)" });
  assert.equal(unitFor({ product: "Anchor Cheddar Cheese Slices", serving_size: "1 slice (21g)" }).grams, 21);
  const can = unitFor({ product: "Ayam Brand Chilli Tuna", serving_size: "40g (1/4 can)", quantity: "160 g" });
  assert.deepEqual([can.name, can.grams, can.step], ["can", 160, 0.25]);
  const canByName = unitFor({ product: "Ayam Brand Chilli Tuna", serving_size: "40 g", serving_g_or_ml: 40, quantity: "160 g" });
  assert.deepEqual([canByName.name, canByName.grams], ["can", 160]);                  // no fraction printed: tuna + a 160 g pack is a can
  const cheese = unitFor({ product: "Cheddar Fromage fondu" });                        // nothing on record
  assert.deepEqual([cheese.name, cheese.grams, cheese.source], ["slice", 20, "typical"]);
  const bread = unitFor({ product: "Gardenia ENRICHED WHITE BREAD", serving_size: "57 g", serving_g_or_ml: 57 });
  assert.deepEqual([bread.name, bread.grams, bread.source], ["slice", 30, "typical"]);   // pack says 57 g without a count: a slice is ~30 g
  assert.equal(unitFor({ product: "Whale Tea mango", quantity: "500 ml" }).name, "bottle");
  assert.equal(unitFor({ product: "Mystery paste" }), null);                             // grams only
  assert.equal(unitFor({ product: "Mystery paste", serving_size: "15 g" }).name, "serving");
});

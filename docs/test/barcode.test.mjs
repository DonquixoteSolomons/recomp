// Open Food Facts parsing and lookup. fetch is mocked; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOff, lookupBarcode, detectBarcode, unitFor, normalizeServing } from "../js/barcode.js";

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
  assert.deepEqual(unitFor({ product: "Gardenia Enriched White Bread", serving_size: "2 slices (57 g)", serving_g_or_ml: 57 }), { name: "slice", grams: 28.5, perServing: 2, source: "pack", step: 1, printed: "2 slices (57 g)" });
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

test("a serving named without a weight is still the unit when the numbers are per serving (the Thai cheese label)", () => {
  const u = unitFor({ product: "Cheddar Fromage fondu", basis: "serving", serving_size: "1 slice" });
  assert.deepEqual([u.name, u.grams, u.perServing, u.source], ["slice", null, 1, "pack"]);
  const two = unitFor({ product: "Gardenia bread", basis: "serving", serving_size: "2 slices" });
  assert.deepEqual([two.name, two.perServing], ["slice", 2]);                              // each slice is half a serving
  assert.equal(unitFor({ product: "Mystery", basis: "serving", serving_size: "1 portion" }).name, "serving");   // an unknown noun: the serving itself
  assert.equal(unitFor({ product: "Cheddar Fromage fondu", basis: "100g", serving_size: "1 slice" }).source, "typical");   // per-100 numbers need a weight
});

test("serving text in Thai, Chinese, Malay or Japanese reads the same as English", () => {
  assert.equal(normalizeServing("1 แผ่น (21 กรัม)"), "1 slice (21 g)");
  const thai = unitFor({ product: "Cheddar Fromage fondu", basis: "serving", serving_size: "1 แผ่น (21 กรัม)" });
  assert.deepEqual([thai.name, thai.grams, thai.source], ["slice", 21, "pack"]);
  assert.deepEqual([unitFor({ product: "面包", basis: "100g", serving_size: "2片 (57克)" }).name, unitFor({ product: "面包", basis: "100g", serving_size: "2片 (57克)" }).grams], ["slice", 28.5]);
  assert.equal(unitFor({ product: "Roti", basis: "100g", serving_size: "1 keping (30 g)" }).grams, 30);
  assert.equal(unitFor({ product: "Susu", basis: "100ml", serving_size: "1 botol (250 มล.)" }).name, "bottle");
  assert.equal(unitFor({ product: "Nasi", basis: "serving", serving_size: "1 หน่วยบริโภค (200 กรัม)" }).name, "serving");
});

test("soft drinks count in cans or bottles, whatever the brand calls itself", () => {
  assert.deepEqual([unitFor({ product: "Coke Zero", quantity: "320 ml" }).name, unitFor({ product: "Coke Zero", quantity: "320 ml" }).grams], ["can", 320]);
  assert.equal(unitFor({ product: "100PLUS Original", quantity: "325 ml" }).name, "can");
  assert.equal(unitFor({ product: "Pokka Green Tea", quantity: "500 ml" }).name, "bottle");
  assert.equal(unitFor({ product: "Yakult Ace", quantity: "100 ml" }).name, "bottle");
});

test("a zero-calorie drink keeps its small figure instead of rounding to nothing", () => {
  assert.equal(parseOff({ code: "1", status: 1, product: { product_name: "Coke Zero", quantity: "320 ml", nutriments: { "energy-kcal_100g": 0.3, proteins_100g: 0 } } }).kcal, 0.3);
});

// Gemini transport: free-tier limits, model fallback. fetch is mocked; no network, no key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimate, readLabel, timers, DEFAULT_MODEL, FALLBACK_MODELS } from "../js/estimate.js";

timers.sleep = async () => {};   // no real waiting in tests

const ok = (json) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }) });
const limited = (quotaId, retryDelay = "20s", quotaValue = "20") => ({ ok: false, status: 429, json: async () => ({ error: { code: 429, message: "You exceeded your current quota", status: "RESOURCE_EXHAUSTED",
  details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId, quotaValue }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }] } }) });
const gone = () => ({ ok: false, status: 404, json: async () => ({ error: { code: 404, message: "models/x is not found" } }) });
const IDENT = { dish: "Chicken rice", components: [{ name: "chicken rice", ref: "chicken_rice", quantity: 1, portion: "1 plate", confidence: "high" }], confidence: "high", assumptions: [], grounding: ["text"], tighten: "" };
const modelOf = (url) => url.match(/models\/([^:]+):/)[1];

function mockFetch(script) {   // script: model -> array of responses in call order
  const calls = [];
  globalThis.fetch = async (url) => { const m = modelOf(url); calls.push(m); const q = script[m] || []; return (q.shift() || gone)(); };
  return calls;
}

test("plain success uses the chosen model, once", async () => {
  const calls = mockFetch({ [DEFAULT_MODEL]: [() => ok(IDENT)] });
  const out = await estimate({ apiKey: "k", text: "chicken rice" });
  assert.deepEqual(calls, [DEFAULT_MODEL]); assert.equal(out.model, DEFAULT_MODEL); assert.equal(out.result.dish, "Chicken rice"); assert.ok(out.result.kcal > 400);
});

test("per-minute limit: waits and retries the same model", async () => {
  const status = [];
  const calls = mockFetch({ [DEFAULT_MODEL]: [() => limited("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "32s"), () => ok(IDENT)] });
  const out = await estimate({ apiKey: "k", text: "chicken rice", onStatus: (s) => status.push(s) });
  assert.deepEqual(calls, [DEFAULT_MODEL, DEFAULT_MODEL]); assert.equal(out.model, DEFAULT_MODEL);
  assert.match(status[0], /retrying in 32 s/);
});

test("per-day limit: moves to the next model without waiting", async () => {
  const status = [];
  const calls = mockFetch({ [DEFAULT_MODEL]: [() => limited("GenerateRequestsPerDayPerProjectPerModel-FreeTier")], [FALLBACK_MODELS[0]]: [() => ok(IDENT)] });
  const out = await estimate({ apiKey: "k", text: "chicken rice", onStatus: (s) => status.push(s) });
  assert.deepEqual(calls, [DEFAULT_MODEL, FALLBACK_MODELS[0]]); assert.equal(out.model, FALLBACK_MODELS[0]);
  assert.match(status[0], /day used up \(20 requests\) — trying the next model/);
});

test("a fallback Google no longer serves is skipped; every model out for the day is one honest error", async () => {
  const daily = () => limited("GenerateRequestsPerDayPerProjectPerModel-FreeTier");
  const script = { [DEFAULT_MODEL]: [daily], [FALLBACK_MODELS[0]]: [gone], [FALLBACK_MODELS[1]]: [daily], [FALLBACK_MODELS[2]]: [daily], [FALLBACK_MODELS[3]]: [daily] };
  const calls = mockFetch(script);
  await assert.rejects(() => estimate({ apiKey: "k", text: "x" }), (e) => e.rateLimited && /used up for today/.test(e.message) && /3–4 pm Singapore/.test(e.message));
  assert.equal(calls.length, 1 + FALLBACK_MODELS.length);
});

test("a retired primary model surfaces the suggested replacement for the app to switch to", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: { message: "Gemini 2.5 Flash is no longer available to new users; use models/gemini-3.6-flash" } }) });
  await assert.rejects(() => estimate({ apiKey: "k", model: "gemini-2.5-flash", text: "x" }), (e) => e.suggestedModel === "gemini-3.6-flash" && e.status === 404);
});

test("a bad key is one clear message, not a retry loop", async () => {
  const calls = mockFetch({ [DEFAULT_MODEL]: [() => ({ ok: false, status: 400, json: async () => ({ error: { message: "API key not valid. Please pass a valid API key." } }) })] });
  await assert.rejects(() => estimate({ apiKey: "k", text: "x" }), /rejected the API key/);
  assert.equal(calls.length, 1);
});

test("readLabel reports the model that answered", async () => {
  // prepareImage needs a browser; stub the pieces it uses
  globalThis.URL.createObjectURL = () => "blob:x"; globalThis.URL.revokeObjectURL = () => {};
  globalThis.Image = class { set src(_) { this.naturalWidth = 100; this.naturalHeight = 100; this.onload(); } };
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,AAAA" }) };
  mockFetch({ [DEFAULT_MODEL]: [() => limited("GenerateRequestsPerDayPerProjectPerModel-FreeTier")], [FALLBACK_MODELS[0]]: [() => ok({ product: "Meiji", kind: "milk", basis: "100ml", serving_size: "100 ml", serving_g_or_ml: 100, kcal: 64, protein_g: 3.2, servings_per_pack: null, confidence: "high" })] });
  const out = await readLabel({ apiKey: "k", image: {} });
  assert.equal(out.model, FALLBACK_MODELS[0]); assert.equal(out.data.kcal, 64);
});

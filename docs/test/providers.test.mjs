// The backup AI (OpenRouter) and the web lookup (Tavily). fetch is mocked; no network, no keys.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { estimate, providers, timers, extractJson, webLookup, FALLBACK_MODELS, OPENROUTER_MODELS, DEFAULT_MODEL } from "../js/estimate.js";

timers.sleep = async () => {};
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
beforeEach(() => { providers.openrouterKey = ""; providers.tavilyKey = ""; store.clear(); });

const IDENT = { dish: "Mala xiang guo", components: [{ name: "mala", ref: "mala_xiang_guo", quantity: 1, portion: "1 portion", confidence: "medium" }], confidence: "medium", assumptions: [], grounding: ["text"], tighten: "" };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const gemini503 = () => json(503, { error: { code: 503, message: "high demand" } });
const geminiOk = (ident) => json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(ident) }] }, finishReason: "STOP" }], usageMetadata: {} });
const orOk = (ident, fenced = true) => json(200, { choices: [{ message: { content: fenced ? "Here you go:\n```json\n" + JSON.stringify(ident) + "\n```" : JSON.stringify(ident) } }], usage: { prompt_tokens: 900, completion_tokens: 80 } });

function route(handlers) {   // url substring -> (url, init) => response; records every call
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); for (const [k, h] of Object.entries(handlers)) if (String(url).includes(k)) return h(String(url), init); throw new Error("unrouted " + url); };
  return calls;
}

test("every Gemini model down + a backup key → the backup AI answers, in OpenAI format, schema in the prompt", async () => {
  providers.openrouterKey = "or-test";
  const calls = route({ generativelanguage: gemini503, "openrouter.ai": () => orOk(IDENT) });
  const status = [];
  const out = await estimate({ apiKey: "g", text: "mala", onStatus: (s) => status.push(s) });
  assert.equal(out.model, "openrouter:" + OPENROUTER_MODELS[0]);
  assert.equal(out.result.dish, "Mala xiang guo"); assert.ok(out.result.kcal > 0);
  assert.equal(calls.filter(c => c.url.includes("generativelanguage")).length, 1 + FALLBACK_MODELS.length);
  const req = calls.find(c => c.url.includes("openrouter")), body = JSON.parse(req.init.body);
  assert.equal(req.init.headers.Authorization, "Bearer or-test");
  assert.equal(body.model, OPENROUTER_MODELS[0]);
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[1].content.at(-1).text, /ONE JSON object/);
  assert.match(status.at(-1), /backup AI/);
});

test("the backup tries its next free model when one is busy, and photos go as data URLs", async () => {
  providers.openrouterKey = "or-test";
  let n = 0;
  const calls = route({ generativelanguage: gemini503, "openrouter.ai": () => (n++ === 0 ? json(429, { error: { message: "rate limited" } }) : orOk(IDENT, false)) });
  globalThis.URL.createObjectURL = () => "blob:x"; globalThis.URL.revokeObjectURL = () => {};
  globalThis.Image = class { set src(_) { this.naturalWidth = 100; this.naturalHeight = 100; this.onload(); } };
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,AAAA" }) };
  const out = await estimate({ apiKey: "g", images: [{}], text: "" });
  assert.equal(out.model, "openrouter:" + OPENROUTER_MODELS[1]);
  const body = JSON.parse(calls.filter(c => c.url.includes("openrouter")).at(-1).init.body);
  assert.equal(body.messages[1].content[0].type, "image_url");
  assert.match(body.messages[1].content[0].image_url.url, /^data:image\/jpeg;base64,/);
});

test("no backup key: the old behaviour — one transient error the app parks the meal on", async () => {
  route({ generativelanguage: gemini503 });
  await assert.rejects(() => estimate({ apiKey: "g", text: "x" }), (e) => e.transient && !/backup/.test(e.message));
});

test("backup down too: the error says both are down", async () => {
  providers.openrouterKey = "or-test";
  route({ generativelanguage: gemini503, "openrouter.ai": () => json(502, { error: { message: "bad gateway" } }) });
  await assert.rejects(() => estimate({ apiKey: "g", text: "x" }), (e) => e.transient && /and so is the backup AI/.test(e.message));
});

test("only a backup key, no Gemini key: the backup is the AI", async () => {
  providers.openrouterKey = "or-test";
  const calls = route({ "openrouter.ai": () => orOk(IDENT) });
  const out = await estimate({ apiKey: "", text: "mala" });
  assert.match(out.model, /^openrouter:/);
  assert.equal(calls.length, 1);
});

test("a rejected backup key is a settings problem, not something to retry", async () => {
  providers.openrouterKey = "bad";
  route({ generativelanguage: gemini503, "openrouter.ai": () => json(401, { error: { message: "No auth" } }) });
  await assert.rejects(() => estimate({ apiKey: "g", text: "x" }), (e) => e.config && /backup key/.test(e.message));
});

test("extractJson finds the object in fences or prose", () => {
  assert.equal(extractJson('Sure!\n```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJson('{"a":{"b":2}} hope that helps'), '{"a":{"b":2}}');
});

const TAVILY = { results: [
  { title: "Dragonfly Mala Hotpot menu", url: "https://www.dragonfly.sg/menu", content: "Mala xiang guo, choose ingredients by weight, $2.80 per 100 g; luncheon meat, fish balls, lotus root.", score: 0.9 },
  { title: "Calories in Dragonfly mala — MyFitnessPal", url: "https://www.myfitnesspal.com/food/calories/dragonfly-mala-123", content: "Dragonfly mala xiang guo (1 bowl): 1,050 calories, 38 g protein.", score: 0.8 },
] };

test("a named place → one web search; its results go into the prompt and come back as sources", async () => {
  providers.tavilyKey = "tv-test";
  let prompt = "";
  const calls = route({ "api.tavily.com": () => json(200, TAVILY), generativelanguage: (u, init) => { prompt = JSON.parse(init.body).contents[0].parts.at(-1).text; return geminiOk(IDENT); } });
  const status = [];
  const out = await estimate({ apiKey: "g", text: "Had mala from dragonfly at bangkit", onStatus: (s) => status.push(s) });
  const search = calls.find(c => c.url.includes("tavily")), body = JSON.parse(search.init.body);
  assert.equal(search.init.headers.Authorization, "Bearer tv-test");
  assert.match(body.query, /mala from dragonfly at bangkit calories/i);
  assert.match(prompt, /Web results about this venue and dish/); assert.match(prompt, /1,050 calories/);
  assert.deepEqual(out.sources.map(s => s.host), ["dragonfly.sg", "myfitnesspal.com"]);
  assert.match(status[0], /searching the web/);
});

test("the search is cached, skipped without a place, and never blocks the estimate", async () => {
  providers.tavilyKey = "tv-test";
  let searches = 0;
  route({ "api.tavily.com": () => { searches++; return json(200, TAVILY); }, generativelanguage: () => geminiOk(IDENT) });
  await estimate({ apiKey: "g", text: "Had laksa from 328 Katong" });
  await estimate({ apiKey: "g", text: "Had laksa from 328 Katong" });
  await estimate({ apiKey: "g", text: "a bowl of laksa" });
  assert.equal(searches, 1);
  store.clear();
  route({ "api.tavily.com": () => json(500, {}), generativelanguage: () => geminiOk(IDENT) });
  const out = await estimate({ apiKey: "g", text: "chicken rice from Tian Tian" });
  assert.equal(out.result.dish, "Mala xiang guo"); assert.deepEqual(out.sources, []);
  assert.equal(await webLookup("chicken rice from Tian Tian"), null);
});

test("a shared meal: the model is told to value the whole dish, because the app applies the share", async () => {
  let prompt = "";
  route({ generativelanguage: (u, init) => { prompt = JSON.parse(init.body).contents[0].parts.at(-1).text; return geminiOk(IDENT); } });
  const out = await estimate({ apiKey: "g", text: "mala, shared", share: 0.5 });
  assert.match(prompt, /share of 50% — the app multiplies/); assert.match(prompt, /WHOLE dish/);
  assert.equal(out.result.kcal, 450);                                                 // 900 whole × ½, once
  await estimate({ apiKey: "g", text: "mala" });
  assert.doesNotMatch(prompt, /share of/);                                           // a whole meal: no share line at all
});

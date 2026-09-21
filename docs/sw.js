/* App shell cache so the page opens offline; data lives in IndexedDB, not here. */
const CACHE = "recomp-v25";
const SHELL = ["./", "./index.html", "./css/style.css", "./js/app.js", "./js/db.js", "./js/foods.js",
               "./js/engine.js", "./js/estimate.js", "./js/sync.js", "./js/barcode.js", "./manifest.webmanifest", "./icon.svg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;            // Gemini, GitHub, fonts: straight to network
  // network first, revalidated (no-cache) so a deploy is never masked by the HTTP cache; cached copy when offline
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});

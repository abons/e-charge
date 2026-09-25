/* Cache-first shell, zodat de rekenhulp in een parkeergarage zonder bereik ook opent — de app-shell
 * is alles wat er hoeft te zijn. De stroomprijzen (`src/prices.ts`) gaan naar een andere origin en
 * dus buiten deze worker om; zonder bereik staan ze in localStorage. VERSION wordt bij elke build
 * door `scripts/build.mjs` gestempeld (hier staat de letterlijke `v1` die hij zoekt);
 * `skipWaiting`/`clients.claim` plus de reload in main.ts maken dat een nieuwe versie zichzelf
 * doorzet in plaats van achter een oude tab te blijven wachten. */
const VERSION = "v1";
const SHELL = ["./", "app.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ??
        fetch(e.request).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
          }
          return resp;
        })
    )
  );
});

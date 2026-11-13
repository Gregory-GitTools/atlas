// Сервис-воркер Atlas.
//  • Файлы программы — сначала сеть, потом кэш: в сети всегда свежая версия кода (телефон не держит
//    старое — опыт travel-earth), без сети — то, что открывалось или скачано «Скачать район».
//  • Библиотеки с номером версии (unpkg, jsdelivr) не меняются — сначала кэш (без сети тоже есть).
//  • Карта (OpenFreeMap, высоты AWS): скачанная «Скачать район» плитка, шрифт, значок — сразу с
//    устройства, и в сети тоже (роуминг дорогой); стиль и описание карты — сначала из сети (за 4 с),
//    без неё — скачанные. Чего нет на устройстве — из сети как обычно, ничего не запоминается.
//    Ключ плитки OpenFreeMap — без номера выпуска карты (то же правило — tileKey в core/offline.js)
const CACHE = "atlas-app";
const TRIP = "atlas-trip";
const MAP_HOST = /^https:\/\/(tiles\.openfreemap\.org|s3\.amazonaws\.com\/elevation-tiles-prod)\//;
const LIB = /^https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.+@\d/;
const tileKey = (u) => u.replace(/^(https:\/\/tiles\.openfreemap\.org\/planet)\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/, "$1/_/$2");
// неизменяемое: плитки, шрифты, значки (у значков OpenFreeMap номер в адресе)
const FIXED = /\/\d+\/\d+\/\d+\.(pbf|png)$|\/fonts\/|\/sprites\//;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const fromTrip = (u) => caches.open(TRIP).then((c) => c.match(tileKey(u)));
const timeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("долго")), ms))]);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req, { cache: "no-cache" })
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (req.mode === "navigate" && (await caches.match(req, { ignoreSearch: true }))) || Response.error()),
    );
    return;
  }
  if (LIB.test(req.url)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req.url);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type !== "opaque") c.put(req.url, res.clone());
      return res;
    }));
    return;
  }
  if (MAP_HOST.test(req.url)) {
    if (FIXED.test(url.pathname)) e.respondWith(fromTrip(req.url).then((hit) => hit || fetch(req)));
    else {
      const net = fetch(req);
      e.respondWith(timeout(net, 4000).catch(async () => (await fromTrip(req.url)) || net));
    }
  }
});

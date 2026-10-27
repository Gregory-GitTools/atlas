// Сервис-воркер Atlas. Сначала сеть, потом кэш: в сети всегда свежая версия кода (телефон не
// держит старое — опыт travel-earth), без сети — то, что открывалось раньше. Кэшируются только
// файлы самого приложения; плитки карты и данные — забота пакета «поездка» (позже)
const CACHE = "atlas-app";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || Response.error())),
  );
});

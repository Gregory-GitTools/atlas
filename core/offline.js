// «Скачать район» — первая часть пакета «поездка» (ROADMAP, раздел «Офлайн»). Скачивается то, что видно
// на карте: векторная карта OpenFreeMap до улиц (зум 14, ближе MapLibre растягивает), высоты для теней и
// горизонталей, если они включены, шрифты и значки стиля, а заодно файлы самой программы — чтобы она
// открылась без сети. Всё лежит в Cache Storage «atlas-trip»; отдаёт сервис-воркер (sw.js): скачанная
// плитка берётся с устройства и в сети (роуминг дорогой), стиль и описание карты — сначала из сети.
// Спутник (Esri), CARTO и тропы Waymarked не скачиваются: их условия не разрешают хранить плитки.
// Вместе с картой — тексты всех экскурсий и разговорников (около 1 МБ) и места остановок экскурсий страны
// района (их находит content/tours.js по событию trip-prepare): копии записей хранилища — «trip/<ключ>»,
// их не стирает «Очистить историю просмотра». Пакеты: список в настройках ("trips"), ключи каждого — в IndexedDB ("trip/<id>"); удаление пакета не
// трогает плитки, нужные другому пакету
import * as settings from "./settings.js";
import { cacheGet, cacheSet, cacheDelete, persist, keepForTrip } from "./storage.js";
import { repoFiles, repoText } from "./repo.js";
import { emit } from "./events.js";

export const TRIP_CACHE = "atlas-trip";
const APP_CACHE = "atlas-app"; // тот же, что в sw.js
// хозяева, чьи плитки можно хранить: OpenFreeMap (открытые данные OSM) и высоты AWS (открытые данные)
const HOSTS = /^https:\/\/(tiles\.openfreemap\.org|s3\.amazonaws\.com\/elevation-tiles-prod)\//;
const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const VECTOR_MAX = 14, DEM_MAX = 12;
export const TILE_LIMIT = 4000; // плиток карты на самом подробном зуме — примерно 100 × 100 км в Альпах
const RANGES = ["0-255", "256-511", "512-767", "768-1023", "1024-1279", "8192-8447"]; // латиница, греческий, кириллица, знаки

// у OpenFreeMap в адресе плитки — номер выпуска карты, он меняется каждую неделю; ключ без него, чтобы
// скачанное находилось и после выхода нового выпуска (то же правило — в sw.js)
export const tileKey = (u) => u.replace(/^(https:\/\/tiles\.openfreemap\.org\/planet)\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/, "$1/_/$2");

export const trips = () => settings.get("trips", []);

// плитки, покрывающие район, на зуме z
const tileRange = ([w, s, e, n], z) => {
  const k = 2 ** z, lat = (y) => Math.max(-85, Math.min(85, y)) * Math.PI / 180;
  const tx = (x) => Math.min(k - 1, Math.max(0, Math.floor(((x + 180) / 360) * k)));
  const ty = (y) => Math.min(k - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(lat(y)) + 1 / Math.cos(lat(y))) / Math.PI) / 2) * k)));
  return { x0: tx(w), x1: tx(e), y0: ty(n), y1: ty(s) };
};
const countAt = (b, z) => { const r = tileRange(b, z); return (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1); };

export const viewBox = (map) => {
  const b = map.getBounds();
  return [b.getWest(), Math.max(-85, b.getSouth()), b.getEast(), Math.min(85, b.getNorth())].map((v) => +v.toFixed(5));
};
// район не слишком велик (кнопка «Скачать» иначе неактивна — правило недоступного)
export const fits = (map) => { const b = viewBox(map); return b[2] - b[0] < 180 && countAt(b, VECTOR_MAX) <= TILE_LIMIT; };

// что скачивать: адреса плиток по шаблонам источников карты + описания, стиль, шрифты, значки
async function plan(map, box) {
  const style = map.getStyle();
  const urls = new Set(), templates = new Map(); // шаблон → наибольший зум
  const add = (t, max) => templates.set(t, Math.max(templates.get(t) ?? 0, max));
  for (const src of Object.values(style.sources || {})) {
    if (src.url && HOSTS.test(src.url)) {
      urls.add(src.url);
      const tj = await fetch(src.url).then((r) => r.json()).catch(() => null);
      for (const t of tj?.tiles || []) if (HOSTS.test(t)) add(t, Math.min(tj.maxzoom ?? VECTOR_MAX, VECTOR_MAX));
    }
    for (const t of src.tiles || []) if (HOSTS.test(t)) add(t, Math.min(src.maxzoom ?? VECTOR_MAX, src.type === "raster-dem" ? DEM_MAX : VECTOR_MAX));
  }
  // тени, 3D и горизонтали берут высоты через свой источник (maplibre-contour) — те же картинки AWS
  if (/elevation-tiles-prod|dem-contour/.test(JSON.stringify(style.sources || {}))) add(DEM, DEM_MAX);
  for (const [t, max] of templates) for (let z = 0; z <= max; z++) {
    const r = tileRange(box, z);
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) urls.add(t.replace("{z}", z).replace("{x}", x).replace("{y}", y));
  }
  // стиль подложки (без сети карта открывается с ним), шрифты подписей, значки
  const basemap = (await import("./basemaps.js")).currentBasemap();
  if (typeof basemap.style === "string" && HOSTS.test(basemap.style)) urls.add(basemap.style);
  if (style.glyphs && HOSTS.test(style.glyphs)) {
    const stacks = new Set(["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"]);
    for (const l of style.layers || []) {
      const f = l.layout?.["text-font"];
      if (Array.isArray(f) && f.every((x) => typeof x === "string")) stacks.add(f.join(","));
    }
    for (const s of stacks) for (const r of RANGES) urls.add(new URL(style.glyphs.replace("{fontstack}", s).replace("{range}", r)).href);
  }
  for (const sp of [style.sprite].flat().filter(Boolean)) {
    const base = typeof sp === "string" ? sp : sp.url;
    if (HOSTS.test(base)) for (const ext of [".json", ".png", "@2x.json", "@2x.png"]) urls.add(base + ext);
  }
  return [...urls];
}

// файлы программы: обход импортов от index.html (свои файлы и библиотеки с номером версии с unpkg)
async function appFiles() {
  const root = new URL("./", location.href);
  const seen = new Set(), queue = ["./", "index.html", "manifest.json", "core/app.js", "core/style.css", "icons/icon-192.png", "icons/icon-512.png"].map((p) => new URL(p, root).href);
  while (queue.length && seen.size < 400) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    if (!/\.(m?js|css|html)$|\/$/.test(new URL(u).pathname) || !u.startsWith(root.href)) continue;
    const text = await fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    const found = [
      ...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"'`]+)["']/g),
      ...text.matchAll(/(?:src|href)=["']([^"'#]+)["']/g),
      ...text.matchAll(/url\(["']?([^"')]+)["']?\)/g),
      ...text.matchAll(/["']((?:\.\.?\/)?(?:core|content|layers|tools|icons)\/[\w./-]+\.(?:m?js|css|json|png|jpg|svg|ico))["']/g),
      ...text.matchAll(/["'](https:\/\/unpkg\.com\/[^"'`\s]+@\d[^"'`\s]*)["']/g),
    ].map((m) => m[1]);
    for (const f of found) {
      if (/^(data:|blob:|mailto:|#)/.test(f) || f.includes("${")) continue;
      const abs = /^https?:/.test(f) ? f : new URL(f, /^\.\.?\//.test(f) ? u : root).href;
      if ((abs.startsWith(root.href) || /^https:\/\/unpkg\.com\/.+@\d/.test(abs)) && !seen.has(abs)) queue.push(abs);
    }
  }
  return [...seen];
}

// название района: город или край в центре карты (Nominatim; только по нажатию «Скачать»)
async function placeName(map) {
  const c = map.getCenter();
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000);
    const j = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=ru&lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}`, { signal: ctl.signal }).then((r) => r.json());
    const a = j.address || {};
    const name = a.city || a.town || a.village || a.municipality || a.county || a.state;
    if (name) return { title: a.country && name !== a.country ? `${name}, ${a.country}` : name, country: a.country || "" };
  } catch { /* без названия */ }
  return { title: `Район ${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}`, country: "" };
}

let job = null; // идёт скачивание: { done, total, stop }
export const downloading = () => job && { done: job.done, total: job.total, phase: job.phase };

// экскурсии и разговорники: тексты всех (повторно не качаются — помнятся по хэшу) и места остановок
// экскурсий страны района; вернуть ключи записей хранилища, которые сохранены копией у поездки
async function texts(box, country) {
  const keys = ["repo/tree"];
  const files = [...(await repoFiles("Экскурсии").catch(() => [])), ...(await repoFiles("Языки").catch(() => []))].filter((f) => /\.(md|txt)$/i.test(f.name));
  await Promise.all(files.map((f) => repoText(f).then(() => keys.push(`repo/text/${f.sha}`)).catch(() => {})));
  const ev = { box, country, tasks: [], stopped: false };
  job.ev = ev;
  emit("trip-prepare", ev);
  let tours = 0;
  for (const r of await Promise.allSettled(ev.tasks)) if (r.status === "fulfilled" && r.value) { keys.push(...r.value.keys); tours += r.value.tours || 0; }
  const kept = [];
  for (const k of keys) if (await keepForTrip(k).catch(() => false)) kept.push(k);
  return { kept, files: files.length, tours };
}

// скачать видимый район; onProgress() — после каждой порции
export async function downloadArea(map, onProgress) {
  if (job) return null;
  job = { done: 0, total: 0, stopped: false };
  try {
    await persist();
    const box = viewBox(map);
    job.phase = "Готовлю экскурсии и разговорники";
    onProgress?.();
    const [tiles, files, place] = await Promise.all([plan(map, box), appFiles(), placeName(map)]);
    const { title, country } = place;
    const extra = await texts(box, country);
    if (job.stopped) return null;
    job.phase = "";
    job.total = tiles.length + files.length;
    onProgress?.();
    const trip = await caches.open(TRIP_CACHE), app = await caches.open(APP_CACHE);
    const keys = [];
    let bytes = 0, failed = 0;
    const one = async (u, isApp) => {
      const cache = isApp ? app : trip, key = isApp ? u : tileKey(u);
      if (!isApp && (await cache.match(key))) { keys.push(key); return; }
      const res = await fetch(u, isApp ? { cache: "no-cache" } : {}).catch(() => null);
      if (!res?.ok) { failed++; return; }
      const blob = await res.blob();
      await cache.put(key, new Response(blob, { headers: { "content-type": res.headers.get("content-type") || "" } }));
      if (u.endsWith("/") && isApp) await cache.put(new URL("index.html", u).href, new Response(blob, { headers: { "content-type": "text/html" } }));
      if (!isApp) { keys.push(key); bytes += blob.size; }
    };
    const work = [...tiles.map((u) => [u, false]), ...files.map((u) => [u, true])];
    let next = 0;
    const lane = async () => {
      while (next < work.length && !job.stopped) {
        const [u, isApp] = work[next++];
        await one(u, isApp);
        job.done++;
        if (job.done % 10 === 0) onProgress?.();
      }
    };
    await Promise.all(Array.from({ length: 6 }, lane));
    if (job.stopped) { await dropKeys(keys); return null; }
    const id = Date.now().toString(36);
    await cacheSet(`trip/${id}`, [...keys, ...extra.kept.map((k) => `idb:${k}`)]);
    const item = { id, title, country, box, tiles: keys.length, bytes, failed, texts: extra.files, tours: extra.tours, saved: new Date().toISOString() };
    settings.set("trips", [...trips(), item]);
    return item;
  } finally { job = null; onProgress?.(); }
}

export const stopDownload = () => { if (job) { job.stopped = true; if (job.ev) job.ev.stopped = true; } };

// убрать ключи, которых нет в других пакетах
async function dropKeys(keys, except = null) {
  const keep = new Set();
  for (const t of trips()) if (t.id !== except) for (const k of (await cacheGet(`trip/${t.id}`)) || []) keep.add(k);
  const trip = await caches.open(TRIP_CACHE);
  await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => (k.startsWith("idb:") ? cacheDelete(`trip/${k.slice(4)}`) : trip.delete(k))));
}

export async function removeTrip(id) {
  await dropKeys((await cacheGet(`trip/${id}`)) || [], id);
  await cacheDelete(`trip/${id}`);
  settings.set("trips", trips().filter((t) => t.id !== id));
}

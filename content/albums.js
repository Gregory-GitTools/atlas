// Мои альбомы (перенос из travel-earth, Грегори 2026-10-29). Альбом — папка со снимками: папки
// «Альбомы» репозитория travel-earth (видны всем, на любом устройстве) и, на компьютере, своя папка,
// выбранная в настройках (доступ к ней хранится только в этом браузере, снимки никуда не уходят).
// В барабане — кнопка «Мои альбомы», в её столбике — страны с флагами; страна — панель слева со
// списком её альбомов, альбом — в той же панели: даты, снимки сеткой, «Смотреть» — галерея.
// Пока панель открыта, на карте: альбом — фиолетовый фотоаппарат (издалека), ближе — точки снимков
// (налезающие — кружок с числом), с «1 км» — миниатюры; снимки в кадре — в общей ленте внизу,
// двойной щелчок — альбом в галерее с этого снимка. Координаты и дата — из EXIF (exifr, грузится
// при первом открытии), прочитанное помнится на устройстве. Точка альбома — самый многолюдный «куст»
// снимков, а не первый снимок (опыт travel-earth: первым часто снят аэропорт вылета), обложка —
// случайный снимок из него. Страна — по границам стран без сети (country-borders.json travel-earth).
// Видео и живые фото — позже (ROADMAP)
import { register, isMobile } from "../core/modules.js";
import { createPanel, isOpen } from "../core/panel.js";
import { repoFiles, repoUrl, repoSite } from "../core/repo.js";
import { flagUrl } from "../core/flags.js";
import { emit } from "../core/events.js";
import { setSearchMode, searchMode } from "../core/search.js";
import { cacheGet, cacheSet, cacheDelete } from "../core/storage.js";
import { track, claimLayers } from "../core/popups.js";
import { setStripItems, selectStripItem, openGalleryWith } from "../core/photo-strip.js";
import { PLAYER } from "../core/player.js";

const svg = (d, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`;
const STACK_D = "M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4 2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z";
const CAMERA_D = "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z";
const ICON = svg(STACK_D);
const BACK = svg("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z", 20);
const COLOR = "#7c4dff"; // --tone-my
const IMAGE_RE = /\.(jpe?g|webp|png)$/i;
const PROBE = 25; // сколько снимков альбома пробовать в поисках координат на первом проходе
const DOT_ZOOM = 10, THUMB_ZOOM = 14, VIEW_ZOOM = 12; // точки снимков, миниатюры, миниатюры для ленты
const THUMB = 240, MAP_THUMB = 88; // миниатюра ленты и сетки; на карте — 44 px в белой рамке
const NO_COUNTRY = "Без страны";

// название напоказ — без даты-префикса, скобок и пометки «-Albom» (сама папка не меняется;
// Грегори в travel-earth: «маску на все цифры в начале», «на убирание скобок», «фильтровать -Albom»)
const displayName = (name) => name
  .replace(/^(?:\d+[\s_-]+)+/, "")
  .replace(/\s*\([^()]*\)/g, "")
  .replace(/[\s_–—-]*albom[\s_–—-]*$/i, "")
  .replace(/\s{2,}/g, " ")
  .trim() || name;
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
function dates(a) {
  if (!a.from) return "";
  const f = new Date(a.from), t = new Date(a.to);
  const day = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (f.toDateString() === t.toDateString()) return `${day(f)} ${f.getFullYear()}`;
  if (f.getFullYear() !== t.getFullYear()) return `${day(f)} ${f.getFullYear()} — ${day(t)} ${t.getFullYear()}`;
  if (f.getMonth() === t.getMonth()) return `${f.getDate()}–${day(t)} ${t.getFullYear()}`;
  return `${day(f)} — ${day(t)} ${t.getFullYear()}`;
}
const photoDate = (p) => (p.rec?.date ? new Date(p.rec.date).toLocaleDateString("ru") : "");

// ---------- данные ----------
const albums = new Map(); // путь папки → { id, name, title, local, photos, point, country, cover, from, to, done }
const photos = new Map(); // "album/12" → { id, album, name, path, url | handle, key, rec, thumb, img }
let seq = 0, scan = 0, ctx = null, loading = null;
let dir = null, needsAccess = false, busy = false, checked = 0;
const canFolders = () => "showDirectoryPicker" in window && !isMobile();

function addAlbum(path, name, local, files) {
  const a = { id: path, name, title: displayName(name), local, photos: [], point: null, country: undefined, cover: null, from: 0, to: 0, done: false };
  for (const f of files.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }))) {
    const p = { id: `album/${++seq}`, album: a, rec: null, thumb: "", img: "", ...f };
    photos.set(p.id, p);
    a.photos.push(p.id);
  }
  albums.set(path, a);
}

async function listRepo() {
  const by = new Map();
  for (const f of (await repoFiles("Альбомы")).filter((f) => IMAGE_RE.test(f.name))) {
    const d = f.path.slice(0, f.path.lastIndexOf("/"));
    if (!by.has(d)) by.set(d, []);
    by.get(d).push({ name: f.name, path: f.path, url: repoUrl(f), key: `exif/${f.sha}` });
  }
  for (const [d, files] of by) addAlbum(d, d.split("/").pop(), false, files);
}

// своя папка: альбом — каждая папка, где есть снимки (подпапки — свои альбомы)
async function walk(handle, path, token) {
  const files = [], dirs = [];
  try {
    for await (const [name, h] of handle.entries()) {
      if (h.kind === "directory") { if (!/^[._]/.test(name)) dirs.push([name, h]); }
      else if (IMAGE_RE.test(name)) files.push({ name, path: `${path}/${name}`, handle: h });
    }
  } catch { return; }
  if (token !== scan) return;
  if (files.length) addAlbum(path, handle.name, true, files);
  for (const [name, h] of dirs.sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true }))) await walk(h, `${path}/${name}`, token);
}

// ---------- EXIF: координаты и дата, помнятся на устройстве ----------
let exifrLoad = null;
const exifr = () => (exifrLoad ??= import("https://unpkg.com/exifr@7.1.3/dist/full.esm.mjs")
  .then((m) => m.default || m).catch((err) => { exifrLoad = null; throw err; }));
const OPTS = { tiff: true, exif: true, gps: true, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false, translateValues: false };

async function exifOf(p) {
  if (p.rec) return p.rec;
  let key = p.key, file = null;
  try {
    if (p.handle) { file = await p.handle.getFile(); key = `exif/local/${p.path}|${file.size}|${file.lastModified}`; }
    const hit = await cacheGet(key).catch(() => null);
    if (hit) { checked++; return (p.rec = hit); }
    // у снимка из репозитория EXIF — в начале файла: хватает первых 128 КБ
    const src = file || await fetch(p.url, { headers: { Range: "bytes=0-131071" } }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))));
    const rec = {};
    try {
      const e = await (await exifr()).parse(src, OPTS);
      if (Number.isFinite(e?.latitude) && Number.isFinite(e?.longitude) && (e.latitude || e.longitude)) Object.assign(rec, { lat: e.latitude, lon: e.longitude });
      // у уменьшенных копий в «Альбомах» остаётся только дата сохранения (DateTime) — тоже годится
      const d = [e?.DateTimeOriginal, e?.CreateDate, e?.ModifyDate].find((x) => x instanceof Date);
      if (d) rec.date = d.getTime();
    } catch { /* без EXIF */ }
    cacheSet(key, rec).catch(() => {});
    checked++;
    return (p.rec = rec);
  } catch {
    // файл не прочитался (нет сети, облачная заглушка) — без координат, но и в память не пишем
    checked++;
    return (p.rec = {});
  }
}

// ---------- страна: по границам стран, без сети после первой загрузки ----------
let borders = null;
const loadBorders = () => (borders ??= fetch(repoSite("country-borders.json")).then((r) => r.json()).then((d) => d.features)
  .catch(() => { borders = null; return []; }));
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (pt, rings) => inRing(pt, rings[0]) && !rings.slice(1).some((r) => inRing(pt, r));
function countryAt(pt, features) {
  const polys = (f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);
  const hit = features.find((f) => polys(f).some((rings) => inPolygon(pt, rings)));
  if (hit) return hit;
  // упрощённая граница не накрывает берег (Лиссабон в устье Тежу) — страна с ближайшей вершиной
  let best = null, dist = Infinity;
  for (const f of features) for (const rings of polys(f)) for (const ring of rings) for (const v of ring) {
    const d = (v[0] - pt[0]) ** 2 + (v[1] - pt[1]) ** 2;
    if (d < dist) { dist = d; best = f; }
  }
  return dist < 1 ? best : null;
}
async function locate(a) {
  if (!a.point) { a.country = null; return; }
  const f = countryAt(a.point, await loadBorders());
  a.country = f ? { name: f.properties.name, iso: f.properties.iso } : null;
}
const countryOf = (a) => a.country?.name || NO_COUNTRY;

// ---------- обход ----------
// проход 1 — у каждого альбома первый снимок с координатами (точка и страна сразу), проход 2 — все
// снимки, альбомы ближе к центру карты первыми; точка альбома — самый многолюдный «куст» (~10 км)
async function finish(a) {
  const cells = new Map();
  for (const id of a.photos) {
    const r = (await exifOf(photos.get(id)));
    if (!r.lat) continue;
    const k = `${r.lon.toFixed(1)},${r.lat.toFixed(1)}`;
    if (!cells.has(k)) cells.set(k, { point: [r.lon, r.lat], ids: [] });
    cells.get(k).ids.push(id);
  }
  const best = [...cells.values()].sort((x, y) => y.ids.length - x.ids.length)[0];
  const moved = best && (!a.point || best.point.join() !== a.point.join());
  if (best) a.point = best.point;
  const pool = best ? best.ids : a.photos;
  a.cover = pool[Math.floor(Math.random() * pool.length)] || null;
  const ds = a.photos.map((id) => photos.get(id).rec?.date).filter(Boolean);
  if (ds.length) { a.from = Math.min(...ds); a.to = Math.max(...ds); }
  if (moved || a.country === undefined) await locate(a);
  a.done = true;
}

async function rescan() {
  const token = ++scan;
  albums.clear();
  photos.clear();
  checked = 0;
  busy = true;
  refresh();
  try { await exifr(); } catch { busy = false; ctx?.status("Не загрузилась программа чтения снимков — проверьте интернет"); return; }
  await listRepo().catch(() => {});
  if (dir && !needsAccess) await walk(dir, dir.name, token);
  if (token !== scan) return;
  for (const a of albums.values()) {
    for (const id of a.photos.slice(0, PROBE)) {
      const r = await exifOf(photos.get(id));
      if (r.lat) { a.point = [r.lon, r.lat]; break; }
    }
    if (token !== scan) return;
    await locate(a);
  }
  refresh();
  // проход 2 — в фоне
  (async () => {
    for (;;) {
      if (token !== scan) return;
      const rest = [...albums.values()].filter((a) => !a.done);
      if (!rest.length) break;
      const c = ctx?.map.getCenter();
      const dist = (a) => (a.point && c ? Math.hypot(a.point[0] - c.lng, a.point[1] - c.lat) : 1e9);
      await finish(rest.reduce((x, y) => (dist(y) < dist(x) ? y : x)));
      refresh();
    }
    busy = false;
    refresh();
  })();
}

async function load(c) {
  if (c) ctx = c;
  loading ??= (async () => {
    if (canFolders()) {
      dir = await cacheGet("albums/dir").catch(() => null) || null;
      needsAccess = !!dir && await dir.queryPermission({ mode: "read" }).catch(() => "denied") !== "granted";
    }
    await rescan();
  })();
  return loading;
}

const countries = () => {
  const by = new Map();
  for (const a of albums.values()) { const k = countryOf(a); by.set(k, (by.get(k) || 0) + 1); }
  // «Без страны» — первой, остальные по алфавиту
  return [...by].sort((x, y) => (y[0] === NO_COUNTRY) - (x[0] === NO_COUNTRY) || x[0].localeCompare(y[0], "ru"));
};
const isoOf = (name) => [...albums.values()].find((a) => a.country?.name === name)?.country.iso || "";

// ---------- миниатюры: по две за раз, только нужные ----------
const queue = [];
let working = 0;
const fileOf = async (p) => (p.handle ? p.handle.getFile() : (await fetch(p.url)).blob());
function thumbOf(p) {
  if (p.thumbing) return p.thumbing;
  p.thumbing = new Promise((resolve) => { queue.push([p, resolve]); pump(); });
  return p.thumbing;
}
function pump() {
  while (working < 2 && queue.length) {
    const [p, resolve] = queue.shift();
    working++;
    makeThumb(p).catch(() => {}).finally(() => { working--; resolve(p.thumb); pump(); });
  }
}
async function makeThumb(p) {
  // поворот из EXIF браузер учитывает сам (imageOrientation по умолчанию — from-image)
  const bmp = await createImageBitmap(await fileOf(p), { resizeWidth: 480, resizeQuality: "medium" });
  const side = Math.min(bmp.width, bmp.height), sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;
  const c = Object.assign(document.createElement("canvas"), { width: THUMB, height: THUMB });
  c.getContext("2d").drawImage(bmp, sx, sy, side, side, 0, 0, THUMB, THUMB);
  p.thumb = URL.createObjectURL(await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85)));
  // на карте — квадрат в тонкой белой скруглённой рамке, как у снимков Commons
  const m = Object.assign(document.createElement("canvas"), { width: MAP_THUMB, height: MAP_THUMB }).getContext("2d");
  const border = 3;
  m.beginPath(); m.roundRect(0, 0, MAP_THUMB, MAP_THUMB, 12); m.fillStyle = "#fff"; m.fill();
  m.beginPath(); m.roundRect(border, border, MAP_THUMB - 2 * border, MAP_THUMB - 2 * border, 12 - border); m.clip();
  m.drawImage(bmp, sx, sy, side, side, border, border, MAP_THUMB - 2 * border, MAP_THUMB - 2 * border);
  p.img = `my-${p.id.replace("/", "-")}`;
  p.imgData = m.getImageData(0, 0, MAP_THUMB, MAP_THUMB);
  if (shown && !ctx.map.hasImage(p.img)) try { ctx.map.addImage(p.img, p.imgData, { pixelRatio: 2 }); } catch { /* стиль меняется */ }
  refresh();
}
// крупный снимок своего файла — адрес держится для 8 последних
const fulls = [];
async function fullOf(p) {
  if (p.url) return p.url;
  const hit = fulls.find((x) => x.id === p.id);
  if (hit) return hit.url;
  const url = URL.createObjectURL(await p.handle.getFile());
  fulls.push({ id: p.id, url });
  if (fulls.length > 8) URL.revokeObjectURL(fulls.shift().url);
  return url;
}
const media = (kind, id) => { const p = photos.get(id); return !p ? Promise.resolve("") : kind === "full" ? fullOf(p) : thumbOf(p); };

// снимки в кадре (вблизи) — миниатюры ближние к центру первыми
function wantInView() {
  if (!shown || ctx.map.getZoom() < VIEW_ZOOM) return;
  const b = ctx.map.getBounds(), c = ctx.map.getCenter();
  [...photos.values()].filter((p) => p.rec?.lat && !p.thumb && b.contains([p.rec.lon, p.rec.lat]))
    .sort((x, y) => Math.hypot(x.rec.lon - c.lng, x.rec.lat - c.lat) - Math.hypot(y.rec.lon - c.lng, y.rec.lat - c.lat))
    .slice(0, 60).forEach(thumbOf);
}

// ---------- карта ----------
let shown = false, frame = 0;
const pt = (p) => [p.rec.lon, p.rec.lat];
const located = () => [...photos.values()].filter((p) => p.rec?.lat);
const fc = (features) => ({ type: "FeatureCollection", features });
const albumData = () => fc([...albums.values()].filter((a) => a.point).map((a) => ({ type: "Feature", geometry: { type: "Point", coordinates: a.point },
  properties: { album: a.id, title: a.title } })));
const dotData = () => fc(located().map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: pt(p) }, properties: { photo: p.id } })));
const thumbData = () => fc(located().filter((p) => p.img).map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: pt(p) }, properties: { photo: p.id, img: p.img } })));
const font = (map) => map.getStyle().layers.find((l) => l.type === "symbol" && Array.isArray(l.layout?.["text-font"]))?.layout["text-font"] || ["Noto Sans Regular"];
const LAYERS = ["albums-icons", "albums-dots", "albums-count", "albums-thumbs"];

// значок альбома — фиолетовый фотоаппарат с тонким белым кантом (правило значков Atlas)
function cameraImage() {
  const s = 64, c = Object.assign(document.createElement("canvas"), { width: s, height: s }).getContext("2d");
  c.translate(6, 6);
  c.scale(52 / 24, 52 / 24);
  const path = new Path2D(CAMERA_D);
  c.lineWidth = 2.4;
  c.lineJoin = "round";
  c.strokeStyle = "#fff";
  c.stroke(path);
  c.fillStyle = COLOR;
  c.fill(path);
  return c.getImageData(0, 0, s, s);
}

function addLayers() {
  const map = ctx.map;
  if (!map.hasImage("album-camera")) map.addImage("album-camera", cameraImage(), { pixelRatio: 2 });
  for (const p of photos.values()) if (p.imgData && !map.hasImage(p.img)) map.addImage(p.img, p.imgData, { pixelRatio: 2 });
  if (!map.getSource("albums")) map.addSource("albums", { type: "geojson", data: albumData() });
  if (!map.getSource("albums-photos")) map.addSource("albums-photos", { type: "geojson", data: dotData(), cluster: true, clusterRadius: 18, clusterMaxZoom: 18 });
  if (!map.getSource("albums-thumbs")) map.addSource("albums-thumbs", { type: "geojson", data: thumbData() });
  if (!map.getLayer("albums-icons")) map.addLayer({ id: "albums-icons", type: "symbol", source: "albums", maxzoom: DOT_ZOOM,
    layout: { "icon-image": "album-camera", "icon-allow-overlap": true, "icon-ignore-placement": true } });
  if (!map.getLayer("albums-dots")) map.addLayer({ id: "albums-dots", type: "circle", source: "albums-photos", minzoom: DOT_ZOOM,
    paint: { "circle-color": COLOR, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5,
      "circle-radius": ["case", ["has", "point_count"], ["step", ["get", "point_count"], 9, 10, 11, 100, 13, 1000, 15], 4] } });
  if (!map.getLayer("albums-count")) map.addLayer({ id: "albums-count", type: "symbol", source: "albums-photos", minzoom: DOT_ZOOM, filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": font(map), "text-size": 11, "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#fff" } });
  if (!map.getLayer("albums-thumbs")) map.addLayer({ id: "albums-thumbs", type: "symbol", source: "albums-thumbs", minzoom: THUMB_ZOOM,
    layout: { "icon-image": ["get", "img"], "icon-padding": 4 } });
  claimLayers(...LAYERS);
}

// карта, лента и открытые списки — по ходу обхода, не чаще раза за кадр
function refresh() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    if (shown && ctx) {
      ctx.map.getSource("albums")?.setData(albumData());
      ctx.map.getSource("albums-photos")?.setData(dotData());
      ctx.map.getSource("albums-thumbs")?.setData(thumbData());
      setStripItems("albums", located().filter((p) => p.thumb).map(stripItem));
    }
    if (isOpen("albums") && !openAlbum && !searchText) renderList(currentCountry);
  });
}
const stripItem = (p) => ({ id: p.id, coordinates: pt(p), thumb: p.thumb, title: [p.album.title, photoDate(p)].filter(Boolean).join(" · "),
  full: p.url, credit: photoDate(p), select: () => showPhoto(p), gallery: () => gallery(p.album, p.id) });

function showOnMap(on) {
  if (shown === on || !ctx) return;
  shown = on;
  const map = ctx.map;
  if (on) { addLayers(); refresh(); wantInView(); return; }
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of ["albums", "albums-photos", "albums-thumbs"]) if (map.getSource(id)) map.removeSource(id);
  setStripItems("albums", []);
}

// окно снимка на карте
function showPhoto(p) {
  if (!p.rec?.lat) return;
  const box = h("div", "");
  const img = Object.assign(document.createElement("img"), { className: "popup-photo", alt: "", src: p.thumb || "" });
  img.style.height = "200px";
  img.style.objectFit = "cover";
  img.style.cursor = "zoom-in";
  img.title = "Альбом в галерее с этого снимка";
  img.addEventListener("click", () => gallery(p.album, p.id));
  fullOf(p).then((u) => { img.src = u; }).catch(() => {});
  box.append(img, h("div", "popup-row", p.album.title), h("div", "popup-sub", [photoDate(p), p.name].filter(Boolean).join(" · ")),
    h("div", "popup-sub", "Щелчок по снимку — альбом в галерее"));
  track(new ctx.maplibregl.Popup({ offset: p.img && ctx.map.getZoom() >= THUMB_ZOOM ? 26 : 8, maxWidth: "300px" }))
    .setLngLat(pt(p)).setDOMContent(box).addTo(ctx.map).on("close", () => selectStripItem(null, p.id));
  if (p.thumb) selectStripItem(p.id);
}

function gallery(a, startId) {
  openGalleryWith(a.photos.map((id) => photos.get(id)).map((p) => ({ id: p.id, thumb: p.thumb, full: p.url,
    title: a.title, credit: [photoDate(p), p.name].filter(Boolean).join(" · "), coordinates: p.rec?.lat ? pt(p) : null })),
  startId || a.photos[0], media);
}

function fitAlbum(a) {
  const pts = a.photos.map((id) => photos.get(id)).filter((p) => p.rec?.lat).map(pt);
  if (!pts.length && !a.point) return;
  if (!pts.length) pts.push(a.point);
  const lng = pts.map((p) => p[0]), lat = pts.map((p) => p[1]);
  const phone = innerWidth <= 600;
  ctx.map.fitBounds([[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]],
    { padding: phone ? { top: innerHeight * 0.6, bottom: 110, left: 30, right: 30 } : { top: 80, bottom: 110, left: 440, right: 90 }, maxZoom: 16, duration: 2000 });
}

// ---------- панель ----------
const panel = createPanel({ id: "albums", title: "Мои альбомы", icon: svg(STACK_D, 18), side: "left" });
const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });
const btn = (icon, title, fn) => { const b = h("button", "pb-btn"); b.innerHTML = icon; b.title = title; b.addEventListener("click", fn); return b; };
let currentCountry = null, openAlbum = null, searchText = "";

// миниатюра, которая сама просит картинку, когда видна
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    seen.unobserve(e.target);
    const p = photos.get(e.target.dataset.photo);
    if (p) thumbOf(p).then((src) => { if (src) e.target.src = src; });
  }
}, { rootMargin: "200px" });
function lazyImg(p, cls) {
  const img = Object.assign(document.createElement("img"), { className: cls, alt: "" });
  if (!p) return img;
  img.dataset.photo = p.id;
  if (p.thumb) img.src = p.thumb; else seen.observe(img);
  return img;
}

function albumRow(a) {
  const r = h("button", "tr-row al-row");
  const text = h("span", "tr-row-text");
  text.append(h("span", "tr-row-title", a.title), h("span", "tr-row-sub", [`${a.photos.length} фото`, dates(a)].filter(Boolean).join(" · ")));
  r.append(lazyImg(photos.get(a.cover || a.photos[0]), "al-cover"), text);
  r.addEventListener("click", () => openAlbumById(a.id));
  return r;
}

function accessRow() {
  const b = h("button", "text-btn al-access", `Открыть мою папку «${dir.name}»`);
  b.addEventListener("click", askAccess);
  return b;
}

function renderList(country, query = "") {
  openAlbum = null;
  currentCountry = country ?? currentCountry;
  searchText = query;
  const q = query.toLowerCase();
  const list = [...albums.values()].filter((a) => (q ? [a.title, a.name, a.id, countryOf(a)].join(" ").toLowerCase().includes(q) : countryOf(a) === currentCountry))
    .sort((x, y) => (y.from || 0) - (x.from || 0) || x.title.localeCompare(y.title, "ru"));
  panel.setTitle(q ? "Найденные альбомы" : currentCountry || "Мои альбомы");
  const nodes = [];
  if (needsAccess && dir) nodes.push(accessRow());
  if (busy) nodes.push(h("p", "pb-hint", `Читаю снимки… проверено ${checked}`));
  if (q && !list.length) nodes.push(h("p", "pb-hint", "Ничего не нашлось"));
  nodes.push(...list.map(albumRow));
  const keep = panel.body.scrollTop;
  panel.body.replaceChildren(...nodes);
  panel.body.scrollTop = keep;
}

function renderAlbum() {
  const a = openAlbum;
  panel.setTitle(a.title);
  const bar = h("div", "pb-bar");
  const left = h("div", "tr-bar-left");
  left.append(btn(BACK, `К альбомам: ${countryOf(a)}`, () => { renderList(countryOf(a)); panel.body.scrollTop = 0; }),
    btn(PLAYER.play, "Смотреть альбом в галерее", () => gallery(a)));
  bar.append(left);
  const facts = h("div", "tr-facts al-facts", [`${a.photos.length} фото`, dates(a), a.country?.name, a.local ? "на этом компьютере" : ""].filter(Boolean).join(" · "));
  const grid = h("div", "al-grid");
  for (const id of a.photos) {
    const p = photos.get(id);
    const cell = h("button", "al-cell");
    cell.title = [photoDate(p), p.name].filter(Boolean).join(" · ");
    cell.append(lazyImg(p, ""));
    if (!p.rec?.lat) cell.classList.add("no-place");
    // щелчок — снимок на карте (если у него есть место), двойной — галерея с него
    cell.addEventListener("click", () => {
      if (!p.rec?.lat) { gallery(a, id); return; }
      ctx.map.flyTo({ center: pt(p), zoom: Math.max(ctx.map.getZoom(), 15), offset: innerWidth <= 600 ? [0, Math.round(innerHeight * 0.22)] : [210, 0], duration: 1500 });
      ctx.map.once("moveend", () => showPhoto(p));
    });
    cell.addEventListener("dblclick", () => gallery(a, id));
    grid.append(cell);
  }
  panel.body.replaceChildren(bar, facts, grid);
  panel.body.scrollTop = 0;
}

function openAlbumById(id) {
  const a = albums.get(id);
  if (!a) return;
  openAlbum = a;
  renderAlbum();
  fitAlbum(a);
  if (!a.done) finish(a).then(() => { refresh(); if (openAlbum === a) renderAlbum(); });
}

// ---------- своя папка (настройки) ----------
async function pickFolder(render) {
  let handle;
  try { handle = await window.showDirectoryPicker({ id: "atlas-albums", mode: "read" }); } catch { return; }
  await cacheSet("albums/dir", handle).catch(() => {});
  dir = handle;
  needsAccess = false;
  loading = Promise.resolve();
  await rescan();
  render?.();
}
async function forgetFolder(render) {
  await cacheDelete("albums/dir").catch(() => {});
  dir = null;
  needsAccess = false;
  await rescan();
  render?.();
}
// после перезапуска браузер даёт доступ к папке только по нажатию
async function askAccess() {
  if (!dir || await dir.requestPermission({ mode: "read" }).catch(() => "denied") !== "granted") return;
  needsAccess = false;
  await rescan();
}

function settingsSection(c, render) {
  if (!canFolders()) return null;
  ctx ??= c;
  const box = h("div", "");
  box.append(h("p", "set-hint", "Снимки с этого компьютера: альбом — каждая папка со снимками. Снимки никуда не отправляются, программа помнит только, какую папку вы выбрали."));
  const row = h("div", "set-row");
  row.append(h("span", "al-folder", dir ? `Папка: ${dir.name}` : "Папка не выбрана"));
  const pick = h("button", "text-btn", dir ? "Выбрать другую…" : "Выбрать папку…");
  pick.addEventListener("click", () => pickFolder(render));
  row.append(pick);
  if (dir) {
    const forget = h("button", "text-btn", "Убрать");
    forget.addEventListener("click", () => forgetFolder(render));
    row.append(forget);
  }
  box.append(row);
  if (dir && needsAccess) {
    const open = h("button", "text-btn", "Открыть доступ к папке");
    open.addEventListener("click", async () => { await askAccess(); render?.(); });
    box.append(open);
  }
  if (albums.size) box.append(h("p", "set-hint", `Альбомов: ${albums.size}, снимков с местом: ${located().length}${busy ? " — читаю снимки…" : ""}`));
  return box;
}
// выбранная папка видна в настройках сразу, ещё до первого открытия раздела
if (canFolders()) cacheGet("albums/dir").then((d) => { if (d && !dir) dir = d; }).catch(() => {});

// ---------- режим в строке поиска ----------
const MODE = { icon: svg(STACK_D, 20), title: "Мои альбомы", placeholder: "Найти альбом", tone: "my",
  filter: (text) => { if (text) renderList(null, text); else if (openAlbum) renderAlbum(); else renderList(currentCountry); },
  exit: () => panel.close() };

function openCountry(country) {
  renderList(country);
  panel.body.scrollTop = 0;
  panel.open();
  setSearchMode(MODE);
  showOnMap(true);
  emit("module", { id: "content/albums", on: true });
}

panel.onClose(() => {
  openAlbum = null;
  currentCountry = null;
  searchText = "";
  showOnMap(false);
  if (searchMode() === MODE) setSearchMode(null);
  emit("module", { id: "content/albums", on: false });
});

let wired = false;
function wire() {
  if (wired || !ctx) return;
  wired = true;
  const map = ctx.map;
  map.on("style.load", () => { if (shown) { addLayers(); refresh(); } });
  map.on("moveend", wantInView);
  map.on("click", (e) => {
    if (!shown) return;
    const f = map.queryRenderedFeatures(e.point, { layers: LAYERS.filter((id) => map.getLayer(id)) })[0];
    if (!f) return;
    if (f.properties.album) { const a = albums.get(f.properties.album); if (a) { renderList(countryOf(a)); openAlbumById(a.id); } return; }
    if (f.properties.cluster) {
      map.getSource("albums-photos").getClusterExpansionZoom(f.properties.cluster_id)
        .then((zoom) => map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom, 19) })).catch(() => {});
      return;
    }
    const p = photos.get(f.properties.photo);
    if (p) showPhoto(p);
  });
  // двойной щелчок по снимку — его альбом в галерее, карта не приближается
  map.on("dblclick", (e) => {
    const f = shown && map.queryRenderedFeatures(e.point, { layers: ["albums-thumbs", "albums-dots"].filter((id) => map.getLayer(id)) })[0];
    const p = f && photos.get(f.properties.photo);
    if (!p) return;
    e.preventDefault();
    gallery(p.album, p.id);
  });
}

register({
  id: "content/albums",
  kind: "content",
  title: "Мои альбомы",
  tone: "my",
  hint: "Свои снимки по альбомам: на карте, в ленте и в галерее",
  icon: ICON,
  sends: "чтение альбомов папки «Альбомы» (GitHub, сайт travel-earth), флаги (flagcdn); снимки с компьютера никуда не уходят",
  column: {
    load: (c) => { ctx = c; wire(); return load(c); },
    items: () => {
      const list = countries().map(([name, n]) => ({ id: name, title: `${name} (${n})`, thumb: flagUrl(isoOf(name)) || "",
        icon: isoOf(name) ? "" : ICON, selected: currentCountry === name && isOpen("albums") }));
      return list.length || !loading ? list : [{ id: "", title: busy ? "Читаю альбомы…" : "Альбомов пока нет", icon: ICON }];
    },
    choose: (country, c) => { if (!country) return; ctx = c; wire(); openCountry(country); },
    isOpen: () => isOpen("albums"),
    close: () => panel.close(),
  },
  settings: settingsSection,
  // для проверки
  stats: () => ({ albums: albums.size, photos: photos.size, located: located().length, thumbs: [...photos.values()].filter((p) => p.thumb).length,
    countries: countries().map(([n, k]) => `${n}:${k}`), busy, shown, open: openAlbum?.title || null, country: currentCountry }),
  openFirst: () => { const a = [...albums.values()][0]; if (!a) return false; openCountry(countryOf(a)); openAlbumById(a.id); return true; },
});

// Альбом 2 — альбомы своей папки, написанные заново (Грегори 2026-11-25: «В режиме альбомов ничего не происходит…
// Предлагаю на альбом сделать кнопку с нуля — Альбом 2»). «Мои альбомы» остаются как были.
// Только компьютер: папка со снимками (доступ к ней хранится в этом браузере, снимки никуда не уходят), каждая
// подпапка со снимками — альбом. Всё, что делает чтение, видно сразу: строка папки считает папки и снимки,
// альбомы появляются в списке по одному, ошибка — словами в строке папки (нажать — повторить). Строки не
// перерисовываются, а дописываются, — нажатие (крестик «Убрать папку») не теряется посреди чтения.
// Потом в фоне — место и дата альбома из EXIF первых снимков; альбом с местом — фиолетовой точкой на карте,
// щелчок по ней — альбом. Альбом — сетка снимков (миниатюры по мере прокрутки), щелчок — общая галерея.
// Открыт альбом — на карте только он (Грегори 2026-11-25: «после выбора альбома на карте оставался только один альбом
// со всеми фотками»): точки всех его снимков с местом (место читается у всех, по ходу), вблизи — миниатюры; щелчок —
// галерея с этого снимка. Раздел — режимом строки поиска, как «Мои альбомы»: значок на кнопке, «Найти альбом»
import { register } from "../core/modules.js";
import { createPanel, isOpen } from "../core/panel.js";
import { FOLDER_ADD_D } from "../core/icons.js";
import { emit } from "../core/events.js";
import { setSearchMode, searchMode } from "../core/search.js";
import { cacheGet, cacheSet } from "../core/storage.js";
import { claimLayers } from "../core/popups.js";
import { openGalleryWith } from "../core/photo-strip.js";
import { HEIC_RE, heicBitmap, heicViewable } from "../core/heic.js";

const svg = (d, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`;
const STACK_D = "M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4 2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z";
const ICON = svg(STACK_D);
const FOLDER_ICON = svg("M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z");
const BACK = svg("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z", 20);
const PLAY = svg("M8 5v14l11-7z", 20);
const X_ICON = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const COLOR = "#7c4dff"; // --tone-my
const VIDEO_RE = /\.(mov|mp4|m4v)$/i;
const MEDIA_RE = /\.(jpe?g|webp|png|heic|heif|mov|mp4|m4v)$/i;
const PROBE = 12; // сколько первых снимков альбома читать в поисках места
const THUMB = 240, PIN = 56, THUMB_ZOOM = 14; // миниатюра сетки; на карте — 28 px в белой рамке, с 14-го приближения
const KEY = "albums2/dirs";

// название напоказ — без даты-префикса и скобок (как в «Моих альбомах»; сама папка не меняется)
const displayName = (name) => name.replace(/^(?:\d+[\s_-]+)+/, "").replace(/\s*\([^()]*\)/g, "").replace(/\s{2,}/g, " ").trim() || name;
const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });
const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;

// ---------- данные ----------
let ctx = null, wired = false, scan = 0, started = false;
let dirs = []; // [{ handle, state: "need" | "read" | "done" | "error", dirs, files, bad, albums, err, row }]
const albums = []; // { id, title, root, files: [{ name, handle, video, thumb }], point, date, row }

const panel = createPanel({ id: "albums2", title: "Альбом 2", icon: svg(STACK_D, 18), side: "left" });
// «Добавить папку…» — значком в шапке, а не строкой (Грегори 2026-11-26); в открытом альбоме не нужен
const addBtn = panel.addButton(svg(FOLDER_ADD_D), "Добавить папку…", () => addFolder());
addBtn.hidden = !("showDirectoryPicker" in window);
const list = h("div", "home-list a2-list");
let openAlbum = null, query = "";

// ---------- папки ----------
const saveDirs = () => cacheSet(KEY, dirs.map((d) => d.handle)).catch(() => {});
async function loadDirs() {
  const saved = await cacheGet(KEY).catch(() => null);
  dirs = (Array.isArray(saved) ? saved : []).map((handle) => ({ handle, state: "need", dirs: 0, files: 0, bad: 0, albums: 0, err: "" }));
}
const granted = async (d) => (await d.handle.queryPermission({ mode: "read" }).catch(() => "denied")) === "granted";

async function addFolder() {
  let handle;
  try { handle = await window.showDirectoryPicker({ id: "atlas-albums2", mode: "read" }); } catch { return; }
  for (const d of dirs) if (await d.handle.isSameEntry(handle).catch(() => false)) return;
  dirs.push({ handle, state: "read", dirs: 0, files: 0, bad: 0, albums: 0, err: "" });
  await saveDirs();
  readAll();
}
function removeFolder(d) {
  if (!confirm(`Убрать папку «${d.handle.name}» из «Альбома 2»? Снимки на диске останутся.`)) return;
  dirs = dirs.filter((x) => x !== d);
  saveDirs();
  readAll();
}
// после перезапуска браузер даёт доступ к папке только по нажатию
async function openAccess(d) {
  if ((await d.handle.requestPermission({ mode: "read" }).catch(() => "denied")) !== "granted") { d.err = "доступ не дан"; d.state = "error"; paintDir(d); return; }
  readAll();
}

// строка папки: что нашлось — словами; текст меняется на месте, строка та же
function dirText(d) {
  const name = d.handle.name;
  if (d.state === "need") return `Открыть папку «${name}»`;
  if (d.state === "error") return `${name} — не читается (${d.err}) — повторить`;
  const bad = d.bad ? `, не открылось папок ${d.bad}` : "";
  if (d.state === "read") return `${name} — читаю… папок ${d.dirs}, снимков ${d.files}${bad}`;
  return d.files ? `${name} — альбомов ${d.albums}, снимков ${d.files}${bad}` : `${name} — снимков не найдено (папок ${d.dirs}${bad})`;
}
const paintDir = (d) => { if (d.row) d.row.querySelector(".tr-row-title").textContent = dirText(d); };

// ---------- чтение: альбом — каждая папка со снимками ----------
async function walk(handle, path, d, token) {
  const files = [], sub = [];
  try {
    for await (const [name, x] of handle.entries()) {
      if (x.kind === "directory") { if (!/^[._[]/.test(name)) sub.push([name, x]); }
      else if (MEDIA_RE.test(name)) files.push({ name, handle: x, video: VIDEO_RE.test(name), thumb: "" });
    }
  } catch (e) {
    if (handle === d.handle) throw e;
    d.bad++;
    paintDir(d);
    return;
  }
  if (token !== scan) return;
  d.dirs++;
  d.files += files.length;
  paintDir(d);
  if (files.length) {
    files.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
    const a = { id: albums.length, path, title: displayName(handle.name), root: d, files, point: null, date: 0, row: null };
    albums.push(a);
    d.albums++;
    addAlbumRow(a);
  }
  for (const [name, x] of sub.sort((p, q) => p[0].localeCompare(q[0], undefined, { numeric: true }))) {
    await walk(x, `${path}/${name}`, d, token);
    if (token !== scan) return;
  }
}

async function readAll() {
  const token = ++scan;
  started = true;
  albums.length = 0;
  openAlbum = null;
  for (const d of dirs) Object.assign(d, { state: (await granted(d)) ? "read" : "need", dirs: 0, files: 0, bad: 0, albums: 0, err: "" });
  if (token !== scan) return;
  renderList();
  for (const d of dirs.filter((x) => x.state === "read")) {
    try { await walk(d.handle, d.handle.name, d, token); d.state = "done"; } catch (e) { d.state = "error"; d.err = e?.name || String(e); }
    if (token !== scan) return;
    paintDir(d);
  }
  refreshEmpty();
  // место и дата — в фоне, альбом за альбомом
  for (const a of [...albums]) {
    if (token !== scan) return;
    await locate(a);
    paintAlbum(a);
    drawMap();
  }
}

// ---------- EXIF: место и дата, помнятся на устройстве ----------
let exifrLoad = null;
const exifr = () => (exifrLoad ??= Promise.race([
  import("https://unpkg.com/exifr@7.1.3/dist/full.esm.mjs").catch(() => import("https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs")),
  new Promise((_, no) => setTimeout(() => no(new Error("exifr")), 20000))]).then((m) => m.default || m).catch((err) => { exifrLoad = null; throw err; }));
const OPTS = { tiff: true, exif: true, gps: true, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false, translateValues: false };

async function exifOf(f) {
  const file = await f.handle.getFile();
  const key = `exif2/${file.name}|${file.size}|${file.lastModified}`;
  const hit = await cacheGet(key).catch(() => null);
  if (hit) return hit;
  const lib = await exifr();
  const t = await lib.parse(file, OPTS).catch(() => null);
  const rec = {};
  const date = t?.DateTimeOriginal || t?.CreateDate;
  if (date instanceof Date && !isNaN(date)) rec.date = date.getTime();
  if (Number.isFinite(t?.latitude) && Number.isFinite(t?.longitude) && (t.latitude || t.longitude)) { rec.lat = t.latitude; rec.lon = t.longitude; }
  cacheSet(key, rec).catch(() => {});
  return rec;
}
async function locate(a) {
  for (const f of a.files.filter((x) => !x.video).slice(0, PROBE)) {
    const r = (f.rec ??= await exifOf(f).catch(() => ({})));
    if (r.date && !a.date) a.date = r.date;
    if (r.lat) { a.point = [r.lon, r.lat]; if (r.date) a.date = r.date; return; }
  }
}

// ---------- список ----------
function renderList() {
  const was = openAlbum;
  openAlbum = null;
  if (was) { seen?.disconnect(); drawMap(); }
  panel.setTitle("Альбом 2");
  list.replaceChildren();
  addBtn.hidden = !("showDirectoryPicker" in window);
  for (const d of dirs) {
    d.row = row(FOLDER_ICON, dirText(d), "Своя папка со снимками", () => {
      if (d.state === "need") openAccess(d);
      else if (d.state === "error") readAll();
    });
    const line = h("div", "home-line");
    const x = Object.assign(h("button", "search-delete"), { type: "button", title: `Убрать папку «${d.handle.name}»`, innerHTML: X_ICON });
    x.addEventListener("click", (e) => { e.stopPropagation(); removeFolder(d); });
    line.append(d.row, x);
    list.append(line);
  }
  for (const a of albums) addAlbumRow(a);
  paintEmpty();
  panel.body.replaceChildren(list);
}
function row(icon, title, hint, fn) {
  const r = Object.assign(h("button", "tr-row home-row"), { type: "button", title: hint || "" });
  r.innerHTML = `<span class="tr-row-text"><span class="tr-row-title"></span><span class="tr-row-sub"></span></span><i class="tr-icon">${icon}</i>`;
  r.querySelector(".tr-row-title").textContent = title;
  r.addEventListener("click", fn);
  return r;
}
function addAlbumRow(a) {
  if (openAlbum) return;
  list.querySelector(".a2-empty")?.remove();
  a.row = row(ICON, a.title, a.path, () => showAlbum(a));
  a.row.classList.add("a2-album");
  a.row.hidden = !matches(a);
  paintAlbum(a);
  list.append(a.row);
}
function paintAlbum(a) {
  if (!a.row) return;
  const when = a.date ? new Date(a.date).toLocaleDateString("ru", { month: "long", year: "numeric" }) : "";
  a.row.querySelector(".tr-row-sub").textContent = [plural(a.files.length, "снимок", "снимка", "снимков"), when, a.point ? "" : "без места"].filter(Boolean).join(" · ");
}
// строка поиска в режиме раздела — альбомы по названию
const matches = (a) => !query || a.title.toLowerCase().includes(query) || a.path.toLowerCase().includes(query);
function filter(text) {
  query = text.trim().toLowerCase();
  if (openAlbum && query) { renderList(); return; }
  for (const a of albums) if (a.row) a.row.hidden = !matches(a);
}
const MODE = { icon: svg(STACK_D, 20), title: "Альбом 2", placeholder: "Найти альбом", tone: "my", filter, exit: () => panel.close() };
// альбомов нет — сказать почему, а не молчать
function paintEmpty() {
  if (openAlbum || albums.length || list.querySelector(".a2-empty")) return;
  const reading = dirs.some((d) => d.state === "read");
  const text = !dirs.length ? "Добавьте папку со снимками — каждая её папка со снимками станет альбомом"
    : reading ? "Читаю папки…" : "Альбомов пока нет";
  list.append(h("p", "pb-hint a2-empty", text));
}
const refreshEmpty = () => { list.querySelector(".a2-empty")?.remove(); paintEmpty(); };

// ---------- альбом ----------
let seen = null;
function showAlbum(a) {
  openAlbum = a;
  panel.setTitle(a.title);
  addBtn.hidden = true;
  const head = h("div", "a2-head");
  const back = Object.assign(h("button", "pb-btn"), { type: "button", title: "Ко всем альбомам", innerHTML: BACK });
  back.addEventListener("click", () => { renderList(); refreshEmpty(); });
  const look = h("button", "text-btn", "Смотреть");
  look.addEventListener("click", () => gallery(a, 0));
  head.append(back, h("span", "a2-sub", a.row?.querySelector(".tr-row-sub").textContent || ""), look);
  const grid = h("div", "al-grid");
  seen?.disconnect();
  seen = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { seen.unobserve(e.target); want(a.files[e.target.dataset.n], e.target); }
  }, { root: panel.body, rootMargin: "200px" });
  a.files.forEach((f, n) => {
    const cell = Object.assign(h("button", "al-cell"), { type: "button", title: f.name });
    cell.dataset.n = n;
    if (f.thumb) cell.append(Object.assign(document.createElement("img"), { alt: "", src: f.thumb }));
    else seen.observe(cell);
    if (f.video) cell.insertAdjacentHTML("beforeend", `<i class="a2-play">${PLAY}</i>`);
    cell.addEventListener("click", () => gallery(a, n));
    grid.append(cell);
  });
  panel.body.replaceChildren(head, grid);
  panel.body.scrollTop = 0;
  if (a.point && ctx) ctx.map.flyTo({ center: a.point, zoom: Math.max(ctx.map.getZoom(), 11), duration: 1500 });
  drawMap();
  placeAll(a);
}

// место всех снимков открытого альбома — по ходу, точки появляются сразу; прочитано всё — карта на весь альбом
async function placeAll(a) {
  let n = 0;
  for (const f of a.files) {
    if (openAlbum !== a) return;
    if (f.video || f.rec) continue;
    f.rec = await exifOf(f).catch(() => ({}));
    if (++n % 10 === 0) drawMap();
  }
  if (openAlbum !== a) return;
  drawMap();
  const pts = a.files.filter((f) => f.rec?.lat).map((f) => [f.rec.lon, f.rec.lat]);
  if (!pts.length || !ctx) return;
  const lng = pts.map((p) => p[0]), lat = pts.map((p) => p[1]);
  const phone = innerWidth <= 600;
  ctx.map.fitBounds([[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]],
    { padding: phone ? { top: innerHeight * 0.55, bottom: 110, left: 30, right: 30 } : { top: 80, bottom: 110, left: 460, right: 90 }, maxZoom: 16, duration: 1500 });
  ctx.map.once("moveend", wantPins);
}

// миниатюры — по две за раз
const queue = [];
let working = 0;
function want(f, cell) {
  queue.push([f, cell]);
  pump();
}
async function pump() {
  while (working < 2 && queue.length) {
    const [f, cell] = queue.shift();
    working++;
    thumbOf(f).then((url) => { if (url && cell.isConnected) cell.prepend(Object.assign(document.createElement("img"), { alt: "", src: url })); })
      .catch(() => {}).finally(() => { working--; pump(); });
  }
}
async function thumbOf(f) {
  if (f.thumb) return f.thumb;
  const file = await f.handle.getFile();
  let bmp;
  if (f.video) bmp = await frameOf(file);
  else bmp = HEIC_RE.test(f.name) ? await heicBitmap(file, { resizeWidth: THUMB, resizeQuality: "medium" }) : await createImageBitmap(file, { resizeWidth: THUMB, resizeQuality: "medium" });
  if (!bmp) return "";
  const c = Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
  c.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
  return (f.thumb = blob ? URL.createObjectURL(blob) : "");
}
// кадр ролика — на 0,1 с; браузер не умеет этот ролик — без кадра (только значок ▶)
function frameOf(file) {
  return new Promise((resolve) => {
    const v = Object.assign(document.createElement("video"), { muted: true, preload: "auto" });
    const url = URL.createObjectURL(file);
    const done = (x) => { clearTimeout(t); URL.revokeObjectURL(url); v.removeAttribute("src"); resolve(x); };
    const t = setTimeout(() => done(null), 8000);
    v.addEventListener("loadedmetadata", () => { v.currentTime = Math.min(0.1, v.duration || 0); });
    v.addEventListener("seeked", () => {
      const k = THUMB / (v.videoWidth || THUMB);
      createImageBitmap(v, { resizeWidth: THUMB, resizeHeight: Math.max(1, Math.round((v.videoHeight || THUMB) * k)) }).then(done, () => done(null));
    });
    v.addEventListener("error", () => done(null));
    v.src = url;
  });
}

// ---------- галерея ----------
const fulls = new Map(); // "a2/3/7" → адрес снимка в памяти (последние несколько)
function gallery(a, start) {
  const items = a.files.map((f, n) => ({ id: `a2/${a.id}/${n}`, thumb: f.thumb, full: "", title: a.title, credit: f.name, coordinates: f.rec?.lat ? [f.rec.lon, f.rec.lat] : null, video: f.video }));
  openGalleryWith(items, items[start]?.id, media);
}
async function media(kind, id) {
  const [, ai, fi] = id.split("/");
  const f = albums[ai]?.files[fi];
  if (!f) return "";
  if (kind === "thumb") return thumbOf(f);
  if (kind !== "full") return "";
  if (fulls.has(id)) return fulls.get(id);
  let blob = await f.handle.getFile();
  if (HEIC_RE.test(f.name)) blob = await heicViewable(blob);
  const url = URL.createObjectURL(blob);
  fulls.set(id, url);
  if (fulls.size > 12) { const [k, u] = fulls.entries().next().value; URL.revokeObjectURL(u); fulls.delete(k); }
  return url;
}

// ---------- карта: альбом с местом — точка; открыт альбом — только его снимки ----------
let shown = false;
const LAYER = "albums2", PHOTOS = "albums2-photos", PINS = "albums2-pins";
const fc = (features) => ({ type: "FeatureCollection", features });
const point = (coordinates, properties) => ({ type: "Feature", geometry: { type: "Point", coordinates }, properties });
const albumData = () => fc(openAlbum ? [] : albums.filter((a) => a.point).map((a) => point(a.point, { a: a.id })));
const located = () => (openAlbum ? openAlbum.files.map((f, n) => [f, n]).filter(([f]) => f.rec?.lat) : []);
const photoData = () => fc(located().map(([f, n]) => point([f.rec.lon, f.rec.lat], { a: openAlbum.id, n, pin: f.pin || "" })));
let mapCount = { albums: 0, photos: 0 }; // для проверки: сколько точек сейчас на карте
function drawMap() {
  if (!shown || !ctx) return;
  const map = ctx.map, ad = albumData(), pd = photoData();
  mapCount = { albums: ad.features.length, photos: pd.features.length };
  if (!map.getSource(LAYER)) {
    map.addSource(LAYER, { type: "geojson", data: ad });
    map.addSource(PHOTOS, { type: "geojson", data: pd });
    map.addLayer({ id: LAYER, type: "circle", source: LAYER, paint: { "circle-radius": 8, "circle-color": COLOR, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.addLayer({ id: PHOTOS, type: "circle", source: PHOTOS, paint: { "circle-radius": 5, "circle-color": COLOR, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
    map.addLayer({ id: PINS, type: "symbol", source: PHOTOS, minzoom: THUMB_ZOOM, filter: ["!=", ["get", "pin"], ""], layout: { "icon-image": ["get", "pin"], "icon-padding": 2 } });
    claimLayers(LAYER, PHOTOS, PINS);
  } else {
    map.getSource(LAYER).setData(ad);
    map.getSource(PHOTOS).setData(pd);
  }
}
// миниатюры снимков в кадре — вблизи, ближние к центру первыми
let pinning = false;
async function wantPins() {
  if (pinning || !shown || !openAlbum || !ctx || ctx.map.getZoom() < THUMB_ZOOM - 0.5) return;
  pinning = true;
  const a = openAlbum, map = ctx.map, b = map.getBounds(), c = map.getCenter();
  const todo = located().map(([f]) => f).filter((f) => !f.pin && !f.video && b.contains([f.rec.lon, f.rec.lat]))
    .sort((x, y) => Math.hypot(x.rec.lon - c.lng, x.rec.lat - c.lat) - Math.hypot(y.rec.lon - c.lng, y.rec.lat - c.lat)).slice(0, 40);
  for (const [i, f] of todo.entries()) {
    if (openAlbum !== a || !shown) break;
    await pinOf(f).catch(() => {});
    if (i % 5 === 4) drawMap();
  }
  drawMap();
  pinning = false;
}
let pins = 0;
async function pinOf(f) {
  const url = await thumbOf(f);
  if (!url) return;
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = Object.assign(document.createElement("canvas"), { width: PIN, height: PIN }), x = c.getContext("2d");
  const k = Math.max((PIN - 6) / img.width, (PIN - 6) / img.height), w = img.width * k, hh = img.height * k;
  x.fillStyle = "#fff";
  x.fillRect(0, 0, PIN, PIN);
  x.save();
  x.beginPath();
  x.rect(3, 3, PIN - 6, PIN - 6);
  x.clip();
  x.drawImage(img, (PIN - w) / 2, (PIN - hh) / 2, w, hh);
  x.restore();
  const id = `a2pin-${++pins}`;
  ctx.map.addImage(id, x.getImageData(0, 0, PIN, PIN), { pixelRatio: 2 });
  f.pin = id;
}
function showOnMap(on) {
  if (!ctx || shown === on) return;
  shown = on;
  if (on) { drawMap(); return; }
  for (const id of [PINS, PHOTOS, LAYER]) if (ctx.map.getLayer(id)) ctx.map.removeLayer(id);
  for (const id of [PHOTOS, LAYER]) if (ctx.map.getSource(id)) ctx.map.removeSource(id);
}
function wire() {
  if (wired || !ctx) return;
  wired = true;
  const map = ctx.map;
  // новый стиль карты — без своих картинок: миниатюры заново
  map.on("style.load", () => { if (!shown) return; for (const a of albums) for (const f of a.files) f.pin = ""; drawMap(); wantPins(); });
  map.on("moveend", wantPins);
  map.on("click", (e) => {
    if (!shown || !map.getLayer(LAYER)) return;
    const f = map.queryRenderedFeatures(e.point, { layers: [PINS, PHOTOS, LAYER] })[0];
    const a = f && albums[f.properties.a];
    if (!a) return;
    if (f.properties.n !== undefined && openAlbum === a) { gallery(a, f.properties.n); return; }
    panel.open();
    showAlbum(a);
  });
}

panel.onClose(() => {
  showOnMap(false);
  if (searchMode() === MODE) setSearchMode(null);
  emit("module", { id: "content/albums2", on: false });
});

register({
  id: "content/albums2",
  kind: "content",
  title: "Альбом 2",
  tone: "my",
  hint: "Альбомы своей папки — новый раздел, сделанный заново",
  icon: ICON,
  needs: ["folders"],
  sends: "ничего: снимки читаются с компьютера; программа чтения мест в снимках (exifr) — с unpkg или jsdelivr",
  column: {
    home: async (c) => {
      ctx = c;
      wire();
      panel.open();
      setSearchMode(MODE);
      showOnMap(true);
      emit("module", { id: "content/albums2", on: true });
      if (started) { if (openAlbum) showAlbum(openAlbum); else renderList(); return; }
      started = true;
      await loadDirs();
      renderList();
      readAll();
    },
    items: () => [],
    choose: () => {},
    isOpen: () => isOpen("albums2"),
    close: () => panel.close(),
  },
  // для проверки
  stats: () => ({ dirs: dirs.map(dirText), albums: albums.map((a) => `${a.title}:${a.files.length}${a.point ? ":место" : ""}`), open: openAlbum?.title || null,
    map: shown ? { ...mapCount, pins: located().filter(([f]) => f.pin).length } : null }),
});

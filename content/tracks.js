// Мои треки (Грегори, 2026-10-30: «Sports Tracker и WOO Sports… ни одна программа не позволяет
// редактировать трек; записать маршрут на телефон и потом его оформить»). Трек пишет любая программа
// на телефоне (в фоне, чего сайт не может), сюда он приходит файлом GPX или KML — выбором файла в
// столбике кнопки или перетаскиванием на карту — и хранится только на этом устройстве.
// Шаг 1: открыть и посмотреть — линия на карте, длина, время в пути, скорость, набор и сброс высоты,
// график высоты и скорости (водишь по нему — по треку бегает точка), сохранить файлом GPX, удалить.
// Шаг 2 (Грегори, 2026-10-30: «забыл остановить и уехал на машине»): края на графике выбирают кусок —
// оставить только его или вырезать, «Назад»; наибольшая скорость и высота, вид занятия, отрезки по км.
// Шаг 3: убрать выбросы GPS, разрезать в точке графика, склеить с другим треком, дорисовать по карте.
// Дальше (ROADMAP): оформить — название, цвет, заметка, альбом, снимки на треке по времени
import { register } from "../core/modules.js";
import { createPanel, isOpen } from "../core/panel.js";
import { emit } from "../core/events.js";
import { setSearchMode, searchMode } from "../core/search.js";
import { cacheGet, cacheSet, cacheDelete } from "../core/storage.js";
import { claimLayers, captureClicks } from "../core/popups.js";
import * as settings from "../core/settings.js";

const svg = (d, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`;
// линия трека между двумя точками
const TRACK_D = "M6 3a3 3 0 0 0-1 5.83V12a4 4 0 0 0 4 4h6a2 2 0 0 1 2 2v.17A3 3 0 1 0 19 18a4 4 0 0 0-4-4H9a2 2 0 0 1-2-2V8.83A3 3 0 0 0 6 3zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm12 12a1 1 0 1 1 0 2 1 1 0 0 1 0-2z";
const ICON = svg(TRACK_D);
const ICON_SMALL = svg(TRACK_D, 18);
const OPEN_ICON = svg("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z");
const BACK = svg("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z", 20);
const SAVE = svg("M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z", 20);
const UNDO = svg("M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 12.5 10c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 10.53 17.15 8 12.5 8z", 20);
const DELETE = svg("M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z", 20);
// правка трека: линия с краями; оранжевое — выбранное, серое пунктиром — то, что уберётся
const toolIcon = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke-linecap="round">${inner}</svg>`;
const TRIM = toolIcon('<path d="M1.5 12h3M19.5 12h3" stroke="#9aa0a6" stroke-width="2" stroke-dasharray="1.5 2.5"/><path d="M6 12h12" stroke="#ff6d00" stroke-width="3"/><path d="M6 6v12M18 6v12" stroke="currentColor" stroke-width="2"/>');
const CUT = toolIcon('<path d="M1.5 12H6M18 12h4.5" stroke="#3949ab" stroke-width="3"/><path d="M6 6v12M18 6v12" stroke="currentColor" stroke-width="2"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5" stroke="#ff6d00" stroke-width="2.2"/>');
const ZOOM = toolIcon('<circle cx="10" cy="10" r="6" stroke="currentColor" stroke-width="2"/><path d="M14.5 14.5L20 20M7.5 10h5M10 7.5v5" stroke="currentColor" stroke-width="2"/>');
const WHOLE = toolIcon('<path d="M2 12h20M5 9l-3 3 3 3M19 9l3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>');
const SPIKES = toolIcon('<path d="M2 16l5-2 3-11 3 13 4-2 5 1" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="10" cy="4" r="2.6" fill="#e53935"/>');
const SPLIT = toolIcon('<path d="M2 12h7M15 12h7" stroke="#3949ab" stroke-width="3"/><path d="M12 4v16" stroke="#ff6d00" stroke-width="2" stroke-dasharray="2 2.5"/>');
const MERGE = toolIcon('<path d="M2 8h6l4 4M2 16h6l4-4h10" stroke="#3949ab" stroke-width="2.5" stroke-linejoin="round"/>');
const DRAW = toolIcon('<path d="M3 21l3.5-1 11-11-2.5-2.5-11 11L3 21z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 5.5l2.5-2.5 2.5 2.5L16.5 8" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>');
const COLOR = "#3949ab"; // --tone-track
const SEL_COLOR = "#ff6d00"; // выбранный кусок

// ---------- разбор файла ----------
// трек: { id, name, date, segs: [[[lon, lat, ele|null, t|null], …], …] } — куски записи (паузы) — отдельно
function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("файл не читается");
  const num = (el, tag) => { const x = el.getElementsByTagName(tag)[0]?.textContent; return x != null && x !== "" ? Number(x) : null; };
  const pt = (el) => {
    const t = el.getElementsByTagName("time")[0]?.textContent;
    return [Number(el.getAttribute("lon")), Number(el.getAttribute("lat")), num(el, "ele"), t ? Date.parse(t) : null];
  };
  const segs = [...doc.getElementsByTagName("trkseg")].map((s) => [...s.getElementsByTagName("trkpt")].map(pt));
  // маршрут (rte) — тоже линия, обычно без времени
  for (const r of doc.getElementsByTagName("rte")) segs.push([...r.getElementsByTagName("rtept")].map(pt));
  const name = doc.querySelector("metadata > name, trk > name, rte > name")?.textContent.trim() || "";
  const creator = doc.documentElement.getAttribute("creator") || "";
  return { name, segs, kind: kindFromFile(doc.querySelector("trk > type")?.textContent) || (/ski/i.test(creator) ? "ski" : null) };
}

function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("файл не читается");
  const segs = [];
  // gx:Track — точки со временем (так пишет Google)
  for (const tr of doc.getElementsByTagNameNS("*", "Track")) {
    const when = [...tr.getElementsByTagNameNS("*", "when")].map((w) => Date.parse(w.textContent));
    const coords = [...tr.getElementsByTagNameNS("*", "coord")].map((c) => c.textContent.trim().split(/\s+/).map(Number));
    segs.push(coords.map(([lon, lat, ele], i) => [lon, lat, Number.isFinite(ele) ? ele : null, when[i] || null]));
  }
  for (const ls of doc.getElementsByTagName("LineString")) {
    const c = ls.getElementsByTagName("coordinates")[0]?.textContent.trim() || "";
    segs.push(c.split(/\s+/).map((x) => x.split(",").map(Number)).map(([lon, lat, ele]) => [lon, lat, Number.isFinite(ele) ? ele : null, null]));
  }
  const name = doc.querySelector("Document > name, Placemark > name")?.textContent.trim() || "";
  return { name, segs };
}

function parseFile(name, text) {
  const t = /\.kml$/i.test(name) ? parseKml(text) : parseGpx(text);
  const segs = t.segs.map((s) => s.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).filter((s) => s.length > 1);
  if (!segs.length) throw new Error("в файле нет трека");
  const first = segs[0][0][3];
  return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: t.name || name.replace(/\.\w+$/, ""),
    file: name, date: first || null, kind: t.kind || null, segs };
}

// ---------- подсчёт ----------
const R = 6371008.8;
function meters(a, b) {
  const rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
const MOVING = 0.3; // м/с — медленнее считается стоянкой (около 1 км/ч)
const PAUSE = 5 * 60 * 1000; // перерыв в записи дольше 5 минут — не время в пути
// путь между точками — с перепадом высот (Грегори, 2026-11-02: «при расчётах скорости учитывать перепад
// высот, особенно на горных лыжах — использовать как универсальный»): по склону путь длиннее, чем по
// карте; на его лыжных днях +3–5 % расстояния и +1–2 км/ч наибольшей скорости, на кайте по воде — почти
// ничего. Высота сглажена по 5 соседним точкам, иначе дрожание высоты GPS прибавляет путь на ровном месте
function smoothEle(seg) {
  // окно поровну с обеих сторон (у концов — уже), чтобы ровный склон не сглаживался в пологий
  return seg.map((_, i) => {
    const k = Math.min(2, i, seg.length - 1 - i);
    const w = seg.slice(i - k, i + k + 1).map((p) => p[2]).filter((e) => e != null);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
}
const along = (a, b, ea, eb) => (ea != null && eb != null ? Math.hypot(meters(a, b), eb - ea) : meters(a, b));

// м — высота меняется хотя бы на столько, иначе это шум GPS (4 м — набор как у Sports Tracker)
const CLIMB = 4;
function climb(eles) {
  let ref = null, up = 0, down = 0;
  for (const e of eles) {
    if (e == null) continue;
    if (ref == null) ref = e;
    else if (e - ref >= CLIMB) { up += e - ref; ref = e; }
    else if (ref - e >= CLIMB) { down += ref - e; ref = e; }
  }
  return [up, down];
}
function stats(t) {
  let dist = 0, moving = 0, up = 0, down = 0, maxEle = -Infinity, minEle = Infinity, maxSpeed = 0;
  const profile = []; // [расстояние от начала, высота, скорость км/ч, точка]
  for (const seg of t.segs) {
    const [u, d] = climb(seg.map((p) => p[2]));
    up += u;
    down += d;
    const se = smoothEle(seg);
    seg.forEach((p, i) => {
      let speed = null;
      if (i) {
        const q = seg[i - 1], d = along(q, p, se[i - 1], se[i]);
        dist += d;
        if (p[3] && q[3]) {
          const dt = p[3] - q[3];
          if (dt > 0 && dt < PAUSE && d / (dt / 1000) > MOVING) moving += dt;
          if (dt > 0) speed = (d / (dt / 1000)) * 3.6;
        }
      }
      if (p[2] != null) {
        maxEle = Math.max(maxEle, p[2]);
        minEle = Math.min(minEle, p[2]);
      }
      profile.push([dist, p[2], speed, p]);
    });
  }
  // скорость на графике — сглаженная (среднее по соседним 7 точкам): у GPS скачки
  const sm = profile.map((x, i) => {
    const w = profile.slice(Math.max(0, i - 3), i + 4).map((y) => y[2]).filter((v) => v != null);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
  profile.forEach((x, i) => { x[2] = sm[i]; if (sm[i] != null) maxSpeed = Math.max(maxSpeed, sm[i]); });
  const all = t.segs.flat(), times = all.map((p) => p[3]).filter(Boolean);
  const total = times.length > 1 ? times[times.length - 1] - times[0] : 0;
  return { dist, total, moving, up, down, maxSpeed, points: all.length,
    maxEle: Number.isFinite(maxEle) ? maxEle : null, minEle: Number.isFinite(minEle) ? minEle : null, profile };
}

const dec = (v, n) => v.toFixed(n).replace(".", ","); // по-русски — запятая
const km = (m) => (m >= 10000 ? `${dec(m / 1000, 1)} км` : m >= 1000 ? `${dec(m / 1000, 2)} км` : `${Math.round(m)} м`);
const hm = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, "0")} мин` : `${m} мин`; };
const day = (t) => (t ? new Date(t).toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric" }) : "");
const clock = (t) => (t ? new Date(t).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }) : "");

// ---------- хранение: только на устройстве ----------
let index = []; // [{ id, name, date, dist }] — список без точек
const tracks = new Map(); // id → трек с точками (прочитанные)
let ctx = null, loading = null;
const saveIndex = () => cacheSet("tracks/index", index).catch(() => {});
async function getTrack(id) {
  if (!tracks.has(id)) { const t = await cacheGet(`tracks/${id}`).catch(() => null); if (t) tracks.set(id, t); }
  return tracks.get(id) || null;
}
const load = () => (loading ??= cacheGet("tracks/index").then((x) => { index = x || []; }).catch(() => {}));

async function addFiles(files) {
  await load();
  const added = [];
  for (const f of files) {
    if (!/\.(gpx|kml)$/i.test(f.name)) { ctx?.status(`«${f.name}» — не трек (нужен файл GPX или KML)`); continue; }
    try {
      const t = parseFile(f.name, await f.text());
      tracks.set(t.id, t);
      await cacheSet(`tracks/${t.id}`, t);
      index.push({ id: t.id, name: t.name, date: t.date, dist: stats(t).dist, kind: t.kind });
      added.push(t);
    } catch (err) { ctx?.status(`«${f.name}»: ${err.message}`); }
  }
  if (!added.length) return;
  saveIndex();
  showOnMap(true);
  openTrack(added[added.length - 1].id);
  setTimeout(() => ctx?.status(""), 4000);
}

async function removeTrack(id) {
  index = index.filter((x) => x.id !== id);
  tracks.delete(id);
  saveIndex();
  await cacheDelete(`tracks/${id}`).catch(() => {});
  openId = null;
  draw();
  renderList();
}

function toGpx(t) {
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const pt = ([lon, lat, ele, time]) => `<trkpt lat="${lat}" lon="${lon}">${ele != null ? `<ele>${ele}</ele>` : ""}${time ? `<time>${new Date(time).toISOString()}</time>` : ""}</trkpt>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Atlas">`
    + `<metadata><name>${esc(t.name)}</name></metadata><trk><name>${esc(t.name)}</name>`
    + t.segs.map((s) => `<trkseg>${s.map(pt).join("")}</trkseg>`).join("") + "</trk></gpx>\n";
}
function download(t) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([toGpx(t)], { type: "application/gpx+xml" })),
    download: `${t.name.replace(/[\\/:*?"<>|]+/g, "_")}.gpx` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// выбор файла: на телефоне — системное окно файлов (туда Sports Tracker сохраняет выгрузку)
const input = Object.assign(document.createElement("input"), { type: "file", multiple: true, accept: ".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml", hidden: true });
input.addEventListener("change", () => { const files = [...input.files]; input.value = ""; addFiles(files); });
document.body.append(input);
// перетаскивание файла на карту
addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) e.preventDefault(); });
addEventListener("drop", (e) => {
  const files = [...(e.dataTransfer?.files || [])].filter((f) => /\.(gpx|kml)$/i.test(f.name));
  if (!files.length) return;
  e.preventDefault();
  if (!isOpen("tracks")) { panel.open(); setSearchMode(MODE); emit("module", { id: "content/tracks", on: true }); }
  addFiles(files);
});

// ---------- карта: все треки тонко, открытый — толще, начало и конец ----------
let shown = false, openId = null, hoverPt = null;
let selPiece = null; // выбранный на графике кусок открытого трека — на карте ярче
let spikePts = []; // выбросы GPS открытого трека — красные точки
let liftPieces = null; // подъёмники открытого трека (горные лыжи) — серым пунктиром
const fc = (features) => ({ type: "FeatureCollection", features });
const line = (t, open) => ({ type: "Feature", geometry: { type: "MultiLineString", coordinates: t.segs.map((s) => s.map((p) => [p[0], p[1]])) },
  properties: { id: t.id, open: open ? 1 : 0 } });
function lineData() {
  return fc(index.map((x) => tracks.get(x.id)).filter(Boolean).map((t) => line(t, t.id === openId)));
}
function endsData() {
  const t = openId && tracks.get(openId);
  if (!t) return fc([]);
  const all = t.segs.flat();
  const f = (p, kind) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p[0], p[1]] }, properties: { kind } });
  return fc([f(all[0], "start"), f(all[all.length - 1], "end"), ...spikePts.map((p) => f(p, "spike")), ...(hoverPt ? [f(hoverPt, "here")] : [])]);
}
const selData = () => fc(selPiece ? [{ type: "Feature", geometry: { type: "MultiLineString", coordinates: selPiece.map((s) => s.map((p) => [p[0], p[1]])) }, properties: {} }] : []);
const liftData = () => fc(liftPieces ? [{ type: "Feature", geometry: { type: "MultiLineString", coordinates: liftPieces.map((s) => s.map((p) => [p[0], p[1]])) }, properties: {} }] : []);
const LAYERS = ["tracks-casing", "tracks-line", "tracks-lift", "tracks-sel", "tracks-ends"];
function addLayers() {
  const map = ctx.map;
  if (!map.getSource("tracks")) map.addSource("tracks", { type: "geojson", data: lineData() });
  if (!map.getSource("tracks-ends")) map.addSource("tracks-ends", { type: "geojson", data: endsData() });
  if (!map.getSource("tracks-sel")) map.addSource("tracks-sel", { type: "geojson", data: selData() });
  if (!map.getSource("tracks-lift")) map.addSource("tracks-lift", { type: "geojson", data: liftData() });
  if (!map.getLayer("tracks-casing")) map.addLayer({ id: "tracks-casing", type: "line", source: "tracks", filter: ["==", ["get", "open"], 1],
    layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": 7 } });
  if (!map.getLayer("tracks-line")) map.addLayer({ id: "tracks-line", type: "line", source: "tracks",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": COLOR, "line-width": ["case", ["==", ["get", "open"], 1], 4, 2.5], "line-opacity": ["case", ["==", ["get", "open"], 1], 1, 0.55] } });
  if (!map.getLayer("tracks-lift")) map.addLayer({ id: "tracks-lift", type: "line", source: "tracks-lift",
    paint: { "line-color": "#fff", "line-width": 2.5, "line-dasharray": [2, 2] } });
  if (!map.getLayer("tracks-sel")) map.addLayer({ id: "tracks-sel", type: "line", source: "tracks-sel",
    layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": SEL_COLOR, "line-width": 5 } });
  // начало — зелёная точка, конец — красная, точка с графика — белая в цвет трека
  if (!map.getLayer("tracks-ends")) map.addLayer({ id: "tracks-ends", type: "circle", source: "tracks-ends",
    paint: { "circle-radius": ["match", ["get", "kind"], "here", 7, "spike", 5, 6],
      "circle-color": ["match", ["get", "kind"], "start", "#43a047", "end", "#e53935", "spike", "#e53935", "#fff"],
      "circle-stroke-color": ["match", ["get", "kind"], "here", COLOR, "#fff"], "circle-stroke-width": ["match", ["get", "kind"], "here", 3, 2] } });
  claimLayers("tracks-line");
}
function draw() {
  if (!shown || !ctx) return;
  ctx.map.getSource("tracks")?.setData(lineData());
  ctx.map.getSource("tracks-ends")?.setData(endsData());
  ctx.map.getSource("tracks-sel")?.setData(selData());
  ctx.map.getSource("tracks-lift")?.setData(liftData());
}
async function showOnMap(on) {
  if (!ctx) return;
  if (on) {
    await load();
    await Promise.all(index.map((x) => getTrack(x.id)));
    shown = true;
    addLayers();
    draw();
    return;
  }
  shown = false;
  for (const id of [...LAYERS].reverse()) if (ctx.map.getLayer(id)) ctx.map.removeLayer(id);
  for (const id of ["tracks", "tracks-ends", "tracks-sel", "tracks-lift"]) if (ctx.map.getSource(id)) ctx.map.removeSource(id);
}
function fit(t) {
  const all = t.segs.flat(), lng = all.map((p) => p[0]), lat = all.map((p) => p[1]);
  const phone = innerWidth <= 600;
  ctx.map.fitBounds([[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]],
    { padding: phone ? { top: innerHeight * 0.6, bottom: 110, left: 30, right: 30 } : { top: 80, bottom: 110, left: 440, right: 90 }, maxZoom: 16, duration: 1500 });
}

// ---------- панель ----------
const panel = createPanel({ id: "tracks", title: "Мои треки", icon: svg(TRACK_D, 18), side: "left" });
const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });
const btn = (icon, title, fn) => { const b = h("button", "pb-btn"); b.innerHTML = icon; b.title = title; b.addEventListener("click", fn); return b; };
let searchText = "";

function openButton() {
  const b = h("button", "text-btn tk-open", "Открыть файл трека…");
  b.title = "GPX или KML — выгрузка из Sports Tracker, Strava, часов. Можно просто перетащить файл на карту";
  b.addEventListener("click", () => input.click());
  return b;
}

function renderList(query = searchText) {
  stopDrawing();
  spikePts = [];
  liftPieces = null;
  openId = null;
  hoverPt = null;
  selPiece = null;
  searchText = query;
  draw();
  const q = query.toLowerCase();
  const list = index.filter((x) => !q || [x.name, day(x.date)].join(" ").toLowerCase().includes(q)).sort((a, b) => (b.date || 0) - (a.date || 0));
  panel.setTitle(q ? "Найденные треки" : "Мои треки");
  const nodes = [openButton()];
  if (!index.length) nodes.push(h("p", "pb-hint", "Треков пока нет. Выгрузите трек из программы на телефоне (Sports Tracker: тренировка → ⋯ → «Экспорт GPX») и откройте здесь или перетащите файл на карту. Треки хранятся только на этом устройстве."));
  else if (q && !list.length) nodes.push(h("p", "pb-hint", "Ничего не нашлось"));
  for (const x of list) {
    const r = h("button", "tr-row");
    const icon = h("span", "tr-icon tk-icon");
    icon.innerHTML = kindOf(x.kind) ? mdi(kindOf(x.kind)[2]) : svg(TRACK_D, 18);
    const text = h("span", "tr-row-text");
    text.append(h("span", "tr-row-title", x.name), h("span", "tr-row-sub", [kindOf(x.kind)?.[1], day(x.date), km(x.dist)].filter(Boolean).join(" · ")));
    r.append(icon, text);
    r.addEventListener("click", () => openTrack(x.id));
    nodes.push(r);
  }
  panel.body.replaceChildren(...nodes);
}

// ---------- правка: выбранный кусок, обрезать, вырезать, «Назад» ----------
// кусок — номера точек a..b по порядку записи (как в profile). Правка меняет segs; прежний вид — в истории
// («Назад», пока открыта страница), исходный трек из файла — в t.orig навсегда («Вернуть как в файле»)
const history = new Map(); // id → [{ segs, revert }, …] — revert: что ещё вернуть (разрезали — убрать второй трек)
function persist(t) {
  t.date = t.segs[0]?.[0]?.[3] || t.date;
  cacheSet(`tracks/${t.id}`, t).catch(() => {});
  const x = index.find((x) => x.id === t.id);
  if (x) Object.assign(x, { name: t.name, date: t.date, dist: stats(t).dist, kind: t.kind || null });
  saveIndex();
}
function edit(t, segs, revert = null) {
  if (!segs.length) return;
  if (!history.has(t.id)) history.set(t.id, []);
  history.get(t.id).push({ segs: t.segs, revert });
  t.orig ||= t.segs;
  t.segs = segs;
  persist(t);
}
// оставить точки, для которых keep(номер) — да; где точки убраны, трек распадается на куски записи
// (без прямой линии через вырезанное)
function pieces(t, keep) {
  let g = 0;
  const out = [];
  for (const s of t.segs) {
    let cur = [];
    for (const p of s) {
      if (keep(g++)) cur.push(p);
      else if (cur.length) { out.push(cur); cur = []; }
    }
    if (cur.length) out.push(cur);
  }
  return out.filter((s) => s.length > 1);
}

// выбросы GPS: точка отскочила в сторону и вернулась — крюк через неё намного длиннее прямой, и
// «скорость» до неё вдвое выше обычной быстрой скорости этого трека (на кайте и велосипеде крутые
// повороты — не выбросы: там скорость обычная)
function spikes(t) {
  const sp = [];
  for (const s of t.segs) for (let i = 1; i < s.length; i++) { const dt = (s[i][3] - s[i - 1][3]) / 1000; if (dt > 0) sp.push(meters(s[i - 1], s[i]) / dt); }
  sp.sort((a, b) => a - b);
  const fast = Math.max(5, sp[Math.floor(sp.length * 0.95)] || 0);
  const out = new Set();
  let g = 0;
  for (const s of t.segs) {
    s.forEach((p, i) => {
      const n = g++;
      if (!i || i === s.length - 1) return;
      const a = s[i - 1], b = s[i + 1], ap = meters(a, p), pb = meters(p, b), ab = meters(a, b);
      const dt = a[3] && p[3] ? (p[3] - a[3]) / 1000 : 0, v = dt > 0 ? ap / dt : null;
      if (ap + pb - ab > Math.max(30, 2 * ab) && Math.min(ap, pb) > 20 && (v == null ? Math.min(ap, pb) > 200 : v > 2 * fast)) out.add(n);
    });
  }
  return out;
}
// убрать отдельные точки, не разрывая трек
function without(t, drop) {
  let g = 0;
  return t.segs.map((s) => s.filter(() => !drop.has(g++))).filter((s) => s.length > 1);
}
// новый трек на устройство (разрезали) и обратно (склеили, «Назад»)
async function store(t) {
  tracks.set(t.id, t);
  await cacheSet(`tracks/${t.id}`, t).catch(() => {});
  if (!index.some((x) => x.id === t.id)) index.push({ id: t.id, name: t.name, date: t.date, dist: stats(t).dist, kind: t.kind || null });
  saveIndex();
}
function forget(id) {
  index = index.filter((x) => x.id !== id);
  tracks.delete(id);
  history.delete(id);
  saveIndex();
  cacheDelete(`tracks/${id}`).catch(() => {});
}
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// рисование по карте: щелчок — новая точка, прямой линией от ближнего к первому щелчку конца трека
let drawing = null; // { id, end: "start" | "end" }
function stopDrawing() {
  if (!drawing) return;
  drawing = null;
  captureClicks(null);
  if (ctx) ctx.map.getCanvas().style.cursor = "";
}
async function drawClick(e) {
  if (!drawing) return;
  const t = await getTrack(drawing.id);
  if (!t) return stopDrawing();
  const p = [e.lngLat.lng, e.lngLat.lat, null, null];
  const all = t.segs.flat();
  drawing.end ||= meters(p, all[0]) < meters(p, all[all.length - 1]) ? "start" : "end";
  const segs = t.segs.map((x) => [...x]);
  if (drawing.end === "end") segs[segs.length - 1].push(p); else segs[0].unshift(p);
  edit(t, segs);
  openTrack(t.id, true);
}

// вид активности: из файла (если программа его пишет) или выбрать самому. Значки — чёрно-белые
// (Грегори, 2026-11-02: «цветные — размазня»), Pictogrammers MDI (Apache 2.0)
const mdi = (d, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`;
const KINDS = [
  ["walk", "Прогулка", "M14.12,10H19V8.2H15.38L13.38,4.87C13.08,4.37 12.54,4.03 11.92,4.03C11.74,4.03 11.58,4.06 11.42,4.11L6,5.8V11H7.8V7.33L9.91,6.67L6,22H7.8L10.67,13.89L13,17V22H14.8V15.59L12.31,11.05L13.04,8.18M14,3.8C15,3.8 15.8,3 15.8,2C15.8,1 15,0.2 14,0.2C13,0.2 12.2,1 12.2,2C12.2,3 13,3.8 14,3.8Z"],
  ["hike", "Поход", "M17.47 8.67H19V23H17.47V12.6C16.67 12.44 15.92 12.14 15.21 11.71S13.9 10.78 13.39 10.2L12.77 13.27L15 15.47V23H13V17L10.76 14.8L8.89 23H6.73C6.73 23 9.86 7.22 9.89 7.09C10 6.61 10.22 6.24 10.59 6C10.96 5.73 11.33 5.6 11.71 5.6C12.1 5.6 12.46 5.69 12.79 5.87C13.13 6.04 13.39 6.29 13.58 6.61L14.64 8.24C14.93 8.78 15.32 9.25 15.81 9.63S16.86 10.3 17.47 10.5V8.67M8.55 5.89L7.4 5.65C6.83 5.5 6.31 5.62 5.84 5.94C5.38 6.26 5.1 6.7 5 7.28L4.19 11.26C4.16 11.55 4.22 11.81 4.38 12.05C4.54 12.29 4.75 12.42 5 12.46L7.21 12.89L8.55 5.89M13 1C11.9 1 11 1.9 11 3S11.9 5 13 5 15 4.11 15 3 14.11 1 13 1Z"],
  ["run", "Бег", "M13.5,5.5C14.59,5.5 15.5,4.58 15.5,3.5C15.5,2.38 14.59,1.5 13.5,1.5C12.39,1.5 11.5,2.38 11.5,3.5C11.5,4.58 12.39,5.5 13.5,5.5M9.89,19.38L10.89,15L13,17V23H15V15.5L12.89,13.5L13.5,10.5C14.79,12 16.79,13 19,13V11C17.09,11 15.5,10 14.69,8.58L13.69,7C13.29,6.38 12.69,6 12,6C11.69,6 11.5,6.08 11.19,6.08L6,8.28V13H8V9.58L9.79,8.88L8.19,17L3.29,16L2.89,18L9.89,19.38Z"],
  ["bike", "Велосипед", "M5,20.5A3.5,3.5 0 0,1 1.5,17A3.5,3.5 0 0,1 5,13.5A3.5,3.5 0 0,1 8.5,17A3.5,3.5 0 0,1 5,20.5M5,12A5,5 0 0,0 0,17A5,5 0 0,0 5,22A5,5 0 0,0 10,17A5,5 0 0,0 5,12M14.8,10H19V8.2H15.8L13.86,4.93C13.57,4.43 13,4.1 12.4,4.1C11.93,4.1 11.5,4.29 11.2,4.6L7.5,8.29C7.19,8.6 7,9 7,9.5C7,10.13 7.33,10.66 7.85,10.97L11.2,13V18H13V11.5L10.75,9.85L13.07,7.5M19,20.5A3.5,3.5 0 0,1 15.5,17A3.5,3.5 0 0,1 19,13.5A3.5,3.5 0 0,1 22.5,17A3.5,3.5 0 0,1 19,20.5M19,12A5,5 0 0,0 14,17A5,5 0 0,0 19,22A5,5 0 0,0 24,17A5,5 0 0,0 19,12M16,4.8C17,4.8 17.8,4 17.8,3C17.8,2 17,1.2 16,1.2C15,1.2 14.2,2 14.2,3C14.2,4 15,4.8 16,4.8Z"],
  ["kite", "Кайтсёрфинг", "M16.5 4.5L15.5 3.43L17.92 1H20L16.5 4.5M20.96 23C19.9 23 18.9 22.75 17.96 22.25C16.12 23.25 13.81 23.25 11.97 22.25C10.13 23.25 7.82 23.25 6 22.25C4.77 22.94 3.36 23.05 2 23V21C3.41 21.05 4.77 20.9 6 20C7.74 21.25 10.21 21.25 11.97 20C13.74 21.25 16.2 21.25 17.96 20C19.17 20.9 20.54 21.05 21.94 21V23H20.96M20.35 12.26C18.3 11.5 16.14 12.61 14.08 13.36L12.39 11.5H9.58V8C11.89 8.19 14.29 7.67 15.9 5.96L14.5 4.56C13.6 5.46 12.3 6 11 6H8C6.89 6 5.95 6.92 6 8C6.07 9.35 5.67 12.73 6.45 13.87L8 16.82C7.43 17.23 6.93 17.62 6.5 18C8.09 19.5 10.65 19.17 11.97 17.5C12.91 18.59 14.45 19.3 15.9 18.83C17.45 17.77 22.74 14 20.35 12.26M11.43 14.65C11 14.89 10.16 15.37 9.82 15.61L8.97 13.59L11.46 13.5L12.16 14.25L11.43 14.65M8 1C6.9 1 6 1.9 6 3S6.9 5 8 5 10 4.11 10 3 9.11 1 8 1Z"],
  ["surf", "Виндсёрфинг, сёрфинг, SUP", "M22 23V21C20.59 21.05 19.22 20.9 18 20C16.24 21.25 13.77 21.25 12 20C10.23 21.25 7.76 21.25 6 20C4.78 20.9 3.41 21.05 2 21V23C3.37 23.05 4.78 22.94 6 22.25C7.84 23.25 10.15 23.25 12 22.25C13.85 23.25 16.16 23.25 18 22.25C19.22 22.94 20.63 23.05 22 23M20.5 11.97V9.95C18.74 9.96 17 9 16.18 7.41L15.29 5.86C15 5.4 14.55 5.11 14.07 4.97L8.5 3.94L5 6.38L6.13 8L8.95 6.1L10.97 6.43L8.81 7.88C8.21 8.29 7.88 9 8 9.71L8.53 12.81C7.12 12.26 3.21 11 3 13.23C3.36 15.67 6.07 17.32 8.06 18.82C9.5 19.29 11.06 18.58 12 17.46C13.32 19.16 15.89 19.46 17.5 18C17.03 17.58 16.5 17.15 16 16.8V12.95L12.19 9.95L14.44 8.44C15.62 10.59 18 12 20.5 11.97M14 14V15.47C14 15.43 11.66 14.16 11.81 14.24L10.73 13.7L10.31 11.08L14 14M19 3.5C19 4.61 18.11 5.5 17 5.5S15 4.61 15 3.5 15.9 1.5 17 1.5 19 2.4 19 3.5Z"],
  ["xc", "Лыжи беговые", "M19 14H17.6V22H19V14M6.44 22H5L7 14H8.44L6.44 22M8.76 9.54V13H7V8.32L11.61 6.31C12.04 6.14 12.5 6.13 12.96 6.27S13.79 6.69 14.06 7.1L15 8.58C15.37 9.25 15.9 9.95 16.62 10.37C17.33 10.79 18.13 11 19 11V12.83C18 12.83 17 12.62 16.13 12.2S14.5 11.06 13.88 10.37L13.31 13.16L15.28 15V22H13.4V16.5L11.5 14.55L9.77 22H7.8L10.43 8.89L8.76 9.54M16 4C16 5.11 15.11 6 14 6S12 5.11 12 4 12.9 2 14 2 16 2.9 16 4Z"],
  ["ski", "Лыжи горные", "M17.92 13.32C17.67 13.28 16.71 13 16.46 12.89L14.39 19.37L11.3 18.24L13.5 12.47L10.45 9L13 7.54C13.45 8.67 14.17 9.62 15.12 10.4S17.16 11.67 18.38 11.86L19.5 8.43L18.06 7.96L17.54 9.56C16.88 9.28 16.3 8.86 15.8 8.32C15.3 7.77 14.94 7.13 14.72 6.41L14.39 5.33C14.27 4.93 14.04 4.61 13.71 4.37C13.38 4.14 13 4 12.63 3.97C12.24 3.94 11.86 4 11.5 4.21L8 6.23C7.63 6.44 7.36 6.74 7.19 7.12C7 7.5 6.96 7.88 7 8.29S7.26 9.06 7.54 9.37L11.11 13.08L9.42 17.54L2.47 15.05L2 16.46L16.04 21.58C16.82 21.86 17.65 22 18.53 22C19.15 22 19.76 21.92 20.36 21.77C20.95 21.61 21.5 21.39 22 21.11L20.87 20C20.12 20.33 19.34 20.5 18.53 20.5C17.87 20.5 17.21 20.39 16.55 20.17L15.8 19.89L17.92 13.32M19 3C19 4.11 18.11 5 17 5S15 4.11 15 3 15.9 1 17 1 19 1.9 19 3Z"],
  ["boat", "Лодка", "M3 13.5L11 2.03V13.5H3M12.5 13.5C13.85 9.75 13.67 4.71 12.5 1C17.26 2.54 20.9 8.4 20.96 13.5H12.5M21.1 17.08C20.69 17.72 20.21 18.27 19.65 18.74C19 18.45 18.42 18 17.96 17.5C16.47 19.43 13.46 19.43 11.97 17.5C10.5 19.43 7.47 19.43 6 17.5C5.5 18 4.95 18.45 4.3 18.74C3.16 17.8 2.3 16.46 2 15H21.94C21.78 15.75 21.5 16.44 21.1 17.08M20.96 23C19.9 23 18.9 22.75 17.96 22.25C16.12 23.25 13.81 23.25 11.97 22.25C10.13 23.25 7.82 23.25 6 22.25C4.77 22.94 3.36 23.05 2 23V21C3.41 21.05 4.77 20.9 6 20C7.74 21.25 10.21 21.25 11.97 20C13.74 21.25 16.2 21.25 17.96 20C19.17 20.9 20.54 21.05 21.94 21V23H20.96Z"],
  ["car", "Машина", "M5,11L6.5,6.5H17.5L19,11M17.5,16A1.5,1.5 0 0,1 16,14.5A1.5,1.5 0 0,1 17.5,13A1.5,1.5 0 0,1 19,14.5A1.5,1.5 0 0,1 17.5,16M6.5,16A1.5,1.5 0 0,1 5,14.5A1.5,1.5 0 0,1 6.5,13A1.5,1.5 0 0,1 8,14.5A1.5,1.5 0 0,1 6.5,16M18.92,6C18.72,5.42 18.16,5 17.5,5H6.5C5.84,5 5.28,5.42 5.08,6L3,12V20A1,1 0 0,0 4,21H5A1,1 0 0,0 6,20V19H18V20A1,1 0 0,0 19,21H20A1,1 0 0,0 21,20V12L18.92,6Z"],
  ["other", "Другое", "M12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5M12,2A7,7 0 0,0 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9A7,7 0 0,0 12,2Z"],
];
const kindOf = (id) => KINDS.find((k) => k[0] === id);
function kindFromFile(type) {
  const s = (type || "").toLowerCase();
  return /kite/.test(s) ? "kite" : /surf|sup|paddle/.test(s) ? "surf" : /cycl|bik|ride/.test(s) ? "bike" : /run/.test(s) ? "run"
    : /hik/.test(s) ? "hike" : /walk/.test(s) ? "walk" : /cross|nordic|xc/.test(s) && /ski/.test(s) ? "xc" : /ski|snowboard/.test(s) ? "ski"
    : /boat|sail|row|kayak|canoe/.test(s) ? "boat" : /driv|car/.test(s) ? "car" : null;
}

// горные лыжи (Грегори, 2026-11-02: «подсчёт спусков и подъёмов, скорость средняя и максимальная без
// канатных дорог — специализированные трекеры так и считают»). Высота (сглаженная) поворачивает
// вверх-вниз; поворот считается, когда высота ушла от крайней точки на SKI_TURN м; подъём от низа до
// верха не меньше SKI_MIN — подъёмник, спуск — спуск. На лыжных днях Грегори (Ski Tracker): 10–33
// спуска в день, средняя на спусках 15–23 км/ч, максимальная 46–60
const SKI_TURN = 25, SKI_MIN = 40;
function skiStats(s) {
  const prof = s.profile, n = prof.length;
  if (n < 3 || prof.some((p) => p[1] == null)) return null;
  const e = prof.map((_, i) => { const k = Math.min(2, i, n - 1 - i); let sum = 0; for (let j = i - k; j <= i + k; j++) sum += prof[j][1]; return sum / (2 * k + 1); });
  const turns = [0];
  let dir = 0, ext = 0;
  for (let i = 1; i < n; i++) {
    if (dir === 0) { if (Math.abs(e[i] - e[0]) >= SKI_TURN) { dir = e[i] > e[0] ? 1 : -1; ext = i; } continue; }
    if (dir === 1 ? e[i] > e[ext] : e[i] < e[ext]) ext = i;
    else if (Math.abs(e[ext] - e[i]) >= SKI_TURN) { turns.push(ext); dir = -dir; ext = i; }
  }
  turns.push(n - 1);
  const runs = [], lifts = [];
  for (let k = 1; k < turns.length; k++) {
    const a = turns[k - 1], b = turns[k], dh = e[b] - e[a];
    if (dh >= SKI_MIN) lifts.push([a, b]);
    else if (-dh >= SKI_MIN) runs.push([a, b]);
  }
  let dist = 0, time = 0, max = 0, vert = 0, liftUp = 0, liftTime = 0;
  // перепад — по настоящим высотам куска (сглаженная срезает вершину и низ поворота)
  const span = (a, b) => { let hi = -Infinity, lo = Infinity; for (let i = a; i <= b; i++) { hi = Math.max(hi, prof[i][1]); lo = Math.min(lo, prof[i][1]); } return hi - lo; };
  for (const [a, b] of runs) {
    vert += span(a, b);
    for (let i = a + 1; i <= b; i++) {
      const d = prof[i][0] - prof[i - 1][0], t0 = prof[i - 1][3][3], t1 = prof[i][3][3], dt = t0 && t1 ? t1 - t0 : 0;
      dist += d;
      if (dt > 0 && dt < PAUSE && d / (dt / 1000) > MOVING) time += dt;
      if (prof[i][2] > max) max = prof[i][2];
    }
  }
  for (const [a, b] of lifts) { liftUp += span(a, b); const t0 = prof[a][3][3], t1 = prof[b][3][3]; if (t0 && t1) liftTime += t1 - t0; }
  return { runs, lifts, dist, time, max, vert, liftUp, liftTime };
}
const kmh = (m, ms) => `${dec(m / (ms / 3600000) / 1000, 1)} км/ч`;

// отрезки по 1, 2, 5, 10 км: время, скорость, набор и сброс; from и to — номера точек начала и конца
function splits(s, size) {
  const prof = s.profile, rows = [];
  let from = 0;
  for (let i = 1; i < prof.length; i++) {
    const last = i === prof.length - 1;
    if (prof[i][0] - prof[from][0] < size && !last) continue;
    const d = prof[i][0] - prof[from][0], t0 = prof[from][3][3], t1 = prof[i][3][3];
    const [up, down] = climb(prof.slice(from, i + 1).map((p) => p[1]));
    const part = prof.slice(from, i + 1), es = part.map((p) => p[1]).filter((v) => v != null), vs = part.map((p) => p[2]).filter((v) => v != null);
    if (d > 50 || !rows.length) rows.push({ from, to: i, dist: d, time: t0 && t1 ? t1 - t0 : 0, up, down,
      maxV: vs.length ? Math.max(...vs) : null, minE: es.length ? Math.min(...es) : null, maxE: es.length ? Math.max(...es) : null });
    from = i;
  }
  return rows;
}
const mmss = (ms) => {
  const sec = Math.round(ms / 1000), hh = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, x = String(sec % 60).padStart(2, "0");
  return hh ? `${hh}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
};

// график: высота (заливка) и скорость (линия) по расстоянию; водишь — точка бежит по треку.
// Два края (ручки) выбирают кусок трека: его цифры под графиком, на карте он ярче; «Крупнее» — график
// только по выбранному, чтобы поставить края точнее
function chart(s, st, changed) {
  const W = 360, H = 120, pad = 4;
  const prof = s.profile;
  const hasEle = s.maxEle != null && s.maxEle !== s.minEle, hasSpeed = s.maxSpeed > 0;
  if (prof.length < 2 || (!hasEle && !hasSpeed)) return null;
  const box = h("div", "tk-chart");
  const last = prof.length - 1, total = prof[last][0];
  // ползунок под графиком: какая часть трека видна; тянуть — двигать, колёсико и два пальца — крупнее/мельче
  const scroll = h("div", "tk-scroll"), thumb = h("div", "tk-thumb");
  scroll.title = "Потяните — сдвинуть график; колёсико мыши или два пальца — крупнее и мельче";
  scroll.append(thumb);
  const placeThumb = () => {
    thumb.style.left = `${(prof[st.v0][0] / (total || 1)) * 100}%`;
    thumb.style.width = `${Math.max(2, ((prof[st.v1][0] - prof[st.v0][0]) / (total || 1)) * 100)}%`;
    scroll.classList.toggle("whole", st.v0 === 0 && st.v1 === last);
  };
  // номер точки по расстоянию от начала
  const idxAt = (d) => { let lo = 0, hi = last; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (prof[mid][0] < d) lo = mid; else hi = mid; } return d - prof[lo][0] < prof[hi][0] - d ? lo : hi; };
  let frame = 0;
  const zoom = (d0, d1) => {
    const w = Math.min(total, Math.max(Math.min(total, 60), d1 - d0)), a = Math.max(0, Math.min(total - w, d0));
    const v0 = idxAt(a), v1 = Math.max(v0 + 4, idxAt(a + w));
    if (v1 > last) return;
    st.v0 = v0; st.v1 = v1;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { render(); changed(false); });
  };
  const render = () => {
    const plot = h("div", "tk-plot");
    const v0 = st.v0, v1 = st.v1, D0 = prof[v0][0], D1 = prof[v1][0];
    const view = prof.slice(v0, v1 + 1);
    const eles = view.map((p) => p[1]).filter((e) => e != null), speeds = view.map((p) => p[2]).filter((v) => v != null);
    const minE = Math.min(...eles), maxE = Math.max(...eles), maxV = Math.max(0, ...speeds);
    const x = (d) => pad + ((d - D0) / (D1 - D0 || 1)) * (W - 2 * pad);
    const yE = (e) => H - pad - ((e - minE) / (maxE - minE || 1)) * (H - 2 * pad - 14);
    const yS = (v) => H - pad - (v / (maxV || 1)) * (H - 2 * pad - 14);
    // не больше ~400 точек на графике
    const step = Math.max(1, Math.floor(view.length / 400));
    const pts = view.filter((_, i) => i % step === 0 || i === view.length - 1);
    let html = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
    // подъёмники (горные лыжи) — серой полосой под графиком
    for (const [a, b] of s.lifts || []) if (b >= v0 && a <= v1) {
      const xa = x(prof[Math.max(a, v0)][0]), xb = x(prof[Math.min(b, v1)][0]);
      html += `<rect class="tk-lift" x="${xa.toFixed(1)}" y="0" width="${Math.max(0.5, xb - xa).toFixed(1)}" height="${H}"/>`;
    }
    const e = pts.filter((p) => p[1] != null);
    if (hasEle && e.length > 1) html += `<path class="tk-ele" d="M${x(e[0][0])},${H - pad} ${e.map((p) => `L${x(p[0]).toFixed(1)},${yE(p[1]).toFixed(1)}`).join(" ")} L${x(e[e.length - 1][0])},${H - pad} Z"/>`;
    const v = pts.filter((p) => p[2] != null);
    if (hasSpeed && v.length > 1) html += `<path class="tk-speed" d="${v.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${yS(p[2]).toFixed(1)}`).join(" ")}"/>`;
    html += `<rect class="tk-out tk-out-a" y="0" height="${H}"/><rect class="tk-out tk-out-b" y="0" height="${H}"/>`;
    html += `<line class="tk-pin" x1="0" x2="0" y1="0" y2="${H}" visibility="hidden"/>`;
    html += `<line class="tk-cursor" x1="0" x2="0" y1="0" y2="${H}" visibility="hidden"/></svg>`;
    plot.innerHTML = html;
    // ручки — поверх графика, их удобно взять и пальцем
    const ha = h("div", "tk-handle"), hb = h("div", "tk-handle");
    ha.title = hb.title = "Потяните, чтобы выбрать кусок трека";
    // наибольшее и наименьшее на графике (как у Mapy.com): ▲ высшая точка, ▼ низшая, ● наибольшая скорость
    const extreme = (val, better) => view.reduce((b, p) => (val(p) != null && (b == null || better(val(p), val(b))) ? p : b), null);
    const marks = [];
    if (hasEle && eles.length) {
      marks.push([extreme((p) => p[1], (a, b) => a > b), (p) => yE(p[1]), (p) => `▲ ${Math.round(p[1])} м`, "tk-mark-ele tk-mark-up"]);
      marks.push([extreme((p) => p[1], (a, b) => a < b), (p) => yE(p[1]), (p) => `▼ ${Math.round(p[1])} м`, "tk-mark-ele tk-mark-down"]);
    }
    if (hasSpeed && speeds.length) marks.push([extreme((p) => p[2], (a, b) => a > b), (p) => yS(p[2]), (p) => `${dec(p[2], 1)} км/ч`, "tk-mark-speed tk-mark-up"]);
    for (const [p, y, text, cls] of marks) {
      if (!p) continue;
      const m = h("div", `tk-mark ${cls}`, text(p));
      const left = (x(p[0]) / W) * 100;
      m.style.left = `${left}%`;
      const top = (y(p) / H) * 100;
      m.style.top = `${top}%`;
      // подпись — внутри графика: у нижнего края — над точкой, у верхнего — под ней
      if (cls.includes("tk-mark-down") && top > 80) m.classList.replace("tk-mark-down", "tk-mark-up");
      else if (cls.includes("tk-mark-up") && top < 18) m.classList.replace("tk-mark-up", "tk-mark-down");
      // у краёв графика подпись не вылезает наружу
      if (left < 12) m.classList.add("tk-mark-l"); else if (left > 88) m.classList.add("tk-mark-r");
      m.title = [km(p[0]), clock(p[3][3])].filter(Boolean).join(" · ");
      plot.append(m);
    }
    plot.append(ha, hb);
    const legend = h("div", "tk-legend");
    if (hasEle) legend.append(h("span", "tk-leg-ele", `высота ${Math.round(minE)}–${Math.round(maxE)} м`));
    if (hasSpeed) legend.append(h("span", "tk-leg-speed", `скорость до ${dec(maxV, 1)} км/ч`));
    if (v0 > 0 || v1 < prof.length - 1) legend.append(h("span", "tk-leg-zoom", `крупно: ${km(D0)} – ${km(D1)}`));
    const read = h("div", "tk-read", "Наведите на график — точка покажется на треке");
    box.replaceChildren(plot, scroll, legend, read);
    const svgEl = plot.querySelector("svg"), cursor = svgEl.querySelector(".tk-cursor");
    const ra = svgEl.querySelector(".tk-out-a"), rb = svgEl.querySelector(".tk-out-b");
    const place = () => {
      const a = Math.max(st.a, v0), b = Math.min(st.b, v1);
      ha.style.left = `${(x(prof[a][0]) / W) * 100}%`;
      hb.style.left = `${(x(prof[b][0]) / W) * 100}%`;
      ra.setAttribute("x", 0);
      ra.setAttribute("width", st.a <= v0 ? 0 : x(prof[a][0]));
      rb.setAttribute("x", x(prof[b][0]));
      rb.setAttribute("width", st.b >= v1 ? 0 : W - x(prof[b][0]));
    };
    place();
    // ближайшая точка к месту на графике (в пределах того, что видно)
    const at = (clientX) => {
      const r = svgEl.getBoundingClientRect();
      const d = D0 + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (D1 - D0);
      let lo = v0, hi = v1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (prof[mid][0] < d) lo = mid; else hi = mid; }
      return d - prof[lo][0] < prof[hi][0] - d ? lo : hi;
    };
    const hover = (i) => {
      const p = prof[i];
      cursor.setAttribute("x1", x(p[0])); cursor.setAttribute("x2", x(p[0])); cursor.setAttribute("visibility", "visible");
      read.textContent = [km(p[0]), p[1] != null && `${Math.round(p[1])} м`, p[2] != null && `${dec(p[2], 1)} км/ч`, clock(p[3][3])].filter(Boolean).join(" · ");
      hoverPt = p[3];
      draw();
    };
    svgEl.addEventListener("pointermove", (ev) => hover(at(ev.clientX)));
    // нажатие — точка остаётся отмеченной (там можно разрезать трек)
    const pinLine = svgEl.querySelector(".tk-pin");
    const showPin = () => {
      const on = st.pin != null && st.pin >= v0 && st.pin <= v1;
      pinLine.setAttribute("visibility", on ? "visible" : "hidden");
      if (on) { pinLine.setAttribute("x1", x(prof[st.pin][0])); pinLine.setAttribute("x2", x(prof[st.pin][0])); }
    };
    showPin();
    svgEl.addEventListener("pointerdown", (ev) => { const i = at(ev.clientX); st.pin = i; showPin(); hover(i); changed(false); });
    svgEl.addEventListener("pointerleave", () => { cursor.setAttribute("visibility", "hidden"); hoverPt = st.pin != null ? prof[st.pin][3] : null; draw(); });
    for (const [el, end] of [[ha, "a"], [hb, "b"]]) {
      el.addEventListener("pointerdown", (ev) => { ev.preventDefault(); el.setPointerCapture(ev.pointerId); el.dataset.drag = "1"; });
      el.addEventListener("pointermove", (ev) => {
        if (!el.dataset.drag) return;
        const i = at(ev.clientX);
        if (end === "a") st.a = Math.min(i, st.b - 1); else st.b = Math.max(i, st.a + 1);
        place();
        hover(end === "a" ? st.a : st.b);
        changed(false);
      });
      const up = () => { if (!el.dataset.drag) return; delete el.dataset.drag; changed(true); };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    }
    box.place = place;
    placeThumb();
  };
  // колёсико — крупнее и мельче вокруг места под мышью
  box.addEventListener("wheel", (ev) => {
    const svgEl = box.querySelector("svg"), r = svgEl.getBoundingClientRect();
    if (ev.clientY > r.bottom) return;
    ev.preventDefault();
    const D0 = prof[st.v0][0], D1 = prof[st.v1][0], d = D0 + Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (D1 - D0);
    const f = Math.exp(ev.deltaY * 0.0015);
    zoom(d - (d - D0) * f, d + (D1 - d) * f);
  }, { passive: false });
  // два пальца — как на карте
  const touches = new Map();
  let pinch = null;
  box.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "touch") return;
    touches.set(ev.pointerId, ev.clientX);
    if (touches.size === 2) {
      const [x1, x2] = [...touches.values()], r = box.querySelector("svg").getBoundingClientRect();
      const D0 = prof[st.v0][0], D1 = prof[st.v1][0];
      pinch = { gap: Math.abs(x2 - x1) || 1, mid: D0 + (((x1 + x2) / 2 - r.left) / r.width) * (D1 - D0), D0, D1 };
    }
  }, true);
  box.addEventListener("pointermove", (ev) => {
    if (!touches.has(ev.pointerId)) return;
    touches.set(ev.pointerId, ev.clientX);
    if (!pinch || touches.size !== 2) return;
    const [x1, x2] = [...touches.values()], f = pinch.gap / (Math.abs(x2 - x1) || 1);
    zoom(pinch.mid - (pinch.mid - pinch.D0) * f, pinch.mid + (pinch.D1 - pinch.mid) * f);
  }, true);
  const lift = (ev) => { touches.delete(ev.pointerId); if (touches.size < 2) pinch = null; };
  box.addEventListener("pointerup", lift, true);
  box.addEventListener("pointercancel", lift, true);
  // ползунок: тянуть — двигать видимую часть; щелчок мимо — перескочить туда
  let pan = null;
  scroll.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const r = scroll.getBoundingClientRect(), w = prof[st.v1][0] - prof[st.v0][0];
    if (ev.target !== thumb) zoom(((ev.clientX - r.left) / r.width) * total - w / 2, ((ev.clientX - r.left) / r.width) * total + w / 2);
    scroll.setPointerCapture(ev.pointerId);
    pan = { x: ev.clientX, d0: ev.target === thumb ? prof[st.v0][0] : ((ev.clientX - r.left) / r.width) * total - w / 2, w, width: r.width };
  });
  scroll.addEventListener("pointermove", (ev) => {
    if (!pan) return;
    const d0 = pan.d0 + ((ev.clientX - pan.x) / pan.width) * total;
    zoom(d0, d0 + pan.w);
  });
  scroll.addEventListener("pointerup", () => { pan = null; });
  scroll.addEventListener("pointercancel", () => { pan = null; });
  render();
  return box;
}

// цифры трека — плитки; у горных лыж — спуски и подъёмы, скорость только на спусках
function factTiles(s, ski) {
  const facts = h("div", "tk-facts");
  const fact = (label, value) => { if (!value) return; const f = h("div", "tk-fact"); f.append(h("b", "", value), h("span", "", label)); facts.append(f); };
  fact("расстояние", km(s.dist));
  if (ski) {
    fact("спусков", String(ski.runs.length));
    fact("подъёмов", String(ski.lifts.length));
    fact("на спусках", km(ski.dist));
    fact("время на спусках", ski.time ? hm(ski.time) : "");
    fact("средняя скорость на спусках", ski.time ? kmh(ski.dist, ski.time) : "");
    fact("максимальная скорость на спусках", ski.max ? `${dec(ski.max, 1)} км/ч` : "");
    fact("перепад на спусках", `${Math.round(ski.vert)} м`);
    fact("на подъёмниках", ski.liftTime ? `${hm(ski.liftTime)} · ${Math.round(ski.liftUp)} м` : "");
    fact("полное время", s.total ? hm(s.total) : "");
  } else {
    fact("в пути", s.moving ? hm(s.moving) : "");
    // полное время — только если были стоянки, иначе оно равно времени в пути
    fact("полное время", s.total - s.moving > 60000 ? hm(s.total) : "");
    fact("средняя скорость", s.moving ? kmh(s.dist, s.moving) : "");
    fact("максимальная скорость", s.maxSpeed ? `${dec(s.maxSpeed, 1)} км/ч` : "");
    fact("набор высоты", s.maxEle != null ? `${Math.round(s.up)} м` : "");
    fact("сброс высоты", s.maxEle != null ? `${Math.round(s.down)} м` : "");
  }
  fact("максимальная высота", s.maxEle != null ? `${Math.round(s.maxEle)} м` : "");
  fact("минимальная высота", s.maxEle != null ? `${Math.round(s.minEle)} м` : "");
  return facts;
}

// выбор вида активности: список со значками (в обычном списке браузера значки не нарисовать)
function kindPicker(t, done) {
  const wrap = h("div", "tk-kind");
  const b = h("button", "text-btn tk-kind-btn");
  const k = kindOf(t.kind);
  b.innerHTML = k ? mdi(k[2]) : ICON_SMALL;
  b.append(h("span", "", k ? k[1] : "Вид активности — выбрать…"));
  b.title = "Вид активности";
  const list = h("div", "tk-kind-list");
  list.hidden = true;
  for (const [id, name, d] of KINDS) {
    const o = h("button", "tk-kind-item" + (t.kind === id ? " on" : ""));
    o.innerHTML = mdi(d);
    o.append(name);
    o.addEventListener("click", () => { t.kind = id; persist(t); done(); });
    list.append(o);
  }
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    list.hidden = !list.hidden;
    if (!list.hidden) document.addEventListener("click", () => { list.hidden = true; }, { once: true });
  });
  wrap.append(b, list);
  return wrap;
}

let sel = null; // { a, b, v0, v1 } — выбранный кусок и видимая часть графика открытого трека
let splitSize = settings.get("tracks.split", 1000);

async function openTrack(id, keep = false) {
  const t = await getTrack(id);
  if (!t) return;
  const again = keep && openId === id;
  if (drawing && drawing.id !== id) stopDrawing();
  openId = id;
  hoverPt = null;
  selPiece = null;
  if (!shown) await showOnMap(true);
  const s = stats(t), last = s.profile.length - 1;
  if (!again || !sel || sel.b > last) sel = { a: 0, b: last, v0: 0, v1: last, pin: null };
  if (sel.pin > last) sel.pin = null;
  const bad = spikes(t);
  { let g = 0; spikePts = t.segs.flat().filter(() => bad.has(g++)); }
  draw();
  if (!again) fit(t);
  panel.setTitle(t.name);
  const bar = h("div", "pb-bar");
  const left = h("div", "tr-bar-left");
  left.append(btn(BACK, "Ко всем трекам", () => renderList()));
  const right = h("div", "tr-bar-left");
  const undo = btn(UNDO, "Назад — отменить последнюю правку", async () => {
    const step = history.get(id).pop();
    t.segs = step.segs;
    persist(t);
    await step.revert?.();
    sel = null;
    openTrack(id, true);
  });
  undo.disabled = !history.get(id)?.length;
  right.append(undo, btn(SAVE, "Сохранить файлом GPX", () => download(t)),
    btn(DELETE, "Удалить трек с этого устройства", () => { if (confirm(`Удалить трек «${t.name}» с этого устройства?`)) removeTrack(id); }));
  bar.append(left, right);
  const all = t.segs.flat();
  const when = t.date ? `${day(t.date)}, ${clock(all[0][3])}–${clock(all[all.length - 1][3])}` : "";
  // вид активности; у горных лыж — спуски и подъёмы, подъёмники на графике и карте серые
  const kind = kindPicker(t, () => openTrack(id, true));
  const ski = t.kind === "ski" ? skiStats(s) : null;
  s.lifts = ski?.lifts || [];
  liftPieces = ski?.lifts.length ? pieces(t, (g) => ski.lifts.some(([a, b]) => g >= a && g <= b)) : null;
  const nodes = [bar];
  if (when) nodes.push(h("div", "tr-facts tk-when", when));
  nodes.push(kind, factTiles(s, ski));

  // выбранный кусок: его цифры и правка
  const whole = () => sel.a === 0 && sel.b === last;
  const selInfo = h("div", "tk-sel-info");
  const tools = h("div", "tk-edit");
  const tool = (icon, text, title, fn) => {
    const b = h("button", "text-btn");
    b.innerHTML = icon;
    b.append(text);
    b.title = title;
    b.addEventListener("click", fn);
    tools.append(b);
    return b;
  };
  const bTrim = tool(TRIM, "Обрезать", "Оставить только выбранное: всё за краями убирается",
    () => { const { a, b } = sel; edit(t, pieces(t, (g) => g >= a && g <= b)); sel = null; openTrack(id, true); });
  const bCut = tool(CUT, "Вырезать", "Убрать выбранный кусок из трека",
    () => { const { a, b } = sel; edit(t, pieces(t, (g) => g <= a || g >= b)); sel = null; openTrack(id, true); });
  const bZoom = tool(ZOOM, "Крупнее", "График — только по выбранному, чтобы поставить края точнее",
    () => { Object.assign(sel, { v0: sel.a, v1: sel.b }); openTrack(id, true); });
  const bAll = tool(WHOLE, "Весь трек", "Снять выбор, график по всему треку",
    () => { sel = { a: 0, b: last, v0: 0, v1: last }; openTrack(id, true); });
  let markSplit = null, updateSplit = null;
  const showSel = (final) => {
    const w = whole();
    bTrim.disabled = bCut.disabled = w;
    bZoom.disabled = w || (sel.v0 === sel.a && sel.v1 === sel.b);
    bAll.disabled = w && sel.v0 === 0 && sel.v1 === last;
    if (w) selInfo.textContent = "Потяните оранжевые края графика, чтобы выбрать кусок трека — его можно обрезать или вырезать";
    else {
      const p = s.profile, x = stats({ segs: pieces(t, (g) => g >= sel.a && g <= sel.b) });
      selInfo.textContent = `Выбрано ${km(p[sel.a][0])} – ${km(p[sel.b][0])}: ` + [km(x.dist), x.moving && hm(x.moving),
        x.moving && `${dec(x.dist / (x.moving / 3600000) / 1000, 1)} км/ч`, p[sel.a][3][3] && `${clock(p[sel.a][3][3])}–${clock(p[sel.b][3][3])}`].filter(Boolean).join(" · ");
    }
    selPiece = w ? null : pieces(t, (g) => g >= sel.a && g <= sel.b);
    updateSplit?.();
    draw();
    if (final) markSplit?.();
  };
  const c = chart(s, sel, showSel);
  if (c) nodes.push(c, selInfo, tools);

  // ещё правка: выбросы, разрезать в отмеченной точке, склеить, дорисовать
  const more = h("div", "tk-edit");
  const tool2 = (icon, text, title, fn) => { const b = tool(icon, text, title, fn); more.append(b); return b; };
  const bSpikes = tool2(SPIKES, bad.size ? `Убрать выбросы GPS (${bad.size})` : "Выбросов GPS нет",
    "Точки, которые GPS отбросил в сторону, — на карте красные", () => { edit(t, without(t, bad)); openTrack(id, true); });
  bSpikes.disabled = !bad.size;
  const bSplit = tool2(SPLIT, "Разрезать", "Разрезать трек на два в отмеченной точке — сначала нажмите на график", async () => {
    const at = sel.pin;
    const second = { id: newId(), name: `${t.name} (2)`, file: t.file, kind: t.kind || null, segs: pieces(t, (g) => g >= at) };
    if (!second.segs.length) return;
    second.date = second.segs[0][0][3] || t.date;
    await store(second);
    edit(t, pieces(t, (g) => g <= at), () => forget(second.id));
    ctx?.status(`Вторая часть — отдельный трек «${second.name}»`);
    setTimeout(() => ctx?.status(""), 4000);
    sel = null;
    openTrack(id, true);
  });
  updateSplit = () => { bSplit.disabled = !c || sel.pin == null || sel.pin <= 0 || sel.pin >= last; };
  // склеить: другой трек добавляется по времени (раньше — в начало, позже — в конец) отдельным куском
  // записи, без прямой между ними; тот трек убирается из списка («Назад» вернёт)
  const others = index.filter((x) => x.id !== id).sort((a, b) => (b.date || 0) - (a.date || 0));
  const merge = h("select", "tk-merge");
  merge.title = "Добавить к этому треку другой — например, если запись прерывалась";
  merge.append(Object.assign(h("option", "", others.length ? "Склеить с треком…" : "Склеить — других треков нет"), { value: "" }),
    ...others.map((x) => Object.assign(h("option", "", [x.name, day(x.date), km(x.dist)].filter(Boolean).join(" · ")), { value: x.id })));
  merge.disabled = !others.length;
  merge.addEventListener("change", async () => {
    const o = merge.value && await getTrack(merge.value);
    if (!o) return;
    const before = (o.segs[0][0][3] || Infinity) < (t.segs[0][0][3] || Infinity);
    edit(t, before ? [...o.segs, ...t.segs] : [...t.segs, ...o.segs], () => store(o));
    forget(o.id);
    sel = null;
    openTrack(id, true);
  });
  const mergeWrap = h("label", "text-btn tk-merge-wrap");
  mergeWrap.innerHTML = MERGE;
  mergeWrap.append(merge);
  mergeWrap.classList.toggle("off", !others.length);
  more.append(mergeWrap);
  const bDraw = tool2(DRAW, drawing?.id === id ? "Готово" : "Дорисовать",
    "Щёлкайте по карте — трек продолжится прямыми от ближнего конца", () => {
      if (drawing?.id === id) { stopDrawing(); openTrack(id, true); return; }
      drawing = { id, end: null };
      captureClicks("tracks");
      ctx.map.getCanvas().style.cursor = "crosshair";
      openTrack(id, true);
    });
  bDraw.classList.toggle("on", drawing?.id === id);
  nodes.push(more);
  if (drawing?.id === id) nodes.push(h("div", "tk-sel-info tk-draw-hint", "Щёлкайте по карте — каждая точка продолжает трек прямой линией. «Назад» убирает последнюю, «Готово» — закончить"));

  // по отрезкам: 1, 2, 5, 10 км; нажатие — отрезок выбран на графике и на карте
  if (s.total && s.dist > 1000) {
    const head = h("div", "tk-split-head");
    head.append(h("span", "", "По отрезкам"));
    for (const size of [1000, 2000, 5000, 10000]) {
      const b = h("button", "tk-chip" + (size === splitSize ? " on" : ""), `${size / 1000} км`);
      b.addEventListener("click", () => { splitSize = size; settings.set("tracks.split", size); openTrack(id, true); });
      head.append(b);
    }
    const table = h("table", "tk-splits");
    table.innerHTML = "<thead><tr><th>км</th><th>время</th><th>средняя, км/ч</th><th>макс., км/ч</th><th>набор, м</th><th>сброс, м</th><th>высота, м</th></tr></thead>";
    const body = h("tbody");
    const rows = splits(s, splitSize).map((r, i) => {
      const tr = h("tr");
      // отрезок «от–до» в км: 0–1, 1–2… последний неполный — с десятыми
      const kmv = (v) => { const r = Math.round(v * 10) / 10; return dec(r, Number.isInteger(r) ? 0 : 1); };
      const range = `${kmv(s.profile[r.from][0] / 1000)}–${kmv(s.profile[r.to][0] / 1000)}`;
      for (const v of [range, r.time ? mmss(r.time) : "", r.time ? dec(r.dist / (r.time / 3600000) / 1000, 1) : "", r.maxV != null ? dec(r.maxV, 1) : "",
        Math.round(r.up), Math.round(r.down), r.minE != null ? `${Math.round(r.minE)}–${Math.round(r.maxE)}` : ""]) tr.append(h("td", "", String(v)));
      tr.title = "Выбрать этот отрезок";
      tr.addEventListener("click", () => {
        Object.assign(sel, { a: r.from, b: r.to });
        if (sel.a < sel.v0 || sel.b > sel.v1) { sel.v0 = 0; sel.v1 = last; openTrack(id, true); return; }
        c?.place();
        showSel(true);
      });
      body.append(tr);
      return [r, tr];
    });
    markSplit = () => rows.forEach(([r, tr]) => tr.classList.toggle("on", r.from === sel.a && r.to === sel.b));
    table.append(body);
    nodes.push(head, table);
  }

  nodes.push(h("p", "pb-hint", `Точек: ${s.points}${t.segs.length > 1 ? `, кусков записи: ${t.segs.length}` : ""}${t.file ? ` · файл «${t.file}»` : ""}`));
  if (t.orig) {
    const r = h("button", "text-btn tk-restore", "Вернуть трек как в файле");
    r.title = "Отменить все правки";
    r.addEventListener("click", () => {
      if (!confirm("Отменить все правки и вернуть трек как в файле?")) return;
      const orig = t.orig;
      edit(t, orig);
      delete t.orig;
      persist(t);
      sel = null;
      openTrack(id, true);
    });
    nodes.push(r);
  }
  panel.body.replaceChildren(...nodes);
  if (c) showSel(true);
  if (!again) panel.body.scrollTop = 0;
}

// ---------- режим в строке поиска ----------
const MODE = { icon: svg(TRACK_D, 20), title: "Мои треки", placeholder: "Найти трек", tone: "track",
  filter: (text) => renderList(text), exit: () => panel.close() };

async function openPanel() {
  await load();
  renderList("");
  panel.open();
  setSearchMode(MODE);
  showOnMap(true);
  emit("module", { id: "content/tracks", on: true });
}

panel.onClose(() => {
  stopDrawing();
  spikePts = [];
  liftPieces = null;
  openId = null;
  hoverPt = null;
  selPiece = null;
  searchText = "";
  showOnMap(false);
  if (searchMode() === MODE) setSearchMode(null);
  emit("module", { id: "content/tracks", on: false });
});

let wired = false;
function wire() {
  if (wired || !ctx) return;
  wired = true;
  ctx.map.on("style.load", () => { if (shown) { addLayers(); draw(); } });
  // щелчок по линии — открыть этот трек
  ctx.map.on("click", "tracks-line", (e) => { const id = e.features[0]?.properties.id; if (!drawing && id && id !== openId) openTrack(id); });
  ctx.map.on("click", drawClick);
  ctx.map.on("mouseenter", "tracks-line", () => { ctx.map.getCanvas().style.cursor = "pointer"; });
  ctx.map.on("mouseleave", "tracks-line", () => { ctx.map.getCanvas().style.cursor = ""; });
}

register({
  id: "content/tracks",
  kind: "content",
  title: "Мои треки",
  tone: "track",
  hint: "Свои треки из Sports Tracker и других программ: на карте, расстояние, время, высота",
  icon: ICON,
  column: {
    load: (c) => { ctx = c; wire(); return load(); },
    // первой строкой — «Открыть файл…», потом треки, новые сверху
    items: () => [{ id: "", title: "Открыть файл…", icon: OPEN_ICON, hint: "GPX или KML" },
      { id: "*", title: `Все треки (${index.length})`, icon: ICON, selected: isOpen("tracks") }],
    choose: (id, c) => {
      ctx = c;
      wire();
      if (!id) { input.click(); return; } // выбор файла — прямо по нажатию (иначе браузер не откроет окно)
      openPanel();
    },
    isOpen: () => isOpen("tracks"),
    close: () => panel.close(),
  },
  // для проверки
  stats: () => ({ tracks: index.length, shown, open: openId ? tracks.get(openId)?.name : null }),
  addText: (name, text) => addFiles([new File([text], name)]),
  // выбрать кусок a..b (доли трека 0…1), как ручками на графике
  select: (a, b) => {
    const t = tracks.get(openId), n = stats(t).profile.length - 1;
    Object.assign(sel, { a: Math.round(a * n), b: Math.round(b * n) });
    return openTrack(openId, true);
  },
  // отметить точку на графике (доля трека 0…1), как нажатием
  pinAt: (f) => {
    const t = tracks.get(openId), n = stats(t).profile.length - 1;
    sel.pin = Math.round(f * n);
    return openTrack(openId, true);
  },
  drawAt: (lng, lat) => drawClick({ lngLat: { lng, lat } }),
  statsOf: (text) => { const s = stats(parseFile("x.gpx", text)); delete s.profile; return s; },
});

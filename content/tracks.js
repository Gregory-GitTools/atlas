// Мои треки (Грегори, 2026-10-30: «Sports Tracker и WOO Sports… ни одна программа не позволяет
// редактировать трек; записать маршрут на телефон и потом его оформить»). Трек пишет любая программа
// на телефоне (в фоне, чего сайт не может), сюда он приходит файлом GPX или KML — выбором файла в
// столбике кнопки или перетаскиванием на карту — и хранится только на этом устройстве.
// Шаг 1: открыть и посмотреть — линия на карте, длина, время в пути, скорость, набор и сброс высоты,
// график высоты и скорости (водишь по нему — по треку бегает точка), сохранить файлом GPX, удалить.
// Шаг 2 (Грегори, 2026-10-30: «забыл остановить и уехал на машине»): края на графике выбирают кусок —
// оставить только его или вырезать, «Назад»; наибольшая скорость и высота, вид занятия, отрезки по км.
// Дальше (ROADMAP): выбросы GPS, склеить и разрезать, дорисовать, оформить
import { register } from "../core/modules.js";
import { createPanel, isOpen } from "../core/panel.js";
import { emit } from "../core/events.js";
import { setSearchMode, searchMode } from "../core/search.js";
import { cacheGet, cacheSet, cacheDelete } from "../core/storage.js";
import { claimLayers } from "../core/popups.js";
import * as settings from "../core/settings.js";

const svg = (d, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`;
// линия трека между двумя точками
const TRACK_D = "M6 3a3 3 0 0 0-1 5.83V12a4 4 0 0 0 4 4h6a2 2 0 0 1 2 2v.17A3 3 0 1 0 19 18a4 4 0 0 0-4-4H9a2 2 0 0 1-2-2V8.83A3 3 0 0 0 6 3zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm12 12a1 1 0 1 1 0 2 1 1 0 0 1 0-2z";
const ICON = svg(TRACK_D);
const OPEN_ICON = svg("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z");
const BACK = svg("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z", 20);
const SAVE = svg("M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z", 20);
const UNDO = svg("M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 12.5 10c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 10.53 17.15 8 12.5 8z", 20);
const DELETE = svg("M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z", 20);
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
  return { name, segs, kind: kindFromFile(doc.querySelector("trk > type")?.textContent) };
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
    seg.forEach((p, i) => {
      let speed = null;
      if (i) {
        const q = seg[i - 1], d = meters(q, p);
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
  return fc([f(all[0], "start"), f(all[all.length - 1], "end"), ...(hoverPt ? [f(hoverPt, "here")] : [])]);
}
const selData = () => fc(selPiece ? [{ type: "Feature", geometry: { type: "MultiLineString", coordinates: selPiece.map((s) => s.map((p) => [p[0], p[1]])) }, properties: {} }] : []);
const LAYERS = ["tracks-casing", "tracks-line", "tracks-sel", "tracks-ends"];
function addLayers() {
  const map = ctx.map;
  if (!map.getSource("tracks")) map.addSource("tracks", { type: "geojson", data: lineData() });
  if (!map.getSource("tracks-ends")) map.addSource("tracks-ends", { type: "geojson", data: endsData() });
  if (!map.getSource("tracks-sel")) map.addSource("tracks-sel", { type: "geojson", data: selData() });
  if (!map.getLayer("tracks-casing")) map.addLayer({ id: "tracks-casing", type: "line", source: "tracks", filter: ["==", ["get", "open"], 1],
    layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": 7 } });
  if (!map.getLayer("tracks-line")) map.addLayer({ id: "tracks-line", type: "line", source: "tracks",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": COLOR, "line-width": ["case", ["==", ["get", "open"], 1], 4, 2.5], "line-opacity": ["case", ["==", ["get", "open"], 1], 1, 0.55] } });
  if (!map.getLayer("tracks-sel")) map.addLayer({ id: "tracks-sel", type: "line", source: "tracks-sel",
    layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": SEL_COLOR, "line-width": 5 } });
  // начало — зелёная точка, конец — красная, точка с графика — белая в цвет трека
  if (!map.getLayer("tracks-ends")) map.addLayer({ id: "tracks-ends", type: "circle", source: "tracks-ends",
    paint: { "circle-radius": ["match", ["get", "kind"], "here", 7, 6],
      "circle-color": ["match", ["get", "kind"], "start", "#43a047", "end", "#e53935", "#fff"],
      "circle-stroke-color": ["match", ["get", "kind"], "here", COLOR, "#fff"], "circle-stroke-width": ["match", ["get", "kind"], "here", 3, 2] } });
  claimLayers("tracks-line");
}
function draw() {
  if (!shown || !ctx) return;
  ctx.map.getSource("tracks")?.setData(lineData());
  ctx.map.getSource("tracks-ends")?.setData(endsData());
  ctx.map.getSource("tracks-sel")?.setData(selData());
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
  for (const id of ["tracks", "tracks-ends", "tracks-sel"]) if (ctx.map.getSource(id)) ctx.map.removeSource(id);
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
    icon.innerHTML = svg(TRACK_D, 18);
    const text = h("span", "tr-row-text");
    text.append(h("span", "tr-row-title", x.name), h("span", "tr-row-sub", [kindOf(x.kind)?.slice(1).join(" "), day(x.date), km(x.dist)].filter(Boolean).join(" · ")));
    r.append(icon, text);
    r.addEventListener("click", () => openTrack(x.id));
    nodes.push(r);
  }
  panel.body.replaceChildren(...nodes);
}

// ---------- правка: выбранный кусок, обрезать, вырезать, «Назад» ----------
// кусок — номера точек a..b по порядку записи (как в profile). Правка меняет segs; прежний вид — в истории
// («Назад», пока открыта страница), исходный трек из файла — в t.orig навсегда («Вернуть как в файле»)
const history = new Map(); // id → [segs, …]
function persist(t) {
  t.date = t.segs[0]?.[0]?.[3] || t.date;
  cacheSet(`tracks/${t.id}`, t).catch(() => {});
  const x = index.find((x) => x.id === t.id);
  if (x) Object.assign(x, { name: t.name, date: t.date, dist: stats(t).dist, kind: t.kind || null });
  saveIndex();
}
function edit(t, segs) {
  if (!segs.length) return;
  if (!history.has(t.id)) history.set(t.id, []);
  history.get(t.id).push(t.segs);
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

// вид занятия: из файла (если программа его пишет) или выбрать самому
const KINDS = [["walk", "🚶", "Прогулка"], ["hike", "🥾", "Поход"], ["run", "🏃", "Бег"], ["bike", "🚴", "Велосипед"],
  ["kite", "🪁", "Кайтсёрфинг"], ["surf", "🏄", "Виндсёрфинг, сёрфинг, SUP"], ["ski", "⛷️", "Лыжи"], ["boat", "⛵", "Лодка"],
  ["car", "🚗", "Машина"], ["other", "📍", "Другое"]];
const kindOf = (id) => KINDS.find((k) => k[0] === id);
function kindFromFile(type) {
  const s = (type || "").toLowerCase();
  return /kite/.test(s) ? "kite" : /surf|sup|paddle/.test(s) ? "surf" : /cycl|bik|ride/.test(s) ? "bike" : /run/.test(s) ? "run"
    : /hik/.test(s) ? "hike" : /walk/.test(s) ? "walk" : /ski/.test(s) ? "ski" : /boat|sail|row|kayak|canoe/.test(s) ? "boat"
    : /driv|car/.test(s) ? "car" : null;
}

// отрезки по 1, 2, 5, 10 км: время, скорость, набор и сброс; from и to — номера точек начала и конца
function splits(s, size) {
  const prof = s.profile, rows = [];
  let from = 0;
  for (let i = 1; i < prof.length; i++) {
    const last = i === prof.length - 1;
    if (prof[i][0] - prof[from][0] < size && !last) continue;
    const d = prof[i][0] - prof[from][0], t0 = prof[from][3][3], t1 = prof[i][3][3];
    const [up, down] = climb(prof.slice(from, i + 1).map((p) => p[1]));
    if (d > 50 || !rows.length) rows.push({ from, to: i, dist: d, time: t0 && t1 ? t1 - t0 : 0, up, down });
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
  const e = pts.filter((p) => p[1] != null);
  if (hasEle && e.length > 1) html += `<path class="tk-ele" d="M${x(e[0][0])},${H - pad} ${e.map((p) => `L${x(p[0]).toFixed(1)},${yE(p[1]).toFixed(1)}`).join(" ")} L${x(e[e.length - 1][0])},${H - pad} Z"/>`;
  const v = pts.filter((p) => p[2] != null);
  if (hasSpeed && v.length > 1) html += `<path class="tk-speed" d="${v.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${yS(p[2]).toFixed(1)}`).join(" ")}"/>`;
  html += `<rect class="tk-out tk-out-a" y="0" height="${H}"/><rect class="tk-out tk-out-b" y="0" height="${H}"/>`;
  html += `<line class="tk-cursor" x1="0" x2="0" y1="0" y2="${H}" visibility="hidden"/></svg>`;
  plot.innerHTML = html;
  // ручки — поверх графика, их удобно взять и пальцем
  const ha = h("div", "tk-handle"), hb = h("div", "tk-handle");
  ha.title = hb.title = "Потяните, чтобы выбрать кусок трека";
  plot.append(ha, hb);
  const legend = h("div", "tk-legend");
  if (hasEle) legend.append(h("span", "tk-leg-ele", `высота ${Math.round(minE)}–${Math.round(maxE)} м`));
  if (hasSpeed) legend.append(h("span", "tk-leg-speed", `скорость до ${dec(maxV, 1)} км/ч`));
  if (v0 > 0 || v1 < prof.length - 1) legend.append(h("span", "tk-leg-zoom", `крупно: ${km(D0)} – ${km(D1)}`));
  const read = h("div", "tk-read", "Наведите на график — точка покажется на треке");
  box.append(plot, legend, read);
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
  svgEl.addEventListener("pointerdown", (ev) => hover(at(ev.clientX)));
  svgEl.addEventListener("pointerleave", () => { cursor.setAttribute("visibility", "hidden"); hoverPt = null; draw(); });
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
  return box;
}

// цифры трека — плитки
function factTiles(s) {
  const facts = h("div", "tk-facts");
  const fact = (label, value) => { if (!value) return; const f = h("div", "tk-fact"); f.append(h("b", "", value), h("span", "", label)); facts.append(f); };
  fact("расстояние", km(s.dist));
  fact("в пути", s.moving ? hm(s.moving) : "");
  // «всего» — только если были стоянки
  fact("всего со стоянками", s.total - s.moving > 60000 ? hm(s.total) : "");
  fact("средняя в пути", s.moving ? `${dec(s.dist / (s.moving / 3600000) / 1000, 1)} км/ч` : "");
  fact("наибольшая скорость", s.maxSpeed ? `${dec(s.maxSpeed, 1)} км/ч` : "");
  fact("набор высоты", s.maxEle != null ? `${Math.round(s.up)} м` : "");
  fact("сброс высоты", s.maxEle != null ? `${Math.round(s.down)} м` : "");
  fact("высшая точка", s.maxEle != null ? `${Math.round(s.maxEle)} м` : "");
  fact("низшая точка", s.maxEle != null ? `${Math.round(s.minEle)} м` : "");
  return facts;
}

let sel = null; // { a, b, v0, v1 } — выбранный кусок и видимая часть графика открытого трека
let splitSize = settings.get("tracks.split", 1000);

async function openTrack(id, keep = false) {
  const t = await getTrack(id);
  if (!t) return;
  const again = keep && openId === id;
  openId = id;
  hoverPt = null;
  selPiece = null;
  if (!shown) await showOnMap(true);
  const s = stats(t), last = s.profile.length - 1;
  if (!again || !sel || sel.b > last) sel = { a: 0, b: last, v0: 0, v1: last };
  draw();
  if (!again) fit(t);
  panel.setTitle(t.name);
  const bar = h("div", "pb-bar");
  const left = h("div", "tr-bar-left");
  left.append(btn(BACK, "Ко всем трекам", () => renderList()));
  const right = h("div", "tr-bar-left");
  const undo = btn(UNDO, "Назад — отменить последнюю правку", () => { t.segs = history.get(id).pop(); persist(t); sel = null; openTrack(id, true); });
  undo.disabled = !history.get(id)?.length;
  right.append(undo, btn(SAVE, "Сохранить файлом GPX", () => download(t)),
    btn(DELETE, "Удалить трек с этого устройства", () => { if (confirm(`Удалить трек «${t.name}» с этого устройства?`)) removeTrack(id); }));
  bar.append(left, right);
  const all = t.segs.flat();
  const when = t.date ? `${day(t.date)}, ${clock(all[0][3])}–${clock(all[all.length - 1][3])}` : "";
  // вид занятия
  const kind = h("select", "tk-kind");
  kind.title = "Вид занятия";
  kind.append(Object.assign(h("option", "", "Вид занятия — выбрать…"), { value: "" }),
    ...KINDS.map(([k, icon, name]) => Object.assign(h("option", "", `${icon} ${name}`), { value: k, selected: t.kind === k })));
  kind.addEventListener("change", () => { t.kind = kind.value || null; persist(t); });
  const nodes = [bar];
  if (when) nodes.push(h("div", "tr-facts tk-when", when));
  nodes.push(kind, factTiles(s));

  // выбранный кусок: его цифры и правка
  const whole = () => sel.a === 0 && sel.b === last;
  const selInfo = h("div", "tk-sel-info");
  const tools = h("div", "tk-edit");
  const tool = (text, title, fn) => { const b = h("button", "text-btn", text); b.title = title; b.addEventListener("click", fn); tools.append(b); return b; };
  const bTrim = tool("Оставить только выбранное", "Обрезать трек: всё за краями выбранного убирается",
    () => { const { a, b } = sel; edit(t, pieces(t, (g) => g >= a && g <= b)); sel = null; openTrack(id, true); });
  const bCut = tool("Вырезать выбранное", "Убрать выбранный кусок из трека",
    () => { const { a, b } = sel; edit(t, pieces(t, (g) => g <= a || g >= b)); sel = null; openTrack(id, true); });
  const bZoom = tool("Крупнее", "График — только по выбранному, чтобы поставить края точнее",
    () => { Object.assign(sel, { v0: sel.a, v1: sel.b }); openTrack(id, true); });
  const bAll = tool("Весь трек", "Снять выбор, график по всему треку",
    () => { sel = { a: 0, b: last, v0: 0, v1: last }; openTrack(id, true); });
  let markSplit = null;
  const showSel = (final) => {
    const w = whole();
    bTrim.disabled = bCut.disabled = w;
    bZoom.disabled = w || (sel.v0 === sel.a && sel.v1 === sel.b);
    bAll.disabled = w && sel.v0 === 0 && sel.v1 === last;
    if (w) selInfo.textContent = "Потяните края графика, чтобы выбрать кусок трека — его можно оставить или вырезать";
    else {
      const p = s.profile, x = stats({ segs: pieces(t, (g) => g >= sel.a && g <= sel.b) });
      selInfo.textContent = `Выбрано ${km(p[sel.a][0])} – ${km(p[sel.b][0])}: ` + [km(x.dist), x.moving && hm(x.moving),
        x.moving && `${dec(x.dist / (x.moving / 3600000) / 1000, 1)} км/ч`, p[sel.a][3][3] && `${clock(p[sel.a][3][3])}–${clock(p[sel.b][3][3])}`].filter(Boolean).join(" · ");
    }
    selPiece = w ? null : pieces(t, (g) => g >= sel.a && g <= sel.b);
    draw();
    if (final) markSplit?.();
  };
  const c = chart(s, sel, showSel);
  if (c) nodes.push(c, selInfo, tools);

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
    table.innerHTML = "<thead><tr><th>№</th><th>до, км</th><th>время</th><th>км/ч</th><th>набор</th><th>сброс</th></tr></thead>";
    const body = h("tbody");
    const rows = splits(s, splitSize).map((r, i) => {
      const tr = h("tr");
      const end = s.profile[r.to][0] / 1000;
      for (const v of [i + 1, dec(end, Number.isInteger(Math.round(end * 100) / 100) ? 0 : 1), r.time ? mmss(r.time) : "",
        r.time ? dec(r.dist / (r.time / 3600000) / 1000, 1) : "", `${Math.round(r.up)} м`, `${Math.round(r.down)} м`]) tr.append(h("td", "", String(v)));
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
  ctx.map.on("click", "tracks-line", (e) => { const id = e.features[0]?.properties.id; if (id && id !== openId) openTrack(id); });
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
  statsOf: (text) => { const s = stats(parseFile("x.gpx", text)); delete s.profile; return s; },
});

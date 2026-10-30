// Мои треки (Грегори, 2026-10-30: «Sports Tracker и WOO Sports… ни одна программа не позволяет
// редактировать трек; записать маршрут на телефон и потом его оформить»). Трек пишет любая программа
// на телефоне (в фоне, чего сайт не может), сюда он приходит файлом GPX или KML — выбором файла в
// столбике кнопки или перетаскиванием на карту — и хранится только на этом устройстве.
// Шаг 1: открыть и посмотреть — линия на карте, длина, время в пути, скорость, набор и сброс высоты,
// график высоты и скорости (водишь по нему — по треку бегает точка), сохранить файлом GPX, удалить.
// Дальше (ROADMAP): обрезать, вырезать кусок, выбросы GPS, склеить и разрезать, дорисовать, оформить
import { register } from "../core/modules.js";
import { createPanel, isOpen } from "../core/panel.js";
import { emit } from "../core/events.js";
import { setSearchMode, searchMode } from "../core/search.js";
import { cacheGet, cacheSet, cacheDelete } from "../core/storage.js";
import { claimLayers } from "../core/popups.js";

const svg = (d, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`;
// линия трека между двумя точками
const TRACK_D = "M6 3a3 3 0 0 0-1 5.83V12a4 4 0 0 0 4 4h6a2 2 0 0 1 2 2v.17A3 3 0 1 0 19 18a4 4 0 0 0-4-4H9a2 2 0 0 1-2-2V8.83A3 3 0 0 0 6 3zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm12 12a1 1 0 1 1 0 2 1 1 0 0 1 0-2z";
const ICON = svg(TRACK_D);
const OPEN_ICON = svg("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z");
const BACK = svg("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z", 20);
const SAVE = svg("M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z", 20);
const DELETE = svg("M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z", 20);
const COLOR = "#3949ab"; // --tone-track

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
  return { name, segs };
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
    file: name, date: first || null, segs };
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
const CLIMB = 3; // м — высота меняется хотя бы на столько, иначе это шум GPS
function stats(t) {
  let dist = 0, moving = 0, up = 0, down = 0, maxEle = -Infinity, minEle = Infinity, maxSpeed = 0;
  const profile = []; // [расстояние от начала, высота, скорость км/ч, точка]
  for (const seg of t.segs) {
    let ref = null; // опорная высота для набора/сброса
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
        if (ref == null) ref = p[2];
        else if (p[2] - ref >= CLIMB) { up += p[2] - ref; ref = p[2]; }
        else if (ref - p[2] >= CLIMB) { down += ref - p[2]; ref = p[2]; }
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
      index.push({ id: t.id, name: t.name, date: t.date, dist: stats(t).dist });
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
const LAYERS = ["tracks-casing", "tracks-line", "tracks-ends"];
function addLayers() {
  const map = ctx.map;
  if (!map.getSource("tracks")) map.addSource("tracks", { type: "geojson", data: lineData() });
  if (!map.getSource("tracks-ends")) map.addSource("tracks-ends", { type: "geojson", data: endsData() });
  if (!map.getLayer("tracks-casing")) map.addLayer({ id: "tracks-casing", type: "line", source: "tracks", filter: ["==", ["get", "open"], 1],
    layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": 7 } });
  if (!map.getLayer("tracks-line")) map.addLayer({ id: "tracks-line", type: "line", source: "tracks",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": COLOR, "line-width": ["case", ["==", ["get", "open"], 1], 4, 2.5], "line-opacity": ["case", ["==", ["get", "open"], 1], 1, 0.55] } });
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
  for (const id of ["tracks", "tracks-ends"]) if (ctx.map.getSource(id)) ctx.map.removeSource(id);
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
    text.append(h("span", "tr-row-title", x.name), h("span", "tr-row-sub", [day(x.date), km(x.dist)].filter(Boolean).join(" · ")));
    r.append(icon, text);
    r.addEventListener("click", () => openTrack(x.id));
    nodes.push(r);
  }
  panel.body.replaceChildren(...nodes);
}

// график: высота (заливка) и скорость (линия) по расстоянию; водишь — точка бежит по треку
function chart(s) {
  const W = 360, H = 120, pad = 4;
  const box = h("div", "tk-chart");
  const prof = s.profile;
  const hasEle = s.maxEle != null && s.maxEle !== s.minEle, hasSpeed = s.maxSpeed > 0;
  if (prof.length < 2 || (!hasEle && !hasSpeed)) return null;
  const x = (d) => pad + (d / (s.dist || 1)) * (W - 2 * pad);
  const yE = (e) => H - pad - ((e - s.minEle) / (s.maxEle - s.minEle || 1)) * (H - 2 * pad - 14);
  const yS = (v) => H - pad - (v / (s.maxSpeed || 1)) * (H - 2 * pad - 14);
  // не больше ~400 точек на графике
  const step = Math.max(1, Math.floor(prof.length / 400));
  const pts = prof.filter((_, i) => i % step === 0 || i === prof.length - 1);
  let html = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  if (hasEle) {
    const e = pts.filter((p) => p[1] != null);
    html += `<path class="tk-ele" d="M${x(e[0][0])},${H - pad} ${e.map((p) => `L${x(p[0]).toFixed(1)},${yE(p[1]).toFixed(1)}`).join(" ")} L${x(e[e.length - 1][0])},${H - pad} Z"/>`;
  }
  if (hasSpeed) {
    const v = pts.filter((p) => p[2] != null);
    html += `<path class="tk-speed" d="${v.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${yS(p[2]).toFixed(1)}`).join(" ")}"/>`;
  }
  html += `<line class="tk-cursor" x1="0" x2="0" y1="0" y2="${H}" visibility="hidden"/></svg>`;
  box.innerHTML = html;
  const legend = h("div", "tk-legend");
  if (hasEle) legend.append(h("span", "tk-leg-ele", `высота ${Math.round(s.minEle)}–${Math.round(s.maxEle)} м`));
  if (hasSpeed) legend.append(h("span", "tk-leg-speed", `скорость до ${dec(s.maxSpeed, 1)} км/ч`));
  const read = h("div", "tk-read", "Наведите на график — точка покажется на треке");
  box.append(legend, read);
  const cursor = box.querySelector(".tk-cursor");
  const move = (e) => {
    const r = box.querySelector("svg").getBoundingClientRect();
    const d = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * s.dist;
    let lo = 0, hi = prof.length - 1; // ближайшая точка по расстоянию
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (prof[mid][0] < d) lo = mid; else hi = mid; }
    const p = prof[d - prof[lo][0] < prof[hi][0] - d ? lo : hi];
    cursor.setAttribute("x1", x(p[0])); cursor.setAttribute("x2", x(p[0])); cursor.setAttribute("visibility", "visible");
    read.textContent = [km(p[0]), p[1] != null && `${Math.round(p[1])} м`, p[2] != null && `${dec(p[2], 1)} км/ч`, clock(p[3][3])].filter(Boolean).join(" · ");
    hoverPt = p[3];
    draw();
  };
  const leave = () => { cursor.setAttribute("visibility", "hidden"); hoverPt = null; draw(); };
  const svgEl = box.querySelector("svg");
  svgEl.addEventListener("pointermove", move);
  svgEl.addEventListener("pointerdown", move);
  svgEl.addEventListener("pointerleave", leave);
  return box;
}

async function openTrack(id) {
  const t = await getTrack(id);
  if (!t) return;
  openId = id;
  hoverPt = null;
  if (!shown) await showOnMap(true);
  draw();
  fit(t);
  const s = stats(t);
  panel.setTitle(t.name);
  const bar = h("div", "pb-bar");
  const left = h("div", "tr-bar-left");
  left.append(btn(BACK, "Ко всем трекам", () => renderList()));
  const right = h("div", "tr-bar-left");
  right.append(btn(SAVE, "Сохранить файлом GPX", () => download(t)),
    btn(DELETE, "Удалить трек с этого устройства", () => { if (confirm(`Удалить трек «${t.name}» с этого устройства?`)) removeTrack(id); }));
  bar.append(left, right);
  const all = t.segs.flat();
  const when = t.date ? `${day(t.date)}, ${clock(all[0][3])}–${clock(all[all.length - 1][3])}` : "";
  const facts = h("div", "tk-facts");
  const fact = (label, value) => { if (!value) return; const f = h("div", "tk-fact"); f.append(h("b", "", value), h("span", "", label)); facts.append(f); };
  fact("расстояние", km(s.dist));
  fact("в пути", s.moving ? hm(s.moving) : "");
  // «всего» — только если были стоянки
  fact("всего со стоянками", s.total - s.moving > 60000 ? hm(s.total) : "");
  fact("средняя скорость", s.moving ? `${dec(s.dist / (s.moving / 3600000) / 1000, 1)} км/ч` : "");
  fact("набор высоты", s.maxEle != null ? `${Math.round(s.up)} м` : "");
  fact("сброс высоты", s.maxEle != null ? `${Math.round(s.down)} м` : "");
  const nodes = [bar];
  if (when) nodes.push(h("div", "tr-facts tk-when", when));
  nodes.push(facts);
  const c = chart(s);
  if (c) nodes.push(c);
  nodes.push(h("p", "pb-hint", `Точек: ${s.points}${t.segs.length > 1 ? `, кусков записи: ${t.segs.length}` : ""}${t.file ? ` · файл «${t.file}»` : ""}`));
  panel.body.replaceChildren(...nodes);
  panel.body.scrollTop = 0;
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
  statsOf: (text) => { const s = stats(parseFile("x.gpx", text)); delete s.profile; return s; },
});

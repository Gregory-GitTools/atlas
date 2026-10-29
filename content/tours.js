// Экскурсии — наброски поездок (перенос из travel-earth, Грегори 2026-10-29). Файлы папки «Экскурсии»
// репозитория travel-earth (пишет и ChatGPT по промту «Экскурсии/_Промт — как написать экскурсию.md»).
// В барабане — кнопка «Экскурсии», в её столбике — страны с флагами; нажатие — панель слева со
// списком экскурсий страны (сначала группы — «Группа:» или «Город:» с несколькими экскурсиями,
// потом остальные), экскурсия — в той же панели: об экскурсии (регион, маршрут, идея, ссылка на
// разговорник страны), пункты, источники. Остановки (разделы с «Место:») — номера на карте, у
// поездки с «Маршрут:» — пунктир между ними; щелчок по остановке на карте или по её заголовку —
// выделение в обе стороны и перелёт. Аудиогид: вступление (название, идея), затем каждая остановка —
// перелёт, рассказ и слайд-шоу снимков Commons вокруг неё; щелчок по остановке во время рассказа —
// дальше с неё. В строке поиска — режим «Найти экскурсию» (название, регион, страна, город, тип,
// теги). Места находит Nominatim (раз в секунду, найденное помнится на устройстве): остановка ищется
// рядом с регионом, у экскурсии по городу — сначала в ±0,3° от города (опыт travel-earth: «Sorrento»
// находился в США, «Castel Sant'Angelo» — под Риети); «широта, долгота» — как есть
import { register } from "../core/modules.js";
import { createPanel, isOpen } from "../core/panel.js";
import { repoFiles, repoText } from "../core/repo.js";
import { speakText, stopSpeech } from "../core/speech.js";
import { countryCode, flagUrl } from "../core/flags.js";
import { emit, on } from "../core/events.js";
import { setSearchMode, searchMode } from "../core/search.js";
import { PLAYER } from "../core/player.js";
import { cacheGet, cacheSet } from "../core/storage.js";
import { uiLanguage } from "../core/labels.js";
import { claimLayers } from "../core/popups.js";

const svg = (d, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`;
const MAP_D = "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z";
const ICON = svg(MAP_D);
const SPEAK = svg("M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z", 18);
const BACK = svg("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z", 20);
// значки групп экскурсий (из travel-earth): по стране, город, гастро, развлечения, иначе капля
const GROUPS = {
  country: { words: ["по стране", "страна", "по региону", "регион"], d: MAP_D },
  city: { words: ["город", "города", "по городу"], d: "M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z" },
  food: { words: ["гастро", "гастрономия", "еда", "кухня"], d: "M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z" },
  fun: { words: ["развлечения", "развлечение", "отдых"], d: "M20 12c0-1.1.9-2 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-1.99.9-1.99 2v4c1.1 0 1.99.9 1.99 2s-.89 2-2 2v4c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-4c-1.1 0-2-.9-2-2z" },
};
const PIN_D = "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z";
const COLOR = "#e53935"; // --tone-tour: номера остановок и значки экскурсий

// ---------- разбор файла (как parseTour в travel-earth) ----------
const KEYS = { "место": "place", "регион": "region", "тропа": "trail", "длина": "length", "время": "time",
  "сложность": "difficulty", "сезон": "season", "точки": "points", "особенности": "features", "справка": "history",
  "выдержка": "quote", "выдержки": "quote", "источник": "sources", "источники": "sources", "теги": "tags", "идея": "idea",
  "маршрут": "route", "страна": "country", "город": "city", "тип": "kind", "значок": "icon", "фото вступления": "introPlace", "группа": "group" };
const LIST_KEYS = new Set(["features", "sources", "quote", "history", "points"]);

// «Длина: 11 км · Время: 4 ч · Сложность: средняя» — несколько полей в строке; кусок без ключа —
// в значении предыдущего поля; строка не с поля — null
function fields(line) {
  const out = [];
  for (const part of line.split(/\s+·\s+/)) {
    const m = part.match(/^([А-Яа-яЁё ]+)\s*:\s*(.*)$/);
    const key = m && KEYS[m[1].trim().toLowerCase()];
    if (key) out.push([key, m[2]]);
    else if (out.length) out[out.length - 1][1] += ` · ${part}`;
    else return null;
  }
  return out;
}

function parse(text, file) {
  const tour = { title: "", region: "", country: "", city: "", group: "", kind: "", icon: "", introPlace: "", tags: "", route: "", sources: [], idea: [], sections: [] };
  let target = tour, key = null;
  const add = (k, v) => {
    if (!v) return;
    if (LIST_KEYS.has(k) || k === "idea") (target[k] ||= []).push(v);
    else target[k] = v;
  };
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    // пустая строка заканчивает справку, выдержку и простое поле; списки продолжаются
    if (!line) { if (key && !["features", "points", "sources"].includes(key)) key = null; continue; }
    if (line.startsWith(">")) { add("quote", line.replace(/^>\s*/, "")); key = "quote"; continue; }
    let m;
    if ((m = line.match(/^#\s+(.+)/)) && !tour.title) { tour.title = m[1]; continue; }
    if ((m = line.match(/^##+\s+(.+)/))) { target = { title: m[1], paras: [] }; tour.sections.push(target); key = null; continue; }
    const f = fields(line);
    if (f) {
      for (const [k, v] of f) {
        key = k;
        // поля остановки до первого «##» — безымянный раздел
        if (target === tour && ["place", "trail", "length", "time", "difficulty", "points", "features", "history", "quote"].includes(k) && !tour.sections.length) {
          tour.sections.push(target = { title: "", paras: [] });
        }
        add(k, v);
      }
      continue;
    }
    if ((m = line.match(/^[-*•]\s+(.+)/))) { add(key && LIST_KEYS.has(key) ? key : target === tour ? "idea" : "features", m[1]); continue; }
    if (key && LIST_KEYS.has(key) && !["features", "points", "sources"].includes(key)) { add(key, line); continue; }
    if (target === tour) tour.idea.push(line);
    else target.paras.push(line);
  }
  tour.title ||= file.replace(/\.\w+$/, "");
  let n = 0;
  for (const sec of tour.sections) sec.n = sec.place ? ++n : 0; // номера — только у остановок с местом
  return tour;
}

const countryOf = (t) => t.country || (t.region.includes(",") ? t.region.split(",").pop().trim() : t.region) || "Без страны";
const groupOf = (t) => {
  const words = [t.kind, t.icon].map((w) => (w || "").trim().toLowerCase());
  for (const [id, g] of Object.entries(GROUPS)) if (words.some((w) => g.words.includes(w))) return id;
  return t.city ? "city" : "";
};
const tourIcon = (t, size = 18) => svg(GROUPS[groupOf(t)]?.d || PIN_D, size);
const source = (line) => {
  const m = line.match(/https?:\/\/\S+/);
  if (!m) return { text: line, url: "" };
  const text = line.replace(m[0], "").replace(/[\s—–:-]+$/, "").trim();
  return { text: text || new URL(m[0]).hostname.replace(/^www\./, ""), url: m[0], video: /youtube\.com|youtu\.be|vimeo\.com/.test(m[0]) };
};

// ---------- места: Nominatim, раз в секунду, найденное помнится ----------
const NEAR_KM = 800, CITY_BOX = 0.3;
const km = ([a, b], [c, d]) => 6371 * Math.acos(Math.min(1, Math.sin(b * Math.PI / 180) * Math.sin(d * Math.PI / 180)
  + Math.cos(b * Math.PI / 180) * Math.cos(d * Math.PI / 180) * Math.cos((c - a) * Math.PI / 180)));
let geoQueue = Promise.resolve();

async function geocodeOnce(query, near, box = 0) {
  // кэш — по запросу и окрестности: одно и то же название в разных поездках — разные места
  const key = `geo/${query.toLowerCase()}${near ? `@${near.map((v) => v.toFixed(1)).join(",")}` : ""}${box ? `#${box}` : ""}`;
  const hit = await cacheGet(key).catch(() => undefined);
  if (hit !== undefined) return hit;
  const run = geoQueue.then(async () => {
    const r = box || 2.5;
    const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", "accept-language": uiLanguage(),
      ...(near && { viewbox: [near[0] - r, near[1] + r, near[0] + r, near[1] - r].join(","), bounded: box ? "1" : "0" }) });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    const [found] = res?.ok ? await res.json() : [];
    const point = found ? [Number(found.lon), Number(found.lat)] : null;
    if (res?.ok) cacheSet(key, point).catch(() => {});
    await new Promise((ok) => setTimeout(ok, 1100)); // правило Nominatim — не чаще раза в секунду
    return point;
  });
  geoQueue = run.catch(() => null);
  return run;
}

async function geocode(query, near = null, region = "", city = null) {
  const m = query.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return [Number(m[2]), Number(m[1])];
  if (city) {
    const inCity = await geocodeOnce(query, city, CITY_BOX);
    if (inCity) return inCity;
  }
  let point = await geocodeOnce(query, near);
  if (point && near && km(point, near) > NEAR_KM && region) {
    point = await geocodeOnce(`${query}, ${region}`, near);
    if (point && km(point, near) > NEAR_KM) point = null;
  }
  return point;
}

// места открытой экскурсии — регион, город, остановки по порядку; карта обновляется по ходу
async function geocodeTour(t) {
  if (t.region && t.point === undefined) {
    t.point = await geocode(t.region).catch(() => null);
    // регион найден — сразу туда, не дожидаясь остановок
    if (openTour === t && !play && !t.sections.some((s) => s.point)) fitTour(t);
  }
  if (t.city && t.cityPoint === undefined) t.cityPoint = await geocode([t.city, t.country].filter(Boolean).join(", ")).catch(() => null);
  for (const sec of t.sections) {
    if (openTour !== t) return;
    if (!sec.place || sec.point !== undefined) continue;
    sec.point = await geocode(sec.place, t.point, t.region, t.cityPoint).catch(() => null);
    drawTour();
  }
}
const stopPoint = async (t, sec) => {
  if (sec.point === undefined && sec.place) { sec.point = await geocode(sec.place, t.point, t.region, t.cityPoint).catch(() => null); drawTour(); }
  return sec.point;
};

// ---------- данные ----------
const tours = new Map(); // путь → экскурсия
let loading = null, ctx = null;
function load(c) {
  if (c) ctx = c;
  loading ??= (async () => {
    const files = (await repoFiles("Экскурсии")).filter((f) => /\.(md|txt)$/i.test(f.name) && !f.path.split("/").some((p) => p.startsWith("_")));
    await Promise.all(files.map(async (f) => {
      const text = await repoText(f).catch(() => "");
      if (text) tours.set(f.path, { id: f.path, path: f.path, ...parse(text, f.name) });
    }));
  })();
  return loading;
}
const countries = () => {
  const by = new Map();
  for (const t of tours.values()) { const c = countryOf(t); by.set(c, (by.get(c) || 0) + 1); }
  return [...by].sort((a, b) => a[0].localeCompare(b[0], "ru"));
};

// разговорник страны — у «Языков» (события: связь модулей только через них)
let languageList = [];
on("languages", (list) => { languageList = list; if (openTour) renderTour(); });
const languageFor = (t) => languageList.find((lg) => lg.countries.some((c) => c.toLowerCase() === countryOf(t).toLowerCase()));

// ---------- карта: остановки открытой экскурсии ----------
let openTour = null, selected = 0;
const font = (map) => map.getStyle().layers.find((l) => l.type === "symbol" && Array.isArray(l.layout?.["text-font"]))?.layout["text-font"] || ["Noto Sans Regular"];
function data() {
  const t = openTour, features = [];
  if (t) {
    const stops = t.sections.filter((s) => s.n && s.point);
    if (t.route && stops.length > 1) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: stops.map((s) => s.point) }, properties: { kind: "route" } });
    for (const s of stops) features.push({ type: "Feature", geometry: { type: "Point", coordinates: s.point }, properties: { kind: "stop", n: s.n, title: s.title || s.place } });
  }
  return { type: "FeatureCollection", features };
}
function ensureLayers() {
  const map = ctx?.map;
  if (!map || map.getSource("tour")) return;
  map.addSource("tour", { type: "geojson", data: data() });
  map.addLayer({ id: "tour-route", type: "line", source: "tour", filter: ["==", ["get", "kind"], "route"],
    paint: { "line-color": COLOR, "line-width": 2.5, "line-dasharray": [2, 2], "line-opacity": 0.85 } });
  map.addLayer({ id: "tour-sel", type: "circle", source: "tour", filter: ["==", ["get", "n"], -1],
    paint: { "circle-radius": 17, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#e91e63", "circle-stroke-width": 3 } });
  map.addLayer({ id: "tour-stops", type: "circle", source: "tour", filter: ["==", ["get", "kind"], "stop"],
    paint: { "circle-radius": 12, "circle-color": COLOR, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
  map.addLayer({ id: "tour-num", type: "symbol", source: "tour", filter: ["==", ["get", "kind"], "stop"],
    layout: { "text-field": ["to-string", ["get", "n"]], "text-font": font(map), "text-size": 13, "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#fff" } });
  claimLayers("tour-stops", "tour-num");
}
function drawTour() {
  if (!ctx) return;
  ensureLayers();
  ctx.map.getSource("tour")?.setData(data());
  ctx.map.setFilter("tour-sel", ["==", ["get", "n"], selected || -1]);
}
// точка — в свободной части кадра: справа от панели (компьютер) или под ней (телефон)
const freeOffset = () => (innerWidth <= 600 ? [0, Math.round(innerHeight * 0.22)] : [210, 0]);
function fitTour(t) {
  const pts = [t.point, ...t.sections.map((s) => s.point)].filter(Boolean);
  if (!pts.length || !ctx) return;
  const lng = pts.map((p) => p[0]), lat = pts.map((p) => p[1]);
  const phone = innerWidth <= 600;
  ctx.map.fitBounds([[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]],
    { padding: phone ? { top: innerHeight * 0.6, bottom: 110, left: 30, right: 30 } : { top: 80, bottom: 110, left: 440, right: 90 }, maxZoom: 13, duration: 2000 });
}

// ---------- панель ----------
const panel = createPanel({ id: "tours", title: "Экскурсии", icon: svg(MAP_D, 18), side: "left" });
const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });
const btn = (icon, title, fn) => { const b = h("button", "pb-btn"); b.innerHTML = icon; b.title = title; b.addEventListener("click", fn); return b; };
let currentCountry = null;

// строка экскурсии в списке: значок группы, название, «тип · регион»
function tourRow(t) {
  const r = h("button", "tr-row");
  const icon = h("span", "tr-icon");
  icon.innerHTML = tourIcon(t);
  const text = h("span", "tr-row-text");
  text.append(h("span", "tr-row-title", t.title), h("span", "tr-row-sub", [t.kind, t.region].filter(Boolean).join(" · ")));
  r.append(icon, text);
  r.addEventListener("click", () => openTourById(t.id));
  return r;
}

// список: экскурсии страны или найденные (query) по всем странам
function renderList(country, query = "") {
  stopPlay();
  closeTourMap();
  currentCountry = country ?? currentCountry;
  const q = query.toLowerCase();
  const list = [...tours.values()].filter((t) => (q ? [t.title, t.region, countryOf(t), t.city, t.kind, t.tags, t.group].join(" ").toLowerCase().includes(q)
    : countryOf(t) === currentCountry)).sort((a, b) => a.title.localeCompare(b.title, "ru"));
  panel.setTitle(q ? "Найденные экскурсии" : currentCountry);
  const nodes = [];
  if (q && !list.length) nodes.push(h("p", "pb-hint", "Ничего не нашлось"));
  // группы (несколько экскурсий одной «Группы»/«Города») — первыми, с заголовком
  const by = new Map();
  for (const t of list) { const g = q ? "" : t.group || t.city || ""; if (!by.has(g)) by.set(g, []); by.get(g).push(t); }
  const groups = [...by].filter(([g, l]) => g && l.length > 1);
  for (const [g, l] of groups) { nodes.push(h("div", "tr-group", g)); nodes.push(...l.map(tourRow)); }
  const rest = list.filter((t) => !groups.some(([, l]) => l.includes(t)));
  if (groups.length && rest.length) nodes.push(h("div", "tr-group", "Другие"));
  nodes.push(...rest.map(tourRow));
  panel.body.replaceChildren(...nodes);
  panel.body.scrollTop = 0;
}

// раздел с заголовком-кнопкой и стрелкой «свернуть»
function section(title, { n = 0, shut = false, onTitle } = {}) {
  const box = h("section", `pb-section tr-section${shut ? " shut" : ""}`);
  if (n) box.dataset.n = n;
  const head = h("div", "tr-sec-head");
  const t = h("button", "tr-sec-title");
  if (n) t.append(h("span", "tr-num", String(n)));
  t.append(title);
  t.addEventListener("click", () => (onTitle ? onTitle() : (box.classList.toggle("shut"), updateFoldAll())));
  const fold = h("button", "tr-fold");
  fold.title = "Свернуть или развернуть";
  fold.addEventListener("click", () => { box.classList.toggle("shut"); updateFoldAll(); });
  head.append(t, fold);
  const body = h("div", "pb-sec-body");
  box.append(head, body);
  return { box, body };
}

// плашка «Справка» / «Из источника» с кнопкой «Послушать»
function listenBox(title, lines) {
  const box = h("div", "tr-listen");
  const head = h("div", "tr-listen-head");
  const b = h("button", "pb-btn tr-listen-btn");
  b.innerHTML = SPEAK;
  b.title = "Послушать";
  b.addEventListener("click", () => {
    const was = b.classList.contains("on");
    stopPlay();
    stopSpeech();
    for (const x of panel.body.querySelectorAll(".tr-listen-btn.on")) x.classList.remove("on");
    if (was) return;
    b.classList.add("on");
    speakText(lines.join(" ")).then(() => b.classList.remove("on"));
  });
  head.append(h("span", "tr-listen-title", title), b);
  box.append(head, ...lines.map((l) => h("p", "", l)));
  return box;
}

let playerBar = null, playerLabel = null, foldAllBtn = null;
function updateFoldAll() {
  if (!foldAllBtn) return;
  const open = [...panel.body.querySelectorAll(".tr-section")].some((x) => !x.classList.contains("shut"));
  foldAllBtn.innerHTML = open ? PLAYER.fold : PLAYER.unfold;
  foldAllBtn.title = open ? "Свернуть все пункты" : "Развернуть все пункты";
}

function renderTour() {
  const t = openTour;
  if (!t) return;
  panel.setTitle(t.title);
  const nodes = [];
  const bar = h("div", "pb-bar");
  const back = btn(BACK, `К экскурсиям: ${countryOf(t)}`, () => renderList(countryOf(t)));
  playerBar = h("div", "pb-player");
  playerLabel = h("span", "pb-player-label");
  foldAllBtn = btn("", "", () => {
    const secs = [...panel.body.querySelectorAll(".tr-section")];
    const open = secs.some((x) => !x.classList.contains("shut"));
    for (const x of secs) x.classList.toggle("shut", open);
    updateFoldAll();
  });
  const left = h("div", "tr-bar-left");
  left.append(back, playerBar);
  bar.append(left, foldAllBtn);
  nodes.push(bar);

  // об экскурсии
  const about = section("Об экскурсии");
  if (t.region) about.body.append(h("div", "tr-facts", `Регион: ${t.region}`));
  if (t.route) about.body.append(h("div", "tr-facts", `Маршрут: ${t.route}`));
  for (const p of t.idea) about.body.append(h("p", "pb-idea", p));
  const lg = languageFor(t);
  if (lg) {
    const a = h("button", "tr-link", `Разговорник: ${lg.name.toLowerCase()}`);
    a.addEventListener("click", () => emit("language-open", { key: lg.key }));
    about.body.append(a);
  }
  nodes.push(about.box);

  for (const sec of t.sections) {
    const s = section(sec.title || sec.place || "Пункт", { n: sec.n, onTitle: sec.n ? () => selectStop(sec.n, true) : null });
    const facts = [sec.trail && `Тропа ${sec.trail}`, sec.length, sec.time, sec.difficulty, sec.season].filter(Boolean).join(" · ");
    if (facts) s.body.append(h("div", "tr-facts", facts));
    if (sec.points?.length) s.body.append(h("div", "tr-facts", `Точки: ${sec.points.join(" → ")}`));
    if (sec.features?.length) { const ul = h("ul", "tr-features"); for (const f of sec.features) ul.append(h("li", "", f)); s.body.append(ul); }
    for (const p of sec.paras) s.body.append(h("p", "pb-idea", p));
    if (sec.history?.length) s.body.append(listenBox("Справка", sec.history));
    if (sec.quote?.length) s.body.append(listenBox("Из источника", sec.quote));
    nodes.push(s.box);
  }
  if (t.sources.length) {
    const src = section("Источники", { shut: true });
    for (const line of t.sources) {
      const x = source(line);
      const div = h("div", "pb-source");
      if (x.url) div.append(Object.assign(document.createElement("a"), { href: x.url, target: "_blank", rel: "noopener", textContent: `${x.video ? "▶ " : ""}${x.text}` }));
      else div.textContent = x.text;
      src.body.append(div);
    }
    nodes.push(src.box);
  }
  const keep = panel.body.scrollTop;
  panel.body.replaceChildren(...nodes);
  panel.body.scrollTop = keep;
  renderPlayer();
  updateFoldAll();
  markSelected();
}

function markSelected() {
  for (const box of panel.body.querySelectorAll(".tr-section[data-n]")) {
    const on = Number(box.dataset.n) === selected;
    box.classList.toggle("current", on);
    if (on) { box.classList.remove("shut"); box.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }
}

// выделить остановку (на карте и в панели); fly — перелететь к ней; во время аудиогида — рассказ с неё
async function selectStop(n, fly) {
  const t = openTour;
  if (!t) return;
  if (play && fly) { const i = play.stops.findIndex((s) => s.n === n); if (i >= 0) { play.i = i; play.paused = false; stopSpeech(); step(); return; } }
  selected = n;
  drawTour();
  markSelected();
  const sec = t.sections.find((s) => s.n === n);
  if (fly && sec) {
    const p = await stopPoint(t, sec);
    if (p) ctx.map.flyTo({ center: p, zoom: Math.max(14, Math.min(ctx.map.getZoom(), 15)), offset: freeOffset(), duration: 2000 });
  }
}

function openTourById(id) {
  const t = tours.get(id);
  if (!t) return;
  stopPlay();
  openTour = t;
  selected = 0;
  currentCountry = countryOf(t);
  emit("languages-wanted", {});
  panel.body.scrollTop = 0;
  renderTour();
  drawTour();
  fitTour(t);
  geocodeTour(t).then(() => openTour === t && !play && fitTour(t));
}
function closeTourMap() {
  if (!openTour) return;
  openTour = null;
  selected = 0;
  drawTour();
  hideSlides();
}

// ---------- аудиогид ----------
let play = null; // { stops, i (-1 — вступление), paused, run }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const narration = (sec) => [
  `${sec.n}. ${sec.title || sec.place}.`,
  sec.points?.length && `Точки: ${sec.points.join(", ").replace(/\s*→\s*/g, ", ")}.`,
  sec.features?.length && sec.features.map((f) => f.replace(/[.;]?$/, ".")).join(" "),
  sec.paras?.join(" "), sec.history?.join(" "), sec.quote?.join(" "),
].filter(Boolean).join(" ");

function stopPlay() {
  if (!play) return;
  play = null;
  stopSpeech();
  hideSlides();
  renderPlayer();
}
async function step() {
  const p = play, t = openTour;
  if (!p || !t) return;
  const run = p.run = {};
  const alive = () => play === p && p.run === run && !p.paused;
  renderPlayer();
  if (p.i < 0) {
    selected = 0;
    drawTour();
    markSelected();
    fitTour(t);
    const home = t.point || t.sections.find((s) => s.point)?.point;
    if (home) showSlides(home);
    const lg = languageFor(t);
    await speakText([t.title, ...t.idea, lg && `Для поездки есть разговорник, ${lg.name.toLowerCase()} язык: ссылка — в начале экскурсии`].filter(Boolean).join(". "));
  } else {
    const sec = p.stops[p.i];
    selected = sec.n;
    drawTour();
    markSelected();
    const pt = await stopPoint(t, sec);
    if (!alive()) return;
    if (pt) {
      showSlides(pt);
      ctx.map.flyTo({ center: pt, zoom: Math.max(14, Math.min(ctx.map.getZoom(), 15)), offset: freeOffset(), duration: 3000 });
      await new Promise((r) => { ctx.map.once("moveend", r); setTimeout(r, 4000); });
      if (!alive()) return;
    }
    await speakText(narration(sec));
  }
  if (!alive()) return;
  await wait(1200);
  if (!alive()) return;
  if (p.i + 1 >= p.stops.length) { stopPlay(); return; }
  p.i++;
  step();
}
const go = (d) => { if (!play) return; play.i = Math.max(-1, Math.min(play.stops.length - 1, play.i + d)); play.paused = false; stopSpeech(); step(); };
function toggle() {
  if (!play) { play = { stops: openTour.sections.filter((s) => s.n), i: -1, paused: false }; stopSpeech(); step(); return; }
  play.paused = !play.paused;
  if (play.paused) { play.run = null; stopSpeech(); clearInterval(slideTimer); renderPlayer(); } else step();
}
function renderPlayer() {
  if (!playerBar || !playerBar.isConnected) return;
  const main = btn(play && !play.paused ? PLAYER.pause : PLAYER.play, !play ? "Аудиогид: рассказ с переходами по точкам и слайд-шоу" : play.paused ? "Продолжить" : "Пауза", toggle);
  main.classList.toggle("on", !!play && !play.paused);
  const off = (b) => { b.disabled = !play; return b; };
  playerBar.replaceChildren(off(btn(PLAYER.prev, "Назад", () => go(-1))), main, off(btn(PLAYER.next, "Дальше", () => go(1))),
    off(btn(PLAYER.stop, "Стоп", stopPlay)), playerLabel);
  const sec = play?.stops[play.i];
  playerLabel.textContent = !play ? "" : play.i < 0 ? "Вступление" : `${play.i + 1} / ${play.stops.length} · ${sec.title || sec.place}`;
}

// ---------- слайд-шоу: снимки Commons вокруг точки, смена раз в 5 с ----------
const slidesBox = h("div", "tr-slides");
slidesBox.hidden = true;
slidesBox.innerHTML = '<img alt=""><img alt=""><div class="tr-slides-cap"></div><button class="tr-slides-close" title="Скрыть слайд-шоу"></button>';
slidesBox.querySelector(".tr-slides-close").innerHTML = svg("M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z", 16);
slidesBox.querySelector(".tr-slides-close").addEventListener("click", () => { slidesOff = true; hideSlides(); });
document.body.append(slidesBox);
const slideCache = new Map();
let slideTimer = 0, slidesOff = false, slideToken = 0;
async function slidesAt(point) {
  const key = point.map((v) => v.toFixed(4)).join(",");
  if (slideCache.has(key)) return slideCache.get(key);
  const api = (params) => fetch(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json", formatversion: 2, origin: "*", ...params })}`,
    { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
  const found = ((await api({ list: "geosearch", gscoord: `${point[1]}|${point[0]}`, gsradius: 1000, gsnamespace: 6, gslimit: 40 })).query?.geosearch || [])
    .filter((g) => /\.(jpe?g|webp)$/i.test(g.title)).slice(0, 10);
  let slides = [];
  if (found.length) {
    const pages = (await api({ pageids: found.map((g) => g.pageid).join("|"), prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: 500,
      iiextmetadatafilter: "Artist|LicenseShortName" })).query?.pages || [];
    const text = (html) => new DOMParser().parseFromString(html || "", "text/html").body.textContent.trim();
    slides = found.map((g) => pages.find((p) => p.pageid === g.pageid)?.imageinfo?.[0]).filter((ii) => ii?.thumburl)
      .map((ii) => ({ url: ii.thumburl, caption: [text(ii.extmetadata?.Artist?.value), text(ii.extmetadata?.LicenseShortName?.value), "Wikimedia Commons"].filter(Boolean).join(" · ") }));
  }
  slideCache.set(key, slides);
  return slides;
}
async function showSlides(point) {
  clearInterval(slideTimer);
  if (slidesOff) return;
  const token = ++slideToken;
  const slides = await slidesAt(point).catch(() => []);
  if (token !== slideToken || !play) return;
  if (!slides.length) { slidesBox.hidden = true; return; }
  const [a, b] = slidesBox.querySelectorAll("img");
  let i = 0, front = a;
  const show = () => {
    const s = slides[i % slides.length];
    const back = front === a ? b : a;
    back.onload = () => { back.classList.add("on"); front.classList.remove("on"); front = back; };
    back.src = s.url;
    slidesBox.querySelector(".tr-slides-cap").textContent = s.caption;
    i++;
  };
  slidesBox.hidden = false;
  show();
  slideTimer = setInterval(show, 5000);
}
function hideSlides() {
  clearInterval(slideTimer);
  slideToken++;
  slidesBox.hidden = true;
  for (const img of slidesBox.querySelectorAll("img")) img.classList.remove("on");
}

// ---------- режим в строке поиска ----------
const MODE = { icon: svg(MAP_D, 20), title: "Экскурсии", placeholder: "Найти экскурсию", tone: "tour",
  filter: (text) => { if (text) renderList(null, text); else if (openTour) renderTour(); else renderList(currentCountry); },
  exit: () => panel.close() };

function openCountry(country, c) {
  if (c) ctx = c;
  renderList(country);
  panel.open();
  setSearchMode(MODE);
  emit("module", { id: "content/tours", on: true });
}

panel.onClose(() => {
  stopPlay();
  closeTourMap();
  currentCountry = null;
  if (searchMode() === MODE) setSearchMode(null);
  emit("module", { id: "content/tours", on: false });
});

let wired = false;
function wire() {
  if (wired || !ctx) return;
  wired = true;
  const map = ctx.map;
  // смена карты сбрасывает слои — поставить заново
  map.on("style.load", () => openTour && drawTour());
  map.on("click", "tour-stops", (e) => selectStop(e.features[0].properties.n, false));
}

register({
  id: "content/tours",
  kind: "content",
  title: "Экскурсии",
  tone: "tour",
  hint: "Наброски поездок: маршрут, точки, справка и аудиогид",
  icon: ICON,
  needs: ["network"],
  sends: "чтение экскурсий (GitHub, сайт travel-earth), названия мест (Nominatim), снимки у остановок (Wikimedia Commons), флаги (flagcdn)",
  column: {
    load: (c) => { ctx = c; wire(); return load(c); },
    items: () => countries().map(([name, n]) => ({ id: name, title: `${name} (${n})`, thumb: flagUrl(countryCode(name)) || "",
      icon: !countryCode(name) ? ICON : "", selected: currentCountry === name && isOpen("tours") })),
    choose: (country, c) => { ctx = c; wire(); openCountry(country, c); },
    isOpen: () => isOpen("tours"),
    close: () => panel.close(),
  },
  // для проверки
  stats: () => ({ tours: tours.size, countries: countries().length, open: openTour?.title || null, country: currentCountry,
    stops: openTour ? openTour.sections.filter((s) => s.n).length : 0, found: openTour ? openTour.sections.filter((s) => s.point).length : 0,
    playing: play ? play.i : null, selected }),
  // для проверки: открыть экскурсию по названию
  openByTitle: (title) => { const t = [...tours.values()].find((x) => x.title.includes(title)); if (t) { openCountry(countryOf(t)); openTourById(t.id); } return !!t; },
});

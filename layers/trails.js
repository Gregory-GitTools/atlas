// Тропы — пешие, велосипедные, МТБ (Waymarked Trails, по данным OpenStreetMap; перенос из
// travel-earth с двумя улучшениями, Грегори 2026-10-27: «обрати внимание на прорисовку пешеходных
// троп — можно ли сделать больше точек?»).
//
// Три ступени по масштабу:
//  • со шкалы «20 км» до зума 11 — готовые картинки Waymarked (тонкие, tileSize 128);
//  • с зума 11 — свои линии и таблички с номерами из списка отрезков (list/segments). Сервер
//    упрощает их сам (ST_SimplifyVW(1000) в его коде): точка примерно на 70–100 м, и параметра
//    подробности нет — поэтому тропы были угловатыми;
//  • с зума 14 (шкала ~300 м) — ПОЛНАЯ геометрия маршрутов в кадре из подробностей маршрута
//    (details/relation): точка каждые 10–30 м, как в OpenStreetMap. Местный маршрут — 2–50 КБ,
//    0,2 с; качается один раз и хранится на устройстве (кэш), после этого маршрут рисуется
//    подробно на любом масштабе, а его упрощённые отрезки прячутся.
// Пропуски: список маршрутов в квадрате сервер ограничивает сотней (в горах это предел — часть
// местных троп не приходила). Квадрат, где пришло 100, делится на четыре — пока маршруты не
// перестанут теряться или квадрат не станет совсем мелким.
//
// В панели — свой раздел «Тропы» (group: "trails"): «Тропы» и «Велодорожки» с меню видов, как у
// «Магазинов» (Грегори, 2026-10-28: «велодорожки объединить в выпадающий список»). У «Троп» меню
// по значимости — тот же цвет, что у линий: международные, национальные, региональные, местные.
import { register } from "../core/modules.js";
import { profileMenu } from "../core/profiles.js";
import { cacheGet, cacheSet } from "../core/storage.js";

const KINDS = [
  { id: "hiking", title: "Тропы", hint: "Маркированные пешеходные маршруты — вблизи подробно, с номерами",
    icon: '<g transform="rotate(-12 7 15)"><ellipse cx="7" cy="16.5" rx="2.4" ry="4"/><circle cx="5.2" cy="10.9" r="1.05"/><circle cx="7.1" cy="10.4" r=".8"/><circle cx="8.6" cy="10.9" r=".7"/><circle cx="9.6" cy="11.9" r=".6"/></g><g transform="rotate(12 17 8)"><ellipse cx="17" cy="9.5" rx="2.4" ry="4"/><circle cx="18.8" cy="3.9" r="1.05"/><circle cx="16.9" cy="3.4" r=".8"/><circle cx="15.4" cy="3.9" r=".7"/><circle cx="14.4" cy="4.9" r=".6"/></g>' },
  { id: "cycling", title: "Велодорожки", hint: "Веломаршруты",
    icon: '<path d="M18.18 10l-1.7-4.68C16.19 4.53 15.44 4 14.6 4H12v2h2.6l1.46 4h-4.81l-.36-1H12V7H7v2h1.75l1.82 5H9.9c-.44-2.23-2.31-3.88-4.65-3.99C2.45 9.87 0 12.2 0 15c0 2.8 2.2 5 5 5 2.46 0 4.45-1.69 4.9-4h4.2c.44 2.23 2.31 3.88 4.65 3.99 2.8.13 5.25-2.19 5.25-5 0-2.8-2.2-5-5-5h-.82zM7.82 16c-.4 1.17-1.49 2-2.82 2-1.68 0-3-1.32-3-3s1.32-3 3-3c1.33 0 2.42.83 2.82 2H5v2h2.82zm6.28-2h-1.4l-.73-2H15c-.44.58-.76 1.25-.9 2zm4.9 4c-1.68 0-3-1.32-3-3 0-.93.41-1.73 1.05-2.28l.96 2.64 1.88-.68-.97-2.67c.03 0 .06-.01.09-.01 1.68 0 3 1.32 3 3s-1.33 3-3.01 3z"/>' },
  { id: "mtb", title: "Маунтинбайк", hint: "Маршруты для горного велосипеда",
    icon: '<path d="M9 1.5l3.5 5h-7z"/><path d="M13.5 3.5l2.8 3h-4.2z" opacity=".75"/><path transform="translate(0 4) scale(1 .85)" d="M18.18 10l-1.7-4.68C16.19 4.53 15.44 4 14.6 4H12v2h2.6l1.46 4h-4.81l-.36-1H12V7H7v2h1.75l1.82 5H9.9c-.44-2.23-2.31-3.88-4.65-3.99C2.45 9.87 0 12.2 0 15c0 2.8 2.2 5 5 5 2.46 0 4.45-1.69 4.9-4h4.2c.44 2.23 2.31 3.88 4.65 3.99 2.8.13 5.25-2.19 5.25-5 0-2.8-2.2-5-5-5h-.82zM7.82 16c-.4 1.17-1.49 2-2.82 2-1.68 0-3-1.32-3-3s1.32-3 3-3c1.33 0 2.42.83 2.82 2H5v2h2.82zm6.28-2h-1.4l-.73-2H15c-.44.58-.76 1.25-.9 2zm4.9 4c-1.68 0-3-1.32-3-3 0-.93.41-1.73 1.05-2.28l.96 2.64 1.88-.68-.97-2.67c.03 0 .06-.01.09-.01 1.68 0 3 1.32 3 3s-1.33 3-3.01 3z"/>' },
];
const chipIcon = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${inner}</svg>`;

const RASTER_MAX_M_PER_100PX = 40000; // картинки — со шкалы «20 км» (Грегори, travel-earth 2026-10-01)
const VECTOR_ZOOM = 11; // свои линии с номерами
const DETAIL_ZOOM = 14; // полная геометрия маршрутов в кадре
const CELL = 0.1; // квадрат списка маршрутов, градусы
const MIN_CELL = 0.0125; // мельче не делим (1/8 квадрата)
const LIST_LIMIT = 100; // предел сервера на список маршрутов
const MAX_CELLS = 40;
const STREAMS = 3;
const MAX_DETAIL = 25; // маршрутов с полной геометрией за один раз
const RETRY_MS = 30000;
const NAME_MAX = 16;
// цвет по значимости маршрута (group у Waymarked): международный, национальный, региональный, местный
const LEVELS = { INT: { color: "#c62828", rank: 4 }, NAT: { color: "#1e53c7", rank: 3 }, REG: { color: "#ef8a00", rank: 2 }, LOC: { color: "#8e24aa", rank: 1 } };

// Waymarked считает в метрах проекции Меркатора
const toMerc = ([lng, lat]) => [(lng * 20037508.34) / 180, Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 6378137];
const fromMerc = ([x, y]) => [(x * 180) / 20037508.34, (Math.atan(Math.exp(y / 6378137)) * 360) / Math.PI - 90];
const zoomForScale = (map, m) => Math.log2((100 * 40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * m));

async function api(kind, path) {
  const res = await fetch(`https://${kind}.waymarkedtrails.org/api/v1/${path}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Waymarked Trails: ${res.status}`);
  return res.json();
}

// все линии маршрута из подробностей: вложенные main / appendices / alternatives → ways[].geometry
function collectWays(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) collectWays(n, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (node.geometry?.type === "LineString") out.push(node.geometry.coordinates);
  else if (node.geometry?.type === "MultiLineString") out.push(...node.geometry.coordinates);
  for (const key of ["route", "main", "appendices", "alternatives", "ways"]) if (node[key]) collectWays(node[key], out);
  return out;
}

function makeKind(kind) {
  const src = `trails-${kind.id}`;
  const rasterLayer = `trails-${kind.id}-raster`;
  const lineLayer = `trails-${kind.id}-line`;
  const labelLayer = `trails-${kind.id}-label`;
  const cells = new Map(); // "x:y:размер" → true | "loading" | когда повторить
  const routes = new Map(); // id → { color, rank, label }
  const segs = new Map(); // "route:cell:i" → feature (упрощённые)
  const full = new Map(); // route → [feature] (полная геометрия)
  const fullState = new Map(); // route → "loading" | true | когда повторить
  let queues = Array.from({ length: STREAMS }, () => Promise.resolve());
  let next = 0, dirty = false, map = null, status = () => {}, on_ = false, wired = false;
  let ranks = null; // показывать только маршруты такой значимости (null — все)

  // фильтр по значимости — только своим линиям и табличкам; готовые картинки издалека не делятся
  // (Грегори, 2026-10-28: «показывать издалека все тропы»)
  const applyFilter = () => {
    if (!map?.getLayer(lineLayer)) return;
    const only = ranks && ["in", ["get", "rank"], ["literal", ranks]];
    map.setFilter(lineLayer, only || null);
    map.setFilter(labelLayer, only ? ["all", ["has", "label"], only] : ["has", "label"]);
  };

  const props = (id) => routes.get(id) || { color: LEVELS.LOC.color, rank: 1 };
  const data = () => ({ type: "FeatureCollection", features: [...[...segs.values()].filter((f) => !full.has(f.properties.route)), ...[...full.values()].flat()] });
  const push = () => { dirty = false; map?.getSource(src)?.setData(data()); };
  const later = () => { if (!dirty) { dirty = true; requestAnimationFrame(push); } };

  function addLayers() {
    if (map.getSource(src)) return;
    const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    map.addSource(`${src}-raster`, { type: "raster", tileSize: 128, maxzoom: 18,
      tiles: [`https://tile.waymarkedtrails.org/${kind.id}/{z}/{x}/{y}.png`],
      attribution: 'Маршруты: <a href="https://waymarkedtrails.org" target="_blank">Waymarked Trails</a> (CC BY-SA)' });
    map.addLayer({ id: rasterLayer, type: "raster", source: `${src}-raster`, minzoom: Math.min(VECTOR_ZOOM, zoomForScale(map, RASTER_MAX_M_PER_100PX)), maxzoom: VECTOR_ZOOM }, firstSymbol);
    map.addSource(src, { type: "geojson", data: data(), tolerance: 0.2 }); // почти без упрощения — точки не теряем
    map.addLayer({ id: lineLayer, type: "line", source: src, minzoom: VECTOR_ZOOM,
      layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "rank"] },
      paint: { "line-color": ["get", "color"], "line-opacity": 0.85,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 12, 1.8, 14, 2.5, 17, 4, 20, 6] } }, firstSymbol);
    for (const l of Object.values(LEVELS)) plate(l.color);
    const font = map.getStyle().layers.find((l) => l.type === "symbol" && Array.isArray(l.layout?.["text-font"]))?.layout["text-font"] || ["Noto Sans Regular"];
    // номер — на табличке цвета маршрута, всегда горизонтально (вдоль петляющей тропы текст не встаёт)
    map.addLayer({ id: labelLayer, type: "symbol", source: src, minzoom: VECTOR_ZOOM, filter: ["has", "label"],
      layout: { "symbol-placement": "line", "symbol-spacing": 200, "text-max-angle": 360,
        "text-rotation-alignment": "viewport", "icon-rotation-alignment": "viewport",
        "text-field": ["get", "label"], "text-font": font, "text-max-width": 12,
        "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 12, 11, 14, 12, 17, 15, 20, 20],
        "icon-image": ["concat", "plate-", ["get", "color"]], "icon-text-fit": "both", "icon-text-fit-padding": [1, 3, 0, 3] },
      paint: { "text-color": "#fff" } });
    applyFilter();
  }

  function plate(color) {
    const id = `plate-${color}`;
    if (map.hasImage(id)) return;
    const s = 24;
    const ctx = Object.assign(document.createElement("canvas"), { width: s, height: s }).getContext("2d");
    ctx.beginPath();
    ctx.roundRect(0, 0, s, s, 6);
    ctx.fillStyle = color;
    ctx.fill();
    map.addImage(id, ctx.getImageData(0, 0, s, s), { pixelRatio: 2, stretchX: [[8, 16]], stretchY: [[8, 16]], content: [6, 5, 18, 19] });
  }

  function removeLayers() {
    for (const id of [labelLayer, lineLayer, rasterLayer]) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [src, `${src}-raster`]) if (map.getSource(id)) map.removeSource(id);
  }

  async function loadCell(x, y, size) {
    const key = `${x}:${y}:${size}`;
    const w = x * size, s = y * size;
    const bbox = [...toMerc([w, s]), ...toMerc([w + size, s + size])].map(Math.round).join(",");
    try {
      const list = (await api(kind.id, `list/by_area?bbox=${bbox}&limit=${LIST_LIMIT}`)).results;
      for (const r of list) {
        const level = LEVELS[r.group] || LEVELS.LOC;
        const label = r.ref || (r.name?.length <= NAME_MAX && r.name) || undefined;
        routes.set(r.id, { color: level.color, rank: level.rank, ...(label && { label }) });
      }
      // упёрлись в предел сервера — часть маршрутов не пришла: делим квадрат на четыре
      if (list.length >= LIST_LIMIT && size / 2 >= MIN_CELL) {
        cells.set(key, true);
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) enqueue(x * 2 + dx, y * 2 + dy, size / 2);
        return;
      }
      const features = list.length ? (await api(kind.id, `list/segments?bbox=${bbox}&relations=${list.map((r) => r.id).join(",")}`)).features : [];
      for (const seg of features) {
        const lines = seg.geometry.type === "LineString" ? [seg.geometry.coordinates] : seg.geometry.coordinates;
        lines.forEach((line, i) => segs.set(`${seg.id}:${key}:${i}`, { type: "Feature",
          geometry: { type: "LineString", coordinates: line.map(fromMerc) }, properties: { route: seg.id, ...props(seg.id) } }));
      }
      cells.set(key, true);
      later();
    } catch {
      cells.set(key, Date.now() + RETRY_MS);
      setTimeout(update, RETRY_MS + 100);
      status("Тропы сейчас не загрузились — сервер занят, чуть позже попробую ещё раз");
    }
  }

  function enqueue(x, y, size) {
    const key = `${x}:${y}:${size}`;
    const st = cells.get(key);
    if (st === true || st === "loading" || st > Date.now()) return;
    cells.set(key, "loading");
    const q = next++ % STREAMS;
    queues[q] = queues[q].then(() => on_ && loadCell(x, y, size));
  }

  // полная геометрия маршрута: из кэша устройства или с сервера (один раз)
  async function loadFull(id) {
    fullState.set(id, "loading");
    try {
      const cacheKey = `trail:${kind.id}:${id}`;
      let lines = await cacheGet(cacheKey);
      if (!lines) {
        const details = await api(kind.id, `details/relation/${id}`);
        lines = collectWays(details).map((l) => l.map(fromMerc).map(([lng, lat]) => [+lng.toFixed(6), +lat.toFixed(6)]));
        await cacheSet(cacheKey, lines).catch(() => {});
      }
      full.set(id, lines.map((coords) => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { route: id, full: true, ...props(id) } })));
      fullState.set(id, true);
      later();
    } catch {
      fullState.set(id, Date.now() + RETRY_MS);
    }
  }

  function update() {
    if (!on_ || !map) return;
    if (map.getLayer(rasterLayer)) map.setLayerZoomRange(rasterLayer, Math.min(VECTOR_ZOOM, zoomForScale(map, RASTER_MAX_M_PER_100PX)), VECTOR_ZOOM);
    if (map.getZoom() < VECTOR_ZOOM) return;
    const c = map.getCenter(), b = map.getBounds();
    // у наклонённой карты граница уходит к горизонту — не дальше полуградуса от центра
    const range = (min, max, v) => [Math.floor(Math.max(min, v - 0.5) / CELL), Math.floor(Math.min(max, v + 0.5) / CELL)];
    const [x0, x1] = range(b.getWest(), b.getEast(), c.lng);
    const [y0, y1] = range(b.getSouth(), b.getNorth(), c.lat);
    const list = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) list.push([x, y, Math.hypot((x + 0.5) * CELL - c.lng, (y + 0.5) * CELL - c.lat)]);
    list.sort((a, b2) => a[2] - b2[2]);
    for (const [x, y] of list.slice(0, MAX_CELLS)) enqueue(x, y, CELL);
    // вблизи — полная геометрия маршрутов, которые сейчас видны
    if (map.getZoom() < DETAIL_ZOOM || !map.getLayer(lineLayer)) return;
    const visible = new Set(map.queryRenderedFeatures({ layers: [lineLayer] }).map((f) => f.properties.route));
    let started = 0;
    for (const id of visible) {
      const st = fullState.get(id);
      if (st === true || st === "loading" || st > Date.now()) continue;
      if (started++ >= MAX_DETAIL) break;
      loadFull(id);
    }
  }

  return {
    kind,
    get on() { return on_; },
    setRanks(r) { ranks = r; applyFilter(); },
    enable(ctx) {
      map = ctx.map;
      status = ctx.status;
      on_ = true;
      if (!wired) {
        wired = true;
        map.on("idle", update);
      }
      addLayers();
      update();
    },
    disable() {
      on_ = false;
      queues = Array.from({ length: STREAMS }, () => Promise.resolve());
      for (const [k, v] of cells) if (v === "loading") cells.delete(k);
      removeLayers();
    },
    // для проверки: сколько точек на маршрут — упрощённо и полностью
    stats: () => ({ routes: routes.size, segs: segs.size, full: full.size,
      segPoints: [...segs.values()].reduce((n, f) => n + f.geometry.coordinates.length, 0),
      fullPoints: [...full.values()].flat().reduce((n, f) => n + f.geometry.coordinates.length, 0) }),
  };
}

const [hiking, cycling, mtb] = KINDS.map(makeKind);
const common = { kind: "layer", group: "trails", needs: ["network"], sends: "район карты (Waymarked Trails)" };

const HIKING_PROFILES = [
  { id: "all", name: "Все тропы", ranks: null },
  { id: "int", name: "Международные", ranks: [LEVELS.INT.rank] },
  { id: "nat", name: "Национальные", ranks: [LEVELS.NAT.rank] },
  { id: "reg", name: "Региональные", ranks: [LEVELS.REG.rank] },
  { id: "loc", name: "Местные", ranks: [LEVELS.LOC.rank] },
];
const hikingProf = profileMenu("trails.hiking.profile", HIKING_PROFILES, "Тропы");
// значимости отмеченных видов вместе; «Все тропы» — без фильтра
const hikingRanks = () => { const s = hikingProf.selected(); return s.some((p) => !p.ranks) ? null : s.flatMap((p) => p.ranks); };

register({
  ...common,
  id: "trails/hiking",
  title: hiking.kind.title,
  hint: hiking.kind.hint,
  icon: chipIcon(hiking.kind.icon),
  menu: hikingProf.menu,
  enable(ctx) {
    hiking.enable(ctx);
    hiking.setRanks(hikingRanks());
  },
  disable: hiking.disable,
  stats: hiking.stats,
});

// велодорожки — одна кнопка, вид выбирается в меню и помнится
const BIKE_PROFILES = [
  { id: "all", name: "Все велодорожки", kinds: [cycling, mtb] },
  { id: "cycling", name: "Веломаршруты", kinds: [cycling] },
  { id: "mtb", name: "Маунтинбайк", kinds: [mtb] },
];
const bikeProf = profileMenu("trails.cycling.profile", BIKE_PROFILES, "Велодорожки");

register({
  ...common,
  id: "trails/cycling",
  title: cycling.kind.title,
  hint: "Веломаршруты и маршруты для горного велосипеда",
  icon: chipIcon(cycling.kind.icon),
  menu: bikeProf.menu,
  // повторное включение — смена вида: лишнее выключить, нужное включить
  enable(ctx) {
    const want = bikeProf.selected().flatMap((p) => p.kinds);
    for (const k of [cycling, mtb]) {
      if (want.includes(k)) k.enable(ctx);
      else if (k.on) k.disable();
    }
  },
  disable() {
    for (const k of [cycling, mtb]) if (k.on) k.disable();
  },
});

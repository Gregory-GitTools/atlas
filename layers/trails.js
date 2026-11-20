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
import { register, modules, toggle } from "../core/modules.js";
import { profileMenu } from "../core/profiles.js";
import { cacheGet, cacheSet } from "../core/storage.js";
import { on } from "../core/events.js";
import { track, claimLayersNear, nearBox, ownHit, closeAll } from "../core/popups.js";
import { qleverBox, cellsInView, cellLoader } from "../core/qlever.js";
import { withWeather } from "../core/place-info.js";

const KINDS = [
  // пешеход с рюкзаком и палкой (Грегори, 2026-10-29, по картинке; босые стопы были «похожи на кальмара»)
  { id: "hiking", title: "Тропы", hint: "Маркированные пешеходные маршруты — вблизи подробно, с номерами",
    icon: '<circle cx="14.4" cy="3.3" r="2.1"/><rect x="5.3" y="5.6" width="4.4" height="6.6" rx=".9" transform="rotate(16 7.5 8.9)"/><rect x="7.7" y="3.2" width="2.8" height="1.9" rx=".6" transform="rotate(16 9.1 4.1)"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12.8 7.2 10.7 13.4" stroke-width="3.4"/><path d="M13.2 7.6l1.6 2.8h2.8" stroke-width="2"/><path d="M10.6 13.4 7 20.8M10.9 13.6l2.3 4v3.8" stroke-width="2.6"/><path d="M18.4 5.2 16.2 22.4" stroke-width=".9"/></g>' },
  { id: "cycling", title: "Велодорожки", hint: "Веломаршруты",
    icon: '<path d="M18.18 10l-1.7-4.68C16.19 4.53 15.44 4 14.6 4H12v2h2.6l1.46 4h-4.81l-.36-1H12V7H7v2h1.75l1.82 5H9.9c-.44-2.23-2.31-3.88-4.65-3.99C2.45 9.87 0 12.2 0 15c0 2.8 2.2 5 5 5 2.46 0 4.45-1.69 4.9-4h4.2c.44 2.23 2.31 3.88 4.65 3.99 2.8.13 5.25-2.19 5.25-5 0-2.8-2.2-5-5-5h-.82zM7.82 16c-.4 1.17-1.49 2-2.82 2-1.68 0-3-1.32-3-3s1.32-3 3-3c1.33 0 2.42.83 2.82 2H5v2h2.82zm6.28-2h-1.4l-.73-2H15c-.44.58-.76 1.25-.9 2zm4.9 4c-1.68 0-3-1.32-3-3 0-.93.41-1.73 1.05-2.28l.96 2.64 1.88-.68-.97-2.67c.03 0 .06-.01.09-.01 1.68 0 3 1.32 3 3s-1.33 3-3.01 3z"/>' },
  // велосипед в гору на наклонной полоске дороги (Грегори, 2026-10-29, по картинке; горки над ним
  // налезали на руль — убраны, подъём и так виден)
  { id: "mtb", title: "Маунтинбайк", hint: "Маршруты для горного велосипеда",
    icon: '<g transform="rotate(-14 5 16)"><g transform="translate(.75 3.25) scale(.85)"><path d="M18.18 10l-1.7-4.68C16.19 4.53 15.44 4 14.6 4H12v2h2.6l1.46 4h-4.81l-.36-1H12V7H7v2h1.75l1.82 5H9.9c-.44-2.23-2.31-3.88-4.65-3.99C2.45 9.87 0 12.2 0 15c0 2.8 2.2 5 5 5 2.46 0 4.45-1.69 4.9-4h4.2c.44 2.23 2.31 3.88 4.65 3.99 2.8.13 5.25-2.19 5.25-5 0-2.8-2.2-5-5-5h-.82zM7.82 16c-.4 1.17-1.49 2-2.82 2-1.68 0-3-1.32-3-3s1.32-3 3-3c1.33 0 2.42.83 2.82 2H5v2h2.82zm6.28-2h-1.4l-.73-2H15c-.44.58-.76 1.25-.9 2zm4.9 4c-1.68 0-3-1.32-3-3 0-.93.41-1.73 1.05-2.28l.96 2.64 1.88-.68-.97-2.67c.03 0 .06-.01.09-.01 1.68 0 3 1.32 3 3s-1.33 3-3.01 3z"/></g></g><path d="M.5 22.1 23.5 16.1v1.5L.5 23.6z"/>' },
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

// у вида — цвет линий на карте: кольцо вокруг значка в меню «Слои»
// у видов — обувь сбоку, от тяжёлой к лёгкой (Грегори, 2026-10-29: «на разных кнопках профиль разной обуви»):
// международные — высокий трекинговый ботинок, национальные — ботинок пониже, региональные — кроссовок,
// местные — носок (кроссовок и носок — по картинкам Грегори, 2026-10-29)
const SHOES = {
  int: '<path fill-rule="evenodd" d="M5 3.6h6.2l.6 7.4c3.4.6 7.6 1.8 9.2 3.8.8 1 .9 2 .9 3.1H3.9l.6-6.6zM8.6 5.4h2.6v.8H8.6zM8.6 7.4h2.6v.8H8.6zM8.6 9.4h2.6v.8H8.6zM8.6 11.4h2.6v.8H8.6z"/><path d="M3.6 18.6h18.8v1.6h-1.2v1.2h-2.4v-1.2h-2.2v1.2h-2.4v-1.2h-2.2v1.2H9.6v-1.2H7.4v1.2H5v-1.2H3.6z"/>',
  nat: '<path fill-rule="evenodd" d="M5.2 7.6h5.8l.5 4.6c3.2.5 7.2 1.6 8.8 3.4.7.8.8 1.5.8 2.3H4.2l.5-5zM8.6 9.4h2.6v.8H8.6zM8.6 11.6h2.6v.8H8.6z"/><path d="M3.8 18.6h18.2v1.6h-1.4v1H18v-1h-2.6v1h-2.6v-1h-2.6v1H7.6v-1H5v1H3.8z"/>',
  reg: '<rect x=".5" y="16.6" width="23" height="2" rx="1"/><path fill-rule="evenodd" d="M.5 7.6c0-1.3 1-2 2.2-1.4.8.4 1.4 1.6 1.9 2.8.7 1.6 2 2.2 3.8 1.6C10 10 9.3 7.6 9.3 6c0-.6.7-.6 1 0 1.6 3.4 4.4 5.4 8.4 6.4 2.4.6 4.8 1.2 4.8 2.6v.6H.5zM.5 8.7h2.4v1H.5zM10.4 15.6l2.4-4.2h1.2l-2.4 4.2zM13 15.6l1.6-2.8h1.2l-1.6 2.8zM15.6 15.6l.8-1.4h1.2l-.8 1.4z"/>',
  loc: '<path d="M4.5 1.5h8v2.6h-8z"/><path d="M4.6 5H12.4V12.4c0 1 .7 1.6 1.8 2l2.6.9c-1.4 1.6-2 3.8-2 6.7H9.2c0-3.6-1.6-6.6-4.8-8.4z"/><path d="M4.2 14.7c2.6 1.6 3.9 4.2 3.9 7.3H7.4C5.2 22 3.8 20 4 17.8z"/><path d="M18.2 15.8c2.4.9 3.6 3 3 5.8L21.4 22h-5.4c0-2.6.6-4.6 2.2-6.2z"/>',
};
const HIKING_PROFILES = [
  { id: "int", name: "Международные", color: LEVELS.INT.color, ranks: [LEVELS.INT.rank] },
  { id: "nat", name: "Национальные", color: LEVELS.NAT.color, ranks: [LEVELS.NAT.rank] },
  { id: "reg", name: "Региональные", color: LEVELS.REG.color, ranks: [LEVELS.REG.rank] },
  { id: "loc", name: "Местные", color: LEVELS.LOC.color, ranks: [LEVELS.LOC.rank] },
].map((p) => ({ ...p, icon: chipIcon(SHOES[p.id]) }));
const hikingProf = profileMenu("trails.hiking.profile", HIKING_PROFILES, "Тропы");
// значимости отмеченных видов вместе; отмечены все — без фильтра
const hikingRanks = () => { const s = hikingProf.selected(); return s.length === HIKING_PROFILES.length ? null : s.flatMap((p) => p.ranks); };

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
  { id: "cycling", name: "Веломаршруты", icon: chipIcon(KINDS[1].icon), kinds: [cycling] },
  { id: "mtb", name: "Маунтинбайк", icon: chipIcon(KINDS[2].icon), kinds: [mtb] },
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

// Горнолыжные спуски (Грегори 2026-11-13: «на кнопке тропы горнолыжные спуски, и они всегда идут с канатными
// подъёмниками; кнопки можно увязать, но не канатные дороги с горнолыжными спусками»). Включились спуски —
// включаются и «Канатные дороги» в «Транспорте» (станции и тросы гондол); канатные дороги спуски не включают.
// Издалека (до зума 11) — готовые картинки Waymarked Trails. Вблизи — свои линии из OpenStreetMap (QLever,
// квадратами по 0,2°, хранятся на устройстве и попадают в «Скачать район»): Грегори 2026-11-15, сценарий —
// облако на 2800 м, видимость 5 м, подъёмники закрываются: «лучше просто линии, стрелки просто поверх, номера
// спусков должны быть видны через запотевшие лыжные очки, притянуть на карту номера подъёмников и информацию
// по клику». Линии — одной толщины на любом масштабе, цвет — сложность (зелёная, синяя, красная, чёрная;
// вне трассы — оранжевый пунктир), стрелка — куда спуск (в OSM спуск рисуют сверху вниз). Номер трассы —
// крупная табличка цвета трассы с белым кантом, всегда стоит прямо к экрану (и на наклонённой 3D-карте);
// подъёмник — тёмная табличка с номером (нет номера — с названием). Щелчок — окно с погодой места
const SLOPES_ICON = '<circle cx="15.6" cy="3.4" r="2.1"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M13.6 7.4 9.8 12.6" stroke-width="3.8"/><path d="M9.8 12.6l3.4 2.6-2 4" stroke-width="3"/><path d="M12.6 8.6l4.2 2.6" stroke-width="2.2"/><path d="M16.8 11.2 19.4 19" stroke-width="1.1"/><path d="M2.4 17.6l18.8 4.4" stroke-width="2"/></g>';
const SLOPES_SRC = "trails-slopes", SLOPES_LAYER = "trails-slopes-raster";
const SKI_SRC = "trails-slopes-lines", SKI_LABELS_SRC = "trails-slopes-labels";
const PISTE_CASE = "trails-slopes-case", PISTE_LINE = "trails-slopes-line", PISTE_OFF = "trails-slopes-offpiste",
  PISTE_ARROWS = "trails-slopes-arrows", PISTE_LABELS = "trails-slopes-numbers",
  LIFTS_LAYER = "trails-slopes-lifts-line", LIFT_LABELS = "trails-slopes-lift-numbers";
const SKI_LAYERS = [LIFT_LABELS, PISTE_LABELS, PISTE_ARROWS, LIFTS_LAYER, PISTE_OFF, PISTE_LINE, PISTE_CASE];
const GONDOLAS = ["cable_car", "gondola", "mixed_lift"]; // их тросы рисуют «Канатные дороги» (places.js)
const SKI_ZOOM = 11, SKI_CELL = 0.2, SKI_FRESH_MS = 30 * 864e5, TAP = 10;
const PISTE_COLORS = { novice: "#2e9d3a", easy: "#1565c0", intermediate: "#d32f2f", advanced: "#111111", expert: "#111111",
  freeride: "#ef6c00", extreme: "#ef6c00" };
const OTHER_COLOR = "#ef6c00", NO_DIFF_COLOR = "#616161", LIFT_COLOR = "#222222";
const OFF_PISTE = ["freeride", "extreme"];
const PISTE_KIND = { downhill: "Горнолыжный спуск", nordic: "Беговая лыжня", sled: "Санная трасса", skitour: "Ски-тур",
  hike: "Зимняя пешая тропа", connection: "Переход между трассами", playground: "Детская площадка", snow_park: "Сноупарк", fatbike: "Трасса для фэтбайка" };
const PISTE_DIFF = { novice: "для начинающих (зелёная)", easy: "лёгкая (синяя)", intermediate: "средняя (красная)", advanced: "сложная (чёрная)",
  expert: "очень сложная", freeride: "вне трассы — не готовится и не патрулируется", extreme: "экстремальная — вне трассы" };
const GROOMING = { classic: "классический ход", skating: "коньковый ход", "classic+skating": "классический и коньковый ход",
  "classic;skating": "классический и коньковый ход", mogul: "бугры", backcountry: "не готовится" };
const LIFT_KIND = { chair_lift: "Кресельный подъёмник", gondola: "Гондола", cable_car: "Канатная дорога", mixed_lift: "Кресла и кабины",
  "t-bar": "Бугель (якорь)", "j-bar": "Бугель (одноместный)", platter: "Бугель (тарелка)", drag_lift: "Бугельный подъёмник",
  rope_tow: "Верёвочный подъёмник", magic_carpet: "Лента-траволатор", zip_line: "Зиплайн" };
const SKI_SPARQL = `{ ?osm osmkey:piste:type ?kind . FILTER (?kind != "ice_skate") BIND("piste" AS ?what)
    OPTIONAL { ?osm osmkey:piste:difficulty ?diff } OPTIONAL { ?osm osmkey:piste:ref ?ref } OPTIONAL { ?osm osmkey:ref ?ref2 }
    OPTIONAL { ?osm osmkey:piste:name ?name } OPTIONAL { ?osm osmkey:name ?name2 } OPTIONAL { ?osm osmkey:piste:grooming ?groom } }
  UNION { ?osm osmkey:aerialway ?kind . FILTER (?kind NOT IN ("station", "pylon", "goods")) BIND("lift" AS ?what)
    OPTIONAL { ?osm osmkey:ref ?ref } OPTIONAL { ?osm osmkey:name ?name } OPTIONAL { ?osm osmkey:aerialway:occupancy ?occ }
    OPTIONAL { ?osm osmkey:aerialway:capacity ?cap } OPTIONAL { ?osm osmkey:aerialway:duration ?dur } OPTIONAL { ?osm osmkey:opening_hours ?oh }
    OPTIONAL { ?osm osmkey:aerialway:heating ?heat } OPTIONAL { ?osm osmkey:aerialway:bubble ?bub } }`;
let slopesMap = null, skiCtx = null, skiOn = false, skiWired = false;
const pistes = new Map(), lifts = new Map(); // osm → запись из квадрата

// длина линии в метрах и точки через каждые step метров (первая — в first от начала)
const metres = ([a, b], [c, d]) => Math.hypot((c - a) * Math.cos(((b + d) * Math.PI) / 360), d - b) * 111320;
const lineLength = (line) => line.reduce((s, p, i) => (i ? s + metres(line[i - 1], p) : 0), 0);
function pointsAlong(line, first, step) {
  const out = [];
  let want = first, done = 0;
  for (let i = 1; i < line.length; i++) {
    const d = metres(line[i - 1], line[i]);
    while (d > 0 && want <= done + d) {
      const t = (want - done) / d;
      out.push([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]);
      want += step;
    }
    done += d;
  }
  return out;
}

// ответ QLever → записи квадрата (компактно, для хранения на устройстве)
function skiRecords(rows) {
  const byOsm = new Map();
  for (const { osm, b } of rows) {
    const v = (k) => b[k]?.value;
    const lines = [...b.wkt.value.matchAll(/\(([^()]+)\)/g)].map((m) => m[1].split(",").map((p) => p.trim().split(/\s+/).map((n) => +(+n).toFixed(5))));
    if (!lines.length) continue;
    const kind = v("kind").split(";")[0];
    if (v("what") === "lift") {
      if (osm.startsWith("way/")) byOsm.set(osm, { lift: true, osm, kind, ref: v("ref"), name: v("name"), occ: v("occ"), cap: v("cap"), dur: v("dur"),
        oh: v("oh"), heat: v("heat"), bub: v("bub"), line: lines[0] });
    } else {
      const ref = v("ref") || v("ref2");
      // отношения повторяют свои линии — нужны только ради номера, если он записан у отношения
      if (osm.startsWith("relation/") && !ref) continue;
      byOsm.set(osm, { osm, kind, diff: v("diff"), ref, name: v("name") || v("name2"), groom: v("groom"),
        area: /^(MULTI)?POLYGON/.test(b.wkt.value), labelOnly: osm.startsWith("relation/"), lines });
    }
  }
  return [...byOsm.values()];
}

const pisteColor = (p) => (["downhill", "playground", "connection"].includes(p.kind)
  ? PISTE_COLORS[p.diff] || (p.kind === "playground" ? PISTE_COLORS.novice : NO_DIFF_COLOR) : OFF_PISTE.includes(p.diff) ? PISTE_COLORS[p.diff] : OTHER_COLOR);

function skiData() {
  const lines = [], labels = [];
  for (const p of pistes.values()) {
    const off = OFF_PISTE.includes(p.diff);
    const props = { osm: p.osm, color: pisteColor(p), off, arrows: (p.kind === "downhill" || p.kind === "sled") && !p.area && !off };
    if (!p.labelOnly) for (const line of p.lines) lines.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: props });
    if (!p.ref) continue;
    // номер — в 60 м от начала спуска (у самого начала сходятся несколько трасс) и дальше каждые 400 м
    for (const line of p.lines) {
      const len = lineLength(line);
      for (const c of pointsAlong(line, Math.min(60, len / 2), 400)) labels.push({ type: "Feature", geometry: { type: "Point", coordinates: c },
        properties: { osm: p.osm, label: p.ref, badge: `slope-badge-${props.color}` } });
    }
  }
  for (const l of lifts.values()) {
    lines.push({ type: "Feature", geometry: { type: "LineString", coordinates: l.line }, properties: { osm: l.osm, lift: true, kind: l.kind } });
    const label = l.ref || (l.name?.length <= NAME_MAX && l.name) || null;
    const mid = pointsAlong(l.line, lineLength(l.line) / 2, 1e9)[0];
    if (label && mid) labels.push({ type: "Feature", geometry: { type: "Point", coordinates: mid }, properties: { osm: l.osm, lift: true, label, badge: `slope-badge-${LIFT_COLOR}` } });
  }
  return { lines: { type: "FeatureCollection", features: lines }, labels: { type: "FeatureCollection", features: labels } };
}
let skiDirty = false;
const skiPush = () => {
  if (skiDirty) return;
  skiDirty = true;
  requestAnimationFrame(() => {
    skiDirty = false;
    const d = skiData();
    slopesMap?.getSource(SKI_SRC)?.setData(d.lines);
    slopesMap?.getSource(SKI_LABELS_SRC)?.setData(d.labels);
  });
};

// квадрат: с устройства (свежий — не старше месяца) или из QLever; без сети — и старый
const skiKey = (box) => `slopes:${box[0]}:${box[1]}`;
async function skiCell(box) {
  const key = skiKey(box), kept = await cacheGet(key).catch(() => null);
  let recs = kept?.recs;
  if (!kept || Date.now() - kept.t > SKI_FRESH_MS) {
    try {
      recs = skiRecords(await qleverBox("?wkt ?what ?diff ?ref ?ref2 ?name ?name2 ?groom ?occ ?cap ?dur ?oh ?heat ?bub", SKI_SPARQL, box, 60000));
      await cacheSet(key, { t: Date.now(), recs }).catch(() => {});
    } catch (err) { if (!recs) throw err; }
  }
  return recs;
}
const skiLoader = cellLoader(SKI_CELL, async (box) => {
  for (const r of await skiCell(box)) (r.lift ? lifts : pistes).set(r.osm, r);
  skiPush();
}, () => skiUpdate());
function skiUpdate() {
  if (skiOn && slopesMap && slopesMap.getZoom() >= SKI_ZOOM) skiLoader.request(cellsInView(slopesMap, SKI_CELL, 0.3));
}

// трассы и подъёмники вокруг точки — для предупреждения «вне трассы» при записи трека (content/tracks.js →
// приложение Android): квадраты 3×3 (около 45 × 65 км в Альпах), с устройства или из QLever. Своя трасса —
// любая, кроме «вне трассы» (freeride, extreme), ски-тура и зимней тропы; подъёмник — тоже своё место.
// Линии и контуры площадных трасс — плоскими рядами «lon, lat, lon, lat…»
const NOT_PISTE = ["skitour", "hike"];
export async function slopesNear(lon, lat) {
  const x0 = Math.floor(lon / SKI_CELL), y0 = Math.floor(lat / SKI_CELL), seen = new Set(), lines = [], areas = [];
  let failed = 0;
  for (let x = x0 - 1; x <= x0 + 1; x++) for (let y = y0 - 1; y <= y0 + 1; y++) {
    const box = [x * SKI_CELL, y * SKI_CELL, (x + 1) * SKI_CELL, (y + 1) * SKI_CELL].map((v) => +v.toFixed(3));
    const recs = await skiCell(box).catch(() => null);
    if (!recs) { failed++; continue; }
    for (const r of recs) {
      if (seen.has(r.osm) || r.labelOnly || NOT_PISTE.includes(r.kind) || OFF_PISTE.includes(r.diff)) continue;
      seen.add(r.osm);
      for (const line of r.lift ? [r.line] : r.lines) (r.area ? areas : lines).push(line.flat());
    }
  }
  return { lines, areas, failed };
}

// «Скачать район» при включённых спусках — и спуски с подъёмниками района
on("trip-prepare", (job) => {
  if (!skiOn) return;
  job.tasks.push((async () => {
    const [w, s, e, n] = job.box, keys = [];
    for (let x = Math.floor(w / SKI_CELL); x <= Math.floor(e / SKI_CELL) && keys.length < 60; x++) {
      for (let y = Math.floor(s / SKI_CELL); y <= Math.floor(n / SKI_CELL) && keys.length < 60; y++) {
        if (job.stopped) return { keys };
        const box = [x * SKI_CELL, y * SKI_CELL, (x + 1) * SKI_CELL, (y + 1) * SKI_CELL].map((v) => +v.toFixed(3));
        if (await skiCell(box).then(() => true, () => false)) keys.push(skiKey(box));
      }
    }
    return { keys };
  })());
}, { replay: false });

// табличка номера: цвет трассы, белый кант; растягивается по длине номера
function skiBadge(map, color) {
  const id = `slope-badge-${color}`;
  if (map.hasImage(id)) return;
  const s = 32, c = Object.assign(document.createElement("canvas"), { width: s, height: s }).getContext("2d");
  c.beginPath();
  c.roundRect(2, 2, s - 4, s - 4, 8);
  c.fillStyle = color;
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = "#fff";
  c.stroke();
  map.addImage(id, c.getImageData(0, 0, s, s), { pixelRatio: 2, stretchX: [[11, 21]], stretchY: [[11, 21]], content: [8, 7, 24, 25] });
}
// стрелка вдоль линии: белый уголок с тёмным контуром
function skiArrow(map) {
  if (map.hasImage("slope-arrow")) return;
  const s = 28, c = Object.assign(document.createElement("canvas"), { width: s, height: s }).getContext("2d");
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  c.moveTo(8, 6);
  c.lineTo(19, 14);
  c.lineTo(8, 22);
  c.strokeStyle = "#000";
  c.lineWidth = 8;
  c.stroke();
  c.strokeStyle = "#fff";
  c.lineWidth = 4.5;
  c.stroke();
  map.addImage("slope-arrow", c.getImageData(0, 0, s, s), { pixelRatio: 2 });
}

function slopesOn(map) {
  if (map.getSource(SLOPES_SRC)) return;
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  map.addSource(SLOPES_SRC, { type: "raster", tileSize: 256, maxzoom: 17, tiles: ["https://tile.waymarkedtrails.org/slopes/{z}/{x}/{y}.png"],
    attribution: 'Спуски: <a href="https://waymarkedtrails.org" target="_blank">Waymarked Trails</a> (CC BY-SA)' });
  map.addLayer({ id: SLOPES_LAYER, type: "raster", source: SLOPES_SRC, minzoom: 8, maxzoom: SKI_ZOOM }, firstSymbol);
  const d = skiData();
  map.addSource(SKI_SRC, { type: "geojson", data: d.lines, tolerance: 0.2 });
  map.addSource(SKI_LABELS_SRC, { type: "geojson", data: d.labels });
  for (const color of [...new Set(Object.values(PISTE_COLORS)), OTHER_COLOR, NO_DIFF_COLOR, LIFT_COLOR]) skiBadge(map, color);
  skiArrow(map);
  const piste = ["!", ["has", "lift"]];
  // одна толщина на любом масштабе (Грегори: «толщину трудно удерживать при масштабировании — лучше просто линии»)
  map.addLayer({ id: PISTE_CASE, type: "line", source: SKI_SRC, minzoom: SKI_ZOOM, filter: ["all", piste, ["!", ["get", "off"]]],
    layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": 5, "line-opacity": 0.8 } }, firstSymbol);
  map.addLayer({ id: PISTE_LINE, type: "line", source: SKI_SRC, minzoom: SKI_ZOOM, filter: ["all", piste, ["!", ["get", "off"]]],
    layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3 } }, firstSymbol);
  map.addLayer({ id: PISTE_OFF, type: "line", source: SKI_SRC, minzoom: SKI_ZOOM, filter: ["all", piste, ["get", "off"]],
    layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3, "line-dasharray": [2, 1.5] } }, firstSymbol);
  map.addLayer({ id: LIFTS_LAYER, type: "line", source: SKI_SRC, minzoom: SKI_ZOOM,
    filter: ["all", ["has", "lift"], ["!", ["in", ["get", "kind"], ["literal", GONDOLAS]]]],
    layout: { "line-cap": "round" }, paint: { "line-color": LIFT_COLOR, "line-width": 2 } }, firstSymbol);
  // стрелки и номера — поверх подписей карты
  map.addLayer({ id: PISTE_ARROWS, type: "symbol", source: SKI_SRC, minzoom: 13, filter: ["all", piste, ["get", "arrows"]],
    layout: { "symbol-placement": "line", "symbol-spacing": 90, "icon-image": "slope-arrow", "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "viewport", "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 1.1, 16, 1.6], "icon-allow-overlap": true, "icon-ignore-placement": true } });
  const badges = (size) => ({ "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": size, "text-max-width": 8,
    "text-padding": 1, "icon-image": ["get", "badge"], "icon-text-fit": "both", "icon-text-fit-padding": [1, 4, 0, 4] });
  map.addLayer({ id: PISTE_LABELS, type: "symbol", source: SKI_LABELS_SRC, minzoom: 12, filter: ["!", ["has", "lift"]],
    layout: badges(["interpolate", ["linear"], ["zoom"], 12, 15, 14, 20, 16, 24]), paint: { "text-color": "#fff" } });
  map.addLayer({ id: LIFT_LABELS, type: "symbol", source: SKI_LABELS_SRC, minzoom: 13, filter: ["has", "lift"],
    layout: badges(["interpolate", ["linear"], ["zoom"], 13, 13, 16, 18]), paint: { "text-color": "#fff" } });
  claimLayersNear(TAP, LIFT_LABELS, PISTE_LABELS, LIFTS_LAYER, PISTE_OFF, PISTE_LINE);
}

// окно трассы или подъёмника: номер, название, сложность / вид, места, время в пути, часы; погода места
function skiInfo(rec, lngLat) {
  const box = document.createElement("div");
  const add = (cls, text) => text && box.append(Object.assign(document.createElement("div"), { className: cls, textContent: text }));
  let title;
  if (rec.lift) {
    title = [rec.ref, rec.name].filter(Boolean).join(" · ") || LIFT_KIND[rec.kind] || "Подъёмник";
    add("popup-title", title);
    add("popup-sub", LIFT_KIND[rec.kind] || rec.kind);
    const dur = rec.dur && `в пути ${rec.dur.replace(".", ",")} мин`;
    add("popup-row", [rec.occ && `мест: ${rec.occ}`, rec.cap && `${rec.cap} чел./ч`, dur, `${Math.round(lineLength(rec.line) / 10) * 10} м`].filter(Boolean).join(" · "));
    add("popup-row", [rec.heat === "yes" && "подогрев сидений", rec.bub === "yes" && "колпак от ветра"].filter(Boolean).join(", "));
    add("popup-row", rec.oh && `Часы работы: ${rec.oh}`);
  } else {
    title = [rec.ref && `Трасса ${rec.ref}`, rec.name].filter(Boolean).join(" · ") || PISTE_KIND[rec.kind] || "Трасса";
    add("popup-title", title);
    add("popup-sub", [PISTE_KIND[rec.kind] || rec.kind, PISTE_DIFF[rec.diff]].filter(Boolean).join(", "));
    add("popup-row", GROOMING[rec.groom] && `Подготовка: ${GROOMING[rec.groom]}`);
  }
  return withWeather(box, lngLat, title);
}
function skiClick(e) {
  if (!skiOn || ownHit(slopesMap, e.point, SKI_LAYERS)) return; // чужой значок (фото, спот) — его окно
  const f = SKI_LAYERS.map((id) => slopesMap.getLayer(id) && slopesMap.queryRenderedFeatures(nearBox(e.point, TAP), { layers: [id] })[0]).find(Boolean);
  const rec = f && (pistes.get(f.properties.osm) || lifts.get(f.properties.osm));
  if (!rec) return;
  const ll = f.geometry.type === "Point" ? f.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
  closeAll();
  track(new skiCtx.maplibregl.Popup({ offset: 10, maxWidth: "280px" })).setLngLat(ll).setDOMContent(skiInfo(rec, ll)).addTo(slopesMap);
}

// «Канатные дороги» — отметить в меню «Транспорта» и включить его; отмечено (или всё без выбора) — не трогать
async function withLifts(ctx) {
  const tr = modules().find((m) => m.id === "places/transport");
  if (!tr) return;
  const marked = tr.menu.items().filter((i) => i.active).map((i) => i.id);
  if (tr.active && (!marked.length || marked.includes("lifts"))) return;
  if (tr.active) tr.menu.toggle("lifts");
  else tr.menu.choose("lifts");
  await toggle(tr.id, ctx, true, { by: "trails/slopes" });
}

register({
  ...common,
  id: "trails/slopes",
  title: "Горнолыжные спуски",
  hint: "Трассы по цвету сложности, с номерами и подъёмниками",
  icon: chipIcon(SLOPES_ICON),
  sends: "район карты (Waymarked Trails, QLever — OpenStreetMap)",
  async enable(ctx) {
    slopesMap = ctx.map;
    skiCtx = ctx;
    skiOn = true;
    slopesOn(ctx.map);
    if (!skiWired) {
      skiWired = true;
      ctx.map.on("idle", skiUpdate);
      ctx.map.on("click", skiClick);
    }
    skiUpdate();
    await withLifts(ctx);
  },
  disable() {
    skiOn = false;
    skiLoader.forgetPending();
    for (const id of [...SKI_LAYERS, SLOPES_LAYER]) if (slopesMap?.getLayer(id)) slopesMap.removeLayer(id);
    for (const id of [SKI_LABELS_SRC, SKI_SRC, SLOPES_SRC]) if (slopesMap?.getSource(id)) slopesMap.removeSource(id);
  },
  stats: () => ({ pistes: pistes.size, lifts: lifts.size, numbered: [...pistes.values()].filter((p) => p.ref).length }),
});

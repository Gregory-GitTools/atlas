// Места — категории как чипы в Google Maps (перенос из travel-earth): рестораны, гостиницы,
// развлечения, музеи, транспорт, магазины. Точки — прямо из векторных тайлов OpenFreeMap (слой
// poi, фильтр по subclass = тег OSM), поэтому появляются сразу, с зума 12; «не найдено» —
// только с 14 (до него в тайлах лишь значимые места). Флажок цвета категории; у транспорта —
// цвет и значок по виду (метро красное «М», трамвай, автобус, паром, поезд), аэропорты — со шкалы
// 5 км, остановки — со шкалы 100 м. Магазины — с меню профилей (продукты, рынки, одежда…).
// Одновременно включена одна категория (group). Щелчок по флажку — окно места с подробностями
// из OSM и Википедии. Пока не сделано из travel-earth: фуникулёры и канатные дороги, аэропорты
// без типа (из QLever) — см. ROADMAP
import { register } from "../core/modules.js";
import { track, claimLayers } from "../core/popups.js";
import { featureContent } from "../core/place-info.js";
import * as settings from "../core/settings.js";
import { qleverBox, cellsInView, cellLoader } from "../core/qlever.js";

const MIN_ZOOM = 12;
const FULL_ZOOM = 14;
const SOURCE = "places-tiles";
const LAYERS = ["places-poi", "places-stops", "places-air", "places-transport-far"];
const OPENMAPTILES = { type: "vector", url: "https://tiles.openfreemap.org/planet" };
const AIRPORT_MAX_M_PER_100PX = 10000; // аэропорты — со шкалы «5 км»
const STOP_MAX_M_PER_100PX = 200; // остановки — со шкалы «100 м»
const AIRPORT_FILTER = ["any", ["in", ["get", "class"], ["literal", ["international", "public", "regional"]]], ["has", "iata"]];

const icon = (d) => `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="${d}"/></svg>`;
const GLYPHS = {
  bus: "M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z",
  train: "M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
  boat: "M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z",
  plane: "M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z",
  cable: "M18,10H13V7.59L22.12,6.07L21.88,4.59L16.41,5.5C16.46,5.35 16.5,5.18 16.5,5A1.5,1.5 0 0,0 15,3.5A1.5,1.5 0 0,0 13.5,5C13.5,5.35 13.63,5.68 13.84,5.93L13,6.07V6.07L11,6.4V6.4L1.88,7.93L2.12,9.41L11,7.93V10H6A2,2 0 0,0 4,12V18A2,2 0 0,0 6,20H18A2,2 0 0,0 20,18V12A2,2 0 0,0 18,10M6,12H8.25V16H6V12M9.75,16V12H14.25V16H9.75M18,16H15.75V12H18V16Z",
  metro: "text:M",
  tram: "M19 16.94V8.5c0-2.79-2.61-3.4-6.01-3.49l.76-1.51H17V2H7v1.5h4.75l-.76 1.52C7.86 5.11 5 5.73 5 8.5v8.44c0 1.45 1.19 2.66 2.59 2.97L6 21.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 20h-.08c1.69 0 2.58-1.37 2.58-3.06zm-7 1.56c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm5-4.5H7V9h10v5z",
};
// фуникулёр — вагончик трамвая, наклонённый как на склоне; ядовито-зелёный с чёрным значком
GLYPHS.funicular = { path: GLYPHS.tram, rotate: -30 };
const AIRPORT_PIN = { glyph: "plane", color: "#546e7a" };
const FUNICULAR_PIN = { glyph: "funicular", color: "#39ff14", ink: "#000" };
// вокзалы и станции фуникулёров видны издалека, как вышки и смотровые площадки — со шкалы «3 км»
// (Грегори, 2026-10-28, travel-earth: «подними видимость до вышек»). В тайлах их нет мельче зума 12 —
// эту часть шкалы закрывает QLever квадратами по 1°. Станцию фуникулёра OSM отмечает прямо
// (station=funicular или funicular=yes) — так же отмечаем и её точку в тайлах, по id
const TRANSPORT_FAR_M = 5000;
const TRANSPORT_CELL = 1;
const TRANSPORT_SPARQL = `{ ?osm osmkey:railway "station" . BIND("station" AS ?kind) OPTIONAL { ?osm osmkey:station ?st } OPTIONAL { ?osm osmkey:funicular ?fun } }
  UNION { ?osm osmkey:railway "halt" . BIND("halt" AS ?kind) OPTIONAL { ?osm osmkey:station ?st } OPTIONAL { ?osm osmkey:funicular ?fun } }`;
const OSM_TYPE_NUM = { node: 1, way: 2, relation: 3 };
const transportFar = new Map(); // osm → feature
const funicularIds = new Set(); // id точек в тайлах (osm_id·10 + тип)

const SHOP_PROFILES = [
  { id: "grocery", name: "Продукты", subclasses: ["supermarket", "convenience", "greengrocer", "bakery", "pastry", "butcher", "seafood", "deli", "cheese", "dairy", "frozen_food", "health_food", "confectionery", "chocolate", "coffee", "tea", "farm"] },
  { id: "market", name: "Рынки", subclasses: ["marketplace"] },
  { id: "goods", name: "Промтовары и хозтовары", subclasses: ["hardware", "doityourself", "houseware", "variety_store", "general", "department_store", "furniture", "garden_centre", "paint", "kitchen", "bathroom_furnishing", "interior_decoration", "electrical", "trade", "bed", "fabric", "craft"] },
  { id: "clothes", name: "Одежда и обувь", subclasses: ["clothes", "shoes", "bag", "boutique", "fashion", "fashion_accessories", "jewelry", "watches", "second_hand", "sports", "outdoor"] },
  { id: "electronics", name: "Электроника", subclasses: ["electronics", "mobile_phone", "computer", "hifi", "camera", "appliance", "video_games"] },
  { id: "pharmacy", name: "Аптеки и косметика", subclasses: ["pharmacy", "chemist", "cosmetics", "perfumery", "medical_supply", "optician"] },
  { id: "malls", name: "Торговые центры", subclasses: ["mall", "department_store"] },
  { id: "gifts", name: "Сувениры и книги", subclasses: ["gift", "souvenir", "books", "antiques", "art", "toys", "stationery", "music"] },
  { id: "alcohol", name: "Алкоголь и напитки", subclasses: ["alcohol", "wine", "beverages"] },
];
SHOP_PROFILES.unshift({ id: "all", name: "Все магазины", subclasses: [...new Set(SHOP_PROFILES.flatMap((s) => s.subclasses))] });

const CATEGORIES = [
  { id: "food", title: "Рестораны", color: "#f57c00", icon: icon("M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"),
    subclasses: ["restaurant", "cafe", "fast_food", "food_court", "bar", "pub", "biergarten", "ice_cream"] },
  { id: "hotels", title: "Гостиницы", color: "#8e24aa", icon: icon("M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z"),
    subclasses: ["hotel", "hostel", "guest_house", "motel", "apartment", "chalet", "camp_site", "caravan_site"] },
  { id: "fun", title: "Развлечения", color: "#d81b60", icon: icon("M20 12c0-1.1.9-2 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-1.99.9-1.99 2v4c1.1 0 1.99.9 1.99 2s-.89 2-2 2v4c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-4c-1.1 0-2-.9-2-2zm-4.42 4.8L12 14.5l-3.58 2.3 1.08-4.12-3.29-2.69 4.24-.25L12 5.8l1.54 3.95 4.24.25-3.29 2.69 1.09 4.11z"),
    subclasses: ["attraction", "viewpoint", "theme_park", "zoo", "petting_zoo", "aquarium", "castle", "monument", "theatre", "cinema", "arts_centre", "escape_game"] },
  { id: "museums", title: "Музеи", color: "#3949ab", icon: icon("M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z"),
    subclasses: ["museum", "gallery"] },
  { id: "transport", title: "Транспорт", color: "#00897b", icon: icon(GLYPHS.bus), airports: true,
    subclasses: ["bus_station", "station", "halt", "subway", "ferry_terminal"], stops: ["bus_stop", "tram_stop"],
    modes: [
      { subclass: "funicular", ...FUNICULAR_PIN },
      { subclass: "subway", glyph: "metro", color: "#e53935" },
      { subclass: "tram_stop", glyph: "tram", color: "#fb8c00" },
      { class: "bus", glyph: "bus", color: "#43a047" },
      { class: "aerialway", glyph: "cable", color: "#39ff14", ink: "#000" },
      { class: "ferry_terminal", glyph: "boat", color: "#0288d1" },
      { class: "railway", glyph: "train", color: "#3949ab" },
    ] },
  { id: "shops", title: "Магазины", color: "#1e88e5", profiles: SHOP_PROFILES,
    icon: icon("M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z") },
];

let active = null; // включённая категория (с выбранным профилем у магазинов)
const zoomForScale = (map, maxMeters) =>
  Math.log2((100 * 40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * maxMeters));

// флажок-булавка цвета категории. Стиль Atlas: тонкий белый кант вместо тени (правило Грегори
// 2026-10-04); ink — цвет значка для светлых флажков. Картинка рисуется заново после смены стиля
function pin(map, color, glyph, ink) {
  const id = `pin-${color}-${glyph || "dot"}${ink ? `-${ink}` : ""}`;
  if (map.hasImage(id)) return id;
  const w = 52, h = 60;
  const ctx = Object.assign(document.createElement("canvas"), { width: w, height: h }).getContext("2d");
  ctx.translate(4, 2);
  const shape = new Path2D();
  shape.moveTo(22, 55);
  shape.bezierCurveTo(18, 42, 4, 34, 4, 21);
  shape.arc(22, 21, 18, Math.PI, 0);
  shape.bezierCurveTo(40, 34, 26, 42, 22, 55);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fff";
  ctx.stroke(shape);
  ctx.fillStyle = color;
  ctx.fill(shape);
  ctx.fillStyle = ink || "#fff";
  const g = GLYPHS[glyph];
  if (typeof g === "string" && g.startsWith("text:")) {
    ctx.font = "bold 24px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(g.slice(5), 22, 22);
  } else if (g) {
    // значок 24×24 → 30 px в головке диаметром 36 (Грегори, 2026-10-28: «значок внутри мелкий»)
    ctx.translate(22, 21);
    ctx.rotate(((g.rotate || 0) * Math.PI) / 180);
    ctx.scale(30 / 24, 30 / 24);
    ctx.translate(-12, -12);
    ctx.fill(new Path2D(g.path || g));
  } else {
    ctx.beginPath();
    ctx.arc(22, 21, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  map.addImage(id, ctx.getImageData(0, 0, w, h), { pixelRatio: 2 });
  return id;
}

const modeIcon = (map, cat) => {
  const cases = (cat.modes || []).flatMap((m) => [["==", ["get", m.subclass ? "subclass" : "class"], m.subclass || m.class], pin(map, m.color, m.glyph, m.ink)]);
  // станции фуникулёров в тайлах выглядят как обычные ж/д — узнаём их по id из QLever
  if (cat.modes && funicularIds.size) cases.unshift(["in", ["id"], ["literal", [...funicularIds]]], pin(map, FUNICULAR_PIN.color, FUNICULAR_PIN.glyph, FUNICULAR_PIN.ink));
  return cases.length ? ["case", ...cases, pin(map, cat.color)] : pin(map, cat.color);
};

function ensureLayers(map) {
  if (map.getSource(SOURCE)) return;
  map.addSource(SOURCE, OPENMAPTILES);
  const layer = (id, sourceLayer, extra) => map.addLayer({
    id, type: "symbol", source: SOURCE, "source-layer": sourceLayer, minzoom: MIN_ZOOM, ...extra,
    layout: { visibility: "none", "icon-anchor": "bottom", "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 1, 17, 1.4],
      "icon-allow-overlap": true, "icon-ignore-placement": true },
  });
  layer("places-stops", "poi"); // остановки ниже станций — станция не прячется под флажком остановки
  layer("places-poi", "poi");
  layer("places-air", "aerodrome_label", { minzoom: 0, filter: AIRPORT_FILTER });
  map.addSource("places-transport", { type: "geojson", data: transportData() });
  map.addLayer({ id: "places-transport-far", type: "symbol", source: "places-transport", minzoom: 0, maxzoom: MIN_ZOOM,
    layout: { visibility: "none", "icon-anchor": "bottom", "icon-size": 1, "icon-allow-overlap": true, "icon-ignore-placement": true } });
}

const transportData = () => ({ type: "FeatureCollection", features: [...transportFar.values()] });
let transportMap = null;
const transportLoader = cellLoader(TRANSPORT_CELL, async (box) => {
  let newFunicular = false;
  for (const { osm, coordinates, b } of await qleverBox("?st ?fun", TRANSPORT_SPARQL, box)) {
    const funicular = b.st?.value === "funicular" || b.fun?.value === "yes";
    // метро и лёгкое метро — отдельный вид, в городе сплошным ковром только мешают
    if (!funicular && ["subway", "light_rail", "monorail"].includes(b.st?.value)) continue;
    const [type, num] = osm.split("/");
    const id = Number(num) * 10 + OSM_TYPE_NUM[type];
    if (funicular && !funicularIds.has(id)) { funicularIds.add(id); newFunicular = true; }
    transportFar.set(osm, { type: "Feature", id, geometry: { type: "Point", coordinates },
      properties: { class: "railway", subclass: funicular ? "funicular" : b.kind.value } });
  }
  transportMap?.getSource("places-transport")?.setData(transportData());
  if (newFunicular && transportMap && active?.modes) apply(transportMap);
}, () => transportMap && updateTransport(transportMap));

function updateTransport(map) {
  transportMap = map;
  if (!active?.modes) return;
  const far = zoomForScale(map, TRANSPORT_FAR_M);
  if (map.getLayer("places-transport-far")) map.setLayerZoomRange("places-transport-far", Math.min(far, MIN_ZOOM), MIN_ZOOM);
  if (map.getZoom() >= far) transportLoader.request(cellsInView(map, TRANSPORT_CELL, 1));
}

function apply(map) {
  if (!map.getLayer("places-poi")) return;
  const vis = (id, on) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  vis("places-poi", !!active);
  vis("places-stops", !!active?.stops);
  vis("places-air", !!active?.airports);
  vis("places-transport-far", !!active?.modes);
  if (!active) return;
  const img = modeIcon(map, active);
  map.setLayoutProperty("places-poi", "icon-image", img);
  map.setLayoutProperty("places-stops", "icon-image", img);
  map.setLayoutProperty("places-air", "icon-image", pin(map, AIRPORT_PIN.color, AIRPORT_PIN.glyph));
  map.setLayoutProperty("places-transport-far", "icon-image", img);
  map.setFilter("places-poi", ["in", ["get", "subclass"], ["literal", active.subclasses]]);
  map.setFilter("places-stops", ["in", ["get", "subclass"], ["literal", active.stops || []]]);
  scaleZooms(map);
}

// пороги «по шкале» зависят от широты — пересчитываются после каждого движения
function scaleZooms(map) {
  if (!map.getLayer("places-air")) return;
  map.setLayerZoomRange("places-air", Math.min(MIN_ZOOM, zoomForScale(map, AIRPORT_MAX_M_PER_100PX)), 24);
  map.setLayerZoomRange("places-stops", Math.max(MIN_ZOOM, zoomForScale(map, STOP_MAX_M_PER_100PX)), 24);
}

function updateStatus(map, status) {
  if (!active) return;
  const name = (active.profile?.id !== "all" && active.profile?.name) || active.title;
  const zoomIn = `Приблизьте карту, чтобы увидеть: ${name.toLowerCase()}`;
  const min = active.airports ? Math.min(MIN_ZOOM, zoomForScale(map, AIRPORT_MAX_M_PER_100PX), zoomForScale(map, TRANSPORT_FAR_M)) : MIN_ZOOM;
  if (map.getZoom() < min) { status(zoomIn); return; }
  if (!map.areTilesLoaded()) return;
  const found = map.queryRenderedFeatures({ layers: LAYERS.filter((id) => map.getLayer(id)) }).length;
  if (found) status("");
  else if (map.getZoom() < FULL_ZOOM) status(zoomIn);
  else status(`В этой части карты не найдено: ${name.toLowerCase()}`);
}

let wired = false;
function wire({ map, maplibregl, status }) {
  if (wired) return;
  wired = true;
  claimLayers(...LAYERS);
  map.on("style.load", () => { ensureLayers(map); apply(map); });
  map.on("moveend", () => scaleZooms(map));
  map.on("idle", () => updateTransport(map));
  map.on("idle", () => updateStatus(map, status));
  map.on("zoomend", () => updateStatus(map, status));
  let click = 0;
  map.on("click", LAYERS, async (e) => {
    const f = e.features[0];
    const n = ++click;
    const content = await featureContent(f);
    if (n !== click) return;
    track(new maplibregl.Popup({ offset: [0, -30], maxWidth: "280px" }))
      .setLngLat(f.geometry.coordinates).setDOMContent(content).addTo(map);
  });
}

for (const cat of CATEGORIES) {
  const profileKey = `places.${cat.id}.profile`;
  const withProfile = () => {
    if (!cat.profiles) return cat;
    const profile = cat.profiles.find((p) => p.id === settings.get(profileKey)) || cat.profiles[0];
    return { ...cat, profile, subclasses: profile.subclasses };
  };
  register({
    id: `places/${cat.id}`,
    kind: "layer",
    group: "places", // в панели — раздел «Места», одновременно включена одна категория
    title: cat.title,
    icon: cat.icon,
    needs: ["network"],
    sends: "район карты (тайлы OpenFreeMap), по щелчку — место (OpenStreetMap, Википедия)",
    // меню у чипа (магазины): профили
    menu: cat.profiles && {
      items: () => cat.profiles.map((p) => ({ id: p.id, title: p.name, active: p.id === withProfile().profile.id })),
      label: () => (withProfile().profile.id === "all" ? cat.title : withProfile().profile.name),
      choose: (id) => settings.set(profileKey, id),
    },
    enable(ctx) {
      wire(ctx);
      ensureLayers(ctx.map);
      active = withProfile();
      apply(ctx.map);
      updateTransport(ctx.map);
      updateStatus(ctx.map, ctx.status);
    },
    disable(ctx) {
      if (active?.id !== cat.id) return;
      active = null;
      apply(ctx.map);
      ctx.status("");
    },
  });
}

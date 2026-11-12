// Значки на природе (перенос из travel-earth): пляжи, сёрфинг и кайт, значки у троп (указатели,
// щиты, смотровые площадки и вышки, маяки, пикник, кемпинги, вода, кострища). Значки свои, в одном
// стиле: символ цвета группы с тонким кантом (не тенью); у жёлтых пляжа и кайта кант красный — на
// светлом море и песке белый теряется (Грегори, 2026-10-04). Наши значки — поверх подписей карты.
// Щелчок — окно: вид, название, высота, описание, направления указателя, у пляжа — покрытие и
// спасатели. Данные — QLever (core/qlever.js); у точек — теги из OSM API.
import { forecastBox, kiteRate, isLight, dirsRu } from "../core/forecast.js";
import * as settings from "../core/settings.js";
import { register, modules, toggle } from "../core/modules.js";
import { on } from "../core/events.js";
import { track, claimLayers } from "../core/popups.js";
import { uiLanguage } from "../core/labels.js";
import { qleverBox, cellsInView, cellLoader, osmTags } from "../core/qlever.js";

const YELLOW = "#ffd600";
const ICONS = {
  info: { color: "#6a9fe0", path: "M10.2 9.5h3.6V20h-3.6z M12 3.5a2.2 2.2 0 1 1 0 4.4a2.2 2.2 0 1 1 0-4.4z" },
  guidepost: { color: "#6a9fe0", path: "M11 2h2v20h-2z M4 4h12l3 2.75L16 9.5H4z M20 11.5H8l-3 2.75L8 17h12z" },
  board: { color: "#8a9099", path: "M3 4h18v11H3z M6.5 15h2v6h-2z M15.5 15h2v6h-2z" },
  map: { color: "#8a9099", evenodd: true, path: "M2.5 6.5L9 4l6 2.5L21.5 4v13.5L15 20l-6-2.5-6.5 2.5z M8.3 5.5h1.4v12H8.3z M14.3 8h1.4v12h-1.4z" },
  viewpoint: { color: "#2e7d32", path: "M12 16.9a2.6 2.6 0 1 1 0 5.2a2.6 2.6 0 1 1 0-5.2z M8 17.2L0.8 12.8L-0.5 15.7L7.6 18.1z M9.9 15.4L6.3 7.7L3.6 9.5L9.1 15.9z M12.5 14.9L13.6 6.5L10.4 6.5L11.5 14.9z M14.9 15.9L20.4 9.5L17.7 7.7L14.1 15.4z M16.4 18.1L24.5 15.7L23.2 12.8L16 17.2z" },
  tower: { color: "#2e7d32", path: "M5 2h14l-2 2.5v1.5H7V4.5z M8 6h2.2L8.2 22H6z M13.8 6H16l2 16h-2.2z M8.5 10.5h7v1.6h-7z M7.8 15.5h8.4v1.6H7.8z" },
  campsite: { color: "#7cb342", path: "M12 3L1.5 21H9l3-6 3 6h7.5z" },
  picnic_site: { color: "#8d5a2b", path: "M3 6h18v2.6H3z M6.3 8.6h2.4L6.4 20H4z M15.3 8.6h2.4L20 20h-2.4z M2 13h20v2.2H2z" },
  firepit: { color: "#d32f2f", path: "M12 2c1 4 6.5 6 6.5 12.5a6.5 6.5 0 0 1-13 0c0-3.2 1.8-5.3 3-6.5 0 2.2 1 3.5 2.3 3.5C10.5 8 10 5 12 2z" },
  drinking_water: { color: "#0288d1", path: "M12 2.5S5 10.5 5 15a7 7 0 0 0 14 0c0-4.5-7-12.5-7-12.5z" },
  lighthouse: { color: "#222", path: "M9 5a3 3 0 0 1 6 0z M9.5 5h5v3h-5z M8 8h8v1.5H8z M9.2 9.5h5.6l1.5 10.5H7.7z M6 20h12v2H6z M9 6.5L3 3.5v6z M15 6.5l6-3v6z",
    white: "M10.7 5.8h2.6v1.5h-2.6z M9 12.5h6v1.8H9z M8.6 16.3h6.8v1.8H8.6z" },
  beach: { color: YELLOW, outline: "#e53935", path: "M1.53 16.1A8.5 8.5 0 0 1 16.55 8.12A2.83 2.83 0 0 0 11.54 10.78A2.83 2.83 0 0 0 6.54 13.44A2.83 2.83 0 0 0 1.53 16.1z M8.29 12.51L9.79 11.71L14.25 20.1L12.75 20.9z M2 20h20v2.5H2z" },
  "kite-bad": { color: "#e53935", path: "M12 2.5L1.5 21h21z", white: "M10.9 9h2.2l-.4 6.5h-1.4z M12 16.8a1.3 1.3 0 1 1 0 2.6a1.3 1.3 0 1 1 0-2.6z" },
  kitesurfing: { color: YELLOW, outline: "#e53935", path: "M11.5 4.2Q17.5 -0.4 23.5 5.2L21.8 6.9Q17.5 3.1 12.7 6z M11.83 5.20L11.93 12.60L12.47 12.60L12.37 5.20z M22.45 5.87L12.05 12.37L12.35 12.83L22.75 6.33z M7.60 7.65a1.75 1.75 0 1 1 0 3.50a1.75 1.75 0 1 1 0 -3.50z M7.22 11.26L5.22 15.66L7.58 16.74L9.58 12.34z M8.27 12.44L12.07 13.24L12.33 11.96L8.53 11.16z M6.10 17.10L9.10 18.10L9.70 16.30L6.70 15.30z M8.79 17.79L10.99 20.09L12.21 18.91L10.01 16.61z M5.50 16.51L6.90 20.51L8.70 19.89L7.30 15.89z M1.98 21.13L15.77 18.70L16.48 19.28L16.02 20.07L2.23 22.50L1.52 21.92z" },
};
// волновой спот — тот же кайтсёрфер с синим кантом
ICONS["kite-wave"] = { ...ICONS.kitesurfing, outline: "#1565c0" };
const KIND_NAMES = {
  info: "Информация", guidepost: "Указатель", board: "Информационный щит", map: "Карта местности",
  viewpoint: "Смотровая площадка", tower: "Смотровая вышка", lighthouse: "Маяк", campsite: "Кемпинг",
  picnic_site: "Место для пикника", firepit: "Кострище", drinking_water: "Питьевая вода",
  beach: "Пляж", beach_resort: "Пляжный курорт", surfing: "Сёрфинг", kitesurfing: "Кайтсёрфинг", windsurfing: "Виндсёрфинг",
};
const SURFACE = { sand: "песок", fine_gravel: "мелкая галька", gravel: "галька", pebblestone: "галька", shingle: "галька", rock: "камни", stone: "камни", grass: "трава", concrete: "бетон" };

const zoomForScale = (map, m) => Math.log2((100 * 40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * m));
const glyphSvg = (kind) => {
  const { color, outline, path } = ICONS[kind];
  return `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="${color}"${outline ? ` stroke="${outline}" stroke-width="1"` : ""} d="${path}"/></svg>`;
};

// у щитов, указателей, карт и инфостендов с тегом image (фото щита в OSM) — оранжевое кольцо
// вокруг обычного значка: не новый значок и не новый слой (Грегори, 2026-10-28, travel-earth:
// «не надо целиться в новый значок с камерой», одобрил именно обводку)
const PHOTO_KINDS = ["info", "guidepost", "board", "map"];
const PHOTO_RING = "#ff9800";

// значок с кантом: сначала обводка, потом заливка — чётко, без тени; photo — с кольцом «есть фото»
function icon(map, kind, photo = false) {
  const id = `outdoor-${kind}${photo ? "-photo" : ""}`;
  if (map.hasImage(id)) return id;
  const { color, path, evenodd, white, outline } = ICONS[kind];
  const size = 64;
  const ctx = Object.assign(document.createElement("canvas"), { width: size, height: size }).getContext("2d");
  if (photo) {
    ctx.beginPath();
    ctx.arc(32, 32, 27, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = PHOTO_RING;
    ctx.stroke();
  }
  ctx.translate(8, 8);
  ctx.scale(2, 2);
  const shape = new Path2D(path);
  ctx.lineWidth = 2;
  ctx.strokeStyle = outline || "#fff";
  ctx.stroke(shape);
  ctx.fillStyle = color;
  ctx.fill(shape, evenodd ? "evenodd" : "nonzero");
  if (white) { ctx.fillStyle = "#fff"; ctx.fill(new Path2D(white)); }
  map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
  return id;
}

const photoUrl = (image) => {
  if (!image) return null;
  if (/^https?:\/\//i.test(image)) return image;
  const m = image.match(/^File:(.+)$/i);
  return m ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(m[1])}?width=280` : null;
};
const photoPage = (image) => (/^https?:\/\//i.test(image) ? image : `https://commons.wikimedia.org/wiki/${encodeURIComponent(image)}`);

// окно значка: теги из OSM API (споты «Кайта в Эстонии» — без OSM, всё в kite-ee.json)
async function showInfo(ctx, f) {
  const p = f.properties;
  const ee = eeSpots.get(p.osm);
  let tags = ee ? { name: ee.name } : null;
  if (!tags) tags = (await Promise.race([osmTags(p.osm).catch(() => null), new Promise((r) => setTimeout(r, 1500, null))])) || {};
  const lang = uiLanguage();
  const kind = ee ? eeKindName(ee) : [KIND_NAMES[p.kind], tags.ele && `${Math.round(tags.ele).toLocaleString("ru")} м`].filter(Boolean).join(" · ");
  const name = tags[`name:${lang}`] || tags.name;
  const box = document.createElement("div");
  const add = (cls, text) => text && box.append(Object.assign(document.createElement("div"), { className: cls, textContent: text }));
  add("popup-title", name || kind);
  if (name) add("popup-sub", kind);
  if (ee) eeInfo(ee, add, box);
  else {
    const surface = [SURFACE[tags.surface], (tags.supervised === "yes" || tags.lifeguard === "yes") && "спасатели"].filter(Boolean).join(", ");
    // фото щита из OSM (тег image): прямая ссылка или файл Commons «File:…»; грузится только по щелчку
    const img = photoUrl(tags.image);
    if (img) {
      const a = Object.assign(document.createElement("a"), { href: photoPage(tags.image), target: "_blank", rel: "noopener" });
      a.append(Object.assign(document.createElement("img"), { className: "popup-photo", src: img, alt: "", width: 260, height: 170 }));
      box.append(a);
    }
    add("popup-row", surface && surface[0].toUpperCase() + surface.slice(1));
    add("popup-row", tags.description);
    add("popup-row", tags.inscription);
    add("popup-row", tags.destination && `→ ${tags.destination.replace(/;/g, ", ")}`);
    if (/^https?:\/\//.test(tags.website || "")) {
      const row = Object.assign(document.createElement("div"), { className: "popup-row" });
      row.append(Object.assign(document.createElement("a"), { href: tags.website, textContent: "Сайт", target: "_blank", rel: "noopener" }));
      box.append(row);
    }
  }
  // кайт- и сёрф-споты — погода: ветер, порывы и волна на 7 дней и годность ветра для кайта
  const spot = ee ? ee.kind !== "bad" : SPOT_KINDS.has(p.kind);
  const wait = spot && box.appendChild(Object.assign(document.createElement("div"), { className: "popup-row wx-wait", textContent: "Погода…" }));
  track(new ctx.maplibregl.Popup({ offset: 14, maxWidth: spot || ee ? "340px" : "260px" })).setLngLat(f.geometry.coordinates).setDOMContent(box).addTo(ctx.map);
  if (spot) wait.replaceWith(await forecastBox(f.geometry.coordinates, { inside: true, at: kiteState.on ? kiteState.at : null,
    kite: ee || { sea: seaOf(p.osm) } }));
}
const SPOT_KINDS = new Set(["surfing", "kitesurfing", "windsurfing"]);
// время ветра (полоса «Ветра»): кольца у спотов и окно спота — на это время
const kiteState = { on: false, at: null };

// сторона воды у спота: 16 румбов, в 1,2 км — вода «1» или суша «0» (core/forecast.js, fromLand). У спотов
// Эстонии — в kite-ee.json; у остальных — по карте, когда спот в кадре крупно; помнится на устройстве
const seaKnown = new Map(Object.entries(settings.get("spot-sea", {})));
const seaOf = (osm) => seaKnown.get(osm) || null;
const SEA_M = 1200, SEA_ZOOM = 11;
function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// вода — слой water схемы OpenMapTiles во всех векторных источниках подложки (море, озёра, реки)
function waterAt(polys, [x, y]) {
  return polys.some(({ geometry: g }) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [])
    .some((poly) => poly.reduce((c, ring) => c !== inRing(x, y, ring), false)));
}
function seaAround(map, [lon, lat]) {
  const polys = [];
  for (const [id, src] of Object.entries(map.getStyle()?.sources || {})) {
    if (src.type !== "vector") continue;
    try { polys.push(...map.querySourceFeatures(id, { sourceLayer: "water" })); } catch { /* нет слоя */ }
  }
  const b = map.getBounds(), k = SEA_M / 111320;
  return Array.from({ length: 16 }, (_, i) => {
    const a = (i * 22.5 * Math.PI) / 180;
    const q = [lon + (k * Math.sin(a)) / Math.cos((lat * Math.PI) / 180), lat + k * Math.cos(a)];
    return b.contains(q) ? (waterAt(polys, q) ? "1" : "0") : "?";
  }).join("");
}
function learnSea(map, features) {
  if (map.getZoom() < SEA_ZOOM || !map.areTilesLoaded()) return false;
  const b = map.getBounds();
  let learned = false;
  for (const f of features) {
    const osm = f.properties.osm;
    if (seaKnown.has(osm) || !b.contains(f.geometry.coordinates)) continue;
    const sea = seaAround(map, f.geometry.coordinates);
    if (sea.includes("?")) continue;
    seaKnown.set(osm, sea);
    learned = true;
  }
  if (learned) settings.set("spot-sea", Object.fromEntries(seaKnown));
  return learned;
}

// слой значков из GeoJSON: поверх подписей карты (наши значки — сверху), окно по щелчку
function pointLayer(ctx, id, extra, source = id) {
  const { map } = ctx;
  if (!map.getSource(source)) map.addSource(source, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  if (!map.getLayer(id)) map.addLayer({ id, type: "symbol", source, ...extra });
  claimLayers(id);
}
const clickWired = new Set();
function wireClick(ctx, id) {
  if (clickWired.has(id)) return;
  clickWired.add(id);
  ctx.map.on("click", id, (e) => showInfo(ctx, e.features[0]));
}

// ---------- пляжи ----------
// natural=beach, leisure=beach_resort — со шкалы «10 км» (Грегори: 3 км было мало). Кадр на
// «10 км» — пара градусов, поэтому квадраты по 2°, до 1,5° от центра
{
  const MAX_M = 20000, CELL = 2;
  const SPARQL = `{ ?osm osmkey:natural "beach" . BIND("beach" AS ?kind) } UNION { ?osm osmkey:leisure "beach_resort" . BIND("beach_resort" AS ?kind) }`;
  const features = new Map();
  let ctx = null, active = false;
  const data = () => ({ type: "FeatureCollection", features: [...features.values()] });
  const loader = cellLoader(CELL, async (box) => {
    for (const { osm, coordinates, b } of await qleverBox("", SPARQL, box)) features.set(osm, { type: "Feature", geometry: { type: "Point", coordinates }, properties: { kind: b.kind.value, osm } });
    ctx?.map.getSource("beaches")?.setData(data());
  }, () => update());
  const update = () => {
    if (!active) return;
    const min = zoomForScale(ctx.map, MAX_M);
    if (ctx.map.getLayer("beaches")) ctx.map.setLayerZoomRange("beaches", min, 24);
    if (ctx.map.getZoom() >= min) loader.request(cellsInView(ctx.map, CELL, 1.5));
  };
  let wired = false;
  register({
    id: "layers/beaches", kind: "layer", group: "places", title: "Пляжи", hint: "Пляжи — с масштаба 10 км", icon: glyphSvg("beach"),
    needs: ["network"], sends: "район карты (QLever, OpenStreetMap)",
    enable(c) {
      ctx = c; active = true;
      pointLayer(c, "beaches", { layout: { "icon-image": icon(c.map, "beach"), "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.75, 14, 1, 16, 1.2] } });
      c.map.getSource("beaches").setData(data());
      wireClick(c, "beaches");
      if (!wired) { wired = true; c.map.on("idle", update); }
      update();
    },
    disable({ map }) { active = false; loader.forgetPending(); if (map.getLayer("beaches")) map.removeLayer("beaches"); },
  });
}

// ---------- кайт-кольца: общая часть «Сёрфинга» и «Кайта в Эстонии» ----------
// Кольцо — только рекомендация на время полосы «Ветра» (core/forecast.js, kiteRate; Грегори 2026-11-12):
// зелёное — подходит (от 6 м/с, направление спота, не с берега), оранжевое — сильно, только для опытных.
// **Красного на карте нет** (Грегори: «90 % карты всегда будет красной») — запрет и опасность только в окне
// выбранного спота; нет кольца — не рекомендуем (мало ветра, не то направление, с берега, шторм).
// Только пока включён «Ветер». Прогноз точек в кадре — пачками по 50, помнится час
const MAP_RINGS = { good: "#2e9d43", strong: "#fd8d3c" };
function kiteRings(source, spots, spotOf) {
  const kite = new Map(); // ключ точки → годность ветра в выбранное время
  const wx = new Map(); // ключ → { t, time[], ms[], gust[], dir[] } — прогноз на 7 дней
  const HOUR = 3600000, MAX_SPOTS = 100;
  let ctx = null, active = false, seq = 0, timer = 0, wired = false, ratedAt = null;
  const data = () => ({ type: "FeatureCollection", features: spots().map((f) => (kiteState.on && kite.has(f.properties.osm)
    ? { ...f, properties: { ...f.properties, kite: kite.get(f.properties.osm) } } : f)) });
  const draw = () => ctx?.map.getSource(source)?.setData(data());
  async function rate() {
    if (!active || !kiteState.on) { kite.clear(); draw(); return; }
    const n = ++seq, now = Date.now(), b = ctx.map.getBounds();
    const inView = spots().filter((f) => f.properties.kind !== "kite-bad" && b.contains(f.geometry.coordinates)).slice(0, MAX_SPOTS);
    const missing = inView.filter((f) => !(wx.get(f.properties.osm)?.t > now - HOUR));
    for (let i = 0; i < missing.length; i += 50) {
      const part = missing.slice(i, i + 50);
      const params = new URLSearchParams({ latitude: part.map((f) => f.geometry.coordinates[1].toFixed(3)).join(","),
        longitude: part.map((f) => f.geometry.coordinates[0].toFixed(3)).join(","), hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
        wind_speed_unit: "ms", timeformat: "unixtime", timezone: "auto", forecast_days: 7, temporal_resolution: "hourly_3",
        daily: "sunrise,sunset" });
      try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
        if (!res.ok) break;
        const d = await res.json();
        (Array.isArray(d) ? d : [d]).forEach(({ hourly: h, daily }, k) => wx.set(part[k].properties.osm,
          { t: now, time: h.time, ms: h.wind_speed_10m, gust: h.wind_gusts_10m, dir: h.wind_direction_10m, daily }));
      } catch { break; }
      if (n !== seq) return;
    }
    if (n !== seq) return;
    const when = kiteState.at ?? now / 1000;
    ratedAt = kiteState.at;
    kite.clear();
    for (const f of inView) {
      const w = wx.get(f.properties.osm);
      const k = w ? w.time.findIndex((t) => t + 10800 > when) : -1;
      if (k < 0) continue;
      // в темноте не рекомендуем (Грегори 2026-11-12: кайт — только при свете)
      const level = isLight(w.daily, w.time[k]) ? kiteRate(w.ms[k], w.gust[k], w.dir[k], spotOf(f.properties.osm)) : "night";
      if (MAP_RINGS[level]) kite.set(f.properties.osm, level);
    }
    draw();
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(rate, 300); };
  on("wind-time", (s) => { Object.assign(kiteState, s); later(); });
  return {
    kite, wx, data, later, ratedAt: () => ratedAt,
    // кольцо — под значком, тем же источником
    enable(c, pointIcon) {
      ctx = c; active = true;
      if (!c.map.getSource(source)) c.map.addSource(source, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      if (!c.map.getLayer(`${source}-kite`)) c.map.addLayer({ id: `${source}-kite`, type: "circle", source, filter: ["has", "kite"],
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 8, 8, 12, 14, 14], "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 3, "circle-stroke-color": ["match", ["get", "kite"], ...Object.entries(MAP_RINGS).flat(), "#888"] } });
      claimLayers(`${source}-kite`);
      pointLayer(c, source, { layout: { "icon-image": pointIcon, "symbol-sort-key": ["get", "rank"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 8, 0.9, 14, 1, 16, 1.2] } });
      draw();
      wireClick(c, source);
      if (!wired) { wired = true; c.map.on("moveend", () => active && kiteState.on && later()); }
      later();
    },
    disable(map) { active = false; for (const id of [source, `${source}-kite`]) if (map.getLayer(id)) map.removeLayer(id); },
    redraw: draw,
  };
}

// ---------- кайт в Эстонии ----------
// Карта «Kite Eestis» эстонских кайтеров (Грегори 2026-11-12: «перенести отдельным слоем, русифицировать
// и учитывать допустимое направление ветра»), переведена на русский — kite-ee.json: споты, волновые споты,
// места, где не катаются (камни, частная земля, опасность), и пути к спотам линиями. У каждого спота —
// допустимые направления `dirs` и откуда они (`src`: «файл» — из описания спота; kiteforum, клуб — сайты;
// «по карте» — по берегу, с какой стороны вода), сторона воды `sea` (tools/spot-sea.mjs), оффшорные по
// описанию `off`, спасатели `rescue`. Названия мест — как на месте, по-эстонски
const eeSpots = new Map(); // "ee/<номер>" → запись файла
let eeList = null;
const eeLoad = () => (eeList ??= fetch("kite-ee.json").then((r) => r.json()).then((list) => {
  list.forEach((s, i) => eeSpots.set(`ee/${i}`, s));
  return list;
}).catch(() => { eeList = null; return []; }));
let eeActive = false, surfRedraw = null;
const eeKindName = (s) => ({ spot: "Кайт-спот", wave: "Кайт-спот · волна", bad: "Здесь не катаются" })[s.kind];
// окно спота Эстонии: вид, описание, допустимый ветер и откуда он, Windguru, источник
function eeInfo(s, add, box) {
  if (s.kind === "bad") box.querySelector(".popup-sub")?.classList.add("kite-bad");
  if (s.desc) add("popup-row kite-desc", s.desc);
  if (s.dirs) add("popup-row kite-dirs", `Ветер для спота: ${dirsRu(s.dirs)} — ${({ "файл": "из описания спота", "по карте": "по берегу, описания нет" })[s.src] || s.src}`);
  if (s.off) add("popup-row kite-off", `С берега по описанию: ${dirsRu(s.off)} — без спасателей не выходить`);
  if (/^https?:\/\//.test(s.wg || "")) {
    const row = Object.assign(document.createElement("div"), { className: "popup-row" });
    row.append(Object.assign(document.createElement("a"), { href: s.wg, textContent: "Windguru", target: "_blank", rel: "noopener" }));
    box.append(row);
  }
  add("popup-row wx-src", "Карта «Kite Eestis» эстонских кайтеров, перевод; ветер — оттуда же, с kiteforum.com и lohesurf.eu");
}

{
  const KIND = { spot: "kitesurfing", wave: "kite-wave", bad: "kite-bad" };
  let points = [], lines = [], ctx = null;
  const rings = kiteRings("kite-ee", () => points, (key) => eeSpots.get(key));
  // окно линии (путь к споту) — название и заметка
  const lineInfo = (e) => {
    const s = eeSpots.get(e.features[0].properties.osm);
    const box = document.createElement("div");
    box.append(Object.assign(document.createElement("div"), { className: "popup-title", textContent: s.name }));
    if (s.desc) box.append(Object.assign(document.createElement("div"), { className: "popup-row kite-desc", textContent: s.desc }));
    track(new ctx.maplibregl.Popup({ offset: 6, maxWidth: "280px" })).setLngLat(e.lngLat).setDOMContent(box).addTo(ctx.map);
  };
  let wired = false;
  register({
    id: "layers/kite-ee", kind: "layer", group: "places", title: "Кайт в Эстонии",
    hint: "Кайт-споты Эстонии: описание, допустимый ветер; с «Ветром» — зелёное кольцо, где ветер подходит", icon: glyphSvg("kitesurfing"),
    needs: ["network"], sends: "точка спота — погода и волна (Open-Meteo); при включённом ветре — споты в кадре (Open-Meteo)",
    async enable(c) {
      ctx = c; eeActive = true;
      for (const k of ["kite-wave", "kite-bad"]) icon(c.map, k);
      const list = await eeLoad();
      points = []; lines = [];
      list.forEach((s, i) => {
        const props = { osm: `ee/${i}`, kind: KIND[s.kind], name: s.name, rank: s.kind === "bad" ? 1 : 0 };
        if (s.line) lines.push({ type: "Feature", geometry: { type: "LineString", coordinates: s.line }, properties: props });
        else if (s.lon != null) points.push({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: props });
      });
      if (!c.map.getSource("kite-ee-lines")) c.map.addSource("kite-ee-lines", { type: "geojson", data: { type: "FeatureCollection", features: lines } });
      if (!c.map.getLayer("kite-ee-lines")) c.map.addLayer({ id: "kite-ee-lines", type: "line", source: "kite-ee-lines", minzoom: 10,
        paint: { "line-color": "#e53935", "line-width": 2.5, "line-dasharray": [2, 1.5] } });
      claimLayers("kite-ee-lines");
      rings.enable(c, ["match", ["get", "kind"], "kite-wave", "outdoor-kite-wave", "kite-bad", "outdoor-kite-bad", icon(c.map, "kitesurfing")]);
      if (!wired) { wired = true; c.map.on("click", "kite-ee-lines", lineInfo); }
      surfRedraw?.();
    },
    disable({ map }) {
      eeActive = false;
      rings.disable(map);
      if (map.getLayer("kite-ee-lines")) map.removeLayer("kite-ee-lines");
      surfRedraw?.();
    },
    stats: () => ({ points: points.length, lines: lines.length, kite: Object.fromEntries(rings.kite), rated: rings.wx.size, at: rings.ratedAt() }),
  });
}

// ---------- сёрфинг ----------
// sport=surfing|kitesurfing|windsurfing по всему миру, на любом масштабе (Грегори: «неограниченная
// видимость») — в OSM их ~1900, QLever отдаёт весь мир одним запросом. Пока включён «Кайт в Эстонии»,
// точка OSM ближе 300 м к его споту не рисуется. Сторона воды у спотов OSM — по карте, когда спот в кадре крупно
{
  const SPARQL = `?osm osmkey:sport ?kind . FILTER (?kind IN ("surfing", "kitesurfing", "windsurfing"))`;
  let osmPoints = null, loading = false, ctx = null, active = false, wired = false;
  const spots = () => {
    const own = eeActive ? [...eeSpots.values()].filter((s) => s.lon != null) : [];
    const near = ([lon, lat]) => own.some((s) => Math.hypot((lon - s.lon) * Math.cos((lat * Math.PI) / 180), lat - s.lat) < 0.0027);
    return (osmPoints || []).filter((f) => !near(f.geometry.coordinates));
  };
  const rings = kiteRings("surf", spots, (key) => ({ sea: seaOf(key) }));
  surfRedraw = () => rings.redraw();
  const load = async () => {
    if (loading || osmPoints) return;
    loading = true;
    try {
      osmPoints = (await qleverBox("", SPARQL, [-180, -90, 180, 90])).map(({ osm, coordinates, b }) => ({ type: "Feature",
        geometry: { type: "Point", coordinates }, properties: { kind: b.kind.value, osm, rank: 1 } }));
      rings.redraw();
      rings.later();
    } catch { setTimeout(load, 60000); }
    loading = false;
  };
  register({
    id: "layers/surf", kind: "layer", group: "places", title: "Сёрфинг", hint: "Сёрфинг, кайт и виндсёрфинг по всему миру", icon: glyphSvg("kitesurfing"),
    needs: ["network"], sends: "запрос мест для сёрфинга (QLever, OpenStreetMap); точка спота — погода и волна (Open-Meteo); при включённом ветре — споты в кадре (Open-Meteo)",
    enable(c) {
      ctx = c; active = true;
      rings.enable(c, icon(c.map, "kitesurfing"));
      if (!wired) {
        wired = true;
        // сторона воды — когда спот в кадре крупно и плитки загружены
        c.map.on("idle", () => { if (active && learnSea(c.map, spots()) && kiteState.on) rings.later(); });
      }
      load();
    },
    disable({ map }) { active = false; rings.disable(map); },
    // для проверки и для расчёта стороны воды (tools/spot-sea.mjs)
    stats: () => ({ kite: Object.fromEntries(rings.kite), rated: rings.wx.size, sea: seaKnown.size }),
    seaAround: (lngLat) => seaAround(ctx.map, lngLat),
  });
}

// ---------- значки у троп ----------
// Включаются вместе с любым слоем троп. Со шкалы 3 км — вышки, смотровые площадки, маяки, пикник;
// остальное — со шкалы 500 м (Грегори: 3 км для всех — слишком густо, 100 м — слишком поздно).
// Метки краской (route_marker) не показываются — их десятки на каждой тропе. Капли воды — самые
// частые значки, поэтому позже всех (со шкалы «30 м») и крупнее (Грегори, 2026-10-28, travel-earth)
{
  const FAR_M = 5000, NEAR_M = 1000, WATER_M = 30, CELL = 0.5;
  const FAR_KINDS = ["tower", "viewpoint", "lighthouse", "picnic_site"];
  const SPARQL = `{ ?osm osmkey:tourism "viewpoint" . BIND("viewpoint" AS ?kind) }
    UNION { ?osm osmkey:tourism "picnic_site" . BIND("picnic_site" AS ?kind) }
    UNION { ?osm osmkey:tourism "camp_site" . BIND("campsite" AS ?kind) }
    UNION { ?osm osmkey:man_made "lighthouse" . BIND("lighthouse" AS ?kind) }
    UNION { ?osm osmkey:man_made "tower" . ?osm <https://www.openstreetmap.org/wiki/Key:tower:type> "observation" . BIND("tower" AS ?kind) }
    UNION { ?osm osmkey:amenity "drinking_water" . BIND("drinking_water" AS ?kind) }
    UNION { ?osm osmkey:leisure "firepit" . BIND("firepit" AS ?kind) }
    UNION { ?osm osmkey:tourism "information" . BIND("info" AS ?kind) OPTIONAL { ?osm osmkey:information ?info }
      OPTIONAL { ?osm osmkey:image ?img } }`;
  const features = new Map();
  let ctx = null, active = false, wired = false;
  const data = () => ({ type: "FeatureCollection", features: [...features.values()] });
  const loader = cellLoader(CELL, async (box) => {
    for (const { osm, coordinates, b } of await qleverBox("?info ?img", SPARQL, box)) {
      let kind = b.kind.value;
      if (kind === "info") {
        if (b.info?.value === "route_marker") continue;
        if (["guidepost", "board", "map"].includes(b.info?.value)) kind = b.info.value;
      }
      const hasPhoto = PHOTO_KINDS.includes(kind) && !!b.img;
      features.set(osm, { type: "Feature", geometry: { type: "Point", coordinates }, properties: { kind, osm, ...(hasPhoto && { hasPhoto: true }) } });
    }
    ctx?.map.getSource("trail-poi")?.setData(data());
  }, () => update());
  const update = () => {
    if (!active) return;
    const { map } = ctx;
    const far = zoomForScale(map, FAR_M), near = zoomForScale(map, NEAR_M), water = zoomForScale(map, WATER_M);
    if (map.getLayer("trail-poi-far")) {
      map.setLayerZoomRange("trail-poi-far", far, 24);
      map.setLayerZoomRange("trail-poi-near", near, 24);
      map.setLayerZoomRange("trail-poi-water", Math.min(water, 22), 24);
    }
    if (map.getZoom() >= far) loader.request(cellsInView(map, CELL));
  };
  const trailsOn = () => modules("layer").some((m) => m.id.startsWith("trails/") && m.active);
  const self = () => modules("layer").find((m) => m.id === "layers/trail-poi");

  register({
    id: "layers/trail-poi", kind: "layer", group: "hidden", title: "Значки у троп",
    needs: ["network"], sends: "район карты (QLever, OpenStreetMap)",
    enable(c) {
      ctx = c; active = true;
      const map = c.map;
      for (const k of Object.keys(ICONS)) icon(map, k);
      for (const k of PHOTO_KINDS) icon(map, k, true);
      const img = ["case", ["==", ["get", "hasPhoto"], true], ["concat", "outdoor-", ["get", "kind"], "-photo"], ["concat", "outdoor-", ["get", "kind"]]];
      const far = ["in", ["get", "kind"], ["literal", FAR_KINDS]];
      const water = ["==", ["get", "kind"], "drinking_water"];
      pointLayer(c, "trail-poi-near", { filter: ["all", ["!", far], ["!", water]], layout: { "icon-image": img, "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 1, 16, 1.2] } }, "trail-poi");
      pointLayer(c, "trail-poi-water", { filter: water, layout: { "icon-image": img, "icon-size": ["interpolate", ["linear"], ["zoom"], 16, 1.6, 19, 2] } }, "trail-poi");
      pointLayer(c, "trail-poi-far", { filter: far, layout: { "icon-image": img, "icon-allow-overlap": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 14, 1, 16, 1.2] } }, "trail-poi");
      map.getSource("trail-poi")?.setData(data());
      wireClick(c, "trail-poi-near");
      wireClick(c, "trail-poi-water");
      wireClick(c, "trail-poi-far");
      if (!wired) { wired = true; map.on("idle", update); }
      update();
    },
    disable({ map }) {
      active = false;
      loader.forgetPending();
      for (const id of ["trail-poi-far", "trail-poi-near", "trail-poi-water"]) if (map.getLayer(id)) map.removeLayer(id);
    },
  });

  // следует за тропами: включилась любая — значки тоже; выключились все — и значки
  on("module", async (e) => {
    if (!e?.id?.startsWith("trails/")) return;
    const m = self();
    const want = trailsOn();
    if (m && want !== m.active) await toggle(m.id, e.ctx, want).catch(() => {});
  }, { replay: false });
}

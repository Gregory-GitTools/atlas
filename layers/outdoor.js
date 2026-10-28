// Значки на природе (перенос из travel-earth): пляжи, сёрфинг и кайт, значки у троп (указатели,
// щиты, смотровые площадки и вышки, маяки, пикник, кемпинги, вода, кострища). Значки свои, в одном
// стиле: символ цвета группы с тонким кантом (не тенью); у жёлтых пляжа и кайта кант красный — на
// светлом море и песке белый теряется (Грегори, 2026-10-04). Наши значки — поверх подписей карты.
// Щелчок — окно: вид, название, высота, описание, направления указателя, у пляжа — покрытие и
// спасатели. Данные — QLever (core/qlever.js); у точек — теги из OSM API.
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
  kitesurfing: { color: YELLOW, outline: "#e53935", path: "M11.5 4.2Q17.5 -0.4 23.5 5.2L21.8 6.9Q17.5 3.1 12.7 6z M11.83 5.20L11.93 12.60L12.47 12.60L12.37 5.20z M22.45 5.87L12.05 12.37L12.35 12.83L22.75 6.33z M7.60 7.65a1.75 1.75 0 1 1 0 3.50a1.75 1.75 0 1 1 0 -3.50z M7.22 11.26L5.22 15.66L7.58 16.74L9.58 12.34z M8.27 12.44L12.07 13.24L12.33 11.96L8.53 11.16z M6.10 17.10L9.10 18.10L9.70 16.30L6.70 15.30z M8.79 17.79L10.99 20.09L12.21 18.91L10.01 16.61z M5.50 16.51L6.90 20.51L8.70 19.89L7.30 15.89z M1.98 21.13L15.77 18.70L16.48 19.28L16.02 20.07L2.23 22.50L1.52 21.92z" },
};
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

// окно значка: теги из OSM API (точки списка Грегори — без OSM, всё в самой точке)
async function showInfo(ctx, f) {
  const p = f.properties;
  let tags = p.osm?.startsWith("list/") ? { name: p.name, description: p.note } : null;
  if (!tags) tags = (await Promise.race([osmTags(p.osm).catch(() => null), new Promise((r) => setTimeout(r, 1500, null))])) || {};
  const lang = uiLanguage();
  const kind = [KIND_NAMES[p.kind], tags.ele && `${Math.round(tags.ele).toLocaleString("ru")} м`].filter(Boolean).join(" · ");
  const name = tags[`name:${lang}`] || tags.name;
  const surface = [SURFACE[tags.surface], (tags.supervised === "yes" || tags.lifeguard === "yes") && "спасатели"].filter(Boolean).join(", ");
  const box = document.createElement("div");
  const add = (cls, text) => text && box.append(Object.assign(document.createElement("div"), { className: cls, textContent: text }));
  add("popup-title", name || kind);
  if (name) add("popup-sub", kind);
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
  track(new ctx.maplibregl.Popup({ offset: 14, maxWidth: img ? "280px" : "260px" })).setLngLat(f.geometry.coordinates).setDOMContent(box).addTo(ctx.map);
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
    id: "layers/beaches", kind: "layer", title: "Пляжи", hint: "Пляжи — с масштаба 10 км", icon: glyphSvg("beach"),
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

// ---------- сёрфинг ----------
// sport=surfing|kitesurfing|windsurfing по всему миру, на любом масштабе (Грегори: «неограниченная
// видимость») — в OSM их ~1900, QLever отдаёт весь мир одним запросом. Плюс кайт-споты Эстонии из
// списка Грегори в Google Картах (surf-spots.json): точка OSM ближе 300 м к точке списка не рисуется
{
  const SPARQL = `?osm osmkey:sport ?kind . FILTER (?kind IN ("surfing", "kitesurfing", "windsurfing"))`;
  let list = null, osmPoints = null, loading = false, ctx = null;
  const data = () => {
    const own = list || [];
    const near = ([lon, lat]) => own.some((f) => Math.hypot((lon - f.geometry.coordinates[0]) * Math.cos((lat * Math.PI) / 180), lat - f.geometry.coordinates[1]) < 0.0027);
    return { type: "FeatureCollection", features: [...own, ...(osmPoints || []).filter((f) => !near(f.geometry.coordinates))] };
  };
  const load = async () => {
    if (loading) return;
    loading = true;
    if (!list) {
      try {
        list = (await (await fetch("surf-spots.json")).json()).map(({ name, note, lon, lat }, i) => ({ type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] }, properties: { kind: "kitesurfing", osm: `list/${i}`, name, note, rank: 0 } }));
      } catch { list = []; }
      ctx?.map.getSource("surf")?.setData(data());
    }
    if (!osmPoints) {
      try {
        osmPoints = (await qleverBox("", SPARQL, [-180, -90, 180, 90])).map(({ osm, coordinates, b }) => ({ type: "Feature",
          geometry: { type: "Point", coordinates }, properties: { kind: b.kind.value, osm, rank: 1 } }));
        ctx?.map.getSource("surf")?.setData(data());
      } catch { setTimeout(load, 60000); }
    }
    loading = false;
  };
  register({
    id: "layers/surf", kind: "layer", title: "Сёрфинг", hint: "Сёрфинг, кайт и виндсёрфинг по всему миру", icon: glyphSvg("kitesurfing"),
    needs: ["network"], sends: "запрос мест для сёрфинга (QLever, OpenStreetMap)",
    enable(c) {
      ctx = c;
      pointLayer(c, "surf", { layout: { "icon-image": icon(c.map, "kitesurfing"), "symbol-sort-key": ["get", "rank"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 8, 0.9, 14, 1, 16, 1.2] } });
      c.map.getSource("surf").setData(data());
      wireClick(c, "surf");
      load();
    },
    disable({ map }) { if (map.getLayer("surf")) map.removeLayer("surf"); },
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

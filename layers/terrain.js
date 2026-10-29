// Рельеф (перенос из travel-earth): тени склонов с 3D-рельефом и горизонтали с подписями высот.
// Высоты — AWS Terrain Tiles (terrarium), без ключа. Горизонтали строит в браузере
// maplibre-contour; он же даёт общий кэш картинок высот для теней и 3D (у каждого свой источник —
// MapLibre просит не делить один на двоих). Библиотека грузится при первом включении
// горизонталей или рельефа (правило «тяжёлое — по надобности»); не загрузилась — тени и 3D
// работают напрямую с AWS, горизонтали недоступны
import { register } from "../core/modules.js";
import { current } from "../core/events.js";

const DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const ATTRIBUTION = 'Высоты: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">AWS Terrain Tiles</a> (Mapzen, SRTM, USGS…)';
const CONTOUR_LIB = "https://unpkg.com/maplibre-contour@0.1.1/dist/index.mjs";
const svg = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${inner}</svg>`;

let demSource = null; // maplibre-contour
let libTried = false;
async function contourLib(maplibregl) {
  if (libTried) return demSource;
  libTried = true;
  try {
    const mlcontour = (await import(CONTOUR_LIB)).default;
    demSource = new mlcontour.DemSource({ url: DEM_URL, encoding: "terrarium", maxzoom: 13, worker: true });
    demSource.setupMaplibre(maplibregl);
  } catch (err) {
    console.warn("maplibre-contour не загрузился", err);
  }
  return demSource;
}

const dark = () => !!current("basemap")?.dark;
const firstSymbol = (map) => map.getStyle().layers.find((l) => l.type === "symbol")?.id;
const font = (map) => map.getStyle().layers.find((l) => l.type === "symbol" && Array.isArray(l.layout?.["text-font"]))?.layout["text-font"] || ["Noto Sans Regular"];
const dem = (map, id) => map.getSource(id) || map.addSource(id, {
  type: "raster-dem", tiles: [demSource ? demSource.sharedDemProtocolUrl : DEM_URL], encoding: "terrarium", tileSize: 256, maxzoom: 13, attribution: ATTRIBUTION });

// Рельеф — одна кнопка (Грегори, 2026-10-28: «Рельеф объединить с 3D-рельефом в один»): тени
// склонов и объёмные горы вместе; объём виден, когда карта наклонена
register({
  id: "layers/terrain",
  kind: "layer",
  group: "relief",
  title: "Тени и 3D",
  hint: "Тени склонов и объёмные горы — наклоните карту (правая кнопка мыши или два пальца)",
  icon: svg('<path d="M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z"/>'),
  needs: ["network"],
  sends: "район карты (AWS Terrain Tiles)",
  load: ({ maplibregl }) => contourLib(maplibregl),
  enable({ map }) {
    dem(map, "dem-hillshade");
    if (!map.getLayer("hillshade")) map.addLayer({ id: "hillshade", type: "hillshade", source: "dem-hillshade", paint: {
      "hillshade-exaggeration": 0.5,
      "hillshade-shadow-color": dark() ? "rgba(0,0,0,0.6)" : "rgba(60,50,40,0.45)",
      "hillshade-highlight-color": "rgba(255,255,255,0.25)" } }, firstSymbol(map));
    dem(map, "dem-3d");
    map.setTerrain({ source: "dem-3d", exaggeration: 1.3 });
  },
  disable({ map }) {
    if (map.getLayer("hillshade")) map.removeLayer("hillshade");
    // пока стиль карты перезагружается, рельефа и так нет
    if (map.style && map.getTerrain()) map.setTerrain(null);
  },
});

register({
  id: "layers/contours",
  kind: "layer",
  group: "relief",
  title: "Высоты",
  hint: "Линии равной высоты с подписями в метрах — с масштаба около 2 км",
  icon: svg('<g fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 15c0-5 4.5-9.5 10-9.5s9 3.5 9 7.5-4 6.5-9.5 6.5S2.5 19 2.5 15z"/><path d="M6.5 14.5c0-3 2.8-5.5 6-5.5s5.3 2 5.3 4.2-2.5 3.8-5.5 3.8-5.8-.3-5.8-2.5z"/></g><circle cx="12.3" cy="13.4" r="1.5"/>'),
  needs: ["network"],
  sends: "район карты (AWS Terrain Tiles)",
  async load({ maplibregl }) {
    if (!(await contourLib(maplibregl))) throw new Error("горизонтали недоступны");
  },
  enable({ map }) {
    if (!demSource || map.getLayer("contours")) return;
    if (!map.getSource("contours")) map.addSource("contours", { type: "vector", maxzoom: 15, attribution: ATTRIBUTION, tiles: [demSource.contourProtocolUrl({
      // зум: [шаг линий, шаг толстых линий с подписями], метры
      thresholds: { 11: [200, 1000], 12: [100, 500], 13: [50, 250], 14: [20, 100], 15: [10, 50] },
      contourLayer: "contours", elevationKey: "ele", levelKey: "level" })] });
    const color = dark() ? "#f0d9b5" : "#9c6b3f";
    const before = firstSymbol(map);
    map.addLayer({ id: "contours", type: "line", source: "contours", "source-layer": "contours", minzoom: 11,
      paint: { "line-color": color, "line-opacity": 0.6, "line-width": ["match", ["get", "level"], 1, 1.4, 0.6] } }, before);
    map.addLayer({ id: "contour-labels", type: "symbol", source: "contours", "source-layer": "contours", minzoom: 11,
      filter: [">", ["get", "level"], 0],
      layout: { "symbol-placement": "line", "text-field": ["concat", ["number-format", ["get", "ele"], {}], " м"], "text-font": font(map), "text-size": 11 },
      paint: { "text-color": color, "text-halo-width": 1.2, "text-halo-color": dark() ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.85)" } }, before);
  },
  disable({ map }) {
    for (const id of ["contour-labels", "contours"]) if (map.getLayer(id)) map.removeLayer(id);
  },
});

// Железные дороги — из тех же векторных тайлов OpenFreeMap, что и места (тайлы OpenRailwayMap
// закрыты для чужих сайтов). Цвет — по виду транспорта, как у флажков станций; тоннели пунктиром
register({
  id: "layers/railways",
  kind: "layer",
  group: "roads",
  title: "Железные дороги",
  hint: "Поезда, метро, трамваи и фуникулёры — каждый своим цветом",
  // знак «Железнодорожный переезд без шлагбаума» — паровоз в треугольнике (Грегори, 2026-10-29: «и поезд на
  // железные дороги» — в кружке «Дороги» все значки — дорожные знаки)
  icon: svg('<path fill-rule="evenodd" d="M12 2 23 21H1zm0 3.9L4.5 19h15z"/><path d="M13.6 10.2h3.1v5.4h-3.1zM7.3 12.4h6.3v3.2H7.3zM8.2 10.4h1.5v2H8.2z"/><circle cx="8.9" cy="16.6" r="1.1"/><circle cx="11.9" cy="16.6" r="1.1"/><circle cx="15.2" cy="16.6" r="1.1"/>'),
  needs: ["network"],
  sends: "район карты (OpenFreeMap)",
  enable({ map }) {
    if (!map.getSource("rail-tiles")) map.addSource("rail-tiles", { type: "vector", url: "https://tiles.openfreemap.org/planet" });
    const color = ["match", ["get", "subclass"], "subway", "#e53935", "tram", "#fb8c00", "light_rail", "#8e24aa", "monorail", "#8e24aa", "funicular", "#39ff14", "#3949ab"];
    const before = firstSymbol(map);
    for (const tunnel of [true, false]) {
      const id = tunnel ? "rail-tunnel" : "rail";
      if (map.getLayer(id)) continue;
      map.addLayer({ id, type: "line", source: "rail-tiles", "source-layer": "transportation", minzoom: 5,
        filter: ["all", ["in", ["get", "class"], ["literal", ["rail", "transit"]]], tunnel ? ["==", ["get", "brunnel"], "tunnel"] : ["!=", ["get", "brunnel"], "tunnel"]],
        layout: { "line-cap": tunnel ? "butt" : "round" },
        paint: { "line-color": color, "line-opacity": tunnel ? 0.55 : 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 10, 1.6, 16, 4], ...(tunnel && { "line-dasharray": [2, 1.5] }) } }, before);
    }
  },
  disable({ map }) {
    for (const id of ["rail", "rail-tunnel"]) if (map.getLayer(id)) map.removeLayer(id);
  },
});

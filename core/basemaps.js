// Подложки карты и переключатель по образцу Google Maps (как в travel-earth): плитка в правом
// нижнем углу показывает «другой» вид (на карте — Спутник, на спутнике — последнюю карту) и
// переключает одним щелчком; при наведении (на телефоне — нажатием) влево раскрывается ряд всех
// карт. Все векторные стили — на схеме OpenMapTiles, поэтому язык подписей переключается на любой.
// Выбор помнится. После смены стиля — событие "basemap" (слои и язык подписей ставятся заново
// по "style.load" самой карты)
import * as settings from "./settings.js";
import { emit } from "./events.js";
import { isMobile } from "./modules.js";

const OPENMAPTILES = { type: "vector", url: "https://tiles.openfreemap.org/planet" };
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

export const BASEMAPS = [
  { id: "satellite", name: "Спутник", hint: "Вид из космоса — спутниковые снимки Esri с подписями и границами", style: satelliteStyle, dark: true },
  { id: "liberty", name: "Яркая", hint: "OpenFreeMap Liberty", style: "https://tiles.openfreemap.org/styles/liberty" },
  { id: "bright", name: "Контрастная", hint: "OpenFreeMap Bright", style: "https://tiles.openfreemap.org/styles/bright" },
  { id: "voyager", name: "Пастельная", hint: "CARTO Voyager", style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json" },
  { id: "dark", name: "Тёмная", hint: "CARTO Dark Matter", style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json", dark: true },
];
const SATELLITE = BASEMAPS[0];
const DEFAULT = BASEMAPS.find((b) => b.id === "liberty"); // по умолчанию — Яркая (Грегори); «Светлую» Грегори убрал 2026-10-25

let current = BASEMAPS.find((b) => b.id === settings.get("basemap")) || DEFAULT;
let lastMap = current === SATELLITE ? DEFAULT : current;

export const currentBasemap = () => current;
export const styleOf = (b) => (typeof b.style === "function" ? b.style() : b.style);

// Спутник «как в Google»: снимки Esri + границы, крупные дороги и подписи из тех же векторных
// тайлов OpenFreeMap — белым с тёмной обводкой
function satelliteStyle() {
  const halo = { "text-color": "#fff", "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.4 };
  const place = (id, cls, font, size, minzoom, maxzoom = 24) => ({
    id, type: "symbol", source: "openmaptiles", "source-layer": "place", filter: ["==", ["get", "class"], cls], minzoom, maxzoom,
    layout: { "text-field": ["get", "name"], "text-font": [font], "text-size": size, "text-max-width": 8 }, paint: halo,
  });
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      esri: {
        type: "raster",
        // blankTile=false: где подробного снимка нет — 404 вместо картинки «Map data not yet available»,
        // и MapLibre растягивает последний настоящий снимок
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      },
      openmaptiles: OPENMAPTILES,
    },
    layers: [
      { id: "esri", type: "raster", source: "esri" },
      { id: "roads-major", type: "line", source: "openmaptiles", "source-layer": "transportation", minzoom: 6,
        filter: ["match", ["get", "class"], ["motorway", "trunk", "primary"], true, false],
        paint: { "line-color": "#ffe9a6", "line-opacity": 0.55, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 14, 3] } },
      { id: "roads-minor", type: "line", source: "openmaptiles", "source-layer": "transportation", minzoom: 12,
        filter: ["match", ["get", "class"], ["secondary", "tertiary", "minor"], true, false],
        paint: { "line-color": "#fff", "line-opacity": 0.35, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 2] } },
      { id: "boundary-state", type: "line", source: "openmaptiles", "source-layer": "boundary", minzoom: 4,
        filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": "#fff", "line-opacity": 0.35, "line-dasharray": [3, 2], "line-width": 0.8 } },
      { id: "boundary-country", type: "line", source: "openmaptiles", "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": "#fff", "line-opacity": 0.7, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 8, 1.6] } },
      { id: "road-names", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name", minzoom: 13,
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "symbol-placement": "line" }, paint: halo },
      { id: "water-names", type: "symbol", source: "openmaptiles", "source-layer": "water_name",
        filter: ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Italic"], "text-size": 12, "text-max-width": 6 },
        paint: { ...halo, "text-color": "#cde8ff" } },
      place("place-village", "village", "Noto Sans Regular", 11, 10),
      place("place-town", "town", "Noto Sans Regular", 12, 7),
      place("place-city", "city", "Noto Sans Bold", ["interpolate", ["linear"], ["zoom"], 4, 12, 10, 17], 3),
      place("place-country", "country", "Noto Sans Bold", ["interpolate", ["linear"], ["zoom"], 1, 11, 6, 16], 0, 8),
    ],
  };
}

export function initBasemaps({ map }) {
  const box = Object.assign(document.createElement("div"), { className: "basemaps" });
  const main = Object.assign(document.createElement("button"), { className: "basemap-main" });
  const row = Object.assign(document.createElement("div"), { className: "basemap-row" });
  box.append(main, row);
  document.body.append(box);

  const fill = (tile, b) => {
    tile.innerHTML = `<img alt=""><span class="basemap-label"></span>`;
    tile.querySelector("img").src = `icons/basemaps/${b.id}.jpg`;
    tile.querySelector(".basemap-label").textContent = b.name;
    tile.title = b.hint;
  };

  const select = (b) => {
    box.classList.remove("open");
    if (b === current) return;
    current = b;
    if (b !== SATELLITE) lastMap = b;
    settings.set("basemap", b.id);
    // diff: false — иначе MapLibre подставляет в новый стиль чужие шрифты (404 на глифы)
    map.setStyle(styleOf(b), { diff: false });
    render();
    emit("basemap", { id: b.id, dark: !!b.dark });
  };

  const render = () => {
    const other = current === SATELLITE ? lastMap : SATELLITE;
    fill(main, other);
    // на телефоне наведения нет — нажатие раскрывает ряд, а выбор — из ряда
    main.onclick = isMobile() ? () => box.classList.toggle("open") : () => select(other);
    row.replaceChildren(...BASEMAPS.map((b) => {
      const tile = Object.assign(document.createElement("button"), { className: "basemap-item" + (b === current ? " active" : "") });
      fill(tile, b);
      tile.addEventListener("click", () => select(b));
      return tile;
    }));
  };
  document.addEventListener("click", (e) => !box.contains(e.target) && box.classList.remove("open"));
  document.addEventListener("keydown", (e) => e.key === "Escape" && box.classList.remove("open"));
  render();
  emit("basemap", { id: current.id, dark: !!current.dark });
}

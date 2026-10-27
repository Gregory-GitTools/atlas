// Ядро Atlas: карта-глобус и загрузка модулей. Всё остальное — модули (см. modules.js)
import * as maplibregl from "https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs";
import { loadAll, modules, toggle, available } from "./modules.js";
import { initLayersPanel } from "./layers-panel.js";
import { initSettingsPanel } from "./settings-panel.js";
import { initBasemaps, currentBasemap, styleOf } from "./basemaps.js";
import { initSearch } from "./search.js";
import { addScale, addGeolocate, addStars } from "./controls.js";
import { initPopups } from "./popups.js";
import { initPlaceInfo } from "./place-info.js";

const status = (text) => { document.getElementById("status").textContent = text || ""; };

export const map = new maplibregl.Map({
  container: "map",
  style: styleOf(currentBasemap()),
  center: [25, 45],
  zoom: 1.6,
  attributionControl: { compact: true },
  // подписи кнопок и шкалы MapLibre — по-русски
  locale: {
    "AttributionControl.ToggleAttribution": "Источники карты",
    "Map.Title": "Карта",
    "Marker.Title": "Метка",
    "NavigationControl.ResetBearing": "Повернуть карту (щелчок — на север)",
    "NavigationControl.ZoomIn": "Приблизить",
    "NavigationControl.ZoomOut": "Отдалить",
    "Popup.Close": "Закрыть",
    "ScaleControl.Meters": "м",
    "ScaleControl.Kilometers": "км",
    "CooperativeGesturesHandler.MobileHelpText": "Двигайте карту двумя пальцами",
  },
});
map.on("style.load", () => map.setProjection({ type: "globe" }));
addStars(map);
addScale(map, maplibregl);
// строка источников — свёрнута в кнопку ⓘ (удалять нельзя — требование лицензий OSM, CARTO, Esri)
map.on("load", () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));

const ctx = { map, status, maplibregl };
window.atlas = { map, ctx, modules, toggle: (id, on) => toggle(id, ctx, on) }; // для отладки из консоли

initPopups(map);
initPlaceInfo(ctx);
initSearch(ctx);
initBasemaps(ctx);
initLayersPanel(ctx);
// столбик справа внизу, снизу вверх: настройки, «+ −», компас, «Где я»
initSettingsPanel(ctx);
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
map.addControl(new maplibregl.NavigationControl({ showZoom: false }), "bottom-right");
addGeolocate(map, maplibregl, status);
await loadAll();

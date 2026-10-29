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
import { initPhotoStrip, stripState } from "./photo-strip.js";

const status = (text) => { document.getElementById("status").textContent = text || ""; };

export const map = new maplibregl.Map({
  container: "map",
  style: styleOf(currentBasemap()),
  center: [25, 45],
  zoom: 1.6,
  attributionControl: false,
  // наклон — до 65° вместо стандартных 60 (Грегори, 2026-10-28: «увеличить наклон ещё на 5 градусов»)
  maxPitch: 65,
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
// строка источников — ⓘ слева внизу, рядом со шкалой
map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
// строка источников — свёрнута в кнопку ⓘ (удалять нельзя — требование лицензий OSM, CARTO, Esri)
map.on("load", () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));

const ctx = { map, status, maplibregl };
window.atlas = { map, ctx, modules, toggle: (id, on) => toggle(id, ctx, on), strip: stripState }; // для отладки из консоли

initPopups(map);
initPlaceInfo(ctx);
initPhotoStrip(ctx);
initSearch(ctx);
initBasemaps(ctx);
initLayersPanel(ctx);
// столбик слева внизу, снизу вверх: настройки, «+ −», компас, «Где я» (Грегори, 2026-10-29: справа
// остаётся только треугольник панели кнопок); шкала и ⓘ — справа от столбика
initSettingsPanel(ctx);
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");
map.addControl(new maplibregl.NavigationControl({ showZoom: false }), "bottom-left");
addGeolocate(map, maplibregl, status);
await loadAll();

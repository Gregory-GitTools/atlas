// Ядро Atlas: карта-глобус и загрузка модулей. Всё остальное — модули (см. modules.js)
import * as maplibregl from "https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs";
import { loadAll, modules, toggle, available } from "./modules.js";
import { initLayersPanel } from "./layers-panel.js";

const status = (text) => { document.getElementById("status").textContent = text || ""; };

export const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [24.75, 59.44],
  zoom: 2,
  attributionControl: { compact: true },
});
map.on("style.load", () => map.setProjection({ type: "globe" }));
map.addControl(new maplibregl.NavigationControl(), "bottom-right");

const ctx = { map, status, maplibregl };
window.atlas = { map, modules, toggle: (id, on) => toggle(id, ctx, on) }; // для отладки из консоли

initLayersPanel(ctx);
await loadAll();
map.once("load", () => {
  const usable = modules().filter(available);
  status(`Модулей: ${usable.length}`);
  setTimeout(() => status(""), 3000);
});

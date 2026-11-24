// Ядро Atlas: карта-глобус и загрузка модулей. Всё остальное — модули (см. modules.js)
import * as maplibregl from "https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs";
import { loadAll, modules, toggle, available } from "./modules.js";
import { initLayersPanel } from "./layers-panel.js";
import { initSettingsPanel } from "./settings-panel.js";
import { initBasemaps, currentBasemap, styleOf } from "./basemaps.js";
import { initSearch } from "./search.js";
import { applyLabels } from "./labels.js";
import "./touch-tip.js"; // долгое нажатие на телефоне — подпись кнопки
import { addScale, addGeolocate, addCompass, addStars, MAX_PITCH } from "./controls.js";
import { initPopups } from "./popups.js";
import { initPlaceInfo } from "./place-info.js";
import { initForecast } from "./forecast.js";
import { initPhotoStrip, stripState } from "./photo-strip.js";
import { initRoute } from "./route.js";
import { VERSION, updated, appVersion } from "./version.js";

// фоновый модуль карты — со своего адреса (почему — в core/maplibre-worker.js)
maplibregl.setWorkerUrl(new URL("../core/maplibre-worker.js", import.meta.url).href);

const status = (text) => { document.getElementById("status").textContent = text || ""; };

export const map = new maplibregl.Map({
  container: "map",
  style: styleOf(currentBasemap()),
  center: [25, 45],
  zoom: 1.6,
  attributionControl: false,
  // наклон — до 70° вместо стандартных 60 (Грегори, 2026-10-28 и 2026-11-02: «ещё на 5 градусов»);
  // издалека меньше — см. tiltLimit в controls.js
  maxPitch: MAX_PITCH,
  // крупный вид (core/ui-scale.js) растягивает страницу — карта рисуется во столько же раз подробнее, без размытия
  pixelRatio: (devicePixelRatio || 1) * (window.atlasUi?.scale || 1),
  // подписи кнопок и шкалы MapLibre — по-русски
  locale: {
    "AttributionControl.ToggleAttribution": "Источники карты",
    "Map.Title": "Карта",
    "Marker.Title": "Метка",
    "Popup.Close": "Закрыть",
    "ScaleControl.Meters": "м",
    "ScaleControl.Kilometers": "км",
    "CooperativeGesturesHandler.MobileHelpText": "Двигайте карту двумя пальцами",
  },
});
addEventListener("atlas-ui-scale", () => map.setPixelRatio((devicePixelRatio || 1) * (window.atlasUi?.scale || 1)));
map.on("style.load", () => map.setProjection({ type: "globe" }));
// при открытии глобус крупно — космоса около 10 % экрана — и лёгкий поворот к Европе (Грегори 2026-11-13).
// Глобус на экране меньше расчётного (перспектива) — масштаб подбирается замером: точка на глобусе
// возвращается в тот же пиксель, мимо — нет; доля космоса — по кругу, обрезанному краями экрана
const EUROPE = [15, 50], SPACE = 0.1;
function fillZoom() {
  const W = map.getCanvas().clientWidth, H = map.getCanvas().clientHeight;
  const on = (x) => { const q = map.project(map.unproject([x, H / 2])); return Math.abs(q.x - x) < 2 && Math.abs(q.y - H / 2) < 2; };
  const radius = () => { let a = 0, b = Math.max(W, H) * 2; for (let i = 0; i < 14; i++) { const m = (a + b) / 2; on(W / 2 + m) ? (a = m) : (b = m); } return a; };
  const space = (R) => { let s = 0; for (let i = 0; i < 200; i++) { const x = -W / 2 + ((i + 0.5) * W) / 200; s += x * x < R * R ? 2 * Math.min(H / 2, Math.sqrt(R * R - x * x)) : 0; } return 1 - (s * W) / 200 / (W * H); };
  let lo = 0.5, hi = 6;
  for (let i = 0; i < 12; i++) {
    const z = (lo + hi) / 2;
    map.jumpTo({ center: EUROPE, zoom: z });
    space(radius()) > SPACE ? (lo = z) : (hi = z);
  }
  return lo;
}
map.once("load", () => {
  const start = { center: map.getCenter(), zoom: map.getZoom() }, zoom = fillZoom();
  map.jumpTo(start);
  map.easeTo({ center: EUROPE, zoom, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 2500 });
});
addStars(map);
addScale(map, maplibregl);
// строка источников — ⓘ слева внизу, рядом со шкалой
map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
// строка источников — свёрнута в кнопку ⓘ (удалять нельзя — требование лицензий OSM, CARTO, Esri); при
// запуске MapLibre раскрывает её сам — не даём (Грегори 2026-11-05: «текст не обязательно каждый раз
// показывать»): раскрывается только щелчком по ⓘ
{
  const attrib = document.querySelector(".maplibregl-ctrl-attrib");
  let asked = false;
  attrib?.addEventListener("click", (e) => { if (e.target.closest(".maplibregl-ctrl-attrib-button")) asked = true; }, true);
  const keep = () => { if (!asked && attrib.classList.contains("maplibregl-compact-show")) attrib.classList.remove("maplibregl-compact-show"); };
  if (attrib) { keep(); new MutationObserver(keep).observe(attrib, { attributes: true, attributeFilter: ["class"] }); }
  // щелчок вне раскрытого окна — свернуть (Грегори 2026-11-24: «окно информации должно закрываться при клике вне окна»)
  addEventListener("pointerdown", (e) => { if (attrib && !(e.target instanceof Node && attrib.contains(e.target))) attrib.classList.remove("maplibregl-compact-show"); }, true);
}
// первой строкой в ⓘ — версия: коммит и дата обновления (Грегори 2026-11-06: «буду ориентироваться по
// дате»). Узнаётся у GitHub по первому нажатию на ⓘ (открытый репозиторий, ничего своего не уходит);
// нет сети — дата файла страницы
{
  const attrib = document.querySelector(".maplibregl-ctrl-attrib");
  const line = Object.assign(document.createElement("div"), { className: "attrib-version" });
  // дата и время обновления (Грегори 2026-11-10: «ставь ещё и время, а то непонятно»); номер — core/version.js
  const day = (d) => `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  const app = appVersion() ? ` · приложение ${appVersion()}` : "";
  line.textContent = `Atlas ${VERSION}${app} · обновлено ${updated()}`;
  attrib?.prepend(line);
  let asked = false;
  attrib?.addEventListener("click", async () => {
    if (asked) return;
    asked = true;
    try {
      const r = await fetch("https://api.github.com/repos/Gregory-GitTools/atlas/commits?per_page=1");
      const c = r.ok && (await r.json())[0];
      if (c) line.textContent = `Atlas ${VERSION}${app} · ${c.sha.slice(0, 7)} · ${day(new Date(c.commit.committer.date))}`;
    } catch { /* без сети — остаётся дата страницы */ }
  });
}

const ctx = { map, status, maplibregl };
window.atlas = { map, ctx, modules, toggle: (id, on) => toggle(id, ctx, on), strip: stripState }; // для отладки из консоли

initPopups(map);
initPlaceInfo(ctx);
initForecast(ctx); // лента прогноза внизу
initPhotoStrip(ctx);
initSearch(ctx);
initBasemaps(ctx);
initLayersPanel(ctx);
// столбик слева внизу, снизу вверх: настройки, компас 2D/3D, «Где я» — полупрозрачные, как лупа и
// треугольник (Грегори, 2026-11-02: «+ −» убраны); шкала и ⓘ — справа от столбика
initSettingsPanel(ctx); // шестерёнка — в столбике справа под логотипом
// язык подписей — в Настройках (Грегори 2026-11-21: «кнопку языков прячем»); стиль сменился — подписи заново
map.on("style.load", () => applyLabels(map));
addCompass(map);
window.atlas.geo = addGeolocate(map, maplibregl, status);
window.atlas.route = initRoute(ctx);
await loadAll();

// без сети (Грегори 2026-11-18: «в режиме полёта видно только звёздное небо») — сказать, что карта есть только
// в скачанных районах; нет ни одного — где скачать. Сеть пропала на ходу — то же
{
  const { trips } = await import("./offline.js");
  const say = () => { if (!navigator.onLine) status(trips().length ? "Нет сети — карта видна в скачанных районах" : "Нет сети — карта видна только в скачанных районах. Скачать: Настройки → «Карта без сети»"); };
  say();
  addEventListener("offline", say);
  addEventListener("online", () => status(""));
}

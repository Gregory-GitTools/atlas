// Куда идти (Грегори, 2026-11-03: «не навигация — только ориентация заранее выбранных точек»).
// Это основа: точка-цель (помнится), на карте — красная метка и пунктир от меня до неё (по дуге
// большого круга), расстояние и сторона света — без сети, где я — от навигации (событие «me»).
// «Проложить путь» — пешком, на велосипеде, на машине: одна линия по дорогам и тропам с длиной и
// временем (сервер маршрутов OpenStreetMap, routing.openstreetmap.de, без ключа). Без подсказок
// на поворотах и без пересчёта на ходу. Только по нажатию: туда уходят начало и конец пути.
// Окно — раздел «Навигация» (content/navigation.js, Грегори 2026-11-04: «окно маршрута — в окно
// поиска»): он шлёт route-target / route-way, отсюда — событие route с тем, что показать.
// В каждом окне на карте — «Сюда»: точка — цель, открывается окно навигации (route-open)
import { register, modules, allowed } from "./modules.js";
import { on, emit } from "./events.js";
import { decoratePopups, closeAll } from "./popups.js";
import * as settings from "./settings.js";

register({
  id: "core/route",
  kind: "service",
  title: "Путь к точке",
  sends: "начало и конец пути — только по кнопке «Проложить путь» (сервер маршрутов OpenStreetMap)",
});
const self = () => modules("service").find((m) => m.id === "core/route");

const OSRM = "https://routing.openstreetmap.de";
const ROUTE_COLOR = "#0a5cff"; // ярко-синий: красный терялся среди дорог (Грегори 2026-11-04)
// цель на карте — синий флажок финиша, цвета навигации (Грегори 2026-11-05: «не мельчи со значком»);
// древко внизу слева — ровно в точке
const FLAG = `<svg viewBox="0 0 44 52" width="44" height="52"><defs><pattern id="go-chk" width="12" height="12" patternUnits="userSpaceOnUse" x="7" y="3">
<rect width="12" height="12" fill="#fff"/><rect width="6" height="6" fill="${"#0a5cff"}"/><rect x="6" y="6" width="6" height="6" fill="${"#0a5cff"}"/></pattern></defs>
<path d="M7 4 Q19 0 25 4 T42 4 V26 Q36 30 25 26 T7 26 Z" fill="url(#go-chk)" stroke="#0a3fb0" stroke-width="2" stroke-linejoin="round"/>
<rect x="3" y="2" width="5" height="49" rx="2.5" fill="#0a3fb0" stroke="#fff" stroke-width="1.5"/></svg>`;
const flagMarker = (ml) => {
  const el = document.createElement("div");
  el.className = "go-flag";
  el.innerHTML = FLAG;
  return new ml.Marker({ element: el, anchor: "bottom-left", offset: [-5, 0] });
};
// показать весь путь: я, точка и линия по дорогам (Грегори 2026-11-05: «при первом „Сюда“ покажи весь путь»)
export const fitPath = (map, pts) => {
  pts = pts.filter(Boolean);
  if (!map || !pts.length) return;
  const pad = innerWidth <= 600 ? { top: Math.round(innerHeight * 0.45), bottom: 90, left: 40, right: 40 } : { top: 110, bottom: 110, left: 440, right: 90 };
  if (pts.length < 2) { map.flyTo({ center: pts[0], zoom: Math.max(map.getZoom(), 14), duration: 1500 }, { navFollow: true }); return; }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: pad, maxZoom: 16, duration: 1500 }, { navFollow: true });
};
const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="${d}"/></svg>`;
// значки — те же, что у видов активности треков (Pictogrammers MDI)
export const WAYS = [
  { id: "foot", title: "Пешком", icon: svg("M14.12,10H19V8.2H15.38L13.38,4.87C13.08,4.37 12.54,4.03 11.92,4.03C11.74,4.03 11.58,4.06 11.42,4.11L6,5.8V11H7.8V7.33L9.91,6.67L6,22H7.8L10.67,13.89L13,17V22H14.8V15.59L12.31,11.05L13.04,8.18M14,3.8C15,3.8 15.8,3 15.8,2C15.8,1 15,0.2 14,0.2C13,0.2 12.2,1 12.2,2C12.2,3 13,3.8 14,3.8Z") },
  { id: "bike", title: "На велосипеде", icon: svg("M5,20.5A3.5,3.5 0 0,1 1.5,17A3.5,3.5 0 0,1 5,13.5A3.5,3.5 0 0,1 8.5,17A3.5,3.5 0 0,1 5,20.5M5,12A5,5 0 0,0 0,17A5,5 0 0,0 5,22A5,5 0 0,0 10,17A5,5 0 0,0 5,12M14.8,10H19V8.2H15.8L13.86,4.93C13.57,4.43 13,4.1 12.4,4.1C11.93,4.1 11.5,4.29 11.2,4.6L7.5,8.29C7.19,8.6 7,9 7,9.5C7,10.13 7.33,10.66 7.85,10.97L11.2,13V18H13V11.5L10.75,9.85L13.07,7.5M19,20.5A3.5,3.5 0 0,1 15.5,17A3.5,3.5 0 0,1 19,13.5A3.5,3.5 0 0,1 22.5,17A3.5,3.5 0 0,1 19,20.5M19,12A5,5 0 0,0 14,17A5,5 0 0,0 19,22A5,5 0 0,0 24,17A5,5 0 0,0 19,12M16,4.8C17,4.8 17.8,4 17.8,3C17.8,2 17,1.2 16,1.2C15,1.2 14.2,2 14.2,3C14.2,4 15,4.8 16,4.8Z") },
  { id: "car", title: "На машине", icon: svg("M5,11L6.5,6.5H17.5L19,11M17.5,16A1.5,1.5 0 0,1 16,14.5A1.5,1.5 0 0,1 17.5,13A1.5,1.5 0 0,1 19,14.5A1.5,1.5 0 0,1 17.5,16M6.5,16A1.5,1.5 0 0,1 5,14.5A1.5,1.5 0 0,1 6.5,13A1.5,1.5 0 0,1 8,14.5A1.5,1.5 0 0,1 6.5,16M18.92,6C18.72,5.42 18.16,5 17.5,5H6.5C5.84,5 5.28,5.42 5.08,6L3,12V20A1,1 0 0,0 4,21H5A1,1 0 0,0 6,20V19H18V20A1,1 0 0,0 19,21H20A1,1 0 0,0 21,20V12L18.92,6Z") },
];
export const ARROW = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2l7 19-7-4-7 4z" fill="currentColor"/></svg>`;
const SIDES = ["на север", "на северо-восток", "на восток", "на юго-восток", "на юг", "на юго-запад", "на запад", "на северо-запад"];

const k = Math.PI / 180;
const distance = (a, b) => {
  const s = Math.sin(((b[1] - a[1]) * k) / 2) ** 2 + Math.cos(a[1] * k) * Math.cos(b[1] * k) * Math.sin(((b[0] - a[0]) * k) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(s)));
};
const bearing = (a, b) => {
  const la1 = a[1] * k, la2 = b[1] * k, dl = (b[0] - a[0]) * k;
  return (Math.atan2(Math.sin(dl) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl)) / k + 360) % 360;
};
// дуга большого круга — издалека прямая на глобусе не ложится на поверхность
function arc(a, b) {
  const v = ([lon, lat]) => [Math.cos(lat * k) * Math.cos(lon * k), Math.cos(lat * k) * Math.sin(lon * k), Math.sin(lat * k)];
  const [p, q] = [v(a), v(b)], w = Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
  if (w < 1e-6) return [a, b];
  const n = Math.max(2, Math.ceil(w / (Math.PI / 180))), out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s1 = Math.sin((1 - t) * w) / Math.sin(w), s2 = Math.sin(t * w) / Math.sin(w);
    const x = s1 * p[0] + s2 * q[0], y = s1 * p[1] + s2 * q[1], z = s1 * p[2] + s2 * q[2];
    out.push([Math.atan2(y, x) / k, Math.atan2(z, Math.hypot(x, y)) / k]);
  }
  // через линию смены дат — без скачка на 360°
  for (let i = 1; i < out.length; i++) while (out[i][0] - out[i - 1][0] > 180) out[i][0] -= 360;
  for (let i = 1; i < out.length; i++) while (out[i][0] - out[i - 1][0] < -180) out[i][0] += 360;
  return out;
}
export const km = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toLocaleString("ru", { maximumFractionDigits: m < 10000 ? 1 : 0 })} км`);
export const time = (s) => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, "0")} мин`; };
const h = (tag, cls, text = "") => Object.assign(document.createElement(tag), { className: cls, textContent: text });
const line = (coords) => ({ type: "FeatureCollection", features: coords ? [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }] : [] });

export function initRoute({ map, maplibregl, status }) {
  let target = settings.get("route.target"); // { lngLat, title }
  let me = null, marker = null, route = null, asked = 0; // route: { way, coords, distance, duration }

  // что показать окну навигации: точка, где я, расстояние, сторона, стрелка относительно экрана, путь
  let busy = null; // способ, для которого ищем путь
  const show = () => {
    const d = me && target ? distance(me, target.lngLat) : null, b = me && target ? bearing(me, target.lngLat) : null;
    const way = route && WAYS.find((w) => w.id === route.way);
    emit("route", {
      target, me: !!me, canRoute: allowed(self()) && !!me && !!target, busy,
      distance: d, side: b === null ? "" : SIDES[Math.round(b / 45) % 8], arrow: b === null ? 0 : b - map.getBearing(),
      main: d === null ? "" : `${km(d)} ${SIDES[Math.round(b / 45) % 8]}`,
      route: route && { way: route.way, title: way.title, distance: route.distance, duration: route.duration, text: `${way.title}: ${km(route.distance)} · ${time(route.duration)}`, points: route.coords.length },
    });
  };

  const draw = () => {
    map.getSource("go-line")?.setData(line(me && target ? arc(me, target.lngLat) : null));
    map.getSource("go-route")?.setData(line(target && route?.coords));
  };
  const addLayers = () => {
    if (map.getSource("go-line")) return;
    map.addSource("go-line", { type: "geojson", data: line(null) });
    map.addSource("go-route", { type: "geojson", data: line(null) });
    map.addLayer({ id: "go-route-casing", type: "line", source: "go-route", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#fff", "line-width": 10 } });
    map.addLayer({ id: "go-route", type: "line", source: "go-route", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ROUTE_COLOR, "line-width": 6 } });
    map.addLayer({ id: "go-line", type: "line", source: "go-line", layout: { "line-cap": "round" },
      paint: { "line-color": "#e53935", "line-width": 2.5, "line-dasharray": [2, 2] } });
    draw();
  };
  // линии пути — поверх всех слоёв (модули добавляют свои позже, и путь уходил под дороги —
  // Грегори 2026-11-04: «проложенный маршрут не видно»)
  const LAYERS = ["go-route-casing", "go-route", "go-line"];
  const raise = () => {
    const ids = map.getStyle()?.layers?.map((l) => l.id) || [];
    if (ids.slice(-LAYERS.length).join() !== LAYERS.join()) for (const id of LAYERS) if (map.getLayer(id)) map.moveLayer(id);
  };
  map.on("styledata", () => { if (map.getLayer("go-line")) raise(); });
  map.on("style.load", addLayers);
  if (map.isStyleLoaded()) addLayers();

  const setTarget = (t) => {
    target = t;
    route = null;
    busy = null;
    asked++;
    settings.set("route.target", t);
    marker?.remove();
    marker = t ? flagMarker(maplibregl).setLngLat(t.lngLat).addTo(map) : null;
    draw();
    show();
  };

  // путь по дорогам: один запрос по нажатию; пока ждали — сменили точку или способ — ответ не нужен
  const ask = async (way) => {
    if (!me || !target || !allowed(self())) return;
    if (route?.way === way.id) { route = null; draw(); show(); return; } // второе нажатие — убрать путь
    const n = ++asked;
    busy = way.id;
    show();
    try {
      const [a, b] = [me, target.lngLat].map((p) => p.map((x) => x.toFixed(6)).join(","));
      const res = await fetch(`${OSRM}/routed-${way.id}/route/v1/driving/${a};${b}?overview=full&geometries=geojson`);
      const r = res.ok ? (await res.json()).routes?.[0] : null;
      if (n !== asked) return;
      busy = null;
      if (!r) { status("Путь не найден"); setTimeout(() => status(""), 4000); show(); return; }
      route = { way: way.id, coords: r.geometry.coordinates, distance: r.distance, duration: r.duration };
      fitPath(map, [me, ...route.coords, target.lngLat]); // путь пришёл — весь на экран
    } catch {
      if (n !== asked) return;
      busy = null;
      status("Не удаётся проложить путь"); setTimeout(() => status(""), 4000);
    }
    draw();
    show();
  };

  // навигацию выключили — проложенный путь убирается (точка остаётся; Грегори 2026-11-04)
  on("me", (p) => { me = p?.lngLat || null; if (!me && route) { route = null; asked++; } draw(); show(); });
  map.on("rotate", show);

  // «Сюда» в окне на карте — только при включённой навигации (Грегори 2026-11-05: «нашёл что-то на слоях,
  // перешёл в навигацию и „Сюда“; в других режимах окно — только сведения об объекте»)
  let navOn = false;
  on("nav", (n) => { navOn = !!n?.on; document.querySelectorAll(".go-here").forEach((b) => (b.hidden = !navOn)); });
  decoratePopups((popup) => {
    const content = popup.getElement()?.querySelector(".maplibregl-popup-content");
    if (!content || content.querySelector(".go-here")) return;
    const btn = h("button", "go-here text-btn", "Сюда");
    btn.type = "button";
    btn.title = "Показать, куда идти к этой точке";
    btn.addEventListener("click", () => {
      const { lng, lat } = popup.getLngLat();
      // пустое место на карте: названия нет — первая часть адреса, адрес — подписью (Грегори 2026-11-05:
      // в истории было «59.42599, 24.80124» дважды); адреса нет — координаты один раз
      const named = content.querySelector(".popup-title")?.textContent?.trim();
      const addr = content.querySelector(".popup-sub")?.textContent?.trim() || "";
      const coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      const title = named || addr.split(", ").slice(0, 2).join(", ") || coords;
      const address = named ? addr : addr || "";
      closeAll();
      setTarget({ lngLat: [lng, lat], title });
      emit("route-open", { lngLat: [lng, lat], title, address: address || (title === coords ? "" : coords) });
    });
    btn.hidden = !navOn;
    content.append(btn);
    // окно стало выше — пусть MapLibre заново выберет, куда его повернуть, чтобы не ушло за край экрана
    // (Грегори 2026-11-04: на телефоне окно «Сюда» уходило за край)
    popup.setLngLat(popup.getLngLat());
  });

  // окно навигации: выбрать точку (null — убрать) и проложить путь
  on("route-target", (t) => setTarget(t), { replay: false });
  on("route-way", ({ way }) => { const w = WAYS.find((x) => x.id === way); if (w) ask(w); }, { replay: false });

  // при запуске точки нет (Грегори 2026-11-05): навигация не включается, точка — в истории окна навигации
  target = null;
  settings.set("route.target", null);
  show();
  // для проверки
  return { state: () => ({ target, me, route: route && { way: route.way, distance: route.distance, points: route.coords.length } }), setTarget };
}

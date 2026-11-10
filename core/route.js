// Куда идти (Грегори, 2026-11-03: «не навигация — только ориентация заранее выбранных точек»).
// Это основа: точка-цель (помнится), на карте — красная метка и пунктир от меня до неё (по дуге
// большого круга), расстояние и сторона света — без сети, где я — от навигации (событие «me»).
// «Проложить путь» — пешком, на велосипеде, на машине: одна линия по дорогам и тропам с длиной и
// временем (сервер маршрутов OpenStreetMap, routing.openstreetmap.de, без ключа). Без подсказок
// на поворотах и без пересчёта на ходу. Только по нажатию: туда уходят начало и конец пути.
// Окно — раздел «Навигация» (content/navigation.js, Грегори 2026-11-04: «окно маршрута — в окно
// поиска»): он шлёт route-target / route-way, отсюда — событие route с тем, что показать.
// В каждом окне на карте при навигации — ряд кнопок (Грегори 2026-11-09): стрелка «Сюда» (точка — цель,
// открывается окно навигации, route-open), «Добавить» (остановка по пути — перед финишем), «Поделиться»,
// «Отметить» (флажок на карте, помнится); вверху окна «⋯» — «Сохранить маршрут» (в список «Куда»),
// «Поделиться маршрутом» (ссылка Google Карт), «Сохранить трек» (файл GPX).
// Маршрут с остановками — запись в списке «Куда» (Грегори 2026-11-10: «добавить точку в любой момент —
// маршрут сразу переписывается с точками и сохраняется в истории как маршрут»): каждая правка (добавили,
// убрали, переставили остановку, сменили способ) — событие route-edit, навигация обновляет запись
import { register, modules, allowed } from "./modules.js";
import { on, emit } from "./events.js";
import { decoratePopups, closeAll, track } from "./popups.js";
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
const icon = (d, size = 26) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="currentColor" d="${d}"/></svg>`;
export const NAV_ARROW = icon("M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z");
export const ADD_ICON = icon("M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M13,7H11V11H7V13H11V17H13V13H17V11H13V7Z");
export const SHARE_ICON = icon("M18,16.08C17.24,16.08 16.56,16.38 16.04,16.85L8.91,12.7C8.96,12.47 9,12.24 9,12C9,11.76 8.96,11.53 8.91,11.3L15.96,7.19C16.5,7.69 17.21,8 18,8A3,3 0 0,0 21,5A3,3 0 0,0 18,2A3,3 0 0,0 15,5C15,5.24 15.04,5.47 15.09,5.7L8.04,9.81C7.5,9.31 6.79,9 6,9A3,3 0 0,0 3,12A3,3 0 0,0 6,15C6.79,15 7.5,14.69 8.04,14.19L15.16,18.34C15.11,18.55 15.08,18.77 15.08,19C15.08,20.61 16.39,21.91 18,21.91C19.61,21.91 20.92,20.61 20.92,19A2.92,2.92 0 0,0 18,16.08Z");
export const MARK_ICON = icon("M12.36,6L12.76,8H18V14H14.64L14.24,12H7V6H12.36M14,4H5V21H7V14H12.6L13,16H20V6H14.4");
export const MARKED_ICON = icon("M14.4,6L14,4H5V21H7V14H12.6L13,16H20V6H14.4Z");
const MORE_ICON = icon("M16,12A2,2 0 0,1 18,10A2,2 0 0,1 20,12A2,2 0 0,1 18,14A2,2 0 0,1 16,12M10,12A2,2 0 0,1 12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12M4,12A2,2 0 0,1 6,10A2,2 0 0,1 8,12A2,2 0 0,1 6,14A2,2 0 0,1 4,12Z", 22);
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
  // остановки по пути — до финиша, по порядку («Добавить» в окне места); пройденная (ближе 40 м) уходит
  let stops = [], stopMarkers = [];
  let savedId = null; // запись маршрута в списке «Куда», к которой привязан текущий путь
  let savedName = null, lastGpx = ""; // её своё название (переименовали) — для файла и ссылки
  const next = () => stops[0]?.lngLat || target?.lngLat;
  let me = null, marker = null, route = null, asked = 0; // route: { way, coords, distance, duration }

  // что показать окну навигации: точка, где я, расстояние, сторона, стрелка относительно экрана, путь
  let busy = null; // способ, для которого ищем путь
  const show = () => {
    const d = me && target ? distance(me, next()) : null, b = me && target ? bearing(me, next()) : null;
    const way = route && WAYS.find((w) => w.id === route.way);
    emit("route", {
      target, stops: stops.map((s) => s.title), saved: savedId, me: !!me, canRoute: allowed(self()) && !!me && !!target, busy,
      distance: d, side: b === null ? "" : SIDES[Math.round(b / 45) % 8], arrow: b === null ? 0 : b - map.getBearing(),
      main: d === null ? "" : `${km(d)} ${SIDES[Math.round(b / 45) % 8]}`,
      route: route && { way: route.way, title: way.title, distance: route.distance, duration: route.duration, text: `${way.title}: ${km(route.distance)} · ${time(route.duration)}`, points: route.coords.length },
    });
  };

  // пройденное стирается: путь — от ближайшей ко мне точки (Грегори 2026-11-06: «показывать только
  // оставшийся путь»); ищем вперёд от прежней ближайшей — назад по пути не прыгает
  let passed = 0, passedAt = null;
  const ahead = () => {
    if (!route) return null;
    if (me && (!passedAt || distance(passedAt, me) > 5)) {
      passedAt = me;
      let best = passed, bd = Infinity;
      for (let i = passed; i < route.coords.length; i++) { const d = distance(me, route.coords[i]); if (d < bd) { bd = d; best = i; } }
      if (bd < 60) passed = best; // с пути не сошёл — пройденное до ближайшей точки
    }
    return route.coords.slice(passed);
  };
  const draw = () => {
    const pts = target ? [me, ...stops.map((s) => s.lngLat), target.lngLat].filter(Boolean) : [];
    map.getSource("go-line")?.setData(line(pts.length > 1 ? pts.slice(1).flatMap((p, i) => arc(pts[i], p)) : null));
    const rest = target && ahead();
    map.getSource("go-route")?.setData(line(rest && me ? [me, ...rest] : rest));
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

  // окно отметки или точки маршрута (Грегори 2026-11-10): то же окно места с кнопками; крестик окна —
  // удалить (отметку, остановку, финиш), оставить — щелчок мимо или Esc
  const itemPopup = (p, role, remove, removeTitle) => {
    closeAll();
    const box = document.createElement("div");
    box.append(h("div", "popup-title", p.title), ...(p.address ? [h("div", "popup-sub", p.address)] : []), h("div", "popup-role", role));
    const popup = new maplibregl.Popup({ offset: 26, maxWidth: "280px" }).setLngLat(p.lngLat).setDOMContent(box);
    popup.atlasRemove = { fn: remove, title: removeTitle };
    track(popup).addTo(map);
    return popup;
  };
  const pointEl = (el, open) => {
    el.addEventListener("click", (e) => { e.stopPropagation(); open(); });
    return el;
  };
  const drawStops = () => {
    stopMarkers.forEach((m) => m.remove());
    stopMarkers = stops.map((s, i) => {
      const el = pointEl(h("div", "go-stop", String(i + 1)), () => {
        const k = stops.indexOf(s);
        if (k >= 0) itemPopup(s, `Остановка ${k + 1}`, () => { const j = stops.indexOf(s); if (j >= 0) removeStop(j); }, "Убрать остановку");
      });
      el.title = s.title;
      return new maplibregl.Marker({ element: el }).setLngLat(s.lngLat).addTo(map);
    });
  };
  // финиш убрали: остановки остались — последняя становится финишем; нет — точки больше нет
  const removeFinish = () => {
    if (!target) return;
    if (!stops.length) { emit("route-target", null); return; }
    const last = stops.pop(), w = route && WAYS.find((x) => x.id === route.way);
    target = { lngLat: last.lngLat, title: last.title, address: last.address || "" };
    marker?.setLngLat(target.lngLat);
    drawStops();
    route = null;
    edited();
    draw();
    show();
    if (w) ask(w, true);
  };
  const setTarget = (t) => {
    stops = t?.stops ? t.stops.map((s) => ({ ...s })) : [];
    savedId = t?.saved || null;
    savedName = t?.name || null;
    target = t && { lngLat: t.lngLat, title: t.title, address: t.address };
    drawStops();
    route = null;
    busy = null;
    asked++;
    settings.set("route.target", t);
    marker?.remove();
    marker = t ? flagMarker(maplibregl).setLngLat(t.lngLat).addTo(map) : null;
    if (marker) pointEl(marker.getElement(), () => itemPopup(target, "Финиш", removeFinish, "Убрать финиш"));
    passed = 0; passedAt = null;
    draw();
    show();
    // сохранённый маршрут — и путь тем же способом, если знаю, где я
    const w = t?.way && WAYS.find((x) => x.id === t.way);
    if (w && me) ask(w);
  };
  // правка маршрута — в его запись в списке «Куда» (записи ещё нет — появляется)
  const edited = () => {
    if (!target) return;
    savedId ||= `r${Date.now()}`;
    emit("route-edit", { saved: savedId, lngLat: target.lngLat, title: target.title, address: target.address || "",
      stops: stops.map((x) => ({ lngLat: x.lngLat, title: x.title })), way: route?.way || busy || null });
  };
  // остановка по пути: точки ещё нет — она и есть цель; путь уже проложен — заново, через остановку
  const addStop = (p) => {
    if (!target) return setTarget(p);
    stops.push({ lngLat: p.lngLat, title: p.title, address: p.address || "" });
    edited();
    drawStops();
    const w = route && WAYS.find((x) => x.id === route.way);
    route = null;
    draw();
    show();
    if (w) ask(w, true);
  };
  const removeStop = (i) => {
    stops.splice(i, 1);
    edited();
    drawStops();
    const w = route && WAYS.find((x) => x.id === route.way);
    route = null;
    draw();
    show();
    if (w) ask(w, true);
  };

  // путь по дорогам: один запрос по нажатию; пока ждали — сменили точку или способ — ответ не нужен
  const ask = async (way, again = false) => {
    if (!me || !target || !allowed(self())) return;
    if (route?.way === way.id && !again) { route = null; draw(); show(); return; } // второе нажатие — убрать путь
    const n = ++asked;
    busy = way.id;
    show();
    try {
      const via = [me, ...stops.map((s) => s.lngLat), target.lngLat].map((p) => p.map((x) => x.toFixed(6)).join(",")).join(";");
      const res = await fetch(`${OSRM}/routed-${way.id}/route/v1/driving/${via}?overview=full&geometries=geojson`);
      const r = res.ok ? (await res.json()).routes?.[0] : null;
      if (n !== asked) return;
      busy = null;
      if (!r) { status("Путь не найден"); setTimeout(() => status(""), 4000); show(); return; }
      route = { way: way.id, coords: r.geometry.coordinates, distance: r.distance, duration: r.duration };
      passed = 0; passedAt = null;
      if (savedId) edited(); // способ — тоже часть маршрута
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
  on("me", (p) => {
    me = p?.lngLat || null;
    if (!me && route) { route = null; asked++; }
    // дошёл до остановки — она пройдена, дальше — к следующей
    if (me && stops.length && distance(me, stops[0].lngLat) < 40) { stops.shift(); drawStops(); }
    draw();
    show();
  });
  map.on("rotate", show);

  // ---------- отметки: флажки на карте, помнятся (только на этом устройстве) ----------
  const MARKS = "route.marks";
  let marks = settings.get(MARKS, []), markMarkers = [];
  const markId = (p) => `${p.lngLat[0].toFixed(5)},${p.lngLat[1].toFixed(5)}`;
  const isMarked = (p) => marks.some((m) => markId(m) === markId(p));
  const drawMarks = () => {
    markMarkers.forEach((m) => m.remove());
    markMarkers = marks.map((m) => {
      const el = h("div", "go-mark");
      el.innerHTML = MARKED_ICON;
      el.title = m.title;
      // щелчок по флажку — окно этого места с теми же кнопками; крестик окна — снять отметку
      pointEl(el, () => itemPopup(m, "Отметка", () => { if (isMarked(m)) toggleMark(m); }, "Снять отметку"));
      return new maplibregl.Marker({ element: el, anchor: "bottom-left", offset: [-4, 0] }).setLngLat(m.lngLat).addTo(map);
    });
  };
  const toggleMark = (p) => {
    marks = isMarked(p) ? marks.filter((m) => markId(m) !== markId(p)) : [...marks, { lngLat: p.lngLat, title: p.title, address: p.address || "" }];
    settings.set(MARKS, marks.length ? marks : null);
    drawMarks();
  };
  drawMarks();

  // ---------- окно места при навигации: стрелка «Сюда», «Добавить», «Поделиться», «Отметить»; «⋯» вверху ----------
  // (Грегори 2026-11-05: в других режимах окно — только сведения об объекте)
  let navOn = false;
  on("nav", (n) => { navOn = !!n?.on; document.querySelectorAll(".maplibregl-popup-content:not(.go-item) > :is(.go-actions, .go-more)").forEach((b) => (b.hidden = !navOn)); });
  // место из окна: названия нет — первая часть адреса, адрес — подписью; адреса нет — координаты
  const placeOf = (popup, content) => {
    const { lng, lat } = popup.getLngLat();
    const named = content.querySelector(".popup-title")?.textContent?.trim();
    const addr = content.querySelector(".popup-sub")?.textContent?.trim() || "";
    const coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const title = named || addr.split(", ").slice(0, 2).join(", ") || coords;
    return { lngLat: [lng, lat], title, address: named ? addr : addr || (title === coords ? "" : coords) };
  };
  const button = (cls, title, html, fn) => {
    const b = h("button", cls);
    Object.assign(b, { type: "button", title, innerHTML: html });
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(b); });
    return b;
  };
  // «Поделиться» — ссылка Google Карт (Грегори 2026-11-10): на телефоне — системное окно, иначе — в буфер
  const ll = (p) => p.lngLat.slice().reverse().map((x) => x.toFixed(6)).join(",");
  const send = async (title, text, url, done) => {
    try {
      if (navigator.share) { await navigator.share({ title, text, url }); return; }
      await navigator.clipboard.writeText(`${title} — ${url}`);
      status(done); setTimeout(() => status(""), 3000);
    } catch { /* отказались от «Поделиться» */ }
  };
  const share = (p) => send(p.title, p.title, `https://www.google.com/maps/search/?api=1&query=${ll(p)}`, "Ссылка на место скопирована");
  // маршрут — ссылка «Как добраться» Google Карт: начало — там, где её откроют, через остановки к финишу
  const MODES = { foot: "walking", bike: "bicycling", car: "driving" };
  const routeUrl = (t, via, way) => "https://www.google.com/maps/dir/?api=1&destination=" + ll(t)
    + (via.length ? "&waypoints=" + encodeURIComponent(via.map(ll).join("|")) : "") + (MODES[way] ? "&travelmode=" + MODES[way] : "");
  const shareRoute = (p) => {
    const t = target || p, via = target ? stops : [];
    send(`Маршрут: ${savedName || t.title}`, via.length ? `${via.map((x) => x.title).join(" → ")} → ${t.title}` : t.title,
      routeUrl(t, via, route?.way || null), "Ссылка на маршрут скопирована");
  };
  // «Сохранить трек» — файл GPX: точки маршрута (остановки и финиш) и линия пути по дорогам, если проложен;
  // не проложен — прямые от точки к точке
  const ESC = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" };
  const xml = (t) => String(t).replace(/[<>&"]/g, (c) => ESC[c]);
  const pt = (tag, [lng, lat], inner = "") => `<${tag} lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">${inner}</${tag}>`;
  const gpx = (p) => {
    const t = target || p, via = target ? stops : [], all = [...via, t];
    const name = savedName || t.title;
    const wpts = all.map((x, i) => pt("wpt", x.lngLat, `<name>${xml(i < all.length - 1 ? `${i + 1}. ${x.title}` : x.title)}</name>`));
    const path = target && route ? `<trk><name>${xml(name)}</name><trkseg>${route.coords.map((c) => pt("trkpt", c)).join("")}</trkseg></trk>`
      : `<rte><name>${xml(name)}</name>${[...(me ? [{ lngLat: me }] : []), ...all].map((x) => pt("rtept", x.lngLat)).join("")}</rte>`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Atlas" xmlns="http://www.topografix.com/GPX/1/1">\n`
      + `<metadata><name>${xml(name)}</name></metadata>\n${wpts.join("\n")}\n${path}\n</gpx>\n`;
  };
  const saveGpx = (p) => {
    const t = target || p, text = gpx(p);
    const file = `${(savedName || t.title).replace(/[\\/:*?"<>|]+/g, " ").trim() || "маршрут"}.gpx`;
    const a = Object.assign(document.createElement("a"), { download: file, href: URL.createObjectURL(new Blob([text], { type: "application/gpx+xml" })) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    lastGpx = text;
  };
  // название маршрута (переименованная запись в списке «Куда») — для файла и ссылки
  on("route-name", (n) => { savedName = n || null; }, { replay: false });
  on("route-share", () => target && shareRoute(target), { replay: false });
  on("route-gpx", () => target && saveGpx(target), { replay: false });
  decoratePopups((popup) => {
    const content = popup.getElement()?.querySelector(".maplibregl-popup-content");
    if (!content || content.querySelector(".go-actions")) return;
    const row = h("div", "go-actions");
    const go = button("go-act go-here", "Сюда", NAV_ARROW, () => {
      const p = placeOf(popup, content);
      closeAll();
      setTarget(p);
      emit("route-open", p);
    });
    const add = button("go-act go-add", "Добавить в путь", ADD_ICON, () => {
      const p = placeOf(popup, content);
      closeAll();
      if (target) { addStop(p); emit("route-card-show"); } else { setTarget(p); emit("route-open", p); }
    });
    const mark = button("go-act go-flagit", "Отметить", MARK_ICON, (b) => {
      toggleMark(placeOf(popup, content));
      paintMark(b);
    });
    const paintMark = (b) => { const on_ = isMarked(placeOf(popup, content)); b.innerHTML = on_ ? MARKED_ICON : MARK_ICON; b.classList.toggle("on", on_); b.title = on_ ? "Снять отметку" : "Отметить"; };
    paintMark(mark);
    row.append(go, add, button("go-act go-share", "Поделиться", SHARE_ICON, () => share(placeOf(popup, content))), mark);
    // «⋯» — рядом с крестиком: «Сохранить маршрут» (есть цель — текущий путь, нет — путь сюда)
    const menu = h("div", "go-menu menu");
    menu.hidden = true;
    const item = (text, fn) => {
      const b = h("button", "menu-item", text);
      b.type = "button";
      b.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = true; fn(placeOf(popup, content)); });
      return b;
    };
    menu.append(
      // есть цель — текущий маршрут (его запись в списке «Куда»), нет — маршрут сюда
      item("Сохранить маршрут", (p) => {
        if (target) edited();
        else emit("route-save", { lngLat: p.lngLat, title: p.title, address: p.address || "", stops: [], way: null });
        status(`Маршрут «${savedName || (target || p).title}» сохранён — он в списке «Куда»`); setTimeout(() => status(""), 3000);
      }),
      item("Поделиться маршрутом", shareRoute),
      item("Сохранить трек (GPX)", saveGpx));
    const more = button("go-more", "Ещё", MORE_ICON, () => { menu.hidden = !menu.hidden; });
    // окно отметки или точки маршрута — кнопки и без навигации; крестик окна удаляет
    const own = popup.atlasRemove;
    row.hidden = more.hidden = !navOn && !own;
    if (own) {
      content.classList.add("go-item");
      const x = popup.getElement().querySelector(".maplibregl-popup-close-button");
      if (x) {
        x.title = own.title;
        x.setAttribute("aria-label", own.title);
        x.addEventListener("click", () => own.fn(), { capture: true });
      }
    }
    content.append(row, more, menu);
    content.classList.add("has-more");
    // окно стало выше — пусть MapLibre заново выберет, куда его повернуть, чтобы не ушло за край экрана
    popup.setLngLat(popup.getLngLat());
  });

  // окно навигации: выбрать точку (null — убрать) и проложить путь
  on("route-target", (t) => setTarget(t), { replay: false });
  on("route-stop-remove", (i) => removeStop(i), { replay: false });
  on("route-way", ({ way }) => { const w = WAYS.find((x) => x.id === way); if (w) ask(w); }, { replay: false });
  // карточку пути открыли — весь оставшийся путь на экран; есть сеть — путь заново от того места, где я
  // (Грегори 2026-11-06: «что будет в середине маршрута? пересчитывать при открытии карточки»)
  on("route-show", () => {
    if (!target) return;
    const w = route && WAYS.find((x) => x.id === route.way);
    if (w && me && navigator.onLine && allowed(self())) { ask(w, true); return; }
    fitPath(map, [me, ...stops.map((x) => x.lngLat), ...(ahead() || []), target.lngLat]);
  }, { replay: false });

  // при запуске точки нет (Грегори 2026-11-05): навигация не включается, точка — в истории окна навигации
  target = null;
  settings.set("route.target", null);
  show();
  // для проверки
  return { state: () => ({ target, me, saved: savedId, stops: stops.map((x) => x.title), marks: marks.map((m) => m.title), route: route && { way: route.way, distance: route.distance, points: route.coords.length } }),
    setTarget, addStop, toggleMark, routeUrl: (p) => routeUrl(target || p, target ? stops : [], route?.way || null), gpx, lastGpx: () => lastGpx };
}

// Мои споты (Грегори 2026-11-12, по образцу «избранного» Windy: «куда ехать в субботу»). Спот отмечается
// звёздочкой в своём окне на карте (layers/outdoor.js), список — здесь: у каждого спота полоса на 7 дней
// по 3 часа, цвет — годность ветра для кайта по тем же правилам, что строка «Кайт» в окне спота
// (core/forecast.js: от 6 м/с, направление спота, с берега — нельзя, только при свете), под ней —
// ближайшее хорошее окно. Сверху — споты, где хорошее окно раньше. Щелчок — карта к споту и его окно,
// крестик — убрать звёздочку. Список — только на устройстве (settings `kite.favorites`, событие
// `kite-favorites`); прогноз — один запрос на все споты при открытии, помнится час (тяжёлого не заводить)
import { register } from "../core/modules.js";
import { createPanel, isOpen } from "../core/panel.js";
import { emit, on } from "../core/events.js";
import * as settings from "../core/settings.js";
import { kiteRate, isLight, KITE_COLORS } from "../core/forecast.js";

export const STAR = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2.6l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>';
const HOUR = 3600000;
const favorites = () => settings.get("kite.favorites", []);

const panel = createPanel({ id: "spots", title: "Мои споты", icon: STAR.replace('width="24" height="24"', 'width="18" height="18"'), side: "left" });
let ctxRef = null, cache = { t: 0, keys: "", data: [] };

async function forecast(list) {
  const keys = list.map((s) => s.key).join("|");
  if (cache.keys === keys && cache.t > Date.now() - HOUR) return cache.data;
  if (!list.length) return [];
  const params = new URLSearchParams({ latitude: list.map((s) => s.lat.toFixed(3)).join(","), longitude: list.map((s) => s.lon.toFixed(3)).join(","),
    hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m", daily: "sunrise,sunset", wind_speed_unit: "ms",
    timeformat: "unixtime", timezone: "auto", forecast_days: 7, temporal_resolution: "hourly_3" });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`);
  const d = await res.json();
  cache = { t: Date.now(), keys, data: Array.isArray(d) ? d : [d] };
  return cache.data;
}

// полоса спота: уровни по шагам с текущего, начало ближайшего хорошего окна и его конец
function rateSpot(spot, d) {
  const h = d.hourly, off = d.utc_offset_seconds || 0, now = Date.now() / 1000;
  const steps = h.time.map((t, k) => k).filter((k) => h.time[k] + 10800 > now).map((k) => ({ t: h.time[k], light: isLight(d.daily, h.time[k]),
    level: isLight(d.daily, h.time[k]) ? kiteRate(h.wind_speed_10m[k], h.wind_gusts_10m[k], h.wind_direction_10m[k], spot) : "night" }));
  const a = steps.findIndex((s) => s.level === "good");
  let b = a;
  while (b >= 0 && b + 1 < steps.length && steps[b + 1].level === "good") b++;
  const local = (t) => new Date((t + off) * 1000);
  const hm = (t) => local(t).toISOString().slice(11, 16);
  const day = (t) => local(t).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", timeZone: "UTC" });
  const win = a < 0 ? null : { t: steps[a].t, text: `${day(steps[a].t)}, ${hm(steps[a].t)}–${hm(steps[b].t + 10800)}` };
  return { steps, win, dayStart: (t) => hm(t) === "00:00" };
}

const el = (tag, cls, text, parent) => { const e = Object.assign(document.createElement(tag), { className: cls || "", textContent: text ?? "" }); parent?.append(e); return e; };

async function render() {
  const list = favorites();
  panel.body.replaceChildren();
  if (!list.length) {
    el("p", "pb-hint", "Здесь будут ваши споты. Откройте спот на карте («Кайт в Эстонии» или «Сёрфинг») и нажмите звёздочку в его окне.", panel.body);
    return;
  }
  const wait = el("p", "pb-hint", "Прогноз…", panel.body);
  let data;
  try { data = await forecast(list); } catch { wait.textContent = "Прогноз не загрузился"; return; }
  if (!isOpen("spots")) return;
  const rows = list.map((s, i) => ({ s, r: rateSpot(s, data[i]) }))
    .sort((x, y) => (x.r.win?.t ?? Infinity) - (y.r.win?.t ?? Infinity));
  const box = el("div", "ks-list");
  for (const { s, r } of rows) {
    const line = el("div", "home-line ks-line", "", box);
    const row = el("button", "tr-row home-row ks-row", "", line);
    row.type = "button";
    row.title = "Показать на карте";
    el("span", "ks-name", s.name, row);
    const strip = el("span", "ks-strip", "", row);
    for (const st of r.steps) {
      const c = el("i", [!st.light && "ks-dark", r.dayStart(st.t) && "ks-day"].filter(Boolean).join(" "), "", strip);
      if (KITE_COLORS[st.level]) c.style.background = KITE_COLORS[st.level];
    }
    el("span", "ks-win" + (r.win ? "" : " none"), r.win ? `Кайт: ${r.win.text}` : "На неделе ветер не подходит", row);
    row.addEventListener("click", () => emit("kite-spot-open", { ...s, ctx: ctxRef }));
    const x = el("button", "search-delete", "", line);
    x.type = "button";
    x.title = "Убрать из моих спотов";
    x.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    x.addEventListener("click", () => setFavorite(s, false));
  }
  el("p", "pb-hint ks-legend", "Зелёное — подходит, оранжевое — сильно, красное — нельзя (с берега, шторм); тёмное — ночь. Прогноз Open-Meteo.", box);
  panel.body.replaceChildren(box);
}

// отметить/снять спот: { key, kind, name, lon, lat, dirs, sea, off, rescue }
export function setFavorite(spot, on) {
  const list = favorites().filter((s) => s.key !== spot.key);
  if (on) list.push(spot);
  settings.set("kite.favorites", list);
  emit("kite-favorites", list.map((s) => s.key));
  if (isOpen("spots")) render();
}
emit("kite-favorites", favorites().map((s) => s.key));
on("kite-favorite-set", ({ spot, on: v }) => setFavorite(spot, v), { replay: false });

register({
  id: "content/spots",
  kind: "content",
  title: "Мои споты",
  tone: "weather",
  hint: "Мои кайт-споты: когда ветер подходит на неделе",
  icon: STAR,
  needs: ["network"],
  sends: "точки моих спотов — прогноз ветра (Open-Meteo)",
  column: {
    home: (ctx) => { ctxRef = ctx; panel.open(); render(); },
    isOpen: () => isOpen("spots"),
    close: () => panel.close(),
  },
  stats: () => ({ favorites: favorites().length, rows: panel.body.querySelectorAll(".ks-row").length,
    wins: [...panel.body.querySelectorAll(".ks-win")].map((w) => w.textContent) }),
});

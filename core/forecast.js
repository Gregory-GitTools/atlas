// Прогноз погоды в точке — общий для окна места (core/place-info.js), узла ветра (layers/weather.js) и окна
// кайт-спота (layers/outdoor.js), Грегори 2026-11-11: «прогноз на несколько дней, порывы, волна для сёрфинга,
// погода в окне кайт-спота»; 2026-11-14: погода — у любого места, прогноз — лентой внизу. Open-Meteo (без
// ключа): ветер, порывы, температура, осадки — 5 дней назад и 7 вперёд с шагом 3 часа; на воде — ещё волна
// (Marine API: высота, направление, период). Время — местное для точки.
// Сеть — только по вызову: модули, которые его зовут, объявляют это в своём `sends`.
import { on, emit } from "./events.js";
import { modules, toggle } from "./modules.js";

const API = "https://api.open-meteo.com/v1/forecast";
const MARINE = "https://marine-api.open-meteo.com/v1/marine";

// пороги силы ветра в м/с и цвета, как у Windy (штиль — голубой … шторм — фиолетовый)
export const WIND_COLORS = [[0, "#9ecae1"], [4, "#41ab5d"], [6, "#f2d024"], [9, "#fd8d3c"], [13, "#e31a1c"], [18, "#8e24aa"]];
export const windColor = (ms) => WIND_COLORS.filter(([k]) => ms >= k).at(-1)[1];
const DIRS = ["С", "ССВ", "СВ", "ВСВ", "В", "ВЮВ", "ЮВ", "ЮЮВ", "Ю", "ЮЮЗ", "ЮЗ", "ЗЮЗ", "З", "ЗСЗ", "СЗ", "ССЗ"];
export const dirName = (deg) => DIRS[Math.round(deg / 22.5) % 16];

// кайт — правила безопасности (Грегори 2026-11-12): кататься — от 6 м/с; **ветер с берега без спасателей —
// выходить запрещено** (спасатели — только на особых спотах, `rescue`); у спота — допустимые направления
// (`dirs`, «W,SW,NW»: из описания спота, с сайтов клуба и kiteforum или по берегу). Кольцо-рекомендация —
// только когда всё сходится. spot: { sea, dirs, off, rescue }:
//   sea — 16 знаков по румбам от спота (С, ССВ, … ССЗ): «1» — в 1,2 км вода, «0» — суша, «?» — не знаем;
//   off — направления, которые описание спота называет оффшорными (флэт за косой и т. п.) — тоже «с берега»
const D16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const KITE_MIN = 6;
export const KITE_COLORS = { good: "#2e9d43", strong: "#fd8d3c", storm: "#e31a1c", off: "#e31a1c", rescue: "#fd8d3c" };
const KITE_TEXT = { calm: `мало ветра (нужно от ${KITE_MIN} м/с)`, dir: "направление ветра не для этого спота", good: "подходит",
  strong: "сильно — только для опытных", storm: "опасно сильно", off: "ветер с берега — выходить запрещено",
  rescue: "ветер с берега — только при дежурстве спасателей", night: "темно — кататься только при свете" };
const idx = (deg) => Math.round(deg / 22.5) % 16;
const list = (s) => (s ? s.split(",").map((x) => D16.indexOf(x.trim())).filter((k) => k >= 0) : null);
// ветер с суши: в 1,2 км по направлению, откуда дует, и в ±22,5° от него — суша; или описание называет его оффшорным
export function fromLand(from, spot) {
  if (from == null) return null;
  const d = idx(from);
  if (list(spot?.off)?.includes(d)) return true;
  const sea = spot?.sea;
  if (!sea || sea[d] === "?") return null;
  return sea[d] === "0" && sea[(d + 15) % 16] === "0" && sea[(d + 1) % 16] === "0";
}
// направление из допустимых (с запасом в соседний румб — прогноз ошибается на 20°); null — не знаем
export function dirOk(from, spot) {
  const ok = list(spot?.dirs);
  if (!ok?.length || from == null) return null;
  const d = idx(from);
  return ok.includes(d) || ok.includes((d + 15) % 16) || ok.includes((d + 1) % 16);
}
export function kiteRate(ms, gust, from, spot) {
  if (ms < KITE_MIN) return "calm";
  if (fromLand(from, spot)) return spot?.rescue ? "rescue" : "off";
  if (ms >= 17 || gust >= 22) return "storm";
  if (dirOk(from, spot) === false) return "dir";
  return ms >= 13 ? "strong" : "good";
}
// светло ли в шаг прогноза [t, t+3 ч): середина шага между восходом и закатом своего дня (daily Open-Meteo,
// unixtime). Кайт — только при свете (Грегори 2026-11-12, по образцу Windy: «рассвет, закат, сумерки»)
export function isLight(daily, t) {
  if (!daily?.sunrise) return true;
  const mid = t + 5400;
  return daily.sunrise.some((up, k) => mid >= up && mid <= daily.sunset[k]);
}
// «W,SW» → «З, ЮЗ»
export const dirsRu = (s) => (list(s) || []).map((k) => DIRS[k]).join(", ");

const r0 = (v) => Math.round(v);
const r1 = (v) => (Math.round(v * 10) / 10).toLocaleString("ru-RU");
const el = (tag, cls, text, parent) => { const e = Object.assign(document.createElement(tag), { className: cls || "", textContent: text ?? "" }); parent?.append(e); return e; };
const btn = (cls, title, html) => { const b = el("button", cls); b.type = "button"; b.title = title; b.innerHTML = html; return b; };
// стрелка «куда дует» (направление ветра и волны в метео — откуда)
const arrow = (from, color, title) => {
  const a = el("span", "wx-dir", "↑");
  a.style.transform = `rotate(${(from + 180) % 360}deg)`;
  if (color) a.style.color = color;
  a.title = title;
  return a;
};

// прогноз точки: 5 прошедших дней (Грегори 2026-11-14: «не обрубать прошлый прогноз») и 7 вперёд по 3 часа.
// Ответ помнится 10 минут — значок погоды в окне места, окно погоды и лента внизу берут один и тот же
export const PAST = 5;
const cache = new Map(); // "что:lat,lon" → { t, p }
const once = (what, [lon, lat], get) => {
  const key = `${what}:${(+lat).toFixed(2)},${(+lon).toFixed(2)}`, hit = cache.get(key);
  if (hit && hit.t > Date.now() - 600000) return hit.p;
  const p = get(lon, lat);
  p.catch(() => cache.delete(key));
  cache.set(key, { t: Date.now(), p });
  return p;
};
const common = (lon, lat) => ({ latitude: lat, longitude: lon, timezone: "auto", timeformat: "unixtime", past_days: PAST, forecast_days: 7, temporal_resolution: "hourly_3" });
const loadWx = (ll) => once("wx", ll, (lon, lat) => fetch(`${API}?${new URLSearchParams({ ...common(lon, lat), wind_speed_unit: "ms",
  hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,precipitation,weather_code", daily: "sunrise,sunset" })}`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Open-Meteo: ${r.status}`)))));
// волна — только на воде: на суше Marine API отвечает пустыми значениями или ошибкой
const loadSea = (ll) => once("sea", ll, (lon, lat) => fetch(`${MARINE}?${new URLSearchParams({ ...common(lon, lat), hourly: "wave_height,wave_direction,wave_period" })}`)
  .then((r) => (r.ok ? r.json() : null)).catch(() => null));
async function load(ll) {
  const [d, m] = await Promise.all([loadWx(ll), loadSea(ll)]);
  return { d, waves: m?.hourly?.wave_height?.some((v) => v != null) ? m.hourly : null };
}

// разбор ответа: время места (секунды UTC + сдвиг пояса, показ — как UTC), шаг на время, свет
const view = ({ d, waves = null }) => {
  const h = d.hourly, off = d.utc_offset_seconds || 0;
  const local = (t) => new Date((t + off) * 1000);
  const stepAt = (t) => { const k = h.time.findIndex((x) => x + 10800 > (t ?? Date.now() / 1000)); return k < 0 ? h.time.length - 1 : k; };
  const today = () => { const n = Date.now() / 1000, k = (d.daily?.time || []).findIndex((t) => t <= n && n < t + 86400); return k < 0 ? 0 : k; };
  return { h, waves, daily: d.daily, stepAt, today, nowK: () => stepAt(null),
    hm: (t) => local(t).toISOString().slice(11, 16),
    dayKey: (t) => local(t).toISOString().slice(0, 10),
    dayName: (t) => local(t).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
    dayShort: (t) => local(t).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", timeZone: "UTC" }).replace(",", ""),
    wave: (k) => (waves && waves.wave_height[k] != null ? waves.wave_height[k] : null),
    light: (k) => isLight(d.daily, h.time[k]) };
};
// шапка на шаг k: ветер и порывы, ниже — время, температура, осадки, волна
const paintNow = (v, k, head, sub) => {
  const { h } = v;
  head.replaceChildren(arrow(h.wind_direction_10m[k], windColor(h.wind_speed_10m[k]), dirName(h.wind_direction_10m[k])),
    ` Ветер ${r0(h.wind_speed_10m[k])} м/с, порывы ${r0(h.wind_gusts_10m[k])} · ${dirName(h.wind_direction_10m[k])}`);
  sub.textContent = [k === v.nowK() ? "Сейчас" : `${v.dayName(h.time[k])}, ${v.hm(h.time[k])}`, `${r0(h.temperature_2m[k])}°`,
    h.precipitation[k] >= 0.1 && `осадки ${r1(h.precipitation[k])} мм`, v.wave(k) != null && `волна ${r1(v.wave(k))} м`].filter(Boolean).join(" · ");
};
const sunLine = (v, box) => {
  const k = v.today();
  if (v.daily?.sunrise?.[k]) el("div", "popup-row wx-sun", `Восход ${v.hm(v.daily.sunrise[k])} · закат ${v.hm(v.daily.sunset[k])}`, box);
};

// значок погоды по коду WMO (weather_code Open-Meteo): ясно, переменная облачность, облачно, туман, дождь
// (и морось), снег, гроза; ясно ночью — луна. Одноцветные, как остальные значки
const SUN = '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
const MOON = '<path d="M14.5 3a9 9 0 1 0 6.5 14.5A7.5 7.5 0 0 1 14.5 3z"/>';
const CLOUD = '<path d="M7 18h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 10.6 3.7 3.7 0 0 0 7 18z"/>';
const UP = (x) => `<g transform="translate(0 -4)">${x}</g>`;
const SKY = {
  clear: ["Ясно", (day) => (day ? SUN : MOON)],
  partly: ["Переменная облачность", (day) => `<g transform="translate(-2 -3) scale(.75)">${day ? SUN : MOON}</g><g stroke="var(--panel)" stroke-width="1.6" transform="translate(2 2) scale(.85)">${CLOUD}</g>`],
  cloud: ["Облачно", () => CLOUD],
  fog: ["Туман", () => '<path d="M4 8h16M3 12h18M5 16h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'],
  rain: ["Дождь", () => UP(CLOUD) + '<path d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'],
  snow: ["Снег", () => UP(CLOUD) + '<circle cx="8" cy="19" r="1.3"/><circle cx="12" cy="21" r="1.3"/><circle cx="16" cy="19" r="1.3"/>'],
  storm: ["Гроза", () => UP(CLOUD) + '<path d="M12.5 14 9 19.5h3l-1 3.5 4-5.5h-3l1.5-3.5z"/>'],
};
const sky = (code) => (code == null ? null : code <= 1 ? "clear" : code === 2 ? "partly" : code === 3 ? "cloud" : code <= 48 ? "fog"
  : (code >= 71 && code <= 77) || code === 85 || code === 86 ? "snow" : code >= 95 ? "storm" : "rain");

// таблица по образцу Windy (Грегори 2026-11-12): шаги ks по 3 часа слева направо, листается вбок; строки —
// сверху вниз, как у Windy (Грегори 2026-11-14): часы, значок погоды, температура, направление, у спота «Кайт»
// (зелёная — подходит, оранжевая — сильно, красная — с берега или шторм, пусто — нет), ветер и порывы
// цветными клетками, осадки, волна. Ночь — затемнена, прошедшее —
// бледнее; выбранное время — в рамке. pick(k) — щелчок по столбцу
function table(v, ks, { kite = null, pick } = {}) {
  const { h } = v, nowK = v.nowK();
  const rate = (k) => (v.light(k) ? kiteRate(h.wind_speed_10m[k], h.wind_gusts_10m[k], h.wind_direction_10m[k], kite) : "night");
  const wrap = el("div", "wx-grid-wrap");
  const grid = el("table", "wx-grid", "", wrap);
  const cols = new Map(); // шаг → клетки столбца
  const row = (label, title) => { const tr = el("tr", "", "", grid); const th = el("th", "", label, tr); if (title) th.title = title; return tr; };
  const cell = (tr, k, text, cls = "") => {
    const td = el("td", [cls, !v.light(k) && "wx-dark", k < nowK && "wx-past"].filter(Boolean).join(" "), text, tr);
    td.dataset.k = k;
    if (!cols.has(k)) cols.set(k, []);
    cols.get(k).push(td);
    return td;
  };
  // дни: название над своими шагами
  const days = row("");
  days.className = "wx-days-row";
  for (let n = 0; n < ks.length;) {
    let m = n;
    while (m < ks.length && v.dayKey(h.time[ks[m]]) === v.dayKey(h.time[ks[n]])) m++;
    const td = el("td", `wx-dayname${ks[m - 1] < nowK ? " wx-past" : ""}`, v.dayName(h.time[ks[n]]), days);
    td.colSpan = m - n;
    n = m;
  }
  const hours = row("Часы");
  ks.forEach((k) => cell(hours, k, v.hm(h.time[k]).slice(0, 2), "wx-h"));
  // значок погоды — сразу под часами, без подписи (как у Windy)
  const icons = row("");
  icons.className = "wx-sky-row";
  ks.forEach((k) => {
    const kind = sky(h.weather_code?.[k]), td = cell(icons, k, "", "wx-sky");
    if (!kind) return;
    td.title = SKY[kind][0];
    td.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${SKY[kind][1](v.light(k))}</svg>`;
    td.dataset.sky = kind;
  });
  const temp = row("°C");
  ks.forEach((k) => cell(temp, k, `${r0(h.temperature_2m[k])}°`));
  const dir = row("Откуда", "Направление: стрелка — куда дует");
  ks.forEach((k) => cell(dir, k, "").append(arrow(h.wind_direction_10m[k], null, dirName(h.wind_direction_10m[k]))));
  // «Кайт» — над ветром (Грегори 2026-11-12)
  if (kite) {
    const kr = row("Кайт", "Годится ли ветер для кайта на этом споте");
    ks.forEach((k) => {
      const level = rate(k), td = cell(kr, k, "", "wx-c wx-k");
      if (KITE_COLORS[level]) td.style.background = KITE_COLORS[level];
      td.title = KITE_TEXT[level];
    });
  }
  const wind = row("Ветер", "Ветер, м/с");
  ks.forEach((k) => { const td = cell(wind, k, r0(h.wind_speed_10m[k]), "wx-c"); td.style.background = windColor(h.wind_speed_10m[k]); });
  const gust = row("Порывы", "Порывы, м/с");
  ks.forEach((k) => { const td = cell(gust, k, r0(h.wind_gusts_10m[k]), "wx-c wx-g"); td.style.background = windColor(h.wind_gusts_10m[k]); });
  const rain = row("Осадки", "Осадки, мм за 3 часа");
  ks.forEach((k) => cell(rain, k, h.precipitation[k] >= 0.1 ? r1(h.precipitation[k]) : "", "wx-rain"));
  if (v.waves) {
    const wv = row("Волна", "Волна, м");
    ks.forEach((k) => cell(wv, k, v.wave(k) != null ? r1(v.wave(k)) : ""));
  }
  // выбрать шаг: рамка; столбец в виду (вне вида — на четверть ширины от края: видно и чуть прошлого)
  let cur = null;
  const select = (k, scroll) => {
    if (!cols.has(k)) k = ks[0];
    if (k !== cur) {
      for (const td of cols.get(cur) || []) td.classList.remove("wx-at");
      for (const td of cols.get(k)) td.classList.add("wx-at");
      cur = k;
    }
    if (scroll) requestAnimationFrame(() => {
      const td = cols.get(k)[0], th = grid.querySelector("th")?.offsetWidth || 50;
      if (td.offsetLeft - th < wrap.scrollLeft || td.offsetLeft + td.offsetWidth > wrap.scrollLeft + wrap.clientWidth)
        wrap.scrollLeft = Math.max(0, td.offsetLeft - th - (wrap.clientWidth - th) / 4);
    });
    return k;
  };
  grid.addEventListener("click", (e) => {
    const td = e.target.closest("td[data-k]");
    if (!td) return;
    e.stopPropagation();
    pick?.(Number(td.dataset.k));
  });
  return { wrap, select, rate };
}

// окно прогноза в окне кайт-спота: at — выбранное время (unix, секунды; нет — сейчас). Сверху — ветер и
// порывы в это время, ниже — таблица на 7 дней по 3 часа (листается вбок).
// inside — внутри чужого окна (кайт-спот): у окна своё название, ветер — строкой помельче
// kite — окно кайт-спота: { sea, dirs, off, rescue } — строка «Кайт: подходит · ветер с воды»
export async function forecastBox(lngLat, { at = null, title = null, inside = false, kite = null } = {}) {
  const box = el("div", "wx");
  try {
    const v = view(await load(lngLat)), { h } = v;
    if (title) el("div", "popup-title", title, box);
    const head = el("div", title || inside ? "wx-now wx-now-sub" : "popup-title wx-now", "", box);
    const sub = el("div", "popup-sub", "", box);
    const kiteLine = kite && el("div", "wx-kite", "", box);
    // прошедшие шаги не показываем
    const nowK = v.nowK(), ks = h.time.map((t, k) => k).filter((k) => k >= nowK);
    let windOn = false;
    const t = table(v, ks, { kite, pick: (k) => { select(k, false); if (windOn) emit("wind-time-set", { at: k === nowK ? null : h.time[k] }); } });
    box.append(t.wrap);
    // шапка — на выбранный шаг k: ветер и порывы, время, у спота — «Кайт: …»
    const select = (k, scroll) => {
      k = t.select(k, scroll);
      paintNow(v, k, head, sub);
      if (!kite) return;
      const level = t.rate(k), land = fromLand(h.wind_direction_10m[k], kite);
      kiteLine.className = `wx-kite wx-kite-${level}`;
      kiteLine.style.setProperty("--kite", KITE_COLORS[level] || "var(--muted)");
      kiteLine.textContent = [`Кайт: ${KITE_TEXT[level]}`, (level === "good" || level === "strong") && land === false && "ветер с воды",
        land == null && !kite.off && "приблизьте карту к споту — узнаю, где вода"].filter(Boolean).join(" · ");
    };
    select(Math.max(nowK, v.stepAt(at)), true);
    // время «Ветра» → рамка (окно спота и лента внизу связаны, Грегори 2026-11-12); окно закрыли — отписаться
    let seen = false;
    const unsub = on("wind-time", (w) => {
      if (!box.isConnected) { if (seen) unsub?.(); return; }
      seen = true;
      windOn = w.on;
      select(Math.max(nowK, v.stepAt(w.at)), true);
    }, { replay: false });
    on("wind-time", (w) => { windOn = w.on; }, { replay: true })();
    sunLine(v, box);
    el("div", "popup-row wx-src", `Прогноз Open-Meteo, время местное${v.waves ? "; ≈ волна, м / период, с — Open-Meteo Marine" : ""}`, box);
  } catch {
    el("div", "popup-title", "Прогноз не загрузился", box);
  }
  return box;
}

// ---------- погода места (Грегори 2026-11-14) ----------
// В окне места под крестиком — температура и осадки сейчас; щелчок — окно места сменяется погодой (ветер,
// температура, осадки, волна на выбранное время), внизу — лента прогноза на место вместо прежнего ползунка
// времени «Ветра»: 5 прошедших дней бледнее и 7 вперёд, в виду — сейчас. «Назад» — снова окно места, лента
// уходит (если «Ветер» не включён — ему лента нужна как время). Тяжёлые слои ветра и осадков сами не
// включаются — их кнопки в шапке ленты
const SVG = (w, inner) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}">${inner}</svg>`;
const DROP = SVG(11, '<path d="M12 3c-3 4.4-6 7.7-6 11a6 6 0 0 0 12 0c0-3.3-3-6.6-6-11z" fill="currentColor"/>');
const BACK = SVG(18, '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>');
const CLOSE = SVG(22, '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>');
const LAYERS = [["weather/wind", "Ветер"], ["weather/radar", "Осадки"]];
let ctx = null, at = null, windOn = false, seq = 0, strip = null; // strip — таблица ленты { select }
const bar = el("div", "wx-bar");
bar.hidden = true;
bar.dataset.keepClear = ""; // окна на карте держатся выше ленты (core/popups.js)
const top = el("div", "wx-bar-top", "", bar);
const name = el("div", "wx-bar-name", "", top);
const layerBtns = LAYERS.map(([id, title]) => {
  const b = btn("wx-bar-btn wx-bar-layer", `${title} на карте`, "");
  b.dataset.id = id;
  b.addEventListener("click", () => { const m = modules().find((x) => x.id === id); if (m && ctx) toggle(id, ctx, !m.active, { by: "forecast" }); });
  top.append(b);
  return b;
});
const when = btn("wx-bar-when", "Сейчас", "");
const shut = btn("wx-bar-btn wx-bar-x", "Закрыть прогноз", CLOSE);
top.append(when, shut);
const body = el("div", "wx-bar-body", "", bar);
// кнопки слоёв: значок из «Слоёв», включённый — затенён
const paintLayers = () => layerBtns.forEach((b) => {
  const m = modules().find((x) => x.id === b.dataset.id);
  b.hidden = !m;
  if (!m) return;
  if (!b.innerHTML) b.innerHTML = m.icon;
  b.classList.toggle("on", !!m.active);
  b.setAttribute("aria-pressed", String(!!m.active));
  b.title = `${m.title}${m.active ? " — выключить" : ""}`;
});
// время — начало выбранного столбца по часам места ленты (у точки в другом поясе шаги сдвинуты), коротко («вс 15 · 03:00»): на телефоне место названию
const paintWhen = () => {
  const v = strip?.v;
  when.textContent = at == null ? "Сейчас" : v ? `${v.dayShort(v.h.time[v.stepAt(at)])} · ${v.hm(v.h.time[v.stepAt(at)])}`
    : new Date(at * 1000).toLocaleString("ru-RU", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  when.classList.toggle("now", at == null);
  shut.title = windOn ? "Закрыть прогноз и выключить ветер" : "Закрыть прогноз";
};

// выбрать время прогноза (unix, с; null — сейчас): рамка в ленте, стрелки «Ветра», окно погоды
export function setForecastTime(t, scroll = true) {
  at = t;
  paintWhen();
  if (strip) strip.select(strip.v.stepAt(at), scroll);
  emit("wx-time", { at });
}
export const forecastTime = () => at;
export const forecastOpen = () => !bar.hidden;

export async function openForecast(lngLat, title) {
  const n = ++seq;
  strip = null;
  name.textContent = title || "Погода в точке";
  name.title = name.textContent;
  bar.hidden = false;
  document.body.classList.add("has-wx-bar");
  paintLayers();
  paintWhen();
  body.replaceChildren(el("div", "wx-wait", "Прогноз…"));
  try {
    const v = view(await load(lngLat));
    if (n !== seq) return;
    const ks = v.h.time.map((t, k) => k), nowK = v.nowK();
    const t = table(v, ks, { pick: (k) => setForecastTime(k === nowK ? null : v.h.time[k], false) });
    strip = { ...t, v };
    paintWhen();
    body.replaceChildren(t.wrap, el("div", "wx-src", "Open-Meteo, время местное; бледнее — прошедшие дни"));
    t.select(v.stepAt(at), true);
  } catch {
    if (n === seq) body.replaceChildren(el("div", "wx-wait", "Прогноз не загрузился"));
  }
}
export function closeForecast() {
  seq++;
  strip = null;
  bar.hidden = true;
  document.body.classList.remove("has-wx-bar");
  setForecastTime(null);
  if (windOn && ctx) toggle("weather/wind", ctx, false, { by: "forecast" });
}
when.addEventListener("click", () => setForecastTime(null));
shut.addEventListener("click", closeForecast);
// щелчок по столбцу таблицы в окне спота — время сюда
on("wind-time-set", ({ at: t }) => { if (forecastOpen()) setForecastTime(t); }, { replay: false });
on("wind-time", (w) => { windOn = w.on; paintWhen(); });
on("module", ({ id }) => { if (LAYERS.some(([x]) => x === id)) paintLayers(); }, { replay: false });

// окно погоды на месте окна места: back — вернуть окно места (нет — без кнопки «Назад»)
export function weatherView(lngLat, title, back) {
  const box = el("div", "wx wx-view");
  if (back) {
    const b = btn("wx-back", "Назад к окну места", BACK);
    el("span", "", title || "Место", b);
    b.addEventListener("click", (e) => { e.stopPropagation(); back(); });
    box.append(b);
  } else el("div", "popup-title", title || "Погода в точке", box);
  const head = el("div", "wx-now wx-now-sub", "Погода…", box);
  const sub = el("div", "popup-sub", "", box);
  load(lngLat).then((r) => {
    const v = view(r);
    const paint = () => paintNow(v, v.stepAt(at), head, sub);
    paint();
    sunLine(v, box);
    el("div", "popup-row wx-src", "Прогноз по дням — лента внизу; Open-Meteo", box);
    const unsub = on("wx-time", () => { if (!box.isConnected) unsub?.(); else paint(); }, { replay: false });
  }).catch(() => { head.textContent = "Прогноз не загрузился"; });
  return box;
}

// значок погоды под крестиком окна места: температура и осадки сейчас; щелчок — окно погоды и лента
export function weatherChip(lngLat, title) {
  const b = btn("wx-chip", "Погода и прогноз", "");
  b.hidden = true;
  loadWx(lngLat).then((d) => {
    const v = view({ d }), k = v.nowK(), p = d.hourly.precipitation[k];
    b.innerHTML = `<b>${r0(d.hourly.temperature_2m[k])}°</b><span class="wx-chip-rain${p >= 0.1 ? "" : " dry"}">${DROP}${r1(p >= 0.1 ? p : 0)}</span>`;
    b.title = `Сейчас ${r0(d.hourly.temperature_2m[k])}°, осадки ${r1(p)} мм за 3 часа — погода и прогноз`;
    b.hidden = false;
  }).catch(() => b.remove());
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    const box = b.parentElement, content = box.closest(".maplibregl-popup-content"), kids = [...box.childNodes];
    const back = () => {
      box.replaceChildren(...kids);
      content?.classList.remove("wx-mode");
      if (!windOn) closeForecast();
    };
    box.replaceChildren(weatherView(lngLat, title, back));
    content?.classList.add("wx-mode");
    openForecast(lngLat, title);
  });
  return b;
}

export function initForecast(c) {
  ctx = c;
  document.body.append(bar);
}

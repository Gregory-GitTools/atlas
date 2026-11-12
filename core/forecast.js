// Прогноз погоды в точке — общий для окна стрелки ветра (layers/weather.js) и окна кайт-спота
// (layers/outdoor.js), Грегори 2026-11-11: «прогноз на несколько дней, порывы, волна для сёрфинга, погода
// в окне кайт-спота». Open-Meteo (без ключа): ветер, порывы, температура, осадки — на 7 дней с шагом
// 3 часа; на воде — ещё волна (Marine API: высота, направление, период). Время — местное для точки.
// Сеть — только по вызову: модули, которые его зовут, объявляют это в своём `sends`.
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
// стрелка «куда дует» (направление ветра и волны в метео — откуда)
const arrow = (from, color, title) => {
  const a = el("span", "wx-dir", "↑");
  a.style.transform = `rotate(${(from + 180) % 360}deg)`;
  if (color) a.style.color = color;
  a.title = title;
  return a;
};

async function load([lon, lat]) {
  const common = { latitude: lat, longitude: lon, timezone: "auto", timeformat: "unixtime", forecast_days: 7, temporal_resolution: "hourly_3" };
  const wx = fetch(`${API}?${new URLSearchParams({ ...common, wind_speed_unit: "ms",
    hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,precipitation", daily: "sunrise,sunset" })}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Open-Meteo: ${r.status}`))));
  // волна — только на воде: на суше Marine API отвечает пустыми значениями или ошибкой
  const sea = fetch(`${MARINE}?${new URLSearchParams({ ...common, hourly: "wave_height,wave_direction,wave_period" })}`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [d, m] = await Promise.all([wx, sea]);
  const waves = m?.hourly?.wave_height?.some((v) => v != null) ? m.hourly : null;
  return { d, waves };
}

// окно прогноза: at — выбранное время (unix, секунды; нет — сейчас). Сверху — ветер и порывы в это время,
// ниже — таблица на 7 дней по 3 часа (листается вбок)
// inside — внутри чужого окна (кайт-спот): у окна своё название, ветер — строкой помельче
// kite — окно кайт-спота: { sea, dirs, off, rescue } — строка «Кайт: подходит · ветер с воды»
export async function forecastBox(lngLat, { at = null, title = null, inside = false, kite = null } = {}) {
  const box = el("div", "wx");
  try {
    const { d, waves } = await load(lngLat);
    const h = d.hourly, off = d.utc_offset_seconds || 0;
    const when = at ?? Date.now() / 1000;
    let i = h.time.findIndex((t, k) => t + 10800 > when && (k === 0 || h.time[k - 1] + 10800 <= when));
    if (i < 0) i = 0;
    // время места: секунды UTC + сдвиг пояса, показ — как UTC
    const local = (t) => new Date((t + off) * 1000);
    const hm = (t) => local(t).toISOString().slice(11, 16);
    const dayKey = (t) => local(t).toISOString().slice(0, 10);
    const dayName = (t) => local(t).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    const wave = (k) => (waves && waves.wave_height[k] != null ? waves.wave_height[k] : null);
    if (title) el("div", "popup-title", title, box);
    const head = el("div", title || inside ? "wx-now wx-now-sub" : "popup-title wx-now", "", box);
    head.append(arrow(h.wind_direction_10m[i], windColor(h.wind_speed_10m[i]), dirName(h.wind_direction_10m[i])),
      ` Ветер ${r0(h.wind_speed_10m[i])} м/с, порывы ${r0(h.wind_gusts_10m[i])} · ${dirName(h.wind_direction_10m[i])}`);
    el("div", "popup-sub", [`${at ? `${dayName(h.time[i])}, ${hm(h.time[i])}` : "Сейчас"}`, `${r0(h.temperature_2m[i])}°`,
      wave(i) != null && `волна ${r1(wave(i))} м`].filter(Boolean).join(" · "), box);
    const light = (k) => isLight(d.daily, h.time[k]);
    const rate = (k) => (light(k) ? kiteRate(h.wind_speed_10m[k], h.wind_gusts_10m[k], h.wind_direction_10m[k], kite) : "night");
    if (kite) {
      const level = rate(i), land = fromLand(h.wind_direction_10m[i], kite);
      const line = el("div", `wx-kite wx-kite-${level}`, "", box);
      line.style.setProperty("--kite", KITE_COLORS[level] || "var(--muted)");
      line.textContent = [`Кайт: ${KITE_TEXT[level]}`, (level === "good" || level === "strong") && land === false && "ветер с воды",
        land == null && !kite.off && "приблизьте карту к споту — узнаю, где вода"].filter(Boolean).join(" · ");
    }
    // таблица по образцу Windy (Грегори 2026-11-12): шаги по 3 часа слева направо, листается вбок; строки —
    // ветер и порывы цветными клетками, направление, температура, осадки, волна; у спота — строка «Кайт»
    // (зелёная — подходит, оранжевая — сильно, красная — с берега или шторм, пусто — нет). Ночь — затемнена.
    // Прошедшие шаги сегодняшнего дня не показываем; выбранное время — в рамке, таблица открывается на нём
    const nowS = Date.now() / 1000;
    const ks = h.time.map((t, k) => k).filter((k) => h.time[k] + 10800 > nowS);
    const wrap = el("div", "wx-grid-wrap", "", box);
    const grid = el("table", "wx-grid", "", wrap);
    const row = (label, title) => { const tr = el("tr", "", "", grid); const th = el("th", "", label, tr); if (title) th.title = title; return tr; };
    const cell = (tr, k, text, cls = "") => {
      const td = el("td", [cls, !light(k) && "wx-dark", k === i && "wx-at"].filter(Boolean).join(" "), text, tr);
      return td;
    };
    // дни: название над своими шагами
    const days = row("");
    days.className = "wx-days-row";
    for (let n = 0; n < ks.length;) {
      let m = n;
      while (m < ks.length && dayKey(h.time[ks[m]]) === dayKey(h.time[ks[n]])) m++;
      const td = el("td", "wx-dayname", dayName(h.time[ks[n]]), days);
      td.colSpan = m - n;
      n = m;
    }
    const hours = row("Часы");
    ks.forEach((k) => cell(hours, k, hm(h.time[k]).slice(0, 2), "wx-h"));
    const wind = row("Ветер", "Ветер, м/с");
    ks.forEach((k) => { const td = cell(wind, k, r0(h.wind_speed_10m[k]), "wx-c"); td.style.background = windColor(h.wind_speed_10m[k]); });
    const gust = row("Порывы", "Порывы, м/с");
    ks.forEach((k) => { const td = cell(gust, k, r0(h.wind_gusts_10m[k]), "wx-c wx-g"); td.style.background = windColor(h.wind_gusts_10m[k]); });
    const dir = row("Откуда", "Направление: стрелка — куда дует");
    ks.forEach((k) => cell(dir, k, "").append(arrow(h.wind_direction_10m[k], null, dirName(h.wind_direction_10m[k]))));
    if (kite) {
      const kr = row("Кайт", "Годится ли ветер для кайта на этом споте");
      ks.forEach((k) => {
        const level = rate(k), td = cell(kr, k, "", "wx-c wx-k");
        if (KITE_COLORS[level]) td.style.background = KITE_COLORS[level];
        td.title = KITE_TEXT[level];
      });
    }
    const temp = row("°C");
    ks.forEach((k) => cell(temp, k, `${r0(h.temperature_2m[k])}°`));
    const rain = row("Осадки", "Осадки, мм");
    ks.forEach((k) => cell(rain, k, h.precipitation[k] >= 0.1 ? r1(h.precipitation[k]) : "", "wx-rain"));
    if (waves) {
      const wv = row("Волна", "Волна, м");
      ks.forEach((k) => cell(wv, k, wave(k) != null ? r1(wave(k)) : ""));
    }
    // открыть на выбранном шаге (или с начала)
    requestAnimationFrame(() => { const at0 = grid.querySelector("td.wx-at"); if (at0) wrap.scrollLeft = Math.max(0, at0.offsetLeft - 70); });
    if (d.daily?.sunrise?.[0]) el("div", "popup-row wx-sun", `Восход ${hm(d.daily.sunrise[0])} · закат ${hm(d.daily.sunset[0])}`, box);
    el("div", "popup-row wx-src", `Прогноз Open-Meteo, время местное${waves ? "; ≈ волна, м / период, с — Open-Meteo Marine" : ""}`, box);
  } catch {
    el("div", "popup-title", "Прогноз не загрузился", box);
  }
  return box;
}

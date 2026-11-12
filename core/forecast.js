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

// кайт (Грегори 2026-11-12: «подходит ли ветер на споте»): сила — для кайта средней площади;
// сторона — откуда дует: с воды (вдоль берега тоже годится) или с суши (уносит в море — опасно).
// sea — 16 знаков по румбам от спота (С, ССВ, … ССЗ): «1» — в 1,2 км вода, «0» — суша, «?» — не знаем
const KITE = [[0, "calm"], [5, "weak"], [7, "good"], [13, "strong"], [17, "storm"]];
export const KITE_COLORS = { weak: "#f2d024", good: "#2e9d43", strong: "#fd8d3c", storm: "#e31a1c", off: "#e31a1c" };
const KITE_TEXT = { calm: "мало ветра", weak: "слабовато", good: "подходит", strong: "сильно", storm: "опасно сильно", off: "с берега — опасно" };
export const seaSide = (from, sea) => {
  if (!sea || from == null) return null;
  const d = Math.round(from / 22.5) % 16;
  const near = [-2, -1, 0, 1, 2].map((k) => sea[(d + k + 16) % 16]);
  return near.includes("1") ? "sea" : near.every((c) => c === "0") ? "land" : null;
};
export function kiteRate(ms, gust, from, sea) {
  let level = KITE.filter(([k]) => ms >= k).at(-1)[1];
  if (level !== "calm" && gust >= 22) level = "storm";
  if (level !== "calm" && seaSide(from, sea) === "land") level = "off";
  return level;
}

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
    hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,precipitation" })}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Open-Meteo: ${r.status}`))));
  // волна — только на воде: на суше Marine API отвечает пустыми значениями или ошибкой
  const sea = fetch(`${MARINE}?${new URLSearchParams({ ...common, hourly: "wave_height,wave_direction,wave_period" })}`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [d, m] = await Promise.all([wx, sea]);
  const waves = m?.hourly?.wave_height?.some((v) => v != null) ? m.hourly : null;
  return { d, waves };
}

// окно прогноза: at — выбранное время (unix, секунды; нет — сейчас). Сверху — ветер и порывы в это время,
// ниже — дни: строка дня (ветер от–до, порывы, температура, осадки, волна), щелчок — по 3 часа
// inside — внутри чужого окна (кайт-спот): у окна своё название, ветер — строкой помельче
// kite — окно кайт-спота: { sea } — строка «Кайт: подходит · с моря», у дня — часы, когда подходит
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
    const rate = (k) => kiteRate(h.wind_speed_10m[k], h.wind_gusts_10m[k], h.wind_direction_10m[k], kite?.sea);
    if (kite) {
      const level = rate(i), side = seaSide(h.wind_direction_10m[i], kite.sea);
      const line = el("div", `wx-kite wx-kite-${level}`, "", box);
      line.style.setProperty("--kite", KITE_COLORS[level] || "var(--muted)");
      line.textContent = [`Кайт: ${KITE_TEXT[level]}`, level !== "off" && side === "sea" && "ветер с воды",
        !kite.sea && "приблизьте карту к споту — узнаю, где вода"].filter(Boolean).join(" · ");
    }
    const days = el("div", "wx-days", "", box);
    const groups = new Map();
    // прошедшие шаги сегодняшнего дня не показываем — с текущего
    const nowS = Date.now() / 1000;
    h.time.forEach((t, k) => { if (t + 10800 <= nowS) return; const key = dayKey(t); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(k); });
    for (const [key, ks] of groups) {
      const day = el("div", "wx-day", "", days);
      const row = el("button", "wx-day-row", "", day);
      row.type = "button";
      const ms = ks.map((k) => h.wind_speed_10m[k]), gust = Math.max(...ks.map((k) => h.wind_gusts_10m[k]));
      const temps = ks.map((k) => h.temperature_2m[k]), rain = ks.reduce((s, k) => s + (h.precipitation[k] || 0), 0);
      const wv = ks.map(wave).filter((v) => v != null);
      el("span", "wx-day-name", dayName(h.time[ks[0]]), row);
      const wind = el("span", "wx-day-wind", `${r0(Math.min(...ms))}–${r0(Math.max(...ms))} м/с`, row);
      wind.style.borderColor = windColor(Math.max(...ms));
      // часы, когда кайт подходит: с первого до конца последнего подходящего шага
      const good = kite ? ks.filter((k) => rate(k) === "good") : [];
      el("span", "wx-day-more", [good.length && `кайт ${hm(h.time[good[0]])}–${hm(h.time[good.at(-1)] + 10800)}`, `порывы ${r0(gust)}`, `${r0(Math.min(...temps))}…${r0(Math.max(...temps))}°`,
        rain >= 0.5 && `${r1(rain)} мм`, wv.length && `волна до ${r1(Math.max(...wv))} м`].filter(Boolean).join(" · "), row);
      const hours = el("div", "wx-table", "", day);
      for (const k of ks) {
        const line = el("div", "wx-row" + (k === i && at ? " wx-at" : "") + (kite && rate(k) === "good" ? " wx-good" : ""), "", hours);
        el("span", "wx-time", hm(h.time[k]), line);
        line.append(arrow(h.wind_direction_10m[k], windColor(h.wind_speed_10m[k]), dirName(h.wind_direction_10m[k])));
        el("span", "wx-wind", `${r0(h.wind_speed_10m[k])}–${r0(h.wind_gusts_10m[k])} м/с`, line);
        el("span", "wx-temp", [`${r0(h.temperature_2m[k])}°`, h.precipitation[k] >= 0.1 && `${r1(h.precipitation[k])} мм`,
          wave(k) != null && `≈${r1(wave(k))} м/${r0(waves.wave_period[k] ?? 0)} с`].filter(Boolean).join(" · "), line);
      }
      // открыт день выбранного времени (или сегодня)
      const open = ks.includes(i);
      day.classList.toggle("open", open);
      row.addEventListener("click", (e) => { e.stopPropagation(); day.classList.toggle("open"); });
    }
    el("div", "popup-row wx-src", `Прогноз Open-Meteo, время местное${waves ? "; ≈ волна, м / период, с — Open-Meteo Marine" : ""}`, box);
  } catch {
    el("div", "popup-title", "Прогноз не загрузился", box);
  }
  return box;
}

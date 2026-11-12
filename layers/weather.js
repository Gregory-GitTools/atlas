// Погода (Грегори, 2026-10-27: «что на счёт погоды?»; в плане — ветер для кайт-спотов и походов).
// Два слоя:
//  • Ветер — стрелки по сетке в кадре: куда дует, сила в м/с (Грегори, 2026-10-28: «измени
//    показания ветра на m/s») и порывы мельче рядом; цвет по силе, как у Windy: штиль — голубой, 4–6 —
//    зелёный, 6–9 — жёлтый (лучший кайт), 9–13 — оранжевый, 13–18 — красный, сильнее — фиолетовый.
//    **Время — полоса внизу** (Грегори 2026-11-11: «прогноз на несколько дней с выбором времени»): 7 дней
//    вперёд с шагом 3 часа, стрелки — на выбранное время; ‹ › — на 3 часа, «Сейчас», крестик — выключить
//    ветер. Щелчок по стрелке — прогноз в точке по дням (core/forecast.js), на воде — с волной.
//    Данные — Open-Meteo (без ключа, бесплатно для некоммерческого). Узлы сетки кратны шагу —
//    при сдвиге карты те же точки, ответ запоминается на час.
//  • Осадки — радар RainViewer (без ключа): последний снимок и анимация за 2 часа. Бесплатно —
//    только до зума 7, дальше картинка растягивается.
import { register, toggle } from "../core/modules.js";
import { emit } from "../core/events.js";
import { track, claimLayers } from "../core/popups.js";
import { forecastBox, WIND_COLORS } from "../core/forecast.js";

const svg = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${inner}</svg>`;
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20]; // шаг сетки, градусы
const COLS = 9; // стрелок по ширине кадра
const MAX_POINTS = 150;
const HOUR = 3600000;
const STEP_S = 3 * 3600; // шаг прогноза — 3 часа
const DAYS = 7;
const PREV = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>';
const NEXT = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

// ---------- ветер ----------
{
  const cache = new Map(); // "lat,lon" → { t, time[], ms[], gust[], dir[] } — прогноз узла на 7 дней
  let ctx = null, active = false, wired = false, timer = null, seq = 0;
  let at = null; // выбранное время (unix, с; null — сейчас)
  // шкала времени: от начала текущего трёхчасового шага по местным часам (00, 03, 06…) на 7 дней вперёд —
  // как шаги прогноза Open-Meteo с timezone=auto
  const start = () => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() - (d.getHours() % 3)); return d.getTime() / 1000; };
  const slots = DAYS * 8;

  const arrow = (map) => {
    if (map.hasImage("wind-arrow")) return;
    const s = 48;
    const c = Object.assign(document.createElement("canvas"), { width: s, height: s }).getContext("2d");
    // стрелка «куда дует», остриё вверх; SDF — чтобы красить по силе ветра
    c.fillStyle = "#fff";
    c.beginPath();
    c.moveTo(24, 4); c.lineTo(36, 20); c.lineTo(28, 20); c.lineTo(28, 44); c.lineTo(20, 44); c.lineTo(20, 20); c.lineTo(12, 20);
    c.closePath();
    c.fill();
    map.addImage("wind-arrow", c.getImageData(0, 0, s, s), { pixelRatio: 2, sdf: true });
  };

  const color = ["step", ["get", "ms"], WIND_COLORS[0][1], ...WIND_COLORS.slice(1).flat()];

  const grid = (map) => {
    const b = map.getBounds();
    const west = Math.max(-180, b.getWest()), east = Math.min(180, b.getEast());
    const south = Math.max(-75, b.getSouth()), north = Math.min(75, b.getNorth());
    let step = STEPS.find((s) => (east - west) / s <= COLS) || STEPS.at(-1);
    let pts;
    for (;;) {
      pts = [];
      for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
        for (let lon = Math.ceil(west / step) * step; lon <= east; lon += step) pts.push([+lon.toFixed(3), +lat.toFixed(3)]);
      }
      if (pts.length <= MAX_POINTS || step === STEPS.at(-1)) break;
      step = STEPS[STEPS.indexOf(step) + 1];
    }
    return pts;
  };

  // значение узла на выбранное время: шаг прогноза, в который оно попадает
  const valueAt = (w, t) => {
    let k = w.time.findIndex((x) => x + STEP_S > t);
    if (k < 0) k = w.time.length - 1;
    return { ms: w.ms[k], gust: w.gust[k], dir: w.dir[k] };
  };
  let shown = [];
  const features = (pts) => pts.flatMap(([lon, lat]) => {
    const w = cache.get(`${lat},${lon}`);
    if (!w) return [];
    const v = valueAt(w, at ?? Date.now() / 1000);
    if (v.ms == null) return [];
    return [{ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { ms: v.ms, gust: Math.round(v.gust), dir: v.dir, rot: (v.dir + 180) % 360, label: String(Math.round(v.ms)), gl: ` ${Math.round(v.gust)}` } }];
  });
  const draw = () => ctx?.map.getSource("wind")?.setData({ type: "FeatureCollection", features: features(shown) });

  async function update() {
    if (!active) return;
    const n = ++seq;
    const pts = grid(ctx.map);
    const now = Date.now();
    const missing = pts.filter(([lon, lat]) => !(cache.get(`${lat},${lon}`)?.t > now - HOUR));
    shown = pts;
    for (let i = 0; i < missing.length; i += 50) {
      const part = missing.slice(i, i + 50);
      const params = new URLSearchParams({ latitude: part.map((p) => p[1]).join(","), longitude: part.map((p) => p[0]).join(","),
        hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m", wind_speed_unit: "ms", timeformat: "unixtime", timezone: "auto",
        forecast_days: DAYS, temporal_resolution: "hourly_3" });
      try {
        const res = await fetch(`${OPEN_METEO}?${params}`);
        if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`);
        const data = await res.json();
        (Array.isArray(data) ? data : [data]).forEach((d, k) => {
          const [lon, lat] = part[k], h = d.hourly;
          cache.set(`${lat},${lon}`, { t: now, time: h.time, ms: h.wind_speed_10m, gust: h.wind_gusts_10m, dir: h.wind_direction_10m });
        });
      } catch (err) {
        console.warn(err);
        ctx.status("Погода сейчас не загрузилась — попробую позже");
        setTimeout(() => ctx.status(""), 4000);
        break;
      }
      if (n !== seq) return;
      draw(); // ближние куски — сразу, не дожидаясь всех
    }
    if (n === seq) draw();
  }

  // ---------- полоса времени ----------
  const bar = Object.assign(document.createElement("div"), { className: "wx-bar", hidden: true });
  bar.dataset.keepClear = ""; // окна на карте держатся выше полосы (core/popups.js)
  bar.innerHTML = `<div class="wx-bar-top"><button type="button" class="wx-bar-btn wx-prev" title="На 3 часа раньше">${PREV}</button>
    <button type="button" class="wx-bar-when" title="Сейчас"></button>
    <button type="button" class="wx-bar-btn wx-next" title="На 3 часа позже">${NEXT}</button>
    <button type="button" class="wx-bar-btn wx-bar-x" title="Выключить ветер">${CLOSE}</button></div>
    <div class="wx-track"><input type="range" class="wx-range" min="0" max="${slots - 1}" step="1" value="0" aria-label="Время прогноза"><div class="wx-ticks"></div></div>`;
  const range = bar.querySelector(".wx-range"), when = bar.querySelector(".wx-bar-when"), ticks = bar.querySelector(".wx-ticks");
  const hm = (d) => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const label = (t) => { const d = new Date(t * 1000); return `${d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" })}, ${hm(d)}`; };
  const paintBar = () => {
    const i = at == null ? 0 : Math.max(0, Math.round((at - start()) / STEP_S));
    range.value = String(i);
    when.textContent = at == null ? `Сейчас · ${hm(new Date())}` : label(at);
    when.classList.toggle("now", at == null);
    bar.querySelector(".wx-prev").disabled = at == null;
    bar.querySelector(".wx-next").disabled = i >= slots - 1;
    // под ползунком — начало каждого дня: черта и день недели
    ticks.replaceChildren(...Array.from({ length: slots }, (_, k) => start() + k * STEP_S)
      .filter((t, k) => k > 0 && new Date(t * 1000).getHours() < 3)
      .map((t) => {
        const s = Object.assign(document.createElement("span"), { textContent: new Date(t * 1000).toLocaleDateString("ru-RU", { weekday: "short" }) });
        s.style.left = `${(((t - start()) / STEP_S) / (slots - 1)) * 100}%`;
        return s;
      }));
  };
  const setAt = (i) => { i = Math.max(0, Math.min(slots - 1, i)); at = i === 0 ? null : start() + i * STEP_S; paintBar(); draw(); emit("wind-time", { on: true, at }); };
  range.addEventListener("input", () => setAt(Number(range.value)));
  bar.querySelector(".wx-prev").addEventListener("click", () => setAt(Number(range.value) - 1));
  bar.querySelector(".wx-next").addEventListener("click", () => setAt(Number(range.value) + 1));
  when.addEventListener("click", () => setAt(0));
  bar.querySelector(".wx-bar-x").addEventListener("click", () => toggle("weather/wind", ctx, false));
  document.body.append(bar);

  async function forecast(f) {
    const [lon, lat] = f.geometry.coordinates;
    const box = await forecastBox([lon, lat], { at });
    track(new ctx.maplibregl.Popup({ offset: 14, maxWidth: "340px" })).setLngLat([lon, lat]).setDOMContent(box).addTo(ctx.map);
  }

  register({
    id: "weather/wind",
    kind: "layer",
    group: "weather",
    title: "Ветер",
    hint: "Ветер на 7 дней: стрелка — куда дует, число — м/с и порывы; время — полоса внизу; щелчок — прогноз по дням",
    icon: svg('<path d="M4 9h11a3 3 0 1 0-3-3h2a1 1 0 1 1 1 1H4zm0 4h15a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H4zm0-2h8v0H4z"/><path d="M3 11h9v2H3z"/>'),
    needs: ["network"],
    sends: "точки в кадре (Open-Meteo); у моря — ещё волна (Open-Meteo Marine)",
    enable(c) {
      ctx = c; active = true;
      const { map } = c;
      arrow(map);
      if (!map.getSource("wind")) map.addSource("wind", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      if (!map.getLayer("wind")) map.addLayer({ id: "wind", type: "symbol", source: "wind",
        layout: { "icon-image": "wind-arrow", "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-allow-overlap": true,
          "icon-size": ["interpolate", ["linear"], ["get", "ms"], 0, 0.9, 15, 1.5],
          // сила крупно, порывы мельче рядом (Грегори 2026-11-11: «порывы»)
          "text-field": ["format", ["get", "label"], {}, ["get", "gl"], { "font-scale": 0.75 }],
          "text-font": ["Noto Sans Bold"], "text-size": 13, "text-offset": [0, 2], "text-allow-overlap": true },
        paint: { "icon-color": color, "icon-halo-color": "rgba(0,0,0,0.55)", "icon-halo-width": 1.5,
          "text-color": "#fff", "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.4 } });
      claimLayers("wind");
      if (!wired) {
        wired = true;
        map.on("moveend", () => { clearTimeout(timer); timer = setTimeout(update, 300); });
        map.on("click", "wind", (e) => forecast(e.features[0]));
      }
      bar.hidden = false;
      document.body.classList.add("has-wx-bar");
      paintBar();
      update();
      emit("wind-time", { on: true, at });
    },
    disable({ map }) {
      active = false;
      bar.hidden = true;
      document.body.classList.remove("has-wx-bar");
      if (map.getLayer("wind")) map.removeLayer("wind");
      emit("wind-time", { on: false, at: null });
    },
    // для проверки: выбрать время (номер шага, 0 — сейчас)
    setStep: (i) => setAt(i),
    stats: () => ({ cached: cache.size, at, shown: shown.length }),
  });
}

// ---------- осадки ----------
{
  const API = "https://api.rainviewer.com/public/weather-maps.json";
  let frames = [], host = "", timer = null, ctx = null, frame = 0, refresh = null;
  const tiles = (path) => [`${host}${path}/256/{z}/{x}/{y}/2/1_1.png`];

  const show = (i) => {
    const { map } = ctx;
    frame = i;
    for (let k = 0; k < frames.length; k++) {
      const id = `radar-${k}`;
      if (map.getLayer(id)) map.setPaintProperty(id, "raster-opacity", k === i ? 0.7 : 0);
    }
  };

  async function load() {
    const { map } = ctx;
    const data = await (await fetch(API)).json();
    host = data.host;
    for (let k = 0; k < frames.length; k++) {
      if (map.getLayer(`radar-${k}`)) map.removeLayer(`radar-${k}`);
      if (map.getSource(`radar-${k}`)) map.removeSource(`radar-${k}`);
    }
    frames = data.radar.past.slice(-8); // последние 2 часа (раз в 10–15 минут)
    const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    frames.forEach((f, k) => {
      map.addSource(`radar-${k}`, { type: "raster", tiles: tiles(f.path), tileSize: 256, maxzoom: 7,
        attribution: 'Радар: <a href="https://www.rainviewer.com" target="_blank">RainViewer</a>' });
      map.addLayer({ id: `radar-${k}`, type: "raster", source: `radar-${k}`, paint: { "raster-opacity": 0, "raster-fade-duration": 0 } }, firstSymbol);
    });
    show(frames.length - 1);
  }

  register({
    id: "weather/radar",
    kind: "layer",
    group: "weather",
    title: "Осадки",
    hint: "Дождь и снег по радарам за последние 2 часа (анимация); подробно — до масштаба около 50 км",
    icon: svg('<path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.99 5.99 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" opacity=".35"/><path d="M8 14l-1.5 4h1.6L9.6 14zm4 0-1.5 4h1.6l1.5-4zm4 0-1.5 4h1.6l1.5-4z"/>'),
    needs: ["network"],
    sends: "район карты (RainViewer)",
    async enable(c) {
      ctx = c;
      await load();
      // анимация: кадры за 2 часа по кругу, на последнем — пауза
      clearInterval(timer);
      timer = setInterval(() => show(frame + 1 < frames.length ? frame + 1 : 0), 700);
      clearInterval(refresh);
      refresh = setInterval(() => load().catch(() => {}), 10 * 60000); // новые снимки — раз в 10 минут
    },
    disable({ map }) {
      clearInterval(timer);
      clearInterval(refresh);
      for (let k = 0; k < frames.length; k++) {
        if (map.getLayer(`radar-${k}`)) map.removeLayer(`radar-${k}`);
        if (map.getSource(`radar-${k}`)) map.removeSource(`radar-${k}`);
      }
      frames = [];
    },
  });
}

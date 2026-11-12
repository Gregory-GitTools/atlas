// Погода (Грегори, 2026-10-27: «что на счёт погоды?»; в плане — ветер для кайт-спотов и походов).
// Два слоя:
//  • Ветер — как у Windy (Грегори 2026-11-12: «цветная раскраска области ветра вместо стрелок»): заливка
//    цветом силы ветра (палитра Windy, плавно между узлами сетки, под подписями карты) и тонкие белые
//    штрихи «куда дует» в узлах; числа — в окне прогноза по щелчку.
//    **Время — полоса внизу** (Грегори 2026-11-11: «прогноз на несколько дней с выбором времени»): 7 дней
//    вперёд с шагом 3 часа, стрелки — на выбранное время; ‹ › — на 3 часа, «Сейчас», крестик — выключить
//    ветер. Щелчок по стрелке — прогноз в точке по дням (core/forecast.js), на воде — с волной.
//    Данные — Open-Meteo (без ключа, бесплатно для некоммерческого). Узлы сетки кратны шагу —
//    при сдвиге карты те же точки, ответ запоминается на час.
//  • Осадки — радар RainViewer (без ключа): последний снимок и анимация за 2 часа. Бесплатно —
//    только до зума 7, дальше картинка растягивается.
import { register, toggle } from "../core/modules.js";
import { emit, on } from "../core/events.js";
import { track, claimLayers, ownHit } from "../core/popups.js";
import { forecastBox } from "../core/forecast.js";

const svg = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${inner}</svg>`;
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20]; // шаг сетки, градусы
const COLS = 14; // узлов сетки по ширине кадра
const MAX_POINTS = 200;
const EMPTY_PNG = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).toDataURL(); // прозрачная точка — пока узлов нет
// палитра силы ветра, м/с → цвет, как на карте Windy; между порогами — плавно
const FILL = [[0, [98, 113, 183]], [1, [57, 97, 159]], [3, [74, 148, 169]], [5, [77, 141, 123]], [7, [83, 165, 83]], [9, [53, 159, 53]],
  [11, [167, 157, 81]], [13, [159, 127, 58]], [15, [161, 108, 92]], [17, [129, 58, 78]], [19, [175, 80, 136]], [21, [117, 74, 147]],
  [24, [109, 97, 163]], [27, [68, 105, 141]], [29, [92, 144, 152]]];
export function fillColor(ms) {
  if (!(ms > 0)) return FILL[0][1];
  for (let k = 1; k < FILL.length; k++) {
    const [b, cb] = FILL[k];
    if (ms <= b) { const [a, ca] = FILL[k - 1], t = (ms - a) / (b - a); return ca.map((v, j) => Math.round(v + (cb[j] - v) * t)); }
  }
  return FILL.at(-1)[1];
}
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

  // штрих «куда дует»: тонкая линия с небольшим уголком на конце, остриё вверх (как линии ветра Windy)
  const arrow = (map) => {
    if (map.hasImage("wind-streak")) return;
    const s = 48;
    const c = Object.assign(document.createElement("canvas"), { width: s, height: s }).getContext("2d");
    c.strokeStyle = "#fff";
    c.lineWidth = 2.6;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.beginPath();
    c.moveTo(24, 44); c.lineTo(24, 6);
    c.moveTo(17, 14); c.lineTo(24, 6); c.lineTo(31, 14);
    c.stroke();
    map.addImage("wind-streak", c.getImageData(0, 0, s, s), { pixelRatio: 2 });
  };

  // заливка: узлы сетки — правильная решётка; между ними — плавно (билинейно), картинка растягивается
  // на прямоугольник узлов (источник image под подписями карты). Сдвиг ползунка — только перекраска
  const CELL_PX = 12;
  const fillCanvas = document.createElement("canvas");
  let fillInfo = null; // для проверки: размер картинки и сумма цветов (меняется со временем ползунка)
  function drawFill() {
    const map = ctx?.map;
    if (!map?.getSource("wind-fill")) return;
    const lons = [...new Set(shown.map((p) => p[0]))].sort((a, b) => a - b), lats = [...new Set(shown.map((p) => p[1]))].sort((a, b) => b - a);
    if (lons.length < 2 || lats.length < 2) return;
    const t = at ?? Date.now() / 1000;
    const v = lats.map((lat) => lons.map((lon) => { const w = cache.get(`${lat},${lon}`); return w ? valueAt(w, t).ms : null; }));
    const W = (lons.length - 1) * CELL_PX + 1, H = (lats.length - 1) * CELL_PX + 1;
    fillCanvas.width = W; fillCanvas.height = H;
    const c = fillCanvas.getContext("2d"), img = c.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const r = Math.min(lats.length - 2, Math.floor(y / CELL_PX)), fy = y / CELL_PX - r;
      for (let x = 0; x < W; x++) {
        const q = Math.min(lons.length - 2, Math.floor(x / CELL_PX)), fx = x / CELL_PX - q;
        const a = v[r][q], b = v[r][q + 1], cc = v[r + 1][q], d = v[r + 1][q + 1];
        if (a == null || b == null || cc == null || d == null) continue;
        const ms = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
        const [R0, G, B] = fillColor(ms), o = (y * W + x) * 4;
        img.data[o] = R0; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    let sum = 0, painted = 0;
    for (let o = 0; o < img.data.length; o += 4) if (img.data[o + 3]) { painted++; sum += img.data[o] + img.data[o + 1] * 3 + img.data[o + 2] * 7; }
    fillInfo = { w: W, h: H, painted, sum };
    const [w, e, n, s] = [lons[0], lons.at(-1), lats[0], lats.at(-1)];
    map.getSource("wind-fill").updateImage({ url: fillCanvas.toDataURL(), coordinates: [[w, n], [e, n], [e, s], [w, s]] });
  }

  const grid = (map) => {
    const b = map.getBounds();
    const west = Math.max(-180, b.getWest()), east = Math.min(180, b.getEast());
    const south = Math.max(-75, b.getSouth()), north = Math.min(75, b.getNorth());
    let step = STEPS.find((s) => (east - west) / s <= COLS) || STEPS.at(-1);
    let pts;
    for (;;) {
      pts = [];
      // на шаг за край кадра — заливка закрывает весь экран, без полос у краёв
      for (let lat = Math.floor(south / step) * step; lat <= Math.ceil(north / step) * step + 1e-9; lat += step) {
        if (Math.abs(lat) > 80) continue;
        for (let lon = Math.floor(west / step) * step; lon <= Math.ceil(east / step) * step + 1e-9; lon += step) pts.push([+lon.toFixed(3), +lat.toFixed(3)]);
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
  const draw = () => { ctx?.map.getSource("wind")?.setData({ type: "FeatureCollection", features: features(shown) }); drawFill(); };

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
  // щелчок по столбцу таблицы в окне спота — ползунок сюда (core/forecast.js)
  on("wind-time-set", ({ at: t }) => { if (active) setAt(t == null ? 0 : Math.round((t - start()) / STEP_S)); }, { replay: false });
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
      // заливка — под подписями карты (как радар осадков), полупрозрачная
      if (!map.getSource("wind-fill")) map.addSource("wind-fill", { type: "image", url: EMPTY_PNG, coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]] });
      if (!map.getLayer("wind-fill")) map.addLayer({ id: "wind-fill", type: "raster", source: "wind-fill",
        paint: { "raster-opacity": 0.6, "raster-resampling": "linear", "raster-fade-duration": 0 } },
        map.getStyle().layers.find((l) => l.type === "symbol")?.id);
      // штрихи — длиннее при сильном ветре, по направлению «куда дует»
      if (!map.getLayer("wind")) map.addLayer({ id: "wind", type: "symbol", source: "wind",
        layout: { "icon-image": "wind-streak", "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-allow-overlap": true,
          "icon-size": ["interpolate", ["linear"], ["get", "ms"], 0, 0.6, 15, 1.2] },
        paint: { "icon-opacity": 0.85 } });
      claimLayers("wind");
      if (!wired) {
        wired = true;
        map.on("moveend", () => { clearTimeout(timer); timer = setTimeout(update, 300); });
        // под стрелкой значок спота или другой свой — окно открывает он, не стрелка
        map.on("click", "wind", (e) => { if (!ownHit(map, e.point, ["wind"])) forecast(e.features[0]); });
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
      for (const id of ["wind", "wind-fill"]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource("wind-fill")) map.removeSource("wind-fill");
      emit("wind-time", { on: false, at: null });
    },
    // для проверки: выбрать время (номер шага, 0 — сейчас)
    setStep: (i) => setAt(i),
    stats: () => ({ cached: cache.size, at, shown: shown.length, fill: fillInfo }),
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

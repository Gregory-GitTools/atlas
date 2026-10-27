// Погода (Грегори, 2026-10-27: «что на счёт погоды?»; в плане — ветер для кайт-спотов и походов).
// Два слоя:
//  • Ветер — стрелки по сетке в кадре: куда дует, сила в узлах (кайтеры считают в узлах) и цвет по
//    силе, как у Windy: штиль — голубой, 8–12 — зелёный, 12–18 — жёлтый (лучший кайт), 18–25 —
//    оранжевый, 25–35 — красный, сильнее — фиолетовый. Щелчок по стрелке — прогноз в этой точке:
//    сейчас (узлы и м/с, порывы, температура) и по часам на сутки вперёд.
//    Данные — Open-Meteo (без ключа, бесплатно для некоммерческого). Узлы сетки кратны шагу —
//    при сдвиге карты те же точки, ответ запоминается на час.
//  • Осадки — радар RainViewer (без ключа): последний снимок и анимация за 2 часа. Бесплатно —
//    только до зума 7, дальше картинка растягивается.
import { register } from "../core/modules.js";
import { track, claimLayers } from "../core/popups.js";

const svg = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${inner}</svg>`;
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20]; // шаг сетки, градусы
const COLS = 9; // стрелок по ширине кадра
const MAX_POINTS = 150;
const HOUR = 3600000;
const COLORS = [[0, "#9ecae1"], [8, "#41ab5d"], [12, "#f2d024"], [18, "#fd8d3c"], [25, "#e31a1c"], [35, "#8e24aa"]];
const KN_TO_MS = 0.514444;

const DIRS = ["С", "ССВ", "СВ", "ВСВ", "В", "ВЮВ", "ЮВ", "ЮЮВ", "Ю", "ЮЮЗ", "ЮЗ", "ЗЮЗ", "З", "ЗСЗ", "СЗ", "ССЗ"];
const dirName = (deg) => DIRS[Math.round(deg / 22.5) % 16];

// ---------- ветер ----------
{
  const cache = new Map(); // "lat,lon" → { t, kn, gust, dir }
  let ctx = null, active = false, wired = false, timer = null, seq = 0;

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

  const color = ["step", ["get", "kn"], COLORS[0][1], ...COLORS.slice(1).flat()];

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

  const features = (pts) => pts.flatMap(([lon, lat]) => {
    const w = cache.get(`${lat},${lon}`);
    return w ? [{ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { kn: Math.round(w.kn), gust: Math.round(w.gust), dir: w.dir, rot: (w.dir + 180) % 360, label: String(Math.round(w.kn)) } }] : [];
  });

  async function update() {
    if (!active) return;
    const { map } = ctx;
    const n = ++seq;
    const pts = grid(map);
    const now = Date.now();
    const missing = pts.filter(([lon, lat]) => !(cache.get(`${lat},${lon}`)?.t > now - HOUR));
    for (let i = 0; i < missing.length; i += 100) {
      const part = missing.slice(i, i + 100);
      const params = new URLSearchParams({ latitude: part.map((p) => p[1]).join(","), longitude: part.map((p) => p[0]).join(","),
        current: "wind_speed_10m,wind_direction_10m,wind_gusts_10m", wind_speed_unit: "kn" });
      try {
        const res = await fetch(`${OPEN_METEO}?${params}`);
        if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`);
        const data = await res.json();
        (Array.isArray(data) ? data : [data]).forEach((d, k) => {
          const [lon, lat] = part[k];
          cache.set(`${lat},${lon}`, { t: now, kn: d.current.wind_speed_10m, gust: d.current.wind_gusts_10m, dir: d.current.wind_direction_10m });
        });
      } catch (err) {
        console.warn(err);
        ctx.status("Погода сейчас не загрузилась — попробую позже");
        break;
      }
    }
    if (n !== seq) return;
    map.getSource("wind")?.setData({ type: "FeatureCollection", features: features(pts) });
  }

  async function forecast(f) {
    const [lon, lat] = f.geometry.coordinates;
    const params = new URLSearchParams({ latitude: lat, longitude: lon, wind_speed_unit: "kn", timezone: "auto", forecast_hours: "24",
      current: "wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m",
      hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,precipitation" });
    const box = document.createElement("div");
    const add = (cls, text, parent = box) => parent.appendChild(Object.assign(document.createElement("div"), { className: cls, textContent: text }));
    try {
      const d = await (await fetch(`${OPEN_METEO}?${params}`)).json();
      const c = d.current;
      add("popup-title", `Ветер ${Math.round(c.wind_speed_10m)} уз · ${dirName(c.wind_direction_10m)}`);
      add("popup-sub", `${(c.wind_speed_10m * KN_TO_MS).toFixed(1)} м/с, порывы ${Math.round(c.wind_gusts_10m)} уз · ${Math.round(c.temperature_2m)}°`);
      const table = Object.assign(document.createElement("div"), { className: "wx-table" });
      const h = d.hourly;
      for (let i = 0; i < h.time.length; i += 3) {
        const row = Object.assign(document.createElement("div"), { className: "wx-row" });
        add("wx-time", h.time[i].slice(11, 16), row);
        const dir = Object.assign(document.createElement("span"), { className: "wx-dir", textContent: "↑", title: dirName(h.wind_direction_10m[i]) });
        dir.style.transform = `rotate(${(h.wind_direction_10m[i] + 180) % 360}deg)`;
        dir.style.color = COLORS.filter(([k]) => h.wind_speed_10m[i] >= k).at(-1)[1];
        row.append(dir);
        add("wx-wind", `${Math.round(h.wind_speed_10m[i])}–${Math.round(h.wind_gusts_10m[i])} уз`, row);
        add("wx-temp", `${Math.round(h.temperature_2m[i])}°${h.precipitation[i] > 0.1 ? ` · ${h.precipitation[i].toFixed(1)} мм` : ""}`, row);
        table.append(row);
      }
      box.append(table);
      add("popup-row", "Прогноз Open-Meteo, время местное");
    } catch {
      add("popup-title", "Прогноз не загрузился");
    }
    track(new ctx.maplibregl.Popup({ offset: 14, maxWidth: "280px" })).setLngLat([lon, lat]).setDOMContent(box).addTo(ctx.map);
  }

  register({
    id: "weather/wind",
    kind: "layer",
    title: "Ветер",
    hint: "Ветер сейчас: стрелка — куда дует, число — узлы; щелчок — прогноз на сутки",
    icon: svg('<path d="M4 9h11a3 3 0 1 0-3-3h2a1 1 0 1 1 1 1H4zm0 4h15a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H4zm0-2h8v0H4z"/><path d="M3 11h9v2H3z"/>'),
    needs: ["network"],
    sends: "точки в кадре (Open-Meteo)",
    enable(c) {
      ctx = c; active = true;
      const { map } = c;
      arrow(map);
      if (!map.getSource("wind")) map.addSource("wind", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      if (!map.getLayer("wind")) map.addLayer({ id: "wind", type: "symbol", source: "wind",
        layout: { "icon-image": "wind-arrow", "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-allow-overlap": true,
          "icon-size": ["interpolate", ["linear"], ["get", "kn"], 0, 0.9, 30, 1.5],
          "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-offset": [0, 2], "text-allow-overlap": true },
        paint: { "icon-color": color, "icon-halo-color": "rgba(0,0,0,0.55)", "icon-halo-width": 1.5,
          "text-color": "#fff", "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.4 } });
      claimLayers("wind");
      if (!wired) {
        wired = true;
        map.on("moveend", () => { clearTimeout(timer); timer = setTimeout(update, 300); });
        map.on("click", "wind", (e) => forecast(e.features[0]));
      }
      update();
    },
    disable({ map }) {
      active = false;
      if (map.getLayer("wind")) map.removeLayer("wind");
    },
    stats: () => ({ cached: cache.size }),
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

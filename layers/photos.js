// Фото (Грегори, 2026-10-28: «кнопка фото — слои с кнопкой в виде камеры: фото и веб-камеры»).
//  • Фото — снимки Wikimedia Commons с координатами (без ключа), с масштаба «1 км»: квадратами
//    0,1° (геопоиск Commons не берёт большие рамки), по одному запросу за раз. Commons отдаёт до 500
//    снимков на квадрат, ближние к его середине, — в центре города квадрат с 500 делится на четыре
//    (до 1/8). «Поиск занят» — повтор через 15 с. На карте — значок
//    камеры, щелчок — снимок в окне (картинка грузится только по щелчку) и ссылка на Commons.
//  • Веб-камеры — точки OpenStreetMap с тегом webcam / contact:webcam (их ~10 тысяч на весь мир —
//    один запрос QLever, на любом масштабе). Щелчок — название и ссылка на камеру; если ссылка —
//    сама картинка, она показывается в окне.
// Mapillary и свои фото — позже, в разделе «Фото» (ROADMAP)
import { register } from "../core/modules.js";
import { track, claimLayers } from "../core/popups.js";
import { qleverBox, osmTags } from "../core/qlever.js";
import { uiLanguage } from "../core/labels.js";

const svg = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${inner}</svg>`;
const CAMERA = "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z";
const WEBCAM = "M12 2a7 7 0 0 0-7 7c0 3.04 1.94 5.62 4.65 6.59L8 20H6v2h12v-2h-2l-1.65-4.41A7 7 0 0 0 19 9a7 7 0 0 0-7-7zm0 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z";
const PHOTO_COLOR = "#e91e63"; // --photo
const WEBCAM_COLOR = "#00897b";
export const PHOTO_ICON = svg(`<path d="${CAMERA}"/>`);
const zoomForScale = (map, m) => Math.log2((100 * 40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * m));

// значок на карте: белый кружок с кантом цвета слоя и знаком внутри
function pinImage(map, id, color, path) {
  if (map.hasImage(id)) return id;
  const s = 48;
  const ctx = Object.assign(document.createElement("canvas"), { width: s, height: s }).getContext("2d");
  ctx.beginPath();
  ctx.arc(24, 24, 20, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.translate(11, 11);
  ctx.scale(26 / 24, 26 / 24);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(path));
  map.addImage(id, ctx.getImageData(0, 0, s, s), { pixelRatio: 2 });
  return id;
}

function pointLayer(map, id, image) {
  if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  if (!map.getLayer(id)) map.addLayer({ id, type: "symbol", source: id,
    layout: { "icon-image": image, "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 14, 0.9, 17, 1.1], "icon-allow-overlap": true } });
  claimLayers(id);
}

const popup = (ctx, coords, box, width = "300px") =>
  track(new ctx.maplibregl.Popup({ offset: 14, maxWidth: width })).setLngLat(coords).setDOMContent(box).addTo(ctx.map);
const el = (tag, props, parent) => { const e = Object.assign(document.createElement(tag), props); parent?.append(e); return e; };

// ---------- фото Commons ----------
{
  const MAX_M = 1000, CELL = 0.1, MIN_CELL = 0.0125, LIMIT = 500, MAX_CELLS = 16, RETRY_MS = 15000;
  const API = "https://commons.wikimedia.org/w/api.php";
  const features = new Map(); // pageid → feature
  const cells = new Map(); // "x:y:размер" → true | "loading" | когда повторить
  let queue = Promise.resolve();
  const enqueue = (x, y, size) => {
    const key = `${x}:${y}:${size}`;
    const st = cells.get(key);
    if (st === true || st === "loading" || st > Date.now()) return;
    cells.set(key, "loading");
    queue = queue.then(() => active && loadCell(x, y, size));
  };
  let ctx = null, active = false, wired = false, lastError = "";
  const data = () => ({ type: "FeatureCollection", features: [...features.values()] });

  async function loadCell(x, y, size) {
    const key = `${x}:${y}:${size}`;
    const [w, s] = [x * size, y * size].map((v) => +v.toFixed(4));
    const [e, n] = [w + size, s + size].map((v) => +v.toFixed(4));
    const params = new URLSearchParams({ action: "query", format: "json", origin: "*", generator: "geosearch",
      ggsbbox: `${n}|${w}|${s}|${e}`, ggsnamespace: "6", ggslimit: "500", prop: "coordinates", colimit: "max" });
    try {
      const res = await fetch(`${API}?${params}`);
      if (!res.ok) throw new Error(`Commons: ${res.status}`);
      const json = await res.json();
      // «поиск сейчас занят» (cirrussearch-too-busy) приходит с кодом 200 — это не пустой квадрат
      if (json.error) throw new Error(`Commons: ${json.error.code}`);
      const pages = Object.values(json.query?.pages || {});
      for (const p of pages) {
        const c = p.coordinates?.[0];
        if (c) features.set(p.pageid, { type: "Feature", geometry: { type: "Point", coordinates: [c.lon, c.lat] }, properties: { title: p.title } });
      }
      cells.set(key, true);
      if (active) ctx.map.getSource("photo-commons")?.setData(data());
      // упёрлись в предел — делим квадрат на четыре
      if (pages.length >= LIMIT && size / 2 >= MIN_CELL) {
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) enqueue(x * 2 + dx, y * 2 + dy, size / 2);
      }
    } catch (err) {
      lastError = String(err);
      // повтор через 15 с — сам, даже если карту не двигают
      cells.set(key, Date.now() + RETRY_MS);
      setTimeout(update, RETRY_MS + 100);
    }
  }

  function update() {
    if (!active) return;
    const { map } = ctx;
    const min = zoomForScale(map, MAX_M);
    if (map.getLayer("photo-commons")) map.setLayerZoomRange("photo-commons", min, 24);
    if (map.getZoom() < min) { ctx.status("Приблизьте карту, чтобы увидеть фото"); return; }
    ctx.status("");
    const b = map.getBounds(), c = map.getCenter();
    const list = [];
    for (let x = Math.floor(b.getWest() / CELL); x <= Math.floor(b.getEast() / CELL); x++)
      for (let y = Math.floor(b.getSouth() / CELL); y <= Math.floor(b.getNorth() / CELL); y++)
        list.push([x, y, Math.hypot((x + 0.5) * CELL - c.lng, (y + 0.5) * CELL - c.lat)]);
    list.sort((a, b2) => a[2] - b2[2]);
    for (const [x, y] of list.slice(0, MAX_CELLS)) enqueue(x, y, CELL);
  }

  function show(f) {
    const title = f.properties.title;
    const file = title.replace(/^File:/, "");
    const box = el("div");
    const a = el("a", { href: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`, target: "_blank", rel: "noopener" }, box);
    el("img", { className: "popup-photo", src: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=320`, alt: "", width: 280, height: 190 }, a);
    el("div", { className: "popup-row", textContent: file.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ") }, box);
    el("div", { className: "popup-row", textContent: "Фото Wikimedia Commons — щелчок по снимку откроет его страницу" }, box);
    popup(ctx, f.geometry.coordinates, box);
  }

  register({
    id: "photo/commons",
    kind: "layer",
    group: "photo",
    title: "Фото",
    hint: "Снимки с координатами из Wikimedia Commons — с масштаба 1 км",
    icon: PHOTO_ICON,
    color: PHOTO_COLOR,
    needs: ["network"],
    sends: "район карты (Wikimedia Commons)",
    enable(c) {
      ctx = c; active = true;
      pointLayer(c.map, "photo-commons", pinImage(c.map, "photo-commons-pin", PHOTO_COLOR, CAMERA));
      c.map.getSource("photo-commons").setData(data());
      if (!wired) {
        wired = true;
        c.map.on("idle", update);
        c.map.on("click", "photo-commons", (e) => show(e.features[0]));
      }
      update();
    },
    disable({ map, status }) {
      active = false;
      status("");
      for (const [k, v] of cells) if (v === "loading") cells.delete(k);
      queue = Promise.resolve();
      if (map.getLayer("photo-commons")) map.removeLayer("photo-commons");
    },
    // для проверки: сколько снимков и квадратов, последняя ошибка
    stats: () => ({ photos: features.size, cells: [...cells.values()].map(String), lastError }),
  });
}

// ---------- веб-камеры ----------
{
  const SPARQL = `{ ?osm osmkey:contact:webcam ?url } UNION { ?osm osmkey:webcam ?url }`;
  let points = null, loading = false, ctx = null, wired = false;
  const data = () => ({ type: "FeatureCollection", features: points || [] });

  async function load() {
    if (points || loading) return;
    loading = true;
    try {
      const seen = new Set();
      points = (await qleverBox("?url", SPARQL, [-180, -90, 180, 90], 60000)).flatMap(({ osm, coordinates, b }) => {
        if (seen.has(osm)) return [];
        seen.add(osm);
        return [{ type: "Feature", geometry: { type: "Point", coordinates }, properties: { osm, url: b.url.value } }];
      });
      ctx?.map.getSource("photo-webcams")?.setData(data());
    } catch {
      setTimeout(load, 60000);
    }
    loading = false;
  }

  async function show(f) {
    const { osm, url } = f.properties;
    const tags = (await Promise.race([osmTags(osm).catch(() => null), new Promise((r) => setTimeout(r, 1500, null))])) || {};
    const box = el("div");
    const name = tags[`name:${uiLanguage()}`] || tags.name;
    el("div", { className: "popup-title", textContent: name || "Веб-камера" }, box);
    if (name) el("div", { className: "popup-sub", textContent: "Веб-камера" }, box);
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    // ссылка на саму картинку — показать её в окне (свежий снимок камеры)
    if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(href)) {
      const a = el("a", { href, target: "_blank", rel: "noopener" }, box);
      el("img", { className: "popup-photo", src: href, alt: "", width: 280, height: 190 }, a);
    }
    const row = el("div", { className: "popup-row" }, box);
    el("a", { href, target: "_blank", rel: "noopener", textContent: "Смотреть камеру" }, row);
    popup(ctx, f.geometry.coordinates, box);
  }

  register({
    id: "photo/webcams",
    kind: "layer",
    group: "photo",
    title: "Веб-камеры",
    hint: "Веб-камеры по всему миру (OpenStreetMap)",
    icon: svg(`<path d="${WEBCAM}"/>`),
    color: WEBCAM_COLOR,
    needs: ["network"],
    sends: "запрос веб-камер (QLever, OpenStreetMap), по щелчку — камера (OpenStreetMap)",
    enable(c) {
      ctx = c;
      pointLayer(c.map, "photo-webcams", pinImage(c.map, "photo-webcams-pin", WEBCAM_COLOR, WEBCAM));
      c.map.getSource("photo-webcams").setData(data());
      if (!wired) {
        wired = true;
        c.map.on("click", "photo-webcams", (e) => show(e.features[0]));
      }
      load();
    },
    disable({ map }) {
      if (map.getLayer("photo-webcams")) map.removeLayer("photo-webcams");
    },
  });
}

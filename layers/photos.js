// Фото (Грегори, 2026-10-28: «кнопка фото — слои с кнопкой в виде камеры: фото и веб-камеры»).
//  • Фото — снимки Wikimedia Commons с координатами (без ключа). Как в travel-earth (Грегори,
//    2026-10-29: «высыпает фотки сразу все… должны быть просто точки и потом миниатюры»):
//    со шкалы «20 км» — только точки там, где есть снимки (редкая проба: узел сетки примерно на
//    100 px экрана, круг 10 км вокруг него, по точке на четверть круга); со «3 км» — квадраты
//    тайлов 12-го уровня и мельче целиком: все снимки точками сразу (квадрат с 500 делится на
//    четыре), и только когда точки в кадре загружены — миниатюры: по одной на клетку экрана 64 px,
//    пачкой (Грегори, 2026-10-29: «без миниатюр точки загружаются мгновенно… высыпать все точки
//    сразу, и только потом подгружать миниатюры»). Со шкалы «1 км» — миниатюры поверх точек. Commons отвечает «поиск занят» (cirrussearch-too-busy) с кодом
//    200 — квадрат повторяется через 15 с. Щелчок — снимок в окне и ссылка на Commons.
//  • Снимки улиц — Mapillary: линии съёмки со «1 км», точки снимков со «100 м»; щелчок — снимок,
//    щелчок по снимку или двойной щелчок по линии — плеер в отдельном окне (viewer.html): по
//    снимкам стрелками, панорамы крутятся; на карте — где стоит камера и куда смотрит.
//  • Веб-камеры — точки OpenStreetMap с тегом webcam / contact:webcam (их ~10 тысяч на весь мир —
//    один запрос QLever; издалека — точки, значки — со «3 км»). Щелчок — название и ссылка на камеру; если ссылка —
//    сама картинка, она показывается в окне.
// Свои фото — позже, в разделе «Фото» (ROADMAP)
import { register, isMobile } from "../core/modules.js";
import { track, claimLayers } from "../core/popups.js";
import { qleverBox, osmTags } from "../core/qlever.js";
import { uiLanguage } from "../core/labels.js";
import { setStripItems, selectStripItem, openGallery } from "../core/photo-strip.js";

const svg = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${inner}</svg>`;
const CAMERA = "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z";
const WEBCAM = "M12 2a7 7 0 0 0-7 7c0 3.04 1.94 5.62 4.65 6.59L8 20H6v2h12v-2h-2l-1.65-4.41A7 7 0 0 0 19 9a7 7 0 0 0-7-7zm0 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z";
const PHOTO_COLOR = "#e91e63"; // --photo
const WEBCAM_COLOR = "#00897b";
const MLY_COLOR = "#05cb63"; // зелёный Mapillary
// уличная камера на кронштейне (значок «Снимков улиц» из travel-earth, Грегори выбрал по картинке)
const STREETS = '<path fill-rule="evenodd" d="M1.2 6.4 17.6 2.2c.9-.2 1.5.1 1.7.9l.2.7-17.9 4.6zM2.2 8.9 19.6 4.4l.9 3.6c.3 1.1-.2 1.8-1.2 2.1L6.4 13.4c-2.3.6-3.6-.2-4-1.7zM7.9 10.6a2.6 2.6 0 1 0-5.2 0 2.6 2.6 0 0 0 5.2 0z"/><circle cx="5.3" cy="10.6" r="1.1"/><path d="M11 12.3h2.6v4.2h5.4v2.6h-6.7c-.7 0-1.3-.6-1.3-1.3z"/><path fill-rule="evenodd" d="M19.6 12.6h2.2c.6 0 1 .4 1 1v8c0 .6-.4 1-1 1h-2.2zM21.2 14.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2zm0 5.2a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2z"/>';
export const PHOTO_ICON = svg(`<path d="${CAMERA}"/>`);
// шрифт подписей — из текущего стиля карты (у CARTO свой сервер шрифтов)
const font = (map) => map.getStyle().layers.find((l) => l.type === "symbol" && Array.isArray(l.layout?.["text-font"]))?.layout["text-font"] || ["Noto Sans Regular"];
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

const popup = (ctx, coords, box, offset = 14) =>
  track(new ctx.maplibregl.Popup({ offset, maxWidth: "300px" })).setLngLat(coords).setDOMContent(box).addTo(ctx.map);
const el = (tag, props, parent) => { const e = Object.assign(document.createElement(tag), props); parent?.append(e); return e; };
const link = (href, parent) => el("a", { href, target: "_blank", rel: "noopener" }, parent);

// ---------- фото Commons ----------
{
  const DOT_M = 40000, LOAD_M = 5000, THUMB_M = 2000; // точки — со «20 км», загрузка — со «3 км», миниатюры — с «1 км»
  const API = "https://commons.wikimedia.org/w/api.php";
  const CELL_MIN_Z = 12, PROBE_PX = 100, MAX_CELLS = 40, SIZE = 44;
  // миниатюры — по одной на клетку экрана THUMB_PX (ближайшая к её середине), пачками до BATCH снимков
  const THUMB_PX = 64, BATCH = 50;
  const CLUSTER_PX = 18; // точки ближе 18 px — один кружок с числом
  // «поиск занят» Commons отвечает часто, если спрашивать параллельно, — по одному запросу,
  // после отказа пауза: 1,5 с, дальше вдвое дольше, до 15 с; удачный ответ её сбрасывает
  const PAUSE_MIN = 1500, PAUSE_MAX = 15000;
  const features = new Map(); // pageid → точка (с img — уже с миниатюрой)
  const images = new Map(); // "photo-123" → ImageData (после смены карты ставятся заново)
  const cells = new Map(); // "z/x/y" → true | "dots" | "loading" | когда повторить
  const dense = new Set(); // квадраты, где 500 точек
  const queue = [];
  let running = false, pause = PAUSE_MIN, ctx = null, active = false, wired = false, lastError = "";
  const data = () => ({ type: "FeatureCollection", features: [...features.values()] });
  const thumbData = () => ({ type: "FeatureCollection", features: [...features.values()].filter((f) => f.properties.img) });
  const refresh = () => {
    if (!active) return;
    ctx.map.getSource("photo-commons")?.setData(data());
    ctx.map.getSource("photo-commons-thumbs")?.setData(thumbData());
    // в ленту внизу — снимки с миниатюрой; в галерее — крупный (1920 px или сам снимок, если он меньше)
    setStripItems("commons", [...features.values()].filter((f) => f.properties.img).map((f) => {
      const p = f.properties;
      return { id: `commons/${p.title}`, coordinates: f.geometry.coordinates, thumb: p.thumb, title: p.caption,
        full: p.fullWidth > 1920 ? p.thumb.replace(/\/\d+px-/, "/1920px-") : p.full,
        credit: [p.author, p.date, p.license].filter(Boolean).join(" · "), link: { href: p.page, text: "Wikimedia Commons" },
        select: () => show(f) };
    }));
  };
  const isPhoto = (title) => /\.(jpe?g|webp)$/i.test(title); // png и svg на Commons — в основном карты и схемы
  const dot = (g, z) => ({ type: "Feature", geometry: { type: "Point", coordinates: [g.lon, g.lat] }, properties: { pageid: g.pageid, title: g.title, z } });
  const text = (html) => new DOMParser().parseFromString(html || "", "text/html").body.textContent.replace(/\s+/g, " ").trim();

  async function query(params) {
    const res = await fetch(`${API}?${new URLSearchParams({ action: "query", format: "json", formatversion: 2, origin: "*", ...params })}`,
      { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Commons: ${res.status}`);
    const json = await res.json();
    // «поиск сейчас занят» (cirrussearch-too-busy) приходит с кодом 200 — это не пустой квадрат
    if (json.error) throw new Error(`Commons: ${json.error.code}`);
    return json.query || {};
  }

  // миниатюра — квадрат из середины снимка в тонкой белой скруглённой рамке (как в travel-earth)
  async function thumb(src) {
    const bmp = await createImageBitmap(await (await fetch(src)).blob());
    const size = SIZE * 2, border = 3, side = Math.min(bmp.width, bmp.height);
    const c = Object.assign(document.createElement("canvas"), { width: size, height: size }).getContext("2d");
    c.beginPath();
    c.roundRect(0, 0, size, size, 12);
    c.fillStyle = "#fff";
    c.fill();
    c.beginPath();
    c.roundRect(border, border, size - 2 * border, size - 2 * border, 12 - border);
    c.clip();
    c.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, border, border, size - 2 * border, size - 2 * border);
    return c.getImageData(0, 0, size, size);
  }

  async function addPhoto(page) {
    const f = features.get(page.pageid);
    if (!f) return;
    const { z } = f.properties, { coordinates } = f.geometry;
    const ii = page.imageinfo?.[0];
    if (!ii?.thumburl || features.get(page.pageid)?.properties.img) return;
    const img = `photo-${page.pageid}`;
    if (!images.has(img)) {
      try { images.set(img, await thumb(ii.thumburl)); } catch { return; }
    }
    if (active && !ctx.map.hasImage(img)) try { ctx.map.addImage(img, images.get(img), { pixelRatio: 2 }); } catch { /* стиль меняется */ }
    const meta = ii.extmetadata || {};
    const t = (k) => text(meta[k]?.value);
    // описание бывает служебным словом «default» — тогда имя файла
    const desc = t("ImageDescription");
    const caption = (desc && desc.toLowerCase() !== "default" ? desc : "") || page.title.replace(/^File:/, "").replace(/\.\w+$/, "").replace(/_/g, " ");
    features.set(page.pageid, { type: "Feature", geometry: { type: "Point", coordinates }, properties: { pageid: page.pageid, title: page.title, img, z,
      thumb: ii.thumburl, page: ii.descriptionurl, full: ii.url, fullWidth: ii.width, aspect: ii.thumbheight / ii.thumbwidth,
      caption: caption.length > 160 ? `${caption.slice(0, 157)}…` : caption,
      author: t("Artist"), license: t("LicenseShortName"), date: t("DateTimeOriginal").replace(/^Taken on\s*/, "") } });
  }

  async function loadCell(z, x, y, dotsOnly) {
    const key = `${z}/${x}/${y}`;
    const n = 2 ** z;
    const lat = (v) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * v) / n))) * 180) / Math.PI;
    const lon = (v) => (v / n) * 360 - 180;
    const [w, s, e, n2] = [lon(x), lat(y + 1), lon(x + 1), lat(y)];
    try {
      if (dotsOnly) {
        // издалека — не квадрат, а круг 10 км (больше Commons не ищет) вокруг узла сетки,
        // по точке на четверть круга — ближайшей к середине четверти
        const cx = (w + e) / 2, cy = (s + n2) / 2;
        const found = (await query({ list: "geosearch", gscoord: `${cy}|${cx}`, gsradius: 10000, gsnamespace: 6, gslimit: 200 })).geosearch || [];
        const r = 10000 / 111320, rx = r / Math.cos((cy * Math.PI) / 180);
        const quarter = new Map();
        for (const g of found) {
          if (!isPhoto(g.title)) continue;
          const qx = g.lon >= cx ? 1 : -1, qy = g.lat >= cy ? 1 : -1;
          const d = Math.hypot((g.lon - (cx + (qx * rx) / 2)) / rx, (g.lat - (cy + (qy * r) / 2)) / r);
          const q = `${qx}:${qy}`;
          if (!quarter.has(q) || d < quarter.get(q).d) quarter.set(q, { g, d });
        }
        for (const { g } of quarter.values()) if (!features.has(g.pageid)) features.set(g.pageid, dot(g, z));
        cells.set(key, "dots");
        refresh();
        return;
      }
      // вблизи — все снимки квадрата точками, сразу; миниатюры — потом, отдельной очередью (thumbs)
      const found = (await query({ list: "geosearch", gsbbox: `${n2}|${w}|${s}|${e}`, gsnamespace: 6, gslimit: 500 })).geosearch || [];
      if (found.length >= 500) dense.add(key);
      for (const g of found) if (isPhoto(g.title) && !features.has(g.pageid)) features.set(g.pageid, dot(g, z));
      cells.set(key, true);
      pause = PAUSE_MIN;
      refresh();
      if (dense.has(key)) setTimeout(update);
    } catch (err) {
      lastError = String(err);
      // повтор сам, даже если карту не двигают
      cells.set(key, Date.now() + pause);
      setTimeout(update, pause + 100);
      pause = Math.min(PAUSE_MAX, pause * 2);
    }
  }

  // Порядок: сначала точки на весь кадр (квадраты основного уровня), потом миниатюры, и только
  // потом — четвертинки переполненных квадратов (в центре города их десятки, миниатюры ждали бы
  // минуту). Запрос к Commons — всегда один за раз
  let baseZ = CELL_MIN_Z;
  function pump() {
    if (!active || running) return;
    let i = queue.findIndex((q) => q[0] <= baseZ);
    let need = [];
    if (i < 0) {
      need = thumbsNeeded();
      if (!need.length) i = queue.length ? 0 : -1;
    }
    if (i < 0 && !need.length) return;
    running = true;
    const job = i >= 0 ? loadCell(...queue.splice(i, 1)[0]) : loadThumbs(need);
    job.finally(() => { running = false; pump(); });
  }

  // Миниатюры (Грегори, 2026-10-29: «высыпать все точки сразу после перемещения и изменения масштаба,
  // и только потом подгружать миниатюры»): экран делится на клетки THUMB_PX, в каждой — снимок,
  // ближайший к её середине; клетка, где миниатюра уже есть, готова. При приближении клетки на
  // местности мельче — миниатюр больше. Сведения о снимках — пачкой до 50 одним запросом, картинки —
  // параллельно
  function thumbsNeeded() {
    const { map } = ctx;
    if (map.getZoom() < zoomForScale(map, LOAD_M)) return [];
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const best = new Map();
    for (const f of features.values()) {
      if (f.properties.failed) continue;
      const { x, y } = map.project(f.geometry.coordinates);
      if (x < 0 || y < 0 || x > w || y > h) continue;
      const key = `${Math.floor(x / THUMB_PX)}:${Math.floor(y / THUMB_PX)}`;
      const cur = best.get(key);
      if (cur?.f.properties.img) continue;
      const d = Math.hypot((x % THUMB_PX) - THUMB_PX / 2, (y % THUMB_PX) - THUMB_PX / 2);
      if (f.properties.img || !cur || d < cur.d) best.set(key, { f, d });
    }
    return [...best.values()].map(({ f }) => f).filter((f) => !f.properties.img).slice(0, BATCH);
  }

  async function loadThumbs(need) {
    try {
      const pages = (await query({ pageids: need.map((f) => f.properties.pageid).join("|"), prop: "imageinfo", iiprop: "url|size|extmetadata",
        iiurlwidth: 120, iiextmetadatafilter: "Artist|LicenseShortName|ImageDescription|DateTimeOriginal" })).pages || [];
      await Promise.all(pages.map(addPhoto));
      // нет миниатюры (не картинка, не скачалась) — больше не просить, клетку займёт соседний снимок
      for (const { properties: { pageid } } of need) if (!features.get(pageid).properties.img) features.get(pageid).properties.failed = true;
      refresh();
    } catch (err) {
      lastError = String(err);
      await new Promise((ok) => setTimeout(ok, PAUSE_MIN));
    }
  }

  // квадраты тайлов в кадре (переполненные — вместе с четвертинками), ближние к центру первыми;
  // издалека (sparse) — редкая проба: один квадрат примерно на PROBE_PX экрана
  function cellsInView(map, sparse) {
    const zoom = map.getZoom();
    const z = Math.min(16, Math.max(CELL_MIN_Z, Math.floor(zoom)));
    const step = sparse ? Math.max(1, Math.ceil(PROBE_PX / (512 * 2 ** (zoom - z)))) : 1;
    const maxZ = Math.floor(zoom) + 1;
    const tx = (lng) => (lng + 180) / 360;
    const ty = (la) => (1 - Math.asinh(Math.tan((la * Math.PI) / 180)) / Math.PI) / 2;
    const b = map.getBounds(), c = map.getCenter();
    const list = [];
    const visit = (cz, x, y) => {
      const n = 2 ** cz;
      list.push([cz, x, y, Math.hypot((x + 0.5) / n - tx(c.lng), (y + 0.5) / n - ty(c.lat))]);
      if (!sparse && cz < maxZ && dense.has(`${cz}/${x}/${y}`)) {
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) visit(cz + 1, 2 * x + dx, 2 * y + dy);
      }
    };
    const n = 2 ** z;
    const from = (v) => Math.ceil(v / step) * step; // сетка пробы — одна и та же при сдвиге карты
    for (let x = from(Math.max(0, Math.floor(tx(b.getWest()) * n))); x <= Math.min(n - 1, Math.floor(tx(b.getEast()) * n)); x += step)
      for (let y = from(Math.max(0, Math.floor(ty(b.getNorth()) * n))); y <= Math.min(n - 1, Math.floor(ty(b.getSouth()) * n)); y += step) visit(z, x, y);
    return list.sort((a, b2) => a[3] - b2[3]);
  }

  function update() {
    if (!active) return;
    const { map } = ctx;
    const dotZoom = zoomForScale(map, DOT_M);
    if (map.getLayer("photo-commons-dots")) map.setLayerZoomRange("photo-commons-dots", dotZoom, 24);
    if (map.getLayer("photo-commons")) map.setLayerZoomRange("photo-commons", zoomForScale(map, THUMB_M), 24);
    // квадраты, до которых очередь не дошла, забываются — после сдвига очередь собирается заново
    for (const [z, x, y] of queue.splice(0)) cells.delete(`${z}/${x}/${y}`);
    if (map.getZoom() < dotZoom) { ctx.status("Приблизьте карту, чтобы увидеть фото"); return; }
    ctx.status("");
    const dotsOnly = map.getZoom() < zoomForScale(map, LOAD_M);
    baseZ = Math.min(16, Math.max(CELL_MIN_Z, Math.floor(map.getZoom())));
    for (const [z, x, y] of cellsInView(map, dotsOnly)) {
      const key = `${z}/${x}/${y}`;
      const st = cells.get(key);
      if (st === true || st === "loading" || st > Date.now() || (dotsOnly && st === "dots")) continue;
      cells.set(key, "loading");
      if (queue.push([z, x, y, dotsOnly]) >= MAX_CELLS) break;
    }
    pump();
  }

  function show(f) {
    const p = f.properties;
    const file = p.title.replace(/^File:/, "");
    const box = el("div");
    const a = link(p.page || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`, box);
    // у снимка с миниатюрой пропорции известны — окно не прыгает, пока грузится крупная
    const src = p.thumb ? p.thumb.replace(/\/\d+px-/, "/330px-") : `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=330`;
    const img = el("img", { className: "popup-photo", src, alt: "" }, a);
    if (p.aspect) img.style.height = `${Math.round(260 * Math.min(p.aspect, 1.3))}px`;
    if (p.thumb) img.addEventListener("error", () => { img.src = p.thumb; }, { once: true });
    el("div", { className: "popup-row", textContent: p.caption || file.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ") }, box);
    const credit = [p.author, p.date, p.license].filter(Boolean).join(" · ");
    if (credit) el("div", { className: "popup-sub", textContent: credit }, box);
    el("div", { className: "popup-sub", textContent: "Wikimedia Commons — щелчок по снимку откроет его страницу" }, box);
    popup(ctx, f.geometry.coordinates, box, p.img ? SIZE / 2 + 4 : 8).on("close", () => selectStripItem(null, `commons/${p.title}`));
    if (p.img) selectStripItem(`commons/${p.title}`);
  }

  register({
    id: "photo/commons",
    kind: "layer",
    group: "photo",
    title: "Фото",
    hint: "Снимки с координатами из Wikimedia Commons: точками с масштаба 20 км, миниатюрами — с 1 км",
    icon: PHOTO_ICON,
    color: PHOTO_COLOR,
    needs: ["network"],
    sends: "район карты (Wikimedia Commons)",
    enable(c) {
      ctx = c; active = true;
      const { map } = c;
      for (const [id, d] of images) if (!map.hasImage(id)) map.addImage(id, d, { pixelRatio: 2 });
      // Точки, которые на экране налезли бы друг на друга, собираются в один кружок с числом снимков
      // в этом месте (Грегори, 2026-10-29: «на перекрывающихся точках писать просто цифру»);
      // приблизили — кружок распадается. Миниатюры — свой источник, без сборки
      if (!map.getSource("photo-commons")) map.addSource("photo-commons", { type: "geojson", data: data(),
        cluster: true, clusterRadius: CLUSTER_PX, clusterMaxZoom: 18,
        attribution: '<a href="https://commons.wikimedia.org/" target="_blank">Wikimedia Commons</a>' });
      map.getSource("photo-commons").setData(data());
      if (!map.getSource("photo-commons-thumbs")) map.addSource("photo-commons-thumbs", { type: "geojson", data: thumbData() });
      map.getSource("photo-commons-thumbs").setData(thumbData());
      if (!map.getLayer("photo-commons-dots")) map.addLayer({ id: "photo-commons-dots", type: "circle", source: "photo-commons",
        paint: { "circle-color": PHOTO_COLOR, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5,
          "circle-radius": ["case", ["has", "point_count"], ["step", ["get", "point_count"], 9, 10, 11, 100, 13, 1000, 15], 4] } });
      if (!map.getLayer("photo-commons-count")) map.addLayer({ id: "photo-commons-count", type: "symbol", source: "photo-commons",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": font(map), "text-size": 11,
          "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": "#fff" } });
      // размер 1 на всех зумах: ужатая картинка расплывается
      if (!map.getLayer("photo-commons")) map.addLayer({ id: "photo-commons", type: "symbol", source: "photo-commons-thumbs",
        layout: { "icon-image": ["get", "img"], "symbol-sort-key": ["get", "z"], "icon-padding": 4 } });
      claimLayers("photo-commons-dots", "photo-commons-count", "photo-commons");
      if (!wired) {
        wired = true;
        map.on("idle", update);
        map.on("click", (e) => {
          if (!active) return;
          const f = map.queryRenderedFeatures(e.point, { layers: ["photo-commons", "photo-commons-dots"].filter((id) => map.getLayer(id)) })[0];
          if (!f) return;
          // кружок с числом — приблизить, пока он не распадётся
          if (f.properties.cluster) {
            map.getSource("photo-commons").getClusterExpansionZoom(f.properties.cluster_id)
              .then((zoom) => map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom, 19) })).catch(() => {});
            return;
          }
          show(features.get(f.properties.pageid) || f);
        });
        // двойной щелчок по миниатюре — галерея с этого снимка, карта не приближается
        map.on("dblclick", (e) => {
          const f = active && map.getLayer("photo-commons") && map.queryRenderedFeatures(e.point, { layers: ["photo-commons"] })[0];
          if (!f) return;
          e.preventDefault();
          openGallery(`commons/${f.properties.title}`);
        });
      }
      update();
    },
    disable({ map, status }) {
      active = false;
      status("");
      for (const [z, x, y] of queue.splice(0)) cells.delete(`${z}/${x}/${y}`);
      for (const [k, v] of cells) if (v === "loading") cells.delete(k);
      for (const id of ["photo-commons", "photo-commons-count", "photo-commons-dots"]) if (map.getLayer(id)) map.removeLayer(id);
      setStripItems("commons", []);
    },
    // для проверки: точек, с миниатюрой, квадратов, переполненных квадратов, последняя ошибка
    stats: () => ({ photos: features.size, thumbs: [...features.values()].filter((f) => f.properties.img).length,
      cells: [...cells.values()].map(String), dense: dense.size, lastError }),
  });
}

// ---------- снимки улиц (Mapillary) ----------
// Векторные тайлы Mapillary; ключ — Client Token приложения Грегори «Travel Earth» (открытый: даёт
// только чтение общедоступного). Тайлы тяжёлые (центр Таллина: 13-й уровень ~1 МБ, 14-й ~2,6 МБ,
// мельче — до 10 МБ), поэтому два источника с одним уровнем каждый — MapLibre грузит источник,
// только когда виден его слой: линии съёмки — тайлы 13-го уровня (со шкалы «1 км»), точки
// снимков — 14-го (со «100 м»). Данные снимка для окна — Graph API, по щелчку
{
  const TOKEN = "MLY|27764742799866922|5ce2165cbf2f1597e411962b204bf708";
  const TILES = `https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${TOKEN}`;
  const LINES_M = 2000, IMAGES_M = 200; // линии — с «1 км», точки — со «100 м»
  const LAYERS = ["photo-mly-lines", "photo-mly-images"];
  const info = new Map(); // id снимка → данные для окна
  let ctx = null, active = false, wired = false, viewer = null;

  async function loadInfo(id) {
    if (info.has(id)) return info.get(id);
    const res = await fetch(`https://graph.mapillary.com/${id}?fields=thumb_1024_url,captured_at,creator,is_pano,width,height&access_token=${encodeURIComponent(TOKEN)}`,
      { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const i = { thumb: d.thumb_1024_url, pano: !!d.is_pano, author: d.creator?.username || "",
      date: d.captured_at ? new Date(d.captured_at).toLocaleDateString("ru") : "",
      aspect: d.is_pano ? 0.5 : d.height && d.width ? d.height / d.width : 0.75 };
    info.set(id, i);
    return i;
  }

  // плеер — отдельное окно, одно и то же (его можно унести на другой монитор, как в travel-earth)
  function openViewer(id) {
    const k = isMobile() ? 0.98 : 0.8;
    const w = Math.round(screen.availWidth * k), h = Math.round(screen.availHeight * (isMobile() ? 0.98 : 0.85));
    viewer = window.open(`viewer.html?id=${encodeURIComponent(id)}`, "atlas-streets",
      `popup,width=${w},height=${h},left=${Math.round((screen.availWidth - w) / 2)},top=${Math.round((screen.availHeight - h) / 2)}`);
    viewer?.focus();
  }

  async function show(f, lngLat) {
    const id = String(f.properties.image_id ?? f.properties.id);
    const i = await loadInfo(id).catch(() => null);
    if (!i || !active) return;
    const play = (e) => { e.preventDefault(); openViewer(id); };
    const box = el("div");
    const a = el("a", { href: "#", title: "Смотреть в плеере" }, box);
    a.addEventListener("click", play);
    const img = el("img", { className: "popup-photo", src: i.thumb, alt: "" }, a);
    img.style.height = `${Math.round(260 * Math.min(i.aspect, 1.3))}px`;
    el("div", { className: "popup-row", textContent: i.pano ? "Панорама 360°" : "Снимок улицы" }, box);
    el("div", { className: "popup-sub", textContent: [i.author, i.date, "CC BY-SA 4.0"].filter(Boolean).join(" · ") }, box);
    const row = el("div", { className: "popup-row" }, box);
    el("a", { href: "#", textContent: "Смотреть в плеере" }, row).addEventListener("click", play);
    row.append(" · ");
    link(`https://www.mapillary.com/app/?pKey=${id}&focus=photo`, row).textContent = "Mapillary";
    popup(ctx, f.geometry.type === "Point" ? f.geometry.coordinates : [lngLat.lng, lngLat.lat], box, f.geometry.type === "Point" ? 10 : 6);
  }

  // точка камеры со «взглядом» — веер вверх, поворачивается по направлению
  function posImage(map) {
    if (map.hasImage("photo-mly-pos")) return;
    const size = 96, c = size / 2;
    const g = Object.assign(document.createElement("canvas"), { width: size, height: size }).getContext("2d");
    g.fillStyle = "rgba(233, 30, 99, 0.35)";
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, 44, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    g.closePath();
    g.fill();
    for (const [r, color] of [[11, "#fff"], [8, PHOTO_COLOR]]) {
      g.beginPath();
      g.arc(c, c, r, 0, 2 * Math.PI);
      g.fillStyle = color;
      g.fill();
    }
    map.addImage("photo-mly-pos", g.getImageData(0, 0, size, size), { pixelRatio: 2 });
  }

  function update() {
    if (!active) return;
    const { map } = ctx;
    const lines = Math.max(13, zoomForScale(map, LINES_M));
    if (map.getLayer("photo-mly-lines")) map.setLayerZoomRange("photo-mly-lines", lines, 24);
    if (map.getLayer("photo-mly-images")) map.setLayerZoomRange("photo-mly-images", Math.max(14, zoomForScale(map, IMAGES_M)), 24);
    ctx.status(map.getZoom() < lines ? "Приблизьте карту, чтобы увидеть снимки улиц" : "");
  }

  // плеер сообщает, где камера и куда смотрит: точка со взглядом; точка у края — карта подвигается
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data?.mapillary || !ctx) return;
    const { map } = ctx;
    const src = map.getSource("photo-mly-pos");
    if (!src) return;
    const m = e.data.mapillary;
    if (m.closed) { src.setData({ type: "FeatureCollection", features: [] }); return; }
    src.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      properties: { bearing: m.bearing || 0 } }] });
    if (!m.moved) return;
    const { x, y } = map.project([m.lng, m.lat]);
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    if (x < w * 0.2 || x > w * 0.8 || y < h * 0.2 || y > h * 0.8) map.easeTo({ center: [m.lng, m.lat], duration: 700 });
  });

  register({
    id: "photo/streets",
    kind: "layer",
    group: "photo",
    title: "Снимки улиц",
    hint: "Снимки и панорамы улиц из Mapillary: линии с масштаба 1 км, точки снимков — со 100 м; снимок открывается в плеере",
    icon: svg(STREETS),
    color: MLY_COLOR,
    needs: ["network"],
    sends: "район карты (Mapillary)",
    enable(c) {
      ctx = c; active = true;
      const { map } = c;
      if (!map.getSource("photo-mly")) map.addSource("photo-mly", { type: "vector", tiles: [TILES], minzoom: 13, maxzoom: 13,
        attribution: '<a href="https://www.mapillary.com/" target="_blank">Mapillary</a> (CC BY-SA)' });
      if (!map.getSource("photo-mly-14")) map.addSource("photo-mly-14", { type: "vector", tiles: [TILES], minzoom: 14, maxzoom: 14 });
      if (!map.getLayer("photo-mly-lines")) map.addLayer({ id: "photo-mly-lines", type: "line", source: "photo-mly", "source-layer": "sequence", minzoom: 13,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": MLY_COLOR, "line-opacity": 0.55, "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.8, 16, 1.5, 18, 2.5] } });
      if (!map.getLayer("photo-mly-images")) map.addLayer({ id: "photo-mly-images", type: "circle", source: "photo-mly-14", "source-layer": "image", minzoom: 14,
        paint: { "circle-color": MLY_COLOR, "circle-radius": ["interpolate", ["linear"], ["zoom"], 16, 2.5, 19, 5],
          "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
      posImage(map);
      if (!map.getSource("photo-mly-pos")) map.addSource("photo-mly-pos", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      if (!map.getLayer("photo-mly-pos")) map.addLayer({ id: "photo-mly-pos", type: "symbol", source: "photo-mly-pos",
        layout: { "icon-image": "photo-mly-pos", "icon-size": 1.6, "icon-rotate": ["get", "bearing"], "icon-rotation-alignment": "map",
          "icon-allow-overlap": true, "icon-ignore-placement": true } });
      claimLayers(...LAYERS);
      if (!wired) {
        wired = true;
        map.on("moveend", update);
        const at = (point) => map.queryRenderedFeatures(point, { layers: LAYERS.filter((id) => map.getLayer(id)) })[0];
        map.on("click", (e) => { const f = active && at(e.point); if (f) show(f, e.lngLat); });
        // двойной щелчок по линии или точке — сразу плеер, карта не приближается
        map.on("dblclick", (e) => {
          const f = active && at(e.point);
          if (!f) return;
          e.preventDefault();
          openViewer(String(f.properties.image_id ?? f.properties.id));
        });
      }
      update();
    },
    disable({ map, status }) {
      active = false;
      status("");
      for (const id of [...LAYERS, "photo-mly-pos"]) if (map.getLayer(id)) map.removeLayer(id);
      // и источники — иначе MapLibre держит тяжёлые тайлы
      for (const id of ["photo-mly", "photo-mly-14", "photo-mly-pos"]) if (map.getSource(id)) map.removeSource(id);
    },
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
      stripItems();
    } catch {
      setTimeout(load, 60000);
    }
    loading = false;
  }

  const PIN_M = 5000; // значки — со шкалы «3 км», мельче — точки
  const href = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);
  const isImage = (url) => /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url);
  let on = false;
  // в ленту — камеры, у которых ссылка ведёт прямо на картинку (свежий кадр); у остальных — страница
  // сайта, превью у неё нет
  const stripItems = () => setStripItems("webcams", !on ? [] : (points || []).filter((f) => isImage(href(f.properties.url))).map((f) => {
    const url = href(f.properties.url);
    return { id: `webcam/${f.properties.osm}`, coordinates: f.geometry.coordinates, thumb: url, full: url, title: "Веб-камера",
      link: { href: url, text: "Смотреть камеру" }, select: () => show(f) };
  }));
  function zoomRange(map) {
    const pin = zoomForScale(map, PIN_M);
    if (map.getLayer("photo-webcams")) map.setLayerZoomRange("photo-webcams", pin, 24);
    if (map.getLayer("photo-webcams-dots")) map.setLayerZoomRange("photo-webcams-dots", 0, pin);
  }

  async function show(f) {
    const { osm, url } = f.properties;
    const tags = (await Promise.race([osmTags(osm).catch(() => null), new Promise((r) => setTimeout(r, 1500, null))])) || {};
    const box = el("div");
    const name = tags[`name:${uiLanguage()}`] || tags.name;
    el("div", { className: "popup-title", textContent: name || "Веб-камера" }, box);
    if (name) el("div", { className: "popup-sub", textContent: "Веб-камера" }, box);
    const page = href(url);
    // ссылка на саму картинку — показать её в окне (свежий снимок камеры) и выделить в ленте
    if (isImage(page)) {
      el("img", { className: "popup-photo", src: page, alt: "" }, link(page, box));
      selectStripItem(`webcam/${osm}`);
    }
    const row = el("div", { className: "popup-row" }, box);
    link(page, row).textContent = "Смотреть камеру";
    popup(ctx, f.geometry.coordinates, box).on("close", () => selectStripItem(null, `webcam/${osm}`));
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
      const { map } = c;
      on = true;
      stripItems();
      pointLayer(map, "photo-webcams", pinImage(map, "photo-webcams-pin", WEBCAM_COLOR, WEBCAM));
      map.getSource("photo-webcams").setData(data());
      // издалека — маленькие точки, значки — со шкалы «3 км» (Грегори, 2026-10-29: на глобусе
      // значки сыпались кучей, «работает не правильно»)
      if (!map.getLayer("photo-webcams-dots")) map.addLayer({ id: "photo-webcams-dots", type: "circle", source: "photo-webcams",
        paint: { "circle-color": WEBCAM_COLOR, "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 2, 8, 3.5],
          "circle-stroke-color": "#fff", "circle-stroke-width": 1 } }, "photo-webcams");
      claimLayers("photo-webcams-dots");
      if (!wired) {
        wired = true;
        map.on("moveend", () => zoomRange(map));
        map.on("click", (e) => {
          const layers = ["photo-webcams", "photo-webcams-dots"].filter((id) => map.getLayer(id));
          const f = layers.length && map.queryRenderedFeatures(e.point, { layers })[0];
          if (f) show(f);
        });
        map.on("dblclick", (e) => {
          const f = on && map.getLayer("photo-webcams") && map.queryRenderedFeatures(e.point, { layers: ["photo-webcams"] })[0];
          if (!f || !isImage(href(f.properties.url))) return;
          e.preventDefault();
          openGallery(`webcam/${f.properties.osm}`);
        });
      }
      zoomRange(map);
      load();
    },
    disable({ map }) {
      for (const id of ["photo-webcams", "photo-webcams-dots"]) if (map.getLayer(id)) map.removeLayer(id);
      on = false;
      stripItems();
    },
  });
}

// Лента снимков внизу экрана и галерея (Грегори, 2026-10-29: «ленту с превью найденных фоток внизу
// экрана и переходом в альбом в отдельном окне при даблклике; и может у веб-камер тоже»).
// Как в travel-earth: в ленте — снимки в кадре, слева направо как на карте; ушедшие из кадра
// убираются, элементы переиспользуются (прокрутка не сбрасывается), колесо крутит ленту вбок.
// Щелчок — снимок выделяется (розовое кольцо на карте и рамка в ленте) и открывается его окно;
// двойной щелчок — галерея gallery.html в отдельном окне (одно и то же, его можно унести на
// другой монитор) со всеми снимками ленты, начиная с выбранного. Галерея ведёт карту: листаешь —
// снимок выделяется, карта подвигается к нему.
//
// Источник (модуль) отдаёт свои снимки: setStripItems(source, items), где снимок —
// { id, coordinates, thumb, title, full?, credit?, link?: { href, text }, select() };
// выключили слой — setStripItems(source, []). Ядро источники по именам не знает
import { emit } from "./events.js";

const MIN_M = 5000; // лента — со шкалы «3 км», как в travel-earth
const COLOR = "#e91e63"; // --photo
const sources = new Map(); // источник → снимки
const buttons = new Map(); // id → кнопка ленты
let list = []; // снимки ленты по порядку — для галереи
let selected = null, galleryFocus = false, map = null, frame = 0;
const zoomForScale = (m) => Math.log2((100 * 40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * m));

const strip = Object.assign(document.createElement("div"), { className: "photo-strip", hidden: true });
strip.addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.scrollLeft += e.deltaY;
  e.preventDefault();
}, { passive: false });

export function setStripItems(source, items) {
  sources.set(source, items);
  if (map) update();
}

const byId = (id) => [...sources.values()].flat().find((p) => p.id === id);

// выделить снимок (null — снять; с ifSelected — снять, только если выделен именно он: окно снимка
// закрылось, а галерея уже выделила другой): кольцо на карте, рамка в ленте
export function selectStripItem(id, ifSelected) {
  if (ifSelected !== undefined && selected !== ifSelected) return;
  selected = id || null;
  const p = selected && byId(selected);
  map?.getSource("photo-strip-selected")?.setData({ type: "FeatureCollection",
    features: p ? [{ type: "Feature", geometry: { type: "Point", coordinates: p.coordinates }, properties: {} }] : [] });
  for (const [k, b] of buttons) b.classList.toggle("active", k === selected);
  buttons.get(selected)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  emit("photo", p ? { id: p.id, source: p.source } : null);
}

function update() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const b = map.getBounds();
    const on = map.getZoom() >= zoomForScale(MIN_M);
    const shown = on ? [...sources.entries()].flatMap(([source, items]) => items.map((p) => ({ ...p, source })))
      .filter((p) => b.contains(p.coordinates))
      .map((p) => [p, map.project(p.coordinates).x]).sort((a, c) => a[1] - c[1]).map(([p]) => p) : [];
    list = shown;
    const keep = new Set(shown.map((p) => p.id));
    for (const [id, el] of buttons) if (!keep.has(id)) { el.remove(); buttons.delete(id); }
    shown.forEach((p, i) => {
      let el = buttons.get(p.id);
      if (!el) {
        el = Object.assign(document.createElement("button"), { className: "photo-strip-item", title: p.title || "" });
        el.append(Object.assign(document.createElement("img"), { src: p.thumb, alt: "", loading: "lazy" }));
        el.addEventListener("click", () => { selectStripItem(p.id); byId(p.id)?.select?.(); });
        el.addEventListener("dblclick", () => openGallery(p.id));
        buttons.set(p.id, el);
      }
      el.classList.toggle("active", p.id === selected);
      if (strip.children[i] !== el) strip.insertBefore(el, strip.children[i] || null);
    });
    strip.hidden = !shown.length;
    document.body.classList.toggle("has-photo-strip", shown.length > 0);
  });
}

// ---------- галерея в отдельном окне ----------
// Список галерея берёт сама у окна карты (window.opener.atlasGallery()) — наружу ничего не уходит
let gallery = { photos: [], start: 0 };
window.atlasGallery = () => gallery;

export function openGallery(id) {
  const from = list.some((p) => p.id === id) ? list : [byId(id), ...list].filter(Boolean);
  gallery = { photos: from.map(({ id: pid, thumb, full, title, credit, link }) => ({ id: pid, thumb, full, title, credit, link })),
    start: Math.max(0, from.findIndex((p) => p.id === id)) };
  const mobile = matchMedia("(pointer: coarse)").matches;
  const w = Math.round(screen.availWidth * (mobile ? 0.98 : 0.8)), h = Math.round(screen.availHeight * (mobile ? 0.98 : 0.85));
  // то же окно — перезагружается с новым списком
  const win = window.open(`gallery.html?t=${Date.now()}`, "atlas-gallery",
    `popup,width=${w},height=${h},left=${Math.round((screen.availWidth - w) / 2)},top=${Math.round((screen.availHeight - h) / 2)}`);
  win?.focus();
}

// галерея листает — снимок выделяется на карте, карта подвигается, если он у края
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data?.gallery || !map) return;
  if (e.data.gallery === "closed") { if (galleryFocus) selectStripItem(null); galleryFocus = false; return; }
  const p = byId(e.data.id);
  if (!p) return;
  galleryFocus = true;
  selectStripItem(p.id);
  const { x, y } = map.project(p.coordinates);
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  if (x < w * 0.2 || x > w * 0.8 || y < h * 0.2 || y > h - 110 - h * 0.1) map.easeTo({ center: p.coordinates, duration: 700 });
});

export function initPhotoStrip(ctx) {
  map = ctx.map;
  document.body.append(strip);
  const addLayer = () => {
    if (!map.getSource("photo-strip-selected")) map.addSource("photo-strip-selected", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    if (!map.getLayer("photo-strip-selected")) map.addLayer({ id: "photo-strip-selected", type: "circle", source: "photo-strip-selected",
      paint: { "circle-radius": 28, "circle-color": "rgba(0, 0, 0, 0)", "circle-stroke-color": COLOR, "circle-stroke-width": 3 } });
    selectStripItem(selected);
  };
  map.on("style.load", addLayer);
  if (map.isStyleLoaded()) addLayer();
  map.on("moveend", update);
  // карту тронули рукой — выделение снимается (движение от галереи — без originalEvent)
  map.on("movestart", (e) => { if (e.originalEvent && selected) { galleryFocus = false; selectStripItem(null); } });
}

// для проверки
export const stripState = () => ({ items: list.length, selected, gallery: gallery.photos.length });

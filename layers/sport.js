// Спорт — своя кнопка в «Местах» (Грегори 2026-11-21: «меню спорт и спорт-инвентарь, прокат, теннис, падел корты…
// туда же перетащить Серф и Кайт»). Виды отмечаются как у «Магазинов», можно несколько. Ищется только в районе
// на экране: QLever квадратами по полградуса вокруг центра, каждый отмеченный вид — своим запросом (горнолыжные курорты — по 2°, видны со шкалы «20 км»,
// остальное — со шкалы «2 км»). Теннисные корты в OSM — каждый отдельно: соседние в пределах ~150 м — одна
// булавка. Щелчок — окно места (core/place-info.js): что это, часы, телефон и все ссылки из OSM — сайт,
// бронирование, соцсети. «Сёрфинг» и «Кайт в Эстонии» — свои модули (layers/outdoor.js), из барабана убраны:
// их включает и выключает этот вид
import { register, modules, toggle } from "../core/modules.js";
import * as settings from "../core/settings.js";
import { track, claimLayers } from "../core/popups.js";
import { featureContent, withWeather } from "../core/place-info.js";
import { profileMenu } from "../core/profiles.js";
import { qleverBox, cellsInView, cellLoader } from "../core/qlever.js";
import { GLYPHS, pin } from "./places.js";

const icon = (d) => `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="${d}"/></svg>`;
Object.assign(GLYPHS, {
  ski: "M2 20.5 9.5 7l3.6 6.2 2.4-3.4L22.5 20.5z M9.5 7l-2 3.6 2-1 2 1z",
  rental: "M21.4 11.6l-9-9C12 2.2 11.5 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.6-1.4zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z",
  sportshop: "M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-1.99.9-1.99 2L3 20c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-3c1.66 0 3 1.34 3 3H9c0-1.66 1.34-3 3-3z",
  tennis: "M14.5 2a7.5 7.5 0 0 0-6.6 11l-5.3 5.3a1.5 1.5 0 0 0 0 2.1l1 1a1.5 1.5 0 0 0 2.1 0l5.3-5.3A7.5 7.5 0 1 0 14.5 2z",
  padel: "M12 2c4 0 7 3 7 7 0 3.5-2.5 6-5 6.6V20a2 2 0 0 1-4 0v-4.4C7.5 15 5 12.5 5 9c0-4 3-7 7-7z",
});

// вид: q — часть запроса QLever (?osm, ?sub — что это для окна места), far — виден издалека;
// падел и теннис — первыми в меню (Грегори 2026-11-21)
const KINDS = [
  { id: "padel", name: "Падел", color: "#c2185b", group: true,
    q: `?osm osmkey:sport ?sp . FILTER (REGEX(?sp, "(^|;)padel(;|$)")) BIND("padel" AS ?sub)` },
  { id: "tennis", name: "Теннис", color: "#9e9d24", group: true,
    q: `?osm osmkey:sport ?sp . FILTER (REGEX(?sp, "(^|;)tennis(;|$)")) ?osm osmkey:leisure ?l . FILTER (?l IN ("pitch", "sports_centre", "sports_hall")) BIND("tennis" AS ?sub)` },
  { id: "ski", name: "Горнолыжные курорты", color: "#0277bd", far: true,
    q: `?osm osmkey:landuse "winter_sports" . ?osm osmkey:name ?nm . BIND("winter_sports" AS ?sub)` },
  { id: "rental", name: "Прокат", color: "#6d4c41",
    q: `{ ?osm osmkey:amenity ?sub . FILTER (?sub IN ("ski_rental", "boat_rental")) }
    UNION { ?osm osmkey:shop "rental" . BIND("rental" AS ?sub) }
    UNION { ?osm osmkey:amenity "bicycle_rental" . ?osm osmkey:bicycle_rental "shop" . BIND("bicycle_rental" AS ?sub) }` },
  { id: "shops", name: "Спортивные магазины", color: "#5e35b1", glyph: "sportshop",
    q: `?osm osmkey:shop ?sub . FILTER (?sub IN ("sports", "outdoor", "ski", "bicycle", "surf", "fishing"))` },
];
// виды-модули: включаются вместе со «Спортом» и выключаются вместе с ним
const LINKED = [
  { id: "surf", name: "Сёрфинг и кайт", module: "layers/surf" },
  { id: "kite-ee", name: "Кайт в Эстонии", module: "layers/kite-ee" },
];
const FAR_M = 20000, NEAR_M = 2000; // шкала (м на 100 px), с которой видно
const FAR_CELL = 2, NEAR_CELL = 0.5;
const OSM_TYPE_NUM = { node: 1, way: 2, relation: 3 };
const LAYER = "sport";

const zoomForScale = (map, m) => Math.log2((100 * 40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * m));
const linkedIcon = (l) => modules("layer").find((m) => m.id === l.module)?.icon;
const prof = profileMenu("places.sport.profile", [
  ...KINDS.map((k) => ({ ...k, icon: icon(GLYPHS[k.glyph || k.id]) })),
  ...LINKED.map((l) => ({ ...l, get icon() { return linkedIcon(l); } })),
], "Спорт");

const points = new Map(); // osm → точка; kind — id вида
let ctxRef = null, on = false, wired = false;
const chosen = () => new Set(prof.selected().map((p) => p.id));
const data = () => {
  const want = chosen();
  return { type: "FeatureCollection", features: [...points.values()].filter((f) => want.has(f.properties.kind)) };
};
const refresh = () => ctxRef?.map.getSource(LAYER)?.setData(data());

// ответ QLever → точки; корты рядом — одна булавка (с названием, если есть)
function add(rows) {
  const seen = new Map();
  for (const f of points.values()) if (KINDS.find((k) => k.id === f.properties.kind)?.group) seen.set(cellKey(f.properties.kind, f.geometry.coordinates), f);
  for (const { osm, coordinates, b } of rows) {
    const kind = b.kind.value, [type, num] = osm.split("/");
    const f = { type: "Feature", id: Number(num) * 10 + OSM_TYPE_NUM[type], geometry: { type: "Point", coordinates },
      properties: { kind, subclass: b.sub?.value || kind, name: b.nm?.value || undefined } };
    if (KINDS.find((k) => k.id === kind)?.group) {
      const key = cellKey(kind, coordinates), old = seen.get(key);
      if (old) { if (!old.properties.name && f.properties.name) { points.delete(osmOf(old)); } else continue; }
      seen.set(key, f);
    }
    points.set(osm, f);
  }
  refresh();
}
const cellKey = (kind, [x, y]) => `${kind}:${Math.round(x * 700)}:${Math.round(y * 1100)}`;
const osmOf = (f) => `${["", "node", "way", "relation"][f.id % 10]}/${Math.floor(f.id / 10)}`;
// у каждого вида свой запрос и своя очередь: спрашиваются только отмеченные (общий запрос на все виды
// у QLever бывает дольше 40 с)
const loaders = new Map(KINDS.map((k) => [k.id, cellLoader(k.far ? FAR_CELL : NEAR_CELL,
  async (box) => add(await qleverBox("?sub ?nm", `{ ${k.q} BIND("${k.id}" AS ?kind) }`, box)), () => update())]));
const forgetAll = () => { for (const l of loaders.values()) l.forgetPending(); };

function update() {
  const map = ctxRef?.map;
  if (!on || !map) return;
  const want = chosen();
  for (const k of KINDS) {
    if (!want.has(k.id)) { loaders.get(k.id).forgetPending(); continue; }
    if (map.getZoom() >= zoomForScale(map, k.far ? FAR_M : NEAR_M)) loaders.get(k.id).request(k.far ? cellsInView(map, FAR_CELL, 2) : cellsInView(map, NEAR_CELL, 0.5));
  }
  if (map.getLayer(LAYER)) map.setLayerZoomRange(LAYER, Math.min(zoomForScale(map, want.has("ski") ? FAR_M : NEAR_M), 24), 24);
}

function ensureLayer(map) {
  if (!map.getSource(LAYER)) map.addSource(LAYER, { type: "geojson", data: data() });
  // выключили — слой прячется, не убирается: его спрашивает окно места (claimLayers)
  if (map.getLayer(LAYER)) { map.setLayoutProperty(LAYER, "visibility", "visible"); return; }
  map.addLayer({ id: LAYER, type: "symbol", source: LAYER,
    layout: { "icon-image": ["match", ["get", "kind"], ...KINDS.flatMap((k) => [k.id, pin(map, k.color, k.glyph || k.id)]), pin(map, "#5e35b1")],
      "icon-anchor": "bottom", "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.8, 12, 1, 17, 1.4],
      "icon-allow-overlap": true, "icon-ignore-placement": true } });
  claimLayers(LAYER);
}

// модули-виды — вслед за отметками в меню
async function syncLinked(ctx, active) {
  const want = chosen();
  for (const l of LINKED) {
    const m = modules("layer").find((x) => x.id === l.module);
    const should = active && want.has(l.id);
    if (m && !!m.active !== should) await toggle(l.module, ctx, should, { by: "places/sport" }).catch(() => {});
  }
}
// «Сёрфинг» и «Кайт в Эстонии» были включены кнопками в «Местах» (до 2026-11-21) — теперь это «Спорт» с ними
{
  const was = settings.get("layers.on", []), old = LINKED.filter((l) => was.includes(l.module));
  if (old.length && !was.includes("places/sport")) {
    settings.set("places.sport.profile", old.map((l) => l.id));
    settings.set("layers.on", [...was.filter((id) => !old.some((l) => l.module === id)), "places/sport"]);
  }
}

function wire({ map, maplibregl }) {
  if (wired) return;
  wired = true;
  map.on("style.load", () => { if (on) { ensureLayer(map); update(); } });
  map.on("idle", update);
  let click = 0;
  map.on("click", LAYER, async (e) => {
    const f = e.features[0];
    const n = ++click;
    const content = await featureContent(f);
    if (n !== click) return;
    track(new maplibregl.Popup({ offset: [0, -30], maxWidth: "280px" }))
      .setLngLat(f.geometry.coordinates).setDOMContent(withWeather(content, f.geometry.coordinates, content.querySelector(".popup-title")?.textContent || "")).addTo(map);
  });
}

register({
  id: "places/sport",
  kind: "layer",
  group: "places",
  title: "Спорт",
  icon: icon(GLYPHS.tennis),
  needs: ["network"],
  sends: "район карты (QLever, OpenStreetMap), по щелчку — место (OpenStreetMap, Википедия)",
  menu: prof.menu,
  enable(ctx) {
    ctxRef = ctx;
    on = true;
    wire(ctx);
    ensureLayer(ctx.map);
    refresh();
    update();
    return syncLinked(ctx, true);
  },
  disable(ctx) {
    on = false;
    forgetAll();
    if (ctx.map.getLayer(LAYER)) ctx.map.setLayoutProperty(LAYER, "visibility", "none");
    return syncLinked(ctx, false);
  },
  stats: () => ({ points: points.size, kinds: [...chosen()], shown: data().features.length }),
});

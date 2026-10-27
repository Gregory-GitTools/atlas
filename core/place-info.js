// Окно места по щелчку (как в travel-earth). Щелчок по значку или подписи самой карты
// (достопримечательность, вершина, город, озеро…) — название, вид, высота, часы, телефон, сайт и
// описание из Википедии; щелчок по пустому месту — координаты (щелчок по ним копирует) и адрес.
// Мимо глобуса, по звёздам, — ничего. Первый щелчок при открытом окне или списке только
// закрывает их. Окна на карте закрываются, как только карта двинулась (правило travel-earth).
// Служба: отправляет в сеть координаты щелчка и название места
import { register, modules, allowed } from "./modules.js";
import { uiLanguage } from "./labels.js";
import { emit } from "./events.js";
import { track, anyOpen as popupOpen, closeAll, ownHit } from "./popups.js";

register({
  id: "core/place-info",
  kind: "service",
  title: "Окно места",
  sends: "координаты щелчка и название места (OpenStreetMap, Википедия)",
});
const self = () => modules("service").find((m) => m.id === "core/place-info");

const NOMINATIM = "https://nominatim.openstreetmap.org";
const SOURCE_LAYERS = ["poi", "place", "water_name", "mountain_peak", "aerodrome_label", "park"];
const KIND = {
  country: "Страна", state: "Регион", province: "Провинция", city: "Город", town: "Город", village: "Деревня",
  hamlet: "Посёлок", suburb: "Район", quarter: "Квартал", neighbourhood: "Район", island: "Остров", islet: "Остров",
  peak: "Вершина", volcano: "Вулкан", saddle: "Перевал", lake: "Озеро", sea: "Море", ocean: "Океан", bay: "Залив",
  park: "Парк", national_park: "Национальный парк", nature_reserve: "Заповедник", protected_area: "Охраняемая территория",
  // значки без названия — тоже, если вид известен
  shelter: "Навес", picnic_shelter: "Навес для пикника", bench: "Скамейка", water_point: "Питьевая вода",
  drinking_water: "Питьевая вода", playground: "Детская площадка", parking: "Парковка", bicycle_parking: "Велопарковка",
  information: "Информация", place_of_worship: "Храм", fuel: "Заправка", atm: "Банкомат", bank: "Банк",
  post_office: "Почта", police: "Полиция", hospital: "Больница", doctors: "Врач", dentist: "Стоматолог",
  pharmacy: "Аптека", school: "Школа", kindergarten: "Детский сад", library: "Библиотека", swimming_pool: "Бассейн",
  sports_centre: "Спортивный центр", pitch: "Спортплощадка", golf_course: "Гольф", spring: "Родник",
  waterfall: "Водопад", cave_entrance: "Пещера", ruins: "Руины", memorial: "Мемориал", monument: "Памятник",
  artwork: "Арт-объект", fountain: "Фонтан", wayside_shrine: "Придорожная часовня", castle: "Замок",
  museum: "Музей", viewpoint: "Смотровая площадка", attraction: "Достопримечательность", restaurant: "Ресторан",
  cafe: "Кафе", bar: "Бар", pub: "Паб", fast_food: "Фастфуд", hotel: "Гостиница", hostel: "Хостел",
  guest_house: "Гостевой дом", camp_site: "Кемпинг", toilets: "Туалет", zoo: "Зоопарк", theatre: "Театр",
  cinema: "Кино", aerodrome: "Аэропорт", railway: "Вокзал", bus: "Автобус", ferry_terminal: "Паром",
};
const OSM_TYPES = { 1: "node", 2: "way", 3: "relation" };

const withTimeout = (promise, ms, fallback) => Promise.race([promise, new Promise((r) => setTimeout(r, ms, fallback))]);
const kindOf = (f) => KIND[f.properties.subclass] || KIND[f.properties.class];
const h = (cls, text, tag = "div") => Object.assign(document.createElement(tag), { className: cls, textContent: text });

// теги OSM значка: у OpenFreeMap id = osm_id·10 + тип; у CARTO номера свои — ищем по имени рядом
async function osmTags(f) {
  let type, id;
  if (f.source !== "carto" && f.id != null) {
    type = OSM_TYPES[f.id % 10];
    id = Math.floor(f.id / 10);
  } else if (f.geometry.type === "Point" && f.properties.name) {
    const [lon, lat] = f.geometry.coordinates;
    const params = new URLSearchParams({ q: f.properties.name, format: "jsonv2", limit: "1", bounded: "1",
      viewbox: [lon - 0.005, lat + 0.005, lon + 0.005, lat - 0.005].join(",") });
    const [found] = await (await fetch(`${NOMINATIM}/search?${params}`)).json();
    type = found?.osm_type;
    id = found?.osm_id;
  }
  if (!type || !id) return null;
  const res = await fetch(`https://api.openstreetmap.org/api/0.6/${type}/${id}.json`);
  return res.ok ? (await res.json()).elements[0]?.tags || null : null;
}

// описание из Википедии: статья на языке интерфейса, иначе английская, иначе указанная в OSM
async function wiki(tags) {
  const lang = uiLanguage();
  let site = null, title = null;
  if (tags.wikidata) {
    const res = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(tags.wikidata)}&props=sitelinks&format=json&origin=*`);
    const links = res.ok ? (await res.json()).entities?.[tags.wikidata]?.sitelinks || {} : {};
    site = [lang, "en"].find((l) => links[`${l}wiki`]);
    title = site && links[`${site}wiki`].title;
  }
  if (!title && /^[a-z-]+:/.test(tags.wikipedia || "")) {
    site = tags.wikipedia.slice(0, tags.wikipedia.indexOf(":"));
    title = tags.wikipedia.slice(site.length + 1);
  }
  if (!title) return null;
  const res = await fetch(`https://${site}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
  const s = res.ok ? await res.json() : null;
  return s?.extract ? { text: s.extract, url: s.content_urls?.desktop?.page } : null;
}

// строка со ссылкой (Википедия, сайт)
const linkRow = (href, text) => {
  const row = h("popup-row", "");
  row.append(Object.assign(document.createElement("a"), { href, textContent: text, target: "_blank", rel: "noopener" }));
  return row;
};

export async function featureContent(f) {
  const p = f.properties;
  const name = p[`name:${uiLanguage()}`] || p.name;
  const kind = [kindOf(f), p.ele && `${Math.round(p.ele).toLocaleString("ru")} м`].filter(Boolean).join(" · ");
  const box = document.createElement("div");
  box.append(h("popup-title", name || kind));
  if (name && kind) box.append(h("popup-sub", kind));
  if (!allowed(self())) return box;
  const tags = await withTimeout(osmTags(f).catch(() => null), 2500, null);
  if (!tags) return box;
  const about = await withTimeout(wiki(tags).catch(() => null), 2500, null);
  if (about) {
    box.append(h("popup-wiki", about.text));
    if (about.url) box.append(linkRow(about.url, "Википедия"));
  } else if (tags.description) box.append(h("popup-wiki", tags.description));
  const rows = [
    tags.cuisine && `Кухня: ${tags.cuisine.replace(/;/g, ", ").replace(/_/g, " ")}`,
    tags.opening_hours && `Часы: ${tags.opening_hours}`,
    (tags.phone || tags["contact:phone"]) && `Телефон: ${tags.phone || tags["contact:phone"]}`,
  ].filter(Boolean);
  for (const r of rows) box.append(h("popup-row", r));
  const site = tags.website || tags["contact:website"];
  if (site && /^https?:\/\//.test(site)) box.append(linkRow(site, "Сайт"));
  return box;
}

async function pointContent(lngLat) {
  const lat = lngLat.lat.toFixed(5), lon = lngLat.lng.toFixed(5);
  const box = document.createElement("div");
  const coords = h("popup-coords", `${lat}, ${lon}`, "button");
  coords.title = "Скопировать координаты";
  coords.addEventListener("click", () => {
    navigator.clipboard?.writeText(`${lat}, ${lon}`);
    coords.textContent = "Скопировано";
    setTimeout(() => { coords.textContent = `${lat}, ${lon}`; }, 1500);
  });
  box.append(coords);
  if (allowed(self())) {
    const params = new URLSearchParams({ lat, lon, format: "jsonv2", zoom: "18", "accept-language": uiLanguage() });
    const place = await withTimeout(fetch(`${NOMINATIM}/reverse?${params}`).then((r) => (r.ok ? r.json() : null)).catch(() => null), 1500, null);
    if (place?.display_name) box.append(h("popup-sub", place.display_name));
  }
  return box;
}

export function initPlaceInfo({ map, maplibregl }) {
  let popup = null;
  let click = 0;

  // значок карты в нескольких пикселях от точки
  const hit = ({ x, y }) => map.queryRenderedFeatures([[x - 8, y - 8], [x + 8, y + 8]]).find((f) =>
    f.layer.type === "symbol" && SOURCE_LAYERS.includes(f.sourceLayer) && (f.properties.name || kindOf(f)));
  // точка на поверхности Земли? (мимо глобуса — звёзды): точка, переведённая в координаты и
  // обратно на экран, возвращается на место только если она на шаре
  const onEarth = (pt) => {
    const back = map.project(map.unproject(pt));
    return Math.hypot(back.x - pt.x, back.y - pt.y) < 2;
  };
  const anyOpen = () => popupOpen() || !!document.querySelector(".menu:not([hidden])");

  map.on("click", async (e) => {
    if (e.originalEvent.target !== map.getCanvas() || !onEarth(e.point)) return;
    if (ownHit(map, e.point)) return; // свой значок модуля — у него своё окно
    if (anyOpen()) { closeAll(); return; }
    const f = hit(e.point);
    const n = ++click;
    const content = f ? await featureContent(f) : await pointContent(e.lngLat);
    if (n !== click) return; // пока ждали ответа, щёлкнули ещё раз
    popup?.remove();
    popup = track(new maplibregl.Popup({ offset: f ? 12 : 4, maxWidth: "280px" }))
      .setLngLat(f?.geometry.type === "Point" ? f.geometry.coordinates : e.lngLat)
      .setDOMContent(content).addTo(map);
    emit("place", { lngLat: f?.geometry.type === "Point" ? f.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat], title: f?.properties.name || "" });
  });

  // над тем, о чём щелчок что-то покажет, — стрелка вместо ладони; раз за кадр, не при перетаскивании
  let pending = null;
  map.on("mousemove", (e) => {
    if (e.originalEvent.buttons) return;
    if (!pending) requestAnimationFrame(() => { map.getCanvas().style.cursor = hit(pending) || ownHit(map, pending) ? "default" : ""; pending = null; });
    pending = e.point;
  });
  map.on("mouseout", () => { map.getCanvas().style.cursor = ""; });
}

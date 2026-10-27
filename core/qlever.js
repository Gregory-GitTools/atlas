// QLever — SPARQL по всему OpenStreetMap, без ключа. Отвечает за 8–17 с почти независимо от
// размера квадрата, поэтому модули грузят квадратами по полградуса и больше, одной очередью.
// Тегов не отдаёт — для окна они берутся из OSM API (osmTags). Общий помощник для модулей
// «Значки у троп», «Пляжи», «Сёрфинг» (опыт travel-earth: Overpass не отвечал, QLever — да)
export const QLEVER_URL = "https://qlever.dev/api/osm-planet";

const query = (select, body, w, s, e, n) => `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?osm ?c ?kind ${select} WHERE {
  ${body}
  ?osm geo:hasGeometry/geo:asWKT ?wkt .
  BIND (geof:centroid(?wkt) AS ?c)
  FILTER (geof:latitude(?c) > ${s} && geof:latitude(?c) < ${n} && geof:longitude(?c) > ${w} && geof:longitude(?c) < ${e})
}`;

// точки в рамке: [{ osm: "node/123", coordinates, b — вся строка ответа }]
export async function qleverBox(select, body, [w, s, e, n], timeout = 40000) {
  const res = await fetch(QLEVER_URL, { method: "POST", headers: { Accept: "application/sparql-results+json" },
    body: new URLSearchParams({ query: query(select, body, w, s, e, n) }), signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`QLever: ${res.status}`);
  return (await res.json()).results.bindings.map((b) => ({ b,
    osm: b.osm.value.replace(/^.*\/(node|way|relation)\/(\d+)$/, "$1/$2"),
    coordinates: b.c.value.match(/-?[\d.]+/g).map(Number) }));
}

// квадраты со стороной cell в кадре, не дальше reach градусов от центра, ближние первыми
export function cellsInView(map, cell, reach = 0.5) {
  const c = map.getCenter(), b = map.getBounds();
  const range = (min, max, v) => [Math.floor(Math.max(min, v - reach) / cell), Math.floor(Math.min(max, v + reach) / cell)];
  const [x0, x1] = range(b.getWest(), b.getEast(), c.lng);
  const [y0, y1] = range(b.getSouth(), b.getNorth(), c.lat);
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y, Math.hypot((x + 0.5) * cell - c.lng, (y + 0.5) * cell - c.lat)]);
  return out.sort((a, b2) => a[2] - b2[2]);
}

// загрузчик квадратов: каждый квадрат — один раз, одной очередью; ошибка — повтор через минуту
export function cellLoader(cell, load, onRetry) {
  const state = new Map();
  let queue = Promise.resolve();
  return {
    request(cells) {
      for (const [x, y] of cells) {
        const key = `${x}:${y}`;
        const st = state.get(key);
        if (st === true || st === "loading" || st > Date.now()) continue;
        state.set(key, "loading");
        queue = queue.then(async () => {
          try {
            await load([x * cell, y * cell, (x + 1) * cell, (y + 1) * cell].map((v) => +v.toFixed(3)));
            state.set(key, true);
          } catch {
            state.set(key, Date.now() + 60000);
            setTimeout(onRetry, 60100);
          }
        });
      }
    },
    forgetPending() { for (const [k, v] of state) if (v === "loading") state.delete(k); },
  };
}

export async function osmTags(osm) {
  const res = await fetch(`https://api.openstreetmap.org/api/0.6/${osm}.json`);
  return res.ok ? (await res.json()).elements[0]?.tags || null : null;
}

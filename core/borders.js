// Страна точки — по границам стран, без сети после первой загрузки (country-borders.json travel-earth).
// Общее для альбомов и списка «Куда» (Грегори 2026-11-13: «маршруты — по странам с флажками, как в альбомах»)
import { repoSite } from "./repo.js";

let borders = null;
const loadBorders = () => (borders ??= fetch(repoSite("country-borders.json")).then((r) => r.json()).then((d) => d.features)
  .catch(() => { borders = null; return []; }));
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (pt, rings) => inRing(pt, rings[0]) && !rings.slice(1).some((r) => inRing(pt, r));
function featureAt(pt, features) {
  const polys = (f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);
  const hit = features.find((f) => polys(f).some((rings) => inPolygon(pt, rings)));
  if (hit) return hit;
  // упрощённая граница не накрывает берег (Лиссабон в устье Тежу) — страна с ближайшей вершиной
  let best = null, dist = Infinity;
  for (const f of features) for (const rings of polys(f)) for (const ring of rings) for (const v of ring) {
    const d = (v[0] - pt[0]) ** 2 + (v[1] - pt[1]) ** 2;
    if (d < dist) { dist = d; best = f; }
  }
  return dist < 1 ? best : null;
}
// [lng, lat] → { name, iso }, null — не в стране (море), undefined — границы не загрузились (спросить позже)
export async function countryAt(pt) {
  const features = await loadBorders();
  if (!features.length) return undefined;
  const f = pt && featureAt(pt, features);
  return f ? { name: f.properties.name, iso: f.properties.iso } : null;
}

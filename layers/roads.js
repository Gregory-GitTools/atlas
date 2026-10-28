// Дороги (Грегори, 2026-10-28: «можно сделать слой автомобильных дорог?») — поверх подложки, цвет
// по классу: автомагистрали красные, скоростные оранжевые, главные жёлтые, второстепенные зелёные,
// местные синие, грунтовки коричневые. Без покрытия (surface=unpaved) — пунктиром, тоннели —
// полупрозрачным пунктиром. Данные — те же векторные тайлы OpenFreeMap, что у мест и железных дорог.
// Виды (Автомагистрали, Главные, Местные, Грунтовые) — кнопками в меню «Слои», можно несколько; выбор помнится
import { register } from "../core/modules.js";
import { profileMenu } from "../core/profiles.js";

const svg = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${inner}</svg>`;
const COLORS = ["match", ["get", "class"], "motorway", "#d32f2f", "trunk", "#f57c00", "primary", "#f9a825", "secondary", "#7cb342",
  "tertiary", "#039be5", "minor", "#5c6bc0", "track", "#8d6e63", "#78909c"];
// толщина: класс × зум (зум в MapLibre — только на верхнем уровне выражения)
const K = ["match", ["get", "class"], "motorway", 1.6, "trunk", 1.4, "primary", 1.2, "secondary", 1, "tertiary", 0.85, 0.6];
const WIDTH = ["interpolate", ["exponential", 1.5], ["zoom"], 5, ["*", K, 0.6], 10, ["*", K, 1.6], 14, ["*", K, 3], 18, ["*", K, 9]];
const SORT = ["match", ["get", "class"], "motorway", 7, "trunk", 6, "primary", 5, "secondary", 4, "tertiary", 3, "minor", 2, 1];

// виды не пересекаются; цвет вида — цвет его линий (кольцо вокруг значка в меню «Слои»)
const CAR = svg('<path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>');
const PROFILES = [
  { id: "highways", name: "Автомагистрали", color: "#d32f2f", classes: ["motorway", "trunk"] },
  { id: "main", name: "Главные", color: "#f9a825", classes: ["primary", "secondary"] },
  { id: "local", name: "Местные", color: "#039be5", classes: ["tertiary", "minor"] },
  { id: "unpaved", name: "Грунтовые", color: "#8d6e63", classes: ["primary", "secondary", "tertiary", "minor", "track"], unpaved: true },
].map((p) => ({ ...p, icon: CAR }));
const prof = profileMenu("roads.profile", PROFILES, "Дороги");
const UNPAVED = ["any", ["==", ["get", "surface"], "unpaved"], ["==", ["get", "class"], "track"]];
const TUNNEL = ["==", ["get", "brunnel"], "tunnel"];

// три слоя: тоннели (полупрозрачный пунктир), с покрытием, грунтовые (пунктир)
// отмеченные виды — дорога подходит под любой
const layers = (parts) => {
  const base = ["any", ...parts.map((p) => ["all", ["in", ["get", "class"], ["literal", p.classes]], ...(p.unpaved ? [UNPAVED] : [])])];
  return [
    { id: "road-tunnel", filter: ["all", base, TUNNEL], opacity: 0.45, dash: [2, 1.5] },
    { id: "road", filter: ["all", base, ["!", TUNNEL], ["!", UNPAVED]], opacity: 0.9 },
    { id: "road-unpaved", filter: ["all", base, ["!", TUNNEL], UNPAVED], opacity: 0.9, dash: [2.5, 1.2] },
  ];
};

register({
  id: "layers/roads",
  kind: "layer",
  group: "roads",
  title: "Дороги",
  hint: "Автомобильные дороги цветом по классу, грунтовые — пунктиром",
  icon: CAR,
  needs: ["network"],
  sends: "район карты (OpenFreeMap)",
  menu: prof.menu,
  // повторное включение — смена вида: слои остаются, меняется фильтр
  enable({ map }) {
    if (!map.getSource("road-tiles")) map.addSource("road-tiles", { type: "vector", url: "https://tiles.openfreemap.org/planet" });
    const before = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    for (const l of layers(prof.selected())) {
      if (map.getLayer(l.id)) { map.setFilter(l.id, l.filter); continue; }
      map.addLayer({ id: l.id, type: "line", source: "road-tiles", "source-layer": "transportation", minzoom: 4, filter: l.filter,
        layout: { "line-cap": l.dash ? "butt" : "round", "line-join": "round", "line-sort-key": SORT },
        paint: { "line-color": COLORS, "line-opacity": l.opacity, "line-width": WIDTH, ...(l.dash && { "line-dasharray": l.dash }) } }, before);
    }
  },
  disable({ map }) {
    for (const l of layers(prof.selected())) if (map.getLayer(l.id)) map.removeLayer(l.id);
  },
});

// Пример модуля-слоя: рельеф (тени склонов) из AWS Terrain Tiles. Образец для всех следующих слоёв
import { register } from "../core/modules.js";

const SOURCE = "terrain-dem";
const LAYER = "terrain-hillshade";

register({
  id: "layers/terrain",
  kind: "layer",
  title: "Рельеф",
  icon: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z"/></svg>`,
  needs: ["network"],
  sends: "район карты",
  enable({ map }) {
    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 15,
      });
    }
    const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    map.addLayer({ id: LAYER, type: "hillshade", source: SOURCE, paint: { "hillshade-exaggeration": 0.4 } }, firstSymbol);
  },
  disable({ map }) {
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
  },
});

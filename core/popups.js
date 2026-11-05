// Окна на карте (MapLibre Popup) — общий учёт. Правило travel-earth: любое окно на карте
// закрывается, как только карта начала двигаться; первый щелчок по карте при открытом окне только
// закрывает его. Модуль, открывший окно, отдаёт его в track() — дальше всё само
const open = new Set();
// дополнения ко всем окнам (кнопка «Сюда» из route.js) — когда окно открылось
const decorators = new Set();
export const decoratePopups = (fn) => decorators.add(fn);

export function track(popup) {
  open.add(popup);
  popup.on("close", () => open.delete(popup));
  popup.on("open", () => decorators.forEach((fn) => fn(popup)));
  return popup;
}

export const anyOpen = () => [...open].some((p) => p.isOpen());

export function closeAll() {
  for (const p of [...open]) if (p.isOpen()) p.remove();
}

export function initPopups(map) {
  // кроме того, как навигация ведёт карту за мной (каждый замер GPS) — иначе окно не успеть прочитать
  map.on("movestart", (e) => { if (!e.navFollow) closeAll(); });
}

// Свои кликабельные слои модулей (флажки мест, значки экскурсий…): щелчок по ним обрабатывает сам
// модуль, общее «окно места» по такому щелчку не открывается
const own = new Set();
export const claimLayers = (...ids) => ids.forEach((id) => own.add(id));
export const ownHit = (map, point) => {
  const layers = [...own].filter((id) => map.getLayer(id));
  return layers.length > 0 && map.queryRenderedFeatures(point, { layers }).length > 0;
};

// Модуль забрал щелчки по карте себе (рисование трека): окно места не открывается, пока не отпустит
let captured = null;
export const captureClicks = (owner) => { captured = owner; };
export const clicksCaptured = () => !!captured;

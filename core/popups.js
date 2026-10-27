// Окна на карте (MapLibre Popup) — общий учёт. Правило travel-earth: любое окно на карте
// закрывается, как только карта начала двигаться; первый щелчок по карте при открытом окне только
// закрывает его. Модуль, открывший окно, отдаёт его в track() — дальше всё само
const open = new Set();

export function track(popup) {
  open.add(popup);
  popup.on("close", () => open.delete(popup));
  return popup;
}

export const anyOpen = () => [...open].some((p) => p.isOpen());

export function closeAll() {
  for (const p of [...open]) if (p.isOpen()) p.remove();
}

export function initPopups(map) {
  map.on("movestart", closeAll);
}

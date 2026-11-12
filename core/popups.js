// Окна на карте (MapLibre Popup) — общий учёт. Правило travel-earth: любое окно на карте
// закрывается, как только карта начала двигаться; первый щелчок по карте при открытом окне только
// закрывает его. Модуль, открывший окно, отдаёт его в track() — дальше всё само
const open = new Set();
// дополнения ко всем окнам (кнопка «Сюда» из route.js) — когда окно открылось
const decorators = new Set();
export const decoratePopups = (fn) => decorators.add(fn);

export function track(popup) {
  open.add(popup);
  let watch = null;
  popup.on("close", () => { open.delete(popup); watch?.disconnect(); });
  popup.on("open", () => {
    decorators.forEach((fn) => fn(popup));
    // окно целиком на экране (Грегори 2026-11-06: «„Сюда“ иногда убегает за край телефона»): выросло
    // (пришёл адрес, добавилась кнопка) и не влезает — карта чуть сдвигается, окно от этого не закрывается
    const el = popup.getElement();
    if (!el || !popup._map) return;
    watch = new ResizeObserver(() => requestAnimationFrame(() => keepOnScreen(popup)));
    watch.observe(el);
  });
  return popup;
}

const EDGE = 8;
function keepOnScreen(popup) {
  const map = popup._map, el = popup.getElement();
  if (!map || !el?.isConnected) return;
  const r = el.getBoundingClientRect(), m = map.getContainer().getBoundingClientRect();
  // свободная часть карты: не под барабаном справа и не под строкой поиска (Грегори 2026-11-11: окно должно
  // позволять себя закрыть — крестик уходил под кнопки барабана)
  const c = { left: m.left, right: m.right, top: m.top, bottom: m.bottom };
  const wheel = [...document.querySelectorAll(".wheel:not(.closed)")].map((w) => w.getBoundingClientRect()).find((w) => w.width > 0);
  if (wheel && wheel.left - c.left > r.width + 2 * EDGE) c.right = Math.min(c.right, wheel.left);
  const bar = !document.body.classList.contains("search-hidden") && document.querySelector(".search-box")?.getBoundingClientRect();
  if (bar && bar.height && c.bottom - bar.bottom > r.height + 2 * EDGE) c.top = Math.max(c.top, bar.bottom);
  // нижние полосы поверх карты (время прогноза ветра) — окно над ними
  for (const b of document.querySelectorAll("[data-keep-clear]:not([hidden])")) {
    const q = b.getBoundingClientRect();
    if (q.height && q.top - c.top > r.height + 2 * EDGE) c.bottom = Math.min(c.bottom, q.top);
  }
  const dx = r.left < c.left + EDGE ? r.left - c.left - EDGE : r.right > c.right - EDGE ? Math.min(r.right - c.right + EDGE, r.left - c.left - EDGE) : 0;
  const dy = r.top < c.top + EDGE ? r.top - c.top - EDGE : r.bottom > c.bottom - EDGE ? Math.min(r.bottom - c.bottom + EDGE, r.top - c.top - EDGE) : 0;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) map.panBy([dx, dy], { duration: 250 }, { navFollow: true });
}

export const anyOpen = () => [...open].some((p) => p.isOpen());

export function closeAll() {
  for (const p of [...open]) if (p.isOpen()) p.remove();
}

// Esc закрывает окно на карте (Грегори 2026-11-10: «оставить — щелчок в сторону или Esc») — раньше прочих
// (core/back.js): сначала окно, следующий Esc — то, что под ним
addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || !anyOpen()) return;
  e.preventDefault();
  closeAll();
}, true);

export function initPopups(map) {
  // кроме того, как навигация ведёт карту за мной (каждый замер GPS) — иначе окно не успеть прочитать
  map.on("movestart", (e) => { if (!e.navFollow) closeAll(); });
}

// Свои кликабельные слои модулей (флажки мест, значки экскурсий…): щелчок по ним обрабатывает сам
// модуль, общее «окно места» по такому щелчку не открывается
const own = new Set();
export const claimLayers = (...ids) => ids.forEach((id) => own.add(id));
// except — свои слои, которые не считать (стрелка ветра уступает значку спота под ней)
export const ownHit = (map, point, except = []) => {
  const layers = [...own].filter((id) => map.getLayer(id) && !except.includes(id));
  return layers.length > 0 && map.queryRenderedFeatures(point, { layers }).length > 0;
};

// Модуль забрал щелчки по карте себе (рисование трека): окно места не открывается, пока не отпустит
let captured = null;
export const captureClicks = (owner) => { captured = owner; };
export const clicksCaptured = () => !!captured;

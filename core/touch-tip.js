// Подсказки на телефоне (Грегори 2026-11-05): на компьютере у кнопок всплывает title при наведении, на
// телефоне наведения нет — долгое нажатие (полсекунды, палец не сдвинулся) показывает ту же подпись над
// кнопкой. Само нажатие тогда не срабатывает: подержал — прочитал, отпустил — ничего не случилось
const HOLD = 700, MOVE = 10; // дольше обычного нажатия — подпись не выскакивает от простого касания
let tip = null, timer = null, start = null, shown = 0;

const hide = () => { tip?.remove(); tip = null; };

const show = (el) => {
  const text = el.getAttribute("title");
  if (!text) return;
  hide();
  tip = Object.assign(document.createElement("div"), { className: "touch-tip", textContent: text });
  document.body.append(tip);
  const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
  const left = Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
  const top = r.top - t.height - 10 >= 8 ? r.top - t.height - 10 : r.bottom + 10;
  Object.assign(tip.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
  shown = Date.now();
  setTimeout(() => shown && Date.now() - shown >= 2400 && hide(), 2500);
};

addEventListener("touchstart", (e) => {
  hide();
  shown = 0;
  clearTimeout(timer);
  const el = e.target.closest?.("button[title], .btn[title]");
  if (!el || e.touches.length > 1) return;
  start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  timer = setTimeout(() => show(el), HOLD);
}, { passive: true, capture: true });

addEventListener("touchmove", (e) => {
  if (!start) return;
  const p = e.touches[0];
  if (Math.hypot(p.clientX - start.x, p.clientY - start.y) > MOVE) { clearTimeout(timer); start = null; }
}, { passive: true, capture: true });

addEventListener("touchend", () => { clearTimeout(timer); start = null; }, { capture: true });
addEventListener("touchcancel", () => { clearTimeout(timer); start = null; hide(); }, { capture: true });

// подсказку показали — щелчок от этого же нажатия не нужен, и меню «копировать/открыть» тоже
const swallow = (e) => { if (shown && Date.now() - shown < 1500) { e.preventDefault(); e.stopPropagation(); } };
addEventListener("click", (e) => { swallow(e); if (shown) shown = Date.now() - 1500; }, { capture: true });
addEventListener("contextmenu", swallow, { capture: true });

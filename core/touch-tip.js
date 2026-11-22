// Подсказки на телефоне (Грегори 2026-11-05): на компьютере у кнопок всплывает title при наведении, на
// телефоне наведения нет — долгое нажатие (полсекунды, палец не сдвинулся) показывает ту же подпись над
// кнопкой. Само нажатие тогда не срабатывает: подержал — прочитал, отпустил — ничего не случилось
const HOLD = 700, MOVE = 10; // дольше обычного нажатия — подпись не выскакивает от простого касания
let tip = null, timer = null, start = null, shown = 0;

const hide = () => { tip?.remove(); tip = null; };

const show = (el) => {
  if (!start) return; // палец уже отпустили
  const text = el.getAttribute("title");
  // кнопку за это время убрали или спрятали (нажатие свернуло окно) — подписи нет: иначе она вылезала
  // в левом верхнем углу поверх строки поиска («Свернуть», Грегори 2026-11-06)
  const box = el.getBoundingClientRect();
  if (!text || !el.isConnected || !box.width || !box.height) return;
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

// компьютер: подпись любой кнопки — сразу при наведении мыши, мышь ушла — сразу гаснет (Грегори 2026-11-22:
// «универсальное решение для всех кнопок»); вид — как подписи карусели («везде кнопки подписываем как на карусели»). Своя вместо title браузера — тот всплывает через секунду и гаснет
// не сразу; title на время наведения переезжает в data-tip. Сбоку от кнопки: справа на экране — слева от неё
let hoverEl = null, hoverTip = null;
const hoverOff = () => {
  if (hoverEl) { if (!hoverEl.hasAttribute("title")) hoverEl.setAttribute("title", hoverEl.dataset.tip); delete hoverEl.dataset.tip; hoverEl = null; }
  const t = hoverTip;
  hoverTip = null;
  if (t) { t.classList.remove("on"); setTimeout(() => t.remove(), 300); }
};
addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse") return;
  const el = e.target.closest?.("button[title], .btn[title], button[data-tip], .btn[data-tip]");
  if (el === hoverEl) return;
  hoverOff();
  const text = el?.getAttribute("title");
  if (!text) return;
  hoverEl = el;
  el.dataset.tip = text;
  el.removeAttribute("title");
  const t = (hoverTip = Object.assign(document.createElement("div"), { className: "touch-tip hover-tip", textContent: text }));
  document.body.append(t);
  const r = el.getBoundingClientRect(), s = t.getBoundingClientRect();
  const left = r.left + r.width / 2 > innerWidth / 2 ? r.left - s.width - 10 : r.right + 10;
  const top = r.top + r.height / 2 - s.height / 2;
  Object.assign(t.style, { left: `${Math.round(Math.max(8, Math.min(innerWidth - s.width - 8, left)))}px`, top: `${Math.round(Math.max(8, Math.min(innerHeight - s.height - 8, top)))}px` });
  requestAnimationFrame(() => t.classList.add("on"));
}, { capture: true });
addEventListener("pointerout", (e) => { if (hoverEl && !hoverEl.contains(e.relatedTarget)) hoverOff(); }, { capture: true });
// кнопку под мышью убрали или спрятали (перерисовали барабан) — подпись не остаётся висеть
addEventListener("pointermove", () => { if (hoverEl && (!hoverEl.isConnected || !hoverEl.getClientRects().length)) hoverOff(); }, { capture: true, passive: true });
addEventListener("wheel", () => hoverOff(), { capture: true, passive: true });
addEventListener("pointerdown", () => hoverOff(), { capture: true });

// подсказку показали — щелчок от этого же нажатия не нужен, и меню «копировать/открыть» тоже
const swallow = (e) => { if (shown && Date.now() - shown < 1500) { e.preventDefault(); e.stopPropagation(); } };
addEventListener("click", (e) => { swallow(e); if (shown) shown = Date.now() - 1500; }, { capture: true });
addEventListener("contextmenu", swallow, { capture: true });

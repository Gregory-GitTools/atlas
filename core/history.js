// История — список недавнего с перетаскиванием и удалением (поиск мест, точки навигации; Грегори
// 2026-11-04: «историю маршрутов — по примеру истории поиска, каждую запись подвинуть или удалить»).
// Сверху — заголовок со стрелкой «свернуть» (свёрнутость помнится) и «Очистить». Строки тянутся за
// ручку слева (указателем — HTML5-перетаскивание на телефоне не работает): соседи перепрыгивают через
// строку, сама строка остаётся под пальцем; порядок — своё избранное, он и сохраняется.
// Список хранится в settings (key), записи узнаются по id(e)
import * as settings from "./settings.js";

const CLEAR = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const DRAG = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-6 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 16a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>`;
const CHEVRON = `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>`;

export const loadList = (key) => settings.get(key, []);
export const saveList = (key, list) => settings.set(key, list.length ? list : null);
// новое — наверх; уже известное остаётся на своём месте (избранное не перемешивается)
export function remember(key, entry, id, size = 20) {
  const list = loadList(key);
  if (!list.some((e) => id(e) === id(entry))) saveList(key, [entry, ...list].slice(0, size));
}

// key — где хранится; title — заголовок; id(e) — чем записи различаются; label(e) → { title, sub };
// pick(e) — щелчок; changed() — список стал другим (перерисовать)
export function historyList({ key, title, id, label, pick, changed }) {
  const box = Object.assign(document.createElement("div"), { className: "history" });
  const list = loadList(key);
  if (!list.length) return box;
  const folded = !!settings.get(`${key}.fold`);
  const head = Object.assign(document.createElement("div"), { className: "history-head" });
  const fold = Object.assign(document.createElement("button"), { type: "button", className: "history-fold" + (folded ? " folded" : ""),
    title: folded ? "Развернуть историю" : "Свернуть историю", innerHTML: `<span></span>${CHEVRON}` });
  fold.firstChild.textContent = `${title} (${list.length})`;
  fold.addEventListener("click", (e) => { e.stopPropagation(); settings.set(`${key}.fold`, folded ? null : true); changed(); });
  const clear = Object.assign(document.createElement("button"), { type: "button", className: "history-clear", textContent: "Очистить" });
  clear.addEventListener("click", (e) => { e.stopPropagation(); saveList(key, []); changed(); });
  head.append(fold, clear);
  box.append(head);
  if (folded) return box;

  const rows = Object.assign(document.createElement("div"), { className: "history-rows" });
  for (const entry of list) {
    const row = Object.assign(document.createElement("div"), { className: "search-history-row" });
    row.entry = entry;
    const handle = Object.assign(document.createElement("span"), { className: "search-drag", title: "Перетащить выше или ниже", innerHTML: DRAG });
    handle.addEventListener("pointerdown", (e) => drag(e, row));
    const { title: t, sub } = label(entry);
    const b = Object.assign(document.createElement("button"), { type: "button", className: "search-item" });
    b.innerHTML = `<span class="search-item-title"></span><span class="search-item-sub"></span>`;
    b.firstChild.textContent = t;
    b.lastChild.textContent = sub || "";
    b.addEventListener("click", () => pick(entry));
    const del = Object.assign(document.createElement("button"), { type: "button", className: "search-delete", title: "Удалить из истории", innerHTML: CLEAR });
    del.addEventListener("click", (e) => {
      e.stopPropagation(); // список перерисуется — щелчок не должен считаться «мимо»
      saveList(key, loadList(key).filter((x) => id(x) !== id(entry)));
      changed();
    });
    row.append(handle, b, del);
    rows.append(row);
  }
  box.append(rows);

  function drag(e, row) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const isRow = (n) => n?.classList?.contains("search-history-row");
    handle.setPointerCapture(e.pointerId);
    row.classList.add("dragging");
    const move = (ev) => {
      const { top, bottom } = row.getBoundingClientRect();
      if (ev.clientY < top && isRow(row.previousElementSibling)) rows.insertBefore(row.previousElementSibling, row.nextElementSibling);
      else if (ev.clientY > bottom && isRow(row.nextElementSibling)) rows.insertBefore(row.nextElementSibling, row);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      row.classList.remove("dragging");
      saveList(key, [...rows.children].map((r) => r.entry));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  return box;
}

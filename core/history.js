// История — список недавнего с перетаскиванием и удалением (поиск мест, точки навигации; Грегори
// 2026-11-04: «историю маршрутов — по примеру истории поиска, каждую запись подвинуть или удалить»).
// Строки тянутся за ручку слева (указателем — HTML5-перетаскивание на телефоне не работает): соседи
// перепрыгивают через строку, сама строка остаётся под пальцем; порядок — своё избранное, он и
// сохраняется. Внизу — «Очистить историю». Свернуть и развернуть список — щелчок по строке поиска
// (Грегори 2026-11-04: вместо кнопок «История поиска» и «свернуть»).
// Список хранится в settings (key), записи узнаются по id(e)
import * as settings from "./settings.js";

const CLEAR = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
const EDIT = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z"/></svg>`;
const DRAG = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-6 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 16a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>`;

export const loadList = (key) => settings.get(key, []);
export const saveList = (key, list) => settings.set(key, list.length ? list : null);
// новое — наверх; уже известное остаётся на своём месте (избранное не перемешивается)
export function remember(key, entry, id, size = 20) {
  const list = loadList(key);
  if (!list.some((e) => id(e) === id(entry))) saveList(key, [entry, ...list].slice(0, size));
}

// key — где хранится; id(e) — чем записи различаются; label(e) → { title, sub }; pick(e) — щелчок;
// changed() — список стал другим (перерисовать). Пусто — пустой узел
// match(e) — показать только подходящие (набирают текст — подсказки из уже найденного)
// rename(e, title) → новая запись: у строки карандаш — переименовать прямо в строке (Грегори 2026-11-09);
// label может вернуть icon — значок перед названием (сохранённый маршрут)
export function historyList({ key, id, label, pick, changed, match, rename }) {
  const box = Object.assign(document.createElement("div"), { className: "history" });
  const list = loadList(key).filter((e) => !match || match(e));
  if (!list.length) return box;
  const rows = Object.assign(document.createElement("div"), { className: "history-rows" });
  for (const entry of list) {
    const row = Object.assign(document.createElement("div"), { className: "search-history-row" });
    row.entry = entry;
    const handle = Object.assign(document.createElement("span"), { className: "search-drag", title: "Перетащить выше или ниже", innerHTML: DRAG });
    handle.addEventListener("pointerdown", (e) => drag(e, row));
    const { title: t, sub, icon } = label(entry);
    const b = Object.assign(document.createElement("button"), { type: "button", className: "search-item" });
    b.innerHTML = `<span class="search-item-title"></span><span class="search-item-sub"></span>`;
    b.firstChild.textContent = t;
    if (icon) b.firstChild.insertAdjacentHTML("afterbegin", `<i class="history-icon">${icon}</i>`);
    b.lastChild.textContent = sub || "";
    b.addEventListener("click", () => pick(entry));
    const del = Object.assign(document.createElement("button"), { type: "button", className: "search-delete", title: "Удалить из истории", innerHTML: CLEAR });
    del.addEventListener("click", (e) => {
      e.stopPropagation(); // список перерисуется — щелчок не должен считаться «мимо»
      saveList(key, loadList(key).filter((x) => id(x) !== id(entry)));
      changed();
    });
    const edit = rename && Object.assign(document.createElement("button"), { type: "button", className: "search-delete search-rename", title: "Переименовать", innerHTML: EDIT });
    edit?.addEventListener("click", (e) => {
      e.stopPropagation();
      const input = Object.assign(document.createElement("input"), { type: "text", className: "history-rename", value: t });
      b.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (keep) => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (keep && v && v !== t) saveList(key, loadList(key).map((x) => (id(x) === id(entry) ? rename(x, v) : x)));
        changed();
      };
      input.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") finish(true); else if (ev.key === "Escape") { ev.preventDefault(); finish(false); } });
      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("blur", () => finish(true));
    });
    row.append(handle, b, ...(edit ? [edit] : []), del);
    rows.append(row);
  }
  const clear = Object.assign(document.createElement("button"), { type: "button", className: "search-history-clear", textContent: "Очистить историю" });
  clear.addEventListener("click", (e) => { e.stopPropagation(); saveList(key, []); changed(); });
  box.append(rows, clear);

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
      // показаны не все (набран текст) — переставленные встают на места показанных, остальные не трогаются
      const moved = [...rows.children].map((r) => r.entry), shown = new Set(moved.map(id));
      saveList(key, loadList(key).map((e) => (shown.has(id(e)) ? moved.shift() : e)));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  return box;
}

// История — список недавнего с перетаскиванием и удалением (поиск мест, точки навигации; Грегори
// 2026-11-04: «историю маршрутов — по примеру истории поиска, каждую запись подвинуть или удалить»).
// Строки тянутся за ручку слева (указателем — HTML5-перетаскивание на телефоне не работает): соседи
// перепрыгивают через строку, сама строка остаётся под пальцем; порядок — своё избранное, он и
// сохраняется. Внизу — «Очистить историю». Свернуть и развернуть список — щелчок по строке поиска
// (Грегори 2026-11-04: вместо кнопок «История поиска» и «свернуть»).
// Список хранится в settings (key), записи узнаются по id(e)
import * as settings from "./settings.js";

const CLEAR = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
// долгое нажатие на строку — переименовать (полсекунды, палец не сдвинулся)
const HOLD = 500, MOVE = 10;
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
// rename(e, title) → новая запись: долгое нажатие на строку — переименовать прямо в строке (Грегори 2026-11-09;
// 2026-11-13: «убираем карандаш и делаем редактирование на долгий тап»);
// label может вернуть icon — значок перед названием (сохранённый маршрут)
// load/save — свой список вместо settings (точки маршрута: Грегори 2026-11-10 — «такая же панель, как
// история поиска»); clear: false — без «Очистить историю»
export function historyList({ key, id, label, pick, changed, match, rename, load, save, clear: withClear = true }) {
  const get = load || (() => loadList(key)), put = save || ((l) => saveList(key, l));
  const box = Object.assign(document.createElement("div"), { className: "history" });
  const list = get().filter((e) => !match || match(e));
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
    let held = false;
    b.addEventListener("click", () => { if (held) held = false; else pick(entry); });
    const del = Object.assign(document.createElement("button"), { type: "button", className: "search-delete", title: "Удалить из истории", innerHTML: CLEAR });
    del.addEventListener("click", (e) => {
      e.stopPropagation(); // список перерисуется — щелчок не должен считаться «мимо»
      put(get().filter((x) => id(x) !== id(entry)));
      changed();
    });
    const edit = () => {
      held = true;
      const input = Object.assign(document.createElement("input"), { type: "text", className: "history-rename", value: t });
      b.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (keep) => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (keep && v && v !== t) put(get().map((x) => (id(x) === id(entry) ? rename(x, v) : x)));
        changed();
      };
      input.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") finish(true); else if (ev.key === "Escape") { ev.preventDefault(); finish(false); } });
      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("blur", () => finish(true));
    };
    if (rename) {
      let timer = 0, at = null;
      const stop = () => { clearTimeout(timer); at = null; };
      b.addEventListener("pointerdown", (e) => {
        if (e.button) return;
        held = false;
        at = [e.clientX, e.clientY];
        timer = setTimeout(() => { at = null; edit(); }, HOLD);
      });
      b.addEventListener("pointermove", (e) => { if (at && Math.hypot(e.clientX - at[0], e.clientY - at[1]) > MOVE) stop(); });
      for (const t of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(t, stop);
      b.addEventListener("contextmenu", (e) => e.preventDefault()); // на телефоне — без меню «копировать»
    }
    row.append(handle, b, del);
    rows.append(row);
  }
  const clear = Object.assign(document.createElement("button"), { type: "button", className: "search-history-clear", textContent: "Очистить историю" });
  clear.addEventListener("click", (e) => { e.stopPropagation(); put([]); changed(); });
  box.append(rows, ...(withClear ? [clear] : []));

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
      const before = get().map(id).join("|"), after = get().map((e) => (shown.has(id(e)) ? moved.shift() : e));
      if (after.map(id).join("|") !== before) put(after);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  return box;
}

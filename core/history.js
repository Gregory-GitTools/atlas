// История — список недавнего с перетаскиванием и удалением (поиск мест, точки навигации; Грегори
// 2026-11-04: «историю маршрутов — по примеру истории поиска, каждую запись подвинуть или удалить»).
// Строки тянутся за ручку слева (указателем — HTML5-перетаскивание на телефоне не работает): соседи
// перепрыгивают через строку, сама строка остаётся под пальцем; порядок — своё избранное, он и
// сохраняется. Свернуть и развернуть список — щелчок по строке поиска (Грегори 2026-11-04: вместо
// кнопок «История поиска» и «свернуть»).
// historyPanel — окно истории целиком, одно на поиск и «Куда» (Грегори 2026-11-21: «привести панели
// Поиска и Навигации к одному виду»): шапка (название, «по странам», экспорт, корзина, свернуть, закрыть),
// значки записей и свои группы — удержание ручки строки открывает таблицу значков
// Список хранится в settings (key), записи узнаются по id(e)
import * as settings from "./settings.js";
import { countryAt } from "./borders.js";
import { flagUrl } from "./flags.js";

const CLEAR = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
// долгое нажатие на строку — переименовать, на ручку — значок и группа (полсекунды, палец не сдвинулся)
const HOLD = 500, MOVE = 10;
const DRAG = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-6 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 16a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>`;

export const loadList = (key) => settings.get(key, []);
export const saveList = (key, list) => settings.set(key, list.length ? list : null);
// новое — наверх; уже известное остаётся на своём месте (избранное не перемешивается); лишнее уходит снизу,
// но своё (со значком или в группе) не вытесняется
export function remember(key, entry, id, size = 20) {
  const list = loadList(key);
  if (list.some((e) => id(e) === id(entry))) return;
  const next = [entry, ...list];
  for (let i = next.length - 1; next.length > size && i > 0; i--) if (!next[i].icon && !next[i].group) next.splice(i, 1);
  saveList(key, next);
}

// key — где хранится; id(e) — чем записи различаются; label(e) → { title, sub }; pick(e) — щелчок;
// changed() — список стал другим (перерисовать). Пусто — пустой узел
// match(e) — показать только подходящие (набирают текст — подсказки из уже найденного)
// rename(e, title) → новая запись: долгое нажатие на строку — переименовать прямо в строке (Грегори 2026-11-09;
// 2026-11-13: «убираем карандаш и делаем редактирование на долгий тап»);
// label может вернуть icon — значок перед названием (сохранённый маршрут)
// load/save — свой список вместо settings (точки маршрута: Грегори 2026-11-10 — «такая же панель, как
// история поиска»)
// items — свои строки вместо списка: записи и группы { group, members, label, pick(), rename(name), remove() }
// (группа перетаскивается вместе со всеми своими); hold(item) — ручку подержали, не двигая
export function historyList({ key, id, label, pick, changed, match, rename, load, save, items, hold }) {
  const get = load || (() => loadList(key)), put = save || ((l) => saveList(key, l));
  const box = Object.assign(document.createElement("div"), { className: "history" });
  const list = items || get().filter((e) => !match || match(e));
  if (!list.length) return box;
  const rows = Object.assign(document.createElement("div"), { className: "history-rows" });
  for (const item of list) {
    const g = item.members ? item : null; // у записи в группе тоже есть group — это номер группы
    const row = Object.assign(document.createElement("div"), { className: g ? "search-history-row history-group-row" : "search-history-row" });
    if (g) row.group = g.group; else row.entry = item;
    row.item = item;
    const handle = Object.assign(document.createElement("span"), { className: "search-drag", title: hold ? "Перетащить; подержать — значок и группа" : "Перетащить выше или ниже", innerHTML: DRAG });
    handle.addEventListener("pointerdown", (e) => drag(e, row));
    handle.addEventListener("contextmenu", (e) => e.preventDefault());
    const { title: t, sub, icon } = g ? g.label : label(item);
    const b = Object.assign(document.createElement("button"), { type: "button", className: "search-item" });
    b.innerHTML = `<span class="search-item-title"></span><span class="search-item-sub"></span>`;
    b.firstChild.textContent = t;
    if (icon) b.firstChild.insertAdjacentHTML("afterbegin", `<i class="history-icon">${icon}</i>`);
    b.lastChild.textContent = sub || "";
    let held = false;
    b.addEventListener("click", () => { if (held) held = false; else if (g) g.pick(); else pick(item); });
    const del = Object.assign(document.createElement("button"), { type: "button", className: "search-delete", title: g ? "Разгруппировать (места останутся)" : "Удалить из истории", innerHTML: CLEAR });
    del.addEventListener("click", (e) => {
      e.stopPropagation(); // список перерисуется — щелчок не должен считаться «мимо»
      if (g) g.remove(); else put(get().filter((x) => id(x) !== id(item)));
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
        if (keep && v && v !== t) { if (g) g.rename(v); else put(get().map((x) => (id(x) === id(item) ? rename(x, v) : x))); }
        changed();
      };
      input.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") finish(true); else if (ev.key === "Escape") { ev.preventDefault(); finish(false); } });
      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("blur", () => finish(true));
    };
    if (rename || g) {
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
  box.append(rows);

  // ручка: потянули — строка едет; подержали на месте — hold (значок и группа)
  function drag(e, row) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const isRow = (n) => n?.classList?.contains("search-history-row");
    try { handle.setPointerCapture(e.pointerId); } catch { /* не настоящий указатель */ }
    row.classList.add("dragging");
    const at = [e.clientX, e.clientY];
    let still = true;
    const timer = hold && setTimeout(() => { if (still) { end(); hold(row.item); } }, HOLD);
    const move = (ev) => {
      if (Math.hypot(ev.clientX - at[0], ev.clientY - at[1]) > MOVE) still = false;
      const { top, bottom } = row.getBoundingClientRect();
      if (ev.clientY < top && isRow(row.previousElementSibling)) rows.insertBefore(row.previousElementSibling, row.nextElementSibling);
      else if (ev.clientY > bottom && isRow(row.nextElementSibling)) rows.insertBefore(row.nextElementSibling, row);
    };
    const end = () => {
      clearTimeout(timer);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      row.classList.remove("dragging");
      // показаны не все (набран текст, одна страна) — переставленные встают на места показанных, остальные не
      // трогаются; группа — всеми своими записями
      const moved = [...rows.children].flatMap((r) => (r.group ? r.item.members : [r.item])), shown = new Set(moved.map(id));
      const before = get().map(id).join("|"), after = get().map((x) => (shown.has(id(x)) ? moved.shift() : x));
      if (after.map(id).join("|") !== before) put(after);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  return box;
}

// ---------- окно истории: шапка, страны, группы, значки ----------
const svg = (d, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="currentColor" d="${d}"/></svg>`;
// значки записей — маленький набор для поездок (Грегори 2026-11-21: «у Google сильно заморочено; аэропорт,
// аренда авто, гостиница, апартаменты — такой наборчик»); одноцветные, цвет — от строки
export const ICONS = [
  { id: "airport", name: "Аэропорт", d: "M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" },
  { id: "car", name: "Аренда авто", d: "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" },
  { id: "hotel", name: "Гостиница", d: "M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z" },
  { id: "apartment", name: "Апартаменты", d: "M17 11V3H7v4H3v14h8v-4h2v4h8V11h-4zM7 19H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm4 4H9v-2h2v2zm0-4H9V9h2v2zm0-4H9V5h2v2zm4 8h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm4 12h-2v-2h2v2zm0-4h-2v-2h2v2z" },
  { id: "home", name: "Дом", d: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" },
  { id: "work", name: "Работа", d: "M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z" },
  { id: "food", name: "Ресторан", d: "M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z" },
  { id: "cafe", name: "Кафе", d: "M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z" },
  { id: "museum", name: "Музей", d: "M12 2 2 7v2h20V7L12 2zM4 11v7h3v-7H4zm6.5 0v7h3v-7h-3zM2 22h20v-3H2v3zm15-11v7h3v-7h-3z" },
  { id: "shop", name: "Магазин", d: "M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-1.99.9-1.99 2L3 20c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-3c1.66 0 3 1.34 3 3H9c0-1.66 1.34-3 3-3zm0 10c-2.76 0-5-2.24-5-5h2c0 1.66 1.34 3 3 3s3-1.34 3-3h2c0 2.76-2.24 5-5 5z" },
  { id: "train", name: "Вокзал", d: "M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" },
  { id: "bus", name: "Автобус", d: "M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z" },
  { id: "ferry", name: "Паром", d: "M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z" },
  { id: "parking", name: "Парковка", d: "M13 3H6v18h4v-6h3c3.31 0 6-2.69 6-6s-2.69-6-6-6zm.2 8H10V7h3.2c1.1 0 2 .9 2 2s-.9 2-2 2z" },
  { id: "fuel", name: "Заправка", d: "M19.77 7.23l.01-.01-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.36 0 .69-.08 1-.21v7.21c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77zM12 10H6V5h6v5zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z" },
  { id: "beach", name: "Пляж", d: "M13.127 14.56l1.43-1.43 6.44 6.443L19.57 21zm4.293-5.73l2.86-2.86c-3.95-3.95-10.35-3.96-14.3-.02 3.93-1.3 8.31-.25 11.44 2.88zM5.95 5.98c-3.94 3.95-3.93 10.35.02 14.3l2.86-2.86C5.7 14.29 4.65 9.91 5.95 5.98zm.02-.02l-.01.01c-.38 3.01 1.17 6.88 4.3 10.02l5.73-5.73c-3.13-3.13-7.01-4.68-10.02-4.3z" },
  { id: "mountain", name: "Горы", d: "M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z" },
  { id: "photo", name: "Фото", d: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" },
  { id: "hospital", name: "Больница", d: "M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z" },
  { id: "star", name: "Звезда", d: "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" },
  { id: "heart", name: "Сердце", d: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" },
  { id: "flag", name: "Флаг", d: "M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z" },
];
const iconSvg = (iconId, size = 22) => { const i = ICONS.find((x) => x.id === iconId); return i ? svg(i.d, size) : ""; };
const FOLDER = "M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z";
const NONE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0 1 20 12c0 4.42-3.58 8-8 8z";
const GLOBE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z";
const TRASH = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z";
const SAVE = "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z";
// свернуть и закрыть — те же, что у окон (core/panel.js)
const FOLD_ICON = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>';
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });
const button = (cls, title, html, fn) => {
  const b = el("button", cls);
  Object.assign(b, { type: "button", title, innerHTML: html });
  b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
  return b;
};

// что открыто в окне: страна, группа или таблица значков — по списку; щелчок по строке поиска — к началу
const views = new Map();
const view = (key) => { if (!views.has(key)) views.set(key, {}); return views.get(key); };
// true — было открыто что-то внутри (страна, группа, значки)
export const resetView = (key) => { const v = views.get(key), was = !!(v?.country || v?.group || v?.pick); views.delete(key); return was; };

// группы — свои, хранятся рядом со списком: [{ id, name, icon? }], у записи — group: id
const loadGroups = (key) => settings.get(`${key}.groups`, []);
const saveGroups = (key, g) => settings.set(`${key}.groups`, g.length ? g : null);

// страна записи — по её точке (core/borders.js), узнаётся один раз и хранится в записи
const NO_COUNTRY = "Без страны";
const countryOf = (e) => e.country?.name || NO_COUNTRY;
const locating = new Set();
async function locate(key, id, lngLat, done) {
  if (locating.has(key)) return;
  locating.add(key);
  let found = false;
  try {
    for (const e of loadList(key).filter((x) => x.country === undefined)) {
      const c = await countryAt(lngLat(e));
      if (c === undefined) break; // границы не загрузились — в другой раз
      const k = id(e);
      saveList(key, loadList(key).map((x) => (id(x) === k && x.country === undefined ? { ...x, country: c } : x)));
      found = true;
    }
  } finally { locating.delete(key); }
  if (found) done();
}
const flagIcon = (iso) => (iso ? `<img class="history-flag" alt="" src="${flagUrl(iso)}">` : "");

const xml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
// экспорт для себя (Грегори 2026-11-21) — KML: открывается в Google Earth, «Моих картах» Google, Organic Maps
// и OsmAnd; группы — папками, свои названия и значки остаются в описании
function exportKml(name, list, groups, label, lngLat) {
  const mark = (e) => {
    const { title, sub } = label(e), [x, y] = lngLat(e), icon = ICONS.find((i) => i.id === e.icon)?.name;
    const about = [sub, icon].filter(Boolean).join(" · ");
    return `<Placemark><name>${xml(title)}</name>${about ? `<description>${xml(about)}</description>` : ""}<Point><coordinates>${x},${y}</coordinates></Point></Placemark>`;
  };
  const known = new Set(groups.map((g) => g.id));
  const parts = [...groups.map((g) => `<Folder><name>${xml(g.name)}</name>${list.filter((e) => e.group === g.id).map(mark).join("")}</Folder>`),
    ...list.filter((e) => !known.has(e.group)).map(mark)];
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(name)}</name>\n${parts.join("\n")}\n</Document></kml>\n`;
  const a = Object.assign(document.createElement("a"), { download: `${name}.kml`, href: URL.createObjectURL(new Blob([text], { type: "application/vnd.google-earth.kml+xml" })) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return text;
}
let lastExport = "";
export const lastKml = () => lastExport; // для проверки

// окно истории целиком → узлы для списка поиска ([] — показывать нечего)
// title — название в шапке; grouped — по странам по умолчанию; lngLat(e) — точка записи; empty — текст пустого
// списка (нет — пустой список не показывается); fold() — свернуть список, close() — закрыть поиск;
// остальное — как у historyList. Набирают текст (match) — просто подходящие записи, без шапки
export function historyPanel({ key, title, id, label: baseLabel, pick, changed, match, rename, lngLat, grouped = false, empty, fold, close }) {
  const v = view(key);
  const all = loadList(key);
  // группа без записей не живёт
  const groups = loadGroups(key).filter((g) => all.some((e) => e.group === g.id));
  if (groups.length !== loadGroups(key).length) saveGroups(key, groups);
  const label = (e) => { const l = baseLabel(e); return e.icon ? { ...l, icon: iconSvg(e.icon) } : l; };
  const hold = (item) => { v.pick = item.group ? { group: item.group.id } : { entry: id(item) }; changed(); };
  if (match) {
    const list = historyList({ key, id, label, pick, changed, match, rename });
    return list.childElementCount ? [list] : [];
  }
  if (!all.length) return empty ? [head(title), el("div", "search-note", empty)] : [];
  locate(key, id, lngLat, changed);

  const isGrouped = settings.get(`${key}.grouped`) ?? grouped;
  const membersOf = (g) => all.filter((e) => e.group === g.id);
  // группа — в стране своей первой записи (Грегори 2026-11-21: «группа не распадается при группировке по странам»)
  const placeOf = (e) => { const g = groups.find((x) => x.id === e.group); return countryOf(g ? membersOf(g)[0] : e); };
  const groupItem = (g) => {
    const members = membersOf(g);
    return { group: g, members,
      label: { title: g.name, sub: `${members.length} · ${members.map((m) => label(m).title).join(", ")}`, icon: g.icon ? iconSvg(g.icon) : svg(FOLDER, 22) },
      pick: () => { v.group = g.id; changed(); },
      rename: (name) => saveGroups(key, loadGroups(key).map((x) => (x.id === g.id ? { ...x, name } : x))),
      remove: () => { saveList(key, loadList(key).map((e) => (e.group === g.id ? { ...e, group: undefined } : e))); saveGroups(key, loadGroups(key).filter((x) => x.id !== g.id)); } };
  };

  // таблица значков: ручку строки подержали
  if (v.pick) {
    const g = v.pick.group && groups.find((x) => x.id === v.pick.group), entry = v.pick.entry && all.find((e) => id(e) === v.pick.entry);
    if (g || entry) return picker(g, entry);
    v.pick = null;
  }
  if (v.group) {
    const g = groups.find((x) => x.id === v.group);
    if (g) return [inner(g.name, g.icon ? iconSvg(g.icon) : svg(FOLDER, 22), () => { v.group = null; }), historyList({ key, id, label, pick, changed, rename, hold, items: membersOf(g) })];
    v.group = null;
  }
  // по странам — сначала страны с флажками («Без страны» первой, остальные по алфавиту, как в альбомах)
  if (isGrouped) {
    const by = new Map();
    for (const e of all) { const k = placeOf(e); by.set(k, { n: (by.get(k)?.n || 0) + 1, iso: by.get(k)?.iso || (countryOf(e) === k && e.country?.iso) || "" }); }
    if (v.country && !by.has(v.country)) v.country = null;
    if (!v.country) {
      const lands = [...by].sort((x, y) => (y[0] === NO_COUNTRY) - (x[0] === NO_COUNTRY) || x[0].localeCompare(y[0], "ru"));
      return [head(title), ...lands.map(([name, { n, iso }]) => countryRow(name, n, iso))];
    }
  }
  // строки: записи по порядку, группа — одной строкой на месте своей первой записи
  const items = [], seen = new Set();
  for (const e of all) {
    if (v.country && placeOf(e) !== v.country) continue;
    const g = groups.find((x) => x.id === e.group);
    if (!g) items.push(e);
    else if (!seen.has(g.id)) { seen.add(g.id); items.push(groupItem(g)); }
  }
  const list = historyList({ key, id, label, pick, changed, rename, hold, items });
  if (v.country) return [inner(v.country, flagIcon(all.find((e) => countryOf(e) === v.country)?.country?.iso) || svg(GLOBE, 22), () => { v.country = null; }), list];
  return [head(title), list];

  // шапка списка: название; «по странам», экспорт, корзина; свернуть, закрыть
  function head(text) {
    const box = el("div", "history-head");
    const name = el("div", "history-title", text);
    const group = button("panel-btn history-group", isGrouped ? "Разгруппировать" : "Сгруппировать по странам", svg(GLOBE), () => {
      settings.set(`${key}.grouped`, !isGrouped === grouped ? null : !isGrouped);
      v.country = null;
      changed();
    });
    group.classList.toggle("on", isGrouped);
    const save = button("panel-btn history-export", "Экспорт (KML)", svg(SAVE), () => { lastExport = exportKml(`Atlas — ${text}`, loadList(key), groups, label, lngLat); });
    const trash = button("panel-btn search-history-clear", "Очистить историю", svg(TRASH), () => {
      if (!confirm(`Очистить историю «${text}»?`)) return;
      saveList(key, []);
      saveGroups(key, []);
      changed();
    });
    box.append(name, group, save, trash, ...controls());
    return box;
  }
  // шапка внутри страны или группы: назад, значок, название; свернуть, закрыть
  function inner(text, icon, back) {
    const box = el("div", "history-head route-view-head");
    const name = el("div", "route-view-title history-title", text);
    if (icon) name.insertAdjacentHTML("afterbegin", `<i class="history-icon">${icon}</i>`);
    box.append(button("route-view-back", "Назад", BACK, () => { back(); changed(); }), name, ...controls());
    return box;
  }
  function controls() {
    return [...(fold ? [button("panel-btn history-fold", "Свернуть", FOLD_ICON, fold)] : []),
      ...(close ? [button("panel-btn history-close", "Закрыть", CLOSE_ICON, close)] : [])];
  }
  function countryRow(name, n, iso) {
    const b = el("button", "search-item nav-country");
    b.type = "button";
    b.innerHTML = `<span class="search-item-title"></span>`;
    b.firstChild.textContent = `${name} (${n})`;
    b.firstChild.insertAdjacentHTML("afterbegin", `<i class="history-icon">${flagIcon(iso) || svg(GLOBE, 22)}</i>`);
    b.addEventListener("click", (e) => { e.stopPropagation(); v.country = name; changed(); });
    return b;
  }
  // значок записи (или группы) и в какую группу её положить
  function picker(g, entry) {
    const done = () => { v.pick = null; changed(); };
    const current = g ? g.icon : entry.icon;
    const setIcon = (icon) => {
      if (g) saveGroups(key, loadGroups(key).map((x) => (x.id === g.id ? { ...x, icon } : x)));
      else saveList(key, loadList(key).map((e) => (id(e) === id(entry) ? { ...e, icon } : e)));
      done();
    };
    const grid = el("div", "icon-grid");
    for (const i of [{ id: undefined, name: "Без значка", d: NONE }, ...ICONS]) {
      const b = button("icon-pick", i.name, `${svg(i.d, 28)}<span></span>`, () => setIcon(i.id));
      b.lastChild.textContent = i.name;
      b.classList.toggle("on", i.id === current);
      grid.append(b);
    }
    const acts = el("div", "icon-groups");
    const act = (text, fn) => acts.append(button("icon-group-btn", text, `${svg(FOLDER, 20)}<span></span>`, () => { fn(); done(); }));
    const setGroup = (gid) => saveList(key, loadList(key).map((e) => (id(e) === id(entry) ? { ...e, group: gid } : e)));
    if (g) act("Разгруппировать (места останутся)", () => groupItem(g).remove());
    else {
      act("В новую группу", () => {
        const gid = `g${Date.now()}`;
        saveGroups(key, [...loadGroups(key), { id: gid, name: `Группа ${loadGroups(key).length + 1}` }]);
        setGroup(gid);
      });
      for (const x of groups) if (x.id !== entry.group) act(`В группу «${x.name}»`, () => setGroup(x.id));
      if (entry.group) act("Убрать из группы", () => setGroup(undefined));
    }
    for (const b of acts.querySelectorAll("span")) b.textContent = b.closest("button").title;
    const name = g ? g.name : label(entry).title;
    return [inner(`Значок: ${name}`, "", () => { v.pick = null; }), grid, acts];
  }
}

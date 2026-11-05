// Окно-панель — один компонент на всё приложение (опыт travel-earth: окна экскурсий, языков и
// альбомов делались по отдельности, и половина правок была про их несовпадения). Одновременно
// открыта одна панель; шапка — название, «свернуть», «закрыть»; высота подстраивается под
// содержимое; на узком экране — во всю ширину под верхней строкой. Свёрнута ли — помнится.
// side: "right" (настройки — справа вверху) или "left" (Языки, Экскурсии, Альбомы — слева под строкой
// поиска; колесо справа при ней остаётся открытым).
// Внизу — ползунок (Грегори, 2026-10-30): потянуть — окно выше или ниже, высота помнится; двойное
// нажатие — снова по содержимому. Своя кнопка раздела в шапке (перед «свернуть») — addButton
import { emit, on } from "./events.js";
import * as settings from "./settings.js";
import { backable } from "./back.js";

const MIN_ICON = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 13H5v-2h14v2z"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>`;

const panels = new Map();
let openId = null;

const iconButton = (icon, title) =>
  Object.assign(document.createElement("button"), { className: "panel-btn", innerHTML: icon, title });

export function createPanel({ id, title, icon = "", side = "right" }) {
  const el = Object.assign(document.createElement("section"), { className: `panel panel-${side}`, hidden: true });
  el.dataset.panel = id;
  const head = Object.assign(document.createElement("header"), { className: "panel-head" });
  const name = Object.assign(document.createElement("h2"), { className: "panel-title", innerHTML: `${icon}<span></span>` });
  name.querySelector("span").textContent = title;
  const minBtn = iconButton(MIN_ICON, "Свернуть");
  const closeBtn = iconButton(CLOSE_ICON, "Закрыть");
  // окно справа (настройки) не сворачивается — только закрыть (Грегори 2026-11-05: «нечего его сворачивать»)
  head.append(name, ...(side === "left" ? [minBtn] : []), closeBtn);
  const body = Object.assign(document.createElement("div"), { className: "panel-body" });
  const grip = Object.assign(document.createElement("div"), { className: "panel-grip", title: "Потяните — окно выше или ниже" });
  el.append(head, body, grip);
  document.body.append(el);

  const setHeight = (px) => {
    el.style.maxHeight = px ? `${px}px` : "";
    settings.set(`panel.${id}.h`, px || null);
  };
  let drag = null;
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, h: el.getBoundingClientRect().height };
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const top = el.getBoundingClientRect().top;
    setHeight(Math.round(Math.max(140, Math.min(innerHeight - top - 8, drag.h + e.clientY - drag.y))));
  });
  const end = () => { drag = null; };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("dblclick", () => setHeight(null));
  const saved = settings.get(`panel.${id}.h`);
  if (saved) el.style.maxHeight = `${Math.min(saved, innerHeight - 60)}px`;

  // окно слева сворачивается значком в строку поиска (Грегори 2026-11-05: «окно просто свёрнуто и
  // занимает место — свернуть в окно поиска»): событие panel-fold. Окно справа не сворачивается
  const setMin = (min) => {
    if (side !== "left") return;
    if (min === el.classList.contains("folded")) return;
    el.classList.toggle("folded", min);
    emit("panel-fold", min ? { id, icon, title: name.querySelector("span").textContent } : null);
    if (!min) emit("panel", { id, side });
  };
  minBtn.addEventListener("click", () => setMin(true));
  minBtn.title = "Свернуть — в строку поиска";
  closeBtn.addEventListener("click", () => close(id));
  const closers = [];

  const panel = { id, side, el, body, setMin, closers, open: () => open(id), close: () => close(id), toggle: () => (openId === id ? close(id) : open(id)),
    setTitle: (text) => { name.querySelector("span").textContent = text; },
    addButton: (icon, title, fn) => { const b = iconButton(icon, title); b.addEventListener("click", fn); head.insertBefore(b, minBtn); return b; },
    onClose: (fn) => closers.push(fn) };
  panels.set(id, panel);
  return panel;
}

export function open(id) {
  if (openId && openId !== id) close(openId, true);
  const p = panels.get(id);
  p.el.hidden = false;
  p.el.classList.remove("folded"); // открыли — развёрнутым
  openId = id;
  // окно — шаг для «Назад» телефона
  if (!p.back) p.back = backable(() => { p.back = null; close(id); });
  emit("panel", { id, side: p.side });
}

export function close(id, replaced = false) {
  const p = panels.get(id);
  if (!p || p.el.hidden) return;
  p.el.hidden = true;
  if (p.el.classList.contains("folded")) { p.el.classList.remove("folded"); emit("panel-fold", null); }
  if (p.back) { const d = p.back; p.back = null; d(); }
  if (openId === id) {
    openId = null;
    for (const fn of p.closers) fn();
    if (!replaced) emit("panel", null);
  }
}

export const isOpen = (id) => openId === id;
// окно слева — свернуть в строку поиска (открылось другое окно — карточка пути) или развернуть (значок)
on("panel-fold-request", ({ fold }) => { const p = openId && panels.get(openId); if (p?.side === "left") p.setMin(fold); }, { replay: false });

// список раздела в его панели (страны, языки; Грегори 2026-11-02: «сразу панели… проще прокрутка, если
// список вырастет»): items — [{ id, title, thumb, icon, hint, selected }], флаг или значок слева
export function homeList(items, choose) {
  const list = Object.assign(document.createElement("div"), { className: "home-list" });
  if (!items.length) list.append(Object.assign(document.createElement("p"), { className: "pb-hint", textContent: "Загрузка…" }));
  for (const it of items) {
    const r = Object.assign(document.createElement("button"), { className: "tr-row home-row" + (it.selected ? " selected" : ""), title: it.hint || "" });
    r.innerHTML = `<span class="tr-row-text"><span class="tr-row-title"></span></span><i class="tr-icon">${it.thumb ? '<img alt="">' : it.icon || ""}</i>`;
    r.querySelector(".tr-row-title").textContent = it.title;
    if (it.thumb) r.querySelector("img").src = it.thumb;
    r.addEventListener("click", () => choose(it.id));
    list.append(r);
  }
  return list;
}

// закрыть открытую панель (колесо открылось — правая панель, настройки, уступает ему место); side —
// только панель этой стороны
export const closeOpen = (side) => openId && (!side || panels.get(openId).side === side) && close(openId);

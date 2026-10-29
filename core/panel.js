// Окно-панель — один компонент на всё приложение (опыт travel-earth: окна экскурсий, языков и
// альбомов делались по отдельности, и половина правок была про их несовпадения). Одновременно
// открыта одна панель; шапка — название, «свернуть», «закрыть»; высота подстраивается под
// содержимое; на узком экране — во всю ширину под верхней строкой. Свёрнута ли — помнится.
// side: "right" (настройки — справа вверху) или "left" (Языки, Экскурсии, Альбомы — слева под строкой
// поиска; колесо справа при ней остаётся открытым)
import { emit } from "./events.js";
import * as settings from "./settings.js";

const MIN_ICON = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 13H5v-2h14v2z"/></svg>`;
const MAX_ICON = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 19H5V5h14v14zM5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5z"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>`;

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
  head.append(name, minBtn, closeBtn);
  const body = Object.assign(document.createElement("div"), { className: "panel-body" });
  el.append(head, body);
  document.body.append(el);

  const setMin = (min) => {
    el.classList.toggle("min", min);
    minBtn.innerHTML = min ? MAX_ICON : MIN_ICON;
    minBtn.title = min ? "Развернуть" : "Свернуть";
    settings.set(`panel.${id}.min`, min || null);
  };
  minBtn.addEventListener("click", () => setMin(!el.classList.contains("min")));
  closeBtn.addEventListener("click", () => close(id));
  const closers = [];
  setMin(!!settings.get(`panel.${id}.min`));

  const panel = { id, side, el, body, setMin, closers, open: () => open(id), close: () => close(id), toggle: () => (openId === id ? close(id) : open(id)),
    setTitle: (text) => { name.querySelector("span").textContent = text; },
    onClose: (fn) => closers.push(fn) };
  panels.set(id, panel);
  return panel;
}

export function open(id) {
  if (openId && openId !== id) close(openId, true);
  const p = panels.get(id);
  p.el.hidden = false;
  openId = id;
  emit("panel", { id, side: p.side });
}

export function close(id, replaced = false) {
  const p = panels.get(id);
  if (!p || p.el.hidden) return;
  p.el.hidden = true;
  if (openId === id) {
    openId = null;
    for (const fn of p.closers) fn();
    if (!replaced) emit("panel", null);
  }
}

export const isOpen = (id) => openId === id;

// закрыть открытую панель (колесо открылось — правая панель, настройки, уступает ему место); side —
// только панель этой стороны
export const closeOpen = (side) => openId && (!side || panels.get(openId).side === side) && close(openId);

// Столбик справа сразу под логотипом (Грегори 2026-11-06: «используем мёртвую зону правого края при
// открытых барабанах»): шестерёнка, язык подписей, затем значки моих включённых режимов (навигация,
// открытые разделы). Виден, пока открыт поиск или любой барабан; барабан, если доходит сюда, — под ним.
// Кнопки добавляют модули (addDockButton), значки режимов рисует core/layers-panel.js (dockModes)
export const dock = Object.assign(document.createElement("div"), { className: "dock" });
const fixed = Object.assign(document.createElement("div"), { className: "dock-fixed" });
const modes = Object.assign(document.createElement("div"), { className: "dock-modes" });
dock.append(fixed, modes);
document.body.append(dock);

export function addDockButton({ title, html, className = "" }) {
  const btn = Object.assign(document.createElement("button"), { type: "button", className: ["btn glass", className].filter(Boolean).join(" "), title, innerHTML: html });
  fixed.append(btn);
  return btn;
}

export const dockModes = modes;
export const setDockShown = (on) => document.body.classList.toggle("dock-on", on);

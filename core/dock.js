// Под кнопкой справа вверху — только язык подписей (Грегори 2026-11-06: «убираем кнопки в столбик, оставим
// только язык; настройки — в верхний барабан, остальное и так есть в барабане»). Виден, пока открыт поиск
// или любой барабан. Кнопки добавляют модули (addDockButton)
export const dock = Object.assign(document.createElement("div"), { className: "dock" });
document.body.append(dock);

export function addDockButton({ title, html, className = "" }) {
  const btn = Object.assign(document.createElement("button"), { type: "button", className: ["btn glass", className].filter(Boolean).join(" "), title, innerHTML: html });
  dock.append(btn);
  return btn;
}

export const setDockShown = (on) => document.body.classList.toggle("dock-on", on);

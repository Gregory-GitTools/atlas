// Строка разделов под поиском (Грегори, 2026-11-02: «фотки, экскурсии и языки вернул бы на панель под
// окном поиска и выбор файлов туда же; панель тоже прятать — полупрозрачная стрелка под лупой»):
//  • кнопки разделов с панелью (kind: "content": Фото, Экскурсии, Языки, Треки) — значок в кружке цвета
//    раздела и короткое название (поле short, иначе title); порядок — как в MODULES;
//  • нажатие — список раздела вниз под кнопкой (поле column модуля: { load(), items(), choose(id),
//    isOpen(), close() }; список подгружается при первом открытии); первой строкой у Фото и Треков —
//    «Открыть папку… / Открыть файл…», прямо по нажатию; выбор открывает панель раздела слева;
//  • кнопка светлая, пока панель раздела открыта;
//  • стрелка под лупой — показать и спрятать строку (▼ / ▲), открытость помнится (search.sections).
import { modules, available, onRegister, MODULES } from "./modules.js";
import { on } from "./events.js";
import { columnItem } from "./layers-panel.js";
import * as settings from "./settings.js";

const ARROW = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M5 9h14l-7 8z"/></svg>';
const order = (m) => MODULES.findIndex((p) => p.includes(m.id));

export function initContentBar(ctx) {
  const search = document.querySelector(".search");
  const row = Object.assign(document.createElement("div"), { className: "search-sections" });
  const arrow = Object.assign(document.createElement("button"), { className: "search-sections-toggle", innerHTML: ARROW });
  const sub = Object.assign(document.createElement("div"), { className: "layers-sub bar-sub", hidden: true });
  search.querySelector(".search-box").after(row);
  search.append(arrow);
  document.body.append(sub);

  // стрелка — под лупой; панели слева — ниже строки и стрелки
  const place = () => {
    const go = search.querySelector(".search-go");
    arrow.style.left = `${go.offsetLeft}px`;
    document.body.style.setProperty("--search-h", `${row.hidden ? 40 : row.offsetTop + row.offsetHeight}px`);
  };

  let isOpen = false;
  const setOpen = (open) => {
    isOpen = open;
    row.hidden = !open;
    arrow.classList.toggle("open", open);
    arrow.title = open ? "Спрятать разделы" : "Показать разделы: фото, экскурсии, языки, треки";
    settings.set("search.sections", open ? null : "hidden");
    if (!open) show(null);
    place();
  };
  arrow.addEventListener("click", () => setOpen(!isOpen));

  // ---------- список раздела ----------
  let openKey = null;
  const sections = () => modules("content").filter(available).sort((a, b) => order(a) - order(b));
  function show(key) {
    openKey = key;
    for (const c of row.children) c.classList.toggle("open", c.dataset.key === key);
    const m = key && sections().find((x) => x.id === key);
    if (!m) { sub.hidden = true; return; }
    const col = m.column;
    if (!col.loaded) {
      col.loaded = true;
      col.load(ctx).catch(() => {}).finally(() => openKey === key && show(key));
    }
    const items = col.items();
    sub.replaceChildren(
      ...(!items.length ? [Object.assign(document.createElement("div"), { className: "layers-wait", textContent: "Загрузка…" })] : []),
      ...items.map((it) => columnItem({ title: it.title, thumb: it.thumb, icon: it.icon, selected: it.selected, hint: it.hint,
        click: () => { col.choose(it.id, ctx); show(null); } })),
    );
    sub.style.setProperty("--tone", `var(--tone-${m.tone})`);
    sub.hidden = false;
    const r = row.querySelector(`[data-key="${key}"]`).getBoundingClientRect();
    sub.style.left = `${Math.max(8, Math.min(r.left, innerWidth - sub.offsetWidth - 8))}px`;
    sub.style.top = `${r.bottom + 6}px`;
    sub.style.maxHeight = `${innerHeight - r.bottom - 16}px`;
  }
  document.addEventListener("click", (e) => {
    if (!e.target.isConnected) return;
    if (openKey && !sub.contains(e.target) && !row.contains(e.target)) show(null);
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && openKey && show(null));

  // ---------- кнопки ----------
  const render = () => {
    row.replaceChildren(...sections().map((m) => {
      const b = Object.assign(document.createElement("button"), { className: `bar-chip tone-${m.tone}`, title: m.hint || m.title });
      b.dataset.key = m.id;
      b.innerHTML = `<i class="bar-chip-icon">${m.icon}</i><span></span>`;
      b.lastChild.textContent = m.short || m.title;
      b.classList.toggle("on", !!m.column.isOpen());
      b.addEventListener("click", (ev) => { ev.stopPropagation(); show(openKey === m.id ? null : m.id); });
      return b;
    }));
    if (openKey) show(openKey);
    place();
  };
  on("panel", render, { replay: false });
  on("module", render, { replay: false });
  onRegister(render);
  addEventListener("resize", () => { place(); if (openKey) show(openKey); });
  render();
  setOpen(settings.get("search.sections") !== "hidden");
}

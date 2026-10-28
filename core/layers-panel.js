// Панель «Слои» — строится из реестра: каждый модуль-слой — кнопка-чип. Ядро слоёв по именам не
// знает; новый модуль появляется здесь сам. Разделы: «Места» (модули с group: "places" —
// можно несколько сразу), «Тропы» (group: "trails"), «Погода» и «Слои». У модуля с menu чип из двух частей: название
// включает, стрелка открывает меню (профили магазинов). Включённые слои помнятся
import { createPanel } from "./panel.js";
import { modules, toggle, available, allowed, onRegister } from "./modules.js";
import { on } from "./events.js";
import * as settings from "./settings.js";

const LAYERS_ICON = `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="m12 16.54-7.38-5.73L3 12.07l9 7 9-7-1.63-1.27zM12 14l7.36-5.73L21 7l-9-7-9 7 1.63 1.27z"/></svg>`;
const SECTIONS = [
  { title: "Места", match: (m) => m.group === "places" },
  { title: "Тропы", match: (m) => m.group === "trails" },
  { title: "Погода", match: (m) => m.id.startsWith("weather/") },
  { title: "Слои", match: (m) => !m.group && !m.id.startsWith("weather/") },
];

export function initLayersPanel(ctx) {
  const panel = createPanel({ id: "layers", title: "Слои", icon: LAYERS_ICON });
  const btn = Object.assign(document.createElement("button"), { className: "btn top-right", innerHTML: LAYERS_ICON, title: "Места и слои" });
  btn.addEventListener("click", () => panel.toggle());
  document.body.append(btn);
  const menu = Object.assign(document.createElement("div"), { className: "menu chip-menu", hidden: true });
  document.body.append(menu);
  document.addEventListener("click", (e) => !menu.contains(e.target) && !e.target.closest(".chip-arrow") && (menu.hidden = true));

  const active = new Set(settings.get("layers.on", []));
  const save = () => settings.set("layers.on", [...active]);

  const switchTo = async (m, on) => {
    // exclusive — в своей группе одновременно включён один (у «Мест» такого нет: Грегори, 2026-10-28,
    // «выделение нескольких мест одновременно»)
    if (on && m.group && m.exclusive) {
      for (const other of modules("layer")) {
        if (other !== m && other.group === m.group && other.active) {
          await toggle(other.id, ctx, false).catch(() => {});
          active.delete(other.id);
        }
      }
    }
    const result = await toggle(m.id, ctx, on).catch((err) => { ctx.status(`«${m.title}» не включился`); console.warn(err); return m.active; });
    result ? active.add(m.id) : active.delete(m.id);
    save();
    render();
  };

  const chip = (m) => {
    const blocked = !allowed(m);
    const label = (el) => {
      el.innerHTML = `${m.icon || ""}<span></span>`;
      el.querySelector("span").textContent = m.menu?.label() || m.title;
    };
    if (!m.menu) {
      const b = Object.assign(document.createElement("button"), { className: "chip" + (m.active ? " on" : "") });
      label(b);
      b.disabled = blocked;
      if (blocked) b.title = "Выключено в настройках: обращается в интернет";
      b.addEventListener("click", () => { b.disabled = true; switchTo(m, !m.active); });
      return b;
    }
    const box = Object.assign(document.createElement("div"), { className: "chip chip-split" + (m.active ? " on" : "") });
    const main = Object.assign(document.createElement("button"), { className: "chip-main", disabled: blocked });
    label(main);
    main.addEventListener("click", () => switchTo(m, !m.active));
    const arrow = Object.assign(document.createElement("button"), { className: "chip-arrow", title: "Выбрать", disabled: blocked,
      innerHTML: `<svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>` });
    arrow.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!menu.hidden) { menu.hidden = true; return; }
      const r = box.getBoundingClientRect();
      menu.style.left = `${Math.min(r.left, innerWidth - 230)}px`;
      menu.style.top = `${r.bottom + 6}px`;
      menu.replaceChildren(...m.menu.items().map((it) => {
        const b = Object.assign(document.createElement("button"), { className: "menu-item" + (it.active ? " active" : ""), textContent: it.title });
        b.addEventListener("click", () => { menu.hidden = true; m.menu.choose(it.id); switchTo(m, true); });
        return b;
      }));
      menu.hidden = false;
    });
    box.append(main, arrow);
    return box;
  };

  const render = () => {
    const usable = modules("layer").filter(available);
    panel.body.replaceChildren(...SECTIONS.flatMap((s) => {
      const items = usable.filter(s.match);
      if (!items.length) return [];
      const list = Object.assign(document.createElement("div"), { className: "chips" });
      list.append(...items.map(chip));
      return [Object.assign(document.createElement("h3"), { className: "set-title", textContent: s.title }), list];
    }));
    btn.classList.toggle("on", active.size > 0);
  };
  onRegister(render);
  render();

  // разрешили сеть снова — включить то, что было включено до запрета
  on("modules", async () => {
    for (const id of active) {
      const m = modules().find((x) => x.id === id);
      if (m && !m.active && allowed(m)) await toggle(id, ctx, true).catch(() => {});
    }
    render();
  }, { replay: false });

  // включённое с прошлого раза — после загрузки карты
  ctx.map.once("load", async () => {
    for (const id of active) await toggle(id, ctx, true).catch(() => {});
    render();
  });
  // смена стиля карты сбрасывает слои — включить заново
  ctx.map.on("style.load", () => {
    for (const m of modules("layer")) if (m.active) m.enable?.(ctx);
  });
}

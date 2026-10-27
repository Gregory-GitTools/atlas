// Панель «Слои» — строится из реестра: каждый модуль-слой — кнопка-чип. Ядро слоёв по именам не
// знает; новый модуль появляется здесь сам. Включённые слои помнятся и включаются при запуске
import { createPanel } from "./panel.js";
import { modules, toggle, available, allowed, onRegister } from "./modules.js";
import { on } from "./events.js";
import * as settings from "./settings.js";

const LAYERS_ICON = `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="m12 16.54-7.38-5.73L3 12.07l9 7 9-7-1.63-1.27zM12 14l7.36-5.73L21 7l-9-7-9 7 1.63 1.27z"/></svg>`;

export function initLayersPanel(ctx) {
  const panel = createPanel({ id: "layers", title: "Слои", icon: LAYERS_ICON });
  const list = Object.assign(document.createElement("div"), { className: "chips" });
  panel.body.append(list);

  const btn = Object.assign(document.createElement("button"), { className: "btn top-right", innerHTML: LAYERS_ICON, title: "Слои" });
  btn.addEventListener("click", () => panel.toggle());
  document.body.append(btn);

  const active = new Set(settings.get("layers.on", []));
  const render = () => {
    list.replaceChildren(...modules("layer").filter(available).map((m) => {
      const chip = Object.assign(document.createElement("button"), { className: "chip", innerHTML: `${m.icon || ""}<span></span>` });
      chip.querySelector("span").textContent = m.title;
      chip.classList.toggle("on", !!m.active);
      if (!allowed(m)) {
        chip.disabled = true;
        chip.title = "Выключено в настройках: обращается в интернет";
      }
      chip.addEventListener("click", async () => {
        chip.disabled = true;
        const on = await toggle(m.id, ctx).catch((err) => { ctx.status(`«${m.title}» не включился`); console.warn(err); return m.active; });
        chip.disabled = false;
        on ? active.add(m.id) : active.delete(m.id);
        settings.set("layers.on", [...active]);
        render();
      });
      return chip;
    }));
    btn.classList.toggle("on", active.size > 0);
  };
  onRegister(render);
  render();
  // разрешили сеть снова — включить слои, которые были включены до запрета
  on("modules", async () => {
    for (const id of active) {
      const m = modules().find((x) => x.id === id);
      if (m && !m.active && allowed(m)) await toggle(id, ctx, true).catch(() => {});
    }
    render();
  }, { replay: false });

  // слои с прошлого раза — после загрузки стиля карты
  ctx.map.once("load", async () => {
    for (const id of active) await toggle(id, ctx, true).catch(() => {});
    render();
  });
  // смена стиля карты сбрасывает слои — включить заново
  ctx.map.on("style.load", () => {
    for (const m of modules("layer")) if (m.active) m.enable?.(ctx);
  });
}

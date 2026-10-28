// «Слои» — как меню слоёв Windy (Грегори, 2026-10-28, со скриншотом): справа вверху кнопка «Слои»,
// по щелчку под ней выпадает столбик кружков с подписями — по одному на раздел (Места, Тропы,
// Дороги, Рельеф, Погода, Пляжи и сёрфинг). Щелчок по кружку — рядом подменю с кнопками-чипами
// этого раздела. Ядро слоёв по именам не знает: раздел модуля — поле group, новый модуль
// появляется сам; модуль без известного раздела попадает в «Ещё». У модуля с menu чип из двух
// частей: название включает, стрелка открывает меню видов. Включённые слои помнятся.
// Открылся столбик — открытая панель закрывается, и наоборот (на экране одно окно).
import { closeOpen } from "./panel.js";
import { modules, toggle, available, allowed, onRegister } from "./modules.js";
import { on } from "./events.js";
import * as settings from "./settings.js";

const svg = (inner) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">${inner}</svg>`;
const LAYERS_ICON = svg('<path d="m12 16.54-7.38-5.73L3 12.07l9 7 9-7-1.63-1.27zM12 14l7.36-5.73L21 7l-9-7-9 7 1.63 1.27z"/>');
// разделы по порядку; значок не задан — берётся у первого модуля раздела
const GROUPS = [
  { id: "places", title: "Места", icon: svg('<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>') },
  { id: "trails", title: "Тропы" },
  { id: "roads", title: "Дороги" },
  { id: "relief", title: "Рельеф", icon: svg('<path d="M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z"/>') },
  { id: "weather", title: "Погода" },
  { id: "water", title: "Пляжи и сёрфинг" },
  { id: "other", title: "Ещё" },
];
const groupOf = (m) => (GROUPS.some((g) => g.id === m.group) ? m.group : "other");

export function initLayersPanel(ctx) {
  const root = Object.assign(document.createElement("div"), { className: "layers-menu top-right" });
  const row = (title, icon) => {
    const r = Object.assign(document.createElement("div"), { className: "layers-row" });
    const label = Object.assign(document.createElement("button"), { className: "layers-label", textContent: title });
    const circle = Object.assign(document.createElement("button"), { className: "btn layers-circle", innerHTML: icon, title });
    label.addEventListener("click", () => circle.click());
    r.append(label, circle);
    return { r, circle };
  };
  const head = row("Слои", LAYERS_ICON);
  head.r.classList.add("layers-head");
  const list = Object.assign(document.createElement("div"), { className: "layers-list", hidden: true });
  root.append(head.r, list);
  // подменю раздела — рядом с его кружком
  const sub = Object.assign(document.createElement("div"), { className: "layers-sub", hidden: true });
  sub.dataset.layers = "";
  const menu = Object.assign(document.createElement("div"), { className: "menu chip-menu", hidden: true });
  document.body.append(root, sub, menu);

  let openGroup = null;
  const setOpen = (open) => {
    list.hidden = !open;
    head.circle.classList.toggle("open", open);
    if (open) closeOpen();
    else showGroup(null);
  };
  head.circle.addEventListener("click", () => setOpen(list.hidden));
  // открылась панель (настройки) — столбик уступает место
  on("panel", (p) => p && setOpen(false), { replay: false });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && !e.target.closest(".chip-arrow")) menu.hidden = true;
    if (openGroup && !sub.contains(e.target) && !menu.contains(e.target) && !list.contains(e.target)) showGroup(null);
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && (openGroup ? showGroup(null) : setOpen(false)));

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
      else if (m.hint) b.title = m.hint;
      b.addEventListener("click", () => { b.disabled = true; switchTo(m, !m.active); });
      return b;
    }
    const box = Object.assign(document.createElement("div"), { className: "chip chip-split" + (m.active ? " on" : "") });
    const main = Object.assign(document.createElement("button"), { className: "chip-main", disabled: blocked, title: m.hint || "" });
    label(main);
    main.addEventListener("click", () => switchTo(m, !m.active));
    const arrow = Object.assign(document.createElement("button"), { className: "chip-arrow", title: "Выбрать", disabled: blocked,
      innerHTML: `<svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>` });
    arrow.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!menu.hidden) { menu.hidden = true; return; }
      const r = box.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 230))}px`;
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

  const groups = () => {
    const usable = modules("layer").filter(available).filter((m) => m.group !== "hidden");
    return GROUPS.map((g) => ({ ...g, items: usable.filter((m) => groupOf(m) === g.id) })).filter((g) => g.items.length);
  };

  const circles = new Map(); // id раздела → кружок
  function showGroup(id) {
    openGroup = id;
    for (const [gid, c] of circles) c.classList.toggle("open", gid === id);
    root.classList.toggle("sub-open", !!id);
    const g = id && groups().find((x) => x.id === id);
    if (!g) { sub.hidden = true; menu.hidden = true; return; }
    const title = Object.assign(document.createElement("h3"), { className: "set-title", textContent: g.title });
    const chips = Object.assign(document.createElement("div"), { className: "chips" });
    chips.append(...g.items.map(chip));
    sub.replaceChildren(title, chips);
    sub.hidden = false;
    // рядом с подписью кружка (на телефоне — рядом с самим кружком), по его верхнему краю;
    // не выходит за низ экрана
    const r = circles.get(id).getBoundingClientRect();
    const edge = innerWidth <= 600 ? r.left : circles.get(id).parentElement.getBoundingClientRect().left;
    sub.style.right = `${innerWidth - edge + 8}px`;
    sub.style.top = `${Math.max(8, Math.min(r.top, innerHeight - sub.offsetHeight - 8))}px`;
  }

  const render = () => {
    circles.clear();
    list.replaceChildren(...groups().map((g) => {
      const { r, circle } = row(g.title, g.icon || g.items[0].icon || LAYERS_ICON);
      circle.classList.toggle("on", g.items.some((m) => m.active));
      circle.addEventListener("click", (e) => { e.stopPropagation(); showGroup(openGroup === g.id ? null : g.id); });
      circles.set(g.id, circle);
      return r;
    }));
    head.circle.classList.toggle("on", active.size > 0);
    if (openGroup) showGroup(openGroup);
  };
  onRegister(render);
  render();
  // слой включился не отсюда (сам по себе, по событию другого модуля) — кружки и чипы обновить
  on("module", render, { replay: false });

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

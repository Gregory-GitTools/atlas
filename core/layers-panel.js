// «Слои» — как меню слоёв Windy (Грегори, 2026-10-28, со скриншотами): справа вверху круглая
// кнопка «Слои», по щелчку под ней выпадает столбик кружков; название — мелкой подписью под
// кружком, между кнопками (Грегори: «Места, Слои, Тропы можно вписать между кнопок»). Щелчок по
// кружку — слева от него столбик кнопок, прижатых вправо, значок справа от названия; без окна и
// заголовка. Всё на глубине одного щелчка:
//  • кружок раздела (поле group модуля: Места, Рельеф, Погода…) — кнопки-переключатели его слоёв;
//  • модуль с видами (поле menu: Транспорт, Магазины, Тропы, Велодорожки, Дороги) — свой кружок,
//    кнопки — его виды, отмечать можно несколько (Грегори: «выбор может быть не одиночным»);
//    снят последний вид — слой выключается. После щелчка столбик кнопок остаётся открытым.
//    Если название модуля совпадает с названием раздела («Дороги», «Тропы»), остальные слои
//    раздела (железные дороги) — в том же кружке, под видами.
// Ядро слоёв по именам не знает: новый модуль появляется сам; без известного раздела — в «Ещё».
// Включённые слои помнятся. Открылся столбик — открытая панель закрывается, и наоборот.
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
// подпись под кружком — короткая, чтобы влезла (полное название — в подсказке)
const SHORT = { "Пляжи и сёрфинг": "Пляжи", "Велодорожки": "Вело" };
const groupOf = (m) => (GROUPS.some((g) => g.id === m.group) ? m.group : "other");
const BLOCKED = "Выключено в настройках: обращается в интернет";

export function initLayersPanel(ctx) {
  const root = Object.assign(document.createElement("div"), { className: "layers-menu top-right" });
  // кружок с подписью под ним; ключ — для поиска кружка (и в проверке)
  const circleBtn = (title, icon, short = title) => {
    const wrap = Object.assign(document.createElement("div"), { className: "layers-cell" });
    const c = Object.assign(document.createElement("button"), { className: "btn layers-circle", innerHTML: icon, title });
    wrap.append(c, Object.assign(document.createElement("span"), { className: "layers-caption", textContent: short }));
    return { wrap, c };
  };
  const head = circleBtn("Слои", LAYERS_ICON);
  const list = Object.assign(document.createElement("div"), { className: "layers-list", hidden: true });
  root.append(head.wrap, list);
  // кнопки кружка — слева от столбика
  const sub = Object.assign(document.createElement("div"), { className: "layers-sub", hidden: true });
  document.body.append(root, sub);

  let openKey = null;
  const setOpen = (open) => {
    list.hidden = !open;
    head.c.classList.toggle("open", open);
    // кнопки карты справа внизу на время прячутся — длинный столбик доходит до них
    document.body.classList.toggle("layers-open", open);
    if (open) closeOpen();
    else show(null);
  };
  head.c.addEventListener("click", () => setOpen(list.hidden));
  // открылась панель (настройки) — столбик уступает место
  on("panel", (p) => p && setOpen(false), { replay: false });
  document.addEventListener("click", (e) => {
    // кнопку, по которой щёлкнули, могли уже перерисовать — это щелчок внутри, а не мимо
    if (!e.target.isConnected) return;
    if (openKey && !sub.contains(e.target) && !list.contains(e.target)) show(null);
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && (openKey ? show(null) : setOpen(false)));

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

  // кнопка в столбике: название, значок справа
  const item = ({ title, icon, on: isOn, blocked, hint, click }) => {
    const b = Object.assign(document.createElement("button"), { className: "layers-item" + (isOn ? " on" : ""), disabled: blocked,
      title: blocked ? BLOCKED : hint || "" });
    b.innerHTML = `<span></span>${icon || ""}`;
    b.firstChild.textContent = title;
    b.addEventListener("click", () => { b.disabled = true; click(); });
    return b;
  };

  // кружки: раздел с обычными слоями и по кружку на каждый модуль с видами
  const entries = () => {
    const usable = modules("layer").filter(available).filter((m) => m.group !== "hidden");
    return GROUPS.flatMap((g) => {
      const mods = usable.filter((m) => groupOf(m) === g.id);
      const withMenu = mods.filter((m) => m.menu);
      let plain = mods.filter((m) => !m.menu);
      const host = withMenu.find((m) => m.title === g.title);
      const out = withMenu.map((m) => ({ key: m.id, title: m.title, icon: m.icon, module: m, plain: m === host ? plain : [] }));
      if (host) plain = [];
      if (plain.length) out.unshift({ key: g.id, title: g.title, icon: g.icon || plain[0].icon, plain });
      return out;
    });
  };

  const circles = new Map(); // ключ → кружок
  function show(key) {
    openKey = key;
    for (const [k, c] of circles) c.classList.toggle("open", k === key);
    const e = key && entries().find((x) => x.key === key);
    if (!e) { sub.hidden = true; return; }
    const m = e.module;
    sub.replaceChildren(
      ...(m ? m.menu.items().map((it) => item({ title: it.title, icon: m.icon, on: m.active && it.active, blocked: !allowed(m),
        click: () => {
          if (!m.active) { m.menu.choose(it.id); switchTo(m, true); } // слой был выключен — только этот вид
          else switchTo(m, m.menu.toggle(it.id)); // отметить ещё один или снять; не осталось ни одного — выключить
        } })) : []),
      ...e.plain.map((p) => item({ title: p.title, icon: p.icon, on: p.active, blocked: !allowed(p), hint: p.hint, click: () => switchTo(p, !p.active) })),
    );
    sub.hidden = false;
    // слева от кружка, по его верхнему краю; не выходит за низ экрана
    const r = circles.get(key).getBoundingClientRect();
    sub.style.right = `${innerWidth - r.left + 10}px`;
    sub.style.top = `${Math.max(8, Math.min(r.top, innerHeight - sub.offsetHeight - 8))}px`;
  }

  const render = () => {
    circles.clear();
    list.replaceChildren(...entries().map((e) => {
      const { wrap, c } = circleBtn(e.title, e.icon || LAYERS_ICON, SHORT[e.title] || e.title);
      // у модуля с видами в подсказке — выбранный вид
      const label = e.module?.menu.label();
      if (label && label !== e.title) c.title = `${e.title}: ${label}`;
      c.dataset.key = e.key;
      c.classList.toggle("on", !!e.module?.active || e.plain.some((m) => m.active));
      c.addEventListener("click", (ev) => { ev.stopPropagation(); show(openKey === e.key ? null : e.key); });
      circles.set(e.key, c);
      return wrap;
    }));
    // кнопка «Слои» серая, пока включён хоть один слой из меню (сохранённые имена старых слоёв не в счёт)
    head.c.classList.toggle("on", modules("layer").some((m) => m.active && m.group !== "hidden"));
    if (openKey) show(openKey);
  };
  onRegister(render);
  render();
  // слой включился не отсюда (сам по себе, по событию другого модуля) — кружки и кнопки обновить
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

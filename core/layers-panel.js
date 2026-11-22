// Кнопки — колёса-барабаны в боковой панели справа, на одном месте (Грегори, 2026-11-02: «один
// барабан сменяет другой»):
//  • барабан слоёв — открывает кнопка «Слои» справа внизу, над лентой фото (открыты — кнопка белая);
//  • барабан мест (Места, Транспорт, Магазины, Спорт) — кнопка с булавкой над «Слоями» (Грегори 2026-11-21:
//    «опять поделим Места и Слои на две кнопки»);
//  • барабан разделов (Экскурсии, Языки, Треки, Фото) — открывает полупрозрачная лупа справа вверху,
//    вместе со строкой поиска: с ней связаны режимы поиска разделов. Так кнопки сгруппированы по смыслу;
//  • щелчок по лупе или треугольнику — показать свой барабан вместо другого, второй щелчок — спрятать (у лупы —
//    вместе со строкой поиска); открыт поиск — на месте лупы логотип, в режиме раздела — значок раздела;
//    на телефоне барабан можно смахнуть вправо;
//  • кнопки — на барабане, как в игровом автомате или при выборе даты: размер у всех один, меняются
//    промежутки — в центре самые большие, к верху и низу всё меньше, кнопки уходят за край барабана
//    и темнеют. Барабан крутится колёсиком мыши или пальцем, по кругу; кнопка, проходя через центр,
//    притормаживает, после прокрутки барабан встаёт ближайшей кнопкой в центр;
//  • нажатие по центральной кнопке открывает её столбик, по любой другой — докручивает её в центр
//    и сразу открывает. Столбик — слева от барабана, по центру относительно кнопки; кнопки столбика
//    прижаты вправо, значок справа от названия. Глубина — один щелчок;
//  • кнопки цветные по группам (поле tone раздела): карты, линии (тропы, дороги), точки (места,
//    транспорт, магазины), фото, погода. Выключено — яркая заливка цвета группы, включено — светлая
//    и крестик в углу, он снимает всё в кнопке; выделенные кнопки столбика — тоже светлые;
//  • «Карты» — первая кнопка: в кружке миниатюра текущей карты, в столбике — виды карт (выбирается
//    одна, в кольце) и под чертой рельеф (тени и 3D, высоты) — их можно включать с любой картой;
//  • раздел (поле group модуля) — кнопка со слоями раздела; модуль с видами (поле menu: Транспорт,
//    Магазины, Тропы, Велодорожки, Дороги) — своя кнопка, отмечать можно несколько, снят последний
//    вид — слой выключается; если его название совпадает с названием раздела («Дороги») — остальные
//    слои раздела (железные дороги) в той же кнопке под видами;
//  • где цвет на карте что-то значит — значок кнопки столбика в кольце этого цвета (поле color);
//  • разделы с панелью (kind: "content"): у модуля поле column — { panel, load(), items(), choose(id),
//    isOpen(), close() } или своё home(ctx). Столбика у них нет (Грегори, 2026-11-02: «сразу панели, как
//    экскурсии или языки, в одном окне под окном поиска — проще прокрутка, если список вырастет»):
//    нажатие открывает панель слева с этим же списком (страны, языки; первой строкой — выбор файла или
//    папки); кнопка залита светлым, пока её панель открыта, крестик её закрывает.
// Ядро слоёв по именам не знает: новый модуль появляется сам; без известного раздела — в «Ещё».
// Включённые слои, какой барабан открыт и спрятан ли поиск — помнятся. Открылась панель настроек —
// барабан уступает место, и наоборот
import { closeOpen, homeList, isOpen as panelOpen, close as closePanel } from "./panel.js";
import { GEAR_ICON } from "./settings-panel.js";
import { ARROW as ROUTE_ARROW } from "./route.js";
import { backable } from "./back.js";
import { modules, toggle, available, allowed, onRegister, MODULES } from "./modules.js";
import { on, emit, current } from "./events.js";
import { BASEMAPS, currentBasemap, setBasemap, thumbOf } from "./basemaps.js";
import * as settings from "./settings.js";

const svg = (inner) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">${inner}</svg>`;
// разделы по порядку; значок не задан — берётся у первого модуля раздела. tone — цвет группы кнопок
const GROUPS = [
  { id: "places", title: "Места", tone: "points", icon: svg('<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>') },
  { id: "trails", title: "Тропы", tone: "lines" },
  { id: "roads", title: "Дороги", tone: "lines" },
  { id: "weather", title: "Погода", tone: "weather", icon: svg('<circle cx="8.5" cy="7.5" r="3.6"/><path d="M8.5 1.2v1.6M2.2 7.5h1.6M4 3l1.1 1.1M13 3l-1.1 1.1M4 12l1.1-1.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M18.4 12.6A5 5 0 0 0 9 11.3a4 4 0 0 0 .5 8H18a3.4 3.4 0 0 0 .4-6.7z" stroke="#fff" stroke-width="1.2"/>') },
  { id: "photo", title: "Фото", tone: "photo", icon: svg('<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>') },
  { id: "other", title: "Ещё", tone: "maps" },
];
// рельеф — в кнопке «Карты» (Грегори, 2026-10-29: «убираем рельеф к картам»)
const MAPS_GROUP = "relief";
const groupOf = (m) => (m.group === MAPS_GROUP ? MAPS_GROUP : GROUPS.some((g) => g.id === m.group) ? m.group : "other");
const BLOCKED = "Выключено в настройках: обращается в интернет";
const CLEAR_ICON = '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
// стопка листов — «Слои карты» (раньше — треугольник)
// «Десктоп» — спрятать всё, кроме карты (Грегори 2026-11-21)
const DESK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H3V4h18v12z"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27zm0 2.54l-7.38-5.73L3 14.07l9 7 9-7-1.63-1.27z"/></svg>';
// поиск места — лупа (Грегори 2026-11-06: «логотип на кнопке не используем, логично — лупа»)
const LUPA = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>';
// логотип (из travel-earth) — только при старте, до первого щелчка по кнопке (Грегори 2026-11-06)
const LOGO = '<img class="start-logo" src="icons/start-logo.png" alt="">';

// барабан: промежуток между кнопками в центре — GAP (Грегори, 2026-10-30: «расстояние между кнопками
// поменьше»), притормаживание у центра
const GAP = 54, DETENT = 0.7, BTN = 40;

export function initLayersPanel(ctx) {
  // ---------- слои ----------
  const active = new Set(settings.get("layers.on", []));
  const save = () => settings.set("layers.on", [...active]);
  const renderAll = () => drums.forEach((d) => d.render());

  const switchTo = async (m, turnOn) => {
    // exclusive — в своей группе одновременно включён один (у «Мест» такого нет: Грегори, 2026-10-28)
    if (turnOn && m.group && m.exclusive) {
      for (const other of modules("layer")) {
        if (other !== m && other.group === m.group && other.active) {
          await toggle(other.id, ctx, false).catch(() => {});
          active.delete(other.id);
        }
      }
    }
    const result = await toggle(m.id, ctx, turnOn).catch((err) => { ctx.status(`«${m.title}» не включился`); console.warn(err); return m.active; });
    result ? active.add(m.id) : active.delete(m.id);
    save();
    renderAll();
  };

  // кнопка столбика: название, значок справа (в кольце цвета слоя на карте, если цвет что-то значит;
  // у карт — миниатюра, выбранная — в кольце)
  const item = ({ title, icon, thumb, color, on: isOn, selected, blocked, hint, num, click }) => {
    const b = Object.assign(document.createElement("button"), { className: "layers-item" + (isOn ? " on" : "") + (selected ? " selected" : ""),
      disabled: blocked, title: blocked ? BLOCKED : hint || "" });
    b.innerHTML = `<span></span><i class="layers-icon${color ? " ring" : ""}${thumb ? " thumb" : ""}">${thumb ? '<img alt="">' : icon || ""}</i>`;
    b.firstChild.textContent = title;
    if (num) b.firstChild.dataset.num = num;
    if (thumb) b.querySelector("img").src = thumb;
    if (color) b.lastChild.style.borderColor = color;
    b.addEventListener("click", () => { b.disabled = true; click(); });
    return b;
  };

  // кнопка карусели — один модуль, где бы она ни стояла (Грегори 2026-11-21: «кнопки начнут повторяться, а реакция
  // должна быть одинаковой»): слой целиком — включить/выключить; вид модуля — отметить/снять (слой был выключен —
  // только этот вид, снят последний — слой выключается). related — связанные кнопки для следующей карусели
  const plainSpec = (p) => ({ key: p.id, title: p.title, icon: p.icon, color: p.color, on: p.active, blocked: !allowed(p), hint: p.hint,
    click: () => switchTo(p, !p.active), related: relatedOf(p) });
  const menuSpec = (m, it) => ({ key: `${m.id}#${it.id}`, title: it.title, icon: it.icon || m.icon, color: it.color, on: m.active && it.active, blocked: !allowed(m),
    click: () => {
      if (!m.active) { m.menu.choose(it.id); switchTo(m, true); }
      else switchTo(m, m.menu.toggle(it.id));
    } });
  // related модуля: [{ module, item? }] — слой целиком или вид слоя с меню
  const relatedOf = (p) => p.related && (() => p.related.map((r) => {
    const m = modules("layer").find((x) => x.id === r.module && available(x));
    const it = r.item && m?.menu?.items().find((i) => i.id === r.item);
    return !m ? null : r.item ? it && menuSpec(m, it) : plainSpec(m);
  }).filter(Boolean));

  // кнопки барабана слоёв: «Карты», потом разделы и модули с видами; раздел «Места» — свой барабан
  const PLACES = "places";
  const layerEntries = () => groupEntries((g) => g.id !== PLACES, true);
  const placeEntries = () => groupEntries((g) => g.id === PLACES, false);
  const groupEntries = (which, withMaps) => {
    const usable = modules("layer").filter(available).filter((m) => m.group !== "hidden");
    const maps = { key: "maps", title: "Карты", tone: "maps", maps: true, plain: usable.filter((m) => groupOf(m) === MAPS_GROUP) };
    return [...(withMaps ? [maps] : []), ...GROUPS.filter(which).flatMap((g) => {
      const mods = usable.filter((m) => groupOf(m) === g.id);
      const withMenu = mods.filter((m) => m.menu);
      let plain = mods.filter((m) => !m.menu);
      const host = withMenu.find((m) => m.title === g.title);
      const out = withMenu.map((m) => ({ key: m.id, title: m.title, icon: m.icon, tone: g.tone, module: m, plain: m === host ? plain : [] }));
      if (host) plain = [];
      if (plain.length) out.unshift({ key: g.id, title: g.title, icon: g.icon || plain[0].icon, tone: g.tone, plain });
      return out;
    })];
  };
  // кнопки барабана разделов — порядок как в MODULES (модули грузятся параллельно, регистрируются вразнобой)
  // первой — «Поиск места» (Грегори 2026-11-06: «в верхнем барабане не хватает кнопки Лупа»): выйти из
  // режима раздела в обычный поиск мест
  const SEARCH_ENTRY = { key: "search", title: "Поиск", icon: LUPA, tone: "maps", plain: [],
    content: { id: "search", column: { home: () => { emit("search-plain"); setSearch(true); emit("search-list"); },
      // светится, пока строка — обычный поиск мест (Грегори 2026-11-11: «кнопка не реагирует на нажатие, другие
      // меняются на инверсию»); крестик — спрятать строку поиска (навигация и разделы работают дальше)
      isOpen: () => searchOn && !mode, close: () => setSearch(false) } } };
  // последней — «Настройки» (Грегори 2026-11-06: «настройки в верхний барабан»)
  const SETTINGS_ENTRY = { key: "settings", title: "Настройки", icon: GEAR_ICON, tone: "maps", plain: [],
    content: { id: "settings", column: { home: () => emit("settings-open"), isOpen: () => panelOpen("settings"), close: () => closePanel("settings") } } };
  const contentEntries = () => [SEARCH_ENTRY, ...modules("content").filter(available)
    .sort((a, b) => MODULES.findIndex((p) => p.includes(a.id)) - MODULES.findIndex((p) => p.includes(b.id)))
    .map((m) => ({ key: m.id, title: m.title, icon: m.icon, tone: m.tone, content: m, plain: [] })), SETTINGS_ENTRY];

  // раздел: своё home(ctx), иначе панель слева со списком column.items()
  const openHome = async (m) => {
    const col = m.column;
    if (col.home) return col.home(ctx);
    const p = col.panel;
    const fill = () => {
      p.setTitle(m.title);
      p.body.replaceChildren(homeList(col.items(), (id) => col.choose(id, ctx)));
    };
    fill();
    p.body.scrollTop = 0;
    p.open();
    if (!col.loaded) {
      col.loaded = true;
      await col.load(ctx).catch(() => {});
      // пока грузилось, могли уйти дальше по разделу — тогда список не трогать
      if (col.isOpen() && p.body.firstChild?.classList?.contains("home-list")) fill();
    }
  };

  // ---------- какой барабан виден: "layers", "content" или ни один ----------
  // Грегори, 2026-11-02 («минимализм»): при первом запуске нет ни барабанов, ни строки поиска.
  // Треугольник: щелчок — барабан слоёв, второй щелчок — спрятать. Лупа справа вверху: щелчок — строка
  // поиска и барабан разделов, а на месте лупы — логотип (лупа уходит в строку поиска: двух луп быть не
  // должно); выбран раздел — вместо логотипа его значок; второй щелчок по логотипу или значку — закрыть всё
  const arrowBtn = Object.assign(document.createElement("button"), { className: "btn glass wheel-toggle", innerHTML: ARROW });
  const placesBtn = Object.assign(document.createElement("button"), { className: "btn glass places-toggle", innerHTML: GROUPS.find((g) => g.id === PLACES).icon });
  const lensBtn = Object.assign(document.createElement("button"), { className: "btn glass search-toggle" });
  const deskBtn = Object.assign(document.createElement("button"), { className: "btn glass desk-toggle", innerHTML: DESK });
  const controls = [arrowBtn, placesBtn, lensBtn, deskBtn];
  // барабаны — каждый своей кнопкой, один другой не прячет (Грегори 2026-11-12): разделы — лупой справа вверху
  // (вместе со строкой поиска), места и слои — кнопками внизу. На компьютере открытые делят высоту и не
  // пересекаются, на телефоне лежат стопкой: нажатие на кнопку нижнего — поднять его наверх, верхнего — закрыть
  // (Грегори 2026-11-21: «прикольно, что можно открыть много барабанов и поднимать их по слоям»)
  const opened = { content: false, places: false, layers: false };
  const BANDS = ["content", "places", "layers"]; // сверху вниз на компьютере
  let order = []; // открытые, последний — сверху
  let searchOn = false, mode = null, routeNow = null;
  const front = () => order.at(-1) || null;
  const phone = () => matchMedia("(max-width: 600px)").matches;
  const stacked = () => order.length > 1 && phone();
  // кнопка барабана внизу: открыт и сверху — белая
  const paintToggle = (b, name, title) => {
    const top = opened[name] && (!stacked() || front() === name);
    b.classList.toggle("open", top);
    b.title = !opened[name] ? title : top ? `Спрятать: ${title.toLowerCase()}` : `${title} — наверх`;
  };
  // «Поиск места» в барабане — светится вместе с обычным поиском (без перерисовки барабана)
  const litSearch = () => {
    const lit = searchOn && !mode;
    for (const c of document.querySelectorAll('[data-key="search"]')) { c.classList.toggle("on", lit); if (c.nextSibling) c.nextSibling.hidden = !lit; }
  };
  const paint = () => {
    litSearch();
    paintToggle(arrowBtn, "layers", "Слои карты");
    paintToggle(placesBtn, "places", "Места");
    // кнопка — ещё и индикатор режима строки поиска (Грегори 2026-11-04): режим есть — его значок, даже
    // при закрытом поиске (навигация включена — значок навигации)
    // поиск открыт — значок на цветном фоне; закрыт — сам значок цвета раздела на прозрачном (Грегори
    // 2026-11-05: «только цветной значок в пустом окне карты»); без раздела — логотип
    lensBtn.classList.toggle("idle", !searchOn);
    // есть цель пути — на кнопке крутящаяся стрелка к ней (Грегори 2026-11-06), цвета навигации
    const target = routeNow?.target;
    // стрелка — красная на белом (как была в карточке); режим — значок на цвете раздела; лупа — на белом
    const tone = target ? null : mode?.tone;
    lensBtn.style.background = tone && searchOn ? `var(--tone-${tone})` : "";
    lensBtn.style.color = tone && !searchOn ? `var(--tone-${tone})` : "";
    lensBtn.classList.toggle("mode", !!mode && !target);
    lensBtn.classList.toggle("open", !mode || !!target);
    // логотип — пока не открыты ни поиск, ни барабан разделов и нет режима (Грегори 2026-11-09: «если ни один
    // барабан не активен — лого»; открыт только барабан слоёв — тоже лого: нажатие откроет поиск)
    const logo = !mode && !target && !searchOn && !opened.content;
    lensBtn.classList.toggle("drop", logo);
    lensBtn.innerHTML = target ? `<span class="search-card-arrow" style="transform: rotate(${routeNow.me ? routeNow.arrow || 0 : 0}deg)">${ROUTE_ARROW}</span>`
      : mode ? mode.icon : logo ? LOGO : LUPA;
    lensBtn.title = opened.content && stacked() && front() !== "content" ? "Разделы — наверх" : searchOn || opened.content ? "Свернуть поиск и разделы" : "Поиск и разделы";
    deskBtn.classList.toggle("open", desk);
    deskBtn.title = desk ? "Вернуть кнопки и окна" : "Десктоп — только карта";
  };
  // открытый поиск — шаг для «Назад» телефона
  let searchBack = null;
  const setSearch = (search) => {
    if (search && !searchOn) searchBack = backable(() => { searchBack = null; setSearch(false); setDrum("content", false); });
    if (!search && searchBack) { const d = searchBack; searchBack = null; d(); }
    searchOn = search;
    document.body.classList.toggle("search-hidden", !searchOn);
    emit("search-shown", searchOn);
    settings.set("search.open", searchOn || null);
    paint();
  };
  // открыть/закрыть барабан; открытый — наверх
  const setDrum = (name, open) => {
    if (open && desk) setDesk(false);
    order = order.filter((n) => n !== name);
    if (open) { order.push(name); closeOpen("right"); }
    opened[name] = open;
    arrange();
  };
  // компьютер: у каждого барабана своё постоянное место сверху вниз (разделы, места, слои) вплотную, каждое — по
  // своим кнопкам (Грегори 2026-11-22: «прижми карусели друг к другу»), открыт он или нет: соседи не прыгают на
  // освободившееся место, закрытый уезжает со своего; не помещаются — места поровну. Телефон — стопкой
  function arrange() {
    for (const d of drums) {
      d.setOpen(opened[d.name]);
      d.wheel.classList.toggle("behind", stacked() && front() !== d.name);
      d.wheel.style.top = d.wheel.style.bottom = "";
    }
    const bands = BANDS;
    if (!phone()) {
      const r = drums[0].wheel.getBoundingClientRect(), need = bands.map((n) => drums.find((d) => d.name === n).need());
      // не помещаются — поровну: при сжатии по доле у короткого барабана оставалась одна кнопка
      const fits = need.reduce((a, b) => a + b, 0) <= r.bottom - r.top;
      let y = r.top;
      bands.forEach((n, k) => {
        const w = drums.find((d) => d.name === n).wheel, h = fits ? need[k] : (r.bottom - r.top) / bands.length;
        w.style.top = `${Math.round(y)}px`;
        w.style.bottom = `${Math.round(innerHeight - y - h)}px`;
        y += h;
      });
    }
    for (const d of drums) d.relayout();
    paint();
  }
  // кнопка барабана: закрыт — открыть; открыт, но лежит под другим (телефон) — наверх; иначе — закрыть
  // «Десктоп» (Грегори 2026-11-21: «прячется всё, кроме самой карты, маршрутов на карте и кнопок в левом нижнем
  // углу; окно поиска — в первую очередь»): класс desk-on у body прячет строку поиска, кнопки справа, барабаны,
  // карусели и окна, ничего не закрывая; ещё раз — всё как было
  let desk = false;
  const setDesk = (on) => { desk = on; document.body.classList.toggle("desk-on", on); paint(); };
  deskBtn.addEventListener("click", () => setDesk(!desk));
  const raise = (name) => { order = [...order.filter((n) => n !== name), name]; arrange(); };
  const toggleDrum = (name) => { if (opened[name] && stacked() && front() !== name) raise(name); else setDrum(name, !opened[name]); };
  arrowBtn.addEventListener("click", () => toggleDrum("layers"));
  placesBtn.addEventListener("click", () => toggleDrum("places"));
  // лупа: закрыто — поиск и разделы; разделы под другим барабаном (телефон) — наверх; иначе — свернуть поиск и разделы
  lensBtn.addEventListener("click", () => {
    if (opened.content && stacked() && front() !== "content") { raise("content"); return; }
    if (searchOn || opened.content) { setSearch(false); setDrum("content", false); } else { setSearch(true); setDrum("content", true); }
  });
  addEventListener("resize", () => arrange());
  on("search-mode", (m) => { mode = m; paint(); });
  // раздел живёт в самой строке поиска (навигация) — строка нужна. Барабан после выбора не закрывается —
  // он под рукой, открывает и закрывает его только кнопка справа вверху (Грегори 2026-11-06)
  // «Закрыть» в шапке истории поиска — как лупа: поиск и разделы свернуть
  on("search-hide", () => { setSearch(false); setDrum("content", false); }, { replay: false });
  on("search-show", () => { setDesk(false); setSearch(true); if (!order.length) setDrum("content", true); }, { replay: false });

  // ---------- барабан ----------
  // номер барабана: разделы — 1, места — 2, слои — 3; у кнопки — номер барабана и её место, у кнопки карусели —
  // ещё и её место в карусели: 3.2.4 (Грегори 2026-11-21: «пронумеровать все панели и их подпанели»)
  function makeDrum(name, entries) {
    const num = BANDS.indexOf(name) + 1;
    const wheel = Object.assign(document.createElement("div"), { className: `wheel wheel-${name} closed` });
    const drum = Object.assign(document.createElement("div"), { className: "wheel-drum" });
    wheel.append(drum);
    // подпись центральной кнопки — когда постоянные подписи выключены (Грегори, 2026-10-30)
    const tip = Object.assign(document.createElement("div"), { className: "wheel-tip" });
    document.body.append(wheel, tip);

    let isOpen = false;
    const setOpen = (open) => {
      if (open === isOpen) return;
      isOpen = open;
      wheel.classList.toggle("closed", !open);
      // подпись центральной кнопки — только при прокрутке и наведении, не сама после нажатия кнопок
      // (Грегори 2026-11-06: «убирай после выбора кнопок»)
      if (open) { R.layout(); liveLabels(true); } else { hideTip(); show(null); }
    };
    document.addEventListener("click", (e) => {
      // кнопку, по которой щёлкнули, могли уже перерисовать — это щелчок внутри, а не мимо
      if (!e.target.isConnected) return;
      if (openKey && !levels.some((l) => l.el.contains(e.target)) && !wheel.contains(e.target) && !controls.some((c) => c.contains(e.target))) show(null);
    });
    // Esc закрывает меню кнопки; сам барабан — нет: он под рукой, Esc («Назад») сначала закрывает окна
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen && openKey && !e.defaultPrevented) { e.preventDefault(); show(null); } });

    // барабан прижат к верху, к кнопкам справа вверху (Грегори 2026-11-21: «поднимаем карусели наверх»);
    // хватает кнопок на всю высоту — по середине
    const centerY = () => Math.min(drum.clientHeight / 2, R.geom().radius + BTN / 2 + 4);
    const R = rotor(drum, wheel, {
      centerY, shown: () => isOpen,
      onStart: () => { hideTip(); liveLabels(); if (openKey) show(null); },
      onSettle: () => { showTip(); liveLabels(true); },
      // на телефоне смахнуть вправо — спрятать барабан (кроме разделов: они с поиском)
      onSwipe: name === "content" ? null : () => setDrum(name, false),
    });

    // ---------- меню кнопки — карусели цепочкой вниз ----------
    // первая — меню кнопки барабана (Грегори 2026-11-21: «значки — кнопками, подписи вращаются вместе с ними; вид
    // и реакция на нажатие — одинаковые»); у центральной кнопки карусели есть связанные (related) и она включена —
    // ниже следующая карусель («после выбора горнолыжных спусков — третья карусель с профильными местами»).
    // Кнопка барабана закрывает всю цепочку. Следующая — в той же колонке, ниже на кнопку, а предыдущие уходят
    // вглубь с наклоном и без подписей (Грегори 2026-11-21: «один под другим со сдвигом вниз и отдалением нижнего
    // слоя в глубину… наклон усилит эффект»)
    const SHIFT = BTN + 12;
    let openKey = null;
    const levels = [];
    const level = (k) => {
      if (levels[k]) return levels[k];
      const el = Object.assign(document.createElement("div"), { className: `layers-sub carousel sub-${name}${k ? `-${k + 1}` : ""}`, hidden: true });
      document.body.append(el);
      const L = { el, k, key: null, specs: [], prefix: "", right: 0, cy: () => 0 };
      // центр первой карусели — вровень с кнопкой барабана, каждой следующей — ниже на SHIFT
      const cy = () => wheel.getBoundingClientRect().top + centerY() + k * SHIFT - el.getBoundingClientRect().top;
      L.R = rotor(el, el, {
        shown: () => !el.hidden,
        centerY: cy,
        onStart: () => { liveLabels(); closeFrom(k + 1); },
        onSettle: () => { liveLabels(true); chain(k); },
      });
      L.cy = cy;
      return (levels[k] = L);
    };
    // глубина — сколько открытых каруселей перед этой; уходит вглубь вокруг своей центральной кнопки
    const paintLevels = () => {
      const shown = levels.filter((L) => !L.el.hidden && !L.closing).length;
      for (const L of levels) {
        L.el.classList.toggle("covered", !L.el.hidden && !L.closing && L.k < shown - 1);
        L.el.style.setProperty("--depth", Math.max(0, shown - 1 - L.k));
        if (!L.el.hidden) L.el.style.transformOrigin = `calc(100% - ${BTN / 2}px) ${Math.round(L.cy())}px`;
      }
      document.body.classList.toggle("carousel-on", !!document.querySelector(".layers-sub.carousel:not([hidden])"));
    };
    // закрыть — уехать вверх, под предыдущую, и погаснуть, потом спрятать (Грегори 2026-11-21: «должны закрываться,
    // а не удаляться»); открыли снова, пока закрывается, — остаётся
    const closeFrom = (k) => {
      for (const L of levels.slice(k)) {
        if (L.el.hidden || L.closing) continue;
        L.el.classList.add("closing");
        L.closing = setTimeout(() => { L.el.hidden = true; L.el.classList.remove("closing"); L.closing = 0; paintLevels(); }, 250);
      }
      paintLevels();
    };
    // карусель k: кнопки specs; та же кнопка, что была (и после закрытия) — карусель стоит, где стояла, другая —
    // в центре первая включённая или выбранная, иначе первая
    function fill(k, key, prefix, specs, tone, wait = false) {
      const L = level(k);
      L.specs = specs;
      L.prefix = prefix;
      const buttons = specs.map((spec, j) => {
        const b = item({ ...spec, num: `${prefix}.${j + 1}` });
        // нажатие по кнопке не в центре — докрутить её в центр, действие — сразу (как у барабана)
        b.addEventListener("click", () => { if (!L.R.atCenter(j)) L.R.spinTo(j, () => chain(k)); });
        return b;
      });
      const cells = buttons.map((b) => { const cell = Object.assign(document.createElement("div"), { className: "wheel-cell" }); cell.append(b); return cell; });
      if (wait) cells.push(Object.assign(document.createElement("div"), { className: "wheel-cell layers-wait", textContent: "Загрузка…" }));
      // выделенные кнопки — светлой заливкой цвета группы
      L.el.style.setProperty("--tone", `var(--tone-${tone})`);
      // все — вплотную слева от барабана, одна под другой
      L.right = innerWidth - wheel.getBoundingClientRect().left;
      L.el.style.right = `${L.right}px`;
      clearTimeout(L.closing);
      L.closing = 0;
      L.el.classList.remove("closing");
      L.el.hidden = false;
      L.R.set(cells);
      if (L.key !== key) L.R.jump(Math.max(0, specs.findIndex((x) => x.on || x.selected)));
      L.key = key;
      paintLevels();
    }
    // за центральной кнопкой карусели k — её связанные кнопки (если она включена), иначе цепочка кончается
    function chain(k) {
      const L = levels[k];
      if (!L || L.el.hidden || L.closing) return;
      const i = L.R.centerIndex(), spec = L.specs[i];
      const next = spec?.on && spec.related?.();
      if (!next?.length) return closeFrom(k + 1);
      fill(k + 1, spec.key, `${L.prefix}.${i + 1}`, next, L.el.style.getPropertyValue("--tone").slice(11, -1));
      chain(k + 1);
    }

    let list = []; // кнопки барабана по порядку: { e, cell, c, x }
    function show(key) {
      openKey = key;
      if (key) { hideTip(); liveLabels(true); }
      for (const { e, c } of list) c.classList.toggle("open", e.key === key);
      const i = key ? list.findIndex((x) => x.e.key === key) : -1;
      if (i < 0) { closeFrom(0); return; }
      const e = list[i].e, m = e.module;
      const cur = currentBasemap();
      const col = e.content?.column;
      // раздел с панелью: список подгружается при первом открытии меню
      if (col && !col.loaded) {
        col.loaded = true;
        col.load(ctx).catch(() => {}).finally(() => openKey === key && show(key));
      }
      const colItems = col ? col.items() : [];
      fill(0, key, `${num}.${i + 1}`, [
        ...colItems.map((it) => ({ key: it.id, title: it.title, thumb: it.thumb, icon: it.icon, selected: it.selected, hint: it.hint,
          click: () => { col.choose(it.id, ctx); show(null); } })),
        ...(e.maps ? BASEMAPS.map((b) => ({ key: b.id || b.name, title: b.name, thumb: thumbOf(b), selected: b === cur, hint: b.hint,
          click: () => { setBasemap(b); show(openKey); } })) : []),
        ...(m ? m.menu.items().map((it) => menuSpec(m, it)) : []),
        ...e.plain.map(plainSpec),
      ], e.tone, col && !colItems.length);
      chain(0);
    }

    // подпись центральной кнопки: встал барабан или навели мышь — видна пару секунд (постоянные подписи выключены)
    let tipTimer = 0;
    const labelsOn = () => !document.body.classList.contains("labels-off");
    function showTip() {
      clearTimeout(tipTimer);
      const l = list[R.centerIndex()];
      if (!isOpen || openKey || !l || R.dragged() || labelsOn()) return hideTip();
      tip.textContent = l.c.ariaLabel;
      const r = l.c.getBoundingClientRect();
      tip.style.right = `${innerWidth - r.left + 8}px`;
      tip.style.top = `${r.top + r.height / 2}px`;
      tip.classList.add("show");
      tipTimer = setTimeout(hideTip, 2500);
    }
    function hideTip() {
      clearTimeout(tipTimer);
      tip.classList.remove("show");
    }
    addEventListener("resize", () => { hideTip(); R.layout(); if (openKey) show(openKey); });

    // ---------- кнопки барабана ----------
    const render = () => {
      const centered = list[R.centerIndex()]?.e.key;
      list = entries().map((e, idx) => {
        const cell = Object.assign(document.createElement("div"), { className: "layers-cell wheel-cell" });
        const c = Object.assign(document.createElement("button"), { className: `btn layers-circle tone-${e.tone}` });
        c.ariaLabel = e.title;
        if (e.maps) {
          c.classList.add("maps-circle");
          c.innerHTML = '<img alt="">';
          c.firstChild.src = thumbOf(currentBasemap());
          c.ariaLabel = `Карты: ${currentBasemap().name}`;
        } else c.innerHTML = e.icon;
        const x = Object.assign(document.createElement("button"), { className: "layers-clear", title: "Снять всё", hidden: true, innerHTML: CLEAR_ICON });
        // постоянная подпись с номером — слева от кнопки, крутится вместе с ней; не нажимается — под ней карта
        const label = Object.assign(document.createElement("span"), { className: "wheel-label", textContent: e.title });
        label.dataset.num = `${num}.${idx + 1}`;
        cell.append(label, c, x);
        // у модуля с видами в подсказке — выбранный вид
        const chosen = e.module?.menu.label();
        if (chosen && chosen !== e.title) c.ariaLabel = `${e.title}: ${chosen}`;
        c.dataset.key = e.key;
        c.addEventListener("mouseenter", () => list[R.centerIndex()]?.c === c && R.settled() && showTip());
        const anyOn = !!e.module?.active || e.plain.some((m) => m.active) || !!e.content?.column.isOpen() || (e.key === "content/navigation" && !!routeNow?.target);
        c.classList.toggle("on", anyOn);
        x.hidden = !anyOn;
        // крестик: выключить всё в кнопке, забыть отмеченные виды и закрыть меню (Грегори, 2026-10-29:
        // «при нажатии на крестик сброса панель сворачивать»)
        x.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          x.disabled = true;
          show(null);
          for (const m of [e.module, ...e.plain]) if (m?.active) await switchTo(m, false);
          e.content?.column.close();
          e.module?.menu.clear?.();
          render();
        });
        // центральная — открыть или закрыть меню; другая — докрутить в центр и сразу открыть
        c.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const i = list.findIndex((l) => l.e.key === e.key);
          // раздел — сразу его панель; слой — меню. Окно раздела уже открыто — кнопка его сворачивает и
          // разворачивает; у навигации с целью — карточку пути (как раньше значки в столбике под логотипом)
          const act = () => {
            if (!e.content) return show(openKey === e.key ? null : e.key);
            show(null);
            // стрелка пути — ко мне: 3D, 200 м, по ходу (Грегори 2026-11-21: «это как начать»); уже так — карточка пути
            if (e.key === "content/navigation" && routeNow?.target) {
              const g = window.atlas?.geo?.state();
              // навигация выключена — только карточка (сама навигацию не включает); карточка открыта — ко мне (она
              // свернётся); список точек маршрута или уже веду стрелкой — карточка
              if (g?.on && current("route-card")?.open) emit("nav-position", { mode: "arrow" });
              else if (!g?.on || g.hold || (g.follow && g.pos === "arrow")) { if (!searchOn) setSearch(true); emit("route-card-toggle"); }
              else emit("nav-position", { mode: "arrow" });
              return;
            }
            // «Поиск» — всегда его история (уже выбран — тоже), чтобы было видно, что выбор сработал
            if (e.key !== "content/navigation" && e.key !== "search" && e.content.column.isOpen()) { emit("panel-fold-request", { fold: !folded }); return; }
            openHome(e.content);
          };
          // не в центре — докрутить и выполнить сразу, не дожидаясь конца прокрутки (пока карта летит, кадры
          // редкие, и окно открывалось с задержкой)
          if (!R.atCenter(i)) R.spinTo(i, () => {}); // пустое «по приезде» — без подписи
          act();
        });
        return { e, cell, c, x };
      });
      R.set(list.map((l) => l.cell));
      // перерисовка не сдвигает барабан: в центре — та же кнопка
      const keep = list.findIndex((l) => l.e.key === centered);
      if (keep >= 0 && keep !== R.centerIndex()) R.jump(keep);
      if (openKey) show(openKey);
    };
    return { name, setOpen, render, wheel, need: () => R.need(), relayout: () => { if (isOpen) { R.layout(); if (openKey) show(openKey); } } };
  }

  const drums = [makeDrum("layers", layerEntries), makeDrum("places", placeEntries), makeDrum("content", contentEntries)];

  // свёрнуто ли окно раздела; цель пути — стрелка на кнопке справа вверху, кнопка навигации в барабане светится
  let folded = null;
  on("panel-fold", (f) => { folded = f; }, { replay: false });
  on("route", (r) => {
    const same = routeNow?.target === r?.target && routeNow?.me === r?.me;
    const sameTarget = routeNow?.target === r?.target;
    routeNow = r;
    // стрелка крутится с картой и со мной — только повернуть её, не перерисовывая кнопку
    const a = same && lensBtn.querySelector(".search-card-arrow");
    if (a) a.style.transform = `rotate(${r.me ? r.arrow || 0 : 0}deg)`; else paint();
    if (!sameTarget) renderAll();
  });
  document.body.append(arrowBtn, placesBtn, lensBtn, deskBtn);

  // подписи и номера кнопок барабанов и каруселей — в Настройках (Грегори 2026-11-21: «пункты видимости подписей»)
  const paintLabels = () => {
    document.body.classList.toggle("labels-off", settings.get("ui.labels") === false);
    // номера — для наладки, по умолчанию выключены (Грегори 2026-11-21)
    document.body.classList.toggle("numbers-off", settings.get("ui.numbers") !== true);
  };
  paintLabels();
  on("button-labels", paintLabels, { replay: false });

  // столбик кнопок барабана или карусели — карта в нём не приближается (Грегори 2026-11-21: «запретить зум карты
  // в районе каруселей»): колёсико над ним крутит барабан или карусель, щипок двумя пальцами и двойной щелчок —
  // ничего. Над подписями — карта, как везде
  const zoneAt = (x, y) => {
    if (document.body.classList.contains("desk-on")) return null;
    // передняя (открытая последней) карусель — первой (Грегори 2026-11-21: «фокус не переходит на соседнюю карусель»)
    for (const el of [...document.querySelectorAll(".wheel:not(.closed):not(.behind), .layers-sub.carousel:not([hidden]):not(.closing)")].reverse()) {
      const box = el.getBoundingClientRect();
      if (y < box.top || y > box.bottom || x > box.right) continue;
      // только столбик самих кнопок, подписи — нет (Грегори 2026-11-22: «с чего ты взял, что подписи должны забирать
      // фокус? Это больше половины экрана на телефоне… реакция только на область самих каруселей»)
      const sel = el.classList.contains("wheel") ? ".wheel-cell:not([hidden]) .layers-circle" : ".wheel-cell:not([hidden]) .layers-icon";
      const parts = [...el.querySelectorAll(sel)].map((c) => c.getBoundingClientRect()).filter((r) => r.width);
      if (!parts.length || y < Math.min(...parts.map((r) => r.top)) - 8 || y > Math.max(...parts.map((r) => r.bottom)) + 8) continue;
      if (x >= Math.min(...parts.map((r) => r.left)) - 8 && x <= Math.max(...parts.map((r) => r.right)) + 8) return el;
    }
    return null;
  };
  addEventListener("wheel", (e) => {
    const zone = e.isTrusted && zoneAt(e.clientX, e.clientY);
    // над кнопкой любой карусели или барабана — крутится она сама
    if (!zone || e.target.closest?.(".wheel, .layers-sub.carousel")) return;
    e.preventDefault();
    e.stopPropagation();
    zone.dispatchEvent(new WheelEvent("wheel", { deltaY: e.deltaY, deltaMode: e.deltaMode, clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true }));
  }, { capture: true, passive: false });
  addEventListener("dblclick", (e) => { if (zoneAt(e.clientX, e.clientY)) e.stopPropagation(); }, true);
  // мышь: подписи — у того барабана или карусели, над чьими кнопками она сейчас, ушла — сразу гаснут
  // (Грегори 2026-11-22: «включай подписи при наведении мыши на конкретный барабан и выключай с затуханием
  // сразу после потери фокуса без задержки»)
  let hoverFrame = 0;
  const hoverLabels = (x, y) => {
    const z = x === null ? null : zoneAt(x, y);
    for (const el of document.querySelectorAll(".labels-here")) if (el !== z) el.classList.remove("labels-here");
    z?.classList.add("labels-here");
  };
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    mouseUser = true;
    cancelAnimationFrame(hoverFrame);
    hoverFrame = requestAnimationFrame(() => hoverLabels(e.clientX, e.clientY));
  }, { passive: true });
  document.addEventListener("pointerleave", () => { cancelAnimationFrame(hoverFrame); hoverLabels(null); });
  const pinch = (e) => {
    if (e.touches.length > 1 && [...e.touches].some((t) => zoneAt(t.clientX, t.clientY))) { e.preventDefault(); e.stopPropagation(); }
  };
  addEventListener("touchstart", pinch, { capture: true, passive: false });
  addEventListener("touchmove", pinch, { capture: true, passive: false });

  // слой включился не отсюда (сам по себе, по событию другого модуля) — кнопки обновить
  // включился другим слоем («Горнолыжные спуски» включают «Транспорт») — помнить до следующего запуска;
  // выключился не из-за запрета сети — забыть
  on("module", ({ id, on: isOn, by, keep }) => {
    if (isOn && by && !active.has(id)) { active.add(id); save(); }
    else if (!isOn && !keep && active.delete(id)) save();
    renderAll();
  }, { replay: false });
  on("basemap", renderAll, { replay: false });
  on("panel", () => renderAll(), { replay: false });
  onRegister(renderAll);
  renderAll();
  // при старте всё закрыто (Грегори 2026-11-06: «при старте все панели и барабаны закрыты»); барабан
  // разделов — «Поиском места» в центре (первая кнопка)
  setSearch(false);
  arrange();

  // разрешили сеть снова — включить то, что было включено до запрета
  on("modules", async () => {
    for (const id of active) {
      const m = modules().find((x) => x.id === id);
      if (m && !m.active && allowed(m)) await toggle(id, ctx, true).catch(() => {});
    }
    renderAll();
  }, { replay: false });

  // включённое с прошлого раза — после загрузки карты
  ctx.map.once("load", async () => {
    for (const id of active) await toggle(id, ctx, true).catch(() => {});
    renderAll();
  });
  // смена стиля карты сбрасывает слои — включить заново
  ctx.map.on("style.load", () => {
    for (const m of modules("layer")) if (m.active) m.enable?.(ctx);
  });
}

// барабан: кнопки по дуге, как в игровом автомате или при выборе даты — размер у всех один, меняются промежутки: в центре
// самые большие, к верху и низу всё меньше, кнопки уходят за край и темнеют. Крутится колёсиком мыши или пальцем, по
// кругу; кнопка, проходя через центр, притормаживает, после прокрутки барабан встаёт ближайшей кнопкой в центр.
// Один и тот же у барабанов и у карусели меню (Грегори 2026-11-21: «вид и реакция на нажатие — одинаковые»).
// box — где кнопки (его высота — высота барабана), el — что слушает колёсико и палец; centerY() — где центр,
// подписи барабанов видны, пока крутят, и 2 с после (Грегори 2026-11-22: «подписи показывать только при вращении
// карусели и через 3 с гасить», потом — «уменьши до 2 с»): fade = true — начать отсчёт, иначе — держать
// с мышью — нет: там подписи по наведению (labels-here). Мышь или палец — по тому, чем трогали последним
// (сенсорный экран — пока не тронули — палец)
let liveTimer = 0, mouseUser = !navigator.maxTouchPoints;
addEventListener("pointerdown", (e) => { mouseUser = e.pointerType === "mouse"; }, { capture: true, passive: true });
function liveLabels(fade) {
  if (mouseUser) return;
  clearTimeout(liveTimer);
  document.body.classList.add("labels-live");
  if (fade) liveTimer = setTimeout(() => document.body.classList.remove("labels-live"), 2000);
}

// shown() — виден ли; onStart — начали крутить, onSettle — встал после прокрутки, onSwipe — смахнули вправо
function rotor(box, el, { centerY, shown, onStart = () => {}, onSettle = () => {}, onSwipe = null }) {
  let cells = [];
  // raw — положение в кнопках (0 — первая в центре), растёт при прокрутке вниз; на экране — с притормаживанием
  // у центра: возле целого значения кнопки движутся медленнее
  let raw = 0, target = 0, frame = 0, onArrive = null;
  const n = () => cells.length;
  // промежуток в центре — GAP; кнопок хватает — барабан на всю высоту, мало — короче и без повторов по кругу,
  // видны все (n/2 + ½: иначе крайняя встаёт ровно на край барабана и прячется — у четырёх разделов не было «Треков»)
  const geom = () => {
    const full = box.clientHeight / 2 - BTN / 2 - 4;
    const half = Math.max(1, Math.min(n() / 2 + 0.5, Math.PI / 2 / Math.asin(Math.min(1, GAP / full))));
    const step = Math.PI / 2 / half;
    return { step, radius: Math.min(full, GAP / Math.sin(step)) };
  };
  // дуги по бокам столбика — видна рабочая область, вместе с подписями (Грегори 2026-11-22, рисунок: «показывал бы
  // эти дуги вместе с подписями кнопок во время вращения… потом раствориться»)
  const arc = Object.assign(document.createElement("div"), { className: "wheel-arc" });
  const shownAt = (v) => v - (DETENT * Math.sin(2 * Math.PI * v)) / (2 * Math.PI);
  const wrap = (d) => { const k = n(); return ((d % k) + k + k / 2) % k - k / 2; };
  const centerIndex = () => ((Math.round(raw) % n()) + n()) % n();

  function layout() {
    if (!n() || !shown()) return;
    const cy = centerY(), { radius, step } = geom();
    if (!arc.isConnected) box.append(arc);
    Object.assign(arc.style, { top: `${Math.round(cy - radius - BTN / 2 - 6)}px`, height: `${Math.round(2 * radius + BTN + 12)}px` });
    const off = shownAt(raw);
    cells.forEach((cell, i) => {
      const a = wrap(i - off) * step;
      if (Math.abs(a) >= Math.PI / 2) { cell.hidden = true; return; }
      const k = Math.cos(a);
      cell.hidden = false;
      cell.style.transform = `translateY(${cy + radius * Math.sin(a) - BTN / 2}px)`;
      // к краям барабана — темнее и прозрачнее, центральная — сверху
      cell.style.filter = `brightness(${0.55 + 0.45 * k})`;
      cell.style.opacity = String(Math.min(1, 0.25 + k));
      cell.style.zIndex = String(Math.round(k * 100));
    });
  }

  const animate = () => {
    cancelAnimationFrame(frame);
    const tick = () => {
      const d = target - raw;
      if (Math.abs(d) < 0.002) {
        raw = target;
        layout();
        const done = onArrive; onArrive = null;
        // докрутили щелчком — кнопку выбрали; встали после прокрутки — onSettle (подпись)
        if (done) done(); else onSettle();
        return;
      }
      raw += d * 0.18;
      layout();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };
  // докрутить кнопку i в центр — кратчайшим путём по кругу
  const spinTo = (i, then) => {
    target = Math.round(raw) + wrap(i - Math.round(raw));
    onArrive = then;
    animate();
  };

  // колёсико: шаг колёсика — кнопка; остановились — барабан встаёт кнопкой в центр
  let snapTimer = 0;
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    onStart();
    target += e.deltaY / (e.deltaMode === 1 ? 3 : 100);
    onArrive = null;
    animate();
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => { target = Math.round(target); animate(); }, 160);
  }, { passive: false });

  // палец и мышь: тянуть вверх-вниз, с разгоном
  let drag = null, suppressClick = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, raw, t: performance.now(), v: 0, moved: false, id: e.pointerId };
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (onSwipe && dx > 40 && Math.abs(dx) > 2 * Math.abs(dy)) { drag = null; suppressClick = true; onSwipe(); return; }
      if (Math.abs(dy) < 6) return;
      drag.moved = true;
      el.setPointerCapture(e.pointerId);
      onStart();
      cancelAnimationFrame(frame);
    }
    const { radius, step: a } = geom(), step = radius * a; // промежуток в центре
    const now = performance.now(), next = drag.raw - dy / step;
    drag.v = (next - raw) / Math.max(1, now - drag.t);
    drag.t = now;
    raw = target = next;
    layout();
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) {
      suppressClick = true;
      // разгон — ещё до ~3 кнопок, потом ближайшая встаёт в центр
      target = Math.round(raw + Math.max(-3, Math.min(3, drag.v * 250)));
      animate();
    }
    drag = null;
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
  el.addEventListener("click", (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);

  return {
    set: (list) => { cells = list; box.replaceChildren(...list); layout(); },
    jump: (i) => { cancelAnimationFrame(frame); onArrive = null; raw = target = i; layout(); },
    layout, spinTo, centerIndex, geom,
    // высота, в которую встают все кнопки без повторов по кругу (как geom() у высокого барабана)
    need: () => { const step = Math.PI / 2 / (n() / 2 + 0.5); return 2 * Math.min(GAP / Math.sin(step), 400) + BTN + 8; },
    settled: () => Math.abs(raw - target) < 0.01,
    atCenter: (i) => i === centerIndex() && Math.abs(raw - Math.round(raw)) < 0.01,
    dragged: () => !!drag?.moved,
  };
}

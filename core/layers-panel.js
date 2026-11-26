// Кнопки — колёса-барабаны справа вверху, под своими кнопками (Грегори 2026-11-22, «тающие карусели»):
//  • кнопки столбиком: лупа — барабан разделов (Экскурсии, Языки, Треки, Фото) вместе со строкой поиска,
//    «Места» (Места, Транспорт, Магазины, Спорт), «Слои»;
//  • открыт один барабан: выезжает из своей кнопки вниз, кнопки ниже сдвигаются на его высоту; нажали кнопку
//    другого — открытый сворачивается сразу (с анимацией); второй щелчок по своей — спрятать (у лупы — вместе со
//    строкой поиска); открыт поиск — на месте лупы логотип; на телефоне барабан можно смахнуть вправо;
//  • меню кнопки — карусель на том же месте, барабан уходит вглубь и вправо, но виден; у карусели своя — так же;
//  • таяние: нет мыши над барабаном и пальца — через 5 с шаг назад (карусель растворяется, прежняя возвращается
//    справа), ещё через 5 с — следующий, пока не растает барабан; тогда кнопки поднимаются на места;
//  • подписи — пока мышь над барабаном или его крутят, ушла — сразу гаснут; новая карусель показывает их 2 с;
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
//    isOpen(), close(), shown()? } или своё home(ctx). Столбика у них нет (Грегори, 2026-11-02: «сразу панели, как
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
import { playerButton } from "./player-window.js";

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
const ARROW = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27zm0 2.54l-7.38-5.73L3 14.07l9 7 9-7-1.63-1.27z"/></svg>';
// поиск места — лупа (Грегори 2026-11-06: «логотип на кнопке не используем, логично — лупа»)
const LUPA = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>';
// логотип (из travel-earth) — только при старте, до первого щелчка по кнопке (Грегори 2026-11-06)
const LOGO = '<img class="start-logo" src="icons/start-logo.png" alt="">';

// барабан: промежуток между кнопками в центре — GAP (Грегори, 2026-10-30: «расстояние между кнопками
// поменьше»), притормаживание у центра
const GAP = 54, DETENT = 0.7, BTN = 40;
// наклон барабана и отступ дуг от середины кнопок (core/style.css: подписи — дальше дуги)

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

  // ---------- какой барабан открыт: "content", "places", "layers" или ни один ----------
  // Грегори, 2026-11-02 («минимализм»): при первом запуске нет ни барабанов, ни строки поиска.
  // Лупа справа вверху: щелчок — строка поиска и барабан разделов, а на месте лупы — логотип (лупа уходит в строку
  // поиска: двух луп быть не должно); выбран раздел — вместо логотипа его значок; второй щелчок — закрыть всё
  const arrowBtn = Object.assign(document.createElement("button"), { className: "btn glass wheel-toggle", innerHTML: ARROW });
  const placesBtn = Object.assign(document.createElement("button"), { className: "btn glass places-toggle", innerHTML: GROUPS.find((g) => g.id === PLACES).icon });
  const lensBtn = Object.assign(document.createElement("button"), { className: "btn glass search-toggle" });
  const playerBtn = playerButton(); // четвёртая — плеер, под кнопками барабанов
  // тающие карусели (Грегори 2026-11-22): открыт один барабан — он выезжает из своей кнопки вниз и сдвигает кнопки
  // ниже; нажали кнопку другого — открытый сразу сворачивается. Нет над ним мыши и пальца — через 5 с шаг назад
  // (карусель растворяется, справа возвращается предыдущая), и так каждые 2 с, пока не растает сам барабан; тогда
  // кнопки поднимаются на свои места
  const BANDS = ["content", "places", "layers"]; // кнопки сверху вниз
  const btnOf = { content: lensBtn, places: placesBtn, layers: arrowBtn };
  let openName = null;
  let placeStrip = () => {}; // полоса справа — ставится ниже, у столбика барабанов
  const drumOf = (n) => drums.find((d) => d.name === n);
  let searchOn = false, mode = null, routeNow = null;
  // кнопка барабана: открыт — белая
  const paintToggle = (b, name, title) => {
    b.classList.toggle("open", openName === name);
    b.title = openName === name ? `Спрятать: ${title.toLowerCase()}` : title;
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
    const logo = !mode && !target && !searchOn && openName !== "content";
    lensBtn.classList.toggle("drop", logo);
    lensBtn.innerHTML = target ? `<span class="search-card-arrow" style="transform: rotate(${routeNow.me ? routeNow.arrow || 0 : 0}deg)">${ROUTE_ARROW}</span>`
      : mode ? mode.icon : logo ? LOGO : LUPA;
    // включён раздел — его название (Грегори 2026-11-26: «на кнопке Поиск и разделы пиши подпись выбранного раздела»)
    lensBtn.title = mode && !target ? (openName === "content" ? `${mode.title} — свернуть разделы` : mode.title)
      : openName === "content" ? "Свернуть поиск и разделы" : "Поиск и разделы";
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
  // открыть барабан (открытый другой — свернуть) или закрыть
  const setDrum = (name, open) => {
    if (open) {
      if (openName && openName !== name) drumOf(openName).setOpen(false);
      openName = name;
      closeOpen("right");
    } else if (openName === name) openName = null;
    drumOf(name).setOpen(open);
    arrange();
    melt();
  };
  // открытый барабан — под своей кнопкой, высотой по своим кнопкам (не помещаются — до низа экрана), кнопки ниже
  // сдвинуты на его высоту; видна карусель — по её кнопкам
  function arrange() {
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gap")) || 10;
    let shift = 0;
    BANDS.forEach((n, i) => {
      const b = btnOf[n];
      b.style.transform = shift ? `translateY(${shift}px)` : "";
      if (n !== openName) return;
      // offsetTop — место кнопки без сдвига
      const top = b.offsetTop + b.offsetHeight + gap, below = BANDS.length - i; // и плеер
      const room = innerHeight - top - below * (b.offsetHeight + gap) - 2 * gap - b.offsetHeight;
      const d = drumOf(n), h = Math.round(Math.max(BTN + 2 * gap, Math.min(d.need(), room)));
      d.place(top, h);
      shift = h + gap;
    });
    playerBtn.style.transform = shift ? `translateY(${shift}px)` : "";
    for (const d of drums) d.relayout();
    placeStrip();
    paint();
  }
  const toggleDrum = (name) => setDrum(name, openName !== name);
  arrowBtn.addEventListener("click", () => toggleDrum("layers"));
  placesBtn.addEventListener("click", () => toggleDrum("places"));
  // лупа: барабан разделов закрыт — поиск и разделы; открыт — свернуть и то, и другое
  lensBtn.addEventListener("click", () => {
    if (openName === "content") { setSearch(false); setDrum("content", false); } else { setSearch(true); setDrum("content", true); }
  });
  addEventListener("resize", () => arrange());
  on("search-mode", (m) => { mode = m; paint(); });
  // раздел живёт в самой строке поиска (навигация) — строка нужна
  // «Закрыть» в шапке истории поиска — как лупа: поиск и разделы свернуть
  on("search-hide", () => { setSearch(false); setDrum("content", false); }, { replay: false });
  on("search-show", () => { setSearch(true); if (!openName) setDrum("content", true); }, { replay: false });

  // ---------- таяние ----------
  // новый барабан или карусель — подписи видны 2 с (Грегори 2026-11-22: «с подписью кнопок на 2 с»)
  const intro = (el) => {
    el.classList.add("labels-intro");
    clearTimeout(el.introTimer);
    el.introTimer = setTimeout(() => el.classList.remove("labels-intro"), 2000);
  };
  // мышь над видимым барабаном или каруселью, палец на нём или он ещё крутится — стоит; иначе через 5 с шаг назад.
  // window.__holdDrums — для проверок: не таять
  let meltTimer = 0, spin = false, pressed = false, hovered = null;
  function melt() {
    clearTimeout(meltTimer);
    const d = openName && drumOf(openName);
    if (!d || window.__holdDrums || spin || pressed || hovered === d.top()) return;
    meltTimer = setTimeout(() => { if (d.depth()) d.back(); else setDrum(d.name, false); }, 5000);
  }
  const spinning = (on) => { spin = on; liveLabels(on); melt(); };

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
      if (open) { wheel.classList.remove("away"); R.layout(); intro(wheel); return; }
      // сворачивается сразу, вместе с каруселями
      hideTip();
      closeFrom(0, false);
      setTimeout(() => { if (!isOpen) wheel.classList.remove("away"); }, 300);
    };
    // Esc — шаг назад по каруселям; сам барабан — нет: Esc («Назад») сначала закрывает окна
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen && stack.length && !e.defaultPrevented) { e.preventDefault(); back(); } });

    // хватает кнопок на всю высоту — по середине, иначе прижат к верху, к своей кнопке
    const centerY = () => Math.min(drum.clientHeight / 2, R.geom().radius + BTN / 2 + 4);
    const R = rotor(drum, wheel, {
      centerY, shown: () => isOpen,
      onStart: () => { hideTip(); spinning(true); },
      onSettle: () => { showTip(); spinning(false); },
      // на телефоне смахнуть вправо — спрятать барабан (кроме разделов: они с поиском)
      onSwipe: name === "content" ? null : () => setDrum(name, false),
    });

    // ---------- карусели — на месте барабана ----------
    // меню кнопки барабана — карусель (Грегори 2026-11-21: «значки — кнопками, подписи вращаются вместе с ними; вид
    // и реакция на нажатие — одинаковые»); включили кнопку со связанными (related) — их карусель («после выбора
    // горнолыжных спусков — третья карусель с профильными местами»). Новая встаёт на то же место, прежняя уходит
    // вглубь и вправо, но видна (2026-11-23); шаг назад — новая растворяется, прежняя возвращается (Грегори 2026-11-22)
    const stack = []; // открытые карусели по порядку: { key, prefix, build, tone }; видна последняя, нет ни одной — барабан
    const levels = [];
    const top = () => (stack.length ? levels[stack.length - 1].el : wheel);
    const level = (k) => {
      if (levels[k]) return levels[k];
      const el = Object.assign(document.createElement("div"), { className: `layers-sub carousel sub-${name}${k ? `-${k + 1}` : ""}`, hidden: true });
      document.body.append(el);
      const L = { el, k, key: null, specs: [] };
      L.R = rotor(el, el, {
        shown: () => !el.hidden,
        centerY: () => Math.min(el.clientHeight / 2, L.R.geom().radius + BTN / 2 + 4),
        onStart: () => spinning(true),
        onSettle: () => spinning(false),
        onSwipe: () => back(),
      });
      return (levels[k] = L);
    };
    // и глубина ушедших: барабан и каждая карусель — на сколько шагов позади текущей
    const paintKeys = () => {
      for (const { e, c } of list) c.classList.toggle("open", e.key === stack[0]?.key);
      wheel.style.setProperty("--depth", stack.length);
      stack.forEach((f, k) => levels[k]?.el.style.setProperty("--depth", stack.length - 1 - k));
    };
    // карусели с k-й — раствориться и спрятаться; наверху остаётся предыдущая (или барабан) — приезжает справа
    const closeFrom = (k, ret = true) => {
      for (const L of levels.slice(k)) {
        if (L.el.hidden || L.melting) continue;
        L.el.classList.add("melting");
        L.melting = setTimeout(() => { L.el.hidden = true; L.el.classList.remove("melting", "away"); L.melting = 0; }, 300);
      }
      stack.length = Math.min(stack.length, k);
      if (ret) top().classList.remove("away");
      paintKeys();
    };
    const push = (frame) => {
      const k = stack.length;
      top().classList.add("away");
      hideTip();
      stack.push(frame);
      fill(k, frame);
      levels[k].el.classList.remove("away");
      intro(levels[k].el);
      paintKeys();
      arrange();
      melt();
    };
    function back() { closeFrom(stack.length - 1); arrange(); melt(); }
    // карусель k: кнопки build(); та же кнопка, что была (и после закрытия) — карусель стоит, где стояла, другая —
    // в центре первая включённая или выбранная, иначе первая
    function fill(k, { key, prefix, build, tone }) {
      const L = level(k), specs = build();
      L.specs = specs;
      const buttons = specs.map((spec, j) => {
        const b = item({ ...spec, num: `${prefix}.${j + 1}`, click: () => {
          spec.click();
          // включили кнопку со связанными — их карусель на место этой
          const next = !spec.on && spec.related?.();
          if (next?.length) push({ key: spec.key, prefix: `${prefix}.${j + 1}`, build: spec.related, tone });
        } });
        // нажатие по кнопке не в центре — докрутить её в центр, действие — сразу (как у барабана)
        b.addEventListener("click", () => { if (!L.R.atCenter(j)) L.R.spinTo(j, () => {}); });
        return b;
      });
      const cells = buttons.map((b) => { const cell = Object.assign(document.createElement("div"), { className: "wheel-cell" }); cell.append(b); return cell; });
      // выделенные кнопки — светлой заливкой цвета группы
      L.el.style.setProperty("--tone", `var(--tone-${tone})`);
      clearTimeout(L.melting);
      L.melting = 0;
      L.el.classList.remove("melting");
      L.el.hidden = false;
      L.R.set(cells);
      if (L.key !== key) L.R.jump(Math.max(0, specs.findIndex((x) => x.on || x.selected)));
      L.key = key;
    }

    let list = []; // кнопки барабана по порядку: { e, cell, c, x }
    // меню кнопки барабана; null — назад к барабану
    function show(key) {
      closeFrom(0);
      const i = key ? list.findIndex((x) => x.e.key === key) : -1;
      if (i < 0) { arrange(); melt(); return; }
      push({ key, prefix: `${num}.${i + 1}`, tone: list[i].e.tone, build: () => {
        const e = list.find((x) => x.e.key === key)?.e, m = e?.module, cur = currentBasemap();
        return !e ? [] : [
          ...(e.maps ? BASEMAPS.map((b) => ({ key: b.id || b.name, title: b.name, thumb: thumbOf(b), selected: b === cur, hint: b.hint, click: () => setBasemap(b) })) : []),
          ...(m ? m.menu.items().map((it) => menuSpec(m, it)) : []),
          ...e.plain.map(plainSpec),
        ];
      } });
    }

    // подпись центральной кнопки: встал барабан или навели мышь — видна пару секунд (постоянные подписи выключены)
    let tipTimer = 0;
    const labelsOn = () => !document.body.classList.contains("labels-off");
    function showTip() {
      clearTimeout(tipTimer);
      const l = list[R.centerIndex()];
      if (!isOpen || stack.length || !l || R.dragged() || labelsOn()) return hideTip();
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
    addEventListener("resize", hideTip);

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
        // крестик: выключить всё в кнопке и забыть отмеченные виды (Грегори, 2026-10-29)
        x.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          x.disabled = true;
          for (const m of [e.module, ...e.plain]) if (m?.active) await switchTo(m, false);
          e.content?.column.close();
          e.module?.menu.clear?.();
          render();
        });
        // центральная — открыть её карусель; другая — докрутить в центр и сразу открыть
        c.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const i = list.findIndex((l) => l.e.key === e.key);
          // раздел — сразу его панель; слой — карусель. Окно раздела уже открыто — кнопка его сворачивает и
          // разворачивает; у навигации с целью — карточку пути (как раньше значки в столбике под логотипом)
          const act = () => {
            if (!e.content) return show(e.key);
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
            // панель закрыта, а раздел ещё работает (музыка играет, column.shown) — открыть панель, а не сворачивать
            // «Поиск» — всегда его история (уже выбран — тоже), чтобы было видно, что выбор сработал
            if (e.key !== "content/navigation" && e.key !== "search" && (e.content.column.shown?.() ?? e.content.column.isOpen())) { emit("panel-fold-request", { fold: !folded }); return; }
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
      // открытые карусели — заново, на своих местах
      stack.forEach((f, k) => fill(k, f));
      paintKeys();
    };
    return {
      name, setOpen, render, wheel, top, back, depth: () => stack.length,
      need: () => (stack.length ? levels[stack.length - 1].R : R).need(),
      // место видимого — барабана или карусели
      place: (y, h) => { const s = top().style; s.top = `${y}px`; s.bottom = `${innerHeight - y - h}px`; },
      relayout: () => { if (!isOpen) return; R.layout(); for (const L of levels) if (!L.el.hidden) L.R.layout(); },
    };
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
  document.body.append(playerBtn, arrowBtn, placesBtn, lensBtn);

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
  // пока открыт барабан, вся полоса справа сверху донизу — его (Грегори 2026-11-24: «на телефоне скролишь с
  // размахом, в половине случаев не попадаешь»): под кнопками, над картой; палец и колёсико в ней крутят видимый
  // барабан или карусель
  const front = () => document.querySelector(".wheel:not(.closed):not(.away), .layers-sub.carousel:not([hidden]):not(.away):not(.melting)");
  const strip = Object.assign(document.createElement("div"), { className: "wheel-strip", hidden: true });
  document.body.append(strip);
  strip.addEventListener("pointerdown", (e) => { const f = front(); if (f) rotorOf.get(f)?.down(e); });
  strip.addEventListener("pointermove", (e) => { const f = front(); if (f) rotorOf.get(f)?.move(e); });
  for (const t of ["pointerup", "pointercancel"]) strip.addEventListener(t, (e) => { const f = front(); if (f) rotorOf.get(f)?.up(e); });
  placeStrip = () => {
    strip.hidden = !openName;
    if (openName) strip.style.left = `${btnOf[openName].getBoundingClientRect().left - 8}px`;
  };
  const zoneAt = (x, y, target) => {
    if (!strip.hidden && x >= strip.getBoundingClientRect().left && (target || document.elementFromPoint(x, y)) === strip) return front();
    // только видимый барабан или карусель: ушедшие вправо и тающие — нет
    for (const el of document.querySelectorAll(".wheel:not(.closed):not(.away), .layers-sub.carousel:not([hidden]):not(.away):not(.melting)")) {
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
    const zone = e.isTrusted && zoneAt(e.clientX, e.clientY, e.target);
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
  // мышь над ним — и барабан не тает
  const hoverLabels = (x, y) => {
    const z = x === null ? null : zoneAt(x, y);
    for (const el of document.querySelectorAll(".labels-here")) if (el !== z) el.classList.remove("labels-here");
    z?.classList.add("labels-here");
    if (z !== hovered) { hovered = z; melt(); }
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
  // палец на барабане или карусели — не тает, отпустил — отсчёт заново
  addEventListener("pointerdown", (e) => { if (zoneAt(e.clientX, e.clientY)) { pressed = true; melt(); } }, { capture: true, passive: true });
  for (const t of ["pointerup", "pointercancel"]) addEventListener(t, () => { if (pressed) { pressed = false; melt(); } }, { capture: true, passive: true });

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
// подписи барабанов на сенсорном экране видны, только пока крутят: перестали — сразу гаснут (Грегори 2026-11-22:
// «никаких задержек на подписи — или фокус мыши, или вращение на телефоне»); с мышью — по наведению (labels-here).
// Мышь или палец — по тому, чем трогали последним (сенсорный экран — пока не тронули — палец)
let mouseUser = !navigator.maxTouchPoints;
addEventListener("pointerdown", (e) => { mouseUser = e.pointerType === "mouse"; }, { capture: true, passive: true });
function liveLabels(on) {
  if (!mouseUser) document.body.classList.toggle("labels-live", on);
}

const rotorOf = new WeakMap(); // элемент, что слушает палец, → его барабан
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
  const shownAt = (v) => v - (DETENT * Math.sin(2 * Math.PI * v)) / (2 * Math.PI);
  const wrap = (d) => { const k = n(); return ((d % k) + k + k / 2) % k - k / 2; };
  const centerIndex = () => ((Math.round(raw) % n()) + n()) % n();

  function layout() {
    if (!n() || !shown()) return;
    const cy = centerY(), { radius, step } = geom();
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

  let moving = false;
  const animate = () => {
    cancelAnimationFrame(frame);
    moving = true;
    const tick = () => {
      const d = target - raw;
      if (Math.abs(d) < 0.002) {
        raw = target;
        moving = false;
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
  // новое касание — новый жест: после прокрутки пальцем щелчка может и не быть, и запрет щелчка оставался на
  // следующее нажатие (Грегори 2026-11-24: «после остановки барабана кнопки на первый клик не реагируют»)
  const down = (e) => {
    if (e.button !== 0) return;
    suppressClick = false;
    drag = { x: e.clientX, y: e.clientY, raw, t: performance.now(), v: 0, moved: false, id: e.pointerId };
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (onSwipe && dx > 40 && Math.abs(dx) > 2 * Math.abs(dy)) { drag = null; suppressClick = true; onSwipe(); return; }
      if (Math.abs(dy) < 6) return;
      drag.moved = true;
      el.setPointerCapture(e.pointerId);
      onArrive = null;
      onStart();
      cancelAnimationFrame(frame);
    }
    const { radius, step: a } = geom(), step = radius * a; // промежуток в центре
    const now = performance.now(), next = drag.raw - dy / step;
    drag.v = (next - raw) / Math.max(1, now - drag.t);
    drag.t = now;
    raw = target = next;
    layout();
  };
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
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
  el.addEventListener("click", (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);

  const api = {
    // полоса справа (wheel-strip) передаёт сюда палец и мышь
    down, move, up: endDrag,
    set: (list) => { cells = list; box.replaceChildren(...list); layout(); },
    // встать сразу; крутился — он встал (onSettle), иначе барабан так и считался бы крутящимся и не таял
    jump: (i) => { cancelAnimationFrame(frame); onArrive = null; raw = target = i; layout(); if (moving) { moving = false; onSettle(); } },
    layout, spinTo, centerIndex, geom,
    // высота, в которую встают все кнопки без повторов по кругу (как geom() у высокого барабана)
    need: () => { const step = Math.PI / 2 / (n() / 2 + 0.5); return 2 * Math.min(GAP / Math.sin(step), 400) + BTN + 8; },
    settled: () => Math.abs(raw - target) < 0.01,
    atCenter: (i) => i === centerIndex() && Math.abs(raw - Math.round(raw)) < 0.01,
    dragged: () => !!drag?.moved,
  };
  rotorOf.set(el, api);
  return api;
}

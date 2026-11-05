// Кнопки — два колеса-барабана в боковой панели справа, на одном месте (Грегори, 2026-11-02: «один
// барабан сменяет другой»):
//  • барабан слоёв — открывает треугольник справа внизу, над лентой фото (◀ — показать, ▶ — спрятать);
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
import { closeOpen, homeList } from "./panel.js";
import { backable } from "./back.js";
import { modules, toggle, available, allowed, onRegister, MODULES } from "./modules.js";
import { on, emit } from "./events.js";
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
const ARROW = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M15.5 5v14L6 12z"/></svg>';

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
  const item = ({ title, icon, thumb, color, on: isOn, selected, blocked, hint, click }) => {
    const b = Object.assign(document.createElement("button"), { className: "layers-item" + (isOn ? " on" : "") + (selected ? " selected" : ""),
      disabled: blocked, title: blocked ? BLOCKED : hint || "" });
    b.innerHTML = `<span></span><i class="layers-icon${color ? " ring" : ""}${thumb ? " thumb" : ""}">${thumb ? '<img alt="">' : icon || ""}</i>`;
    b.firstChild.textContent = title;
    if (thumb) b.querySelector("img").src = thumb;
    if (color) b.lastChild.style.borderColor = color;
    b.addEventListener("click", () => { b.disabled = true; click(); });
    return b;
  };

  // кнопки барабана слоёв: «Карты», потом разделы и модули с видами
  const layerEntries = () => {
    const usable = modules("layer").filter(available).filter((m) => m.group !== "hidden");
    const maps = { key: "maps", title: "Карты", tone: "maps", maps: true, plain: usable.filter((m) => groupOf(m) === MAPS_GROUP) };
    return [maps, ...GROUPS.flatMap((g) => {
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
  const contentEntries = () => modules("content").filter(available)
    .sort((a, b) => MODULES.findIndex((p) => p.includes(a.id)) - MODULES.findIndex((p) => p.includes(b.id)))
    .map((m) => ({ key: m.id, title: m.title, icon: m.icon, tone: m.tone, content: m, plain: [] }));

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
  const lensBtn = Object.assign(document.createElement("button"), { className: "btn glass search-toggle" });
  const controls = [arrowBtn, lensBtn];
  let shown = null, searchOn = false, mode = null;
  const paint = () => {
    arrowBtn.classList.toggle("open", shown === "layers");
    arrowBtn.title = shown === "layers" ? "Спрятать слои карты" : "Слои карты";
    // кнопка — ещё и индикатор режима строки поиска (Грегори 2026-11-04): режим есть — его значок, даже
    // при закрытом поиске (навигация включена — значок навигации)
    // поиск открыт — значок на цветном фоне; закрыт — сам значок цвета раздела на прозрачном (Грегори
    // 2026-11-05: «только цветной значок в пустом окне карты»); без раздела — логотип
    lensBtn.classList.toggle("open", !mode);
    lensBtn.classList.toggle("mode", !!mode);
    lensBtn.classList.toggle("idle", !searchOn);
    lensBtn.style.background = mode && searchOn ? `var(--tone-${mode.tone})` : "";
    lensBtn.style.color = mode && !searchOn ? `var(--tone-${mode.tone})` : "";
    lensBtn.innerHTML = mode ? mode.icon : '<img src="icons/logo.png" alt="">';
    lensBtn.title = !searchOn ? "Поиск и разделы: экскурсии, языки, треки, фото"
      : shown ? "Спрятать барабан" : "Закрыть поиск";
  };
  // открытый поиск — шаг для «Назад» телефона
  let searchBack = null;
  const setShown = (which, search = searchOn) => {
    if (search && !searchOn) searchBack = backable(() => { searchBack = null; setShown(null, false); });
    if (!search && searchBack) { const d = searchBack; searchBack = null; d(); }
    searchOn = search;
    document.body.classList.toggle("search-hidden", !searchOn);
    settings.set("search.open", searchOn || null);
    if (which !== shown) {
      shown = which;
      settings.set("layers.panel", which);
      if (which) closeOpen("right");
      for (const d of drums) d.setOpen(d.name === which);
    }
    paint();
  };
  // щелчок — свой барабан (вместо другого), второй щелчок — спрятать. Кнопка справа вверху (логотип,
  // значок режима) — три положения по кругу, ничего не сбрасывает (Грегори 2026-11-05: «выбор — только в
  // барабане»; «пришёл и закрыл за собой дверь»): поиск с барабаном → щелчок прячет барабан → щелчок
  // прячет поиск (значок — цветной на прозрачном) → щелчок — снова поиск с барабаном. Окно раздела
  // прячется вместе со строкой и возвращается с ней (body.search-hidden)
  arrowBtn.addEventListener("click", () => setShown(shown === "layers" ? null : "layers"));
  lensBtn.addEventListener("click", () => (!searchOn ? setShown("content", true) : shown ? setShown(null, true) : setShown(null, false)));
  on("search-mode", (m) => { mode = m; paint(); });
  // раздел живёт в самой строке поиска (навигация) — строка нужна; на телефоне барабан уступает место
  on("search-show", () => setShown(innerWidth <= 600 ? null : shown || "content", true), { replay: false });
  // открылась панель настроек (на телефоне — любая) — барабан уступает место
  on("panel", (p) => p && shown && (p.side === "right" || innerWidth <= 600) && setShown(null), { replay: false });

  // ---------- барабан ----------
  function makeDrum(name, entries) {
    const wheel = Object.assign(document.createElement("div"), { className: `wheel wheel-${name} closed` });
    const drum = Object.assign(document.createElement("div"), { className: "wheel-drum" });
    wheel.append(drum);
    // столбик кнопки — слева от барабана
    const sub = Object.assign(document.createElement("div"), { className: `layers-sub sub-${name}`, hidden: true });
    // подпись — только у центральной кнопки, слева от неё (Грегори, 2026-10-30)
    const tip = Object.assign(document.createElement("div"), { className: "wheel-tip" });
    document.body.append(wheel, sub, tip);

    let isOpen = false;
    const setOpen = (open) => {
      if (open === isOpen) return;
      isOpen = open;
      wheel.classList.toggle("closed", !open);
      if (open) { layout(); setTimeout(showTip, 300); } else { hideTip(); show(null); }
    };
    document.addEventListener("click", (e) => {
      // кнопку, по которой щёлкнули, могли уже перерисовать — это щелчок внутри, а не мимо
      if (!e.target.isConnected) return;
      if (openKey && !sub.contains(e.target) && !wheel.contains(e.target) && !controls.some((c) => c.contains(e.target))) show(null);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen && !e.defaultPrevented) { e.preventDefault(); openKey ? show(null) : setShown(null); } });

    // ---------- столбик кнопки ----------
    let openKey = null;
    let list = []; // кнопки барабана по порядку: { e, cell, c, x }
    function show(key) {
      openKey = key;
      if (key) hideTip();
      for (const { e, c } of list) c.classList.toggle("open", e.key === key);
      const e = key && list.find((x) => x.e.key === key)?.e;
      if (!e) { sub.hidden = true; return; }
      const m = e.module;
      const cur = currentBasemap();
      const col = e.content?.column;
      // раздел с панелью: список подгружается при первом открытии столбика
      if (col && !col.loaded) {
        col.loaded = true;
        col.load(ctx).catch(() => {}).finally(() => openKey === key && show(key));
      }
      const colItems = col ? col.items() : [];
      sub.replaceChildren(
        ...(col && !colItems.length ? [Object.assign(document.createElement("div"), { className: "layers-wait", textContent: "Загрузка…" })] : []),
        ...colItems.map((it) => item({ title: it.title, thumb: it.thumb, icon: it.icon, selected: it.selected, hint: it.hint,
          click: () => { col.choose(it.id, ctx); show(null); } })),
        ...(e.maps ? BASEMAPS.map((b) => item({ title: b.name, thumb: thumbOf(b), selected: b === cur, hint: b.hint,
          click: () => { setBasemap(b); show(openKey); } })) : []),
        ...(e.maps && e.plain.length ? [Object.assign(document.createElement("div"), { className: "layers-sep" })] : []),
        ...(m ? m.menu.items().map((it) => item({ title: it.title, icon: it.icon || m.icon, color: it.color, on: m.active && it.active, blocked: !allowed(m),
          click: () => {
            if (!m.active) { m.menu.choose(it.id); switchTo(m, true); } // слой был выключен — только этот вид
            else switchTo(m, m.menu.toggle(it.id)); // отметить ещё один или снять; не осталось ни одного — выключить
          } })) : []),
        ...e.plain.map((p) => item({ title: p.title, icon: p.icon, color: p.color, on: p.active, blocked: !allowed(p), hint: p.hint, click: () => switchTo(p, !p.active) })),
      );
      // выделенные кнопки столбика — светлой заливкой цвета группы
      sub.style.setProperty("--tone", `var(--tone-${e.tone})`);
      sub.hidden = false;
      // слева от барабана, по центру относительно кнопки (она в центре барабана); не выходит за экран
      const r = wheel.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      sub.style.right = `${innerWidth - r.left - 4}px`;
      sub.style.top = `${Math.max(8, Math.min(mid - sub.offsetHeight / 2, innerHeight - sub.offsetHeight - 8))}px`;
    }

    // raw — положение барабана в кнопках (0 — первая в центре), растёт при прокрутке вниз;
    // на экране — с притормаживанием у центра: возле целого значения кнопки движутся медленнее
    let raw = 0, target = 0, frame = 0, onArrive = null;
    const n = () => list.length;
    // промежуток в центре — GAP; кнопок хватает — барабан на всю высоту, мало — короче и без повторов по кругу,
    // видны все (n/2 + ½: иначе крайняя встаёт ровно на край барабана и прячется — у четырёх разделов не было «Треков»)
    const geom = () => {
      const full = drum.clientHeight / 2 - BTN / 2 - 4;
      const half = Math.max(1, Math.min(n() / 2 + 0.5, Math.PI / 2 / Math.asin(Math.min(1, GAP / full))));
      const step = Math.PI / 2 / half;
      return { step, radius: Math.min(full, GAP / Math.sin(step)) };
    };
    const shownAt = (v) => v - (DETENT * Math.sin(2 * Math.PI * v)) / (2 * Math.PI);
    const wrap = (d) => { const k = n(); return ((d % k) + k + k / 2) % k - k / 2; };
    const centerIndex = () => ((Math.round(raw) % n()) + n()) % n();

    function layout() {
      if (!n() || !isOpen) return;
      const h = drum.clientHeight, { radius, step } = geom();
      const off = shownAt(raw);
      list.forEach(({ cell }, i) => {
        const a = wrap(i - off) * step;
        if (Math.abs(a) >= Math.PI / 2) { cell.hidden = true; return; }
        const k = Math.cos(a);
        cell.hidden = false;
        cell.style.transform = `translateY(${h / 2 + radius * Math.sin(a) - BTN / 2}px)`;
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
          done?.();
          showTip();
          return;
        }
        raw += d * 0.18;
        layout();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    // подпись центральной кнопки: встал барабан или навели мышь — видна пару секунд
    let tipTimer = 0;
    function showTip() {
      clearTimeout(tipTimer);
      const l = list[centerIndex()];
      if (!isOpen || openKey || !l || drag?.moved) return hideTip();
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

    // докрутить кнопку i в центр — кратчайшим путём по кругу
    const spinTo = (i, then) => {
      target = Math.round(raw) + wrap(i - Math.round(raw));
      onArrive = then;
      animate();
    };

    // колёсико: шаг колёсика — кнопка; остановились — барабан встаёт кнопкой в центр
    let snapTimer = 0;
    wheel.addEventListener("wheel", (e) => {
      e.preventDefault();
      hideTip();
      if (openKey) show(null);
      target += e.deltaY / (e.deltaMode === 1 ? 3 : 100);
      onArrive = null;
      animate();
      clearTimeout(snapTimer);
      snapTimer = setTimeout(() => { target = Math.round(target); animate(); }, 160);
    }, { passive: false });

    // палец и мышь: тянуть вверх-вниз, с разгоном; на телефоне смахнуть вправо — спрятать панель
    let drag = null, suppressClick = false;
    wheel.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, raw, t: performance.now(), v: 0, moved: false, id: e.pointerId };
    });
    wheel.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (dx > 40 && Math.abs(dx) > 2 * Math.abs(dy)) { drag = null; suppressClick = true; setShown(null); return; }
        if (Math.abs(dy) < 6) return;
        drag.moved = true;
        wheel.setPointerCapture(e.pointerId);
        hideTip();
        if (openKey) show(null);
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
    wheel.addEventListener("pointerup", endDrag);
    wheel.addEventListener("pointercancel", endDrag);
    wheel.addEventListener("click", (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
    addEventListener("resize", () => { hideTip(); layout(); if (openKey) show(openKey); });

    // ---------- кнопки барабана ----------
    const render = () => {
      const centered = list[centerIndex()]?.e.key;
      list = entries().map((e) => {
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
        cell.append(c, x);
        // у модуля с видами в подсказке — выбранный вид
        const label = e.module?.menu.label();
        if (label && label !== e.title) c.ariaLabel = `${e.title}: ${label}`;
        c.dataset.key = e.key;
        c.addEventListener("mouseenter", () => list[centerIndex()]?.c === c && Math.abs(raw - target) < 0.01 && showTip());
        const anyOn = !!e.module?.active || e.plain.some((m) => m.active) || !!e.content?.column.isOpen();
        c.classList.toggle("on", anyOn);
        x.hidden = !anyOn;
        // крестик: выключить всё в кнопке, забыть отмеченные виды и закрыть столбик (Грегори, 2026-10-29:
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
        // центральная — открыть или закрыть столбик; другая — докрутить в центр и сразу открыть
        c.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const i = list.findIndex((l) => l.e.key === e.key);
          // раздел — сразу его панель; слой — столбик
          const act = () => (e.content ? (show(null), openHome(e.content)) : show(openKey === e.key ? null : e.key));
          if (i === centerIndex() && Math.abs(raw - Math.round(raw)) < 0.01) act();
          else { show(null); spinTo(i, act); }
        });
        return { e, cell, c, x };
      });
      drum.replaceChildren(...list.map((l) => l.cell));
      // перерисовка не сдвигает барабан: в центре — та же кнопка
      const keep = list.findIndex((l) => l.e.key === centered);
      if (keep >= 0 && keep !== centerIndex()) raw = target = keep;
      layout();
      if (openKey) show(openKey);
    };
    return { name, setOpen, render };
  }

  const drums = [makeDrum("layers", layerEntries), makeDrum("content", contentEntries)];
  document.body.append(arrowBtn, lensBtn);

  // слой включился не отсюда (сам по себе, по событию другого модуля) — кнопки обновить
  on("module", renderAll, { replay: false });
  on("basemap", renderAll, { replay: false });
  on("panel", () => renderAll(), { replay: false });
  onRegister(renderAll);
  renderAll();
  // открытый барабан и поиск — с прошлого раза; при первом запуске — ничего (раньше было только «да» — слои)
  const saved = settings.get("layers.panel");
  setShown(saved === true ? "layers" : saved || null, !!settings.get("search.open") || saved === "content");

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

// Навигация — раздел в барабане поиска (Грегори, 2026-11-04: «кнопку Навигация — в барабан поиска,
// окно маршрута — в окно поиска; история маршрутов — как история поиска»). Кнопка включает навигацию
// (ту же, что кнопка слева внизу) и светится, пока она включена; её крестик навигацию выключает.
// Пока навигация включена, строка поиска — в её режиме (значок — стрелка на кнопке справа вверху):
// «Куда»; щелчок по строке — подсказки (история точек), набор — подсказки из неё, Enter — поиск мест
// (Nominatim), выбранное место — цель. Цель — отдельная панель под строкой (Грегори 2026-11-05: «это
// должны быть разные панели»): стрелка, расстояние и сторона света, способы передвижения (пешком,
// велосипед, машина — проложить путь), «Свернуть» (в строке остаётся стрелка — щелчок раскрывает) и
// «Убрать точку». Сама цель, линия и путь — в core/route.js (здесь только окно)
import { register } from "../core/modules.js";
import { emit, on } from "../core/events.js";
import { setSearchMode, searchMode, geocode, refreshSearchList, foldSearchList, setSearchCard, showSearchList } from "../core/search.js";
import { historyList, remember, loadList, saveList } from "../core/history.js";
import { WAYS, ARROW, SHARE_ICON, START_ICON, FINISH_ICON as FINISH_BIG } from "../core/route.js";
import { showPlace } from "../core/place-info.js";
import { trackIcon } from "../core/icons.js";
import { countryAt } from "../core/borders.js";
import { flagUrl } from "../core/flags.js";

const HISTORY = "route.history";
const ICON = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>';
// сохранённый маршрут («⋯» → «Сохранить маршрут» в окне места) — своя запись, даже к той же точке
const id = (e) => e.saved || `${e.lngLat[0].toFixed(5)},${e.lngLat[1].toFixed(5)}`;
// значок сохранённого маршрута в списке (Грегори 2026-11-09: «если это сохранённый маршрут — поставить отметку»)
const ROUTE_ICON = trackIcon(22);
const BACK = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>';
const GPX_ICON = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/></svg>';
// старт и финиш — те же значки, что у кнопок «Старт» и «Финиш» в окне места
const FINISH_ICON = FINISH_BIG.replace(/width="\d+" height="\d+"/, 'width="20" height="20"');
const START_SMALL = START_ICON.replace(/width="\d+" height="\d+"/, 'width="20" height="20"');
const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });

let navOn = false, state = {}, results = null, note = "", ctx = null;
// открытый маршрут (его saved): вместо списка «Куда» — его точки, как история (Грегори 2026-11-10: «при клике
// на маршрут — такая же панель со списком, но с другим значком; двигать и менять местами точки»)
let openRoute = null;
// открытая страна списка «Куда» (Грегори 2026-11-13: «группирую маршруты по странам — как в альбомах, с флажками»)
let openCountry = null;

// строка поиска «Куда»: подсказки — история точек (при наборе — подходящие), Enter — найти место;
// цель — своя карточка над подсказками
const CLOSE = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const FOLD = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 15l6-6 6 6"/></svg>';
const MODE = { icon: ICON, title: "Навигация", placeholder: "Куда", tone: "nav",
  filter: (text) => { if (!text && results) { results = null; note = ""; } },
  submit: (text) => find(text),
  list: (q) => suggestions(q),
  // щелчок по строке — к началу списка; true — был открыт маршрут
  reset: () => { const was = !!openRoute || !!openCountry; openRoute = null; openCountry = null; return was; },
  // маршрут в работе (карточка пути или список его точек) — строка поиска ищет дополнительные точки, к началу
  // не уводит (Грегори 2026-11-10: «в режиме трека окно поиска — в режиме дополнительных точек»): щелчок —
  // список точек маршрута и набор текста
  // (маршрут — есть остановки или открыт список его точек; одна цель — обычный список «Куда»)
  keep: (closed) => {
    const listed = !!openRoute && loadList(HISTORY).some((e) => e.saved === openRoute);
    if (!state.target || !(listed || (state.points?.length || 0) > 1)) return false;
    if (closed && !listed) emit("route-build");
    return true;
  },
  hint: () => (state.target ? "Добавить точку" : "Куда"),
  exit: () => {} };
// карточка пути — висящий маршрут: видна при любом режиме строки поиска (Грегори 2026-11-05: «навигация
// работает со всеми режимами»); свёрнута — в строке крупная красная стрелка к цели
setSearchCard({
  card: () => (state.target ? targetCard() : null),
  icon: () => `<span class="search-card-arrow" style="transform: rotate(${state.me ? state.arrow || 0 : 0}deg)">${ARROW}</span>`,
  title: () => (state.me ? `${state.main} — показать путь` : `${state.target?.title || "Точка"} — показать путь`),
});
// карточка цели — на каждое изменение; подсказки — только когда сменились они сами
const render = (withList = true) => refreshSearchList(withList && searchMode() === MODE);

async function find(q) {
  if (!q) return;
  results = [];
  note = "Ищу…";
  render();
  try {
    const found = await geocode(q);
    if (found === null) { note = "Поиск мест выключен в настройках: он обращается в интернет"; results = []; }
    else { results = found; note = found.length ? "" : "Ничего не найдено"; }
  } catch { note = "Поиск не удался — проверьте интернет"; results = []; }
  render();
}

// найденное место при навигации — на карте наше окно места (Сюда, Добавить, Поделиться, Отметить, ⋯; Грегори
// 2026-11-10); выбрать в нём, что делать
function place(t) {
  results = null;
  note = "";
  foldSearchList();
  showPlace(t);
}

function choose(t) {
  results = null;
  note = "";
  remember(HISTORY, t, id);
  emit("route-target", t);
  emit("route-name", t.saved ? t.name || null : null);
  // маршрут — открывается список его точек, подсказки не закрываются
  if (t.saved) { openRoute = t.saved; render(); return; }
  // выбрали — подсказки закрываются, карточка цели раскрыта
  foldSearchList();
  // на карте — и я, и точка
}

// цель: стрелка, расстояние, сторона, способы передвижения, путь
function targetCard() {
  const t = state.target;
  const card = h("div", "nav-card");
  const top = h("div", "nav-card-top");
  const arrow = h("div", "go-arrow");
  arrow.innerHTML = ARROW;
  arrow.hidden = !state.me;
  arrow.style.transform = `rotate(${state.arrow || 0}deg)`;
  const text = h("div", "go-text");
  text.append(h("div", "go-main", state.me ? state.main : t.title), h("div", "go-sub", state.me ? t.title : (state.points?.length || 0) > 1 ? `Маршрут: ${state.points.length} точк${state.points.length < 5 ? "и" : "ек"}` : "Включите навигацию — покажу, куда идти"));
  // «стрелка вверх» — к построению маршрута: список его точек (Грегори 2026-11-10); свернуть карточку —
  // кнопкой «Навигация» в барабане
  const fold = h("button", "go-close");
  Object.assign(fold, { type: "button", title: "Точки маршрута", innerHTML: FOLD });
  fold.addEventListener("click", (e) => { e.stopPropagation(); emit("route-build"); showSearchList(); });
  const close = h("button", "go-close");
  Object.assign(close, { type: "button", title: "Убрать точку", innerHTML: CLOSE });
  close.addEventListener("click", (e) => { e.stopPropagation(); emit("route-target", null); });
  top.append(arrow, text, fold, close);
  const ways = h("div", "go-ways");
  for (const w of WAYS) {
    const b = h("button", "go-way");
    Object.assign(b, { type: "button", title: `Проложить путь: ${w.title.toLowerCase()}`, innerHTML: w.icon, disabled: !state.canRoute });
    b.classList.toggle("on", state.route?.way === w.id || state.busy === w.id);
    b.addEventListener("click", () => emit("route-way", { way: w.id }));
    ways.append(b);
  }
  const way = h("div", "nav-way", state.busy ? `${WAYS.find((w) => w.id === state.busy).title}: ищу путь…` : state.route?.text || (state.canRoute ? (state.me && state.points?.length ? "Путь от меня по дорогам и тропам — выберите, как добираться" : "Путь по дорогам и тропам — выберите, как добираться") : ""));
  // точки маршрута по порядку: остановки с номером и финиш с флажком, крестик убирает любую — путь
  // перестраивается (Грегори 2026-11-10: «финиш тоже должен быть в списке и его можно удалить»)
  const stopsRow = h("div", "go-stops");
  // название места и адрес — строкой ниже, как в списке точек маршрута (Грегори 2026-11-13)
  const pt = (badge, { title, address }, xTitle, fn, passed) => {
    const row = h("div", "go-pt");
    row.classList.toggle("go-passed", !!passed);
    const b = h("span", "go-pt-n");
    b.innerHTML = badge;
    const x = h("button", "go-stop-x");
    Object.assign(x, { type: "button", title: xTitle, innerHTML: CLOSE });
    x.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    const text = h("span", "go-pt-t");
    text.append(h("span", "go-pt-title", title), ...(address ? [h("span", "go-pt-sub", address)] : []));
    row.append(b, text, x);
    stopsRow.append(row);
  };
  for (const p of state.points || []) {
    if (p.role === "start") pt(START_SMALL, p, "Убрать старт", () => emit("route-start-remove"), p.done);
    else if (p.role === "finish") pt(FINISH_ICON, p, "Убрать финиш", () => emit("route-finish-remove"), p.done);
    else pt(`<b class="route-pt-n">${p.n}</b>`, p, "Убрать остановку", () => emit("route-stop-remove", p.n - 1), p.done);
  }
  card.append(top, ...((state.points?.length || 0) > 1 ? [stopsRow] : []), ways, way);
  return card;
}

// подсказки: найденные места или история точек (при наборе — подходящие), как у поиска мест
function suggestions(q) {
  const out = [];
  if (results) {
    if (note) out.push(h("div", "search-note", note));
    for (const r of results) {
      const [title, ...rest] = r.display_name.split(", ");
      const b = h("button", "search-item");
      b.dataset.key = r.display_name;
      b.innerHTML = `<span class="search-item-title"></span><span class="search-item-sub"></span>`;
      b.firstChild.textContent = title;
      b.lastChild.textContent = rest.join(", ");
      b.addEventListener("click", () => place({ lngLat: [Number(r.lon), Number(r.lat)], title, address: rest.join(", "), bbox: r.boundingbox }));
      out.push(b);
    }
    return out;
  }
  const entry = openRoute && !q && loadList(HISTORY).find((e) => e.saved === openRoute);
  if (entry) return routeView(entry);
  // набирают текст при открытом маршруте — маршрут остаётся открытым (стёрли — снова его точки)
  if (!q) openRoute = null;
  // маршрут в работе — выбранное из истории место тоже окном на карте (Добавить или Сюда)
  const pickIn = (e) => (state.target && !e.saved ? place({ lngLat: e.lngLat, title: e.title, address: e.address || "" }) : choose(e));
  // по странам, как альбомы: стран больше одной — сначала список стран с флажками, щелчок — записи страны;
  // набирают текст — подходящие из всех стран
  locate();
  const by = countries();
  if (openCountry && (!by.has(openCountry) || by.size < 2)) openCountry = null;
  if (!q && !openCountry && by.size > 1) return [...by].map(([name, { n, iso }]) => countryRow(name, n, iso));
  if (!q && openCountry) out.push(countryHead(openCountry, by.get(openCountry).iso));
  const inCountry = !q && !!openCountry;
  const hist = historyList({ key: HISTORY, id, clear: !inCountry,
    match: q ? (e) => `${e.name || ""} ${e.title} ${e.address || ""}`.toLowerCase().includes(q) : inCountry ? (e) => countryOf(e) === openCountry : null,
    // подпись — адрес; координаты — только если название не они же (старые записи)
    label: (e) => {
      const c = `${e.lngLat[1].toFixed(5)}, ${e.lngLat[0].toFixed(5)}`;
      const via = e.stops?.length ? `через ${e.stops.map((s) => s.title).join(", ")} · ` : "";
      if (e.saved) return { title: e.name || e.title, sub: `${e.start ? e.start.title + " → " : ""}${e.stops?.length ? "через " + e.stops.map((s) => s.title).join(", ") + " → " : ""}${e.title}`, icon: ROUTE_ICON };
      return { title: e.title, sub: via + (e.address || (e.title === c ? "" : c)) };
    },
    rename: (e, title) => (e.saved ? { ...e, name: title } : { ...e, title }),
    pick: pickIn, changed: render });
  if (hist.childElementCount) out.push(hist);
  else if (!q) out.push(h("div", "search-note", "Наберите место и нажмите Enter — или «Сюда» в окне любого места на карте"));
  return out;
}

// страна записи — по финишу (core/borders.js), узнаётся один раз и хранится в записи
const NO_COUNTRY = "Без страны";
const countryOf = (e) => e.country?.name || NO_COUNTRY;
// «Без страны» — первой, остальные по алфавиту (как в альбомах)
const countries = () => {
  const by = new Map();
  for (const e of loadList(HISTORY)) { const k = countryOf(e); by.set(k, { n: (by.get(k)?.n || 0) + 1, iso: e.country?.iso || "" }); }
  return new Map([...by].sort((x, y) => (y[0] === NO_COUNTRY) - (x[0] === NO_COUNTRY) || x[0].localeCompare(y[0], "ru")));
};
let locating = false;
async function locate() {
  if (locating) return;
  locating = true;
  let found = false;
  try {
    for (const e of loadList(HISTORY).filter((x) => x.country === undefined)) {
      const c = await countryAt(e.lngLat);
      if (c === undefined) break; // границы не загрузились — в другой раз
      const key = id(e);
      saveList(HISTORY, loadList(HISTORY).map((x) => (id(x) === key && x.country === undefined ? { ...x, country: c } : x)));
      found = true;
    }
  } finally { locating = false; }
  if (found && searchMode() === MODE && !openRoute) render();
}
const flagIcon = (iso) => (iso ? `<img class="history-flag" alt="" src="${flagUrl(iso)}">` : "");
function countryRow(name, n, iso) {
  const b = h("button", "search-item nav-country");
  b.type = "button";
  b.innerHTML = `<span class="search-item-title"></span>`;
  b.firstChild.textContent = `${name} (${n})`;
  b.firstChild.insertAdjacentHTML("afterbegin", `<i class="history-icon">${flagIcon(iso) || ROUTE_ICON}</i>`);
  b.addEventListener("click", (e) => { e.stopPropagation(); openCountry = name; render(); });
  return b;
}
// шапка страны: назад к странам, флаг, название
function countryHead(name, iso) {
  const head = h("div", "route-view-head");
  const back = h("button", "route-view-back");
  Object.assign(back, { type: "button", title: "Все страны", innerHTML: BACK });
  back.addEventListener("click", (e) => { e.stopPropagation(); openCountry = null; render(); });
  const title = h("div", "route-view-title", name);
  if (iso) title.insertAdjacentHTML("afterbegin", `<i class="history-icon">${flagIcon(iso)}</i>`);
  head.append(back, title);
  return head;
}

// маршрут: шапка (назад к списку, значок, название, «Поделиться», «Сохранить трек») и его точки по порядку —
// остановки и финиш последним; перетащили или убрали — маршрут пересчитывается (если он сейчас в пути)
function routeView(entry) {
  const head = h("div", "route-view-head");
  const btn = (cls, title, html, fn) => {
    const b = h("button", cls);
    Object.assign(b, { type: "button", title, innerHTML: html });
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  const active = () => state.saved === entry.saved;
  const activate = () => { if (!active()) { emit("route-target", entry); emit("route-name", entry.name || null); } };
  const name = h("div", "route-view-title", entry.name || entry.title);
  // справа — значок маршрута: карточка пути (Грегори 2026-11-10: «именно он должен открывать карточку»)
  head.append(
    btn("route-view-back", "Все места", BACK, () => { openRoute = null; render(); }), name,
    btn("route-view-btn", "Поделиться маршрутом", SHARE_ICON, () => { activate(); emit("route-share"); }),
    btn("route-view-btn", "Сохранить трек (GPX)", GPX_ICON, () => { activate(); emit("route-gpx"); }),
    btn("route-view-btn route-view-card", "Карточка пути", ROUTE_ICON, () => { activate(); emit("route-card-show"); }));
  const pid = (p) => `${p.lngLat[0].toFixed(5)},${p.lngLat[1].toFixed(5)}`;
  const current = () => loadList(HISTORY).find((e) => e.saved === entry.saved) || entry;
  const points = () => { const e = current(); return [...(e.start ? [e.start] : []), ...(e.stops || []), { lngLat: e.lngLat, title: e.title, address: e.address || "" }]; };
  const list = historyList({ id: pid, clear: false, load: points,
    save: (pts) => {
      const e = current(), was = active();
      if (!pts.length) {
        saveList(HISTORY, loadList(HISTORY).filter((x) => x.saved !== e.saved));
        openRoute = null;
        if (was) emit("route-target", null);
      } else {
        // старт был — первая точка списка остаётся стартом; последняя — финиш
        const last = pts[pts.length - 1], first = e.start && pts.length > 1 ? pts[0] : null;
        const pt = (x) => ({ lngLat: x.lngLat, title: x.title, address: x.address || "" });
        const next = { ...e, lngLat: last.lngLat, title: last.title, address: last.address || "", start: first ? pt(first) : undefined,
          stops: pts.slice(first ? 1 : 0, -1).map(pt) };
        saveList(HISTORY, loadList(HISTORY).map((x) => (x.saved === e.saved ? next : x)));
        if (was) emit("route-target", { ...next, way: state.route?.way || state.busy || e.way || null });
      }
      setTimeout(() => render()); // номера точек — заново
    },
    label: (p) => {
      const pts = points(), i = pts.findIndex((x) => pid(x) === pid(p)), last = i === pts.length - 1, first = i === 0 && !!current().start;
      const n = i + (current().start ? 0 : 1);
      // название и адрес строкой ниже — как в карточке пути; старт и финиш видны по значку
      return { title: p.title, sub: p.address || "", icon: last ? FINISH_ICON : first ? START_SMALL : `<b class="route-pt-n">${n}</b>` };
    },
    rename: (p, title) => ({ ...p, title }),
    pick: (p) => { activate(); emit("route-focus", p); },
    changed: render });
  list.classList.add("route-view");
  return [head, list];
}

function openPanel(c) {
  if (c) ctx = c;
  // раздел — составить маршрут и без навигации (Грегори 2026-11-13: программа сама ничего не включает);
  // где я — кнопкой «Навигация» слева внизу
  results = null;
  note = "";
  emit("search-show");
  setSearchMode(MODE);
  render();
}

// кнопка в барабане светится, пока включена навигация или открыт её раздел
const lit = () => navOn || searchMode() === MODE;
let litWas = false;
on("route", (s) => { state = s; render(false); });
// навигацию включили (кнопкой слева внизу, в барабане или сама при запуске) — строка поиска в режиме
// навигации (если в ней не другой раздел); выключили — режим снят
on("nav", ({ on: v }) => {
  if (navOn === v) return;
  navOn = v;
  if (v && (!searchMode() || searchMode() === MODE)) setSearchMode(MODE);
  // навигацию выключили — точка «Сюда» снимается (Грегори 2026-11-05: «сбросил маршрут — обязательно сбросить
  // точку»); маршрут из нескольких точек остаётся — его составляют и без навигации (2026-11-13)
  const planned = (state.points?.length || 0) > 1 || !!state.saved;
  if (!v && state.target && !planned) emit("route-target", null);
  if (!v && searchMode() === MODE && !planned) setSearchMode(null);
  emit("module", { id: "content/navigation", on: lit() }); // барабан перерисует кнопку
});
// другой раздел ушёл из строки поиска, а навигация включена — снова режим навигации
// Выбрали «Поиск места» в барабане — строка остаётся обычным поиском (навигация при этом работает), пока
// не нажмут «Навигация» снова
let plain = false;
on("search-plain", () => { plain = true; }, { replay: false });
on("search-mode", () => { if (lit() !== litWas) { litWas = lit(); emit("module", { id: "content/navigation", on: litWas }); } }, { replay: false });
on("search-mode", (m) => { if (m) plain = false; if (!m && navOn && !plain) setTimeout(() => navOn && !plain && !searchMode() && setSearchMode(MODE)); }, { replay: false });
// карточка пути видна — карта за мной не ходит, на экране весь оставшийся путь (route-show); спрятали —
// сразу ко мне (Грегори 2026-11-06: «карточку закрыли — позиционируем без задержки; открыли — опять весь
// маршрут»)
// так же — пока открыт список точек маршрута (Грегори 2026-11-10: щелчки по точкам спорили с картой за мной)
let cardOpen = false, viewing = false;
const holdNow = () => emit("nav-hold", { hold: cardOpen || viewing });
on("route-card", ({ open }) => {
  if (open === cardOpen) return;
  cardOpen = open;
  holdNow();
  if (open) emit("route-show");
}, { replay: false });
on("route-viewing", ({ open }) => {
  if (open === viewing) return;
  viewing = open;
  holdNow();
  if (open) emit("route-show");
}, { replay: false });
// «Сохранить маршрут» — наверх списка «Куда», своей записью со значком маршрута
// «Добавить» в окне места: открыт список точек маршрута — он и остаётся (точка в нём уже есть), иначе — карточка
// раздел ещё не открыт — открывается (строка поиска «Добавить точку», карточка пути)
on("route-added", () => {
  if (searchMode() !== MODE) openPanel();
  if (!document.querySelector(".search-results:not([hidden]) .route-view")) emit("route-card-show");
}, { replay: false });
on("route-save", (r) => remember(HISTORY, { ...r, saved: `r${Date.now()}` }, id, 40), { replay: false });
// правка маршрута (добавили или убрали остановку, сменили способ) — в его запись; записи нет — наверх списка;
// своё название (переименовали) остаётся
on("route-edit", (r) => {
  const list = loadList(HISTORY), old = list.find((e) => e.saved === r.saved);
  if (old) saveList(HISTORY, list.map((e) => (e.saved === r.saved ? { ...r, ...(e.name ? { name: e.name } : {}) } : e)));
  else remember(HISTORY, r, id, 40);
  openRoute = r.saved;
  render();
}, { replay: false });
// «Сюда» в окне места — в историю и окно навигации
on("route-open", (t) => {
  remember(HISTORY, t, id);
  openPanel();
}, { replay: false });

register({
  id: "content/navigation",
  kind: "content",
  title: "Навигация",
  tone: "nav",
  hint: "Где я, куда идти и как добраться",
  icon: ICON,
  column: {
    home: (c) => { plain = false; openPanel(c); },
    // светится, пока навигация включена (Грегори: «нужна для индикации режима навигации»)
    isOpen: () => lit(),
    // крестик кнопки — выключить навигацию, убрать маршрут с карты (он в списке «Куда») и закрыть окно
    close: () => { emit("nav-switch", { on: false }); emit("route-target", null); if (searchMode() === MODE) setSearchMode(null); },
  },
  // для проверки
  stats: () => ({ navOn, open: searchMode() === MODE, target: state.target?.title || null, results: results?.length ?? null }),
});

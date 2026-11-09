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
import { setSearchMode, searchMode, geocode, refreshSearchList, foldSearchList, foldSearchCard, setSearchCard } from "../core/search.js";
import { historyList, remember } from "../core/history.js";
import { WAYS, ARROW } from "../core/route.js";

const HISTORY = "route.history";
const ICON = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>';
// сохранённый маршрут («⋯» → «Сохранить маршрут» в окне места) — своя запись, даже к той же точке
const id = (e) => e.saved || `${e.lngLat[0].toFixed(5)},${e.lngLat[1].toFixed(5)}`;
// значок сохранённого маршрута в списке (Грегори 2026-11-09: «если это сохранённый маршрут — поставить отметку»)
const ROUTE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M18,15A3,3 0 0,1 21,18A3,3 0 0,1 18,21C16.69,21 15.58,20.17 15.17,19H14A2,2 0 0,1 12,17V15A2,2 0 0,0 10,13H8.83C8.42,14.17 7.31,15 6,15A3,3 0 0,1 3,12A3,3 0 0,1 6,9C7.31,9 8.42,9.83 8.83,11H10A4,4 0 0,1 14,15V17H15.17C15.58,15.83 16.69,15 18,15M18,17A1,1 0 0,0 17,18A1,1 0 0,0 18,19A1,1 0 0,0 19,18A1,1 0 0,0 18,17M6,11A1,1 0 0,0 5,12A1,1 0 0,0 6,13A1,1 0 0,0 7,12A1,1 0 0,0 6,11Z"/></svg>';
const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });

let navOn = false, state = {}, results = null, note = "", ctx = null;

// строка поиска «Куда»: подсказки — история точек (при наборе — подходящие), Enter — найти место;
// цель — своя карточка над подсказками
const CLOSE = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const FOLD = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg>';
const MODE = { icon: ICON, title: "Навигация", placeholder: "Куда", tone: "nav",
  filter: (text) => { if (!text && results) { results = null; note = ""; } },
  submit: (text) => find(text),
  list: (q) => suggestions(q),
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

function choose(t) {
  results = null;
  note = "";
  remember(HISTORY, t, id);
  emit("route-target", t);
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
  text.append(h("div", "go-main", state.me ? state.main : t.title), h("div", "go-sub", state.me ? t.title : "Включите навигацию — покажу, куда идти"));
  const fold = h("button", "go-close");
  Object.assign(fold, { type: "button", title: "Свернуть", innerHTML: FOLD });
  fold.addEventListener("click", (e) => { e.stopPropagation(); foldSearchCard(); });
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
  const way = h("div", "nav-way", state.busy ? `${WAYS.find((w) => w.id === state.busy).title}: ищу путь…` : state.route?.text || (state.me ? "Путь по дорогам и тропам — выберите, как добираться" : ""));
  // остановки по пути — по порядку, крестик снимает
  const stopsRow = h("div", "go-stops");
  (state.stops || []).forEach((title, i) => {
    const chip = h("span", "go-stop-chip");
    chip.append(h("b", "", String(i + 1)), h("span", "", title));
    const x = h("button", "go-stop-x");
    Object.assign(x, { type: "button", title: "Убрать остановку", innerHTML: CLOSE });
    x.addEventListener("click", (e) => { e.stopPropagation(); emit("route-stop-remove", i); });
    chip.append(x);
    stopsRow.append(chip);
  });
  card.append(top, ...(state.stops?.length ? [stopsRow] : []), ways, way);
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
      b.addEventListener("click", () => choose({ lngLat: [Number(r.lon), Number(r.lat)], title, address: rest.join(", ") }));
      out.push(b);
    }
    return out;
  }
  const hist = historyList({ key: HISTORY, id, match: q ? (e) => `${e.title} ${e.address || ""}`.toLowerCase().includes(q) : null,
    // подпись — адрес; координаты — только если название не они же (старые записи)
    label: (e) => {
      const c = `${e.lngLat[1].toFixed(5)}, ${e.lngLat[0].toFixed(5)}`;
      const via = e.stops?.length ? `через ${e.stops.map((s) => s.title).join(", ")} · ` : "";
      return { title: e.title, sub: via + (e.address || (e.title === c ? "" : c)), icon: e.saved ? ROUTE_ICON : "" };
    },
    rename: (e, title) => ({ ...e, title }),
    pick: choose, changed: render });
  if (hist.childElementCount) out.push(hist);
  else if (!q) out.push(h("div", "search-note", "Наберите место и нажмите Enter — или «Сюда» в окне любого места на карте"));
  return out;
}

function openPanel(c) {
  if (c) ctx = c;
  if (!navOn) emit("nav-switch", { on: true }); // кнопка раздела включает навигацию (только она)
  results = null;
  note = "";
  emit("search-show");
  setSearchMode(MODE);
  render();
}

on("route", (s) => { state = s; render(false); });
// навигацию включили (кнопкой слева внизу, в барабане или сама при запуске) — строка поиска в режиме
// навигации (если в ней не другой раздел); выключили — режим снят
on("nav", ({ on: v }) => {
  if (navOn === v) return;
  navOn = v;
  if (v && (!searchMode() || searchMode() === MODE)) setSearchMode(MODE);
  if (!v && searchMode() === MODE) setSearchMode(null);
  // навигацию выключили — и точка снимается (Грегори 2026-11-05: «сбросил маршрут — обязательно сбросить точку»)
  if (!v && state.target) emit("route-target", null);
  emit("module", { id: "content/navigation", on: v }); // барабан перерисует кнопку
});
// другой раздел ушёл из строки поиска, а навигация включена — снова режим навигации
// Выбрали «Поиск места» в барабане — строка остаётся обычным поиском (навигация при этом работает), пока
// не нажмут «Навигация» снова
let plain = false;
on("search-plain", () => { plain = true; }, { replay: false });
on("search-mode", (m) => { if (m) plain = false; if (!m && navOn && !plain) setTimeout(() => navOn && !plain && !searchMode() && setSearchMode(MODE)); }, { replay: false });
// карточка пути видна — карта за мной не ходит, на экране весь оставшийся путь (route-show); спрятали —
// сразу ко мне (Грегори 2026-11-06: «карточку закрыли — позиционируем без задержки; открыли — опять весь
// маршрут»)
let cardOpen = false;
on("route-card", ({ open }) => {
  if (open === cardOpen) return;
  cardOpen = open;
  emit("nav-hold", { hold: open });
  if (open) emit("route-show");
}, { replay: false });
// «Сохранить маршрут» — наверх списка «Куда», своей записью со значком маршрута
on("route-save", (r) => remember(HISTORY, { ...r, saved: `r${Date.now()}` }, id, 40), { replay: false });
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
    isOpen: () => navOn,
    // крестик кнопки — выключить навигацию и закрыть окно
    close: () => { emit("nav-switch", { on: false }); if (searchMode() === MODE) setSearchMode(null); },
  },
  // для проверки
  stats: () => ({ navOn, open: searchMode() === MODE, target: state.target?.title || null, results: results?.length ?? null }),
});

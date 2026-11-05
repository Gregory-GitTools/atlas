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
import { setSearchMode, searchMode, geocode, refreshSearchList, foldSearchList, foldSearchCard } from "../core/search.js";
import { historyList, remember } from "../core/history.js";
import { WAYS, ARROW } from "../core/route.js";

const HISTORY = "route.history";
const ICON = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>';
const id = (e) => `${e.lngLat[0].toFixed(5)},${e.lngLat[1].toFixed(5)}`;
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
  card: () => (state.target ? targetCard() : null),
  // свёрнутая карточка — стрелка к цели в строке поиска
  cardIcon: () => `<span class="search-card-arrow" style="transform: rotate(${state.me ? state.arrow || 0 : 0}deg)">${ARROW}</span>`,
  cardTitle: () => (state.me ? `${state.main} — показать` : `${state.target?.title || "Точка"} — показать`),
  exit: () => {} };
// карточка цели — на каждое изменение; подсказки — только когда сменились они сами
const render = (withList = true) => { if (searchMode() === MODE) refreshSearchList(withList); };

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
  const map = ctx?.map;
  if (map) {
    const pts = [t.lngLat, ...(state.me && window.atlas?.geo?.state().position ? [window.atlas.geo.state().position] : [])];
    if (pts.length > 1) map.fitBounds([[Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1])], [Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])]],
      { padding: innerWidth <= 600 ? { top: innerHeight * 0.5, bottom: 90, left: 40, right: 40 } : { top: 90, bottom: 110, left: 440, right: 90 }, maxZoom: 16, duration: 1500 });
    else map.flyTo({ center: t.lngLat, zoom: Math.max(map.getZoom(), 14), duration: 1500 });
  }
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
  Object.assign(fold, { type: "button", title: "Свернуть — в строке останется стрелка", innerHTML: FOLD });
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
  card.append(top, ways, way);
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
    label: (e) => { const c = `${e.lngLat[1].toFixed(5)}, ${e.lngLat[0].toFixed(5)}`; return { title: e.title, sub: e.address || (e.title === c ? "" : c) }; },
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
on("search-mode", (m) => { if (!m && navOn) setTimeout(() => navOn && !searchMode() && setSearchMode(MODE)); }, { replay: false });
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
    home: (c) => openPanel(c),
    // светится, пока навигация включена (Грегори: «нужна для индикации режима навигации»)
    isOpen: () => navOn,
    // крестик кнопки — выключить навигацию и закрыть окно
    close: () => { emit("nav-switch", { on: false }); if (searchMode() === MODE) setSearchMode(null); },
  },
  // для проверки
  stats: () => ({ navOn, open: searchMode() === MODE, target: state.target?.title || null, results: results?.length ?? null }),
});

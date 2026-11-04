// Навигация — раздел в барабане поиска (Грегори, 2026-11-04: «кнопку Навигация — в барабан поиска,
// окно маршрута — в окно поиска; история маршрутов — как история поиска»). Кнопка включает навигацию
// (ту же, что кнопка слева внизу) и светится, пока она включена; её крестик навигацию выключает.
// Окно — сама строка поиска с её списком (Грегори 2026-11-04: «не под строкой поиска, а в окне поиска:
// поиск и список поисковых запросов, только с возможностью проложить»): строка ищет место (Enter —
// как обычный поиск мест, Nominatim), выбранное место — цель; в списке — стрелка, расстояние и сторона
// света, способы передвижения (пешком, велосипед, машина — проложить путь), «Убрать точку»; ниже —
// найденные места или история точек (щелчок — снова цель, строки перетаскиваются и удаляются, историю
// можно свернуть). Щёлкнули мимо — в списке остаётся только цель. Сама цель, линия и путь — в
// core/route.js (здесь только окно)
import { register } from "../core/modules.js";
import { emit, on } from "../core/events.js";
import { setSearchMode, searchMode, geocode, refreshSearchList } from "../core/search.js";
import { historyList, remember } from "../core/history.js";
import { WAYS, ARROW } from "../core/route.js";

const HISTORY = "route.history";
const ICON = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>';
const id = (e) => `${e.lngLat[0].toFixed(5)},${e.lngLat[1].toFixed(5)}`;
const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });

let navOn = false, state = {}, results = null, note = "", ctx = null;

// строка поиска: Enter — найти место; пустая — снова история
const MODE = { icon: ICON, title: "Навигация", placeholder: "Куда идти?", tone: "nav",
  filter: (text) => { if (!text && results) { results = null; note = ""; } },
  submit: (text) => find(text),
  list: ({ full }) => nodes(full),
  exit: () => {} };
const render = () => { if (searchMode() === MODE) refreshSearchList(); };

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
  render();
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
  const close = h("button", "go-close", "×");
  Object.assign(close, { type: "button", title: "Убрать точку" });
  close.addEventListener("click", () => emit("route-target", null));
  top.append(arrow, text, close);
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

function nodes(full) {
  const out = [];
  if (state.target) out.push(targetCard());
  if (!full) return out;
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
  } else {
    const hist = historyList({ key: HISTORY, title: "Недавние точки", id,
      label: (e) => ({ title: e.title, sub: e.address || `${e.lngLat[1].toFixed(5)}, ${e.lngLat[0].toFixed(5)}` }),
      pick: choose, changed: render });
    if (hist.childElementCount) out.push(hist);
    else if (!state.target) out.push(h("div", "search-note", "Наберите место и нажмите Enter — или «Сюда» в окне любого места на карте"));
  }
  return out;
}

function openPanel(c) {
  if (c) ctx = c;
  emit("nav-switch", { on: true }); // кнопка раздела включает навигацию
  results = null;
  note = "";
  emit("search-show");
  setSearchMode(MODE);
  render();
}

on("route", (s) => { state = s; render(); });
on("nav", ({ on: v }) => {
  if (navOn === v) return;
  navOn = v;
  emit("module", { id: "content/navigation", on: v }); // барабан перерисует кнопку
});
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

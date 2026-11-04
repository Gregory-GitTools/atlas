// Строка поиска мест (как в travel-earth): Nominatim — бесплатный геокодер OpenStreetMap, его
// правила запрещают подсказки на каждую букву, поэтому поиск — по Enter или лупе. Места рядом
// с видимой частью карты — выше в списке. История — последние выбранные места (до 20): при пустой
// строке видна под полем, щелчок ведёт на место без нового запроса; строки можно перетаскивать
// (так складывается своё избранное) и удалять, историю — свернуть (core/history.js; Грегори
// 2026-11-04: «не хватает сворачивания истории поиска»). Стрелки ↑↓ — по списку, Enter — выбрать.
// Режим с submit и list (навигация, Грегори 2026-11-04: «не под строкой поиска, а в окне поиска — это
// поиск и список поисковых запросов, только с возможностью проложить») — свой список в том же окне под
// строкой: list({ full }) → узлы; full — полный (строка в работе), иначе — только главное (щёлкнули мимо);
// Enter — его submit(текст), места он ищет сам через geocode() — тот же Nominatim с теми же правилами.
// refreshSearchList() — раздел перерисовывает свой список
// Поиск — модуль-служба: отправляет текст запроса и район карты, подчиняется режиму «без сети».
// Режимы (Грегори, 2026-10-29: «без окна поиска не обойтись; после выбора режимов в окне поиска должен
// появляться соответствующий значок»): раздел (Языки, Экскурсии, Альбомы) включает свой режим —
// setSearchMode({ icon, title, placeholder, filter(text), exit() }): у поля его значок с крестиком,
// ввод ищет внутри раздела (filter на каждую букву — это своё, не Nominatim). Значок режима — не в строке,
// а на кнопке справа вверху (событие search-mode, Грегори 2026-11-02: «логотип меняется на выбранную
// функцию, значок из окна поиска убираем»); там же — выход из режима
import { register, modules, allowed } from "./modules.js";
import { emit, on } from "./events.js";
import * as settings from "./settings.js";
import { uiLanguage, languageButton } from "./labels.js";
import { track } from "./popups.js";
import { historyList, remember as rememberIn } from "./history.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const HISTORY_KEY = "search.history";
const HISTORY_SIZE = 20;

const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
const CLEAR_ICON = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

register({
  id: "core/search",
  kind: "service",
  title: "Поиск мест",
  sends: "текст запроса и район карты (Nominatim, OpenStreetMap)",
});
const self = () => modules("service").find((m) => m.id === "core/search");

let mode = null, setMode = () => {};
// включить режим раздела (null — обратно к поиску мест)
export const setSearchMode = (m) => setMode(m);
let showMode = () => {};
export const refreshSearchList = () => showMode();
export const searchMode = () => mode;

// места по тексту (Nominatim): рядом с видимой частью карты — выше; null — поиск выключен в настройках
let mapRef = null;
export async function geocode(q, limit = 8) {
  if (!allowed(self())) return null;
  const params = new URLSearchParams({ q, format: "jsonv2", limit: String(limit), "accept-language": uiLanguage() });
  if (mapRef && mapRef.getZoom() >= 5) {
    const b = mapRef.getBounds();
    params.set("viewbox", [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map((v) => v.toFixed(4)).join(","));
    params.set("bounded", "0");
  }
  const res = await fetch(`${NOMINATIM}?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function initSearch({ map, maplibregl }) {
  mapRef = map;
  const bar = Object.assign(document.createElement("div"), { className: "search" });
  // слева — логотип Atlas (Грегори, 2026-10-29: строка поиска как у Google, логотип внутри слева)
  bar.innerHTML = `<div class="search-box">
      <input type="search" placeholder="Поиск места" autocomplete="off" enterkeyhint="search" aria-label="Поиск места">
      <button class="search-clear" title="Очистить" hidden>${CLEAR_ICON}</button>
      <button class="search-go" title="Найти">${SEARCH_ICON}</button>
    </div>
    <div class="search-results menu" hidden></div>`;
  bar.querySelector(".search-box").append(languageButton(map));
  document.body.append(bar);
  const input = bar.querySelector("input");
  const clearBtn = bar.querySelector(".search-clear");
  // ---------- режим раздела ----------
  setMode = (m) => {
    if (mode === m) return;
    const old = mode;
    mode = m;
    input.value = "";
    clearBtn.hidden = true;
    close();
    input.placeholder = m?.placeholder || "Поиск места";
    emit("search-mode", m && { icon: m.icon, title: m.title, tone: m.tone || "lang" });
    old?.filter("");
    full = true;
    showMode();
  };
  // свой список раздела — в окне поиска
  let full = true;
  showMode = () => {
    if (!mode?.list) return;
    const nodes = mode.list({ full });
    list.replaceChildren(...nodes);
    list.hidden = !nodes.length;
  };
  // закрыли поиск кнопкой справа вверху — выйти из режима раздела (и закрыть его панель)
  on("search-exit", () => { const m = mode; setMode(null); m?.exit(); }, { replay: false });
  const list = bar.querySelector(".search-results");
  let cursor = null; // display_name выделенной стрелками строки
  let marker = null;

  const close = () => { list.hidden = true; cursor = null; };
  const note = (text) => { list.replaceChildren(Object.assign(document.createElement("div"), { className: "search-note", textContent: text })); list.hidden = false; };

  const item = (r) => {
    const b = Object.assign(document.createElement("button"), { className: "search-item" });
    b.dataset.key = r.display_name;
    const [title, ...rest] = r.display_name.split(", ");
    b.innerHTML = `<span class="search-item-title"></span><span class="search-item-sub"></span>`;
    b.firstChild.textContent = title;
    b.lastChild.textContent = rest.join(", ");
    b.addEventListener("click", () => choose(r, title));
    return b;
  };


  const showHistory = () => {
    cursor = null;
    if (input.value.trim()) { close(); return; }
    const h = historyList({ key: HISTORY_KEY, title: "История поиска", id: (e) => e.display_name,
      label: (e) => { const [t, ...rest] = e.display_name.split(", "); return { title: t, sub: rest.join(", ") }; },
      pick: (e) => choose(e, e.display_name.split(", ")[0]), changed: showHistory });
    if (!h.childElementCount) { close(); return; }
    // строкам истории — как найденным: стрелки ↑↓ ходят по ним
    for (const b of h.querySelectorAll(".search-item")) b.dataset.key = b.closest(".search-history-row").entry.display_name;
    list.replaceChildren(h);
    list.hidden = false;
  };

  const run = async () => {
    cursor = null;
    const q = input.value.trim();
    if (!q) return;
    if (!allowed(self())) { note("Поиск мест выключен в настройках: он обращается в интернет"); return; }
    note("Поиск…");
    try {
      const results = await geocode(q);
      if (!results.length) { note("Ничего не найдено"); return; }
      list.replaceChildren(...results.map(item));
    } catch (err) {
      console.warn("Nominatim", err);
      note("Поиск не удался — проверьте интернет и попробуйте ещё раз");
    }
  };

  // новое место — наверх; уже известное остаётся на своём месте (избранное не перемешивается)
  const remember = (r) => rememberIn(HISTORY_KEY, { display_name: r.display_name, lat: r.lat, lon: r.lon, boundingbox: r.boundingbox },
    (e) => e.display_name, HISTORY_SIZE);

  const choose = (r, title) => {
    close();
    remember(r);
    input.value = title;
    clearBtn.hidden = false;
    const lngLat = [Number(r.lon), Number(r.lat)];
    marker?.remove();
    const content = document.createElement("div");
    content.append(Object.assign(document.createElement("div"), { className: "popup-title", textContent: title }),
      Object.assign(document.createElement("div"), { className: "popup-sub", textContent: r.display_name }));
    marker = new maplibregl.Marker({ color: "#e53935" }).setLngLat(lngLat)
      .setPopup(track(new maplibregl.Popup({ offset: 30 }).setDOMContent(content))).addTo(map);
    const [s, n, w, e] = r.boundingbox.map(Number); // boundingbox: юг, север, запад, восток
    map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 16, duration: 2500 });
    emit("place", { lngLat, title, address: r.display_name });
  };

  const mark = () => {
    for (const it of list.querySelectorAll(".search-item")) {
      const on = it.dataset.key === cursor;
      it.classList.toggle("active", on);
      if (on) it.scrollIntoView({ block: "nearest" });
    }
  };

  input.addEventListener("keydown", (e) => {
    const items = [...list.querySelectorAll(".search-item")];
    const i = items.findIndex((it) => it.dataset.key === cursor);
    if (e.key === "ArrowDown" && items.length) { e.preventDefault(); cursor = items[Math.min(items.length - 1, i + 1)].dataset.key; mark(); }
    else if (e.key === "ArrowUp" && i >= 0) { e.preventDefault(); cursor = i > 0 ? items[i - 1].dataset.key : null; mark(); }
    else if (e.key === "Enter") { if (mode) { mode.submit?.(input.value.trim()); return; } if (i >= 0) { e.preventDefault(); items[i].click(); } else run(); }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("input", () => { clearBtn.hidden = !input.value; full = true; if (mode) { mode.filter(input.value.trim()); showMode(); } else showHistory(); });
  input.addEventListener("focus", () => { full = true; if (!mode) showHistory(); else showMode(); });
  bar.querySelector(".search-go").addEventListener("click", () => { input.focus(); if (mode) (mode.submit || mode.filter)(input.value.trim()); else run(); });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.hidden = true;
    if (mode) { mode.filter(""); full = true; showMode(); input.focus(); return; }
    marker?.remove();
    marker = null;
    input.focus();
    showHistory();
  });
  // щелчок мимо поиска закрывает список (строка, по которой щёлкнули, могла уже перерисоваться)
  // у раздела со своим списком — сворачивается до главного (цель навигации остаётся видна)
  document.addEventListener("click", (e) => {
    if (!e.target.isConnected || bar.contains(e.target)) return;
    if (mode?.list) { if (full) { full = false; showMode(); } } else close();
  });
}

// Строка поиска мест (как в travel-earth): Nominatim — бесплатный геокодер OpenStreetMap, его
// правила запрещают подсказки на каждую букву, поэтому поиск — по Enter или лупе. Места рядом
// с видимой частью карты — выше в списке. История — последние выбранные места (до 20): при пустой
// строке видна под полем, щелчок ведёт на место без нового запроса; строки можно перетаскивать
// (так складывается своё избранное) и удалять. Стрелки ↑↓ — по списку, Enter — выбрать.
// Поиск — модуль-служба: отправляет текст запроса и район карты, подчиняется режиму «без сети»
import { register, modules, allowed } from "./modules.js";
import { emit } from "./events.js";
import * as settings from "./settings.js";
import { uiLanguage, languageButton } from "./labels.js";
import { track } from "./popups.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const HISTORY_KEY = "search.history";
const HISTORY_SIZE = 20;

const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
const CLEAR_ICON = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const DRAG_ICON = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-6 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 16a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>`;

register({
  id: "core/search",
  kind: "service",
  title: "Поиск мест",
  sends: "текст запроса и район карты (Nominatim, OpenStreetMap)",
});
const self = () => modules("service").find((m) => m.id === "core/search");

const loadHistory = () => settings.get(HISTORY_KEY, []);
const saveHistory = (list) => settings.set(HISTORY_KEY, list.length ? list : null);

export function initSearch({ map, maplibregl }) {
  const bar = Object.assign(document.createElement("div"), { className: "search" });
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

  const historyRow = (r) => {
    const row = Object.assign(document.createElement("div"), { className: "search-history-row" });
    row.entry = r;
    const handle = Object.assign(document.createElement("span"), { className: "search-drag", title: "Перетащить выше или ниже", innerHTML: DRAG_ICON });
    handle.addEventListener("pointerdown", (e) => drag(e, row));
    const del = Object.assign(document.createElement("button"), { className: "search-delete", title: "Удалить из истории", innerHTML: CLEAR_ICON });
    del.addEventListener("click", (e) => {
      e.stopPropagation(); // список перерисуется — щелчок не должен считаться «мимо поиска»
      saveHistory(loadHistory().filter((h) => h.display_name !== r.display_name));
      showHistory();
    });
    row.append(handle, item(r), del);
    return row;
  };

  // перетаскивание указателем (HTML5 drag-and-drop не работает на телефоне): соседи перепрыгивают
  // через строку, сама строка остаётся на месте — иначе браузер отпустит захват указателя
  const drag = (e, row) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const isRow = (n) => n?.classList?.contains("search-history-row");
    handle.setPointerCapture(e.pointerId);
    row.classList.add("dragging");
    const move = (ev) => {
      const { top, bottom } = row.getBoundingClientRect();
      if (ev.clientY < top && isRow(row.previousElementSibling)) list.insertBefore(row.previousElementSibling, row.nextElementSibling);
      else if (ev.clientY > bottom && isRow(row.nextElementSibling)) list.insertBefore(row.nextElementSibling, row);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      row.classList.remove("dragging");
      saveHistory([...list.querySelectorAll(".search-history-row")].map((r) => r.entry));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const showHistory = () => {
    cursor = null;
    const history = loadHistory();
    if (input.value.trim() || !history.length) { close(); return; }
    const clear = Object.assign(document.createElement("button"), { className: "search-history-clear", textContent: "Очистить историю" });
    clear.addEventListener("click", (e) => { e.stopPropagation(); saveHistory([]); close(); });
    list.replaceChildren(...history.map(historyRow), clear);
    list.hidden = false;
  };

  const run = async () => {
    cursor = null;
    const q = input.value.trim();
    if (!q) return;
    if (!allowed(self())) { note("Поиск мест выключен в настройках: он обращается в интернет"); return; }
    const params = new URLSearchParams({ q, format: "jsonv2", limit: "8", "accept-language": uiLanguage() });
    // места рядом с видимой частью карты — выше (bounded=0 — остальной мир не отсекается)
    if (map.getZoom() >= 5) {
      const b = map.getBounds();
      params.set("viewbox", [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map((v) => v.toFixed(4)).join(","));
      params.set("bounded", "0");
    }
    note("Поиск…");
    try {
      const res = await fetch(`${NOMINATIM}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const results = await res.json();
      if (!results.length) { note("Ничего не найдено"); return; }
      list.replaceChildren(...results.map(item));
    } catch (err) {
      console.warn("Nominatim", err);
      note("Поиск не удался — проверьте интернет и попробуйте ещё раз");
    }
  };

  // новое место — наверх; уже известное остаётся на своём месте (избранное не перемешивается)
  const remember = (r) => {
    const entry = { display_name: r.display_name, lat: r.lat, lon: r.lon, boundingbox: r.boundingbox };
    const history = loadHistory();
    if (!history.some((h) => h.display_name === entry.display_name)) saveHistory([entry, ...history].slice(0, HISTORY_SIZE));
  };

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
    else if (e.key === "Enter") { if (i >= 0) { e.preventDefault(); items[i].click(); } else run(); }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("input", () => { clearBtn.hidden = !input.value; showHistory(); });
  input.addEventListener("focus", showHistory);
  bar.querySelector(".search-go").addEventListener("click", () => { input.focus(); run(); });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.hidden = true;
    marker?.remove();
    marker = null;
    input.focus();
    showHistory();
  });
  // щелчок мимо поиска закрывает список (строка, по которой щёлкнули, могла уже перерисоваться)
  document.addEventListener("click", (e) => e.target.isConnected && !bar.contains(e.target) && close());
}

// Строка поиска мест (как в travel-earth): Nominatim — бесплатный геокодер OpenStreetMap, его
// правила запрещают запросы на каждую букву, поэтому поиск — по Enter или лупе. Места рядом с
// видимой частью карты — выше в списке. Поведение окна (Грегори 2026-11-05, «общепринятые контролы»):
//   • открыли поиск — просто строка, без курсора и без списка;
//   • щелчок по строке — список подсказок (история: последние выбранные места, до 20), следующий
//     щелчок — список закрывается; щелчок мимо — тоже;
//   • начали набирать — подсказки из уже найденного (история, без запросов в сеть), Enter — поиск,
//     найденное — в том же списке, выбрали — место на карте, список закрывается;
//   • строки истории перетаскиваются и удаляются (core/history.js), внизу списка — ползунок высоты.
// Стрелки ↑↓ — по списку, Enter — выбрать.
// Режимы раздела: setSearchMode({ icon, title, placeholder, filter(text), exit() }) — ввод ищет
// внутри раздела (filter на каждую букву — своё, не Nominatim); значок режима — на кнопке справа
// вверху (событие search-mode). Режим со своим списком (навигация): list(text) → узлы подсказок
// вместо истории, submit(text) — Enter (места он ищет сам через geocode() — тот же Nominatim);
// card() → карточка над списком — отдельная панель (куда идти), она сворачивается своей кнопкой, а
// в строке тогда — значок (cardIcon()), щелчок по нему — карточка снова. refreshSearchList() —
// раздел перерисовал своё, foldSearchList() — выбрал: список закрыть, карточку показать.
// Поиск — модуль-служба: отправляет текст запроса и район карты, подчиняется режиму «без сети»
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
const CLEAR_ICON = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

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
let refresh = () => {}, picked = () => {};
// withList — и подсказки (если открыты): карточка обновляется часто (каждый замер GPS), список — нет
export const refreshSearchList = (withList = false) => refresh(withList);
export const foldSearchList = () => picked();
let foldCard = () => {};
// свернуть карточку раздела в значок в строке поиска
export const foldSearchCard = () => foldCard();
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
      <button class="search-card-btn" title="Показать" hidden></button>
      <button class="search-clear" title="Очистить" hidden>${CLEAR_ICON}</button>
      <button class="search-go" title="Найти">${SEARCH_ICON}</button>
    </div>
    <div class="search-card menu" hidden></div>
    <div class="search-results menu" hidden></div>`;
  bar.querySelector(".search-box").append(languageButton(map));
  document.body.append(bar);
  const input = bar.querySelector("input");
  const clearBtn = bar.querySelector(".search-clear");
  const cardBtn = bar.querySelector(".search-card-btn");
  const cardBox = bar.querySelector(".search-card");
  const list = bar.querySelector(".search-results");
  let cursor = null; // display_name выделенной стрелками строки
  let marker = null;
  let cardOpen = true; // карточка раздела развёрнута (свернули — значок в строке)

  // ---------- режим раздела ----------
  setMode = (m) => {
    if (mode === m) return;
    const old = mode;
    mode = m;
    input.value = "";
    clearBtn.hidden = true;
    close();
    cardOpen = true;
    input.placeholder = m?.placeholder || "Поиск места";
    emit("search-mode", m && { icon: m.icon, title: m.title, tone: m.tone || "lang" });
    old?.filter("");
    refresh();
  };
  // карточка раздела (куда идти) — своя панель над списком; свёрнута — значок в строке
  refresh = (withList = true) => {
    const card = mode?.card?.() || null;
    cardBox.replaceChildren(...(card ? [card] : []));
    cardBox.hidden = !card || !cardOpen;
    cardBtn.hidden = !card || cardOpen;
    if (card && !cardOpen) { cardBtn.innerHTML = mode.cardIcon?.() || ""; cardBtn.title = mode.cardTitle?.() || "Показать"; }
    if (withList && (!list.hidden || wantList)) suggest();
  };
  picked = () => { close(); cardOpen = true; refresh(); input.blur(); };
  cardBtn.addEventListener("click", (e) => { e.stopPropagation(); cardOpen = true; refresh(); });
  // карточка сворачивается своей кнопкой (раздел зовёт foldCard)
  foldCard = () => { cardOpen = false; refresh(); };

  let wantList = false; // нажали Enter в разделе — его найденное покажется, когда придёт
  const close = () => { list.hidden = true; cursor = null; wantList = false; };
  // ползунок внизу списка (как у окон, Грегори 2026-11-04: «история поиска должна иметь движок внизу»):
  // потянуть — список выше или ниже, высота помнится; двойное нажатие — снова по содержимому
  const grip = Object.assign(document.createElement("div"), { className: "panel-grip search-grip", title: "Потяните — список выше или ниже" });
  const setH = (px) => { list.style.maxHeight = px ? `${px}px` : ""; settings.set("search.h", px || null); };
  if (settings.get("search.h")) list.style.maxHeight = `${Math.min(settings.get("search.h"), innerHeight - 120)}px`;
  let pull = null;
  grip.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); grip.setPointerCapture(e.pointerId); pull = { y: e.clientY, h: list.getBoundingClientRect().height }; });
  grip.addEventListener("pointermove", (e) => {
    if (!pull) return;
    setH(Math.round(Math.max(120, Math.min(innerHeight - list.getBoundingClientRect().top - 8, pull.h + e.clientY - pull.y))));
  });
  grip.addEventListener("pointerup", () => { pull = null; });
  grip.addEventListener("pointercancel", () => { pull = null; });
  grip.addEventListener("dblclick", () => setH(null));
  grip.addEventListener("click", (e) => e.stopPropagation());
  // в списке ползунок всегда последним; пустой список — закрыт
  // прокручивается только середина списка (Грегори 2026-11-05: на телефоне при прокрутке уезжал ползунок или
  // всё окно вверх): ползунок — снаружи прокрутки, всегда внизу; прокрутка не передаётся странице
  const scroller = Object.assign(document.createElement("div"), { className: "search-scroll" });
  const fill = (...nodes) => { scroller.replaceChildren(...nodes); scroller.scrollTop = 0; list.replaceChildren(...(nodes.length ? [scroller, grip] : [])); list.hidden = !nodes.length; };
  // высота — по видимой части экрана: открылась клавиатура — список над ней, не под ней
  const vv = window.visualViewport;
  const fit = () => document.documentElement.style.setProperty("--vvh", `${Math.round(vv ? vv.height : innerHeight)}px`);
  vv?.addEventListener("resize", fit);
  addEventListener("resize", fit);
  fit();
  const note = (text) => fill(Object.assign(document.createElement("div"), { className: "search-note", textContent: text }));

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

  // подсказки: история, при наборе — то, что уже находили и в тексте есть набранное
  const suggest = () => {
    cursor = null;
    const q = input.value.trim().toLowerCase();
    if (mode?.list) { fill(...mode.list(q)); return; }
    if (mode) { close(); return; }
    const h = historyList({ key: HISTORY_KEY, id: (e) => e.display_name, match: q ? (e) => e.display_name.toLowerCase().includes(q) : null,
      label: (e) => { const [t, ...rest] = e.display_name.split(", "); return { title: t, sub: rest.join(", ") }; },
      pick: (e) => choose(e, e.display_name.split(", ")[0]), changed: suggest });
    if (!h.childElementCount) { close(); return; }
    // строкам истории — как найденным: стрелки ↑↓ ходят по ним
    for (const b of h.querySelectorAll(".search-item")) b.dataset.key = b.closest(".search-history-row").entry.display_name;
    fill(h);
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
      fill(...results.map(item));
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
    input.blur();
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
    for (const it of scroller.querySelectorAll(".search-item")) {
      const on = it.dataset.key === cursor;
      it.classList.toggle("active", on);
      if (on) it.scrollIntoView({ block: "nearest" });
    }
  };

  input.addEventListener("keydown", (e) => {
    const items = [...list.querySelectorAll(".search-item")];
    const i = items.findIndex((it) => it.dataset.key === cursor);
    if (e.key === "ArrowDown" && items.length) { e.preventDefault(); if (list.hidden) suggest(); cursor = items[Math.min(items.length - 1, i + 1)].dataset.key; mark(); }
    else if (e.key === "ArrowUp" && i >= 0) { e.preventDefault(); cursor = i > 0 ? items[i - 1].dataset.key : null; mark(); }
    else if (e.key === "Enter") {
      if (i >= 0 && !list.hidden) { e.preventDefault(); items[i].click(); return; }
      if (mode?.submit) { wantList = true; mode.submit(input.value.trim()); } else if (!mode) run();
    } else if (e.key === "Escape") close();
  });
  // набор — подсказки из уже найденного (в разделе — его поиск по буквам)
  input.addEventListener("input", () => {
    clearBtn.hidden = !input.value;
    if (mode && !mode.list) { mode.filter(input.value.trim()); return; }
    mode?.filter(input.value.trim());
    suggest();
  });
  // щелчок по строке — подсказки, следующий — закрыть (без щелчка список сам не открывается)
  input.addEventListener("click", () => {
    if (!list.hidden) close();
    else if (!mode || mode.list) suggest();
  });
  bar.querySelector(".search-go").addEventListener("click", () => {
    if (mode?.submit) { wantList = true; mode.submit(input.value.trim()); } else if (mode) mode.filter(input.value.trim()); else run();
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.hidden = true;
    if (mode) { mode.filter(""); if (mode.list) suggest(); return; }
    marker?.remove();
    marker = null;
    suggest();
  });
  // щелчок мимо поиска закрывает список подсказок (карточка раздела остаётся)
  document.addEventListener("click", (e) => e.target.isConnected && !bar.contains(e.target) && close());
}


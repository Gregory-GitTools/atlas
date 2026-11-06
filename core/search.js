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
// Карточка пути (навигация, setSearchCard({ card, icon, title })) — висящий маршрут, работает при
// любом режиме: отдельная панель под строкой; свёрнута — в строке стрелка, щелчок — карточка снова.
// Открыто всегда одно окно (Грегори 2026-11-05): подсказки, карточка пути или окно раздела — другое
// уходит значком в строку (окно раздела — своим значком, событие panel-fold) и возвращается щелчком по
// нему или по строке (щелчок по строке открывает окно активного режима). refreshSearchList() —
// раздел перерисовал своё, foldSearchList() — выбрал: список закрыть, карточку показать.
// Поиск — модуль-служба: отправляет текст запроса и район карты, подчиняется режиму «без сети»
import { register, modules, allowed } from "./modules.js";
import { emit, on } from "./events.js";
import * as settings from "./settings.js";
import { uiLanguage } from "./labels.js";
import { track } from "./popups.js";
import { closeOpen } from "./panel.js";
import { historyList, remember as rememberIn } from "./history.js";
import { backable } from "./back.js";

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
let foldCard = () => {}, cardSrc = null;
// карточка пути — от навигации, при любом режиме
export const setSearchCard = (src) => { cardSrc = src; refresh(false); };
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
      <button class="search-clear" title="Очистить" hidden>${CLEAR_ICON}</button>
      <button class="search-go" title="Найти">${SEARCH_ICON}</button>
    </div>
    <div class="search-card menu" hidden></div>
    <div class="search-results menu" hidden></div>`;
  document.body.append(bar);
  const input = bar.querySelector("input");
  const clearBtn = bar.querySelector(".search-clear");
  const cardBox = bar.querySelector(".search-card");
  const list = bar.querySelector(".search-results");
  let cursor = null; // display_name выделенной стрелками строки
  let marker = null;
  let cardOpen = true; // карточка пути развёрнута (свернули — стрелка в строке)
  let folded = null, leftOpen = false; // свёрнутое окно раздела { id, icon, title }; открыто ли окно слева
  on("panel-fold", (f) => { folded = f; leftOpen = !!leftOpen && !f; refresh(false); }, { replay: false });
  on("panel", (p) => {
    leftOpen = p?.side === "left";
    if (!p || p.side === "left") folded = null;
    // открылось окно раздела — карточка пути уходит в строку
    if (leftOpen) { cardOpen = false; close(); }
    refresh(false);
  }, { replay: false });
  const unfoldPanel = () => { cardOpen = false; close(); emit("panel-fold-request", { fold: false }); };
  // «Поиск места» в барабане — из режима раздела в обычный поиск: окно раздела закрыть, режим снять
  on("search-plain", () => { closeOpen("left"); setMode(null); input.value = ""; clearBtn.hidden = true; }, { replay: false });
  // открыт ли поиск (кнопка справа вверху) — карточка пути видна только с ним
  let searchOn = false, cardShown = false;
  on("search-shown", (v) => { searchOn = v; refresh(false); });

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
    const card = cardSrc?.card() || null;
    cardBox.replaceChildren(...(card ? [card] : []));
    // одно окно за раз: открыты подсказки или окно раздела — карточки нет (её стрелка — в столбике под
    // логотипом, core/layers-panel.js); в строке поиска — только лупа (Грегори 2026-11-06)
    const shown = !!card && cardOpen && list.hidden && !leftOpen;
    cardBox.hidden = !shown;
    const open = shown && searchOn;
    if (open !== cardShown) { cardShown = open; emit("route-card", { open }); }
    if (withList && (!list.hidden || wantList)) suggest();
  };
  // карточку пути открыли — окно раздела уходит в строку
  const showCard = () => { close(); input.blur(); cardOpen = true; if (leftOpen) emit("panel-fold-request", { fold: true }); refresh(false); };
  picked = showCard;
  // стрелка пути в столбике: карточка видна — свернуть, нет — показать
  on("route-card-toggle", () => (cardShown ? foldCard() : showCard()), { replay: false });
  // карточка сворачивается своей кнопкой (раздел зовёт foldCard)
  foldCard = () => { cardOpen = false; refresh(); };

  let wantList = false; // нажали Enter в разделе — его найденное покажется, когда придёт
  // подсказки — шаг для «Назад» телефона; закрылись — снова карточка раздела
  let listBack = null;
  const close = () => {
    const was = !list.hidden;
    list.hidden = true; cursor = null; wantList = false;
    if (listBack) { const d = listBack; listBack = null; d(); }
    if (was) refresh(false);
  };
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
  const fill = (...nodes) => {
    scroller.replaceChildren(...nodes);
    scroller.scrollTop = 0;
    if (!nodes.length) { close(); return; }
    list.replaceChildren(scroller, grip);
    const was = list.hidden;
    list.hidden = false;
    if (!listBack) listBack = backable(() => { listBack = null; close(); });
    if (leftOpen) emit("panel-fold-request", { fold: true }); // подсказки — одно окно с окном раздела
    if (was) refresh(false);
  };
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

  // набрано что-то — первой строкой «Искать «…» везде» (то же, что Enter; Грегори 2026-11-05): видно, что
  // история — только найденное раньше, а настоящий поиск — по Enter или этой строке
  const submit = () => { if (mode?.submit) { wantList = true; mode.submit(input.value.trim()); } else if (mode) mode.filter(input.value.trim()); else run(); };
  const everywhere = (q) => {
    const b = Object.assign(document.createElement("button"), { className: "search-item search-everywhere" });
    b.dataset.key = " everywhere";
    b.innerHTML = `<span class="search-item-title"></span><span class="search-item-sub">Enter — поиск по всей карте</span>`;
    b.firstChild.textContent = `Искать «${q}» везде`;
    b.addEventListener("click", submit);
    return b;
  };
  // подсказки: история, при наборе — то, что уже находили и в тексте есть набранное
  const suggest = () => {
    cursor = null;
    const raw = input.value.trim(), q = raw.toLowerCase();
    if (mode?.list) {
      const nodes = mode.list(q);
      // найденное (строки прямо в списке) — без строки «искать везде»; история — с ней
      fill(...(raw && mode.submit && !nodes.some((n) => n.classList?.contains("search-item")) ? [everywhere(raw)] : []), ...nodes);
      return;
    }
    if (mode) { close(); return; }
    const h = historyList({ key: HISTORY_KEY, id: (e) => e.display_name, match: q ? (e) => e.display_name.toLowerCase().includes(q) : null,
      label: (e) => { const [t, ...rest] = e.display_name.split(", "); return { title: t, sub: rest.join(", ") }; },
      pick: (e) => choose(e, e.display_name.split(", ")[0]), changed: suggest });
    // строкам истории — как найденным: стрелки ↑↓ ходят по ним
    for (const b of h.querySelectorAll(".search-item")) b.dataset.key = b.closest(".search-history-row").entry.display_name;
    const top = raw ? [everywhere(raw)] : [];
    if (!h.childElementCount && !top.length) { close(); return; }
    fill(...top, ...(h.childElementCount ? [h] : []));
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
      if (mode?.submit || !mode) submit();
    } else if (e.key === "Escape" && !list.hidden) { e.preventDefault(); close(); }
  });
  // набор — подсказки из уже найденного (в разделе — его поиск по буквам)
  input.addEventListener("input", () => {
    clearBtn.hidden = !input.value;
    if (mode && !mode.list) { mode.filter(input.value.trim()); return; }
    mode?.filter(input.value.trim());
    suggest();
  });
  // щелчок по строке — подсказки (и клавиатура), следующий — подсказки закрыть и клавиатуру спрятать
  // (Грегори 2026-11-05: «остаётся только окно без клавиатуры»); «Назад» на телефоне прячет клавиатуру,
  // подсказки остаются; без щелчка список сам не открывается
  // у раздела без своих подсказок (Экскурсии, Альбомы…) щелчок открывает его свёрнутое окно
  input.addEventListener("click", () => {
    if (!list.hidden) { close(); input.blur(); }
    else if (!mode || mode.list) { if (leftOpen) emit("panel-fold-request", { fold: true }); suggest(); }
    else if (folded) unfoldPanel();
  });
  bar.querySelector(".search-go").addEventListener("click", submit);
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


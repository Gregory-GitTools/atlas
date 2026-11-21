// Окно настроек: «Поделиться» (первой строкой — Грегори, 2026-10-29), перенос настроек файлом, «Что уходит в сеть» (у каждого модуля — что отправляет
// и переключатель), режим «без сети», загруженные данные и модели. Список модулей строится из
// реестра — новый модуль появляется здесь сам
import { createPanel } from "./panel.js";
import { on, emit } from "./events.js";
import { modules, available, toggle, onRegister, isBlocked, setBlocked, offline, setOffline, isMobile } from "./modules.js";
import { downloadArea, downloading, stopDownload, trips, removeTrip, fits, routeLine, routeFits, basemapOk } from "./offline.js";
import * as settings from "./settings.js";
import { LANGUAGES, labelLanguage, setLabelLanguage } from "./labels.js";
import { usage, models, removeModel, formatBytes, persist, viewCache, clearViewCache, storageParts } from "./storage.js";
import { installSection, openedForInstall } from "./install.js";
import { VERSION, updated, appVersion } from "./version.js";

export const GEAR_ICON = `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54a7.4 7.4 0 0 0-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54a7.4 7.4 0 0 0 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>`;

const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });

// постоянная часть: сама карта (подложка) тянет плитки района, пока нет скачанной поездки
const CORE_SENDS = [{ title: "Карта", sends: "район карты (без сети — только скачанные поездки)" }];

export function initSettingsPanel(ctx) {
  // окно — слева под строкой поиска, как окна разделов (Грегори 2026-11-06: «всё по возможности
  // одинаково»); открывает его шестерёнка в барабане разделов (core/layers-panel.js, событие settings-open)
  const panel = createPanel({ id: "settings", title: "Настройки", icon: GEAR_ICON, side: "left" });
  on("settings-open", () => { panel.open(); render(); }, { replay: false });

  async function render() {
    const body = [];

    body.push(shareRow(ctx));
    body.push(h("h3", "set-title", "Установка"), installSection());
    // версия (Грегори 2026-11-21: «напиши в информации и в настройках»)
    body.push(h("p", "set-hint set-version", `Atlas ${VERSION}${appVersion() ? ` · приложение Android ${appVersion()}` : ""} · обновлено ${updated()}`));
    body.push(h("h3", "set-title", "Размер кнопок и текста"), sizeSection());
    body.push(h("h3", "set-title", "Подписи"), labelsSection(ctx));

    // свои разделы модулей (например, папка «Моих альбомов»)
    for (const m of modules().filter((m) => m.settings && available(m))) {
      const node = m.settings(ctx, render);
      if (node) body.push(h("h3", "set-title", m.title), node);
    }

    // перенос
    body.push(h("h3", "set-title", "Перенос на другое устройство"));
    const row = h("div", "set-row");
    const save = h("button", "text-btn", "Сохранить в файл");
    save.addEventListener("click", () => settings.downloadSettings());
    const load = h("button", "text-btn", "Загрузить из файла");
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json", hidden: true });
    load.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      try {
        settings.importAll(JSON.parse(await input.files[0].text()));
        ctx.status("Настройки загружены — страница перезапустится");
        setTimeout(() => location.reload(), 1200);
      } catch (err) { ctx.status(err.message); }
    });
    row.append(save, load, input);
    body.push(row, h("p", "set-hint", "Всё, что программа запоминает, хранится только на этом устройстве. Файл переносит настройки на другое."));

    // сеть
    body.push(h("h3", "set-title", "Что уходит в сеть"));
    const off = h("label", "set-switch");
    const offBox = Object.assign(document.createElement("input"), { type: "checkbox", checked: offline() });
    offBox.addEventListener("change", async () => { await setOffline(offBox.checked, ctx); render(); });
    off.append(offBox, document.createTextNode(" Без сети — выключить всё, что обращается в интернет"));
    body.push(off);
    const net = h("div", "set-list");
    for (const item of CORE_SENDS) net.append(netRow(item.title, item.sends));
    for (const m of modules().filter((m) => m.sends)) {
      const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: !isBlocked(m.id), disabled: offline() });
      box.addEventListener("change", async () => { await setBlocked(m.id, !box.checked, ctx); render(); });
      net.append(netRow(m.title, m.sends, box));
    }
    body.push(net);

    // карта без сети (ROADMAP «Скачать поездку», первая часть): скачивается то, что видно на карте
    body.push(h("h3", "set-title", "Карта без сети"), tripSection());

    // место на устройстве (план «Карта без сети»: обзор хранилища) — всего, полоса по видам и строки с размерами
    body.push(h("h3", "set-title", "Место на устройстве"), await placeSection());
    const u = await usage();
    const list = Object.entries(models());
    if (!list.length) body.push(h("p", "set-hint", "Голоса, переводчик и другие большие файлы появятся здесь, когда вы их скачаете."));
    const ml = h("div", "set-list");
    for (const [id, m] of list) {
      const del = h("button", "text-btn", "Удалить");
      del.addEventListener("click", async () => { await removeModel(id); render(); });
      ml.append(netRow(m.title, formatBytes(m.bytes), del));
    }
    body.push(ml);
    // запомненное при просмотре (Грегори 2026-11-04: «где хранятся? нужна кнопка очистить»): в хранилище
    // браузера на этом устройстве, не папкой на диске — открыть её нельзя, очистить можно
    const vc = await viewCache().catch(() => ({ n: 0, bytes: 0 }));
    const vrow = h("div", "set-row");
    const vclear = h("button", "text-btn", "Очистить историю просмотра");
    vclear.disabled = !vc.n;
    vclear.addEventListener("click", async () => { vclear.disabled = true; await clearViewCache().catch(() => {}); render(); });
    vrow.append(h("span", "set-hint", vc.n ? `Запомнено при просмотре: ${formatBytes(vc.bytes)}` : "Запомненного при просмотре нет"), vclear);
    body.push(vrow, h("p", "set-hint", "Найденные на карте снимки, тропы, места экскурсий и сведения о ваших снимках программа помнит неделю, чтобы знакомые места открывались без интернета и быстрее. Хранится это внутри браузера на этом устройстве, отдельной папки на диске нет. Ваши треки и выбранные папки очистка не трогает. Сами картинки браузер держит в своём временном хранилище и удаляет сам."));
    if (!u.persisted && (list.length || trips().length)) {
      const keep = h("button", "text-btn", "Не удалять скачанное при нехватке места");
      keep.addEventListener("click", async () => { await persist(); render(); });
      body.push(keep);
    }

    panel.body.replaceChildren(...body);
  }

  // «Скачать район на карте»: кнопка видна всегда; неактивна без сети, во время скачивания и когда
  // район слишком велик (тогда под ней — почему). Ход скачивания обновляется на месте, без перерисовки окна
  let tripUi = null;
  const tripState = () => {
    if (!tripUi) return;
    const { dl, dlRoute, stop, prog, why } = tripUi;
    const job = downloading(), big = !fits(ctx.map), net = !offline() && navigator.onLine;
    const line = routeLine(), long = !!line && !routeFits(), map = basemapOk();
    dl.disabled = !!job || big || !net || !map;
    dlRoute.disabled = !!job || !line || long || !net || !map;
    stop.hidden = !job;
    prog.textContent = !job ? "" : job.phase ? `${job.phase}…` : `Скачивается: ${job.total ? Math.floor((job.done / job.total) * 100) : 0} %`;
    why.textContent = [!net && "Нужен интернет.", net && !map && "Эту карту скачать нельзя — выберите в «Картах» «Яркую» или «Контрастную».", net && map && big && "Район на карте: приблизьте карту — примерно до 100 км.",
      net && map && !line && "Вдоль маршрута: сначала составьте маршрут в «Навигации» — две точки или больше.", net && map && long && "Маршрут слишком длинный для скачивания — примерно до 1000 км."].filter(Boolean).join(" ");
  };
  ctx.map.on("moveend", () => !panel.el.hidden && tripState());
  on("basemap", () => !panel.el.hidden && tripState(), { replay: false });
  on("route", () => !panel.el.hidden && tripState(), { replay: false });
  function tripSection() {
    const box = h("div", "trip-box");
    const row = h("div", "set-row");
    const dl = h("button", "text-btn trip-dl", "Скачать район на карте");
    const dlRoute = h("button", "text-btn trip-dl-route", "Скачать вдоль маршрута");
    const stop = h("button", "text-btn", "Остановить");
    const prog = h("span", "set-hint trip-prog"), why = h("p", "set-hint trip-why");
    const start = async (line) => {
      const done = downloadArea(ctx.map, tripState, line);
      tripState();
      const item = await done.catch((err) => { ctx.status(`Не скачалось: ${err.message}`); return null; });
      if (item) ctx.status(`Скачано: ${item.title}, ${formatBytes(item.bytes)}`);
      if (!panel.el.hidden) render();
    };
    dl.addEventListener("click", () => start(null));
    dlRoute.addEventListener("click", () => start(routeLine()));
    stop.addEventListener("click", () => stopDownload());
    row.append(dl, dlRoute, prog, stop);
    tripUi = { dl, dlRoute, stop, prog, why };
    tripState();
    const list = h("div", "set-list trip-list");
    for (const t of trips()) {
      const btns = h("div", "set-row");
      const show = h("button", "text-btn", "Показать"), del = h("button", "text-btn", "Удалить");
      show.addEventListener("click", () => {
        const [w, s, e, n] = t.box;
        if (isMobile()) panel.close();
        ctx.map.fitBounds([[w, s], [e, n]], { padding: 20 });
      });
      del.addEventListener("click", async () => { del.disabled = true; await removeTrip(t.id); render(); });
      btns.append(show, del);
      list.append(netRow(t.title, `${formatBytes(t.bytes)}${t.tours ? ` · экскурсий: ${t.tours}` : ""} · ${new Date(t.saved).toLocaleDateString("ru")}`, btns));
    }
    box.append(row, why, list, h("p", "set-hint", "«Район на карте» — то, что видно на карте сейчас; «Вдоль маршрута» — полоса по 3 км в обе стороны от маршрута из «Навигации» (от старта до финиша). Скачивается карта до отдельных домов и тропинок, высоты — если включены тени или горизонтали, и сама программа. Вместе с ней — все экскурсии и разговорники, а у экскурсий этой страны — места остановок. Без сети она откроется и покажет этот район; скачанное берётся с устройства и в сети, чтобы не тратить роуминг. Спутник, тропы, погода, поиск и снимки в слайд-шоу экскурсий — только в сети."));
    return box;
  }

  const netRow = (title, what, control) => {
    const r = h("div", "set-item");
    const text = h("div", "set-item-text");
    text.append(h("div", "set-item-title", title), h("div", "set-item-sub", what));
    r.append(text);
    if (control) r.append(control);
    return r;
  };

  onRegister(() => !panel.el.hidden && render());

  // пришли по кнопке «Установить» из другого браузера — сразу настройки
  if (openedForInstall()) {
    history.replaceState(null, "", location.pathname);
    ctx.map.once("load", () => { emit("search-show"); panel.open(); render(); });
  }
}

// «Поделиться»: ссылка на сайт программы (Грегори, 2026-10-29: «ссылку на сайт программы, а не на
// геолокацию»). Где браузер умеет — системное окно «Поделиться» (на телефоне — мессенджеры, почта),
// иначе ссылка копируется
const SHARE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5a3 3 0 1 0-5.91.7L8.04 9.81A2.99 2.99 0 0 0 3 12a3 3 0 0 0 5.04 2.19l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z"/></svg>';
export const SITE = "https://gregory-gittools.github.io/atlas/";

// обзор места: всего занято и сколько ещё можно; полоса — доли видов данных; ниже — строки с цветом и размером.
// «Программа и прочее» — разница между общим и известным (файлы программы, служебное браузера)
const PARTS = [["trips", "Карты для поездок", "--tone-nav"], ["tracks", "Мои треки", "--tone-track"], ["models", "Голоса и переводчик", "--tone-lang"],
  ["view", "Запомнено при просмотре", "--tone-weather"], ["rest", "Программа и прочее", "--muted"]];
async function placeSection() {
  const box = h("div", "place-box");
  const p = await storageParts().catch(() => null);
  if (!p) { box.append(h("p", "set-hint", "Браузер не сообщает, сколько места занято.")); return box; }
  const sizes = { trips: trips().reduce((s, t) => s + (t.bytes || 0), 0) + p.trip, tracks: p.tracks, models: p.models, view: p.view };
  sizes.rest = Math.max(0, p.total - sizes.trips - sizes.tracks - sizes.models - sizes.view);
  const total = Math.max(p.total, Object.values(sizes).reduce((a, b) => a + b, 0));
  const free = p.quota > total ? p.quota - total : 0;
  box.append(h("p", "place-sum", `Занято ${formatBytes(total)}${free ? ` · можно ещё около ${formatBytes(free)}` : ""}${p.persisted ? " · хранится надёжно" : ""}`));
  const bar = h("div", "place-bar");
  const list = h("div", "set-list");
  for (const [key, title, tone] of PARTS) {
    const n = sizes[key];
    if (n && total) {
      const seg = h("span", "place-seg");
      seg.style.width = `${Math.max(1, (n / total) * 100)}%`;
      seg.style.background = `var(${tone})`;
      seg.title = `${title}: ${formatBytes(n)}`;
      bar.append(seg);
    }
    const row = h("div", "set-item place-row");
    const dot = h("span", "place-dot");
    dot.style.background = `var(${tone})`;
    row.append(dot, h("span", "set-item-text set-item-title", title), h("span", "place-size", n ? formatBytes(n) : "нет"));
    row.classList.toggle("empty", !n);
    list.append(row);
  }
  box.append(bar, list);
  return box;
}

// размер кнопок и текста (core/ui-scale.js; Грегори 2026-11-17, магнитола): «Авто» — крупный на широком
// сенсорном экране лёжа (машина), иначе обычный. Где браузер так не умеет (компьютер) — кнопки неактивны,
// под ними почему
const SIZES = [["auto", "Авто"], [1, "Обычный"], [1.25, "Крупный"], [1.5, "Очень крупный"]];
// язык подписей на карте (был кнопкой под логотипом) и подписи с номерами у кнопок барабанов и каруселей
// (Грегори 2026-11-21: «в меню пункты видимости подписей… номера карусельных кнопок… всегда можно выключить»)
function labelsSection(ctx) {
  const box = h("div", "set-list");
  const lang = h("label", "set-row set-lang-row", "Язык подписей на карте ");
  const select = h("select", "set-lang");
  for (const l of LANGUAGES) select.append(Object.assign(document.createElement("option"), { value: l.code, textContent: l.name, selected: l === labelLanguage() }));
  select.addEventListener("change", () => setLabelLanguage(ctx.map, LANGUAGES.find((l) => l.code === select.value)));
  lang.append(select);
  box.append(lang);
  for (const [key, text] of [["ui.labels", "Подписи кнопок"], ["ui.numbers", "Номера кнопок"]]) {
    const row = h("label", "set-switch");
    const check = Object.assign(document.createElement("input"), { type: "checkbox", checked: settings.get(key) !== false });
    check.dataset.key = key;
    check.addEventListener("change", () => { settings.set(key, check.checked ? null : false); emit("button-labels"); });
    row.append(check, document.createTextNode(` ${text}`));
    box.append(row);
  }
  return box;
}

function sizeSection() {
  const ui = window.atlasUi;
  const box = h("div", "size-box");
  const row = h("div", "set-row");
  const hint = h("p", "set-hint");
  const why = h("p", "set-hint size-why");
  const paint = () => {
    const no = !ui || !ui.supported; // компьютер: страницу так не растянуть — там Ctrl и +
    row.querySelectorAll("button").forEach((b) => {
      const v = SIZES[+b.dataset.i][0];
      b.classList.toggle("on", !no && ui.choice === v);
      b.disabled = no;
    });
    hint.textContent = no ? "" : ui.choice === "auto" ? `Сейчас ${ui.auto > 1 ? "крупный — экран машины" : "обычный"}. Крупный — на широком сенсорном экране лёжа (магнитола).` : "";
    why.textContent = no ? "На компьютере размер меняют клавиши Ctrl и + или Ctrl и −." : "";
  };
  SIZES.forEach(([v, label], i) => {
    const b = h("button", "text-btn size-btn", label);
    b.dataset.i = i;
    b.addEventListener("click", () => {
      ui.set(v);
      paint();
    });
    row.append(b);
  });
  const again = () => (box.isConnected ? paint() : removeEventListener("atlas-ui-scale", again));
  addEventListener("atlas-ui-scale", again);
  paint();
  box.append(row, hint, why);
  return box;
}

function shareRow(ctx) {
  const b = h("button", "share-btn");
  b.innerHTML = `${SHARE_ICON}<span>Поделиться</span>`;
  b.title = "Ссылка на Atlas";
  b.addEventListener("click", async () => {
    const url = SITE;
    if (navigator.share) {
      try { await navigator.share({ title: "Atlas", url }); return; } catch (err) { if (err.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); ctx.status("Ссылка скопирована"); }
    catch { prompt("Ссылка на Atlas:", url); }
    setTimeout(() => ctx.status(""), 2500);
  });
  return b;
}

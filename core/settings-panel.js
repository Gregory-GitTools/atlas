// Окно настроек: «Поделиться» (первой строкой — Грегори, 2026-10-29), перенос настроек файлом, «Что уходит в сеть» (у каждого модуля — что отправляет
// и переключатель), режим «без сети», загруженные данные и модели. Список модулей строится из
// реестра — новый модуль появляется здесь сам
import { createPanel } from "./panel.js";
import { modules, available, toggle, onRegister, isBlocked, setBlocked, offline, setOffline } from "./modules.js";
import * as settings from "./settings.js";
import { usage, models, removeModel, formatBytes, persist } from "./storage.js";
import { installSection, openedForInstall } from "./install.js";

const GEAR_ICON = `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54a7.4 7.4 0 0 0-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54a7.4 7.4 0 0 0 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>`;

const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });

// постоянная часть: сама карта (подложка) тянет плитки района, пока нет скачанной поездки
const CORE_SENDS = [{ title: "Карта", sends: "район карты (без сети — только скачанные поездки)" }];

export function initSettingsPanel(ctx) {
  const panel = createPanel({ id: "settings", title: "Настройки", icon: GEAR_ICON });

  // кнопка-шестерёнка — в столбике кнопок карты слева внизу
  ctx.map.addControl({
    onAdd() {
      const box = h("div", "maplibregl-ctrl maplibregl-ctrl-group");
      const b = Object.assign(document.createElement("button"), { type: "button", title: "Настройки", innerHTML: GEAR_ICON, className: "ctrl-icon" });
      b.addEventListener("click", () => { panel.toggle(); if (!panel.el.hidden) render(); });
      box.append(b);
      return box;
    },
    onRemove() {},
  }, "bottom-left");

  async function render() {
    const body = [];

    body.push(shareRow(ctx));
    body.push(h("h3", "set-title", "Установка"), installSection());

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

    // данные
    body.push(h("h3", "set-title", "Загруженные данные"));
    const u = await usage();
    body.push(h("p", "set-hint", `Занято на устройстве: ${formatBytes(u.usage)}${u.persisted ? " · хранится надёжно" : ""}`));
    const list = Object.entries(models());
    if (!list.length) body.push(h("p", "set-hint", "Голоса, переводчик и другие большие файлы появятся здесь, когда вы их скачаете."));
    const ml = h("div", "set-list");
    for (const [id, m] of list) {
      const del = h("button", "text-btn", "Удалить");
      del.addEventListener("click", async () => { await removeModel(id); render(); });
      ml.append(netRow(m.title, formatBytes(m.bytes), del));
    }
    body.push(ml);
    if (!u.persisted && list.length) {
      const keep = h("button", "text-btn", "Не удалять скачанное при нехватке места");
      keep.addEventListener("click", async () => { await persist(); render(); });
      body.push(keep);
    }

    panel.body.replaceChildren(...body);
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
    ctx.map.once("load", () => { panel.open(); render(); });
  }
}

// «Поделиться»: ссылка на сайт программы (Грегори, 2026-10-29: «ссылку на сайт программы, а не на
// геолокацию»). Где браузер умеет — системное окно «Поделиться» (на телефоне — мессенджеры, почта),
// иначе ссылка копируется
const SHARE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5a3 3 0 1 0-5.91.7L8.04 9.81A2.99 2.99 0 0 0 3 12a3 3 0 0 0 5.04 2.19l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z"/></svg>';
export const SITE = "https://gregory-gittools.github.io/atlas/";

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

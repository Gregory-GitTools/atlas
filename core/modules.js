// Реестр модулей — гнёзда, в которые вставляется всё новое. Модуль — файл в своей папке
// (layers/, sources/, tools/, voices/), который один раз вызывает register(). Ядро модулей не
// знает по именам: новая возможность = новый файл + строка в MODULES ниже.
//
// Описание модуля:
//   id        — уникальное имя, "layers/trails"
//   kind      — "layer" | "content" | "source" | "tool" | "voice" (content — раздел с панелью: Языки…)
//   title     — подпись на кнопке
//   icon      — SVG-строка (монохромная, currentColor)
//   needs     — что требуется: ["folders", "webgpu", "network", "desktop"]; нет нужного на
//               этом устройстве — модуль не показывается; нет данных — кнопка неактивна
//   sends     — что модуль отправляет в сеть, для экрана «Что уходит в сеть»: "район карты",
//               "текст запроса", "звук"…; не отправляет ничего — поле не задаётся
//   group     — раздел (кружок) в меню «Слои»: places, trails, roads, relief, weather, water; "hidden" — не
//               показывать; exclusive: true — в группе включён только один
//   menu      — виды слоя, свой кружок в «Слоях»: { items() → [{ id, title, active }], label(), choose(id),
//               toggle(id) → остались ли отмеченные } — готовый собирает profileMenu() из core/profiles.js
//   load()    — тяжёлое грузится здесь, при первом включении, а не при старте
//   enable(ctx) / disable(ctx) — включить и выключить; ctx = { map, status }
//   settings(ctx) — свой раздел в окне настроек (DOM-узел), заголовок — title модуля («Мои альбомы»: своя папка)

import * as settings from "./settings.js";
import { emit } from "./events.js";

export const MODULES = [
  "../layers/places.js",
  "../layers/trails.js",
  "../layers/outdoor.js",
  "../layers/roads.js",
  "../layers/terrain.js",
  "../layers/weather.js",
  "../layers/photos.js",
  "../content/tours.js",
  "../content/languages.js",
  "../content/albums.js",
];

const registry = new Map();
const listeners = new Set();

export function register(mod) {
  if (registry.has(mod.id)) throw new Error(`модуль ${mod.id} уже есть`);
  registry.set(mod.id, { ...mod, loaded: false, active: false });
  for (const fn of listeners) fn(mod.id);
}

export const modules = (kind) => [...registry.values()].filter((m) => !kind || m.kind === kind);
export const onRegister = (fn) => listeners.add(fn);

const CAN = {
  folders: () => "showDirectoryPicker" in window && !isMobile(),
  webgpu: () => "gpu" in navigator,
  network: () => navigator.onLine,
  desktop: () => !isMobile(),
};

export function isMobile() {
  return !!navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || matchMedia("(pointer: coarse) and (hover: none)").matches;
}

export const available = (mod) => (mod.needs || []).every((n) => CAN[n]?.() ?? true);

// Сеть: режим «без сети» и запрет по модулю (экран «Что уходит в сеть»). Модуль, которому сеть
// запрещена, на этом устройстве есть, но выключен — его кнопка видна и неактивна (правило недоступного)
export const offline = () => !!settings.get("net.offline");
export const isBlocked = (id) => settings.get("net.blocked", []).includes(id);
export const allowed = (mod) => !mod.sends || (!offline() && !isBlocked(mod.id));

async function applyNetwork(ctx) {
  for (const m of registry.values()) if (m.active && !allowed(m)) await toggle(m.id, ctx, false, { keep: true });
  emit("modules", null);
}

export async function setOffline(on, ctx) {
  settings.set("net.offline", on || null);
  await applyNetwork(ctx);
}

export async function setBlocked(id, blocked, ctx) {
  const list = new Set(settings.get("net.blocked", []));
  blocked ? list.add(id) : list.delete(id);
  settings.set("net.blocked", list.size ? [...list] : null);
  await applyNetwork(ctx);
}

// keep — выключение не по воле пользователя (запрет сети): панели помнят, что модуль был включён
export async function toggle(id, ctx, on, { keep = false } = {}) {
  const mod = registry.get(id);
  if (!mod || !available(mod)) return false;
  on ??= !mod.active;
  if (on && !allowed(mod)) return false;
  if (on && !mod.loaded) {
    await mod.load?.(ctx);
    mod.loaded = true;
  }
  await (on ? mod.enable : mod.disable)?.(ctx);
  mod.active = on;
  emit("module", { id, on, keep, ctx });
  return on;
}

export async function loadAll() {
  const results = await Promise.allSettled(MODULES.map((path) => import(new URL(path, import.meta.url))));
  results.forEach((r, i) => r.status === "rejected" && console.warn("модуль не загрузился:", MODULES[i], r.reason));
}

// Реестр модулей — гнёзда, в которые вставляется всё новое. Модуль — файл в своей папке
// (layers/, sources/, tools/, voices/), который один раз вызывает register(). Ядро модулей не
// знает по именам: новая возможность = новый файл + строка в MODULES ниже.
//
// Описание модуля:
//   id        — уникальное имя, "layers/trails"
//   kind      — "layer" | "source" | "tool" | "voice"
//   title     — подпись на кнопке
//   icon      — SVG-строка (монохромная, currentColor)
//   needs     — что требуется: ["folders", "webgpu", "network", "desktop"]; нет нужного на
//               этом устройстве — модуль не показывается; нет данных — кнопка неактивна
//   load()    — тяжёлое грузится здесь, при первом включении, а не при старте
//   enable(ctx) / disable(ctx) — включить и выключить; ctx = { map, status }

export const MODULES = [
  "../layers/terrain.js",
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

export async function toggle(id, ctx, on) {
  const mod = registry.get(id);
  if (!mod || !available(mod)) return false;
  on ??= !mod.active;
  if (on && !mod.loaded) {
    await mod.load?.(ctx);
    mod.loaded = true;
  }
  await (on ? mod.enable : mod.disable)?.(ctx);
  mod.active = on;
  return on;
}

export async function loadAll() {
  const results = await Promise.allSettled(MODULES.map((path) => import(new URL(path, import.meta.url))));
  results.forEach((r, i) => r.status === "rejected" && console.warn("модуль не загрузился:", MODULES[i], r.reason));
}

// Язык подписей на карте (как в travel-earth): у всех векторных стилей схема OpenMapTiles с тегами
// name:xx (~80 языков), поэтому у каждой подписи-названия text-field меняется на
// coalesce(name:xx, name). «Без подписей» прячет их, «Местные названия» — тег name.
// Выбор помнится; событие "label-language" — для поиска и окон мест (язык ответов)
import * as settings from "./settings.js";
import { emit } from "./events.js";

export const LANGUAGES = [
  { code: "none", short: "—", name: "Без подписей" },
  { code: "local", short: "Мест", name: "Местные названия" },
  { code: "ru", short: "Ру", name: "Русский" },
  { code: "en", short: "En", name: "English" },
  { code: "et", short: "Et", name: "Eesti" },
  { code: "fi", short: "Fi", name: "Suomi" },
  { code: "lv", short: "Lv", name: "Latviešu" },
  { code: "lt", short: "Lt", name: "Lietuvių" },
  { code: "uk", short: "Ук", name: "Українська" },
  { code: "de", short: "De", name: "Deutsch" },
  { code: "fr", short: "Fr", name: "Français" },
  { code: "es", short: "Es", name: "Español" },
  { code: "it", short: "It", name: "Italiano" },
];

let current = LANGUAGES.find((l) => l.code === settings.get("labels")) || LANGUAGES.find((l) => l.code === "ru");
export const labelLanguage = () => current;
// язык ответов поиска и описаний: для «без подписей» и «местных» — русский
export const uiLanguage = () => (current.code.length === 2 ? current.code : "ru");

// подписи-названия — symbol-слои, в text-field которых есть name (номера дорог и домов не переводятся)
const nameLayers = (map) => map.getStyle().layers.filter((l) =>
  l.type === "symbol" && l.layout?.["text-field"] && /name/.test(JSON.stringify(l.layout["text-field"])));

export function applyLabels(map) {
  const code = current.code;
  const field = code === "local" || code === "none" ? ["get", "name"] : ["coalesce", ["get", `name:${code}`], ["get", "name"]];
  for (const layer of nameLayers(map)) {
    map.setLayoutProperty(layer.id, "visibility", code === "none" ? "none" : "visible");
    if (code !== "none") map.setLayoutProperty(layer.id, "text-field", field);
  }
}

export function setLabelLanguage(map, lang) {
  current = lang;
  settings.set("labels", lang.code);
  if (map.isStyleLoaded()) applyLabels(map);
  emit("label-language", { code: lang.code, ui: uiLanguage() });
}

// меню языка — выпадающий список у кнопки (кнопка живёт в строке поиска)
export function languageButton(map) {
  const wrap = Object.assign(document.createElement("div"), { className: "lang" });
  const btn = Object.assign(document.createElement("button"), { className: "lang-btn", title: "Язык подписей на карте" });
  const menu = Object.assign(document.createElement("div"), { className: "lang-menu menu", hidden: true });
  wrap.append(btn, menu);
  const render = () => {
    btn.innerHTML = `<span></span><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>`;
    btn.firstChild.textContent = current.short;
    menu.replaceChildren(...LANGUAGES.map((l) => {
      const item = Object.assign(document.createElement("button"), { className: "menu-item" + (l === current ? " active" : ""), textContent: l.name });
      item.addEventListener("click", () => { menu.hidden = true; setLabelLanguage(map, l); render(); });
      return item;
    }));
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener("click", (e) => !wrap.contains(e.target) && (menu.hidden = true));
  render();
  map.on("style.load", () => applyLabels(map));
  return wrap;
}

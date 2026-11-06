// Язык подписей на карте (как в travel-earth): у всех векторных стилей схема OpenMapTiles с тегами
// name:xx (~80 языков), поэтому у каждой подписи-названия text-field меняется на
// coalesce(name:xx, name). «Без подписей» прячет их, «Местные названия» — тег name.
// Выбор помнится; событие "label-language" — для поиска и окон мест (язык ответов)
import * as settings from "./settings.js";
import { emit } from "./events.js";
import { addDockButton } from "./dock.js";

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
  // isStyleLoaded() ложно, пока догружаются плитки, — но слои уже есть, менять можно; стиль ещё
  // не пришёл совсем — подписи поставит style.load
  try { applyLabels(map); } catch { /* стиль ещё не загружен */ }
  emit("label-language", { code: lang.code, ui: uiLanguage() });
}

// язык подписей — кнопка столбика справа под логотипом (Грегори 2026-11-06; до того — слева внизу, ещё
// раньше — в строке поиска), меню — сбоку от неё, в сторону середины экрана
export function languageButton(map) {
  const btn = addDockButton({ title: "Язык подписей на карте", className: "lang-btn", html: "<span></span>" });
  const menu = Object.assign(document.createElement("div"), { className: "lang-menu menu", hidden: true });
  document.body.append(menu);
  const render = () => {
    btn.firstChild.textContent = current.short;
    menu.replaceChildren(...LANGUAGES.map((l) => {
      const item = Object.assign(document.createElement("button"), { className: "menu-item" + (l === current ? " active" : ""), textContent: l.name });
      item.addEventListener("click", () => { menu.hidden = true; setLabelLanguage(map, l); render(); });
      return item;
    }));
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    if (menu.hidden) return;
    const r = btn.getBoundingClientRect();
    const right = r.left > innerWidth / 2;
    Object.assign(menu.style, right ? { left: "", right: `${Math.round(innerWidth - r.left + 8)}px` } : { right: "", left: `${Math.round(r.right + 8)}px` });
    menu.style.top = `${Math.round(Math.max(8, Math.min(r.top, innerHeight - menu.offsetHeight - 8)))}px`;
  });
  document.addEventListener("click", (e) => !menu.contains(e.target) && (menu.hidden = true));
  render();
  map.on("style.load", () => applyLabels(map));
  return btn;
}

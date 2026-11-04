// Кадр (из photo-editor): кнопка показывает рамку с уголками, над полосой — пропорции: как снимок,
// свободно, 1:1, 4:5, 4:3, 16:9, 9:16 (помнятся; открыта строка шума или цвета — пропорции прячутся,
// повторный щелчок «Кадр» при открытой рамке — снова они). Сама рамка — общая, в tools/editor.js: ею
// пользуются все инструменты (поворот срезает по ней пустые углы)
import { ASPECTS } from "./editor.js";

export default function crop(ed) {
  const { svg, button } = ed;
  const el = Object.assign(document.createElement("div"), { className: "edit-group" });
  const toggle = button(svg("M17 15h2V7c0-1.1-.9-2-2-2H9v2h8v8zM7 17V1H5v4H1v2h4v10c0 1.1.9 2 2 2h10v4h2v-4h4v-2H7z"), "Кадрировать — рамка с пропорциями", () => (ed.state.cropOn && ed.state.panel !== "crop" ? ed.panel("crop") : ed.crop()));
  el.append(toggle);
  const chips = Object.assign(document.createElement("div"), { className: "edit-chips" });
  const list = ASPECTS.map((a) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "edit-chip", textContent: a.title || a.key });
    b.addEventListener("click", () => ed.setAspect(a.key));
    chips.append(b);
    return [a.key, b];
  });
  ed.sub.append(chips);
  return {
    el,
    sync: (s) => {
      toggle.classList.toggle("on", s.cropOn);
      chips.hidden = !s.cropOn || s.panel !== "crop";
      for (const [key, b] of list) b.classList.toggle("on", key === s.aspect);
    },
  };
}

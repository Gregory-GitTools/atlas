// Поворот (из photo-editor): на 90° влево и вправо, зеркало, точный угол ползунком (±45°, шаг
// 0,1°; щелчок по числу — 0°), «Горизонт» — угол по линии горизонта (tools/horizon.js), сетка.
// Пока тянешь ползунок, сетка видна сама — по ней удобно ровнять
import { findHorizon, MAX_TILT } from "./horizon.js";

export default function rotate(ed) {
  const { svg, button } = ed;
  const el = Object.assign(document.createElement("div"), { className: "edit-group" });
  const left = button(svg("M7.11 8.53 5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z"), "Повернуть влево на 90°", () => ed.turn(-1));
  const right = button(svg("M15.55 5.55 11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11a7.906 7.906 0 0 0-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02c1.39-.17 2.74-.71 3.9-1.61l-1.44-1.44c-.75.54-1.59.89-2.46 1.03zm3.89-2.42 1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z"), "Повернуть вправо на 90°", () => ed.turn(1));
  const mirror = button(svg("M15 21h2v-2h-2v2zm4-12h2V7h-2v2zM3 5v14c0 1.1.9 2 2 2h4v-2H5V5h4V3H5c-1.1 0-2 .9-2 2zm16-2v2h2c0-1.1-.9-2-2-2zm-8 20h2V1h-2v22zm8-6h2v-2h-2v2zM15 5h2V3h-2v2zm4 8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2z"), "Зеркально", () => ed.mirror());

  // точный угол
  const fine = Object.assign(document.createElement("label"), { className: "edit-angle", title: "Точный угол — тяните; стрелки ← → на ползунке — по 0,1°" });
  const slider = Object.assign(document.createElement("input"), { type: "range", min: -45, max: 45, step: 0.1, value: 0 });
  const value = Object.assign(document.createElement("button"), { type: "button", className: "edit-angle-value", title: "Сбросить угол (0°)" });
  slider.addEventListener("input", () => ed.setAngle(Number(slider.value)));
  slider.addEventListener("pointerdown", () => { ed.state.dragging = true; ed.redraw(); });
  addEventListener("pointerup", () => { if (ed.state.dragging) { ed.state.dragging = false; ed.redraw(); } });
  value.addEventListener("click", () => ed.setAngle(0));
  fine.append(slider, value);

  // значок — уровень с пузырьком
  const LEVEL = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="20" height="8" rx="4"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><path d="M8.5 9v6M15.5 9v6" stroke-width="1.5"/></svg>';
  const level = button(LEVEL, "Выровнять по горизонту", async () => {
    level.disabled = true;
    document.body.classList.add("busy");
    ed.say("Ищу горизонт…");
    try {
      const a = await findHorizon(ed.preview());
      // угол линии — в координатах снимка (y вниз): чтобы выровнять, крутить в обратную сторону
      if (a === null) ed.say("Ровной линии горизонта не нашлось — угол не менял");
      else if (Math.abs(a) > MAX_TILT) ed.say(`Похоже, за горизонт принято что-то другое (${a.toFixed(1).replace(".", ",")}°) — угол не менял`);
      else { ed.setAngle(-a); ed.state.grid = true; ed.say(`Горизонт выровнен: ${(-a).toFixed(1).replace(".", ",")}°`); }
    } catch (err) { ed.say(err.message); }
    level.disabled = false;
    document.body.classList.remove("busy");
    ed.sync();
  });
  const grid = button(svg("M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM8 20H4v-4h4v4zm0-6H4v-4h4v4zm0-6H4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4z"), "Сетка", () => { ed.state.grid = !ed.state.grid; ed.sync(); });

  el.append(left, right, mirror, fine, level, grid);
  return {
    el,
    sync: (s) => {
      slider.value = s.angle;
      value.textContent = `${s.angle.toFixed(1).replace(".", ",")}°`;
      grid.classList.toggle("on", s.grid);
      mirror.classList.toggle("on", s.flip);
    },
  };
}

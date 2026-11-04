// Перспектива (из photo-editor): кнопка показывает четыре ручки по углам снимка — тяните угол туда,
// где он должен быть, и сходящиеся стены и столбы становятся ровными (сетка помогает равнять).
// Снимок искажается по-настоящему, рамка кадра — внутри искажённого. «Как было» — без перспективы
export default function perspective(ed) {
  const { svg, button } = ed;
  const el = Object.assign(document.createElement("div"), { className: "edit-group" });
  const toggle = button('<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 4h10l4 16H3z"/><circle cx="7" cy="4" r="1.6" fill="currentColor"/><circle cx="17" cy="4" r="1.6" fill="currentColor"/><circle cx="21" cy="20" r="1.6" fill="currentColor"/><circle cx="3" cy="20" r="1.6" fill="currentColor"/></svg>',
    "Перспектива — тяните углы снимка, чтобы выпрямить стены", () => ed.perspective());
  const reset = button(svg("M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"), "Перспектива — как было", () => ed.resetQuad());
  el.append(toggle, reset);
  return {
    el,
    sync: (s) => {
      toggle.classList.toggle("on", s.persp);
      reset.disabled = !ed.warped();
    },
  };
}

// Плитки вариантов над полосой правки (шум, цвет): маленький снимок с вариантом и подпись, как в
// photo-editor; щелчок — примерить (можно сравнивать подряд), ← → — соседний вариант. Плитки
// считаются при открытии строки: снимок с уже выбранным другим инструментом (честно)
export function variantsTool(ed, { key, title, icon, list, order, off, apply, clear }) {
  ed.filter({ key, order, off, apply, clear });
  const el = Object.assign(document.createElement("div"), { className: "edit-group" });
  const toggle = ed.button(icon, title, () => ed.panel(key));
  el.append(toggle);
  const row = Object.assign(document.createElement("div"), { className: "edit-tiles", hidden: true });
  const tiles = list.map((v) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "edit-tile", title: v.label });
    b.innerHTML = `<span class="edit-tile-img"></span><span class="edit-tile-label"></span>`;
    b.querySelector(".edit-tile-label").textContent = v.label;
    b.addEventListener("click", () => ed.setValue(key, v.key));
    row.append(b);
    return [v.key, b];
  });
  ed.sub.append(row);
  // ← → — соседний вариант, пока открыта строка
  addEventListener("keydown", (e) => {
    if (ed.state.panel !== key || !ed.state.p || (e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.target.matches?.("input")) return;
    e.preventDefault();
    const i = list.findIndex((v) => v.key === ed.state.values[key]), n = Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
    ed.setValue(key, list[n].key);
  });
  // плитки — заново, когда открыли строку или сменилось то, на чём они считаются
  let stamp = "", run = 0;
  async function fill(s) {
    const n = ++run;
    for (const [v, b] of tiles) {
      const c = await ed.sample(key, v).catch(() => null);
      if (n !== run) return;
      const box = b.querySelector(".edit-tile-img");
      box.replaceChildren(...(c ? [c] : []));
    }
  }
  return {
    el,
    sync: (s) => {
      const open = s.panel === key && !!s.p;
      toggle.classList.toggle("on", open || s.values[key] !== off);
      row.hidden = !open;
      for (const [v, b] of tiles) b.classList.toggle("on", v === s.values[key]);
      const now = open ? [s.pv?.width, s.pv?.height, s.q, s.flip, JSON.stringify({ ...s.values, [key]: null })].join() : "";
      if (open && now !== stamp) fill(s);
      stamp = now;
    },
  };
}

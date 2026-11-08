// Сведения о снимке (из photo-editor, панель «сведения»): кнопка открывает над полосой строку — файл,
// размер, разрешение; дата съёмки, камера и место правятся (место — «широта, долгота», как копирует
// Google Карты), у каждого — «Скопировать». Записывается по «Сохранить»: тронули только сведения —
// тот же снимок с новым EXIF, без пересжатия (tools/jpeg.js). У PNG и WebP EXIF нет — только смотреть.
// «В Избранное» — копия снимка в «…-Albom» поездки (ещё раз — убрать оттуда), «Удалить» — снимок
// (у живого фото — с роликом) переносится в «[Удалённые]» своей папки тем же путём: ничего не
// стирается, обход «Моих альбомов» эту папку пропускает
import { readMeta } from "./jpeg.js";

const DELETED = "[Удалённые]";
const ICON = "M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z";
const COPY = "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z";
const STAR = "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";
const STAR_O = "M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z";
const BIN = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z";

const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });
const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
// EXIF «2023:06:25 15:42:09» ↔ поле «2023-06-25T15:42:09»
const toInput = (d) => (/^\d{4}:\d\d:\d\d \d\d:\d\d(:\d\d)?/.test(d || "") ? d.slice(0, 10).replaceAll(":", "-") + "T" + d.slice(11, 19) : "");
const toExif = (v) => (v ? `${v.slice(0, 10).replaceAll("-", ":")} ${v.slice(11, 19).padEnd(8, ":00").slice(0, 8)}` : "");
const showDate = (v) => (v ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)} ${v.slice(11, 19)}` : "");
const showGps = (g) => (g ? `${g[0].toFixed(6)}, ${g[1].toFixed(6)}` : "");
// «59.437, 24.7536» (и «59,437 24,7536») → [широта, долгота]; пусто — места нет; не разобрать — undefined
function parseGps(text) {
  const t = text.trim();
  if (!t) return null;
  const m = t.replace(/(\d),(\d)/g, "$1.$2").match(/^(-?\d+(?:\.\d+)?)[\s,;]+(-?\d+(?:\.\d+)?)$/);
  if (!m) return undefined;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : undefined;
}
const sameGps = (a, b) => (!a && !b) || (!!a && !!b && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6);

export default function info(ed) {
  const { svg, button } = ed;
  const el = h("div", "edit-group");
  const toggle = button(svg(ICON), "Сведения о снимке — дата, камера, место; в Избранное, удалить", () => ed.panel("info"));
  el.append(toggle);

  const row = h("div", "edit-info");
  row.hidden = true;
  const head = h("div", "edit-info-file");
  const field = (label, input) => {
    const copy = button(svg(COPY, 18), `Скопировать: ${label.toLowerCase()}`, () => copyText(input === date ? showDate(date.value) : input.value, copy));
    copy.classList.add("edit-info-copy");
    const box = h("label", "edit-info-field");
    box.append(h("span", "edit-info-label", label), input, copy);
    return box;
  };
  const date = Object.assign(document.createElement("input"), { type: "datetime-local", step: 1 });
  const camera = Object.assign(document.createElement("input"), { type: "text", placeholder: "—" });
  const place = Object.assign(document.createElement("input"), { type: "text", placeholder: "широта, долгота" });
  place.title = "Широта и долгота через запятую — как копируют Google Карты (правый щелчок по месту)";
  const star = button(svg(STAR_O), "В Избранное", favourite);
  const bin = button(svg(BIN), `Удалить — в папку «${DELETED}»`, remove);
  const acts = h("div", "edit-info-acts");
  acts.append(star, bin);
  row.append(head, field("Дата", date), field("Камера", camera), field("Место", place), acts);
  ed.sub.append(row);

  // что в файле (orig) и что сейчас в полях → поправки для «Сохранить»
  let orig = {}, forP = null, fav = null, inFav = false, sent = "{}";
  function changed() {
    const m = {}, gps = parseGps(place.value);
    if (toExif(date.value) !== (toInput(orig.date) ? toExif(toInput(orig.date)) : "")) m.date = toExif(date.value);
    if (camera.value.trim() !== (orig.camera || "")) m.camera = camera.value.trim();
    place.classList.toggle("bad", gps === undefined);
    if (gps !== undefined && !sameGps(gps, orig.gps)) m.gps = gps;
    sent = JSON.stringify(m);
    ed.setMeta(m);
  }
  for (const i of [date, camera, place]) i.addEventListener("input", changed);
  // поля — не для клавиш правки (← → у плиток, Esc)
  for (const i of [date, camera, place]) i.addEventListener("keydown", (e) => { if (e.key !== "Escape") e.stopPropagation(); });

  async function load(s) {
    const p = s.p, file = s.file;
    head.textContent = `${p.edit.path.split("/").pop()} · ${mb(file.size)} · ${s.size[0]} × ${s.size[1]}`;
    orig = /\.jpe?g$/i.test(p.edit.path) ? await readMeta(file) : {};
    if (forP !== p) return;
    fill({});
    const jpeg = /\.jpe?g$/i.test(p.edit.path);
    for (const i of [date, camera, place]) { i.disabled = !jpeg; i.title = jpeg ? i === place ? place.title : "" : "У PNG и WebP сведений EXIF нет — только у JPEG"; }
    // в «Избранном» ли он
    fav = null; inFav = false;
    try {
      const where = await ed.locate(p);
      const own = /-Albom$/i.test(where.dir.name.trim());
      fav = own ? null : await ed.curated(where.trip, false);
      inFav = own || (!!fav && await fav.getFileHandle(where.name).then(() => true, () => false));
      star.disabled = own;
    } catch { star.disabled = true; }
    if (forP === p) paint();
  }
  // поля — что в файле с поправками m (открыли снимок, «Назад», «Сбросить всё»)
  function fill(m) {
    sent = JSON.stringify(m);
    date.value = toInput("date" in m ? m.date : orig.date);
    camera.value = "camera" in m ? m.camera : orig.camera || "";
    place.value = showGps("gps" in m ? m.gps : orig.gps);
    place.classList.remove("bad");
  }
  const paint = () => {
    star.innerHTML = svg(inFav ? STAR : STAR_O);
    star.classList.toggle("on", inFav);
    star.title = star.disabled && inFav ? "Снимок из «Избранного»" : inFav ? "Убрать из Избранного" : "В Избранное — копия в «…-Albom» поездки";
  };

  async function favourite() {
    const p = ed.state.p;
    if (!p) return;
    try {
      const where = await ed.locate(p, true);
      if (inFav) {
        if (!confirm("Убрать снимок из «Избранного»? Сам снимок останется на месте.")) return;
        await (await ed.curated(where.trip, false))?.removeEntry(where.name);
        inFav = false;
      } else {
        const to = await ed.curated(where.trip, true);
        await ed.write(await to.getFileHandle(where.name, { create: true }), await where.file.getFile());
        inFav = true;
      }
      paint();
      ed.say(inFav ? "В Избранном" : "Убран из Избранного");
      try { window.opener?.atlasGalleryRescan?.(); } catch { /* окно карты закрыто */ }
    } catch (err) { ed.say(`Не получилось: ${err.message}`); }
  }

  async function remove() {
    const p = ed.state.p;
    if (!p || !confirm(`Убрать снимок в папку «${DELETED}» вашей папки? Ничего не стирается — вернуть можно, перенеся файл обратно.`)) return;
    try {
      const where = await ed.locate(p, true);
      let to = await where.root.getDirectoryHandle(DELETED, { create: true });
      for (const s of p.edit.path.split("/").slice(0, -1)) to = await to.getDirectoryHandle(s, { create: true });
      // живое фото — снимок и ролик с тем же именем
      const stem = where.name.replace(/\.[^.]+$/, "").toLowerCase(), names = [where.name];
      if (p.live) for await (const [n, fh] of where.dir.entries()) if (fh.kind === "file" && n !== where.name && n.replace(/\.[^.]+$/, "").toLowerCase() === stem && /\.(mov|mp4)$/i.test(n)) names.push(n);
      for (const n of names) {
        let name = n;
        for (let i = 2; await to.getFileHandle(name).then(() => true, () => false); i++) name = n.replace(/(\.[^.]+)?$/, ` (${i})$1`);
        const fh = await where.dir.getFileHandle(n);
        if (fh.move) try { await fh.move(to, name); continue; } catch { /* перенос не поддержан — копия и удаление */ }
        await ed.write(await to.getFileHandle(name, { create: true }), await fh.getFile());
        await where.dir.removeEntry(n);
      }
      ed.close(true);
      window.gallery.remove(p);
      try { window.opener?.atlasGalleryRemoved?.(p.id); } catch { /* окно карты закрыто */ }
      ed.say(`Снимок — в «${DELETED}»`);
      setTimeout(() => ed.say(""), 2500);
    } catch (err) { ed.say(`Не удалился: ${err.message}`); }
  }

  return {
    el,
    sync: (s) => {
      const open = s.panel === "info" && !!s.p;
      toggle.classList.toggle("on", open || Object.keys(s.meta || {}).length > 0);
      row.hidden = !open;
      if (!s.p) { forP = null; return; }
      if (forP !== s.p) { forP = s.p; sent = "{}"; load(s).catch(() => {}); }
      else if (JSON.stringify(s.meta || {}) !== sent) fill(s.meta || {});
    },
  };
}

async function copyText(text, btn) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { prompt("Скопируйте:", text); return; }
  btn.classList.add("done");
  setTimeout(() => btn.classList.remove("done"), 900);
}

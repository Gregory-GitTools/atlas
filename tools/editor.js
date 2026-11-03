// Правка снимка в окне галереи (перенос photo-editor / Albom, Грегори 2026-11-03: «начнём
// перетаскивать photo-editor», «интерфейс — на свой взгляд, в одном стиле»). Кнопка «Править»
// (карандаш вверху) — у своих снимков с компьютера (jpg, png, webp); у роликов, снимков с GitHub и
// на телефоне — неактивна. Снимок — на холсте, внизу — полоса инструментов (модули tools/: каждый
// даёт свою группу кнопок), справа — «Оригинал», «Отмена», «Сохранить».
// Качество — как в последней версии photo-editor: превью до 2400 точек, уменьшение в линейном
// свете (не темнеет на встречном свете), экран показывает файл как есть, пока его не тронули.
// Поворот — по-настоящему поворачивает пиксели; края без снимка срезает рамка (самый большой кадр
// тех же пропорций внутри повёрнутого снимка), за рамкой снимок затемнён — видно, что останется.
// Сохранение — как в photo-editor: исходник — в «[Originals]» рядом со снимком (только при первой
// правке), снимок переписывается, копия — в «…-Albom» поездки (в Atlas это «Избранное»); EXIF
// (место, дата, камера) переносится целиком (tools/jpeg.js). «Оригинал» возвращает исходник.
// Доступ к папке окно галереи берёт само (IndexedDB albums/dirs) и само просит право записи — по
// нажатию «Сохранить» (браузер спрашивает один раз за сеанс)
import { cacheGet } from "../core/storage.js";
import { keepExif } from "./jpeg.js";

const TOOLS = ["./rotate.js"]; // новый инструмент — файл в tools/ и строка здесь
const PREVIEW_MAX = 2400; // как в photo-editor (было 1000 — при увеличении снимок размывался)
const ORIGINALS = "[Originals]";
const QUALITY = 0.92;

const $ = (s) => document.querySelector(s);
const g = window.gallery;
const stage = $(".stage");
const canvas = Object.assign(document.createElement("canvas"), { className: "edit-canvas", hidden: true });
const bar = Object.assign(document.createElement("div"), { className: "edit-bar", hidden: true });
const note = Object.assign(document.createElement("div"), { className: "edit-note" });
stage.append(canvas, note, bar);
const editBtn = $(".edit-btn");

// ---------- уменьшение в линейном свете (photo-editor, imaging.js) ----------
const TO_LINEAR = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toSrgb = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255));
function downsample(src, w, h) {
  const sw = src.width, sh = src.height;
  const c = Object.assign(document.createElement("canvas"), { width: sw, height: sh });
  c.getContext("2d").drawImage(src, 0, 0);
  const d = c.getContext("2d").getImageData(0, 0, sw, sh).data, out = new Uint8ClampedArray(w * h * 4);
  const kx = sw / w, ky = sh / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * ky), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ky));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * kx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * kx));
      let r = 0, gg = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) for (let o = (sy * sw + x0) * 4, sx = x0; sx < x1; sx++, o += 4, n++) {
        r += TO_LINEAR[d[o]]; gg += TO_LINEAR[d[o + 1]]; b += TO_LINEAR[d[o + 2]]; a += d[o + 3];
      }
      const i = (y * w + x) * 4;
      out[i] = toSrgb(r / n); out[i + 1] = toSrgb(gg / n); out[i + 2] = toSrgb(b / n); out[i + 3] = Math.round(a / n);
    }
  }
  const res = Object.assign(document.createElement("canvas"), { width: w, height: h });
  res.getContext("2d").putImageData(new ImageData(out, w, h), 0, 0);
  return res;
}

// поворот на 90°·q и зеркало — впечатываются в пиксели
function turned(src, q, flip) {
  q = ((q % 4) + 4) % 4;
  const w = src.width, h = src.height, swap = q % 2 === 1;
  const c = Object.assign(document.createElement("canvas"), { width: swap ? h : w, height: swap ? w : h });
  const x = c.getContext("2d");
  x.translate(c.width / 2, c.height / 2);
  x.rotate((q * Math.PI) / 2);
  if (flip) x.scale(-1, 1);
  x.drawImage(src, -w / 2, -h / 2);
  return c;
}
// самый большой кадр тех же пропорций внутри снимка, повёрнутого на deg: доля от сторон
export function cropScale(w, h, deg) {
  const a = (Math.abs(deg) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return Math.min(w / (w * c + h * s), h / (w * s + h * c));
}

// ---------- состояние правки ----------
// p — снимок галереи; file — исходный файл; pv — превью (после поворотов на 90° и зеркала);
// q, flip — повороты на 90° и зеркало; angle — точный угол, °
const ed = { p: null, file: null, src: null, pv: null, q: 0, flip: false, angle: 0, grid: false, dragging: false, hasOriginal: false };
const dirty = () => !!ed.p && (ed.angle !== 0 || ed.q % 4 !== 0 || ed.flip);
const say = (text) => { note.textContent = text || ""; note.classList.toggle("show", !!text); };

// доступ к своей папке: из IndexedDB этого окна (так браузер даёт просить запись из него),
// для проверки — у окна карты
async function roots() {
  const saved = await cacheGet("albums/dirs").catch(() => null);
  if (Array.isArray(saved) && saved.length) return saved;
  try { return window.opener?.atlasGalleryRoots?.() || []; } catch { return []; }
}
async function locate(p, write = false) {
  const root = (await roots())[p.edit.root];
  if (!root) throw new Error("папка снимка не найдена — откройте её в «Моих альбомах» снова");
  const mode = write ? "readwrite" : "read";
  if (await root.queryPermission({ mode }) !== "granted" && await root.requestPermission({ mode }) !== "granted")
    throw new Error(write ? "без разрешения на запись сохранить нельзя" : "нет доступа к папке");
  const parts = p.edit.path.split("/"), name = parts.pop(), chain = [root];
  for (const s of parts) chain.push(await chain.at(-1).getDirectoryHandle(s));
  const dir = chain.at(-1);
  // поездка — первая папка внутри своей (там лежит «…-Albom»); снимок прямо в своей папке — она сама
  return { root, dir, name, trip: chain[1] || root, file: await dir.getFileHandle(name) };
}
const originalOf = async (where) => {
  try { return await (await (await where.dir.getDirectoryHandle(ORIGINALS)).getFileHandle(where.name)).getFile(); } catch { return null; }
};

// ---------- отрисовка ----------
let frame = 0;
const redraw = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
function draw() {
  const r = stage.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
  if (canvas.width !== cw || canvas.height !== ch) Object.assign(canvas, { width: cw, height: ch });
  const x = canvas.getContext("2d");
  x.clearRect(0, 0, cw, ch);
  if (!ed.pv) return;
  const W = ed.pv.width, H = ed.pv.height, s = Math.min((cw * 0.94) / W, ((ch - 90 * dpr) * 0.94) / H);
  const cx = cw / 2, cy = (ch - 70 * dpr) / 2;
  x.save();
  x.translate(cx, cy);
  x.rotate((ed.angle * Math.PI) / 180);
  x.imageSmoothingQuality = "high";
  x.drawImage(ed.pv, (-W * s) / 2, (-H * s) / 2, W * s, H * s);
  x.restore();
  // рамка: то, что останется; за ней — затемнено
  const k = cropScale(W, H, ed.angle), rw = k * W * s, rh = k * H * s, rx = cx - rw / 2, ry = cy - rh / 2;
  if (ed.angle) {
    x.fillStyle = "rgba(20, 20, 24, 0.72)";
    x.beginPath();
    x.rect(0, 0, cw, ch);
    x.rect(rx, ry, rw, rh);
    x.fill("evenodd");
    x.strokeStyle = "rgba(255, 255, 255, 0.9)";
    x.lineWidth = 1.5 * dpr;
    x.strokeRect(rx, ry, rw, rh);
  }
  // сетка (как в photo-editor): мелкая — по горизонту равняться, крупная (синяя) — трети
  if (ed.grid || ed.dragging) {
    const lines = (n, color, width, skip) => {
      x.strokeStyle = color;
      x.lineWidth = width * dpr;
      x.beginPath();
      for (let i = 1; i < n; i++) {
        if (skip && i % skip === 0) continue;
        x.moveTo(rx + (rw * i) / n, ry); x.lineTo(rx + (rw * i) / n, ry + rh);
        x.moveTo(rx, ry + (rh * i) / n); x.lineTo(rx + rw, ry + (rh * i) / n);
      }
      x.stroke();
    };
    lines(30, "rgba(255, 255, 255, 0.22)", 1, 10);
    lines(3, "rgba(77, 163, 255, 0.85)", 2);
  }
}
new ResizeObserver(() => ed.p && redraw()).observe(stage);

// ---------- инструменты ----------
const svg = (d, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${d}" fill="currentColor"/></svg>`;
export const button = (icon, title, fn) => {
  const b = Object.assign(document.createElement("button"), { type: "button", className: "player-btn edit-tool", title, innerHTML: icon });
  b.addEventListener("click", fn);
  return b;
};
// что дают инструменты: состояние правки и действия над ним
const api = {
  get state() { return ed; },
  svg, button, redraw, say, dirty, sync: () => sync(),
  setAngle(a) { ed.angle = Math.max(-45, Math.min(45, Math.round(a * 10) / 10)); sync(); },
  turn(d) { ed.q = (ed.q + d + 4) % 4; ed.pv = turned(ed.src, ed.q, ed.flip); ed.angle = 0; sync(); },
  mirror() { ed.flip = !ed.flip; ed.pv = turned(ed.src, ed.q, ed.flip); ed.angle = 0; sync(); },
  // копия превью без поворота — для поиска горизонта
  preview: () => ed.pv,
};
const syncers = [];
const groups = Object.assign(document.createElement("div"), { className: "edit-tools" });
const restoreBtn = button(svg("M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"), "Вернуть снимок, каким он был до правки", restore);
const cancelBtn = button(svg("M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"), "Выйти из правки (Esc)", () => close());
const saveBtn = button(svg("M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"), "Сохранить (Ctrl+S)", save);
saveBtn.classList.add("edit-save");
const end = Object.assign(document.createElement("div"), { className: "edit-end" });
end.append(restoreBtn, cancelBtn, saveBtn);
bar.append(groups, end);
const ready = Promise.all(TOOLS.map((m) => import(m).then((mod) => {
  const t = mod.default(api);
  groups.append(t.el);
  if (t.sync) syncers.push(t.sync);
}).catch((err) => console.warn("инструмент не загрузился:", m, err))));

function sync() {
  saveBtn.disabled = !dirty();
  restoreBtn.disabled = !ed.hasOriginal;
  for (const f of syncers) f(ed);
  redraw();
}

// ---------- открыть, выйти ----------
editBtn.addEventListener("click", () => (ed.p ? close() : open(g.current())));
let busy = false;
async function open(p) {
  if (!p?.edit || busy) return;
  busy = true;
  g.stop();
  document.body.classList.add("busy");
  say("");
  try {
    await ready;
    const where = await locate(p);
    const file = await where.file.getFile();
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, PREVIEW_MAX / Math.max(bmp.width, bmp.height));
    const src = k < 1 ? downsample(bmp, Math.round(bmp.width * k), Math.round(bmp.height * k)) : turned(bmp, 0, false);
    bmp.close?.();
    if (g.current() !== p) return;
    Object.assign(ed, { p, file, src, pv: src, q: 0, flip: false, angle: 0, hasOriginal: !!(await originalOf(where)) });
    document.body.classList.add("editing");
    canvas.hidden = bar.hidden = false;
    editBtn.classList.add("on");
    editBtn.title = "Выйти из правки";
    sync();
  } catch (err) {
    say(`Не открылся для правки: ${err.message}`);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
}
function close(force = false) {
  if (!ed.p) return true;
  if (!force && dirty() && !confirm("Выйти без сохранения? Правка пропадёт.")) return false;
  Object.assign(ed, { p: null, file: null, src: null, pv: null, angle: 0, q: 0, flip: false, dragging: false });
  document.body.classList.remove("editing");
  canvas.hidden = bar.hidden = true;
  editBtn.classList.remove("on");
  editBtn.title = "Править снимок";
  say("");
  return true;
}
g.onShow?.(() => close(true));

// ---------- сохранить, вернуть оригинал ----------
const write = async (fh, data) => {
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
  // сразу после записи размер иногда на миг старый (антивирус, кэш) — пара повторов (photo-editor)
  for (const ms of [0, 60, 200]) {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    if ((await fh.getFile()).size === data.size) return;
  }
  throw new Error("файл записался не целиком");
};
const reason = (err) => (/read-only/i.test(err.message)
  ? "файл помечен «только для чтения» — в Проводнике: Свойства → снять «Только для чтения»" : err.message);
// «…-Albom» поездки: уже есть (с пробелом перед «-Albom» или без) — она, нет — новая
async function curated(trip, create) {
  for await (const e of trip.values()) if (e.kind === "directory" && /-Albom$/i.test(e.name.trim())) return e;
  return create ? trip.getDirectoryHandle(`${trip.name}-Albom`, { create: true }) : null;
}

async function save() {
  if (!dirty() || busy) return;
  const p = ed.p;
  busy = true;
  document.body.classList.add("busy");
  say("Сохраняю…");
  try {
    const where = await locate(p, true);
    // полный размер: исходник → повороты на 90° и зеркало → точный угол и рамка
    const bmp = await createImageBitmap(ed.file, { imageOrientation: "from-image" });
    const base = ed.q || ed.flip ? turned(bmp, ed.q, ed.flip) : bmp;
    const W = base.width, H = base.height, k = cropScale(W, H, ed.angle);
    const out = Object.assign(document.createElement("canvas"), { width: Math.round(W * k), height: Math.round(H * k) });
    const x = out.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.translate(out.width / 2, out.height / 2);
    x.rotate((ed.angle * Math.PI) / 180);
    x.drawImage(base, -W / 2, -H / 2);
    bmp.close?.();
    const type = /\.png$/i.test(where.name) ? "image/png" : /\.webp$/i.test(where.name) ? "image/webp" : "image/jpeg";
    let blob = await new Promise((r) => out.toBlob(r, type, QUALITY));
    if (type === "image/jpeg") blob = await keepExif(blob, ed.file, out.width, out.height);
    // исходник — в «[Originals]», только при первой правке (дальше там уже настоящий оригинал)
    if (!(await originalOf(where))) {
      const backup = await (await where.dir.getDirectoryHandle(ORIGINALS, { create: true })).getFileHandle(where.name, { create: true });
      await write(backup, ed.file);
    }
    await write(where.file, blob);
    // правка — в «Избранное» поездки (как в photo-editor: правленый снимок всегда туда)
    if (!/-Albom$/i.test(where.dir.name.trim())) {
      const fav = await curated(where.trip, true);
      await write(await fav.getFileHandle(where.name, { create: true }), blob);
    }
    done(p, blob, "Сохранено");
  } catch (err) {
    say(`Не сохранилось: ${reason(err)}`);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
}

async function restore() {
  if (!ed.hasOriginal || busy) return;
  if (!confirm("Вернуть снимок, каким он был до правки? Правка пропадёт.")) return;
  const p = ed.p;
  busy = true;
  document.body.classList.add("busy");
  try {
    const where = await locate(p, true);
    const orig = await originalOf(where);
    if (!orig) throw new Error("исходника в «[Originals]» нет");
    await write(where.file, orig);
    await (await where.dir.getDirectoryHandle(ORIGINALS)).removeEntry(where.name).catch(() => {});
    const fav = !/-Albom$/i.test(where.dir.name.trim()) && await curated(where.trip, false);
    if (fav) await fav.removeEntry(where.name).catch(() => {});
    done(p, orig, "Снимок — как до правки");
  } catch (err) {
    say(`Не вернулся: ${reason(err)}`);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
}

// снимок записан: окно карты обновит миниатюры, галерея покажет новый файл
function done(p, blob, text) {
  const url = URL.createObjectURL(blob);
  if (p.full?.startsWith("blob:") && p.mine) URL.revokeObjectURL(p.full);
  Object.assign(p, { full: url, thumb: url, mine: true });
  try { window.opener?.atlasGallerySaved?.(p.id); } catch { /* окно карты закрыто */ }
  close(true);
  g.refresh(p);
  say(text);
  setTimeout(() => say(""), 2500);
}

addEventListener("keydown", (e) => {
  if (!ed.p) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
}, true);
addEventListener("beforeunload", (e) => { if (dirty()) e.preventDefault(); });

// для проверки
window.galleryEditor = { state: () => ({ open: !!ed.p, angle: ed.angle, q: ed.q, flip: ed.flip, dirty: dirty(), hasOriginal: ed.hasOriginal, pv: ed.pv && [ed.pv.width, ed.pv.height], note: note.textContent }), api, save, restore };

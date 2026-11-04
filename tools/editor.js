// Правка снимка в окне галереи (перенос photo-editor / Albom, Грегори 2026-11-03: «начнём
// перетаскивать photo-editor», «интерфейс — на свой взгляд, в одном стиле»). Кнопка «Править»
// (карандаш вверху) — у своих снимков с компьютера (jpg, png, webp); у роликов, снимков с GitHub и
// на телефоне — неактивна. Снимок — на холсте, внизу — полоса инструментов (модули tools/: каждый
// даёт свою группу кнопок), справа — «Оригинал», «Отмена», «Сохранить».
// Качество — как в последней версии photo-editor: превью до 2400 точек, уменьшение в линейном
// свете (не темнеет на встречном свете), экран показывает файл как есть, пока его не тронули.
// Поворот — по-настоящему поворачивает пиксели; края без снимка срезает рамка (самый большой кадр
// тех же пропорций внутри повёрнутого снимка), за рамкой снимок затемнён — видно, что останется.
// Рамка кадрирования — одна на все инструменты (правило photo-editor: свои рамки инструменты не
// строят): «Кадр» (tools/crop.js) показывает её с уголками и пропорциями; уголки тянутся,
// рамка двигается, но за края снимка (с учётом поворота) не выходит — упирается и скользит.
// Сохранение — как в photo-editor: исходник — в «[Originals]» рядом со снимком (только при первой
// правке), снимок переписывается, копия — в «…-Albom» поездки (в Atlas это «Избранное»); EXIF
// (место, дата, камера) переносится целиком (tools/jpeg.js). «Оригинал» возвращает исходник.
// Доступ к папке окно галереи берёт само (IndexedDB albums/dirs) и само просит право записи — по
// нажатию «Сохранить» (браузер спрашивает один раз за сеанс)
import { cacheGet } from "../core/storage.js";
import * as settings from "../core/settings.js";
import { keepExif } from "./jpeg.js";

const TOOLS = ["./rotate.js", "./crop.js"]; // новый инструмент — файл в tools/ и строка здесь
const PREVIEW_MAX = 2400; // как в photo-editor (было 1000 — при увеличении снимок размывался)
const ORIGINALS = "[Originals]";
const QUALITY = 0.92;

const $ = (s) => document.querySelector(s);
const g = window.gallery;
const stage = $(".stage");
const canvas = Object.assign(document.createElement("canvas"), { className: "edit-canvas", hidden: true });
const bar = Object.assign(document.createElement("div"), { className: "edit-bar", hidden: true });
const note = Object.assign(document.createElement("div"), { className: "edit-note" });
const sub = Object.assign(document.createElement("div"), { className: "edit-sub", hidden: true }); // вторая строка (пропорции)
stage.append(canvas, note, sub, bar);
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

// ---------- рамка кадрирования ----------
// Рамка — в точках превью, начало координат — середина снимка, оси экрана (снимок повёрнут на
// angle вокруг начала). Пропорции: как у снимка, свободно, или из списка (как в photo-editor)
export const ASPECTS = [
  { key: "photo", title: "Как снимок" }, { key: "free", title: "Свободно" }, { key: "1:1", r: 1 },
  { key: "4:5", r: 4 / 5 }, { key: "4:3", r: 4 / 3 }, { key: "16:9", r: 16 / 9 }, { key: "9:16", r: 9 / 16 },
];
const ratio = () => ASPECTS.find((a) => a.key === ed.aspect)?.r || ed.pv.width / ed.pv.height;
const fixed = () => ed.aspect !== "free";
// точка рамки — на снимке? (с учётом поворота)
function onPhoto(x, y) {
  const a = (-ed.angle * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  return Math.abs(x * c - y * sn) <= ed.pv.width / 2 + 0.01 && Math.abs(x * sn + y * c) <= ed.pv.height / 2 + 0.01;
}
const fits = (r) => onPhoto(r.x, r.y) && onPhoto(r.x + r.w, r.y) && onPhoto(r.x, r.y + r.h) && onPhoto(r.x + r.w, r.y + r.h);
// самая большая рамка пропорции r посередине повёрнутого снимка
function biggest(r = ratio()) {
  const a = (Math.abs(ed.angle) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), W = ed.pv.width, H = ed.pv.height;
  const w = Math.min(W / (c + sn / r), H / (sn + c / r)), h = w / r;
  return { x: -w / 2, y: -h / 2, w, h };
}
// не помещается (повернули сильнее) — уменьшить вокруг середины
function shrink(r) {
  if (fits(r)) return r;
  if (!onPhoto(r.x + r.w / 2, r.y + r.h / 2)) return biggest();
  let lo = 0, hi = 1;
  const at = (k) => ({ x: r.x + (r.w * (1 - k)) / 2, y: r.y + (r.h * (1 - k)) / 2, w: r.w * k, h: r.h * k });
  for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (fits(at(m))) lo = m; else hi = m; }
  return at(lo);
}
const same = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
// что останется: рамка (если она открыта), иначе — весь снимок без пустых углов
const kept = () => (ed.cropOn ? ed.crop : biggest(ed.pv.width / ed.pv.height));

// ---------- состояние правки ----------
// p — снимок галереи; file — исходный файл; pv — превью (после поворотов на 90° и зеркала);
// q, flip — повороты на 90° и зеркало; angle — точный угол, °
// cropOn — рамка открыта, crop — рамка, aspect — пропорции (помнятся), touched — рамку двигали рукой
const ed = { p: null, file: null, src: null, pv: null, q: 0, flip: false, angle: 0, grid: false, dragging: false, hasOriginal: false,
  cropOn: false, crop: null, aspect: settings.get("edit.aspect", "photo"), touched: false };
const dirty = () => !!ed.p && (ed.angle !== 0 || ed.q % 4 !== 0 || ed.flip || (ed.cropOn && !same(ed.crop, biggest(ed.pv.width / ed.pv.height))));
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
  const W = ed.pv.width, H = ed.pv.height, s = Math.min((cw * 0.94) / W, ((ch - 130 * dpr) * 0.94) / H);
  const cx = cw / 2, cy = (ch - 110 * dpr) / 2;
  view = { s, cx, cy, dpr };
  x.save();
  x.translate(cx, cy);
  x.rotate((ed.angle * Math.PI) / 180);
  x.imageSmoothingQuality = "high";
  x.drawImage(ed.pv, (-W * s) / 2, (-H * s) / 2, W * s, H * s);
  x.restore();
  // рамка: то, что останется; за ней — затемнено; у открытой рамки — уголки
  const k = kept(), rx = cx + k.x * s, ry = cy + k.y * s, rw = k.w * s, rh = k.h * s;
  if (ed.angle || ed.cropOn) {
    x.fillStyle = "rgba(20, 20, 24, 0.72)";
    x.beginPath();
    x.rect(0, 0, cw, ch);
    x.rect(rx, ry, rw, rh);
    x.fill("evenodd");
    x.strokeStyle = "rgba(255, 255, 255, 0.9)";
    x.lineWidth = 1.5 * dpr;
    x.strokeRect(rx, ry, rw, rh);
  }
  if (ed.cropOn) {
    const L = Math.min(22 * dpr, rw / 3, rh / 3);
    x.strokeStyle = "#fff";
    x.lineWidth = 4 * dpr;
    x.lineCap = "square";
    x.beginPath();
    for (const [px, py, dx, dy] of [[rx, ry, 1, 1], [rx + rw, ry, -1, 1], [rx, ry + rh, 1, -1], [rx + rw, ry + rh, -1, -1]]) {
      x.moveTo(px + dx * L, py); x.lineTo(px, py); x.lineTo(px, py + dy * L);
    }
    x.stroke();
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

// ---------- рамку тянут мышью или пальцем ----------
let view = { s: 1, cx: 0, cy: 0, dpr: 1 }, drag = null;
const HIT = 24; // точек экрана вокруг уголка — за него можно взяться
const toFrame = (e) => {
  const b = canvas.getBoundingClientRect();
  return { x: ((e.clientX - b.left) * view.dpr - view.cx) / view.s, y: ((e.clientY - b.top) * view.dpr - view.cy) / view.s };
};
const corners = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
function grab(pt) {
  if (!ed.cropOn) return null;
  const r = ed.crop, near = (HIT * view.dpr) / view.s;
  const i = corners(r).findIndex(([cx, cy]) => Math.hypot(pt.x - cx, pt.y - cy) <= near);
  if (i >= 0) {
    const [ax, ay] = corners(r)[3 - i]; // напротив — неподвижный
    return { kind: "corner", ax, ay, sx: i % 2 ? 1 : -1, sy: i > 1 ? 1 : -1, i };
  }
  if (pt.x > r.x && pt.x < r.x + r.w && pt.y > r.y && pt.y < r.y + r.h) return { kind: "move", from: pt, r0: { ...r } };
  return null;
}
canvas.addEventListener("pointerdown", (e) => {
  const g0 = grab(toFrame(e));
  if (!g0) return;
  drag = g0;
  ed.dragging = true;
  canvas.setPointerCapture(e.pointerId);
  redraw();
});
canvas.addEventListener("pointermove", (e) => {
  const pt = toFrame(e);
  if (!drag) {
    const g0 = grab(pt);
    canvas.style.cursor = !g0 ? "" : g0.kind === "move" ? "move" : g0.i === 0 || g0.i === 3 ? "nwse-resize" : "nesw-resize";
    return;
  }
  const min = (40 * view.dpr) / view.s;
  let next = null;
  if (drag.kind === "move") {
    // упёрлась — скользит вдоль края: по каждой оси — сколько можно
    const dx = pt.x - drag.from.x, dy = pt.y - drag.from.y, at = (kx, ky) => ({ ...drag.r0, x: drag.r0.x + dx * kx, y: drag.r0.y + dy * ky });
    const most = (ok) => { if (ok(1)) return 1; let lo = 0, hi = 1; for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; } return lo; };
    const kx = most((k) => fits(at(k, 0))), ky = most((k) => fits(at(kx, k)));
    next = at(kx, ky);
  } else {
    // sx, sy — в какую сторону от неподвижного уголка лежит тот, за который тянут
    let w = Math.max(min, (pt.x - drag.ax) * drag.sx), h = Math.max(min, (pt.y - drag.ay) * drag.sy);
    if (fixed()) { const r = ratio(); if (w / h > r) h = w / r; else w = h * r; }
    const at = (k) => {
      const ww = min + (w - min) * k, hh = fixed() ? ww / (w / h) : min + (h - min) * k;
      return { x: drag.sx > 0 ? drag.ax : drag.ax - ww, y: drag.sy > 0 ? drag.ay : drag.ay - hh, w: ww, h: hh };
    };
    next = at(1);
    if (!fits(next)) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (fits(at(m))) lo = m; else hi = m; }
      next = at(lo);
    }
  }
  ed.crop = next;
  ed.touched = true;
  sync();
});
const letGo = () => { if (drag) { drag = null; ed.dragging = false; sync(); } };
canvas.addEventListener("pointerup", letGo);
canvas.addEventListener("pointercancel", letGo);

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
  sub,
  // повернули — рамка не тронута рукой: снова самая большая; тронута — уменьшается, если не влезает
  setAngle(a) { ed.angle = Math.max(-45, Math.min(45, Math.round(a * 10) / 10)); ed.crop = ed.touched ? shrink(ed.crop) : biggest(); sync(); },
  turn(d) { ed.q = (ed.q + d + 4) % 4; ed.pv = turned(ed.src, ed.q, ed.flip); ed.angle = 0; refit(); sync(); },
  mirror() { ed.flip = !ed.flip; ed.pv = turned(ed.src, ed.q, ed.flip); ed.angle = 0; refit(); sync(); },
  // рамка: открыть или убрать; пропорции — открывают её заново, самой большой
  crop(on = !ed.cropOn) { ed.cropOn = on; refit(); sync(); },
  setAspect(key) { ed.aspect = key; settings.set("edit.aspect", key); ed.cropOn = true; refit(); sync(); },
  // копия превью без поворота — для поиска горизонта
  preview: () => ed.pv,
};
const refit = () => { ed.touched = false; ed.crop = biggest(); };
const syncers = [];
const groups = Object.assign(document.createElement("div"), { className: "edit-tools" });
const restoreBtn = button(svg("M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"), "Вернуть снимок, каким он был до правки", restore);
const cancelBtn = button(svg("M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"), "Выйти из правки (Esc)", () => close());
const saveBtn = button(svg("M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"), "Сохранить (Ctrl+S)", save);
saveBtn.classList.add("edit-save");
const end = Object.assign(document.createElement("div"), { className: "edit-end" });
end.append(restoreBtn, cancelBtn, saveBtn);
bar.append(groups, end);
// группы — в порядке TOOLS, как бы ни грузились модули
const ready = Promise.all(TOOLS.map((m) => { const slot = groups.appendChild(document.createElement("div")); slot.className = "edit-group"; return import(m).then((mod) => {
  const t = mod.default(api);
  slot.replaceWith(t.el);
  if (t.sync) syncers.push(t.sync);
}).catch((err) => console.warn("инструмент не загрузился:", m, err)); }));

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
    Object.assign(ed, { p, file, src, pv: src, q: 0, flip: false, angle: 0, cropOn: false, hasOriginal: !!(await originalOf(where)) });
    refit();
    document.body.classList.add("editing");
    canvas.hidden = bar.hidden = sub.hidden = false;
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
  Object.assign(ed, { p: null, file: null, src: null, pv: null, angle: 0, q: 0, flip: false, dragging: false, cropOn: false, crop: null });
  drag = null;
  document.body.classList.remove("editing");
  canvas.hidden = bar.hidden = sub.hidden = true;
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
    // рамка — в точках превью: в полный размер — во столько раз, во сколько снимок больше превью
    const W = base.width, H = base.height, f = W / ed.pv.width, r = kept();
    const out = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(r.w * f)), height: Math.max(1, Math.round(r.h * f)) });
    const x = out.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.translate(-r.x * f, -r.y * f);
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
window.galleryEditor = { state: () => ({ open: !!ed.p, angle: ed.angle, q: ed.q, flip: ed.flip, dirty: dirty(), hasOriginal: ed.hasOriginal, pv: ed.pv && [ed.pv.width, ed.pv.height], note: note.textContent,
  cropOn: ed.cropOn, aspect: ed.aspect, crop: ed.crop && Object.fromEntries(Object.entries(ed.crop).map(([k, v]) => [k, Math.round(v * 10) / 10])), fits: !!ed.crop && fits(ed.crop) }),
  // точка рамки (в точках превью от середины снимка) → точка экрана — проверка тянет за уголки
  toScreen: (x, y) => { const b = canvas.getBoundingClientRect(); return [b.left + (view.cx + x * view.s) / view.dpr, b.top + (view.cy + y * view.s) / view.dpr]; },
  api, save, restore };

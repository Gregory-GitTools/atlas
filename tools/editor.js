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
// Перспектива (tools/perspective.js) — четыре ручки по углам снимка: тянешь угол — снимок
// по-настоящему искажается (сходящиеся стены становятся ровными); рамка — внутри искажённого.
// Шум и цвет (tools/noise.js, tools/color.js, как в photo-editor) — обработка пикселей (filter):
// превью показывает её сразу, при сохранении она идёт по снимку в полный размер, по всему кадру
// до поворота и рамки (иначе автоконтраст менялся бы от рамки — опыт photo-editor). Варианты —
// плитками над полосой с маленьким снимком в каждом; одна строка над полосой за раз (panel).
// Сохранение — как в photo-editor: исходник — в «[Originals]» рядом со снимком (только при первой
// правке), снимок переписывается, копия — в «…-Albom» поездки (в Atlas это «Избранное»); EXIF
// (место, дата, камера) переносится целиком (tools/jpeg.js). «Оригинал» возвращает исходник.
// Доступ к папке окно галереи берёт само (IndexedDB albums/dirs) и само просит право записи — по
// нажатию «Сохранить» (браузер спрашивает один раз за сеанс)
import { cacheGet } from "../core/storage.js";
import * as settings from "../core/settings.js";
import { keepExif, setMeta } from "./jpeg.js";

const TOOLS = ["./rotate.js", "./perspective.js", "./crop.js", "./noise.js", "./color.js", "./background.js", "./upscale.js", "./depth.js", "./info.js"]; // новый инструмент — файл в tools/ и строка здесь
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
// пропорции над полосой; узкое окно — полоса переносится в две строки и растёт вверх
const dock = Object.assign(document.createElement("div"), { className: "edit-dock" });
dock.append(sub, bar);
stage.append(canvas, note, dock);
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
  // сдвиг к середине не оставлять: «Фон» рисует по холсту от угла (Грегори 2026-11-11: при сохранении
  // снимок с белым фоном лёг поверх исходника со сдвигом на полкадра)
  x.setTransform(1, 0, 0, 1, 0, 0);
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
// ---------- перспектива: снимок — четырёхугольник ----------
// quad — куда встают углы снимка (верх-лево, верх-право, низ-право, низ-лево) в точках превью от
// середины снимка, до поворота на angle. Без перспективы — сам прямоугольник снимка
const rectQuad = () => { const w = ed.pv.width / 2, h = ed.pv.height / 2; return [[-w, -h], [w, -h], [w, h], [-w, h]]; };
const warped = () => !!ed.quad && rectQuad().some(([x, y], i) => Math.abs(x - ed.quad[i][0]) > 0.5 || Math.abs(y - ed.quad[i][1]) > 0.5);
const rad = () => (ed.angle * Math.PI) / 180;
const turn = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
// углы снимка на экране (с поворотом)
const outline = () => ed.quad.map((q) => turn(q, rad()));
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
// выпуклый (иначе снимок вывернется) — все повороты обхода в одну сторону
const convex = (q) => q.every((_, i) => cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]) > 1) || q.every((_, i) => cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]) < -1);
// точка рамки — на снимке? (с учётом поворота и перспективы)
function onPhoto(x, y) {
  const pt = turn([x, y], -rad()), q = ed.quad, sign = Math.sign(cross(q[0], q[1], q[2]));
  return q.every((a, i) => { const b = q[(i + 1) % 4]; return sign * ((b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0])) >= -0.01 * ed.pv.width; });
}
const fits = (r) => onPhoto(r.x, r.y) && onPhoto(r.x + r.w, r.y) && onPhoto(r.x, r.y + r.h) && onPhoto(r.x + r.w, r.y + r.h);
// самая большая рамка пропорции r внутри снимка (с поворотом и перспективой). Была — вокруг
// середины четырёхугольника, и у скошенного снимка оставалось много места (Грегори 2026-11-08):
// при высоте h середины рамки, у которых все четыре уголка на снимке, — выпуклый многоугольник
// (каждый уголок × каждая сторона — полуплоскость); h — наибольшая, при которой он не пуст,
// рамка — посередине этого многоугольника
function biggest(r = ratio()) {
  const q = outline(), sign = Math.sign(cross(q[0], q[1], q[2])) || 1, big = 4 * Math.max(ed.pv.width, ed.pv.height);
  const centers = (h) => {
    let poly = [[-big, -big], [big, -big], [big, big], [-big, big]];
    for (let i = 0; i < 4 && poly.length; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        // уголок — середина + (dx·w/2, dy·h/2) — по внутреннюю сторону a→b
        const side = ([x, y]) => sign * ((b[0] - a[0]) * (y + (dy * h) / 2 - a[1]) - (b[1] - a[1]) * (x + (dx * h * r) / 2 - a[0]));
        const out = [];
        poly.forEach((p, k) => {
          const n = poly[(k + 1) % poly.length], sp = side(p), sn = side(n);
          if (sp >= 0) out.push(p);
          if ((sp >= 0) !== (sn >= 0)) { const t = sp / (sp - sn); out.push([p[0] + (n[0] - p[0]) * t, p[1] + (n[1] - p[1]) * t]); }
        });
        poly = out;
      }
    }
    return poly;
  };
  let lo = 0, hi = 2 * Math.max(ed.pv.width, ed.pv.height);
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (centers(m).length) lo = m; else hi = m; }
  const c = centers(lo), cx = c.length ? c.reduce((a, p) => a + p[0], 0) / c.length : 0, cy = c.length ? c.reduce((a, p) => a + p[1], 0) / c.length : 0;
  return { x: cx - (lo * r) / 2, y: cy - lo / 2, w: lo * r, h: lo };
}

// куда уходит точка снимка (u, v от 0 до 1) при перспективе — и обратно (Хекберт, квадрат → четырёхугольник)
function homography(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) { const d = dx1 * dy2 - dx2 * dy1; g = (sx * dy2 - dx2 * sy) / d; h = (dx1 * sy - sx * dy1) / d; }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}
const apply = (m, x, y) => { const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]; };
function invert(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = c * h - b * i, C = b * f - c * e;
  const det = a * A + d * B + g * C;
  return [A / det, B / det, C / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
}
// показ искажённого снимка: сетка 16×16 клеток, каждая — два треугольника, натянутых как есть
// (быстро; при сохранении — точный расчёт каждой точки)
function drawWarped(x, img, q, scale) {
  const N = 16, m = homography(q), W = img.width, H = img.height, grow = 1 / scale;
  const P = (i, j) => apply(m, i / N, j / N), S = (i, j) => [(W * i) / N, (H * j) / N];
  const tri = (s, d) => {
    const cxm = (d[0][0] + d[1][0] + d[2][0]) / 3, cym = (d[0][1] + d[1][1] + d[2][1]) / 3;
    const out = d.map(([px, py]) => { const vx = px - cxm, vy = py - cym, l = Math.hypot(vx, vy) || 1; return [px + (vx / l) * grow, py + (vy / l) * grow]; });
    const [[s0x, s0y], [s1x, s1y], [s2x, s2y]] = s, [[d0x, d0y], [d1x, d1y], [d2x, d2y]] = d;
    const den = s0x * (s1y - s2y) + s1x * (s2y - s0y) + s2x * (s0y - s1y);
    if (!den) return;
    x.save();
    x.beginPath(); x.moveTo(...out[0]); x.lineTo(...out[1]); x.lineTo(...out[2]); x.closePath(); x.clip();
    x.transform((d0x * (s1y - s2y) + d1x * (s2y - s0y) + d2x * (s0y - s1y)) / den, (d0y * (s1y - s2y) + d1y * (s2y - s0y) + d2y * (s0y - s1y)) / den,
      (d0x * (s2x - s1x) + d1x * (s0x - s2x) + d2x * (s1x - s0x)) / den, (d0y * (s2x - s1x) + d1y * (s0x - s2x) + d2y * (s1x - s0x)) / den,
      (d0x * (s1x * s2y - s2x * s1y) + d1x * (s2x * s0y - s0x * s2y) + d2x * (s0x * s1y - s1x * s0y)) / den,
      (d0y * (s1x * s2y - s2x * s1y) + d1y * (s2x * s0y - s0x * s2y) + d2y * (s0x * s1y - s1x * s0y)) / den);
    x.drawImage(img, 0, 0);
    x.restore();
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    tri([S(i, j), S(i + 1, j), S(i + 1, j + 1)], [P(i, j), P(i + 1, j), P(i + 1, j + 1)]);
    tri([S(i, j), S(i + 1, j + 1), S(i, j + 1)], [P(i, j), P(i + 1, j + 1), P(i, j + 1)]);
  }
}
// сохранение с перспективой: каждая точка кадра — обратно в снимок, цвет — между четырьмя соседями
function warpOut(base, r, f) {
  const W = base.width, H = base.height, ow = Math.max(1, Math.round(r.w * f)), oh = Math.max(1, Math.round(r.h * f));
  const sc = Object.assign(document.createElement("canvas"), { width: W, height: H });
  sc.getContext("2d").drawImage(base, 0, 0);
  const src = sc.getContext("2d").getImageData(0, 0, W, H).data;
  const out = Object.assign(document.createElement("canvas"), { width: ow, height: oh });
  const img = out.getContext("2d").createImageData(ow, oh), d = img.data;
  const inv = invert(homography(ed.quad)), a = -rad(), c = Math.cos(a), sn = Math.sin(a);
  for (let oy = 0; oy < oh; oy++) {
    const fy = r.y + (oy + 0.5) / f;
    for (let ox = 0; ox < ow; ox++) {
      const fx = r.x + (ox + 0.5) / f;
      const [u, v] = apply(inv, fx * c - fy * sn, fx * sn + fy * c);
      const sx = Math.min(W - 1.001, Math.max(0, u * W - 0.5)), sy = Math.min(H - 1.001, Math.max(0, v * H - 0.5));
      const x0 = sx | 0, y0 = sy | 0, tx = sx - x0, ty = sy - y0, i0 = (y0 * W + x0) * 4, i1 = i0 + W * 4, o = (oy * ow + ox) * 4;
      for (let k = 0; k < 4; k++) {
        const top = src[i0 + k] + (src[i0 + 4 + k] - src[i0 + k]) * tx, bot = src[i1 + k] + (src[i1 + 4 + k] - src[i1 + k]) * tx;
        d[o + k] = top + (bot - top) * ty;
      }
    }
  }
  out.getContext("2d").putImageData(img, 0, 0);
  return out;
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
// снимок поменялся (угол, перспектива): рамка не тронута рукой — снова самая большая; тронута —
// едет и растягивается вместе с самой большой, на том же месте снимка (Грегори 2026-11-08: «рамка
// кадрирования не следит за рамкой перспективы» — раньше только уменьшалась)
function follow(change) {
  if (!ed.touched) { change(); ed.crop = biggest(); return; }
  const c = ed.crop, r = c.w / c.h, b0 = biggest(r);
  change();
  const b1 = biggest(r), k = b0.h > 0 ? b1.h / b0.h : 1;
  ed.crop = shrink({ x: b1.x + (c.x - b0.x) * k, y: b1.y + (c.y - b0.y) * k, w: c.w * k, h: c.h * k });
}
const same = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
// что останется: рамка (если она открыта), иначе — весь снимок без пустых углов
const kept = () => (ed.cropOn ? ed.crop : biggest(ed.pv.width / ed.pv.height));

// ---------- состояние правки ----------
// p — снимок галереи; file — исходный файл; pv — превью (после поворотов на 90° и зеркала);
// q, flip — повороты на 90° и зеркало; angle — точный угол, °
// cropOn — рамка открыта, crop — рамка, aspect — пропорции (помнятся), touched — рамку двигали рукой
const ed = { p: null, file: null, src: null, pv: null, q: 0, flip: false, angle: 0, grid: false, dragging: false, hasOriginal: false,
  cropOn: false, crop: null, aspect: settings.get("edit.aspect", "photo"), touched: false, quad: null, persp: false,
  panel: null, shown: null, values: {}, meta: {}, size: null, zoom: 1, pan: [0, 0] };
// обработка пикселей от инструментов: { key, order, off, apply(canvas, value) } — по порядку order
const filters = [];
const active = (v = ed.values) => filters.filter((f) => v[f.key] !== undefined && v[f.key] !== f.off);
// meta — поправленные сведения (tools/info.js): только они — снимок не пересчитывается
const dirty = () => edited() || (!!ed.p && Object.keys(ed.meta).length > 0);
// finishers — что делают с готовым кадром при сохранении (увеличение ×2); edited — есть ли им работа
const finishers = [];
const edited = () => !!ed.p && (finishers.some((f) => f.on()) || ed.angle !== 0 || ed.q % 4 !== 0 || ed.flip || warped() || active().length > 0 || (ed.cropOn && !same(ed.crop, biggest(ed.pv.width / ed.pv.height))));
const say = (text) => { note.textContent = text || ""; note.classList.toggle("show", !!text); };

// доступ к своей папке: из IndexedDB этого окна (так браузер даёт просить запись из него),
// для проверки — у окна карты
// Список папок — заранее (при открытии правки): браузер разрешает спросить запись только в первые
// секунды после нажатия, а чтение IndexedDB, пока страница занята нейросетью («Фон»), эти секунды съедало
// (Грегори 2026-11-10: «Не сохранилось: … User activation is required to request permissions»)
let known = null;
async function roots() {
  const saved = await cacheGet("albums/dirs").catch(() => null);
  if (Array.isArray(saved) && saved.length) return (known = saved);
  try { return (known = window.opener?.atlasGalleryRoots?.() || []); } catch { return []; }
}
// Окну галереи Edge своё разрешение на запись не даёт и не спрашивает (Грегори 2026-11-11: в окне галереи
// нет «Изменения файлов», а у окна карты — есть) — сначала доступ окна карты, где запись уже разрешена
const openerRoot = (i) => { try { return window.opener?.atlasGalleryRoots?.()[i] || null; } catch { return null; } };
async function locate(p, write = false) {
  let root = (known || await roots())[p.edit.root];
  if (!root) throw new Error("папка снимка не найдена — откройте её в «Моих альбомах» снова");
  const mode = write ? "readwrite" : "read";
  const there = openerRoot(p.edit.root);
  if (there && there.name === root.name && await there.queryPermission({ mode }).catch(() => "") === "granted") root = there;
  const ok = await root.queryPermission({ mode }) === "granted" ? "granted" : await root.requestPermission({ mode }).catch((e) => e);
  if (ok instanceof Error) throw new Error("браузер не успел спросить разрешение на запись — нажмите «Сохранить» ещё раз");
  if (ok !== "granted" && write) {
    try { window.opener?.atlasGalleryAskWrite?.(p.edit.root); } catch { /* окно карты закрыто */ }
    throw new Error(window.opener ? "в окне карты появилась кнопка «Разрешить запись в папку» — нажмите её и разрешите, затем снова «Сохранить»" : "браузер не дал записать в папку");
  }
  if (ok !== "granted") throw new Error("нет доступа к папке");
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
  // снизу — место под полосу инструментов (на узком окне она в две строки)
  const low = (dock.offsetHeight + 24) * dpr;
  // вписан в окно, дальше — масштаб колесом и сдвиг (ed.zoom, ed.pan — точки CSS)
  const W = ed.pv.width, H = ed.pv.height, s = ed.zoom * Math.min((cw * 0.94) / W, ((ch - low - 20 * dpr) * 0.94) / H);
  const cx = cw / 2 + ed.pan[0] * dpr, cy = (ch - low) / 2 + 10 * dpr + ed.pan[1] * dpr;
  view = { s, cx, cy, dpr };
  x.save();
  x.translate(cx, cy);
  x.rotate((ed.angle * Math.PI) / 180);
  x.imageSmoothingQuality = "high";
  const img = ed.shown || ed.pv; // с шумом и цветом
  if (warped()) { x.scale(s, s); x.translate(-W / 2, -H / 2); drawWarped(x, img, ed.quad.map(([qx, qy]) => [qx + W / 2, qy + H / 2]), s); }
  else x.drawImage(img, (-W * s) / 2, (-H * s) / 2, W * s, H * s);
  x.restore();
  // рамка: то, что останется; за ней — затемнено; у открытой рамки — уголки
  const k = kept(), rx = cx + k.x * s, ry = cy + k.y * s, rw = k.w * s, rh = k.h * s;
  if (ed.angle || ed.cropOn || warped() || ed.persp) {
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
  if (ed.grid || ed.dragging || ed.persp) {
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
  // перспектива: контур снимка и ручки по углам
  if (ed.persp) {
    const pts = outline().map(([px, py]) => [cx + px * s, cy + py * s]);
    x.strokeStyle = "rgba(77, 163, 255, 0.9)";
    x.lineWidth = 1.5 * dpr;
    x.beginPath(); pts.forEach((pp, i) => (i ? x.lineTo(...pp) : x.moveTo(...pp))); x.closePath(); x.stroke();
    for (const pp of pts) {
      x.beginPath(); x.arc(pp[0], pp[1], 9 * dpr, 0, Math.PI * 2);
      x.fillStyle = "#fff"; x.fill();
      x.lineWidth = 3 * dpr; x.strokeStyle = "#4da3ff"; x.stroke();
    }
  }
}
const resized = new ResizeObserver(() => ed.p && redraw());
resized.observe(stage);
resized.observe(dock);

// ---------- рамку тянут мышью или пальцем ----------
let view = { s: 1, cx: 0, cy: 0, dpr: 1 }, drag = null;
const HIT = 24; // точек экрана вокруг уголка — за него можно взяться
const toFrame = (e) => {
  const b = canvas.getBoundingClientRect();
  return { x: ((e.clientX - b.left) * view.dpr - view.cx) / view.s, y: ((e.clientY - b.top) * view.dpr - view.cy) / view.s };
};
const corners = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
function grab(pt) {
  if (ed.persp) {
    const near = (HIT * view.dpr) / view.s, i = outline().findIndex(([qx, qy]) => Math.hypot(pt.x - qx, pt.y - qy) <= near);
    if (i >= 0) return { kind: "quad", i };
  }
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
// мимо рамки и ручек (или средней кнопкой) — сдвигает вид
canvas.addEventListener("pointerdown", (e) => {
  const g0 = e.button === 1 ? null : grab(toFrame(e));
  if (g0) ed.dragging = true;
  drag = g0 || { kind: "pan", x: e.clientX, y: e.clientY, pan: [...ed.pan] };
  canvas.setPointerCapture(e.pointerId);
  if (!g0) canvas.style.cursor = "grabbing";
  e.preventDefault();
  redraw();
});
canvas.addEventListener("pointermove", (e) => {
  const pt = toFrame(e);
  if (!drag) {
    const g0 = grab(pt);
    canvas.style.cursor = !g0 ? (zoomed() ? "grab" : "") : g0.kind === "quad" ? "pointer" : g0.kind === "move" ? "move" : g0.i === 0 || g0.i === 3 ? "nwse-resize" : "nesw-resize";
    return;
  }
  if (drag.kind === "pan") {
    ed.pan = [drag.pan[0] + e.clientX - drag.x, drag.pan[1] + e.clientY - drag.y];
    redraw();
    return;
  }
  if (drag.kind === "quad") {
    // угол снимка — куда отпустили (не дальше снимка от его края и только выпуклым)
    const [qx, qy] = turn([pt.x, pt.y], -rad()), W = ed.pv.width, H = ed.pv.height;
    const q = ed.quad.map((c, i) => (i === drag.i ? [Math.max(-W, Math.min(W, qx)), Math.max(-H, Math.min(H, qy))] : c));
    if (convex(q)) { follow(() => { ed.quad = q; }); sync(); }
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
const letGo = () => {
  if (!drag) return;
  const pan = drag.kind === "pan";
  drag = null;
  ed.dragging = false;
  canvas.style.cursor = pan && zoomed() ? "grab" : "";
  if (!pan) sync();
};
canvas.addEventListener("pointerup", letGo);
canvas.addEventListener("pointercancel", letGo);
// колесо — масштаб снимка вокруг стрелки мыши (от 1/5 окна — видны ручки перспективы за краями —
// до ×12); двойной щелчок — снова вписан. Масштаб браузера в правке выключен (Грегори 2026-11-08):
// Ctrl+колесо и щипок тачпада — тоже масштаб снимка, Ctrl + / − / 0 — ничего
const zoomed = () => ed.zoom !== 1 || ed.pan[0] !== 0 || ed.pan[1] !== 0;
function zoomAt(k, clientX, clientY) {
  const z = Math.max(0.2, Math.min(12, ed.zoom * k));
  if (z === ed.zoom) return;
  // точка под мышью остаётся на месте: середина снимка отъезжает от мыши во столько же раз
  const b = canvas.getBoundingClientRect(), mx = clientX - b.left, my = clientY - b.top;
  const cx = view.cx / view.dpr, cy = view.cy / view.dpr, f = z / ed.zoom;
  ed.pan = [ed.pan[0] + (mx - (mx - cx) * f) - cx, ed.pan[1] + (my - (my - cy) * f) - cy];
  ed.zoom = z;
  redraw();
}
canvas.addEventListener("wheel", (e) => {
  if (!ed.p) return;
  e.preventDefault();
  zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
}, { passive: false });
addEventListener("wheel", (e) => { if (ed.p && e.ctrlKey) e.preventDefault(); }, { passive: false });
canvas.addEventListener("dblclick", () => { if (!ed.p) return; ed.zoom = 1; ed.pan = [0, 0]; canvas.style.cursor = ""; redraw(); });

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
  // повернули — рамка за снимком (follow)
  setAngle(a) { follow(() => { ed.angle = Math.max(-45, Math.min(45, Math.round(a * 10) / 10)); }); sync(); },
  // поправленная перспектива поворачивается вместе со снимком (photo-editor: иначе правка пропадёт)
  turn(d) {
    const o = ed.quad;
    ed.quad = d > 0 ? o.map((_, i) => { const [x, y] = o[(i + 3) % 4]; return [-y, x]; }) : o.map((_, i) => { const [x, y] = o[(i + 1) % 4]; return [y, -x]; });
    ed.q = (ed.q + d + 4) % 4; ed.pv = turned(ed.src, ed.q, ed.flip); ed.angle = 0; refit(); refilter();
  },
  // зеркало — слева направо, как видно на экране: после поворота на 90° одного переключения flip
  // мало (отразило бы сверху вниз) — поворот меняется на обратный
  mirror() {
    const o = ed.quad;
    ed.quad = [o[1], o[0], o[3], o[2]].map(([x, y]) => [-x, y]);
    ed.flip = !ed.flip; ed.q = (4 - ed.q) % 4; ed.pv = turned(ed.src, ed.q, ed.flip); ed.angle = 0; refit(); refilter();
  },
  // перспектива: ручки показать или убрать (поправленное остаётся); «как было» — снимок без неё
  perspective(on = !ed.persp) { ed.persp = on; sync(); },
  resetQuad() { follow(() => { ed.quad = rectQuad(); }); sync(); },
  warped,
  // рамка: открыть или убрать; пропорции — открывают её заново, самой большой
  crop(on = !ed.cropOn) { ed.cropOn = on; ed.panel = on ? "crop" : ed.panel === "crop" ? null : ed.panel; refit(); sync(); },
  setAspect(key) { ed.aspect = key; settings.set("edit.aspect", key); ed.cropOn = true; refit(); sync(); },
  // строка над полосой: одна за раз (пропорции, шум, цвет); второй щелчок — убрать
  panel(key) { ed.panel = ed.panel === key ? null : key; sync(); },
  // обработка пикселей: инструмент объявляет её, значение — в ed.values[key]; clear(v) — с прозрачностью
  // (у JPEG сохраняется PNG рядом)
  filter(f) { filters.push(f); filters.sort((a, b) => a.order - b.order); ed.values[f.key] = f.off; },
  setValue(key, v) { ed.values[key] = v; refilter(); },
  // маленькая копия снимка с обработкой, как будто ed.values[key] = v — для плиток вариантов
  async sample(key, v, width = 96) {
    const src = ed.pv, w = width, h = Math.max(1, Math.round((width * src.height) / src.width));
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
    c.getContext("2d").drawImage(src, 0, 0, w, h);
    await runFilters(c, { ...ed.values, [key]: v }, w / src.width);
    return c;
  },
  // копия превью без поворота — для поиска горизонта
  preview: () => ed.pv,
  // готовый кадр в размер превью: обработка, точный угол, перспектива, рамка — для 3D
  frame: () => framed(ed.shown || ed.pv, 1),
  // сведения о снимке: поправки к EXIF ({ date, camera, gps }; ключа нет — не трогали)
  setMeta(m) { ed.meta = m; sync(); },
  // обработка готового кадра при сохранении: { on() — включена, run(canvas) → canvas }
  finish(f) { finishers.push(f); },
  // своя папка снимка, «Избранное» поездки, запись файла, выйти из правки — для «Сведений»
  locate: (p, w) => locate(p, w), curated: (trip, create) => curated(trip, create), write: (fh, data) => write(fh, data),
  close: (force) => close(force), done: (p, blob, text) => done(p, blob, text),
};
const refit = () => { ed.touched = false; ed.crop = biggest(); };
// k — во сколько раз холст меньше превью (у плиток): шумодаву — меньше окрестность
async function runFilters(c, values, k = 1) {
  for (const f of active(values)) await f.apply(c, values[f.key], k);
}
// превью с обработкой — заново; пока считается (шум — секунды), крутится кружок
let filtering = 0;
async function refilter() {
  const n = ++filtering;
  if (!active().length) { ed.shown = null; sync(); return; }
  document.body.classList.add("busy");
  sync();
  try {
    const c = Object.assign(document.createElement("canvas"), { width: ed.pv.width, height: ed.pv.height });
    c.getContext("2d").drawImage(ed.pv, 0, 0);
    await new Promise((r) => setTimeout(r, 20)); // кружок успевает показаться
    await runFilters(c, ed.values);
    if (n === filtering && ed.pv) ed.shown = c;
  } catch (err) { say(err.message); }
  if (n === filtering) { document.body.classList.remove("busy"); sync(); }
}
const syncers = [];
const groups = Object.assign(document.createElement("div"), { className: "edit-tools" });
// «Сбросить правку» — значок снимка (как был), не круговая стрелка: «Назад» рядом — тоже стрелка, их путали
// (Грегори 2026-11-11: «различаем»)
const restoreBtn = button(svg("M19 19H5V5h14m0-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m-5.04 9.29-2.75 3.54-1.96-2.36L6.5 17h11z"), "Сбросить правку", () => (changed() ? resetAll() : restore()));
restoreBtn.classList.add("edit-restore");
const cancelBtn = button(svg("M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"), "Выйти из правки (Esc)", () => close());
const saveBtn = button(svg("M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"), "Сохранить (Ctrl+S)", save);
saveBtn.classList.add("edit-save");
const undoBtn = button(svg("M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"), "Назад — отменить последнее (Ctrl+Z)", () => undo());
const end = Object.assign(document.createElement("div"), { className: "edit-end" });
end.append(undoBtn, restoreBtn, cancelBtn, saveBtn);
bar.append(groups, end);
// группы — в порядке TOOLS, как бы ни грузились модули
const ready = Promise.all(TOOLS.map((m) => { const slot = groups.appendChild(document.createElement("div")); slot.className = "edit-group"; return import(m).then((mod) => {
  const t = mod.default(api);
  slot.replaceWith(t.el);
  if (t.sync) syncers.push(t.sync);
}).catch((err) => console.warn("инструмент не загрузился:", m, err)); }));

function sync() {
  saveBtn.disabled = !dirty();
  // «Сбросить правку»: есть изменения — снимок как при открытии правки (активна с первой правки,
  // Грегори 2026-11-08); нет — снимок из копии, каким он был до первой сохранённой правки
  if (ed.p && first) {
    const now = snapKey();
    undoBtn.disabled = !history.length && now === current.key;
    if (now !== current.key) remember();
  }
  restoreBtn.disabled = !changed() && !ed.hasOriginal;
  restoreBtn.title = changed() || !ed.hasOriginal ? "Сбросить правку — снимок как при открытии" : "Вернуть снимок, каким он был до правки (из копии)";
  for (const f of syncers) f(ed);
  redraw();
}

// ---------- назад, сбросить всё (Грегори 2026-11-08) ----------
// шаг — снимок состояния правки; изменения подряд (ползунок, набор текста, тянут рамку) — один шаг:
// запоминается через полсекунды тишины и не посреди перетаскивания
let history = [], current = null, first = null, later = 0;
const snap = () => ({ angle: ed.angle, q: ed.q, flip: ed.flip, crop: { ...ed.crop }, cropOn: ed.cropOn, touched: !!ed.touched, quad: ed.quad.map((c) => [...c]),
  aspect: ed.aspect, values: { ...ed.values }, meta: { ...ed.meta }, fin: finishers.map((f) => f.on()) });
const keyOf = (sn) => JSON.stringify(sn);
const snapKey = () => keyOf(snap());
function remember() {
  clearTimeout(later);
  later = setTimeout(function tick() { if (ed.dragging) later = setTimeout(tick, 300); else commit(); }, 500);
}
function commit() {
  clearTimeout(later);
  if (!ed.p) return;
  const sn = snap(), key = keyOf(sn);
  if (key === current.key) return;
  history.push(current);
  current = { sn, key };
}
function back(to) {
  const sn = to.sn, turnedNow = sn.q !== ed.q || sn.flip !== ed.flip;
  Object.assign(ed, { angle: sn.angle, q: sn.q, flip: sn.flip, crop: { ...sn.crop }, cropOn: sn.cropOn, touched: sn.touched, quad: sn.quad.map((c) => [...c]),
    aspect: sn.aspect, values: { ...sn.values }, meta: { ...sn.meta } });
  if (!ed.cropOn && ed.panel === "crop") ed.panel = null;
  finishers.forEach((f, i) => f.set?.(sn.fin[i]));
  if (turnedNow) ed.pv = turned(ed.src, ed.q, ed.flip);
  current = to;
  refilter();
}
const changed = () => !!ed.p && !!first && snapKey() !== first.key;
function undo() {
  if (!ed.p || busy) return;
  commit();
  if (history.length) back(history.pop());
}
function resetAll() {
  if (!ed.p || busy) return;
  commit();
  if (current.key === first.key) return;
  history.push(current); // и это можно вернуть «Назад»
  back(first);
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
    await roots(); // свежий список папок — к нажатию «Сохранить» уже под рукой
    const where = await locate(p);
    const file = await where.file.getFile();
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, PREVIEW_MAX / Math.max(bmp.width, bmp.height));
    const src = k < 1 ? downsample(bmp, Math.round(bmp.width * k), Math.round(bmp.height * k)) : turned(bmp, 0, false);
    const size = [bmp.width, bmp.height];
    bmp.close?.();
    if (g.current() !== p) return;
    Object.assign(ed, { p, file, src, pv: src, shown: null, q: 0, flip: false, angle: 0, cropOn: false, persp: false, panel: null, meta: {}, size, hasOriginal: !!(await originalOf(where)) });
    for (const f of filters) ed.values[f.key] = f.off; // как в photo-editor: «Оригинал», шум выключен
    ed.quad = rectQuad();
    refit();
    Object.assign(ed, { zoom: 1, pan: [0, 0] });
    finishers.forEach((f) => f.set?.(false));
    history = [];
    current = first = { sn: snap(), key: snapKey() };
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
  Object.assign(ed, { p: null, file: null, src: null, pv: null, angle: 0, q: 0, flip: false, dragging: false, cropOn: false, crop: null, quad: null, persp: false, shown: null, panel: null, meta: {}, zoom: 1, pan: [0, 0] });
  drag = null;
  clearTimeout(later);
  history = [];
  current = first = null;
  document.body.classList.remove("editing");
  canvas.hidden = bar.hidden = sub.hidden = true;
  editBtn.classList.remove("on");
  editBtn.title = "Править снимок";
  say("");
  for (const f of syncers) f(ed); // инструменты узнают, что правка закрыта
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

// сохранили или вернули оригинал — правка открывается снова, уже с записанным снимком
// (Грегори 2026-11-11: «после применения фильтров не выходи из окна редактирования»)
async function reopen(p, text) {
  await open(p);
  say(text);
  setTimeout(() => say(""), 4000);
}
async function save() {
  if (!dirty() || busy) return;
  const p = ed.p;
  let again = null;
  busy = true;
  document.body.classList.add("busy");
  say("Сохраняю…");
  try {
    const where = await locate(p, true);
    const jpeg = !/\.(png|webp)$/i.test(where.name), meta = jpeg && Object.keys(ed.meta).length ? ed.meta : null;
    // прозрачного JPEG не бывает — PNG рядом («… без фона.png»), сам снимок не тронут
    if (jpeg && active().some((f) => f.clear?.(ed.values[f.key]))) {
      const png = await render(where, null, "image/png"), name = `${where.name.replace(/\.[^.]+$/, "")} без фона.png`;
      await write(await where.dir.getFileHandle(name, { create: true }), png);
      close(true);
      try { window.opener?.atlasGalleryRescan?.(); } catch { /* окно карты закрыто */ }
      again = `Сохранено рядом: ${name}`;
      return;
    }
    // поправили только сведения — тот же снимок с новым EXIF, без пересжатия
    const blob = edited() ? await render(where, meta) : await setMeta(ed.file, meta || {});
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
    again = "Сохранено";
  } catch (err) {
    say(`Не сохранилось: ${reason(err)}`);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
    if (again) reopen(p, again);
  }
}

// снимок в полный размер со всей правкой
// кадр: точный угол, перспектива и рамка; f — во сколько раз base больше превью
function framed(base, f) {
  const W = base.width, H = base.height, r = kept();
  if (warped()) return warpOut(base, r, f);
  const out = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(r.w * f)), height: Math.max(1, Math.round(r.h * f)) });
  const x = out.getContext("2d");
  x.imageSmoothingQuality = "high";
  x.translate(-r.x * f, -r.y * f);
  x.rotate((ed.angle * Math.PI) / 180);
  x.drawImage(base, -W / 2, -H / 2);
  return out;
}

async function render(where, meta, type) {
  // полный размер: исходник → повороты на 90° и зеркало → точный угол и рамка
  const bmp = await createImageBitmap(ed.file, { imageOrientation: "from-image" });
  let base = ed.q || ed.flip ? turned(bmp, ed.q, ed.flip) : bmp;
  // шум и цвет — по всему кадру в полный размер, до поворота и рамки
  if (active().length) {
    say("Сохраняю: шум и цвет…");
    if (!(base instanceof HTMLCanvasElement)) base = turned(base, 0, false);
    await new Promise((res) => setTimeout(res, 30));
    await runFilters(base, ed.values, base.width / ed.pv.width);
  }
  // рамка — в точках превью: в полный размер — во столько раз, во сколько снимок больше превью
  if (warped()) {
    say("Сохраняю: выправляю перспективу…");
    await new Promise((res) => setTimeout(res, 30)); // надпись успевает показаться
  }
  let out = framed(base, base.width / ed.pv.width);
  bmp.close?.();
  for (const fin of finishers) if (fin.on()) out = await fin.run(out);
  type ||= /\.png$/i.test(where.name) ? "image/png" : /\.webp$/i.test(where.name) ? "image/webp" : "image/jpeg";
  const blob = await new Promise((r) => out.toBlob(r, type, QUALITY));
  if (!blob) throw new Error("снимок слишком большой для браузера");
  return type === "image/jpeg" ? keepExif(blob, ed.file, out.width, out.height, meta) : blob;
}

async function restore() {
  if (!ed.hasOriginal || busy) return;
  if (!confirm("Вернуть снимок, каким он был до правки? Правка пропадёт.")) return;
  const p = ed.p;
  let again = false;
  busy = true;
  document.body.classList.add("busy");
  try {
    const where = await locate(p, true);
    const file = await originalOf(where);
    if (!file) throw new Error("исходника в «[Originals]» нет");
    // в память: файл копии сейчас удалится, а показ снимка в галерее — из него (Грегори 2026-11-11:
    // после «Оригинала» вместо снимка — пустое место)
    const orig = new Blob([await file.arrayBuffer()], { type: file.type });
    await write(where.file, orig);
    await (await where.dir.getDirectoryHandle(ORIGINALS)).removeEntry(where.name).catch(() => {});
    const fav = !/-Albom$/i.test(where.dir.name.trim()) && await curated(where.trip, false);
    if (fav) await fav.removeEntry(where.name).catch(() => {});
    done(p, orig, "Снимок — как до правки");
    again = true;
  } catch (err) {
    say(`Не вернулся: ${reason(err)}`);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
    if (again) reopen(p, "Снимок — как до правки");
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
  if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "_", "0"].includes(e.key)) { e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !e.target.matches?.("input")) { e.preventDefault(); undo(); return; }
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
}, true);
addEventListener("beforeunload", (e) => { if (dirty()) e.preventDefault(); });

// для проверки
window.galleryEditor = { state: () => ({ open: !!ed.p, angle: ed.angle, q: ed.q, flip: ed.flip, dirty: dirty(), hasOriginal: ed.hasOriginal, pv: ed.pv && [ed.pv.width, ed.pv.height], note: note.textContent,
  cropOn: ed.cropOn, aspect: ed.aspect, crop: ed.crop && Object.fromEntries(Object.entries(ed.crop).map(([k, v]) => [k, Math.round(v * 10) / 10])), fits: !!ed.crop && fits(ed.crop),
  persp: ed.persp, warped: !!ed.quad && warped(), panel: ed.panel, values: { ...ed.values }, shown: !!ed.shown, meta: { ...ed.meta }, size: ed.size, zoom: Math.round(ed.zoom * 1000) / 1000, steps: history.length, quad: ed.quad && ed.quad.map((c) => c.map((v) => Math.round(v))) }),
  fitsBox: (r) => fits(r),
  // угол снимка (с перспективой и поворотом) → точка экрана
  cornerOnScreen: (i) => { const [x, y] = outline()[i], b = canvas.getBoundingClientRect(); return [b.left + (view.cx + x * view.s) / view.dpr, b.top + (view.cy + y * view.s) / view.dpr]; },
  // точка рамки (в точках превью от середины снимка) → точка экрана — проверка тянет за уголки
  toScreen: (x, y) => { const b = canvas.getBoundingClientRect(); return [b.left + (view.cx + x * view.s) / view.dpr, b.top + (view.cy + y * view.s) / view.dpr]; },
  api, save, restore };

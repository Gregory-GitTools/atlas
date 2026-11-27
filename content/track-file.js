// Трек — разбор файла GPX/KML и подсчёт (длина, время в пути, скорость, набор высоты, график). Без панели и карты:
// это нужно и «Моим трекам» (content/tracks.js), и «Моим альбомам» (GPX в папках со снимками) — раньше альбомы
// брали разбор из tracks.js целиком (Грегори 2026-11-27: «Задача разбить большой код на блоки»)

export const COLOR = "#3949ab"; // --tone-track
// цвет трека на карте и в списке — на выбор (без оранжевого: он у выбранного куска)
export const COLORS = [COLOR, "#1e88e5", "#00897b", "#43a047", "#f9a825", "#e53935", "#d81b60", "#8e24aa", "#6d4c41"];

// ---------- разбор файла ----------
// трек: { id, name, date, segs: [[[lon, lat, ele|null, t|null], …], …] } — куски записи (паузы) — отдельно
function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("файл не читается");
  const num = (el, tag) => { const x = el.getElementsByTagName(tag)[0]?.textContent; return x != null && x !== "" ? Number(x) : null; };
  const pt = (el) => {
    const t = el.getElementsByTagName("time")[0]?.textContent;
    return [Number(el.getAttribute("lon")), Number(el.getAttribute("lat")), num(el, "ele"), t ? Date.parse(t) : null];
  };
  const segs = [...doc.getElementsByTagName("trkseg")].map((s) => [...s.getElementsByTagName("trkpt")].map(pt));
  // маршрут (rte) — тоже линия, обычно без времени
  for (const r of doc.getElementsByTagName("rte")) segs.push([...r.getElementsByTagName("rtept")].map(pt));
  const name = doc.querySelector("metadata > name, trk > name, rte > name")?.textContent.trim() || "";
  const note = doc.querySelector("trk > desc, metadata > desc")?.textContent.trim() || "";
  const creator = doc.documentElement.getAttribute("creator") || "";
  const color = doc.getElementsByTagNameNS("*", "color")[0]?.textContent.trim();
  return { name, note, segs, kind: kindFromFile(doc.querySelector("trk > type")?.textContent) || (/ski/i.test(creator) ? "ski" : null), ...(COLORS.includes(color) && { color }) };
}

function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("файл не читается");
  const segs = [];
  // gx:Track — точки со временем (так пишет Google)
  for (const tr of doc.getElementsByTagNameNS("*", "Track")) {
    const when = [...tr.getElementsByTagNameNS("*", "when")].map((w) => Date.parse(w.textContent));
    const coords = [...tr.getElementsByTagNameNS("*", "coord")].map((c) => c.textContent.trim().split(/\s+/).map(Number));
    segs.push(coords.map(([lon, lat, ele], i) => [lon, lat, Number.isFinite(ele) ? ele : null, when[i] || null]));
  }
  for (const ls of doc.getElementsByTagName("LineString")) {
    const c = ls.getElementsByTagName("coordinates")[0]?.textContent.trim() || "";
    segs.push(c.split(/\s+/).map((x) => x.split(",").map(Number)).map(([lon, lat, ele]) => [lon, lat, Number.isFinite(ele) ? ele : null, null]));
  }
  const name = doc.querySelector("Document > name, Placemark > name")?.textContent.trim() || "";
  return { name, segs };
}

export function parseFile(name, text) {
  const t = /\.kml$/i.test(name) ? parseKml(text) : parseGpx(text);
  const segs = t.segs.map((s) => s.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).filter((s) => s.length > 1);
  if (!segs.length) throw new Error("в файле нет трека");
  const first = segs[0][0][3];
  return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: t.name || name.replace(/\.\w+$/, ""),
    file: name, date: first || null, kind: t.kind || null, ...(t.note && { note: t.note }), ...(t.color && { color: t.color }), segs };
}

// ---------- подсчёт ----------
const R = 6371008.8;
export function meters(a, b) {
  const rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
export const MOVING = 0.3; // м/с — медленнее считается стоянкой (около 1 км/ч)
export const PAUSE = 5 * 60 * 1000; // перерыв в записи дольше 5 минут — не время в пути
// путь между точками — с перепадом высот (Грегори, 2026-11-02: «при расчётах скорости учитывать перепад
// высот, особенно на горных лыжах — использовать как универсальный»): по склону путь длиннее, чем по
// карте; на его лыжных днях +3–5 % расстояния и +1–2 км/ч наибольшей скорости, на кайте по воде — почти
// ничего. Высота сглажена по 5 соседним точкам, иначе дрожание высоты GPS прибавляет путь на ровном месте
function smoothEle(seg) {
  // окно поровну с обеих сторон (у концов — уже), чтобы ровный склон не сглаживался в пологий
  return seg.map((_, i) => {
    const k = Math.min(2, i, seg.length - 1 - i);
    const w = seg.slice(i - k, i + k + 1).map((p) => p[2]).filter((e) => e != null);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
}
const along = (a, b, ea, eb) => (ea != null && eb != null ? Math.hypot(meters(a, b), eb - ea) : meters(a, b));

// м — высота меняется хотя бы на столько, иначе это шум GPS (4 м — набор как у Sports Tracker)
const CLIMB = 4;
export function climb(eles) {
  let ref = null, up = 0, down = 0;
  for (const e of eles) {
    if (e == null) continue;
    if (ref == null) ref = e;
    else if (e - ref >= CLIMB) { up += e - ref; ref = e; }
    else if (ref - e >= CLIMB) { down += ref - e; ref = e; }
  }
  return [up, down];
}
export function stats(t) {
  let dist = 0, moving = 0, up = 0, down = 0, maxEle = -Infinity, minEle = Infinity, maxSpeed = 0;
  const profile = []; // [расстояние от начала, высота, скорость км/ч, точка]
  for (const seg of t.segs) {
    const [u, d] = climb(seg.map((p) => p[2]));
    up += u;
    down += d;
    const se = smoothEle(seg);
    seg.forEach((p, i) => {
      let speed = null;
      if (i) {
        const q = seg[i - 1], d = along(q, p, se[i - 1], se[i]);
        dist += d;
        if (p[3] && q[3]) {
          const dt = p[3] - q[3];
          if (dt > 0 && dt < PAUSE && d / (dt / 1000) > MOVING) moving += dt;
          if (dt > 0) speed = (d / (dt / 1000)) * 3.6;
        }
      }
      if (p[2] != null) {
        maxEle = Math.max(maxEle, p[2]);
        minEle = Math.min(minEle, p[2]);
      }
      profile.push([dist, p[2], speed, p]);
    });
  }
  // скорость на графике — сглаженная (среднее по соседним 7 точкам): у GPS скачки
  const sm = profile.map((x, i) => {
    const w = profile.slice(Math.max(0, i - 3), i + 4).map((y) => y[2]).filter((v) => v != null);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
  profile.forEach((x, i) => { x[2] = sm[i]; if (sm[i] != null) maxSpeed = Math.max(maxSpeed, sm[i]); });
  const all = t.segs.flat(), times = all.map((p) => p[3]).filter(Boolean);
  const total = times.length > 1 ? times[times.length - 1] - times[0] : 0;
  return { dist, total, moving, up, down, maxSpeed, points: all.length,
    maxEle: Number.isFinite(maxEle) ? maxEle : null, minEle: Number.isFinite(minEle) ? minEle : null, profile };
}

export const dec = (v, n) => v.toFixed(n).replace(".", ","); // по-русски — запятая
export const km = (m) => (m >= 10000 ? `${dec(m / 1000, 1)} км` : m >= 1000 ? `${dec(m / 1000, 2)} км` : `${Math.round(m)} м`);
export const hm = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, "0")} мин` : `${m} мин`; };
export const day = (t) => (t ? new Date(t).toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric" }) : "");
export const clock = (t) => (t ? new Date(t).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }) : "");

// вид занятия по слову из файла (trk > type) — его понимают и другие программы
export function kindFromFile(type) {
  const s = (type || "").toLowerCase();
  return /kite/.test(s) ? "kite" : /surf|sup|paddle/.test(s) ? "surf" : /cycl|bik|ride/.test(s) ? "bike" : /run/.test(s) ? "run"
    : /hik/.test(s) ? "hike" : /walk/.test(s) ? "walk" : /cross|nordic|xc/.test(s) && /ski/.test(s) ? "xc" : /ski|snowboard/.test(s) ? "ski"
    : /boat|sail|row|kayak|canoe/.test(s) ? "boat" : /driv|car/.test(s) ? "car" : null;
}

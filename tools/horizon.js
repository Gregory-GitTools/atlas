// Поиск линии горизонта (из photo-editor, vision.js): OpenCV.js — края (Canny), отрезки (Hough),
// почти горизонтальные отрезки собираются в линии по углу и по высоте в кадре; горизонт — самая
// верхняя длинная и ровная линия (над горизонтом обычно только небо, берег и волны — ниже).
// OpenCV.js (~10 МБ) грузится при первом нажатии «Горизонт», а не при открытии галереи

const OPENCV = "https://docs.opencv.org/4.9.0/opencv.js";
export const MAX_TILT = 5; // ° — горизонт заваливают редко сильнее: больше — значит, нашли не его

let loading = null;
// cv успевает проснуться раньше, чем на него вешают onRuntimeInitialized (опыт photo-editor) —
// готовность проверяется опросом. Сам cv обещанием не отдаётся: у него есть then, и обещание,
// получив его, зовёт then снова и снова — страница падала (проверено на снимках Грегори)
export function opencv() {
  if (window.cv && typeof window.cv.Mat === "function") return Promise.resolve(); // уже загружена
  loading ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { src: OPENCV, async: true });
    s.onerror = () => { loading = null; reject(new Error("не загрузилась программа поиска горизонта — проверьте интернет")); };
    document.head.append(s);
    const t0 = Date.now();
    const poll = () => {
      if (window.cv && typeof window.cv.Mat === "function") resolve();
      else if (Date.now() - t0 > 60000) { loading = null; reject(new Error("программа поиска горизонта не запустилась")); }
      else setTimeout(poll, 100);
    };
    poll();
  });
  return loading;
}

// canvas — уменьшенная копия снимка; ответ — угол линии (° в координатах снимка, y вниз) или null
export async function findHorizon(canvas) {
  await opencv();
  const cv = window.cv;
  const W = canvas.width, H = canvas.height;
  const src = cv.imread(canvas), gray = new cv.Mat(), edges = new cv.Mat(), lines = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.Canny(gray, edges, 60, 160);
  // разрыв в отрезке — до 30 точек: настоящий берег или кромка леса редко идеально ровные
  cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 60, W * 0.15, 30);
  let flat = [];
  for (let i = 0; i < lines.rows; i++) {
    const [x1, y1, x2, y2] = lines.data32S.subarray(i * 4, i * 4 + 4);
    const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    if (Math.min(Math.abs(deg), Math.abs(deg - 180), Math.abs(deg + 180)) >= 20) continue;
    const angle = deg > 90 ? deg - 180 : deg < -90 ? deg + 180 : deg;
    const xc = (x1 + x2) / 2, yc = (y1 + y2) / 2;
    // где линия пересекла бы середину кадра — высота, не зависящая от того, где лежит отрезок
    flat.push({ angle, len: Math.hypot(x2 - x1, y2 - y1), yc, at: yc - Math.tan((angle * Math.PI) / 180) * (xc - W / 2) });
  }
  src.delete(); gray.delete(); edges.delete(); lines.delete();
  // параллельные линии разной высоты (горизонт, берег, рябь) — разные кластеры: по углу И высоте
  const clusters = [];
  for (let iter = 0; iter < 8 && flat.length; iter++) {
    let best = null;
    for (let a = -20; a <= 20; a += 0.5) for (let y = 0; y <= H; y += H * 0.02) {
      const m = flat.filter((h) => Math.abs(h.angle - a) < 1.5 && Math.abs(h.at - y) < H * 0.04);
      const len = m.reduce((s, h) => s + h.len, 0);
      if (m.length && (!best || len > best.len)) best = { len, m };
    }
    if (!best || best.len < W * 0.15) break;
    const mean = best.m.reduce((s, h) => s + h.angle * h.len, 0) / best.len;
    const meanY = best.m.reduce((s, h) => s + h.yc * h.len, 0) / best.len;
    const std = Math.sqrt(best.m.reduce((s, h) => s + h.len * (h.angle - mean) ** 2, 0) / best.len);
    clusters.push({ angle: mean, len: best.len, std, meanY });
    const used = new Set(best.m);
    flat = flat.filter((h) => !used.has(h));
  }
  const sure = clusters.filter((c) => c.std < 1.5 && c.len >= W * 0.25).sort((a, b) => a.meanY - b.meanY);
  return sure.length ? sure[0].angle : null;
}

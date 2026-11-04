// Цвет (из photo-editor): Оригинал, Авто, Контраст+, Ч/Б, Тепло. Автоконтраст — по каждому каналу
// отдельно: края гистограммы (доля точек clip) растягиваются на весь диапазон; насыщенность —
// от серого; тепло — красный выше, синий ниже. Гистограмма — по всему кадру (photo-editor: иначе
// тугая рамка меняла бы цвет). По умолчанию — «Оригинал»: экран совпадает с файлом
import { variantsTool } from "./variants.js";

const LIST = [
  { key: "original", label: "Оригинал", clip: 0, sat: 1, warm: 0 },
  { key: "auto", label: "Авто", clip: 0.005, sat: 1.15, warm: 0 },
  { key: "contrast", label: "Контраст+", clip: 0.02, sat: 1.15, warm: 0 },
  { key: "bw", label: "Ч/Б", clip: 0.005, sat: 0, warm: 0 },
  { key: "warm", label: "Тепло", clip: 0.005, sat: 1.15, warm: 12 },
];

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
export function colorize(canvas, key) {
  const v = LIST.find((x) => x.key === key);
  if (!v || key === "original") return;
  const x = canvas.getContext("2d"), img = x.getImageData(0, 0, canvas.width, canvas.height), d = img.data, n = d.length / 4;
  if (v.clip > 0) for (const ch of [0, 1, 2]) {
    const hist = new Uint32Array(256);
    for (let i = ch; i < d.length; i += 4) hist[d[i]]++;
    const cut = Math.max(1, Math.floor(n * v.clip));
    let lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += hist[lo]) < cut) lo++;
    acc = 0;
    while (hi > 0 && (acc += hist[hi]) < cut) hi--;
    if (hi <= lo) continue;
    const k = 255 / (hi - lo);
    for (let i = ch; i < d.length; i += 4) d[i] = clamp((d[i] - lo) * k);
  }
  if (v.sat !== 1 || v.warm) for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], gray = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = clamp(gray + (r - gray) * v.sat + v.warm);
    d[i + 1] = clamp(gray + (g - gray) * v.sat);
    d[i + 2] = clamp(gray + (b - gray) * v.sat - v.warm);
  }
  x.putImageData(img, 0, 0);
}

export default (ed) => variantsTool(ed, {
  key: "color", title: "Цвет", order: 20, off: "original", list: LIST, apply: (c, key) => colorize(c, key),
  icon: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>',
});

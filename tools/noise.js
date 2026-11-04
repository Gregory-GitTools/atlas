// Шумоподавление (из photo-editor): Выкл, Лёгкое, Среднее, Сильное — сглаживание, которое бережёт
// края (bilateralFilter из OpenCV.js; fastNlMeans в сборке docs.opencv.org нет — проверено в
// photo-editor). Идёт раньше цвета. OpenCV грузится при первом выборе (как у горизонта). На
// маленьких плитках окрестность меньше — иначе плитка «Сильное» размылась бы в кашу
import { variantsTool } from "./variants.js";
import { opencv } from "./horizon.js";

const LIST = [
  { key: "off", label: "Выкл", d: 0, color: 0, space: 0 },
  { key: "light", label: "Лёгкое", d: 5, color: 40, space: 40 },
  { key: "medium", label: "Среднее", d: 9, color: 75, space: 75 },
  { key: "strong", label: "Сильное", d: 15, color: 120, space: 120 },
];

export async function denoise(canvas, key, k = 1) {
  const v = LIST.find((x) => x.key === key);
  if (!v?.d) return;
  await opencv();
  const cv = window.cv, d = Math.max(3, Math.round(v.d * Math.min(1, k * 2))) | 1;
  const src = cv.imread(canvas), rgb = new cv.Mat(), dst = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  cv.bilateralFilter(rgb, dst, d, v.color, v.space * Math.min(1, k * 2), cv.BORDER_DEFAULT);
  cv.cvtColor(dst, src, cv.COLOR_RGB2RGBA);
  cv.imshow(canvas, src);
  src.delete(); rgb.delete(); dst.delete();
}

export default (ed) => variantsTool(ed, {
  key: "noise", title: "Шумоподавление", order: 10, off: "off", list: LIST, apply: (c, key, k) => denoise(c, key, k),
  icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="5" cy="6" r="1.3"/><circle cx="9" cy="4" r="1.1"/><circle cx="4" cy="10.5" r="1"/><circle cx="8" cy="9" r="1.4"/><circle cx="5.5" cy="14.5" r="1.2"/><circle cx="3.5" cy="18.5" r="1"/><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6z" opacity=".9"/></svg>',
});

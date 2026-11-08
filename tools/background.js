// Фон (ИИ, 2026-11-08): нейросеть RMBG-1.4 (BRIA, лицензия — только некоммерческая; канал Грегори не
// монетизируется) отделяет главное от фона, плитки — что сделать с фоном: размыть (как «портрет»
// телефона), белый, чёрный, Ч/Б при цветном главном, прозрачный (у JPEG сохраняется PNG рядом —
// «… без фона.png»). Маска считается один раз на снимок (и поворот на 90°) по превью — модель всё
// равно смотрит на 1024 × 1024 — и растягивается на любой размер: плитки, превью, сохранение.
// transformers.js и модели — с CDN при первом выборе (≈ 45 МБ, дальше — из кэша браузера)
import { variantsTool } from "./variants.js";

const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js";
const LIST = [
  { key: "keep", label: "Как есть" },
  { key: "blur", label: "Размыть" },
  { key: "white", label: "Белый" },
  { key: "black", label: "Чёрный" },
  { key: "gray", label: "Ч/Б фон" },
  { key: "cut", label: "Прозрачный" },
];

// transformers.js — общий для ИИ-инструментов (фон, 3D); не загрузился — в следующий раз заново
let lib = null;
export const transformers = () => (lib ??= import(LIB).catch(() => { lib = null; throw new Error("нейросеть не загрузилась — нужен интернет"); }));
// ход загрузки модели — в строку подсказки
export const progress = (say, what) => (p) => {
  if (p.status === "progress" && p.total > 1e6) say(`${what}: загружаю нейросеть — ${Math.round(p.loaded / 1048576)} из ${Math.round(p.total / 1048576)} МБ (один раз)`);
};

let rmbg = null;
const model = (say) => (rmbg ??= transformers().then(async (T) => {
  const on = progress(say, "Фон");
  const [net, proc] = await Promise.all([
    T.AutoModel.from_pretrained("briaai/RMBG-1.4", { config: { model_type: "custom" }, dtype: "q8", progress_callback: on }),
    // в репозитории модели настройки для Python — свои, по её карточке
    T.AutoProcessor.from_pretrained("briaai/RMBG-1.4", { config: { do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, image_mean: [0.5, 0.5, 0.5],
      feature_extractor_type: "ImageFeatureExtractor", image_std: [1, 1, 1], resample: 2, rescale_factor: 1 / 255, size: { width: 1024, height: 1024 } } }),
  ]);
  return { T, net, proc };
}).catch((err) => { rmbg = null; throw err; }));

// маска (белое с прозрачностью фона) в размер превью — одна на снимок и поворот
let cache = null;
function maskOf(ed) {
  const s = ed.state, key = [s.p?.id, s.q, s.flip].join("|");
  if (cache?.key === key) return cache.mask;
  const mask = (async () => {
    const { T, net, proc } = await model(ed.say);
    ed.say("Фон: нейросеть ищет главное…");
    const pv = s.pv, w = pv.width, h = pv.height;
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
    c.getContext("2d").drawImage(pv, 0, 0);
    const { pixel_values } = await proc(T.RawImage.fromCanvas(c));
    const { output } = await net({ input: pixel_values });
    const m = await T.RawImage.fromTensor(output[0].mul(255).to("uint8")).resize(w, h);
    const x = c.getContext("2d"), img = x.createImageData(w, h), d = img.data;
    for (let i = 0; i < w * h; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = m.data[i * m.channels]; }
    x.putImageData(img, 0, 0);
    ed.say("");
    return c;
  })();
  cache = { key, mask };
  mask.catch(() => { if (cache?.mask === mask) cache = null; });
  return mask;
}

export async function background(ed, canvas, key) {
  const mask = await maskOf(ed), w = canvas.width, h = canvas.height;
  // главное — вырезано по маске
  const fg = Object.assign(document.createElement("canvas"), { width: w, height: h }), fx = fg.getContext("2d");
  fx.drawImage(canvas, 0, 0);
  fx.globalCompositeOperation = "destination-in";
  fx.drawImage(mask, 0, 0, w, h);
  const x = canvas.getContext("2d");
  if (key === "blur") {
    // размытие — уменьшить и растянуть обратно (у фильтра blur края снимка тают в прозрачность)
    const k = Math.max(1, Math.round(Math.max(w, h) / 90));
    const small = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(w / k)), height: Math.max(1, Math.round(h / k)) });
    const sx = small.getContext("2d");
    sx.imageSmoothingQuality = "high";
    sx.drawImage(canvas, 0, 0, small.width, small.height);
    x.imageSmoothingQuality = "high";
    x.drawImage(small, 0, 0, w, h);
  } else if (key === "gray") {
    const copy = Object.assign(document.createElement("canvas"), { width: w, height: h });
    copy.getContext("2d").drawImage(canvas, 0, 0);
    x.filter = "grayscale(1)";
    x.drawImage(copy, 0, 0);
    x.filter = "none";
  } else if (key === "white" || key === "black") {
    x.fillStyle = key === "white" ? "#fff" : "#000";
    x.fillRect(0, 0, w, h);
  } else x.clearRect(0, 0, w, h);
  x.drawImage(fg, 0, 0);
}

export default (ed) => variantsTool(ed, {
  key: "bg", title: "Фон — нейросеть отделяет главное: размыть, заменить, убрать", order: 30, off: "keep", list: LIST,
  apply: (c, key) => background(ed, c, key), clear: (v) => v === "cut",
  icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 5a2 2 0 0 1 2-2h3v2H5v3H3zm13-2h3a2 2 0 0 1 2 2v3h-2V5h-3zM3 16h2v3h3v2H5a2 2 0 0 1-2-2zm16 0h2v3a2 2 0 0 1-2 2h-3v-2h3zM12 6.5a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zM7 17.5c0-2.2 2.2-4 5-4s5 1.8 5 4v.5H7z"/></svg>',
});

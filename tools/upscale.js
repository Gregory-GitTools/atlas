// Увеличение ×2 нейросетью (из photo-editor: UpscalerJS, модель ESRGAN-slim на tf.js; всё — с CDN
// при первом сохранении с ним, считается в браузере). Кнопка включает, делается при сохранении — по
// готовому кадру (после поворота, перспективы и рамки). Снимок режется на куски по 256 точек с полями
// 16 (швов не видно): photo-editor отдавал снимок целиком, и результат 12-мегапиксельного снимка — это
// полгигабайта памяти. Модель отдаёт точки 0–255, а toPixels ждёт 0–1 — без деления на 255 он падал,
// и увеличение молча не получалось (исправлено в photo-editor 2026-11-02)
const LIBS = [
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js",
  "https://cdn.jsdelivr.net/npm/@upscalerjs/default-model@1.0.0/dist/umd/index.min.js",
  "https://cdn.jsdelivr.net/npm/upscaler@1.0.0/dist/browser/umd/upscaler.min.js",
];
const MAX = 16384; // больше холст в браузере не бывает
const TILE = 256, PAD = 16;

let loading = null;
const script = (src) => new Promise((ok, fail) => document.head.append(Object.assign(document.createElement("script"),
  { src, onload: ok, onerror: () => fail(new Error("нейросеть не загрузилась — нужен интернет")) })));
const upscaler = () => (loading ??= (async () => {
  for (const src of LIBS) await script(src);
  return new window.Upscaler({ model: window.DefaultUpscalerJSModel });
})().catch((err) => { loading = null; throw err; }));

// холст → холст вдвое больше; progress(0…1)
export async function upscale(src, progress = () => {}) {
  const W = src.width, H = src.height;
  if (W * 2 > MAX || H * 2 > MAX) throw new Error(`снимок ${W} × ${H} слишком большой для ×2 (вдвое — больше ${MAX} точек)`);
  const up = await upscaler(), tf = window.tf;
  const out = Object.assign(document.createElement("canvas"), { width: W * 2, height: H * 2 });
  const ox = out.getContext("2d");
  const total = Math.ceil(W / TILE) * Math.ceil(H / TILE);
  let done = 0;
  for (let y = 0; y < H; y += TILE) {
    for (let x = 0; x < W; x += TILE) {
      const x0 = Math.max(0, x - PAD), y0 = Math.max(0, y - PAD), x1 = Math.min(W, x + TILE + PAD), y1 = Math.min(H, y + TILE + PAD);
      const tile = Object.assign(document.createElement("canvas"), { width: x1 - x0, height: y1 - y0 });
      tile.getContext("2d").drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
      const raw = await up.upscale(tile, { output: "tensor" });
      const norm = tf.tidy(() => raw.div(255).clipByValue(0, 1));
      const big = Object.assign(document.createElement("canvas"), { width: raw.shape[1], height: raw.shape[0] });
      await tf.browser.toPixels(norm, big);
      norm.dispose();
      raw.dispose();
      const w = Math.min(TILE, W - x), h = Math.min(TILE, H - y);
      ox.drawImage(big, (x - x0) * 2, (y - y0) * 2, w * 2, h * 2, x * 2, y * 2, w * 2, h * 2);
      progress(++done / total);
    }
  }
  // прозрачность (фон убран) нейросеть не видит — с исходника, вдвое
  ox.globalCompositeOperation = "destination-in";
  ox.drawImage(src, 0, 0, W * 2, H * 2);
  return out;
}

export default function upscaleTool(ed) {
  const el = Object.assign(document.createElement("div"), { className: "edit-group" });
  // включено — для этого снимка: открыли другой — выключено
  let forP = null;
  const on = () => !!forP && forP === ed.state.p;
  const toggle = ed.button(ed.svg("M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z"), "Увеличить ×2 нейросетью — при сохранении", () => {
    forP = on() ? null : ed.state.p;
    ed.say(on() ? "×2 — при сохранении (нейросеть; большой снимок — минуты)" : "");
    ed.sync();
  });
  el.append(toggle);
  ed.finish({
    on,
    run: (c) => {
      ed.say("Сохраняю: увеличение ×2 — загружаю нейросеть…");
      return upscale(c, (k) => ed.say(`Сохраняю: увеличение ×2 — ${Math.round(k * 100)}%`));
    },
  });
  return {
    el,
    sync: (s) => {
      if (!s.p) forP = null; // правка закрыта (сохранили или вышли) — выключено
      toggle.classList.toggle("on", on());
    },
  };
}

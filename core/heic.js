// HEIC/HEIF — снимки iPhone (Грегори, план «Фото»: «HEIC с iPhone»). Safari показывает их сам, Chrome и Edge —
// нет: тогда декодер libheif (heic-to 1.6.7, LGPL, ~3 МБ, работает в своём фоновом потоке) грузится с jsdelivr
// при первом таком снимке; дальше он в кэше сервис-воркера (библиотека с номером версии) — есть и без сети.
// Поворот снимка (irot/imir) libheif применяет сам — картинка выходит как на телефоне.
export const HEIC_RE = /\.(heic|heif)$/i;

let lib = null;
const decoder = () => (lib ??= import("https://cdn.jsdelivr.net/npm/heic-to@1.6.7/dist/heic-to.js")
  .catch((err) => { lib = null; throw err; }));

// браузер умеет сам? (Safari — да) — пробуется один раз
let native = null;
async function nativeOk(blob) {
  if (native !== null) return native;
  try { (await createImageBitmap(blob)).close(); native = true; } catch { native = false; }
  return native;
}

// картинка снимка (opts — как у createImageBitmap: resizeWidth и т. п.)
export async function heicBitmap(blob, opts) {
  if (await nativeOk(blob)) return createImageBitmap(blob, opts);
  const { heicTo } = await decoder();
  const bmp = await heicTo({ blob, type: "bitmap" });
  if (!opts) return bmp;
  try { return await createImageBitmap(bmp, opts); } finally { bmp.close(); }
}

// файл, который покажет <img>: сам снимок, если браузер умеет, иначе копия JPEG (только в памяти)
export async function heicViewable(blob) {
  if (await nativeOk(blob)) return blob;
  const { heicTo } = await decoder();
  return heicTo({ blob, type: "image/jpeg", quality: 0.92 });
}

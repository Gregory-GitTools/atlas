// Место и дата снимка или ролика — для «Моих альбомов» (content/albums.js), помнятся на устройстве (storage).
// Снимок — EXIF (программа exifr), ролик — оглавление moov, снимок телефона — галерея и приложение Android
import { cacheGet, cacheSet } from "../core/storage.js";

// unpkg не ответил — та же версия с jsdelivr (Грегори 2026-11-24: «альбом не загружается» — без программы
// обход стоял, список пустой)
let exifrLoad = null;
export const exifr = () => (exifrLoad ??= import("https://unpkg.com/exifr@7.1.3/dist/full.esm.mjs")
  .catch(() => import("https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs"))
  .then((m) => m.default || m).catch((err) => { exifrLoad = null; throw err; }));
const OPTS = { tiff: true, exif: true, gps: true, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false, translateValues: false };

// снимок или ролик → { lat, lon, date, tz }; skipExif — программа чтения не загрузилась: без места, в память не пишем
export async function readMeta(p, skipExif) {
  let key = p.key, file = null;
  // снимок телефона: дата — из галереи (настоящее время), место — EXIF через приложение; «-» — место не
  // разрешено: без места и не запоминаем (разрешат — прочитается)
  if (p.phone) {
    const hit = await cacheGet(key).catch(() => null);
    if (hit) return hit;
    let ll = "";
    try { ll = AtlasPhotos.place(p.phone); } catch { /* старое приложение */ }
    const [lat, lon] = ll.split(",").map(Number), rec = { ...(p.at ? { date: p.at } : {}), ...(ll.includes(",") ? { lat, lon } : {}) };
    if (ll !== "-") cacheSet(key, rec).catch(() => {});
    return rec;
  }
  try {
    if (p.handle) { file = await p.handle.getFile(); key = `exif/local/${p.path}|${file.size}|${file.lastModified}`; }
    const hit = await cacheGet(key).catch(() => null);
    if (hit) return hit;
    if (p.video) {
      const rec = file ? await movMeta(file).catch(() => ({})) : {};
      cacheSet(key, rec).catch(() => {});
      return rec;
    }
    // у снимка из репозитория EXIF — в начале файла: хватает первых 128 КБ
    const src = file || await fetch(p.url, { headers: { Range: "bytes=0-131071" } }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))));
    const lib = await (skipExif ? Promise.reject(new Error("exifr")) : exifr()); // не загрузилась — снимок без места, но в память не пишем: прочитается при «Повторить»
    const rec = {};
    try {
      const e = await lib.parse(src, OPTS);
      if (Number.isFinite(e?.latitude) && Number.isFinite(e?.longitude) && (e.latitude || e.longitude)) Object.assign(rec, { lat: e.latitude, lon: e.longitude });
      // у уменьшенных копий в «Альбомах» остаётся только дата сохранения (DateTime) — тоже годится
      const d = [e?.DateTimeOriginal, e?.CreateDate, e?.ModifyDate].find((x) => x instanceof Date);
      if (d) rec.date = d.getTime();
      // часовой пояс съёмки («+03:00») — снимок встаёт на трек точно по времени (фото на треке)
      const tz = /^([+-])(\d\d):?(\d\d)$/.exec(String(e?.OffsetTimeOriginal || e?.OffsetTime || "").trim());
      if (d && tz) rec.tz = (tz[1] === "-" ? -1 : 1) * (Number(tz[2]) * 60 + Number(tz[3]));
    } catch { /* без EXIF */ }
    cacheSet(key, rec).catch(() => {});
    return rec;
  } catch {
    // файл не прочитался (нет сети, облачная заглушка) — без координат, но и в память не пишем
    return {};
  }
}

// дата и место ролика — из его оглавления (атом moov, QuickTime/MP4), сам ролик не читается: дата —
// com.apple.quicktime.creationdate (местное время, как у снимков), иначе mvhd (секунды с 1904 года);
// место — строка ISO 6709 «+59.4370+024.7536+012.000/» (iPhone, Android)
async function movMeta(file) {
  const bytes = async (o, n) => new Uint8Array(await file.slice(o, o + n).arrayBuffer());
  let o = 0, moov = null;
  while (o + 8 <= file.size) {
    const b = await bytes(o, 16), v = new DataView(b.buffer);
    let size = v.getUint32(0);
    const type = String.fromCharCode(...b.subarray(4, 8));
    if (size === 1) size = Number(v.getBigUint64(8)); else if (size === 0) size = file.size - o;
    if (size < 8) break;
    if (type === "moov") { moov = await bytes(o, Math.min(size, 16 << 20)); break; }
    o += size;
  }
  const rec = {};
  if (!moov) return rec;
  const text = new TextDecoder("latin1").decode(moov);
  const local = text.match(/(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)[+-]\d{2}:?\d{2}/);
  const i = text.indexOf("mvhd");
  if (local) rec.date = new Date(local[1]).getTime();
  else if (i > 0) {
    const v = new DataView(moov.buffer);
    const t = moov[i + 4] === 1 ? Number(v.getBigUint64(i + 8)) : v.getUint32(i + 8);
    if (t > 0) rec.date = (t - 2082844800) * 1000;
  }
  const at = text.match(/([+-]\d{2}\.\d{3,})([+-]\d{3}\.\d{3,})/);
  if (at && (+at[1] || +at[2])) Object.assign(rec, { lat: +at[1], lon: +at[2] });
  return rec;
}

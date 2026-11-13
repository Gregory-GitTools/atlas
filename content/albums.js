// Мои альбомы (перенос из travel-earth, Грегори 2026-10-29). Альбом — папка со снимками: папки
// «Альбомы» репозитория travel-earth (видны всем, на любом устройстве) и, на компьютере, своя папка,
// выбранная в настройках (доступ к ней хранится только в этом браузере, снимки никуда не уходят).
// В барабане — кнопка «Мои альбомы», в её столбике — страны с флагами; страна — панель слева со
// списком её альбомов, альбом — в той же панели: даты, снимки сеткой, «Смотреть» — галерея.
// Пока панель открыта, на карте: альбом — фиолетовый фотоаппарат (издалека), ближе — точки снимков
// (налезающие — кружок с числом), с «1 км» — миниатюры; снимки в кадре — в общей ленте внизу,
// двойной щелчок — альбом в галерее с этого снимка. Координаты и дата — из EXIF (exifr, грузится
// при первом открытии), прочитанное помнится на устройстве. Точка альбома — самый многолюдный «куст»
// снимков, а не первый снимок (опыт travel-earth: первым часто снят аэропорт вылета), обложка —
// случайный снимок из него. Страна — по границам стран без сети (core/borders.js).
// Видео и живые фото (как в travel-earth, Грегори 2026-11-02): ролик (.mov/.mp4) — своей клеткой со
// значком ▶; живое фото iPhone — снимок и ролик с одним именем (IMG_1234.JPG + IMG_1234.MOV) — одна
// клетка со значком LIVE, ролик оживает в галерее. Дубликаты (2026-11-08) — одинаковые и похожие снимки в
// своих папках, лишние копии — в папку «[Повторы]»
import { register, isMobile } from "../core/modules.js";
import { trackIcon } from "../core/icons.js";
import { createPanel, isOpen, homeList } from "../core/panel.js";
import { repoFiles, repoUrl } from "../core/repo.js";
import { flagUrl } from "../core/flags.js";
import { countryAt } from "../core/borders.js";
import { emit, on } from "../core/events.js";
import { parseFile } from "./tracks.js";
import { setSearchMode, searchMode } from "../core/search.js";
import { cacheGet, cacheSet, cacheDelete } from "../core/storage.js";
import { track, claimLayers } from "../core/popups.js";
import { setStripItems, selectStripItem, openGalleryWith, touchUI } from "../core/photo-strip.js";
import { PLAYER } from "../core/player.js";

const svg = (d, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`;
const STACK_D = "M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4 2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z";
const CAMERA_D = "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z";
const ICON = svg(STACK_D);
// строка «Открыть папку…» в списке — тот же плюс, что «Открыть файл…» у треков
const OPEN_ICON = svg("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z");
const FOLDER_ICON = svg("M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z");
const BACK = svg("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z", 20);
const COLOR = "#7c4dff"; // --tone-my
const VIDEO_RE = /\.(mov|mp4|m4v)$/i;
const MEDIA_RE = /\.(jpe?g|webp|png|mov|mp4|m4v)$/i;
// трек поездки лежит с её снимками (Грегори 2026-11-08: «сканировать папку с фото на наличие .GPX и
// хранить их с фотографиями»; папка может быть и только с треком) — на карте линией, в шапке альбома —
// «Просмотр трека» (открывает «Мои треки», стрелка оттуда — назад в альбом)
const TRACK_RE = /\.gpx$/i;
const TRACK_D = "M6 3a3 3 0 0 0-1 5.83V12a4 4 0 0 0 4 4h6a2 2 0 0 1 2 2v.17A3 3 0 1 0 19 18a4 4 0 0 0-4-4H9a2 2 0 0 1-2-2V8.83A3 3 0 0 0 6 3zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm12 12a1 1 0 1 1 0 2 1 1 0 0 1 0-2z";
const TRACK_COLOR = "#3949ab"; // --tone-track
const PROBE = 25; // сколько снимков альбома пробовать в поисках координат на первом проходе
const DOT_ZOOM = 10, THUMB_ZOOM = 14, VIEW_ZOOM = 12; // точки снимков, миниатюры, миниатюры для ленты
const THUMB = 240, MAP_THUMB = 88; // миниатюра ленты и сетки; на карте — 44 px в белой рамке
const NO_COUNTRY = "Без страны";

// название напоказ — без даты-префикса, скобок и пометки «-Albom» (сама папка не меняется;
// Грегори в travel-earth: «маску на все цифры в начале», «на убирание скобок», «фильтровать -Albom»)
const displayName = (name) => name
  .replace(/^(?:\d+[\s_-]+)+/, "")
  .replace(/\s*\([^()]*\)/g, "")
  .replace(/[\s_–—-]*albom[\s_–—-]*$/i, "")
  .replace(/\s{2,}/g, " ")
  .trim() || name;
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
function dates(a) {
  if (!a.from) return "";
  const f = new Date(a.from), t = new Date(a.to);
  const day = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (f.toDateString() === t.toDateString()) return `${day(f)} ${f.getFullYear()}`;
  if (f.getFullYear() !== t.getFullYear()) return `${day(f)} ${f.getFullYear()} — ${day(t)} ${t.getFullYear()}`;
  if (f.getMonth() === t.getMonth()) return `${f.getDate()}–${day(t)} ${t.getFullYear()}`;
  return `${day(f)} — ${day(t)} ${t.getFullYear()}`;
}
const photoDate = (p) => (p.rec?.date ? new Date(p.rec.date).toLocaleDateString("ru") : "");

// ---------- данные ----------
const albums = new Map(); // путь папки → { id, name, title, local, parent, photos, point, country, cover, from, to, done }
const groups = new Map(); // путь папки-поездки → { id, name, title, local, parent, group: true }
// номер снимка — по пути к файлу (своя папка — по её месту в списке): после нового обхода папок он тот
// же, и открытая галерея не теряет свои снимки
const photos = new Map(); // "album/0:Фото/Рига/r.jpg" → { id, album, name, path, url | handle, key, rec, thumb, img, video, live: файл ролика }
let scan = 0, ctx = null, loading = null;
// свои папки со снимками (Грегори 2026-11-03: «+ Добавить папку») — доступ к каждой в IndexedDB albums/dirs
let dirs = [], needsAccess = false, busy = false, checked = 0;
const canFolders = () => "showDirectoryPicker" in window && !isMobile();

function addAlbum(path, name, local, files, tracks = []) {
  const a = { id: path, name, title: displayName(name), local, parent: null, photos: [], point: null, country: undefined, cover: null, from: 0, to: 0, done: false,
    tracks: tracks.map((t) => ({ ...t, key: `album:${dirs.indexOf(t.root)}:${t.path}` })) };
  // ролик с тем же именем, что у снимка, — его живое фото, отдельной клеткой не показывается
  const stem = (f) => f.name.replace(/\.[^.]+$/, "").toLowerCase();
  const clips = new Map(files.filter((f) => VIDEO_RE.test(f.name)).map((f) => [stem(f), f]));
  const live = new Map(files.filter((f) => !VIDEO_RE.test(f.name) && clips.has(stem(f))).map((f) => [f, clips.get(stem(f))]));
  const paired = new Set(live.values());
  for (const f of files.filter((f) => !paired.has(f)).sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }))) {
    const p = { id: `album/${f.root ? dirs.indexOf(f.root) : "r"}:${f.path}`, album: a, rec: null, thumb: "", img: "", video: VIDEO_RE.test(f.name), live: live.get(f) || null, ...f };
    photos.set(p.id, p);
    a.photos.push(p.id);
  }
  albums.set(path, a);
}

async function listRepo() {
  const by = new Map();
  for (const f of (await repoFiles("Альбомы")).filter((f) => MEDIA_RE.test(f.name) && !f.path.includes("/["))) {
    const d = f.path.slice(0, f.path.lastIndexOf("/"));
    if (!by.has(d)) by.set(d, []);
    by.get(d).push({ name: f.name, path: f.path, url: repoUrl(f), key: `exif/${f.sha}` });
  }
  for (const [d, files] of by) addAlbum(d, d.split("/").pop(), false, files);
}

// своя папка: альбом — каждая папка, где есть снимки (подпапки — свои альбомы); «[Originals]» —
// исходники поправленных снимков, повторы — пропускаются
async function walk(handle, path, token, root) {
  const files = [], dirs = [], proxies = new Map(), tracks = [];
  try {
    for await (const [name, h] of handle.entries()) {
      if (h.kind === "directory") { if (!/^[._[]/.test(name)) dirs.push([name, h]); }
      else if (MEDIA_RE.test(name)) files.push({ name, path: `${path}/${name}`, handle: h, root });
      else if (TRACK_RE.test(name)) tracks.push({ name, path: `${path}/${name}`, handle: h, root, dir: handle });
      else if (/^GL\d{6}\.LRV$/i.test(name)) proxies.set(name.slice(2, 8), h);
    }
  } catch { return; }
  if (token !== scan) return;
  // GoPro: рядом с роликом GX011479.MP4 (4K, сотни МБ) — его уменьшенная копия GL011479.LRV (640×480);
  // кадр для клетки берётся из неё — быстро; играет в галерее сам ролик
  for (const f of files) { const m = /^G[HX](\d{6})\.MP4$/i.exec(f.name); if (m && proxies.has(m[1])) f.proxy = proxies.get(m[1]); }
  if (files.length || tracks.length) addAlbum(path, handle.name, true, files, tracks);
  for (const [name, h] of dirs.sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true }))) await walk(h, `${path}/${name}`, token, root);
}

// поездки — структура папок как на диске (Грегори 2026-11-02: «подпапки воспринимать как отдельные
// альбомы, повторить структуру папок»): папка ниже корня, где лежат альбомы, — поездка; в списке
// страны она одной строкой, внутри — её альбомы-дни. «-Albom» внутри поездки — «Избранное»
const up = (path) => path.slice(0, path.lastIndexOf("/"));
function nest(root) {
  for (const a of [...albums.values()].filter((a) => a.id.startsWith(`${root}/`))) {
    let child = a;
    for (let p = up(a.id); p.length > root.length; p = up(p)) {
      child.parent = p;
      if (groups.has(p)) break;
      const name = p.split("/").pop();
      child = { id: p, name, title: displayName(name), local: a.local, parent: null, group: true };
      groups.set(p, child);
    }
  }
  // снимки, лежащие прямо в папке поездки, — внутри неё последней строкой
  for (const g of groups.values()) if (albums.has(g.id)) Object.assign(albums.get(g.id), { parent: g.id, title: "Снимки поездки" });
  for (const a of albums.values()) if (a.parent && /albom$/i.test(a.name)) a.title = "Избранное";
}
const kidsOf = (g) => [...groups.values(), ...albums.values()].filter((x) => x.parent === g.id)
  .sort((x, y) => (y.title === "Избранное") - (x.title === "Избранное") || (x.id === g.id) - (y.id === g.id)
    || x.name.localeCompare(y.name, undefined, { numeric: true }));
const albumsIn = (g) => kidsOf(g).flatMap((x) => (x.group ? albumsIn(x) : [x]));
const topOf = (x) => { while (x.parent) x = groups.get(x.parent); return x; };
// поездка — в стране, где больше всего её снимков; даты — от первого до последнего дня
function tally(g) {
  const list = albumsIn(g), by = new Map();
  for (const a of list) if (a.country) by.set(a.country.name, (by.get(a.country.name) || 0) + a.photos.length);
  const ds = list.filter((a) => a.from);
  return { list, photos: list.filter((a) => a.title !== "Избранное").reduce((n, a) => n + a.photos.length, 0), country: [...by].sort((x, y) => y[1] - x[1])[0]?.[0],
    from: ds.length ? Math.min(...ds.map((a) => a.from)) : 0, to: ds.length ? Math.max(...ds.map((a) => a.to)) : 0,
    cover: list.filter((a) => a.title !== "Избранное" && a.cover).sort((x, y) => y.photos.length - x.photos.length)[0]?.cover
      || list.find((a) => a.photos.length)?.photos[0] };
}

// ---------- EXIF: координаты и дата, помнятся на устройстве ----------
let exifrLoad = null;
const exifr = () => (exifrLoad ??= import("https://unpkg.com/exifr@7.1.3/dist/full.esm.mjs")
  .then((m) => m.default || m).catch((err) => { exifrLoad = null; throw err; }));
const OPTS = { tiff: true, exif: true, gps: true, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false, translateValues: false };

async function exifOf(p) {
  if (p.rec) return p.rec;
  let key = p.key, file = null;
  try {
    if (p.handle) { file = await p.handle.getFile(); key = `exif/local/${p.path}|${file.size}|${file.lastModified}`; }
    const hit = await cacheGet(key).catch(() => null);
    if (hit) { checked++; return (p.rec = hit); }
    if (p.video) {
      const rec = file ? await movMeta(file).catch(() => ({})) : {};
      cacheSet(key, rec).catch(() => {});
      checked++;
      return (p.rec = rec);
    }
    // у снимка из репозитория EXIF — в начале файла: хватает первых 128 КБ
    const src = file || await fetch(p.url, { headers: { Range: "bytes=0-131071" } }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))));
    const rec = {};
    try {
      const e = await (await exifr()).parse(src, OPTS);
      if (Number.isFinite(e?.latitude) && Number.isFinite(e?.longitude) && (e.latitude || e.longitude)) Object.assign(rec, { lat: e.latitude, lon: e.longitude });
      // у уменьшенных копий в «Альбомах» остаётся только дата сохранения (DateTime) — тоже годится
      const d = [e?.DateTimeOriginal, e?.CreateDate, e?.ModifyDate].find((x) => x instanceof Date);
      if (d) rec.date = d.getTime();
    } catch { /* без EXIF */ }
    cacheSet(key, rec).catch(() => {});
    checked++;
    return (p.rec = rec);
  } catch {
    // файл не прочитался (нет сети, облачная заглушка) — без координат, но и в память не пишем
    checked++;
    return (p.rec = {});
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

async function locate(a) {
  if (!a.point) { a.country = null; return; }
  a.country = (await countryAt(a.point)) || null;
}
// трек альбома — прочитан один раз за обход: { segs, color }; не читается — пустой
const trackOf = (t) => (t.data ??= t.handle.getFile().then((f) => f.text()).then((x) => parseFile(t.name, x))
  .catch(() => ({ segs: [] })).then((x) => (t.parsed = x)));
const trackPoints = (a) => (a.tracks || []).flatMap((t) => (t.parsed?.segs || []).flat());
const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;
const trackCount = (n) => (n ? plural(n, "трек", "трека", "треков") : "");
// «Моим трекам» — ссылки на треки альбомов: файл, его папка и альбом (у «Снимков поездки» и
// «Избранного» — название поездки)
const trackTitle = (a) => (a.parent && (a.title === "Снимки поездки" || a.title === "Избранное") ? groups.get(a.parent)?.title || a.title : a.title);
const sendTracks = () => emit("album-tracks", [...albums.values()].flatMap((a) => a.tracks.map((t) => ({ key: t.key, name: t.name.replace(/\.\w+$/, ""),
  file: t.name, handle: t.handle, dir: t.dir, root: t.root, albumId: a.id, albumTitle: trackTitle(a) }))));
const countryOf = (a) => (a.group ? tally(a).country : a.country?.name) || NO_COUNTRY;

// ---------- обход ----------
// проход 1 — у каждого альбома первый снимок с координатами (точка и страна сразу), проход 2 — все
// снимки, альбомы ближе к центру карты первыми; точка альбома — самый многолюдный «куст» (~10 км)
async function finish(a) {
  const cells = new Map();
  for (const id of a.photos) {
    const r = (await exifOf(photos.get(id)));
    if (!r.lat) continue;
    const k = `${r.lon.toFixed(1)},${r.lat.toFixed(1)}`;
    if (!cells.has(k)) cells.set(k, { point: [r.lon, r.lat], ids: [] });
    cells.get(k).ids.push(id);
  }
  const best = [...cells.values()].sort((x, y) => y.ids.length - x.ids.length)[0];
  const moved = best && (!a.point || best.point.join() !== a.point.join());
  if (best) a.point = best.point;
  const pool = best ? best.ids : a.photos;
  a.cover = pool[Math.floor(Math.random() * pool.length)] || null;
  // у альбома без снимков с местом — точка трека
  if (!a.point) a.point = trackPoints(a)[0]?.slice(0, 2) || null;
  const ds = [...a.photos.map((id) => photos.get(id).rec?.date), ...trackPoints(a).map((q) => q[3])].filter(Boolean);
  if (ds.length) { a.from = Math.min(...ds); a.to = Math.max(...ds); }
  if (moved || a.country === undefined) await locate(a);
  a.done = true;
}

async function rescan() {
  const token = ++scan;
  albums.clear();
  groups.clear();
  photos.clear();
  checked = 0;
  busy = true;
  refresh();
  try { await exifr(); } catch { busy = false; ctx?.status("Не загрузилась программа чтения снимков — проверьте интернет"); return; }
  await listRepo().catch(() => {});
  nest("Альбомы");
  if (!needsAccess) for (const d of dirs) { await walk(d, d.name, token, d); if (token !== scan) return; }
  if (token !== scan) return;
  for (const d of dirs) nest(d.name);
  sendTracks();
  for (const a of albums.values()) {
    for (const id of a.photos.slice(0, PROBE)) {
      const r = await exifOf(photos.get(id));
      if (r.lat) { a.point = [r.lon, r.lat]; break; }
    }
    for (const t of a.tracks) await trackOf(t);
    if (!a.point) a.point = trackPoints(a)[0]?.slice(0, 2) || null;
    if (token !== scan) return;
    await locate(a);
  }
  refresh();
  // проход 2 — в фоне
  (async () => {
    for (;;) {
      if (token !== scan) return;
      const rest = [...albums.values()].filter((a) => !a.done);
      if (!rest.length) break;
      const c = ctx?.map.getCenter();
      const dist = (a) => (a.point && c ? Math.hypot(a.point[0] - c.lng, a.point[1] - c.lat) : 1e9);
      await finish(rest.reduce((x, y) => (dist(y) < dist(x) ? y : x)));
      refresh();
    }
    busy = false;
    refresh();
  })();
}

async function load(c) {
  if (c) ctx = c;
  loading ??= (async () => {
    if (canFolders()) {
      dirs = await savedDirs();
      needsAccess = await noAccess();
    }
    await rescan();
  })();
  return loading;
}

// в столбике и в списке страны — альбомы и поездки верхнего уровня
const tops = () => [...groups.values(), ...albums.values()].filter((x) => !x.parent);
const countries = () => {
  const by = new Map();
  for (const a of tops()) { const k = countryOf(a); by.set(k, (by.get(k) || 0) + 1); }
  // «Без страны» — первой, остальные по алфавиту
  return [...by].sort((x, y) => (y[0] === NO_COUNTRY) - (x[0] === NO_COUNTRY) || x[0].localeCompare(y[0], "ru"));
};
const isoOf = (name) => [...albums.values()].find((a) => a.country?.name === name)?.country.iso || "";

// ---------- миниатюры: по две за раз, только нужные ----------
const queue = [];
let working = 0;
const fileOf = async (p) => (p.handle ? p.handle.getFile() : (await fetch(p.url)).blob());
function thumbOf(p) {
  if (p.thumbing) return p.thumbing;
  p.thumbing = new Promise((resolve) => { queue.push([p, resolve]); pump(); });
  return p.thumbing;
}
function pump() {
  while (working < 2 && queue.length) {
    const [p, resolve] = queue.shift();
    working++;
    makeThumb(p).catch(() => {}).finally(() => { working--; resolve(p.thumb); pump(); });
  }
}
// кадр ролика — своей миниатюры у него нет: грузим в <video> и рисуем кадр чуть от начала (первый
// бывает чёрным); кодек, который браузер молча не умеет (HEVC без поддержки видеокарты), — не ждём
// дольше 8 секунд (опыт travel-earth: иначе такой ролик забивал очередь миниатюр)
async function frameOf(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const v = Object.assign(document.createElement("video"), { muted: true, preload: "auto", src: url });
    await new Promise((resolve, reject) => {
      v.onloadeddata = resolve;
      v.onerror = () => reject(new Error("ролик не читается"));
      setTimeout(() => reject(new Error("ролик не загрузился")), 8000);
    });
    if (!v.videoWidth) throw new Error("картинку ролика браузер не умеет"); // HEVC: звук есть, картинки нет
    await new Promise((resolve) => { v.onseeked = resolve; v.currentTime = Math.min(0.3, (v.duration || 1) / 10); setTimeout(resolve, 500); });
    return await createImageBitmap(v, { resizeWidth: 480, resizeHeight: Math.round((480 * v.videoHeight) / v.videoWidth), resizeQuality: "medium" });
  } finally { URL.revokeObjectURL(url); }
}
async function makeThumb(p) {
  // поворот из EXIF браузер учитывает сам (imageOrientation по умолчанию — from-image)
  const bmp = p.video ? await frameOf(p.proxy ? await p.proxy.getFile() : await fileOf(p)).catch((err) => { p.noFrame = true; throw err; })
    : await createImageBitmap(await fileOf(p), { resizeWidth: 480, resizeQuality: "medium" });
  const side = Math.min(bmp.width, bmp.height), sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;
  const c = Object.assign(document.createElement("canvas"), { width: THUMB, height: THUMB });
  c.getContext("2d").drawImage(bmp, sx, sy, side, side, 0, 0, THUMB, THUMB);
  p.thumb = URL.createObjectURL(await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85)));
  // на карте — квадрат в тонкой белой скруглённой рамке, как у снимков Commons
  const m = Object.assign(document.createElement("canvas"), { width: MAP_THUMB, height: MAP_THUMB }).getContext("2d");
  const border = 3;
  m.beginPath(); m.roundRect(0, 0, MAP_THUMB, MAP_THUMB, 12); m.fillStyle = "#fff"; m.fill();
  m.beginPath(); m.roundRect(border, border, MAP_THUMB - 2 * border, MAP_THUMB - 2 * border, 12 - border); m.clip();
  m.drawImage(bmp, sx, sy, side, side, border, border, MAP_THUMB - 2 * border, MAP_THUMB - 2 * border);
  p.img = `my-${p.id.replace("/", "-")}`;
  p.imgData = m.getImageData(0, 0, MAP_THUMB, MAP_THUMB);
  if (shown && !ctx.map.hasImage(p.img)) try { ctx.map.addImage(p.img, p.imgData, { pixelRatio: 2 }); } catch { /* стиль меняется */ }
  refresh();
}
// крупный снимок своего файла — адрес держится для 8 последних
// (у живого фото — и его ролик: kind "live")
const fulls = [];
async function fullOf(f, id) {
  if (f.url) return f.url;
  const hit = fulls.find((x) => x.id === id);
  if (hit) return hit.url;
  const url = URL.createObjectURL(await f.handle.getFile());
  fulls.push({ id, url });
  if (fulls.length > 8) URL.revokeObjectURL(fulls.shift().url);
  return url;
}
// музыка слайд-шоу — папка «Music» в корне своей папки снимков (как в Albom); нет — показ без звука
const MUSIC_EXT = /\.(mp3|m4a|aac|ogg|wav|flac)$/i;
let musicList = null, musicUrl = "";
async function musicFiles() {
  if (musicList) return musicList;
  const list = [];
  if (!needsAccess) for (const d of dirs) {
    try {
      const m = await d.getDirectoryHandle("Music");
      for await (const e of m.values()) if (e.kind === "file" && MUSIC_EXT.test(e.name)) list.push(e);
    } catch { /* папки «Music» нет */ }
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return (musicList = list);
}
async function musicTrack(i) {
  const list = await musicFiles();
  if (!list.length) return "";
  if (musicUrl) URL.revokeObjectURL(musicUrl);
  return (musicUrl = URL.createObjectURL(await list[i % list.length].getFile()));
}
const media = (kind, id) => {
  if (kind === "music-count") return musicFiles().then((l) => l.length);
  if (kind === "music") return musicTrack(Number(id) || 0);
  const p = photos.get(id);
  if (!p || (kind === "live" && !p.live)) return Promise.resolve("");
  return kind === "full" ? fullOf(p, id) : kind === "live" ? fullOf(p.live, `${id}/live`) : thumbOf(p);
};

// снимки в кадре (вблизи) — миниатюры ближние к центру первыми
function wantInView() {
  if (!shown || ctx.map.getZoom() < VIEW_ZOOM) return;
  const b = ctx.map.getBounds(), c = ctx.map.getCenter();
  [...photos.values()].filter((p) => p.rec?.lat && !p.thumb && b.contains([p.rec.lon, p.rec.lat]))
    .sort((x, y) => Math.hypot(x.rec.lon - c.lng, x.rec.lat - c.lat) - Math.hypot(y.rec.lon - c.lng, y.rec.lat - c.lat))
    .slice(0, 60).forEach(thumbOf);
}

// ---------- карта ----------
let shown = false, frame = 0;
const pt = (p) => [p.rec.lon, p.rec.lat];
const located = () => [...photos.values()].filter((p) => p.rec?.lat);
const fc = (features) => ({ type: "FeatureCollection", features });
const albumData = () => fc([...albums.values()].filter((a) => a.point).map((a) => ({ type: "Feature", geometry: { type: "Point", coordinates: a.point },
  properties: { album: a.id, title: a.title } })));
const dotData = () => fc(located().map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: pt(p) }, properties: { photo: p.id } })));
const thumbData = () => fc(located().filter((p) => p.img).map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: pt(p) }, properties: { photo: p.id, img: p.img } })));
const font = (map) => map.getStyle().layers.find((l) => l.type === "symbol" && Array.isArray(l.layout?.["text-font"]))?.layout["text-font"] || ["Noto Sans Regular"];
const trackData = () => fc([...albums.values()].flatMap((a) => a.tracks.flatMap((t) => (t.parsed?.segs || []).filter((s) => s.length > 1)
  .map((s) => ({ type: "Feature", geometry: { type: "LineString", coordinates: s.map((q) => [q[0], q[1]]) }, properties: { album: a.id, title: a.title, color: t.parsed.color || TRACK_COLOR } })))));
const LAYERS = ["albums-tracks", "albums-icons", "albums-dots", "albums-count", "albums-thumbs"];

// значок альбома — фиолетовый фотоаппарат с тонким белым кантом (правило значков Atlas)
function cameraImage() {
  const s = 64, c = Object.assign(document.createElement("canvas"), { width: s, height: s }).getContext("2d");
  c.translate(6, 6);
  c.scale(52 / 24, 52 / 24);
  const path = new Path2D(CAMERA_D);
  c.lineWidth = 2.4;
  c.lineJoin = "round";
  c.strokeStyle = "#fff";
  c.stroke(path);
  c.fillStyle = COLOR;
  c.fill(path);
  return c.getImageData(0, 0, s, s);
}

function addLayers() {
  const map = ctx.map;
  if (!map.hasImage("album-camera")) map.addImage("album-camera", cameraImage(), { pixelRatio: 2 });
  for (const p of photos.values()) if (p.imgData && !map.hasImage(p.img)) map.addImage(p.img, p.imgData, { pixelRatio: 2 });
  if (!map.getSource("albums")) map.addSource("albums", { type: "geojson", data: albumData() });
  if (!map.getSource("albums-photos")) map.addSource("albums-photos", { type: "geojson", data: dotData(), cluster: true, clusterRadius: 18, clusterMaxZoom: 18 });
  if (!map.getSource("albums-thumbs")) map.addSource("albums-thumbs", { type: "geojson", data: thumbData() });
  if (!map.getSource("albums-tracks")) map.addSource("albums-tracks", { type: "geojson", data: trackData() });
  // трек — под значками и снимками, с белым кантом; щелчок по нему — его альбом
  if (!map.getLayer("albums-tracks-casing")) map.addLayer({ id: "albums-tracks-casing", type: "line", source: "albums-tracks",
    layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": 6 } });
  if (!map.getLayer("albums-tracks")) map.addLayer({ id: "albums-tracks", type: "line", source: "albums-tracks",
    layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3 } });
  if (!map.getLayer("albums-icons")) map.addLayer({ id: "albums-icons", type: "symbol", source: "albums", maxzoom: DOT_ZOOM,
    layout: { "icon-image": "album-camera", "icon-allow-overlap": true, "icon-ignore-placement": true } });
  if (!map.getLayer("albums-dots")) map.addLayer({ id: "albums-dots", type: "circle", source: "albums-photos", minzoom: DOT_ZOOM,
    paint: { "circle-color": COLOR, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5,
      "circle-radius": ["case", ["has", "point_count"], ["step", ["get", "point_count"], 9, 10, 11, 100, 13, 1000, 15], 4] } });
  if (!map.getLayer("albums-count")) map.addLayer({ id: "albums-count", type: "symbol", source: "albums-photos", minzoom: DOT_ZOOM, filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": font(map), "text-size": 11, "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#fff" } });
  if (!map.getLayer("albums-thumbs")) map.addLayer({ id: "albums-thumbs", type: "symbol", source: "albums-thumbs", minzoom: THUMB_ZOOM,
    layout: { "icon-image": ["get", "img"], "icon-padding": 4 } });
  claimLayers(...LAYERS, "albums-tracks-casing");
}

// карта, лента и открытые списки — по ходу обхода, не чаще раза за кадр
function refresh() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    if (shown && ctx) {
      ctx.map.getSource("albums")?.setData(albumData());
      ctx.map.getSource("albums-photos")?.setData(dotData());
      ctx.map.getSource("albums-thumbs")?.setData(thumbData());
      ctx.map.getSource("albums-tracks")?.setData(trackData());
      setStripItems("albums", located().filter((p) => p.thumb).map(stripItem));
    }
    if (isOpen("albums") && !openAlbum && !searchText && !dupView) { if (openGroup) renderGroup(true); else renderList(currentCountry); }
  });
}
const stripItem = (p) => ({ id: p.id, coordinates: pt(p), thumb: p.thumb, title: [p.album.title, photoDate(p)].filter(Boolean).join(" · "),
  full: p.url, credit: photoDate(p), select: () => showPhoto(p), gallery: () => gallery(p.album, p.id) });

function showOnMap(on) {
  if (shown === on || !ctx) return;
  shown = on;
  const map = ctx.map;
  if (on) { addLayers(); refresh(); wantInView(); return; }
  for (const id of [...LAYERS, "albums-tracks-casing"]) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of ["albums", "albums-photos", "albums-thumbs", "albums-tracks"]) if (map.getSource(id)) map.removeSource(id);
  setStripItems("albums", []);
}

// окно снимка на карте
let tappedCell = null, popupPhoto = null; // выбранный снимок в альбоме и на карте — касание по нему открывает галерею
function showPhoto(p) {
  if (!p.rec?.lat) return;
  popupPhoto = p.id;
  const box = h("div", "");
  const img = Object.assign(document.createElement("img"), { className: "popup-photo", alt: "", src: p.thumb || "" });
  img.style.height = "200px";
  img.style.objectFit = "cover";
  img.style.cursor = "zoom-in";
  img.title = "Альбом в галерее с этого снимка";
  img.addEventListener("click", () => gallery(p.album, p.id));
  if (!p.video) fullOf(p, p.id).then((u) => { img.src = u; }).catch(() => {});
  box.append(img, h("div", "popup-row", p.album.title), h("div", "popup-sub", [photoDate(p), p.name].filter(Boolean).join(" · ")),
    h("div", "popup-sub", p.video ? "Ролик — щелчок откроет его в галерее" : p.live ? "Живое фото — щелчок оживит его в галерее" : "Щелчок по снимку — альбом в галерее"));
  track(new ctx.maplibregl.Popup({ offset: p.img && ctx.map.getZoom() >= THUMB_ZOOM ? 26 : 8, maxWidth: "300px" }))
    .setLngLat(pt(p)).setDOMContent(box).addTo(ctx.map).on("close", () => { selectStripItem(null, p.id); if (popupPhoto === p.id) popupPhoto = null; });
  if (p.thumb) selectStripItem(p.id);
}

// у поездки — снимки всех её альбомов подряд, без «Избранного» (там копии)
const photosOf = (x) => (x.group ? tally(x).list.filter((a) => a.title !== "Избранное").flatMap((a) => a.photos) : x.photos);

// снимок своей папки можно править в галерее (tools/editor.js): папка — по номеру в списке своих папок
// (окно галереи берёт её доступ из IndexedDB albums/dirs, со своим нажатием просит право записи),
// путь — внутри неё. Ролики, снимки с GitHub и телефон — без правки (кнопка неактивна)
const EDITABLE = /\.(jpe?g|png|webp)$/i;
const editInfo = (p) => (p.root && !p.video && EDITABLE.test(p.name) && !isMobile()
  ? { root: dirs.indexOf(p.root), path: p.path.slice(p.root.name.length + 1) } : null);
// окно галереи сохранило правку — миниатюра и крупный снимок заново, из нового файла
window.atlasGallerySaved = (id) => {
  const p = photos.get(id);
  if (!p) return;
  const i = fulls.findIndex((x) => x.id === id);
  if (i >= 0) URL.revokeObjectURL(fulls.splice(i, 1)[0].url);
  if (p.thumb) URL.revokeObjectURL(p.thumb);
  p.thumb = ""; p.thumbing = null; p.noFrame = false;
  // дату и место могли поправить (сведения о снимке) — EXIF заново
  p.rec = null;
  Promise.all([thumbOf(p), exifOf(p)]).then(() => { refresh(); if (openAlbum === p.album) renderAlbum(); });
};
// окно галереи убрало снимок в «[Удалённые]» — из альбома
window.atlasGalleryRemoved = (id) => {
  const p = photos.get(id);
  if (!p) return;
  forget(p);
  refresh();
  if (openAlbum === p.album) renderAlbum();
};
// в «Избранное» добавили или убрали снимок — папки заново, когда окно галереи закроют (обход большой
// папки — не мгновение, а пока галерея открыта, её снимки лучше не трогать)
let rescanLater = false;
window.atlasGalleryRescan = () => { rescanLater = true; };
addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.data?.gallery !== "closed" || !rescanLater) return;
  rescanLater = false;
  rescan().then(() => refresh()).catch(() => {});
});
// для проверки (снимки выдуманной папки в тесте не уходят в IndexedDB) — доступ к своим папкам
window.atlasGalleryRoots = () => dirs;
// окно галереи (popup) запись в папку у Edge не спрашивает — сразу отказ (Грегори 2026-11-11), а папки
// открыты только на чтение; спросить можно здесь, по нажатию — кнопка над картой, после неё «Сохранить» снова
window.atlasGalleryAskWrite = (i) => {
  const d = dirs[i];
  if (!d) return;
  // красная плашка внизу слева над шкалой, с крестиком — передумали (Грегори 2026-11-11: «на неудачном месте»)
  document.querySelector(".al-write-ask")?.remove();
  const box = h("div", "al-write-ask");
  const b = h("button", "al-write-go", `Разрешить запись в папку «${d.name}»`);
  b.type = "button";
  const x = h("button", "al-write-x");
  Object.assign(x, { type: "button", title: "Закрыть", innerHTML: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>' });
  x.addEventListener("click", () => box.remove());
  box.append(b, x);
  b.addEventListener("click", async () => {
    const ok = await d.requestPermission({ mode: "readwrite" }).catch(() => "denied");
    box.remove();
    ctx?.status(ok === "granted" ? "Запись разрешена — нажмите «Сохранить» в окне снимка" : "Браузер не дал разрешения на запись");
    setTimeout(() => ctx?.status(""), 5000);
  });
  document.body.append(box);
};

// «Смотреть» — сразу слайд-шоу (play); щелчок по снимку — просто галерея с него
function gallery(a, startId, play = false) {
  const ids = photosOf(a);
  openGalleryWith(ids.map((id) => galleryItem(photos.get(id))), startId || ids[0], media, { play });
}
const galleryItem = (p) => ({ id: p.id, thumb: p.thumb, full: p.url, title: p.album.title, credit: [photoDate(p), p.name].filter(Boolean).join(" · "),
  coordinates: p.rec?.lat ? pt(p) : null, video: p.video, live: !!p.live, edit: editInfo(p) });

function fitAlbum(a) {
  const pts = [...photosOf(a).map((id) => photos.get(id)).filter((p) => p.rec?.lat).map(pt),
    ...(a.group ? tally(a).list : [a]).flatMap(trackPoints).map((q) => [q[0], q[1]])];
  if (!pts.length && !a.point) return;
  if (!pts.length) pts.push(a.point);
  const lng = pts.map((p) => p[0]), lat = pts.map((p) => p[1]);
  const phone = innerWidth <= 600;
  ctx.map.fitBounds([[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]],
    { padding: phone ? { top: innerHeight * 0.6, bottom: 110, left: 30, right: 30 } : { top: 80, bottom: 110, left: 440, right: 90 }, maxZoom: 16, duration: 2000 });
}

// ---------- панель ----------
const panel = createPanel({ id: "albums", title: "Мои альбомы", icon: svg(STACK_D, 18), side: "left" });
const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });
const btn = (icon, title, fn) => { const b = h("button", "pb-btn"); b.innerHTML = icon; b.title = title; b.addEventListener("click", fn); return b; };
let currentCountry = null, openAlbum = null, openGroup = null, searchText = "";

// миниатюра, которая сама просит картинку, когда видна
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    seen.unobserve(e.target);
    const p = photos.get(e.target.dataset.photo);
    if (p) thumbOf(p).then((src) => { if (src) e.target.src = src; else if (p.noFrame) noFrame(e.target, p); });
  }
}, { rootMargin: "200px" });
// ролик, который браузер не показывает (HEVC с iPhone, Грегори 2026-11-02: Азоры) — клетка со значком
// плёнки и подписью почему, а не пустое место; у альбома — подсказка, что поможет
const NO_CLIP = "Этот браузер не показывает видео с iPhone (формат HEVC)";
const hevc = () => (hevc.ok ??= !!document.createElement("video").canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"'));
function noFrame(img, p) {
  const cell = img.closest(".al-cell");
  if (!cell) return;
  cell.classList.add("no-frame");
  cell.title = `${cell.title} — ${NO_CLIP[0].toLowerCase()}${NO_CLIP.slice(1)}`;
  if (p.album === openAlbum && !panel.body.querySelector(".al-noclip")) panel.body.querySelector(".al-grid")?.before(noClipHint());
}
function noClipHint() {
  const d = h("p", "pb-hint al-noclip", `${NO_CLIP}: живые фото остаются снимками, ролики — без картинки. `
    + "Помогает свежий драйвер видеокарты (Chrome отключает видеокарту при старом драйвере) или Edge с «Расширениями для видео HEVC» из Microsoft Store.");
  return d;
}
function lazyImg(p, cls) {
  const img = Object.assign(document.createElement("img"), { className: cls, alt: "" });
  if (!p) return img;
  img.dataset.photo = p.id;
  if (p.thumb) img.src = p.thumb; else seen.observe(img);
  return img;
}

function albumRow(a) {
  const r = h("button", "tr-row al-row");
  const text = h("span", "tr-row-text");
  text.append(h("span", "tr-row-title", a.title), h("span", "tr-row-sub",
    [a.photos.length || !a.tracks.length ? `${a.photos.length} фото` : "", trackCount(a.tracks.length), dates(a)].filter(Boolean).join(" · ")));
  r.append(lazyImg(photos.get(a.cover || a.photos[0]), "al-cover"), text);
  r.addEventListener("click", () => openAlbumById(a.id));
  return r;
}

// папка отличается от альбома (Грегори 2026-11-02): стрелка раскрывает её альбомы прямо в
// списке (справа — Грегори 2026-11-03), обложка — стопкой; щелчок по строке — папка целиком (на карте, ▶ — все снимки)
const expanded = new Set(); // раскрытые папки
const CHEVRON = svg("M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z", 20);
function groupRow(g, depth) {
  const t = tally(g), open = expanded.has(g.id);
  const line = h("div", "al-line al-folder");
  line.style.paddingLeft = `${depth * 24}px`;
  const chev = btn(CHEVRON, open ? "Свернуть папку" : "Раскрыть папку", () => { if (open) expanded.delete(g.id); else expanded.add(g.id); rerender(); });
  chev.classList.add("al-chev");
  chev.classList.toggle("open", open);
  const r = h("button", "tr-row al-row");
  const text = h("span", "tr-row-text");
  text.append(h("span", "tr-row-title", g.title), h("span", "tr-row-sub",
    [`${kidsOf(g).length} альб.`, `${t.photos} фото`, dates(t)].filter(Boolean).join(" · ")));
  r.append(lazyImg(photos.get(t.cover), "al-cover al-stack"), text);
  r.addEventListener("click", () => openGroupById(g.id));
  line.append(r, chev);
  return line;
}
// альбомы папки — с отступом под обложкой папки
function rows(items, depth = 0) {
  return items.flatMap((x) => {
    if (x.group) return [groupRow(x, depth), ...(expanded.has(x.id) ? rows(kidsOf(x), depth + 1) : [])];
    const line = h("div", "al-line");
    line.style.paddingLeft = `${depth * 24}px`;
    line.append(albumRow(x));
    return [line];
  });
}
const rerender = () => (dupView ? renderDups() : openAlbum ? renderAlbum() : openGroup ? renderGroup(true) : renderList(currentCountry, searchText));

// в шапке — раскрыть или свернуть все папки списка разом; кнопка видна, только когда папки есть
const UNFOLD = svg("M12 5.83 15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z", 18);
const FOLD = svg("M7.41 18.59 8.83 20 12 16.83 15.17 20l1.41-1.41L12 14l-4.59 4.59zm9.18-13.18L15.17 4 12 7.17 8.83 4 7.41 5.41 12 10l4.59-4.59z", 18);
let foldItems = [];
const allFolders = (items) => items.filter((x) => x.group).flatMap((g) => [g, ...allFolders(kidsOf(g))]);
const foldBtn = panel.addButton(UNFOLD, "Раскрыть все папки", () => {
  const all = allFolders(foldItems), open = all.length && all.every((g) => expanded.has(g.id));
  for (const g of all) if (open) expanded.delete(g.id); else expanded.add(g.id);
  rerender();
});
function setFold(items) {
  foldItems = items;
  dupBtn.hidden = dupView || ![...photos.values()].some((p) => p.handle);
  panel.setIcon(dupView ? FIND_DUPS : undefined);
  const all = allFolders(items), open = all.length > 0 && all.every((g) => expanded.has(g.id));
  foldBtn.hidden = !all.length;
  foldBtn.innerHTML = open ? FOLD : UNFOLD;
  foldBtn.title = open ? "Свернуть все папки" : "Раскрыть все папки";
}

// стрелка назад — в поездку, где лежит альбом, иначе к списку страны
function backBtn(x) {
  const g = x.parent && groups.get(x.parent);
  return btn(BACK, g ? `К поездке: ${g.title}` : `К альбомам: ${countryOf(x)}`, () => {
    if (g) openGroupById(g.id); else renderList(countryOf(x));
    panel.body.scrollTop = 0;
  });
}

function accessRow() {
  const b = h("button", "text-btn al-access", accessTitle());
  b.addEventListener("click", askAccess);
  return b;
}

function renderList(country, query = "") {
  openAlbum = null;
  openGroup = null;
  dupView = false;
  currentCountry = country ?? currentCountry;
  searchText = query;
  const q = query.toLowerCase();
  const from = (x) => (x.group ? tally(x).from : x.from) || 0;
  const list = (q ? [...groups.values(), ...albums.values()] : tops())
    .filter((a) => (q ? [a.title, a.name, a.id, countryOf(a)].join(" ").toLowerCase().includes(q) : countryOf(a) === currentCountry))
    .sort((x, y) => from(y) - from(x) || x.title.localeCompare(y.title, "ru"));
  // без страны — список стран (первой строкой — своя папка), у списка страны — стрелка «Все страны»
  if (!q && !currentCountry) {
    panel.setTitle("Мои альбомы");
    setFold([]);
    panel.body.replaceChildren(...(busy ? [h("p", "pb-hint", `Читаю снимки… проверено ${checked}`)] : []), homeList(countryItems(), chooseItem));
    return;
  }
  panel.setTitle(q ? "Найденные альбомы" : currentCountry || "Мои альбомы");
  const nodes = [];
  if (!q) {
    const bar = h("div", "pb-bar");
    bar.append(btn(BACK, "Все страны", () => { currentCountry = null; renderList(null); panel.body.scrollTop = 0; }));
    nodes.push(bar);
  }
  if (needsAccess && dirs.length) nodes.push(accessRow());
  if (busy) nodes.push(h("p", "pb-hint", `Читаю снимки… проверено ${checked}`));
  if (q && !list.length) nodes.push(h("p", "pb-hint", "Ничего не нашлось"));
  setFold(list);
  nodes.push(...rows(list));
  const keep = panel.body.scrollTop;
  panel.body.replaceChildren(...nodes);
  panel.body.scrollTop = keep;
}

// поездка — в той же панели: назад, ▶ все снимки поездки, даты, её альбомы по порядку папок
function renderGroup(keepScroll) {
  const g = openGroup, t = tally(g);
  panel.setTitle(g.title);
  const bar = h("div", "pb-bar");
  const left = h("div", "tr-bar-left");
  left.append(backBtn(g), btn(PLAYER.play, "Слайд-шоу всей поездки", () => gallery(g, null, true)));
  bar.append(left);
  const lands = [...new Set(t.list.map((a) => a.country?.name).filter(Boolean))];
  const facts = h("div", "tr-facts al-facts", [`${t.photos} фото`, dates(t), lands.join(", "), g.local ? "на этом компьютере" : ""].filter(Boolean).join(" · "));
  const keep = panel.body.scrollTop;
  const kids = kidsOf(g);
  setFold(kids);
  panel.body.replaceChildren(bar, facts, ...rows(kids));
  panel.body.scrollTop = keepScroll ? keep : 0;
}

function openGroupById(id) {
  const g = groups.get(id);
  if (!g) return;
  openAlbum = null;
  openGroup = g;
  dupView = false;
  renderGroup();
  fitAlbum(g);
}

function renderAlbum() {
  const a = openAlbum;
  panel.setTitle(a.title);
  setFold([]);
  const bar = h("div", "pb-bar");
  const left = h("div", "tr-bar-left");
  const play = btn(PLAYER.play, "Слайд-шоу альбома", () => gallery(a, null, true));
  play.disabled = !a.photos.length;
  left.append(backBtn(a), play);
  // трек из папки альбома — в «Моих треках», стрелка оттуда — назад сюда
  for (const t of a.tracks) {
    const b = btn(trackIcon(20), `Просмотр трека «${t.name.replace(/\.\w+$/, "")}»`, () => emit("track-open", { key: t.key, ctx }));
    b.classList.add("al-track");
    left.append(b);
  }
  bar.append(left);
  const clips = a.photos.filter((id) => photos.get(id).video).length;
  const facts = h("div", "tr-facts al-facts", [a.photos.length - clips || !a.tracks.length ? `${a.photos.length - clips} фото` : "", trackCount(a.tracks.length), clips ? `${clips} видео` : "", dates(a), a.country?.name, a.local ? "на этом компьютере" : ""].filter(Boolean).join(" · "));
  // снимки по дням (Грегори 2026-11-04: «когда открыты миниатюры альбома, поделить их по датам»):
  // день — заголовок с датой и числом снимков, щелчок по нему сворачивает день; внутри дня — по времени;
  // без даты — последним. Один день — без заголовков
  const dayOf = (p) => (p.rec?.date ? new Date(p.rec.date).toDateString() : "");
  const days = new Map();
  for (const id of [...a.photos].sort((x, y) => (photos.get(x).rec?.date || Infinity) - (photos.get(y).rec?.date || Infinity))) {
    const k = dayOf(photos.get(id));
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(id);
  }
  const blocks = [];
  for (const [k, ids] of days) {
    const grid = h("div", "al-grid");
    if (days.size > 1) {
      const d = k && new Date(ids.length && photos.get(ids[0]).rec.date);
      const head = h("button", "al-day" + (shutDays.has(`${a.id}|${k}`) ? " shut" : ""));
      head.type = "button";
      head.innerHTML = `<span></span><span class="al-day-n"></span>${CHEVRON}`;
      head.firstChild.textContent = k ? d.toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric", weekday: "short" }) : "Без даты";
      head.children[1].textContent = String(ids.length);
      head.title = "Свернуть или развернуть день";
      head.addEventListener("click", () => {
        const key = `${a.id}|${k}`;
        if (shutDays.has(key)) shutDays.delete(key); else shutDays.add(key);
        head.classList.toggle("shut");
        grid.hidden = head.classList.contains("shut");
      });
      grid.hidden = head.classList.contains("shut");
      blocks.push(head);
    }
    blocks.push(grid);
    for (const id of ids) {
    const p = photos.get(id);
    const cell = h("button", "al-cell");
    cell.title = [photoDate(p), p.name].filter(Boolean).join(" · ");
    const img = lazyImg(p, "");
    cell.append(img);
    if (p.video || p.live) cell.append(h("span", "al-badge", p.video ? "▶" : "LIVE"));
    if (p.noFrame) requestAnimationFrame(() => noFrame(img, p));
    if (!p.rec?.lat) cell.classList.add("no-place");
    // щелчок — снимок на карте (если у него есть место), двойной — галерея с него; на телефоне вместо
    // двойного — касание уже выбранного снимка (Грегори 2026-11-05)
    cell.addEventListener("click", () => {
      if (!p.rec?.lat || (touchUI() && tappedCell === id)) { gallery(a, id); return; }
      tappedCell = id;
      ctx.map.flyTo({ center: pt(p), zoom: Math.max(ctx.map.getZoom(), 15), offset: innerWidth <= 600 ? [0, Math.round(innerHeight * 0.22)] : [210, 0], duration: 1500 });
      ctx.map.once("moveend", () => showPhoto(p));
    });
    cell.addEventListener("dblclick", () => gallery(a, id));
    grid.append(cell);
    }
  }
  // ролики iPhone (.mov) там, где браузер не умеет HEVC, — сразу подсказка (живые фото иначе молча остаются снимками)
  const iphone = a.photos.some((id) => { const p = photos.get(id); return p.noFrame || (!hevc() && /\.mov$/i.test((p.live || p).name)); });
  const keep = openAlbum === renderedAlbum ? panel.body.scrollTop : 0;
  panel.body.replaceChildren(bar, facts, ...(iphone ? [noClipHint()] : []), ...blocks);
  // заново (дочитаны даты) — прокрутка на месте
  panel.body.scrollTop = keep;
  renderedAlbum = openAlbum;
}
const shutDays = new Set(); // свёрнутые дни: «альбом|день», пока открыта страница
let renderedAlbum = null;

function openAlbumById(id) {
  const a = albums.get(id);
  if (!a) return;
  openAlbum = a;
  openGroup = null;
  dupView = false;
  renderedAlbum = null; // открыли заново — с начала
  renderAlbum();
  fitAlbum(a);
  if (!a.done) finish(a).then(() => { refresh(); if (openAlbum === a) renderAlbum(); });
}

// ---------- повторы (Грегори 2026-11-08: поиск дубликатов — первый из новых фото-инструментов) ----------
// В своих папках одни и те же снимки лежат по нескольку раз: поездка скопирована на другой диск,
// снимок сохранён дважды. Одинаковые — файлы байт в байт: сначала размер, у совпавших по размеру —
// хэш SHA-256 (у роликов больше 32 МБ — начала, середины и конца). Похожие — снимки одной секунды
// съёмки (дата EXIF) с почти той же картинкой (dHash 64 бита, отличие до 8): уменьшенная или
// поправленная копия. «Избранное» (-Albom) — копии нарочно, не в счёте. Оставить — самый большой файл,
// при равных — из альбома, где снимков больше (полная копия поездки), потом — с коротким именем (без
// «— копия», «(1)» — в архиве Грегори такие копии Проводника есть); щелчок по другой клетке —
// оставить её. Лишняя копия не удаляется — переносится в папку «[Повторы]» в корне своей папки тем же
// путём (обход её пропускает); вернуть — перенести файл обратно. У живого фото — вместе с роликом
const STASH = "[Повторы]";
// кнопка — снимок с лупой (Грегори 2026-11-08: два листка — «копировать», он у пути к папке)
const FIND_DUPS = svg("M18 13v7H4V6h5.02c.05-.71.22-1.38.48-2H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-5l-2-2zm-1.5 5h-11l2.75-3.53 1.96 2.36 2.75-3.54zm2.8-9.11c.44-.7.7-1.51.7-2.39C20 4.01 17.99 2 15.5 2S11 4.01 11 6.5s2.01 4.5 4.49 4.5c.88 0 1.7-.26 2.39-.7L21 13.42 22.42 12 19.3 8.89zM15.5 9C14.12 9 13 7.88 13 6.5S14.12 4 15.5 4 18 5.12 18 6.5 16.88 9 15.5 9z", 18);
const COPY = svg("M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z", 18);
let dupView = false, dups = null, dupRun = 0;
const dupBtn = panel.addButton(FIND_DUPS, "Найти дубликаты снимков", () => openDups());
dupBtn.hidden = true;
const mb = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} КБ`
  : n < 1073741824 ? `${(n / 1048576).toLocaleString("ru", { maximumFractionDigits: n < 10485760 ? 1 : 0 })} МБ` : `${(n / 1073741824).toLocaleString("ru", { maximumFractionDigits: 1 })} ГБ`);
const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

async function digest(file) {
  const CHUNK = 4 << 20;
  const parts = file.size <= 8 * CHUNK ? [file] : [0, (file.size - CHUNK) / 2, file.size - CHUNK].map((o) => file.slice(Math.floor(o), Math.floor(o) + CHUNK));
  const hash = await crypto.subtle.digest("SHA-256", await new Blob(parts).arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// отпечаток картинки: 9×8 серых точек, бит — светлее ли точка соседа справа
async function dhash(p) {
  const bmp = await createImageBitmap(await p.handle.getFile(), { resizeWidth: 9, resizeHeight: 8, resizeQuality: "high" });
  const c = new OffscreenCanvas(9, 8).getContext("2d");
  c.drawImage(bmp, 0, 0);
  const d = c.getImageData(0, 0, 9, 8).data, gray = (i) => d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
  const bits = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(gray(y * 9 + x) > gray(y * 9 + x + 1));
  return bits;
}
const differ = (a, b) => a.reduce((n, bit, i) => n + (bit !== b[i]), 0);

async function findDups() {
  const run = ++dupRun, token = scan;
  const list = [...photos.values()].filter((p) => p.handle && p.album.title !== "Избранное");
  dups = { busy: true, scan, step: "", done: 0, total: 0, same: [], like: [], keep: new Map(), moving: 0 };
  const step = (text, total) => { Object.assign(dups, { step: text, done: 0, total }); renderDups(); };
  const tick = () => { if (++dups.done % 25 === 0) renderDups(); };
  const stale = () => run !== dupRun || token !== scan;
  step("Сравниваю размеры", list.length);
  const bySize = new Map();
  for (const p of list) {
    try { p.size = (await p.handle.getFile()).size; push(bySize, p.size, p); } catch { /* файла уже нет */ }
    if (stale()) return;
    tick();
  }
  const cands = [...bySize.values()].filter((g) => g.length > 1);
  step("Сверяю содержимое", cands.flat().length);
  for (const g of cands) {
    const byHash = new Map();
    for (const p of g) {
      try { push(byHash, await digest(await p.handle.getFile()), p); } catch { /* не прочитался */ }
      if (stale()) return;
      tick();
    }
    for (const x of byHash.values()) if (x.length > 1) dups.same.push(x);
  }
  // похожие: из одинаковых файлов — по одному, снимки одной секунды съёмки
  const twins = new Set(dups.same.flatMap((g) => g.slice(1)));
  const pics = list.filter((p) => !p.video && !twins.has(p));
  step("Ищу похожие снимки", pics.length);
  const byDate = new Map();
  for (const p of pics) {
    const r = await exifOf(p);
    if (r.date) push(byDate, r.date, p);
    if (stale()) return;
    tick();
  }
  for (const g of byDate.values()) {
    if (g.length < 2) continue;
    const prints = await Promise.all(g.map((p) => dhash(p).catch(() => null)));
    if (stale()) return;
    // близкие попарно — в одну группу
    const root = g.map((_, i) => i), find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++)
      if (prints[i] && prints[j] && differ(prints[i], prints[j]) <= 8) root[find(i)] = find(j);
    const by = new Map();
    g.forEach((p, i) => push(by, find(i), p));
    for (const x of by.values()) if (x.length > 1) dups.like.push(x);
  }
  // группы из одних и тех же папок — рядом
  const where = (g) => [...new Set(g.map((p) => p.album.id))].sort().join("|");
  for (const k of ["same", "like"]) dups[k].sort((x, y) => where(x).localeCompare(where(y)));
  dups.busy = false;
  renderDups();
}

const keepOf = (g) => dups.keep.get(g) || [...g].sort((x, y) => (y.size || 0) - (x.size || 0) || y.album.photos.length - x.album.photos.length
  || x.name.length - y.name.length)[0]; // «IMG_1.jpg» раньше «IMG_1 — копия.jpg»
// где лежит: своя папка (если их несколько), поездка, альбом
function placeOf(a) {
  const parts = [a.title];
  for (let g = a.parent && groups.get(a.parent); g; g = g.parent && groups.get(g.parent)) parts.unshift(g.title);
  if (dirs.length > 1) parts.unshift(a.id.split("/")[0]);
  return parts.join(" / ");
}

function openDups() {
  dupView = true;
  openAlbum = null;
  openGroup = null;
  if (!dups || (!dups.busy && dups.scan !== scan)) findDups(); else renderDups();
  panel.body.scrollTop = 0;
}

function renderDups() {
  if (!dupView || !dups) return;
  panel.setTitle("Дубликаты");
  setFold([]);
  const bar = h("div", "pb-bar");
  bar.append(btn(BACK, "К альбомам", () => { renderList(currentCountry); panel.body.scrollTop = 0; }));
  // в шапке — ссылки на разделы (Грегори 2026-11-08); шапка не уезжает при прокрутке
  const links = h("div", "al-dup-links");
  const sections = [];
  bar.append(links);
  const nodes = [bar];
  if (dups.busy) nodes.push(h("p", "pb-hint al-dup-hint", `${dups.step}… ${dups.done} из ${dups.total}`));
  else {
    const extra = dups.same.flatMap((g) => g.filter((p) => p !== keepOf(g)));
    const size = extra.reduce((n, p) => n + (p.size || 0), 0);
    nodes.push(h("div", "tr-facts al-facts", dups.same.length ? `Одинаковых файлов: ${dups.same.length} · лишних копий ${extra.length} (${mb(size)})` : "Одинаковых файлов нет"),
      h("p", "pb-hint al-dup-hint", `Лишняя копия не удаляется — переносится в папку «${STASH}» вашей папки тем же путём. Щелчок по снимку — оставить его, двойной — посмотреть.`));
    if (extra.length) {
      const all = h("button", "text-btn al-dup-all", dups.moving ? `Переношу… ${dups.moving - 1}` : `Убрать лишние копии (${extra.length})`);
      all.disabled = !!dups.moving;
      all.addEventListener("click", () => stashAll(extra, `Перенести лишние копии (${extra.length}, ${mb(size)}) в папку «${STASH}»? Ничего не удаляется: вернуть можно, перенеся файлы обратно.`));
      nodes.push(all);
    }
    const section = (list, title, short, hint) => {
      if (!list.length) return;
      const head = h("div", "al-dup-title", title);
      const go = h("button", "al-dup-link", `${short} (${list.length})`);
      go.title = `К разделу «${title}»`;
      go.addEventListener("click", () => panel.body.scrollTo({ top: head.offsetTop - bar.offsetHeight - 4, behavior: "smooth" }));
      links.append(go);
      nodes.push(head, h("p", "pb-hint al-dup-hint", hint));
      // над группами — папки, где лежат копии, у каждой — «скопировать полный путь»
      let last = "";
      for (const g of list) {
        const folders = [...new Map(g.map((p) => [p.album.id, p])).values()];
        const at = folders.map((p) => p.album.id).join("|");
        if (at !== last) { last = at; nodes.push(whereBox(folders)); }
        nodes.push(dupRow(g));
      }
    };
    section(dups.same, "Одинаковые файлы", "Одинаковые", "Копии байт в байт");
    section(dups.like, "Похожие снимки", "Похожие", "Сняты в ту же секунду, картинка почти та же — уменьшенная или поправленная копия, а может, серия. Решайте сами");
  }
  const keep = panel.body.scrollTop;
  panel.body.replaceChildren(...nodes);
  panel.body.scrollTop = keep;
}

// полный путь к папке на диске: браузер его не сообщает (знает только имя выбранной папки) — где она
// лежит, Грегори вставляет один раз из адресной строки Проводника, помнится на этом компьютере (albums/paths)
let diskPaths = null;
const pathsOf = async () => (diskPaths ??= (await cacheGet("albums/paths").catch(() => null)) || {});
async function askDiskPath(root) {
  const known = (await pathsOf())[root.name] || "";
  const text = prompt(`Где на диске лежит ваша папка «${root.name}»? Откройте её в Проводнике, щёлкните по адресной строке, скопируйте и вставьте сюда (например E:\\AllPhoto\\${root.name}).`, known);
  if (text == null || !text.trim()) return null;
  let path = text.trim().replace(/^"|"$/g, "").replace(/\//g, "\\").replace(/\\+$/, "");
  // вставили папку выше — дописываем имя выбранной
  if (path.split("\\").pop().toLowerCase() !== root.name.toLowerCase()) path += `\\${root.name}`;
  diskPaths[root.name] = path;
  await cacheSet("albums/paths", diskPaths).catch(() => {});
  return path;
}
async function copyFolderPath(p) {
  const base = (await pathsOf())[p.root.name] || await askDiskPath(p.root);
  if (!base) return;
  const full = [base, ...p.path.split("/").slice(1, -1)].join("\\");
  try { await navigator.clipboard.writeText(full); ctx?.status(`Путь скопирован: ${full}`); }
  catch { prompt("Скопируйте путь:", full); }
}
function whereBox(folders) {
  const box = h("div", "al-dup-where");
  for (const p of folders) {
    const line = h("div", "al-dup-folder");
    const copy = btn(COPY, "Скопировать полный путь к папке", () => copyFolderPath(p));
    line.append(h("span", "al-dup-place", placeOf(p.album)), copy);
    box.append(line);
  }
  return box;
}

function dupRow(g) {
  const row = h("div", "al-dup");
  const kept = keepOf(g);
  for (const p of g) {
    const cell = h("div", "al-dup-cell" + (p === kept ? " keep" : ""));
    const pic = h("button", "al-cell");
    pic.title = [placeOf(p.album), p.name, photoDate(p)].filter(Boolean).join(" · ");
    pic.append(lazyImg(p, ""));
    if (p.video || p.live) pic.append(h("span", "al-badge", p.video ? "▶" : "LIVE"));
    pic.addEventListener("click", () => { dups.keep.set(g, p); renderDups(); });
    pic.addEventListener("dblclick", () => openGalleryWith(g.map(galleryItem), p.id, media));
    cell.append(pic, h("span", "al-dup-info", [p.album.title, p.size ? mb(p.size) : ""].filter(Boolean).join(" · ")));
    if (p === kept) cell.append(h("span", "al-dup-keep", "оставить"));
    else {
      const out = h("button", "text-btn al-dup-out", "Убрать");
      out.disabled = !!dups.moving;
      out.addEventListener("click", () => stashAll([p]));
      cell.append(out);
    }
    row.append(cell);
  }
  return row;
}

// запись в свою папку браузер разрешает только по нажатию — разрешение спрашивается первым делом
async function stashAll(list, question) {
  for (const r of new Set(list.map((p) => p.root))) {
    if (await r.requestPermission({ mode: "readwrite" }).catch(() => "denied") !== "granted") { ctx?.status("Нет разрешения на запись в папку — копии остались на месте"); return; }
  }
  if (question && !confirm(question)) return;
  let fail = 0;
  dups.moving = 1;
  renderDups();
  for (const p of list) {
    try { await stash(p); forget(p); } catch { fail++; }
    if (++dups.moving % 10 === 0) renderDups();
  }
  dups.moving = 0;
  if (fail) ctx?.status(`Не перенеслось копий: ${fail}`);
  refresh();
  renderDups();
}

const dirAt = async (root, names, create = false) => { let d = root; for (const n of names) d = await d.getDirectoryHandle(n, { create }); return d; };
async function stash(p) {
  const folder = p.path.split("/").slice(1, -1); // путь внутри своей папки — без её имени и имени файла
  const from = await dirAt(p.root, folder), to = await dirAt(p.root, [STASH, ...folder], true);
  for (const f of [p, p.live].filter(Boolean)) {
    // такой файл в «[Повторы]» уже есть — рядом с номером
    let name = f.name;
    for (let i = 2; await to.getFileHandle(name).then(() => true, () => false); i++) name = f.name.replace(/(\.[^.]+)?$/, ` (${i})$1`);
    if (f.handle.move) try { await f.handle.move(to, name); continue; } catch { /* перенос не поддержан — копия и удаление */ }
    const w = await (await to.getFileHandle(name, { create: true })).createWritable();
    await w.write(await f.handle.getFile());
    await w.close();
    await from.removeEntry(f.name);
  }
}
// убранный снимок — из альбома и из найденного
function forget(p) {
  photos.delete(p.id);
  const a = p.album;
  a.photos = a.photos.filter((id) => id !== p.id);
  if (a.cover === p.id) a.cover = a.photos[0] || null;
  if (dups) for (const k of ["same", "like"]) dups[k] = dups[k].map((g) => {
    const rest = g.filter((x) => x !== p), kept = dups.keep.get(g);
    if (kept && kept !== p) dups.keep.set(rest, kept);
    return rest;
  }).filter((g) => g.length > 1);
}

// ---------- свои папки (настройки) ----------
// раньше папка была одна (albums/dir) — она становится первой в списке
async function savedDirs() {
  const list = await cacheGet("albums/dirs").catch(() => null);
  if (Array.isArray(list)) return list;
  const old = await cacheGet("albums/dir").catch(() => null);
  return old ? [old] : [];
}
const noAccess = async () => {
  for (const d of dirs) if (await d.queryPermission({ mode: "read" }).catch(() => "denied") !== "granted") return true;
  return false;
};
const saveDirs = () => Promise.all([cacheSet("albums/dirs", dirs), cacheDelete("albums/dir")]).catch(() => {});
const accessTitle = () => (dirs.length === 1 ? `Открыть мою папку «${dirs[0].name}»` : "Открыть мои папки");
async function pickFolder(render) {
  let handle;
  try { handle = await window.showDirectoryPicker({ id: "atlas-albums", mode: "read" }); } catch { return; }
  for (const d of dirs) if (await d.isSameEntry?.(handle).catch(() => false)) { render?.(); return; } // уже есть
  dirs = [...dirs, handle];
  await saveDirs();
  needsAccess = await noAccess();
  musicList = null;
  loading = Promise.resolve();
  await rescan();
  render?.();
}
async function forgetFolder(d, render) {
  dirs = dirs.filter((x) => x !== d);
  await saveDirs();
  needsAccess = await noAccess();
  musicList = null;
  await rescan();
  render?.();
}
// после перезапуска браузер даёт доступ к папкам только по нажатию
async function askAccess() {
  for (const d of dirs) if (await d.requestPermission({ mode: "read" }).catch(() => "denied") !== "granted") return;
  needsAccess = false;
  musicList = null;
  await rescan();
}

function settingsSection(c, render) {
  if (!canFolders()) return null;
  ctx ??= c;
  const box = h("div", "");
  box.append(h("p", "set-hint", "Снимки с этого компьютера: альбом — каждая папка со снимками. Снимки никуда не отправляются, программа помнит только, какие папки вы выбрали."));
  for (const d of dirs) {
    const row = h("div", "set-row");
    row.append(h("span", "al-folder", `Папка: ${d.name}`));
    const where = h("button", "text-btn", "Путь на диске…");
    where.title = "Для «Скопировать полный путь» в повторах";
    where.addEventListener("click", async () => { if (await askDiskPath(d)) render?.(); });
    row.append(where);
    const forget = h("button", "text-btn", "Убрать");
    forget.addEventListener("click", () => forgetFolder(d, render));
    row.append(forget);
    box.append(row);
    const known = diskPaths?.[d.name];
    if (known) box.append(h("p", "set-hint", known));
  }
  const pick = h("button", "text-btn", "+ Добавить папку…");
  pick.addEventListener("click", () => pickFolder(render));
  box.append(pick);
  if (dirs.length && needsAccess) {
    const open = h("button", "text-btn", "Открыть доступ к папке");
    open.addEventListener("click", async () => { await askAccess(); render?.(); });
    box.append(open);
  }
  if (albums.size) box.append(h("p", "set-hint", `Альбомов: ${albums.size}, снимков с местом: ${located().length}${busy ? " — читаю снимки…" : ""}`));
  return box;
}
// выбранная папка видна в настройках сразу, ещё до первого открытия раздела
if (canFolders()) { savedDirs().then((l) => { if (!dirs.length) dirs = l; }); pathsOf(); }

// ---------- режим в строке поиска ----------
const MODE = { icon: svg(STACK_D, 20), title: "Мои альбомы", placeholder: "Найти альбом", tone: "my",
  filter: (text) => { if (text) renderList(null, text); else if (openAlbum) renderAlbum(); else if (openGroup) renderGroup(); else renderList(currentCountry); },
  exit: () => panel.close() };

// первой строкой — своя папка со снимками (на компьютере), прямо здесь, а не в настройках
// (Грегори, 2026-11-02: «в треках файлы выбираются на месте, для фото надо лазать по меню»)
function countryItems() {
  const folder = !canFolders() ? [] : [{ id: "#folder", icon: OPEN_ICON, hint: "Снимки с этого компьютера никуда не отправляются",
    title: needsAccess && dirs.length ? accessTitle() : "Добавить папку…" },
    // свои папки — под ней, у каждой крестик «Убрать папку» (Грегори 2026-11-11: раздел папок в настройках
    // закомментирован — убрать было негде); снимки на диске не трогаются
    ...(needsAccess ? [] : dirs.map((d, i) => ({ id: `#dir:${i}`, icon: FOLDER_ICON, title: d.name, hint: "Своя папка со снимками",
      remove: { title: `Убрать папку «${d.name}»`, fn: () => confirm(`Убрать папку «${d.name}» из альбомов? Снимки на диске останутся.`)
        && forgetFolder(d, () => isOpen("albums") && !currentCountry && renderList(null)) } })))];
  const list = countries().map(([name, n]) => ({ id: name, title: `${name} (${n})`, thumb: flagUrl(isoOf(name)) || "",
    icon: isoOf(name) ? "" : ICON, selected: currentCountry === name && isOpen("albums") }));
  return [...folder, ...(list.length || !loading ? list : [{ id: "", title: busy ? "Читаю альбомы…" : "Альбомов пока нет", icon: ICON }])];
}
// окно выбора папки — прямо по нажатию (иначе браузер его не откроет); после выбора — снова список стран
function chooseItem(country) {
  if (country?.startsWith("#dir:")) return; // строка своей папки — только крестик «Убрать»
  if (country === "#folder") { (dirs.length && needsAccess ? askAccess() : pickFolder()).then(() => isOpen("albums") && !currentCountry && renderList(null)); return; }
  if (country) openCountry(country);
}

function openCountry(country) {
  renderList(country);
  panel.body.scrollTop = 0;
  panel.open();
  setSearchMode(MODE);
  showOnMap(true);
  emit("module", { id: "content/albums", on: true });
}

// «Мои треки» открыли панель — им нужны треки альбомов (папки обходятся, если ещё нет)
on("album-tracks-wanted", ({ ctx: c }) => { ctx = c; wire(); load(c).catch(() => {}); }, { replay: false });
// из трека — назад в его альбом
on("album-open", async ({ id, ctx: c }) => {
  ctx = c;
  wire();
  await load(c).catch(() => {});
  const a = albums.get(id);
  if (!a) return;
  openCountry(countryOf(topOf(a)));
  openAlbumById(id);
}, { replay: false });

panel.onClose(() => {
  dupView = false;
  dupRun++;
  dups = null;
  openAlbum = null;
  openGroup = null;
  currentCountry = null;
  searchText = "";
  showOnMap(false);
  if (searchMode() === MODE) setSearchMode(null);
  emit("module", { id: "content/albums", on: false });
});

let wired = false;
function wire() {
  if (wired || !ctx) return;
  wired = true;
  const map = ctx.map;
  map.on("style.load", () => { if (shown) { addLayers(); refresh(); } });
  map.on("moveend", wantInView);
  map.on("click", (e) => {
    if (!shown) return;
    const f = map.queryRenderedFeatures(e.point, { layers: LAYERS.filter((id) => map.getLayer(id)) })[0];
    if (!f) return;
    if (f.properties.album) { const a = albums.get(f.properties.album); if (a) { renderList(countryOf(topOf(a))); openAlbumById(a.id); } return; }
    if (f.properties.cluster) {
      map.getSource("albums-photos").getClusterExpansionZoom(f.properties.cluster_id)
        .then((zoom) => map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom, 19) })).catch(() => {});
      return;
    }
    const p = photos.get(f.properties.photo);
    // на телефоне касание снимка, чьё окно уже открыто, — галерея (окно ещё не закрылось: этот обработчик раньше)
    if (p && touchUI() && popupPhoto === p.id) { gallery(p.album, p.id); return; }
    if (p) showPhoto(p);
  });
  // двойной щелчок по снимку — его альбом в галерее, карта не приближается
  map.on("dblclick", (e) => {
    const f = shown && map.queryRenderedFeatures(e.point, { layers: ["albums-thumbs", "albums-dots"].filter((id) => map.getLayer(id)) })[0];
    const p = f && photos.get(f.properties.photo);
    if (!p) return;
    e.preventDefault();
    gallery(p.album, p.id);
  });
}

register({
  id: "content/albums",
  kind: "content",
  title: "Мои альбомы",
  tone: "my",
  hint: "Свои снимки по альбомам: на карте, в ленте и в галерее",
  icon: ICON,
  sends: "чтение альбомов папки «Альбомы» (GitHub, сайт travel-earth), флаги (flagcdn); снимки с компьютера никуда не уходят",
  column: {
    // кнопка раздела — панель со списком стран
    home: (c) => {
      ctx = c;
      wire();
      currentCountry = null;
      openCountry(null);
      load(c).then(() => isOpen("albums") && !currentCountry && !openAlbum && !openGroup && renderList(null)).catch(() => {});
    },
    load: (c) => { ctx = c; wire(); return load(c); },
    items: countryItems,
    choose: (country, c) => { ctx = c; wire(); chooseItem(country); },
    isOpen: () => isOpen("albums"),
    close: () => panel.close(),
  },
  // раздел папок в настройках убран (Грегори 2026-11-09: «убираем из настроек… указания на папку»,
  // «закомментируй»): папка добавляется первой строкой списка альбомов
  // settings: settingsSection,
  // для проверки
  stats: () => ({ albums: albums.size, tracks: [...albums.values()].reduce((n, a) => n + a.tracks.length, 0), groups: groups.size, photos: photos.size, located: located().length, thumbs: [...photos.values()].filter((p) => p.thumb).length,
    countries: countries().map(([n, k]) => `${n}:${k}`), busy, shown, dups: dups && { busy: dups.busy, same: dups.same.length, like: dups.like.length, view: dupView }, open: openAlbum?.title || openGroup?.title || null, country: currentCountry }),
  pickFolder: () => pickFolder(),
  forgetFolder: (name) => forgetFolder(dirs.find((d) => d.name === name)),
  openFirst: (title) => { const a = [...albums.values()].find((x) => !title || x.title === title); if (!a) return false; openCountry(countryOf(a)); openAlbumById(a.id); return true; },
});

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
import { trackIcon, FOLDER_ADD_D, GLOBE_D, PLUS_D, sortButton } from "../core/icons.js";
import * as settings from "../core/settings.js";
import { createPanel, isOpen, homeList } from "../core/panel.js";
import { repoFiles, repoUrl } from "../core/repo.js";
import { flagUrl } from "../core/flags.js";
import { countryAt } from "../core/borders.js";
import { emit, on } from "../core/events.js";
import { parseFile } from "./track-file.js";
import { readMeta, exifr } from "./albums-meta.js";
import { parseStory, decode } from "./albums-story.js";
import { setSearchMode, searchMode } from "../core/search.js";
import { cacheGet, cacheSet, cacheDelete } from "../core/storage.js";
import { track, claimLayers } from "../core/popups.js";
import { setStripItems, selectStripItem, openGalleryWith, touchUI } from "../core/photo-strip.js";
import { PLAYER } from "../core/player.js";
import { HEIC_RE, heicBitmap, heicViewable } from "../core/heic.js";

const svg = (d, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`;
const STACK_D = "M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4 2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z";
const CAMERA_D = "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z";
const ICON = svg(STACK_D);
// строка «Открыть папку…» в списке — тот же плюс, что «Открыть файл…» у треков
const OPEN_ICON = svg(PLUS_D);
const FOLDER_ICON = svg("M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z");
const BACK = svg("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z", 20);
const COLOR = "#7c4dff"; // --tone-my
const VIDEO_RE = /\.(mov|mp4|m4v)$/i;
const MEDIA_RE = /\.(jpe?g|webp|png|heic|heif|mov|mp4|m4v)$/i; // HEIC — снимки iPhone (core/heic.js)
// трек поездки лежит с её снимками (Грегори 2026-11-08: «сканировать папку с фото на наличие .GPX и
// хранить их с фотографиями»; папка может быть и только с треком) — на карте линией, в шапке альбома —
// «Просмотр трека» (открывает «Мои треки», стрелка оттуда — назад в альбом)
const TRACK_RE = /\.gpx$/i;
// рассказ альбома — текстовый файл в его папке (.txt, .md; «_…» — служебные, не читаются)
const TEXT_RE = /^[^_].*\.(txt|md)$/i;
// «Рассказ» альбома — раскрытая книга (тот же значок — в галерее)
const STORY_ICON = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 6.5C10.2 5.2 7.6 4.6 3 4.8v13.6c4.6-.2 7.2.4 9 1.7 1.8-1.3 4.4-1.9 9-1.7V4.8c-4.6-.2-7.2.4-9 1.7zm0 0v13.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6 9h3M6 12h3M15 9h3M15 12h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
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
// что сейчас делает обход — строкой над списком, она меняется на месте, список не перестраивается (Грегори 2026-11-27:
// «Если зайти в большую папку то не видна процесса сканирования. Все висит и мигает»): обход папок, место каждого
// альбома (до 25 снимков), даты и места всех снимков — в фоне, ближние к карте первыми
let phase = { step: "", done: 0, total: 0 };
function progress() {
  if (phase.step === "walk") { let d = 0, f = 0; for (const x of found.values()) { d += x.dirs; f += x.files; } return `Обхожу папки… папок ${d}, снимков ${f}`; }
  if (phase.step === "probe") return `Ищу, где сняты альбомы… ${phase.done} из ${phase.total}`;
  if (phase.step === "finish") return `Читаю даты и места всех снимков… альбомов ${phase.done} из ${phase.total}, снимков ${checked}`;
  return "Читаю альбомы…";
}
const canFolders = () => "showDirectoryPicker" in window && !isMobile();
// папки галереи телефона — альбомы (Грегори 2026-11-24: «показывать»; приложение 1.9 — AtlasPhotos.all/place):
// снимки — по адресам https://phone.invalid/… (Photos.java), место — из EXIF по одному снимку
const PHONE = "https://phone.invalid/", PHONE_ROOT = "Телефон";
const phoneApp = () => typeof window.AtlasPhotos?.all === "function";
const phoneAccess = () => { try { return AtlasPhotos.access(); } catch { return "none"; } };

function addAlbum(path, name, local, files, tracks = [], texts = []) {
  const a = { id: path, name, title: displayName(name), local, parent: null, photos: [], point: null, country: undefined, cover: null, from: 0, to: 0, done: false, texts, story: null,
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
  if (texts.length) loadStory(a);
}

async function listRepo() {
  const by = new Map(), texts = new Map();
  for (const f of (await repoFiles("Альбомы")).filter((f) => (MEDIA_RE.test(f.name) || TEXT_RE.test(f.name)) && !f.path.includes("/["))) {
    const d = f.path.slice(0, f.path.lastIndexOf("/"));
    if (TEXT_RE.test(f.name)) { if (!texts.has(d)) texts.set(d, []); texts.get(d).push({ name: f.name, url: repoUrl(f) }); continue; }
    if (!by.has(d)) by.set(d, []);
    by.get(d).push({ name: f.name, path: f.path, url: repoUrl(f), key: `exif/${f.sha}` });
  }
  for (const [d, files] of by) addAlbum(d, d.split("/").pop(), false, files, [], texts.get(d) || []);
}

function listPhone() {
  if (!phoneApp() || phoneAccess() === "none") return;
  let list;
  try { list = JSON.parse(AtlasPhotos.all()); } catch { return; }
  const by = new Map();
  for (const x of list) { const k = x.folder || "Без папки"; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  for (const [name, xs] of by) {
    addAlbum(`${PHONE_ROOT}/${name}`, name, false, xs.map((x) => {
      const [kind, n] = x.id.split(":");
      return { name: x.name, path: `${PHONE_ROOT}/${name}/${x.name}`, url: `${PHONE}full/${kind}/${n}`, thumbUrl: `${PHONE}thumb/${kind}/${n}`,
        phone: x.id, at: x.at, key: `exif/phone/${x.id}|${x.at}` };
    }));
  }
}

// своя папка: альбом — каждая папка, где есть снимки (подпапки — свои альбомы); «[Originals]» —
// исходники поправленных снимков, повторы — пропускаются
async function walk(handle, path, token, root) {
  const files = [], dirs = [], proxies = new Map(), tracks = [], texts = [];
  try {
    for await (const [name, h] of handle.entries()) {
      if (h.kind === "directory") { if (!/^[._[]/.test(name)) dirs.push([name, h]); }
      else if (MEDIA_RE.test(name)) files.push({ name, path: `${path}/${name}`, handle: h, root });
      else if (TRACK_RE.test(name)) tracks.push({ name, path: `${path}/${name}`, handle: h, root, dir: handle });
      else if (TEXT_RE.test(name)) texts.push({ name, handle: h });
      else if (/^GL\d{6}\.LRV$/i.test(name)) proxies.set(name.slice(2, 8), h);
    }
  } catch (e) {
    // корень своей папки не читается — сказать в списке, а не молчать «Альбомов пока нет»
    if (handle === root) scanErr = `Папка «${handle.name}» не читается (${e?.name || e}) — повторить`;
    else if (found.has(root)) found.get(root).bad++;
    return;
  }
  if (token !== scan) return;
  const st = found.get(root);
  if (st) { st.dirs++; st.files += files.length; refresh(); }
  // GoPro: рядом с роликом GX011479.MP4 (4K, сотни МБ) — его уменьшенная копия GL011479.LRV (640×480);
  // кадр для клетки берётся из неё — быстро; играет в галерее сам ролик
  for (const f of files) { const m = /^G[HX](\d{6})\.MP4$/i.exec(f.name); if (m && proxies.has(m[1])) f.proxy = proxies.get(m[1]); }
  if (files.length || tracks.length) addAlbum(path, handle.name, true, files, tracks, texts);
  for (const [name, h] of dirs.sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true }))) await walk(h, `${path}/${name}`, token, root);
}

// ---------- рассказ альбома (подписи-экскурсии, как в travel-earth, Грегори 2026-09-30: «положить текстовые
// файлы в альбомы как экскурсии») ----------
// разбор и формат файлов — content/albums-story.js
function loadStory(a) {
  return (a.storyLoad ??= Promise.all(a.texts.map(async (t) => {
    const bytes = t.handle ? await (await t.handle.getFile()).arrayBuffer() : await fetch(t.url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))));
    return [t.name, decode(bytes)];
  })).then((texts) => {
    a.story = parseStory(texts, a.photos.map((id) => photos.get(id).name));
    // открыт альбом или его поездка — кнопка «Рассказ» становится активной
    if (a.story && isOpen("albums") && !dupView) { if (openAlbum === a) renderAlbum(); else if (openGroup && a.id.startsWith(`${openGroup.id}/`)) renderGroup(true); }
    return a.story;
  }).catch(() => null));
}
// подпись снимка из рассказа его альбома
const captionOf = (p) => p.album.story?.captions.get(p.name.toLowerCase()) || "";
// рассказы для галереи: у поездки — рассказы её альбомов по порядку; снимок рассказа — номер снимка
function storiesOf(x) {
  const list = (x.group ? tally(x).list.filter((a) => a.title !== "Избранное") : [x]).filter((a) => a.story);
  return list.map((a) => {
    const id = new Map(a.photos.map((pid) => [photos.get(pid).name.toLowerCase(), pid]));
    return { title: a.story.title || a.title, blocks: a.story.blocks.map((b) => (b.type === "photo" ? { ...b, id: id.get(b.file.toLowerCase()) } : b)).filter((b) => b.type !== "photo" || b.id) };
  });
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
let noExif = false, scanErr = ""; // scanErr — почему обход своей папки не удался (строкой в списке)
// что нашёл обход в каждой своей папке — в её строке списка (Грегори 2026-11-24: папка добавлена, а «Альбомов пока нет»
// без объяснений): папки → { dirs: прочитано папок, files: снимков и роликов, bad: не открылось папок, done }
const found = new Map();
// место и дата снимка — один раз (content/albums-meta.js); программа чтения не загрузилась — без них
async function exifOf(p) {
  if (p.rec) return p.rec;
  p.rec = await readMeta(p, noExif);
  checked++;
  return p.rec;
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
  file: t.name, handle: t.handle, dir: t.dir, root: t.root, albumId: a.id, albumTitle: trackTitle(a),
  where: () => pathText(`${a.id}/${t.name}`), copy: () => copyPath(t.root, a.id.split("/").slice(1)) }))));
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

// ошибка обхода — строкой в списке «… — повторить» (Грегори 2026-11-24: «после добавления папки она просто не сканируется»)
async function rescan() {
  scanErr = "";
  try { await scanAll(); } catch (e) { busy = false; scanErr = `Альбомы не прочитались (${e?.message || e}) — повторить`; refresh(); }
}
async function scanAll() {
  const token = ++scan;
  albums.clear();
  groups.clear();
  photos.clear();
  checked = 0;
  busy = true;
  refresh();
  // программа чтения снимков не загрузилась — альбомы всё равно в списке («Без страны»), строкой «Повторить»
  found.clear();
  for (const d of dirs) found.set(d, { dirs: 0, files: 0, bad: 0, done: false });
  // программа чтения снимков не ответила за 20 с — тоже «не загрузилась»: обход не ждёт её вечно
  noExif = await Promise.race([exifr(), new Promise((_, no) => setTimeout(no, 20000))]).then(() => false, () => true);
  if (noExif) ctx?.status("Не загрузилась программа чтения снимков — места и даты не прочитаны");
  await listRepo().catch(() => {});
  listPhone();
  nest("Альбомы");
  phase = { step: "walk", done: 0, total: 0 };
  if (!needsAccess) for (const d of dirs) { await walk(d, d.name, token, d); if (token !== scan) return; found.get(d).done = true; refresh(); }
  if (token !== scan) return;
  for (const d of dirs) nest(d.name);
  sendTracks();
  phase = { step: "probe", done: 0, total: albums.size };
  for (const a of albums.values()) {
    phase.done++;
    refresh();
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
      phase = { step: "finish", done: albums.size - rest.length, total: albums.size };
      if (!rest.length) break;
      const c = ctx?.map.getCenter();
      const dist = (a) => (a.point && c ? Math.hypot(a.point[0] - c.lng, a.point[1] - c.lat) : 1e9);
      await finish(rest.reduce((x, y) => (dist(y) < dist(x) ? y : x)));
      refresh();
    }
    busy = false;
    phase = { step: "", done: 0, total: 0 };
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
  })().catch((e) => { loading = null; busy = false; scanErr = `Альбомы не прочитались (${e?.message || e}) — повторить`; refresh(); });
  return loading;
}

// в столбике и в списке страны — альбомы и поездки верхнего уровня
const tops = () => [...groups.values(), ...albums.values()].filter((x) => !x.parent);
// первый уровень — откуда альбомы: свои папки, «Альбомы» сайта, галерея телефона; каждая — отдельно: свои страны,
// свои дубликаты, на карте — только её альбомы (Грегори 2026-11-26: «добавленные папки должны определять первый
// уровень группировки, и работать отдельно»). Источник один — сразу его страны
const SITE_ROOT = "Альбомы";
const rootOf = (x) => x.id.split("/")[0];
let currentRoot = null;
const sources = () => [...dirs.map((d) => d.name), ...[SITE_ROOT, PHONE_ROOT].filter((r) => tops().some((x) => rootOf(x) === r))];
const root = () => { if (currentRoot) return currentRoot; const s = sources(); return s.length === 1 ? s[0] : null; };
const under = (r) => (x) => !r || rootOf(x) === r;
const rootTitle = (r) => (r === SITE_ROOT ? "Альбомы сайта" : r);
const countries = () => {
  const by = new Map(), mine = under(root());
  for (const a of tops().filter(mine)) { const k = countryOf(a); by.set(k, (by.get(k) || 0) + 1); }
  // «Без страны» — первой, остальные по алфавиту
  return [...by].sort((x, y) => (y[0] === NO_COUNTRY) - (x[0] === NO_COUNTRY) || x[0].localeCompare(y[0], "ru"));
};
const isoOf = (name) => [...albums.values()].find((a) => a.country?.name === name)?.country.iso || "";

// ---------- миниатюры: по две за раз, только нужные ----------
const queue = [];
let working = 0;
const fileOf = async (p) => (p.handle ? p.handle.getFile() : (await fetch(p.url)).blob());
// first — клетка на экране: вперёд очереди (иначе в большой папке она ждёт, пока сделаются миниатюры для карты)
function thumbOf(p, first = false) {
  if (p.thumbing) {
    const i = first ? queue.findIndex((q) => q[0] === p) : -1;
    if (i > 0) queue.unshift(...queue.splice(i, 1));
    return p.thumbing;
  }
  p.thumbing = new Promise((resolve) => { if (first) queue.unshift([p, resolve]); else queue.push([p, resolve]); pump(); });
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
// HEIC в Chrome раскрывает декодер — около секунды на снимок: готовая миниатюра 480 px помнится на устройстве
// (`thumb/<ключ снимка>`, файл поменялся — ключ другой), второй раз альбом открывается сразу
async function heicThumb(p) {
  const file = await fileOf(p);
  const key = `thumb/${p.handle ? `local/${p.path}|${file.size}|${file.lastModified}` : p.key}`;
  const hit = await cacheGet(key).catch(() => null);
  if (hit instanceof Blob) return createImageBitmap(hit);
  const bmp = await heicBitmap(file, { resizeWidth: 480, resizeQuality: "medium" });
  const c = Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
  c.getContext("2d").drawImage(bmp, 0, 0);
  c.toBlob((b) => b && cacheSet(key, b).catch(() => {}), "image/jpeg", 0.85);
  return bmp;
}
async function makeThumb(p) {
  // поворот из EXIF браузер учитывает сам (imageOrientation по умолчанию — from-image)
  const bmp = p.thumbUrl ? await createImageBitmap(await fetch(p.thumbUrl).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status)))))
    : p.video ? await frameOf(p.proxy ? await p.proxy.getFile() : await fileOf(p)).catch((err) => { p.noFrame = true; throw err; })
    : HEIC_RE.test(p.name) ? await heicThumb(p)
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
  if (f.url) return HEIC_RE.test(f.name) && !f.phone ? fullOf({ ...f, url: "", handle: { getFile: () => fileOf(f) } }, id) : f.url;
  const hit = fulls.find((x) => x.id === id);
  if (hit) return hit.url;
  const file = await f.handle.getFile();
  const url = URL.createObjectURL(HEIC_RE.test(f.name) ? await heicViewable(file) : file);
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
  onMap().filter((p) => !p.thumb && b.contains([p.rec.lon, p.rec.lat]))
    .sort((x, y) => Math.hypot(x.rec.lon - c.lng, x.rec.lat - c.lat) - Math.hypot(y.rec.lon - c.lng, y.rec.lat - c.lat))
    .slice(0, 60).forEach(thumbOf);
}

// ---------- карта ----------
let shown = false, frame = 0;
const pt = (p) => [p.rec.lon, p.rec.lat];
const located = () => { const mine = under(root()); return [...photos.values()].filter((p) => p.rec?.lat && mine(p.album)); };
// открыт альбом или поездка — на карте только они (Грегори 2026-11-25: «после выбора альбома на карте оставался
// только один альбом со всеми фотками»): их снимки, их треки, без значков других альбомов
const focus = () => openAlbum || openGroup;
const focusAlbums = () => { const x = focus(); return x ? (x.group ? tally(x).list : [x]) : [...albums.values()].filter(under(root())); };
const onMap = () => { const x = focus(); if (!x) return located(); const ids = new Set(photosOf(x)); return located().filter((p) => ids.has(p.id)); };
const fc = (features) => ({ type: "FeatureCollection", features });
const albumData = () => fc((focus() ? [] : [...albums.values()].filter(under(root()))).filter((a) => a.point).map((a) => ({ type: "Feature", geometry: { type: "Point", coordinates: a.point },
  properties: { album: a.id, title: a.title } })));
const dotData = () => fc(onMap().map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: pt(p) }, properties: { photo: p.id } })));
const thumbData = () => fc(onMap().filter((p) => p.img).map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: pt(p) }, properties: { photo: p.id, img: p.img } })));
const font = (map) => map.getStyle().layers.find((l) => l.type === "symbol" && Array.isArray(l.layout?.["text-font"]))?.layout["text-font"] || ["Noto Sans Regular"];
const trackData = () => fc(focusAlbums().flatMap((a) => a.tracks.flatMap((t) => (t.parsed?.segs || []).filter((s) => s.length > 1)
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
function drawMap() {
  if (!shown || !ctx) return;
  ctx.map.getSource("albums")?.setData(albumData());
  ctx.map.getSource("albums-photos")?.setData(dotData());
  ctx.map.getSource("albums-thumbs")?.setData(thumbData());
  ctx.map.getSource("albums-tracks")?.setData(trackData());
  setStripItems("albums", onMap().filter((p) => p.thumb).map(stripItem));
}
// пока читаются снимки — строка хода меняется сразу, карта и список — не чаще раза в 1,5 с, не под нажатием и только
// если в них что-то изменилось
let lastDraw = 0, drawLater = 0, pressing = false;
function refresh() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    for (const el of panel.body.querySelectorAll(".al-progress")) el.textContent = progress();
    const wait = busy ? 1500 - (performance.now() - lastDraw) : 0;
    clearTimeout(drawLater);
    if (wait > 0 || pressing) { drawLater = setTimeout(refresh, Math.max(wait, 300)); return; }
    lastDraw = performance.now();
    drawMap();
    if (isOpen("albums") && !openAlbum && !searchText && !dupView && !waitingFor) { if (openGroup) renderGroup(true, true); else renderList(currentCountry, "", true); }
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

// снимок на карте — его альбом в панели, клетка выделена и прокручена к середине; карта стоит (Грегори 2026-11-27:
// «Нужно что бы при клике на карте фокус прыгал в этот альбом в панели»)
function focusPhoto(p) {
  if (openAlbum !== p.album) { currentRoot = rootOf(p.album); currentCountry = countryOf(topOf(p.album)); openAlbumById(p.album.id, false); }
  tappedCell = p.id;
  const cell = [...panel.body.querySelectorAll(".al-cell")].find((c) => c.dataset.id === p.id);
  if (!cell) return;
  if (cell.parentElement.hidden) cell.parentElement.previousElementSibling?.click(); // свёрнутый день — раскрыть
  for (const c of panel.body.querySelectorAll(".al-cell.focus")) c.classList.remove("focus");
  cell.classList.add("focus");
  cell.scrollIntoView({ block: "center", behavior: "smooth" });
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
// story — сразу с открытым рассказом (кнопка «Рассказ» альбома)
function gallery(a, startId, play = false, story = false) {
  const ids = photosOf(a);
  openGalleryWith(ids.map((id) => galleryItem(photos.get(id))), startId || ids[0], media, { play, story: storiesOf(a), storyOpen: story });
}
const galleryItem = (p) => ({ id: p.id, thumb: p.thumb, full: p.url, title: p.album.title, caption: captionOf(p), credit: [photoDate(p), p.name].filter(Boolean).join(" · "),
  coordinates: p.rec?.lat ? pt(p) : null, video: p.video, live: !!p.live, heic: HEIC_RE.test(p.name), edit: editInfo(p) });

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

// палец или кнопка мыши нажаты в панели — список под ними не перестраивается
panel.body.addEventListener("pointerdown", () => { pressing = true; });
for (const t of ["pointerup", "pointercancel"]) addEventListener(t, () => { pressing = false; });

// миниатюра, которая сама просит картинку, когда видна; запас — по прокрутке панели (по окну он обрезался краем
// панели: клетки чуть ниже видимых не готовились заранее и при прокрутке появлялись пустыми)
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    seen.unobserve(e.target);
    const p = photos.get(e.target.dataset.photo);
    if (p) thumbOf(p, true).then((src) => { if (src) e.target.src = src; else if (p.noFrame) noFrame(e.target, p); });
  }
}, { root: panel.body, rootMargin: "200px" });
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
// своя папка со снимками — значком в шапке (Грегори 2026-11-26), видна в списках, не в альбоме
const addBtn = panel.addButton(svg(FOLDER_ADD_D), "Добавить папку…", () => addFolder());
// порядок альбомов по дате: сначала новые или сначала старые; без даты — всегда в конце
// группировка по странам — как в «Моих треках»; выключена — все альбомы папки одним списком по дате
// (Грегори 2026-11-26: «кнопки группировки не вижу»)
let byCountry = settings.get("albums.flat") !== true;
const groupBtn = panel.addButton(svg(GLOBE_D), "", () => {
  byCountry = !byCountry;
  settings.set("albums.flat", byCountry ? null : true);
  currentCountry = null;
  renderList(null);
  panel.body.scrollTop = 0;
});
let oldFirst = settings.get("albums.oldFirst") === true;
const sortBtn = panel.addButton("", "", () => { oldFirst = !oldFirst; settings.set("albums.oldFirst", oldFirst || null); sortButton(sortBtn, oldFirst); rerender(); });
sortButton(sortBtn, oldFirst);
function setFold(items, sortable = false, groupable = false) {
  foldItems = items;
  addBtn.hidden = !canFolders() || dupView || !!openAlbum || !!openGroup;
  addBtn.title = needsAccess && dirs.length ? accessTitle() : "Добавить папку…";
  sortBtn.hidden = !sortable;
  groupBtn.hidden = !groupable;
  groupBtn.classList.toggle("on", byCountry);
  groupBtn.title = byCountry ? "Разгруппировать" : "Сгруппировать по странам";
  // дубликаты — в открытой своей папке, в «Все папки» — во всех своих папках (Грегори 2026-11-27: «Дубликаты нужно
  // искать в указанной папке (в окне все папки) во всех папках»)
  const r = root();
  dupBtn.hidden = dupView || ![...photos.values()].some((p) => p.handle && under(r)(p.album));
  dupBtn.title = r ? "Найти дубликаты снимков" : "Найти дубликаты снимков во всех папках";
  panel.setIcon(dupView ? FIND_DUPS : undefined);
  const all = allFolders(items), open = all.length > 0 && all.every((g) => expanded.has(g.id));
  foldBtn.hidden = !all.length;
  foldBtn.innerHTML = open ? FOLD : UNFOLD;
  foldBtn.title = open ? "Свернуть все папки" : "Раскрыть все папки";
}

// стрелка назад — в поездку, где лежит альбом, иначе к списку страны
function backBtn(x) {
  const g = x.parent && groups.get(x.parent);
  return btn(BACK, g ? `К поездке: ${g.title}` : `К альбомам: ${byCountry ? countryOf(x) : rootTitle(rootOf(x))}`, () => {
    if (g) openGroupById(g.id);
    else { currentCountry = byCountry ? countryOf(x) : null; renderList(null); }
    panel.body.scrollTop = 0;
  });
}

function accessRow() {
  const b = h("button", "text-btn al-access", accessTitle());
  b.addEventListener("click", askAccess);
  return b;
}

let listSig = "";
function renderList(country, query = "", quiet = false) {
  const was = openAlbum || openGroup;
  if (!quiet) waitingFor = null;
  openAlbum = null;
  openGroup = null;
  dupView = false;
  currentCountry = country ?? currentCountry;
  searchText = query;
  if (was) drawMap();
  const q = query.toLowerCase();
  const r = root(), mine = under(r), many = sources().length > 1;
  // в папке без группировки — все её альбомы одним списком
  const flat = !q && !!r && !byCountry && !currentCountry;
  const from = (x) => (x.group ? tally(x).from : x.from) || (oldFirst ? Infinity : 0);
  const list = (q ? [...groups.values(), ...albums.values()] : tops()).filter(mine)
    .filter((a) => (q ? [a.title, a.name, a.id, countryOf(a)].join(" ").toLowerCase().includes(q) : flat || countryOf(a) === currentCountry))
    .sort((x, y) => (oldFirst ? from(x) - from(y) : from(y) - from(x)) || x.title.localeCompare(y.title, "ru"));
  const upBtn = () => btn(BACK, "Все папки", () => { currentRoot = null; currentCountry = null; renderList(null); drawMap(); panel.body.scrollTop = 0; });
  const bar = (b) => { const x = h("div", "pb-bar"); x.append(b); return x; };
  // папка не выбрана — папки (первый уровень); в папке — её страны, у списка страны — стрелка к ним
  if (!q && !currentCountry && !flat) {
    const items = countryItems(), sig = ["home", r, busy, ...items.map((x) => x.title)].join("|");
    // обход дошёл до нового альбома, а строки те же — список стоит (не мигает, нажатие не теряется)
    if (quiet && sig === listSig) return;
    listSig = sig;
    panel.setTitle(r ? rootTitle(r) : "Мои альбомы");
    setFold([], false, !!r);
    panel.body.replaceChildren(...(r && currentRoot && many ? [bar(upBtn())] : []), ...(busy ? [h("p", "pb-hint al-progress", progress())] : []),
      homeList(items, chooseItem));
    return;
  }
  const sig = ["list", r, q, currentCountry, busy, needsAccess, ...list.map((x) => `${x.id}:${from(x)}:${x.group ? tally(x).photos : x.photos.length}`)].join("|");
  if (quiet && sig === listSig) return;
  listSig = sig;
  panel.setTitle(q ? "Найденные альбомы" : flat ? rootTitle(r) : currentCountry);
  const nodes = [];
  if (!q && (!flat || many)) nodes.push(bar(flat ? upBtn()
    : btn(BACK, r && many ? `Страны: ${rootTitle(r)}` : "Все страны", () => { currentCountry = null; renderList(null); panel.body.scrollTop = 0; })));
  if (needsAccess && dirs.length) nodes.push(accessRow());
  if (busy) nodes.push(h("p", "pb-hint al-progress", progress()));
  if (q && !list.length) nodes.push(h("p", "pb-hint", "Ничего не нашлось"));
  setFold(list, list.length > 1, !q && !!r);
  nodes.push(...rows(list));
  const keep = panel.body.scrollTop;
  panel.body.replaceChildren(...nodes);
  panel.body.scrollTop = keep;
}

// поездка — в той же панели: назад, ▶ все снимки поездки, даты, её альбомы по порядку папок
function renderGroup(keepScroll, quiet = false) {
  const g = openGroup, t = tally(g);
  const sig = ["group", g.id, t.photos, t.from, t.to, ...kidsOf(g).map((x) => x.id)].join("|");
  if (quiet && sig === listSig) return;
  listSig = sig;
  panel.setTitle(g.title);
  const bar = h("div", "pb-bar");
  const left = h("div", "tr-bar-left");
  left.append(backBtn(g), btn(PLAYER.play, "Слайд-шоу всей поездки", () => gallery(g, null, true)), storyBtn(g));
  bar.append(left);
  const lands = [...new Set(t.list.map((a) => a.country?.name).filter(Boolean))];
  const facts = h("div", "tr-facts al-facts", [`${t.photos} фото`, dates(t), lands.join(", "), g.local ? "на этом компьютере" : ""].filter(Boolean).join(" · "));
  const keep = panel.body.scrollTop;
  const kids = kidsOf(g);
  setFold(kids);
  panel.body.replaceChildren(bar, facts, pathRow(g), ...rows(kids));
  panel.body.scrollTop = keepScroll ? keep : 0;
}

function openGroupById(id) {
  const g = groups.get(id);
  if (!g) return;
  openAlbum = null;
  openGroup = g;
  dupView = false;
  renderGroup();
  drawMap();
  fitAlbum(g);
}

// «Рассказ» — галерея с рассказом альбома справа; рассказа нет — кнопка видна, неактивна и говорит, как его сделать
function storyBtn(x) {
  const has = storiesOf(x).length > 0;
  const b = btn(STORY_ICON, has ? "Рассказ: снимки с подписями" : "Рассказа нет. Положите в папку альбома текстовый файл (.txt): имя снимка строкой, под ним — подпись",
    () => gallery(x, null, false, true));
  b.disabled = !has;
  b.classList.add("al-story");
  return b;
}

function renderAlbum() {
  const a = openAlbum;
  panel.setTitle(a.title);
  setFold([]);
  const bar = h("div", "pb-bar");
  const left = h("div", "tr-bar-left");
  const play = btn(PLAYER.play, "Слайд-шоу альбома", () => gallery(a, null, true));
  play.disabled = !a.photos.length;
  // открыли из трека — стрелка назад в него (Грегори 2026-11-27: «И назад в трек не попасть»)
  const tb = fromTrack?.album === a.id ? btn(BACK, `Назад в трек «${fromTrack.name}»`, () => emit("track-open", { key: fromTrack.key, ctx, album: { id: a.id, title: a.title } })) : null;
  left.append(tb || backBtn(a), play, storyBtn(a));
  // трек из папки альбома — в «Моих треках», стрелка оттуда — назад сюда
  for (const t of a.tracks) {
    const b = btn(trackIcon(20), `Просмотр трека «${t.name.replace(/\.\w+$/, "")}»`, () => emit("track-open", { key: t.key, ctx, album: { id: a.id, title: a.title } }));
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
    const cell = h("button", "al-cell" + (id === tappedCell ? " focus" : ""));
    cell.dataset.id = id;
    cell.title = [captionOf(p), photoDate(p), p.name].filter(Boolean).join(" · ");
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
      for (const c of panel.body.querySelectorAll(".al-cell.focus")) c.classList.toggle("focus", c === cell);
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
  panel.body.replaceChildren(bar, facts, pathRow(a), ...(iphone ? [noClipHint()] : []), ...blocks);
  // заново (дочитаны даты) — прокрутка на месте
  panel.body.scrollTop = keep;
  renderedAlbum = openAlbum;
}
const shutDays = new Set(); // свёрнутые дни: «альбом|день», пока открыта страница
let renderedAlbum = null;

function openAlbumById(id, fit = true) {
  const a = albums.get(id);
  if (!a) return;
  if (openAlbum !== a) tappedCell = null;
  openAlbum = a;
  openGroup = null;
  dupView = false;
  renderedAlbum = null; // открыли заново — с начала
  renderAlbum();
  drawMap();
  if (fit) fitAlbum(a);
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
  const file = await p.handle.getFile(), size = { resizeWidth: 9, resizeHeight: 8, resizeQuality: "high" };
  const bmp = HEIC_RE.test(p.name) ? await heicBitmap(file, size) : await createImageBitmap(file, size);
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
  const r = root();
  const list = [...photos.values()].filter((p) => p.handle && under(r)(p.album) && p.album.title !== "Избранное");
  dups = { busy: true, scan, root: r, step: "", done: 0, total: 0, same: [], like: [], keep: new Map(), moving: 0 };
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
// где лежит: поездка, альбом; искали во всех папках — и своя папка
function placeOf(a) {
  const parts = [a.title];
  for (let g = a.parent && groups.get(a.parent); g; g = g.parent && groups.get(g.parent)) parts.unshift(g.title);
  if (dups && !dups.root && dirs.length > 1) parts.unshift(rootOf(a));
  return parts.join(" / ");
}

function openDups() {
  dupView = true;
  openAlbum = null;
  openGroup = null;
  if (!dups || dups.root !== root() || (!dups.busy && dups.scan !== scan)) findDups(); else renderDups();
  panel.body.scrollTop = 0;
}

function renderDups() {
  if (!dupView || !dups) return;
  // идёт поиск — меняется только строка счёта: панель не перестраивается каждые 25 снимков, и стрелка «К альбомам»
  // успевает нажаться (Грегори 2026-11-26: «этот режим забирает на себя всё управление и не позволяет из него выйти»)
  const progress = dups.busy && panel.body.querySelector(".al-dup-progress");
  if (progress) { progress.textContent = `${dups.step}… ${dups.done} из ${dups.total}`; return; }
  panel.setTitle(sources().length > 1 ? (dups.root ? `Дубликаты: ${rootTitle(dups.root)}` : "Дубликаты во всех папках") : "Дубликаты");
  setFold([]);
  const bar = h("div", "pb-bar");
  bar.append(btn(BACK, "К альбомам", () => { renderList(currentCountry); panel.body.scrollTop = 0; }));
  // в шапке — ссылки на разделы (Грегори 2026-11-08); шапка не уезжает при прокрутке
  const links = h("div", "al-dup-links");
  const sections = [];
  bar.append(links);
  const nodes = [bar];
  if (dups.busy) nodes.push(h("p", "pb-hint al-dup-hint al-dup-progress", `${dups.step}… ${dups.done} из ${dups.total}`));
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
const copyFolderPath = (p) => copyPath(p.root, p.path.split("/").slice(1, -1));
async function copyPath(d, rel) {
  const base = (await pathsOf())[d.name] || await askDiskPath(d);
  if (!base) return;
  const full = [base, ...rel].join("\\");
  try { await navigator.clipboard.writeText(full); ctx?.status(`Путь скопирован: ${full}`); setTimeout(() => ctx?.status(""), 4000); }
  catch { prompt("Скопируйте путь:", full); }
}
// где лежит альбом или поездка: путь целиком (своя папка — с диском, если его сказали) и «Скопировать» (Грегори
// 2026-11-27: «Нужно иметь под рукой возможность или попасть в реальную папку или увидеть полный путь альбома и
// трека»). Проводник браузер не открывает — путь вставляется в его адресную строку
function pathText(id) {
  const parts = id.split("/"), d = dirs.find((x) => x.name === parts[0]), base = d && diskPaths?.[d.name];
  if (d) return [base || d.name, ...parts.slice(1)].join("\\");
  return parts[0] === SITE_ROOT ? `Сайт: ${parts.join("/")}` : parts.join(" / ");
}
function pathRow(x) {
  const row = h("div", "al-path");
  const text = h("span", "al-path-text", pathText(x.id));
  text.title = text.textContent;
  row.append(text);
  const d = dirs.find((y) => y.name === rootOf(x));
  if (d) row.append(btn(COPY, "Скопировать полный путь к папке — вставьте его в адресную строку Проводника", async () => { await copyPath(d, x.id.split("/").slice(1)); text.textContent = pathText(x.id); }));
  return row;
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
    pic.addEventListener("dblclick", () => openGalleryWith(g.map(galleryItem), p.id, media, { story: storiesOf(p.album) }));
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
// Запись, которая не папка (старая, испорченная), пропускается: на ней обход падал раньше первой строки, и раздел
// молчал (Грегори 2026-11-25: «старая кнопка по прежнему бездействует»). Папки «Альбома 2» переходят сюда один раз
// (Грегори 2026-11-26: «переносим все функции»)
const isDir = (d) => typeof d?.queryPermission === "function" && typeof d?.entries === "function";
async function savedDirs() {
  let list = await cacheGet("albums/dirs").catch(() => null);
  if (!Array.isArray(list)) { const old = await cacheGet("albums/dir").catch(() => null); list = old ? [old] : []; }
  list = list.filter(isDir);
  if (await cacheGet("albums/from2").catch(() => null)) return list;
  const more = await cacheGet("albums2/dirs").catch(() => null);
  for (const d of Array.isArray(more) ? more.filter(isDir) : []) {
    const same = await Promise.all(list.map((x) => x.isSameEntry(d).catch(() => false)));
    if (!same.includes(true)) list.push(d);
  }
  await Promise.all([cacheSet("albums/dirs", list), cacheSet("albums/from2", true)]).catch(() => {});
  return list;
}
const noAccess = async () => {
  for (const d of dirs) if (await Promise.resolve().then(() => d.queryPermission({ mode: "read" })).catch(() => "denied") !== "granted") return true;
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
  const r = root();
  const folder = !canFolders() ? [] : [...(needsAccess && dirs.length ? [{ id: "#folder", icon: OPEN_ICON, title: accessTitle(),
    hint: "Снимки с этого компьютера никуда не отправляются" }] : []),
    // свои папки — под ней, у каждой крестик «Убрать папку» (Грегори 2026-11-11: раздел папок в настройках
    // закомментирован — убрать было негде); снимки на диске не трогаются. Щелчок — альбомы этой папки
    ...(needsAccess || currentRoot ? [] : dirs.map((d, i) => ({ id: `#dir:${i}`, icon: FOLDER_ICON, title: dirTitle(d), hint: "Своя папка со снимками",
      remove: { title: `Убрать папку «${d.name}»`, fn: () => confirm(`Убрать папку «${d.name}» из альбомов? Снимки на диске останутся.`)
        && forgetFolder(d, () => isOpen("albums") && !currentCountry && renderList(null)) } })))];
  const count = (s) => tops().filter((x) => rootOf(x) === s).reduce((n, x) => n + (x.group ? tally(x).list.length : 1), 0);
  const list = r ? countries().map(([name, n]) => ({ id: name, title: `${name} (${n})`, thumb: flagUrl(isoOf(name)) || "",
    icon: isoOf(name) ? "" : ICON, selected: currentCountry === name && isOpen("albums") }))
    : [SITE_ROOT, PHONE_ROOT].filter((s) => sources().includes(s)).map((s) => ({ id: `#root:${s}`, icon: s === PHONE_ROOT ? svg(CAMERA_D) : ICON,
      title: `${rootTitle(s)} — альбомов ${count(s)}`, hint: s === PHONE_ROOT ? "Папки галереи телефона" : "Альбомы, выложенные на сайте" }));
  // в приложении без доступа к галерее — строка «Показать снимки телефона» (Android спросит разрешение)
  const phone = phoneApp() && phoneAccess() === "none" ? [{ id: "#phone", icon: OPEN_ICON, title: "Показать снимки телефона", hint: "Папки галереи — альбомами; снимки никуда не отправляются" }] : [];
  const retry = scanErr ? [{ id: "#retry", icon: ICON, title: scanErr }]
    : noExif ? [{ id: "#retry", icon: ICON, title: "Места и даты не прочитаны — повторить", hint: "Не загрузилась программа чтения снимков — проверьте интернет" }] : [];
  const none = busy ? "Читаю альбомы…" : canFolders() && !dirs.length ? "Альбомов пока нет — папка со снимками: значок папки вверху" : "Альбомов пока нет";
  return [...folder, ...phone, ...retry, ...(list.length || !loading ? list : [{ id: "", title: none, icon: ICON }])];
}
// «Alboms — альбомов 65, снимков 3712» / «Alboms — читаю…» / «Alboms — снимков не найдено (папок 3)»
function dirTitle(d) {
  const st = found.get(d);
  if (!st) return d.name;
  if (!st.done) return `${d.name} — читаю…`;
  const n = [...albums.values()].filter((a) => a.local && a.photos.some((id) => photos.get(id)?.root === d)).length;
  const bad = st.bad ? `, не открылось папок ${st.bad}` : "";
  return st.files ? `${d.name} — альбомов ${n}, снимков ${st.files}${bad}` : `${d.name} — снимков не найдено (папок ${st.dirs}${bad})`;
}
function addFolder() {
  (dirs.length && needsAccess ? askAccess() : pickFolder()).then(() => isOpen("albums") && !openAlbum && !openGroup && !dupView && renderList(currentCountry, searchText));
}
// окно выбора папки — прямо по нажатию (иначе браузер его не откроет); после выбора — снова список стран
function chooseItem(country) {
  if (country?.startsWith("#dir:")) { const d = dirs[+country.slice(5)]; if (d) openRoot(d.name); return; }
  if (country?.startsWith("#root:")) { openRoot(country.slice(6)); return; }
  if (country === "#retry") { if (loading) rescan(); else load(ctx); return; }
  if (country === "#phone") { try { AtlasPhotos.ask(); } catch { /* старое приложение */ } return; }
  if (country === "#folder") { addFolder(); return; }
  if (country) openCountry(country);
}

function openRoot(r) {
  currentRoot = r;
  currentCountry = null;
  openCountry(null);
  drawMap();
}

function openCountry(country) {
  renderList(country);
  panel.body.scrollTop = 0;
  panel.open();
  setSearchMode(MODE);
  showOnMap(true);
  emit("module", { id: "content/albums", on: true });
}

// разрешили галерею (или место в снимках) — альбомы заново, если их уже читали
window.addEventListener("atlas-photos-changed", () => { if (loading) rescan(); });

// «Мои треки» открыли панель — им нужны треки альбомов (папки обходятся, если ещё нет)
on("album-tracks-wanted", ({ ctx: c }) => { ctx = c; wire(); load(c).catch(() => {}); }, { replay: false });
// фото на треке (Грегори, план «Треки: фото на треке по времени»): «Мои треки» спрашивают снимки за время
// трека — снимки его альбома (у дня поездки и «Снимков поездки» — всей поездки) и уже прочитанные снимки
// всех альбомов. Время снимка — «как на часах камеры» (wall: часы как будто в UTC); где известен пояс
// (tz из EXIF) или это ролик (в нём время точное) — сразу точное (at). Ответ — reply(список)
on("track-photos-wanted", async ({ albumId, from, to, ctx: c, reply }) => {
  ctx = c;
  wire();
  await load(c).catch(() => {});
  const a = albumId && albums.get(albumId);
  const top = a?.parent ? groups.get(a.parent) : null;
  const own = a ? photosOf(top || a).map((id) => photos.get(id)).filter(Boolean) : [];
  // и снимки альбомов тех же дней (дата — в начале имени папки: 20261024 …, 2026.10.24 …, 2026-10-24 …): трек, загруженный файлом, своего
  // альбома не знает (Грегори 2026-11-22: «пропали фотки в треках», альбом «20261024 (GPX) Neeme»)
  const DAY = 864e5, day = (T) => Math.floor((T - new Date(T).getTimezoneOffset() * 60000) / DAY);
  const near = [...albums.values()].filter((x) => {
    const m = /^(\d{4})[._]?(\d\d)[._]?(\d\d)(?:-(\d{4}[._]?)?(\d\d)[._]?(\d\d))?/.exec(x.name.replace(/^(\d{4})-(\d\d)-(\d\d)/, "$1$2$3"));
    if (!m) return x.from && x.from <= to + DAY && x.to >= from - DAY;
    const f = Date.UTC(+m[1], m[2] - 1, +m[3]) / DAY, t = m[6] ? Date.UTC(+(m[4]?.slice(0, 4) || m[1]), m[5] - 1, +m[6]) / DAY : f;
    return f <= day(to) + 1 && t >= day(from) - 1;
  }).flatMap((x) => photosOf(x).map((id) => photos.get(id))).filter((p) => p && !own.includes(p));
  const read = [...own, ...near.slice(0, 600)];
  for (let i = 0; i < read.length; i += 4) await Promise.all(read.slice(i, i + 4).map(exifOf));
  const pick = new Map();
  for (const p of [...own, ...photos.values()]) {
    const d = p.rec?.date;
    if (!d || pick.has(p.id) || p.album.title === "Избранное") continue;
    const wall = p.video ? null : d - new Date(d).getTimezoneOffset() * 60000;
    const at = p.video ? d : p.rec.tz != null ? wall - p.rec.tz * 60000 : null;
    if ((at ?? wall) < from - DAY || (at ?? wall) > to + DAY) continue;
    pick.set(p.id, { id: p.id, name: p.name, video: p.video, wall, at, lat: p.rec.lat, lon: p.rec.lon, mine: own.includes(p), albumId: p.album.id, albumTitle: trackTitle(p.album) });
  }
  const list = [...pick.values()];
  // папки есть, а доступа после перезапуска браузера нет — снимков не видно: «Мои треки» покажут кнопку
  const out = list.map((x) => ({ ...x,
    thumb: () => thumbOf(photos.get(x.id)),
    open: (ids) => openGalleryWith(ids.filter((id) => photos.has(id)).map((id) => galleryItem(photos.get(id))), x.id, media) }));
  if (needsAccess && dirs.length) out.access = { title: accessTitle(), ask: () => askAccess() };
  reply(out);
}, { replay: false });

// из трека — альбом (его папки или снимка на треке); from — трек, «Назад в трек». Панель открывается сразу:
// большая папка обходится долго, а без доступа к папкам после перезапуска браузера альбома нет вовсе (Грегори
// 2026-11-27: «После нажатия альбом не читается») — строка хода или «Открыть доступ», альбом — как только его
// папка пройдена
let fromTrack = null, albumWait = 0, waitingFor = null;
on("album-open", async ({ id, title, ctx: c, from }) => {
  ctx = c;
  wire();
  fromTrack = from ? { ...from, album: id } : null;
  const run = ++albumWait;
  if (!albums.has(id)) {
    let over = false;
    load(c).catch(() => {}).finally(() => { over = true; });
    openCountry(currentCountry);
    panel.setTitle(title || "Альбом");
    const bar = h("div", "pb-bar");
    if (from) bar.append(btn(BACK, `Назад в трек «${from.name}»`, () => emit("track-open", { key: from.key, ctx, album: { id, title } })));
    const why = h("p", "pb-hint", "Открываю альбом…");
    const ask = needsAccess && dirs.length ? [accessRow()] : [];
    panel.body.replaceChildren(bar, ...ask, why, h("p", "pb-hint al-progress", progress()));
    // доступ дадут — обход заново, альбом всё равно откроется; все альбомы известны, как только папки обойдены
    waitingFor = id;
    while (!albums.has(id)) {
      await new Promise((r) => setTimeout(r, 300));
      if (run !== albumWait || !isOpen("albums") || openAlbum || openGroup || dupView) return;
      if (needsAccess && dirs.length) why.textContent = "Нет доступа к папкам со снимками — нажмите «Открыть доступ»";
      else if ((over && !busy) || ["probe", "finish"].includes(phase.step)) {
        why.textContent = `Альбом «${title || id}» не найден — папку переименовали, перенесли или убрали из альбомов`;
        return;
      }
    }
    waitingFor = null;
  }
  const a = albums.get(id);
  currentRoot = rootOf(a);
  openCountry(countryOf(topOf(a)));
  openAlbumById(id);
}, { replay: false });

panel.onClose(() => {
  fromTrack = null;
  albumWait++;
  waitingFor = null;
  dupView = false;
  dupRun++;
  dups = null;
  openAlbum = null;
  openGroup = null;
  currentCountry = null;
  currentRoot = null;
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
    if (f.properties.album) { const a = albums.get(f.properties.album); if (a) { currentRoot = rootOf(a); renderList(countryOf(topOf(a))); openAlbumById(a.id); } return; }
    if (f.properties.cluster) {
      map.getSource("albums-photos").getClusterExpansionZoom(f.properties.cluster_id)
        .then((zoom) => map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom, 19) })).catch(() => {});
      return;
    }
    const p = photos.get(f.properties.photo);
    // на телефоне касание снимка, чьё окно уже открыто, — галерея (окно ещё не закрылось: этот обработчик раньше)
    if (p && touchUI() && popupPhoto === p.id) { gallery(p.album, p.id); return; }
    if (p) { showPhoto(p); focusPhoto(p); }
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
      currentRoot = null;
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
    countries: countries().map(([n, k]) => `${n}:${k}`), busy,
    phone: [...albums.values()].filter((a) => a.id.startsWith(`${PHONE_ROOT}/`)).map((a) => `${a.name}:${a.photos.length}${a.point ? ":место" : ""}`).sort(), shown, dups: dups && { busy: dups.busy, same: dups.same.length, like: dups.like.length, view: dupView }, open: openAlbum?.title || openGroup?.title || null, country: currentCountry,
    map: shown ? { albums: albumData().features.length, photos: dotData().features.length } : null, oldFirst,
    root: currentRoot, sources: sources(), flat: !byCountry }),
  pickFolder: () => pickFolder(),
  forgetFolder: (name) => forgetFolder(dirs.find((d) => d.name === name)),
  openFirst: (title) => { const a = [...albums.values()].find((x) => !title || x.title === title); if (!a) return false; currentRoot = rootOf(a); openCountry(countryOf(a)); openAlbumById(a.id); return true; },
});

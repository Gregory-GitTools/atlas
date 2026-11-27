// Музыка — свои песни с двумя плеерами на выбор (Грегори 2026-11-25: «Сделай новую кнопку музыки с двумя найденными
// плеерами»): APlayer (готовый вид со списком и обложками) и AmplitudeJS (вид свой, на кнопках и ползунке атласа).
// Выбор плеера — кнопками в барабане четвёртой кнопки «Плееры» (Грегори 2026-11-27: «Выбор плееров сделай в новой
// карусели»), не в панели; выбор помнится. Песни — папка с компьютера (доступ хранится в этом браузере, как
// в «Альбоме 2») или файлы, выбранные на месте (везде, и на телефоне; до перезапуска). Название, исполнитель и
// обложка — из тегов ID3 mp3, иначе «Исполнитель - Название» из имени файла и cover/folder.jpg рядом с песней.
// Панель закрыли — музыка играет дальше, кнопка остаётся отмеченной; её крестик — пауза и закрыть.
// Строка поиска — режимом раздела: «Найти песню» прячет в списке неподходящие. Песни никуда не отправляются;
// программы плееров — с jsdelivr (потом из кэша)
import { register, isMobile } from "../core/modules.js";
import { createPanel, isOpen } from "../core/panel.js";
import { FOLDER_ADD_D } from "../core/icons.js";
import { id3, fromName } from "../core/id3.js";
import { emit } from "../core/events.js";
import { setSearchMode, searchMode } from "../core/search.js";
import { cacheGet, cacheSet } from "../core/storage.js";

const svg = (d, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`;
const NOTE_D = "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z";
const ICON = svg(NOTE_D);
const FOLDER_ICON = svg("M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z");
const FILE_ICON = svg("M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z");
const PREV = svg("M6 6h2v12H6zm3.5 6 8.5 6V6z", 26);
const NEXT = svg("M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z", 26);
const PLAY = svg("M8 5v14l11-7z", 30);
const PAUSE = svg("M6 19h4V5H6v14zm8-14v14h4V5h-4z", 30);
const X_ICON = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const COLOR = "#7c4dff"; // --tone-my
const AUDIO_RE = /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i;
const COVER_RE = /^(cover|folder|front|album)\.(jpe?g|png|webp)$/i;
const KEY = "music/dirs", PLAYER_KEY = "atlas-music-player";
const CDN = "https://cdn.jsdelivr.net/npm/";
const PLAYERS = {
  aplayer: { title: "APlayer", js: `${CDN}aplayer@1.10.1/dist/APlayer.min.js`, css: `${CDN}aplayer@1.10.1/dist/APlayer.min.css` },
  amplitude: { title: "Amplitude", js: `${CDN}amplitudejs@5.3.2/dist/amplitude.min.js` },
};

const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });
const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;
const canFolders = () => "showDirectoryPicker" in window && !isMobile();

// ---------- данные ----------
let dirs = []; // [{ handle, state: "need" | "read" | "done" | "error", songs, err, row }]
let picked = []; // песни из выбранных файлов
let songs = []; // [{ file, name, title, artist, url, cover, dir }]
let which = localStorage.getItem(PLAYER_KEY) === "amplitude" ? "amplitude" : "aplayer";
let query = "", started = false, scan = 0, status = "";
let ap = null, ampOn = false; // текущий плеер

const panel = createPanel({ id: "music", title: "Музыка", icon: svg(NOTE_D, 18), side: "left" });
// «Добавить папку с музыкой…» — значком в шапке, а не строкой (Грегори 2026-11-26)
const addBtn = panel.addButton(svg(FOLDER_ADD_D), "Добавить папку с музыкой…", () => addFolder());
addBtn.hidden = !canFolders();
const host = h("div", "mu-player");
const list = h("div", "home-list mu-list");
const note = h("p", "pb-hint mu-note");

// ---------- программы плееров: по требованию, один раз ----------
const loaded = {};
function script(url) {
  return (loaded[url] ??= new Promise((ok, fail) => {
    const s = Object.assign(document.createElement("script"), { src: url, async: true });
    s.onload = ok;
    s.onerror = () => { delete loaded[url]; fail(new Error("не загрузилась программа плеера")); };
    document.head.append(s);
  }));
}
function style(url) {
  if (document.querySelector(`link[href="${url}"]`)) return;
  document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: url }));
}

// ---------- теги ID3v2 (core/id3.js) ----------
async function describe(s) {
  const t = /\.mp3$/i.test(s.name) ? await id3(s.file).catch(() => ({})) : {};
  const n = fromName(s.name);
  s.title = t.title || n.title;
  s.artist = t.artist || n.artist;
  s.cover = t.cover || s.dirCover || "";
}

// ---------- папки ----------
const saveDirs = () => cacheSet(KEY, dirs.map((d) => d.handle)).catch(() => {});
async function loadDirs() {
  const saved = canFolders() ? await cacheGet(KEY).catch(() => null) : null;
  dirs = (Array.isArray(saved) ? saved : []).map((handle) => ({ handle, state: "need", songs: 0, err: "" }));
}
const granted = async (d) => (await d.handle.queryPermission({ mode: "read" }).catch(() => "denied")) === "granted";
async function addFolder() {
  let handle;
  try { handle = await window.showDirectoryPicker({ id: "atlas-music", mode: "read" }); } catch { return; }
  for (const d of dirs) if (await d.handle.isSameEntry(handle).catch(() => false)) return;
  dirs.push({ handle, state: "read", songs: 0, err: "" });
  await saveDirs();
  readAll();
}
function removeFolder(d) {
  if (!confirm(`Убрать папку «${d.handle.name}» из «Музыки»? Песни на диске останутся.`)) return;
  dirs = dirs.filter((x) => x !== d);
  saveDirs();
  readAll();
}
async function openAccess(d) {
  if ((await d.handle.requestPermission({ mode: "read" }).catch(() => "denied")) !== "granted") { d.err = "доступ не дан"; d.state = "error"; paintDir(d); return; }
  readAll();
}
function dirText(d) {
  const name = d.handle.name;
  if (d.state === "need") return `${name} — нажмите, чтобы открыть доступ`;
  if (d.state === "error") return `${name} — ошибка: ${d.err} (нажмите — ещё раз)`;
  if (d.state === "read") return `${name} — читаю… песен ${d.songs}`;
  return `${name} — ${plural(d.songs, "песня", "песни", "песен")}`;
}
const paintDir = (d) => { if (d.row) d.row.querySelector(".tr-row-title").textContent = dirText(d); };
async function walk(handle, d, out, token) {
  const files = [], sub = [];
  let cover = null;
  for await (const [name, x] of handle.entries()) {
    if (token !== scan) return;
    if (/^[._]/.test(name)) continue;
    if (x.kind === "directory") sub.push(x);
    else if (AUDIO_RE.test(name)) files.push(x);
    else if (COVER_RE.test(name)) cover = x;
  }
  const dirCover = cover ? URL.createObjectURL(await cover.getFile()) : "";
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const x of files) {
    out.push({ file: await x.getFile(), name: x.name, dirCover, dir: d });
    d.songs++;
  }
  paintDir(d);
  sub.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const x of sub) await walk(x, d, out, token);
}

// всё заново: папки, потом теги, потом плеер
async function readAll() {
  const token = ++scan;
  const found = [];
  render();
  for (const d of dirs) {
    if (d.state !== "read" && !(await granted(d))) { d.state = "need"; paintDir(d); continue; }
    d.state = "read";
    d.songs = 0;
    paintDir(d);
    try { await walk(d.handle, d, found, token); d.state = "done"; } catch (e) { d.state = "error"; d.err = e.message || String(e); }
    if (token !== scan) return;
    paintDir(d);
  }
  await setSongs([...found, ...picked], token);
}
async function setSongs(all, token) {
  status = all.length ? `Читаю названия: 0 из ${all.length}` : "";
  paintNote();
  let done = 0, i = 0;
  const work = async () => {
    while (i < all.length) {
      const s = all[i++];
      await describe(s);
      if (token !== scan) return;
      if (++done % 20 === 0) { status = `Читаю названия: ${done} из ${all.length}`; paintNote(); }
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  if (token !== scan) return;
  for (const s of songs) if (!all.includes(s) && s.url) URL.revokeObjectURL(s.url);
  for (const s of all) s.url ||= URL.createObjectURL(s.file);
  songs = all;
  status = "";
  paintNote();
  mount();
}
const input = Object.assign(document.createElement("input"), { type: "file", multiple: true, accept: "audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac", hidden: true });
input.addEventListener("change", () => {
  const files = [...input.files].filter((f) => AUDIO_RE.test(f.name) || f.type.startsWith("audio/"));
  input.value = "";
  if (!files.length) return;
  picked = [...picked, ...files.map((file) => ({ file, name: file.name, dirCover: "", dir: null }))];
  readAll();
});
document.body.append(input);

// ---------- панель ----------
function row(icon, title, hint, fn) {
  const r = Object.assign(h("button", "tr-row home-row"), { type: "button", title: hint || "" });
  r.innerHTML = `<span class="tr-row-text"><span class="tr-row-title"></span><span class="tr-row-sub"></span></span><i class="tr-icon">${icon}</i>`;
  r.querySelector(".tr-row-title").textContent = title;
  r.addEventListener("click", fn);
  return r;
}
function paintNote() {
  const reading = dirs.some((d) => d.state === "read");
  note.textContent = status || (reading ? "Читаю папки…" : songs.length ? "" : "Добавьте папку с музыкой или выберите файлы — песни играют прямо здесь и никуда не отправляются");
  note.hidden = !note.textContent;
}
function render() {
  list.replaceChildren();
  for (const d of dirs) {
    d.row = row(FOLDER_ICON, dirText(d), "Своя папка с музыкой", () => {
      if (d.state === "need") openAccess(d);
      else if (d.state === "error") readAll();
    });
    const line = h("div", "home-line");
    const x = Object.assign(h("button", "search-delete"), { type: "button", title: `Убрать папку «${d.handle.name}»`, innerHTML: X_ICON });
    x.addEventListener("click", (e) => { e.stopPropagation(); removeFolder(d); });
    line.append(d.row, x);
    list.append(line);
  }
  list.append(row(FILE_ICON, picked.length ? `Выбрать файлы… (выбрано ${picked.length})` : "Выбрать файлы…", "Песни с этого устройства — до перезапуска", () => input.click()));
  paintNote();
  panel.body.replaceChildren(list, note, host);
}

// ---------- плееры ----------
const playing = () => (ap ? !ap.audio.paused : ampOn && window.Amplitude?.getPlayerState?.() === "playing");
const changed = () => emit("module", { id: "content/music", on: isOpen("music") || playing() });
function stop() {
  // у APlayer после ошибки песни — переход к следующей через 2 с; убранный плеер не должен ни переходить, ни играть
  if (ap) { ap.pause(); ap.list.switch = ap.skipForward = ap.play = () => {}; ap.destroy(); ap = null; }
  if (ampOn) { try { window.Amplitude.stop(); } catch { /* нет песен */ } ampOn = false; }
  host.replaceChildren();
}
const matches = (s) => !query || `${s.title} ${s.artist} ${s.name}`.toLowerCase().includes(query);
function filterRows() {
  const rows = host.querySelectorAll(".aplayer-list li, .mu-song");
  songs.forEach((s, i) => { if (rows[i]) rows[i].hidden = !matches(s); });
}
async function mount() {
  stop();
  if (!songs.length) { changed(); return; }
  const want = which, p = PLAYERS[want];
  host.replaceChildren(h("p", "pb-hint", `Загружаю ${p.title}…`));
  try {
    if (p.css) style(p.css);
    await script(p.js);
  } catch (e) {
    host.replaceChildren(h("p", "pb-hint", `${p.title}: ${e.message} — нет сети? Другой плеер — кнопкой выше`));
    return;
  }
  if (want !== which) return;
  host.replaceChildren();
  if (want === "aplayer") mountAPlayer();
  else mountAmplitude();
  filterRows();
  changed();
}
function mountAPlayer() {
  const box = h("div", "mu-aplayer");
  host.append(box);
  ap = new window.APlayer({
    container: box, theme: COLOR, preload: "metadata", listFolded: false, listMaxHeight: "50vh",
    audio: songs.map((s) => ({ name: s.title, artist: s.artist || " ", url: s.url, cover: s.cover || undefined })),
  });
  for (const ev of ["play", "pause", "ended"]) ap.on(ev, changed);
}
function mountAmplitude() {
  const box = h("div", "mu-amp");
  box.innerHTML = `<div class="mu-now"><img class="mu-cover" data-amplitude-song-info="cover_art_url" alt="">
      <div class="mu-meta"><b class="mu-title" data-amplitude-song-info="name"></b><span class="mu-artist" data-amplitude-song-info="artist"></span></div></div>
    <input type="range" class="amplitude-song-slider mu-slider" value="0" step=".1" aria-label="Место в песне">
    <div class="mu-time"><span class="amplitude-current-time"></span><span class="amplitude-duration-time"></span></div>
    <div class="mu-buttons"><button type="button" class="btn amplitude-prev" title="Предыдущая">${PREV}</button>
      <button type="button" class="btn mu-play amplitude-play-pause" title="Играть / пауза"><i class="mu-on">${PAUSE}</i><i class="mu-off">${PLAY}</i></button>
      <button type="button" class="btn amplitude-next" title="Следующая">${NEXT}</button></div>
    <div class="mu-songs"></div>`;
  box.querySelector(".mu-songs").append(...songs.map((s, i) => {
    const r = h("button", "mu-song amplitude-song-container amplitude-play-pause");
    r.type = "button";
    r.dataset.amplitudeSongIndex = i;
    r.append(h("span", "mu-song-title", s.title), h("span", "mu-song-artist", s.artist));
    return r;
  }));
  host.append(box);
  window.Amplitude.init({
    songs: songs.map((s) => ({ name: s.title, artist: s.artist, url: s.url, cover_art_url: s.cover || "" })),
    callbacks: { play: changed, pause: changed, stop: changed, song_change: changed },
  });
  ampOn = true;
}

// ---------- строка поиска — режим раздела ----------
function filter(t) {
  query = t.trim().toLowerCase();
  filterRows();
}
const MODE = { icon: svg(NOTE_D, 20), title: "Музыка", placeholder: "Найти песню", tone: "my", filter, exit: () => panel.close() };

panel.onClose(() => {
  if (searchMode() === MODE) setSearchMode(null);
  changed();
});

register({
  id: "content/music",
  kind: "content",
  drum: "player", // кнопки «APlayer» и «Amplitude» в барабане плееров, не в разделах
  title: "Музыка",
  tone: "my",
  hint: "Свои песни — с компьютера или телефона в плеере APlayer или Amplitude",
  icon: ICON,
  sends: "ничего: песни играют с устройства; программы плееров (APlayer, AmplitudeJS) — с jsdelivr",
  column: {
    home: async () => {
      panel.open();
      setSearchMode(MODE);
      changed();
      if (started) return;
      started = true;
      await loadDirs();
      render();
      if (dirs.length) readAll();
    },
    items: () => [],
    players: Object.entries(PLAYERS).map(([id, p]) => ({ id, title: p.title })),
    player: () => which,
    // другой плеер — песни те же, играют в нём
    pick: (id) => {
      if (id === which || !PLAYERS[id]) return;
      which = id;
      localStorage.setItem(PLAYER_KEY, id);
      if (started) mount();
    },
    choose: () => {},
    // играет — кнопка отмечена и без панели; её крестик — пауза и закрыть
    isOpen: () => isOpen("music") || playing(),
    shown: () => isOpen("music"),
    close: () => { if (ap) ap.pause(); else if (ampOn) window.Amplitude.pause(); panel.close(); },
  },
  // для проверки
  stats: () => ({ player: which, dirs: dirs.map(dirText), songs: songs.map((s) => `${s.artist ? s.artist + " — " : ""}${s.title}${s.cover ? ":обложка" : ""}`),
    mounted: ap ? "aplayer" : ampOn ? "amplitude" : null, playing: playing(), rows: host.querySelectorAll(".aplayer-list li:not([hidden]), .mu-song:not([hidden])").length }),
});

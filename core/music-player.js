// Плеер — четвёртая кнопка справа, не связанная с картой (Грегори 2026-11-26: «Это должно быть отдельным окном плеера,
// а на смартфоне просто самостоятельным плеером»; раньше: «ни один плеер не может оставлять структуру альбома, ставить
// обложку альбома песни… просто плеер фоном… YT Music с ориентацией на андроид»). Страница player.html: на компьютере —
// своё окно, на телефоне — во весь экран поверх карты (свернуть — играет дальше). Альбом — папка с песнями (название
// и исполнитель — из тегов, если они есть у песен), обложка — cover/folder.jpg в папке или картинка из тегов; песни — по
// номерам из тегов, иначе по именам файлов. Папки — те же, что у «Музыки» (music/dirs), на телефоне — выбранные на месте
// (до перезапуска). Играющая песня — в шторке телефона и на клавишах мультимедиа (Media Session) с обложкой альбома.
// Песни никуда не отправляются. Кнопка справа светится, пока играет (канал atlas-player)
import { cacheGet, cacheSet } from "./storage.js";
import { id3, fromName } from "./id3.js";

const svg = (d) => `<svg viewBox="0 0 24 24" fill="currentColor"><path d="${d}"/></svg>`;
const NOTE = svg("M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z");
const FOLDER_ADD = svg("M20 6h-8l-2-2H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z");
const FILES = svg("M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z");
const OPEN_OUT = svg("M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z");
const BACK = svg("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z");
const FOLD = svg("M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z");
const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
const PREV = svg("M6 6h2v12H6zm3.5 6 8.5 6V6z");
const NEXT = svg("M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z");
const PLAY = svg("M8 5v14l11-7z");
const PAUSE = svg("M6 19h4V5H6v14zm8-14v14h4V5h-4z");
const AUDIO_RE = /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i;
const COVER_RE = /^(cover|folder|front|album)\.(jpe?g|png|webp)$/i;
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const KEY = "music/dirs"; // те же папки, что у «Музыки» (content/music.js)
const YTM = "https://music.youtube.com/";

const embed = new URLSearchParams(location.search).has("embed");
const mobile = !!navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || matchMedia("(pointer: coarse) and (hover: none)").matches;
const canFolders = "showDirectoryPicker" in window && !mobile;
const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;
const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });
const button = (icon, title, fn) => { const b = Object.assign(h("button", "btn"), { type: "button", title, innerHTML: icon }); b.addEventListener("click", fn); return b; };
const main = document.querySelector(".main"), bar = document.querySelector(".bar"), find = document.querySelector(".find");

// ---------- данные ----------
let dirs = []; // [{ handle, state: "need" | "read" | "done" | "error", songs }]
let picked = []; // выбранные на месте: [{ file, path }]
let albums = []; // [{ key, title, artist, cover, songs: [{ file, name, title, artist, track, cover }] }]
let view = null; // открытый альбом или null — библиотека
let scan = 0, reading = false, query = "";

async function walk(handle, path, out, token, d) {
  const files = [], sub = [];
  let cover = null, image = null;
  for await (const [name, x] of handle.entries()) {
    if (token !== scan) return;
    if (/^[._]/.test(name)) continue;
    if (x.kind === "directory") sub.push(x);
    else if (AUDIO_RE.test(name)) files.push(x);
    else if (COVER_RE.test(name)) cover = x;
    else if (IMAGE_RE.test(name)) image ??= x;
  }
  if (files.length) {
    const c = cover || image;
    out.push({ path, folder: handle.name, files: await Promise.all(files.map((x) => x.getFile())), cover: c ? URL.createObjectURL(await c.getFile()) : "" });
    d.songs += files.length;
    paint();
  }
  for (const x of sub) await walk(x, `${path}/${x.name}`, out, token, d);
}
// выбранные файлы: с папкой (webkitRelativePath) — альбом по папке, без неё — по тегу альбома
function pickedFolders() {
  const by = new Map();
  for (const { file, path } of picked) {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (!by.has(dir)) by.set(dir, { path: dir ? `#picked/${dir}` : "#picked", folder: dir.split("/").pop() || "", files: [], cover: "", images: [] });
    const f = by.get(dir);
    if (AUDIO_RE.test(file.name) || file.type.startsWith("audio/")) f.files.push(file);
    else if (IMAGE_RE.test(file.name)) f.images.push(file);
  }
  for (const f of by.values()) {
    const c = f.images.find((x) => COVER_RE.test(x.name)) || f.images[0];
    if (c) f.cover = URL.createObjectURL(c);
  }
  return [...by.values()].filter((f) => f.files.length);
}

const most = (list) => { const n = new Map(); for (const x of list.filter(Boolean)) n.set(x, (n.get(x) || 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };
async function toAlbums(folders, token) {
  const out = [];
  for (const f of folders) {
    const songs = [];
    for (const file of f.files) {
      const t = /\.mp3$/i.test(file.name) ? await id3(file).catch(() => ({})) : {};
      if (token !== scan) return null;
      const n = fromName(file.name);
      songs.push({ file, name: file.name, title: t.title || n.title, artist: t.artist || n.artist, album: t.album || "", albumArtist: t.albumArtist || "", track: t.track || 0, tagCover: t.cover || "" });
    }
    // без папки (выбранные по одной) — альбомы по тегу
    const groups = f.folder ? [songs] : [...songs.reduce((m, s) => m.set(s.album, [...(m.get(s.album) || []), s]), new Map()).values()];
    for (const list of groups) {
      list.sort((a, b) => (a.track || 1e6) - (b.track || 1e6) || a.name.localeCompare(b.name, undefined, { numeric: true }));
      const cover = f.cover || list.find((s) => s.tagCover)?.tagCover || "";
      for (const s of list) s.cover = s.tagCover || cover;
      out.push({ key: `${f.path}|${list[0].album}`, title: most(list.map((s) => s.album)) || f.folder || "Выбранные песни",
        artist: most(list.map((s) => s.albumArtist)) || most(list.map((s) => s.artist)), cover, songs: list });
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "ru", { numeric: true }));
}

async function readAll() {
  const token = ++scan;
  reading = true;
  paint();
  const folders = [];
  for (const d of dirs) {
    if ((await d.handle.queryPermission({ mode: "read" }).catch(() => "denied")) !== "granted") { d.state = "need"; continue; }
    d.state = "read";
    d.songs = 0;
    try { await walk(d.handle, d.handle.name, folders, token, d); d.state = "done"; } catch { d.state = "error"; }
    if (token !== scan) return;
  }
  const list = await toAlbums([...folders, ...pickedFolders()], token);
  if (!list) return;
  albums = list;
  reading = false;
  if (view) view = albums.find((a) => a.key === view.key) || null;
  paint();
}

// ---------- папки и файлы ----------
const saveDirs = () => cacheSet(KEY, dirs.map((d) => d.handle)).catch(() => {});
async function addFolder() {
  let handle;
  try { handle = await window.showDirectoryPicker({ id: "atlas-music", mode: "read" }); } catch { return; }
  for (const d of dirs) if (await d.handle.isSameEntry(handle).catch(() => false)) return;
  dirs.push({ handle, state: "read", songs: 0 });
  await saveDirs();
  readAll();
}
function removeFolder(d) {
  if (!confirm(`Убрать папку «${d.handle.name}» из плеера и «Музыки»? Песни на диске останутся.`)) return;
  dirs = dirs.filter((x) => x !== d);
  saveDirs();
  readAll();
}
// после перезапуска браузер даёт доступ к папкам только по нажатию
async function askAccess() {
  for (const d of dirs) if (d.state === "need") await d.handle.requestPermission({ mode: "read" }).catch(() => "denied");
  readAll();
}
const fileInput = (folder) => {
  const i = Object.assign(document.createElement("input"), { type: "file", multiple: true, hidden: true, accept: folder ? "" : "audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac" });
  if (folder) i.webkitdirectory = true;
  i.addEventListener("change", () => {
    picked = [...picked, ...[...i.files].map((file) => ({ file, path: file.webkitRelativePath || file.name }))];
    i.value = "";
    readAll();
  });
  document.body.append(i);
  return i;
};
const pickSongs = fileInput(false), pickDir = fileInput(true);

// ---------- проигрывание ----------
const audio = Object.assign(document.createElement("audio"), { preload: "metadata" });
document.body.append(audio);
let queue = [], at = -1, url = "";
const current = () => queue[at] || null;
const albumOf = (s) => albums.find((a) => a.songs.includes(s));
function playAt(list, i) {
  queue = list;
  at = i;
  const s = current();
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(s.file);
  audio.src = url;
  audio.play().catch(() => {});
  const a = albumOf(s);
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist, album: a?.title || "",
      artwork: s.cover ? [{ src: s.cover, sizes: "512x512" }] : [] });
  }
  paint();
}
const step = (d) => { if (at + d >= 0 && at + d < queue.length) playAt(queue, at + d); };
const toggle = () => { if (!current()) return; if (audio.paused) audio.play().catch(() => {}); else audio.pause(); };
audio.addEventListener("ended", () => { if (at + 1 < queue.length) step(1); else paintBar(); });
for (const ev of ["play", "pause"]) audio.addEventListener(ev, () => { paint(); tell(); });
audio.addEventListener("timeupdate", paintTime);
audio.addEventListener("loadedmetadata", paintTime);
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => audio.play().catch(() => {}));
  ms.setActionHandler("pause", () => audio.pause());
  ms.setActionHandler("previoustrack", () => step(-1));
  ms.setActionHandler("nexttrack", () => step(1));
  try { ms.setActionHandler("seekto", (e) => { audio.currentTime = e.seekTime; }); } catch { /* старый браузер */ }
}

// кнопка плеера на карте светится, пока играет
const channel = "BroadcastChannel" in window ? new BroadcastChannel("atlas-player") : null;
const tell = () => {
  const s = current();
  channel?.postMessage({ playing: !audio.paused, title: s ? [s.artist, s.title].filter(Boolean).join(" — ") : "" });
  document.title = s && !audio.paused ? `▶ ${s.title} — Плеер` : "Плеер — Atlas";
};
// крестик у «Плеера Atlas» в барабане плееров — пауза
channel?.addEventListener("message", (e) => { if (e.data?.ask) tell(); if (e.data?.stop) audio.pause(); });
addEventListener("pagehide", () => channel?.postMessage({ playing: false, title: "" }));

// ---------- вид ----------
const coverBox = (src) => { const c = h("div", "cover"); if (src) c.style.backgroundImage = `url("${src}")`; else c.innerHTML = NOTE; return c; };
const matches = (a) => !query || [a.title, a.artist, ...a.songs.flatMap((s) => [s.title, s.artist])].join(" ").toLowerCase().includes(query);

function head() {
  const box = document.querySelector(".head");
  box.querySelectorAll(".btn").forEach((b) => b.remove());
  if (canFolders) box.append(button(FOLDER_ADD, "Добавить папку с музыкой…", addFolder));
  else box.append(button(FOLDER_ADD, "Выбрать папку с музыкой…", () => pickDir.click()));
  box.append(button(FILES, "Выбрать песни…", () => pickSongs.click()));
  const yt = Object.assign(h("a", "btn"), { href: YTM, target: "_blank", rel: "noopener", title: "YouTube Music", innerHTML: OPEN_OUT });
  box.append(yt);
  // в приложении (во весь экран поверх карты): свернуть — музыка играет дальше; закрыть — стоп
  if (embed) {
    box.append(button(FOLD, "Свернуть плеер (музыка играет дальше)", () => parent.postMessage({ player: "hide" }, location.origin)),
      button(X, "Закрыть плеер", () => { audio.pause(); parent.postMessage({ player: "close" }, location.origin); }));
  }
}

function paint() {
  const nodes = [];
  const need = dirs.filter((d) => d.state === "need");
  if (need.length) {
    const b = h("button", "access", need.length === 1 ? `Открыть мою папку «${need[0].handle.name}»` : "Открыть мои папки");
    b.type = "button";
    b.addEventListener("click", askAccess);
    nodes.push(b);
  }
  for (const d of dirs) {
    const line = h("div", "dir");
    line.append(h("span", "", `${d.handle.name} — ${d.state === "need" ? "нет доступа" : d.state === "read" ? `читаю… песен ${d.songs}` : d.state === "error" ? "не прочиталась" : plural(d.songs, "песня", "песни", "песен")}`),
      button(X, `Убрать папку «${d.handle.name}»`, () => removeFolder(d)));
    nodes.push(line);
  }
  if (view) nodes.push(...albumView(view));
  else {
    const shown = albums.filter(matches);
    if (!albums.length) nodes.push(h("p", "hint", reading ? "Читаю песни…"
      : `Добавьте папку с музыкой или выберите песни — значками вверху. Альбом — папка с песнями, обложка — cover.jpg в ней или картинка из песни. Песни играют здесь и никуда не отправляются.${mobile ? " Выбранное помнится до перезапуска." : ""}`));
    else if (!shown.length) nodes.push(h("p", "hint", "Ничего не нашлось"));
    const grid = h("div", "grid");
    for (const a of shown) {
      const c = Object.assign(h("button", "card" + (current() && a.songs.includes(current()) ? " now" : "")), { type: "button", title: [a.title, a.artist].filter(Boolean).join(" — ") });
      c.append(coverBox(a.cover), h("b", "", a.title), h("small", "", [a.artist, plural(a.songs.length, "песня", "песни", "песен")].filter(Boolean).join(" · ")));
      c.addEventListener("click", () => { view = a; paint(); main.scrollTop = 0; });
      grid.append(c);
    }
    nodes.push(grid);
  }
  main.replaceChildren(...nodes);
  paintBar();
}

function albumView(a) {
  const top = h("div", "album-top"), text = h("div", "");
  const btns = h("div", "album-btns");
  btns.append(button(BACK, "К альбомам", () => { view = null; paint(); }), button(PLAY, "Слушать альбом", () => playAt(a.songs, 0)));
  const yt = Object.assign(h("a", "btn"), { href: `${YTM}search?q=${encodeURIComponent([a.artist, a.title].filter(Boolean).join(" "))}`, target: "_blank", rel: "noopener",
    title: "Найти альбом в YouTube Music", innerHTML: OPEN_OUT });
  btns.append(yt);
  text.append(h("h2", "", a.title), h("p", "", [a.artist, plural(a.songs.length, "песня", "песни", "песен")].filter(Boolean).join(" · ")), btns);
  top.append(coverBox(a.cover), text);
  const list = h("div", "songs");
  a.songs.forEach((s, i) => {
    if (query && ![s.title, s.artist].join(" ").toLowerCase().includes(query)) return;
    const r = Object.assign(h("button", "song" + (s === current() ? " now" : "")), { type: "button", title: s.name });
    const t = h("span", "");
    t.append(h("b", "", s.title), ...(s.artist && s.artist !== a.artist ? [h("small", "", s.artist)] : []));
    r.append(h("i", "", s === current() && !audio.paused ? "▶" : String(s.track || i + 1)), t);
    r.addEventListener("click", () => playAt(a.songs, i));
    list.append(r);
  });
  return [top, list];
}

const time = (t) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "0:00");
let seek = null, cur = null, dur = null;
function paintBar() {
  const s = current();
  bar.hidden = !s;
  if (!s) return;
  const c = coverBox(s.cover);
  c.title = "К альбому";
  c.addEventListener("click", () => { view = albumOf(s) || null; paint(); });
  const meta = h("div", "meta");
  meta.append(h("b", "", s.title), h("small", "", [s.artist, albumOf(s)?.title].filter(Boolean).join(" · ")));
  const ctl = h("div", "ctl");
  const prev = button(PREV, "Предыдущая", () => step(-1)), next = button(NEXT, "Следующая", () => step(1));
  prev.disabled = at <= 0;
  next.disabled = at >= queue.length - 1;
  const play = button(audio.paused ? PLAY : PAUSE, audio.paused ? "Играть" : "Пауза", toggle);
  play.classList.add("play");
  ctl.append(prev, play, next);
  const box = h("div", "seek");
  cur = h("span", "");
  dur = h("span", "");
  seek = Object.assign(document.createElement("input"), { type: "range", min: 0, max: 1000, value: 0, ariaLabel: "Место в песне" });
  seek.addEventListener("input", () => { if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; });
  box.append(cur, seek, dur);
  bar.replaceChildren(c, meta, ctl, box);
  paintTime();
}
function paintTime() {
  if (!seek) return;
  cur.textContent = time(audio.currentTime);
  dur.textContent = time(audio.duration);
  if (document.activeElement !== seek) seek.value = audio.duration ? Math.round((audio.currentTime / audio.duration) * 1000) : 0;
}

find.addEventListener("input", () => { query = find.value.trim().toLowerCase(); paint(); });
addEventListener("keydown", (e) => {
  if (e.target === find || e.target.tagName === "INPUT") return;
  if (e.code === "Space") { e.preventDefault(); toggle(); }
});

// ---------- старт ----------
head();
paint();
if (canFolders) {
  const saved = await cacheGet(KEY).catch(() => null);
  dirs = (Array.isArray(saved) ? saved : []).filter((x) => typeof x?.queryPermission === "function").map((handle) => ({ handle, state: "read", songs: 0 }));
  if (dirs.length) readAll(); else paint();
}
// для проверки
window.atlasPlayer = { stats: () => ({ albums: albums.map((a) => `${a.title}|${a.artist}|${a.songs.length}${a.cover ? "|обложка" : ""}`), view: view?.title || null,
  now: current()?.title || null, meta: navigator.mediaSession?.metadata ? [navigator.mediaSession.metadata.title, navigator.mediaSession.metadata.album, navigator.mediaSession.metadata.artwork.length].join("|") : "" }) };

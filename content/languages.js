// Языки — разговорники (перенос из travel-earth, Грегори 2026-10-29: «добавляем кнопки в барабан:
// Языки, Экскурсии, Мои альбомы»). Файлы папки «Языки» репозитория travel-earth, на язык — до трёх:
// разговорник, словарь, общие фразы. В барабане — кнопка «Языки», в её столбике — языки с флагами;
// нажатие открывает панель слева: вкладки (разговорник / словарь / общие фразы), «О языке», разделы
// (открыты первый и первый с фразами, остальные — по щелчку), источники. Щелчок по фразе — её читает
// голос языка страны; плеер «все подряд» — название раздела, фраза по-русски, затем на языке страны,
// карточка подсвечена и в кадре; щелчок по фразе во время чтения — продолжить с неё.
// Формат файла (как в travel-earth, промт — «Языки/_Промт — как написать разговорник.md»):
//   # Название · Язык: it-IT · Страны: Италия, Ватикан · Источники: + список · текст шапки — о языке
//   ## Раздел · ### Подзаголовок (диалог) · - по-русски — на языке — произношение (ударная ЗАГЛАВНАЯ)
//   «Вы: …», «Портье: …» в начале фразы — кто говорит; «- Bonjour. / Здравствуйте.» (формат ChatGPT)
//   тоже понимается; прочий текст — пояснения
import { register } from "../core/modules.js";
import { createPanel, isOpen } from "../core/panel.js";
import { repoFiles, repoText } from "../core/repo.js";
import { speakText, stopSpeech, langVoice } from "../core/speech.js";
import { langFlag } from "../core/flags.js";
import { emit } from "../core/events.js";
import { setSearchMode, searchMode } from "../core/search.js";

const ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="m12.87 15.07-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7 1.62-4.33L19.12 17h-3.24z"/></svg>';
const PLAYER = {
  prev: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>',
  fold: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7.41 18.59 8.83 20 12 16.83 15.17 20l1.41-1.41L12 14l-4.59 4.59zm9.18-13.18L15.17 4 12 7.17 8.83 4 7.41 5.41 12 10l4.59-4.59z"/></svg>',
  unfold: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 5.83 15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z"/></svg>',
};
const KINDS = [[/разговорник/i, "Разговорник"], [/словарь/i, "Словарь"], [/фразы/i, "Общие фразы"]];
const kindOf = (pb) => KINDS.find(([re]) => re.test(pb.title))?.[1] || "Фразы";
const kindRank = (pb) => { const i = KINDS.findIndex(([re]) => re.test(pb.title)); return i < 0 ? KINDS.length : i; };
// «Венгерский от ChatGPT — Разговорник» → «Венгерский»: пометка источника и вид — не в названии языка
const languageName = (pb) => pb.title.replace(/\s*(от\s+)?ChatGPT/gi, "").replace(/\s*[—–-]?\s*(разговорник|словарь|общие фразы|фразы)\s*$/i, "")
  .replace(/\s*[—–-]\s*$/, "").trim();

function parse(text, name) {
  const pb = { title: name.replace(/\.\w+$/, ""), lang: "", countries: [], idea: [], sources: [], sections: [] };
  let sec = null, inSources = false;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { inSources = false; continue; }
    let m;
    if ((m = line.match(/^#\s+(.+)/))) { pb.title = m[1].trim(); continue; }
    if ((m = line.match(/^##\s+(.+)/))) { sec = { title: m[1].trim(), items: [] }; pb.sections.push(sec); inSources = false; continue; }
    if (sec && (m = line.match(/^###\s+(.+)/))) { sec.items.push({ sub: m[1].trim() }); continue; }
    if (!sec && (m = line.match(/^(язык|страны|источники):\s*(.*)$/i))) {
      const key = m[1].toLowerCase();
      if (key === "язык") pb.lang = m[2].trim();
      else if (key === "страны") pb.countries = m[2].split(",").map((c) => c.trim()).filter(Boolean);
      else { inSources = true; if (m[2]) pb.sources.push(m[2]); }
      continue;
    }
    if (!sec && inSources && line.startsWith("- ")) { pb.sources.push(line.slice(2)); continue; }
    if (!sec) { pb.idea.push(line); continue; }
    let parts = line.startsWith("- ") ? line.slice(2).split(/\s+—\s+/) : null;
    // «- Bonjour. / Здравствуйте.» — на языке / по-русски, делит первая « / », за которой кириллица
    const slash = parts?.length === 1 && parts[0].match(/^(.+?)\s+\/\s+(?=[^/]*[А-Яа-яЁё])(.+)$/);
    if (slash) parts = [slash[2], slash[1]];
    if (parts?.length >= 2) {
      const who = parts[0].match(/^([^:]{1,20}):\s+(.+)$/);
      sec.items.push({ who: who?.[1] || "", ru: who?.[2] || parts[0], foreign: parts[1], say: parts.slice(2).join(" — ") });
    } else sec.items.push({ note: line.replace(/^-\s+/, "") });
  }
  return pb;
}

// источник «Название — https://…»
const source = (line) => {
  const m = line.match(/^(.*?)\s*[—–-]?\s*(https?:\/\/\S+)\s*$/);
  return m ? { text: m[1] || m[2], url: m[2] } : { text: line };
};

const languages = new Map(); // ключ (код языка) → { key, name, flag, books: [pb] }
let loading = null, current = null, kind = null;

function load() {
  loading ??= (async () => {
    const files = (await repoFiles("Языки")).filter((f) => /\.(md|txt)$/i.test(f.name));
    await Promise.all(files.map(async (f) => {
      const text = await repoText(f).catch(() => "");
      if (!text) return;
      const pb = { id: f.path, ...parse(text, f.name) };
      const key = pb.lang || languageName(pb);
      if (!languages.has(key)) languages.set(key, { key, name: languageName(pb), flag: "", books: [] });
      const lg = languages.get(key);
      lg.books.push(pb);
      lg.books.sort((a, b) => kindRank(a) - kindRank(b) || a.title.localeCompare(b.title, "ru"));
      // название и флаг — по разговорнику (у него обычно указаны страны)
      lg.name = languageName(lg.books[0]);
      const withCountry = lg.books.find((b) => b.countries.length) || lg.books[0];
      lg.flag = langFlag(withCountry.countries, withCountry.lang);
    }));
  })();
  return loading;
}

// ---------- панель ----------
const panel = createPanel({ id: "languages", title: "Языки", icon: ICON.replace('width="24" height="24"', 'width="18" height="18"'), side: "left" });
const h = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });
const btn = (icon, title, fn) => { const b = h("button", "pb-btn"); b.innerHTML = icon; b.title = title; b.addEventListener("click", fn); return b; };

let play = null; // { list: [{ it, b, box, sec }], lang, i, paused, run }
let list = [], foldAllBtn = null, playerBar = null, playerLabel = null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function stopPlay() {
  play = null;
  stopSpeech();
  for (const b of panel.body.querySelectorAll(".speaking")) b.classList.remove("speaking");
  renderPlayer();
}
async function step() {
  const p = play;
  if (!p) return;
  const run = p.run = {};
  const alive = () => play === p && p.run === run && !p.paused;
  renderPlayer();
  const { it, b, box, sec } = p.list[p.i];
  for (const x of panel.body.querySelectorAll(".speaking")) x.classList.remove("speaking");
  box.classList.remove("shut");
  updateFoldAll();
  b.classList.add("speaking");
  b.scrollIntoView({ block: "center", behavior: "smooth" });
  // новый раздел — сначала его название
  if (p.list[p.i - 1]?.sec !== sec) {
    await speakText(sec);
    if (!alive()) return;
    await wait(500);
  }
  if (!alive()) return;
  await speakText(it.ru);
  if (!alive()) return;
  await wait(400);
  if (!alive()) return;
  await speakText(it.foreign, p.lang);
  if (!alive()) return;
  await wait(1200);
  if (!alive()) return;
  b.classList.remove("speaking");
  if (p.i + 1 >= p.list.length) { stopPlay(); return; }
  p.i++;
  step();
}
function startPlay(from) {
  if (!list.length) return;
  stopSpeech();
  const first = list.findIndex((x) => !x.box.classList.contains("shut"));
  play = { list, lang: current.books.find((b) => b.id === kind)?.lang || "", i: from ?? Math.max(0, first), paused: false };
  step();
}
const go = (d) => { if (!play) return; play.i = Math.max(0, Math.min(play.list.length - 1, play.i + d)); play.paused = false; stopSpeech(); step(); };
const pause = () => {
  if (!play) { startPlay(); return; }
  play.paused = !play.paused;
  if (play.paused) { play.run = null; stopSpeech(); renderPlayer(); } else step();
};

function renderPlayer() {
  if (!playerBar) return;
  const main = btn(play && !play.paused ? PLAYER.pause : PLAYER.play,
    !play ? "Читать все фразы подряд — с первого раскрытого раздела" : play.paused ? "Продолжить" : "Пауза", pause);
  main.classList.toggle("on", !!play && !play.paused);
  const off = (b) => { b.disabled = !play; return b; };
  playerBar.replaceChildren(off(btn(PLAYER.prev, "Назад", () => go(-1))), main, off(btn(PLAYER.next, "Дальше", () => go(1))),
    off(btn(PLAYER.stop, "Стоп", stopPlay)), playerLabel);
  const cur = play?.list[play.i];
  playerLabel.textContent = cur ? `${play.i + 1} / ${play.list.length} · ${cur.sec}` : "";
}

function updateFoldAll() {
  if (!foldAllBtn) return;
  const open = [...panel.body.querySelectorAll(".pb-section")].some((x) => !x.classList.contains("shut"));
  foldAllBtn.innerHTML = open ? PLAYER.fold : PLAYER.unfold;
  foldAllBtn.title = open ? "Свернуть все разделы" : "Развернуть все разделы";
}

// раздел, который сворачивается щелчком по заголовку
function section(title, shut) {
  const box = h("section", `pb-section${shut ? " shut" : ""}`);
  const head = h("button", "pb-sec-title", title);
  head.addEventListener("click", () => { box.classList.toggle("shut"); updateFoldAll(); });
  const body = h("div", "pb-sec-body");
  box.append(head, body);
  return { box, body };
}

function render() {
  stopPlay();
  const lg = current;
  const pb = lg.books.find((b) => b.id === kind) || lg.books[0];
  kind = pb.id;
  panel.setTitle(lg.name);
  const nodes = [];
  // вкладки: разговорник / словарь / общие фразы
  if (lg.books.length > 1) {
    const tabs = h("div", "pb-tabs");
    for (const b of lg.books) {
      const t = h("button", `pb-tab${b === pb ? " on" : ""}`, kindOf(b));
      t.addEventListener("click", () => { kind = b.id; render(); const q = document.querySelector(".search-box input")?.value.trim(); if (q) filter(q); });
      tabs.append(t);
    }
    nodes.push(tabs);
  }
  // плеер «все подряд» и «свернуть все»
  playerBar = h("div", "pb-player");
  playerLabel = h("span", "pb-player-label");
  foldAllBtn = btn("", "", () => {
    const secs = [...panel.body.querySelectorAll(".pb-section")];
    const open = secs.some((x) => !x.classList.contains("shut"));
    for (const x of secs) x.classList.toggle("shut", open);
    updateFoldAll();
  });
  const bar = h("div", "pb-bar");
  bar.append(playerBar, foldAllBtn);
  nodes.push(bar);

  const about = section("О языке", false);
  for (const line of pb.idea) about.body.append(h("p", "pb-idea", line));
  about.body.append(h("p", "pb-hint", langVoice(pb.lang)
    ? "Нажмите на фразу — её прочитает голос на языке страны. Ударная гласная в подсказке — заглавная: грАцие."
    : "Нажмите на фразу, чтобы послушать. Голоса этого языка на устройстве не нашлось — фраза может прозвучать с акцентом или не прозвучать. В Windows голос добавляется так: Параметры → Время и язык → Речь → Добавить голоса."));
  nodes.push(about.box);

  list = [];
  // открыты первый раздел и первый с фразами (в «Произношении» одни правила — Грегори не нашёл «Buongiorno»)
  const firstPhrases = pb.sections.findIndex((sec) => sec.items.some((it) => it.foreign));
  pb.sections.forEach((sec, i) => {
    const { box, body } = section(sec.title, i && i !== firstPhrases);
    for (const it of sec.items) {
      if (it.sub) { body.append(h("div", "pb-sub", it.sub)); continue; }
      if (it.note) { body.append(h("p", "pb-note", it.note)); continue; }
      const b = h("button", "pb-phrase");
      b.title = "Послушать";
      const ru = h("div", "pb-ru");
      if (it.who) ru.append(h("b", "", `${it.who}: `));
      ru.append(it.ru);
      b.append(ru, h("div", "pb-foreign", it.foreign));
      if (it.say) b.append(h("div", "pb-say", it.say));
      const idx = list.push({ it, b, box, sec: sec.title }) - 1;
      b.addEventListener("click", () => {
        if (play) { play.i = idx; play.paused = false; stopSpeech(); step(); return; }
        // повторный щелчок по звучащей — стоп
        const was = b.classList.contains("speaking");
        stopSpeech();
        for (const x of panel.body.querySelectorAll(".speaking")) x.classList.remove("speaking");
        if (was) return;
        b.classList.add("speaking");
        speakText(it.foreign, pb.lang).then(() => b.classList.remove("speaking"));
      });
      body.append(b);
    }
    nodes.push(box);
  });
  if (pb.sources.length) {
    const src = section("Источники", true);
    for (const line of pb.sources) {
      const s = source(line);
      const div = h("div", "pb-source");
      if (s.url) div.append(Object.assign(document.createElement("a"), { href: s.url, target: "_blank", rel: "noopener", textContent: s.text }));
      else div.textContent = s.text;
      src.body.append(div);
    }
    nodes.push(src.box);
  }
  panel.body.replaceChildren(...nodes);
  panel.body.scrollTop = 0;
  renderPlayer();
  updateFoldAll();
}

// поиск фразы в открытом разговорнике — из строки поиска (по-русски, на языке, произношение);
// разделы без находок прячутся, с находками раскрываются; пустая строка — всё как было
function filter(text) {
  const q = text.toLowerCase();
  for (const sec of panel.body.querySelectorAll(".pb-section")) {
    if (!q) { sec.hidden = false; for (const x of sec.querySelectorAll(".pb-phrase, .pb-sub, .pb-note")) x.hidden = false; continue; }
    let found = 0;
    for (const x of sec.querySelectorAll(".pb-sub, .pb-note")) x.hidden = true;
    for (const b of sec.querySelectorAll(".pb-phrase")) {
      const hit = b.textContent.toLowerCase().includes(q);
      b.hidden = !hit;
      found += hit;
    }
    sec.hidden = !found;
    if (found) sec.classList.remove("shut");
  }
  updateFoldAll();
}
const MODE = { icon: ICON.replace('width="24" height="24"', 'width="20" height="20"'), title: "Языки", placeholder: "Найти фразу",
  filter, exit: () => panel.close() };

function openLanguage(key) {
  current = languages.get(key);
  if (!current) return;
  kind = null;
  render();
  panel.open();
  setSearchMode(MODE);
  emit("module", { id: "content/languages", on: true });
}

panel.onClose(() => {
  stopPlay();
  current = null;
  if (searchMode() === MODE) setSearchMode(null);
  emit("module", { id: "content/languages", on: false });
});

register({
  id: "content/languages",
  kind: "content",
  title: "Языки",
  tone: "lang",
  hint: "Разговорники: фразы для поездки с произношением, их можно послушать",
  icon: ICON,
  needs: ["network"],
  sends: "чтение разговорников (GitHub, сайт travel-earth), флаги (flagcdn)",
  column: {
    load,
    // языки по алфавиту; открытый — выделен
    items: () => [...languages.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((lg) => ({ id: lg.key, title: lg.name, thumb: lg.flag, selected: current === lg && isOpen("languages") })),
    choose: openLanguage,
    isOpen: () => isOpen("languages"),
    close: () => panel.close(),
  },
  // для проверки
  stats: () => ({ languages: languages.size, books: [...languages.values()].reduce((n, l) => n + l.books.length, 0),
    open: current?.name || null, phrases: list.length, playing: !!play }),
});

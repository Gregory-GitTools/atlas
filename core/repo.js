// Данные из репозитория travel-earth: Экскурсии, Языки, Альбомы пока живут там (CLAUDE.md, «Данные»),
// ChatGPT пишет туда же. Список файлов — GitHub API (дерево репозитория; без ключа — 60 запросов в
// час на адрес, поэтому дерево помнится на устройстве час), если API не ответил — список jsDelivr.
// Сами файлы — с сайта travel-earth (GitHub Pages, CORS открыт) с ?v=хэш: изменился файл — изменился
// хэш, и кэш браузера не отдаёт старое (опыт travel-earth: «правки долго не доходят»). Прочитанный
// файл тоже помнится на устройстве по хэшу — второй раз без сети
import { cacheGet, cacheSet } from "./storage.js";

const REPO = "Gregory-GitTools/travel-earth";
const SITE = "https://gregory-gittools.github.io/travel-earth/";
const TREE_MS = 3600 * 1000;
let tree = null;

async function loadTree() {
  const hit = await cacheGet("repo/tree").catch(() => null);
  if (hit && Date.now() - hit.t < TREE_MS) return hit.files;
  let files = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`, { signal: AbortSignal.timeout(15000) });
    if (r.ok) files = (await r.json()).tree.filter((x) => x.type === "blob").map((x) => ({ path: x.path, sha: x.sha, size: x.size }));
  } catch { /* ниже — запасной список */ }
  if (!files) {
    try {
      const r = await fetch(`https://data.jsdelivr.com/v1/packages/gh/${REPO}@main?structure=flat`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) files = (await r.json()).files.map((x) => ({ path: x.name.replace(/^\//, ""), sha: x.hash, size: x.size }));
    } catch { /* нет ни того, ни другого */ }
  }
  if (files) cacheSet("repo/tree", { t: Date.now(), files }).catch(() => {});
  // нет сети — устаревшее дерево лучше, чем ничего
  return files || hit?.files || [];
}

// файлы папки (без подпапок с «_» и файлов с «_» и «.» в начале имени — промты, служебное)
export async function repoFiles(dir) {
  tree ??= loadTree();
  const files = await tree;
  return files.filter((f) => f.path.startsWith(`${dir}/`))
    .map((f) => ({ ...f, name: f.path.split("/").pop() }))
    .filter((f) => !/^[_.]/.test(f.name));
}

// файл сайта travel-earth вне папок данных (границы стран)
export const repoSite = (path) => `${SITE}${path}`;
export const repoUrl = (f) => `${SITE}${f.path.split("/").map(encodeURIComponent).join("/")}?v=${encodeURIComponent(f.sha)}`;

// текст файла (UTF-8, иначе Windows-1251 — как в travel-earth)
export async function repoText(f) {
  const key = `repo/text/${f.sha}`;
  const hit = await cacheGet(key).catch(() => null);
  if (hit) return hit;
  const r = await fetch(repoUrl(f));
  if (!r.ok) throw new Error(`${f.path}: ${r.status}`);
  const buf = await r.arrayBuffer();
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { text = new TextDecoder("windows-1251").decode(buf); }
  cacheSet(key, text).catch(() => {});
  return text;
}

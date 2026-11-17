// Хранилище на устройстве: кэши (IndexedDB) и менеджер загружаемых моделей (Cache Storage).
// Модели — голоса, переводчик, ИИ — весят от десятков мегабайт до гигабайт: качаются один раз,
// в настройках видно, что скачано и сколько занимает, можно удалить. Хранилище просим
// «постоянным», чтобы браузер не стёр скачанное при нехватке места (решение «Данные и доступ»)
import * as settings from "./settings.js";

const DB = "atlas";
const STORES = ["cache"];
let dbPromise;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => STORES.forEach((s) => req.result.objectStoreNames.contains(s) || req.result.createObjectStore(s));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("cache", mode);
    const req = fn(t.objectStore("cache"));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
};

// кэш «ключ → значение» для модулей; ключ с приставкой модуля: "geo:Tallinn", "exif:…"
// нет записи — берётся копия из скачанной поездки ("trip/<ключ>", core/offline.js): её не стирает
// «Очистить историю просмотра», и без сети экскурсии, разговорники и места остановок остаются
const getRaw = (key) => tx("readonly", (s) => s.get(key));
export const cacheGet = async (key) => {
  const v = await getRaw(key);
  return v === undefined && !String(key).startsWith("trip/") ? getRaw(`trip/${key}`) : v;
};
// сохранить копию записи для скачанной поездки; вернуть, удалось ли
export async function keepForTrip(key) {
  const v = await getRaw(key);
  if (v === undefined) return (await getRaw(`trip/${key}`)) !== undefined;
  await cacheSet(`trip/${key}`, v);
  return true;
}
export const cacheSet = (key, value) => tx("readwrite", (s) => s.put(value, key));
export const cacheDelete = (key) => tx("readwrite", (s) => s.delete(key));

// запомненное при просмотре (найденные снимки Commons, тропы, места экскурсий, сведения о снимках,
// списки файлов): сколько записей и примерно сколько места; своё (треки, доступ к папкам) — не в счёт
const MINE = /^(tracks\/|trip\/|albums\/dirs?$)/;
export async function viewCache() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("cache", "readonly"), st = t.objectStore("cache"), req = st.openCursor();
    let n = 0, bytes = 0;
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (typeof c.key === "string" && !MINE.test(c.key)) {
        n++;
        try { bytes += c.key.length + JSON.stringify(c.value)?.length || 0; } catch { /* не строка */ }
      }
      c.continue();
    };
    t.oncomplete = () => resolve({ n, bytes });
    t.onerror = () => reject(t.error);
  });
}
// сколько места что занимает — для обзора в настройках (Грегори 2026-11-17, план «Карта без сети»):
// треки, копии записей для поездок, запомненное при просмотре — по записям хранилища (примерно, по длине JSON);
// плитки поездок — из их списка; модели — из своего списка; остальное (файлы программы, служебное браузера) — разница
export async function storageParts() {
  const d = await db();
  const parts = await new Promise((resolve, reject) => {
    const t = d.transaction("cache", "readonly"), req = t.objectStore("cache").openCursor();
    const p = { tracks: 0, trip: 0, view: 0 };
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (typeof c.key === "string") {
        let b = c.key.length;
        try { b += JSON.stringify(c.value)?.length || 0; } catch { /* не строка */ }
        if (c.key.startsWith("tracks/")) p.tracks += b;
        else if (c.key.startsWith("trip/")) p.trip += b;
        else if (!MINE.test(c.key)) p.view += b;
      }
      c.continue();
    };
    t.oncomplete = () => resolve(p);
    t.onerror = () => reject(t.error);
  });
  const { usage: total, quota, persisted } = await usage();
  return { ...parts, models: Object.values(models()).reduce((s, m) => s + (m.bytes || 0), 0), total, quota, persisted };
}

// забыть запомненное при просмотре (треки и выбранные папки остаются)
export async function clearViewCache() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("cache", "readwrite"), req = t.objectStore("cache").openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (typeof c.key === "string" && !MINE.test(c.key)) c.delete();
      c.continue();
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function persist() {
  if (!navigator.storage?.persist) return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}

export async function usage() {
  const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) || {};
  return { usage, quota, persisted: !!(await navigator.storage?.persisted?.()) };
}

// ── модели ──────────────────────────────────────────────────────────────────────────────
const MODEL_CACHE = "atlas-models";
const listKey = "models"; // { id: { title, url, bytes, saved } } — что скачано, для списка в настройках

export const models = () => settings.get(listKey, {});

// скачать (или взять уже скачанную) модель; onProgress(доля 0..1)
export async function model(id, { url, title }, onProgress) {
  const cache = await caches.open(MODEL_CACHE);
  const hit = await cache.match(url);
  if (hit) return hit.blob();
  await persist();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`не скачалось (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) onProgress?.(got / total);
  }
  const blob = new Blob(parts);
  await cache.put(url, new Response(blob, { headers: { "content-type": res.headers.get("content-type") || "" } }));
  settings.set(listKey, { ...models(), [id]: { title, url, bytes: blob.size, saved: new Date().toISOString() } });
  return blob;
}

export async function removeModel(id) {
  const list = models();
  if (!list[id]) return;
  await (await caches.open(MODEL_CACHE)).delete(list[id].url);
  delete list[id];
  settings.set(listKey, list);
}

export const formatBytes = (n) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1).replace(".", ",")} ГБ` : n >= 1e6 ? `${Math.round(n / 1e6)} МБ` : n >= 1e3 ? `${Math.round(n / 1e3)} КБ` : `${n} Б`;

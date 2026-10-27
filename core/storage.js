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
export const cacheGet = (key) => tx("readonly", (s) => s.get(key));
export const cacheSet = (key, value) => tx("readwrite", (s) => s.put(value, key));
export const cacheDelete = (key) => tx("readwrite", (s) => s.delete(key));

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
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} ГБ` : n >= 1e6 ? `${Math.round(n / 1e6)} МБ` : n >= 1e3 ? `${Math.round(n / 1e3)} КБ` : `${n} Б`;

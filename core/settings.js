// Настройки — одно хранилище на устройстве (localStorage, ключи "atlas.<имя>"). Ничего не уходит
// наружу; перенос на другое устройство — выгрузка в файл и загрузка из файла
import { saveFile } from "./save-file.js";

const PREFIX = "atlas.";

export function get(key, fallback = null) {
  const raw = localStorage.getItem(PREFIX + key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); } catch { return raw; }
}

export function set(key, value) {
  if (value === undefined || value === null) localStorage.removeItem(PREFIX + key);
  else localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

export function exportAll() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(PREFIX)) data[key.slice(PREFIX.length)] = get(key.slice(PREFIX.length));
  }
  return { app: "atlas", saved: new Date().toISOString(), settings: data };
}

export function importAll(file) {
  if (file?.app !== "atlas" || typeof file.settings !== "object") throw new Error("это не файл настроек Atlas");
  for (const [key, value] of Object.entries(file.settings)) set(key, value);
}

export function downloadSettings() {
  saveFile("atlas-настройки.json", JSON.stringify(exportAll(), null, 2), "application/json");
}

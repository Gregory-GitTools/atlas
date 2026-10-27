// Связь модулей: общие события вместо прямых вызовов. Модуль сообщает «выбрано место» или
// «язык страны», другие слушают — и ничего не знают друг о друге. Последнее значение каждого
// события запоминается: модуль, включённый позже, сразу получает текущее состояние.
//
// Принятые имена (дополнять здесь же):
//   place      — выбранное место { lngLat, title }
//   photo      — открытый снимок { id, source }
//   tour-stop  — текущая остановка экскурсии { tour, n }
//   language   — язык страны, которую смотрим { code, name }
//   panel      — открыта панель { id } или null

const handlers = new Map();
const last = new Map();

export function on(name, fn, { replay = true } = {}) {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(fn);
  if (replay && last.has(name)) fn(last.get(name));
  return () => handlers.get(name).delete(fn);
}

export function emit(name, data) {
  last.set(name, data);
  for (const fn of handlers.get(name) || []) {
    try { fn(data); } catch (err) { console.warn(`обработчик «${name}»:`, err); }
  }
}

export const current = (name) => last.get(name);

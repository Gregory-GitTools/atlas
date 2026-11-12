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
//   module     — модуль включён или выключен { id, on, keep } (keep — выключен запретом сети, а не рукой)
//   modules    — изменились разрешения сети: перерисовать списки модулей
//   languages-wanted — нужен список языков (экскурсии ищут разговорник страны)
//   languages  — список языков { key, name, countries }[] (отвечают «Языки»)
//   language-open — открыть разговорник { key }
//   search-mode — режим строки поиска { icon, title, tone } (раздел) или null (поиск мест)
//   search-exit — выйти из режима раздела (закрыли поиск кнопкой справа вверху)
//   me         — где я по навигации { lngLat } или null (выключена) — для «Куда идти»
//   nav        — навигация включена или выключена { on }
//   nav-switch — включить или выключить навигацию { on } (раздел «Навигация»)
//   route      — что показать окну навигации: точка, расстояние, сторона, стрелка, путь (core/route.js)
//   route-target — выбрать точку { lngLat, title } или null — убрать
//   route-way  — проложить путь { way: "foot" | "bike" | "car" } (второй раз — убрать)
//   route-open — «Сюда» в окне на карте: открыть окно навигации { lngLat, title }
//   route-show — карточка пути открылась: весь оставшийся путь на экран (есть сеть — пересчитать)
//   route-card — карточка пути видна или нет { open }
//   nav-hold   — карта не ходит за мной (открыта карточка пути) { hold }; снято — сразу ко мне
//   wind-time  — ветер включён и выбранное время { on, at } (at — unix, с; null — сейчас): кольца кайт-спотов
//   search-show — показать строку поиска и барабан разделов (окно раздела открыли не из барабана)

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

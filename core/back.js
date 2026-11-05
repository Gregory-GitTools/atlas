// Кнопка «Назад» телефона (Грегори 2026-11-05: «нужна»): как в обычных приложениях — закрывает последнее
// открытое (подсказки поиска, окно раздела, строку поиска), а не уходит со страницы. Открылось что-то —
// backable(close) кладёт шаг в историю браузера; «Назад» снимает его и зовёт close. Закрыли рукой —
// done() убирает свой шаг (history.back), чтобы следующее «Назад» не пропало впустую
const stack = [];
let skip = 0;

export function backable(close) {
  const entry = { close };
  stack.push(entry);
  history.pushState({ atlas: stack.length }, "");
  return () => {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    skip++;
    history.back();
  };
}

addEventListener("popstate", () => {
  if (skip) { skip--; return; }
  stack.pop()?.close();
});

// Esc на компьютере — то же, что «Назад» на телефоне (Грегори 2026-11-05): закрывает последнее открытое.
// Кто сам обработал Esc (строка поиска, колесо), ставит preventDefault — тогда здесь ничего
addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || !stack.length) return;
  e.preventDefault();
  history.back();
});

// для проверки
export const backDepth = () => stack.length;

// Виды слоя (Транспорт, Магазины, Тропы, Велодорожки, Дороги) — можно отметить несколько сразу
// (Грегори, 2026-10-28: «выбор может быть не одиночным»). Первый вид в списке — «все»: он
// снимает остальные, любой другой снимает «все». Выбор помнится (ключ настроек — массив id;
// старое одиночное значение тоже читается). Модуль отдаёт menu в register, а сам берёт selected()
import * as settings from "./settings.js";

export function profileMenu(key, profiles, title) {
  const all = profiles[0].id;
  const ids = () => {
    const v = settings.get(key);
    const known = (Array.isArray(v) ? v : v ? [v] : []).filter((id) => profiles.some((p) => p.id === id));
    return known.length ? known : [all];
  };
  const selected = () => profiles.filter((p) => ids().includes(p.id));
  return {
    selected,
    menu: {
      items: () => profiles.map((p) => ({ id: p.id, title: p.name, active: ids().includes(p.id) })),
      // подпись: один вид — его название, иначе название слоя
      label: () => {
        const s = selected();
        return s.length === 1 && s[0].id !== all ? s[0].name : title;
      },
      // только этот вид (слой был выключен)
      choose: (id) => settings.set(key, [id]),
      // отметить или снять вид; false — не осталось ни одного (слой выключается)
      toggle: (id) => {
        const cur = ids();
        const next = id === all ? (cur.includes(all) ? [] : [all])
          : cur.includes(id) ? cur.filter((x) => x !== id) : [...cur.filter((x) => x !== all), id];
        settings.set(key, next);
        return next.length > 0;
      },
    },
  };
}

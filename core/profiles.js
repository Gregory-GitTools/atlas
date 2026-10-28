// Виды слоя (Транспорт, Магазины, Тропы, Велодорожки, Дороги) — можно отметить несколько сразу
// (Грегори, 2026-10-28: «выбор может быть не одиночным»). Пункта «Все…» нет: снять всё — крестик
// у кружка (clear). Снят последний вид — слой выключается. У вида могут быть icon (значок кнопки)
// и color (цвет линий или флажков на карте — кольцо вокруг значка, вместо длинных описаний).
// Выбор помнится (ключ настроек — массив id; старое одиночное значение и «all» тоже читаются).
// Модуль отдаёт menu в register, а сам берёт selected()
import * as settings from "./settings.js";

export function profileMenu(key, profiles, title) {
  const ids = () => {
    const v = settings.get(key);
    const list = Array.isArray(v) ? v : v ? [v] : [];
    if (list.includes("all")) return profiles.map((p) => p.id);
    return list.filter((id) => profiles.some((p) => p.id === id));
  };
  // ничего не отмечено, а слой включён (первое включение, старые настройки) — все виды
  const selected = () => {
    const s = profiles.filter((p) => ids().includes(p.id));
    return s.length ? s : profiles;
  };
  return {
    selected,
    menu: {
      items: () => profiles.map((p) => ({ id: p.id, title: p.name, icon: p.icon, color: p.color, active: ids().includes(p.id) })),
      // подпись (подсказка кружка): один вид — его название, иначе название слоя
      label: () => {
        const s = ids();
        return s.length === 1 ? profiles.find((p) => p.id === s[0]).name : title;
      },
      // только этот вид (слой был выключен)
      choose: (id) => settings.set(key, [id]),
      // отметить или снять вид; false — не осталось ни одного (слой выключается)
      toggle: (id) => {
        const cur = ids();
        const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
        settings.set(key, next);
        return next.length > 0;
      },
      clear: () => settings.set(key, null),
    },
  };
}

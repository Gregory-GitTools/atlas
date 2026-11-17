// Размер кнопок и текста (Грегори 2026-11-17, магнитола ISUDAR 1280×720: «я за поиски дизайна»).
// Обычный скрипт в <head> (не модуль) — до первой отрисовки. Крупнее становится всё сразу, вместе с картой:
// страница раскладывается на меньшую ширину и растягивается на экран (viewport, как плотность экрана
// у Android) — раскладка та же, что на компьютере, только крупнее; отдельных размеров под машину нет.
// «Авто» — крупный на широком сенсорном экране лёжа без мыши (магнитола: 16:9 и шире, от 1000 точек;
// планшет 4:3 и 16:10, телефон лёжа — не попадают). Выбор — atlas.ui.scale: "auto" | 1 | 1.25 | 1.5.
// Где браузер этого не умеет (компьютер — там Ctrl и +), остаётся обычный размер, atlasUi.supported = false.
(function () {
  const meta = document.querySelector('meta[name="viewport"]');
  const BASE = "width=device-width, initial-scale=1, viewport-fit=cover";
  const KEY = "atlas.ui.scale";
  const root = document.documentElement;
  let applied = 1;
  let size = null; // экран при обычном размере, в точках CSS: [ширина, высота]

  const choice = () => {
    try { const v = JSON.parse(localStorage.getItem(KEY)); return [1, 1.25, 1.5].includes(v) ? v : "auto"; } catch { return "auto"; }
  };
  const car = () => {
    const [w, h] = size;
    return matchMedia("(pointer: coarse)").matches && !matchMedia("(hover: hover)").matches && w >= 1000 && w / h >= 1.7;
  };
  const target = () => (choice() === "auto" ? (car() ? 1.25 : 1) : choice());

  function measure() {
    meta.content = BASE;
    applied = 1;
    size = [root.clientWidth, root.clientHeight];
  }

  function apply() {
    const s = target();
    if (s === applied) return;
    if (s === 1) { meta.content = BASE; applied = 1; }
    else {
      const w = Math.round(size[0] / s);
      meta.content = `width=${w}, initial-scale=${s}, minimum-scale=${s}, viewport-fit=cover`;
      applied = s;
      // браузер не послушался (компьютер, WebView без широкой раскладки) — обычный размер
      if (Math.abs(root.clientWidth - w) > 2) { meta.content = BASE; applied = 1; window.atlasUi.supported = false; }
      else window.atlasUi.supported = true;
    }
    root.classList.toggle("ui-big", applied > 1);
    root.style.setProperty("--ui-scale", String(applied));
  }

  window.atlasUi = {
    supported: null, // умеет ли браузер крупный вид (проба при загрузке)
    get scale() { return applied; },
    get choice() { return choice(); },
    get auto() { return car() ? 1.25 : 1; },
    // выбрать размер ("auto" | 1 | 1.25 | 1.5); вернёт, какой получился
    set(v) {
      localStorage.setItem(KEY, JSON.stringify(v));
      apply();
      dispatchEvent(new Event("atlas-ui-scale"));
      return applied;
    },
  };

  measure();
  // умеет ли браузер растягивать страницу — пробуем сразу, пока страница пуста (в <head> это ничего не стоит)
  {
    const w = Math.round(size[0] / 1.25);
    meta.content = `width=${w}, initial-scale=1.25, minimum-scale=1.25, viewport-fit=cover`;
    window.atlasUi.supported = Math.abs(root.clientWidth - w) <= 2;
    meta.content = BASE;
  }
  apply();
  // повернули экран — заново от обычного размера
  matchMedia("(orientation: landscape)").addEventListener("change", () => { measure(); apply(); dispatchEvent(new Event("atlas-ui-scale")); });
})();

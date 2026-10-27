// Установка — первый раздел настроек. Опыт travel-earth (решения Грегори 2026-10-04): ставить из
// Microsoft Edge — ради его хороших голосов, какой бы браузер ни был основным; одна кнопка
// «Установить» (не в Edge она открывает Edge, там — сама установка); тексты — для людей; под
// кнопкой — «Установка и удаление вручную», с напоминанием, что программа записана в Windows.
// Адрес ?install — открыть настройки сразу на этом разделе (с него приходит Edge).
import { isMobile } from "./modules.js";

const SITE = "gregory-gittools.github.io/atlas";
const EDGE = `<img class="logo" src="icons/edge.svg" alt="">`;
const CHROME = `<img class="logo" src="icons/chrome.svg" alt="">`;

const IS_EDGE = !!navigator.userAgentData?.brands?.some((b) => /Edge/.test(b.brand)) || /\bEdg\//.test(navigator.userAgent);
const IS_WINDOWS = /Windows/.test(navigator.userAgent);
const INSTALLED = matchMedia("(display-mode: standalone), (display-mode: window-controls-overlay)").matches;
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

let prompt = null;
const waiting = new Set();
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  prompt = e;
  waiting.forEach((fn) => fn());
});
addEventListener("appinstalled", () => { prompt = null; waiting.forEach((fn) => fn()); });

export const openedForInstall = () => new URLSearchParams(location.search).has("install");

export function installSection() {
  const box = document.createElement("div");
  box.className = "install";
  const row = document.createElement("div");
  row.className = "install-row";
  const lead = document.createElement("p");
  lead.className = "install-lead";
  const btn = document.createElement("button");
  btn.className = "text-btn install-btn";
  const hint = document.createElement("p");
  hint.className = "set-hint";
  row.append(lead, btn);
  box.append(row, hint);

  const update = () => {
    btn.hidden = false;
    btn.disabled = false;
    hint.textContent = "";
    if (INSTALLED) {
      lead.textContent = "Программа установлена.";
      btn.hidden = true;
    } else if (isMobile()) {
      lead.textContent = "Значок «Atlas» на экран телефона.";
      btn.innerHTML = `<img class="logo" src="icons/icon-32.png" alt="">Установить`;
      btn.disabled = !prompt;
      if (!prompt) hint.textContent = "Если кнопка серая — меню браузера ⋮ → «Добавить на главный экран».";
    } else if (!IS_EDGE && IS_WINDOWS && !LOCAL) {
      lead.innerHTML = `Ярлык «Atlas» на рабочий стол — программа откроется в ${EDGE}Microsoft Edge, с хорошими голосами. Даже если у вас другой основной браузер.`;
      btn.innerHTML = `${EDGE}Установить`;
    } else {
      lead.innerHTML = IS_EDGE ? `Ярлык «Atlas» на рабочий стол — программа откроется в ${EDGE}Microsoft Edge, с хорошими голосами.`
        : "Ярлык «Atlas» на рабочий стол.";
      btn.innerHTML = `${EDGE}Установить`;
      btn.disabled = !prompt;
      if (!prompt) hint.textContent = "Если кнопка серая — программа уже установлена (есть в меню «Пуск»).";
    }
  };
  btn.addEventListener("click", async () => {
    if (!IS_EDGE && IS_WINDOWS && !LOCAL && !isMobile()) {
      const url = new URL(location.href);
      url.search = "?install";
      url.hash = "";
      location.href = `microsoft-edge:${url}`;
      return;
    }
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice;
    prompt = null;
    update();
  });
  waiting.add(update);
  update();

  const manual = document.createElement("details");
  manual.className = "install-manual";
  manual.innerHTML = isMobile()
    ? `<summary>Установка и удаление программы вручную</summary>
       <p><b>Установить</b></p>
       <ol><li>Откройте в ${CHROME}Chrome адрес <b>${SITE}</b></li>
       <li>Меню <b>⋮</b> → <b>Добавить на главный экран</b> → <b>Установить</b>.</li></ol>
       <p><b>Удалить</b></p>
       <ol><li>Долгое нажатие на значок Atlas → <b>Удалить</b>.</li></ol>`
    : `<summary>Установка и удаление программы вручную</summary>
       <p><b>Установить</b></p>
       <ol><li>Откройте в ${EDGE}Microsoft Edge адрес <b>${SITE}</b></li>
       <li>Меню <b>⋯</b> справа вверху → <b>Приложения</b> → <b>Установить Atlas</b>.</li>
       <li>Подтвердите и отметьте «Создать ярлык на рабочем столе».</li></ol>
       <p><b>Удалить</b></p>
       <ol><li>Пуск → <b>Параметры</b> → <b>Приложения</b>.</li>
       <li>Найдите <b>Atlas</b> → <b>Удалить</b>.</li></ol>
       <p class="set-hint">Удалить только ярлык с рабочего стола мало — программа записана в Windows.</p>`;
  box.append(manual);
  return box;
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

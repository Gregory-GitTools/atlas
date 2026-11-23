// Сохранить текст файлом. В приложении Android — в «Загрузки» телефона через AtlasApp.saveFile (Грегори
// 2026-11-22: «на телефоне не сработал экспорт GPX»: ссылка с download в WebView ничего не делает); в браузере —
// обычная загрузка
export function saveFile(name, text, type) {
  const app = window.AtlasApp;
  if (app?.saveFile) {
    const err = app.saveFile(name, type, text);
    say(!err ? `Сохранено в «Загрузки»: ${name}` : err === "ask" ? "Разрешите доступ к файлам и сохраните ещё раз" : `Файл не сохранён: ${err}`);
    return;
  }
  if (app) { say("Сохранение файлов — в новой версии приложения: обновите Atlas"); return; }
  const a = Object.assign(document.createElement("a"), { download: name, href: URL.createObjectURL(new Blob([text], { type })) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function say(text) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 5000);
}

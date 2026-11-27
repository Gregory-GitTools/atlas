// Четвёртая кнопка справа — «Плееры»: её барабан — выбор плеера (Грегори 2026-11-27: «Выбор плееров сделай в новой
// карусели. Добавь spotify и какой нибудь плайер стандартный от Microsoft и телефона»; барабан — core/layers-panel.js).
// Здесь — «Плеер Atlas» (player.html, core/music-player.js), не связанный с картой (Грегори 2026-11-26: «Это должно
// быть отдельным окном плеера, а на смартфоне просто самостоятельным плеером»). На компьютере — своё окно (уже
// открыто — поднять, музыка не прерывается); на телефоне и в приложении — во весь экран поверх карты: «Свернуть»
// прячет его, музыка играет дальше. Кнопка светится, пока играет
import { isMobile } from "./modules.js";

export const NOTE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
const URL_ = "player.html";

let frame = null, playing = false, song = "", ch = null;
const listeners = new Set();
const changed = () => { for (const f of listeners) f(); };
export const onPlayer = (f) => listeners.add(f);
export const playerPlaying = () => playing;
export const playerSong = () => song;

const overlay = () => {
  if (!frame) {
    frame = Object.assign(document.createElement("iframe"), { className: "player-frame", src: `${URL_}?embed=1`, title: "Плеер", allow: "autoplay" });
    document.body.append(frame);
  }
  frame.hidden = false;
  frame.focus();
  changed();
};
export function openPlayer() {
  if (isMobile()) return overlay();
  // окно с этим именем уже есть — window.open отдаёт его, не перезагружая (музыка не прерывается)
  const w = Math.min(460, screen.availWidth), h = Math.min(760, screen.availHeight);
  const win = window.open("", "atlas-player", `popup,width=${w},height=${h},left=${screen.availWidth - w - 40},top=60`);
  if (!win) return overlay(); // окна запрещены — поверх карты
  try { if (win.location.href === "about:blank") win.location.href = URL_; } catch { /* чужая страница */ }
  win.focus();
}
// крестик «Снять всё» у кнопки «Плеер Atlas» — пауза (окно остаётся)
export function stopPlayer() {
  ch?.postMessage({ stop: true });
  if (frame) frame.hidden = true;
  changed();
}

addEventListener("message", (e) => {
  if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
  if (e.data?.player === "hide") frame.hidden = true;
  else if (e.data?.player === "close") { frame.remove(); frame = null; playing = false; }
  changed();
});
if ("BroadcastChannel" in window) {
  ch = new BroadcastChannel("atlas-player");
  ch.addEventListener("message", (e) => { if ("playing" in (e.data || {})) { playing = !!e.data.playing; song = e.data.title || ""; changed(); } });
  ch.postMessage({ ask: true }); // окно плеера уже открыто с прошлого раза — пусть скажет, играет ли
}

export function playerButton() {
  return Object.assign(document.createElement("button"), { type: "button", className: "btn glass player-toggle", innerHTML: NOTE, title: "Плееры" });
}

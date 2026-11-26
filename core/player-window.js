// Четвёртая кнопка справа — «Плеер» (player.html, core/music-player.js), не связанная с картой (Грегори 2026-11-26:
// «Это должно быть отдельным окном плеера, а на смартфоне просто самостоятельным плеером»). На компьютере — своё
// окно (уже открыто — поднять, музыка не прерывается); на телефоне и в приложении — во весь экран поверх карты:
// «Свернуть» прячет его, музыка играет дальше. Кнопка светится, пока играет
import { isMobile } from "./modules.js";

const NOTE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
const URL_ = "player.html";

export function playerButton() {
  const btn = Object.assign(document.createElement("button"), { type: "button", className: "btn glass player-toggle", innerHTML: NOTE, title: "Плеер" });
  let frame = null, playing = false, song = "";
  const paint = () => {
    btn.classList.toggle("open", playing || !!(frame && !frame.hidden));
    btn.title = playing && song ? `Плеер — играет: ${song}` : "Плеер";
  };
  const overlay = () => {
    if (!frame) {
      frame = Object.assign(document.createElement("iframe"), { className: "player-frame", src: `${URL_}?embed=1`, title: "Плеер", allow: "autoplay" });
      document.body.append(frame);
    }
    frame.hidden = false;
    frame.focus();
    paint();
  };
  btn.addEventListener("click", () => {
    if (isMobile()) return overlay();
    // окно с этим именем уже есть — window.open отдаёт его, не перезагружая (музыка не прерывается)
    const w = Math.min(460, screen.availWidth), h = Math.min(760, screen.availHeight);
    const win = window.open("", "atlas-player", `popup,width=${w},height=${h},left=${screen.availWidth - w - 40},top=60`);
    if (!win) return overlay(); // окна запрещены — поверх карты
    try { if (win.location.href === "about:blank") win.location.href = URL_; } catch { /* чужая страница */ }
    win.focus();
  });
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
    if (e.data?.player === "hide") frame.hidden = true;
    else if (e.data?.player === "close") { frame.remove(); frame = null; playing = false; }
    paint();
  });
  if ("BroadcastChannel" in window) {
    const ch = new BroadcastChannel("atlas-player");
    ch.addEventListener("message", (e) => { if ("playing" in (e.data || {})) { playing = !!e.data.playing; song = e.data.title || ""; paint(); } });
    ch.postMessage({ ask: true }); // окно плеера уже открыто с прошлого раза — пусть скажет, играет ли
  }
  return btn;
}

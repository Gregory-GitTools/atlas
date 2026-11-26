// Версия Atlas (Грегори 2026-11-21: «нигде не написана версия приложения») — в ⓘ первой строкой и в
// «Настройках». Номер общий у сайта и приложения Android (versionName): новый — при каждом выпуске.
// Сайт обновляется сам, без приложения, поэтому рядом — дата обновления страницы, а в приложении —
// ещё и номер установленной оболочки (у старых сборок без AtlasApp — по тому, что она умеет)
export const VERSION = "1.12";

export const updated = () => {
  const d = new Date(document.lastModified);
  return `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
};

export function appVersion() {
  try { if (window.AtlasApp?.version) return window.AtlasApp.version(); } catch { /* старая оболочка */ }
  const w = window;
  return w.AtlasPhotos ? "1.4" : w.AtlasTrack?.setSlopes ? "1.3" : w.AtlasTrack ? "1.2" : w.AtlasGps ? "1.1" : w.Capacitor?.isNativePlatform?.() ? "1.0" : null;
}

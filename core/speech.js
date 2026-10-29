// Голос для чтения (перенос из travel-earth): голоса браузера и системы (speechSynthesis). По-русски —
// лучший из найденных: «естественные» онлайн-голоса (Edge: Svetlana/Dmitry Online), потом «Google
// русский» (Chrome), потом простые голоса Windows. Фраза на языке страны — голосом этого языка, сначала
// того же региона (it-IT), потом любой it-*. Текст читается по предложениям: Chrome обрывает длинную
// фразу онлайн-голоса через ~15 с. Свой голос (Piper) — позже, папка voices/ (ROADMAP)

export const canSpeak = () => "speechSynthesis" in window;
const voiceRank = (v) => (/natural|neural|online/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : 2);
const norm = (l) => l.toLowerCase().replace("_", "-");

export function langVoice(lang = "ru-RU") {
  if (!canSpeak()) return null;
  const base = norm(lang).split("-")[0];
  const exact = (v) => (norm(v.lang) === norm(lang) ? 0 : 1);
  return speechSynthesis.getVoices().filter((v) => norm(v.lang).split("-")[0] === base)
    .sort((a, b) => exact(a) - exact(b) || voiceRank(a) - voiceRank(b))[0] || null;
}

// остановить речь — только если она идёт: на Android Chrome cancel() вплотную перед speak() глотает
// новую фразу (опыт travel-earth)
export function stopSpeech() {
  if (canSpeak() && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
}

// прочитать текст (lang — язык фразы, по умолчанию русский); промис — когда дочитано или прервано
export function speakText(text, lang = "ru-RU") {
  return new Promise((resolve) => {
    if (!canSpeak() || !text) { resolve(); return; }
    speechSynthesis.resume(); // Chrome иногда держит синтезатор на паузе
    const voice = langVoice(lang);
    const parts = text.match(/[^.!?…]+[.!?…]*\s*/g)?.map((x) => x.trim()).filter(Boolean) || [text];
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = voice?.lang || lang;
      if (voice) u.voice = voice;
      if (i === parts.length - 1) u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
    // Chrome иногда не присылает onend — тогда «дочитано», когда синтезатор замолчал
    const poll = setInterval(() => {
      if (!speechSynthesis.speaking && !speechSynthesis.pending) { clearInterval(poll); resolve(); }
    }, 700);
  });
}

// Android Chrome: речь, начатая не прямо в обработчике касания, может молчать — при первом касании
// страницы синтезатор «разблокируется» беззвучной фразой
let unlocked = false;
function unlock() {
  if (unlocked || !canSpeak()) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  speechSynthesis.speak(u);
}
for (const ev of ["pointerdown", "touchend", "keydown"]) addEventListener(ev, unlock, { capture: true, once: true });
// список голосов приходит не сразу
if (canSpeak()) speechSynthesis.getVoices();

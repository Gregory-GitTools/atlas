// Рассказ альбома — разбор текстовых файлов папки (подписи-экскурсии, как в travel-earth, Грегори 2026-09-30:
// «положить текстовые файлы в альбомы как экскурсии»). Формат для Блокнота: «# Название» — название рассказа (иначе
// имя файла); «## Раздел» — заголовок; строка, где только имя снимка из этой папки, — абзац сразу под ней становится
// подписью к снимку; остальное — абзацы рассказа (пустая строка — новый абзац). Несколько файлов — по порядку имён.
// Кодировка — UTF-8, не читается — Windows-1251 (старый Блокнот)
export function parseStory(texts, names) {
  const byName = new Map(names.map((n) => [n.toLowerCase(), n]));
  // имя без расширения тоже годится: «IMG_1234» — и для IMG_1234.HEIC, и для живого фото
  for (const n of names) { const k = n.replace(/\.[^.]+$/, "").toLowerCase(); if (!byName.has(k)) byName.set(k, n); }
  const blocks = [], captions = new Map();
  let title = "", para = [], photo = null;
  const endPara = () => {
    if (!para.length) return;
    const text = para.join(" ");
    if (photo) { captions.set(photo.toLowerCase(), text); blocks.push({ type: "photo", file: photo, text }); photo = null; } else blocks.push({ type: "p", text });
    para = [];
  };
  const endPhoto = () => { if (photo) { blocks.push({ type: "photo", file: photo, text: "" }); photo = null; } };
  for (const [name, text] of [...texts].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) { endPara(); continue; }
      const head = /^(#{1,3})\s+(.+)/.exec(line);
      if (head) {
        endPara(); endPhoto();
        if (head[1] === "#" && !title) title = head[2]; else blocks.push({ type: "h", text: head[2] });
        continue;
      }
      const file = byName.get(line.toLowerCase());
      if (file) { endPara(); endPhoto(); photo = file; continue; }
      para.push(line);
    }
    endPara(); endPhoto();
    if (!title) title = name.replace(/\.(txt|md)$/i, "");
  }
  return blocks.length ? { title, blocks, captions } : null;
}
export const decode = (bytes) => { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("windows-1251").decode(bytes); } };

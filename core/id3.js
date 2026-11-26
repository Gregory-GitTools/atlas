// Теги ID3v2 песен mp3: название, исполнитель, альбом, исполнитель альбома, номер песни, обложка — для «Музыки»
// (content/music.js) и плеера (player.html). Без тегов — «Исполнитель - Название» из имени файла
const covers = new Map(); // одинаковая обложка у песен альбома — одна ссылка
function coverUrl(bytes, mime) {
  const key = `${bytes.length}:${bytes.subarray(64, 96).join(",")}`;
  if (!covers.has(key)) covers.set(key, URL.createObjectURL(new Blob([bytes], { type: mime || "image/jpeg" })));
  return covers.get(key);
}
function text(b, enc) {
  const label = enc === 0 ? "latin1" : enc === 1 ? "utf-16" : enc === 2 ? "utf-16be" : "utf-8";
  return new TextDecoder(label).decode(b).replace(/\0+$/, "").split("\0")[0].trim();
}
const FIELDS = { TIT2: "title", TPE1: "artist", TALB: "album", TPE2: "albumArtist", TRCK: "track" };
export async function id3(file) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {};
  const ver = head[3], size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
  if (ver < 3 || ver > 4) return {};
  const b = new Uint8Array(await file.slice(10, 10 + Math.min(size, 8e6)).arrayBuffer());
  const out = {};
  let p = head[5] & 0x40 ? (ver === 4 ? (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3] : ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) + 4) : 0;
  while (p + 10 < b.length && b[p]) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const len = ver === 4 ? (b[p + 4] << 21) | (b[p + 5] << 14) | (b[p + 6] << 7) | b[p + 7] : (b[p + 4] << 24) | (b[p + 5] << 16) | (b[p + 6] << 8) | b[p + 7];
    const body = b.subarray(p + 10, p + 10 + len);
    p += 10 + len;
    if (len <= 0) break;
    if (FIELDS[id]) out[FIELDS[id]] = text(body.subarray(1), body[0]);
    else if (id === "APIC" && !out.cover) {
      const enc = body[0];
      let i = 1;
      while (i < body.length && body[i]) i++;
      const mime = new TextDecoder("latin1").decode(body.subarray(1, i));
      i += 2; // ноль и вид картинки
      if (enc === 1 || enc === 2) { while (i + 1 < body.length && (body[i] || body[i + 1])) i += 2; i += 2; }
      else { while (i < body.length && body[i]) i++; i++; }
      if (i < body.length) out.cover = coverUrl(body.slice(i), mime);
    }
  }
  if (out.track) out.track = parseInt(out.track, 10) || 0; // «3/12» → 3
  return out;
}
// без тегов — «Исполнитель - Название» из имени файла
export function fromName(name) {
  const base = name.replace(/\.[^.]+$/, "").replace(/^\d+[\s._-]+/, "").replace(/_/g, " ").trim();
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1], title: m[2] } : { artist: "", title: base };
}

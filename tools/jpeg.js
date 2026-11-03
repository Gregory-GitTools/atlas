// Сведения о снимке (EXIF) при сохранении правки. Холст (canvas.toBlob) пишет JPEG без EXIF — без
// него пропали бы место съёмки (по нему снимок стоит на карте), дата, камера. Поэтому блок EXIF
// исходного файла переносится в новый как есть, целиком (photo-editor переписывал только камеру,
// дату и место — остальное терялось), и в нём поправляются две вещи: поворот (Orientation = 1 —
// поворот из EXIF уже впечатан в пиксели) и размер кадра (PixelX/YDimension — после обрезки он другой)

const EXIF = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"

// блок APP1 с EXIF из начала JPEG (он в первых 64 КБ после начала файла) или null
async function exifSegment(file) {
  const b = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let o = 2; o + 4 <= b.length && b[o] === 0xff;) {
    const marker = b[o + 1], len = (b[o + 2] << 8) | b[o + 3];
    if (marker === 0xda || marker === 0xd9) return null; // начались сами данные снимка
    if (marker === 0xe1 && EXIF.every((x, i) => b[o + 4 + i] === x)) return o + 2 + len <= b.length ? b.slice(o, o + 2 + len) : null;
    o += 2 + len;
  }
  return null;
}

// поправить в блоке: поворот и размер кадра
function patch(seg, width, height) {
  const t = 10; // начало TIFF внутри блока: FF E1, длина (2), "Exif\0\0"
  const v = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
  const little = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, little), u32 = (o) => v.getUint32(t + o, little);
  const ok = (o, n) => o >= 0 && t + o + n <= seg.byteLength;
  const ifd = (at, fn) => {
    if (!ok(at, 2)) return;
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (!ok(e, 12)) return;
      fn(u16(e), u16(e + 2), e);
    }
  };
  const set = (type, e, value) => {
    if (type === 3) v.setUint16(t + e + 8, value, little);
    else if (type === 4) v.setUint32(t + e + 8, value, little);
  };
  if (!ok(4, 4)) return;
  ifd(u32(4), (tag, type, e) => {
    if (tag === 0x0112) set(type, e, 1);
    if (tag === 0x8769) ifd(u32(e + 8), (tag2, type2, e2) => {
      if (tag2 === 0xa002) set(type2, e2, width);
      if (tag2 === 0xa003) set(type2, e2, height);
    });
  });
}

// новый JPEG (с холста) + EXIF исходного файла; у исходника EXIF нет — как есть
export async function keepExif(blob, original, width, height) {
  const seg = await exifSegment(original).catch(() => null);
  if (!seg) return blob;
  try { patch(seg, width, height); } catch { return blob; }
  const b = new Uint8Array(await blob.arrayBuffer());
  // блок JFIF холста (APP0) EXIF не нужен: по правилам EXIF его блок — сразу после начала файла
  const rest = b[2] === 0xff && b[3] === 0xe0 ? 4 + ((b[4] << 8) | b[5]) : 2;
  return new Blob([b.subarray(0, 2), seg, b.subarray(rest)], { type: "image/jpeg" });
}

// для проверки: поворот и размер кадра в EXIF файла
export async function exifFacts(file) {
  const seg = await exifSegment(file);
  if (!seg) return null;
  const facts = {};
  const t = 10, v = new DataView(seg.buffer, seg.byteOffset, seg.byteLength), little = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, little), u32 = (o) => v.getUint32(t + o, little);
  const val = (type, e) => (type === 3 ? u16(e + 8) : u32(e + 8));
  const walk = (at, fn) => { const n = u16(at); for (let i = 0; i < n; i++) { const e = at + 2 + i * 12; fn(u16(e), u16(e + 2), e); } };
  walk(u32(4), (tag, type, e) => {
    if (tag === 0x0112) facts.orientation = val(type, e);
    if (tag === 0x8825) facts.gps = true;
    if (tag === 0x8769) walk(u32(e + 8), (tag2, type2, e2) => {
      if (tag2 === 0xa002) facts.width = val(type2, e2);
      if (tag2 === 0xa003) facts.height = val(type2, e2);
    });
  });
  return facts;
}

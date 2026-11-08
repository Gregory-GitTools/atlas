// Сведения о снимке (EXIF) при сохранении правки. Холст (canvas.toBlob) пишет JPEG без EXIF — без
// него пропали бы место съёмки (по нему снимок стоит на карте), дата, камера. Поэтому блок EXIF
// исходного файла переносится в новый как есть, целиком (photo-editor переписывал только камеру,
// дату и место — остальное терялось), и в нём поправляются две вещи: поворот (Orientation = 1 —
// поворот из EXIF уже впечатан в пиксели) и размер кадра (PixelX/YDimension — после обрезки он другой)

const EXIF = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"

// блок APP1 с EXIF из начала JPEG (он в первых 64 КБ после начала файла) или null
async function exifSegment(file) {
  return (await findExif(file))?.seg || null;
}
// он же и где лежит в файле
async function findExif(file) {
  const b = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let o = 2; o + 4 <= b.length && b[o] === 0xff;) {
    const marker = b[o + 1], len = (b[o + 2] << 8) | b[o + 3];
    if (marker === 0xda || marker === 0xd9) return null; // начались сами данные снимка
    if (marker === 0xe1 && EXIF.every((x, i) => b[o + 4 + i] === x)) return o + 2 + len <= b.length ? { seg: b.slice(o, o + 2 + len), at: o } : null;
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

// новый JPEG (с холста) + EXIF исходного файла; у исходника EXIF нет — как есть. meta — поправленные
// дата, камера, место (tools/info.js)
export async function keepExif(blob, original, width, height, meta = null) {
  let seg = await exifSegment(original).catch(() => null);
  if (!seg && !meta) return blob;
  try { if (seg) patch(seg, width, height); } catch { if (!meta) return blob; seg = null; }
  if (meta) seg = withMeta(seg, meta);
  const b = new Uint8Array(await blob.arrayBuffer());
  // блок JFIF холста (APP0) EXIF не нужен: по правилам EXIF его блок — сразу после начала файла
  const rest = b[2] === 0xff && b[3] === 0xe0 ? 4 + ((b[4] << 8) | b[5]) : 2;
  return new Blob([b.subarray(0, 2), seg, b.subarray(rest)], { type: "image/jpeg" });
}

// ---------- дата, камера, место ----------
// Блок EXIF не пересобирается: всё старое остаётся на своих местах (внутри MakerNote камеры — свои
// ссылки на смещения: сдвинь его, и сведения камеры испортятся), новые оглавления (IFD0, Exif, GPS) с
// поправленным дописываются в конец блока, а начало TIFF указывает на новое IFD0. Старые записи
// остаются в блоке, на них просто никто не ссылается. EXIF нет (сканы) — заводится пустой
const EMPTY_TIFF = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function tiffOf(tiff) {
  const little = tiff[0] === 0x49, v = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (o) => v.getUint16(o, little), u32 = (o) => v.getUint32(o, little);
  const read = (at) => {
    if (!at || at + 2 > tiff.length) return { list: [], next: 0 };
    const n = u16(at), list = [];
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > tiff.length) break;
      list.push({ tag: u16(e), type: u16(e + 2), count: u32(e + 4), raw: [...tiff.subarray(e + 8, e + 12)] });
    }
    const end = at + 2 + n * 12;
    return { list, next: end + 4 <= tiff.length ? u32(end) : 0 };
  };
  const word = (raw) => new DataView(Uint8Array.from(raw).buffer).getUint32(0, little);
  // значение записи: до 4 байт — в ней самой, длиннее — по смещению
  const data = (e) => {
    const n = (SIZE[e.type] || 1) * e.count;
    if (n <= 4) return Uint8Array.from(e.raw.slice(0, n));
    const at = word(e.raw);
    return at + n <= tiff.length ? tiff.slice(at, at + n) : new Uint8Array(0);
  };
  const ptr = (ifd, tag) => { const e = ifd.list.find((x) => x.tag === tag); return e ? word(e.raw) : 0; };
  const ifd0 = read(u32(4));
  return { little, data, ifd0, exif: read(ptr(ifd0, 0x8769)), gps: read(ptr(ifd0, 0x8825)) };
}

// дата — «ГГГГ:ММ:ДД чч:мм:сс» (как в EXIF), камера — производитель и модель, место — градусы
export async function readMeta(file) {
  const seg = await exifSegment(file).catch(() => null);
  if (!seg) return {};
  try {
    const t = tiffOf(seg.subarray(10)), meta = {};
    const text = (ifd, tag) => {
      const e = ifd.list.find((x) => x.tag === tag);
      return e?.type === 2 ? new TextDecoder().decode(t.data(e)).split("\0")[0].trim() : "";
    };
    const deg = (tag) => {
      const e = t.gps.list.find((x) => x.tag === tag);
      if (e?.type !== 5 || e.count < 3) return null;
      const d = new DataView(t.data(e).buffer), r = (i) => d.getUint32(i * 8, t.little) / (d.getUint32(i * 8 + 4, t.little) || 1);
      return r(0) + r(1) / 60 + r(2) / 3600;
    };
    meta.date = text(t.exif, 0x9003) || text(t.exif, 0x9004) || text(t.ifd0, 0x0132);
    meta.camera = [text(t.ifd0, 0x010f), text(t.ifd0, 0x0110)].filter(Boolean).join(" ");
    const lat = deg(2), lon = deg(4);
    if (lat !== null && lon !== null && (lat || lon)) meta.gps = [text(t.gps, 1) === "S" ? -lat : lat, text(t.gps, 3) === "W" ? -lon : lon];
    return meta;
  } catch { return {}; }
}

// блок EXIF (или null) + поправки { date, camera, gps: [lat, lon] | null } → новый блок
function withMeta(seg, meta) {
  const tiff = seg ? seg.subarray(10) : Uint8Array.from(EMPTY_TIFF);
  const t = tiffOf(tiff), little = t.little, out = [...tiff];
  const b16 = (x) => (little ? [x & 255, (x >> 8) & 255] : [(x >> 8) & 255, x & 255]);
  const b32 = (x) => (little ? [x & 255, (x >> 8) & 255, (x >> 16) & 255, (x >>> 24) & 255] : [(x >>> 24) & 255, (x >> 16) & 255, (x >> 8) & 255, x & 255]);
  const pad = () => { if (out.length % 2) out.push(0); };
  const value = (type, count, bytes) => {
    if (bytes.length <= 4) return { type, count, raw: [...bytes, 0, 0, 0, 0].slice(0, 4) };
    pad();
    const at = out.length;
    out.push(...bytes);
    return { type, count, raw: b32(at) };
  };
  const ascii = (s) => { const d = [...new TextEncoder().encode(s), 0]; return value(2, d.length, d); };
  const put = (ifd, tag, val) => { ifd.list = ifd.list.filter((e) => e.tag !== tag); if (val) ifd.list.push({ tag, ...val }); };
  const write = (ifd) => {
    ifd.list.sort((a, b) => a.tag - b.tag);
    pad();
    const at = out.length;
    out.push(...b16(ifd.list.length));
    for (const e of ifd.list) out.push(...b16(e.tag), ...b16(e.type), ...b32(e.count), ...e.raw);
    out.push(...b32(ifd.next || 0));
    return at;
  };
  const { ifd0, exif, gps } = t;
  if (meta.date !== undefined) {
    put(exif, 0x9003, meta.date ? ascii(meta.date) : null);
    put(exif, 0x9004, meta.date ? ascii(meta.date) : null);
  }
  if (meta.camera !== undefined) {
    // одной строкой — в «производителя», модель убирается (как в photo-editor)
    put(ifd0, 0x010f, meta.camera ? ascii(meta.camera) : null);
    put(ifd0, 0x0110, null);
  }
  if (meta.gps !== undefined) {
    for (const tag of [0, 1, 2, 3, 4]) put(gps, tag, null);
    if (meta.gps) {
      const [lat, lon] = meta.gps;
      const dms = (x) => {
        x = Math.abs(x);
        const d = Math.floor(x), m = Math.floor((x - d) * 60), s = Math.round(((x - d) * 60 - m) * 60 * 10000);
        return [[d, 1], [m, 1], [s, 10000]].flatMap(([n, q]) => [...b32(n), ...b32(q)]);
      };
      put(gps, 0, value(1, 4, [2, 3, 0, 0]));
      put(gps, 1, ascii(lat < 0 ? "S" : "N"));
      put(gps, 2, value(5, 3, dms(lat)));
      put(gps, 3, ascii(lon < 0 ? "W" : "E"));
      put(gps, 4, value(5, 3, dms(lon)));
    }
  }
  const exifAt = exif.list.length ? write(exif) : 0, gpsAt = gps.list.length ? write(gps) : 0;
  put(ifd0, 0x8769, exifAt ? { type: 4, count: 1, raw: b32(exifAt) } : null);
  put(ifd0, 0x8825, gpsAt ? { type: 4, count: 1, raw: b32(gpsAt) } : null);
  out.splice(4, 4, ...b32(write(ifd0)));
  const len = 2 + EXIF.length + out.length;
  if (len > 0xffff) throw new Error("сведения о снимке не помещаются в файл");
  return Uint8Array.from([0xff, 0xe1, len >> 8, len & 255, ...EXIF, ...out]);
}

// только сведения, без пересчёта снимка: тот же JPEG, в нём — новый блок EXIF (качество не теряется)
export async function setMeta(file, meta) {
  const found = await findExif(file).catch(() => null);
  const seg = withMeta(found?.seg || null, meta);
  const at = found ? found.at : 2, skip = found ? found.seg.length : 0;
  return new Blob([file.slice(0, at), seg, file.slice(at + skip)], { type: "image/jpeg" });
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

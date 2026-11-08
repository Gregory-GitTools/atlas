// 3D-параллакс (ИИ, 2026-11-08): нейросеть Depth Anything V2 Small (Apache-2.0) строит карту
// глубины готового кадра (с обработкой, поворотом и рамкой — `api.frame()`), и снимок оживает:
// ближнее и дальнее сдвигаются по-разному (WebGL — каждая точка берётся со сдвигом по своей глубине,
// глубина уточняется тремя шагами, чтобы края предметов не двоились). Движение — «Круг», «Качели»,
// «Наезд»; «Записать ролик» — два круга (8 с) в файл рядом со снимком («… 3D.mp4», где браузер
// не умеет MP4 — .webm). Снимок не меняется. Модель — с CDN при первом открытии (≈ 27 МБ)
import { transformers, progress } from "./background.js";

const PERIOD = 4000; // один круг движения, мс
const VIDEO_MAX = 1920; // ролик — не больше Full HD по длинной стороне
const MOTIONS = [
  { key: "orbit", label: "Круг", d: "M12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-6-6V2l4 3-4 3z" },
  { key: "sway", label: "Качели", d: "M7 7l-5 5 5 5v-4h10v4l5-5-5-5v4H7z" },
  { key: "zoom", label: "Наезд", d: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zm.5-7H9v2H7v1h2v2h1v-2h2V9h-2z" },
];
const ICON = "M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3 6.7 3.7L12 11.7 5.3 8 12 4.3zM5 9.7l6 3.3v6.6l-6-3.3V9.7zm8 9.9V13l6-3.3v6.6l-6 3.3z";
const REC = "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z";

let estimator = null;
const depthModel = (say) => (estimator ??= transformers().then((T) =>
  T.pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", { dtype: "q8", progress_callback: progress(say, "3D") }).then((run) => ({ T, run })),
).catch((err) => { estimator = null; throw err; }));

// сдвиг выборки по глубине: off — параллакс, zoom — наезд (ближнее растёт быстрее), S — запас по краям
const FRAG = `precision highp float;
uniform sampler2D img, dep; uniform vec2 off; uniform float zoom, S; varying vec2 uv;
vec2 at(vec2 p, float d) { return (p - 0.5) / (S * (1.0 + zoom * d)) + 0.5 - off * (d - 0.5); }
void main() {
  float d = texture2D(dep, uv).r;
  for (int i = 0; i < 3; i++) d = texture2D(dep, at(uv, d)).r;
  gl_FragColor = texture2D(img, at(uv, d));
}`;
const VERT = "attribute vec2 p; varying vec2 uv; void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }";

export default function depth(ed) {
  const el = Object.assign(document.createElement("div"), { className: "edit-group" });
  const toggle = ed.button(ed.svg(ICON), "3D-параллакс — снимок оживает (нейросеть: глубина)", () => ed.panel("depth"));
  el.append(toggle);
  const row = Object.assign(document.createElement("div"), { className: "edit-3d-row", hidden: true });
  let motion = "orbit";
  const moves = MOTIONS.map((m) => {
    const b = ed.button(ed.svg(m.d), m.label, () => { motion = m.key; t0 = performance.now(); paint(); });
    row.append(b);
    return [m.key, b];
  });
  const rec = ed.button(ed.svg(REC), `Записать ролик ${(2 * PERIOD) / 1000} с — рядом со снимком`, record);
  rec.classList.add("edit-3d-rec");
  row.append(rec);
  ed.sub.append(row);
  const paint = () => { for (const [k, b] of moves) b.classList.toggle("on", k === motion); };
  paint();

  // холст WebGL поверх снимка, размер — кадра (до Full HD), на экране — вписан
  const view = Object.assign(document.createElement("canvas"), { className: "edit-3d", hidden: true });
  document.querySelector(".stage").append(view);
  let gl = null, prog = null, texImg = null, texDep = null;
  function setup() {
    gl = view.getContext("webgl", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL недоступен");
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    const tex = (unit, name) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
      return t;
    };
    texImg = tex(0, "img");
    texDep = tex(1, "dep");
  }

  // кадр и его глубина — заново, когда изменилось то, из чего кадр собран
  let built = "", pending = "", job = 0, building = false, ready = false, t0 = 0, frameId = 0, recording = false;
  async function build(now) {
    const n = ++job;
    ready = false;
    building = true;
    pending = now;
    document.body.classList.add("busy");
    try {
      let frame = ed.frame();
      const k = Math.min(1, VIDEO_MAX / Math.max(frame.width, frame.height));
      // чётные стороны — для видеокодека
      const w = Math.max(2, Math.round((frame.width * k) / 2) * 2), h = Math.max(2, Math.round((frame.height * k) / 2) * 2);
      const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
      const cx = c.getContext("2d");
      cx.imageSmoothingQuality = "high";
      cx.drawImage(frame, 0, 0, w, h);
      frame = null;
      const { T, run } = await depthModel(ed.say);
      if (n !== job) return;
      ed.say("3D: нейросеть считает глубину…");
      const { depth: dm } = await run(T.RawImage.fromCanvas(c));
      if (n !== job) return;
      // глубина чуть размыта — без ступенек на краях
      const d = Object.assign(document.createElement("canvas"), { width: dm.width, height: dm.height }), dx = d.getContext("2d"), img = dx.createImageData(dm.width, dm.height);
      for (let i = 0; i < dm.width * dm.height; i++) { const v = dm.data[i * dm.channels]; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
      dx.putImageData(img, 0, 0);
      const ds = Object.assign(document.createElement("canvas"), { width: w, height: h }), dsx = ds.getContext("2d");
      dsx.filter = `blur(${Math.max(1, Math.round(Math.max(w, h) / 400))}px)`;
      dsx.drawImage(d, 0, 0, w, h);
      if (!gl) setup();
      Object.assign(view, { width: w, height: h });
      gl.viewport(0, 0, w, h);
      for (const [unit, t, src] of [[0, texImg, c], [1, texDep, ds]]) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      }
      ready = true;
      built = now;
      ed.say("");
      t0 = performance.now();
    } catch (err) { if (n === job) ed.say(`3D не получилось: ${err.message}`); }
    if (n !== job) return;
    building = false;
    pending = "";
    document.body.classList.remove("busy");
    ed.sync();
  }
  // кадр движения: t — доля круга
  function draw(t) {
    const a = 2 * Math.PI * t, A = 0.025;
    const off = motion === "orbit" ? [A * Math.cos(a), A * 0.6 * Math.sin(a)] : motion === "sway" ? [A * Math.sin(a), 0] : [0, 0];
    gl.uniform2f(gl.getUniformLocation(prog, "off"), off[0], off[1]);
    gl.uniform1f(gl.getUniformLocation(prog, "zoom"), motion === "zoom" ? 0.12 * (0.5 - 0.5 * Math.cos(a)) : 0);
    gl.uniform1f(gl.getUniformLocation(prog, "S"), 1 + 2 * A);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function loop() {
    cancelAnimationFrame(frameId);
    if (!ready || view.hidden) return;
    draw(((performance.now() - t0) % PERIOD) / PERIOD);
    frameId = requestAnimationFrame(loop);
  }

  async function record() {
    const p = ed.state.p;
    if (!ready || recording || !p) return;
    const type = ["video/mp4;codecs=avc1.640033", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) { ed.say("Браузер не умеет записывать видео"); return; }
    recording = true;
    ed.sync();
    try {
      const where = await ed.locate(p, true); // разрешение на запись — по нажатию, до записи
      const chunks = [], rc = new MediaRecorder(view.captureStream(30), { mimeType: type, videoBitsPerSecond: 16e6 });
      rc.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise((r) => (rc.onstop = r));
      t0 = performance.now();
      rc.start(500);
      const tick = setInterval(() => ed.say(`3D: записываю ролик — ${Math.min(2 * PERIOD, Math.round(performance.now() - t0)) / 1000 | 0} из ${(2 * PERIOD) / 1000} с`), 250);
      await new Promise((r) => setTimeout(r, 2 * PERIOD));
      rc.stop();
      await stopped;
      clearInterval(tick);
      const ext = type.startsWith("video/mp4") ? "mp4" : "webm", stem = where.name.replace(/\.[^.]+$/, "");
      let name = `${stem} 3D.${ext}`;
      for (let i = 2; await where.dir.getFileHandle(name).then(() => true, () => false); i++) name = `${stem} 3D (${i}).${ext}`;
      await ed.write(await where.dir.getFileHandle(name, { create: true }), new Blob(chunks, { type: type.split(";")[0] }));
      try { window.opener?.atlasGalleryRescan?.(); } catch { /* окно карты закрыто */ }
      ed.say(`Ролик сохранён рядом: ${name}`);
    } catch (err) { ed.say(`Ролик не записался: ${err.message}`); }
    recording = false;
    ed.sync();
  }

  return {
    el,
    sync: (s) => {
      const open = s.panel === "depth" && !!s.p;
      const now = open ? [s.p.id, s.pv?.width, s.pv?.height, s.q, s.flip, s.angle, JSON.stringify(s.values), JSON.stringify(s.crop), JSON.stringify(s.quad), s.cropOn, !!s.shown].join() : "";
      if (!s.p) { ready = false; built = ""; } // правка закрыта — глубина устарела
      if (!open) {
        cancelAnimationFrame(frameId);
        if (building) { job++; building = false; pending = ""; document.body.classList.remove("busy"); }
      } else if (now !== built && now !== pending && !recording) build(now);
      const live = open && ready && now === built;
      toggle.classList.toggle("on", open);
      row.hidden = !open;
      view.hidden = !live;
      rec.disabled = !live || recording;
      // поверх снимка, над полосой правки
      if (open) view.style.height = `calc(100% - ${document.querySelector(".edit-dock").offsetHeight + 24}px)`;
      if (live) loop();
    },
  };
}

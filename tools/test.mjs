// Проверка Atlas: node tools/test.mjs [--phone | --car] [--only=photo]
// Поднимает свой сервер на свободном порту, открывает приложение в Chrome без окна (headless),
// включает и выключает каждый модуль из реестра, открывает панели, снимает экраны в test-output/
// и собирает ошибки. Код выхода 1 — если были ошибки. Только встроенное в Node, без пакетов.
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "test-output");
const PHONE = process.argv.includes("--phone");
// --car — магнитола (ISUDAR, Android, 1280×720 лёжа, сенсорный экран; Грегори 2026-11-15): раскладка как на
// компьютере по ширине, но устройство — Android (WebView), касания вместо мыши; сам крупный вид (core/ui-scale.js):
// страница 1024×576 в точках CSS — в них и касания
const CAR = process.argv.includes("--car");
const VH = PHONE ? 800 : CAR ? 576 : 800; // высота экрана: «я» в навигации — на четверть высоты ниже центра
// --only=photo — проверить только разделы модулей, в id которых есть это слово (быстро при отладке; несколько — через запятую)
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
// несколько через запятую: --only=layers/beaches,weather/wind
const want = (id) => !ONLY || ONLY.split(",").some((o) => id.includes(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error("Chrome не найден — укажите путь в переменной CHROME"); process.exit(2); }

// статический сервер
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, "index.html") : file;
  if (!target.startsWith(ROOT) || !fs.existsSync(target)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(target)] || "application/octet-stream" });
  fs.createReadStream(target).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-test-"));
const chrome = spawn(CHROME, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error("Chrome не ответил")), 20000);
});
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let nextId = 0;
const pending = new Map();
const errors = [];
let netFails = 0;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (pending.has(d.id)) { pending.get(d.id)(d.result ?? { exceptionDetails: { text: `ошибка браузера: ${d.error?.message}` } }); pending.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errors.push("исключение: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split("\n")[0]);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
    // у объекта ошибки — и место, где она возникла (первые строки стека), иначе в отчёте одно «Error»
    const text = (d.params.args.map((a) => a.value ?? a.description).join(" ") + " @ " + (d.params.stackTrace?.callFrames || []).slice(0, 3).map((f) => `${f.functionName}:${f.url.split("/").pop()}:${f.lineNumber}`).join(" < ")).split("\n").slice(0, 4).map((l) => l.trim()).join(" ← ");
    // сбои чужих серверов (плитка не пришла или пришла пустой) — не ошибка программы, только счёт
    // и горизонтали (maplibre-contour), когда сервер высот не ответил вовремя
    if (/Failed to fetch|AJAXError|could not be decoded/.test(text) || /timed out/.test(text) && /maplibre-contour/.test(text)) netFails++;
    else errors.push("console.error: " + text.slice(0, 400) + " [после: " + (lastCheck || "") + "]");
  }
};
const send = (method, params = {}) => new Promise((r) => { const id = ++nextId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
// шаг, который не ответил за 2 минуты, — ошибка с началом его текста (раньше проверка висела молча)
const run = async (expr) => {
  const r = await Promise.race([send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }),
    sleep(120000).then(() => { throw new Error("шаг завис: " + expr.replace(/\s+/g, " ").slice(0, 160)); })]);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
const idle = () => run(`new Promise((r) => { const t = Date.now(); const c = () => atlas.map.loaded() && atlas.map.areTilesLoaded() || Date.now() - t > 15000 ? r(true) : setTimeout(c, 300); c(); })`);

// EXIF при сохранении правки (tools/jpeg.js): блок исходника переносится целиком, поворот — 1,
// размер кадра — новый; место съёмки (GPS) остаётся
{
  const { keepExif, exifFacts } = await import("./jpeg.js");
  const tiff = new Uint8Array(84), v = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0], 0); v.setUint32(4, 8, true);
  v.setUint16(8, 3, true); // IFD0: Orientation = 6, ExifIFD → 50, GPS → 0
  [[0x0112, 3, 1, 6], [0x8769, 4, 1, 50], [0x8825, 4, 1, 0]].forEach(([tag, type, n, val], i) => { const e = 10 + i * 12; v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, n, true); v.setUint32(e + 8, val, true); });
  v.setUint16(50, 2, true);
  [[0xa002, 4, 1, 4000], [0xa003, 4, 1, 3000]].forEach(([tag, type, n, val], i) => { const e = 52 + i * 12; v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, n, true); v.setUint32(e + 8, val, true); });
  const app1 = new Uint8Array(4 + 6 + tiff.length);
  app1.set([0xff, 0xe1, ((app1.length - 2) >> 8) & 255, (app1.length - 2) & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  app1.set(tiff, 10);
  const original = new Blob([new Uint8Array([0xff, 0xd8]), app1, new Uint8Array([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
  const fresh = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xda, 0, 2, 0xff, 0xd9])]);
  const out = await keepExif(fresh, original, 1234, 567);
  var exifCheck = { before: await exifFacts(original), after: await exifFacts(out) };
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", PHONE ? { width: 390, height: 800, deviceScaleFactor: 2, mobile: true }
  : CAR ? { width: 1280, height: 720, deviceScaleFactor: 1, mobile: true } : { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
if (CAR) {
  await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 10; ISUDAR) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/113.0.0.0 Safari/537.36 wv" });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
}
await send("Page.navigate", { url });
const report = [];
let lastCheck = "";
const check = (name, ok, extra = "") => { lastCheck = name; process.stderr.write(`${ok ? "+" : "-"} ${name.slice(0, 70)}
`); report.push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) errors.push(name); };

// кнопка барабана разделов (Грегори 2026-11-06: значков в столбике под логотипом больше нет — окна и
// карточку пути сворачивает и разворачивает кнопка раздела в барабане): нажать и дождаться, пока докрутится
// (пока карта летит к пути, кадры редкие — ждём, пока кнопка встанет в центр, до 5 с)
const tap = (key) => run(`(async () => { const c = document.querySelector('.wheel-content .layers-circle[data-key="${key}"]'); c.click();
  for (let i = 0; i < 50 && c.closest(".wheel-cell").style.zIndex !== "100"; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 500)); return true; })()`);
const settingsToggle = `(async () => { const p = document.querySelector('[data-panel="settings"]');
  if (p.hidden) (await import("./core/events.js")).emit("settings-open"); else p.querySelector(".panel-btn[title=Закрыть]").click(); return true; })()`;

try {
  await run(`new Promise((r) => { const c = () => window.atlas?.map?.loaded() ? r(true) : setTimeout(c, 200); c(); })`);
  await idle();
  check("карта загрузилась", true, await run(`atlas.map.getProjection()?.type`));
  // фоновый модуль карты — со своего адреса: старый WebView (магнитола, Android-приложение) иначе не грузит
  // его с unpkg («Worker failed to load»); файл-прослойку находит «Скачать район» (Грегори 2026-11-16)
  const mlWorker = await run(`(async () => { const ml = await import("https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs");
    const u = ml.getWorkerUrl(), text = await (await fetch(u)).text();
    return { own: new URL(u).origin === location.origin, lib: text.includes("unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl-worker.mjs") }; })()`);
  check("карта: фоновый модуль MapLibre — со своего адреса (для старого WebView), версия та же", mlWorker.own && mlWorker.lib, JSON.stringify(mlWorker));
  // при открытии — глобус крупно (космоса около 10 % экрана), поворот к Европе (Грегори 2026-11-13)
  await sleep(2800);
  const globe = await run(`(() => { const m = atlas.map, c = m.getCenter(), W = m.getCanvas().clientWidth, H = m.getCanvas().clientHeight; let n = 0, k = 0;
    for (let x = 0.5; x < 60; x++) for (let y = 0.5; y < 40; y++) { k++; const p = [x * W / 60, y * H / 40], q = m.project(m.unproject(p)); if (Math.hypot(q.x - p[0], q.y - p[1]) < 2) n++; }
    return { center: [Math.round(c.lng), Math.round(c.lat)], space: +(1 - n / k).toFixed(3) }; })()`);
  check("старт: глобус крупно — космоса около 10 % экрана, в середине Европа", globe.center.join() === "15,50" && globe.space > 0.05 && globe.space < 0.15, JSON.stringify(globe));
  // при старте всё закрыто, на кнопке справа вверху — логотип; барабан разделов — «Поиском места» в центре
  const start = await run(`({ logo: !!document.querySelector(".search-toggle .start-logo"), search: document.body.classList.contains("search-hidden"),
    wheels: [...document.querySelectorAll(".wheel")].every((w) => w.classList.contains("closed")), panels: [...document.querySelectorAll(".panel")].every((p) => p.hidden) })`);
  // щелчок — поиск и барабан разделов, в центре «Поиск места», на кнопке лупа; второй — всё закрыть, снова логотип
  start.mid = await run(`(async () => { const L = document.querySelector(".search-toggle"); L.click(); await new Promise((r) => setTimeout(r, 500));
    const m = [...document.querySelectorAll(".wheel-content .wheel-cell:not([hidden])")].sort((a, b) => b.style.zIndex - a.style.zIndex)[0]?.querySelector(".layers-circle").ariaLabel
      + (L.querySelector(".start-logo") ? " (логотип при открытом поиске)" : "");
    L.click(); await new Promise((r) => setTimeout(r, 300)); return m + (L.querySelector(".start-logo") ? "" : " (нет логотипа после закрытия)"); })()`);
  check("старт: всё закрыто, на кнопке справа вверху — логотип; первый щелчок — «Поиск места» в центре барабана",
    start.logo && start.search && start.wheels && start.panels && start.mid === "Поиск места", JSON.stringify(start));
  check("правка: EXIF исходника переносится — поворот 1, новый размер кадра, место съёмки остаётся",
    exifCheck.before.orientation === 6 && exifCheck.after.orientation === 1 && exifCheck.after.width === 1234 && exifCheck.after.height === 567 && exifCheck.after.gps, JSON.stringify(exifCheck));
  const extras = await run(`({ stars: document.querySelector("canvas.stars")?.width > 0, scale: document.querySelector(".maplibregl-ctrl-scale")?.textContent,
    geo: !!document.querySelector(".geo-btn"), order: [...document.querySelectorAll(".maplibregl-ctrl-bottom-left .map-btn button")].map((b) => b.className.split(" ").pop()),
    zoom: !!document.querySelector(".maplibregl-ctrl-zoom-in, .maplibregl-ctrl-compass"),
    glass: [...document.querySelectorAll(".map-btn button, .wheel-toggle, .places-toggle, .search-toggle")].every((b) => b.classList.contains("glass")) })`);
  check("звёзды, шкала, навигация", extras.stars && /км|м$/.test(extras.scale || "") && extras.geo, JSON.stringify(extras));
  check("слева внизу: навигация и компас — полупрозрачные, без «+ −»",
    JSON.stringify(extras.order) === '["geo-btn","pos-btn","compass-btn"]' && !extras.zoom && extras.glass, JSON.stringify(extras));
  const tilt = async () => { await run(`document.querySelector(".compass-btn").click(); true`); await sleep(1300);
    return run(`({ pitch: Math.round(atlas.map.getPitch()), bearing: Math.round(atlas.map.getBearing()), label: document.querySelector(".compass-mode").textContent })`); };
  const view0 = await run(`({ center: atlas.map.getCenter().toArray(), zoom: atlas.map.getZoom() })`);
  await run(`atlas.map.jumpTo({ center: [24.75, 59.44], zoom: 12 }); true`);
  await run(`atlas.map.jumpTo({ bearing: 30 }); true`);
  const rot = `atlas.map.dragRotate.isEnabled() && atlas.map.touchZoomRotate._rotationDisabled !== true`;
  const c3 = await tilt(), cN = { ...(await tilt()), rotate: await run(rot) }, c2 = { ...(await tilt()), rotate: await run(rot) };
  check("компас: по кругу 3D → Север (2D, не поворачивается) → 2D (поворачивать можно)",
    c3.pitch >= 55 && c3.label === "3D" && cN.pitch === 0 && cN.bearing === 0 && cN.label === "С" && !cN.rotate
    && c2.pitch === 0 && c2.label === "2D" && c2.rotate, JSON.stringify([c3, cN, c2]));
  // издалека космос не растёт: наклон сам уменьшается, со шкалы 100 км — 2D, компас 3D не предлагает
  const far = await run(`(async () => { const m = atlas.map, at = async (zoom) => { m.jumpTo({ zoom, pitch: 75 }); await new Promise((r) => setTimeout(r, 50)); return Math.round(m.getPitch()); };
    const r = { near: await at(13), mid: await at(7.5), far: await at(5) }; await new Promise((r) => setTimeout(r, 100)); r.label = document.querySelector(".compass-mode").textContent; m.jumpTo({ pitch: 0 }); return r; })()`);
  check("наклон: вблизи 75°, при отдалении меньше, на 100 км — 2D", far.near === 75 && far.mid > 0 && far.mid < 75 && far.far === 0 && far.label === "2D", JSON.stringify(far));
  // навигация (подставные координаты): включаю у Таллина — сразу 3D, я внизу, масштаб прежний (Грегори
  // 2026-11-10); карта по ходу движения (на восток, потом на север), метка — стрелка; сдвинул карту — сама не
  // возвращается, кнопка «Навигация» — ко мне; выровнял рукой — 2D, кнопкой — я в центре;
  // С — я в центре, север вверху; «Куда идти» — точка из окна, расстояние, сторона, путь пешком
  await send("Browser.grantPermissions", { permissions: ["geolocation"], origin: url.replace(/\/$/, "") });
  const goTo = (lat, lon) => send("Emulation.setGeolocationOverride", { latitude: lat, longitude: lon, accuracy: 5 });
  const me = `(() => { const r = document.querySelector(".geo-dot").getBoundingClientRect(); return { x: Math.round((r.left + r.right) / 2 - innerWidth / 2), y: Math.round((r.top + r.bottom) / 2 - innerHeight / 2) }; })()`;
  const nav = (extra = "") => run(`({ ...atlas.geo.state(), bearing: Math.round(atlas.map.getBearing()), pitch: Math.round(atlas.map.getPitch()), zoom: Math.round(atlas.map.getZoom() * 10) / 10,
    me: ${me}, chevron: document.querySelector(".geo-dot").classList.contains("chevron"), title: document.querySelector(".geo-btn").title, pad: atlas.map.getPadding() ${extra} })`);
  await run(`atlas.map.jumpTo({ center: [24.74, 59.43], zoom: 14.3, pitch: 0, bearing: 20 }); true`);
  await goTo(59.437, 24.745);
  await run(`window.confirm = () => true; document.querySelector(".geo-btn").click(); true`);
  await sleep(2500);
  const n2 = await nav();
  check("навигация: при начале — 3D, я внизу, масштаб не тронут, кнопка «Навигация»",
    n2.follow && n2.mode === "3d" && n2.zoom === 14.3 && n2.pitch >= 55 && Math.abs(n2.me.x) <= 3 && Math.abs(n2.me.y - VH / 4) <= 8 && /^Навигация/.test(n2.title), JSON.stringify(n2));
  await goTo(59.437, 24.7455);
  await sleep(2500);
  const navE = await nav();
  await goTo(59.4375, 24.7455);
  await sleep(2500);
  const navN = await nav();
  const near = (a, b) => Math.abs(((a - b + 540) % 360) - 180) <= 5;
  check("навигация: 3D — я внизу, карта по ходу движения, метка — стрелка, масштаб прежний", navE.mode === "3d" && navE.pitch >= 55 && near(navE.heading, 90) && near(navE.bearing, 90)
    && navE.chevron && navE.zoom === 14.3 && Math.abs(navE.me.y - VH / 4) <= 8 && near(navN.heading, 0) && near(navN.bearing, 0) && navN.zoom === 14.3, JSON.stringify([navE, navN]));
  // сдвинул карту рукой — сама не возвращается; кнопка «Навигация» — снова ко мне
  await run(`atlas.map.fire("dragstart", { originalEvent: new MouseEvent("mousedown") }); atlas.map.panBy([200, 0], { duration: 0 }); true`);
  const away = await run(`atlas.geo.state().follow`);
  await goTo(59.4376, 24.7455);
  await sleep(3000);
  const stay = await nav();
  await run(`window.confirm = () => true; document.querySelector(".geo-btn").click(); true`);
  await sleep(1500);
  const backHome = await nav();
  check("навигация: сдвинул карту — сама не возвращается, кнопка «Навигация» — ко мне", away === false && !stay.follow && Math.abs(stay.me.x) > 100 && backHome.follow && Math.abs(backHome.me.x) <= 3, JSON.stringify({ away, stay, backHome }));
  // выровнял карту рукой — 2D, карта за мной не перестаёт ходить, «Позиция» — «свой» (запомнен), я в центре
  await run(`atlas.map.fire("pitchstart", { originalEvent: new MouseEvent("mousedown") }); atlas.map.jumpTo({ pitch: 0 }); true`);
  const flat = await run(`({ ...atlas.geo.state() })`);
  await sleep(1500);
  const flatBack = await nav(`, saved: JSON.parse(localStorage.getItem("atlas.nav.manual") || "null"), label: document.querySelector(".pos-mode").textContent`);
  check("навигация: выровнял рукой — 2D, карта за мной, «Позиция» — «Свой» с этим масштабом и наклоном, я в центре", flat.mode === "2d" && flat.follow && flat.pos === "manual" && flatBack.follow && flatBack.mode === "2d"
    && flatBack.label === "Свой" && flatBack.saved?.zoom === 14.3 && flatBack.saved?.pitch === 0 && flatBack.saved?.mode === "2d"
    && Math.abs(flatBack.me.x) <= 3 && Math.abs(flatBack.me.y) <= 3 && flatBack.chevron, JSON.stringify({ flat, flatBack }));
  // компас по кругу до «С» (из 2D — через 3D; если наклон на этом масштабе недоступен — сразу «С»)
  // (на экране магнитолы переход дольше — ждём 3,5 с)
  for (let k = 0; k < 3 && (await run(`document.querySelector(".compass-mode").textContent`)) !== "С"; k++) {
    await run(`document.querySelector(".compass-btn").click(); true`);
    await sleep(CAR ? 3500 : 2000);
  }
  await sleep(1000);
  const nN = await nav();
  check("навигация: С — я в центре, север вверху, точка вместо стрелки", nN.mode === "north" && nN.bearing === 0 && nN.pitch === 0 && Math.abs(nN.me.x) <= 3 && Math.abs(nN.me.y) <= 3 && !nN.chevron && nN.zoom === 14.3, JSON.stringify(nN));
  // «Позиция» (Грегори 2026-11-21): нажатия по кругу — весь путь (2D, север; пути нет — я в центре) → стрелка
  // (3D, шкала 200 м, я внизу) → свой (как поставили рукой); масштаб рукой — «свой» запомнен; сдвинул — гаснет,
  // щелчок — снова в тот же режим
  const posNav = () => nav(`, label: document.querySelector(".pos-mode").textContent, lit: document.querySelector(".pos-btn").classList.contains("on")`);
  const posClick = async (ms = CAR ? 3500 : 2500) => { await run(`document.querySelector(".pos-btn").click(); true`); await sleep(ms); return posNav(); };
  await run(`atlas.map.jumpTo({ zoom: 12 }); true`);
  const pR = await posClick();
  const pA = await posClick();
  const arrowZoom = Math.log2((100 * 40075016.686 * Math.cos((59.4376 * Math.PI) / 180)) / (512 * 200));
  await run(`atlas.map.fire("zoomstart", { originalEvent: new WheelEvent("wheel") }); atlas.map.jumpTo({ zoom: 15.5 }); true`);
  await sleep(1500);
  const pM = await posNav();
  const pR2 = await posClick();
  const pA2 = await posClick();
  const pM2 = await posClick();
  await run(`atlas.map.fire("dragstart", { originalEvent: new MouseEvent("mousedown") }); atlas.map.panBy([200, 0], { duration: 0 }); true`);
  const pOff = await posNav();
  const pBack = await posClick();
  check("«Позиция»: по кругу — весь путь (2D, север, я в центре) → 3D 200 м → свой (масштаб рукой); сдвинул — гаснет, щелчок — снова свой",
    pR.pos === "route" && pR.label === "Путь" && pR.lit && pR.mode === "north" && pR.pitch === 0 && pR.bearing === 0 && pR.zoom === 12 && Math.abs(pR.me.x) <= 3 && Math.abs(pR.me.y) <= 3
    && pA.pos === "arrow" && pA.label === "3D" && pA.pitch >= 55 && Math.abs(pA.zoom - arrowZoom) < 0.1 && Math.abs(pA.me.y - VH / 4) <= 8
    && pM.pos === "manual" && pM.follow && pM.label === "Свой" && pR2.pos === "route" && pR2.pitch === 0 && pA2.pos === "arrow"
    && pM2.pos === "manual" && pM2.zoom === 15.5 && pM2.pitch >= 55 && !pOff.follow && !pOff.lit && pBack.pos === "manual" && pBack.follow && pBack.lit && Math.abs(pBack.me.x) <= 3,
    JSON.stringify({ pR, pA, arrowZoom, pM, pR2, pA2, pM2, pOff, pBack }));
  // как было для дальнейшего: «весь путь» (С, 2D), масштаб 14.3
  await posClick();
  await run(`atlas.map.jumpTo({ zoom: 14.3 }); true`);
  await sleep(1000);
  // «Куда идти» — в самом окне поиска (Грегори 2026-11-04: «не под строкой поиска, а в окне поиска»): «Сюда»
  // в окне на карте — точка, строка поиска «Куда», в её списке стрелка, расстояние и сторона; путь пешком
  const navPanel = `document.querySelector(".search-card")`, navList = `document.querySelector(".search-results")`;
  const exitModeNav = `(() => { for (let k = 0; k < 3 && (!document.body.classList.contains("search-hidden") || !document.querySelector(".wheel-content").classList.contains("closed")); k++) document.querySelector(".search-toggle").click(); return true; })()`;
  const navStats = `atlas.modules().find((m) => m.id === "content/navigation").stats()`;
  const here = await run(`(async () => { const { track } = await import(new URL("core/popups.js", location.href));
    const p = track(new atlas.ctx.maplibregl.Popup()).setLngLat([24.76, 59.43]).setHTML('<div class="popup-title">Проба</div>').addTo(atlas.map);
    const b = p.getElement().querySelector(".go-here"); const had = !!b; b?.click();
    const shut = !p.isOpen();
    await new Promise((r) => setTimeout(r, 400));
    return { had, open: !shut, openLater: p.isOpen(), ...atlas.route.state(), panel: !${navPanel}.hidden, list: !${navList}.hidden, panels: document.querySelectorAll(".panel-left:not([hidden])").length, card: ${navPanel}.querySelector(".nav-card")?.textContent || "",
      placeholder: document.querySelector(".search-box input").placeholder, search: !document.body.classList.contains("search-hidden"), ...${navStats} }; })()`);
  check("куда идти: «Сюда» — карточка под строкой «Куда»: стрелка, расстояние и сторона; подсказки закрыты, отдельного окна нет", here.had && !here.openLater && here.panel && !here.list && !here.panels && here.target === "Проба"
    && /^\d[\d,]* (м|км) на юго-восток.*Проба/.test(here.card) && here.placeholder === "Добавить точку" && here.search, JSON.stringify(here));
  const flag = await run(`(() => { const f = document.querySelector(".go-flag svg"); const r = f?.getBoundingClientRect(); return r && { w: Math.round(r.width), h: Math.round(r.height), red: !!document.querySelector(".maplibregl-marker svg path[fill='#e53935']") }; })()`);
  check("куда идти: цель — крупный синий флажок финиша", flag && flag.w >= 40 && flag.h >= 48, JSON.stringify(flag));
  await run(`${navPanel}.querySelector(".go-way").click(); true`);
  for (let i = 0; i < 20 && !(await run(`!!atlas.route.state().route`)); i++) await sleep(500);
  await sleep(300);
  const walk = await run(`({ ...atlas.route.state(), way: ${navPanel}.querySelector(".nav-way").textContent })`);
  // путь — ярко-синий и поверх всех слоёв (даже включённых после него)
  const top = await run(`(() => { const ids = atlas.map.getStyle().layers.map((l) => l.id); return { last: ids.slice(-3), color: atlas.map.getPaintProperty("go-route", "line-color") }; })()`);
  check("куда идти: путь пешком — линия, длина и время в окне; синяя, поверх всего", walk.route?.way === "foot" && walk.route.points > 10 && /Пешком: .* · \d+ мин/.test(walk.way)
    && top.last.join() === "go-route-casing,go-route,go-line" && top.color === "#0a5cff", JSON.stringify({ walk, top }));
  await shot("00-route");
  // окно места при навигации (Грегори 2026-11-09): стрелка, «Добавить», «Поделиться», «Отметить»; «⋯» — «Сохранить маршрут»
  const placePopup = (title, ll) => `(async () => { const { track } = await import(new URL("core/popups.js", location.href));
    window.__pp = track(new atlas.ctx.maplibregl.Popup()).setLngLat(${JSON.stringify(ll)}).setHTML('<div class="popup-title">${title}</div>').addTo(atlas.map);
    await new Promise((r) => setTimeout(r, 200)); return true; })()`;
  await run(placePopup("Остановка", [24.77, 59.435]));
  const acts = await run(`({ btns: [...__pp.getElement().querySelectorAll(".go-actions .go-act")].map((b) => b.title), more: !!__pp.getElement().querySelector(".go-more:not([hidden])") })`);
  await run(`__pp.getElement().querySelector(".go-add").click(); true`);
  await sleep(500);
  const added = await run(`({ stops: atlas.route.state().stops, chip: [...document.querySelectorAll(".search-card .go-pt")].map((c) => c.textContent), marker: document.querySelectorAll(".go-stop").length })`);
  await run(placePopup("Остановка", [24.77, 59.435]));
  await run(`__pp.getElement().querySelector(".go-flagit").click(); true`);
  const marked = await run(`({ marks: atlas.route.state().marks, flag: document.querySelectorAll(".go-mark").length, on: __pp.getElement().querySelector(".go-flagit").classList.contains("on") })`);
  await run(`__pp.getElement().querySelector(".go-flagit").click(); true`);
  const unmarked = await run(`({ marks: atlas.route.state().marks, flag: document.querySelectorAll(".go-mark").length })`);
  await run(`__pp.getElement().querySelector(".go-more").click(); true`);
  const menuOpen = await run(`!__pp.getElement().querySelector(".go-menu").hidden`);
  await run(`[...__pp.getElement().querySelectorAll(".go-menu .menu-item")].find((b) => b.textContent === "Сохранить маршрут").click(); true`);
  const saved = await run(`(() => { const e = JSON.parse(localStorage.getItem("atlas.route.history") || "[]")[0]; return e && { title: e.title, stops: e.stops?.length, saved: !!e.saved }; })()`);
  await run(`__pp.remove(); true`);
  // карточка пути открыта — щелчок по карте всё равно открывает окно места (Грегори 2026-11-10: «после выбора
  // финиша невозможно поставить вторую точку»): карточка — не меню, которое первый щелчок только закрывает
  // окна на карте закрываем Esc: крестик в окне точки маршрута её убирает (а щелчок может попасть по флажку)
  const W = PHONE ? 390 : CAR ? 1024 : 1200;
  await run(`(() => { document.querySelectorAll(".search-results").forEach((m) => (m.hidden = true)); return true; })()`);
  const cardShown = await run(`!document.querySelector(".search-card").hidden`);
  // карта ещё может лететь к пути карточки — щелчок по летящей карте её только останавливает
  for (let i = 0; i < 20 && (await run(`atlas.map.isMoving()`)); i++) await sleep(250);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: PHONE ? W / 2 : W - 300, y: CAR ? 480 : 620, button: "left", clickCount: 1 });
  // окно ждёт адрес из сети — ждём окно, а не просто паузу
  for (let i = 0; i < 30 && !(await run(`!!document.querySelector(".maplibregl-popup .go-add")`)); i++) await sleep(300);
  await sleep(300);
  const mapPop = await run(`(() => { const p = [...document.querySelectorAll(".maplibregl-popup")].pop(); const r = { open: !!p, add: !!p?.querySelector(".go-add:not([hidden])") }; document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return r; })()`);
  check("навигация: при открытой карточке пути щелчок по карте открывает окно места с «Добавить»", cardShown && mapPop.open && mapPop.add, JSON.stringify({ cardShown, mapPop }));
  // маршрут с остановкой — сам в списке «Куда» (значок маршрута); его точки — своим списком, как история:
  // шапка «назад», «Поделиться маршрутом», «Сохранить трек»; перетащили — финиш другой, путь пересчитан
  await run(`(() => { const i = document.querySelector(".search-box input"); i.click(); i.focus(); return true; })()`);
  await sleep(600);
  // маршрут в работе — щелчок по строке сразу открывает его точки (Грегори 2026-11-10)
  const viewAtOnce = await run(`!!document.querySelector(".search-results:not([hidden]) .route-view")`);
  const view = await run(`({ btns: [...document.querySelectorAll(".route-view-head button")].map((b) => b.title),
    rows: [...document.querySelectorAll(".route-view .search-history-row .search-item-title")].map((r) => r.textContent), finish: !!document.querySelector(".route-view .search-history-row:last-child .history-icon svg") })`);
  const hd = await run(`(() => { const r = document.querySelector(".route-view .search-drag").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: hd.x, y: hd.y, button: "left", clickCount: 1 });
  for (let k = 1; k <= 6; k++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hd.x, y: hd.y + k * 12, button: "left", buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hd.x, y: hd.y + 72, button: "left", clickCount: 1 });
  await sleep(600);
  const moved = await run(`({ ...atlas.route.state(), rows: [...document.querySelectorAll(".route-view .search-history-row .search-item-title")].map((r) => r.textContent),
    entry: (({ title, stops }) => ({ title, stops: stops.map((x) => x.title) }))(JSON.parse(localStorage.getItem("atlas.route.history"))[0]) })`);
  const files = await run(`(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    return { gpx: atlas.route.gpx(), url: atlas.route.routeUrl() }; })()`);
  check("маршрут: остановка — запись со значком маршрута в «Куда», его точки — своим списком (назад, «Поделиться», GPX); перетащили — финиш другой",
    JSON.stringify(view.btns) === '["Все места","Поделиться маршрутом","Сохранить трек (GPX)","Карточка пути"]' && viewAtOnce && JSON.stringify(view.rows) === '["1Остановка","Проба"]' && view.finish
    && moved.target?.title === "Остановка" && JSON.stringify(moved.stops) === '["Проба"]' && JSON.stringify(moved.rows) === '["1Проба","Остановка"]'
    && moved.entry.title === "Остановка" && JSON.stringify(moved.entry.stops) === '["Проба"]', JSON.stringify({ view, moved: { target: moved.target?.title, stops: moved.stops, rows: moved.rows, entry: moved.entry } }));
  check("маршрут: «Поделиться» — ссылка Google Карт через остановки, «Сохранить трек» — GPX с точками",
    /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=59\.435000,24\.770000&waypoints=/.test(files.url) && (files.gpx.match(/<wpt /g) || []).length === 2
    && /<name>1\. Проба<\/name>/.test(files.gpx) && /<(trk|rte)>/.test(files.gpx), JSON.stringify({ url: files.url, gpx: files.gpx.slice(0, 300) }));
  // открыт список точек: карта за мной не ходит; щелчок по карте — окно места, список остаётся; значок
  // маршрута справа — карточка пути (в ней все точки, у финиша крестик); стрелка вверх — снова список;
  // щелчок по строке поиска — маршрут в работе: список точек остаётся, набор ищет дополнительную точку;
  // найденное — наше окно места на карте («Добавить»); «Все места» — к началу списка «Куда»
  const vHold = await run(`atlas.geo.state().hold`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: PHONE ? 60 : 300, y: VH - 100, button: "left", clickCount: 1 });
  await sleep(2500);
  const vMap = await run(`({ pop: !!document.querySelector(".maplibregl-popup .go-add:not([hidden])"), view: !!document.querySelector(".search-results:not([hidden]) .route-view") })`);
  await run(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); true`);
  await run(`document.querySelector(".route-view-card").click(); true`);
  await sleep(300);
  const vCard = await run(`({ card: !document.querySelector(".search-card").hidden, list: !document.querySelector(".search-results").hidden,
    pts: [...document.querySelectorAll(".search-card .go-pt .go-stop-x")].map((b) => b.title) })`);
  await run(`[...document.querySelectorAll(".search-card .go-close")].find((b) => b.title === "Точки маршрута").click(); true`);
  await sleep(300);
  const vBack = await run(`!!document.querySelector(".search-results:not([hidden]) .route-view")`);
  await run(`document.querySelector(".search-box input").click(); true`);
  await sleep(200);
  const vKeep = await run(`({ view: !!document.querySelector(".search-results:not([hidden]) .route-view"), ph: document.querySelector(".search-box input").placeholder })`);
  const vFound = await run(`(async () => { const i = document.querySelector(".search-box input"); i.value = "Tallinn"; i.dispatchEvent(new Event("input"));
    i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    for (let t = 0; t < 40 && !document.querySelector(".search-results:not([hidden]) > .search-scroll > .search-item:not(.search-everywhere)"); t++) await new Promise((r) => setTimeout(r, 250));
    const r = document.querySelector(".search-results > .search-scroll > .search-item:not(.search-everywhere)");
    if (!r) return { found: false };
    r.click();
    for (let t = 0; t < 20 && !document.querySelector(".maplibregl-popup .go-add"); t++) await new Promise((r) => setTimeout(r, 250));
    return { found: true, pop: !!document.querySelector(".maplibregl-popup .go-add:not([hidden])"), title: document.querySelector(".maplibregl-popup .popup-title")?.textContent,
      list: !document.querySelector(".search-results").hidden, input: i.value, stops: atlas.route.state().stops.length }; })()`);
  await run(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); true`);
  await run(`document.querySelector(".search-box input").click(); true`);
  await sleep(200);
  const vAgain = await run(`!!document.querySelector(".search-results:not([hidden]) .route-view")`);
  await run(`document.querySelector(".route-view-back")?.click(); true`);
  await sleep(200);
  const vHome = await run(`({ list: !document.querySelector(".search-results").hidden, view: !!document.querySelector(".route-view"), icon: !!document.querySelector(".search-results .history-icon") })`);
  check("маршрут: список точек — карта за мной не ходит, щелчок по карте — окно места, список остаётся; значок маршрута — карточка со всеми точками; стрелка вверх — список; строка поиска — точки маршрута и поиск дополнительной точки (окно места с «Добавить»); «Все места» — к началу",
    vHold && vMap.pop && vMap.view && vCard.card && !vCard.list && JSON.stringify(vCard.pts) === '["Убрать остановку","Убрать финиш"]' && vBack
    && vKeep.view && vKeep.ph === "Добавить точку" && vFound.found && vFound.pop && vFound.title && !vFound.list && vFound.input === "" && vFound.stops === 1 && vAgain
    && vHome.list && !vHome.view && vHome.icon,
    JSON.stringify({ vHold, vMap, vCard, vBack, vKeep, vFound, vAgain, vHome }));
  // снова в маршрут — «назад»
  await run(`document.querySelector(".search-results .history-icon").closest(".search-item").click(); true`);
  await sleep(300);
  await run(`document.querySelector(".route-view-back").click(); true`);
  await sleep(200);
  const back = await run(`!document.querySelector(".route-view-head") && !!document.querySelector(".search-results .history-icon")`);
  check("маршрут: «назад» — снова весь список «Куда»", back);
  // назад к одной точке «Проба»
  await run(`atlas.route.setTarget({ lngLat: [24.76, 59.43], title: "Проба", way: "foot" });
    localStorage.setItem("atlas.route.history", JSON.stringify(JSON.parse(localStorage.getItem("atlas.route.history") || "[]").filter((e) => !e.saved))); true`);
  const removed = [];
  // отметка и точки маршрута на карте — щелчок открывает то же окно места; крестик окна удаляет, Esc — оставляет
  const items = await run(`(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const pop = () => { const p = [...document.querySelectorAll(".maplibregl-popup")].pop(); return p && { role: p.querySelector(".popup-role")?.textContent,
      acts: [...p.querySelectorAll(".go-actions:not([hidden]) .go-act")].length, x: p.querySelector(".maplibregl-popup-close-button")?.title }; };
    const close = () => document.querySelector(".maplibregl-popup .maplibregl-popup-close-button").click();
    const r = {};
    atlas.route.toggleMark({ lngLat: [24.765, 59.432], title: "Флажок" }); await wait(100);
    document.querySelector(".go-mark").click(); await wait(200);
    r.mark = pop();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(100);
    r.esc = { open: !!document.querySelector(".maplibregl-popup"), marks: atlas.route.state().marks.length };
    document.querySelector(".go-mark").click(); await wait(200); close(); await wait(100);
    r.unmarked = { marks: atlas.route.state().marks.length, flags: document.querySelectorAll(".go-mark").length };
    atlas.route.addStop({ lngLat: [24.755, 59.433], title: "Заход" }); await wait(200);
    document.querySelector(".go-stop").click(); await wait(200);
    r.stop = pop(); close(); await wait(200);
    r.stops = atlas.route.state().stops.length;
    atlas.route.addStop({ lngLat: [24.755, 59.433], title: "Заход" }); await wait(200);
    document.querySelector(".go-flag").click(); await wait(200);
    r.finish = pop(); close(); await wait(200);
    r.after = { target: atlas.route.state().target?.title, stops: atlas.route.state().stops.length };
    return r; })()`);
  check("отметка и точки маршрута: щелчок — окно места с кнопками, крестик — удалить (остановку, финиш — финишем становится остановка), Esc — оставить",
    items.mark?.role === "Отметка" && items.mark.acts === 6 && items.mark.x === "Снять отметку" && !items.esc.open && items.esc.marks === 1 && !items.unmarked.marks && !items.unmarked.flags
    && items.stop?.role === "Остановка 1" && items.stop.x === "Убрать остановку" && items.stops === 0 && items.finish?.role === "Финиш" && items.after.target === "Заход" && !items.after.stops, JSON.stringify(items));
  await run(`atlas.route.setTarget({ lngLat: [24.76, 59.43], title: "Проба", way: "foot" });
    localStorage.setItem("atlas.route.history", JSON.stringify(JSON.parse(localStorage.getItem("atlas.route.history") || "[]").filter((e) => !e.saved))); true`);
  check("окно места: стрелка, «Старт», «Добавить», «Финиш», «Поделиться», «Отметить» и «⋯»; остановка в пути и на карте, отметка флажком, «Сохранить маршрут» — в список «Куда»",
    JSON.stringify(acts.btns) === '["Сюда","Старт","Добавить в путь","Финиш","Поделиться","Отметить"]' && acts.more && JSON.stringify(added.stops) === '["Остановка"]' && JSON.stringify(added.chip) === '["1Остановка","Проба"]' && added.marker === 1
    && marked.marks.includes("Остановка") && marked.flag === 1 && marked.on && !unmarked.marks.length && !unmarked.flag && menuOpen
    && saved?.saved && saved.title === "Проба" && saved.stops === 1 && !removed.length, JSON.stringify({ acts, added, marked, unmarked, menuOpen, saved, removed }));
  // история: долгое нажатие — переименовать в строке (щелчок после него запись не открывает); у сохранённого маршрута — значок
  const ren = await run(`(async () => { const hm = await import(new URL("core/history.js", location.href));
    hm.saveList("zz.hist", [{ id: 1, t: "Старое", r: 1 }]);
    let box; const make = () => { box?.remove(); box = hm.historyList({ key: "zz.hist", id: (e) => e.id, label: (e) => ({ title: e.t, icon: e.r ? "<svg></svg>" : "" }), rename: (e, t) => ({ ...e, t }), pick() { picked++; }, changed: make }); document.body.append(box); };
    let picked = 0; make();
    const icon = !!box.querySelector(".history-icon"), pencil = !!box.querySelector(".search-rename");
    const it = box.querySelector(".search-item");
    it.click();
    it.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 50, clientY: 20 }));
    await new Promise((r) => setTimeout(r, 650));
    it.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); it.click();
    const i = box.querySelector(".history-rename"); i.value = "Новое"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const r = { icon, pencil, picked, title: hm.loadList("zz.hist")[0].t, shown: box.querySelector(".search-item-title")?.textContent };
    box.remove(); hm.saveList("zz.hist", []); return r; })()`);
  check("история: долгое нажатие переименовывает запись прямо в строке, карандаша нет, у сохранённого маршрута — значок",
    ren.icon && !ren.pencil && ren.picked === 1 && ren.title === "Новое" && ren.shown === "Новое", JSON.stringify(ren));
  // кнопка «Навигация» в барабане поиска светится, пока навигация включена; выключили — путь убран, точка осталась
  const wheelNav = `document.querySelector('.wheel-content .layers-circle[data-key="content/navigation"]')`;
  const lit = await run(`({ on: ${wheelNav}?.classList.contains("on"), nav: ${navStats}.navOn })`);
  await run(`window.confirm = () => true; document.querySelector(".geo-btn").click(); true`);
  await sleep(500);
  const off = await run(`({ ...atlas.route.state(), on: ${wheelNav}?.classList.contains("on"), nav: ${navStats}.navOn })`);
  check("навигация: кнопка в барабане светится, пока навигация включена; выключили — путь и точка сняты",
    lit.on && lit.nav && !off.on && !off.nav && !off.route && !off.target, JSON.stringify({ lit, off }));
  // кнопки в окне места — только при навигации (Грегори 2026-11-14): без неё — одна «Навигация» под крестиком,
  // она открывает раздел; открыт раздел «Навигация» (и без GPS) — все, «Сюда» видна и неактивна
  const popRow = `(async () => { const { track } = await import(new URL("core/popups.js", location.href));
    const p = track(new atlas.ctx.maplibregl.Popup({ maxWidth: "280px" })).setLngLat([24.76, 59.43]).setHTML('<div class="popup-title">Проба</div>').addTo(atlas.map);
    const q = (c) => p.getElement().querySelector(c), seen = (c) => !!q(c) && q(c).offsetParent !== null;
    const r = { shown: [...p.getElement().querySelectorAll(".go-act, .go-more")].filter((b) => b.offsetParent).map((b) => b.title).join(),
      navon: seen(".go-navon"), navLit: !!q(".go-navon")?.classList.contains("on"), disabled: q(".go-here")?.disabled, start: seen(".go-begin") && !q(".go-begin").disabled, finish: seen(".go-end") && !q(".go-end").disabled, add: seen(".go-add") && !q(".go-add").disabled };
    const row = q(".go-actions").getBoundingClientRect(), box = p.getElement().getBoundingClientRect();
    r.fits = row.right <= box.right + 1 && [...p.getElement().querySelectorAll(".go-act")].filter((b) => b.offsetParent).every((b) => Math.abs(b.getBoundingClientRect().top - row.top) < 2);
    // «Навигация» — всегда на одном месте у крестика; «⋯» — правее всех в ряду (Грегори 2026-11-15)
    const nav = q(".go-navon").getBoundingClientRect(); r.navAt = [Math.round(box.right - nav.right), Math.round(nav.top - box.top)];
    r.moreRight = !seen(".go-more") || [...p.getElement().querySelectorAll(".go-act")].filter((b) => b.offsetParent).every((b) => b.getBoundingClientRect().right <= q(".go-more").getBoundingClientRect().left + 1);
    p.remove(); return r; })()`;
  const noNav = await run(popRow);
  // «Навигация» в окне — как кнопка в барабане: раздел открылся, окно осталось
  const navInPop = await run(`(async () => { const { track } = await import(new URL("core/popups.js", location.href));
    const p = track(new atlas.ctx.maplibregl.Popup({ maxWidth: "280px" })).setLngLat([24.76, 59.43]).setHTML('<div class="popup-title">Проба</div>').addTo(atlas.map);
    p.getElement().querySelector(".go-navon").click(); await new Promise((r) => setTimeout(r, 300));
    const r = { open: p.isOpen(), lit: ${wheelNav}?.classList.contains("on"), row: [...p.getElement().querySelectorAll(".go-act")].filter((b) => b.offsetParent).length };
    p.remove(); return r; })()`);
  await run(`import(new URL("core/search.js", location.href)).then((m) => { m.setSearchMode(null); return true; })`);
  await sleep(200);
  await run(`${wheelNav}.click(); true`);
  await sleep(300);
  const noHere = await run(popRow);
  // включённая «Навигация» в окне — затенена, второй клик выключает навигацию (Грегори 2026-11-15), окно остаётся
  const navOffInPop = await run(`(async () => { const { track } = await import(new URL("core/popups.js", location.href));
    const p = track(new atlas.ctx.maplibregl.Popup({ maxWidth: "280px" })).setLngLat([24.76, 59.43]).setHTML('<div class="popup-title">Проба</div>').addTo(atlas.map);
    p.getElement().querySelector(".go-navon").click(); await new Promise((r) => setTimeout(r, 300));
    const r = { open: p.isOpen(), lit: !!${wheelNav}?.classList.contains("on"), btnLit: p.getElement().querySelector(".go-navon").classList.contains("on"),
      row: [...p.getElement().querySelectorAll(".go-act")].filter((b) => b.offsetParent).length };
    p.remove(); return r; })()`);
  await run(`import(new URL("core/search.js", location.href)).then((m) => { m.setSearchMode(null); return true; })`);
  await sleep(200);
  const noNav2 = await run(popRow);
  check("окно места без навигации — только кнопка «Навигация» (открывает раздел, окно остаётся); раздел открыт — «Навигация» на том же месте, затенена и выключает его; (без GPS) «Сюда» видна и неактивна, «Старт», «Добавить», «Финиш», «Поделиться», «Отметить», «⋯»; ряд в одну строку",
    noNav.shown === "" && noNav.navon && !noNav.navLit && noHere.navon && noHere.navLit && navOffInPop.open && !navOffInPop.lit && !navOffInPop.btnLit && navOffInPop.row === 0 && navInPop.open && navInPop.lit && navInPop.row === 6 && noNav2.shown === noNav.shown && noNav2.navon && /^Сюда,Старт,Добавить в путь,Финиш,Поделиться,Отметить,Ещё$/.test(noHere.shown)
    && noHere.disabled && noHere.start && noHere.finish && noHere.add && noHere.fits && noNav.fits && noHere.moreRight && noHere.navAt.join() === noNav.navAt.join(), JSON.stringify({ noNav, navInPop, noHere, navOffInPop, noNav2 }));
  // планирование дома: первая точка — метка; «Финиш» — маршрут (запись в «Куда» со стартом); «+» — перед
  // финишем; новый «Старт» — прежний становится второй точкой (Грегори 2026-11-14); способ — путь по точкам маршрута, без меня; программа сама не прокладывает
  const plan = await run(`(async () => { const { track } = await import(new URL("core/popups.js", location.href));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const press = async (title, ll, cls) => { const p = track(new atlas.ctx.maplibregl.Popup()).setLngLat(ll).setHTML('<div class="popup-title">' + title + '</div>').addTo(atlas.map);
      await wait(100); p.getElement().querySelector(cls).click(); await wait(200); };
    const hist = () => JSON.parse(localStorage.getItem("atlas.route.history") || "[]").filter((e) => e.saved);
    const r = {};
    await press("Альфа", [24.70, 59.40], ".go-begin");
    r.one = { start: atlas.route.state().start, recs: hist().length, marker: !!document.querySelector(".go-start"), mode: atlas.modules().find((m) => m.id === "content/navigation").stats().open };
    await press("Бета", [24.80, 59.42], ".go-end");
    await press("Гамма", [24.75, 59.41], ".go-add");
    await press("Дельта", [24.71, 59.405], ".go-begin");
    const st = atlas.route.state(), rec = hist()[0];
    r.built = { start: st.start, stops: st.stops, finish: st.target?.title, route: !!st.route, rec: rec && { start: rec.start?.title, stops: rec.stops.map((x) => x.title), title: rec.title },
      card: [...document.querySelectorAll(".search-card .go-pt .go-stop-x")].map((b) => b.title) };
    document.querySelector(".search-card .go-way").click();
    for (let t = 0; t < 40 && !atlas.route.state().route; t++) await wait(250);
    r.path = atlas.route.state().route;
    return r; })()`);
  check("маршрут без навигации: Старт — метка; Финиш — запись в «Куда» со стартом; «+» — перед финишем; новый Старт — прежний второй точкой; способ — путь по точкам, без меня",
    plan.one.start === "Альфа" && !plan.one.recs && plan.one.marker && plan.one.mode
    && plan.built.start === "Дельта" && JSON.stringify(plan.built.stops) === '["Альфа","Гамма"]' && plan.built.finish === "Бета" && !plan.built.route
    && plan.built.rec?.start === "Дельта" && JSON.stringify(plan.built.rec.stops) === '["Альфа","Гамма"]' && plan.built.rec.title === "Бета"
    && JSON.stringify(plan.built.card) === '["Убрать старт","Убрать остановку","Убрать остановку","Убрать финиш"]'
    && plan.path?.way === "foot" && plan.path.fromMe === false, JSON.stringify(plan));
  // второй «Финиш» — прежний финиш становится предпоследней точкой; в обеих формах маршрута — название и адрес
  // строкой ниже; место из поиска — карта долетает до него, хотя карточка пути сначала показала весь маршрут
  // (Грегори 2026-11-13)
  const plan2 = await run(`(async () => { const { track } = await import(new URL("core/popups.js", location.href));
    const { showPlace } = await import(new URL("core/place-info.js", location.href));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const press = async (title, ll, cls) => { const p = track(new atlas.ctx.maplibregl.Popup()).setLngLat(ll).setHTML('<div class="popup-title">' + title + '</div><div class="popup-sub">' + title + ' 1, Таллин</div>').addTo(atlas.map);
      await wait(100); p.getElement().querySelector(cls).click(); await wait(200); };
    const r = {};
    await press("Эпсилон", [24.73, 59.41], ".go-end");
    r.finish = { stops: atlas.route.state().stops, finish: atlas.route.state().target?.title };
    r.card = [...document.querySelectorAll(".search-card .go-pt")].map((x) => [...x.querySelectorAll(".go-pt-title, .go-pt-sub")].map((y) => y.textContent).join("|"));
    const rec = JSON.parse(localStorage.getItem("atlas.route.history")).find((e) => e.saved);
    r.recAddr = rec.address;
    // крестик и «свернуть» карточки — мелкие, вровень с лупой
    r.icons = [".search-card .go-close svg", ".search-card .go-stop-x svg"].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().width));
    // карточка с ползунком; место из поиска при раскрытой карточке
    r.grip = !!document.querySelector(".search-card > .search-grip");
    atlas.map.jumpTo({ center: [10, 47], zoom: 5 });
    await wait(300);
    (await import(new URL("core/events.js", location.href))).emit("route-show");
    showPlace({ lngLat: [24.79, 59.44], title: "Кадриорг", address: "Таллин" });
    for (let t = 0; t < 40 && !document.querySelector(".maplibregl-popup .go-add"); t++) await wait(200);
    await wait(600);
    const c = atlas.map.getCenter();
    r.flight = { at: Math.abs(c.lng - 24.79) < 0.05 && Math.abs(c.lat - 59.44) < 0.05, zoom: Math.round(atlas.map.getZoom()), pop: !!document.querySelector(".maplibregl-popup .go-add") };
    document.querySelector(".maplibregl-popup .go-add")?.click(); await wait(300);
    r.added = atlas.route.state().stops;
    return r; })()`);
  check("второй «Финиш» — прежний становится предпоследней точкой; в карточке — название и адрес строкой ниже; адреса в записи",
    plan2.finish.finish === "Эпсилон" && JSON.stringify(plan2.finish.stops) === '["Альфа","Гамма","Бета"]'
    && plan2.card.join() === "Дельта,Альфа,Гамма,Бета,Эпсилон|Эпсилон 1, Таллин"
    && plan2.recAddr === "Эпсилон 1, Таллин", JSON.stringify(plan2));
  check("место из поиска при раскрытой карточке пути — карта долетает до него, окно места, «+» — перед финишем",
    plan2.flight.at && plan2.flight.zoom >= 12 && plan2.flight.pop && JSON.stringify(plan2.added) === '["Альфа","Гамма","Бета","Кадриорг"]', JSON.stringify(plan2));
  check("крестик и «свернуть» карточки пути — вровень с лупой (22 px); у карточки ползунок", plan2.icons.join() === "22,22" && plan2.grip, JSON.stringify(plan2));
  // ползунок карточки: вверх — до самой шапки, вниз — снова во всю высоту
  const dragGrip = async (dy) => {
    const g = await run(`(() => { const r = document.querySelector(".search-card > .search-grip").getBoundingClientRect(); return [r.x + r.width / 2, r.y + 8]; })()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: g[0], y: g[1], button: "left", clickCount: 1 });
    for (let k = 1; k <= 8; k++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: g[0], y: g[1] + (dy * k) / 8, button: "left", buttons: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: g[0], y: g[1] + dy, button: "left", clickCount: 1 });
    await sleep(200);
    return run(`(() => { const c = document.querySelector(".search-card .nav-card"), t = c.querySelector(".nav-card-top"); return { card: Math.round(c.getBoundingClientRect().bottom), head: Math.round(t.getBoundingClientRect().bottom), full: c.scrollHeight }; })()`);
  };
  const gUp = await dragGrip(-500), gDown = await dragGrip(600);
  check("карточка пути: ползунок вверх — до шапки, вниз — во всю высоту", gUp.card - gUp.head <= 10 && gDown.card - gDown.head > 100 && !(await run(`localStorage.getItem("atlas.search.card.h")`)), JSON.stringify({ gUp, gDown }));
  await shot("00-route-plan");
  // список точек маршрута — тоже название и адрес строкой ниже
  await run(`document.querySelector(".search-card .go-close[title='Точки маршрута']").click(); true`);
  await sleep(600);
  const vSubs = await run(`[...document.querySelectorAll(".route-view .search-history-row")].map((x) => x.querySelector(".search-item-title").textContent.replace(/^([0-9]+|START)/, "") + "|" + x.querySelector(".search-item-sub").textContent)`);
  check("список точек маршрута: название и адрес строкой ниже", vSubs.join() === "Дельта|,Альфа|,Гамма|,Бета|,Кадриорг|Таллин,Эпсилон|Эпсилон 1, Таллин", JSON.stringify(vSubs));
  // «Куда» по странам: всегда (и при одной) — страны с флажком и числом; щелчок — записи страны, «назад» — страны
  await run(`document.querySelector(".route-view-back").click(); true`);
  await run(`window.__keepHist = localStorage.getItem("atlas.route.history"); localStorage.setItem("atlas.route.history", JSON.stringify([...JSON.parse(localStorage.getItem("atlas.route.history")),
    { lngLat: [11.39, 47.26], title: "Инсбрук", address: "Тироль" }, { lngLat: [7.75, 46.02], title: "Церматт", address: "Вале" }, { lngLat: [11.4, 47.27], title: "Халль", address: "Тироль" }]));
    (async () => (await import(new URL("core/search.js", location.href))).refreshSearchList(true))(); true`);
  for (let i = 0; i < 30 && (await run(`document.querySelectorAll(".search-results .nav-country").length`)) < 3; i++) await sleep(300);
  const lands = await run(`[...document.querySelectorAll(".search-results .nav-country")].map((b) => b.textContent + (b.querySelector("img.history-flag") ? "⚑" : ""))`);
  await run(`[...document.querySelectorAll(".search-results .nav-country")].find((b) => /Австрия/.test(b.textContent)).click(); true`);
  await sleep(300);
  const land = await run(`({ head: document.querySelector(".search-results .route-view-head")?.textContent, rows: [...document.querySelectorAll(".search-results .search-history-row .search-item-title")].map((x) => x.textContent),
    clear: !!document.querySelector(".search-results .search-history-clear") })`);
  await run(`document.querySelector(".search-results .route-view-back").click(); true`);
  await sleep(300);
  const landBack = await run(`document.querySelectorAll(".search-results .nav-country").length`);
  check("«Куда» по странам: страны с флажком и числом, щелчок — записи страны, «назад» — страны",
    /^Австрия ?\(?2\)?⚑,Швейцария ?\(?1\)?⚑,Эстония ?\(?\d+\)?⚑$/.test(lands.join()) && land.head === "Австрия" && land.rows.join() === "Инсбрук,Халль" && !land.clear && landBack === 3, JSON.stringify({ lands, land, landBack }));
  await run(`localStorage.setItem("atlas.route.history", window.__keepHist); true`);
  // кнопка в барабане открывает раздел (маршрут) и сама навигацию не включает; где я — кнопкой слева внизу
  await run(`atlas.route.setTarget(null);
    localStorage.setItem("atlas.route.history", JSON.stringify(JSON.parse(localStorage.getItem("atlas.route.history") || "[]").filter((e) => !e.saved))); true`);
  await run(`(async () => { (await import(new URL("core/search.js", location.href))).setSearchMode(null); return true; })()`);
  await run(`${exitModeNav}`);
  await sleep(300);
  const dark = await run(`({ on: ${wheelNav}?.classList.contains("on"), open: ${navStats}.open })`);
  await run(`(() => { if (document.body.classList.contains("search-hidden")) document.querySelector(".search-toggle").click(); return true; })()`);
  await sleep(300);
  await run(`${wheelNav}.click(); true`);
  await sleep(800);
  const relit = await run(`({ geo: atlas.geo.state().on, on: ${wheelNav}?.classList.contains("on"), open: ${navStats}.open })`);
  check("навигация: кнопка в барабане открывает раздел и светится, навигацию сама не включает", !dark.on && !dark.open && !relit.geo && relit.on && relit.open, JSON.stringify({ dark, relit }));
  await run(`window.confirm = () => true; document.querySelector(".geo-btn").click(); true`);
  for (let i = 0; i < 20 && !(await run(`!!atlas.route.state().me`)); i++) await sleep(250);
  // поиск места в окне навигации (Enter) — точка; история точек: свернуть, удалить
  await run(`(() => { const i = document.querySelector(".search-box input"); i.value = "Kadriorg"; i.dispatchEvent(new Event("input")); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true; })()`);
  for (let i = 0; i < 20 && !(await run(`${navList}.querySelectorAll(".search-scroll > .search-item:not(.search-everywhere)").length`)); i++) await sleep(500);
  const found = await run(`${navList}.querySelectorAll(".search-scroll > .search-item:not(.search-everywhere)").length`);
  await run(`${navList}.querySelector(".search-scroll > .search-item:not(.search-everywhere)").click(); true`);
  // найденное — наше окно места на карте (Грегори 2026-11-10), в нём «Сюда»
  for (let i = 0; i < 20 && !(await run(`!!document.querySelector(".maplibregl-popup .go-here:not([hidden])")`)); i++) await sleep(250);
  await run(`document.querySelector(".maplibregl-popup .go-here")?.click(); true`);
  await sleep(500);
  // «Сюда» — подсказки закрылись, карточка цели раскрыта; строка — «Добавить точку»
  const picked = await run(`({ target: atlas.route.state().target?.title, history: JSON.parse(localStorage.getItem("atlas.route.history") || "[]").map((e) => e.title),
    list: !${navList}.hidden, card: !${navPanel}.hidden && !!${navPanel}.querySelector(".nav-card"), placeholder: document.querySelector(".search-box input").placeholder })`);
  // щелчок по строке — подсказки (история точек, как у поиска: внизу «Очистить историю» и ползунок), второй — закрыть
  const clickInput = async () => {
    const xy = await run(`(() => { const r = document.querySelector(".search-box input").getBoundingClientRect(); return [r.x + 30, r.y + r.height / 2]; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: xy[0], y: xy[1], button: "left", clickCount: 1 });
    await sleep(200);
  };
  await run(`(() => { const i = document.querySelector(".search-box input"); i.value = ""; i.dispatchEvent(new Event("input")); return true; })()`);
  await run(`(() => { (document.querySelector(".search-results").hidden || document.querySelector(".search-box input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))); return true; })()`);
  await clickInput();
  // «Куда» всегда по странам — сначала страна
  const land1 = await run(`(() => { const b = ${navList}.querySelectorAll(".nav-country"), clear = !!${navList}.querySelector(".search-history-clear");
    b[0]?.click(); document.querySelector(".search-box input").focus(); return b.length + (clear ? "+clear" : ""); })()`);
  await sleep(300);
  const hist = await run(`({ rows: ${navList}.querySelectorAll(".search-history-row").length, open: !${navList}.hidden,
    clear: !!${navList}.querySelector(".search-history-clear"), grip: !!${navList}.querySelector(".search-grip"), card: !${navPanel}.hidden })`);
  // набор — подсказки из уже найденного
  await run(`(() => { const i = document.querySelector(".search-box input"); i.value = "Про"; i.dispatchEvent(new Event("input")); return true; })()`);
  const typed = await run(`[...${navList}.querySelectorAll(".search-history-row .search-item-title")].map((t) => t.textContent)`);
  const every = await run(`${navList}.querySelector(".search-scroll > .search-item:first-child.search-everywhere")?.textContent || ""`);
  check("набор — первой строкой «Искать «…» везде — Enter»", /Искать «Про» везде/.test(every) && /Enter/.test(every), every);
  await run(`(() => { const i = document.querySelector(".search-box input"); i.value = ""; i.dispatchEvent(new Event("input")); return true; })()`);
  await clickInput();
  // открыта страна — щелчок по строке ведёт к началу (к странам), следующий — закрыть
  const toLands = await run(`!${navList}.hidden && !${navList}.querySelector(".route-view-head") && ${navList}.querySelectorAll(".nav-country").length === 1`);
  await clickInput();
  const shut = await run(`${navList}.hidden`);
  await clickInput();
  await run(`(${navList}.querySelector(".nav-country")?.click(), true)`);
  await sleep(300);
  await run(`${navList}.querySelector(".search-history-row:last-child .search-delete").click(); true`);
  const left = await run(`JSON.parse(localStorage.getItem("atlas.route.history") || "[]").length`);
  check("навигация: место из «Куда» — точка, подсказки закрылись; щелчок по строке — страны («Очистить историю» под ними), в стране — история (отдельно от карточки), набор — подходящие, второй щелчок — закрыть",
    found > 0 && /Kadri|Кадри/i.test(picked.target) && picked.history.length === 2 && !picked.list && picked.card && picked.placeholder === "Добавить точку"
    && land1 === "1+clear" && hist.rows === 2 && hist.open && !hist.clear && hist.grip && !hist.card && JSON.stringify(typed) === '["Проба"]' && toLands && shut && left === 1, JSON.stringify({ found, picked, land1, hist, typed, toLands, shut, left }));
  // «Свернуть» карточку — в строке стрелка; щелчок по ней — карточка снова
  await run(`(() => { (document.querySelector(".search-results").hidden || document.querySelector(".search-box input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))); return true; })()`);
  const held = await run(`atlas.geo.state().hold`);
  await run(`[...${navPanel}.querySelectorAll(".go-close")].find((b) => b.title === "Точки маршрута").click(); true`);
  await sleep(500);
  const build = await run(`({ view: !!document.querySelector(".search-results:not([hidden]) .route-view"), hold: atlas.geo.state().hold, saved: !!atlas.route.state().saved })`);
  await tap("content/navigation");
  const cardBack = await run(`!${navPanel}.hidden`);
  await tap("content/navigation");
  await sleep(1000);
  const freed = await nav();
  await run(`localStorage.setItem("atlas.route.history", JSON.stringify(JSON.parse(localStorage.getItem("atlas.route.history") || "[]").filter((e) => !e.saved))); true`);
  check("навигация: карточка пути открыта — карта за мной не ходит; стрелка вверх — точки маршрута (тоже не ходит); свернули — сразу ко мне",
    held === true && build.view && build.hold && build.saved && cardBack && !freed.hold && freed.follow && Math.abs(freed.me.x) <= 3, JSON.stringify({ held, build, cardBack, freed }));
  const navBtn = `document.querySelector('.wheel-content .layers-circle[data-key="content/navigation"]')`;
  const folded = await run(`({ card: !${navPanel}.hidden, btn: ${navBtn}.classList.contains("on"), arrow: !!document.querySelector(".search-toggle .search-card-arrow") })`);
  await tap("content/navigation");
  const unfolded = await run(`({ card: !${navPanel}.hidden })`);
  check("навигация: «Свернуть» — карточка уходит, кнопка навигации в барабане светится, на кнопке справа вверху стрелка; кнопка навигации — снова карточка", !folded.card && folded.btn && folded.arrow && unfolded.card, JSON.stringify({ folded, unfolded }));
  await run(`[...${navPanel}.querySelectorAll(".go-close")].find((b) => b.title === "Убрать точку").click(); true`);
  await sleep(200);
  check("куда идти: крестик убирает точку", !(await run(`atlas.route.state().target`)) && !(await run(`!!${navPanel}.querySelector(".nav-card")`)));
  // кнопка справа вверху: один щелчок закрывает поиск, значок навигации остаётся, пока она включена; снова — открывает,
  // режим тот же (ничего не сброшено)
  await run(exitModeNav);
  await sleep(300);
  const closedLens = await run(`({ hidden: document.body.classList.contains("search-hidden"), mode: document.querySelector(".search-toggle").classList.contains("mode"),
    nav: !!document.querySelector(".search-toggle svg path")?.getAttribute("d").startsWith("M12 2 4.5"), wheel: !document.querySelector(".wheel-content").classList.contains("closed") })`);
  await run(`document.querySelector(".search-toggle").click(); true`);
  await sleep(300);
  const reopened = await run(`({ placeholder: document.querySelector(".search-box input").placeholder, focus: document.activeElement === document.querySelector(".search-box input"), list: !document.querySelector(".search-results").hidden })`);
  // «Назад» телефона — закрывает последнее открытое: подсказки, потом поиск
  await run(`(() => { const i = document.querySelector(".search-box input"); i.click(); return true; })()`);
  await sleep(200);
  const backList0 = await run(`!document.querySelector(".search-results").hidden`);
  await run(`history.back(); true`);
  await sleep(400);
  const afterList = await run(`({ list: !document.querySelector(".search-results").hidden, search: !document.body.classList.contains("search-hidden") })`);
  await run(`history.back(); true`);
  await sleep(400);
  const afterSearch = await run(`document.body.classList.contains("search-hidden")`);
  check("«Назад» на телефоне: сначала подсказки, потом поиск", backList0 && !afterList.list && afterList.search && afterSearch, JSON.stringify({ backList0, afterList, afterSearch }));
  check("кнопка поиска: закрывает и открывает, ничего не сбрасывая (значок навигации, «Куда»); открытый поиск — без курсора и без списка",
    closedLens.hidden && closedLens.mode && closedLens.nav && !closedLens.wheel && reopened.placeholder === "Куда" && !reopened.focus && !reopened.list, JSON.stringify({ closedLens, reopened }));
  // «Поиск места» в барабане — обычный поиск, навигация при этом включена
  const plain = await run(`(async () => { const w = () => new Promise((r) => setTimeout(r, 400));
    for (let k = 0; k < 3 && document.querySelector(".wheel-content").classList.contains("closed"); k++) { document.querySelector(".search-toggle").click(); await w(); }
    document.querySelector('.wheel-content .layers-circle[data-key="search"]').click();
    for (let k = 0; k < 15 && document.querySelector(".search-box input").placeholder !== "Поиск места"; k++) await w();
    const lupa = () => document.querySelector('.wheel-content .layers-circle[data-key="search"]');
    const r = { placeholder: document.querySelector(".search-box input").placeholder, nav: atlas.geo.state().on, lit: lupa().classList.contains("on"), x: !lupa().nextSibling.hidden };
    document.querySelector('.wheel-content .layers-circle[data-key="content/navigation"]').click();
    for (let k = 0; k < 15 && document.querySelector(".search-box input").placeholder !== "Куда"; k++) await w();
    r.mode = document.querySelector(".search-toggle").className;
    r.back = document.querySelector(".search-box input").placeholder; r.litAfter = lupa().classList.contains("on"); return r; })()`);
  check("барабан: «Поиск места» — обычный поиск (навигация работает), кнопка светится, с крестиком; «Навигация» — снова «Куда», лупа гаснет",
    plain.placeholder === "Поиск места" && plain.nav && plain.lit && plain.x && plain.back === "Куда" && !plain.litAfter, JSON.stringify(plain));
  await run(`document.querySelector(".compass-btn").click(); true`); // снова 2D
  await run(`window.confirm = () => true; document.querySelector(".geo-btn").click(); true`); // слежение → выключить
  await send("Emulation.clearGeolocationOverride");
  check("навигация: выключено", !(await run(`atlas.geo.state().on`)));
  await run(`atlas.map.jumpTo({ center: ${JSON.stringify(view0.center)}, zoom: ${view0.zoom}, pitch: 0, bearing: 0 }); true`);
  await shot("00-start");

  const mods = await run(`atlas.modules().map((m) => ({ id: m.id, kind: m.kind, title: m.title }))`);
  check("модули зарегистрированы", mods.length > 0, `${mods.length}`);
  for (const [i, m] of mods.entries()) {
    const on = await run(`atlas.toggle(${JSON.stringify(m.id)}, true)`);
    await idle();
    await shot(`${String(i + 1).padStart(2, "0")}-${m.id.replace(/\W+/g, "-")}`);
    const off = await run(`atlas.toggle(${JSON.stringify(m.id)}, false)`);
    check(`модуль ${m.id} («${m.title}»)`, on === true && off === false);
  }

  // режим «без сети»: модуль, обращающийся в интернет, выключается и не включается; после — снова можно
  const netMod = mods.find((m) => m.kind === "layer");
  if (netMod) {
    const id = JSON.stringify(netMod.id);
    const offline = await run(`(async () => { const m = await import("./core/modules.js"); await atlas.toggle(${id}, true);
      await m.setOffline(true, atlas.ctx); const off = atlas.modules().find((x) => x.id === ${id}).active;
      const refused = await atlas.toggle(${id}, true); await m.setOffline(false, atlas.ctx); const back = await atlas.toggle(${id}, true);
      await atlas.toggle(${id}, false); return { off, refused, back }; })()`);
    check("режим «без сети» выключает модуль и не даёт включить", offline.off === false && offline.refused === false && offline.back === true, JSON.stringify(offline));
  }
  // барабаны справа: слои — кнопка «Слои», места (places/…) — кнопка с булавкой над ней, кнопка барабана — свой
  // столбик; разделы (content/…) — открывает лупа справа вверху, кнопка — сразу панель раздела со списком
  const drumOf = (key) => (key === "places" || key.startsWith("places/") ? "places" : "layers");
  const toggleOf = { places: ".places-toggle", layers: ".wheel-toggle" };
  const openLayers = (key) => key.startsWith("content/") ? `(async () => {
    // лупа открывает поиск с барабаном разделов, а при открытом поиске — закрывает (Грегори 2026-11-04)
    for (let t = 0; t < 3 && document.querySelector(".wheel-content").classList.contains("closed"); t++) {
      document.querySelector(".search-toggle").click();
      await new Promise((r) => setTimeout(r, 400));
    }
    [...document.querySelectorAll(".wheel-content .layers-circle")].find((b) => b.dataset.key === ${JSON.stringify(key)}).click();
    for (let t = 0; t < 30 && !document.querySelector(".panel-left:not([hidden])"); t++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 150));
    return true; })()` : `(async () => {
    const w = document.querySelector(".wheel-${drumOf(key)}");
    // закрыт — открыть; на телефоне под другим барабаном — поднять
    for (let t = 0; t < 2 && (w.classList.contains("closed") || w.classList.contains("behind")); t++) {
      document.querySelector("${toggleOf[drumOf(key)]}").click();
      await new Promise((r) => setTimeout(r, 400));
    }
    const c = [...w.querySelectorAll(".layers-circle")].find((b) => b.dataset.key === ${JSON.stringify(key)});
    if (!c.classList.contains("open")) c.click();
    for (let t = 0; t < 30 && document.querySelector(".sub-${drumOf(key)}").hidden; t++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 150));
    return true; })()`;
  // спрятать барабаны мест и слоёв (верхний — щелчком по его кнопке, потом следующий)
  const closeLayers = `(async () => { for (let k = 0; k < 4; k++) { const w = [".wheel-places", ".wheel-layers"].find((s) => { const x = document.querySelector(s); return !x.classList.contains("closed") && !x.classList.contains("behind"); });
    if (!w) break; document.querySelector(w === ".wheel-places" ? ".places-toggle" : ".wheel-toggle").click(); await new Promise((r) => setTimeout(r, 50)); } return true; })()`;
  // закрыть поиск и раздел — щелчок по значку раздела справа вверху (барабан разделов спрятан — сначала он)
  // выйти из раздела — крестиком его окна (кнопка справа вверху теперь ничего не сбрасывает), потом закрыть поиск
  const exitMode = `(async () => { document.querySelector(".panel-left:not([hidden]) .panel-head .panel-btn[title=Закрыть]")?.click();
    await new Promise((r) => setTimeout(r, 200));
    for (let k = 0; k < 3 && (!document.body.classList.contains("search-hidden") || !document.querySelector(".wheel-content").classList.contains("closed")); k++) document.querySelector(".search-toggle").click(); return true; })()`;
  // открыть строку поиска (при первом запуске её нет) — лупой справа вверху
  const openSearch = `(async () => { for (let k = 0; k < 3 && document.body.classList.contains("search-hidden"); k++) { document.querySelector(".search-toggle").click(); await new Promise((r) => setTimeout(r, 300)); } return true; })()`;
  // кнопка в столбике слоёв или строка списка в панели раздела — по названию
  const itemFor = (title) => `[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].find((c) => c.firstChild.textContent === ${JSON.stringify(title)})`;

  // карты: в колесе справа кнопка «Карты» — в её столбике виды карт с миниатюрами; каждая загружается без ошибок
  await run(openLayers("maps"));
  const basemaps = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].filter((b) => b.querySelector(".thumb")).map((b) => b.title)`);
  check("виды карт в «Картах»", basemaps.length >= 5, `${basemaps.length} карт`);
  for (let i = 0; i < basemaps.length; i++) {
    await run(`${openLayers("maps")}.then(() => { [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].filter((b) => b.querySelector(".thumb"))[${i}].click(); return true; })`);
    await sleep(500);
    await idle();
    if (i === 0) await shot("50-satellite");
    const ok = await run(`atlas.map.isStyleLoaded() && atlas.map.getStyle().layers.length > 0`);
    check(`карта «${basemaps[i]}»`, ok);
  }
  const mapsCircle = await run(`document.querySelector('.layers-circle[data-key="maps"]').ariaLabel`);
  check("на кнопке «Карты» — текущая карта", /Тёмная/.test(mapsCircle), mapsCircle);
  await run(`${openLayers("maps")}.then(() => { [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].filter((b) => b.querySelector(".thumb"))[1].click(); return true; })`);
  await idle();
  await run(closeLayers);

  // язык подписей: English → у подписей name:en; потом обратно русский
  const lang = await run(`(async () => { const b = document.querySelector(".lang-btn"); b.click();
    [...document.querySelectorAll(".lang-menu .menu-item")].find((i) => i.textContent === "English").click();
    await new Promise((r) => setTimeout(r, 300));
    const en = atlas.map.getStyle().layers.some((l) => JSON.stringify(l.layout?.["text-field"] || "").includes("name:en"));
    b.click(); [...document.querySelectorAll(".lang-menu .menu-item")].find((i) => i.textContent === "Русский").click();
    return { en, label: b.textContent }; })()`);
  check("язык подписей переключается", lang.en && lang.label === "Ру", JSON.stringify(lang));
  // ревизия 2026-11-05/06: язык и шестерёнка — в столбике справа под логотипом; ⓘ при запуске свёрнута; пустая строка состояния не видна
  const misc = await run(`({ lang: !!document.querySelector(".dock .lang-btn") && document.querySelectorAll(".dock button").length === 1 && !!document.querySelector('.wheel-content .layers-circle[data-key="settings"]') && !document.querySelector(".maplibregl-ctrl-bottom-left .lang-btn"), inSearch: !!document.querySelector(".search-box .lang-btn"),
    attrib: document.querySelector(".maplibregl-ctrl-attrib")?.classList.contains("maplibregl-compact-show"),
    version: (() => { const b = document.querySelector(".maplibregl-ctrl-attrib-button"); b.click(); const a = document.querySelector(".maplibregl-ctrl-attrib");
      const r = { open: a.classList.contains("maplibregl-compact-show"), w: Math.round(a.getBoundingClientRect().width), line: a.querySelector(".attrib-version")?.textContent || "" }; b.click(); return r; })(),
    status: (() => { const s = document.getElementById("status"); return s.textContent ? "text" : getComputedStyle(s).display; })() })`);
  check("язык подписей и шестерёнка — в столбике под логотипом; ⓘ свёрнута; пустая строка состояния спрятана", misc.lang && !misc.inSearch && !misc.attrib && misc.version.open && misc.version.w >= 260 && /^Atlas \d+\.\d+ · .*, \d\d:\d\d$/.test(misc.version.line) && (misc.status === "none" || misc.status === "text"), JSON.stringify(misc));
  // окно настроек: только «закрыть», без «свернуть»; Esc закрывает его, как «Назад» на телефоне
  await run(settingsToggle);
  await sleep(300);
  const setHead = await run(`[...document.querySelectorAll('[data-panel="settings"] .panel-head .panel-btn')].map((b) => b.title)`);
  await run(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); true`);
  await sleep(400);
  const escShut = await run(`document.querySelector('[data-panel="settings"]').hidden`);
  check("окно настроек — «Свернуть» и «Закрыть», как у всех окон; Esc закрывает его", JSON.stringify(setHead) === '["Свернуть","Закрыть"]' && escShut, JSON.stringify({ setHead, escShut }));

  // поиск: запрос → список → выбор → маркер и запись в историю
  await run(openSearch);
  const search = await run(`(async () => { const i = document.querySelector(".search-box input"); i.value = "Tallinn";
    i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    for (let t = 0; t < 40 && !document.querySelector(".search-results .search-item"); t++) await new Promise((r) => setTimeout(r, 250));
    const n = document.querySelectorAll(".search-results .search-item").length;
    document.querySelector(".search-results .search-item")?.click();
    await new Promise((r) => setTimeout(r, 300));
    return { n, marker: !!document.querySelector(".maplibregl-marker"), history: JSON.parse(localStorage.getItem("atlas.search.history") || "[]").length }; })()`);
  check("поиск мест", search.n > 0 && search.marker && search.history === 1, JSON.stringify(search));
  // найденное остаётся на карте и в другом режиме строки; вернулись к лупе — название снова в строке;
  // крестик — тихо: отметка с карты, без списка истории (Грегори 2026-11-15)
  const keepMark = await run(`(async () => { const s = await import(new URL("core/search.js", location.href)), ev = await import(new URL("core/events.js", location.href));
    const i = document.querySelector(".search-box input"), wait = (t) => new Promise((r) => setTimeout(r, t)), title = i.value;
    s.setSearchMode({ title: "Проба", icon: "", placeholder: "Проба", filter() {} }); await wait(200);
    const inMode = { text: i.value, marker: !!document.querySelector(".maplibregl-marker") };
    ev.emit("search-plain"); await wait(200);
    const back = { text: i.value, clear: !document.querySelector(".search-clear").hidden };
    document.querySelector(".search-clear").click(); await wait(300);
    return { title, inMode, back, gone: !document.querySelector(".maplibregl-marker"), list: !document.querySelector(".search-results").hidden, text: i.value }; })()`);
  check("поиск: отметка остаётся при смене режима, у лупы её название снова в строке; крестик тихо убирает её без истории",
    keepMark.title && !keepMark.inMode.text && keepMark.inMode.marker && keepMark.back.text === keepMark.title && keepMark.back.clear && keepMark.gone && !keepMark.list && !keepMark.text,
    JSON.stringify(keepMark));
  // окно поиска — общепринятое (Грегори 2026-11-05): щелчок по строке — подсказки (история), набор — из уже
  // найденного, второй щелчок — закрыть
  const tapInput = async () => {
    const xy = await run(`(() => { const r = document.querySelector(".search-box input").getBoundingClientRect(); return [r.x + 30, r.y + r.height / 2]; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: xy[0], y: xy[1], button: "left", clickCount: 1 });
    await sleep(200);
  };
  await run(`(() => { const i = document.querySelector(".search-box input"); i.value = ""; i.dispatchEvent(new Event("input")); (document.querySelector(".search-results").hidden || document.querySelector(".search-box input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))); return true; })()`);
  await tapInput();
  const sug = await run(`({ open: !document.querySelector(".search-results").hidden, rows: document.querySelectorAll(".search-results .search-history-row").length })`);
  await run(`(() => { const i = document.querySelector(".search-box input"); i.value = "zzzq"; i.dispatchEvent(new Event("input")); return true; })()`);
  // нет подходящих — только строка «Искать «…» везде»
  const none = await run(`!document.querySelector(".search-results .search-history-row") && !!document.querySelector(".search-results .search-everywhere")`);
  await run(`(() => { const i = document.querySelector(".search-box input"); i.value = "Талл"; i.dispatchEvent(new Event("input")); return true; })()`);
  const typedS = await run(`document.querySelectorAll(".search-results .search-history-row").length`);
  await tapInput();
  const shutS = await run(`document.querySelector(".search-results").hidden`);
  // длинная история: прокручивается только середина списка, ползунок виден внизу, окно поиска на месте
  const longList = await run(`(async () => { const key = "atlas.search.history", keep = localStorage.getItem(key);
    localStorage.setItem(key, JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ display_name: "Место " + i + ", Таллин", lat: "59.4", lon: "24.7", boundingbox: ["59.4", "59.5", "24.7", "24.8"] }))));
    const i = document.querySelector(".search-box input"); i.value = ""; i.dispatchEvent(new Event("input")); if (document.querySelector(".search-results").hidden) i.click(); await new Promise((r) => setTimeout(r, 200));
    const sc = document.querySelector(".search-scroll"), bar0 = document.querySelector(".search").getBoundingClientRect().top;
    sc.scrollTop = 99999; await new Promise((r) => setTimeout(r, 200));
    const g = document.querySelector(".search-grip").getBoundingClientRect(), L = document.querySelector(".search-results").getBoundingClientRect();
    const r = { scrolled: sc.scrollTop > 0, grip: g.bottom <= innerHeight && g.top > 0, inside: L.bottom <= innerHeight, page: document.scrollingElement.scrollTop, bar: document.querySelector(".search").getBoundingClientRect().top === bar0 };
    i.click(); localStorage.setItem(key, keep); return r; })()`);
  check("поиск: длинный список прокручивается внутри, ползунок внизу на виду, окно поиска не уезжает", longList.scrolled && longList.grip && longList.inside && longList.page === 0 && longList.bar, JSON.stringify(longList));
  check("поиск: щелчок по строке — история, набор — подходящие из найденного, второй щелчок — закрыть", sug.open && sug.rows === 1 && none && typedS === 1 && shutS, JSON.stringify({ sug, none, typedS, shutS }));
  await sleep(2800);
  await idle();
  await shot("60-search");

  // окно места: щелчок по пустой точке — координаты; щелчок по подписи города — название и вид;
  // щелчок при открытом окне — только закрывает
  // на магнитоле — касание пальцем
  const clickAt = async (x, y) => {
    // (synthesizeTapGesture в Chrome без экрана не даёт click — только касания; настоящий палец даёт, как и эти события)
    if (CAR) for (const [type, touchPoints] of [["touchStart", [{ x, y }]], ["touchEnd", []]]) { await send("Input.dispatchTouchEvent", { type, touchPoints }); await sleep(60); }
    else for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  };
  await run(`document.querySelector(".search-clear").click(); document.activeElement.blur(); document.body.click(); atlas.map.jumpTo({ center: [24.75, 59.437], zoom: 11 }); true`);
  await idle();
  // на магнитоле (1280×720) в точке 40, 400 — подпись посёлка Табасалу; пустое место — море над Таллином
  await clickAt(...(CAR ? [640, 100] : [40, 400]));
  await sleep(2500);
  const empty = await run(`document.querySelector(".maplibregl-popup .popup-coords")?.textContent || ""`);
  check("щелчок по карте — координаты", /^\d+\.\d+, \d+\.\d+$/.test(empty), empty || await run(`(() => { const e = document.elementFromPoint(${CAR ? 640 : 40}, ${CAR ? 100 : 400}); return e.className + " / " + e.parentElement?.className + " / " + [...document.querySelectorAll(".maplibregl-popup")].map((p) => p.textContent.slice(0, 80)).join(" | "); })()`));
  // окно со «Сюда» у края экрана целиком на экране (Грегори 2026-11-04: на телефоне уходило за край)
  const popFit = await run(`(() => { const r = document.querySelector(".maplibregl-popup")?.getBoundingClientRect(); return r && { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: innerWidth, h: innerHeight, here: !!document.querySelector(".maplibregl-popup .go-here") }; })()`);
  check("окно места со «Сюда» — целиком на экране", popFit && popFit.here && popFit.l >= 0 && popFit.t >= 0 && popFit.r <= popFit.w && popFit.b <= popFit.h, JSON.stringify(popFit));
  // мимо окна: окно держится ниже строки поиска и может накрыть точку первого щелчка
  const miss = await run(`(() => { const r = document.querySelector(".maplibregl-popup")?.getBoundingClientRect(); return r && r.bottom > 380 && r.top < 420 && r.left < 60 ? [40, Math.min(innerHeight - 160, r.bottom + 60)] : [40, 400]; })()`);
  await clickAt(...miss);
  await sleep(400);
  check("второй щелчок закрывает окно", await run(`!document.querySelector(".maplibregl-popup")`));
  const city = await run(`(() => { const f = atlas.map.queryRenderedFeatures().find((f) => f.sourceLayer === "place" && f.properties.class === "city");
    if (!f) return null; const p = atlas.map.project(f.geometry.coordinates); return { x: p.x, y: p.y, name: f.properties["name:ru"] || f.properties.name }; })()`);
  if (city) {
    await clickAt(city.x, city.y);
    await sleep(4000);
    const info = await run(`({ title: document.querySelector(".maplibregl-popup .popup-title")?.textContent, sub: document.querySelector(".maplibregl-popup .popup-sub")?.textContent, wiki: !!document.querySelector(".maplibregl-popup .popup-wiki") })`);
    check("щелчок по подписи города — окно места", !!info.title, JSON.stringify(info));
    // окно места — как окна разделов: название 15, текст 13, шрифт тот же; не под барабаном и не под строкой поиска
    const look = await run(`(() => { const p = document.querySelector(".maplibregl-popup"), c = p.querySelector(".maplibregl-popup-content"), cs = getComputedStyle(c),
      t = getComputedStyle(p.querySelector(".popup-title")), r = c.getBoundingClientRect(),
      w = [...document.querySelectorAll(".wheel:not(.closed)")].map((x) => x.getBoundingClientRect()).find((x) => x.width > 0);
      return { title: t.fontSize, text: cs.fontSize, font: cs.fontFamily.includes("Poppins"), clearOfWheel: !w || r.right <= w.left + 1, right: Math.round(r.right), wheel: w && Math.round(w.left) }; })()`);
    check("окно места: шрифт и размеры как у окон разделов, не под барабаном", look.title === "15px" && look.text === "13px" && look.font && look.clearOfWheel, JSON.stringify(look));
    await shot("70-place");
    // навигация ведёт карту за мной — окно остаётся (Грегори 2026-11-04: «окно Сюда постоянно сбрасывается»)
    await run(`atlas.map.panBy([5, 5], { duration: 0 }, { navFollow: true }); true`);
    await sleep(300);
    const stays = await run(`!!document.querySelector(".maplibregl-popup")`);
    await run(`atlas.map.panBy([5, 5]); true`);
    await sleep(500);
    check("окно закрывается при движении карты, но не от навигации", stays && await run(`!document.querySelector(".maplibregl-popup")`));
  } else check("подпись города на карте", false);


  // места: в центре Таллина «Рестораны» — флажки; «Музеи» выключают «Рестораны»; щелчок по флажку — окно
  if (want("places/food") && mods.some((m) => m.id === "places/food")) {
    await run(`atlas.map.jumpTo({ center: [24.745, 59.437], zoom: 16 }); true`);
    await run(openLayers("places"));
    await sleep(500);
    const chipFor = itemFor;
    await run(`${chipFor("Рестораны")}.click(); true`);
    await sleep(800);
    await idle();
    for (let i = 0; i < 15 && !(await run(`atlas.map.queryRenderedFeatures({ layers: ["places-poi-food"] }).length > 0`)); i++) await sleep(1000);
    const pins = await run(`atlas.map.queryRenderedFeatures({ layers: ["places-poi-food"] }).length`);
    check("места: флажки ресторанов", pins > 0, `${pins}`);
    await shot("80-places-food");
    await run(`${chipFor("Музеи")}.click(); true`);
    await sleep(1200);
    await idle();
    // несколько категорий сразу: рестораны остаются, музеи добавились, на чипах обе отмечены
    const both = await run(`({ food: atlas.modules().find((m) => m.id === "places/food").active, museums: atlas.modules().find((m) => m.id === "places/museums").active,
      foodPins: atlas.map.queryRenderedFeatures({ layers: ["places-poi-food"] }).length, museumPins: atlas.map.queryRenderedFeatures({ layers: ["places-poi-museums"] }).length,
      chipsOn: [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item.on")].map((c) => c.firstChild.textContent) })`);
    check("места: несколько категорий сразу", both.food && both.museums && both.foodPins > 0 && both.museumPins > 0, JSON.stringify(both));
    await shot("80b-places-food-museums");
    await run(`${chipFor("Музеи")}.click(); true`);
    await run(closeLayers);
    await sleep(800);
    await idle();
    const pt = await run(`(() => { const f = atlas.map.queryRenderedFeatures({ layers: ["places-poi-food"] })[0]; if (!f) return null; const p = atlas.map.project(f.geometry.coordinates); return { x: p.x, y: p.y - 15 }; })()`);
    if (pt) {
      await clickAt(pt.x, pt.y);
      await sleep(3500);
      const pop = await run(`document.querySelector(".maplibregl-popup .popup-title")?.textContent || ""`);
      check("места: щелчок по флажку — окно", !!pop, pop);
      await shot("81-places-popup");
    }
    await run(`atlas.toggle("places/food", false); true`);
  }

  // транспорт издалека (QLever): у Барселоны на «3 км» — вокзалы и фуникулёр Монжуика зелёной булавкой
  if (want("places/transport") && mods.some((m) => m.id === "places/transport")) {
    // «Горнолыжные спуски» в проверке модулей отметили «Канатные дороги» — виды с чистого листа
    await run(`atlas.toggle("places/transport", false)`);
    await run(`localStorage.removeItem("atlas.places.transport.profile"); true`);
    await run(`atlas.map.jumpTo({ center: [2.16, 41.38], zoom: 10.5 }); atlas.toggle("places/transport", true)`);
    for (let i = 0; i < 45 && !(await run(`atlas.map.queryRenderedFeatures({ layers: ["places-transport-far"] }).length > 0`)); i++) await sleep(1000);
    const far = await run(`(() => { const fs = atlas.map.queryRenderedFeatures({ layers: ["places-transport-far"] }); return { n: fs.length, funicular: fs.filter((f) => f.properties.subclass === "funicular").length }; })()`);
    for (let i = 0; i < 30 && !(await run(`atlas.map.queryRenderedFeatures({ layers: ["places-cable-far-line"] }).length > 0`)); i++) await sleep(1000);
    const farCable = await run(`({ lines: atlas.map.queryRenderedFeatures({ layers: ["places-cable-far-line"] }).length, stations: atlas.map.queryRenderedFeatures({ layers: ["places-transport-far"] }).filter((f) => f.properties.subclass === "cable").length })`);
    far.cable = farCable;
    check("транспорт: вокзалы, фуникулёры и канатки издалека", far.n > 0 && farCable.lines > 0 && farCable.stations > 0, JSON.stringify(far));
    await shot("82-transport-far");
    // канатная дорога Port Vell: зелёный трос и станции на зуме 13 (станции в тайлах — только с 14)
    await run(`atlas.map.jumpTo({ center: [2.183, 41.372], zoom: 13.5 }); true`);
    for (let i = 0; i < 20 && !(await run(`atlas.map.queryRenderedFeatures({ layers: ["places-cable"] }).length > 0`)); i++) { await run(`atlas.map.triggerRepaint(); true`); await sleep(1000); }
    const cable = await run(`({ lines: atlas.map.queryRenderedFeatures({ layers: ["places-lift-line"] }).length, stations: atlas.map.queryRenderedFeatures({ layers: ["places-cable"] }).length })`);
    check("транспорт: канатная дорога (трос и станции)", cable.lines > 0 && cable.stations > 0, JSON.stringify(cable));
    await shot("83-cable");
    // виды транспорта из меню: «Метро» — только красные «М», «Фуникулёры и канатные дороги» — без метро
    const pick = async (title) => run(`(async () => {
      await ${openLayers("places/transport")};
      const items = [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].map((i) => i.firstChild.textContent);
      ${itemFor(title)}.click();
      await new Promise((r) => setTimeout(r, 1500));
      // столбик кнопок не закрывается после выбора
      const open = !document.querySelector(".sub-places").hidden;
      await ${closeLayers};
      return { items, open }; })()`);
    const { items, open } = await pick("Метро");
    await idle();
    const metro = await run(`[...new Set(atlas.map.queryRenderedFeatures({ layers: ["places-poi-transport", "places-stops", "places-cable", "places-lift-line"] }).map((f) => f.properties.subclass + (f.layer.id === "places-poi-transport" ? "" : "@" + f.layer.id)))]`);
    check("транспорт: меню видов, «Метро» — только метро, список остаётся", open && items.length === 7 && metro.length > 0 && metro.every((s) => s === "subway"), `${items.join(" / ")} → ${metro.join(", ")}`);
    // второй вид добавляется к первому: метро и канатки вместе; снять «Метро» — останутся канатки
    await pick("Канатные дороги");
    await idle();
    const multi = await run(`({ subway: atlas.map.queryRenderedFeatures({ layers: ["places-poi-transport"] }).some((f) => f.properties.subclass === "subway"),
      lines: atlas.map.queryRenderedFeatures({ layers: ["places-lift-line"] }).length,
      label: document.querySelector('.layers-circle[data-key="places/transport"]').ariaLabel })`);
    check("транспорт: несколько видов сразу (метро + канатки)", multi.subway && multi.lines > 0 && multi.label === "Транспорт", JSON.stringify(multi));
    await pick("Метро");
    await idle();
    const lifts = await run(`({ poi: [...new Set(atlas.map.queryRenderedFeatures({ layers: ["places-poi-transport"] }).map((f) => f.properties.class))], lines: atlas.map.queryRenderedFeatures({ layers: ["places-lift-line"] }).length })`);
    check("транспорт: «Фуникулёры и канатные дороги»", lifts.lines > 0 && !lifts.poi.includes("subway") && lifts.poi.every((c) => c !== "bus"), JSON.stringify(lifts));
    await shot("84-transport-lifts");
    // крестик у кружка «Транспорт» снимает всё: слой выключен, виды забыты
    const cleared = await run(`(async () => {
      await ${openLayers("places/transport")};
      const x = document.querySelector('.layers-circle[data-key="places/transport"]').parentElement.querySelector(".layers-clear");
      const shown = !x.hidden;
      x.click(); await new Promise((r) => setTimeout(r, 800));
      const res = { shown, off: !atlas.modules().find((m) => m.id === "places/transport").active,
        closed: document.querySelector(".sub-places").hidden };
      // открыть снова: ничего не отмечено, у видов кольца цвета
      await ${openLayers("places/transport")};
      res.noneMarked = !document.querySelector(".layers-sub:not([hidden]) .layers-item.on");
      res.rings = [...document.querySelectorAll(".layers-sub .layers-icon.ring")].length;
      await ${closeLayers};
      return res; })()`);
    check("транспорт: крестик снимает всё, у видов кольца цвета", cleared.shown && cleared.off && cleared.closed && cleared.noneMarked && cleared.rings === 7, JSON.stringify(cleared));
    await run(`atlas.toggle("places/transport", false)`);
    // «Горнолыжные спуски» (в «Тропах»): трассы и все подъёмники, включают «Канатные дороги» в «Транспорте» и
    // запоминают это; выключили спуски — канатные дороги остаются (Грегори 2026-11-13)
    // вблизи — свои линии из OSM (QLever): номера трасс табличками, стрелки, подъёмники с подписями; щелчок по номеру —
    // окно трассы (Грегори 2026-11-15: «номера спусков должны быть видны через запотевшие лыжные очки»)
    await run(`atlas.map.jumpTo({ center: [10.245, 47.135], zoom: 14 }); atlas.toggle("trails/slopes", true)`);
    await idle();
    const skiCount = (id) => `atlas.map.queryRenderedFeatures({ layers: ["${id}"] }).length`;
    for (let i = 0; i < 60 && !(await run(`${skiCount("trails-slopes-numbers")} > 0 && ${skiCount("trails-slopes-lifts-line")} > 0`)); i++) { await run(`atlas.map.triggerRepaint(); true`); await sleep(1000); }
    const ski = await run(`(() => { const tr = atlas.modules().find((m) => m.id === "places/transport");
      return { raster: !!atlas.map.getLayer("trails-slopes-raster"), chairs: ${skiCount("trails-slopes-lifts-line")},
        numbers: ${skiCount("trails-slopes-numbers")}, arrows: ${skiCount("trails-slopes-arrows")}, liftNumbers: ${skiCount("trails-slopes-lift-numbers")},
        font: atlas.map.getLayoutProperty("trails-slopes-numbers", "text-font")?.[0],
        tr: tr.active, marked: tr.menu.items().filter((i) => i.active).map((i) => i.id), kept: JSON.parse(localStorage.getItem("atlas.layers.on") || "[]").includes("places/transport"),
        gondolas: atlas.map.getLayoutProperty("places-lift-line", "visibility") }; })()`);
    await shot("85-slopes");
    const skiAt = await run(`(() => { const c = atlas.map.project(atlas.map.getCenter());
      const p = atlas.map.queryRenderedFeatures({ layers: ["trails-slopes-numbers"] }).map((f) => atlas.map.project(f.geometry.coordinates))
        .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
      return p && [Math.round(p.x), Math.round(p.y)]; })()`);
    if (skiAt) await clickAt(...skiAt);
    for (let i = 0; i < 10 && !(await run(`!!document.querySelector(".maplibregl-popup .popup-title")`)); i++) await sleep(300);
    const skiPop = await run(`({ title: document.querySelector(".maplibregl-popup .popup-title")?.textContent || "", sub: document.querySelector(".maplibregl-popup .popup-sub")?.textContent || "",
      wx: !!document.querySelector(".maplibregl-popup .wx-chip"), kept: atlas.modules().find((m) => m.id === "trails/slopes").stats().numbered })`);
    check("«Горнолыжные спуски» вблизи: номера трасс табличками (жирным), стрелки, номера подъёмников; щелчок по номеру — окно трассы с погодой",
      ski.numbers > 0 && ski.arrows > 0 && ski.liftNumbers > 0 && /Bold/.test(ski.font) && /^Трасса \S+/.test(skiPop.title) && /спуск|лыжня|трасса/i.test(skiPop.sub) && skiPop.wx && skiPop.kept > 0,
      JSON.stringify({ ski, skiAt, skiPop }));
    await run(`document.querySelector(".maplibregl-popup-close-button")?.click(); atlas.toggle("trails/slopes", false)`);
    const skiOff = await run(`({ raster: !!atlas.map.getLayer("trails-slopes-raster"), tr: atlas.modules().find((m) => m.id === "places/transport").active })`);
    check("«Горнолыжные спуски»: трассы и подъёмники, включают «Канатные дороги»; выключили спуски — канатные дороги остались",
      ski.raster && ski.chairs > 0 && ski.tr && ski.marked.join() === "lifts" && ski.kept && ski.gondolas === "visible" && !skiOff.raster && skiOff.tr, JSON.stringify({ ski, skiOff }));
    await run(`atlas.toggle("places/transport", false)`);
    // «Беговые лыжи» — отдельно от спусков (Грегори 2026-11-21: «не надо их путать»), без маяков и щитов у троп
    if (mods.some((m) => m.id === "trails/nordic")) {
      await run(`atlas.map.jumpTo({ center: [24.86, 59.47], zoom: 13 }); atlas.toggle("trails/nordic", true)`);
      let nd = null;
      for (let i = 0; i < 60; i++) {
        nd = await run(`({ ...atlas.modules().find((m) => m.id === "trails/nordic").stats(), lifts: atlas.map.getLayer("trails-slopes-lifts-line") ? ${skiCount("trails-slopes-lifts-line")} : 0,
          poi: atlas.modules().find((m) => m.id === "layers/trail-poi")?.active || false, slopes: atlas.modules().find((m) => m.id === "trails/slopes").active })`);
        if (nd.drawn > 0) break;
        await run(`atlas.map.triggerRepaint(); true`); await sleep(1000);
      }
      await shot("85b-nordic");
      await run(`atlas.toggle("trails/nordic", false)`);
      const ndOff = await run(`!!atlas.map.getLayer("trails-slopes-raster")`);
      check("«Беговые лыжи» — своя кнопка: лыжни у Пирита без подъёмников, спусков и значков троп; выключили — слоёв нет",
        nd.nordic > 0 && nd.drawn > 0 && nd.lifts === 0 && !nd.poi && !nd.slopes && !ndOff, JSON.stringify({ nd, ndOff }));
    }
    const forgot = await run(`!JSON.parse(localStorage.getItem("atlas.layers.on") || "[]").includes("places/transport")`);
    check("выключенный слой забыт до следующего запуска", forgot);
    await run(`localStorage.removeItem("atlas.places.transport.profile"); true`);
  }

  // пешие тропы (Валь-Гардена): с зума 11 — линии с номерами, с 14 — полная геометрия маршрутов
  if (want("trails/hiking") && mods.some((m) => m.id === "trails/hiking")) {
    const stats = `atlas.modules().find((m) => m.id === "trails/hiking").stats()`;
    await run(`atlas.map.jumpTo({ center: [11.765, 46.585], zoom: 12.5 }); atlas.toggle("trails/hiking", true)`);
    for (let i = 0; i < 30 && !(await run(`${stats}.segs > 0`)); i++) await sleep(1000);
    await sleep(2000);
    await idle();
    const s1 = await run(stats);
    check("тропы: маршруты и линии", s1.segs > 0 && s1.routes > 0, JSON.stringify(s1));
    await run(`atlas.map.jumpTo({ center: [11.765, 46.585], zoom: 15 }); true`);
    await idle();
    await shot("85-trails-simplified");
    for (let i = 0; i < 30 && !(await run(`${stats}.full > 0`)); i++) { await run(`atlas.map.triggerRepaint(); true`); await sleep(1000); }
    await sleep(3000);
    await idle();
    const s2 = await run(stats);
    check("тропы: вблизи — полная геометрия", s2.full > 0 && s2.fullPoints > 0, JSON.stringify(s2));
    // значки у троп: щиты с фото — с оранжевой обводкой (из того же запроса QLever)
    for (let i = 0; i < 40 && !(await run(`(atlas.map.getSource("trail-poi")?.serialize?.().data?.features?.length || 0) > 0`)); i++) await sleep(1000);
    const poi = await run(`(() => { const d = atlas.map.getSource("trail-poi")?.serialize?.().data?.features || []; return { all: d.length, photo: d.filter((f) => f.properties.hasPhoto).length, water: d.filter((f) => f.properties.kind === "drinking_water").length, ringImg: atlas.map.hasImage("outdoor-guidepost-photo") }; })()`);
    check("значки у троп: загрузились, обводка для фото готова", poi.all > 0 && poi.ringImg, JSON.stringify(poi));
    await shot("86-trails-full");
    // меню значимости: «Местные» — только фиолетовые линии (rank 1), картинки издалека не трогаются
    await run(`atlas.map.jumpTo({ center: [11.765, 46.585], zoom: 12.5 }); (async () => { localStorage.setItem("atlas.trails.hiking.profile", JSON.stringify("loc")); await atlas.toggle("trails/hiking", true); return true; })()`);
    await idle();
    const loc = await run(`[...new Set(atlas.map.queryRenderedFeatures({ layers: ["trails-hiking-line"] }).map((f) => f.properties.rank))]`);
    check("тропы: меню «Местные» — только местные", loc.length > 0 && loc.every((r) => r === 1), JSON.stringify(loc));
    await shot("86b-trails-local");
    await run(`localStorage.removeItem("atlas.trails.hiking.profile"); atlas.toggle("trails/hiking", true).then(() => true)`);
    await idle();
    const all = await run(`[...new Set(atlas.map.queryRenderedFeatures({ layers: ["trails-hiking-line"] }).map((f) => f.properties.rank))]`);
    check("тропы: ничего не отмечено — все", all.length > 1, JSON.stringify(all));
    await run(`atlas.toggle("trails/hiking", false)`);
  }

  // велодорожки: одна кнопка в разделе «Тропы», вид — в меню; «Маунтинбайк» оставляет только МТБ
  if (want("trails/cycling") && mods.some((m) => m.id === "trails/cycling")) {
    const bike = await run(`(async () => {
      await ${openLayers("trails/cycling")};
      const circles = [...document.querySelectorAll(".wheel-layers .layers-circle")].map((c) => c.ariaLabel.split(":")[0]);
      const items = [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].map((i) => i.firstChild.textContent);
      ${itemFor("Маунтинбайк")}.click();
      await new Promise((r) => setTimeout(r, 1500));
      const layers = { cycling: !!atlas.map.getLayer("trails-cycling-line"), mtb: !!atlas.map.getLayer("trails-mtb-line") };
      const label = document.querySelector('.layers-circle[data-key="trails/cycling"]').ariaLabel;
      // тот же вид ещё раз — выключает
      ${itemFor("Маунтинбайк")}.click();
      await new Promise((r) => setTimeout(r, 800));
      const off = !atlas.modules().find((m) => m.id === "trails/cycling").active && !atlas.map.getLayer("trails-mtb-line");
      localStorage.removeItem("atlas.trails.cycling.profile");
      await ${closeLayers};
      return { circles, items, layers, label, off };
    })()`);
    check("велодорожки: свой кружок, виды кнопками, повторный щелчок выключает", bike.circles.includes("Велодорожки") && bike.items.length === 2 && bike.layers.mtb && !bike.layers.cycling && bike.label === "Велодорожки: Маунтинбайк" && bike.off, JSON.stringify(bike));
  }

  // дороги: у Таллина — линии по классам; «Грунтовые» — только без покрытия
  if (want("layers/roads") && mods.some((m) => m.id === "layers/roads")) {
    await run(`atlas.map.jumpTo({ center: [24.75, 59.4], zoom: 12 }); atlas.toggle("layers/roads", true).then(() => true)`);
    await idle();
    const classes = await run(`[...new Set(atlas.map.queryRenderedFeatures({ layers: ["road", "road-unpaved", "road-tunnel"] }).map((f) => f.properties.class))]`);
    check("дороги: линии по классам", classes.includes("primary") || classes.includes("trunk"), JSON.stringify(classes));
    await shot("87a-roads");
    await run(`(async () => { localStorage.setItem("atlas.roads.profile", JSON.stringify("unpaved")); await atlas.toggle("layers/roads", true); return true; })()`);
    await idle();
    const unp = await run(`({ paved: atlas.map.queryRenderedFeatures({ layers: ["road", "road-tunnel"] }).length,
      unpaved: atlas.map.queryRenderedFeatures({ layers: ["road-unpaved"] }).length })`);
    check("дороги: «Грунтовые» — только без покрытия", unp.paved === 0 && unp.unpaved > 0, JSON.stringify(unp));
    await shot("87b-roads-unpaved");
    await run(`localStorage.removeItem("atlas.roads.profile"); atlas.toggle("layers/roads", false).then(() => true)`);
  }

  // экскурсии: кнопка в барабане, в столбике — страны; страна — список в панели, экскурсия — пункты,
  // номера остановок на карте; аудиогид начинается; режим «Найти экскурсию» в строке поиска
  if (want("content/tours") && mods.some((m) => m.id === "content/tours")) {
    const ts = `atlas.modules().find((m) => m.id === "content/tours").stats()`;
    await run(openLayers("content/tours"));
    for (let i = 0; i < 40 && !(await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].length > 3`)); i++) await sleep(500);
    await shot("98-tours-home");
    const cs = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].map((b) => b.firstChild.textContent)`);
    check("экскурсии: в столбике — страны", cs.length >= 5 && cs.some((c) => /^Италия/.test(c)), JSON.stringify(cs));
    await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].find((b) => /^Италия/.test(b.firstChild.textContent)).click(); true`);
    await sleep(600);
    const lst = await run(`({ panel: !document.querySelector('[data-panel="tours"]').hidden, rows: [...document.querySelectorAll(".tr-row-title")].map((r) => r.textContent),
      mode: document.querySelector(".search-box input").placeholder })`);
    check("экскурсии: список страны в панели, режим поиска", lst.panel && lst.rows.length >= 2 && lst.mode === "Найти экскурсию", JSON.stringify(lst));
    // «Свернуть» окна — оно уходит значком в строку поиска (места не занимает); щелчок по значку или по
    // строке — окно снова (Грегори 2026-11-05); висящий маршрут — стрелкой, одно окно за раз
    const tp = `document.querySelector('[data-panel="tours"]')`;
    const head = await run(`[...${tp}.querySelectorAll(".panel-head .panel-btn")].slice(-2).map((b) => b.title + ":" + Math.round(b.getBoundingClientRect().width))`);
    await run(`${tp}.querySelector(".panel-btn[title=Свернуть]").click(); true`);
    const fold1 = await run(`({ shown: getComputedStyle(${tp}).display !== "none", on: document.querySelector('.wheel-content .layers-circle[data-key="content/tours"]').classList.contains("on") })`);
    await tap("content/tours");
    const fold2 = await run(`getComputedStyle(${tp}).display !== "none"`);
    await tap("content/tours");
    const fold2b = await run(`getComputedStyle(${tp}).display !== "none"`);
    await run(`(() => { const i = document.querySelector(".search-box input"); i.click(); return true; })()`);
    const fold3 = await run(`getComputedStyle(${tp}).display !== "none"`);
    await run(`atlas.route.setTarget({ lngLat: [12.33, 45.44], title: "Проба пути" }); true`);
    await sleep(200);
    const arrow1 = await run(`({ card: !document.querySelector(".search-card").hidden, arrow: !!document.querySelector(".search-toggle .search-card-arrow") })`);
    await tap("content/navigation");
    const arrow2 = await run(`({ card: !document.querySelector(".search-card").hidden, panel: getComputedStyle(${tp}).display !== "none" })`);
    await tap("content/tours");
    const arrow3 = await run(`({ card: !document.querySelector(".search-card").hidden, panel: getComputedStyle(${tp}).display !== "none", wheel: !document.querySelector(".wheel-content").classList.contains("closed") })`);
    await run(`atlas.route.setTarget(null); true`);
    check("окна: в шапке «Свернуть» и «Закрыть» 34 px, как в карточке; кнопка раздела в барабане сворачивает и разворачивает, строка — разворачивает; карточка пути — кнопкой навигации, одно окно за раз, барабан не закрывается",
      JSON.stringify(head) === '["Свернуть:34","Закрыть:34"]' && !fold1.shown && fold1.on && fold2 && !fold2b && fold3 && !arrow1.card && arrow1.arrow && arrow2.card && !arrow2.panel
      && !arrow3.card && arrow3.panel && arrow3.wheel, JSON.stringify({ head, fold1, fold2, fold2b, fold3, arrow1, arrow2, arrow3 }));
    await run(`(([...document.querySelectorAll(".tr-row")].find((r) => /Венеция/.test(r.textContent))) || document.querySelector(".tr-row")).click(); true`);
    for (let i = 0; i < 60 && (await run(`${ts}.found`)) < 3; i++) await sleep(1000);
    for (let i = 0; i < 30 && !(await run(`atlas.map.queryRenderedFeatures({ layers: ["tour-stops"] }).length >= 2`)); i++) await sleep(1000);
    const tour = await run(`({ ...${ts}, sections: document.querySelectorAll(".tr-section").length, nums: atlas.map.queryRenderedFeatures({ layers: ["tour-stops"] }).length })`);
    check("экскурсии: экскурсия открыта, остановки на карте", tour.open && tour.sections > 3 && tour.found >= 3 && tour.nums >= 2, JSON.stringify(tour));
    await shot("98-tour");
    // щелчок по заголовку остановки — выделение
    await run(`document.querySelector('.tr-section[data-n="2"] .tr-sec-title').click(); true`);
    await sleep(800);
    check("экскурсии: щелчок по остановке — выделена", (await run(`${ts}.selected`)) === 2 && (await run(`!!document.querySelector('.tr-section.current[data-n="2"]')`)));
    // аудиогид: плей — вступление
    await run(`document.querySelector(".pb-player .pb-btn:nth-child(2)").click(); true`);
    await sleep(800);
    check("экскурсии: аудиогид запускается", (await run(`${ts}.playing`)) === -1 && /Вступление/.test(await run(`document.querySelector(".pb-player-label").textContent`)));
    await run(`document.querySelector(".pb-player .pb-btn:nth-child(4)").click(); true`);
    // поиск экскурсии из строки поиска
    const found = await run(`(async () => { const i = document.querySelector(".search-box input"); i.value = "Будапешт"; i.dispatchEvent(new Event("input"));
      await new Promise((r) => setTimeout(r, 200)); return [...document.querySelectorAll(".tr-row-title")].map((r) => r.textContent); })()`);
    check("экскурсии: поиск из строки поиска", found.length >= 1 && found.every((t) => /Будапешт/.test(t)), JSON.stringify(found));
    await run(exitMode);
    await sleep(300);
    check("экскурсии: крестик значка — закрыть, остановки с карты убраны", await run(`document.querySelector('[data-panel="tours"]').hidden && !atlas.map.queryRenderedFeatures({ layers: ["tour-stops"] }).length`));
    await run(closeLayers);
  }

  // языки: кнопка в барабане, в столбике — языки с флагами; язык — панель слева с разделами и фразами,
  // в строке поиска — значок режима, ввод ищет фразу; крестик значка — обратно к поиску мест
  if (want("content/languages") && mods.some((m) => m.id === "content/languages")) {
    await run(openLayers("content/languages"));
    for (let i = 0; i < 40 && !(await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].length > 3`)); i++) await sleep(500);
    const langs = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].map((b) => b.firstChild.textContent)`);
    check("языки: в столбике — языки", langs.length >= 5 && langs.some((l) => /Итальянский/.test(l)), JSON.stringify(langs));
    // уже у списка — значок раздела вместо логотипа, строка поиска ищет язык
    const ll = await run(`(async () => { const i = document.querySelector(".search-box input"); i.value = "итал"; i.dispatchEvent(new Event("input"));
      await new Promise((r) => setTimeout(r, 200)); const shown = [...document.querySelectorAll(".panel:not([hidden]) .home-row:not([hidden])")].map((b) => b.textContent);
      i.value = ""; i.dispatchEvent(new Event("input"));
      return { mode: document.querySelector(".search-toggle").classList.contains("mode"), placeholder: i.placeholder, shown }; })()`);
    check("языки: у списка — значок раздела на кнопке, поиск ищет язык", ll.mode && ll.placeholder === "Найти язык" && ll.shown.length === 1 && /Итальянский/.test(ll.shown[0]), JSON.stringify(ll));
    await run(`${itemFor("Итальянский")}.click(); true`);
    await sleep(800);
    const pb = await run(`({ panel: !document.querySelector('[data-panel="languages"]').hidden, title: document.querySelector('[data-panel="languages"] .panel-title span').textContent,
      tabs: [...document.querySelectorAll(".pb-tab")].map((t) => t.textContent), phrases: document.querySelectorAll(".pb-phrase").length,
      mode: document.querySelector(".search-toggle").classList.contains("mode"), placeholder: document.querySelector(".search-box input").placeholder,
      wheelOn: document.querySelector('.layers-circle[data-key="content/languages"]').classList.contains("on") })`);
    check("языки: разговорник открыт в панели, в поиске — значок режима", pb.panel && pb.title === "Итальянский" && pb.phrases > 20 && pb.tabs.length >= 2
      && pb.mode && pb.placeholder === "Найти фразу" && pb.wheelOn, JSON.stringify(pb));
    await shot("97-languages");
    const found = await run(`(async () => { const i = document.querySelector(".search-box input"); i.value = "спасибо"; i.dispatchEvent(new Event("input"));
      await new Promise((r) => setTimeout(r, 200)); const shown = [...document.querySelectorAll(".pb-phrase")].filter((b) => !b.hidden);
      return { shown: shown.length, all: shown.every((b) => b.textContent.toLowerCase().includes("спасибо")) }; })()`);
    check("языки: поиск фразы из строки поиска", found.shown > 0 && found.all, JSON.stringify(found));
    await run(`document.querySelector(".pb-phrase:not([hidden])").click(); true`);
    // стрелка назад — к списку языков
    const pbBack = await run(`(async () => { const b = document.querySelector('[data-panel="languages"] .tr-bar-left .pb-btn'); const title = b?.title; b?.click();
      await new Promise((r) => setTimeout(r, 300)); return { title, list: document.querySelectorAll('[data-panel="languages"] .home-row').length, head: document.querySelector('[data-panel="languages"] .panel-title span').textContent }; })()`);
    check("языки: стрелка назад в разговорнике — к списку языков", pbBack.title === "Все языки" && pbBack.list > 0 && pbBack.head === "Языки", JSON.stringify(pbBack));
    await run(exitMode);
    await sleep(300);
    const back = await run(`({ panel: document.querySelector('[data-panel="languages"]').hidden, mode: !document.querySelector(".search-toggle").classList.contains("mode"),
      placeholder: document.querySelector(".search-box input").placeholder })`);
    check("языки: крестик значка — обратно к поиску мест", back.panel && back.mode && back.placeholder === "Поиск места", JSON.stringify(back));
    await run(closeLayers);
  }

  // мои альбомы: кнопка в барабане, в столбике — страны; альбом папки «Альбомы» (Какумяэ) — в Эстонии,
  // в панели — снимки сеткой, на карте — точки и миниатюры, в ленте — его снимки; режим «Найти альбом»
  if (want("content/albums") && mods.some((m) => m.id === "content/albums")) {
    const as = `atlas.modules().find((m) => m.id === "content/albums").stats()`;
    await run(openLayers("content/albums"));
    for (let i = 0; i < 60 && !(await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].some((b) => /^Эстония/.test(b.firstChild.textContent))`)); i++) await sleep(500);
    const cs = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].map((b) => b.firstChild.textContent)`);
    // телефон узнаётся так же, как в программе (эмуляция здесь меняет только размер экрана)
    const phone = await run(`import("./core/modules.js").then((m) => m.isMobile())`);
    check("альбомы: в столбике — страны, на компьютере первой строкой — выбор папки", cs.some((c) => /^Эстония/.test(c))
      && (phone ? !/папк/.test(cs[0]) : cs[0] === "Добавить папку…"), JSON.stringify(cs));
    await run(`${itemFor("Эстония (1)")}.click(); true`);
    await sleep(600);
    const lst = await run(`({ panel: !document.querySelector('[data-panel="albums"]').hidden, rows: [...document.querySelectorAll(".al-row .tr-row-title")].map((r) => r.textContent),
      mode: document.querySelector(".search-box input").placeholder, icons: !!atlas.map.getLayer("albums-icons") })`);
    check("альбомы: список страны в панели, значки на карте, режим поиска", lst.panel && lst.rows.length >= 1 && lst.mode === "Найти альбом" && lst.icons, JSON.stringify(lst));
    await run(`document.querySelector(".al-row").click(); true`);
    for (let i = 0; i < 40 && !(await run(`${as}.located >= 5 && document.querySelectorAll(".al-cell img[src]").length >= 5`)); i++) await sleep(1000);
    await sleep(2500);
    await idle();
    for (let i = 0; i < 30 && !(await run(`atlas.map.queryRenderedFeatures({ layers: ["albums-dots", "albums-thumbs"] }).length > 0`)); i++) await sleep(1000);
    const al = await run(`({ ...${as}, cells: document.querySelectorAll(".al-cell").length, imgs: document.querySelectorAll(".al-cell img[src]").length,
      onMap: atlas.map.queryRenderedFeatures({ layers: ["albums-dots", "albums-thumbs"] }).length, zoom: atlas.map.getZoom() })`);
    check("альбомы: альбом открыт, снимки с местом на карте", al.open && al.cells >= 10 && al.imgs >= 5 && al.located >= 5 && al.onMap > 0, JSON.stringify(al));
    await shot("99-albums");
    for (let i = 0; i < 20 && !(await run(`document.querySelectorAll(".photo-strip-item").length > 0`)); i++) await sleep(1000);
    check("альбомы: снимки — в ленте внизу", await run(`document.querySelectorAll(".photo-strip-item").length > 0`));
    const found = await run(`(async () => { const i = document.querySelector(".search-box input"); i.value = "kakum"; i.dispatchEvent(new Event("input"));
      await new Promise((r) => setTimeout(r, 200)); return [...document.querySelectorAll(".al-row .tr-row-title")].map((r) => r.textContent); })()`);
    check("альбомы: поиск из строки поиска", found.length === 1, JSON.stringify(found));
    await run(exitMode);
    await sleep(300);
    check("альбомы: крестик значка — закрыть, снимки с карты и ленты убраны", await run(`document.querySelector('[data-panel="albums"]').hidden && !atlas.map.getLayer("albums-dots") && !document.querySelectorAll(".photo-strip-item").length`));
    await run(closeLayers);

    // своя папка с поездкой (выдуманная, в памяти): поездка с днями-подпапками — одной строкой в стране,
    // внутри — «Избранное» (-Albom) первым, дни по порядку папок, снимки самой папки поездки — последними, «[Originals]» пропущены; назад — в поездку.
    // В «Риге» — живое фото (r.jpg + r.mov) и ролик v.mp4 (tools/test-clip.mp4: 1 с, 64×48, внутри дата 1.01.2024; место из ролика проверено на настоящих роликах iPhone — здесь оно увело бы «Ригу» в другую страну)
    if (!PHONE) {
      const gear = settingsToggle;
      const setBtn = (text) => `[...document.querySelectorAll(".panel:not([hidden]) .text-btn")].find((b) => b.textContent === ${JSON.stringify(text)})`;
      await run(`(async () => {
        const jpg = await new Promise((r) => { const c = Object.assign(document.createElement("canvas"), { width: 8, height: 8 }); c.toBlob(r, "image/jpeg"); });
        const clip = await (await fetch("tools/test-clip.mp4")).blob();
        const jpgBig = await new Promise((r) => { const c = Object.assign(document.createElement("canvas"), { width: 400, height: 300 }); const x = c.getContext("2d");
          x.fillStyle = "#6af"; x.fillRect(0, 0, 400, 300); x.fillStyle = "#353"; x.beginPath(); x.moveTo(0, 150); x.lineTo(400, 164); x.lineTo(400, 300); x.lineTo(0, 300); x.fill(); c.toBlob(r, "image/jpeg"); });
        const file = (name, data) => { const f = { kind: "file", name, data: data || (/\.(mov|mp4|m4a)$/.test(name) ? clip : name === "r.jpg" ? jpgBig : jpg), t: 1,
          getFile: async () => new File([f.data], name, { type: /\.mov$/.test(name) ? "video/quicktime" : /\.(mp4|m4a)$/.test(name) ? "video/mp4" : "image/jpeg", lastModified: f.t }),
          createWritable: async () => { const parts = []; return { write: async (d) => { parts.push(d); }, close: async () => { f.data = new Blob(parts); f.t = Date.now(); } }; } }; return f; };
        const folder = (name, items) => ({ kind: "directory", name, items, async *entries() { for (const i of items) yield [i.name, i]; },
          async *values() { for (const i of items) yield i; },
          getDirectoryHandle: async (n, o) => items.find((i) => i.kind === "directory" && i.name === n) || (o?.create ? (items.push(folder(n, [])), items.at(-1)) : Promise.reject(new DOMException("нет", "NotFoundError"))),
          getFileHandle: async (n, o) => items.find((i) => i.kind === "file" && i.name === n) || (o?.create ? (items.push(file(n, new Blob([]))), items.at(-1)) : Promise.reject(new DOMException("нет", "NotFoundError"))),
          removeEntry: async (n) => { const i = items.findIndex((x) => x.name === n); if (i < 0) throw new DOMException("нет", "NotFoundError"); items.splice(i, 1); },
          isSameEntry: async (o) => o?.name === name,
          queryPermission: async () => "granted", requestPermission: async () => "granted" });
        const trip = "20230625-0716 (Travel) Испания";
        window.showDirectoryPicker = async () => folder("Фото", [
          folder(trip, [file("0.jpg"), folder("20230626 Варшава", [file("3.jpg"), folder("[Originals]", [file("3.jpg")])]),
            folder("20230625 Таллин", [file("1.jpg"), file("2.jpg")]), folder(trip + "-Albom", [file("1.jpg")])]),
          folder("20240101 Рига", [file("r.jpg"), file("r.mov"), file("v.mp4"),
            file("Рига.txt", new Blob([["# Прогулка по Риге", "", "Домский собор и старый город.", "", "r.jpg", "Вид на старый город"].join(String.fromCharCode(10))]))]), folder("Music", [file("a.m4a")])]);
        window.testFs = { file, folder };
        return true; })()`);
      await run(gear);
      await sleep(600);
      await run(`atlas.modules().find((m) => m.id === "content/albums").pickFolder(); true`);
      for (let i = 0; i < 30 && !(await run(`${as}.groups === 1 && !${as}.busy`)); i++) await sleep(500);
      await run(gear);
      await run(openLayers("content/albums"));
      for (let i = 0; i < 20 && !(await run(`!!${itemFor("Без страны (2)")}`)); i++) await sleep(500);
      const tc = await run(`({ ...${as}, items: [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].map((b) => b.firstChild.textContent) })`);
      check("альбомы: поездка с подпапками — одна строка, дни — свои альбомы, «[Originals]» пропущены",
        tc.groups === 1 && tc.albums === 6 && tc.items.includes("Без страны (2)"), JSON.stringify(tc));
      // просьба о записи в папку (окно галереи её не получает) — красная плашка внизу слева над шкалой, крестик закрывает
      const ask = await run(`(() => { atlasGalleryAskWrite(0); const el = document.querySelector(".al-write-ask"), r = el.getBoundingClientRect(),
        sc = document.querySelector(".maplibregl-ctrl-scale").getBoundingClientRect();
        const out = { text: el.querySelector(".al-write-go").textContent, bg: getComputedStyle(el).backgroundColor, above: r.bottom <= sc.top + 1, left: r.left < innerWidth / 2,
          inside: r.left >= 0 && r.right <= innerWidth };
        el.querySelector(".al-write-x").click(); out.closed = !document.querySelector(".al-write-ask"); return out; })()`);
      check("альбомы: просьба о записи — красная плашка внизу слева над шкалой, крестик закрывает",
        /^Разрешить запись в папку/.test(ask.text) && ask.bg === "rgb(229, 57, 53)" && ask.above && ask.left && ask.inside && ask.closed, JSON.stringify(ask));
      await run(`${itemFor("Без страны (2)")}.click(); true`);
      await sleep(600);
      const rows = await run(`[...document.querySelectorAll(".al-row")].map((r) => r.textContent)`);
      // папка отличается от альбома: стрелка раскрывает её альбомы в списке, кнопка в шапке — все папки разом
      const fold = `document.querySelector('[data-panel="albums"] .panel-head .panel-btn:not([hidden])[title$="все папки"]')`;
      const titles = `[...document.querySelectorAll(".al-row .tr-row-title")].map((r) => r.textContent)`;
      const f0 = await run(`({ chev: document.querySelectorAll(".al-chev").length, fold: ${fold}?.title, rows: ${titles} })`);
      await run(`document.querySelector(".al-chev").click(); true`);
      const f1 = await run(`({ fold: ${fold}?.title, rows: ${titles}, indent: getComputedStyle(document.querySelector(".al-folder + .al-line")).paddingLeft })`);
      await run(`${fold}.click(); true`);
      const f2 = await run(`({ fold: ${fold}?.title, rows: ${titles} })`);
      check("альбомы: стрелка папки раскрывает её альбомы, кнопка в шапке сворачивает все",
        f0.chev === 1 && f0.fold === "Раскрыть все папки" && f1.rows.length === f0.rows.length + 4 && f1.indent === "24px" && f1.fold === "Свернуть все папки"
        && f2.rows.length === f0.rows.length && f2.fold === "Раскрыть все папки", JSON.stringify({ f0, f1, f2 }));
    // ползунок внизу окна: потянуть мышью вверх — окно ниже; двойное нажатие — снова по содержимому
      const box = `document.querySelector('[data-panel="albums"]')`;
      const g = await run(`(() => { const r = ${box}.querySelector(".panel-grip").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, ${box}.getBoundingClientRect().height]; })()`);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: g[0], y: g[1], button: "left", buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 5; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: g[0], y: g[1] - 8 * i, button: "left", buttons: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: g[0], y: g[1] - 40, button: "left", buttons: 0, clickCount: 1 });
      const dragged = await run(`${box}.getBoundingClientRect().height`);
      await run(`${box}.querySelector(".panel-grip").dispatchEvent(new MouseEvent("dblclick")); true`);
      check("окно: ползунок внизу меняет высоту, двойное нажатие возвращает", Math.abs(g[2] - 40 - dragged) < 2 && !(await run(`${box}.style.maxHeight`)),
        JSON.stringify({ before: g[2], dragged }));
      await run(`[...document.querySelectorAll(".al-row")].find((r) => r.textContent.startsWith("Испания")).click(); true`);
      await sleep(400);
      const inTrip = await run(`({ title: document.querySelector('[data-panel="albums"] .panel-title')?.textContent,
        kids: [...document.querySelectorAll(".al-row .tr-row-title")].map((r) => r.textContent) })`);
      check("альбомы: поездка открыта — «Избранное» первым, дни по порядку, «Снимки поездки» последними",
        rows.some((r) => /^Испания4 альб\. · 4 фото/.test(r)) && JSON.stringify(inTrip.kids) === JSON.stringify(["Избранное", "Таллин", "Варшава", "Снимки поездки"]), JSON.stringify({ rows, inTrip }));
      await run(`document.querySelectorAll(".al-row")[2].click(); true`);
      await sleep(400);
      const day = await run(`({ open: ${as}.open, back: document.querySelector('[data-panel="albums"] .pb-btn').title, cells: document.querySelectorAll(".al-cell").length })`);
      await run(`document.querySelector('[data-panel="albums"] .pb-btn').click(); true`);
      await sleep(300);
      const back = await run(`${as}.open`);
      check("альбомы: день поездки — свой альбом, стрелка назад — в поездку", day.open === "Варшава" && day.cells === 1 && day.back === "К поездке: Испания" && back === "Испания",
        JSON.stringify({ day, back }));

      // видео и живые фото: r.jpg + r.mov — одна клетка LIVE, v.mp4 — своя клетка ▶; в галерее ролик играет
      // с кнопками плеера, живое фото — ролик поверх снимка без кнопок
      await run(`document.querySelector('[data-panel="albums"] .pb-btn').click(); true`);
      await sleep(300);
      await run(`[...document.querySelectorAll(".al-row")].find((r) => r.textContent.startsWith("Рига")).click(); true`);
      for (let i = 0; i < 20 && !(await run(`[...document.querySelectorAll(".al-cell img")].every((i) => i.src)`)); i++) await sleep(500);
      // снимки по дням (Грегори 2026-11-04): у ролика дата из файла — «1 января 2024», у снимка без даты — «Без даты», последним
      const riga = await run(`({ facts: document.querySelector(".al-facts").textContent, cells: [...document.querySelectorAll(".al-cell")].map((c) => [c.title, c.querySelector(".al-badge")?.textContent || "", !!c.querySelector("img").src]),
        days: [...document.querySelectorAll(".al-day")].map((d) => d.textContent) })`);
      check("альбомы: живое фото — одна клетка LIVE, ролик — своя клетка ▶ с кадром", riga.cells.length === 2 && riga.cells[1][1] === "LIVE" && riga.cells[0][1] === "▶"
        && riga.cells.every((c) => c[2]) && /^1 фото · 1 видео/.test(riga.facts), JSON.stringify(riga));
      check("альбомы: дата ролика — из самого файла; снимки по дням", /^01\.01\.2024 · v\.mp4$/.test(riga.cells[0]?.[0])
        && riga.days.length === 2 && /1 января 2024/.test(riga.days[0]) && /^Без даты1$/.test(riga.days[1]), JSON.stringify(riga));
      // рассказ альбома (текстовый файл в папке): кнопка «Рассказ» активна, подпись — в клетке снимка
      const rs = await run(`({ on: !document.querySelector(".al-story")?.disabled, cap: [...document.querySelectorAll(".al-cell")].map((c) => c.title).find((t) => /r\.jpg$/.test(t)) })`);
      check("альбомы: рассказ из текстового файла — кнопка «Рассказ», подпись у снимка", rs.on && /^Вид на старый город · /.test(rs.cap || ""), JSON.stringify(rs));
      await run(`document.querySelector(".al-day").click(); true`);
      const shut = await run(`({ hidden: document.querySelector(".al-grid").hidden, cells: [...document.querySelectorAll(".al-grid:not([hidden]) .al-cell")].length })`);
      await run(`document.querySelector(".al-day").click(); true`);
      check("альбомы: щелчок по дню сворачивает его", shut.hidden && shut.cells === 1, JSON.stringify(shut));
      const cxy = await run(`(() => { const r = [...document.querySelectorAll(".al-cell")].find((c) => c.querySelector(".al-badge")?.textContent === "▶").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      for (const n of [1, 2]) for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: cxy[0], y: cxy[1], button: "left", clickCount: n });
      let gt = null;
      for (let i = 0; i < 20 && !gt; i++) { await sleep(300); gt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => /gallery\.html/.test(t.url)); }
      if (!gt) check("галерея: окно открылось", false);
      else {
        const gws = new WebSocket(gt.webSocketDebuggerUrl);
        await new Promise((r) => (gws.onopen = r));
        let gid = 0;
        const gpend = new Map();
        gws.onmessage = (m) => { const d = JSON.parse(m.data); if (gpend.has(d.id)) { gpend.get(d.id)(d.result); gpend.delete(d.id); } };
        const grun = (expr) => new Promise((r) => { const id = ++gid; gpend.set(id, r); gws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } })); })
          .then((r) => r.result?.value);
        const gst = `(() => { const v = document.querySelector(".clip"); return { meta: document.querySelector(".meta").textContent, photo: !document.querySelector(".photo").hidden,
          clip: !v.hidden, controls: v.controls, t: v.currentTime, w: v.videoWidth, op: v.style.opacity, live: !document.querySelector(".live-btn").hidden,
          badges: [...document.querySelectorAll(".thumb-badge")].map((b) => b.textContent) }; })()`;
        await sleep(2000);
        const gv = await grun(gst);
        const gs = await grun(`({ btn: !document.querySelector(".story-btn").disabled, h2: document.querySelector(".story h2")?.textContent, p: document.querySelector(".story p")?.textContent,
          stops: document.querySelectorAll(".story-stop").length, sub: document.querySelector(".subtitle").textContent })`);
        check("галерея: рассказ альбома — кнопка активна, название, абзац, снимок с подписью; у ролика подписи нет",
          gs.btn && gs.h2 === "Прогулка по Риге" && /Домский собор/.test(gs.p || "") && gs.stops === 1 && gs.sub === "", JSON.stringify(gs));
        check("галерея: ролик играет с кнопками плеера", gv.clip && gv.controls && !gv.photo && gv.w > 0 && gv.t > 0 && !gv.live && JSON.stringify(gv.badges) === '["LIVE","▶"]', JSON.stringify(gv));
        await grun(`document.querySelector(".thumb").click(); true`);
        await sleep(400);
        const gl = await grun(gst);
        const gc = await grun(`({ sub: document.querySelector(".subtitle").textContent, cur: !!document.querySelector(".story-stop.current") })`);
        check("галерея: у снимка — подпись из рассказа внизу, в рассказе он отмечен", gc.sub === "Вид на старый город" && gc.cur, JSON.stringify(gc));
        await sleep(2500);
        const gl2 = await grun(gst);
        check("галерея: живое фото — снимок, ролик поверх без кнопок, в конце снова снимок",
          gl.live && gl.photo && gl.clip && !gl.controls && gl.op === "1" && gl2.op === "0" && gl2.photo, JSON.stringify({ gl, gl2 }));
        await grun(`window.close(); true`);
        gws.close();
        // слайд-шоу (как в Albom): кнопка в альбоме — показ сразу, по кругу, живое фото и ролик доигрывают, музыка из «Music»
        // настоящим щелчком мыши — окно из скрипта браузер не откроет
        const pxy = await run(`(() => { const r = [...document.querySelectorAll('[data-panel="albums"] .pb-btn')].find((b) => b.title === "Слайд-шоу альбома").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
        for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: pxy[0], y: pxy[1], button: "left", clickCount: 1 });
        let st = null;
        for (let i = 0; i < 20 && !st; i++) { await sleep(300); st = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => /gallery\.html\?.*play=1/.test(t.url)); }
        if (!st) check("слайд-шоу: окно открылось", false);
        else {
          const sws = new WebSocket(st.webSocketDebuggerUrl);
          await new Promise((r) => (sws.onopen = r));
          let sid = 0;
          const spend = new Map();
          sws.onmessage = (m) => { const d = JSON.parse(m.data); if (spend.has(d.id)) { spend.get(d.id)(d.result); spend.delete(d.id); } };
          // шаг галереи, не ответивший за 2 минуты, — ошибка «шаг завис», как у run (2026-11-17: полный прогон
          // провисел ночь на «Фоне» — нейросеть в браузере без экрана)
          const srun = (expr) => Promise.race([new Promise((r) => { const id = ++sid; spend.set(id, r); sws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } })); }),
            sleep(120000).then(() => { throw new Error("шаг завис: " + expr.replace(/\s+/g, " ").slice(0, 160)); })])
            .then((r) => r.result?.value);
          // «Сохранить» и «Оригинал» не выходят из правки — она открывается снова с записанным снимком;
          // дождаться этого и выйти, как рукой
          const afterSave = async (n) => {
            let stayed = false;
            for (let i = 0; i < n && !(stayed = await srun(`galleryEditor.state().open && /Сохранено|как до правки/.test(galleryEditor.state().note) && !document.body.classList.contains("busy")`)); i++) await sleep(300);
            await srun(`document.querySelector(".edit-btn").click(); true`);
            for (let i = 0; i < 20 && (await srun(`galleryEditor.state().open`)); i++) await sleep(300);
            return stayed;
          };
          const ss = `({ count: document.querySelector(".count").textContent, on: document.querySelector(".play-btn").classList.contains("on"),
            full: !!document.querySelector(".full-btn svg"), music: !!document.querySelector(".music").getAttribute("src"),
            btns: [...document.querySelectorAll(".player .player-btn")].filter((b) => !b.hidden && b.querySelector("svg")).map((b) => b.className.split(" ")[1]).join(" ") })`;
          const seen = new Set();
          let s0 = null;
          for (let i = 0; i < 24; i++) { await sleep(500); const v = await srun(ss); s0 ||= v; if (v) seen.add(v.count); }
          const s1 = await srun(ss);
          await new Promise((r) => { const id = ++sid; spend.set(id, (res) => { fs.writeFileSync(path.join(OUT, "00-slideshow.png"), Buffer.from(res.data, "base64")); r(); });
            sws.send(JSON.stringify({ id, method: "Page.captureScreenshot", params: { format: "png" } })); });
          await srun(`document.querySelector(".play-btn").click(); true`);
          const s2 = await srun(ss);
          // описание снимка — за кнопкой ⓘ: спрятано, щелчок показывает, следующий снимок — снова спрятано
          const info = await srun(`(async () => { const vis = () => getComputedStyle(document.querySelector(".caption")).visibility === "visible";
            const a = vis(); document.querySelector(".info-btn").click(); const b = vis();
            document.querySelector(".thumb:not(.active)").click(); await new Promise((r) => setTimeout(r, 200)); return { a, b, c: vis() }; })()`);
          check("галерея: описание снимка — за кнопкой ⓘ", info && !info.a && info.b && !info.c, JSON.stringify(info));
          check("слайд-шоу: «Слайд-шоу альбома» — показ сразу, плеер (во весь экран, назад, дальше, стоп, плей), по кругу через живое фото и ролик, музыка из «Music», кнопка останавливает",
            s0?.on && s1.on && s1.full && s1.btns === "full-btn back-btn fwd-btn stop-btn play-btn" && seen.has("1 / 2") && seen.has("2 / 2") && s1.music && !s2.on, JSON.stringify({ s0, s1, s2, seen: [...seen] }));
          // правка снимка (tools/editor.js): r.jpg своей папки — карандаш активен; поворот на 3° —
          // «Сохранить»: исходник в «[Originals]», снимок переписан (обрезан по рамке), копия в «…-Albom»
          // поездки; «Оригинал» — снимок как был, копии убраны
          await srun(`(async () => { window.confirm = () => true; const t = [...document.querySelectorAll(".thumb")].findIndex((b) => b.title === "Рига"); return true; })()`);
          await srun(`(() => { const i = [...document.querySelectorAll(".thumb")].findIndex((b, k) => k === 0); document.querySelectorAll(".thumb")[i].click(); return true; })()`);
          await sleep(600);
          const e0 = await srun(`({ enabled: !document.querySelector(".edit-btn").disabled, meta: document.querySelector(".meta").textContent })`);
          await srun(`document.querySelector(".edit-btn").click(); true`);
          for (let i = 0; i < 20 && !(await srun(`window.galleryEditor?.state().open`)); i++) await sleep(300);
          const e1 = await srun(`({ ...galleryEditor.state(), bar: !document.querySelector(".edit-bar").hidden, tools: [...document.querySelectorAll(".edit-tool")].filter((b) => !b.closest(".edit-info, .edit-3d-row")).length,
            save: document.querySelector(".edit-save").disabled, nav: getComputedStyle(document.querySelector(".nav")).pointerEvents })`);
          // «Горизонт» (OpenCV, грузится по нажатию): линия на выдуманном снимке завалена на 2° — угол −2°
          await srun(`[...document.querySelectorAll(".edit-tool")].find((b) => b.title === "Выровнять по горизонту").click(); true`);
          for (let i = 0; i < 60 && !/Горизонт выровнен|не нашлось|другое|интернет|запустилась/.test(await srun(`galleryEditor.state().note`)); i++) await sleep(500);
          const hz = await srun(`galleryEditor.state()`);
          check("правка: «Горизонт» — угол по линии горизонта", Math.abs(hz.angle + 2) <= 0.6 && /Горизонт выровнен/.test(hz.note), JSON.stringify(hz));
          await srun(`(() => { const s = document.querySelector(".edit-angle input"); s.value = 3; s.dispatchEvent(new Event("input")); return true; })()`);
          const e2 = await srun(`({ ...galleryEditor.state(), save: document.querySelector(".edit-save").disabled, label: document.querySelector(".edit-angle-value").textContent })`);
          await new Promise((r) => { const id = ++sid; spend.set(id, (res) => { fs.writeFileSync(path.join(OUT, "00-edit.png"), Buffer.from(res.data, "base64")); r(); });
            sws.send(JSON.stringify({ id, method: "Page.captureScreenshot", params: { format: "png" } })); });
          await srun(`document.querySelector(".edit-save").click(); true`);
          const stayed = await afterSave(30);
          check("правка: после «Сохранить» правка не закрывается — снова открыта с записанным снимком", stayed);
          const fsState = `(async () => { const root = atlasGalleryRoots()[0], riga = root.items.find((i) => i.name === "20240101 Рига");
            const img = riga.items.find((i) => i.name === "r.jpg"), bmp = await createImageBitmap(img.data);
            return { size: [bmp.width, bmp.height], orig: !!riga.items.find((i) => i.name === "[Originals]")?.items.find((i) => i.name === "r.jpg"),
              fav: riga.items.find((i) => /-Albom$/.test(i.name))?.items.map((i) => i.name) || null }; })()`;
          const saved = await run(fsState);
          check("правка: карандаш у своего снимка, поворот на 3° — сохранено: исходник в «[Originals]», снимок обрезан по рамке, копия в «…-Albom»",
            e0.enabled && e1.open && e1.bar && e1.tools === 18 && e1.save && e1.nav === "none" && e2.dirty && !e2.save && e2.label === "3,0°"
            && saved.orig && saved.size[0] < 400 && saved.size[0] > 340 && JSON.stringify(saved.fav) === '["r.jpg"]', JSON.stringify({ e0, e1, e2, saved }));
          await srun(`document.querySelector(".edit-btn").click(); true`);
          for (let i = 0; i < 20 && !(await srun(`galleryEditor.state().open`)); i++) await sleep(300);
          const e3 = await srun(`({ ...galleryEditor.state(), restore: document.querySelector(".edit-restore").disabled })`);
          await srun(`document.querySelector(".edit-restore").click(); true`);
          await afterSave(30);
          const back = await run(fsState);
          await sleep(500);
          back.shown = await srun(`document.querySelector(".stage img").naturalWidth`);
          check("правка: «Оригинал» — снимок как был и виден в галерее, «[Originals]» и копия в «…-Albom» убраны", e3.hasOriginal && !e3.restore
            && back.size[0] === 400 && back.shown === 400 && !back.orig && JSON.stringify(back.fav) === "[]", JSON.stringify({ e3, back }));
          // рамка кадрирования: «Кадр» → «1:1» — квадрат во всю высоту; уголок тянется (мышью), рамка
          // двигается и упирается в край снимка; «Сохранить» — квадратный снимок
          const gsend = (method, params) => new Promise((r) => { const id = ++sid; spend.set(id, r); sws.send(JSON.stringify({ id, method, params })); });
          const mouse = async (from, to) => {
            await gsend("Input.dispatchMouseEvent", { type: "mouseMoved", x: from[0], y: from[1] });
            await gsend("Input.dispatchMouseEvent", { type: "mousePressed", x: from[0], y: from[1], button: "left", clickCount: 1 });
            for (let k = 1; k <= 5; k++) await gsend("Input.dispatchMouseEvent", { type: "mouseMoved", x: from[0] + ((to[0] - from[0]) * k) / 5, y: from[1] + ((to[1] - from[1]) * k) / 5, button: "left", buttons: 1 });
            await gsend("Input.dispatchMouseEvent", { type: "mouseReleased", x: to[0], y: to[1], button: "left", clickCount: 1 });
          };
          await srun(`document.querySelector(".edit-btn").click(); true`);
          for (let i = 0; i < 20 && !(await srun(`galleryEditor.state().open`)); i++) await sleep(300);
          await srun(`[...document.querySelectorAll(".edit-tool")].find((b) => /^Кадрировать/.test(b.title)).click(); true`);
          await srun(`[...document.querySelectorAll(".edit-chip")].find((b) => b.textContent === "1:1").click(); true`);
          await sleep(200);
          const c1 = await srun(`galleryEditor.state()`);
          const k1 = await srun(`galleryEditor.toScreen(150, 150)`), k2 = await srun(`galleryEditor.toScreen(100, 100)`);
          await mouse(k1, k2);
          const c2 = await srun(`galleryEditor.state()`);
          const m1 = await srun(`galleryEditor.toScreen(0, 0)`), m2 = await srun(`galleryEditor.toScreen(300, 0)`);
          await mouse(m1, m2);
          const c3 = await srun(`galleryEditor.state()`);
          await gsend("Page.captureScreenshot", { format: "png" }).then((res) => fs.writeFileSync(path.join(OUT, "00-crop.png"), Buffer.from(res.data, "base64")));
          check("правка: рамка «1:1» — квадрат, уголок тянется, рамка упирается в край снимка",
            c1.cropOn && c1.aspect === "1:1" && c1.crop.w === 300 && c1.crop.h === 300 && c1.dirty
            && Math.abs(c2.crop.w - 250) <= 3 && c2.crop.w === c2.crop.h && c2.fits
            && Math.abs(c3.crop.x + c3.crop.w - 200) <= 1 && c3.fits, JSON.stringify({ c1, c2, c3 }));
          await srun(`document.querySelector(".edit-save").click(); true`);
          await afterSave(30);
          const sq = await run(fsState);
          check("правка: сохранён кадр по рамке", Math.abs(sq.size[0] - c3.crop.w) <= 2 && sq.size[0] === sq.size[1] && sq.orig, JSON.stringify(sq));
          // перспектива: ручки по углам; левый верхний угол — вправо: снимок искажён, рамка внутри;
          // поворот на 90° и зеркало несут перспективу с собой (зеркало — слева направо); сохранение — точный расчёт
          await srun(`document.querySelector(".edit-btn").click(); true`);
          for (let i = 0; i < 20 && !(await srun(`galleryEditor.state().open`)); i++) await sleep(300);
          await srun(`[...document.querySelectorAll(".edit-tool")].find((b) => /^Перспектива — тяните/.test(b.title)).click(); true`);
          // угол — где он на экране после перерисовки; окно галереи в общей проверке отвечает не сразу — до трёх попыток
          for (let t = 0; t < 3 && !(await srun(`galleryEditor.state().warped`)); t++) {
            await sleep(300);
            const pc = await srun(`galleryEditor.cornerOnScreen(0)`);
            await mouse(pc, [pc[0] + 50, pc[1]]);
          }
          const p1 = await srun(`galleryEditor.state()`);
          const p2 = await srun(`(() => { const a = galleryEditor.api; a.turn(1); a.mirror(); const s1 = galleryEditor.state(); a.mirror(); a.turn(-1); return { s1, s2: galleryEditor.state() }; })()`);
          await gsend("Page.captureScreenshot", { format: "png" }).then((res) => fs.writeFileSync(path.join(OUT, "00-perspective.png"), Buffer.from(res.data, "base64")));
          check("правка: перспектива — угол тянется, снимок искажён, рамка внутри; поворот и зеркало несут её с собой",
            p1.persp && p1.warped && p1.quad[0][0] > -125 + 20 && p1.fits && p1.dirty && p2.s1.q === 3 && p2.s1.flip && p2.s1.warped && p2.s1.fits
            && p2.s2.q === 0 && !p2.s2.flip && JSON.stringify(p2.s2.quad) === JSON.stringify(p1.quad), JSON.stringify({ p1, p2 }));
          // рамка — самая большая на искажённом снимке: на 3 % больше не влезает нигде рядом, а по-старому
          // (вокруг середины четырёхугольника) выходила меньше
          const bg = await srun(`(() => { const s = galleryEditor.state(), c = s.crop, f = galleryEditor.fitsBox, k = 1.03;
            const cx = s.quad.reduce((a, p) => a + p[0], 0) / 4, cy = s.quad.reduce((a, p) => a + p[1], 0) / 4, r = c.w / c.h;
            let lo = 0, hi = 2000; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (f({ x: cx - m * r / 2, y: cy - m / 2, w: m * r, h: m })) lo = m; else hi = m; }
            let bigger = false; for (let dx = -40; dx <= 40; dx += 4) for (let dy = -40; dy <= 40; dy += 4)
              if (f({ x: c.x + dx - c.w * (k - 1) / 2, y: c.y + dy - c.h * (k - 1) / 2, w: c.w * k, h: c.h * k })) bigger = true;
            return { h: c.h, old: Math.round(lo * 10) / 10, bigger }; })()`);
          check("правка: рамка на искажённом снимке — самая большая, больше прежней (вокруг середины)", !bg.bigger && bg.h > bg.old + 1, JSON.stringify(bg));
          await srun(`document.querySelector(".edit-save").click(); true`);
          await afterSave(40);
          const ps = await run(fsState);
          check("правка: перспектива сохранена — кадр по рамке", Math.abs(ps.size[0] - p2.s2.crop.w) <= 2 && Math.abs(ps.size[1] - p2.s2.crop.h) <= 2, JSON.stringify({ ps, crop: p2.s2.crop }));
          // «Назад» (и Ctrl+Z) — по шагу; «Сбросить правку» активна с первой правки — снимок как при открытии;
          // колесо — масштаб снимка вокруг мыши, Ctrl+колесо не масштабирует страницу, двойной щелчок — вписан
          await srun(`document.querySelector(".edit-btn").click(); true`);
          for (let i = 0; i < 20 && !(await srun(`galleryEditor.state().open`)); i++) await sleep(300);
          const angle = (v) => srun(`(() => { const s = document.querySelector(".edit-angle input"); s.value = ${v}; s.dispatchEvent(new Event("input")); return true; })()`);
          const btns = `({ ...galleryEditor.state(), undo: !document.querySelector(".edit-end .edit-tool").disabled, reset: !document.querySelector(".edit-restore").disabled, resetTitle: document.querySelector(".edit-restore").title })`;
          const u0 = await srun(btns);
          await angle(5);
          const u1 = await srun(btns);
          await sleep(800);
          await angle(8);
          await sleep(800);
          await srun(`document.querySelector(".edit-end .edit-tool").click(); true`);
          const u2 = await srun(btns);
          await srun(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })); true`);
          const u3 = await srun(btns);
          await angle(8);
          await srun(`document.querySelector(".edit-restore").click(); true`);
          const u4 = await srun(btns);
          check("правка: «Назад» — по шагу (и Ctrl+Z), «Сбросить правку» — активна с первой правки, снимок как при открытии",
            !u0.undo && /^Вернуть/.test(u0.resetTitle) && u1.undo && u1.reset && /^Сбросить правку/.test(u1.resetTitle) && u2.angle === 5 && u3.angle === 0 && u4.angle === 0 && !u4.dirty && u4.undo,
            JSON.stringify({ u0, u1, u2, u3, u4 }));
          const cv = await srun(`(() => { const b = document.querySelector(".edit-canvas").getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 3]; })()`);
          await gsend("Input.dispatchMouseEvent", { type: "mouseWheel", x: cv[0], y: cv[1], deltaX: 0, deltaY: -400 });
          await sleep(200);
          const z1 = await srun(`galleryEditor.state().zoom`);
          const ctrl = await srun(`(() => { const e = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; })()`);
          await gsend("Input.dispatchMouseEvent", { type: "mousePressed", x: cv[0], y: cv[1], button: "left", clickCount: 2 });
          await gsend("Input.dispatchMouseEvent", { type: "mouseReleased", x: cv[0], y: cv[1], button: "left", clickCount: 2 });
          await sleep(200);
          const z2 = await srun(`galleryEditor.state().zoom`);
          check("правка: колесо — масштаб снимка, Ctrl+колесо страницу не масштабирует, двойной щелчок — вписан", z1 > 1.3 && ctrl && z2 === 1, JSON.stringify({ z1, ctrl, z2 }));
          // рамка, тронутая рукой (вдвое меньше самой большой), едет за перспективой: угол снимка вернули —
          // рамка выросла вместе со снимком (раньше оставалась прежней). «×2» — подсказка с размерами
          const fl = await srun(`(() => { const a = galleryEditor.api, e = a.state; a.crop(true);
            const b = e.crop; e.touched = true; e.crop = { x: b.x, y: b.y, w: b.w / 2, h: b.h / 2 };
            e.quad = e.quad.map((c, i) => (i === 0 ? [c[0] + 60, c[1] + 40] : c)); e.crop = { ...e.crop };
            const h0 = e.crop.h; a.resetQuad(); const h1 = e.crop.h, big = b.h; a.crop(false); return { h0, h1, big, fits: galleryEditor.state().fits }; })()`);
          await srun(`[...document.querySelectorAll(".edit-tool")].find((b) => b.title.startsWith("Увеличить ×2")).click(); true`);
          const x2 = await srun(`galleryEditor.state().note`);
          check("правка: рамка, тронутая рукой, едет и растёт вместе с перспективой; «×2» — подсказка с размерами",
            fl.h1 > fl.h0 * 1.05 && fl.fits && /×2 включено.*\d+ × \d+ → \d+ × \d+/.test(x2), JSON.stringify({ fl, x2 }));
          await srun(`document.querySelector(".edit-end .edit-tool[title='Выйти из правки (Esc)']").click(); true`);
          await sleep(300);
          // шум и цвет: плитки вариантов с маленьким снимком; «Лёгкое» и «Ч/Б» — превью с обработкой, сохранено серым
          await srun(`document.querySelector(".edit-btn").click(); true`);
          for (let i = 0; i < 20 && !(await srun(`galleryEditor.state().open`)); i++) await sleep(300);
          const tool = (t) => srun(`[...document.querySelectorAll(".edit-tool")].find((b) => b.title === ${JSON.stringify(t)}).click(); true`);
          const tile = (t) => srun(`[...document.querySelectorAll(".edit-tiles:not([hidden]) .edit-tile")].find((b) => b.title === ${JSON.stringify(t)}).click(); true`);
          await tool("Шумоподавление");
          for (let i = 0; i < 40 && (await srun(`document.querySelectorAll(".edit-tiles:not([hidden]) .edit-tile canvas").length`)) < 4; i++) await sleep(300);
          const nt = await srun(`({ tiles: [...document.querySelectorAll(".edit-tiles:not([hidden]) .edit-tile")].map((b) => b.title), drawn: document.querySelectorAll(".edit-tiles:not([hidden]) canvas").length })`);
          await tile("Лёгкое");
          for (let i = 0; i < 40 && !(await srun(`galleryEditor.state().shown`)); i++) await sleep(300);
          await tool("Цвет");
          for (let i = 0; i < 40 && (await srun(`document.querySelectorAll(".edit-tiles:not([hidden]) .edit-tile canvas").length`)) < 5; i++) await sleep(300);
          await tile("Ч/Б");
          for (let i = 0; i < 40 && (await srun(`galleryEditor.state().values.color !== "bw" || document.body.classList.contains("busy")`)); i++) await sleep(300);
          const cs = await srun(`({ ...galleryEditor.state(), tiles: [...document.querySelectorAll(".edit-tiles:not([hidden]) .edit-tile")].map((b) => b.title) })`);
          await gsend("Page.captureScreenshot", { format: "png" }).then((res) => fs.writeFileSync(path.join(OUT, "00-color.png"), Buffer.from(res.data, "base64")));
          check("правка: шум и цвет — плитки с вариантами, «Лёгкое» и «Ч/Б» на превью",
            JSON.stringify(nt.tiles) === '["Выкл","Лёгкое","Среднее","Сильное"]' && nt.drawn === 4 && cs.values.noise === "light" && cs.values.color === "bw" && cs.shown && cs.dirty
            && JSON.stringify(cs.tiles) === '["Оригинал","Авто","Контраст+","Ч/Б","Тепло"]', JSON.stringify({ nt, cs }));
          await srun(`document.querySelector(".edit-save").click(); true`);
          await afterSave(60);
          const gray = await run(`(async () => { const riga = atlasGalleryRoots()[0].items.find((i) => i.name === "20240101 Рига"), f = riga.items.find((i) => i.name === "r.jpg");
            const b = await createImageBitmap(f.data), c = Object.assign(document.createElement("canvas"), { width: b.width, height: b.height }), x = c.getContext("2d"); x.drawImage(b, 0, 0);
            const pts = [[0.5, 0.25], [0.5, 0.75]].map(([u, v]) => [...x.getImageData(Math.floor(b.width * u), Math.floor(b.height * v), 1, 1).data.slice(0, 3)]);
            return { pts, gray: pts.every(([r, g, bl]) => Math.abs(r - g) <= 6 && Math.abs(g - bl) <= 6) }; })()`);
          check("правка: шум и цвет сохранены — снимок серый", gray.gray, JSON.stringify(gray));
          // у ролика правки нет — карандаш виден, но неактивен
          await srun(`document.querySelectorAll(".thumb")[1].click(); true`);
          await sleep(500);
          check("правка: у ролика карандаш неактивен", await srun(`document.querySelector(".edit-btn").disabled && document.querySelector(".edit-btn").title === "Ролики не правятся"`));
          // ИИ: «Фон» (RMBG-1.4) — плитки вариантов с маской нейросети; «Прозрачный» у JPEG — PNG рядом, снимок
          // не тронут. «3D-параллакс» (Depth Anything V2) — холст WebGL поверх снимка, ролик — рядом. Модели —
          // с CDN (≈ 70 МБ в первый раз); без сети — предупреждение, не ошибка
          const riga = `atlasGalleryRoots()[0].items.find((i) => i.name === "20240101 Рига")`;
          await srun(`document.querySelectorAll(".thumb")[0].click(); true`);
          await sleep(500);
          const before = await run(`(async () => [...new Uint8Array(await ${riga}.items.find((i) => i.name === "r.jpg").data.arrayBuffer())].join())()`);
          await srun(`document.querySelector(".edit-btn").click(); true`);
          for (let i = 0; i < 20 && !(await srun(`galleryEditor.state().open`)); i++) await sleep(300);
          await tool("Фон — нейросеть отделяет главное: размыть, заменить, убрать");
          for (let i = 0; i < 300 && (await srun(`document.querySelectorAll(".edit-tiles:not([hidden]) .edit-tile canvas").length`)) < 6
            && !/интернет/.test(await srun(`galleryEditor.state().note`)); i++) await sleep(500);
          const bt = await srun(`({ tiles: [...document.querySelectorAll(".edit-tiles:not([hidden]) .edit-tile")].map((b) => b.title), drawn: document.querySelectorAll(".edit-tiles:not([hidden]) canvas").length, note: galleryEditor.state().note })`);
          if (/интернет/.test(bt.note)) console.log("  ! ИИ: нейросеть не загрузилась (нет сети) — не проверено");
          else {
            await tile("Размыть");
            for (let i = 0; i < 60 && (await srun(`galleryEditor.state().values.bg !== "blur" || document.body.classList.contains("busy")`)); i++) await sleep(300);
            const bs = await srun(`galleryEditor.state()`);
            await gsend("Page.captureScreenshot", { format: "png" }).then((res) => fs.writeFileSync(path.join(OUT, "00-background.png"), Buffer.from(res.data, "base64")));
            await tile("Прозрачный");
            for (let i = 0; i < 60 && (await srun(`galleryEditor.state().values.bg !== "cut" || document.body.classList.contains("busy")`)); i++) await sleep(300);
            await srun(`document.querySelector(".edit-save").click(); true`);
            await afterSave(60);
            const cut = await run(`(async () => { const f = ${riga}.items.find((i) => i.name === "r без фона.png"), b = f && await createImageBitmap(f.data);
              const same = [...new Uint8Array(await ${riga}.items.find((i) => i.name === "r.jpg").data.arrayBuffer())].join() === ${JSON.stringify(before)};
              const r = { png: !!f, type: f && (await f.getFile()).type, size: b && [b.width, b.height], same };
              ${riga}.items.splice(${riga}.items.indexOf(f), 1); return r; })()`);
            check("ИИ: «Фон» — шесть плиток с маской нейросети, «Размыть» на превью; «Прозрачный» — PNG рядом, снимок не тронут",
              JSON.stringify(bt.tiles) === '["Как есть","Размыть","Белый","Чёрный","Ч/Б фон","Прозрачный"]' && bt.drawn === 6 && bs.shown && bs.dirty
              && cut.png && cut.same && cut.size?.[0] > 100, JSON.stringify({ bt, bs: { values: bs.values, shown: bs.shown, note: bs.note }, cut }));
            // 3D: кадр с глубиной на холсте WebGL, «Качели», запись ролика рядом
            await srun(`document.querySelector(".edit-btn").click(); true`);
            for (let i = 0; i < 20 && !(await srun(`galleryEditor.state().open`)); i++) await sleep(300);
            await tool("3D-параллакс — снимок оживает (нейросеть: глубина)");
            for (let i = 0; i < 300 && (await srun(`document.querySelector(".edit-3d").hidden`)) && !/не получилось/.test(await srun(`galleryEditor.state().note`)); i++) await sleep(500);
            await tool("Качели");
            await sleep(700);
            const d3 = await srun(`(() => { const v = document.querySelector(".edit-3d"), c = Object.assign(document.createElement("canvas"), { width: 8, height: 8 }), x = c.getContext("2d");
              x.drawImage(v, 0, 0, 8, 8); const px = x.getImageData(0, 0, 8, 8).data; let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
              return { shown: !v.hidden, size: [v.width, v.height], lit: sum > 0, sway: [...document.querySelectorAll(".edit-3d-row .edit-tool")].find((b) => b.title === "Качели").classList.contains("on"),
                rec: !document.querySelector(".edit-3d-rec").disabled, note: galleryEditor.state().note }; })()`);
            await gsend("Page.captureScreenshot", { format: "png" }).then((res) => fs.writeFileSync(path.join(OUT, "00-3d.png"), Buffer.from(res.data, "base64")));
            await srun(`document.querySelector(".edit-3d-rec").click(); true`);
            for (let i = 0; i < 60 && !/Ролик (сохранён|не записался)/.test(await srun(`galleryEditor.state().note`)); i++) await sleep(500);
            const clip3 = await run(`(() => { const f = ${riga}.items.find((i) => / 3D[.](mp4|webm)$/.test(i.name)), r = f && { name: f.name, size: f.data.size };
              if (f) ${riga}.items.splice(${riga}.items.indexOf(f), 1); return r || null; })()`);
            const n3 = await srun(`galleryEditor.state().note`);
            await srun(`document.querySelector(".edit-end .edit-tool[title='Выйти из правки (Esc)']").click(); true`);
            await sleep(300);
            check("ИИ: «3D-параллакс» — глубина нейросети, снимок движется на холсте WebGL, ролик 8 с — рядом со снимком",
              d3.shown && d3.lit && d3.size[0] % 2 === 0 && d3.size[1] % 2 === 0 && d3.sway && d3.rec && clip3?.size > 1000 && /^r 3D[.](mp4|webm)$/.test(clip3.name) && /Ролик сохранён/.test(n3),
              JSON.stringify({ d3, clip3, n3 }));
          }
          // сведения о снимке (tools/info.js): дата, камера, место правятся — «Сохранить» пишет только EXIF,
          // сжатые точки те же; поля после этого показывают записанное; «Место» не разобрать — красная рамка
          await srun(`document.querySelectorAll(".thumb")[0].click(); true`);
          await sleep(500);
          const rigaFile = `atlasGalleryRoots()[0].items.find((i) => i.name === "20240101 Рига").items.find((i) => i.name === "r.jpg").data`;
          const scan = (b) => `(async () => { const u = [...new Uint8Array(await ${b}.arrayBuffer())]; return u.slice(u.findIndex((x, i) => x === 0xff && u[i + 1] === 0xda)).join(); })()`;
          const tail0 = await run(scan(rigaFile));
          await srun(`document.querySelector(".edit-btn").click(); true`);
          for (let i = 0; i < 20 && !(await srun(`galleryEditor.state().open`)); i++) await sleep(300);
          await tool("Сведения о снимке — дата, камера, место; в Избранное, удалить");
          for (let i = 0; i < 20 && !(await srun(`/r\\.jpg · .* · \\d+ × \\d+/.test(document.querySelector(".edit-info-file").textContent)`)); i++) await sleep(300);
          const typeIn = (n, v) => srun(`(() => { const i = document.querySelectorAll(".edit-info input")[${n}]; i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event("input")); return true; })()`);
          await typeIn(2, "где-то");
          const bad = await srun(`document.querySelectorAll(".edit-info input")[2].classList.contains("bad")`);
          await typeIn(0, "2022-03-04T05:06:07");
          await typeIn(1, "Тест Камера");
          await typeIn(2, "59,437 24,7536");
          const mi = await srun(`({ ...galleryEditor.state(), row: !document.querySelector(".edit-info").hidden, head: document.querySelector(".edit-info-file").textContent,
            bad: document.querySelectorAll(".edit-info input")[2].classList.contains("bad"), save: document.querySelector(".edit-save").disabled })`);
          await gsend("Page.captureScreenshot", { format: "png" }).then((res) => fs.writeFileSync(path.join(OUT, "00-info.png"), Buffer.from(res.data, "base64")));
          await srun(`document.querySelector(".edit-save").click(); true`);
          await afterSave(30);
          const ms = await run(`(async () => { const { readMeta } = await import("./tools/jpeg.js"); const b = ${rigaFile};
            return { meta: await readMeta(b), size: b.size }; })()`);
          ms.tail = (await run(scan(rigaFile))) === tail0;
          await srun(`document.querySelector(".edit-btn").click(); true`);
          for (let i = 0; i < 20 && !(await srun(`galleryEditor.state().open`)); i++) await sleep(300);
          for (let i = 0; i < 20 && !(await srun(`document.querySelectorAll(".edit-info input")[1].value`)); i++) await sleep(300);
          const mf = await srun(`[...document.querySelectorAll(".edit-info input")].map((i) => i.value)`);
          check("сведения: дата, камера, место правятся — записан только EXIF (сжатые точки те же), поля показывают записанное, неразборчивое место — красным",
            bad && !mi.bad && mi.row && /^r\.jpg · /.test(mi.head) && mi.dirty && !mi.save && mi.meta.date === "2022:03:04 05:06:07" && mi.meta.camera === "Тест Камера"
            && ms.tail && ms.meta.date === "2022:03:04 05:06:07" && ms.meta.camera === "Тест Камера" && Math.abs(ms.meta.gps?.[0] - 59.437) < 1e-5 && Math.abs(ms.meta.gps?.[1] - 24.7536) < 1e-5
            && mf[0] === "2022-03-04T05:06:07" && mf[1] === "Тест Камера" && mf[2] === "59.437000, 24.753600", JSON.stringify({ bad, mi, ms, mf }));
          // «В Избранное»: снимок там (копия от правки) — звезда жёлтая; щелчок убирает, ещё щелчок — снова там
          const favs = `(atlasGalleryRoots()[0].items.find((i) => i.name === "20240101 Рига").items.find((i) => /-Albom$/.test(i.name))?.items.map((i) => i.name) || [])`;
          const starOn = `document.querySelector(".edit-info-acts .edit-tool").classList.contains("on")`;
          const f0 = { on: await srun(starOn), fav: await run(favs) };
          await srun(`document.querySelector(".edit-info-acts .edit-tool").click(); true`);
          for (let i = 0; i < 20 && (await srun(starOn)); i++) await sleep(300);
          const f1 = { on: await srun(starOn), fav: await run(favs) };
          await srun(`document.querySelector(".edit-info-acts .edit-tool").click(); true`);
          for (let i = 0; i < 20 && !(await srun(starOn)); i++) await sleep(300);
          const f2 = { on: await srun(starOn), fav: await run(favs) };
          check("сведения: звезда — в Избранное и обратно", f0.on && f0.fav.includes("r.jpg") && !f1.on && !f1.fav.includes("r.jpg") && f2.on && f2.fav.includes("r.jpg"), JSON.stringify({ f0, f1, f2 }));
          // «Удалить»: живое фото (снимок и ролик) — в «[Удалённые]» тем же путём, из ленты галереи и из альбома
          const n0 = { thumbs: await srun(`document.querySelectorAll(".thumb").length`), photos: (await run(as)).photos };
          await srun(`document.querySelectorAll(".edit-info-acts .edit-tool")[1].click(); true`);
          for (let i = 0; i < 20 && (await srun(`document.querySelectorAll(".thumb").length`)) === n0.thumbs; i++) await sleep(300);
          const del = await run(`(() => { const root = atlasGalleryRoots()[0], names = (d) => d?.items.map((i) => i.name) || null;
            const bin = root.items.find((i) => i.name === "[Удалённые]");
            return { riga: names(root.items.find((i) => i.name === "20240101 Рига")).filter((n) => !n.startsWith("[") && !/-Albom$/.test(n)), bin: names(bin?.items.find((i) => i.name === "20240101 Рига")),
              photos: ${as}.photos }; })()`);
          const g = await srun(`({ thumbs: document.querySelectorAll(".thumb").length, open: galleryEditor.state().open })`);
          check("сведения: «Удалить» — снимок и ролик живого фото в «[Удалённые]», из галереи и альбома убран",
            JSON.stringify(del.riga) === '["v.mp4","Рига.txt"]' && JSON.stringify(del.bin?.slice().sort()) === '["r.jpg","r.mov"]' && del.photos === n0.photos - 1 && g.thumbs === n0.thumbs - 1 && !g.open, JSON.stringify({ n0, del, g }));
          // вернуть как было — для проверок дальше (папки обойдутся заново, когда галерею закроют)
          await run(`(() => { const root = atlasGalleryRoots()[0], riga = root.items.find((i) => i.name === "20240101 Рига"), bin = root.items.findIndex((i) => i.name === "[Удалённые]");
            riga.items.unshift(...root.items[bin].items[0].items); root.items.splice(bin, 1); atlasGalleryRescan(); return true; })()`);
          // ×2 (tools/upscale.js, нейросеть с CDN): полоса 300×30 — два куска по ширине → 600×60, цвет тот же
          const up = await srun(`(async () => { try { const { upscale } = await import("./tools/upscale.js");
            const c = Object.assign(document.createElement("canvas"), { width: 300, height: 30 }), x = c.getContext("2d"); x.fillStyle = "#c63"; x.fillRect(0, 0, 300, 30);
            const o = await upscale(c), px = [...o.getContext("2d").getImageData(400, 30, 1, 1).data];
            return { size: [o.width, o.height], px }; } catch (e) { return { err: e.message }; } })()`);
          if (up.err && /интернет/.test(up.err)) console.log("  ! ×2: нейросеть не загрузилась (нет сети) — не проверено");
          else check("×2: нейросеть увеличивает снимок вдвое кусками (300×30 → 600×60, цвет тот же)",
            up.size?.[0] === 600 && up.size[1] === 60 && Math.abs(up.px[0] - 0xcc) < 30 && Math.abs(up.px[1] - 0x66) < 30 && Math.abs(up.px[2] - 0x33) < 30, JSON.stringify(up));
          await srun(`window.close(); true`);
          sws.close();
          // галерея закрыта — папки обходятся заново (вернули r.jpg и r.mov)
          await sleep(1000);
          for (let i = 0; i < 40 && ((await run(`${as}.busy`)) || (await run(`${as}.photos`)) < n0.photos); i++) await sleep(500);
        }
      }
      await run(exitMode);
      await run(closeLayers);

      // повторы: вторая папка «Диск D» — копия ролика v.mp4 из «Риги» и два похожих снимка (одна секунда съёмки
      // в EXIF, второй — уменьшенный); 0–3.jpg первой папки — одинаковые файлы (8×8), копия в «Избранном» не в счёте.
      // Оставить — из альбома, где снимков больше; лишнее — в «[Повторы]» тем же путём
      await run(`(async () => { const { file, folder } = testFs;
        const shot = async (w) => {
          const c = new OffscreenCanvas(w, w * 3 / 4), x = c.getContext("2d");
          x.fillStyle = "#fa3"; x.fillRect(0, 0, w, w * 3 / 4); x.fillStyle = "#236"; x.beginPath(); x.arc(w * 0.3, w * 0.3, w * 0.2, 0, 7); x.fill(); x.fillRect(w * 0.6, w * 0.1, w * 0.3, w * 0.55);
          const b = new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg" })).arrayBuffer());
          // EXIF: IFD0 → Exif IFD → DateTimeOriginal
          const t = new Uint8Array(64), v = new DataView(t.buffer);
          t.set([0x49, 0x49, 0x2a, 0]); v.setUint32(4, 8, true);
          v.setUint16(8, 1, true); v.setUint16(10, 0x8769, true); v.setUint16(12, 4, true); v.setUint32(14, 1, true); v.setUint32(18, 26, true);
          v.setUint16(26, 1, true); v.setUint16(28, 0x9003, true); v.setUint16(30, 2, true); v.setUint32(32, 20, true); v.setUint32(36, 44, true);
          t.set(new TextEncoder().encode("2024:03:01 12:00:00"), 44);
          const app = new Uint8Array(74); app.set([0xff, 0xe1, 0, 72, 0x45, 0x78, 0x69, 0x66, 0, 0]); app.set(t, 10);
          return new Blob([b.slice(0, 2), app, b.slice(2)], { type: "image/jpeg" });
        };
        const v = atlasGalleryRoots()[0].items.find((i) => i.name === "20240101 Рига").items.find((i) => i.name === "v.mp4");
        const s1 = await shot(400), s2 = await shot(200);
        window.showDirectoryPicker = async () => folder("Диск D", [folder("20240101 Рига", [file("v.mp4", v.data)]),
          folder("20240301 Похожие", [file("s1.jpg", s1), file("s2.jpg", s2)])]);
        return true; })()`);
      const before = await run(`${as}.albums`);
      await run(gear);
      await sleep(600);
      await run(`atlas.modules().find((m) => m.id === "content/albums").pickFolder(); true`);
      for (let i = 0; i < 30 && !(await run(`${as}.albums === ${before + 2} && !${as}.busy`)); i++) await sleep(500);
      await run(gear);
      await run(openLayers("content/albums"));
      await sleep(600);
      const dupBtn = `document.querySelector('[data-panel="albums"] .panel-head .panel-btn[title="Найти дубликаты снимков"]')`;
      check("повторы: кнопка в шапке «Моих альбомов»", await run(`!!${dupBtn} && !${dupBtn}.hidden`));
      const hs = await run(`[...document.querySelectorAll('[data-panel="albums"] .panel-head svg')].filter((x) => x.getBoundingClientRect().width).map((x) => Math.round(x.getBoundingClientRect().width))`);
      check("шапка окна: значки крупные — значок окна как в строках списка, в кнопках почти во всю кнопку", hs[0] === 24 && hs.slice(1).every((w) => w === 30), JSON.stringify(hs));
      await run(`${dupBtn}.click(); true`);
      for (let i = 0; i < 40 && !(await run(`${as}.dups && !${as}.dups.busy`)); i++) await sleep(500);
      const dv = await run(`({ ...${as}.dups, title: document.querySelector('[data-panel="albums"] .panel-title').textContent,
        icon: document.querySelector('[data-panel="albums"] .panel-title path').getAttribute("d").startsWith("M18 13v7"), rows: [...document.querySelectorAll(".al-dup")].map((r) => r.children.length),
        keep: document.querySelectorAll(".al-dup-cell.keep").length, all: document.querySelector(".al-dup-all")?.textContent, where: [...document.querySelectorAll(".al-dup-where")].map((w) => w.textContent) })`);
      check("повторы: одинаковые файлы (снимки и ролик в двух папках) и похожие снимки, в каждой группе один «оставить»",
        dv.view && dv.title === "Дубликаты" && dv.icon && dv.same === 2 && dv.like === 1 && JSON.stringify(dv.rows.slice().sort()) === "[2,2,4]" && dv.keep === 3 && dv.all === "Убрать лишние копии (4)", JSON.stringify(dv));
      await sleep(800);
      await shot("99-dups");
      // в шапке — ссылки на разделы; у папок — «скопировать полный путь»: где лежит своя папка, спрашивается
      // один раз (вставили папку выше — имя дописывается), путь — с обратными косыми, как в Проводнике
      const links = await run(`(async () => { const l = [...document.querySelectorAll(".al-dup-link")]; const b = document.querySelector('[data-panel="albums"] .panel-body');
        l[1].click(); await new Promise((r) => setTimeout(r, 900));
        const head = [...document.querySelectorAll(".al-dup-title")][1].getBoundingClientRect().top - document.querySelector(".al-dup-links").getBoundingClientRect().bottom;
        return { names: l.map((x) => x.textContent), top: b.scrollTop, head }; })()`);
      const copied = await run(`(async () => { const asked = []; window.prompt = (q) => { asked.push(q); return "E:/Архив/"; };
        let got = null; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { got = t; } } });
        const btns = [...document.querySelectorAll(".al-dup-folder .pb-btn")];
        btns[0].click(); await new Promise((r) => setTimeout(r, 300)); const first = got;
        btns[1].click(); await new Promise((r) => setTimeout(r, 300));
        return { first, second: got, asked: asked.length, title: btns[0].title }; })()`);
      check("повторы: в шапке ссылки на разделы, у папок — копировать полный путь (папку на диске спрашивают один раз)",
        JSON.stringify(links.names) === '["Одинаковые (2)","Похожие (1)"]' && links.top > 0 && links.head > -30 && links.head < 400
        && copied.asked === 2 && /^E:\\Архив\\(Фото|Диск D)\\20240101 Рига$/.test(copied.first) && copied.title === "Скопировать полный путь к папке"
        && (await run(`!document.querySelector('[data-panel="albums"] .panel-head .panel-btn[title="Найти дубликаты снимков"] path').getAttribute("d").startsWith("M16 1H4")`)),
        JSON.stringify({ links, copied }));
      const tree = `const tree = (d, pre = "") => d.items.flatMap((i) => (i.kind === "directory" ? tree(i, pre + i.name + "/") : [pre + i.name]));`;
      await run(`[...document.querySelectorAll(".al-dup-cell")].find((c) => /^Диск D.*v[.]mp4/.test(c.querySelector(".al-cell").title)).querySelector(".al-dup-out").click(); true`);
      for (let i = 0; i < 20 && (await run(`${as}.dups.same`)) !== 1; i++) await sleep(300);
      const d1 = await run(`(() => { ${tree} return { d: tree(atlasGalleryRoots()[1]), same: ${as}.dups.same }; })()`);
      check("повторы: «Убрать» переносит копию в «[Повторы]» тем же путём",
        JSON.stringify(d1.d) === JSON.stringify(["20240301 Похожие/s1.jpg", "20240301 Похожие/s2.jpg", "[Повторы]/20240101 Рига/v.mp4"]) && d1.same === 1, JSON.stringify(d1));
      await run(`window.confirm = () => true; document.querySelector(".al-dup-all").click(); true`);
      for (let i = 0; i < 20 && (await run(`${as}.dups.same`)); i++) await sleep(300);
      const d2 = await run(`(() => { ${tree} const all = tree(atlasGalleryRoots()[0]); return { moved: all.filter((f) => f.startsWith("[Повторы]/")), jpgs: all.filter((f) => !f.includes("[") && /[0-9][.]jpg$/.test(f)),
        ...${as}.dups, facts: document.querySelector(".al-facts").textContent, photos: ${as}.photos }; })()`);
      const trip = "20230625-0716 (Travel) Испания";
      check("повторы: «Убрать лишние копии» — остался один снимок из альбома, где снимков больше, похожие — на месте",
        JSON.stringify(d2.moved) === JSON.stringify([`[Повторы]/${trip}/0.jpg`, `[Повторы]/${trip}/20230625 Таллин/2.jpg`, `[Повторы]/${trip}/20230626 Варшава/3.jpg`])
        && JSON.stringify(d2.jpgs) === JSON.stringify([`${trip}/20230625 Таллин/1.jpg`, `${trip}/${trip}-Albom/1.jpg`]) && d2.same === 0 && d2.like === 1 && d2.facts === "Одинаковых файлов нет",
        JSON.stringify(d2));
      await run(exitMode);
      await run(closeLayers);
      await run(gear);
      await sleep(600);
      // «Убрать папку» — крестиком в строке папки в списке альбомов (Грегори 2026-11-11), с вопросом
      await run(openLayers("content/albums"));
      for (let i = 0; i < 20 && !(await run(`!!document.querySelector(".panel:not([hidden]) .home-line")`)); i++) await sleep(300);
      const rowsBefore = await run(`[...document.querySelectorAll(".panel:not([hidden]) .home-line .tr-row-title")].map((t) => t.textContent)`);
      const xTitle = await run(`(() => { let asked = ""; window.confirm = (q) => { asked = q; return true; };
        const line = [...document.querySelectorAll(".panel:not([hidden]) .home-line")].find((l) => l.textContent.includes("Диск D"));
        const x = line.querySelector(".search-delete"); const t = x.title; x.click(); return { t, asked }; })()`);
      for (let i = 0; i < 20 && (await run(`${as}.busy || ${as}.albums !== ${before}`)); i++) await sleep(500);
      const rowsAfter = await run(`[...document.querySelectorAll(".panel:not([hidden]) .home-line .tr-row-title")].map((t) => t.textContent)`);
      check("альбомы: своя папка — строкой в списке, крестик «Убрать папку» с вопросом убирает её",
        rowsBefore.includes("Диск D") && xTitle.t === "Убрать папку «Диск D»" && /Снимки на диске останутся/.test(xTitle.asked) && !rowsAfter.includes("Диск D") && rowsAfter.length === rowsBefore.length - 1,
        JSON.stringify({ rowsBefore, xTitle, rowsAfter }));
      await run(closeLayers);
      await run(gear);
      await sleep(600);
      await run(gear);
      await sleep(600);
      await run(`atlas.modules().find((m) => m.id === "content/albums").forgetFolder(atlasGalleryRoots()[0].name); true`);
      for (let i = 0; i < 20 && (await run(`${as}.groups`)); i++) await sleep(500);
      await run(gear);
      await sleep(300);

      // трек в папке со снимками (выдуманный, Пирита): «Поход» — снимок без места и walk.gpx, «Только трек» —
      // папка с одним GPX, тоже альбом. Место альбома — из трека, в шапке — «Просмотр трека»; трек открывается
      // в «Моих треках», стрелка — назад в альбом; правка пишется в файл, исходник — в «[Originals]»
      if (mods.some((m) => m.id === "content/tracks")) {
        const walk = (name, lat) => `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><metadata><name>${name}</name></metadata><trk><trkseg>${
          Array.from({ length: 21 }, (_, i) => `<trkpt lat="${lat}" lon="${(24.83 + i * 0.000585).toFixed(6)}"><ele>5</ele><time>${new Date(Date.UTC(2024, 4, 5, 9, 0, i * 10)).toISOString()}</time></trkpt>`).join("")}</trkseg></trk></gpx>`;
        await run(`(async () => { const { file, folder } = testFs, gpx = (n, x) => file(n, new Blob([x]));
          const d = new Date(Date.UTC(2024, 4, 5, 9, 1, 40)), two = (n) => String(n).padStart(2, "0");
          const wall = d.getFullYear() + ":" + two(d.getMonth() + 1) + ":" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
          const base = await new Promise((r) => { const c = Object.assign(document.createElement("canvas"), { width: 8, height: 8 }); c.toBlob(r, "image/jpeg"); });
          const shot = await (await import("./tools/jpeg.js")).setMeta(base, { date: wall });
          window.showDirectoryPicker = async () => folder("Треки", [folder("20240505 Поход", [file("p.jpg", shot), gpx("walk.gpx", ${JSON.stringify(walk("Поход у моря", 59.47))})]),
            folder("20240506 Только трек", [gpx("solo.gpx", ${JSON.stringify(walk("Один трек", 59.48))})])]);
          return true; })()`);
        await run(gear);
        await sleep(600);
        await run(`atlas.modules().find((m) => m.id === "content/albums").pickFolder(); true`);
        for (let i = 0; i < 30 && !(await run(`${as}.tracks === 2 && !${as}.busy`)); i++) await sleep(500);
        await run(gear);
        const am = `atlas.modules().find((m) => m.id === "content/albums")`, ts = `atlas.modules().find((m) => m.id === "content/tracks")`;
        await run(`${am}.openFirst("Поход")`);
        await sleep(800);
        const g1 = await run(`({ ...${as}, facts: document.querySelector(".al-facts").textContent, btn: document.querySelector(".al-track")?.title,
          lines: atlas.map.getSource("albums-tracks")?.serialize().data.features.length })`);
        check("альбомы: GPX в папке — альбом и без снимков, линия на карте, в шапке «Просмотр трека»",
          g1.tracks === 2 && g1.open === "Поход" && /^1 фото · 1 трек/.test(g1.facts) && g1.btn === "Просмотр трека «walk»" && g1.lines === 2, JSON.stringify(g1));
        await run(`document.querySelector(".al-track").click(); true`);
        await sleep(1200);
        const tbar = `[...document.querySelectorAll('[data-panel="tracks"] .pb-bar .pb-btn')].map((b) => b.title)`;
        const g2 = await run(`({ ...${ts}.stats(), panel: !document.querySelector('[data-panel="tracks"]').hidden, albums: !document.querySelector('[data-panel="albums"]').hidden, bar: ${tbar} })`);
        check("треки: «Просмотр трека» — трек альбома в «Моих треках», стрелка — назад в альбом, без «Удалить»",
          g2.panel && !g2.albums && g2.open === "Поход у моря" && g2.bar[0] === "Назад в альбом «Поход»" && !g2.bar.some((t) => /^Удалить/.test(t)) && g2.tracks === 0 && g2.albumTracks === 2,
          JSON.stringify(g2));
        // фото на треке по времени: снимок 09:01:40 — посередине трека (точка 10 из 20): кружок на карте,
        // чёрточка на графике, лента «Фото на треке» под графиком; щелчок — снимок выбран, белая точка на треке
        for (let i = 0; i < 20 && !(await run(`!!document.querySelector(".tk-photo")`)); i++) await sleep(500);
        const ph = await run(`(() => { const f = atlas.map.getSource("tracks-photos")?.serialize().data.features || [];
          const cell = document.querySelector(".tk-photo"); cell?.click();
          return { cells: document.querySelectorAll(".tk-photo").length, head: [...document.querySelectorAll('[data-panel="tracks"] .tk-section')].map((e) => e.textContent).find((t) => /^Фото/.test(t)),
            time: cell?.querySelector(".tk-photo-time")?.textContent, marks: document.querySelectorAll(".tk-photo-mark").length, n: f.length, lon: f[0]?.geometry.coordinates[0],
            on: cell?.classList.contains("on"), here: atlas.map.getSource("tracks-ends").serialize().data.features.some((x) => x.properties.kind === "here") }; })()`);
        check("треки: фото на треке по времени — кружок посередине трека, чёрточка на графике, лента «Фото на треке», щелчок выбирает",
          ph.cells === 1 && ph.head === "Фото на треке · 1" && ph.n === 1 && Math.abs(ph.lon - (24.83 + 10 * 0.000585)) < 0.0002 && ph.marks >= 1 && ph.on && ph.here
          && ph.time === new Date(Date.UTC(2024, 4, 5, 9, 1, 40)).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }), JSON.stringify(ph));
        await run(`document.querySelector(".tk-photos").scrollIntoView({ block: "center" }); true`);
        await shot("99c-track-photos");
        await run(`(() => { const n = document.querySelector(".tk-name"); n.value = "Поход к маяку"; n.dispatchEvent(new Event("change")); return true; })()`);
        await sleep(1200);
        const walkDir = `atlasGalleryRoots().find((d) => d.name === "Треки").items.find((i) => i.name === "20240505 Поход")`;
        const g3 = await run(`(async () => { const d = ${walkDir}, orig = d.items.find((i) => i.name === "[Originals]")?.items.find((i) => i.name === "walk.gpx");
          return { now: await d.items.find((i) => i.name === "walk.gpx").data.text(), orig: orig && await orig.data.text(),
            back: !!document.querySelector('[data-panel="tracks"] .tk-revert, [data-panel="tracks"] [title^="Вернуть"]') }; })()`);
        check("треки: правка трека альбома — в его файл, исходник — в «[Originals]»",
          g3.now.includes("<name>Поход к маяку</name>") && g3.orig?.includes("<name>Поход у моря</name>"), JSON.stringify({ ...g3, now: g3.now.slice(0, 300) }));
        await run(`document.querySelector('[data-panel="tracks"] .pb-bar .pb-btn').click(); true`);
        await sleep(1000);
        const g4 = await run(`({ ...${as}, panel: !document.querySelector('[data-panel="albums"]').hidden, tracks: !document.querySelector('[data-panel="tracks"]').hidden, here: location.protocol })`);
        // смена панелей не сдвигает историю браузера (раньше «альбом → трек → альбом» уводило со страницы)
        await run(exitMode);
        await sleep(500);
        g4.after = await run(`location.protocol`);
        check("треки: стрелка — назад в альбом, страница на месте", g4.panel && !g4.tracks && g4.open === "Поход" && g4.here === "http:" && g4.after === "http:", JSON.stringify(g4));
        await run(exitMode);
        await run(closeLayers);
        // в «Моих треках» — раздел «Из альбомов» с названием альбома, кнопка «Открыть альбом»
        await run(openLayers("content/tracks"));
        await sleep(600);
        await run(`${itemFor("Все треки (2)")}?.click(); true`);
        await sleep(800);
        const g5 = await run(`({ head: document.querySelector('[data-panel="tracks"] .tk-section')?.textContent,
          rows: [...document.querySelectorAll('[data-panel="tracks"] .tk-album-row')].map((r) => r.textContent) })`);
        await run(`[...document.querySelectorAll('[data-panel="tracks"] .tk-album-row')].find((r) => r.textContent.includes("Один трек")).click(); true`);
        await sleep(800);
        g5.bar = await run(tbar);
        check("треки: «Из альбомов» — треки папок со снимками, у трека — «Открыть альбом»",
          g5.head === "Из альбомов" && g5.rows.length === 2 && g5.rows.some((r) => r.includes("Поход к маяку") && r.includes("Поход")) && g5.bar[0] === "Ко всем трекам" && g5.bar[1] === "Открыть альбом «Только трек»",
          JSON.stringify(g5));
        await run(exitMode);
        await run(closeLayers);
        await run(gear);
        await sleep(600);
        await run(`atlas.modules().find((m) => m.id === "content/albums").forgetFolder(atlasGalleryRoots()[0].name); true`);
        for (let i = 0; i < 20 && (await run(`${as}.tracks`)); i++) await sleep(500);
        await run(gear);
        await sleep(300);
      }
    }
  }

  // мои треки: выдуманный трек (не настоящий — личное в репозиторий не кладём): 2 км на восток вдоль
  // Пирита, 10 минут, подъём на 20 м; открывается файлом — панель, линия, начало и конец, график
  if (want("content/tracks") && mods.some((m) => m.id === "content/tracks")) {
    const gpx = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><metadata><name>Проверочный трек</name></metadata><trk><trkseg>${
      Array.from({ length: 61 }, (_, i) => `<trkpt lat="59.47" lon="${(24.83 + i * 0.000585).toFixed(6)}"><ele>${(5 + i / 3).toFixed(1)}</ele><time>${new Date(Date.UTC(2026, 4, 26, 9, 0, i * 10)).toISOString()}</time></trkpt>`).join("")}</trkseg></trk></gpx>`;
    const ts = `atlas.modules().find((m) => m.id === "content/tracks")`;
    const st = await run(`${ts}.statsOf(${JSON.stringify(gpx)})`);
    check("треки: расчёт — 2 км, 10 минут, подъём 20 м", Math.abs(st.dist - 2000) < 60 && st.moving === 600000 && Math.abs(st.up - 20) < 4, JSON.stringify(st));
    // склон 45°: шаг 20 м по карте и 20 м вниз — путь и скорость с перепадом высот в 1,41 раза больше
    const slope = gpx.replace(/<trkpt lat="59\.47" lon="([\d.]+)"><ele>[\d.]+<\/ele>/g, (_, lon) => {
      const i = Math.round((+lon - 24.83) / 0.000585);
      return `<trkpt lat="59.47" lon="${(24.83 + i * 0.000351).toFixed(6)}"><ele>${2000 - i * 20}</ele>`;
    });
    const s3 = await run(`${ts}.statsOf(${JSON.stringify(slope)})`);
    check("треки: расстояние и скорость — с перепадом высот (склон 45°)", Math.abs(s3.dist / 1692 - 1) < 0.01 && Math.abs(s3.maxSpeed / (28.2 * 3.6 / 10) - 1) < 0.02, JSON.stringify(s3));
    await run(openLayers("content/tracks"));
    await sleep(500);
    // горные лыжи (выдуманная гора): три раза подъёмник 200 м вверх медленно и спуск 200 м вниз быстро;
    // файл от Ski Tracker — вид «Лыжи горные» сам; спусков 3, подъёмов 3, скорость — только спусков
    {
      const pts = [];
      let lon = 12.2, t = Date.UTC(2026, 1, 14, 9, 0, 0), ele = 1000;
      const add = () => pts.push(`<trkpt lat="47.46" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele><time>${new Date(t).toISOString()}</time></trkpt>`);
      add();
      for (let c = 0; c < 3; c++) {
        for (let j = 0; j < 30; j++) { lon += 0.0002; ele += 200 / 30; t += 10000; add(); }
        for (let j = 0; j < 15; j++) { lon -= 0.0004; ele -= 200 / 15; t += 10000; add(); }
      }
      const skiGpx = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/0" version="1.0" creator="SkiTracker"><trk><name>Горы</name><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
      await run(`${itemFor("Все треки (0)")}?.click(); true`);
      await sleep(500);
      await run(`${ts}.addText("ski.gpx", ${JSON.stringify(skiGpx)}).then(() => true)`);
      await sleep(1500);
      const sk = await run(`({ kind: document.querySelector(".tk-kind-btn").textContent, facts: Object.fromEntries([...document.querySelectorAll(".tk-fact")].map((f) => [f.lastChild.textContent, f.firstChild.textContent])),
        lifts: document.querySelectorAll(".tk-chart .tk-lift").length, mapLift: atlas.map.getSource("tracks-lift").serialize().data.features.length })`);
      check("треки: горные лыжи — 3 спуска и 3 подъёма, скорость только на спусках", sk.kind === "Лыжи горные" && sk.facts["спусков"] === "3" && sk.facts["подъёмов"] === "3"
        && /км\/ч$/.test(sk.facts["максимальная скорость на спусках"]) && /^(59\d|60\d) м$/.test(sk.facts["перепад на спусках"]) && sk.lifts === 3 && sk.mapLift === 1, JSON.stringify(sk));
      await shot("99c-ski");
      await run(`window.confirm = () => true; document.querySelector('[data-panel="tracks"] .pb-bar .tr-bar-left:last-child .pb-btn:last-child').click(); true`);
      await sleep(500);
      await run(exitMode);
      await sleep(300);
      await run(openLayers("content/tracks"));
      await sleep(500);
    }
    const items = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].map((b) => b.firstChild.textContent)`);
    const tkHome = await run(`({ panel: !document.querySelector('[data-panel="tracks"]').hidden, open: document.querySelector('[data-panel="tracks"] .home-row')?.textContent })`);
    check("треки: кнопка раздела — сразу панель со списком, строки «Открыть трек…» нет", tkHome.panel && !tkHome.open && !items.includes("Открыть трек…"), JSON.stringify({ items, tkHome }));
    await run(`${itemFor("Все треки (0)")}?.click(); true`);
    await sleep(500);
    await run(`${ts}.addText("test.gpx", ${JSON.stringify(gpx)}).then(() => true)`);
    await sleep(2500);
    await idle();
    const tk = await run(`({ ...${ts}.stats(), panel: !document.querySelector('[data-panel="tracks"]').hidden, facts: [...document.querySelectorAll(".tk-fact b")].map((b) => b.textContent),
      chart: !!document.querySelector(".tk-chart svg .tk-ele"), line: atlas.map.queryRenderedFeatures({ layers: ["tracks-line"] }).length,
      ends: atlas.map.queryRenderedFeatures({ layers: ["tracks-ends"] }).length, mode: document.querySelector(".search-box input").placeholder })`);
    check("треки: файл открыт — панель, цифры, график, линия и концы на карте", tk.panel && tk.open === "Проверочный трек" && /^(1,9\d|2,0\d) км$/.test(tk.facts[0]) && tk.chart && tk.line > 0 && tk.ends === 2 && tk.mode === "Найти трек", JSON.stringify(tk));
    // оформление: название, цвет, заметка — сразу сохраняются; цвет — на карте, заметку находит поиск
    const look = await run(`(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const n = document.querySelector(".tk-name"); n.value = "Вокруг озера"; n.dispatchEvent(new Event("change"));
      const t = document.querySelector(".panel:not([hidden]) .panel-title span").textContent;
      document.querySelectorAll(".tk-color")[5].click();
      const note = document.querySelector(".tk-note"); note.value = "Пикник у маяка"; note.dispatchEvent(new Event("change"));
      await wait(300);
      const color = atlas.map.getSource("tracks").serialize().data.features[0].properties.color;
      const i = document.querySelector(".search-box input"); i.value = "маяк"; i.dispatchEvent(new Event("input")); await wait(300);
      const found = [...document.querySelectorAll('[data-panel="tracks"] .tr-row:not(.home-row) .tr-row-title')].map((r) => r.textContent);
      const icon = document.querySelector('[data-panel="tracks"] .tk-icon').style.background;
      i.value = ""; i.dispatchEvent(new Event("input")); await wait(200);
      [...document.querySelectorAll('[data-panel="tracks"] .tr-row')].find((r) => r.textContent.includes("Вокруг озера")).click(); await wait(800);
      const n2 = document.querySelector(".tk-name"); n2.value = "Проверочный трек"; n2.dispatchEvent(new Event("change"));
      document.querySelectorAll(".tk-color")[0].click();
      return { t, color, found, icon, note: document.querySelector(".tk-note").value, open: ${ts}.stats().open }; })()`);
    check("треки: оформление — название, цвет на карте и в списке, заметку находит поиск", look.t === "Вокруг озера" && look.color === "#e53935"
      && JSON.stringify(look.found) === '["Вокруг озера"]' && /229, 57, 53/.test(look.icon) && look.note === "Пикник у маяка" && look.open === "Проверочный трек", JSON.stringify(look));
    // график: точка бежит по треку
    const here = await run(`(() => { const r = document.querySelector(".tk-chart svg").getBoundingClientRect();
      document.querySelector(".tk-chart svg").dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + r.width / 2, clientY: r.top + 20, bubbles: true }));
      return document.querySelector(".tk-read").textContent; })()`);
    await sleep(300);
    check("треки: наведение на график — точка на треке", /км/.test(here) && (await run(`atlas.map.getSource("tracks-ends").serialize().data.features.length`)) === 3, here);
    const marks = await run(`[...document.querySelectorAll(".tk-chart .tk-mark")].map((m) => m.textContent)`);
    check("треки: на графике — высшая и низшая точка, наибольшая скорость", marks.includes("▲ 25 м") && marks.includes("▼ 5 м") && marks.some((m) => /^11,9 км\/ч$/.test(m)), JSON.stringify(marks));
    await shot("99b-tracks");
    // правка: наибольшие скорость и высота, отрезки по км; выбрать вторую половину — оставить её; «Назад»
    const ed0 = await run(`({ labels: [...document.querySelectorAll(".tk-fact span")].map((x) => x.textContent), splits: document.querySelectorAll(".tk-splits tbody tr").length,
      kind: !!document.querySelector(".tk-kind"), trim: document.querySelector(".tk-edit .text-btn").disabled })`);
    check("треки: максимальная скорость и высота, вид активности, отрезки по 1 км", ["максимальная скорость", "максимальная высота", "минимальная высота", "средняя скорость"].every((l) => ed0.labels.includes(l)) && ed0.splits === 2 && ed0.kind && ed0.trim, JSON.stringify(ed0));
    const row1 = await run(`[...document.querySelectorAll(".tk-splits tbody tr:first-child td")].map((td) => td.textContent)`);
    check("треки: отрезок — «0–1» км, время, средняя и макс. скорость, набор, сброс, высота", row1[0] === "0–1" && /^\d+:\d\d$/.test(row1[1]) && row1[3] && /^\d+–\d+$/.test(row1[6]), JSON.stringify(row1));
    // колёсико над графиком — крупнее, ползунок показывает видимую часть
    const zm = await run(`(async () => { const svg = document.querySelector(".tk-chart svg"), r = svg.getBoundingClientRect();
      svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, clientX: r.left + r.width / 2, clientY: r.top + 30, bubbles: true, cancelable: true }));
      await new Promise((ok) => setTimeout(ok, 300));
      const th = document.querySelector(".tk-thumb").getBoundingClientRect(), sc = document.querySelector(".tk-scroll").getBoundingClientRect();
      return { legend: document.querySelector(".tk-leg-zoom")?.textContent || "", part: Math.round((th.width / sc.width) * 100) }; })()`);
    check("треки: колёсико увеличивает график, ползунок — видимая часть", /^крупно: /.test(zm.legend) && zm.part > 20 && zm.part < 80, JSON.stringify(zm));
    // ползунок: правый край влево — крупнее; середину вправо — сдвиг
    const gp = await run(`(async () => { document.querySelector(".tk-thumb ~ *") ; const wait = () => new Promise((ok) => setTimeout(ok, 200));
      const legend = () => document.querySelector(".tk-leg-zoom")?.textContent || "";
      // сначала весь трек
      [...document.querySelectorAll(".tk-edit .text-btn")].find((b) => b.textContent === "Весь трек")?.click(); await wait();
      const sc = document.querySelector(".tk-scroll"), g = sc.querySelector(".tk-grip-b"), r = g.getBoundingClientRect();
      const ev = (el, type, x) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: r.top + r.height / 2, pointerId: 7, bubbles: true }));
      ev(g, "pointerdown", r.left + 7); ev(sc, "pointermove", r.left - sc.getBoundingClientRect().width / 2); ev(sc, "pointerup", 0); await wait();
      const zoomed = legend();
      const th = sc.querySelector(".tk-thumb").getBoundingClientRect();
      ev(sc.querySelector(".tk-thumb"), "pointerdown", th.left + th.width / 2); ev(sc, "pointermove", th.left + th.width / 2 + 60); ev(sc, "pointerup", 0); await wait();
      return { whole: !!document.querySelector(".tk-grip-a") , zoomed, moved: legend() }; })()`);
    // при сдвиге масштаб не меняется: та же точка на той же высоте графика
    const steady = await run(`(async () => { const wait = () => new Promise((ok) => setTimeout(ok, 200));
      const y = () => document.querySelector(".tk-ele").getAttribute("d").split(" ").filter((p) => p.startsWith("L")).map((p) => +p.split(",")[1]);
      const sc = document.querySelector(".tk-scroll"), th = sc.querySelector(".tk-thumb").getBoundingClientRect();
      const ev = (el, type, x) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: th.top + th.height / 2, pointerId: 8, bubbles: true }));
      const before = Math.min(...y());
      ev(sc.querySelector(".tk-thumb"), "pointerdown", th.left + th.width / 2); ev(sc, "pointermove", th.left + th.width / 2 - 40); ev(sc, "pointerup", 0); await wait();
      return { before, after: Math.min(...y()) }; })()`);
    check("треки: при сдвиге графика масштаб высоты не меняется", steady.after > steady.before, JSON.stringify(steady));
    check("треки: ползунок — край тянется (крупнее), середина двигает", /^крупно: 0 м – /.test(gp.zoomed) && /^крупно: /.test(gp.moved) && gp.moved !== gp.zoomed, JSON.stringify(gp));
    // вид активности — список с чёрно-белыми значками
    const kp = await run(`(async () => { document.querySelector(".tk-kind-btn").click(); await new Promise((ok) => setTimeout(ok, 100));
      const items = [...document.querySelectorAll(".tk-kind-item")]; const names = items.map((i) => i.textContent);
      items.find((i) => i.textContent === "Кайтсёрфинг").click(); await new Promise((ok) => setTimeout(ok, 400));
      return { names, chosen: document.querySelector(".tk-kind-btn").textContent, svg: !!document.querySelector(".tk-kind-btn svg[fill=currentColor]") }; })()`);
    check("треки: вид активности — список со значками, лыжи беговые и горные", kp.names.includes("Лыжи беговые") && kp.names.includes("Лыжи горные") && kp.names.includes("Кайтсёрфинг") && kp.chosen === "Кайтсёрфинг" && kp.svg, JSON.stringify(kp));
    await run(`${ts}.select(0.5, 1).then(() => true)`);
    await sleep(300);
    const ed1 = await run(`({ info: document.querySelector(".tk-sel-info").textContent, sel: atlas.map.getSource("tracks-sel").serialize().data.features.length })`);
    check("треки: выбран кусок — его цифры и линия на карте", /^Выбрано .*: (9\d\d м|1,0\d км)/.test(ed1.info) && ed1.sel === 1, JSON.stringify(ed1));
    await run(`document.querySelector(".tk-edit .text-btn").click(); true`);
    await sleep(500);
    const ed2 = await run(`({ dist: document.querySelector(".tk-fact b").textContent, undo: !document.querySelector('[data-panel="tracks"] .pb-bar .tr-bar-left:last-child .pb-btn').disabled, restore: !!document.querySelector(".tk-restore") })`);
    check("треки: «Оставить только выбранное» — трек обрезан", /^(9\d\d м|1,0\d км)$/.test(ed2.dist) && ed2.undo && ed2.restore, JSON.stringify(ed2));
    await run(`document.querySelector('[data-panel="tracks"] .pb-bar .tr-bar-left:last-child .pb-btn').click(); true`);
    await sleep(500);
    const ed3 = await run(`document.querySelector(".tk-fact b").textContent`);
    check("треки: «Назад» — трек как был", /^(1,9\d|2,0\d) км$/.test(ed3), ed3);
    // выбросы GPS: трек с точкой, отскочившей на 330 м, — найдена и убрана; разрезать в отмеченной точке —
    // два трека, «Назад» — снова один; склеить их; дорисовать щелчками по карте
    const spiky = gpx.replace(/(<trkpt lat=")59\.47(" lon="24\.84755)/, "$159.473$2").replace("Проверочный трек", "Трек с выбросом");
    await run(`${ts}.addText("spiky.gpx", ${JSON.stringify(spiky)}).then(() => true)`);
    await sleep(800);
    const sp0 = await run(`({ btn: [...document.querySelectorAll(".tk-edit .text-btn")].map((b) => b.textContent).find((x) => /выброс/i.test(x)),
      red: atlas.map.getSource("tracks-ends").serialize().data.features.filter((f) => f.properties.kind === "spike").length })`);
    await run(`[...document.querySelectorAll(".tk-edit .text-btn")].find((b) => /Убрать выбросы/.test(b.textContent)).click(); true`);
    await sleep(500);
    const sp1 = await run(`({ btn: [...document.querySelectorAll(".tk-edit .text-btn")].map((b) => b.textContent).find((x) => /выброс/i.test(x)), dist: document.querySelector(".tk-fact b").textContent })`);
    check("треки: выброс GPS найден, на карте красный, убран", sp0.btn === "Убрать выбросы GPS (1)" && sp0.red === 1 && sp1.btn === "Выбросов GPS нет" && /^(1,9\d|2,0\d) км$/.test(sp1.dist), JSON.stringify({ sp0, sp1 }));
    const btnText = (re) => `[...document.querySelectorAll(".tk-edit .text-btn")].find((b) => ${re}.test(b.textContent))`;
    await run(`${ts}.pinAt(0.5).then(() => true)`);
    await sleep(300);
    await run(`${btnText("/^Разрезать/")}.click(); true`);
    await sleep(800);
    const sp2 = await run(`({ n: ${ts}.stats().tracks, dist: document.querySelector(".tk-fact b").textContent })`);
    await run(`document.querySelector('[data-panel="tracks"] .pb-bar .tr-bar-left:last-child .pb-btn').click(); true`);
    await sleep(800);
    const sp3 = await run(`({ n: ${ts}.stats().tracks, dist: document.querySelector(".tk-fact b").textContent })`);
    check("треки: «Разрезать» — два трека, «Назад» — снова один", sp2.n === 3 && /^(9\d\d м|1,0\d км)$/.test(sp2.dist) && sp3.n === 2 && /^(1,9\d|2,0\d) км$/.test(sp3.dist), JSON.stringify({ sp2, sp3 }));
    await run(`(() => { const m = document.querySelector(".tk-merge"); m.value = m.options[1].value; m.dispatchEvent(new Event("change")); return true; })()`);
    await sleep(800);
    const sp4 = await run(`({ n: ${ts}.stats().tracks, dist: document.querySelector(".tk-fact b").textContent, hint: document.querySelector('[data-panel="tracks"] .pb-hint').textContent })`);
    check("треки: «Склеить с треком» — один трек из двух", sp4.n === 1 && /^(3,9\d|4,0\d) км$/.test(sp4.dist) && /кусков записи: 2/.test(sp4.hint), JSON.stringify(sp4));
    await run(`${btnText("/^Дорисовать/")}.click(); true`);
    await sleep(300);
    await run(`${ts}.drawAt(24.8705, 59.47).then(() => true)`);
    await sleep(500);
    const sp5 = await run(`({ dist: document.querySelector(".tk-fact b").textContent, done: !!${btnText("/^Готово/")}, place: !!document.querySelector(".maplibregl-popup") })`);
    await run(`${btnText("/^Готово/")}.click(); true`);
    await sleep(300);
    check("треки: «Дорисовать» — щелчок по карте продолжает трек", /^(4,\d\d) км$/.test(sp5.dist) && sp5.dist !== sp4.dist && sp5.done && !sp5.place, JSON.stringify(sp5));
    // ползунок внизу окна: потянуть вверх — окно ниже; двойное нажатие — снова по содержимому
    const gr = await run(`(() => { const p = document.querySelector('[data-panel="tracks"]'), g = p.querySelector(".panel-grip"), before = p.getBoundingClientRect().height, r = g.getBoundingClientRect();
      const ev = (type, y) => g.dispatchEvent(new PointerEvent(type, { clientX: r.left + r.width / 2, clientY: y, pointerId: 1, bubbles: true }));
      ev("pointerdown", r.top + 8); ev("pointermove", r.top - 100); ev("pointerup", r.top - 100);
      const after = p.getBoundingClientRect().height; g.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      return { before: Math.round(before), after: Math.round(after), reset: Math.round(p.getBoundingClientRect().height), icons: document.querySelectorAll(".tk-edit svg").length,
        labels: [...document.querySelectorAll(".tk-edit .text-btn")].map((b) => b.textContent) }; })()`);
    check("окно: ползунок внизу меняет высоту; правка — значки «Обрезать», «Вырезать»", Math.abs(gr.before - gr.after - 108) < 3 && gr.reset === gr.before && gr.icons >= 4
      && gr.labels[0] === "Обрезать" && gr.labels[1] === "Вырезать", JSON.stringify(gr));
    // удалить (без вопроса — подтверждение подменено), трек уходит и с устройства
    await run(`window.confirm = () => true; document.querySelector('[data-panel="tracks"] .pb-bar .tr-bar-left:last-child .pb-btn:last-child').click(); true`);
    await sleep(500);
    check("треки: удаление", (await run(`${ts}.stats().tracks`)) === 0);
    // запись трека (приложение Android): своя подмена AtlasTrack — кнопка над «Навигацией», запись с паузой
    // (два куска), стоп кнопкой — трек в «Моих треках», файл приложения стёрт, линия записи с карты убрана
    await run(`(() => { const lines = [], st = { on: false, start: 0, pausedAt: 0, pausedTotal: 0, dist: 0 };
      window.__rec = lines;
      window.AtlasTrack = { start: () => { Object.assign(st, { on: true, start: Date.now() - 65000, dist: 850, max: 12.5 }); return "ok"; },
        pause: () => { st.pausedAt = Date.now(); lines.push(null); }, resume: () => { st.pausedTotal += Date.now() - st.pausedAt; st.pausedAt = 0; },
        stop: () => { st.on = false; st.pausedAt = 0; }, state: () => JSON.stringify({ ...st, saved: lines.length > 0 }),
        read: (from) => JSON.stringify(lines.slice(from)), clear: () => { if (!st.on) lines.length = 0; } };
      ${ts}.recInit(); return true; })()`);
    await run(`document.querySelector(".rec-btn").click(); window.__recT = Date.now(); for (let i = 0; i < 20; i++) __rec.push([24.83 + i * 0.0005, 59.47, 5, Date.now() - (40 - i) * 1000]); true`);
    await sleep(1500);
    const rc1 = await run(`({ ...${ts}.recState(), row: document.querySelector('[data-panel="tracks"] .tk-rec')?.textContent })`);
    await run(`document.querySelector('[data-panel="tracks"] .tk-rec .pb-btn').click(); true`);
    await sleep(500);
    const rc2 = await run(`({ paused: document.querySelector(".rec-btn").classList.contains("paused"), row: document.querySelector('[data-panel="tracks"] .tk-rec')?.textContent })`);
    await run(`document.querySelector('[data-panel="tracks"] .tk-rec .pb-btn').click(); for (let i = 0; i < 10; i++) __rec.push([24.85 + i * 0.0005, 59.471, 5, Date.now() - (10 - i) * 1000]); true`);
    await sleep(500);
    await run(`document.querySelector(".rec-btn").click(); true`);
    for (let i = 0; i < 10 && !(await run(`${ts}.stats().tracks === 1 && !${ts}.recState().finishing`)); i++) await sleep(300);
    const rc3 = await run(`({ ...${ts}.recState(), ...${ts}.stats(), left: __rec.length, segs: atlas.map.getSource("tracks-rec").serialize().data.features.length, hint: document.querySelector('[data-panel="tracks"] .pb-hint')?.textContent })`);
    check("запись трека: кнопка над «Навигацией», время, км и скорость, пауза, стоп — трек в «Моих треках» из двух кусков",
      rc1.btn && rc1.on && /^0:01:0\d$/.test(rc1.time) && rc1.pts === 20 && rc1.line && /^Идёт запись0:01:0\d · 850 м · макс 45 км\/ч$/.test(rc1.row)
      && /^0:01:0\d\n850 м\nмакс 45 км\/ч$/.test(rc1.pill)
      && rc2.paused && /^Запись — пауза/.test(rc2.row) && !rc3.on && rc3.time === "" && rc3.tracks === 1 && /^Запись /.test(rc3.open) && rc3.left === 0 && rc3.segs === 0
      && /кусков записи: 2/.test(rc3.hint), JSON.stringify({ rc1, rc2, rc3 }));
    // приложение: снимки галереи телефона на треке (AtlasPhotos). Нет разрешения — кнопка «Фото из галереи
    // телефона»; дали — в ленте снимок и ролик, снятые за время записи (третий — позже, не на треке); второй
    // щелчок — галерея с адресами https://phone.invalid/…
    await run(`(() => { const T = window.__recT, opened = [];
      window.__phone = [{ id: "img:7", name: "PXL_1.jpg", video: false, at: T - 30000 }, { id: "vid:8", name: "PXL_2.mp4", video: true, at: T - 25000 },
        { id: "img:9", name: "PXL_3.jpg", video: false, at: T + 3600000 }];
      window.__opened = opened; window.__open = window.open; window.open = (u) => { opened.push(u); return null; };
      window.AtlasPhotos = { a: "none", access() { return this.a; }, ask() { this.a = "all"; setTimeout(() => atlasPhotosChanged()); },
        list: (from, to) => JSON.stringify(__phone.filter((x) => x.at >= from && x.at <= to)) };
      atlasPhotosChanged(); return true; })()`);
    await sleep(600);
    const ph1 = await run(`({ btn: [...document.querySelectorAll('[data-panel="tracks"] .tk-edit .text-btn')].map((b) => b.textContent).find((t) => /галере/.test(t)),
      cells: document.querySelectorAll(".tk-photo").length })`);
    await run(`[...document.querySelectorAll('[data-panel="tracks"] .tk-edit .text-btn')].find((b) => /галере/.test(b.textContent)).click(); true`);
    for (let i = 0; i < 10 && (await run(`document.querySelectorAll(".tk-photo").length`)) < 2; i++) await sleep(300);
    const ph2 = await run(`(() => { const cells = [...document.querySelectorAll(".tk-photo")];
      cells[0]?.click(); cells[0]?.click(); const g = atlasGallery();
      return { cells: cells.length, head: [...document.querySelectorAll('[data-panel="tracks"] .tk-section')].map((e) => e.textContent).find((t) => /^Фото/.test(t)),
        src: cells[0]?.querySelector("img").getAttribute("src"), btn: [...document.querySelectorAll('[data-panel="tracks"] .tk-edit .text-btn')].some((b) => /галере/.test(b.textContent)),
        opened: __opened.length, full: g.photos.map((x) => x.full), video: g.photos.map((x) => !!x.video), start: g.start }; })()`);
    await run(`window.open = window.__open; delete window.AtlasPhotos; atlasPhotosChanged(); true`);
    check("приложение: фото из галереи телефона на треке — сперва кнопка разрешения, потом снимок и ролик за время записи, галерея",
      ph1.btn === "Фото из галереи телефона" && ph1.cells === 0 && ph2.cells === 2 && ph2.head === "Фото на треке · 2" && ph2.src === "https://phone.invalid/thumb/img/7"
      && !ph2.btn && ph2.opened === 1 && ph2.full.join() === "https://phone.invalid/full/img/7,https://phone.invalid/full/vid/8" && ph2.video.join() === "false,true" && ph2.start === 0,
      JSON.stringify({ ph1, ph2 }));
    await run(`document.querySelector('[data-panel="tracks"] .pb-bar .tr-bar-left:last-child .pb-btn:last-child').click(); true`);
    await sleep(500);
    await run(exitMode);
    await sleep(300);
    // «вне трассы»: приложению уходят трассы и подъёмники вокруг первой точки (квадраты «Спусков» — с устройства,
    // здесь подложены свои), кроме «вне трассы» и ски-тура; уехал с трасс — время на кнопке оранжевое
    await run(`(async () => { const { cacheSet } = await import(new URL("core/storage.js", location.href).href), t = Date.now();
      for (let x = 50; x <= 52; x++) for (let y = 233; y <= 235; y++) {
        const box = [x * 0.2, y * 0.2].map((v) => +v.toFixed(3)), here = x === 51 && y === 234;
        await cacheSet(\`slopes:\${box[0]}:\${box[1]}\`, { t, recs: here ? [
          { osm: "way/1", kind: "downhill", diff: "easy", lines: [[[10.27, 46.99], [10.28, 46.995]]] },
          { osm: "way/2", kind: "downhill", diff: "freeride", lines: [[[10.26, 46.98], [10.265, 46.985]]] },
          { osm: "way/3", kind: "skitour", lines: [[[10.25, 46.98], [10.255, 46.985]]] },
          { osm: "relation/4", kind: "downhill", ref: "4", labelOnly: true, lines: [[[10.27, 46.99], [10.28, 46.995]]] },
          { osm: "way/5", kind: "downhill", diff: "easy", area: true, lines: [[[10.27, 46.99], [10.271, 46.99], [10.271, 46.991], [10.27, 46.99]]] },
          { lift: true, osm: "way/6", kind: "chair_lift", line: [[10.28, 46.995], [10.27, 46.99]] }] : [] });
      }
      const lines = [], st = { on: false, start: 0, pausedAt: 0, pausedTotal: 0, dist: 0, off: 0 };
      window.__rec = lines; window.__slopes = [];
      window.AtlasTrack = { start: () => { Object.assign(st, { on: true, start: Date.now() }); return "ok"; }, pause() {}, resume() {},
        stop: () => { st.on = false; }, state: () => JSON.stringify({ ...st, saved: lines.length > 0 }), read: (from) => JSON.stringify(lines.slice(from)),
        clear: () => { if (!st.on) lines.length = 0; }, setSlopes: (json) => __slopes.push(JSON.parse(json)), __st: st };
      return true; })()`);
    await run(`document.querySelector(".rec-btn").click(); for (let i = 0; i < 5; i++) __rec.push([10.27 + i * 0.0002, 46.99, 2000, Date.now() - (5 - i) * 1000]); true`);
    for (let i = 0; i < 20 && !(await run(`__slopes.length > 0`)); i++) await sleep(300);
    await run(`AtlasTrack.__st.off = 140; true`);
    await sleep(1500);
    const sl = await run(`({ calls: __slopes.length, lines: __slopes[0]?.lines.length, areas: __slopes[0]?.areas.length, flat: __slopes[0]?.lines[0]?.length,
      at: ${ts}.recState().slopesAt?.slice(0, 2), off: ${ts}.recState().offPiste })`);
    await run(`AtlasTrack.__st.on = false; __rec.length = 0; true`);
    await sleep(1500);
    check("вне трассы: приложению — трассы и подъёмник вокруг места записи (без «вне трассы», ски-тура), уехал — кнопка оранжевая",
      sl.calls === 1 && sl.lines === 2 && sl.areas === 1 && sl.flat === 4 && sl.at?.[1] === 46.99 && sl.off && !(await run(`${ts}.recState().on`)), JSON.stringify(sl));
    check("треки: закрыть — линии с карты убраны",await run(`document.querySelector('[data-panel="tracks"]').hidden && !atlas.map.getLayer("tracks-line")`));
    await run(closeLayers);
  }

  // фото: у Таллина издалека — только точки Commons, вблизи — миниатюры; снимки улиц Mapillary;
  // веб-камеры — по всему миру (QLever)
  if (want("photo/commons") && mods.some((m) => m.id === "photo/commons")) {
    const stats = `atlas.modules().find((m) => m.id === "photo/commons").stats()`;
    await run(`atlas.map.jumpTo({ center: [24.745, 59.437], zoom: 8.5 }); atlas.toggle("photo/commons", true).then(() => true)`);
    for (let i = 0; i < 50 && !(await run(`atlas.map.queryRenderedFeatures({ layers: ["photo-commons-dots"] }).length > 0`)); i++) await sleep(1000);
    await sleep(1500);
    const far = await run(`({ dots: atlas.map.queryRenderedFeatures({ layers: ["photo-commons-dots"] }).length,
      thumbs: atlas.map.queryRenderedFeatures({ layers: ["photo-commons"] }).length, loaded: ${stats}.thumbs })`);
    check("фото: издалека — только точки", far.dots > 0 && far.thumbs === 0 && far.loaded === 0, JSON.stringify(far));
    await shot("91-photo-dots");
    await run(`atlas.map.jumpTo({ center: [24.745, 59.437], zoom: 14 }); true`);
    for (let i = 0; i < 50 && !(await run(`atlas.map.getLayer("photo-commons") && atlas.map.queryRenderedFeatures({ layers: ["photo-commons"] }).length > 0`)); i++) await sleep(1000);
    const n = await run(`atlas.map.queryRenderedFeatures({ layers: ["photo-commons"] }).length`);
    const st = await run(`atlas.modules().find((m) => m.id === "photo/commons").stats()`);
    check("фото: снимки Commons", n > 0, `${n} на экране, ${JSON.stringify(st)}`);
    const p = await run(`(() => { const c = atlas.map.project(atlas.map.getCenter()); return atlas.map.queryRenderedFeatures({ layers: ["photo-commons"] })
      .map((f) => atlas.map.project(f.geometry.coordinates)).filter((q) => q.x > 30 && q.x < innerWidth - 70 && q.y > 80 && q.y < innerHeight - 120)
      .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0]; })()`);
    if (p) {
      await clickAt(p.x, p.y);
      for (let i = 0; i < 10 && !(await run(`!!document.querySelector(".maplibregl-popup .popup-photo")`)); i++) await sleep(500);
      check("фото: щелчок — снимок в окне", await run(`!!document.querySelector(".maplibregl-popup .popup-photo")`));
      await shot("92-photo-commons");
      // налезающие точки — один кружок с числом снимков
      const cl = await run(`(() => { const f = atlas.map.queryRenderedFeatures({ layers: ["photo-commons-dots"] });
        const c = f.filter((x) => x.properties.cluster); return { clusters: c.length, max: Math.max(0, ...c.map((x) => x.properties.point_count)),
        labels: atlas.map.queryRenderedFeatures({ layers: ["photo-commons-count"] }).length, single: f.length - c.length }; })()`);
      check("фото: налезающие точки — кружок с числом", cl.clusters > 0 && cl.labels > 0 && cl.max > 1, JSON.stringify(cl));
      // лента внизу: снимки в кадре; щелчок — выделение и окно, двойной щелчок — галерея
      await run(`document.querySelector(".maplibregl-popup")?.remove(); true`);
      for (let i = 0; i < 20 && !(await run(`atlas.strip().items > 0`)); i++) await sleep(1000);
      const sb = await run(`(() => { const b = [...document.querySelectorAll(".photo-strip:not([hidden]) .photo-strip-item:not(.active)")]
          .find((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth - 90; }); if (!b) return null;
        const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, n: document.querySelectorAll(".photo-strip-item").length }; })()`);
      check("лента: снимки в кадре внизу", !!sb && sb.n > 0, JSON.stringify(sb));
      if (sb) {
        await clickAt(sb.x, sb.y);
        await sleep(1500);
        const sel = await run(`({ selected: atlas.strip().selected, active: !!document.querySelector(".photo-strip-item.active"),
          ring: atlas.map.getSource("photo-strip-selected").serialize().data.features.length, popup: !!document.querySelector(".maplibregl-popup .popup-photo") })`);
        check("лента: щелчок — снимок выделен и открыт", !!sel.selected && sel.active && sel.ring === 1 && sel.popup, JSON.stringify(sel));
        await shot("92c-photo-strip");
        await run(`document.querySelector(".photo-strip-item").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); true`);
        check("лента: двойной щелчок — галерея", (await run(`atlas.strip().gallery`)) > 0);
        const gal = await fetch(`${url}gallery.html`).then((r) => r.ok).catch(() => false);
        check("галерея: страница есть", gal);
        await run(`document.querySelector(".maplibregl-popup")?.remove(); true`);
      }
      // в центре города квадрат с 500 снимками делится на четыре
      for (let i = 0; i < 90 && (await run(`${stats}.dense`)) === 0; i++) await sleep(1000);
      const st2 = await run(stats);
      check("фото: густой квадрат делится", st2.dense > 0 && st2.cells.length > 4, `переполненных ${st2.dense}, квадратов ${st2.cells.length}, миниатюр ${st2.thumbs}`);
      await run(`document.querySelector(".maplibregl-popup")?.remove(); true`);
    }
    await run(`atlas.toggle("photo/commons", false).then(() => true)`);
    // снимки улиц: линии съёмки, щелчок — снимок, плеер сообщает положение камеры — точка со взглядом
    await run(`atlas.map.jumpTo({ center: [24.745, 59.437], zoom: 16 }); atlas.toggle("photo/streets", true).then(() => true)`);
    for (let i = 0; i < 40 && !(await run(`atlas.map.queryRenderedFeatures({ layers: ["photo-mly-images"] }).length > 0`)); i++) await sleep(1000);
    const mly = await run(`atlas.map.queryRenderedFeatures({ layers: ["photo-mly-lines", "photo-mly-images"] }).length`);
    check("снимки улиц: линии и точки Mapillary", mly > 0, `${mly}`);
    const mp = await run(`(() => { const f = atlas.map.queryRenderedFeatures({ layers: ["photo-mly-images"] })[0];
      return f && atlas.map.project(f.geometry.coordinates); })()`);
    check("снимки улиц: точки снимков вблизи", !!mp);
    if (mp) {
      await clickAt(mp.x, mp.y);
      for (let i = 0; i < 10 && !(await run(`!!document.querySelector(".maplibregl-popup .popup-photo")`)); i++) await sleep(500);
      check("снимки улиц: щелчок — снимок и «Смотреть в плеере»", await run(`!!document.querySelector(".maplibregl-popup .popup-photo")
        && [...document.querySelectorAll(".maplibregl-popup a")].some((a) => a.textContent === "Смотреть в плеере")`));
      await shot("92b-streets");
      await run(`document.querySelector(".maplibregl-popup")?.remove(); true`);
    }
    await run(`postMessage({ mapillary: { lng: 24.745, lat: 59.437, bearing: 90 } }, location.origin); true`);
    await sleep(500);
    check("снимки улиц: точка камеры от плеера", await run(`atlas.map.getSource("photo-mly-pos").serialize().data.features.length === 1`));
    const viewer = await fetch(`${url}viewer.html`).then((r) => r.ok).catch(() => false);
    check("снимки улиц: страница плеера есть", viewer);
    await run(`atlas.toggle("photo/streets", false).then(() => true)`);
    await run(`atlas.map.jumpTo({ center: [10, 50], zoom: 3 }); atlas.toggle("photo/webcams", true).then(() => true)`);
    await sleep(3000);
    const globe = await run(`atlas.map.queryRenderedFeatures({ layers: ["photo-webcams-dots", "photo-webcams"] }).length`);
    check("веб-камеры: на глобусе не видны", globe === 0, `${globe}`);
    await run(`atlas.map.jumpTo({ center: [24.745, 59.437], zoom: 8 }); true`);
    for (let i = 0; i < 45 && !(await run(`atlas.map.queryRenderedFeatures({ layers: ["photo-webcams-dots"] }).length > 0`)); i++) await sleep(1000);
    const cams = await run(`({ dots: atlas.map.queryRenderedFeatures({ layers: ["photo-webcams-dots"] }).length,
      pins: atlas.map.queryRenderedFeatures({ layers: ["photo-webcams"] }).length })`);
    check("веб-камеры: со «100 км» — точки, не значки", cams.dots > 0 && cams.pins === 0, JSON.stringify(cams));
    await shot("93-webcams");
    await run(`atlas.map.jumpTo({ center: [24.745, 59.437], zoom: 13 }); true`);
    await sleep(2000);
    const near = await run(`({ dots: atlas.map.queryRenderedFeatures({ layers: ["photo-webcams-dots"] }).length,
      pins: atlas.map.queryRenderedFeatures({ layers: ["photo-webcams"] }).length })`);
    check("веб-камеры: вблизи — значки", near.pins > 0 && near.dots === 0, JSON.stringify(near));
    // в ленте — только камеры со ссылкой прямо на картинку
    const camStrip = await run(`[...document.querySelectorAll(".photo-strip-item img")].map((i) => i.src).filter((s) => !s.includes("wikimedia")).length`);
    check("веб-камеры: в ленте — только с картинкой", camStrip <= near.pins, `${camStrip} в ленте`);
    await run(`atlas.toggle("photo/webcams", false).then(() => true)`);
  }

  // рельеф и горизонтали в горах: линии высот появились, 3D включается
  if (want("layers/contours") && mods.some((m) => m.id === "layers/contours")) {
    await run(`atlas.map.jumpTo({ center: [11.85, 46.55], zoom: 13 }); (async () => { await atlas.toggle("layers/contours", true); return true; })()`);
    for (let i = 0; i < 20 && !(await run(`atlas.map.getLayer("contours") ? atlas.map.queryRenderedFeatures({ layers: ["contours"] }).length > 0 : false`)); i++) await sleep(1000);
    await idle();
    const n = await run(`atlas.map.getLayer("contours") ? atlas.map.queryRenderedFeatures({ layers: ["contours"] }).length : -1`);
    check("горизонтали", n > 0, `${n} линий`);
    await shot("87-contours");
    const t3d = await run(`(async () => { await atlas.toggle("layers/terrain", true); atlas.map.jumpTo({ pitch: 60 }); await new Promise((r) => setTimeout(r, 4000)); const on = !!atlas.map.getTerrain(); return on; })()`);
    await shot("88-terrain3d");
    check("рельеф: тени и 3D одной кнопкой", t3d && await run(`!!atlas.map.getLayer("hillshade")`));
    await run(`(async () => { atlas.map.jumpTo({ pitch: 0 }); for (const id of ["layers/terrain", "layers/contours"]) await atlas.toggle(id, false); return true; })()`);
  }

  // пляжи (QLever), сёрфинг по всему миру и «Кайт в Эстонии» (kite-ee.json) у Таллина
  if (want("layers/beaches") && mods.some((m) => m.id === "layers/beaches")) {
    await run(`atlas.map.jumpTo({ center: [24.65, 59.47], zoom: 10.5 }); (async () => { for (const id of ["layers/beaches", "layers/surf", "layers/kite-ee"]) await atlas.toggle(id, true); return true; })()`);
    for (let i = 0; i < 45 && !(await run(`atlas.map.getLayer("beaches") && atlas.map.queryRenderedFeatures({ layers: ["beaches"] }).length > 0`)); i++) await sleep(1000);
    const eeStats = `atlas.modules().find((m) => m.id === "layers/kite-ee").stats()`;
    const b = await run(`({ beaches: atlas.map.queryRenderedFeatures({ layers: ["beaches"] }).length, ee: atlas.map.queryRenderedFeatures({ layers: ["kite-ee"] }).length, ...${eeStats} })`);
    check("пляжи и «Кайт в Эстонии»: споты, места «не катаются» и пути из файла", b.beaches > 0 && b.ee > 0 && b.points >= 250 && b.lines === 15, JSON.stringify({ ...b, kite: undefined }));
    // окно спота — как окно места (Грегори 2026-11-21): описание, ветер для спота, «Кайт: …», кнопки; таблица на 7 дней
    // со строкой «Кайт» — лента внизу по значку погоды под крестиком
    const spotPt = await run(`(() => { const f = atlas.map.queryRenderedFeatures({ layers: ["kite-ee"] }).filter((f) => f.properties.kind !== "kite-bad")
      .map((f) => atlas.map.project(f.geometry.coordinates)).find((q) => q.x > 40 && q.x < innerWidth - 90 && q.y > 120 && q.y < innerHeight - 160); return f && [f.x, f.y]; })()`);
    if (spotPt) {
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: spotPt[0], y: spotPt[1], button: "left", clickCount: 1 });
      for (let i = 0; i < 30 && !(await run(`/^Кайт: /.test(document.querySelector(".maplibregl-popup .wx-kite")?.textContent || "") && !!document.querySelector(".maplibregl-popup .wx-chip:not([hidden])")`)); i++) await sleep(500);
      await run(`document.querySelector(".maplibregl-popup .wx-chip")?.click(); true`);
      for (let i = 0; i < 30 && !(await run(`!!document.querySelector(".wx-bar:not([hidden]) .wx-k")`)); i++) await sleep(500);
      const spot = await run(`(() => { const p = document.querySelector(".maplibregl-popup"), b = document.querySelector(".wx-bar"); return p && { title: p.querySelector(".popup-title")?.textContent,
        dirs: p.querySelector(".kite-dirs")?.textContent, kite: p.querySelector(".wx-kite")?.textContent, grid: !!p.querySelector(".wx-grid"),
        buttons: p.querySelectorAll(".go-actions .go-act").length, bar: !b.hidden, days: b.querySelectorAll(".wx-dayname").length,
        cols: b.querySelectorAll(".wx-h").length, kiteRow: b.querySelectorAll(".wx-k").length, dark: b.querySelectorAll(".wx-h.wx-dark").length }; })()`);
      await shot("89b-spot-weather");
      check("кайт-спот: окно как у места — ветер для спота, «Кайт: …», кнопки; таблица на 7 дней со строкой «Кайт» — в ленте внизу",
        !!spot && /^Ветер для спота: [СЮЗВ]/.test(spot.dirs || "") && /^Кайт: /.test(spot.kite || "") && !spot.grid && spot.buttons > 0
        && spot.bar && spot.days >= 7 && spot.cols >= 48 && spot.kiteRow === spot.cols && spot.dark > 10, JSON.stringify(spot));
      await run(`document.querySelector(".wx-bar-x").click(); true`);
      // «Мои споты» (Грегори 2026-11-12): звёздочка в окне спота → в списке раздела полоса на 7 дней; щелчок — карта к споту и его окно; крестик — убрать
      const title = spot.title;
      await run(`document.querySelector(".maplibregl-popup .popup-star").click(); true`);
      const starOn = await run(`document.querySelector(".maplibregl-popup .popup-star").classList.contains("on")`);
      await run(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); true`);
      await run(openLayers("content/spots"));
      const ms = `atlas.modules().find((m) => m.id === "content/spots").stats()`;
      for (let i = 0; i < 30 && !(await run(`${ms}.rows > 0`)); i++) await sleep(500);
      const fav = await run(`(() => { const s = ${ms}, r = document.querySelector(".ks-row"); return { ...s, name: r?.querySelector(".ks-name")?.textContent,
        cells: r?.querySelectorAll(".ks-strip > i").length, dark: r?.querySelectorAll(".ks-strip > i.ks-dark").length }; })()`);
      await shot("89d-my-spots");
      await run(`document.querySelector(".ks-row").click(); true`);
      for (let i = 0; i < 30 && !(await run(`!!document.querySelector(".maplibregl-popup .wx-kite")`)); i++) await sleep(500);
      const back = await run(`document.querySelector(".maplibregl-popup .popup-title")?.textContent`);
      await run(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); true`);
      await run(`document.querySelector(".ks-line .search-delete").click(); true`);
      await sleep(300);
      const left = await run(`${ms}.favorites`);
      check("мои споты: звёздочка — в списке, полоса на 7 дней с ночью, щелчок — окно спота, крестик — убрать",
        starOn && fav.favorites === 1 && fav.name === title && fav.cells >= 48 && fav.dark > 10 && fav.wins.length === 1 && back === title && left === 0,
        JSON.stringify({ starOn, fav, back, left }));
      await run(`document.querySelector('[data-panel="spots"] .panel-btn[title=Закрыть]')?.click(); true`);
    }
    // правила безопасности кайта (Грегори 2026-11-12): от 6 м/с; с берега без спасателей — запрещено; направление спота
    const rates = await run(`import("./core/forecast.js").then(({ kiteRate: k }) => { const s = { sea: "0000000011111111", dirs: "SW,W,NW" }; // вода с юга до севера через запад
      return [k(9, 12, 270, s), k(9, 12, 90, s), k(9, 12, 90, { ...s, rescue: true }), k(5, 7, 270, s), k(9, 12, 180, s), k(15, 19, 270, s),
        k(10, 24, 270, s), k(9, 12, 270, { ...s, off: "W" }), k(9, 12, 247, s), k(9, 12, 180, { sea: s.sea })].join(","); })`);
    check("кайт: от 6 м/с; с берега — запрещено (при спасателях — оранжевое); направление спота; шторм",
      rates === "good,off,rescue,calm,dir,strong,storm,off,good,good", rates);
    await run(`atlas.toggle("weather/wind", true).then(() => true)`);
    for (let i = 0; i < 30 && !(await run(`${eeStats}.rated > 0`)); i++) await sleep(500);
    await sleep(800);
    const ring = await run(`(() => { const s = ${eeStats}; const levels = Object.values(s.kite);
      return { rated: s.rated, levels, layer: !!atlas.map.getLayer("kite-ee-kite"), drawn: atlas.map.queryRenderedFeatures({ layers: ["kite-ee-kite"] }).length }; })()`);
    check("кайт: при ветре споты в кадре оценены, на карте кольца — только рекомендации (без красного)",
      ring.rated > 0 && ring.layer && ring.levels.every((l) => /^(good|strong)$/.test(l)) && (ring.levels.length === 0 || ring.drawn > 0), JSON.stringify(ring));
    await shot("89c-kite-rings");
    // ползунок времени двигает и кольца (Грегори 2026-11-12: «направление меняется — и кружок должен реагировать»):
    // на каждом дневном шаге следующих дней кольца пересчитаны на это время
    const wind = `atlas.modules().find((m) => m.id === "weather/wind")`;
    const steps = [];
    // шаги — по местным часам от начала полосы: дневные 09:00 и 12:00 следующих четырёх дней
    const first = await run(`new Date().getHours()`);
    const day = [];
    for (let i = 1; i < 40 && day.length < 8; i++) if ([9, 12].includes((first - (first % 3) + 3 * i) % 24)) day.push(i);
    for (const i of day) {
      await run(`${wind}.setStep(${i}); true`);
      await sleep(900);
      steps.push(await run(`(() => { const s = ${eeStats}, at = ${wind}.stats().at; return { i: ${i}, h: new Date(at * 1000).getHours(), same: s.at === at, levels: Object.values(s.kite).join(""),
        drawn: atlas.map.queryRenderedFeatures({ layers: ["kite-ee-kite"] }).length }; })()`));
    }
    check("кайт: ползунок времени — кольца пересчитаны на выбранное время на каждом шаге",
      steps.length === 8 && steps.every((x) => x.same && [9, 12].includes(x.h) && (x.levels === "" || x.drawn > 0)), JSON.stringify(steps));
    // окно спота, лента и ползунок связаны (Грегори 2026-11-12): ползунок — рамка в ленте и «Кайт: …» окна на это время;
    // щелчок по столбцу — ползунок; «Кайт» над «Ветром»
    // карта могла уйти к споту («Мои споты») — точку спота взять заново
    const spotPt2 = await run(`(() => { const f = atlas.map.queryRenderedFeatures({ layers: ["kite-ee"] }).filter((f) => f.properties.kind !== "kite-bad")
      .map((f) => atlas.map.project(f.geometry.coordinates)).find((q) => q.x > 40 && q.x < innerWidth - 90 && q.y > 120 && q.y < innerHeight - 160); return f && [f.x, f.y]; })()`);
    if (spotPt2) {
      await run(`${wind}.setStep(0); true`);
      await sleep(400);
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: spotPt2[0], y: spotPt2[1], button: "left", clickCount: 1 });
      for (let i = 0; i < 30 && !(await run(`!!document.querySelector(".maplibregl-popup .wx-chip:not([hidden])")`)); i++) await sleep(500);
      await run(`document.querySelector(".maplibregl-popup .wx-chip")?.click(); true`);
      for (let i = 0; i < 30 && !(await run(`!!document.querySelector(".wx-bar:not([hidden]) .wx-k")`)); i++) await sleep(500);
      const link = await run(`(async () => { const b = document.querySelector(".wx-bar:not([hidden])"), wait = (ms) => new Promise((r) => setTimeout(r, ms));
        if (!b?.querySelector(".wx-k")) return { none: [...document.querySelectorAll(".maplibregl-popup .popup-title")].map((t) => t.textContent) };
        const rows = [...b.querySelectorAll(".wx-grid th")].map((t) => t.textContent).filter(Boolean);
        ${wind}.setStep(6); await wait(300);
        const atH = b.querySelector(".wx-h.wx-at")?.textContent, barH = new Date(${wind}.stats().at * 1000).getHours();
        const kite = document.querySelector(".maplibregl-popup .wx-kite")?.textContent || "";
        const td = [...b.querySelectorAll(".wx-h:not(.wx-past)")][10]; td.click(); await wait(300);
        const clicked = Number(td.textContent), barAfter = new Date(${wind}.stats().at * 1000).getHours();
        return { rows: rows.slice(0, 5), atH, barH, kite, clicked, barAfter, framed: td.classList.contains("wx-at") }; })()`);
      check("окно спота, лента и ползунок ветра связаны: ползунок двигает рамку и «Кайт: …» окна, щелчок по столбцу — ползунок; «Кайт» над «Ветром»",
        link.rows.join() === "Часы,°C,Откуда,Кайт,Ветер" && Number(link.atH) === link.barH && new RegExp(`· ${String(link.barH).padStart(2, "0")}:00`).test(link.kite)
        && link.clicked === link.barAfter && link.framed, JSON.stringify(link));
      await run(`document.querySelector(".wx-bar-x").click(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); true`);
    }
    await run(`${wind}.setStep(0); atlas.toggle("weather/wind", false).then(() => true)`);
    await sleep(600);
    const ringOff = await run(`({ kite: Object.keys(${eeStats}.kite).length, drawn: atlas.map.queryRenderedFeatures({ layers: ["kite-ee-kite"] }).length })`);
    check("кайт: ветер выключен — колец нет", ringOff.kite === 0 && ringOff.drawn === 0, JSON.stringify(ringOff));
    await shot("89-beaches-surf");
    await run(`(async () => { for (const id of ["layers/beaches", "layers/surf", "layers/kite-ee"]) await atlas.toggle(id, false); return true; })()`);
  }

  // погода: стрелки ветра с силой в м/с, прогноз по щелчку, радар осадков
  if (want("weather/wind") && mods.some((m) => m.id === "weather/wind")) {
    await run(`atlas.map.jumpTo({ center: [24.7, 59.45], zoom: 9 }); atlas.toggle("weather/wind", true).then(() => true)`);
    for (let i = 0; i < 20 && !(await run(`atlas.map.getLayer("wind") && atlas.map.queryRenderedFeatures({ layers: ["wind"] }).length > 0`)); i++) await sleep(1000);
    const w = await run(`atlas.map.queryRenderedFeatures({ layers: ["wind"] }).map((f) => f.properties.ms)`);
    check("ветер: узлы сетки (щёлкаются, прогноз)", w.length > 0, `${w.length} узлов, ${w.slice(0, 5).join(", ")} м/с`);
    // лента прогноза вместо ползунка (Грегори 2026-11-14): 5 прошедших дней (бледнее) и 7 вперёд по 3 часа,
    // в рамке и в виду — сейчас; в шапке — кнопки «Ветер» (включён — затенена) и «Осадки»; кнопки карты не закрывает
    // (на телефоне лента лежит под ними — кнопки поверх и нажимаются, Грегори 2026-11-15)
    const wind = `atlas.modules().find((m) => m.id === "weather/wind")`;
    for (let i = 0; i < 20 && !(await run(`document.querySelectorAll(".wx-bar .wx-h").length > 0`)); i++) await sleep(500);
    await sleep(300);
    const barNow = await run(`(() => { const b = document.querySelector(".wx-bar"), r = b.getBoundingClientRect(),
      hit = [...document.querySelectorAll(".btn.glass, .wheel-toggle, .places-toggle")].filter((x) => x.offsetParent).some((x) => { const q = x.getBoundingClientRect(); return q.right > r.left && q.left < r.right && q.bottom > r.top && q.top < r.bottom
        && !x.contains(document.elementFromPoint((q.left + q.right) / 2, (q.top + q.bottom) / 2)); });
      const hs = [...b.querySelectorAll(".wx-h")], at = b.querySelector(".wx-h.wx-at"), q = at?.getBoundingClientRect(), w = b.querySelector(".wx-grid-wrap").getBoundingClientRect();
      return { shown: !b.hidden, name: b.querySelector(".wx-bar-name").textContent, when: b.querySelector(".wx-bar-when").textContent, cols: hs.length,
        past: b.querySelectorAll(".wx-h.wx-past").length, atIdx: hs.indexOf(at), inView: !!q && q.left >= w.left && q.right <= w.right + 1,
        layers: [...b.querySelectorAll(".wx-bar-layer")].map((x) => x.classList.contains("on")).join(), hit,
        gust: atlas.map.queryRenderedFeatures({ layers: ["wind"] })[0]?.properties.gl }; })()`);
    // заливка цветом силы ветра, как у Windy (Грегори 2026-11-12): картинка под подписями, перекрашивается со временем
    const fill0 = await run(`({ layer: !!atlas.map.getLayer("wind-fill"), below: (() => { const ls = atlas.map.getStyle().layers.map((l) => l.id); return ls.indexOf("wind-fill") < ls.indexOf("wind"); })(), ...${wind}.stats().fill })`);
    const before = await run(`JSON.stringify(atlas.map.queryRenderedFeatures({ layers: ["wind"] }).map((f) => f.properties.dir).slice(0, 8))`);
    // щелчок по столбцу ленты на 20 шагов вперёд — стрелки на это время
    await run(`(() => { const hs = [...document.querySelectorAll(".wx-bar .wx-h")]; hs[hs.findIndex((x) => x.classList.contains("wx-at")) + 20].click(); return true; })()`);
    await sleep(800);
    const later = await run(`({ at: ${wind}.stats().at, when: document.querySelector(".wx-bar-when").textContent,
      dirs: JSON.stringify(atlas.map.queryRenderedFeatures({ layers: ["wind"] }).map((f) => f.properties.dir).slice(0, 8)) })`);
    const fill1 = await run(`${wind}.stats().fill`);
    check("ветер: заливка цветом силы ветра под штрихами, плавная; время ленты перекрашивает", fill0.layer && fill0.below && fill0.w > 50 && fill0.painted > fill0.w * fill0.h * 0.8 && fill1.sum !== fill0.sum,
      JSON.stringify({ fill0, fill1 }));
    check("ветер: лента прогноза — 5 дней назад и 7 вперёд по 3 часа, в рамке и в виду сейчас, кнопки «Ветер» (вкл.) и «Осадки»; столбец — стрелки на его время; кнопки не закрывает",
      barNow.shown && barNow.name === "Центр карты" && barNow.when === "Сейчас" && barNow.cols >= 94 && barNow.past >= 40 && barNow.atIdx === barNow.past && barNow.inView
      && barNow.layers === "true,false" && !barNow.hit && /^ [0-9]+$/.test(barNow.gust)
      && later.at > Date.now() / 1000 + 50 * 3600 && later.when !== "Сейчас" && later.dirs !== before, JSON.stringify({ barNow, later: { at: later.at, when: later.when }, same: later.dirs === before, before, dirs: later.dirs }));
    // стрелка ближе к центру — у краёв её закрывают строка поиска и кнопки
    const p = await run(`(() => { const c = atlas.map.project(atlas.map.getCenter()); return atlas.map.queryRenderedFeatures({ layers: ["wind"] })
      .map((f) => atlas.map.project(f.geometry.coordinates)).filter((q) => q.x > 30 && q.x < innerWidth - 70 && q.y > 80 && q.y < document.querySelector(".wx-bar").getBoundingClientRect().top - 40)
      .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0]; })()`);
    await clickAt(p.x, p.y);
    for (let i = 0; i < 10 && !(await run(`/порывы/.test(document.querySelector(".maplibregl-popup .wx-now")?.textContent || "")`)); i++) await sleep(500);
    await sleep(1200);
    const fc = await run(`({ sub: document.querySelector(".maplibregl-popup .wx-view .popup-sub")?.textContent, bar: document.querySelector(".wx-bar-when").textContent,
      name: document.querySelector(".wx-bar-name").textContent, head: document.querySelector(".maplibregl-popup .wx-now")?.textContent,
      above: document.querySelector(".maplibregl-popup").getBoundingClientRect().bottom <= document.querySelector(".wx-bar").getBoundingClientRect().top + 1 })`);
    check("ветер: щелчок по узлу — окно погоды в точке на время ленты, лента — на эту точку; окно над лентой",
      fc.sub?.includes(fc.bar.split(" · ")[1]) && fc.bar !== "Сейчас" && fc.name === "Погода в точке" && /порывы/.test(fc.head) && fc.above, JSON.stringify(fc));
    // бегущие линии (Грегори 2026-11-13: «как в Windy с анимацией»): частицы бегут, на холсте есть линии;
    // карту двигают — линий нет; узлы сетки невидимы (стрелок нет)
    await run(`document.querySelector(".maplibregl-popup")?.remove(); true`);
    const fl0 = await run(`${wind}.stats().flow`);
    await sleep(1500);
    const fl1 = await run(`(() => { const c = document.querySelector(".wind-flow"), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data;
      let lit = 0; for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 40) lit++;
      return { ...${wind}.stats().flow, lit, under: c.previousElementSibling === atlas.map.getCanvas(), arrows: atlas.map.getPaintProperty("wind", "icon-opacity") }; })()`);
    const flMove = await run(`(async () => { atlas.map.panBy([40, 0], { duration: 600 }); await new Promise((r) => setTimeout(r, 300));
      const c = document.querySelector(".wind-flow"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let lit = 0; for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 40) lit++;
      await new Promise((r) => setTimeout(r, 1500)); return { lit, after: ${wind}.stats().flow.frames }; })()`);
    check("ветер: бегущие линии — частицы бегут по полю ветра, при движении карты спрятаны; стрелок нет",
      fl1.on && fl1.particles > 100 && fl1.cells > 100 && fl1.frames > fl0.frames + 5 && fl1.lit > 50 && fl1.under && fl1.arrows === 0
      && flMove.lit === 0 && flMove.after > fl1.frames, JSON.stringify({ fl0, fl1, flMove }));
    await shot("90-wind");
    // крестик ленты — лента ушла, ветер выключен
    await run(`document.querySelector(".maplibregl-popup")?.remove(); document.querySelector(".wx-bar-x").click(); true`);
    await sleep(500);
    const off = await run(`({ bar: document.querySelector(".wx-bar").hidden, layer: !!atlas.map.getLayer("wind"), on: ${wind}.active })`);
    check("ветер: крестик ленты прогноза закрывает её и выключает ветер", off.bar && !off.layer && !off.on, JSON.stringify(off));
    await run(`atlas.map.jumpTo({ center: [15, 52], zoom: 4 }); atlas.toggle("weather/radar", true).then(() => true)`);
    await sleep(3000);
    const frames = await run(`atlas.map.getStyle().layers.filter((l) => l.id.startsWith("radar-")).length`);
    check("осадки: кадры радара", frames > 0, `${frames}`);
    await idle();
    await shot("91-radar");
    await run(`atlas.toggle("weather/radar", false).then(() => true)`);
  }

  // погода места (Грегори 2026-11-14): под крестиком окна места — температура и осадки; щелчок — окно погоды
  // и лента прогноза внизу, тяжёлые «Ветер» и «Осадки» сами не включаются (кнопки в шапке ленты);
  // «Назад» — снова окно места, ленты нет
  if (want("core/forecast")) {
    await run(`atlas.map.jumpTo({ center: [24.75, 59.437], zoom: 11 }); true`);
    await idle();
    await clickAt(...(CAR ? [640, 100] : [40, 400])); // на магнитоле в 40, 400 — подпись Табасалу
    for (let i = 0; i < 20 && !(await run(`!!document.querySelector(".maplibregl-popup .wx-chip:not([hidden])")`)); i++) await sleep(500);
    const chip = await run(`(() => { const c = document.querySelector(".maplibregl-popup .wx-chip"), x = document.querySelector(".maplibregl-popup-close-button");
      const q = c?.getBoundingClientRect(), r = x?.getBoundingClientRect(), t = document.querySelector(".maplibregl-popup .popup-coords")?.getBoundingClientRect();
      return { text: c?.textContent, under: !!q && q.top >= r.bottom - 2 && Math.abs((q.left + q.right) / 2 - (r.left + r.right) / 2) < 30, clear: !!t && t.right <= q.left + 1 }; })()`);
    check("погода места: под крестиком окна — температура и осадки, текст не заходит под них",
      /^-?[0-9]+°[0-9]+(,[0-9])?↑$/.test(chip.text) && chip.under && chip.clear, JSON.stringify(chip));
    await run(`document.querySelector(".maplibregl-popup .wx-chip").click(); true`);
    for (let i = 0; i < 20 && !(await run(`document.querySelectorAll(".wx-bar .wx-h").length > 0`)); i++) await sleep(500);
    await sleep(500);
    // щелчок по значку — лента внизу, окно места не меняется (Грегори 2026-11-14: «не меняй окно»)
    const wx = await run(`(() => { const b = document.querySelector(".wx-bar"), hs = [...b.querySelectorAll(".wx-h")], c = document.querySelector(".maplibregl-popup .wx-chip");
      return { coords: !!document.querySelector(".maplibregl-popup .popup-coords"), on: c.classList.contains("on"), wind: !!c.querySelector(".wx-dir"),
        bar: !b.hidden, name: b.querySelector(".wx-bar-name").textContent,
        rows: [...b.querySelectorAll(".wx-grid tr:not(.wx-days-row)")].map((tr) => tr.querySelector("th").textContent || (tr.classList.contains("wx-sky-row") ? "☀" : "?")).join(),
        sky: [...b.querySelectorAll(".wx-sky")].filter((td) => td.querySelector("svg") && td.title).length, skyN: b.querySelectorAll(".wx-sky").length, past: b.querySelectorAll(".wx-h.wx-past").length, atIdx: hs.indexOf(b.querySelector(".wx-h.wx-at")),
        heavy: !!atlas.map.getLayer("wind") || atlas.map.getStyle().layers.some((l) => l.id.startsWith("radar-")),
        above: document.querySelector(".maplibregl-popup").getBoundingClientRect().bottom <= b.getBoundingClientRect().top + 1 }; })()`);
    check("погода места: щелчок по значку — лента прогноза на место (сейчас в рамке, прошлое есть), окно места то же, значок затенён, в нём стрелка ветра; ветер и осадки не включились",
      wx.coords && wx.on && wx.wind && wx.bar && wx.name === "Погода в точке" && wx.past >= 40 && wx.atIdx === wx.past && !wx.heavy && wx.above, JSON.stringify(wx));
    // порядок строк ленты — как у Windy (Грегори 2026-11-14), под часами — значок погоды у каждого шага
    check("погода места: строки ленты — часы, значок погоды, °C, откуда, ветер, порывы, осадки",
      /^Часы,☀,°C,Откуда,Ветер,Порывы,Осадки(,Волна)?$/.test(wx.rows) && wx.skyN >= 94 && wx.sky === wx.skyN, JSON.stringify({ rows: wx.rows, sky: wx.sky, skyN: wx.skyN }));
    await shot("92-place-weather");
    // окно раздела слева и сообщение — выше ленты (Грегори 2026-11-17: на магнитоле окно настроек заходило на ленту)
    const clear = await run(`(async () => { (await import("./core/events.js")).emit("settings-open"); await new Promise((r) => setTimeout(r, 800));
      atlas.ctx.status("Проба сообщения"); await new Promise((r) => setTimeout(r, 200));
      const bar = document.querySelector(".wx-bar").getBoundingClientRect().top, p = document.querySelector('[data-panel="settings"]').getBoundingClientRect().bottom, s = document.querySelector(".status").getBoundingClientRect().bottom;
      document.querySelector('[data-panel="settings"] .panel-btn[title=Закрыть]').click(); atlas.ctx.status("");
      return { bar: Math.round(bar), panel: Math.round(p), status: Math.round(s) }; })()`);
    check("погода места: окно слева и сообщение — выше ленты прогноза", clear.panel <= clear.bar && clear.status <= clear.bar, JSON.stringify(clear));
    // колесо мыши листает ленту вбок: к себе — назад, в прошлое (Грегори 2026-11-14: «наоборот»)
    const wheel = await run(`(() => { const w = document.querySelector(".wx-bar .wx-grid-wrap"), s0 = w.scrollLeft;
      w.dispatchEvent(new WheelEvent("wheel", { deltaY: 300, bubbles: true, cancelable: true })); return { s0, s1: w.scrollLeft }; })()`);
    check("погода места: колесо мыши к себе листает ленту назад", wheel.s1 < wheel.s0, JSON.stringify(wheel));
    // столбец ленты — время ленты; кнопка «Ветер» в шапке — включает и выключает слой, лента остаётся
    await run(`(() => { const hs = [...document.querySelectorAll(".wx-bar .wx-h")]; hs[hs.findIndex((x) => x.classList.contains("wx-at")) + 8].click(); return true; })()`);
    await sleep(300);
    const picked = await run(`document.querySelector(".wx-bar-when").textContent`);
    await run(`document.querySelector('.wx-bar-layer[data-id="weather/wind"]').click(); true`);
    for (let i = 0; i < 20 && !(await run(`!!atlas.map.getLayer("wind")`)); i++) await sleep(300);
    const windBtn = await run(`({ layer: !!atlas.map.getLayer("wind"), on: document.querySelector('.wx-bar-layer[data-id="weather/wind"]').classList.contains("on"),
      name: document.querySelector(".wx-bar-name").textContent, at: atlas.modules().find((m) => m.id === "weather/wind").stats().at })`);
    await run(`document.querySelector('.wx-bar-layer[data-id="weather/wind"]').click(); true`);
    await sleep(600);
    const windOff = await run(`({ layer: !!atlas.map.getLayer("wind"), bar: !document.querySelector(".wx-bar").hidden })`);
    check("погода места: столбец ленты — время ленты; «Ветер» в шапке ленты включает слой на это время и выключает, лента остаётся",
      !/^Сейчас/.test(picked) && windBtn.layer && windBtn.on && windBtn.name === "Погода в точке" && windBtn.at > Date.now() / 1000 + 12 * 3600
      && !windOff.layer && windOff.bar, JSON.stringify({ picked, windBtn, windOff }));
    // второй щелчок по значку — ленты нет, время — снова сейчас; крестик ленты — тоже, значок гаснет
    await run(`document.querySelector(".maplibregl-popup .wx-chip").click(); true`);
    await sleep(300);
    const again = await run(`({ coords: !!document.querySelector(".maplibregl-popup .popup-coords"), on: document.querySelector(".maplibregl-popup .wx-chip").classList.contains("on"),
      actions: !!document.querySelector(".maplibregl-popup .go-actions")?.offsetParent, navon: !!document.querySelector(".maplibregl-popup .go-navon")?.offsetParent,
      bar: !document.querySelector(".wx-bar").hidden, when: document.querySelector(".wx-bar-when").textContent })`);
    await run(`document.querySelector(".maplibregl-popup .wx-chip").click(); true`);
    await sleep(300);
    const reopen = await run(`document.querySelector(".maplibregl-popup .wx-chip").classList.contains("on") && !document.querySelector(".wx-bar").hidden`);
    // лента открыта — значок в окне другого места тоже затенён, щелчок убирает ленту, а не открывает заново
    await clickAt(...(CAR ? [760, 110] : [60, 430])); // первый щелчок по карте закрывает окно, второй — окно другого места
    await sleep(300);
    await clickAt(...(CAR ? [760, 110] : [60, 430]));
    for (let i = 0; i < 20 && !(await run(`!!document.querySelector(".maplibregl-popup .wx-chip:not([hidden])")`)); i++) await sleep(500);
    const other = await run(`document.querySelector(".maplibregl-popup .wx-chip").classList.contains("on")`);
    await run(`document.querySelector(".maplibregl-popup .wx-chip").click(); true`);
    await sleep(300);
    const otherOff = await run(`!document.querySelector(".maplibregl-popup .wx-chip").classList.contains("on") && document.querySelector(".wx-bar").hidden`);
    await run(`document.querySelector(".maplibregl-popup .wx-chip").click(); true`);
    await sleep(300);
    await run(`document.querySelector(".wx-bar-x").click(); true`);
    await sleep(300);
    const shutX = await run(`({ on: document.querySelector(".maplibregl-popup .wx-chip").classList.contains("on"), bar: !document.querySelector(".wx-bar").hidden })`);
    check("погода места: второй щелчок по значку (и в окне другого места) и крестик ленты убирают её, значок гаснет; без навигации в окне только «Навигация»",
      again.coords && !again.on && !again.bar && again.when === "Сейчас" && !again.actions && again.navon && reopen && other && otherOff && !shutX.on && !shutX.bar, JSON.stringify({ again, reopen, other, otherOff, shutX }));
    await run(`document.querySelector(".maplibregl-popup")?.remove(); true`);
  }

  // GPS приложения Android (AtlasGps в MainActivity, Грегори 2026-11-19: «магнитола не определяет локацию»): окно
  // браузера замера не даёт — через 10 с подсказка, сколько видно спутников; замер приложения ставит метку; выключили — GPS приложения выключен
  if (want("core/native-gps")) {
    await send("Emulation.setGeolocationOverride", {}); // браузер места не знает
    await run(`(() => { const calls = []; window.AtlasGps = { calls, start: () => calls.push("start"), stop: () => calls.push("stop"),
      info: () => JSON.stringify({ allowed: true, hasGps: true, gps: true, net: false, sats: 7, used: 2, running: true }) }; return true; })()`);
    await run(`window.confirm = () => true; document.querySelector(".geo-btn").click(); true`);
    await sleep(11500);
    const g1 = await run(`({ text: document.querySelector("#status").textContent, calls: AtlasGps.calls.slice(), dot: !!document.querySelector(".geo-dot") })`);
    check("GPS приложения: включён с навигацией, через 10 с без замера — сколько видно спутников", g1.calls[0] === "start" && /видно 7, для замера годится 2/.test(g1.text) && !g1.dot, JSON.stringify(g1));
    await run(`atlasNativeFix({ lat: 59.437, lon: 24.745, acc: 5, alt: null, heading: null, speed: null, t: Date.now(), precise: true }); true`);
    await sleep(1200);
    const g2 = await run(`({ text: document.querySelector("#status").textContent, dot: !!document.querySelector(".geo-dot"), pos: atlas.geo.state().position })`);
    check("GPS приложения: замер — метка на месте, подсказка убрана", g2.dot && !g2.text && Math.abs(g2.pos[0] - 24.745) < 1e-6, JSON.stringify(g2));
    await run(`window.confirm = () => true; document.querySelector(".geo-btn").click(); true`);
    await sleep(300);
    if (await run(`atlas.geo.state().on`)) await run(`window.confirm = () => true; document.querySelector(".geo-btn").click(); true`);
    const g3 = await run(`({ calls: AtlasGps.calls.slice(), fix: window.atlasNativeFix })`);
    check("GPS приложения: навигацию выключили — GPS приложения выключен", g3.calls.includes("stop") && !g3.fix, JSON.stringify(g3));
    await run(`delete window.AtlasGps; true`);
    await send("Emulation.setGeolocationOverride", { latitude: 59.437, longitude: 24.745, accuracy: 5 });
  }

  // фото на треке: пояс камеры подбирается по снимкам с местом (камера на часах другого пояса — +5 ч от UTC);
  // снимок без места встаёт на трек тем же сдвигом; пояс из EXIF — точно; снимок вне времени трека — не на треке
  if (want("content/tracks")) {
    const z = await run(`(async () => { const { placePhotos } = await import("./content/tracks.js");
      const T0 = Date.UTC(2024, 4, 5, 9, 0, 0), seg = Array.from({ length: 21 }, (_, i) => [24.83 + i * 0.001, 59.47, 5, T0 + i * 60000]);
      const W = (min) => T0 + min * 60000 + 5 * 3600000; // часы камеры: UTC+5
      const out = placePhotos({ segs: [seg] }, [
        { id: "gps", wall: W(4), at: null, lat: 59.47, lon: 24.834 },
        { id: "gps2", wall: W(16), at: null, lat: 59.47, lon: 24.846 },
        { id: "nogps", wall: W(10), at: null },
        { id: "tz", wall: 0, at: T0 + 12 * 60000 },
        { id: "late", wall: W(90), at: null } ]);
      return out.map((x) => [x.id, Math.round((x.pt[0] - 24.83) * 1000)]); })()`);
    check("треки: фото на треке — пояс камеры подобран по снимкам с местом, без места — тем же сдвигом, вне трека — нет",
      JSON.stringify(z) === JSON.stringify([["gps", 4], ["nogps", 10], ["tz", 12], ["gps2", 16]]), JSON.stringify(z));
  }

  // HEIC с iPhone (core/heic.js): Chrome сам не показывает — декодер libheif по первому снимку; картинка, копия
  // для <img>, дата и место из EXIF; в своей папке — альбом с миниатюрой (tools/test-photo.heic — выдуманный 96×64)
  if (want("core/heic")) {
    const h = await run(`(async () => { const m = await import("./core/heic.js"); const blob = await (await fetch("tools/test-photo.heic")).blob();
      const bmp = await m.heicBitmap(blob); const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d"); c.drawImage(bmp, 0, 0);
      const top = [...c.getImageData(10, 10, 1, 1).data], low = [...c.getImageData(10, 55, 1, 1).data];
      const jpg = await m.heicViewable(blob), img = new Image(); img.src = URL.createObjectURL(jpg); await img.decode();
      const e = await (await import("https://unpkg.com/exifr@7.1.3/dist/full.esm.mjs")).default.parse(blob, { gps: true, exif: true });
      return { w: bmp.width, h: bmp.height, top, low, type: jpg.type, iw: img.naturalWidth, lat: e?.latitude, lon: e?.longitude, date: e?.DateTimeOriginal?.toISOString?.() }; })()`);
    check("HEIC: снимок раскрыт — размер и цвета на месте, для просмотра — JPEG", h.w === 96 && h.h === 64 && h.top[2] > 150 && h.low[1] > 120 && h.low[2] < 120
      && h.iw === 96 && (h.type === "image/jpeg" || h.type === "image/heic" || h.type === ""), JSON.stringify(h));
    check("HEIC: дата и место из EXIF", Math.abs(h.lat - 59.437) < 0.001 && Math.abs(h.lon - 24.745) < 0.001 && /^2024-05-01/.test(h.date || ""), JSON.stringify(h));
    if (!PHONE && !CAR) {
      const al = `atlas.modules().find((m) => m.id === "content/albums")`;
      await run(`(async () => { const data = await (await fetch("tools/test-photo.heic")).blob();
        const file = { kind: "file", name: "IMG_0001.HEIC", getFile: async () => new File([data], "IMG_0001.HEIC", { lastModified: 1 }) };
        const dir = (name, items) => ({ kind: "directory", name, items, async *entries() { for (const i of items) yield [i.name, i]; }, async *values() { for (const i of items) yield i; },
          getDirectoryHandle: async () => { throw new DOMException("нет", "NotFoundError"); }, isSameEntry: async (o) => o?.name === name,
          queryPermission: async () => "granted", requestPermission: async () => "granted" });
        window.showDirectoryPicker = async () => dir("iPhone", [dir("20240501 Снимки iPhone", [file])]); return true; })()`);
      await run(`${al}.pickFolder(); true`);
      for (let i = 0; i < 30 && !(await run(`${al}.stats().photos >= 1 && !${al}.stats().busy`)); i++) await sleep(500);
      await run(openLayers("content/albums"));
      await sleep(800);
      await run(`${al}.openFirst("Снимки iPhone")`);
      for (let i = 0; i < 40 && !(await run(`!!document.querySelector(".al-cell img")?.naturalWidth`)); i++) await sleep(500);
      const a = await run(`(() => { const s = ${al}.stats(), img = document.querySelector(".al-cell img"); return { open: s.open, cells: document.querySelectorAll(".al-cell").length, img: img?.naturalWidth || 0,
        country: document.querySelector('[data-panel="albums"] .panel-title')?.textContent, est: s.countries.some((c) => /Эстония/.test(c)) }; })()`);
      check("HEIC: в своей папке — альбом, место по EXIF (Эстония), миниатюра", a.open === "Снимки iPhone" && a.cells === 1 && a.img > 0 && a.est, JSON.stringify(a));
      await shot("98-heic-album");
      await run(`${al}.forgetFolder("iPhone"); true`);
      await run(exitMode);
      await sleep(300);
      await run(closeLayers);
    }
  }

  // размер кнопок и текста (core/ui-scale.js, Грегори 2026-11-17): на магнитоле сам крупный (страница 1024×576
  // растянута на экран, карта рисуется подробнее — не размыта); на телефоне выбирается в настройках и
  // возвращается; на компьютере кнопки неактивны с подсказкой про Ctrl и +
  if (want("core/ui-scale")) {
    const st = `({ s: atlasUi.scale, w: innerWidth, h: innerHeight, pr: atlas.map.getPixelRatio(), dpr: devicePixelRatio })`;
    const u0 = await run(st);
    check(`размер: ${CAR ? "на магнитоле сам крупный, карта не размыта" : "обычный"}`, CAR ? u0.s === 1.25 && u0.w === 1024 && u0.h === 576 && u0.pr === 1.25 * u0.dpr : u0.s === 1 && u0.pr === u0.dpr, JSON.stringify(u0));
    const ui = await run(`(async () => { (await import("./core/events.js")).emit("settings-open"); await new Promise((r) => setTimeout(r, 800));
      const b = [...document.querySelectorAll(".size-btn")]; return { n: b.length, off: b.map((x) => x.disabled), on: b.map((x) => x.classList.contains("on")), why: document.querySelector(".size-why")?.textContent }; })()`);
    if (!PHONE && !CAR) check("размер: на компьютере кнопки неактивны, сказано про Ctrl и +", ui.n === 4 && ui.off.every(Boolean) && ui.why.includes("Ctrl"), JSON.stringify(ui));
    else check("размер: в настройках четыре кнопки, выбрано «Авто»", ui.n === 4 && !ui.off.some(Boolean) && ui.on[0] && !ui.why, JSON.stringify(ui));
    if (PHONE) {
      const big = await run(`(async () => { document.querySelectorAll(".size-btn")[2].click(); await new Promise((r) => setTimeout(r, 800)); return ${st}; })()`);
      const back = await run(`(async () => { document.querySelectorAll(".size-btn")[0].click(); await new Promise((r) => setTimeout(r, 800)); return ${st}; })()`);
      check("размер: «Крупный» на телефоне — страница уже в 1,25 раза, «Авто» — как было", big.s === 1.25 && big.w === 312 && big.pr === 1.25 * big.dpr && back.s === 1 && back.w === u0.w, JSON.stringify({ big, back }));
    }
    await run(settingsToggle);
  }

  // «Скачать район» (core/offline.js, sw.js): маленький район — кнопка в настройках, пакет в списке, плитки
  // в «atlas-trip» (ключ OpenFreeMap без номера выпуска — плитка с чужим выпуском отдаётся с устройства),
  // шрифты, значки, файлы программы и библиотеки; большой район — кнопка неактивна с подсказкой; удалить
  if (want("core/offline")) {
    // скачивается только «Яркая» и «Контрастная»: на «Тёмной» (CARTO) кнопка неактивна, сказано почему
    const carto = await run(`(async () => { const b = await import("./core/basemaps.js"); b.setBasemap(b.BASEMAPS.find((x) => x.id === "dark")); await new Promise((r) => setTimeout(r, 1500));
      (await import("./core/events.js")).emit("settings-open"); await new Promise((r) => setTimeout(r, 800));
      const r = { off: document.querySelector(".trip-dl").disabled, why: document.querySelector(".trip-why").textContent };
      b.setBasemap(b.BASEMAPS.find((x) => x.id === "liberty")); await new Promise((r) => setTimeout(r, 1500)); return r; })()`);
    check("без сети: «Тёмную» скачать нельзя — кнопка неактивна, сказано, какую выбрать", carto.off && carto.why.includes("«Яркую»"), JSON.stringify(carto));
    await idle();
    await run(`atlas.map.jumpTo({ center: [24.745, 59.437], zoom: 15, pitch: 0, bearing: 0 }); navigator.serviceWorker.ready.then(() => true)`);
    await idle();
    await run(`document.querySelector('[data-panel="settings"]').hidden ? (async () => { (await import("./core/events.js")).emit("settings-open"); await new Promise((r) => setTimeout(r, 800)); return true; })() : true`);
    const before = await run(`import("./core/offline.js").then((o) => o.trips().length)`);
    const ui = await run(`(() => { const b = document.querySelector(".trip-dl"); return { has: !!b, on: !!b && !b.disabled, title: b?.closest(".panel-body")?.querySelector(".trip-box")?.previousElementSibling?.textContent }; })()`);
    check("без сети: «Скачать район на карте» в настройках, активна", ui.has && ui.on && ui.title === "Карта без сети", JSON.stringify(ui));
    await run(`document.querySelector(".trip-dl").click(); true`);
    let prog = "";
    for (let i = 0; i < 300 && (await run(`import("./core/offline.js").then((o) => o.trips().length)`)) === before; i++) { if (!prog) prog = await run(`document.querySelector(".trip-prog")?.textContent || ""`); await sleep(1000); }
    const r = await run(`(async () => { const o = await import("./core/offline.js"); const t = o.trips().at(-1);
      const keys = (await (await caches.open("atlas-trip")).keys()).map((q) => q.url), app = (await (await caches.open("atlas-app")).keys()).map((q) => q.url);
      const tile = keys.find((k) => k.includes("/planet/_/14/") && k.endsWith(".pbf"));
      const fake = tile && await fetch(tile.replace("/_/", "/00000000_zz_test/")).then((x) => x.ok && x.arrayBuffer()).then((b) => b && b.byteLength).catch(() => 0);
      await new Promise((r) => setTimeout(r, 600));
      return { title: t?.title, tiles: t?.tiles, bytes: t?.bytes, n: keys.length, tile: !!tile, fake, glyph: keys.some((k) => k.includes("/fonts/")), sprite: keys.some((k) => k.includes("/sprites/")),
        app: app.length, lib: app.some((u) => u.includes("maplibre-gl.mjs")), nav: app.some((u) => u.endsWith("/content/navigation.js")), index: app.some((u) => u.endsWith("/index.html")),
        ctl: !!navigator.serviceWorker.controller, row: [...document.querySelectorAll(".trip-list .set-item-title")].map((e) => e.textContent), dl: !document.querySelector(".trip-dl").disabled }; })()`);
    check("без сети: район скачан — плитки, шрифты, значки, в списке с названием", r.tiles > 10 && r.bytes > 0 && r.tile && r.glyph && r.sprite && r.row.includes(r.title) && r.dl, JSON.stringify({ ...r, prog }));
    // место на устройстве: всего, полоса и строки; скачанная поездка — в «Картах для поездок»
    const place = await run(`(async () => { (await import("./core/events.js")).emit("settings-open"); await new Promise((r) => setTimeout(r, 1200));
      const rows = [...document.querySelectorAll(".place-row")].map((r) => [r.querySelector(".set-item-title").textContent, r.querySelector(".place-size").textContent]);
      return { sum: document.querySelector(".place-sum")?.textContent, segs: document.querySelectorAll(".place-seg").length, rows }; })()`);
    check("место на устройстве: занято всего, полоса по видам, скачанная карта — в «Картах для поездок»", /^Занято \d/.test(place.sum || "") && place.segs >= 1 && place.rows.length === 5
      && place.rows[0][0] === "Карты для поездок" && /[КМГ]Б$/.test(place.rows[0][1]), JSON.stringify(place));
    check("без сети: файлы программы и библиотеки на устройстве", r.app > 30 && r.lib && r.nav && r.index, `${r.app} файлов`);
    check("без сети: скачанная плитка отдаётся с устройства и при новом выпуске карты", r.ctl && r.fake > 0, `${r.fake} байт`);
    await shot("97-offline-settings");
    // экскурсии и разговорники: копии текстов и мест остановок у поездки переживают «Очистить историю просмотра»
    const tx = await run(`(async () => { const o = await import("./core/offline.js"), st = await import("./core/storage.js"); const t = o.trips().at(-1);
      const list = (await st.cacheGet("trip/" + t.id)) || [], idb = list.filter((k) => k.startsWith("idb:")).map((k) => k.slice(4));
      const text = idb.find((k) => k.startsWith("repo/text/")), geo = idb.filter((k) => k.startsWith("geo/")).length;
      await st.clearViewCache();
      const after = text && await st.cacheGet(text);
      return { texts: t.texts, tours: t.tours, country: t.country, kept: idb.length, geo, survives: typeof after === "string" && after.length > 0, sub: [...document.querySelectorAll(".trip-list .set-item-sub")].map((e) => e.textContent).at(-1) }; })()`);
    check("без сети: экскурсии и разговорники — тексты у поездки, переживают очистку истории", tx.texts > 50 && tx.kept > 50 && tx.survives && tx.country === "Эстония", JSON.stringify(tx));
    check("без сети: экскурсии страны — места остановок найдены заранее", tx.tours === 0 || tx.geo > 0, JSON.stringify(tx));
    await run(`atlas.map.jumpTo({ center: [10, 50], zoom: 5 }); new Promise((r) => setTimeout(() => r(true), 800))`);
    const big = await run(`({ off: document.querySelector(".trip-dl").disabled, why: document.querySelector(".trip-why").textContent, dim: +getComputedStyle(document.querySelector(".trip-dl")).opacity })`);
    check("без сети: большой район — кнопка неактивна и блёклая, сказано почему", big.off && big.dim < 0.6 && /приблизьте/i.test(big.why), JSON.stringify(big));
    await run(`(async () => { [...document.querySelectorAll(".trip-list .text-btn")].filter((b) => b.textContent === "Удалить").at(-1).click(); for (let i = 0; i < 30 && document.querySelector(".trip-list")?.children.length > ${before}; i++) await new Promise((r) => setTimeout(r, 200)); return true; })()`);
    const gone = await run(`(async () => { const st = await import("./core/storage.js"); return { list: (await import("./core/offline.js")).trips().length, keys: (await (await caches.open("atlas-trip")).keys()).length,
      copies: await new Promise((r) => { const q = indexedDB.open("atlas"); q.onsuccess = () => { const k = q.result.transaction("cache").objectStore("cache").getAllKeys(); k.onsuccess = () => r(k.result.filter((x) => String(x).startsWith("trip/repo/")).length); }; }) }; })()`);
    check("без сети: «Удалить» убирает район, его плитки и копии текстов", gone.list === before && (before > 0 || gone.keys === 0 && gone.copies === 0), JSON.stringify(gone));
    // вдоль маршрута: без маршрута кнопка неактивна (сказано почему); маршрут Таллин — Кейла (прямые, ~25 км) —
    // полоса плиток вдоль него, а не прямоугольник; название — по концам маршрута
    const noRoute = await run(`(async () => { atlas.route.setTarget(null); await new Promise((r) => setTimeout(r, 300)); return { off: document.querySelector(".trip-dl-route").disabled, why: document.querySelector(".trip-why").textContent }; })()`);
    check("без сети: «Скачать вдоль маршрута» без маршрута неактивна, сказано почему", noRoute.off && noRoute.why.includes("составьте маршрут"), JSON.stringify(noRoute));
    const rt = await run(`(async () => { const o = await import("./core/offline.js");
      atlas.route.setStart({ lngLat: [24.745, 59.437], title: "Таллин" }); atlas.route.setFinish({ lngLat: [24.42, 59.31], title: "Кейла" });
      await new Promise((r) => setTimeout(r, 400)); const before = o.trips().length, b = document.querySelector(".trip-dl-route"); const on = !b.disabled; b.click();
      for (let i = 0; i < 300 && o.trips().length === before; i++) await new Promise((r) => setTimeout(r, 1000));
      const t = o.trips().at(-1), list = (await (await import("./core/storage.js")).cacheGet("trip/" + t.id)) || [];
      const z14 = list.filter((k) => k.includes("/planet/_/14/")).length;
      const [w, s, e, n] = t.box, k = 2 ** 14, tx = (x) => Math.floor((x + 180) / 360 * k), ty = (y) => { const r = y * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * k); };
      const pad = Math.ceil(3 / (40075 * Math.cos(n * Math.PI / 180) / k)), rect = (tx(e) - tx(w) + 1 + 2 * pad) * (ty(s) - ty(n) + 1 + 2 * pad); // прямоугольник с той же каймой
      return { on, title: t.title, route: t.route, z14, rect, bytes: t.bytes }; })()`);
    check("без сети: «Скачать вдоль маршрута» — полоса вдоль пути, название по концам", rt.on && rt.route && rt.title === "Маршрут: Таллин — Кейла" && rt.z14 > 20 && rt.z14 < rt.rect * 0.8, JSON.stringify(rt));
    await run(`(async () => { const o = await import("./core/offline.js"); await o.removeTrip(o.trips().at(-1).id); atlas.route.setTarget(null); return true; })()`);
    await run(`document.querySelector('[data-panel="settings"] .panel-btn[title=Закрыть]').click(); true`);
  }

  // «Спорт» в «Местах»: свой кружок, в меню виды и «Сёрфинг и кайт»; теннис у Таллина — булавки (QLever), щелчок — окно
  if (want("places/sport") && mods.some((m) => m.id === "places/sport")) {
    await run(`atlas.map.jumpTo({ center: [24.70, 59.43], zoom: 13 }); true`);
    await run(openLayers("places/sport"));
    await sleep(500);
    const menu = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item")].map((c) => c.firstChild.textContent)`);
    await run(`${itemFor("Теннис")}.click(); true`);
    let sp = null;
    // QLever бывает дольше 40 с, тогда загрузчик повторяет запрос через минуту — ждём и повтора
    for (let i = 0; i < 110; i++) {
      await sleep(1000);
      sp = await run(`({ ...atlas.modules().find((m) => m.id === "places/sport").stats(), drawn: atlas.map.getLayer("sport") ? atlas.map.queryRenderedFeatures({ layers: ["sport"] }).length : 0 })`);
      if (sp.drawn > 0) break;
    }
    check("спорт: в меню первыми «Падел» и «Теннис», дальше виды и «Сёрфинг и кайт», теннис — булавки в районе",
      menu[0] === "Падел" && menu[1] === "Теннис" && ["Горнолыжные курорты", "Прокат", "Спортивные магазины", "Теннис", "Падел", "Сёрфинг и кайт", "Кайт в Эстонии"].every((t) => menu.includes(t))
      && sp.kinds.join() === "tennis" && sp.drawn > 0, JSON.stringify({ menu, sp }));
    await run(closeLayers);
    // булавка — в середину экрана (на телефоне края закрыты строкой поиска и кнопками); булавок нет — щёлкать некуда
    if (sp.drawn > 0) {
      await run(`(() => { const f = atlas.map.queryRenderedFeatures({ layers: ["sport"] })[0]; atlas.map.jumpTo({ center: f.geometry.coordinates }); return true; })()`);
      await sleep(800);
      const pt = await run(`(() => { const f = atlas.map.queryRenderedFeatures({ layers: ["sport"] }).sort((a, b) => { const d = (x) => { const p = atlas.map.project(x.geometry.coordinates); return Math.hypot(p.x - innerWidth / 2, p.y - innerHeight / 2); }; return d(a) - d(b); })[0];
        const p = atlas.map.project(f.geometry.coordinates); return [p.x, p.y - 15]; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: pt[0], y: pt[1], button: "left", clickCount: 1 });
      let title = null;
      for (let i = 0; i < 20 && !title; i++) { await sleep(500); title = await run(`document.querySelector(".maplibregl-popup .popup-title")?.textContent || null`); }
      check("спорт: щелчок по булавке — окно места", !!title, title || JSON.stringify({ pt, el: await run(`document.elementFromPoint(${pt[0]}, ${pt[1]})?.className`), at: await run(`atlas.map.queryRenderedFeatures([${pt[0]}, ${pt[1]}], { layers: ["sport"] }).length`), pop: await run(`[...document.querySelectorAll(".maplibregl-popup")].map((p) => p.textContent.slice(0, 60))`) }));
      await shot("80c-places-sport");
    }
    // «Сёрфинг и кайт» из меню включает модуль сёрфинга, выключение «Спорта» — и его
    await run(openLayers("places/sport"));
    await sleep(300);
    await run(`${itemFor("Сёрфинг и кайт")}.click(); true`);
    await sleep(1500);
    const surfOn = await run(`atlas.modules().find((m) => m.id === "layers/surf").active`);
    await run(`atlas.toggle("places/sport", false).then(() => true)`);
    await sleep(500);
    const surfOff = await run(`!atlas.modules().find((m) => m.id === "layers/surf").active && atlas.map.getLayoutProperty("sport", "visibility") === "none"`);
    check("спорт: «Сёрфинг и кайт» — из меню «Спорта», выключается вместе с ним", surfOn && surfOff, JSON.stringify({ surfOn, surfOff }));
    await run(`document.querySelector(".maplibregl-popup-close-button")?.click(); true`);
    await run(closeLayers);
  }

  await run(`document.querySelector('[data-panel=settings]') ? true : false`).then((has) => check("панель «settings» есть", has));
  // «Слои»: столбик разделов (Места, Тропы, Дороги, Рельеф, Погода, Пляжи и сёрфинг), подменю у кружка
  await run(`atlas.toggle("layers/railways", true).then(() => true)`);
  await run(openLayers("layers/roads"));
  const lm = await run(`({ groups: [...document.querySelectorAll(".wheel-layers .layers-circle")].map((c) => c.ariaLabel.split(":")[0]),
    places: [...document.querySelectorAll(".wheel-places .layers-circle")].map((c) => c.ariaLabel.split(":")[0]),
    sub: [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].map((c) => c.firstChild.textContent),
    on: [...document.querySelectorAll(".wheel-layers .layers-circle.on")].map((c) => c.ariaLabel) })`);
  check("«Слои»: кружки, «Дороги» — виды и железные дороги, «Фото»; «Места» — свой барабан", ["Карты", "Тропы", "Велодорожки", "Дороги", "Погода", "Фото"].every((g) => lm.groups.includes(g))
    && ["Места", "Транспорт", "Магазины", "Спорт"].every((g) => lm.places.includes(g) && !lm.groups.includes(g)) && !lm.places.includes("Карты")
    && !lm.groups.includes("Экскурсии") && !lm.groups.includes("Языки")
    && !lm.groups.includes("Пляжи и сёрфинг") && !lm.groups.includes("Рельеф") && lm.sub.length === 5
    && lm.sub.includes("Железные дороги") && lm.on.includes("Дороги"), JSON.stringify(lm));
  await shot("95-panel-layers");
  // лупа справа вверху: щелчок — строка поиска и барабан разделов (Экскурсии, Языки, Треки, Фото), на месте
  // лупы — логотип (лупа одна — в строке); треугольник — барабан слоёв вместо разделов; второй щелчок по
  // треугольнику прячет слои, по логотипу — поиск и разделы
  const lens = await run(`(async () => { const wait = () => new Promise((r) => setTimeout(r, 450));
    const L = document.querySelector(".search-toggle"), A = document.querySelector(".wheel-toggle");
    const st = () => ({ layers: !document.querySelector(".wheel-layers").classList.contains("closed"), content: !document.querySelector(".wheel-content").classList.contains("closed"),
      search: getComputedStyle(document.querySelector(".search")).display !== "none", logo: !!L.querySelector("svg path")?.getAttribute("d").startsWith("M15.5 14"), drop: L.classList.contains("drop"), dock: getComputedStyle(document.querySelector(".dock")).display !== "none",
      lenses: [L, document.querySelector(".search-go")].filter((b) => b.getClientRects().length && b.querySelector("svg path")?.getAttribute("d").startsWith("M15.5 14")).length });
    // поиск открыт — щелчок закрывает
    for (let k = 0; k < 3 && (!document.body.classList.contains("search-hidden") || st().content); k++) { L.click(); await wait(); }
    if (st().layers) { A.click(); await wait(); }
    const s0 = st();
    L.click(); await wait(); const s1 = st();
    const keys = [...document.querySelectorAll(".wheel-content .wheel-cell:not([hidden]) .layers-circle")].map((c) => c.ariaLabel).sort();
    // треугольник — слои, разделы остаются (Грегори 2026-11-12: «не прятать один барабан другим»)
    A.click(); await wait(); const s2 = st();
    const cells = (w) => [...document.querySelectorAll(".wheel-" + w + " .wheel-cell:not([hidden])")].map((c) => c.getBoundingClientRect());
    const apart = Math.max(...cells("content").map((r) => r.bottom)) <= Math.min(...cells("layers").map((r) => r.top)) + 1;
    const behind = document.querySelector(".wheel-content").classList.contains("behind");
    // телефон: разделы под слоями — лупа поднимает их наверх
    let up = null;
    if (behind) { L.click(); await wait(); up = { content: !document.querySelector(".wheel-content").classList.contains("behind"), layers: document.querySelector(".wheel-layers").classList.contains("behind") }; }
    // лупа (разделы сверху) — свернуть поиск и разделы; слои остаются
    L.click(); await wait(); const s4 = st();
    A.click(); await wait(); const s5 = st();
    // два положения лупы: закрыто → поиск и разделы → закрыто
    L.click(); await wait(); const c1 = st(); L.click(); await wait(); const c2 = st(); L.click(); await wait(); const c3 = st();
    L.click(); await wait();
    const lr = L.getBoundingClientRect();
    A.click(); await wait();
    return { s0, s1, s2, apart, behind, up, s4, s5, c1, c2, c3, keys, corner: innerWidth - lr.right >= 18 && innerWidth - lr.right <= 24 && lr.top < 20 }; })()`);
  check("барабаны: каждый своей кнопкой, один другой не прячет; компьютер — не пересекаются, телефон — нижний поднимается своей кнопкой; лупа сворачивает поиск и разделы",
    !lens.s0.search && !lens.s0.content && lens.s0.drop && !lens.s0.logo && !lens.s0.dock && lens.s1.content && lens.s1.search && lens.s1.logo && lens.s1.dock
    && lens.s2.layers && lens.s2.content && lens.s2.search && (PHONE ? lens.behind && lens.up?.content && lens.up?.layers : lens.apart && !lens.behind)
    && !lens.s4.search && !lens.s4.content && lens.s4.layers && lens.s4.drop && !lens.s5.layers && !lens.s5.dock
    && lens.c1.search && lens.c1.content && lens.c1.dock && !lens.c2.search && !lens.c2.content && lens.c2.drop && !lens.c2.dock && lens.c3.search && lens.c3.content
    && JSON.stringify(lens.keys) === JSON.stringify(["Мои альбомы", "Мои споты", "Мои треки", "Навигация", "Настройки", "Поиск места", "Экскурсии", "Языки"]) && lens.corner, JSON.stringify(lens));
  // три барабана (Грегори 2026-11-21: «открыть много барабанов и поднимать их по слоям»): компьютер — полосами
  // разделы, места, слои сверху вниз; телефон — стопкой, нажатая кнопка поднимает свой наверх, верхний — закрывает
  const three = await run(`(async () => { const wait = () => new Promise((r) => setTimeout(r, 450));
    const L = document.querySelector(".search-toggle"), P = document.querySelector(".places-toggle"), A = document.querySelector(".wheel-toggle");
    const w = (n) => document.querySelector(".wheel-" + n), open = (n) => !w(n).classList.contains("closed"), behind = (n) => w(n).classList.contains("behind");
    for (let k = 0; k < 3 && !open("content"); k++) { L.click(); await wait(); }
    if (!open("layers")) { A.click(); await wait(); }
    if (!open("places")) { P.click(); await wait(); }
    const cells = (n) => [...document.querySelectorAll(".wheel-" + n + " .wheel-cell:not([hidden])")].map((c) => c.getBoundingClientRect());
    const lo = (n) => Math.min(...cells(n).map((r) => r.top)), hi = (n) => Math.max(...cells(n).map((r) => r.bottom));
    const top = () => ["content", "places", "layers"].filter((n) => open(n) && !behind(n));
    const r = { all: open("content") && open("places") && open("layers"), bands: hi("content") <= lo("places") + 1 && hi("places") <= lo("layers") + 1,
      top: top(), pOpen: P.classList.contains("open"), aOpen: A.classList.contains("open") };
    const pr = P.getBoundingClientRect(), ar = A.getBoundingClientRect();
    r.above = Math.round(ar.top - pr.bottom) === 10 && Math.round(pr.right) === Math.round(ar.right);
    // телефон: «Слои» — наверх, «Места» — наверх, ещё раз — закрыть, ещё раз — открыть сверху;
    // компьютер: «Слои» — закрыть, «Места» — закрыть, открыть, закрыть
    const steps = [];
    for (const b of [A, P, P, P]) { b.click(); await wait(); steps.push(top().join()); }
    // как было: слои открыты, разделы и места закрыты
    for (let k = 0; k < 6; k++) {
      const t = top();
      if (t.includes("places")) P.click(); else if (t.includes("content")) L.click(); else if (open("places")) P.click(); else if (open("content")) L.click(); else break;
      await wait();
    }
    if (!open("layers")) { A.click(); await wait(); }
    return { ...r, steps, after: ["content", "places", "layers"].filter(open) }; })()`);
  check("три барабана: компьютер — полосами (разделы, места, слои), телефон — стопкой, кнопка поднимает свой наверх; «Места» над «Слоями»",
    three.all && three.above && three.after.join() === "layers" && (PHONE
      ? three.top.join() === "places" && three.pOpen && !three.aOpen && three.steps.join("|") === "layers|places|layers|places"
      : three.bands && three.top.length === 3 && three.pOpen && three.aOpen && three.steps.join("|") === "content,places|content|content,places|content"), JSON.stringify(three));
  await shot("95c-three-drums");
  // барабан: в центре промежутки между кнопками больше, к краям меньше, крайние темнее; колёсико
  // крутит его, нажатие по кнопке не в центре докручивает её и открывает столбик
  await run(`document.querySelector(".sub-layers").hidden || document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })); true`);
  const drum = await run(`(() => { const cells = [...document.querySelectorAll(".wheel-layers .wheel-cell")].filter((c) => !c.hidden)
    .map((c) => { const r = c.getBoundingClientRect(); return { y: r.top + r.height / 2, b: parseFloat(c.style.filter.replace("brightness(", "")) }; })
    .sort((a, b) => a.y - b.y); const gaps = cells.slice(1).map((c, i) => Math.round(c.y - cells[i].y));
    return { n: cells.length, gaps, edge: cells[0].b, mid: Math.max(...cells.map((c) => c.b)) }; })()`);
  const mid = Math.floor(drum.gaps.length / 2);
  check("колесо: в центре промежутки больше, к краям меньше и темнее", drum.n >= 5 && drum.gaps[0] < drum.gaps[mid] && drum.gaps.at(-1) < drum.gaps[mid] && drum.edge < drum.mid, JSON.stringify(drum));
  // центральная — та, что сверху (барабан прижат к треугольнику, его центр — не середина полосы)
  const centerKey = `[...document.querySelectorAll(".wheel-layers .wheel-cell")].filter((c) => !c.hidden).sort((a, b) => b.style.zIndex - a.style.zIndex)[0].querySelector(".layers-circle").dataset.key`;
  const before = await run(centerKey);
  await run(`document.querySelector(".wheel-layers").dispatchEvent(new WheelEvent("wheel", { deltaY: 200, bubbles: true, cancelable: true })); true`);
  await sleep(1200);
  const after = await run(centerKey);
  check("колесо: колёсико мыши крутит барабан", before !== after, `${before} → ${after}`);
  // подпись — только у центральной кнопки, промежуток в центре небольшой
  // подпись видна 2,5 с после остановки барабана — ждём, пока он встанет (на медленном экране дольше, до 6 с)
  await run(`(async () => { for (let i = 0; i < 60 && !document.querySelector(".wheel-tip").classList.contains("show"); i++) await new Promise((r) => setTimeout(r, 100)); return true; })()`);
  const tipInfo = await run(`({ tip: document.querySelector(".wheel-tip").classList.contains("show") ? document.querySelector(".wheel-tip").textContent : "",
    center: document.querySelector('.layers-circle[data-key=' + JSON.stringify(${centerKey}) + ']').ariaLabel,
    titles: document.querySelectorAll(".wheel-layers .layers-circle[title]").length })`);
  check("колесо: подпись только у центральной кнопки, промежуток ≤ 60", tipInfo.tip && tipInfo.tip === tipInfo.center && !tipInfo.titles && drum.gaps[mid] <= 60, JSON.stringify({ ...tipInfo, gap: drum.gaps[mid] }));
  await run(`document.querySelector('.layers-circle[data-key="photo"]').click(); true`);
  await sleep(1500);
  const spun = await run(`({ center: ${centerKey}, open: !document.querySelector(".sub-layers").hidden && document.querySelector('.layers-circle[data-key="photo"]').classList.contains("open") })`);
  check("колесо: нажатие — кнопка докручивается в центр и открывается", spun.center === "photo" && spun.open, JSON.stringify(spun));
  await shot("95b-wheel");
  await run(openLayers("maps"));
  const relief = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].map((c) => c.firstChild.textContent)`);
  check("«Карты»: виды карт, потом тени и 3D и высоты", relief.includes("Высоты") && relief.includes("Тени и 3D") && relief.length === 7, JSON.stringify(relief));
  // меню кнопки — карусель слева от барабана (Грегори 2026-11-21): значки — круглые кнопки как на барабане, подпись
  // слева от значка; в центре — вровень с кнопкой барабана; нажатие не по центральной — докручивается в центр
  const car = await run(`(async () => { const sub = document.querySelector(".sub-layers"), c = document.querySelector('.layers-circle[data-key="maps"]');
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    await wait(1200); // барабан докручивается к «Картам»
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    const shown = () => [...sub.querySelectorAll(".wheel-cell:not([hidden]) .layers-item")];
    // смена карты перерисовывает барабан — кнопку «Карты» искать заново
    const btn = () => document.querySelector('.layers-circle[data-key="maps"]');
    const center = () => shown().sort((a, b) => Math.abs(mid(a) - mid(btn())) - Math.abs(mid(b) - mid(btn())))[0];
    const icon = sub.querySelector(".layers-icon"), ir = icon.getBoundingClientRect(), cr = c.getBoundingClientRect();
    const span = sub.querySelector(".layers-item > span").getBoundingClientRect();
    const r = { carousel: sub.classList.contains("carousel"), cells: shown().length, size: Math.round(ir.width) === Math.round(cr.width) && Math.round(ir.height) === Math.round(cr.height),
      round: getComputedStyle(icon).borderRadius === "50%", label: span.right <= ir.left + 1, off: Math.round(mid(center()) - mid(c)),
      beside: Math.round(sub.getBoundingClientRect().right) <= Math.round(c.closest(".wheel").getBoundingClientRect().left) + 1,
      arc: new Set(shown().map((b) => Math.round(b.getBoundingClientRect().top))).size === shown().length };
    const first = center().firstChild.textContent, items = shown(), k = items.indexOf(center());
    const next = items[k + 1] || items[k - 1], t = next.firstChild.textContent;
    next.click(); await wait(1200);
    r.spun = center()?.firstChild.textContent === t && !sub.hidden;
    r.picked = t + " → " + center()?.firstChild.textContent;
    shown().find((b) => b.firstChild.textContent === first)?.click(); await wait(1200);
    r.back = center()?.firstChild.textContent === first;
    return r; })()`);
  check("меню кнопки — карусель: значки — круглые кнопки как на барабане, подпись слева, центр вровень с кнопкой, нажатая — в центр",
    car.carousel && car.cells > 2 && car.size && car.round && car.label && car.beside && car.arc && Math.abs(car.off) <= 3 && car.spun && car.back, JSON.stringify(car));
  await shot("95d-carousel");
  await run(`atlas.toggle("layers/railways", false).then(() => true)`);
  await run(`(async () => { const L = document.querySelector(".search-toggle"); for (let k = 0; k < 2 && document.querySelector(".wheel-content").classList.contains("closed"); k++) { L.click(); await new Promise((r) => setTimeout(r, 400)); } return true; })()`);
  await tap("settings");
  check("настройки — шестерёнкой в барабане разделов, барабан остаётся открытым", await run(`!document.querySelector(".wheel-content").classList.contains("closed") && !document.querySelector('[data-panel="settings"]').hidden && getComputedStyle(document.querySelector('[data-panel="settings"]')).display !== "none"`));
  await shot("96-panel-settings");
  // «Поделиться» — первой строкой, ссылка на сайт программы
  const share = await run(`(async () => { const b = document.querySelector(".panel:not([hidden]) .panel-body > :first-child");
    const m = await import("./core/settings-panel.js"); return { first: b?.classList.contains("share-btn") && b.textContent.includes("Поделиться"), link: m.SITE }; })()`);
  check("настройки: первой строкой «Поделиться», ссылка на сайт", share.first && share.link === "https://gregory-gittools.github.io/atlas/", JSON.stringify(share));
  // «Очистить историю просмотра» — запомненное при просмотре уходит, треки остаются
  const vc = await run(`(async () => { const st = await import("./core/storage.js"); await st.cacheSet("tracks/zz-test", { keep: 1 }); await st.cacheSet("commons/zz-test", { t: 1 });
    const before = await st.viewCache(); const sp = document.querySelector('[data-panel="settings"]');
    sp.querySelector(".panel-btn[title=Закрыть]").click(); await new Promise((r) => setTimeout(r, 300)); (await import("./core/events.js")).emit("settings-open"); await new Promise((r) => setTimeout(r, 800)); // окно заново — кнопка знает, что есть что очищать
    const b = [...document.querySelectorAll(".panel:not([hidden]) .text-btn")].find((x) => x.textContent === "Очистить историю просмотра");
    b?.click(); for (let i = 0; i < 20 && await st.cacheGet("commons/zz-test"); i++) await new Promise((r) => setTimeout(r, 200));
    const r = { btn: !!b, before: before.n, after: (await st.viewCache()).n, track: !!(await st.cacheGet("tracks/zz-test")) }; await st.cacheDelete("tracks/zz-test"); return r; })()`);
  check("настройки: «Очистить историю просмотра» — запомненное ушло, треки остались", vc.btn && vc.before > 0 && vc.after === 0 && vc.track, JSON.stringify(vc));
  // раздела своих папок «Моих альбомов» в настройках нет (Грегори 2026-11-09: «убираем из настроек»)
  // (эмуляция телефона здесь меняет только размер экрана — телефон узнаётся так же, как в программе)
  const albumsSet = await run(`(async () => { const m = await import("./core/modules.js");
    return { shown: [...document.querySelectorAll(".panel:not([hidden]) .set-title")].some((t) => t.textContent === "Мои альбомы"), phone: m.isMobile() }; })()`);
  check("настройки: раздела «Мои альбомы» (папки) нет", !albumsSet.shown, JSON.stringify(albumsSet));
  // раскладка: ⓘ и шкала — в линию с шестерёнкой, треугольник — в правом нижнем углу, логотип в поиске,
  // верх колеса — под кнопкой языка под лупой справа вверху (Грегори 2026-11-06: «опусти барабаны ниже»)
  await run(openSearch);
  const lay = await run(`(() => { const mid = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
    const gear = document.querySelector(".compass-btn");
    const t = document.querySelector(".wheel-toggle").getBoundingClientRect(), w = document.querySelector(".wheel-layers").getBoundingClientRect();
    const sb = document.querySelector(".search-box").getBoundingClientRect();
    return { gear: mid(gear), info: mid(document.querySelector(".maplibregl-ctrl-attrib-button")), scale: mid(document.querySelector(".maplibregl-ctrl-scale")),
      corner: [Math.round(innerWidth - t.right), Math.round(innerHeight - t.bottom)], size: Math.round(t.width),
      logo: (() => { const L = document.querySelector(".search-toggle.open:not(.idle)"), i = L?.querySelector("svg"); if (!i) return false; const a = i.getBoundingClientRect(), b = L.getBoundingClientRect();
        return a.width >= b.width - 10 && Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2) <= 1; })(), wheelTop: Math.round(Math.min(...[...document.querySelectorAll(".wheel:not(.closed)")].map((x) => x.getBoundingClientRect().top), w.top)), searchTop: Math.round(sb.top), phone: innerWidth <= 600 }; })()`);
  check("раскладка: ⓘ и шкала в линию с нижней кнопкой слева (компас)", Math.abs(lay.info - lay.gear) <= 2 && Math.abs(lay.scale - lay.gear) <= 2, JSON.stringify(lay));
  check("раскладка: треугольник в правом нижнем углу, отодвинут от края, размером с кнопки", lay.corner[0] >= 18 && lay.corner[0] <= 24 && lay.corner[1] >= 6 && lay.corner[1] <= 14 && lay.size === 40, JSON.stringify(lay));
  check("раскладка: открыт поиск — на кнопке справа вверху лупа, крупно и по центру", lay.logo);
  if (!lay.phone) check("раскладка: верх колеса (верхнего из открытых) — под кнопкой языка", Math.abs(lay.wheelTop - (lay.searchTop + 100)) <= 2, JSON.stringify(lay));
} catch (err) {
  errors.push("проверка прервалась: " + err.message);
}

console.log(report.join("\n"));
if (netFails) console.log(`\nСбоев загрузки с чужих серверов: ${netFails} (не считаются ошибкой)`);
console.log(errors.length ? `\nОшибки (${errors.length}):\n` + errors.map((e) => "  " + e).join("\n") : "\nОшибок нет");
console.log(`Снимки экрана: ${path.relative(process.cwd(), OUT)}`);
ws.close();
chrome.kill();
server.close();
// профиль Chrome — временный: убрать (раньше оставался в Temp после каждого прогона — 56 ГБ за неделю)
await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once("exit", r)));
for (let i = 0; i < 10; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(500); } }
process.exit(errors.length ? 1 : 0);

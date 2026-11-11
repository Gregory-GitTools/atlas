// Проверка Atlas: node tools/test.mjs [--phone] [--only=photo]
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
// --only=photo — проверить только разделы модулей, в id которых есть это слово (быстро при отладке)
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const want = (id) => !ONLY || id.includes(ONLY);
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
await send("Emulation.setDeviceMetricsOverride", PHONE ? { width: 390, height: 800, deviceScaleFactor: 2, mobile: true } : { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
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
    glass: [...document.querySelectorAll(".map-btn button, .wheel-toggle, .search-toggle")].every((b) => b.classList.contains("glass")) })`);
  check("звёзды, шкала, навигация", extras.stars && /км|м$/.test(extras.scale || "") && extras.geo, JSON.stringify(extras));
  check("слева внизу: навигация и компас — полупрозрачные, без «+ −»",
    JSON.stringify(extras.order) === '["geo-btn","compass-btn"]' && !extras.zoom && extras.glass, JSON.stringify(extras));
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
  const far = await run(`(async () => { const m = atlas.map, at = async (zoom) => { m.jumpTo({ zoom, pitch: 70 }); await new Promise((r) => setTimeout(r, 50)); return Math.round(m.getPitch()); };
    const r = { near: await at(13), mid: await at(7.5), far: await at(5) }; await new Promise((r) => setTimeout(r, 100)); r.label = document.querySelector(".compass-mode").textContent; m.jumpTo({ pitch: 0 }); return r; })()`);
  check("наклон: вблизи 70°, при отдалении меньше, на 100 км — 2D", far.near === 70 && far.mid > 0 && far.mid < 70 && far.far === 0 && far.label === "2D", JSON.stringify(far));
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
  await run(`document.querySelector(".geo-btn").click(); true`);
  await sleep(2500);
  const n2 = await nav();
  check("навигация: при начале — 3D, я внизу, масштаб не тронут, кнопка «Навигация»",
    n2.follow && n2.mode === "3d" && n2.zoom === 14.3 && n2.pitch >= 55 && Math.abs(n2.me.x) <= 3 && Math.abs(n2.me.y - 200) <= 8 && /^Навигация/.test(n2.title), JSON.stringify(n2));
  await goTo(59.437, 24.7455);
  await sleep(2500);
  const navE = await nav();
  await goTo(59.4375, 24.7455);
  await sleep(2500);
  const navN = await nav();
  const near = (a, b) => Math.abs(((a - b + 540) % 360) - 180) <= 5;
  check("навигация: 3D — я внизу, карта по ходу движения, метка — стрелка, масштаб прежний", navE.mode === "3d" && navE.pitch >= 55 && near(navE.heading, 90) && near(navE.bearing, 90)
    && navE.chevron && navE.zoom === 14.3 && Math.abs(navE.me.y - 200) <= 8 && near(navN.heading, 0) && near(navN.bearing, 0) && navN.zoom === 14.3, JSON.stringify([navE, navN]));
  // сдвинул карту рукой — сама не возвращается; кнопка «Навигация» — снова ко мне
  await run(`atlas.map.fire("dragstart", { originalEvent: new MouseEvent("mousedown") }); atlas.map.panBy([200, 0], { duration: 0 }); true`);
  const away = await run(`atlas.geo.state().follow`);
  await goTo(59.4376, 24.7455);
  await sleep(3000);
  const stay = await nav();
  await run(`document.querySelector(".geo-btn").click(); true`);
  await sleep(1500);
  const backHome = await nav();
  check("навигация: сдвинул карту — сама не возвращается, кнопка «Навигация» — ко мне", away === false && !stay.follow && Math.abs(stay.me.x) > 100 && backHome.follow && Math.abs(backHome.me.x) <= 3, JSON.stringify({ away, stay, backHome }));
  // выровнял карту рукой — 2D; кнопкой — я в центре
  await run(`atlas.map.fire("pitchstart", { originalEvent: new MouseEvent("mousedown") }); atlas.map.jumpTo({ pitch: 0 }); true`);
  const flat = await run(`({ ...atlas.geo.state() })`);
  await sleep(500);
  await run(`document.querySelector(".geo-btn").click(); true`);
  await sleep(1500);
  const flatBack = await nav();
  check("навигация: выровнял рукой — 2D, кнопкой «Навигация» — я в центре", flat.mode === "2d" && !flat.follow && flatBack.follow && flatBack.mode === "2d"
    && Math.abs(flatBack.me.x) <= 3 && Math.abs(flatBack.me.y) <= 3 && flatBack.chevron, JSON.stringify({ flat, flatBack }));
  // компас по кругу до «С» (из 2D — через 3D; если наклон на этом масштабе недоступен — сразу «С»)
  for (let k = 0; k < 3 && (await run(`document.querySelector(".compass-mode").textContent`)) !== "С"; k++) {
    await run(`document.querySelector(".compass-btn").click(); true`);
    await sleep(2000);
  }
  await sleep(1000);
  const nN = await nav();
  check("навигация: С — я в центре, север вверху, точка вместо стрелки", nN.mode === "north" && nN.bearing === 0 && nN.pitch === 0 && Math.abs(nN.me.x) <= 3 && Math.abs(nN.me.y) <= 3 && !nN.chevron && nN.zoom === 14.3, JSON.stringify(nN));
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
  const W = PHONE ? 390 : 1200;
  await run(`(() => { document.querySelectorAll(".search-results").forEach((m) => (m.hidden = true)); return true; })()`);
  const cardShown = await run(`!document.querySelector(".search-card").hidden`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: PHONE ? W / 2 : W - 300, y: 620, button: "left", clickCount: 1 });
  await sleep(2500);
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
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: PHONE ? 60 : 300, y: 700, button: "left", clickCount: 1 });
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
    items.mark?.role === "Отметка" && items.mark.acts === 4 && items.mark.x === "Снять отметку" && !items.esc.open && items.esc.marks === 1 && !items.unmarked.marks && !items.unmarked.flags
    && items.stop?.role === "Остановка 1" && items.stop.x === "Убрать остановку" && items.stops === 0 && items.finish?.role === "Финиш" && items.after.target === "Заход" && !items.after.stops, JSON.stringify(items));
  await run(`atlas.route.setTarget({ lngLat: [24.76, 59.43], title: "Проба", way: "foot" });
    localStorage.setItem("atlas.route.history", JSON.stringify(JSON.parse(localStorage.getItem("atlas.route.history") || "[]").filter((e) => !e.saved))); true`);
  check("окно места при навигации: стрелка, «Добавить», «Поделиться», «Отметить» и «⋯»; остановка в пути и на карте, отметка флажком, «Сохранить маршрут» — в список «Куда»",
    JSON.stringify(acts.btns) === '["Сюда","Добавить в путь","Поделиться","Отметить"]' && acts.more && JSON.stringify(added.stops) === '["Остановка"]' && JSON.stringify(added.chip) === '["1Остановка","Проба"]' && added.marker === 1
    && marked.marks.includes("Остановка") && marked.flag === 1 && marked.on && !unmarked.marks.length && !unmarked.flag && menuOpen
    && saved?.saved && saved.title === "Проба" && saved.stops === 1 && !removed.length, JSON.stringify({ acts, added, marked, unmarked, menuOpen, saved, removed }));
  // история: карандаш — переименовать в строке; у сохранённого маршрута — значок
  const ren = await run(`(async () => { const hm = await import(new URL("core/history.js", location.href));
    hm.saveList("zz.hist", [{ id: 1, t: "Старое", r: 1 }]);
    let box; const make = () => { box?.remove(); box = hm.historyList({ key: "zz.hist", id: (e) => e.id, label: (e) => ({ title: e.t, icon: e.r ? "<svg></svg>" : "" }), rename: (e, t) => ({ ...e, t }), pick() {}, changed: make }); document.body.append(box); };
    make();
    const icon = !!box.querySelector(".history-icon");
    box.querySelector(".search-rename").click();
    const i = box.querySelector(".history-rename"); i.value = "Новое"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const r = { icon, title: hm.loadList("zz.hist")[0].t, shown: box.querySelector(".search-item-title")?.textContent };
    box.remove(); hm.saveList("zz.hist", []); return r; })()`);
  check("история: карандаш переименовывает запись прямо в строке, у сохранённого маршрута — значок", ren.icon && ren.title === "Новое" && ren.shown === "Новое", JSON.stringify(ren));
  // кнопка «Навигация» в барабане поиска светится, пока навигация включена; выключили — путь убран, точка осталась
  const wheelNav = `document.querySelector('.wheel-content .layers-circle[data-key="content/navigation"]')`;
  const lit = await run(`({ on: ${wheelNav}?.classList.contains("on"), nav: ${navStats}.navOn })`);
  await run(`document.querySelector(".geo-btn").click(); true`);
  await sleep(500);
  const off = await run(`({ ...atlas.route.state(), on: ${wheelNav}?.classList.contains("on"), nav: ${navStats}.navOn })`);
  check("навигация: кнопка в барабане светится, пока навигация включена; выключили — путь и точка сняты",
    lit.on && lit.nav && !off.on && !off.nav && !off.route && !off.target, JSON.stringify({ lit, off }));
  // «Сюда» — только при навигации; без неё окно на карте — только сведения
  const noHere = await run(`(async () => { const { track } = await import(new URL("core/popups.js", location.href));
    const p = track(new atlas.ctx.maplibregl.Popup()).setLngLat([24.76, 59.43]).setHTML('<div class="popup-title">Проба</div>').addTo(atlas.map);
    const b = p.getElement().querySelector(".go-here"); const r = { has: !!b, visible: !!b && !b.hidden && b.offsetParent !== null }; p.remove(); return r; })()`);
  check("«Сюда» в окне на карте — только при включённой навигации", !noHere.visible, JSON.stringify(noHere));
  // кнопка в барабане включает навигацию снова
  await run(`${wheelNav}.click(); true`);
  await sleep(2500);
  const relit = await run(`({ geo: atlas.geo.state().on, on: ${wheelNav}?.classList.contains("on") })`);
  check("навигация: кнопка в барабане включает навигацию", relit.geo && relit.on, JSON.stringify(relit));
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
  const hist = await run(`({ rows: ${navList}.querySelectorAll(".search-history-row").length, open: !${navList}.hidden,
    clear: !!${navList}.querySelector(".search-history-clear"), grip: !!${navList}.querySelector(".search-grip"), card: !${navPanel}.hidden })`);
  // набор — подсказки из уже найденного
  await run(`(() => { const i = document.querySelector(".search-box input"); i.value = "Про"; i.dispatchEvent(new Event("input")); return true; })()`);
  const typed = await run(`[...${navList}.querySelectorAll(".search-history-row .search-item-title")].map((t) => t.textContent)`);
  const every = await run(`${navList}.querySelector(".search-scroll > .search-item:first-child.search-everywhere")?.textContent || ""`);
  check("набор — первой строкой «Искать «…» везде — Enter»", /Искать «Про» везде/.test(every) && /Enter/.test(every), every);
  await run(`(() => { const i = document.querySelector(".search-box input"); i.value = ""; i.dispatchEvent(new Event("input")); return true; })()`);
  await clickInput();
  const shut = await run(`${navList}.hidden`);
  await clickInput();
  await run(`${navList}.querySelector(".search-history-row:last-child .search-delete:not(.search-rename)").click(); true`);
  const left = await run(`JSON.parse(localStorage.getItem("atlas.route.history") || "[]").length`);
  check("навигация: место из «Куда» — точка, подсказки закрылись; щелчок по строке — история (отдельно от карточки), набор — подходящие, второй щелчок — закрыть",
    found > 0 && /Kadri|Кадри/i.test(picked.target) && picked.history.length === 2 && !picked.list && picked.card && picked.placeholder === "Добавить точку"
    && hist.rows === 2 && hist.open && hist.clear && hist.grip && !hist.card && JSON.stringify(typed) === '["Проба"]' && shut && left === 1, JSON.stringify({ found, picked, hist, typed, shut, left }));
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
  await run(`document.querySelector(".geo-btn").click(); true`); // слежение → выключить
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
  // два барабана справа: слои — открывает треугольник, кнопка — свой столбик; разделы (content/…) —
  // открывает лупа справа вверху, кнопка — сразу панель раздела со списком (как человек щёлкает)
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
    if (document.querySelector(".wheel-layers").classList.contains("closed")) {
      document.querySelector(".wheel-toggle").click();
      await new Promise((r) => setTimeout(r, 400));
    }
    const c = [...document.querySelectorAll(".wheel-layers .layers-circle")].find((b) => b.dataset.key === ${JSON.stringify(key)});
    if (!c.classList.contains("open")) c.click();
    for (let t = 0; t < 30 && document.querySelector(".sub-layers").hidden; t++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 150));
    return true; })()`;
  // второй щелчок по треугольнику — спрятать барабан слоёв
  const closeLayers = `(() => { if (!document.querySelector(".wheel-layers").classList.contains("closed")) document.querySelector(".wheel-toggle").click(); return true; })()`;
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
  check("язык подписей и шестерёнка — в столбике под логотипом; ⓘ свёрнута; пустая строка состояния спрятана", misc.lang && !misc.inSearch && !misc.attrib && misc.version.open && misc.version.w >= 260 && /^(Обновлено|Версия).*, \d\d:\d\d$/.test(misc.version.line) && (misc.status === "none" || misc.status === "text"), JSON.stringify(misc));
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
  const clickAt = async (x, y) => {
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  };
  await run(`document.querySelector(".search-clear").click(); document.activeElement.blur(); document.body.click(); atlas.map.jumpTo({ center: [24.75, 59.437], zoom: 11 }); true`);
  await idle();
  await clickAt(40, 400);
  await sleep(2500);
  const empty = await run(`document.querySelector(".maplibregl-popup .popup-coords")?.textContent || ""`);
  check("щелчок по карте — координаты", /^\d+\.\d+, \d+\.\d+$/.test(empty), empty);
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
      const open = !document.querySelector(".sub-layers").hidden;
      ${closeLayers};
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
        closed: document.querySelector(".sub-layers").hidden };
      // открыть снова: ничего не отмечено, у видов кольца цвета
      await ${openLayers("places/transport")};
      res.noneMarked = !document.querySelector(".layers-sub:not([hidden]) .layers-item.on");
      res.rings = [...document.querySelectorAll(".layers-sub .layers-icon.ring")].length;
      ${closeLayers};
      return res; })()`);
    check("транспорт: крестик снимает всё, у видов кольца цвета", cleared.shown && cleared.off && cleared.closed && cleared.noneMarked && cleared.rings === 7, JSON.stringify(cleared));
    await run(`atlas.toggle("places/transport", false)`);
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
      ${closeLayers};
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
          folder("20240101 Рига", [file("r.jpg"), file("r.mov"), file("v.mp4")]), folder("Music", [file("a.m4a")])]);
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
        check("галерея: ролик играет с кнопками плеера", gv.clip && gv.controls && !gv.photo && gv.w > 0 && gv.t > 0 && !gv.live && JSON.stringify(gv.badges) === '["LIVE","▶"]', JSON.stringify(gv));
        await grun(`document.querySelector(".thumb").click(); true`);
        await sleep(400);
        const gl = await grun(gst);
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
          const srun = (expr) => new Promise((r) => { const id = ++sid; spend.set(id, r); sws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } })); })
            .then((r) => r.result?.value);
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
          for (let i = 0; i < 30 && (await srun(`galleryEditor.state().open`)); i++) await sleep(300);
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
          for (let i = 0; i < 30 && (await srun(`galleryEditor.state().open`)); i++) await sleep(300);
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
          for (let i = 0; i < 30 && (await srun(`galleryEditor.state().open`)); i++) await sleep(300);
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
          for (let i = 0; i < 40 && (await srun(`galleryEditor.state().open`)); i++) await sleep(300);
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
          for (let i = 0; i < 60 && (await srun(`galleryEditor.state().open`)); i++) await sleep(300);
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
            for (let i = 0; i < 60 && (await srun(`galleryEditor.state().open`)); i++) await sleep(300);
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
          for (let i = 0; i < 30 && (await srun(`galleryEditor.state().open`)); i++) await sleep(300);
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
            JSON.stringify(del.riga) === '["v.mp4"]' && JSON.stringify(del.bin?.slice().sort()) === '["r.jpg","r.mov"]' && del.photos === n0.photos - 1 && g.thumbs === n0.thumbs - 1 && !g.open, JSON.stringify({ n0, del, g }));
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
        await run(`(() => { const { file, folder } = testFs, gpx = (n, x) => file(n, new Blob([x]));
          window.showDirectoryPicker = async () => folder("Треки", [folder("20240505 Поход", [file("p.jpg"), gpx("walk.gpx", ${JSON.stringify(walk("Поход у моря", 59.47))})]),
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
    await run(exitMode);
    await sleep(300);
    check("треки: закрыть — линии с карты убраны", await run(`document.querySelector('[data-panel="tracks"]').hidden && !atlas.map.getLayer("tracks-line")`));
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

  // пляжи и кайт (QLever): у Таллина — значки пляжей; сёрфинг — по всему миру и споты Грегори
  if (want("layers/beaches") && mods.some((m) => m.id === "layers/beaches")) {
    await run(`atlas.map.jumpTo({ center: [24.65, 59.47], zoom: 10.5 }); (async () => { await atlas.toggle("layers/beaches", true); await atlas.toggle("layers/surf", true); return true; })()`);
    const count = (id) => `(atlas.map.getSource(${JSON.stringify(id)})?._data?.features?.length ?? atlas.map.getSource(${JSON.stringify(id)})?.serialize?.().data?.features?.length ?? 0)`;
    for (let i = 0; i < 45 && !(await run(`atlas.map.getLayer("beaches") && atlas.map.queryRenderedFeatures({ layers: ["beaches"] }).length > 0`)); i++) await sleep(1000);
    const b = await run(`({ beaches: atlas.map.queryRenderedFeatures({ layers: ["beaches"] }).length, surf: atlas.map.queryRenderedFeatures({ layers: ["surf"] }).length })`);
    check("пляжи и сёрфинг", b.beaches > 0 && b.surf > 0, JSON.stringify(b));
    await shot("89-beaches-surf");
    await run(`(async () => { await atlas.toggle("layers/beaches", false); await atlas.toggle("layers/surf", false); return true; })()`);
  }

  // погода: стрелки ветра с силой в м/с, прогноз по щелчку, радар осадков
  if (want("weather/wind") && mods.some((m) => m.id === "weather/wind")) {
    await run(`atlas.map.jumpTo({ center: [24.7, 59.45], zoom: 9 }); atlas.toggle("weather/wind", true).then(() => true)`);
    for (let i = 0; i < 20 && !(await run(`atlas.map.getLayer("wind") && atlas.map.queryRenderedFeatures({ layers: ["wind"] }).length > 0`)); i++) await sleep(1000);
    const w = await run(`atlas.map.queryRenderedFeatures({ layers: ["wind"] }).map((f) => f.properties.ms)`);
    check("ветер: стрелки", w.length > 0, `${w.length} стрелок, ${w.slice(0, 5).join(", ")} м/с`);
    // стрелка ближе к центру — у краёв её закрывают строка поиска и кнопки
    const p = await run(`(() => { const c = atlas.map.project(atlas.map.getCenter()); return atlas.map.queryRenderedFeatures({ layers: ["wind"] })
      .map((f) => atlas.map.project(f.geometry.coordinates)).filter((q) => q.x > 30 && q.x < innerWidth - 70 && q.y > 80 && q.y < innerHeight - 120)
      .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0]; })()`);
    await clickAt(p.x, p.y);
    for (let i = 0; i < 10 && !(await run(`document.querySelectorAll(".wx-row").length > 0`)); i++) await sleep(500);
    check("ветер: прогноз по щелчку", await run(`document.querySelectorAll(".wx-row").length > 0`));
    await shot("90-wind");
    await run(`document.querySelector(".maplibregl-popup")?.remove(); atlas.toggle("weather/wind", false).then(() => true)`);
    await run(`atlas.map.jumpTo({ center: [15, 52], zoom: 4 }); atlas.toggle("weather/radar", true).then(() => true)`);
    await sleep(3000);
    const frames = await run(`atlas.map.getStyle().layers.filter((l) => l.id.startsWith("radar-")).length`);
    check("осадки: кадры радара", frames > 0, `${frames}`);
    await idle();
    await shot("91-radar");
    await run(`atlas.toggle("weather/radar", false).then(() => true)`);
  }

  await run(`document.querySelector('[data-panel=settings]') ? true : false`).then((has) => check("панель «settings» есть", has));
  // «Слои»: столбик разделов (Места, Тропы, Дороги, Рельеф, Погода, Пляжи и сёрфинг), подменю у кружка
  await run(`atlas.toggle("layers/railways", true).then(() => true)`);
  await run(openLayers("layers/roads"));
  const lm = await run(`({ groups: [...document.querySelectorAll(".wheel-layers .layers-circle")].map((c) => c.ariaLabel.split(":")[0]),
    sub: [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .panel:not([hidden]) .home-row")].map((c) => c.firstChild.textContent),
    on: [...document.querySelectorAll(".wheel-layers .layers-circle.on")].map((c) => c.ariaLabel) })`);
  check("«Слои»: кружки, «Дороги» — виды и железные дороги, «Фото»", ["Карты", "Места", "Транспорт", "Магазины", "Тропы", "Велодорожки", "Дороги", "Погода", "Фото"].every((g) => lm.groups.includes(g))
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
    A.click(); await wait(); const s2 = st();
    A.click(); await wait(); const s3 = st();
    // поиск открыт без барабана — щелчок прячет всё (Грегори 2026-11-06, вечер: «открыть / свернуть всё»)
    L.click(); await wait(); const s4 = st();
    // поиск закрыт: нижняя кнопка — барабан слоёв, наверху логотип (Грегори 2026-11-09)
    A.click(); await wait(); const s5 = st(); A.click(); await wait();
    // два положения: закрыто → всё → закрыто (лупа, логотипа после старта нет) → всё
    L.click(); await wait(); const c1 = st(); L.click(); await wait(); const c2 = st(); L.click(); await wait(); const c3 = st();
    const lr = L.getBoundingClientRect();
    A.click(); await wait();
    return { s0, s1, s2, s3, s4, s5, c1, c2, c3, keys, corner: innerWidth - lr.right >= 18 && innerWidth - lr.right <= 24 && lr.top < 20 }; })()`);
  check("кнопка справа вверху: всё закрыто — логотип, открыто — лупа; при открытом поиске нижняя кнопка сменяет барабаны туда и обратно; без поиска — слои, наверху логотип",
    !lens.s0.search && !lens.s0.content && lens.s0.drop && !lens.s0.logo && !lens.s0.dock && lens.s1.content && lens.s1.search && lens.s1.logo && lens.s1.dock
    && lens.s2.layers && !lens.s2.content && lens.s2.search && !lens.s3.layers && lens.s3.content && lens.s3.search && !lens.s4.search && !lens.s4.content && !lens.s4.dock
    && lens.s5.layers && !lens.s5.search && lens.s5.drop
    && lens.c1.search && lens.c1.content && lens.c1.dock && !lens.c2.search && !lens.c2.content && lens.c2.drop && !lens.c2.dock && lens.c3.search && lens.c3.content
    && JSON.stringify(lens.keys) === JSON.stringify(["Мои альбомы", "Мои треки", "Навигация", "Настройки", "Поиск места", "Экскурсии", "Языки"]) && lens.corner, JSON.stringify(lens));
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
  check("«Карты»: виды карт, под чертой тени и 3D и высоты", relief.includes("Высоты") && relief.includes("Тени и 3D") && relief.length === 7
    && (await run(`!!document.querySelector(".layers-sub .layers-sep")`)), JSON.stringify(relief));
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
        return a.width >= b.width - 10 && Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2) <= 1; })(), wheelTop: Math.round(w.top), searchTop: Math.round(sb.top), phone: innerWidth <= 600 }; })()`);
  check("раскладка: ⓘ и шкала в линию с нижней кнопкой слева (компас)", Math.abs(lay.info - lay.gear) <= 2 && Math.abs(lay.scale - lay.gear) <= 2, JSON.stringify(lay));
  check("раскладка: треугольник в правом нижнем углу, отодвинут от края, размером с кнопки", lay.corner[0] >= 18 && lay.corner[0] <= 24 && lay.corner[1] >= 6 && lay.corner[1] <= 14 && lay.size === 40, JSON.stringify(lay));
  check("раскладка: открыт поиск — на кнопке справа вверху лупа, крупно и по центру", lay.logo);
  if (!lay.phone) check("раскладка: верх колеса — под кнопкой языка", Math.abs(lay.wheelTop - (lay.searchTop + 100)) <= 2, JSON.stringify(lay));
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

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
  if (pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errors.push("исключение: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split("\n")[0]);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
    // у объекта ошибки — и место, где она возникла (первые строки стека), иначе в отчёте одно «Error»
    const text = d.params.args.map((a) => a.value ?? a.description).join(" ").split("\n").slice(0, 4).map((l) => l.trim()).join(" ← ");
    // сбои чужих серверов (плитка не пришла или пришла пустой) — не ошибка программы, только счёт
    if (/Failed to fetch|AJAXError|could not be decoded/.test(text)) netFails++;
    else errors.push("console.error: " + text.slice(0, 400));
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

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", PHONE ? { width: 390, height: 800, deviceScaleFactor: 2, mobile: true } : { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
const report = [];
const check = (name, ok, extra = "") => { report.push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) errors.push(name); };

try {
  await run(`new Promise((r) => { const c = () => window.atlas?.map?.loaded() ? r(true) : setTimeout(c, 200); c(); })`);
  await idle();
  check("карта загрузилась", true, await run(`atlas.map.getProjection()?.type`));
  const extras = await run(`({ stars: document.querySelector("canvas.stars")?.width > 0, scale: document.querySelector(".maplibregl-ctrl-scale")?.textContent,
    geo: !!document.querySelector(".geo-btn"), order: [...document.querySelectorAll(".maplibregl-ctrl-bottom-left .map-btn button")].map((b) => b.className.split(" ").pop()),
    zoom: !!document.querySelector(".maplibregl-ctrl-zoom-in, .maplibregl-ctrl-compass"),
    glass: [...document.querySelectorAll(".map-btn button, .wheel-toggle, .search-toggle")].every((b) => b.classList.contains("glass")) })`);
  check("звёзды, шкала, «Где я»", extras.stars && /км|м$/.test(extras.scale || "") && extras.geo, JSON.stringify(extras));
  check("слева внизу: «Где я», компас, настройки — полупрозрачные, без «+ −»",
    JSON.stringify(extras.order) === '["geo-btn","compass-btn","glass"]' && !extras.zoom && extras.glass, JSON.stringify(extras));
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
  // навигация: «Где я» + 3D — карта по ходу движения (подставные координаты: иду на восток, потом на север)
  await send("Browser.grantPermissions", { permissions: ["geolocation"], origin: url.replace(/\/$/, "") });
  const goTo = (lat, lon) => send("Emulation.setGeolocationOverride", { latitude: lat, longitude: lon, accuracy: 5 });
  await goTo(59.437, 24.745);
  await run(`document.querySelector(".geo-btn").click(); true`);
  await sleep(3500);
  await run(`document.querySelector(".compass-btn").click(); true`);
  await sleep(1500);
  await goTo(59.437, 24.7455);
  await sleep(1800);
  const navE = await run(`({ ...atlas.geo.state(), bearing: Math.round(atlas.map.getBearing()), pitch: Math.round(atlas.map.getPitch()),
    arrow: document.querySelector(".geo-dot.moving .geo-arrow") !== null, btn: document.querySelector(".geo-btn").classList.contains("nav") })`);
  await goTo(59.4375, 24.7455);
  await sleep(1800);
  const navN = await run(`({ ...atlas.geo.state(), bearing: Math.round(atlas.map.getBearing()) })`);
  const near = (a, b) => Math.abs(((a - b + 540) % 360) - 180) <= 5;
  check("навигация: «Где я» в 3D — карта по ходу движения, стрелка у точки", navE.nav && navE.pitch >= 55 && near(navE.heading, 90) && near(navE.bearing, 90)
    && navE.arrow && navE.btn && near(navN.heading, 0) && near(navN.bearing, 0), JSON.stringify([navE, navN]));
  // сдвинул карту рукой в навигации — через 10 секунд она сама возвращается ко мне
  await run(`atlas.map.fire("dragstart", { originalEvent: new MouseEvent("mousedown") }); atlas.map.panBy([200, 0], { duration: 0 }); true`);
  const away = await run(`atlas.geo.state().follow`);
  await sleep(11500);
  const backHome = await run(`({ follow: atlas.geo.state().follow, bearing: Math.round(atlas.map.getBearing()) })`);
  check("навигация: сдвинул карту — через 10 секунд снова ко мне", away === false && backHome.follow && near(backHome.bearing, 0), JSON.stringify({ away, backHome }));
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
    if (document.querySelector(".wheel-content").classList.contains("closed")) {
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
  const exitMode = `(async () => { const b = document.querySelector(".search-toggle");
    if (document.querySelector(".wheel-content").classList.contains("closed")) { b.click(); await new Promise((r) => setTimeout(r, 300)); }
    b.click(); return true; })()`;
  // открыть строку поиска (при первом запуске её нет) — лупой справа вверху
  const openSearch = `(async () => { if (document.body.classList.contains("search-hidden")) { document.querySelector(".search-toggle").click(); await new Promise((r) => setTimeout(r, 300)); } return true; })()`;
  // кнопка в столбике слоёв или строка списка в панели раздела — по названию
  const itemFor = (title) => `[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].find((c) => c.firstChild.textContent === ${JSON.stringify(title)})`;

  // карты: в колесе справа кнопка «Карты» — в её столбике виды карт с миниатюрами; каждая загружается без ошибок
  await run(openLayers("maps"));
  const basemaps = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].filter((b) => b.querySelector(".thumb")).map((b) => b.title)`);
  check("виды карт в «Картах»", basemaps.length >= 5, `${basemaps.length} карт`);
  for (let i = 0; i < basemaps.length; i++) {
    await run(`${openLayers("maps")}.then(() => { [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].filter((b) => b.querySelector(".thumb"))[${i}].click(); return true; })`);
    await sleep(500);
    await idle();
    if (i === 0) await shot("50-satellite");
    const ok = await run(`atlas.map.isStyleLoaded() && atlas.map.getStyle().layers.length > 0`);
    check(`карта «${basemaps[i]}»`, ok);
  }
  const mapsCircle = await run(`document.querySelector('.layers-circle[data-key="maps"]').ariaLabel`);
  check("на кнопке «Карты» — текущая карта", /Тёмная/.test(mapsCircle), mapsCircle);
  await run(`${openLayers("maps")}.then(() => { [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].filter((b) => b.querySelector(".thumb"))[1].click(); return true; })`);
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
  await clickAt(40, 400);
  await sleep(400);
  check("второй щелчок закрывает окно", await run(`!document.querySelector(".maplibregl-popup")`));
  const city = await run(`(() => { const f = atlas.map.queryRenderedFeatures().find((f) => f.sourceLayer === "place" && f.properties.class === "city");
    if (!f) return null; const p = atlas.map.project(f.geometry.coordinates); return { x: p.x, y: p.y, name: f.properties["name:ru"] || f.properties.name }; })()`);
  if (city) {
    await clickAt(city.x, city.y);
    await sleep(4000);
    const info = await run(`({ title: document.querySelector(".maplibregl-popup .popup-title")?.textContent, sub: document.querySelector(".maplibregl-popup .popup-sub")?.textContent, wiki: !!document.querySelector(".maplibregl-popup .popup-wiki") })`);
    check("щелчок по подписи города — окно места", !!info.title, JSON.stringify(info));
    await shot("70-place");
    await run(`atlas.map.panBy([5, 5]); true`);
    await sleep(500);
    check("окно закрывается при движении карты", await run(`!document.querySelector(".maplibregl-popup")`));
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
      const items = [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].map((i) => i.firstChild.textContent);
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
      const items = [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].map((i) => i.firstChild.textContent);
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
    for (let i = 0; i < 40 && !(await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].length > 3`)); i++) await sleep(500);
    await shot("98-tours-home");
    const cs = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].map((b) => b.firstChild.textContent)`);
    check("экскурсии: в столбике — страны", cs.length >= 5 && cs.some((c) => /^Италия/.test(c)), JSON.stringify(cs));
    await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].find((b) => /^Италия/.test(b.firstChild.textContent)).click(); true`);
    await sleep(600);
    const lst = await run(`({ panel: !document.querySelector('[data-panel="tours"]').hidden, rows: [...document.querySelectorAll(".tr-row-title")].map((r) => r.textContent),
      mode: document.querySelector(".search-box input").placeholder })`);
    check("экскурсии: список страны в панели, режим поиска", lst.panel && lst.rows.length >= 2 && lst.mode === "Найти экскурсию", JSON.stringify(lst));
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
    for (let i = 0; i < 40 && !(await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].length > 3`)); i++) await sleep(500);
    const langs = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].map((b) => b.firstChild.textContent)`);
    check("языки: в столбике — языки", langs.length >= 5 && langs.some((l) => /Итальянский/.test(l)), JSON.stringify(langs));
    // уже у списка — значок раздела вместо логотипа, строка поиска ищет язык
    const ll = await run(`(async () => { const i = document.querySelector(".search-box input"); i.value = "итал"; i.dispatchEvent(new Event("input"));
      await new Promise((r) => setTimeout(r, 200)); const shown = [...document.querySelectorAll(".home-row:not([hidden])")].map((b) => b.textContent);
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
    for (let i = 0; i < 60 && !(await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].some((b) => /^Эстония/.test(b.firstChild.textContent))`)); i++) await sleep(500);
    const cs = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].map((b) => b.firstChild.textContent)`);
    // телефон узнаётся так же, как в программе (эмуляция здесь меняет только размер экрана)
    const phone = await run(`import("./core/modules.js").then((m) => m.isMobile())`);
    check("альбомы: в столбике — страны, на компьютере первой строкой — выбор папки", cs.some((c) => /^Эстония/.test(c))
      && (phone ? !/папк/.test(cs[0]) : /^Открыть .*папку/.test(cs[0])), JSON.stringify(cs));
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
      const gear = `document.querySelector(".maplibregl-ctrl-bottom-left button[title=Настройки]")`;
      const setBtn = (text) => `[...document.querySelectorAll(".panel:not([hidden]) .text-btn")].find((b) => b.textContent === ${JSON.stringify(text)})`;
      await run(`(async () => {
        const jpg = await new Promise((r) => { const c = Object.assign(document.createElement("canvas"), { width: 8, height: 8 }); c.toBlob(r, "image/jpeg"); });
        const clip = await (await fetch("tools/test-clip.mp4")).blob();
        const file = (name) => ({ kind: "file", name, getFile: async () => /\.(mov|mp4)$/.test(name)
          ? new File([clip], name, { type: name.endsWith(".mov") ? "video/quicktime" : "video/mp4", lastModified: 1 })
          : new File([jpg], name, { type: "image/jpeg", lastModified: 1 }) });
        const folder = (name, items) => ({ kind: "directory", name, async *entries() { for (const i of items) yield [i.name, i]; },
          queryPermission: async () => "granted", requestPermission: async () => "granted" });
        const trip = "20230625-0716 (Travel) Испания";
        window.showDirectoryPicker = async () => folder("Фото", [
          folder(trip, [file("0.jpg"), folder("20230626 Варшава", [file("3.jpg"), folder("[Originals]", [file("3.jpg")])]),
            folder("20230625 Таллин", [file("1.jpg"), file("2.jpg")]), folder(trip + "-Albom", [file("1.jpg")])]),
          folder("20240101 Рига", [file("r.jpg"), file("r.mov"), file("v.mp4")])]);
        return true; })()`);
      await run(`${gear}.click(); true`);
      await sleep(600);
      await run(`${setBtn("Выбрать папку…")}.click(); true`);
      for (let i = 0; i < 30 && !(await run(`${as}.groups === 1 && !${as}.busy`)); i++) await sleep(500);
      await run(`${gear}.click(); true`);
      await run(openLayers("content/albums"));
      for (let i = 0; i < 20 && !(await run(`!!${itemFor("Без страны (2)")}`)); i++) await sleep(500);
      const tc = await run(`({ ...${as}, items: [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].map((b) => b.firstChild.textContent) })`);
      check("альбомы: поездка с подпапками — одна строка, дни — свои альбомы, «[Originals]» пропущены",
        tc.groups === 1 && tc.albums === 6 && tc.items.includes("Без страны (2)"), JSON.stringify(tc));
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
      const riga = await run(`({ facts: document.querySelector(".al-facts").textContent, cells: [...document.querySelectorAll(".al-cell")].map((c) => [c.title, c.querySelector(".al-badge")?.textContent || "", !!c.querySelector("img").src]) })`);
      check("альбомы: живое фото — одна клетка LIVE, ролик — своя клетка ▶ с кадром", riga.cells.length === 2 && riga.cells[0][1] === "LIVE" && riga.cells[1][1] === "▶"
        && riga.cells.every((c) => c[2]) && /^1 фото · 1 видео/.test(riga.facts), JSON.stringify(riga));
      check("альбомы: дата ролика — из самого файла", /^01\.01\.2024 · v\.mp4$/.test(riga.cells[1]?.[0]), JSON.stringify(riga));
      const cxy = await run(`(() => { const r = document.querySelectorAll(".al-cell")[1].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
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
      }
      await run(exitMode);
      await run(closeLayers);
      await run(`${gear}.click(); true`);
      await sleep(600);
      await run(`${setBtn("Убрать")}.click(); true`);
      for (let i = 0; i < 20 && (await run(`${as}.groups`)); i++) await sleep(500);
      await run(`${gear}.click(); true`);
      await sleep(300);
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
    const items = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].map((b) => b.firstChild.textContent)`);
    const tkHome = await run(`({ panel: !document.querySelector('[data-panel="tracks"]').hidden, open: document.querySelector('[data-panel="tracks"] .tk-open')?.textContent })`);
    check("треки: кнопка раздела — сразу панель со списком, первой строкой «Открыть файл трека…»", tkHome.panel && tkHome.open === "Открыть файл трека…", JSON.stringify({ items, tkHome }));
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
      const found = [...document.querySelectorAll('[data-panel="tracks"] .tr-row-title')].map((r) => r.textContent);
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
    sub: [...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].map((c) => c.firstChild.textContent),
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
      search: getComputedStyle(document.querySelector(".search")).display !== "none", logo: !!L.querySelector("img"),
      lenses: [L, document.querySelector(".search-go")].filter((b) => b.getClientRects().length && b.querySelector("svg path")?.getAttribute("d").startsWith("M15.5 14")).length });
    // поиск открыт, а на месте барабана разделов — слои: первый щелчок вернёт разделы, второй закроет
    for (let k = 0; k < 2 && !document.body.classList.contains("search-hidden"); k++) { L.click(); await wait(); }
    if (st().layers) { A.click(); await wait(); }
    const s0 = st();
    L.click(); await wait(); const s1 = st();
    const keys = [...document.querySelectorAll(".wheel-content .wheel-cell:not([hidden]) .layers-circle")].map((c) => c.ariaLabel).sort();
    A.click(); await wait(); const s2 = st();
    A.click(); await wait(); const s3 = st();
    L.click(); await wait(); L.click(); await wait(); const s4 = st();
    const lr = L.getBoundingClientRect();
    A.click(); await wait();
    return { s0, s1, s2, s3, s4, keys, corner: innerWidth - lr.right < 16 && lr.top < 20 }; })()`);
  check("лупа: щелчок — поиск и разделы, на её месте логотип; треугольник — слои; второй щелчок прячет",
    !lens.s0.search && !lens.s0.content && lens.s0.lenses === 1 && lens.s1.content && lens.s1.search && lens.s1.logo && lens.s1.lenses === 1
    && lens.s2.layers && !lens.s2.content && lens.s2.search && !lens.s3.layers && !lens.s4.search && !lens.s4.content && !lens.s4.logo
    && JSON.stringify(lens.keys) === JSON.stringify(["Мои альбомы", "Мои треки", "Экскурсии", "Языки"]) && lens.corner, JSON.stringify(lens));
  // барабан: в центре промежутки между кнопками больше, к краям меньше, крайние темнее; колёсико
  // крутит его, нажатие по кнопке не в центре докручивает её и открывает столбик
  await run(`document.querySelector(".sub-layers").hidden || document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); true`);
  const drum = await run(`(() => { const cells = [...document.querySelectorAll(".wheel-layers .wheel-cell")].filter((c) => !c.hidden)
    .map((c) => { const r = c.getBoundingClientRect(); return { y: r.top + r.height / 2, b: parseFloat(c.style.filter.replace("brightness(", "")) }; })
    .sort((a, b) => a.y - b.y); const gaps = cells.slice(1).map((c, i) => Math.round(c.y - cells[i].y));
    return { n: cells.length, gaps, edge: cells[0].b, mid: Math.max(...cells.map((c) => c.b)) }; })()`);
  const mid = Math.floor(drum.gaps.length / 2);
  check("колесо: в центре промежутки больше, к краям меньше и темнее", drum.n >= 5 && drum.gaps[0] < drum.gaps[mid] && drum.gaps.at(-1) < drum.gaps[mid] && drum.edge < drum.mid, JSON.stringify(drum));
  const centerKey = `(() => { const r = document.querySelector(".wheel-layers").getBoundingClientRect(), m = r.top + r.height / 2;
    return [...document.querySelectorAll(".wheel-layers .wheel-cell")].filter((c) => !c.hidden).map((c) => { const b = c.getBoundingClientRect(); return [Math.abs(b.top + b.height / 2 - m), c.querySelector(".layers-circle").dataset.key]; }).sort((a, b) => a[0] - b[0])[0][1]; })()`;
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
  const relief = await run(`[...document.querySelectorAll(".layers-sub:not([hidden]) .layers-item, .home-row")].map((c) => c.firstChild.textContent)`);
  check("«Карты»: виды карт, под чертой тени и 3D и высоты", relief.includes("Высоты") && relief.includes("Тени и 3D") && relief.length === 7
    && (await run(`!!document.querySelector(".layers-sub .layers-sep")`)), JSON.stringify(relief));
  await run(`atlas.toggle("layers/railways", false).then(() => true)`);
  await run(`document.querySelector(".maplibregl-ctrl-bottom-left button[title=Настройки]").click(); true`);
  await sleep(800);
  check("настройки прячут колесо", await run(`document.querySelector(".wheel-layers").classList.contains("closed") && document.querySelector(".sub-layers").hidden && document.querySelectorAll(".panel:not([hidden])").length === 1`));
  await shot("96-panel-settings");
  // «Поделиться» — первой строкой, ссылка на сайт программы
  const share = await run(`(async () => { const b = document.querySelector(".panel:not([hidden]) .panel-body > :first-child");
    const m = await import("./core/settings-panel.js"); return { first: b?.classList.contains("share-btn") && b.textContent.includes("Поделиться"), link: m.SITE }; })()`);
  check("настройки: первой строкой «Поделиться», ссылка на сайт", share.first && share.link === "https://gregory-gittools.github.io/atlas/", JSON.stringify(share));
  // своя папка «Моих альбомов» — только на компьютере
  // (эмуляция телефона здесь меняет только размер экрана — телефон узнаётся так же, как в программе)
  const albumsSet = await run(`(async () => { const m = await import("./core/modules.js");
    return { shown: [...document.querySelectorAll(".panel:not([hidden]) .set-title")].some((t) => t.textContent === "Мои альбомы"), phone: m.isMobile() }; })()`);
  check("настройки: раздел «Мои альбомы» (папка) — только на компьютере", albumsSet.shown === !albumsSet.phone, JSON.stringify(albumsSet));
  // раскладка: ⓘ и шкала — в линию с шестерёнкой, треугольник — в правом нижнем углу, логотип в поиске,
  // верх колеса — под лупой справа вверху (на компьютере)
  await run(openSearch);
  const lay = await run(`(() => { const mid = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
    const gear = document.querySelector(".maplibregl-ctrl-bottom-left button[title=Настройки]");
    const t = document.querySelector(".wheel-toggle").getBoundingClientRect(), w = document.querySelector(".wheel-layers").getBoundingClientRect();
    const sb = document.querySelector(".search-box").getBoundingClientRect();
    return { gear: mid(gear), info: mid(document.querySelector(".maplibregl-ctrl-attrib-button")), scale: mid(document.querySelector(".maplibregl-ctrl-scale")),
      corner: [Math.round(innerWidth - t.right), Math.round(innerHeight - t.bottom)], size: Math.round(t.width),
      logo: (() => { const i = document.querySelector(".search-toggle.open img"), b = i?.parentElement.getBoundingClientRect(); return !!i?.naturalWidth && i.getBoundingClientRect().width >= b.width; })(), wheelTop: Math.round(w.top), searchTop: Math.round(sb.top), phone: innerWidth <= 600 }; })()`);
  check("раскладка: ⓘ и шкала в линию с шестерёнкой", Math.abs(lay.info - lay.gear) <= 2 && Math.abs(lay.scale - lay.gear) <= 2, JSON.stringify(lay));
  check("раскладка: треугольник в правом нижнем углу, размером с кнопки", lay.corner.every((v) => v >= 6 && v <= 14) && lay.size === 40, JSON.stringify(lay));
  check("раскладка: открыт поиск — на месте лупы логотип во весь кружок", lay.logo);
  if (!lay.phone) check("раскладка: верх колеса — под лупой", Math.abs(lay.wheelTop - (lay.searchTop + 50)) <= 2, JSON.stringify(lay));
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
process.exit(errors.length ? 1 : 0);

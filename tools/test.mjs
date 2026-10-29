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
    geo: !!document.querySelector(".geo-btn"), order: [...document.querySelectorAll(".maplibregl-ctrl-bottom-right .maplibregl-ctrl")].map((c) => c.querySelector("button")?.title || c.className.split(" ").pop()) })`);
  check("звёзды, шкала, «Где я»", extras.stars && /км|м$/.test(extras.scale || "") && extras.geo, JSON.stringify(extras));
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

  // подложки: каждая загружается без ошибок, и язык подписей ставится заново
  const basemaps = await run(`[...document.querySelectorAll(".basemap-row .basemap-item")].map((b) => b.title)`);
  check("переключатель карт", basemaps.length >= 5, `${basemaps.length} карт`);
  for (let i = 0; i < basemaps.length; i++) {
    await run(`document.querySelectorAll(".basemap-row .basemap-item")[${i}].click(); true`);
    await sleep(500);
    await idle();
    if (i === 0) await shot("50-satellite");
    const ok = await run(`atlas.map.isStyleLoaded() && atlas.map.getStyle().layers.length > 0`);
    check(`карта «${basemaps[i]}»`, ok);
  }
  await run(`document.querySelectorAll(".basemap-row .basemap-item")[1].click(); true`);
  await idle();

  // язык подписей: English → у подписей name:en; потом обратно русский
  const lang = await run(`(async () => { const b = document.querySelector(".lang-btn"); b.click();
    [...document.querySelectorAll(".lang-menu .menu-item")].find((i) => i.textContent === "English").click();
    await new Promise((r) => setTimeout(r, 300));
    const en = atlas.map.getStyle().layers.some((l) => JSON.stringify(l.layout?.["text-field"] || "").includes("name:en"));
    b.click(); [...document.querySelectorAll(".lang-menu .menu-item")].find((i) => i.textContent === "Русский").click();
    return { en, label: b.textContent }; })()`);
  check("язык подписей переключается", lang.en && lang.label === "Ру", JSON.stringify(lang));

  // поиск: запрос → список → выбор → маркер и запись в историю
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

  // «Слои»: кнопка открывает столбик кружков, кружок — подменю раздела (как человек щёлкает)
  const openLayers = (key) => `(async () => {
    if (document.querySelector(".layers-list").hidden) document.querySelector(".layers-menu > .layers-cell .layers-circle").click();
    await new Promise((r) => setTimeout(r, 200));
    const c = [...document.querySelectorAll(".layers-list .layers-circle")].find((b) => b.dataset.key === ${JSON.stringify(key)});
    if (!c.classList.contains("open")) c.click();
    await new Promise((r) => setTimeout(r, 300));
    return true; })()`;
  const closeLayers = `(() => { if (!document.querySelector(".layers-list").hidden) document.querySelector(".layers-menu > .layers-cell .layers-circle").click(); return true; })()`;
  // кнопка в столбике кружка по названию
  const itemFor = (title) => `[...document.querySelectorAll(".layers-sub .layers-item")].find((c) => c.firstChild.textContent === ${JSON.stringify(title)})`;

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
      chipsOn: [...document.querySelectorAll(".layers-sub .layers-item.on")].map((c) => c.firstChild.textContent) })`);
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
      const items = [...document.querySelectorAll(".layers-sub .layers-item")].map((i) => i.firstChild.textContent);
      ${itemFor(title)}.click();
      await new Promise((r) => setTimeout(r, 1500));
      // столбик кнопок не закрывается после выбора
      const open = !document.querySelector(".layers-sub").hidden;
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
      label: document.querySelector('.layers-circle[data-key="places/transport"]').title })`);
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
        noneMarked: !document.querySelector(".layers-sub .layers-item.on"),
        rings: [...document.querySelectorAll(".layers-sub .layers-icon.ring")].length };
      ${closeLayers};
      return res; })()`);
    check("транспорт: крестик снимает всё, у видов кольца цвета", cleared.shown && cleared.off && cleared.noneMarked && cleared.rings === 7, JSON.stringify(cleared));
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
      const circles = [...document.querySelectorAll(".layers-list .layers-circle")].map((c) => c.title.split(":")[0]);
      const items = [...document.querySelectorAll(".layers-sub .layers-item")].map((i) => i.firstChild.textContent);
      ${itemFor("Маунтинбайк")}.click();
      await new Promise((r) => setTimeout(r, 1500));
      const layers = { cycling: !!atlas.map.getLayer("trails-cycling-line"), mtb: !!atlas.map.getLayer("trails-mtb-line") };
      const label = document.querySelector('.layers-circle[data-key="trails/cycling"]').title;
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
  const lm = await run(`({ groups: [...document.querySelectorAll(".layers-list .layers-circle")].map((c) => c.title.split(":")[0]),
    sub: [...document.querySelectorAll(".layers-sub .layers-item")].map((c) => c.firstChild.textContent),
    on: [...document.querySelectorAll(".layers-list .layers-circle.on")].map((c) => c.title) })`);
  check("«Слои»: кружки, «Дороги» — виды и железные дороги, «Фото»", ["Места", "Транспорт", "Магазины", "Тропы", "Велодорожки", "Дороги", "Рельеф", "Погода", "Фото"].every((g) => lm.groups.includes(g))
    && !lm.groups.includes("Пляжи и сёрфинг") && lm.sub.length === 5
    && lm.sub.includes("Железные дороги") && lm.on.includes("Дороги"), JSON.stringify(lm));
  await shot("95-panel-layers");
  await run(openLayers("relief"));
  const relief = await run(`[...document.querySelectorAll(".layers-sub .layers-item")].map((c) => c.firstChild.textContent)`);
  check("«Рельеф»: тени и 3D + высоты", relief.includes("Высоты") && relief.length === 2, JSON.stringify(relief));
  await run(`atlas.toggle("layers/railways", false).then(() => true)`);
  await run(`document.querySelector(".maplibregl-ctrl-bottom-right button[title=Настройки]").click(); true`);
  await sleep(800);
  check("панель закрывает столбик «Слои»", await run(`document.querySelector(".layers-list").hidden && document.querySelector(".layers-sub").hidden && document.querySelectorAll(".panel:not([hidden])").length === 1`));
  await shot("96-panel-settings");
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

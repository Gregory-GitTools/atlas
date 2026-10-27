// Проверка Atlas: node tools/test.mjs [--phone]
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
    const text = d.params.args.map((a) => a.value ?? a.description).join(" ");
    // сбои чужих серверов (плитка не пришла или пришла пустой) — не ошибка программы, только счёт
    if (/Failed to fetch|AJAXError|could not be decoded/.test(text)) netFails++;
    else errors.push("console.error: " + text.slice(0, 200));
  }
};
const send = (method, params = {}) => new Promise((r) => { const id = ++nextId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const run = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
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

  // места: в центре Таллина «Рестораны» — флажки; «Музеи» выключают «Рестораны»; щелчок по флажку — окно
  if (mods.some((m) => m.id === "places/food")) {
    await run(`atlas.map.jumpTo({ center: [24.745, 59.437], zoom: 16 }); document.querySelector(".top-right").click(); true`);
    await sleep(500);
    const chipFor = (title) => `[...document.querySelectorAll("[data-panel=layers] .chip, [data-panel=layers] .chip-main")].find((c) => c.textContent.trim() === ${JSON.stringify(title)})`;
    await run(`${chipFor("Рестораны")}.click(); true`);
    await sleep(800);
    await idle();
    const pins = await run(`atlas.map.queryRenderedFeatures({ layers: ["places-poi"] }).length`);
    check("места: флажки ресторанов", pins > 0, `${pins}`);
    await shot("80-places-food");
    await run(`${chipFor("Музеи")}.click(); true`);
    await sleep(800);
    const excl = await run(`({ food: atlas.modules().find((m) => m.id === "places/food").active, museums: atlas.modules().find((m) => m.id === "places/museums").active })`);
    check("места: одна категория за раз", !excl.food && excl.museums, JSON.stringify(excl));
    await run(`${chipFor("Музеи")}.click(); ${chipFor("Рестораны")}.click(); document.querySelector("[data-panel=layers] .panel-btn[title=Закрыть]").click(); true`);
    await sleep(800);
    await idle();
    const pt = await run(`(() => { const f = atlas.map.queryRenderedFeatures({ layers: ["places-poi"] })[0]; if (!f) return null; const p = atlas.map.project(f.geometry.coordinates); return { x: p.x, y: p.y - 15 }; })()`);
    if (pt) {
      await clickAt(pt.x, pt.y);
      await sleep(3500);
      const pop = await run(`document.querySelector(".maplibregl-popup .popup-title")?.textContent || ""`);
      check("места: щелчок по флажку — окно", !!pop, pop);
      await shot("81-places-popup");
    }
    await run(`atlas.toggle("places/food", false); true`);
  }

  // пешие тропы (Валь-Гардена): с зума 11 — линии с номерами, с 14 — полная геометрия маршрутов
  if (mods.some((m) => m.id === "trails/hiking")) {
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
    await shot("86-trails-full");
    await run(`atlas.toggle("trails/hiking", false)`);
  }

  // рельеф и горизонтали в горах: линии высот появились, 3D включается
  if (mods.some((m) => m.id === "layers/contours")) {
    await run(`atlas.map.jumpTo({ center: [11.85, 46.55], zoom: 13 }); (async () => { await atlas.toggle("layers/hillshade", true); await atlas.toggle("layers/contours", true); return true; })()`);
    for (let i = 0; i < 20 && !(await run(`atlas.map.getLayer("contours") ? atlas.map.queryRenderedFeatures({ layers: ["contours"] }).length > 0 : false`)); i++) await sleep(1000);
    await idle();
    const n = await run(`atlas.map.getLayer("contours") ? atlas.map.queryRenderedFeatures({ layers: ["contours"] }).length : -1`);
    check("горизонтали", n > 0, `${n} линий`);
    await shot("87-contours");
    const t3d = await run(`(async () => { await atlas.toggle("layers/terrain3d", true); atlas.map.jumpTo({ pitch: 60 }); await new Promise((r) => setTimeout(r, 4000)); const on = !!atlas.map.getTerrain(); return on; })()`);
    await shot("88-terrain3d");
    check("3D-рельеф", t3d);
    await run(`(async () => { atlas.map.jumpTo({ pitch: 0 }); for (const id of ["layers/terrain3d", "layers/contours", "layers/hillshade"]) await atlas.toggle(id, false); return true; })()`);
  }

  // пляжи и кайт (QLever): у Таллина — значки пляжей; сёрфинг — по всему миру и споты Грегори
  if (mods.some((m) => m.id === "layers/beaches")) {
    await run(`atlas.map.jumpTo({ center: [24.65, 59.47], zoom: 10.5 }); (async () => { await atlas.toggle("layers/beaches", true); await atlas.toggle("layers/surf", true); return true; })()`);
    const count = (id) => `(atlas.map.getSource(${JSON.stringify(id)})?._data?.features?.length ?? atlas.map.getSource(${JSON.stringify(id)})?.serialize?.().data?.features?.length ?? 0)`;
    for (let i = 0; i < 45 && !(await run(`atlas.map.getLayer("beaches") && atlas.map.queryRenderedFeatures({ layers: ["beaches"] }).length > 0`)); i++) await sleep(1000);
    const b = await run(`({ beaches: atlas.map.queryRenderedFeatures({ layers: ["beaches"] }).length, surf: atlas.map.queryRenderedFeatures({ layers: ["surf"] }).length })`);
    check("пляжи и сёрфинг", b.beaches > 0 && b.surf > 0, JSON.stringify(b));
    await shot("89-beaches-surf");
    await run(`(async () => { await atlas.toggle("layers/beaches", false); await atlas.toggle("layers/surf", false); return true; })()`);
  }

  for (const id of ["layers", "settings"]) {
    await run(`document.querySelector('[data-panel=${id}]') ? true : false`).then((has) => check(`панель «${id}» есть`, has));
  }
  await run(`document.querySelector(".top-right").click(); true`);
  await sleep(500);
  await shot("90-panel-layers");
  await run(`document.querySelector(".maplibregl-ctrl-bottom-right button[title=Настройки]").click(); true`);
  await sleep(800);
  check("одновременно открыта одна панель", await run(`document.querySelectorAll(".panel:not([hidden])").length === 1`));
  await shot("91-panel-settings");
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

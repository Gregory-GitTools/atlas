// Сторона воды у кайт-спотов списка Грегори: node tools/spot-sea.mjs
// Открывает Atlas в Chrome без окна, подводит карту к каждой точке surf-spots.json (масштаб ~1:30 000)
// и записывает в точку поле sea — 16 знаков по румбам (С, ССВ, … ССЗ): «1» — в 1,2 км вода, «0» — суша
// (layers/outdoor.js, seaAround). Нужен заново, когда список спотов поменялся. Только встроенное в Node.
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "surf-spots.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error("Chrome не найден: укажите путь в CHROME"); process.exit(2); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, "index.html") : file;
  if (!target.startsWith(ROOT) || !fs.existsSync(target)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[path.extname(target)] || "application/octet-stream" });
  fs.createReadStream(target).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-sea-"));
const chrome = spawn(CHROME, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error("Chrome не ответил")), 20000);
});
const targets = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++nextId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const run = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r?.result.value;
};

try {
  await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  for (let i = 0; i < 60 && !(await run(`!!window.atlas?.map?.loaded?.()`).catch(() => false)); i++) await sleep(500);
  await run(`atlas.toggle("layers/surf", true).then(() => true)`);
  const spots = JSON.parse(fs.readFileSync(FILE, "utf8"));
  for (const s of spots) {
    await run(`atlas.map.jumpTo({ center: [${s.lon}, ${s.lat}], zoom: 13 }); true`);
    await run(`new Promise((r) => { const t = Date.now(); const c = () => atlas.map.loaded() && atlas.map.areTilesLoaded() || Date.now() - t > 20000 ? r(true) : setTimeout(c, 300); c(); })`);
    s.sea = await run(`atlas.modules().find((m) => m.id === "layers/surf").seaAround([${s.lon}, ${s.lat}])`);
    console.log(s.sea, s.name);
  }
  // как было: одна точка — одна строка
  fs.writeFileSync(FILE, "[\n" + spots.map((s) => "  " + JSON.stringify(s).replace(/,"/g, ', "').replace(/":/g, '": ')).join(",\n") + "\n]\n");
} finally {
  ws.close();
  chrome.kill();
  server.close();
}

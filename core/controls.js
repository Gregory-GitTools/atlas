// Кнопки и приборы карты (как в travel-earth): шкала масштаба по-русски, навигация, компас, звёздное небо.
// Столбик слева внизу, снизу вверх: настройки, компас, навигация —
// MapLibre ставит каждый следующий элемент угла выше предыдущих, поэтому порядок addControl важен.
// Кнопок «+ −» нет (Грегори, 2026-11-02): приближают колёсиком, пальцами, двойным щелчком
import * as settings from "./settings.js";
import { emit, on } from "./events.js";

// кнопка столбика — полупрозрачная, как лупа и треугольник (класс glass — один на все такие кнопки)
export function addMapButton(map, { title, html, className = "" }) {
  const btn = Object.assign(document.createElement("button"), { type: "button", className: ["btn glass", className].filter(Boolean).join(" "), title, innerHTML: html });
  map.addControl({
    onAdd() {
      const box = Object.assign(document.createElement("div"), { className: "maplibregl-ctrl map-btn" });
      box.append(btn);
      return box;
    },
    onRemove() {},
  }, "bottom-left");
  return btn;
}

// ---------- шкала ----------
// «м»/«км» — из русских подписей карты (locale в app.js)
export function addScale(map, maplibregl) {
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
}

// ---------- навигация («Где я») ----------
// как в Google Maps и Mapy.com: первый щелчок — слежение, карта встаёт на меня (центр значка синий);
// сдвинул карту рукой — она не бегает за мной (центр серый), через 10 секунд сама возвращается
// («пешком и в машине всегда к себе»); щелчок по серому — сразу ко мне, по синему — выключить.
// При запуске не включается никогда. Грегори, 2026-11-03 — где я на экране, по режиму компаса:
//   С (север вверху) — я в центре, карта не крутится;
//   2D — я в центре, стороны света — как повернули (карта не крутится);
//   3D — я в нижней части, карта по ходу движения.
// Режим следует за экраном: наклонил рукой — через 10 с ко мне в 3D, выровнял — через 10 с в центр 2D;
// север вверху — только кнопкой компаса.
// Масштаб и наклон навигация не трогает никогда («нельзя постоянно бороться»); только при включении
// издалека (весь шар) — один перелёт ко мне. Метка и карта движутся плавно, от точки к точке за время
// между замерами GPS (а не прыжками). Направление — курс GPS на ходу, иначе по сдвигу больше 8 м;
// стою — по компасу телефона (если он есть). Во 2D и 3D метка — стрелка, на севере — точка.
// Координаты не уходят никуда: геолокация браузера работает на устройстве; где я — событие «me»
// (линия «Куда идти» в route.js)
const GEO_ZOOM = 16;
const FAR_ZOOM = 10; // дальше — при включении перелёт ко мне
const NAV_MIN_STEP = 8; // м — сдвиг, по которому видно направление
const NAV_TURN = 4; // ° — поворот меньше не трогает карту (GPS дрожит)
const NAV_BACK = 10000; // мс — сдвинул карту рукой: через столько она вернётся ко мне
const NAV_LOW = 0.25; // я — на четверть экрана ниже середины

const metersBetween = (a, b) => {
  const k = Math.PI / 180, x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k), y = (b[1] - a[1]) * k;
  return Math.hypot(x, y) * 6371008.8;
};
const bearingBetween = (a, b) => {
  const k = Math.PI / 180, la1 = a[1] * k, la2 = b[1] * k, dl = (b[0] - a[0]) * k;
  return (Math.atan2(Math.sin(dl) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl)) / k + 360) % 360;
};
const turnOf = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const NAV_ICON = `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle class="geo-center" cx="12" cy="12" r="3.5"/></svg>`;
const CHEVRON = `<svg class="geo-chevron" viewBox="0 0 40 40" width="40" height="40"><path d="M20 3l13 32-13-7-13 7z" fill="#1a73e8" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>`;

export function addGeolocate(map, maplibregl, status) {
  let watch = null, follow = false, position = null, shownPos = null, marker = null, btn;
  let heading = null, moveHeading = null, anchor = null, lastFix = 0, lastSpeed = 0, first = true, anim = 0, back = null;

  const courseUp = () => compassMode === "3d";
  const low = () => compassMode === "3d";
  let wasOn = null;
  const update = () => {
    // навигация включена или выключена — событие nav (кнопка «Навигация» в барабане — её индикатор)
    if (wasOn !== (watch !== null)) { wasOn = watch !== null; emit("nav", { on: wasOn }); }
    btn.classList.toggle("on", watch !== null);
    btn.classList.toggle("follow", watch !== null && follow);
    btn.title = watch === null ? "Навигация" : !follow ? "Навигация: снова ко мне" : "Навигация — щелчок выключит";
    if (!marker) return;
    const el = marker.getElement();
    el.classList.toggle("moving", heading !== null);
    el.classList.toggle("chevron", heading !== null && compassMode !== "north");
    if (heading !== null) marker.setRotation(heading);
  };
  // карта ко мне: только центр (и поворот по ходу в 3D) — масштаб и наклон не трогаем
  const center = (duration = 800) => {
    if (!position || compassTurning) return;
    const offset = [0, low() ? Math.round(innerHeight * NAV_LOW) : 0];
    const bearing = compassMode === "north" ? { bearing: 0 } : courseUp() && moveHeading !== null ? { bearing: moveHeading } : {};
    // navFollow — окна на карте от этого не закрываются (Грегори 2026-11-04: «окно Сюда постоянно сбрасывается»)
    if (first && map.getZoom() < FAR_ZOOM) map.flyTo({ center: position, zoom: GEO_ZOOM, offset, ...bearing, duration: 3000 }, { navFollow: true });
    else map.easeTo({ center: position, offset, ...bearing, duration, easing: (t) => t }, { navFollow: true });
    first = false;
  };
  // метка — плавно от прежней точки к новой
  const glide = (to, duration) => {
    cancelAnimationFrame(anim);
    const from = shownPos || to, t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      shownPos = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
      marker?.setLngLat(shownPos);
      emit("me", { lngLat: shownPos });
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };
  // направление движения: курс GPS на ходу, иначе по сдвигу; поворот меньше NAV_TURN — не считается
  const course = (pos, p) => {
    const gps = pos.coords.heading, speed = pos.coords.speed;
    let h = null;
    if (Number.isFinite(gps) && speed > 0.7) { h = gps; anchor = p; }
    else if (!anchor) anchor = p;
    else if (metersBetween(anchor, p) > NAV_MIN_STEP) { h = bearingBetween(anchor, p); anchor = p; }
    if (h === null) return;
    if (moveHeading === null || turnOf(h, moveHeading) >= NAV_TURN) moveHeading = h;
    heading = moveHeading;
  };
  // компас телефона — стрелка, пока стою (карту по нему не крутим)
  const onCompass = (e) => {
    const h = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? (360 - e.alpha) % 360 : null);
    if (h == null || watch === null || lastSpeed > 0.7) return;
    if (heading !== null && turnOf(h, heading) < NAV_TURN) return;
    heading = h;
    update();
  };
  const listenCompass = async () => {
    try { if (typeof DeviceOrientationEvent?.requestPermission === "function") await DeviceOrientationEvent.requestPermission(); } catch { return; }
    addEventListener("deviceorientationabsolute", onCompass);
    addEventListener("deviceorientation", onCompass);
  };

  const start = () => {
    if (!navigator.geolocation) { status("Этот браузер не умеет определять местоположение"); return; }
    follow = true;
    first = true;
    listenCompass();
    watch = navigator.geolocation.watchPosition((pos) => {
      const now = Date.now(), gap = lastFix ? Math.min(1500, Math.max(300, now - lastFix)) : 0;
      lastFix = now;
      lastSpeed = pos.coords.speed || 0;
      position = [pos.coords.longitude, pos.coords.latitude];
      course(pos, position);
      if (!marker) {
        const el = Object.assign(document.createElement("div"), { className: "geo-dot", innerHTML: CHEVRON });
        el.append(Object.assign(document.createElement("div"), { className: "geo-arrow" }));
        marker = new maplibregl.Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat(position).addTo(map);
        shownPos = position;
      }
      if (gap) glide(position, gap); else { marker.setLngLat((shownPos = position)); emit("me", { lngLat: position }); }
      update();
      if (follow) center(gap || 800);
    }, (err) => {
      // запрет — выключить совсем, иначе спрашивали бы при каждом запуске
      if (err.code === err.PERMISSION_DENIED) { stop(); status("Нет доступа к местоположению — разрешите его браузеру"); }
      else status("Не удаётся определить местоположение");
    }, { enableHighAccuracy: true, maximumAge: 1000 });
    update();
  };
  const stop = () => {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null; follow = false; position = shownPos = null; heading = moveHeading = null; anchor = null; lastFix = 0;
    cancelAnimationFrame(anim);
    clearTimeout(back); back = null;
    removeEventListener("deviceorientationabsolute", onCompass);
    removeEventListener("deviceorientation", onCompass);
    marker?.remove(); marker = null;
    emit("me", null);
    update();
  };

  btn = addMapButton(map, { title: "Навигация", className: "geo-btn", html: NAV_ICON });
  btn.addEventListener("click", () => {
    if (watch === null) start();
    else if (!follow) { clearTimeout(back); back = null; follow = true; update(); center(); }
    else stop();
  });

  // сдвинул, повернул, наклонил или приблизил карту рукой — она не бегает за мной, через 10 секунд —
  // снова ко мне (в режиме, который стал от наклона: 3D или 2D)
  const comeBack = () => {
    clearTimeout(back);
    back = setTimeout(() => { back = null; if (watch !== null && !follow) { follow = true; update(); center(); } }, NAV_BACK);
  };
  const userMove = (e) => {
    if (!e.originalEvent || watch === null) return;
    if (follow || back) comeBack();
    if (follow) { follow = false; update(); }
  };
  map.on("dragstart", userMove);
  map.on("rotatestart", userMove);
  map.on("pitchstart", userMove);
  map.on("zoomstart", (e) => { if (e.originalEvent && back) comeBack(); });
  // сменили режим компаса — я в центре или внизу; ждём, пока компас докрутит карту
  modeWatchers.add(() => {
    update();
    if (follow && position) map.once("moveend", () => follow && setTimeout(center));
  });
  // включить или выключить из раздела «Навигация»
  on("nav-switch", ({ on: want }) => { if (want && watch === null) start(); else if (!want && watch !== null) stop(); }, { replay: false });
  // при запуске навигация не включается никогда, даже если была включена при закрытии (Грегори 2026-11-05:
  // «загрузка идёт, ничего не происходит, а кнопка включена — дезориентирует»)
  settings.set("geolocate", null);
  update();
  // для проверки
  return { state: () => ({ on: watch !== null, follow, mode: compassMode, heading, position }) };
}

// ---------- наклон: тонкая полоска космоса, на 100 км — 2D ----------
// Грегори, 2026-11-02: при отдалении полоска космоса над горизонтом не должна расти — наклон сам
// уменьшается так, что космоса над горизонтом около 8 % высоты экрана; на шкале «100 км» карта
// ложится в 2D (за один шаг масштаба наклон уходит в 0). Обратно при приближении наклон не возвращается —
// наклонить можно снова (компас, правая кнопка мыши, два пальца).
// Наибольший наклон по масштабу — замер полоски космоса в Chrome (MapLibre 6.16, глобус, 2026-11-02);
// масштаб — метры в точке, поэтому одинаково на экваторе и на севере
export const MAX_PITCH = 70;
const SPACE_PITCH = [[5, 45], [6, 53], [7, 59], [8, 64], [9, 67], [10, 69], [11, MAX_PITCH]]; // [масштаб, наклон]
const FLAT_M = 1000; // метров в точке: 100 px шкалы = 100 км — дальше только 2D

export function tiltLimit(map) {
  const m = (40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  const z = Math.log2(40075016.686 / (512 * m)); // «масштаб»: как зум на экваторе
  const i = SPACE_PITCH.findIndex(([zz]) => zz > z);
  const [[z0, p0], [z1, p1]] = i < 0 ? [SPACE_PITCH.at(-1), SPACE_PITCH.at(-1)] : i === 0 ? [SPACE_PITCH[0], SPACE_PITCH[0]] : [SPACE_PITCH[i - 1], SPACE_PITCH[i]];
  const pitch = z1 === z0 ? p0 : p0 + ((p1 - p0) * (z - z0)) / (z1 - z0);
  const flat = Math.min(1, Math.max(0, z - Math.log2(40075016.686 / (512 * FLAT_M))));
  return Math.round(pitch * flat * 10) / 10;
}

// пределу наклона — следовать за масштабом; лишний наклон MapLibre убирает сразу, не прерывая движения карты
function keepTilt(map) {
  const update = () => { const l = tiltLimit(map); if (l !== map.getMaxPitch()) map.setMaxPitch(l); };
  map.on("move", update);
  map.on("load", update);
  update();
}

// ---------- компас: 3D · Север · 2D ----------
// Грегори, 2026-11-02: три режима по кругу, щелчок — следующий:
//   3D — карта наклонена (с навигацией — карта по ходу движения);
//   Север — 2D по сторонам света: север вверху, повернуть карту нельзя;
//   2D — свободно: поворачивайте как удобно (правая кнопка мыши, два пальца).
// Стрелка поворачивается вместе с картой и ложится при наклоне; под ней — режим. Наклонили или выпрямили
// карту рукой — режим следует за ней (Грегори, 2026-11-03: «один раз нажал компас и дальше следим за
// экраном»: наклонил — 3D, выровнял — 2D; север вверху — только кнопкой).
// Издалека (шкала 100 км и дальше) 3D нет — режим пропускается
const TILT = 60;
const LABEL = { "3d": "3D", north: "С", "2d": "2D" };
// режим компаса — и для навигации (где на экране я и крутится ли карта)
let compassMode = "2d";
let compassTurning = false; // компас докручивает карту — навигация не перебивает (ко мне — после)
const modeWatchers = new Set();
const TITLE = { "3d": "3D — наклон; с навигацией карта по ходу движения", north: "Север вверху, карта не поворачивается", "2d": "2D — карту можно поворачивать" };

export function addCompass(map) {
  const btn = addMapButton(map, { className: "compass-btn",
    html: `<svg class="compass-needle" viewBox="0 0 24 24" width="20" height="20"><path d="M12 2l4 10h-8z" fill="#e53935"/><path d="M12 22l-4-10h8z" fill="currentColor"/></svg><span class="compass-mode"></span>` });
  const needle = btn.querySelector(".compass-needle"), label = btn.querySelector(".compass-mode");
  let mode = map.getPitch() > 5 ? "3d" : settings.get("compass.mode") === "north" ? "north" : "2d";
  const lockRotate = (lock) => {
    if (lock) { map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); map.keyboard.disableRotation(); }
    else { map.dragRotate.enable(); map.touchZoomRotate.enableRotation(); map.keyboard.enableRotation(); }
  };
  const next = () => (mode === "3d" ? "north" : mode === "north" ? "2d" : map.getMaxPitch() < 5 ? "north" : "3d");
  const update = () => {
    if (compassMode !== mode) { compassMode = mode; for (const f of modeWatchers) f(mode); }
    needle.style.transform = `rotateX(${map.getPitch()}deg) rotate(${-map.getBearing()}deg)`;
    label.textContent = LABEL[mode];
    btn.title = `${TITLE[mode]}. Щелчок — ${TITLE[next()].split(" — ")[0].split(",")[0].toLowerCase()}`;
    btn.dataset.mode = mode;
  };
  const set = (m) => {
    mode = m;
    settings.set("compass.mode", m === "north" ? "north" : null);
    // наклон тоже поворачивается правой кнопкой — в режиме «Север» её нет, наклон — щелчком по компасу
    lockRotate(m === "north");
    compassTurning = true;
    if (m === "3d") map.easeTo({ pitch: TILT, duration: 1000 });
    else map.easeTo({ pitch: 0, ...(m === "north" && { bearing: 0 }), duration: 1000 });
    // после easeTo: прерванное им движение тоже заканчивается moveend
    map.once("moveend", () => { compassTurning = false; });
    update();
  };
  btn.addEventListener("click", () => set(next()));
  // наклонили рукой — 3D; выпрямили рукой (или карта легла сама при отдалении) — свободный 2D
  map.on("moveend", () => {
    const tilted = map.getPitch() > 5;
    if (tilted === (mode === "3d")) return;
    mode = tilted ? "3d" : "2d";
    settings.set("compass.mode", null);
    lockRotate(false);
    update();
  });
  keepTilt(map);
  lockRotate(mode === "north");
  map.on("move", update);
  update();
  return { mode: () => mode };
}

// ---------- звёздное небо ----------
// Вокруг глобуса холст MapLibre прозрачный, под ним — холст со звёздами. Звёзды лежат на небесной
// сфере вокруг Земли, и камера смотрит на них из той же точки, что и на глобус (центр, поворот,
// наклон), поэтому небо вращается вместе с шаром как одно целое (плоский фон Грегори отверг).
// 12 000 звёзд разных цветов, мерцают; ~30 кадров в секунду, при движении карты — каждый кадр.
// Тем, кто просит меньше движения (настройка системы), — без мерцания
const STAR_COUNT = 12000;
const FOV = 36.87; // угол обзора камеры MapLibre по вертикали
const TINTS = ["255,255,255", "255,255,255", "190,210,255", "160,190,255", "255,240,200", "255,215,160", "255,180,140", "255,160,160"];

export function addStars(map) {
  const canvas = Object.assign(document.createElement("canvas"), { className: "stars" });
  document.body.prepend(canvas);
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const stars = Array.from({ length: STAR_COUNT }, () => {
    const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    const bright = Math.random() ** 3; // большинство тусклые и мелкие, редкие — яркие
    return { x: r * Math.cos(a), y: r * Math.sin(a), z, size: 0.8 + bright * 2.2, alpha: 0.3 + bright * 0.7,
      tint: TINTS[Math.floor(Math.random() * TINTS.length)], speed: 0.6 + Math.random() * 2.4, phase: Math.random() * Math.PI * 2 };
  });
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const mix = (a, ka, b, kb) => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];

  const draw = () => {
    const dpr = devicePixelRatio || 1, w = innerWidth, h = innerHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const rad = Math.PI / 180;
    const { lng, lat } = map.getCenter();
    const bearing = map.getBearing() * rad, pitch = map.getPitch() * rad, lo = lng * rad, la = lat * rad;
    // оси камеры в координатах Земли: камера над центром карты смотрит сквозь Землю
    const centerV = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    const east = [-Math.sin(lo), Math.cos(lo), 0];
    const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
    let up = mix(north, Math.cos(bearing), east, Math.sin(bearing));
    const right = mix(east, Math.cos(bearing), north, -Math.sin(bearing));
    let forward = mix(centerV, -1, up, 0);
    [forward, up] = [mix(forward, Math.cos(pitch), up, Math.sin(pitch)), mix(up, Math.cos(pitch), centerV, Math.sin(pitch))];
    const focal = h / 2 / Math.tan((FOV / 2) * rad);
    const t = performance.now() / 1000;
    for (const s of stars) {
      const v = [s.x, s.y, s.z];
      const depth = dot(v, forward);
      if (depth <= 0) continue;
      const x = w / 2 + (focal * dot(v, right)) / depth, y = h / 2 - (focal * dot(v, up)) / depth;
      if (x < -2 || y < -2 || x > w + 2 || y > h + 2) continue;
      const twinkle = calm.matches ? 1 : 0.7 + 0.3 * Math.sin(t * s.speed + s.phase);
      ctx.fillStyle = `rgba(${s.tint},${s.alpha * twinkle})`;
      ctx.beginPath();
      ctx.arc(x, y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  let last = 0;
  const frame = (now) => {
    if (map.isMoving() || (!calm.matches && now - last > 33)) { last = now; draw(); }
    requestAnimationFrame(frame);
  };
  map.on("load", draw);
  requestAnimationFrame(frame);
}

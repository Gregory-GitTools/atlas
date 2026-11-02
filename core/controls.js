// Кнопки и приборы карты (как в travel-earth): шкала масштаба по-русски, «Где я», компас 2D/3D, звёздное небо.
// Столбик слева внизу, снизу вверх: настройки, компас, «Где я» —
// MapLibre ставит каждый следующий элемент угла выше предыдущих, поэтому порядок addControl важен.
// Кнопок «+ −» нет (Грегори, 2026-11-02): приближают колёсиком, пальцами, двойным щелчком
import * as settings from "./settings.js";

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

// ---------- где я ----------
// как в Google Maps и Mapy.com: первый щелчок — слежение, карта встаёт на меня (центр значка
// синий); сдвинул карту рукой — она больше не бегает за мной (центр серый), щелчок — снова ко мне;
// щелчок по синему — выключить. Включённое слежение помнится — при запуске карта сразу на мне.
// Навигация (Грегори, 2026-11-02: «3D с включённой навигацией, направление движения»): слежение и карта
// наклонена — карта поворачивается по ходу движения (куда иду — вверху экрана, мир крутится навстречу),
// я — в нижней части экрана, впереди видно больше; у точки — стрелка направления. В 2D — север вверху.
// Направление — из GPS (heading) на ходу, иначе по последним точкам (сдвиг больше 8 м); стою — не крутится.
// Координаты не уходят никуда: геолокация браузера работает на устройстве
const GEO_ZOOM = 16;
const NAV_ZOOM = 17;
const NAV_MIN_STEP = 8; // м — сдвиг, по которому видно направление
const NAV_TURN = 4; // ° — поворот меньше не трогает карту (GPS дрожит)
const NAV_BACK = 10000; // мс — сдвинул карту в навигации: через столько она вернётся ко мне

const metersBetween = (a, b) => {
  const k = Math.PI / 180, x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k), y = (b[1] - a[1]) * k;
  return Math.hypot(x, y) * 6371008.8;
};
const bearingBetween = (a, b) => {
  const k = Math.PI / 180, la1 = a[1] * k, la2 = b[1] * k, dl = (b[0] - a[0]) * k;
  return (Math.atan2(Math.sin(dl) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl)) / k + 360) % 360;
};

export function addGeolocate(map, maplibregl, status) {
  let watch = null, follow = false, position = null, marker = null, btn;
  let heading = null, anchor = null; // направление движения и точка, от которой оно считается

  const navigating = () => follow && map.getPitch() > 5;
  const update = () => {
    btn.classList.toggle("on", watch !== null);
    btn.classList.toggle("follow", watch !== null && follow);
    btn.classList.toggle("nav", watch !== null && navigating());
    btn.title = watch === null ? "Где я" : !follow ? "Снова ко мне" : navigating() ? "Навигация: карта по ходу движения — щелчок выключит" : "Выключить «Где я»";
    marker?.getElement().classList.toggle("moving", heading !== null);
    if (heading !== null) marker?.setRotation(heading);
  };
  const center = (fly) => {
    if (!position) return;
    // навигация: по ходу движения, я — в нижней трети экрана
    if (navigating()) {
      map.easeTo({ center: position, bearing: heading ?? map.getBearing(), zoom: Math.max(map.getZoom(), NAV_ZOOM - 1),
        offset: [0, innerHeight * 0.25], duration: 1000, essential: true });
      return;
    }
    // издалека — перелёт с приближением, вблизи — просто сдвиг
    if (fly || map.getZoom() < 12) map.flyTo({ center: position, zoom: Math.max(map.getZoom(), GEO_ZOOM), duration: 3000 });
    else map.easeTo({ center: position, duration: 800 });
  };
  const turn = (pos, p) => {
    const gps = pos.coords.heading, speed = pos.coords.speed;
    let h = null;
    if (Number.isFinite(gps) && speed > 0.7) { h = gps; anchor = p; }
    else if (!anchor) anchor = p;
    else if (metersBetween(anchor, p) > NAV_MIN_STEP) { h = bearingBetween(anchor, p); anchor = p; }
    if (h === null) return false;
    const diff = heading === null ? 180 : Math.abs(((h - heading + 540) % 360) - 180);
    heading = h;
    return diff >= NAV_TURN;
  };
  const start = () => {
    if (!navigator.geolocation) { status("Этот браузер не умеет определять местоположение"); return; }
    follow = true;
    watch = navigator.geolocation.watchPosition((pos) => {
      const first = !position;
      position = [pos.coords.longitude, pos.coords.latitude];
      turn(pos, position);
      if (!marker) {
        const el = Object.assign(document.createElement("div"), { className: "geo-dot" });
        el.append(Object.assign(document.createElement("div"), { className: "geo-arrow" }));
        marker = new maplibregl.Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat(position).addTo(map);
      }
      marker.setLngLat(position);
      update();
      if (follow) center(first);
    }, (err) => {
      // запрет — выключить совсем, иначе спрашивали бы при каждом запуске
      if (err.code === err.PERMISSION_DENIED) { stop(); status("Нет доступа к местоположению — разрешите его браузеру"); }
      else status("Не удаётся определить местоположение");
    }, { enableHighAccuracy: true, maximumAge: 10000 });
    settings.set("geolocate", true);
    update();
  };
  const stop = () => {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null; follow = false; position = null; heading = null; anchor = null;
    clearTimeout(back); back = null;
    marker?.remove(); marker = null;
    settings.set("geolocate", null);
    update();
  };

  btn = addMapButton(map, { title: "Где я", className: "geo-btn",
    html: `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle class="geo-center" cx="12" cy="12" r="3.5"/></svg>` });
  btn.addEventListener("click", () => {
    if (watch === null) start();
    else if (!follow) { clearTimeout(back); back = null; follow = true; update(); center(false); }
    else stop();
  });

  // сдвинул или повернул карту рукой — она больше не бегает за мной; в навигации (пешком, в машине) —
  // через 10 секунд без касаний карта сама возвращается ко мне (Грегори: «всегда к себе»)
  let back = null;
  const arm = () => {
    clearTimeout(back);
    back = setTimeout(() => { back = null; if (watch !== null && !follow) { follow = true; update(); center(false); } }, NAV_BACK);
  };
  const userMove = (e) => {
    if (!e.originalEvent || watch === null) return;
    if ((follow && navigating()) || back) arm();
    if (follow) { follow = false; update(); }
  };
  map.on("zoomstart", (e) => { if (e.originalEvent && back) userMove(e); });
  map.on("dragstart", userMove);
  map.on("rotatestart", userMove);
  // наклонили (компас) при слежении — сразу навигация, выпрямили — обычное слежение
  let wasNav = false;
  map.on("pitchend", () => {
    if (navigating() !== wasNav) { wasNav = navigating(); update(); if (follow && position) center(false); }
  });
  if (settings.get("geolocate")) start();
  // для проверки
  return { state: () => ({ on: watch !== null, follow, nav: navigating(), heading, position }) };
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
//   3D — карта наклонена (с «Где я» — навигация по ходу движения);
//   Север — 2D по сторонам света: север вверху, повернуть карту нельзя;
//   2D — свободно: поворачивайте как удобно (правая кнопка мыши, два пальца).
// Стрелка поворачивается вместе с картой и ложится при наклоне; под ней — режим. Наклонили или выпрямили
// карту рукой — режим следует за ней. Издалека (шкала 100 км и дальше) 3D нет — режим пропускается
const TILT = 60;
const LABEL = { "3d": "3D", north: "С", "2d": "2D" };
const TITLE = { "3d": "3D — наклон; с «Где я» карта по ходу движения", north: "Север вверху, карта не поворачивается", "2d": "2D — карту можно поворачивать" };

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
    if (m === "3d") map.easeTo({ pitch: TILT, duration: 1000 });
    else map.easeTo({ pitch: 0, ...(m === "north" && { bearing: 0 }), duration: 1000 });
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

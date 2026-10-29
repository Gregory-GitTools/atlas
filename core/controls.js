// Кнопки и приборы карты (как в travel-earth): шкала масштаба по-русски, «Где я», звёздное небо.
// Столбик слева внизу, снизу вверх: настройки, «+ −», компас, «Где я» —
// MapLibre ставит каждый следующий элемент угла выше предыдущих, поэтому порядок addControl важен
import * as settings from "./settings.js";

// ---------- шкала ----------
// «м»/«км» — из русских подписей карты (locale в app.js)
export function addScale(map, maplibregl) {
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
}

// ---------- где я ----------
// как в Google Maps и Mapy.com: первый щелчок — слежение, карта встаёт на меня (центр значка
// синий); сдвинул карту рукой — она больше не бегает за мной (центр серый), щелчок — снова ко мне;
// щелчок по синему — выключить. Включённое слежение помнится — при запуске карта сразу на мне.
// Координаты не уходят никуда: геолокация браузера работает на устройстве
const GEO_ZOOM = 16;

export function addGeolocate(map, maplibregl, status) {
  let watch = null, follow = false, position = null, marker = null, btn;

  const update = () => {
    btn.classList.toggle("on", watch !== null);
    btn.classList.toggle("follow", watch !== null && follow);
  };
  const center = (fly) => {
    if (!position) return;
    // издалека — перелёт с приближением, вблизи — просто сдвиг
    if (fly || map.getZoom() < 12) map.flyTo({ center: position, zoom: Math.max(map.getZoom(), GEO_ZOOM), duration: 3000 });
    else map.easeTo({ center: position, duration: 800 });
  };
  const start = () => {
    if (!navigator.geolocation) { status("Этот браузер не умеет определять местоположение"); return; }
    follow = true;
    watch = navigator.geolocation.watchPosition((pos) => {
      const first = !position;
      position = [pos.coords.longitude, pos.coords.latitude];
      marker ??= new maplibregl.Marker({ element: Object.assign(document.createElement("div"), { className: "geo-dot" }) }).setLngLat(position).addTo(map);
      marker.setLngLat(position);
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
    watch = null; follow = false; position = null;
    marker?.remove(); marker = null;
    settings.set("geolocate", null);
    update();
  };

  map.addControl({
    onAdd() {
      const box = Object.assign(document.createElement("div"), { className: "maplibregl-ctrl maplibregl-ctrl-group" });
      btn = Object.assign(document.createElement("button"), { type: "button", className: "geo-btn ctrl-icon", title: "Где я" });
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle class="geo-center" cx="12" cy="12" r="3.5"/></svg>`;
      btn.addEventListener("click", () => {
        if (watch === null) start();
        else if (!follow) { follow = true; update(); center(false); }
        else stop();
      });
      box.append(btn);
      return box;
    },
    onRemove() {},
  }, "bottom-left");

  map.on("dragstart", () => { if (follow) { follow = false; update(); } });
  if (settings.get("geolocate")) start();
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

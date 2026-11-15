// Фоновый модуль MapLibre со своего адреса сайта. Сама библиотека для чужого адреса (unpkg) делает
// временный blob и сразу его удаляет — WebView до ~116 (старые магнитолы, Android-приложение) не успевает
// его прочесть: «Worker failed to load», карта пустая. Номер версии — тот же, что в core/app.js
import "https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl-worker.mjs";

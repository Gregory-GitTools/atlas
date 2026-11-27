package io.github.gregorygittools.atlas;

import android.Manifest;
import android.os.Build;
import android.content.pm.PackageManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

// окно — сайт Atlas (capacitor.config.json: server.url), обновляется вместе с сайтом.
// Панель навигации Android (кнопки «Назад», «Домой», «Недавние» или полоска жестов) видна всегда, и карта
// под неё не заходит (Грегори 2026-11-18: «на Самсунге я привык к навигационной панели — оставим для неё
// место»). Лёжа (магнитола 1280×720, телефон боком) прячется только строка состояния сверху — её можно
// вытянуть жестом от края.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // крупный вид для машины (core/ui-scale.js) растягивает страницу через <meta viewport> — WebView
        // слушается его только с широкой раскладкой; без неё на сайте просто обычный размер
        getBridge().getWebView().getSettings().setUseWideViewPort(true);
        getBridge().getWebView().addJavascriptInterface(new Gps(), "AtlasGps");
        getBridge().getWebView().addJavascriptInterface(new Track(), "AtlasTrack");
        getBridge().getWebView().addJavascriptInterface(new PhotosJs(), "AtlasPhotos");
        getBridge().getWebView().addJavascriptInterface(new AppJs(), "AtlasApp");
        phoneMedia();
        popups();
        keepBarsClear();
        fitBars();
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        fitBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) fitBars();
    }

    @Override
    public void onDestroy() {
        gpsStop();
        super.onDestroy();
    }

    // ── GPS напрямую (Грегори 2026-11-19: «магнитола не определяет локацию» — разрешение дано, значок
    // местоположения горит, а замера нет). Геолокация WebView идёт через службы Google, на магнитолах их часто
    // нет или они старые; здесь — сам приёмник GPS и сеть через LocationManager. Сайт (core/controls.js)
    // зовёт AtlasGps.start()/stop(), замеры получает в window.atlasNativeFix, что видно — AtlasGps.info()
    private LocationManager lm;
    private LocationListener gpsL, netL;
    private GnssStatus.Callback sky;
    private int sats = 0, used = 0;
    private long lastGps = 0;

    private class Gps {
        @JavascriptInterface public void start() { runOnUiThread(MainActivity.this::gpsStart); }
        @JavascriptInterface public void stop() { runOnUiThread(MainActivity.this::gpsStop); }
        @JavascriptInterface public String info() {
            boolean allowed = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            LocationManager m = (LocationManager) getSystemService(LOCATION_SERVICE);
            boolean gps = false, net = false, has = false;
            try {
                has = m.getAllProviders().contains(LocationManager.GPS_PROVIDER);
                gps = m.isProviderEnabled(LocationManager.GPS_PROVIDER);
                net = m.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            } catch (Exception ignored) { }
            return "{\"allowed\":" + allowed + ",\"hasGps\":" + has + ",\"gps\":" + gps + ",\"net\":" + net
                + ",\"sats\":" + sats + ",\"used\":" + used + ",\"running\":" + (lm != null) + "}";
        }
    }

    // ── запись трека (TrackService): сайт зовёт AtlasTrack.start/pause/resume/stop, state() — что сейчас,
    // read(from) — точки с этого номера, clear() — трек забран в «Мои треки» (или «✕» в шторке), файл больше не нужен
    private class Track {
        // нет разрешения на точное место — спросить; "ask" — сайт скажет, что нажать ещё раз
        @JavascriptInterface public String start() {
            boolean fine = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            boolean notes = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            // строка в шторке — по желанию: без неё запись идёт так же, только кнопок «Пауза» и «Стоп» там не видно
            if (!fine || !notes) {
                String[] ask = Build.VERSION.SDK_INT >= 33
                    ? new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.POST_NOTIFICATIONS }
                    : new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION };
                runOnUiThread(() -> ActivityCompat.requestPermissions(MainActivity.this, ask, 7));
                if (!fine) return "ask";
            }
            TrackService.send(MainActivity.this, TrackService.START);
            return "ok";
        }
        @JavascriptInterface public void pause() { TrackService.send(MainActivity.this, TrackService.PAUSE); }
        @JavascriptInterface public void resume() { TrackService.send(MainActivity.this, TrackService.RESUME); }
        @JavascriptInterface public void stop() { TrackService.send(MainActivity.this, TrackService.STOP); }
        @JavascriptInterface public String state() {
            android.content.SharedPreferences p = TrackService.prefs(MainActivity.this);
            return "{\"on\":" + p.getBoolean("on", false) + ",\"start\":" + p.getLong("start", 0) + ",\"pausedAt\":" + p.getLong("pausedAt", 0)
                + ",\"pausedTotal\":" + p.getLong("pausedTotal", 0) + ",\"dist\":" + p.getFloat("dist", 0) + ",\"saved\":" + (TrackService.file(MainActivity.this).length() > 0) + ",\"off\":" + p.getFloat("off", 0) + ",\"max\":" + p.getFloat("max", 0) + ",\"dropped\":" + p.getBoolean("dropped", false) + "}";
        }
        // трассы вокруг — для «вне трассы» (TrackService.saveSlopes)
        @JavascriptInterface public void setSlopes(String json) { TrackService.saveSlopes(MainActivity.this, json); }
        @JavascriptInterface public String read(int from) { return TrackService.read(MainActivity.this, from); }
        @JavascriptInterface public void clear() {
            android.content.SharedPreferences p = TrackService.prefs(MainActivity.this);
            if (!p.getBoolean("on", false)) { TrackService.file(MainActivity.this).delete(); p.edit().putBoolean("dropped", false).apply(); }
        }
    }

    // ── снимки галереи телефона на треке (Photos): access() — "all" | "some" | "none", ask() — спросить
    // разрешение (ответ — window.atlasPhotosChanged()), list(from, to) — что снято за это время
    private class PhotosJs {
        @JavascriptInterface public String access() { return Photos.access(MainActivity.this); }
        @JavascriptInterface public void ask() { runOnUiThread(() -> ActivityCompat.requestPermissions(MainActivity.this, Photos.wanted(), 8)); }
        // фото уже разрешены, а место в них — нет (разрешение появилось в 1.7): спросить один раз, ответ — atlasPhotosChanged
        private boolean placeAsked = false;
        @JavascriptInterface public String list(double from, double to) {
            if (!placeAsked && Build.VERSION.SDK_INT >= 29 && !Photos.access(MainActivity.this).equals("none") && !Photos.placeAllowed(MainActivity.this)) {
                placeAsked = true;
                runOnUiThread(() -> ActivityCompat.requestPermissions(MainActivity.this, new String[] { Manifest.permission.ACCESS_MEDIA_LOCATION }, 8));
            }
            return Photos.list(MainActivity.this, (long) from, (long) to);
        }
        // папки галереи — альбомы («Мои альбомы»); место — так же: разрешение спрашивается один раз
        @JavascriptInterface public String all() {
            if (!placeAsked && Build.VERSION.SDK_INT >= 29 && !Photos.access(MainActivity.this).equals("none") && !Photos.placeAllowed(MainActivity.this)) {
                placeAsked = true;
                runOnUiThread(() -> ActivityCompat.requestPermissions(MainActivity.this, new String[] { Manifest.permission.ACCESS_MEDIA_LOCATION }, 8));
            }
            return Photos.all(MainActivity.this);
        }
        @JavascriptInterface public String place(String id) { return Photos.place(MainActivity.this, id); }
    }

    // ── номер приложения для ⓘ и «Настроек» сайта (core/version.js)
    private class AppJs {
        @JavascriptInterface public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
        }
        // музыкальное приложение телефона (Грегори 2026-11-27: «плеер… от телефона») — какое выбрано у системы;
        // false — такого нет
        @JavascriptInterface public boolean openMusic() {
            try { startActivity(Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MUSIC).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return true; }
            catch (Exception e) { return false; }
        }
        // файл сайта (GPX, KML, настройки) — в «Загрузки» телефона (Грегори 2026-11-22: «на телефоне не сработал
        // экспорт GPX»: ссылка с download в WebView ничего не делает). Ответ: "" — сохранено, "ask" — ждём
        // разрешения (Android 9 и старше), иначе — текст ошибки
        @JavascriptInterface public String saveFile(String name, String mime, String text) {
            try {
                byte[] data = text.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) return "нет доступа к «Загрузкам»";
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) { out.write(data); }
                    return "";
                }
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    runOnUiThread(() -> ActivityCompat.requestPermissions(MainActivity.this, new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, 9));
                    return "ask";
                }
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                dir.mkdirs();
                File f = new File(dir, name);
                for (int i = 2; f.exists(); i++) f = new File(dir, name.replaceFirst("(\\.[^.]+)?$", " (" + i + ")$1"));
                try (OutputStream out = new FileOutputStream(f)) { out.write(data); }
                return "";
            } catch (Exception e) { return String.valueOf(e.getMessage()); }
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == 8) getBridge().getWebView().evaluateJavascript("window.atlasPhotosChanged&&atlasPhotosChanged()", null);
    }

    // адреса https://phone.invalid/… — и у окна сайта, и у его служебного работника, и у окна галереи
    private void phoneMedia() {
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                WebResourceResponse x = Photos.serve(MainActivity.this, r);
                return x != null ? x : super.shouldInterceptRequest(v, r);
            }
        });
        final boolean bridgeSw = getBridge().getConfig().isResolveServiceWorkerRequests();
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest r) {
                WebResourceResponse x = Photos.serve(MainActivity.this, r);
                return x != null || !bridgeSw ? x : getBridge().getLocalServer().shouldInterceptRequest(r);
            }
        });
    }

    // ── окна сайта (галерея, просмотр улиц): window.open в приложении заменял карту галереей, а та без
    // window.opener пустая. Теперь — второе окно поверх карты; закрывается крестиком/Esc галереи (window.close)
    // и кнопкой «Назад». Чужие сайты (ссылки «в новом окне») — в браузере телефона
    private WebView popup;
    private final OnBackPressedCallback popupBack = new OnBackPressedCallback(false) {
        @Override public void handleOnBackPressed() {
            if (popup == null) return;
            WebView w = popup;
            w.evaluateJavascript("window.close()", null); // окно карты узнаёт, что галерея закрыта
            new Handler(Looper.getMainLooper()).postDelayed(() -> { if (popup == w) popupClose(); }, 400);
        }
    };

    private void popups() {
        WebView main = getBridge().getWebView();
        main.getSettings().setSupportMultipleWindows(true);
        main.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
        main.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean user, Message msg) {
                ((WebView.WebViewTransport) msg.obj).setWebView(popupOpen());
                msg.sendToTarget();
                return true;
            }
        });
        getOnBackPressedDispatcher().addCallback(this, popupBack);
    }

    private boolean ours(Uri u) {
        String s = u.getScheme();
        return s == null || s.equals("about") || s.equals("blob") || s.equals("data") || Uri.parse(getBridge().getServerUrl()).getHost().equals(u.getHost());
    }

    private WebView popupOpen() {
        popupClose();
        WebView w = new WebView(this);
        WebSettings s = w.getSettings(), m = getBridge().getWebView().getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setUserAgentString(m.getUserAgentString());
        w.setBackgroundColor(Color.BLACK);
        w.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) { return Photos.serve(MainActivity.this, r); }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (ours(r.getUrl())) return false;
                outside(r.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap icon) {
                if (ours(Uri.parse(url))) return;
                v.stopLoading();
                outside(Uri.parse(url));
                v.post(MainActivity.this::popupClose);
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override public void onCloseWindow(WebView v) { if (v == popup) popupClose(); }
        });
        ((ViewGroup) findViewById(android.R.id.content)).addView(w, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        popup = w;
        popupBack.setEnabled(true);
        return w;
    }

    private void popupClose() {
        if (popup == null) return;
        WebView w = popup;
        popup = null;
        popupBack.setEnabled(false);
        ((ViewGroup) w.getParent()).removeView(w);
        w.destroy();
    }

    private void outside(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
    }

    private LocationListener listener(final boolean precise) {
        // все четыре метода — на Android до 11 система зовёт и onStatusChanged (без него — падение)
        return new LocationListener() {
            @Override public void onLocationChanged(Location l) { send(l, precise); }
            @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
            @Override public void onProviderEnabled(String provider) { }
            @Override public void onProviderDisabled(String provider) { }
        };
    }

    private void gpsStart() {
        if (lm != null) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        sats = 0; used = 0; lastGps = 0;
        try {
            if (lm.getAllProviders().contains(LocationManager.GPS_PROVIDER)) {
                gpsL = listener(true);
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, gpsL, Looper.getMainLooper());
                sky = new GnssStatus.Callback() {
                    @Override public void onSatelliteStatusChanged(GnssStatus s) {
                        int n = s.getSatelliteCount(), u = 0;
                        for (int i = 0; i < n; i++) if (s.usedInFix(i)) u++;
                        sats = n; used = u;
                    }
                };
                lm.registerGnssStatusCallback(sky, new Handler(Looper.getMainLooper()));
            }
            if (lm.getAllProviders().contains(LocationManager.NETWORK_PROVIDER)) {
                netL = listener(false);
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000, 0, netL, Looper.getMainLooper());
            }
            // последнее известное место (не старше 10 минут) — сразу, примерно
            Location best = null;
            for (String p : lm.getProviders(true)) {
                Location l = lm.getLastKnownLocation(p);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            }
            if (best != null && System.currentTimeMillis() - best.getTime() < 600000) send(best, false);
        } catch (SecurityException ignored) { }
    }

    private void gpsStop() {
        if (lm == null) return;
        try {
            if (gpsL != null) lm.removeUpdates(gpsL);
            if (netL != null) lm.removeUpdates(netL);
            if (sky != null) lm.unregisterGnssStatusCallback(sky);
        } catch (Exception ignored) { }
        lm = null; gpsL = null; netL = null; sky = null;
    }

    private void send(Location l, boolean precise) {
        if (precise) lastGps = System.currentTimeMillis();
        else if (System.currentTimeMillis() - lastGps < 5000) return; // сеть не перебивает спутники
        String js = String.format(java.util.Locale.ROOT,
            "window.atlasNativeFix&&atlasNativeFix({lat:%.7f,lon:%.7f,acc:%.1f,alt:%s,heading:%s,speed:%s,t:%d,precise:%b})",
            l.getLatitude(), l.getLongitude(), l.getAccuracy(),
            l.hasAltitude() ? String.valueOf(l.getAltitude()) : "null",
            l.hasBearing() ? String.valueOf(l.getBearing()) : "null",
            l.hasSpeed() ? String.valueOf(l.getSpeed()) : "null",
            l.getTime(), precise);
        WebView w = getBridge().getWebView();
        if (w != null) w.evaluateJavascript(js, null);
    }

    // окно сайта — между видимыми системными панелями и вырезом камеры: отступы ставим сами, сайту
    // отступы не передаём (иначе он отступил бы второй раз). Спрятанная строка состояния места не занимает
    private void keepBarsClear() {
        getWindow().setNavigationBarColor(Color.parseColor("#202124")); // как верхняя полоса сайта (theme_color)
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }

    private void fitBars() {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.show(WindowInsetsCompat.Type.navigationBars());
        if (getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE) bars.hide(WindowInsetsCompat.Type.statusBars());
        else bars.show(WindowInsetsCompat.Type.statusBars());
        ViewCompat.requestApplyInsets(findViewById(android.R.id.content));
    }
}

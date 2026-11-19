package io.github.gregorygittools.atlas;

import android.Manifest;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

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

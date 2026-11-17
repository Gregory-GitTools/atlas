package io.github.gregorygittools.atlas;

import android.content.res.Configuration;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

// окно — сайт Atlas (capacitor.config.json: server.url), обновляется вместе с сайтом;
// лёжа (экран машины 1280×720) — во весь экран без строки состояния, панель снизу — жестом от края
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // крупный вид для машины (core/ui-scale.js) растягивает страницу через <meta viewport> — WebView
        // слушается его только с широкой раскладкой; без неё на сайте просто обычный размер
        getBridge().getWebView().getSettings().setUseWideViewPort(true);
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

    private void fitBars() {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE) bars.hide(WindowInsetsCompat.Type.systemBars());
        else bars.show(WindowInsetsCompat.Type.systemBars());
    }
}

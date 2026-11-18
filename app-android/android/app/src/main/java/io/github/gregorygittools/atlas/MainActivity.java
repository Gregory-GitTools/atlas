package io.github.gregorygittools.atlas;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
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

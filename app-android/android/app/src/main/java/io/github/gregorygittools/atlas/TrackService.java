package io.github.gregorygittools.atlas;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.nio.charset.StandardCharsets;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

// Запись трека при погасшем экране (Грегори 2026-11-19: «если приложение не работает в фоновом режиме с
// выключенным экраном… в этой функции нет смысла. Не буду же я держать телефон в руках на скорости 60 км/ч»).
// Служба переднего плана: пока пишет — строка «Atlas пишет трек» в шторке с кнопками «Пауза» и «Стоп», Android
// её не останавливает. Точки — сразу в файл rec.txt (строка «lon lat ele t», пауза — строка «-»), так что
// закрытое приложение или перезапуск телефона записанного не теряют. Сайт (content/tracks.js) через AtlasTrack
// в MainActivity видит состояние и точки, по «Стоп» забирает трек в «Мои треки» и стирает файл.
// «Вне трассы» (Грегори 2026-11-20, горные лыжи): сайт кладёт рядом трассы и подъёмники (slopes.json), служба
// на каждом замере меряет расстояние до ближайшей — уехал с трасс, звук и вибрация, без сети и при погасшем экране
public class TrackService extends Service {
    static final String START = "start", PAUSE = "pause", RESUME = "resume", STOP = "stop", MUTE = "mute", ASK = "ask", NO = "no";
    private static final String CHANNEL = "track", OFF_CHANNEL = "offpiste";
    private static final int ID = 1, OFF_ID = 2;
    private static final float MAX_ERROR = 40; // м — замеры грубее не пишем (в доме, под мостом)
    // «вне трассы»: ближе ON_PISTE к трассе или подъёмнику — катается, следим; дальше OFF_PISTE на ходу (быстрее
    // MOVING м/с) дольше OFF_MS — предупреждение; дальше LEFT — уехал с курорта (домой, в деревню), не следим.
    // На карте трасса — линия посередине, а широкие спуски — до 100 м, поэтому порог с запасом
    private static final float ON_PISTE = 30, OFF_PISTE = 100, LEFT = 1500, MOVING = 2.5f;
    private static final long OFF_MS = 8000;
    private static final float TOP_SPEED = 70; // м/с (250 км/ч) — быстрее только скачок GPS, в «макс.» не идёт

    private LocationManager lm;
    private LocationListener gps;
    private Location last;
    // трассы: ряды «lon, lat, lon, lat…» и рамки рядов (запад, юг, восток, север) — далёкие не перебираем
    private double[][] lines = {}, linesBox = {}, areas = {}, areasBox = {};
    private long slopesTime = -1, farSince = 0;
    private boolean armed = false, alerted = false;
    private long alertedAt = 0, noteAt = 0;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("track", MODE_PRIVATE); }
    static File file(Context c) { return new File(c.getFilesDir(), "rec.txt"); }
    static File slopesFile(Context c) { return new File(c.getFilesDir(), "slopes.json"); }

    // от сайта: {lines: [[lon, lat, …], …], areas: [[…], …]} — через временный файл, чтобы служба не прочла половину
    static void saveSlopes(Context c, String json) {
        File tmp = new File(c.getFilesDir(), "slopes.tmp");
        try {
            try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(json.getBytes(StandardCharsets.UTF_8)); }
            if (!tmp.renameTo(slopesFile(c))) tmp.delete();
        } catch (Exception ignored) { }
    }

    static void send(Context c, String action) {
        Intent i = new Intent(c, TrackService.class).setAction(action);
        if (START.equals(action) || RESUME.equals(action)) ContextCompat.startForegroundService(c, i);
        else c.startService(i);
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences p = prefs(this);
        long now = System.currentTimeMillis();
        String a = intent != null ? intent.getAction() : null;
        // система перезапустила службу (null) — пишем дальше, если запись шла
        if (a == null) a = p.getBoolean("on", false) ? (p.getLong("pausedAt", 0) > 0 ? PAUSE : RESUME) : STOP;
        if (!a.equals(MUTE)) p.edit().putBoolean("ask", a.equals(ASK)).apply();
        switch (a) {
            case START:
                if (!p.getBoolean("on", false)) {
                    file(this).delete();
                    slopesFile(this).delete();
                    p.edit().putBoolean("on", true).putLong("start", now).putLong("pausedAt", 0).putLong("pausedTotal", 0).putFloat("dist", 0)
                        .putBoolean("mute", false).putFloat("off", 0).putFloat("max", 0).apply();
                    armed = false;
                }
                last = null;
                listen(true);
                break;
            case RESUME:
                if (!p.getBoolean("on", false)) { stopSelf(); return START_NOT_STICKY; }
                long at = p.getLong("pausedAt", 0);
                if (at > 0) p.edit().putLong("pausedTotal", p.getLong("pausedTotal", 0) + now - at).putLong("pausedAt", 0).apply();
                listen(true);
                break;
            case PAUSE:
                if (!p.getBoolean("on", false)) { stopSelf(); return START_NOT_STICKY; }
                if (p.getLong("pausedAt", 0) == 0) { p.edit().putLong("pausedAt", now).apply(); append("-"); }
                last = null;
                listen(false);
                onPiste();
                break;
            case ASK: // «Стоп» в шторке — сперва «Сохранить трек?», запись пока идёт
            case NO:  // «Нет» — назад, как было
                if (!p.getBoolean("on", false)) { stopSelf(); return START_NOT_STICKY; }
                break;
            case MUTE: // «Не предупреждать» в предупреждении — до конца этой записи
                p.edit().putBoolean("mute", true).apply();
                onPiste();
                return p.getBoolean("on", false) ? START_STICKY : START_NOT_STICKY;
            default: // STOP — файл остаётся: его заберёт сайт
                p.edit().putBoolean("on", false).putLong("pausedAt", 0).apply();
                listen(false);
                onPiste();
                armed = false;
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
                stopSelf();
                return START_NOT_STICKY;
        }
        try {
            ServiceCompat.startForeground(this, ID, note(), Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0);
        } catch (RuntimeException e) { // нет разрешения на местоположение — Android не даёт писать в фоне
            p.edit().putBoolean("on", false).apply();
            listen(false);
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        listen(false);
        super.onDestroy();
    }

    private void listen(boolean on) {
        if (lm == null) lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (gps != null) { lm.removeUpdates(gps); gps = null; }
        if (!on || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        // все четыре метода — на Android до 11 система зовёт и onStatusChanged (без него — падение)
        gps = new LocationListener() {
            @Override public void onLocationChanged(Location l) { fix(l); }
            @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
            @Override public void onProviderEnabled(String provider) { }
            @Override public void onProviderDisabled(String provider) { }
        };
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, gps, Looper.getMainLooper());
        } catch (SecurityException | IllegalArgumentException ignored) { }
    }

    private void fix(Location l) {
        if (l.hasAccuracy() && l.getAccuracy() > MAX_ERROR) return;
        SharedPreferences p = prefs(this);
        float before = p.getFloat("dist", 0), dist = before + (last != null ? last.distanceTo(l) : 0);
        Location prev = last;
        last = l;
        // скорость — от GPS, а нет её — по прошлому замеру (не чаще раза в секунду: иначе дёргается)
        float speed = l.hasSpeed() && l.getSpeed() > 0 ? l.getSpeed()
            : prev != null && l.getTime() - prev.getTime() >= 900 ? prev.distanceTo(l) * 1000f / (l.getTime() - prev.getTime()) : 0;
        // наибольшая — только по скорости от GPS (по разнице замеров скачет: 41 км/ч превращались в 58), и точной
        boolean sure = l.hasSpeed() && (Build.VERSION.SDK_INT < 26 || !l.hasSpeedAccuracy() || l.getSpeedAccuracyMetersPerSecond() < 3);
        float maxBefore = p.getFloat("max", 0), max = sure && l.getSpeed() > maxBefore && l.getSpeed() < TOP_SPEED ? l.getSpeed() : maxBefore;
        append(String.format(Locale.ROOT, "%.7f %.7f %s %d", l.getLongitude(), l.getLatitude(),
            l.hasAltitude() ? String.format(Locale.ROOT, "%.1f", l.getAltitude()) : "-", l.getTime()));
        p.edit().putFloat("dist", dist).putFloat("max", max).apply();
        // в шторке — расстояние на каждые 100 м, новая наибольшая скорость — не чаще раза в 5 с
        long now = System.currentTimeMillis();
        if ((int) (dist / 100) != (int) (before / 100) || (Math.round(max * 3.6f) > Math.round(maxBefore * 3.6f) && now - noteAt > 5000)) {
            noteAt = now;
            getSystemService(NotificationManager.class).notify(ID, note());
        }
        watch(l, speed);
    }

    // ---------- вне трассы ----------
    private void watch(Location l, float speed) {
        SharedPreferences p = prefs(this);
        if (p.getBoolean("mute", false)) return;
        loadSlopes();
        double lon = l.getLongitude(), lat = l.getLatitude();
        double[] near = nearest(lon, lat); // {метры, lon, lat} ближайшей точки трассы
        double d = near[0];
        if (d <= ON_PISTE) { armed = true; onPiste(); return; }
        if (!armed) return;
        if (d > LEFT) { armed = false; onPiste(); return; }
        if (d <= OFF_PISTE) { farSince = 0; return; }
        long now = System.currentTimeMillis();
        if (farSince == 0) { if (speed < MOVING) return; farSince = now; }
        if (now - farSince < OFF_MS) return;
        p.edit().putFloat("off", (float) d).apply();
        // уже предупредили — только поправляем расстояние в шторке (без звука)
        if (alerted && Math.abs(d - alertedAt) < 25) return;
        double y = near[2] - lat, x = (near[1] - lon) * Math.cos(Math.toRadians(lat));
        alertedAt = Math.round(d);
        alert(alertedAt, side(Math.toDegrees(Math.atan2(x, y))));
        alerted = true;
    }

    // вернулся (или пауза, стоп, «Не предупреждать») — предупреждение убираем
    private void onPiste() {
        farSince = 0;
        prefs(this).edit().putFloat("off", 0).apply();
        if (alerted) getSystemService(NotificationManager.class).cancel(OFF_ID);
        alerted = false;
    }

    private static final String[] SIDES = { "север", "северо-восток", "восток", "юго-восток", "юг", "юго-запад", "запад", "северо-запад" };
    private static String side(double deg) { return SIDES[(int) Math.round((((deg % 360) + 360) % 360) / 45) % 8]; }

    private void loadSlopes() {
        File f = slopesFile(this);
        long t = f.exists() ? f.lastModified() : 0;
        if (t == slopesTime) return;
        slopesTime = t;
        lines = linesBox = areas = areasBox = new double[0][];
        if (t == 0) return;
        try {
            byte[] buf = new byte[(int) f.length()];
            try (FileInputStream in = new FileInputStream(f)) { int n = 0; while (n < buf.length) { int k = in.read(buf, n, buf.length - n); if (k < 0) break; n += k; } }
            JSONObject o = new JSONObject(new String(buf, StandardCharsets.UTF_8));
            double[][][] l = rows(o.optJSONArray("lines")), a = rows(o.optJSONArray("areas"));
            lines = l[0]; linesBox = l[1]; areas = a[0]; areasBox = a[1];
        } catch (Exception ignored) { }
    }
    private static double[][][] rows(JSONArray arr) {
        ArrayList<double[]> out = new ArrayList<>(), boxes = new ArrayList<>();
        for (int i = 0; arr != null && i < arr.length(); i++) {
            JSONArray r = arr.optJSONArray(i);
            if (r == null || r.length() < 2) continue;
            double[] v = new double[r.length() & ~1], b = { 180, 90, -180, -90 };
            for (int j = 0; j < v.length; j += 2) {
                v[j] = r.optDouble(j); v[j + 1] = r.optDouble(j + 1);
                b[0] = Math.min(b[0], v[j]); b[1] = Math.min(b[1], v[j + 1]); b[2] = Math.max(b[2], v[j]); b[3] = Math.max(b[3], v[j + 1]);
            }
            out.add(v); boxes.add(b);
        }
        return new double[][][] { out.toArray(new double[0][]), boxes.toArray(new double[0][]) };
    }

    // расстояние до ближайшей трассы или подъёмника (внутри площадной трассы — 0); метры вокруг точки — как на плоскости
    private double[] nearest(double lon, double lat) {
        double kx = 111320 * Math.cos(Math.toRadians(lat)), ky = 111320;
        double[] best = { Double.POSITIVE_INFINITY, lon, lat };
        for (int i = 0; i < areas.length; i++) if (inBox(areasBox[i], lon, lat, 0, kx, ky) && inside(areas[i], lon, lat)) return new double[] { 0, lon, lat };
        for (int k = 0; k < 2; k++) {
            double[][] set = k == 0 ? lines : areas, boxes = k == 0 ? linesBox : areasBox;
            for (int i = 0; i < set.length; i++) {
                if (!inBox(boxes[i], lon, lat, Math.min(best[0], 1e5), kx, ky)) continue;
                double[] v = set[i];
                if (v.length == 2) seg(best, lon, lat, v[0], v[1], v[0], v[1], kx, ky);
                for (int j = 2; j < v.length; j += 2) seg(best, lon, lat, v[j - 2], v[j - 1], v[j], v[j + 1], kx, ky);
            }
        }
        return best;
    }
    private static boolean inBox(double[] b, double lon, double lat, double m, double kx, double ky) {
        return lon >= b[0] - m / kx && lon <= b[2] + m / kx && lat >= b[1] - m / ky && lat <= b[3] + m / ky;
    }
    private static void seg(double[] best, double lon, double lat, double ax, double ay, double bx, double by, double kx, double ky) {
        double px = (lon - ax) * kx, py = (lat - ay) * ky, dx = (bx - ax) * kx, dy = (by - ay) * ky, len = dx * dx + dy * dy;
        double t = len > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len)) : 0;
        double d = Math.hypot(px - t * dx, py - t * dy);
        if (d < best[0]) { best[0] = d; best[1] = ax + (bx - ax) * t; best[2] = ay + (by - ay) * t; }
    }
    private static boolean inside(double[] ring, double lon, double lat) {
        boolean in = false;
        for (int i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
            if ((ring[i + 1] > lat) != (ring[j + 1] > lat) && lon < (ring[j] - ring[i]) * (lat - ring[i + 1]) / (ring[j + 1] - ring[i + 1]) + ring[i]) in = !in;
        }
        return in;
    }

    // громко: свой канал с высокой важностью — звук и вибрация и при погасшем экране
    private void alert(long metres, String where) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        long[] buzz = { 0, 600, 250, 600, 250, 600 };
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(OFF_CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(OFF_CHANNEL, "Вне трассы", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Запись трека: уехали с трасс и подъёмников");
            ch.enableVibration(true);
            ch.setVibrationPattern(buzz);
            nm.createNotificationChannel(ch);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent open = PendingIntent.getActivity(this, 3, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), flags);
        PendingIntent mute = PendingIntent.getService(this, 4, new Intent(this, TrackService.class).setAction(MUTE), flags);
        nm.notify(OFF_ID, new NotificationCompat.Builder(this, OFF_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_track)
            .setContentTitle("Вне трассы")
            .setContentText(String.format(new Locale("ru"), "До ближайшей трассы %d м, на %s", metres, where))
            .setContentIntent(open)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_SOUND)
            .setVibrate(buzz)
            .setOnlyAlertOnce(true) // поправка расстояния — без звука
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .addAction(0, "Не предупреждать", mute)
            .build());
    }

    private void append(String line) {
        try (FileWriter w = new FileWriter(file(this), true)) { w.write(line + "\n"); } catch (Exception ignored) { }
    }

    // точки с номера from (строки файла): для сайта
    static String read(Context c, int from) {
        StringBuilder s = new StringBuilder("[");
        try (BufferedReader r = new BufferedReader(new FileReader(file(c)))) {
            String line;
            int i = 0;
            while ((line = r.readLine()) != null) {
                if (i++ < from || line.isEmpty()) continue;
                if (s.length() > 1) s.append(',');
                if (line.equals("-")) { s.append("null"); continue; }
                String[] x = line.split(" ");
                s.append('[').append(x[0]).append(',').append(x[1]).append(',').append(x[2].equals("-") ? "null" : x[2]).append(',').append(x[3]).append(']');
            }
        } catch (Exception ignored) { }
        return s.append(']').toString();
    }

    // в шторке (Грегори 2026-11-20: «строка „Atlas пишет трек“ лишняя. Из-за неё кнопки сворачиваются. В верхней
    // строке время, километры, максимальная скорость должны быть крупнее. Во второй строке кнопки… После нажатия
    // стоп должен быть вопрос: сохранить?»): своя разметка — свёрнуто одна строка с кнопками-значками
    // (note_small), развёрнуто — крупные цифры и под ними кнопки (note_big); «Стоп» — сперва вопрос, запись идёт
    private Notification note() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Запись трека", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        SharedPreferences p = prefs(this);
        boolean paused = p.getLong("pausedAt", 0) > 0, ask = p.getBoolean("ask", false);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), flags);
        PendingIntent toggle = PendingIntent.getService(this, 1, new Intent(this, TrackService.class).setAction(ask ? NO : paused ? RESUME : PAUSE), flags);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, TrackService.class).setAction(ask ? STOP : ASK), flags);
        RemoteViews small = new RemoteViews(getPackageName(), R.layout.note_small), big = new RemoteViews(getPackageName(), R.layout.note_big);
        Locale ru = new Locale("ru");
        // время в пути без пауз — часы идут сами (на паузе стоят)
        long ran = (paused ? p.getLong("pausedAt", 0) : System.currentTimeMillis()) - p.getLong("start", 0) - p.getLong("pausedTotal", 0);
        long base = SystemClock.elapsedRealtime() - Math.max(0, ran);
        String km = String.format(ru, "%.1f км", p.getFloat("dist", 0) / 1000), max = String.format(ru, "%d км/ч", Math.round(p.getFloat("max", 0) * 3.6f));
        int toggleIcon = ask ? R.drawable.ic_note_no : paused ? R.drawable.ic_note_play : R.drawable.ic_note_pause;
        int stopIcon = ask ? R.drawable.ic_note_save : R.drawable.ic_note_stop;
        for (RemoteViews v : new RemoteViews[] { small, big }) {
            v.setChronometer(R.id.time, base, null, !paused);
            v.setTextViewText(R.id.km, km);
            v.setTextViewText(R.id.max, "макс " + max);
            v.setViewVisibility(R.id.stats, ask ? View.GONE : View.VISIBLE);
            v.setViewVisibility(R.id.ask, ask ? View.VISIBLE : View.GONE);
            v.setImageViewResource(R.id.toggleIcon, toggleIcon);
            v.setImageViewResource(R.id.stopIcon, stopIcon);
        }
        small.setTextViewText(R.id.max, max);
        small.setOnClickPendingIntent(R.id.toggleIcon, toggle);
        small.setOnClickPendingIntent(R.id.stopIcon, stop);
        big.setTextViewText(R.id.toggleText, ask ? "Нет" : paused ? "Продолжить" : "Пауза");
        big.setTextViewText(R.id.stopText, ask ? "Сохранить" : "Стоп");
        big.setOnClickPendingIntent(R.id.toggle, toggle);
        big.setOnClickPendingIntent(R.id.stop, stop);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_track)
            .setContentTitle(paused ? "Запись трека — пауза" : "Запись трека") // для чтения с экрана; на виду — своя разметка
            .setContentText(km + " · макс " + max)
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(small)
            .setCustomBigContentView(big)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }
}

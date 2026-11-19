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
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.Locale;

// Запись трека при погасшем экране (Грегори 2026-11-19: «если приложение не работает в фоновом режиме с
// выключенным экраном… в этой функции нет смысла. Не буду же я держать телефон в руках на скорости 60 км/ч»).
// Служба переднего плана: пока пишет — строка «Atlas пишет трек» в шторке с кнопками «Пауза» и «Стоп», Android
// её не останавливает. Точки — сразу в файл rec.txt (строка «lon lat ele t», пауза — строка «-»), так что
// закрытое приложение или перезапуск телефона записанного не теряют. Сайт (content/tracks.js) через AtlasTrack
// в MainActivity видит состояние и точки, по «Стоп» забирает трек в «Мои треки» и стирает файл
public class TrackService extends Service {
    static final String START = "start", PAUSE = "pause", RESUME = "resume", STOP = "stop";
    private static final String CHANNEL = "track";
    private static final int ID = 1;
    private static final float MAX_ERROR = 40; // м — замеры грубее не пишем (в доме, под мостом)

    private LocationManager lm;
    private LocationListener gps;
    private Location last;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("track", MODE_PRIVATE); }
    static File file(Context c) { return new File(c.getFilesDir(), "rec.txt"); }

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
        switch (a) {
            case START:
                if (!p.getBoolean("on", false)) {
                    file(this).delete();
                    p.edit().putBoolean("on", true).putLong("start", now).putLong("pausedAt", 0).putLong("pausedTotal", 0).putFloat("dist", 0).apply();
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
                break;
            default: // STOP — файл остаётся: его заберёт сайт
                p.edit().putBoolean("on", false).putLong("pausedAt", 0).apply();
                listen(false);
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
        last = l;
        append(String.format(Locale.ROOT, "%.7f %.7f %s %d", l.getLongitude(), l.getLatitude(),
            l.hasAltitude() ? String.format(Locale.ROOT, "%.1f", l.getAltitude()) : "-", l.getTime()));
        p.edit().putFloat("dist", dist).apply();
        // в шторке — расстояние, обновляется на каждые 100 м
        if ((int) (dist / 100) != (int) (before / 100)) getSystemService(NotificationManager.class).notify(ID, note());
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

    private Notification note() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Запись трека", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        SharedPreferences p = prefs(this);
        boolean paused = p.getLong("pausedAt", 0) > 0;
        float km = p.getFloat("dist", 0) / 1000;
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), flags);
        PendingIntent toggle = PendingIntent.getService(this, 1, new Intent(this, TrackService.class).setAction(paused ? RESUME : PAUSE), flags);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, TrackService.class).setAction(STOP), flags);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_track)
            .setContentTitle(paused ? "Запись трека — пауза" : "Atlas пишет трек")
            .setContentText(String.format(new Locale("ru"), "%.1f км", km))
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, paused ? "Продолжить" : "Пауза", toggle)
            .addAction(0, "Стоп", stop);
        // время в пути без пауз — часы в шторке идут сами
        if (!paused) b.setUsesChronometer(true).setShowWhen(true).setWhen(p.getLong("start", 0) + p.getLong("pausedTotal", 0));
        return b.build();
    }
}

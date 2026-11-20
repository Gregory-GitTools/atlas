package io.github.gregorygittools.atlas;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Size;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.core.content.ContextCompat;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

// снимки и ролики галереи телефона на треке (Грегори 2026-11-20: «делаем фото из галереи»): сайт спрашивает
// AtlasPhotos.list(from, to) — что снято за время трека (DATE_TAKEN — настоящее время, UTC), картинки берёт
// по адресам https://phone.invalid/thumb|full/img|vid/<номер> — их отдаёт serve() прямо из MediaStore
// (адрес вымышленный, в сеть не уходит; служебный работник сайта чужие адреса не трогает)
final class Photos {
    static final String HOST = "phone.invalid";
    private static final int THUMB = 320, FULL = 2560;

    private Photos() { }

    static String[] wanted() {
        if (Build.VERSION.SDK_INT >= 34) return new String[] { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED };
        if (Build.VERSION.SDK_INT >= 33) return new String[] { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO };
        return new String[] { Manifest.permission.READ_EXTERNAL_STORAGE };
    }

    // "all" — вся галерея, "some" — только выбранные снимки (Android 14: «Выбрать фото»), "none" — нет доступа
    static String access(Context c) {
        if (has(c, Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_IMAGES : Manifest.permission.READ_EXTERNAL_STORAGE)) return "all";
        if (Build.VERSION.SDK_INT >= 34 && has(c, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)) return "some";
        return "none";
    }

    private static boolean has(Context c, String p) { return ContextCompat.checkSelfPermission(c, p) == PackageManager.PERMISSION_GRANTED; }

    // [{ id: "img:123", name, video, at }] — снятое между from и to (мс)
    static String list(Context c, long from, long to) {
        JSONArray out = new JSONArray();
        add(c, out, "img", MediaStore.Images.Media.EXTERNAL_CONTENT_URI, from, to);
        add(c, out, "vid", MediaStore.Video.Media.EXTERNAL_CONTENT_URI, from, to);
        return out.toString();
    }

    private static void add(Context c, JSONArray out, String kind, Uri table, long from, long to) {
        String[] cols = { MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.DATE_TAKEN };
        String where = MediaStore.MediaColumns.DATE_TAKEN + " >= ? AND " + MediaStore.MediaColumns.DATE_TAKEN + " <= ?";
        try (Cursor q = c.getContentResolver().query(table, cols, where, new String[] { String.valueOf(from), String.valueOf(to) }, MediaStore.MediaColumns.DATE_TAKEN)) {
            while (q != null && q.moveToNext()) {
                out.put(new JSONObject().put("id", kind + ":" + q.getLong(0)).put("name", q.getString(1))
                    .put("video", kind.equals("vid")).put("at", q.getLong(2)));
            }
        } catch (Exception ignored) { } // нет разрешения — пусто
    }

    // ответ на https://phone.invalid/… или null — не наш адрес
    static WebResourceResponse serve(Context c, WebResourceRequest r) {
        Uri u = r.getUrl();
        if (!HOST.equals(u.getHost())) return null;
        List<String> s = u.getPathSegments();
        try {
            boolean video = s.get(1).equals("vid");
            Uri item = ContentUris.withAppendedId(video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI, Long.parseLong(s.get(2)));
            ContentResolver cr = c.getContentResolver();
            if (s.get(0).equals("thumb")) return jpeg(thumb(cr, item, video, Long.parseLong(s.get(2))));
            if (video) return stream(cr, item, r);
            // снимок — уменьшенный до 2560 точек (снимок на 50–200 Мп целиком окну не по силам); HEIC — тоже в JPEG
            if (Build.VERSION.SDK_INT >= 28) {
                return jpeg(ImageDecoder.decodeBitmap(ImageDecoder.createSource(cr, item), (d, info, src) -> {
                    Size z = info.getSize();
                    float k = Math.min(1f, (float) FULL / Math.max(z.getWidth(), z.getHeight()));
                    d.setTargetSize(Math.max(1, Math.round(z.getWidth() * k)), Math.max(1, Math.round(z.getHeight() * k)));
                    d.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                }));
            }
            return answer(200, cr.getType(item), cr.openInputStream(item), new HashMap<>());
        } catch (Exception e) {
            return answer(404, "text/plain", new ByteArrayInputStream(new byte[0]), new HashMap<>());
        }
    }

    @SuppressWarnings("deprecation")
    private static Bitmap thumb(ContentResolver cr, Uri item, boolean video, long id) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) return cr.loadThumbnail(item, new Size(THUMB, THUMB), null);
        return video ? MediaStore.Video.Thumbnails.getThumbnail(cr, id, MediaStore.Video.Thumbnails.MINI_KIND, null)
            : MediaStore.Images.Thumbnails.getThumbnail(cr, id, MediaStore.Images.Thumbnails.MINI_KIND, null);
    }

    private static WebResourceResponse jpeg(Bitmap b) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, 88, o);
        b.recycle();
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "max-age=86400");
        return answer(200, "image/jpeg", new ByteArrayInputStream(o.toByteArray()), h);
    }

    // ролик — по частям (Range), иначе перемотка в плеере не работает
    private static WebResourceResponse stream(ContentResolver cr, Uri item, WebResourceRequest r) throws Exception {
        long size;
        try (android.content.res.AssetFileDescriptor fd = cr.openAssetFileDescriptor(item, "r")) { size = fd.getLength(); }
        InputStream in = cr.openInputStream(item);
        Map<String, String> h = new HashMap<>();
        h.put("Accept-Ranges", "bytes");
        String range = null;
        for (Map.Entry<String, String> e : r.getRequestHeaders().entrySet()) if (e.getKey().equalsIgnoreCase("Range")) range = e.getValue();
        if (range != null && range.startsWith("bytes=") && size > 0) {
            String[] ab = range.substring(6).split("-", -1);
            long a = ab[0].isEmpty() ? 0 : Long.parseLong(ab[0]);
            long b = ab.length > 1 && !ab[1].isEmpty() ? Math.min(Long.parseLong(ab[1]), size - 1) : size - 1;
            long skip = a;
            while (skip > 0) { long n = in.skip(skip); if (n <= 0) break; skip -= n; }
            h.put("Content-Range", "bytes " + a + "-" + b + "/" + size);
            h.put("Content-Length", String.valueOf(b - a + 1));
            return answer(206, cr.getType(item), in, h);
        }
        if (size > 0) h.put("Content-Length", String.valueOf(size));
        return answer(200, cr.getType(item), in, h);
    }

    private static WebResourceResponse answer(int code, String mime, InputStream in, Map<String, String> h) {
        h.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse(mime, null, code, code == 404 ? "Not Found" : code == 206 ? "Partial Content" : "OK", h, in);
    }
}

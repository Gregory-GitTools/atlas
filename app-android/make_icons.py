# иконки и заставка приложения из icon.png — логотип Travel Earth (Грегори 2026-11-16); запуск: python make_icons.py
from pathlib import Path
from PIL import Image

res = Path("android/app/src/main/res")
src = Image.open("icon.png").convert("RGBA")

def fit(size, part, bg=(0, 0, 0, 0)):
    """картинка size×size, глобус занимает долю part по центру"""
    out = Image.new("RGBA", (size, size), bg)
    g = round(size * part)
    out.alpha_composite(src.resize((g, g), Image.LANCZOS), ((size - g) // 2, (size - g) // 2))
    return out

for d in res.glob("mipmap-*dpi"):
    n = Image.open(d / "ic_launcher.png").size[0]
    fit(n, 0.92).save(d / "ic_launcher.png")
    fit(n, 0.92).save(d / "ic_launcher_round.png")
    m = Image.open(d / "ic_launcher_foreground.png").size[0]
    # фон значка прозрачный (values/ic_launcher_background.xml; Грегори 2026-11-18: «везде логотип на прозрачном
    # фоне»); безопасная зона адаптивной иконки — 66 из 108
    fit(m, 0.66).save(d / "ic_launcher_foreground.png")

for p in res.glob("drawable*/splash.png"):
    w, h = Image.open(p).size
    out = Image.new("RGBA", (w, h), (32, 33, 36, 255))  # #202124 — theme_color сайта
    out.alpha_composite(fit(round(min(w, h) * 0.4), 1), ((w - round(min(w, h) * 0.4)) // 2, (h - round(min(w, h) * 0.4)) // 2))
    out.convert("RGB").save(p)
print("ok")

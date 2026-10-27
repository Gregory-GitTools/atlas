# Значки Atlas: глобус с меридианами и красной меткой. Запуск: python tools/make-icons.py (нужен Pillow)
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)
S = 1024  # рисуем крупно, потом уменьшаем — так края гладкие


def draw():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c, r = S / 2, S * 0.44
    # шар: тёмно-синий, светлее к верхнему левому краю
    for i in range(60, 0, -1):
        k = i / 60
        col = (int(20 + 50 * (1 - k)), int(60 + 90 * (1 - k)), int(120 + 110 * (1 - k)), 255)
        rr = r * k
        off = (1 - k) * r * 0.35
        d.ellipse([c - rr - off, c - rr - off, c + rr - off, c + rr - off], fill=col)
    d.ellipse([c - r, c - r, c + r, c + r], outline=(255, 255, 255, 255), width=int(S * 0.028))
    w = int(S * 0.016)
    line = (255, 255, 255, 170)
    # меридианы — эллипсы разной ширины
    for k in (0.33, 0.7):
        d.ellipse([c - r * k, c - r, c + r * k, c + r], outline=line, width=w)
    d.line([c, c - r, c, c + r], fill=line, width=w)
    # параллели — хорды
    for y in (-0.5, 0, 0.5):
        half = r * (1 - y * y) ** 0.5
        d.line([c - half, c + y * r, c + half, c + y * r], fill=line, width=w)
    # метка: красная капля с белым кантом
    px, py, pr = c + r * 0.28, c - r * 0.18, S * 0.12
    tip = (px, py + pr * 2.1)
    for color, grow in (((255, 255, 255, 255), S * 0.022), ((229, 57, 53, 255), 0)):
        d.ellipse([px - pr - grow, py - pr - grow, px + pr + grow, py + pr + grow], fill=color)
        d.polygon([(px - pr * 0.82 - grow, py + pr * 0.55), (px + pr * 0.82 + grow, py + pr * 0.55), (tip[0], tip[1] + grow * 1.6)], fill=color)
    d.ellipse([px - pr * 0.38, py - pr * 0.38, px + pr * 0.38, py + pr * 0.38], fill=(255, 255, 255, 255))
    return img


big = draw()
for size, name in ((512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png"), (32, "icon-32.png")):
    big.resize((size, size), Image.LANCZOS).save(OUT / name)
big.resize((256, 256), Image.LANCZOS).save(OUT / "app.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
print("значки готовы:", OUT)

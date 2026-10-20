"""Настоящие гравюры для миров II–IV: скачать с Wikimedia Commons и обработать один раз.

    python3 tools/ink.py            # исходники кешируются в .art-src/, результат — в art/

Нужен Pillow: pip install pillow.
Чёрно-белые гравюры → слой чернил: PNG, где альфа = темнота линии (цвет красится в app.js под палитру мира).
Раскраска «от руки» (отмывка) — отдельный маленький цветной слой, растягивается мягко.
Цветные миниатюры — только кадрирование и сжатие.
Источники и лицензии — art/CREDITS.md.
"""
import json, os, sys, time, urllib.parse, urllib.request
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, '.art-src')
OUT = os.path.join(ROOT, 'art')
UA = 'touch2decay/1.0 (https://github.com/ai-slopes-hq/touch2decay)'


def fetch(title, width=1920):
    """Файл Commons по имени; большие — уменьшенной копией шириной width."""
    path = os.path.join(SRC, title.replace(' ', '_'))
    if os.path.exists(path):
        return Image.open(path)
    os.makedirs(SRC, exist_ok=True)
    q = urllib.parse.urlencode(dict(action='query', format='json', prop='imageinfo', iiprop='url',
                                    iiurlwidth=width, titles='File:' + title))
    req = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA})).read()
    page = next(iter(json.loads(req('https://commons.wikimedia.org/w/api.php?' + q))['query']['pages'].values()))
    info = page['imageinfo'][0]
    open(path, 'wb').write(req(info.get('thumburl') or info['url']))
    time.sleep(0.5)
    return Image.open(path)


def ink(img, lo, hi):
    """Оттенки серого → уровни: светлее hi — бумага (прозрачно), темнее lo — полные чернила."""
    g = ImageOps.grayscale(img)
    return g.point(lambda v: 255 if v <= lo else 0 if v >= hi else round(255 * (hi - v) / (hi - lo)))


def save_ink(alpha, name, width):
    alpha = alpha.resize((width, round(alpha.height * width / alpha.width)), Image.LANCZOS)
    im = Image.new('LA', alpha.size, 0)
    im.putalpha(alpha.point(lambda v: v // 17 * 17))   # 16 уровней — PNG втрое легче, на глаз не видно
    path = os.path.join(OUT, name)
    im.save(path, optimize=True)
    return alpha.size, path


def kircher():
    """II · Cabbala — Древо сфирот Кирхера (1652). Центры сфирот — в app.js (KIRCHER), в долях картинки."""
    a = ink(fetch('Kircher Tree of Life.png'), 70, 190)
    return save_ink(a, 'kircher-tree.png', 820)


def leo():
    """III · Rosarium — лев, пожирающий солнце (ксилография, 1550) + отмывка: зелёный лев, золотое солнце, кровь."""
    a = ink(fetch('Lion devouring the sun.jpg'), 80, 200)
    size, path = save_ink(a, 'leo-viridis.png', 820)
    # отмывка в 1/8: силуэт = чернила, «закрытые» широким фильтром; солнце — круг, кровь — струйка из пасти
    s = 8
    small = a.resize((a.width // s, a.height // s), Image.BOX)
    sil = small.point(lambda v: 255 if v > 40 else 0).filter(ImageFilter.MaxFilter(13)).filter(ImageFilter.MinFilter(9))
    w, h = small.size
    sun = Image.new('L', small.size, 0)
    ImageDraw.Draw(sun).ellipse([w * (SUN[0] - SUN[2]), h * (SUN[1] - SUN[2]), w * (SUN[0] + SUN[2]), h * (SUN[1] + SUN[2])], fill=255)
    blood = Image.new('L', small.size, 0)
    d = ImageDraw.Draw(blood)
    for x0, y0, x1, y1 in BLOOD:
        d.line([w * x0, h * y0, w * x1, h * y1], fill=255, width=3)
    edge = Image.new('L', small.size, 0)                 # у краёв картинки отмывка сходит на нет, без жёстких углов
    ImageDraw.Draw(edge).rectangle([4, 4, w - 5, h - 5], fill=255)
    green = ImageChops.multiply(ImageChops.subtract(sil, sun), edge.filter(ImageFilter.GaussianBlur(3)))
    wash = Image.new('RGBA', small.size, (0, 0, 0, 0))
    for mask, col, al in [(green, (104, 140, 64), 120), (sun.filter(ImageFilter.MaxFilter(5)), (226, 172, 52), 170), (blood, (176, 40, 30), 200)]:
        layer = Image.new('RGBA', small.size, col + (0,))
        layer.putalpha(mask.filter(ImageFilter.GaussianBlur(1.6)).point(lambda v: v * al // 255))
        wash = Image.alpha_composite(wash, layer)
    wash.save(os.path.join(OUT, 'leo-viridis-wash.png'), optimize=True)
    return size, path


SUN = (0.716, 0.21, 0.135)        # солнце на гравюре льва: центр и радиус диска с лучами, в долях (дублируется в app.js)
BLOOD = [(0.6, 0.28, 0.655, 0.36), (0.655, 0.36, 0.662, 0.74), (0.672, 0.36, 0.684, 0.72)]


def fons():
    """III · Rosarium — ртутный фонтан, первая гравюра «Розария философов» (Франкфурт, 1550)."""
    img = fetch('Fotothek df tg 0007012 Theosophie ^ Alchemie.jpg').crop((22, 18, 778, 792))
    return save_ink(ink(img, 60, 150), 'fons-mercurialis.png', 700)


def terra():
    """IV · Terra — «Октябрь» из «Великолепного часослова герцога Беррийского» (братья Лимбург, ок. 1412–1416)."""
    img = fetch('Les Très Riches Heures du duc de Berry octobre.jpg', 1400).convert('RGB')
    w, h = img.size
    cw = round(h * 0.5)                         # узкий кадр под телефон; в app.js — «cover»
    img = img.crop(((w - cw) // 2, round(h * 0.012), (w + cw) // 2, round(h * 0.988)))
    img = img.resize((640, round(img.height * 640 / img.width)), Image.LANCZOS)
    path = os.path.join(OUT, 'terra-octobre.jpg')
    img.save(path, quality=80, optimize=True, progressive=True)
    return img.size, path


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for f in [kircher, leo, fons, terra]:
        size, path = f()
        print(f'{os.path.relpath(path, ROOT)}  {size[0]}×{size[1]}  {os.path.getsize(path) // 1024} КБ')
    wash = os.path.join(OUT, 'leo-viridis-wash.png')
    print(f'art/leo-viridis-wash.png  {os.path.getsize(wash) // 1024} КБ')

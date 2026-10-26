#!/usr/bin/env python3
"""Иконка Universum: солнце из host/draw.js (sunGlyph) — двойной диск, 28 лучей, прямые и волнистые через один.
Белое на чёрном, 1024×1024, без прозрачности и скруглений (маску ставит iOS).
python3 ios/icon/make-icon.py  →  icon.svg, AppIcon-1024.png (нужен playwright с chromium)."""
import math, pathlib, sys

OUT = pathlib.Path(__file__).parent
S = 7.6                      # масштаб от размеров в приложении (диск 14 → 106 px, луч 50 → 380 px)
C = 512
N = 28
LW = 11                      # линия толще, чем в приложении (0.9 × S ≈ 7): hairline на 60 pt пропадает
rot = math.radians(-90) + math.pi / N * 0.0

def pt(a, r, off=0.0):
    c, s = math.cos(a), math.sin(a)
    return C + c * r - s * off, C + s * r + c * off

parts = []
for k in range(N):
    a = k / N * math.tau + rot
    if k % 2:                                  # прямой луч: узкий треугольник от диска
        l, w = 50 * S, 2.6 * S
        p0, p1, p2 = pt(a, 17 * S, w), pt(a, l), pt(a, 17 * S, -w)
        parts.append(f'<polyline points="{p0[0]:.1f},{p0[1]:.1f} {p1[0]:.1f},{p1[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}" stroke-opacity="0.95"/>')
    else:                                      # волнистый луч
        l = 38 * S
        pts = []
        for i in range(15):
            t = i / 14
            r = 17 * S + t * (l - 17 * S)
            wv = math.sin(t * math.pi * 3) * 2.2 * S * (1 - t * 0.5)
            x, y = pt(a, r, wv)
            pts.append(f'{x:.1f},{y:.1f}')
        parts.append(f'<polyline points="{" ".join(pts)}" stroke-opacity="0.8"/>')

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<rect width="1024" height="1024" fill="#000"/>
<g fill="none" stroke="#ededed" stroke-width="{LW}" stroke-linecap="round" stroke-linejoin="round">
<circle cx="{C}" cy="{C}" r="470" stroke-width="5" stroke-opacity="0.35"/>
{chr(10).join(parts)}
<circle cx="{C}" cy="{C}" r="{14 * S:.1f}" fill="#000" stroke-opacity="0.95"/>
<circle cx="{C}" cy="{C}" r="{10.5 * S:.1f}" stroke-width="{LW * 0.7:.1f}" stroke-opacity="0.55"/>
</g></svg>'''
(OUT / 'icon.svg').write_text(svg)

if '--no-png' not in sys.argv:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1024, 'height': 1024})
        pg.set_content(f'<body style="margin:0;background:#000">{svg}</body>')
        pg.screenshot(path=str(OUT / 'AppIcon-1024.png'), omit_background=False)
        b.close()

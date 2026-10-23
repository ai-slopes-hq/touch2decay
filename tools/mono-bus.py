#!/usr/bin/env python3
# Сверка шины Monochordum (дека, хор, выход) в браузере: прежний engine.js + эталонный worklet против ядра t2d.wasm, OfflineAudioContext
# (страница — tools/ref/mono-bus.html). Мерило — RMS ± 1 дБ, энергия по октавам ± 1.5 дБ (там, где она не на 60 дБ ниже всего сигнала):
# Web Audio считает фильтры во float и сглаживает ручки по-своему, по сэмплам здесь не сойдётся.
#   python3 -m http.server 8765 (в корне репозитория) и python3 tools/mono-bus.py
import asyncio, os, sys
from playwright.async_api import async_playwright

URL = os.environ.get('T2D_URL', 'http://localhost:8765') + '/tools/ref/mono-bus.html'


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL)
        res = await pg.evaluate('async () => { while (!window.__res) await new Promise(r => setTimeout(r, 50)); return await window.__res; }')
        await b.close()
    bad = 0
    for name, r in res.items():
        dl, dr = r['rms'][1] - r['rms'][0], r['rms'][3] - r['rms'][2]
        db = [round(c - f, 2) for f, c in zip(r['bandsRef'], r['bandsCore'])]
        top = max(r['bandsRef'])
        ok = abs(dl) <= 1 and abs(dr) <= 1 and all(abs(x) <= 1.5 for x, f in zip(db, r['bandsRef']) if f > top - 60)
        bad += not ok
        print(f"{name:8s} RMS ref {r['rms'][0]:.2f} dB, core {dl:+.4f} / {dr:+.4f} dB; octaves core−ref {db} {'ok' if ok else 'FAIL'}")
    if errs:
        print('page errors:', errs)
        bad += 1
    sys.exit(1 if bad else 0)


asyncio.run(main())

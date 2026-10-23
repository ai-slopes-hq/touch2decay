#!/usr/bin/env python3
# Сверка звука Tria в браузере: прежний engine.js на узлах Web Audio + эталонная модель против ядра t2d.wasm (sdk::Param), OfflineAudioContext
# (страница — tools/ref/tria-bus.html). Эталон — 4 прогона: у браузера место разрыва петли FM дрона случайное на каждый контекст, звук
# прежнего engine.js сам по себе гуляет. Мерило — RMS ± 1 дБ от среднего эталонов, октавы — не дальше 1.5 дБ от разброса эталонов
# (там, где энергия не на 60 дБ ниже всего сигнала);
# у браузера синус и треугольник — таблицы, шум — Math.random, всё во float: по сэмплам не сойдётся.
#   python3 -m http.server 8765 (в корне репозитория) и python3 tools/tria-bus.py
import asyncio, os, sys
from playwright.async_api import async_playwright

URL = os.environ.get('T2D_URL', 'http://localhost:8765') + '/tools/ref/tria-bus.html'


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
        ref = r['refRms']; mL = sum(x[0] for x in ref) / len(ref); mR = sum(x[1] for x in ref) / len(ref)
        dl, dr = r['coreRms'][0] - mL, r['coreRms'][1] - mR
        lo = [min(b[i] for b in r['refBands']) for i in range(len(r['coreBands']))]
        hi = [max(b[i] for b in r['refBands']) for i in range(len(r['coreBands']))]
        top = max(hi)
        out = [round(c - h, 2) if c > h else round(c - l, 2) if c < l else 0 for c, l, h in zip(r['coreBands'], lo, hi)]
        ok = abs(dl) <= 1 and abs(dr) <= 1 and all(abs(x) <= 1.5 for x, h in zip(out, hi) if h > top - 60)
        bad += not ok
        spread = max(h - l for l, h, in zip(lo, hi) if h > top - 60)
        print(f"{name:8s} RMS ref {mL:.2f} dB (runs ±{max(abs(x[0] - mL) for x in ref):.2f}), core {dl:+.3f} / {dr:+.3f} dB; octaves outside ref spread {out}; ref spread up to {spread:.1f} dB {'ok' if ok else 'FAIL'}")
    if errs:
        print('page errors:', errs)
        bad += 1
    sys.exit(1 if bad else 0)


asyncio.run(main())

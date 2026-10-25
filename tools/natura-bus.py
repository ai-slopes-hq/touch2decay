#!/usr/bin/env python3
# Сверка звука Natura (мир SDK, core/worlds/natura) с прежним движком на узлах Web Audio: страница tools/ref/natura-bus.html рендерит эталон
# (tools/ref/natura-engine.js + tools/ref/natura-model.js) в OfflineAudioContext и отдаёт состояние сцены и действия; то же — в нативный
# core/build/natura-cli; мерило — RMS ± 1 дБ и энергия по октавам ± 1.5 дБ (там, где она не на 60 дБ ниже самой громкой полосы; низшая
# 31–63 Гц — ± 2 дБ; у чистой синусоиды — только то, что не ниже 40 дБ от пика: дальше одна «юбка» щелчка атаки, а она зависит от подвыборочного старта и k-rate среза Chromium). Различия не по ошибке: волны — настоящие band-limited (не PeriodicWave браузера), ленточная задержка — своя интерполяция.
#   python3 -m http.server 8765 (в корне репозитория), core/build.sh и python3 tools/natura-bus.py
import asyncio, base64, os, subprocess, sys
import numpy as np
from playwright.async_api import async_playwright

ROOT = os.path.join(os.path.dirname(__file__), '..')
URL = os.environ.get('T2D_URL', 'http://localhost:8765') + '/tools/ref/natura-bus.html'
CLI = os.path.join(ROOT, 'core', 'build', 'natura-cli')
SR = 48000
EDGES = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000, 24000]
ONLY = sys.argv[1:]


def bands(x):
    X = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return [10 * np.log10(X[(f >= a) & (f < b)].sum() + 1e-30) for a, b in zip(EDGES[:-1], EDGES[1:])]


def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        await pg.goto(URL)
        res = await pg.evaluate('async () => { while (!window.__res) await new Promise(r => setTimeout(r, 50)); return await window.__res; }')
        await b.close()
    bad = 0
    for name, r in res.items():
        if ONLY and name not in ONLY: continue
        ref = [np.frombuffer(base64.b64decode(c), dtype=np.float32).astype(np.float64) for c in r['ch']]
        inp = 'state ' + ' '.join(repr(float(v)) for v in r['state']) + '\nsecs 6\nact 0.05 1 0 1\n'
        for t, kind, i, a in r['acts']:
            inp += f"act {t} {kind} {i} {' '.join(repr(float(v)) for v in a)}\n"
        raw = subprocess.run([CLI], input=inp.encode(), stdout=subprocess.PIPE, check=True).stdout
        core = np.frombuffer(raw, dtype=np.float32).astype(np.float64).reshape(-1, 4).T
        n = min(len(ref[0]), core.shape[1])
        for lab, i in (('dry L', 0), ('dry R', 1), ('send L', 2), ('send R', 3)):
            if i in (1, 3): continue                       # мир моно: правый канал равен левому
            a, c = ref[i][:n], core[i][:n]
            d = rms_db(c) - rms_db(a)
            ba, bc = bands(a), bands(c)
            top = max(ba)
            db = [round(y - x, 1) for x, y in zip(ba, bc)]
            floor = 40 if name == 'sine' else 60
            ok = abs(d) <= 1 and all(abs(v) <= (2 if k == 0 else 1.5) for k, (v, x) in enumerate(zip(db, ba)) if x > top - floor)
            bad += not ok
            print(f"{name:9s} {lab:7s} RMS ref {rms_db(a):6.1f} dB, core−ref {d:+.2f} dB; octaves core−ref {db} {'ok' if ok else 'FAIL'}")
    if errs:
        print('page errors:', errs[:5]); bad += 1
    sys.exit(1 if bad else 0)


asyncio.run(main())

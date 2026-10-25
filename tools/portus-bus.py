#!/usr/bin/env python3
# Сверка звука Portus (мир SDK, core/worlds/portus) с прежним движком на узлах Web Audio: страница tools/ref/portus-bus.html рендерит эталон
# (tools/ref/portus-engine.js) в OfflineAudioContext и отдаёт STATE; тот же STATE — в нативный core/build/portus-cli; мерило — RMS ± 1 дБ и
# энергия по октавам ± 1.5 дБ (там, где она не на 60 дБ ниже самой громкой полосы; низшая 31–63 Гц — ± 2 дБ). Замер 25.10: RMS ± 0.3 дБ, октавы ± 1.1 дБ (31–63 Гц до +1.6). Различия не по ошибке: пила — настоящий band-limited (не PeriodicWave
# браузера), эхо — одна пара линий от моно-суммы, смена зала — не перекрёстное затухание, а затухание-рост.
#   python3 -m http.server 8765 (в корне репозитория), core/build.sh (или clang++ … portus_cli.cpp) и python3 tools/portus-bus.py
import asyncio, base64, os, subprocess, sys
import numpy as np
from playwright.async_api import async_playwright

ROOT = os.path.join(os.path.dirname(__file__), '..')
URL = os.environ.get('T2D_URL', 'http://localhost:8765') + '/tools/ref/portus-bus.html'
CLI = os.path.join(ROOT, 'core', 'build', 'portus-cli')
SR = 48000
EDGES = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000, 24000]


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
        ref = [np.frombuffer(base64.b64decode(c), dtype=np.float32).astype(np.float64) for c in r['ch']]
        inp = 'state ' + ' '.join(repr(float(v)) for v in r['state']) + '\nsecs 6\n'
        raw = subprocess.run([CLI], input=inp.encode(), stdout=subprocess.PIPE, check=True).stdout
        core = np.frombuffer(raw, dtype=np.float32).astype(np.float64).reshape(-1, 4).T
        n = min(len(ref[0]), core.shape[1])
        for lab, i in (('dry L', 0), ('dry R', 1), ('send L', 2), ('send R', 3)):
            a, c = ref[i][:n], core[i][:n]
            d = rms_db(c) - rms_db(a)
            ba, bc = bands(a), bands(c)
            top = max(ba)
            db = [round(y - x, 1) for x, y in zip(ba, bc)]
            ok = abs(d) <= 1 and all(abs(v) <= (2 if k == 0 else 1.5) for k, (v, x) in enumerate(zip(db, ba)) if x > top - 60)   # низшая полоса 31–63 Гц — на краю окна анализа: ± 2 дБ
            bad += not ok
            print(f"{name:8s} {lab:7s} RMS ref {rms_db(a):6.1f} dB, core−ref {d:+.2f} dB; octaves core−ref {db} {'ok' if ok else 'FAIL'}")
    if errs:
        print('page errors:', errs[:5]); bad += 1
    sys.exit(1 if bad else 0)


asyncio.run(main())

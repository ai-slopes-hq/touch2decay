#!/usr/bin/env python3
# Сверка мастера ядра (core/host/host.cpp, masterRun) с цепочкой Web Audio из host/audio.js: core/build/mix-cli отдаёт сумму миров (L, R)
# и микс после мастера; страница tools/ref/master-bus.html пропускает ту же сумму через узлы веба (highpass → lowpass → компрессор → master →
# колено 4x → потолок) в OfflineAudioContext. Сцены — tools/ref/master-scenes.js. Мерило — как у tenebrae-bus.py: RMS ± 1 дБ, октавы ± 1.5 дБ
# (низшая ± 2 дБ), полосы ниже −60 дБ от самой громкой — пропуск; строка на канал, код 1 при FAIL.
#   python3 -m http.server 8765 (в корне репозитория), core/build.sh и python3 tools/master-bus.py [сцена …]
import asyncio, base64, os, subprocess, sys
import numpy as np
from playwright.async_api import async_playwright

ROOT = os.path.join(os.path.dirname(__file__), '..')
URL = os.environ.get('T2D_URL', 'http://localhost:8765') + '/tools/ref/master-bus.html'
CLI = os.path.join(ROOT, 'core', 'build', 'mix-cli')
SR = 48000
EDGES = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000, 24000]
ONLY = sys.argv[1:]


def band_power(x):
    X = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.array([X[(f >= a) & (f < b)].sum() + 1e-30 for a, b in zip(EDGES[:-1], EDGES[1:])])


def db(p): return 10 * np.log10(p + 1e-24)


def core(stdin):
    raw = subprocess.run([CLI], input=stdin.encode(), stdout=subprocess.PIPE, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 4).T


def b64(x): return base64.b64encode(np.ascontiguousarray(x, dtype=np.float32).tobytes()).decode()


async def main():
    errs, res = [], {}
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        await pg.goto(URL)
        await pg.wait_for_function('window.__ready === true', timeout=15000)
        stdin = await pg.evaluate('window.__stdin')
        unknown = [n for n in ONLY if n not in stdin]
        if unknown:
            await b.close()
            sys.exit(f"unknown scene: {', '.join(unknown)} (known: {', '.join(stdin)})")
        for name, inp in stdin.items():
            if ONLY and name not in ONLY: continue
            c = core(inp)
            ch = await pg.evaluate('([n, l, r]) => window.__run(n, l, r)', [name, b64(c[0]), b64(c[1])])
            res[name] = (c, [np.frombuffer(base64.b64decode(s), dtype=np.float32).astype(np.float64) for s in ch])
        await b.close()
    if not res: sys.exit('no scene ran')
    bad = 0
    for name, (c, ref) in res.items():
        for lab, i in (('mix L', 0), ('mix R', 1)):
            a, x = ref[i], c[2 + i].astype(np.float64)
            n = min(len(a), len(x))
            a, x = a[:n], x[:n]
            d = db(np.mean(x ** 2)) - db(np.mean(a ** 2))
            ba, bc = db(band_power(a)), db(band_power(x))
            top = ba.max()
            dd = [round(float(y - z), 1) for z, y in zip(ba, bc)]
            ok = abs(d) <= 1 and all(abs(v) <= (2 if k == 0 else 1.5) for k, (v, z) in enumerate(zip(dd, ba)) if z > top - 60)
            bad += not ok
            print(f"{name:6s} {lab} RMS ref {db(np.mean(a ** 2)):6.1f} dB (sum {db(np.mean(c[i].astype(np.float64) ** 2)):6.1f}), core−ref {d:+.2f} dB; octaves core−ref {dd} {'ok' if ok else 'FAIL'}")
    if errs:
        print('page errors:', errs[:5]); bad += 1
    sys.exit(1 if bad else 0)


asyncio.run(main())

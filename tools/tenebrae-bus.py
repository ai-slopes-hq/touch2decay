#!/usr/bin/env python3
# Сверка звука Tenebrae (мир I, core/worlds/tenebrae, слот 1) с эталоном на узлах Web Audio: страница tools/ref/tenebrae-bus.html рендерит
# tools/ref/tenebrae-engine.js в OfflineAudioContext по сценам tools/ref/tenebrae-scenes.js и отдаёт stdin для CLI; то же — в нативный
# core/build/tenebrae-cli. Мерило — RMS ± 1 дБ и энергия по октавам ± 1.5 дБ (там, где она не на 60 дБ ниже самой громкой полосы;
# низшая 31–63 Гц — ± 2 дБ), отдельно сухой выход и посыл в зал, L и R (мир стерео).
# Звук случаен с обеих сторон (джиттер строя, шум дыхания, полоса треска удара: Math.random в вебе, Rng ядра), и одна реализация
# гуляет по октавам на 2–3 дБ, поэтому мощности усредняются по зёрнам (SEEDS; у удара — полоса треска на каждый удар своя, их 16):
# Math.random страницы от зерна, у CLI — "seed".
# Неизбежные отличия — docs/worlds/tenebrae.md, «Ядро: отличия».
#   python3 -m http.server 8765 (в корне репозитория), core/build.sh и python3 tools/tenebrae-bus.py [сцена …]
import asyncio, base64, json, os, subprocess, sys
import numpy as np
from playwright.async_api import async_playwright

ROOT = os.path.join(os.path.dirname(__file__), '..')
URL = os.environ.get('T2D_URL', 'http://localhost:8765') + '/tools/ref/tenebrae-bus.html'
CLI = os.path.join(ROOT, 'core', 'build', 'tenebrae-cli')
SR = 48000
SEEDS = 4
SEEDS_OF = {'strike': 16}
EDGES = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000, 24000]
ONLY = sys.argv[1:]


def band_power(x):
    X = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.array([X[(f >= a) & (f < b)].sum() + 1e-30 for a, b in zip(EDGES[:-1], EDGES[1:])])


def db(p): return 10 * np.log10(p + 1e-24)


async def render(pw, seed, only, errs):
    b = await pw.chromium.launch()
    pg = await b.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    await pg.add_init_script(f'window.__seed = {seed}; window.__only = {json.dumps(only)};')
    await pg.goto(URL)
    while not errs and not await pg.evaluate('!!window.__res'):   # ошибка на странице — сразу выход, а не ожидание до таймаута
        await asyncio.sleep(0.05)
    res = {} if errs else await pg.evaluate('async () => await window.__res')
    await b.close()
    return res


def core(stdin, seed):
    raw = subprocess.run([CLI], input=f'seed {seed}\n{stdin}'.encode(), stdout=subprocess.PIPE, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64).reshape(-1, 4).T


async def main():
    errs = []
    async with async_playwright() as pw:
        runs = [await render(pw, 1, ONLY or None, errs)]   # сцены — из tenebrae-scenes.js (все или названные)
        names = [] if errs else list(runs[0])
        for seed in range(2, 1 + max((SEEDS_OF.get(n, SEEDS) for n in names), default=0)):
            runs.append(await render(pw, seed, [n for n in names if seed <= SEEDS_OF.get(n, SEEDS)], errs))
    bad = 0
    for name in runs[0]:
        rs = [r[name] for r in runs if name in r]
        refs = [[np.frombuffer(base64.b64decode(c), dtype=np.float32).astype(np.float64) for c in r['ch']] for r in rs]
        cores = [core(rs[0]['stdin'], s) for s in range(1, 1 + len(rs))]
        n = min(len(refs[0][0]), cores[0].shape[1])
        for lab, i in (('dry L', 0), ('dry R', 1), ('send L', 2), ('send R', 3)):
            pa = np.mean([np.mean(r[i][:n] ** 2) for r in refs])
            pc = np.mean([np.mean(c[i][:n] ** 2) for c in cores])
            ba = db(np.mean([band_power(r[i][:n]) for r in refs], axis=0))
            bc = db(np.mean([band_power(c[i][:n]) for c in cores], axis=0))
            d = db(pc) - db(pa)
            top = ba.max()
            dd = [round(float(y - x), 1) for x, y in zip(ba, bc)]
            ok = abs(d) <= 1 and all(abs(v) <= (2 if k == 0 else 1.5) for k, (v, x) in enumerate(zip(dd, ba)) if x > top - 60)
            bad += not ok
            print(f"{name:7s} {lab:6s} RMS ref {db(pa):6.1f} dB, core−ref {d:+.2f} dB; octaves core−ref {dd} {'ok' if ok else 'FAIL'}")
    if errs:
        print('page errors:', errs[:5]); bad += 1
    sys.exit(1 if bad else 0)


asyncio.run(main())

"""Сверка звука Inferno: прежний JS (tools/ref/inferno-engine.js на OfflineAudioContext в Chromium) против ядра (core/worlds/inferno, нативно).
Мерило решения 6: RMS ± 1 дБ и спектр по полосам, не сэмпл-в-сэмпл (шум у обоих свой). Сравниваются сухой выход и посыл в зал, без мастера.

    python3 tools/inferno-compare.py            # все сценарии
Нужны: clang++, numpy, playwright (chromium); страницу отдаёт локальный http.server (поднимается сам).
"""
import asyncio, base64, os, subprocess, sys, tempfile, time
import numpy as np
from playwright.async_api import async_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SR, SECS, RUNS = 48000, 3, 16          # RUNS прогонов с разной случайностью (всплеск и шум у обоих свои): сравнение — по средней мощности
SCEN = {
  'strike':  ['fx storm 0', 'strike 8 1'],
  'strike-metal-fire': ['fx storm 0', 'fx structure 0.9', 'fx fire 0.8', 'fx smoke 0.6', 'strike 2 1', 'strike 5 0.6'],
  'hold-white': ['fx storm 0', 'circ 4 color 0', 'hold 4'],
  'sinners-mix': ['fx storm 0', 'fx structure 0.5', 'pin 1 0.3', 'circ 1 color 3', 'pin 5 0.6', 'circ 5 color 2', 'pin 7 0.2', 'circ 7 color 4', 'pin 8 0.9', 'circ 8 color 1'],
  'wide-drive': ['fx storm 0', 'circ 3 width 0.9', 'circ 3 drive 0.9', 'circ 6 width 0.1', 'strike 3 1', 'strike 6 1'],
}
BANDS = [(50, 100), (100, 200), (200, 400), (400, 800), (800, 1600), (1600, 3200), (3200, 6400), (6400, 12800)]


def js_render(ops):
    code = """async (ops) => {
      const SR=%d, SECS=%d;
      const {createModel}=await import('/tools/ref/inferno-model.js'); const {createEngine}=await import('/tools/ref/inferno-engine.js');
      const ctx=new OfflineAudioContext(2,SR*SECS,SR), mg=ctx.createChannelMerger(2); mg.connect(ctx.destination);
      const T={send:()=>{const g=ctx.createGain(); g.connect(mg,0,1); return g;}};
      const m=createModel(), e=createEngine(T,m); m.listen(e.on);
      const dry=ctx.createGain(); dry.connect(mg,0,0);
      e.build(ctx,dry);
      for(const l of ops){const a=l.split(' '); const n=(i)=>parseFloat(a[i]);
        if(a[0]==='fx')m.setFx(a[1],n(2)); else if(a[0]==='strike')m.strike(n(1),n(2)); else if(a[0]==='pin')m.pin(n(1),n(2));
        else if(a[0]==='hold')m.hold(n(1),1); else if(a[0]==='pos')m.setPos(n(1),n(2)); else if(a[0]==='circ')m.setCirc(n(1),a[2],a[2]==='color'?n(3)|0:n(3));}
      const buf=await ctx.startRendering(); const L=buf.getChannelData(0),R=buf.getChannelData(1),o=new Float32Array(L.length*2);
      for(let i=0;i<L.length;i++){o[2*i]=L[i];o[2*i+1]=R[i];}
      let s='';const u=new Uint8Array(o.buffer);for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));
      return btoa(s);}""" % (SR, SECS)
    return code


async def render_js(page, ops):
    b64 = await page.evaluate(js_render(ops), ops)
    return np.frombuffer(base64.b64decode(b64), dtype=np.float32).reshape(-1, 2)


def render_core(ops, exe, seed=1):
    with tempfile.TemporaryDirectory() as d:
        sc, out = os.path.join(d, 's.txt'), os.path.join(d, 'o.f32')
        open(sc, 'w').write('\n'.join(ops) + '\n')
        subprocess.run([exe, sc, str(SECS), out, str(seed)], check=True)
        return np.fromfile(out, dtype=np.float32).reshape(-1, 2)


def db(x): return 20 * np.log10(max(x, 1e-12))
def rms(x): return float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) if len(x) else 0.0


def bands(x):                                            # энергия по октавным полосам, усреднённый спектр (окно 8192)
    n = 8192; w = np.hanning(n); acc = np.zeros(n // 2 + 1)
    for i in range(0, len(x) - n, n // 2): acc += np.abs(np.fft.rfft(x[i:i + n].astype(np.float64) * w)) ** 2
    f = np.fft.rfftfreq(n, 1 / SR)
    return [10 * np.log10(acc[(f >= lo) & (f < hi)].sum() + 1e-18) for lo, hi in BANDS]


async def main():
    exe = os.path.join(tempfile.gettempdir(), 'inferno-render')
    subprocess.run(['clang++', '-std=c++17', '-O2', '-ffp-contract=off', os.path.join(ROOT, 'core/render-cli/inferno.cpp'),
                    os.path.join(ROOT, 'core/worlds/inferno/model.cpp'), os.path.join(ROOT, 'core/worlds/inferno/world.cpp'),
                    os.path.join(ROOT, 'core/worlds/inferno/sound.cpp'), os.path.join(ROOT, 'core/host/scale.cpp'), '-o', exe], check=True)
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '--directory', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    bad = 0
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            page = await br.new_page()
            await page.goto('http://localhost:8766/tools/blank.html') if False else await page.goto('http://localhost:8766/')
            for name, ops in SCEN.items():
                js_runs = [await render_js(page, ops) for _ in range(RUNS)]
                core_runs = [render_core(ops, exe, seed + 1) for seed in range(RUNS)]
                print(f'== {name}')
                for ch, label in ((0, 'dry '), (1, 'send')):
                    parts = [(0, SR // 2), (SR // 2, SR), (SR, SR * 2), (SR * 2, SR * 3)]
                    pw = lambda runs, p, q: float(np.sqrt(np.mean([np.mean(r[p:q, ch].astype(np.float64) ** 2) for r in runs])))   # средняя мощность → RMS
                    r = ' '.join(f'{db(pw(js_runs, p, q)):6.1f}/{db(pw(core_runs, p, q)):6.1f}' for p, q in parts)
                    mb = lambda runs: [10 * np.log10(np.mean([10 ** (bands(x[:, ch])[i] / 10) for x in runs]) + 1e-18) for i in range(len(BANDS))]
                    dd = [y - x for x, y in zip(mb(js_runs), mb(core_runs))]
                    tot = db(pw(core_runs, 0, SR * SECS)) - db(pw(js_runs, 0, SR * SECS))
                    a = js_runs[0][:, ch]
                    print(f'  {label} rms js/core dB (0-.5 .5-1 1-2 2-3 s): {r}   total Δ {tot:+.2f} dB')
                    print(f'       bands Δ dB (core − js): ' + ' '.join(f'{x:+5.1f}' for x in dd))
                    if abs(tot) > 1.0 and rms(a) > 1e-5: bad += 1
            await br.close()
    finally:
        srv.terminate()
    print('FAIL: RMS differs by more than 1 dB in', bad, 'channels' if bad else '') if bad else print('ok: RMS within ±1 dB')
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(asyncio.run(main()))

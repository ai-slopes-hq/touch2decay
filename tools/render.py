"""Офлайн-рендер звука: подменяет AudioContext на OfflineAudioContext, ставит планеты касаниями,
выполняет JS (например, меняет тембр) и пишет WAV + печатает RMS и время расчёта.

    python3 tools/render.py                                   # одна планета, 4 с
    python3 tools/render.py "()=>{const v=t2d.voices.find(v=>v.active); v.wave=0.75; v.dirty=true}"
    python3 tools/render.py --world 2                         # Cymatica: удар по пластине

Время расчёта — грубая мера нагрузки звукового графа (сравнивай версии между собой).
"""
import asyncio, base64, os, struct, sys, wave
from playwright.async_api import async_playwright

URL = os.environ.get('T2D_URL', 'http://localhost:8765/index.html')
OUT = os.path.join(os.path.dirname(__file__), '..', '.shots')
SECS = 4
INIT = """(() => { const SR=44100, SECS=%d; window.__off=null;
  window.AudioContext=function(){ window.__off=new OfflineAudioContext(2,SR*SECS,SR); return window.__off; };
  window.webkitAudioContext=window.AudioContext; })();""" % SECS


async def main(js, world=1, onsets=False):
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        c = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        await c.add_init_script(INIT)
        pg = await c.new_page()
        await pg.goto(URL); await pg.wait_for_timeout(300)
        cdp = await c.new_cdp_session(pg)
        T = lambda typ, pts: cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': pts})
        if world == 2:                                       # Cymatica: первое касание — удар по пластине, ждём worklet
            await pg.evaluate('()=>t2d.go(2)')
            g = await pg.evaluate('()=>t2d.cym.geo')
            await T('touchStart', [{'x': g['cx'], 'y': g['cy'], 'id': 1}]); await pg.wait_for_timeout(60); await T('touchEnd', [])
            for _ in range(50):
                if await pg.evaluate('()=>t2d.cym.ready'): break
                await pg.wait_for_timeout(100)
            if onsets:                                       # узор: 4 удара подряд на 120 BPM — проверить ровность
                await pg.evaluate("()=>{const h={vel:1}; t2d.cym.load({bpm:120, rhythm:{len:4, steps:[h,h,h,h]}, melody:{len:1, steps:[{x:0.3,y:0.1}]}}); t2d.cym.play(true)}")
            else:
                await pg.evaluate('()=>t2d.cym.strike(0.3, 0.1)')
        else:
            for k in range(2):                               # двойной тап — закреплённая планета
                await T('touchStart', [{'x': 140, 'y': 600, 'id': k + 1}]); await pg.wait_for_timeout(70); await T('touchEnd', []); await pg.wait_for_timeout(80)
        if js:
            await pg.evaluate(js)
        await pg.wait_for_timeout(300)
        res = await pg.evaluate("""async()=>{ const t=performance.now(); const buf=await window.__off.startRendering(); const ms=performance.now()-t;
          const L=buf.getChannelData(0),R=buf.getChannelData(1),n=L.length,o=new Int16Array(n*2); let e=0;
          let e1=0; for(let i=0;i<n;i++){o[2*i]=Math.max(-1,Math.min(1,L[i]))*32767;o[2*i+1]=Math.max(-1,Math.min(1,R[i]))*32767; if(i>n/2) e+=L[i]*L[i]; if(i<44100) e1+=L[i]*L[i];}
          let s=''; const u=new Uint8Array(o.buffer); for(let i=0;i<u.length;i+=32768) s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));
          return {ms, rms:Math.sqrt(e/(n/2)), rms1:Math.sqrt(e1/44100), b64:btoa(s)}; }""")
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, 'render.wav')
        w = wave.open(path, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(44100); w.writeframes(base64.b64decode(res['b64'])); w.close()
        print(f"render {SECS}s: {res['ms']:.0f} ms, rms {res['rms']:.3f} (first 1 s {res['rms1']:.3f}) → {path}")
        if onsets: print_onsets(path)
        await b.close()

def print_onsets(path):
    """Начала ударов: по разности соседних отсчётов (щелчок удара, а не низкий звон) энергия окна 1 мс
    прыгает в 5 раз против среднего за 10 мс до; между ударами не меньше 0.1 с. Печатает интервалы и разброс."""
    w = wave.open(path); n = w.getnframes(); x = struct.unpack('<%dh' % (n * 2), w.readframes(n))[0::2]
    d1 = [x[i] - x[i - 1] for i in range(1, n)]
    F = 44; e = [sum(v * v for v in d1[i:i + F]) / F for i in range(0, len(d1) - F, F)]
    t, last = [], -1e9
    for i in range(10, len(e)):
        prev = sum(e[i - 10:i]) / 10
        if e[i] > 5 * prev + 1e2 and (i - last) * F / 44100 > 0.1:
            t.append(i * F / 44100); last = i
    d = [b - a for a, b in zip(t, t[1:])]
    if not d: print('onsets: none'); return
    m = sum(d) / len(d)
    print(f'onsets: {len(t)}, interval mean {m * 1000:.2f} ms, max deviation {max(abs(v - m) for v in d) * 1000:.2f} ms')


args = [a for a in sys.argv[1:]]
world = 1
if '--world' in args:                                         # --world 2 — рендер Cymatica (удар по пластине)
    i = args.index('--world'); world = int(args[i + 1]); del args[i:i + 2]
onsets = '--onsets' in args                                   # --onsets — разброс интервалов между ударами узора
if onsets: args.remove('--onsets')
asyncio.run(main(args[0] if args else None, world, onsets))

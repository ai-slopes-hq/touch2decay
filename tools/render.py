"""Офлайн-рендер звука: подменяет AudioContext на OfflineAudioContext, ставит планеты касаниями,
выполняет JS (например, меняет тембр) и пишет WAV + печатает RMS и время расчёта.

    python3 tools/render.py                                   # одна планета, 4 с
    python3 tools/render.py "()=>{const v=t2d.voices.find(v=>v.active); v.wave=0.75; v.dirty=true}"

Время расчёта — грубая мера нагрузки звукового графа (сравнивай версии между собой).
"""
import asyncio, base64, os, sys, wave
from playwright.async_api import async_playwright

URL = os.environ.get('T2D_URL', 'http://localhost:8765/index.html')
OUT = os.path.join(os.path.dirname(__file__), '..', '.shots')
SECS = 4
INIT = """(() => { const SR=44100, SECS=%d; window.__off=null;
  window.AudioContext=function(){ window.__off=new OfflineAudioContext(2,SR*SECS,SR); return window.__off; };
  window.webkitAudioContext=window.AudioContext; })();""" % SECS


async def main(js):
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        c = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        await c.add_init_script(INIT)
        pg = await c.new_page()
        await pg.goto(URL); await pg.wait_for_timeout(300)
        cdp = await c.new_cdp_session(pg)
        T = lambda typ, pts: cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': pts})
        for k in range(2):                                   # двойной тап — закреплённая планета
            await T('touchStart', [{'x': 140, 'y': 600, 'id': k + 1}]); await pg.wait_for_timeout(70); await T('touchEnd', []); await pg.wait_for_timeout(80)
        if js:
            await pg.evaluate(js)
        await pg.wait_for_timeout(300)
        res = await pg.evaluate("""async()=>{ const t=performance.now(); const buf=await window.__off.startRendering(); const ms=performance.now()-t;
          const L=buf.getChannelData(0),R=buf.getChannelData(1),n=L.length,o=new Int16Array(n*2); let e=0;
          for(let i=0;i<n;i++){o[2*i]=Math.max(-1,Math.min(1,L[i]))*32767;o[2*i+1]=Math.max(-1,Math.min(1,R[i]))*32767; if(i>n/2) e+=L[i]*L[i];}
          let s=''; const u=new Uint8Array(o.buffer); for(let i=0;i<u.length;i+=32768) s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));
          return {ms, rms:Math.sqrt(e/(n/2)), b64:btoa(s)}; }""")
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, 'render.wav')
        w = wave.open(path, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(44100); w.writeframes(base64.b64decode(res['b64'])); w.close()
        print(f"render {SECS}s: {res['ms']:.0f} ms, rms {res['rms']:.3f} → {path}")
        await b.close()

asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else None))

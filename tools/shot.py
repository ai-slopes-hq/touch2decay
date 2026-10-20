"""Скриншоты и проверка жестов в headless Chromium, как на iPhone (390×844, касания через CDP).

    python3 -m http.server 8765          # из корня репозитория, в отдельном терминале
    python3 tools/shot.py                # все сценарии → .shots/*.png
    python3 tools/shot.py ring map       # только выбранные

Нужен Playwright: pip install playwright && playwright install chromium.
Внимание: headless рисует программно (без видеокарты) — частота кадров здесь не равна iPhone.
Сам проверяй картинку глазами: открой .shots/*.png.
"""
import asyncio, math, os, sys
from playwright.async_api import async_playwright

URL = os.environ.get('T2D_URL', 'http://localhost:8765/index.html')
OUT = os.path.join(os.path.dirname(__file__), '..', '.shots')
W, H = 390, 844


class Phone:
    def __init__(self, pg, cdp):
        self.pg, self.cdp, self.nid = pg, cdp, 100

    async def T(self, typ, pts):
        await self.cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': pts})

    async def tap(self, x, y, hold=60):
        self.nid += 1
        await self.T('touchStart', [{'x': x, 'y': y, 'id': self.nid}])
        await self.pg.wait_for_timeout(hold)
        await self.T('touchEnd', [])

    async def pin(self, x, y):                      # двойной тап — закрепить планету
        await self.tap(x, y); await self.pg.wait_for_timeout(90); await self.tap(x, y); await self.pg.wait_for_timeout(150)

    async def hold(self, x, y, ms=600):             # удержание; вернуть id, палец остаётся на экране
        self.nid += 1
        await self.T('touchStart', [{'x': x, 'y': y, 'id': self.nid}])
        await self.pg.wait_for_timeout(ms)
        return self.nid

    async def drag(self, pid, x0, y0, x1, y1, steps=10):
        for i in range(1, steps + 1):
            await self.T('touchMove', [{'x': x0 + (x1 - x0) * i / steps, 'y': y0 + (y1 - y0) * i / steps, 'id': pid}])
            await self.pg.wait_for_timeout(16)

    async def up(self):
        await self.T('touchEnd', [])

    async def js(self, expr):
        return await self.pg.evaluate(expr)

    async def shot(self, name):
        os.makedirs(OUT, exist_ok=True)
        await self.pg.screenshot(path=os.path.join(OUT, name + '.png'))


async def sc_planets(p):
    for x, y in [(110, 640), (250, 560), (120, 380)]:
        await p.pin(x, y)
    await p.pg.wait_for_timeout(600)
    await p.shot('planets')
    print('planets:', await p.js("()=>t2d.voices.filter(v=>v.active).map(v=>[v.i,v.pinned,Math.round(t2d.freq(v))])"))


async def sc_ring(p):
    await p.pin(200, 450)
    await p.hold(200, 450); await p.up(); await p.pg.wait_for_timeout(200)   # отпустил в центре — кольцо закреплено
    e = await p.js("()=>t2d.editor&&{cx:t2d.editor.cx,cy:t2d.editor.cy}")
    await p.tap(e['cx'] + math.cos(math.radians(-30)) * 100, e['cy'] + math.sin(math.radians(-30)) * 100)   # луч cutoff
    await p.tap(W * 0.6, H - 16 - 140 * 0.6)                                                                  # пад LFO
    await p.pg.wait_for_timeout(400)
    await p.shot('ring')
    print('ring:', await p.js("()=>({editor:t2d.editor&&t2d.editor.key, lfo:t2d.voices.filter(v=>v.pinned).map(v=>Object.keys(v.lfo))})"))


async def sc_map(p):
    await p.pin(150, 600)
    await p.tap(10, H - 8); await p.pg.wait_for_timeout(800)      # тап по солнцу — карта Universum
    await p.shot('map')
    for name, (x, y), back in [('cabbala', (100, 200), (W - 5, H - 5)), ('rosarium', (100, 600), (W - 85, 90)), ('terra', (300, 600), (5, 5))]:
        await p.tap(x, y); await p.pg.wait_for_timeout(800); await p.shot(name)
        await p.tap(*back); await p.pg.wait_for_timeout(800)
    await p.tap(300, 200); await p.pg.wait_for_timeout(800)       # обратно в Systema


async def sc_sun(p):                               # планету тянут на солнце — солнце бьёт её лучами
    pid = await p.hold(160, 560, ms=60)
    await p.drag(pid, 160, 560, 30, H - 40, steps=14)
    await p.pg.wait_for_timeout(250); await p.shot('sun')
    await p.up()


async def sc_hole(p):                              # касание в чёрной дыре — планета встаёт снаружи; затащить — съедена
    c = await p.js('()=>t2d.holeAt()')
    await p.tap(c['x'] + 30, c['y'] + 10); await p.pg.wait_for_timeout(200)
    print('hole tap:', await p.js("()=>t2d.voices.filter(v=>v.active).map(v=>+v.holeT.toFixed(2))"))
    await p.pin(200, 420)
    pid = await p.hold(200, 420, ms=60)
    await p.drag(pid, 200, 420, c['x'] + 30, c['y'] + 10, steps=16)
    await p.pg.wait_for_timeout(500); await p.shot('hole-drag')
    print('hole held:', await p.js("()=>t2d.voices.filter(v=>v.active).map(v=>[+v.holeT.toFixed(2), v.pinned])"))
    await p.up(); await p.pg.wait_for_timeout(600); await p.shot('hole'); await p.pg.wait_for_timeout(2600)
    print('hole released (eaten one dies):', await p.js("()=>t2d.voices.filter(v=>v.active).map(v=>+v.holeT.toFixed(2))"))


async def sc_vol(p):                               # фейдер громкости: зажал — длинная шкала, повёл вниз — тише
    await p.pin(200, 520)
    b = await p.js("()=>t2d.btnPos('vol')")
    v0 = await p.js('()=>t2d.vol')
    pid = await p.hold(b['x'], b['y'], ms=60)
    await p.drag(pid, b['x'], b['y'], b['x'], b['y'] + 60, steps=8)
    await p.pg.wait_for_timeout(150); await p.shot('vol')
    await p.up(); await p.pg.wait_for_timeout(150)
    print('vol:', round(v0, 3), '→', round(await p.js('()=>t2d.vol'), 3))
    await p.shot('vol-bar')


SCENARIOS = {'vol': sc_vol, 'planets': sc_planets, 'ring': sc_ring, 'map': sc_map, 'sun': sc_sun, 'hole': sc_hole}


async def main(names):
    async with async_playwright() as pw:
        for n in names:
            b = await pw.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
            c = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2, has_touch=True, is_mobile=True)
            pg = await c.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(URL); await pg.wait_for_timeout(600)
            await SCENARIOS[n](Phone(pg, await c.new_cdp_session(pg)))
            print(n, 'errors:', errs)
            await b.close()

asyncio.run(main(sys.argv[1:] or list(SCENARIOS)))

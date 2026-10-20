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


async def sc_worlds(p):                            # карта, Cymatica в четверти II, III и IV не открываются
    await p.pin(150, 600)                                  # Sol Niger: закреплённая планета
    a, b = {'x': 200, 'y': 450, 'id': 1}, {'x': 10, 'y': H - 8, 'id': 2}
    await p.T('touchStart', [a]); await p.pg.wait_for_timeout(60)        # палец держит новую планету...
    await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(60)     # ...второй — солнце: карта
    await p.T('touchEnd', [b]); await p.pg.wait_for_timeout(800)         # touchEnd перечисляет отпускаемые точки: солнце
    assert await p.js('()=>t2d.view') == 'map', 'sun -> map'
    await p.T('touchEnd', [a]); await p.pg.wait_for_timeout(200)         # палец с планеты отпущен уже на карте — без ошибок
    await p.tap(100, 600); await p.pg.wait_for_timeout(800)              # четверть III — не открывается
    assert await p.js('()=>t2d.view') == 'map', 'III stays closed'
    await p.tap(100, 200); await p.pg.wait_for_timeout(800)              # четверть II — Cymatica
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 2], 'II -> Cymatica'
    assert await p.js('()=>t2d.T2D_ok'), 'T2D helpers for worlds'
    await p.shot('cymatica')
    assert await p.js('()=>t2d.voices.some(v=>v.active&&v.pinned&&v.env>0.5)'), 'Sol Niger keeps sounding'
    assert await p.js('()=>t2d.sounding()'), 'sounding() sees Sol Niger from Cymatica'
    z = await p.js('()=>t2d.zoom'); await p.pg.mouse.move(200, 400); await p.pg.mouse.wheel(0, -300)
    await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.zoom') == z, 'wheel in Cymatica keeps Sol Niger zoom'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.voices.some(v=>v.active&&v.pinned)'), 'undo in Cymatica leaves Sol Niger alone'
    r = await p.js("()=>t2d.btnPos('rev')"); await p.tap(r['x'], r['y'])  # FX без набора — ничего
    await p.pg.set_viewport_size({'width': 430, 'height': 900}); await p.pg.wait_for_timeout(300)
    await p.pg.set_viewport_size({'width': W, 'height': H}); await p.pg.wait_for_timeout(300)
    await p.tap(W - 10, H - 8); await p.pg.wait_for_timeout(800)          # резонатор — карта
    assert await p.js('()=>t2d.view') == 'map', 'resonator -> map'
    await p.pg.set_viewport_size({'width': 430, 'height': 900}); await p.pg.wait_for_timeout(300)
    await p.pg.set_viewport_size({'width': W, 'height': H}); await p.pg.wait_for_timeout(300)
    await p.shot('map')
    await p.tap(300, 200); await p.pg.wait_for_timeout(800)              # четверть I
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 1], 'I -> Sol Niger'



async def sc_sun(p):                               # планету тянут на солнце — солнце бьёт её лучами
    pid = await p.hold(160, 560, ms=60)
    await p.drag(pid, 160, 560, 30, H - 40, steps=14)
    await p.pg.wait_for_timeout(250); await p.shot('sun')
    s0 = await p.js('()=>t2d.strikes')
    a, b = {'x': 30, 'y': H - 40, 'id': pid}, {'x': 10, 'y': H - 8, 'id': 999}
    await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(60)     # второй палец — солнце: карта, планету не отпускаем
    await p.T('touchEnd', [b]); await p.pg.wait_for_timeout(1000)
    assert await p.js('()=>t2d.view') == 'map'
    assert await p.js('()=>t2d.strikes') > s0, 'sun strikes keep going off-screen'
    await p.T('touchEnd', [a])


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


async def sc_solniger(p):                          # Sol Niger через интерфейс мира: всё как раньше
    assert await p.js('()=>t2d.world') == 1
    await p.pin(150, 600)
    assert await p.js('()=>t2d.hist(1)') == 1, 'pin -> one undo step'
    assert await p.js('()=>t2d.sounding()'), 'pinned planet sounds'
    u = await p.js("()=>t2d.btnPos('undo')")
    await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.voices.filter(v=>v.active&&v.pinned).length') == 0, 'undo removes the pin'


async def sc_hold(p):                              # держишь планету и уходишь на карту — кольцо тайком не открывается
    await p.pin(150, 600)
    a, b = {'x': 150, 'y': 600, 'id': 1}, {'x': 10, 'y': H - 8, 'id': 2}
    await p.T('touchStart', [a]); await p.pg.wait_for_timeout(60)
    await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(60)
    await p.T('touchEnd', [b]); await p.pg.wait_for_timeout(800)         # карта, планету всё ещё держат
    await p.T('touchEnd', [a]); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.view') == 'map'
    assert not await p.js('()=>!!t2d.editor'), 'no hidden ring opened while on the map'


async def sc_undo(p):                              # лад общий: переключён в Cymatica — откатывается отменой Cymatica, не Sol Niger
    await p.pin(150, 600)
    await p.tap(10, H - 8); await p.pg.wait_for_timeout(800)
    await p.tap(100, 200); await p.pg.wait_for_timeout(800)              # Cymatica
    s = await p.js("()=>t2d.btnPos('scl')"); await p.tap(s['x'], s['y']); await p.pg.wait_for_timeout(300)   # тап — лад вкл/выкл
    on = await p.js('()=>t2d.scl.on')
    assert await p.js('()=>t2d.hist(2)') == 1, 'scale change is a Cymatica undo step'
    await p.tap(W - 10, H - 8); await p.pg.wait_for_timeout(800)
    await p.tap(300, 200); await p.pg.wait_for_timeout(800)              # обратно в Sol Niger
    assert await p.js('()=>t2d.hist(1)') == 1, 'Sol Niger history untouched'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.scl.on') == on, 'undo in Sol Niger keeps the scale set in Cymatica'
    s = await p.js("()=>t2d.btnPos('scl')"); await p.tap(s['x'], s['y']); await p.pg.wait_for_timeout(300)   # лад в самом Sol Niger
    assert await p.js('()=>t2d.scl.on') != on
    await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.scl.on') == on, 'undo in Sol Niger reverts its own scale change'


async def sc_plate(p):                             # Cymatica: удар, смычок, закреплённый смычок, кольцо, высота, FX, отмена
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)        # без касаний: первое касание — по пластине
    g = await p.js('()=>t2d.cym.geo'); cx, cy, r = g['cx'], g['cy'], g['r']
    await p.tap(cx, cy); await p.pg.wait_for_timeout(700)                # звук строится — удар ждёт в очереди
    assert await p.js('()=>t2d.cym.ready'), 'worklet ready'
    assert await p.js('()=>Math.max(...t2d.cym.energy)') > 0, 'first strike is heard'
    pid = await p.hold(cx + 30, cy, ms=600)                              # держишь — смычок
    assert await p.js('()=>t2d.cym.live') == 1 and await p.js('()=>t2d.sounding()'), 'bow while held'
    await p.up(); await p.pg.wait_for_timeout(200)
    bx, by = cx - 40, cy + 20
    await p.pin(bx, by)                                                  # двойной тап — закрепить
    assert await p.js('()=>t2d.cym.bows.length') == 1, 'double tap pins a bow'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.cym.bows.length') == 0, 'undo removes the bow'
    await p.pin(bx, by)
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.cym.bows.length') == 0, 'trash clears bows'
    await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(400)
    assert await p.js('()=>t2d.cym.bows.length') == 1, 'undo brings the bow back'
    assert await p.js('()=>Math.max(...t2d.cym.energy)') > 0, 'restored bow sounds'
    pid = await p.hold(bx, by, ms=600)                                   # долгое касание метки — кольцо
    assert await p.js('()=>t2d.cym.ringOpen'), 'ring opens on the bow mark'
    await p.up(); await p.pg.wait_for_timeout(200)
    assert not await p.js('()=>t2d.cym.ringOpen') and await p.js('()=>t2d.cym.bows.length') == 1, 'ring closes, bow stays'
    f0 = await p.js('()=>t2d.cym.f0')                                    # щипок: развёл — больше и ниже
    a, b = {'x': cx - 20, 'y': cy - 60, 'id': 51}, {'x': cx + 20, 'y': cy - 60, 'id': 52}
    await p.T('touchStart', [a]); await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(30)
    for i in range(1, 9):
        a2, b2 = dict(a, x=cx - 20 - 8 * i), dict(b, x=cx + 20 + 8 * i)
        await p.T('touchMove', [a2, b2]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a2, b2]); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.cym.f0') < f0, 'pinch out lowers the plate'
    z = await p.js('()=>t2d.zoom'); await p.pg.mouse.move(cx, cy)
    for d in (3000, -3000):
        for _ in range(20): await p.pg.mouse.wheel(0, d)
        await p.pg.wait_for_timeout(100)
        f = await p.js('()=>t2d.cym.f0'); assert 55 <= f <= 880, f'pitch clamped: {f}'
    assert await p.js('()=>t2d.zoom') == z, 'wheel in Cymatica keeps Sol Niger zoom'
    s0 = await p.js('()=>t2d.cym.fx.structure'); rv = await p.js("()=>t2d.btnPos('rev')")
    pid = await p.hold(rv['x'], rv['y'], ms=120); await p.drag(pid, rv['x'], rv['y'], rv['x'] - 80, rv['y'], steps=10); await p.up()
    assert await p.js('()=>t2d.cym.fx.structure') != s0, 'FX fan moves structure'
    await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(200)       # убрать смычки
    a, b = {'x': cx, 'y': cy, 'id': 61}, {'x': W - 10, 'y': H - 8, 'id': 62}
    await p.T('touchStart', [a]); await p.pg.wait_for_timeout(300)       # смычок...
    await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(60)     # ...второй палец — резонатор: карта
    await p.T('touchEnd', [b]); await p.pg.wait_for_timeout(400)
    await p.T('touchEnd', [a]); await p.pg.wait_for_timeout(2500)
    assert await p.js('()=>t2d.view') == 'map'
    assert not await p.js('()=>t2d.sounding()'), 'bow stops when its finger is lifted on the map'


SCENARIOS = {'plate': sc_plate, 'hold': sc_hold, 'undo': sc_undo, 'solniger': sc_solniger, 'vol': sc_vol, 'planets': sc_planets, 'ring': sc_ring, 'worlds': sc_worlds, 'sun': sc_sun, 'hole': sc_hole}


async def main(names):
    failed = False
    async with async_playwright() as pw:
        for n in names:
            b = await pw.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
            c = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2, has_touch=True, is_mobile=True)
            pg = await c.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(URL); await pg.wait_for_timeout(600)
            try:
                await SCENARIOS[n](Phone(pg, await c.new_cdp_session(pg)))
            except Exception as e:                  # проверка не прошла или сценарий упал
                print(n, 'FAILED:', type(e).__name__, e); failed = True
            print(n, 'errors:', errs)
            if errs: failed = True
            await b.close()
    sys.exit(1 if failed else 0)

asyncio.run(main(sys.argv[1:] or list(SCENARIOS)))

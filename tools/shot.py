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



async def sc_ampoff(p):                            # левый край полосы amp — off: планета молчит, но модулирует
    await p.pin(200, 450)
    await p.hold(200, 450); await p.up(); await p.pg.wait_for_timeout(200)   # закреплённое кольцо — под ним полоса amp
    a = await p.js('()=>t2d.ampStrip()')
    await p.tap(a['x'] + 3, a['y'] + a['h'] / 2); await p.pg.wait_for_timeout(100)
    amp = await p.js('()=>t2d.voices.find(v=>v.pinned).amp')
    await p.shot('ampoff')
    assert amp == 0, f'left edge of the amp strip is off: {amp}'
    await p.tap(a['x'] + a['w'] * 0.25, a['y'] + a['h'] / 2); await p.pg.wait_for_timeout(100)
    amp = await p.js('()=>t2d.voices.find(v=>v.pinned).amp')
    assert 0.05 <= amp < 0.5, f'a bit to the right it plays again, quietly: {amp}'


async def sc_worlds(p):                            # карта, Cymatica в четверти II, эскиз Laboratorium в III
    await p.pin(150, 600)                                  # Tenebrae: закреплённая планета
    a, b = {'x': 200, 'y': 450, 'id': 1}, {'x': 10, 'y': H - 8, 'id': 2}
    await p.T('touchStart', [a]); await p.pg.wait_for_timeout(60)        # палец держит новую планету...
    await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(60)     # ...второй — солнце: карта
    await p.T('touchEnd', [b]); await p.pg.wait_for_timeout(800)         # touchEnd перечисляет отпускаемые точки: солнце
    assert await p.js('()=>t2d.view') == 'map', 'sun -> map'
    await p.T('touchEnd', [a]); await p.pg.wait_for_timeout(200)         # палец с планеты отпущен уже на карте — без ошибок
    await p.tap(100, 600); await p.pg.wait_for_timeout(800)              # четверть III — эскиз Laboratorium
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 3], 'III opens (sketch)'
    s = await p.js('()=>t2d.lab.geo().sun'); await p.tap(s['x'] - 25, s['y'] + 25); await p.pg.wait_for_timeout(800)
    assert await p.js('()=>t2d.view') == 'map', 'sun -> map'
    await p.tap(100, 200); await p.pg.wait_for_timeout(800)              # четверть II — Cymatica
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 2], 'II -> Cymatica'
    assert await p.js('()=>t2d.T2D_ok'), 'T2D helpers for worlds'
    await p.shot('cymatica')
    assert await p.js('()=>t2d.voices.some(v=>v.active&&v.pinned&&v.env>0.5)'), 'Tenebrae keeps sounding'
    assert await p.js('()=>t2d.sounding()'), 'sounding() sees Tenebrae from Cymatica'
    z = await p.js('()=>t2d.zoom'); await p.pg.mouse.move(200, 400); await p.pg.mouse.wheel(0, -300)
    await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.zoom') == z, 'wheel in Cymatica keeps Tenebrae zoom'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.voices.some(v=>v.active&&v.pinned)'), 'undo in Cymatica leaves Tenebrae alone'
    r = await p.js("()=>t2d.btnPos('rev')"); await p.tap(r['x'], r['y'])  # FX без набора — ничего
    await p.pg.set_viewport_size({'width': 430, 'height': 900}); await p.pg.wait_for_timeout(300)
    await p.pg.set_viewport_size({'width': W, 'height': H}); await p.pg.wait_for_timeout(300)
    await p.tap(W - 10, H - 8); await p.pg.wait_for_timeout(800)          # резонатор — карта
    assert await p.js('()=>t2d.view') == 'map', 'resonator -> map'
    await p.pg.set_viewport_size({'width': 430, 'height': 900}); await p.pg.wait_for_timeout(300)
    await p.pg.set_viewport_size({'width': W, 'height': H}); await p.pg.wait_for_timeout(300)
    await p.shot('map')
    await p.tap(300, 200); await p.pg.wait_for_timeout(800)              # четверть I
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 1], 'I -> Tenebrae'



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


async def sc_solniger(p):                          # Tenebrae через интерфейс мира: всё как раньше
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


async def sc_undo(p):                              # лад общий: переключён в Cymatica — откатывается отменой Cymatica, не Tenebrae
    await p.pin(150, 600)
    await p.tap(10, H - 8); await p.pg.wait_for_timeout(800)
    await p.tap(100, 200); await p.pg.wait_for_timeout(800)              # Cymatica
    s = await p.js("()=>t2d.btnPos('scl')"); await p.tap(s['x'], s['y']); await p.pg.wait_for_timeout(300)   # тап — лад вкл/выкл
    on = await p.js('()=>t2d.scl.on')
    assert await p.js('()=>t2d.hist(2)') == 1, 'scale change is a Cymatica undo step'
    await p.tap(W - 10, H - 8); await p.pg.wait_for_timeout(800)
    await p.tap(300, 200); await p.pg.wait_for_timeout(800)              # обратно в Tenebrae
    assert await p.js('()=>t2d.hist(1)') == 1, 'Tenebrae history untouched'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.scl.on') == on, 'undo in Tenebrae keeps the scale set in Cymatica'
    s = await p.js("()=>t2d.btnPos('scl')"); await p.tap(s['x'], s['y']); await p.pg.wait_for_timeout(300)   # лад в самом Tenebrae
    assert await p.js('()=>t2d.scl.on') != on
    await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.scl.on') == on, 'undo in Tenebrae reverts its own scale change'


async def sc_plate(p):                             # Cymatica: удар, смычок, закреплённый смычок, кольцо, высота, FX, отмена
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)        # без касаний: первое касание — по пластине
    g = await p.js('()=>t2d.cym.geo'); cx, cy, r = g['cx'], g['cy'], g['r']
    await p.tap(cx, cy - 0.9 * r); await p.pg.wait_for_timeout(700)      # звук строится — удар ждёт в очереди (край — нота пластины)
    assert await p.js('()=>t2d.cym.ready'), 'worklet ready'
    assert await p.js('()=>Math.max(...t2d.cym.energy)') > 0, 'first strike is heard'
    await p.shot('plate')
    assert await p.js('()=>typeof t2d.cym.sandSpread') == 'undefined', 'no sand on the handpan'
    u = await p.js("()=>t2d.btnPos('undo')"); c = await p.js("()=>t2d.btnPos('clr')")
    if await p.js('()=>t2d.cym.bowsOn'):                                 # смычки выключены флагом BOWS_ON — их проверки ждут
        pid = await p.hold(cx + 30, cy, ms=600)                              # держишь — смычок
        assert await p.js('()=>t2d.cym.live') == 1 and await p.js('()=>t2d.sounding()'), 'bow while held'
        await p.up(); await p.pg.wait_for_timeout(200)
        bx, by = cx - 40, cy + 20
        await p.pin(bx, by)                                                  # двойной тап — закрепить
        assert await p.js('()=>t2d.cym.bows.length') == 1, 'double tap pins a bow'
        await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
        assert await p.js('()=>t2d.cym.bows.length') == 0, 'undo removes the bow'
        await p.pin(bx, by)
        await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(200)
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
    assert await p.js('()=>t2d.zoom') == z, 'wheel in Cymatica keeps Tenebrae zoom'
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


async def sc_orphan(p):                           # корзина, пока держишь метку смычка, — смычок не остаётся звучать невидимкой
    if not await p.js('()=>(t2d.go(2), t2d.cym.bowsOn)'): print('orphan: bows off (BOWS_ON) — skipped'); return
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)
    g = await p.js('()=>t2d.cym.geo'); bx, by = g['cx'] - 40, g['cy'] + 20
    await p.pin(bx, by); await p.pg.wait_for_timeout(600)
    assert await p.js('()=>t2d.cym.bows.length') == 1
    c = await p.js("()=>t2d.btnPos('clr')")
    a, b = {'x': bx, 'y': by, 'id': 71}, {'x': c['x'], 'y': c['y'], 'id': 72}
    await p.T('touchStart', [a]); await p.pg.wait_for_timeout(60)
    for k in range(1, 5): await p.T('touchMove', [dict(a, x=bx + 6 * k)]); await p.pg.wait_for_timeout(16)
    a = dict(a, x=bx + 24)
    await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(60)     # второй палец — корзина
    await p.T('touchEnd', [b])
    for k in range(1, 5): await p.T('touchMove', [dict(a, x=bx + 24 + 6 * k)]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [dict(a, x=bx + 48)]); await p.pg.wait_for_timeout(4000)
    assert await p.js('()=>t2d.cym.bows.length') == 0
    assert not await p.js('()=>t2d.sounding()'), 'no orphan bow keeps sounding after trash'


async def sc_seq(p):                               # астролябия: пуск, запись игрой, правка на кольцах, темп, кубик, корзина
    import math
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)
    g = await p.js('()=>t2d.cym.astro'); cx, cy, R1, R2, ty = g['cx'], g['cy'], g['R1'], g['R2'], g['ty']
    slot = lambda i, R, d=0: (cx + R * math.cos(-math.pi / 2 + (i + d) * math.pi / 8), cy + R * math.sin(-math.pi / 2 + (i + d) * math.pi / 8))
    await p.tap(g['playX'], ty); await p.pg.wait_for_timeout(500)              # ▶
    assert await p.js('()=>t2d.cym.seq.playing'), 'play'
    await p.tap(g['recX'], ty); await p.pg.wait_for_timeout(200)              # ●
    assert await p.js('()=>t2d.cym.seq.rec'), 'record'
    for dx, dy in [(-50, 0), (40, -30), (0, 50)]:
        await p.tap(cx + dx, cy + dy); await p.pg.wait_for_timeout(300)
    n = await p.js('()=>t2d.cym.seq.rhythm.steps.filter(Boolean).length')
    assert n >= 2, f'taps recorded: {n}'
    for _ in range(3):                                                     # барабанишь в одну точку — каждый тап пишется
        await p.tap(cx - 20, cy - 60); await p.pg.wait_for_timeout(320)
    m = await p.js('()=>t2d.cym.seq.rhythm.steps.filter(Boolean).length')
    assert m >= n + 2, f'same-spot taps recorded: {n} -> {m}'
    await p.tap(g['recX'], ty); await p.pg.wait_for_timeout(100)              # запись выкл
    s8 = await p.js('()=>!!t2d.cym.seq.rhythm.steps[8]')
    await p.tap(*slot(8, R2)); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>!!t2d.cym.seq.rhythm.steps[8]') != s8, 'tap on a rhythm tick toggles it'
    async def drag_len(R, frm, to):                                        # край заливки кольца тянешь по кругу
        hx, hy = slot(frm, R); pid = await p.hold(hx, hy, ms=60)
        for k in range(1, 13):
            a = -math.pi / 2 + (frm + (to - frm) * k / 12) * math.pi / 8
            await p.T('touchMove', [{'x': cx + R * math.cos(a), 'y': cy + R * math.sin(a), 'id': pid}]); await p.pg.wait_for_timeout(16)
        await p.up(); await p.pg.wait_for_timeout(100)
    await drag_len(R2, 15.5, 7.5)
    assert await p.js('()=>[t2d.cym.seq.rhythm.len, t2d.cym.seq.melody.len]') == [8, 7], 'drag the rhythm fill — rhythm length only'
    await drag_len(R1, 6.5, 2.5)
    assert await p.js('()=>[t2d.cym.seq.rhythm.len, t2d.cym.seq.melody.len]') == [8, 3], 'drag the melody fill — melody length only'
    b0 = await p.js('()=>t2d.cym.seq.bpm')
    pid = await p.hold(g['playX'], ty, ms=120); await p.drag(pid, g['playX'], ty, g['playX'] + 60, ty, steps=8); await p.up()
    assert await p.js('()=>t2d.cym.seq.bpm') > b0 and await p.js('()=>t2d.cym.seq.playing'), 'drag ▶ sets tempo, keeps playing'
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(600)
    assert await p.js('()=>t2d.cym.seq.rhythm.steps.some(Boolean) && t2d.cym.seq.playing'), 'dice makes a playing pattern'
    r, m = await p.js('()=>[t2d.cym.seq.rhythm.len, t2d.cym.seq.melody.len]')
    assert r % m != 0, f'dice: melody length does not divide the rhythm — polyrhythm: {r} vs {m}'
    await p.shot('astrolabe')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>!t2d.cym.seq.rhythm.steps.some(Boolean) && t2d.cym.seq.playing'), 'trash clears, clock goes on'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.cym.seq.rhythm.steps.some(Boolean)'), 'undo brings the pattern back'
    await p.js('()=>t2d.go(1)'); await p.pg.wait_for_timeout(500)
    assert await p.js('()=>t2d.sounding()'), 'pattern keeps playing from the other world'
    for vw, vh in [(844, 390), (1280, 720), (375, 667)]:                   # пуск и запись — на экране при любой раскладке
        await p.pg.set_viewport_size({'width': vw, 'height': vh}); await p.pg.wait_for_timeout(300)
        a = await p.js('()=>t2d.cym.astro'); top = await p.js('()=>T2D.topY')
        assert a['ty'] + 18 < vh, f'transport on screen at {vw}x{vh}: {a["ty"]}'
        assert a['cy'] - a['R2'] - 6 > top, f'rings under the top row at {vw}x{vh}'


async def sc_twist(p):                             # два пальца крутят кольца (каждое своё) и пластину (транспонирование); Shift-мышь
    import math
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)
    await p.js("()=>{const C=t2d.cym.core,n=C.degPerOct(),a=C.cellCenter(0,0,n),b=C.cellCenter(1,2,n),h={vel:1}; t2d.cym.load({rhythm:{len:16, steps:[h,null,null,null,h]}, melody:{len:16, steps:[a,null,null,null,b]}})}")
    g = await p.js('()=>t2d.cym.astro'); cx, cy = g['cx'], g['cy']
    pt = lambda R, deg: {'x': cx + R * math.cos(math.radians(deg)), 'y': cy + R * math.sin(math.radians(deg))}
    async def twist(R, d0, turn, i1=81, i2=82, spread=0):
        a, b = dict(pt(R, -90 - d0), id=i1), dict(pt(R, -90 + d0), id=i2)
        await p.T('touchStart', [a]); await p.pg.wait_for_timeout(30)
        await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(30)
        for k in range(1, 11):
            a = dict(pt(R + spread * k / 10, -90 - d0 + turn * k / 10), id=i1); b = dict(pt(R + spread * k / 10, -90 + d0 + turn * k / 10), id=i2)
            await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
        await p.T('touchEnd', [a, b]); await p.pg.wait_for_timeout(150)
    m0 = await p.js('()=>t2d.cym.notes')
    await twist(g['R2'], 25, 45)                                           # пальцы на кольце ритма широко — всё равно ритм
    st = await p.js('()=>t2d.cym.seq.rhythm.steps.map(Boolean)')
    assert [i for i, x in enumerate(st) if x] == [2, 6], f'rhythm ring turned by 2: {st}'
    assert await p.js('()=>t2d.cym.notes') == m0, 'the melody stays where it was'
    await twist(g['R1'], 25, 45)                                           # кольцо мелодии — крутится само
    st = await p.js('()=>t2d.cym.seq.rhythm.steps.map(Boolean)')
    assert [i for i, x in enumerate(st) if x] == [2, 6], f'melody ring leaves the rhythm alone: {st}'
    m = await p.js('()=>t2d.cym.notes')
    assert m[2] == m0[0] and m[6] == m0[4], f'melody ring turned by 2: {m}'
    pos = lambda: p.js('()=>t2d.cym.seq.melody.steps.map(s=>s&&[+s.x.toFixed(4),+s.y.toFixed(4)])')
    s13 = await pos()
    a1, b1 = dict(pt(40, -120), id=85), dict(pt(40, -60), id=86)          # повернул пластину и вернул одним жестом — места прежние
    await p.T('touchStart', [a1]); await p.T('touchStart', [a1, b1]); await p.pg.wait_for_timeout(30)
    for k in list(range(1, 11)) + list(range(9, -1, -1)):
        a1, b1 = dict(pt(40, -120 + 3 * k), id=85), dict(pt(40, -60 + 3 * k), id=86)
        await p.T('touchMove', [a1, b1]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a1, b1]); await p.pg.wait_for_timeout(150)
    assert await pos() == s13, 'twist there and back restores the hits exactly'
    exp = await p.js('()=>{const C=t2d.cym.core; return C.transposeHits(t2d.cym.seq.melody.steps, 2, t2d.cym.base, C.degPerOct(), C.noteList()).map(s=>s&&[+s.x.toFixed(4),+s.y.toFixed(4)])}')
    n0 = await p.js('()=>t2d.cym.notes')
    await twist(40, 30, 40)
    assert await pos() == exp, 'plate twist moves every hit 2 scale steps'
    n1 = await p.js('()=>t2d.cym.notes'); L = await p.js('()=>t2d.cym.core.noteList()')
    assert all(b2 is None if a2 is None else L.index(b2) == L.index(a2) + 2 for a2, b2 in zip(n0, n1)), f'plate twist transposes by 2 steps: {n0} -> {n1}'
    s0, m0 = await pos(), await p.js('()=>t2d.cym.notes')
    a, b = {'x': cx - 30, 'y': cy, 'id': 91}, {'x': cx + 30, 'y': cy, 'id': 92}
    await p.T('touchStart', [a]); await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(30)
    for k in range(1, 11):
        a, b = dict(a, x=cx - 30 - 3 * k), dict(b, x=cx + 30 + 3 * k)
        await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a, b]); await p.pg.wait_for_timeout(150)
    m1 = await p.js('()=>t2d.cym.notes')
    sh = {L.index(b2) - L.index(a2) for a2, b2 in zip(m0, m1) if a2 is not None}
    assert await pos() == s0 and len(sh) == 1 and sh.pop() < 0, f'pinch keeps the hits and carries all notes down: {m0} -> {m1}'
    bows = await p.js('()=>t2d.cym.bowsOn')
    a = {'x': cx + 20, 'y': cy, 'id': 95}                                 # держишь (смычок, если включены); второй палец и поворот
    await p.T('touchStart', [a]); await p.pg.wait_for_timeout(300)
    assert not bows or await p.js('()=>t2d.cym.live') == 1
    await twist(40, 50, 40, 96, 97)
    await p.T('touchEnd', [a]); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.cym.live') == 0, 'held bow stops when a twist starts'
    assert await p.js('()=>t2d.cym.gesture') == 'twist'
    a = {'x': cx + 20, 'y': cy, 'id': 98}                                  # держишь смычок, вторым пальцем — ▶
    await p.T('touchStart', [a]); await p.pg.wait_for_timeout(300)
    b = {'x': g['playX'], 'y': g['ty'], 'id': 99}
    await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(60); await p.T('touchEnd', [b]); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.cym.seq.playing') and (not bows or await p.js('()=>t2d.cym.live') == 1), '▶ by a second finger works, bow keeps going'
    await p.T('touchEnd', [a]); await p.tap(g['playX'], g['ty']); await p.pg.wait_for_timeout(100)
    r0 = await p.js('()=>t2d.cym.seq.rhythm.steps.map(Boolean)')
    m = p.pg.mouse; s = pt(g['R2'], -90)
    await p.pg.keyboard.down('Shift'); await m.move(s['x'], s['y']); await m.down()
    for k in range(1, 19):
        q = pt(g['R2'], -90 + 5 * k); await m.move(q['x'], q['y']); await p.pg.wait_for_timeout(10)
    await m.up(); await p.pg.keyboard.up('Shift'); await p.pg.wait_for_timeout(100)
    r1 = await p.js('()=>t2d.cym.seq.rhythm.steps.map(Boolean)')
    assert r1 == r0[-4:] + r0[:-4], f'Shift-drag turns the rhythm ring by 4: {r0} -> {r1}'


async def sc_entry(p):                             # клавиш нет: курсор — тапом по гнезду, тап по пластине пишет в него; запись игрой
    import math
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)
    for vw, vh in [(844, 390), (W, H)]:                                    # пуск и запись на экране в альбоме и портрете
        await p.pg.set_viewport_size({'width': vw, 'height': vh}); await p.pg.wait_for_timeout(300)
        a = await p.js('()=>t2d.cym.astro')
        assert a['ty'] + 18 < vh, f'transport on screen at {vw}x{vh}'
    assert await p.js('()=>t2d.cym.keys') is None, 'no scale keys'
    g = await p.js('()=>t2d.cym.astro'); geo = await p.js('()=>t2d.cym.geo')
    assert await p.js('()=>t2d.cym.cursor') is None, 'no cursor until a slot is tapped'
    await p.tap(geo['cx'], geo['cy'] - 0.9 * geo['r']); await p.pg.wait_for_timeout(700)
    assert not await p.js('()=>t2d.cym.seq.melody.steps.some(Boolean)'), 'without a cursor a tap only plays'
    s3 = lambda: (g['cx'] + g['R1'] * math.cos(math.radians(-90 + 3 * 22.5)), g['cy'] + g['R1'] * math.sin(math.radians(-90 + 3 * 22.5)))
    await p.tap(*s3()); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.cym.cursor') == 3, 'tap a melody slot — cursor there'
    q = await p.js('()=>{const c=t2d.cym.core.cellCenter(1,2,t2d.cym.core.degPerOct()), g=t2d.cym.geo; return {x:g.cx+c.x*g.r, y:g.cy+c.y*g.r}}')
    await p.tap(q['x'], q['y']); await p.pg.wait_for_timeout(100)
    hz = await p.js('()=>t2d.cym.lastStrike.hz'); m = await p.js('()=>t2d.cym.notes')
    assert m[3] is not None and abs(55 * 2 ** (m[3] / 12) - hz) < 0.01, f'plate tap writes its note into the cursor slot: {m[3]} vs {hz}'
    assert await p.js('()=>t2d.cym.cursor') == 4, 'cursor moves on'
    assert await p.js('()=>t2d.cym.seq.rhythm.steps.filter(Boolean).length') == 16, 'empty rhythm gets a hit on every step'
    await p.tap(q['x'], q['y']); await p.pg.wait_for_timeout(100)          # тот же тап по метке — та же нота в следующее гнездо
    m = await p.js('()=>t2d.cym.notes')
    assert m[4] == m[3] and await p.js('()=>t2d.cym.cursor') == 5, f'step entry repeats a note on the same spot: {m[3:6]}'
    await p.shot('entry')
    await p.tap(15, g['ty']); await p.pg.wait_for_timeout(100)             # мимо пластины и колец — курсор убран
    assert await p.js('()=>t2d.cym.cursor') is None, 'tap away clears the cursor'
    await p.tap(*s3()); await p.pg.wait_for_timeout(100)
    await p.tap(g['playX'], g['ty']); await p.pg.wait_for_timeout(500)    # ▶ — курсор убран
    assert await p.js('()=>t2d.cym.cursor') is None and await p.js('()=>t2d.cym.seq.playing'), '▶ clears the cursor'
    await p.tap(*s3()); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.cym.cursor') is None, 'no cursor while the clock runs'
    await p.tap(g['recX'], g['ty']); await p.pg.wait_for_timeout(200)    # ●
    n0 = await p.js('()=>JSON.stringify(t2d.cym.seq.melody.steps)')
    await p.tap(geo['cx'] + 30, geo['cy'] + 40); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>JSON.stringify(t2d.cym.seq.melody.steps)') != n0, 'recorded place'
    assert await p.js('()=>t2d.cym.lastStrike.rec') is True, 'strike while recording carries rec'
    await p.tap(g['recX'], g['ty']); await p.tap(g['playX'], g['ty']); await p.pg.wait_for_timeout(200)


async def sc_relative(p):                          # щипок транспонирует все ноты; кольца крутятся с запасом и видно
    import math
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)
    await p.js("()=>{const C=t2d.cym.core,n=C.degPerOct(),a=C.cellCenter(1,0,n),b=C.cellCenter(1,3,n),h={vel:1}; t2d.cym.load({rhythm:{len:16, steps:[h,null,null,null,h]}, melody:{len:16, steps:[a,null,null,null,b]}})}")
    g = await p.js('()=>t2d.cym.astro'); cx, cy = g['cx'], g['cy']
    L = await p.js('()=>t2d.cym.core.noteList()'); m0 = await p.js('()=>t2d.cym.notes')
    a, b = {'x': cx - 30, 'y': cy, 'id': 41}, {'x': cx + 30, 'y': cy, 'id': 42}
    await p.T('touchStart', [a]); await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(30)
    for k in range(1, 11):
        a, b = dict(a, x=cx - 30 - 3 * k), dict(b, x=cx + 30 + 3 * k)
        await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a, b]); await p.pg.wait_for_timeout(150)
    m = await p.js('()=>t2d.cym.notes')
    d0, d4 = L.index(m[0]) - L.index(m0[0]), L.index(m[4]) - L.index(m0[4])
    assert d0 == d4 and d0 < 0, f'pinch transposes all notes alike: {m0[:5]} -> {m[:5]}'
    pt = lambda R, deg, i: {'x': cx + R * math.cos(math.radians(deg)), 'y': cy + R * math.sin(math.radians(deg)), 'id': i}
    R = g['R2'] + 22                                                       # мимо линии кольца ритма — всё равно ритм
    a, b = pt(R, -115, 43), pt(R, -65, 44)
    await p.T('touchStart', [a]); await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(30)
    for k in range(1, 11):
        a, b = pt(R, -115 + 3 * k, 43), pt(R, -65 + 3 * k, 44)
        await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
    turn = await p.js('()=>t2d.cym.ringTurn')
    assert abs(turn['rhythm'] - 7.5) < 3 and turn['melody'] == 0, f'the rhythm ring visibly turns with the fingers, alone: {turn}'
    for k in range(11, 16):
        a, b = pt(R, -115 + 3 * k, 43), pt(R, -65 + 3 * k, 44)
        await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a, b]); await p.pg.wait_for_timeout(150)
    st = await p.js('()=>t2d.cym.seq.rhythm.steps.map(Boolean)')
    assert [i for i, x in enumerate(st) if x] == [2, 6], f'rhythm ring turned by 2: {st}'
    assert await p.js('()=>t2d.cym.ringTurn.rhythm') == 0, 'snaps to a slot on release'
    R = (await p.js('()=>t2d.cym.geo'))['rMax'] + 4                       # между столом и кольцом мелодии — мелодия
    a, b = pt(R, -115, 45), pt(R, -65, 46)
    await p.T('touchStart', [a]); await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(30)
    for k in range(1, 16):
        a, b = pt(R, -115 + 3 * k, 45), pt(R, -65 + 3 * k, 46)
        await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a, b]); await p.pg.wait_for_timeout(150)
    st = await p.js('()=>t2d.cym.seq.melody.steps.map(Boolean)')
    assert [i for i, x in enumerate(st) if x] == [2, 6], f'melody ring turned by 2: {st}'


async def sc_grid(p):                              # сетка записи 1/16 → 1/8 → 1/4; зажал — причесать ритм; фон-волны по высоте
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)
    g = await p.js('()=>t2d.cym.astro'); gx, ty = g['gridX'], g['ty']
    assert await p.js('()=>t2d.cym.grid') == 1
    for want in (2, 4, 1):
        await p.tap(gx, ty); await p.pg.wait_for_timeout(100)
        assert await p.js('()=>t2d.cym.grid') == want, f'grid cycles to {want}'
    await p.tap(gx, ty); await p.tap(gx, ty); await p.pg.wait_for_timeout(100)   # 1/4
    await p.tap(g['playX'], ty); await p.pg.wait_for_timeout(500); await p.tap(g['recX'], ty)
    for k in range(5):
        await p.tap(g['cx'] - 40 + 20 * k, g['cy'] + 30); await p.pg.wait_for_timeout(170 + 37 * k)
    st = await p.js('()=>t2d.cym.seq.rhythm.steps.map(Boolean)')
    assert any(st) and all(i % 4 == 0 for i, x in enumerate(st) if x), f'recorded on the 1/4 grid: {st}'
    await p.tap(g['recX'], ty); await p.tap(g['playX'], ty); await p.pg.wait_for_timeout(100)
    await p.js("()=>{const h=(n)=>({x:0.1*n,y:0,vel:1}); t2d.cym.load({rhythm:{len:16, steps:[null,h(1),h(2),null,null,null,null,h(7)]}})}")
    await p.tap(g['cx'] + 60, g['cy']); await p.pg.wait_for_timeout(150)           # любой жест — чтобы узор попал в историю
    pid = await p.hold(gx, ty, ms=700); await p.up(); await p.pg.wait_for_timeout(150)
    st = await p.js('()=>t2d.cym.seq.rhythm.steps.map(Boolean)')
    assert [i for i, x in enumerate(st) if x] == [0, 4, 8], f'hold the grid button — rhythm combed to 1/4: {st}'
    assert await p.js('()=>t2d.cym.grid') == 4, 'hold does not cycle the grid'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(150)
    st = await p.js('()=>t2d.cym.seq.rhythm.steps.map(Boolean)')
    assert [i for i, x in enumerate(st) if x] == [1, 2, 7], f'undo brings the uncombed rhythm back: {st}'
    w1 = await p.js('()=>t2d.cym.waveStep')
    await p.pg.mouse.move(g['cx'], g['cy'])
    for _ in range(10): await p.pg.mouse.wheel(0, 3000)
    await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.cym.waveStep') < w1, 'smaller plate — denser waves'
    await p.shot('waves')


async def sc_scalepinch(p):                        # с ладом щипок идёт по ступеням без застреваний, пластина едет плавно
    import math
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)
    await p.js('()=>{t2d.scl.on = true}')
    g = await p.js('()=>t2d.cym.astro'); cx, cy = g['cx'], g['cy']
    semis = await p.js('()=>t2d.cym.core.scaleSemis()')
    a, b = {'x': cx - 20, 'y': cy, 'id': 31}, {'x': cx + 20, 'y': cy, 'id': 32}
    await p.T('touchStart', [a]); await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(30)
    seen = []
    for k in range(1, 31):
        a, b = dict(a, x=cx - 20 - 2 * k), dict(b, x=cx + 20 + 2 * k)
        await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
        seen.append(round(12 * math.log2(await p.js('()=>t2d.cym.f0') / 55)))
    shown = await p.js('()=>t2d.cym.shownF0'); f0 = await p.js('()=>t2d.cym.f0')
    await p.T('touchEnd', [a, b]); await p.pg.wait_for_timeout(150)
    idx = [semis.index(s) for s in seen]
    assert all(s in semis for s in seen), f'pinch lands on scale notes: {seen}'
    assert all(abs(j - i) <= 1 for i, j in zip(idx, idx[1:])), f'one scale step at a time: {idx}'
    assert len(set(idx)) >= 4, f'keeps moving through the scale, no sticking: {idx}'
    assert shown != f0, 'plate size eases to the new note'



async def sc_echo(p):                              # эхо по долям темпа: луч time 1/16t … 1/4d, повторов больше с echo
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)
    g = await p.js('()=>t2d.cym.geo'); await p.tap(g['cx'], g['cy']); await p.pg.wait_for_timeout(700)
    rv = await p.js("()=>t2d.btnPos('rev')")
    pid = await p.hold(rv['x'], rv['y'], ms=120); await p.drag(pid, rv['x'], rv['y'], rv['x'], rv['y'] + 400, steps=12)
    e = await p.js('()=>t2d.cym.echo'); await p.shot('echo'); await p.up()
    bpm = await p.js('()=>t2d.cym.seq.bpm')
    assert e['label'] == '1/4d', f'time ray at the end is a dotted quarter: {e}'
    assert abs(e['sec'] - 1.5 * 60 / bpm) < 1e-3, f'delay follows the tempo: {e}'
    await p.js("()=>t2d.cym.load({bpm: 120, fx: {time: 2 / 8, echo: 0.2}})"); await p.pg.wait_for_timeout(100)
    e = await p.js('()=>t2d.cym.echo')
    assert e['label'] == '1/8t' and abs(e['sec'] - 60 / 120 / 3) < 1e-3, f'eighth triplet at 120: {e}'
    fb0 = e['fb']; await p.js("()=>t2d.cym.load({fx: {echo: 0.9}})"); e = await p.js('()=>t2d.cym.echo')
    assert e['fb'] > fb0 + 0.2, f'more echo, more repeats: {fb0} -> {e}'
    ch = await p.js('()=>t2d.cym.echoChains')                           # смена доли — новая линия, старая звенит своим временем
    assert len(ch) >= 2 and abs(ch[-1]['sec'] - 0.5 / 3) < 1e-3 and abs(ch[-1]['real'] - ch[-1]['sec']) < 1e-4, f'new time starts clean, no glide: {ch}'
    assert any(abs(x['sec'] - 1.5 * 60 / bpm) < 1e-3 for x in ch[:-1]), f'old echoes keep their time: {ch}'
    await p.js("()=>t2d.cym.load({bpm: 40, fx: {time: 1}})"); e = await p.js('()=>t2d.cym.echo')
    assert abs(e['sec'] - 2.25) < 1e-3 and await p.js('()=>t2d.cym.echoMax') > 2.2, f'slow dotted quarter fits the delay line: {e}'



async def sc_handpan(p):                           # нота — от клетки пластины: сектор — ступень, кольцо — октава; бусины и метки правят ноты
    import math
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)
    await p.js('()=>{t2d.scl.on = false}')
    async def cell(ring, sec):
        return await p.js(f'()=>{{const c=t2d.cym.core.cellCenter({ring},{sec},t2d.cym.core.degPerOct()), g=t2d.cym.geo; return {{x:g.cx+c.x*g.r, y:g.cy+c.y*g.r}}}}')
    assert await p.js('()=>t2d.cym.showNotes') is False, 'at rest no note names'
    await p.shot('handpan')
    q = await cell(1, 1); pid = await p.hold(q['x'], q['y'], ms=400)
    assert await p.js('()=>t2d.cym.showNotes') is True, 'finger on the plate — note names'
    await p.shot('handpan-held'); await p.up(); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.cym.showNotes') is False, 'finger lifted — names gone'
    g0 = await p.js('()=>t2d.cym.geo'); a, b = {'x': g0['cx'] - 30, 'y': g0['cy'], 'id': 21}, {'x': g0['cx'] + 30, 'y': g0['cy'], 'id': 22}
    await p.T('touchStart', [a]); await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(30)
    for k in range(1, 6):
        a, b = dict(a, x=g0['cx'] - 30 - 4 * k), dict(b, x=g0['cx'] + 30 + 4 * k)
        await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a, b]); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.cym.showNotes') is True, 'just after a pinch — names shown'
    await p.pg.wait_for_timeout(1300)
    assert await p.js('()=>t2d.cym.showNotes') is False, 'a second later — gone'
    q = await cell(1, 2); await p.tap(q['x'], q['y']); await p.pg.wait_for_timeout(250)   # гейт: клетка горит, пока звучит её нота
    lit = await p.js('()=>t2d.cym.lit')
    assert '1,2' in lit, f'the struck cell glows while its note sounds: {lit}'
    await p.shot('handpan-gate')
    await p.pg.wait_for_timeout(4000)
    assert await p.js('()=>t2d.cym.lit') == [], 'and goes dark when the note has died away'
    q = await cell(0, 0); await p.tap(q['x'], q['y']); await p.pg.wait_for_timeout(700)
    h0 = await p.js('()=>t2d.cym.lastStrike.hz')
    q = await cell(2, 0); await p.tap(q['x'], q['y']); await p.pg.wait_for_timeout(200)
    h2 = await p.js('()=>t2d.cym.lastStrike.hz')
    assert abs(h2 / h0 - 4) < 0.02, f'centre ring is two octaves above the edge ring: {h0} -> {h2}'
    await p.js('()=>{t2d.scl.on = true}'); await p.pg.wait_for_timeout(100)
    g = await p.js('()=>t2d.cym.geo'); await p.tap(g['cx'], g['cy']); await p.pg.wait_for_timeout(200)
    hz = await p.js('()=>t2d.cym.lastStrike.hz'); L = await p.js('()=>t2d.cym.core.noteList()')
    assert round(12 * math.log2(hz / 55)) in L, f'with a scale the centre plays a scale note: {hz}'
    await p.js('()=>{t2d.scl.on = false}'); await p.pg.wait_for_timeout(100)
    await p.js("()=>{const C=t2d.cym.core,n=C.degPerOct(),a=C.cellCenter(0,0,n),b=C.cellCenter(0,1,n),h={vel:1}; t2d.cym.load({rhythm:{len:8, steps:[h,h]}, melody:{len:8, steps:[a,b]}})}")
    await p.js('()=>{t2d.scl.on = true}'); await p.pg.wait_for_timeout(100)   # лад сменили — в worklet уходят новые ноты
    assert await p.js('()=>JSON.stringify(t2d.cym.sentSeq.melody.steps.map(s=>s&&s.s)) === JSON.stringify(t2d.cym.notes)'), 'scale change reaches the worklet'
    await p.js('()=>{t2d.scl.on = false}'); await p.pg.wait_for_timeout(100)
    born0 = await p.js('()=>t2d.cym.bornM'); await p.pg.wait_for_timeout(600)
    g1 = await p.js('()=>t2d.cym.geo'); a1, b1 = {'x': g1['cx'] - 30, 'y': g1['cy'] + 200, 'id': 23}, {'x': g1['cx'] + 30, 'y': g1['cy'] + 200, 'id': 24}
    await p.T('touchStart', [a1]); await p.T('touchStart', [a1, b1]); await p.pg.wait_for_timeout(30)
    for k in range(1, 8):
        a1, b1 = dict(a1, x=g1['cx'] - 30 - 4 * k), dict(b1, x=g1['cx'] + 30 + 4 * k)
        await p.T('touchMove', [a1, b1]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a1, b1]); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.cym.f0') != 110 and await p.js('()=>t2d.cym.bornM') == born0, 'pinch does not make the beads flash'
    for _ in range(3):
        u0 = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u0['x'], u0['y']); await p.pg.wait_for_timeout(100)
    await p.js("()=>{const C=t2d.cym.core,n=C.degPerOct(),a=C.cellCenter(0,0,n),b=C.cellCenter(0,1,n),h={vel:1}; t2d.cym.load({rhythm:{len:8, steps:[h,h]}, melody:{len:8, steps:[a,b]}})}")
    q = await cell(0, 3); await p.tap(q['x'], q['y']); await p.pg.wait_for_timeout(150)   # жест — чтобы узор попал в историю отмены
    L = await p.js('()=>t2d.cym.core.noteList()'); b = await p.js('()=>t2d.cym.base')
    m0 = await p.js('()=>t2d.cym.notes')
    assert m0[0] == L[b] and m0[1] == L[b + 1], f'notes come from the cells: {m0[:2]}'
    a = await p.js('()=>t2d.cym.astro')
    pid = await p.hold(a['cx'], a['cy'] - a['R1'], ms=60)                  # бусину гнезда 0 — от центра на 13 px
    await p.drag(pid, a['cx'], a['cy'] - a['R1'], a['cx'], a['cy'] - a['R1'] - 13, steps=6); await p.up(); await p.pg.wait_for_timeout(100)
    m = await p.js('()=>t2d.cym.notes')
    assert m[0] == L[b + 2], f'bead dragged out two steps: {m0[0]} -> {m[0]}'
    c2 = await p.js('()=>{const C=t2d.cym.core,s=t2d.cym.seq.melody.steps[0]; return C.cellIdx(s.x,s.y,t2d.cym.base,C.degPerOct())}')
    assert c2 == b + 2, f'the hit moved to the cell of the new note: {c2}'
    s1 = await cell(0, 1); t1 = await cell(2, 1)
    pid = await p.hold(s1['x'], s1['y'], ms=60); await p.drag(pid, s1['x'], s1['y'], t1['x'], t1['y'], steps=10); await p.up(); await p.pg.wait_for_timeout(100)
    m = await p.js('()=>t2d.cym.notes')
    assert m[1] >= m0[1] + 24, f'mark dragged to the centre — note two octaves up: {m0[1]} -> {m[1]}'
    u = await p.js("()=>t2d.btnPos('undo')")
    for _ in range(2):
        await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>t2d.cym.notes') == m0, 'undo brings the places (and notes) back'
    R1 = a['R1']; cx, cy = a['cx'], a['cy']
    pid = await p.hold(cx + R1 * math.cos(-math.pi / 2 + 7.5 * math.pi / 8), cy + R1 * math.sin(-math.pi / 2 + 7.5 * math.pi / 8), ms=60)
    for k in range(1, 13):
        an = -math.pi / 2 + (7.5 - 4 * k / 12) * math.pi / 8
        await p.T('touchMove', [{'x': cx + R1 * math.cos(an), 'y': cy + R1 * math.sin(an), 'id': pid}]); await p.pg.wait_for_timeout(16)
    await p.up(); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>[t2d.cym.seq.rhythm.len, t2d.cym.seq.melody.len]') == [8, 4], 'the melody ring has its own length'
    await p.pg.mouse.move(cx, cy)                                          # пластина у верха (колесо вниз — меньше и выше): центр за 1760 Гц — молчит
    for _ in range(20): await p.pg.mouse.wheel(0, 3000)
    await p.pg.wait_for_timeout(100)
    await p.js("()=>{const C=t2d.cym.core,n=C.degPerOct(),a=C.cellCenter(2,0,n),b=C.cellCenter(0,0,n),h={vel:1}; t2d.cym.load({rhythm:{len:2, steps:[h,h]}, melody:{len:2, steps:[a,b]}})}")
    s = await p.js('()=>t2d.cym.sentSeq')
    assert s['melody']['steps'][0] is None and s['melody']['steps'][1] is not None, f'out-of-range cell is silent: {s}'
    for _ in range(20): await p.pg.mouse.wheel(0, -3000)
    await p.pg.wait_for_timeout(100)
    d = await p.js("()=>t2d.btnPos('dice')"); rings = set()               # кубик кладёт удары во все три кольца, не только у края
    for _ in range(20):
        await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(40)
        rs = await p.js('()=>{const C=t2d.cym.core,n=C.degPerOct(),b=t2d.cym.base; return t2d.cym.seq.melody.steps.filter(Boolean).map(s=>{const i=C.cellIdx(s.x,s.y,b,n); return i==null?-1:Math.floor((i-b)/n)})}')
        assert all(0 <= r <= 2 for r in rs), f'dice hits stay on the plate: {rs}'
        rings |= set(rs)
    assert rings == {0, 1, 2}, f'dice reaches every ring: {rings}'


async def sc_sketches(p):                         # эскизы миров III и IV: картинка, FX меняют пейзаж, солнце — на карту
    await p.js('()=>t2d.go(3)'); await p.pg.wait_for_timeout(900); await p.shot('laboratorium')
    await p.js('()=>{t2d.lab.fx.athanor=1}'); await p.pg.wait_for_timeout(300); await p.shot('laboratorium-fire')
    await p.js('()=>t2d.go(4)'); await p.pg.wait_for_timeout(900); await p.shot('natura')
    await p.js("()=>Object.assign(t2d.nat.fx,{reverb:1,delay:1,time:1,chorus:1,cutoff:1,env:0.9})"); await p.pg.wait_for_timeout(500); await p.shot('natura-fx')
    await p.js("()=>Object.assign(t2d.nat.fx,{reverb:0,delay:0,time:0,chorus:0,cutoff:0})"); await p.pg.wait_for_timeout(500); await p.shot('natura-clear')
    await p.tap(30, H - 30); await p.pg.wait_for_timeout(300)            # надгробие — пока ни к чему не ведёт
    assert await p.js('()=>t2d.view') == 'play', 'Natura tombstone does nothing yet'
    s = await p.js('()=>t2d.nat.geo().sun'); await p.tap(s['x'] + 25, s['y'] + 25); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'Natura sun -> map'
    await p.tap(100, 600); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 3], 'III opens'
    await p.tap(W - 38, H - 40); await p.pg.wait_for_timeout(300)        # древо в углу — пока ни к чему не ведёт
    assert await p.js('()=>t2d.view') == 'play', 'corner tree does nothing yet'
    s = await p.js('()=>t2d.lab.geo().sun'); await p.tap(s['x'] - 25, s['y'] + 25); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'Laboratorium sun -> map'
    await p.shot('map-sketches')


async def sc_lab(p):                              # Laboratorium: огонь — дрон, колба вбок — высота, вверх — уровень, трубки, пеликан, корзина, отмена, кубик
    await p.js('()=>t2d.go(3)'); await p.pg.wait_for_timeout(300)
    fb = await p.js('()=>t2d.lab.furnace()'); await p.tap(fb['x'], fb['y']); await p.pg.wait_for_timeout(1800)
    assert await p.js('()=>t2d.lab.fire && t2d.lab.live'), 'tap the furnace — fire, drone'
    lv = await p.js('()=>T2D.level'); assert lv > 0.02, f'drone is heard: {lv}'
    assert await p.js('()=>t2d.sounding()'), 'sounding while the fire burns'
    a = await p.js('()=>t2d.lab.at(0)'); f0 = await p.js('()=>t2d.lab.OPS[0].f')
    pid = await p.hold(a['x'], a['y'], ms=60); await p.drag(pid, a['x'], a['y'], a['x'] + 60, a['y'], steps=8)
    assert await p.js('()=>t2d.lab.focus') == 0, 'holding a flask — its waveform in the scroll'
    await p.shot('lab-pitch'); await p.up(); await p.pg.wait_for_timeout(100)
    f1 = await p.js('()=>t2d.lab.OPS[0].f')
    assert abs(12 * math.log2(f1 / f0) - 10) < 0.6, f'drag right 60 px — ten semitones up: {f0} -> {f1}'
    l0 = await p.js('()=>t2d.lab.OPS[0].level'); a = await p.js('()=>t2d.lab.at(0)')
    pid = await p.hold(a['x'], a['y'], ms=60); await p.drag(pid, a['x'], a['y'], a['x'], a['y'] - 40, steps=8); await p.up()
    assert await p.js('()=>t2d.lab.OPS[0].level') > l0 + 0.2, 'drag up — more liquid'
    n = await p.js('()=>t2d.lab.at(1)'); t = await p.js('()=>t2d.lab.at(0)')
    pid = await p.hold(n['x'], n['neckY'], ms=60); await p.drag(pid, n['x'], n['neckY'], t['x'], t['y'], steps=12)
    await p.shot('lab-tube'); await p.up(); await p.pg.wait_for_timeout(300)
    assert [1, 0] in await p.js('()=>t2d.lab.mods'), 'neck of aer to ignis — aer modulates ignis'
    await p.pg.wait_for_timeout(400)
    q = await p.js('()=>t2d.lab.tubeAt(1, 0)'); await p.tap(q['x'], q['y']); await p.pg.wait_for_timeout(200)
    assert [1, 0] not in await p.js('()=>t2d.lab.mods'), 'tap on the tube removes it'
    n = await p.js('()=>t2d.lab.at(1)')
    pid = await p.hold(n['x'], n['neckY'], ms=60); await p.drag(pid, n['x'], n['neckY'], n['x'] + 70, n['neckY'] - 40, steps=6)
    await p.drag(pid, n['x'] + 70, n['neckY'] - 40, n['x'], n['y'], steps=6); await p.up(); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.lab.OPS[1].fb') > 0, 'neck back into itself — pelican'
    m0 = await p.js('()=>t2d.lab.mods')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.lab.mods') == [] and not await p.js('()=>t2d.lab.fire'), 'trash — tubes gone, fire out'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.lab.mods') == m0 and await p.js('()=>t2d.lab.fire'), 'undo brings tubes and fire back'
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(1500)
    assert await p.js('()=>t2d.lab.fire && t2d.lab.live'), 'dice keeps a burning fire burning'
    jg = await p.js('()=>t2d.lab.jug()'); await p.tap(jg['x'], jg['y']); await p.pg.wait_for_timeout(1200)
    m1 = await p.js('()=>t2d.lab.mods'); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(300)
    assert not await p.js('()=>t2d.lab.fire'), 'dice does not light the fire'
    await p.tap(fb['x'], fb['y']); await p.pg.wait_for_timeout(1500)
    j = await p.js('()=>t2d.lab.jar(3)'); pid = await p.hold(j['x'], j['y'], ms=400)
    assert any(v['k'] == 3 and v['on'] for v in await p.js('()=>t2d.lab.voices')), 'hold a jar — the apparatus sounds on its note'
    await p.shot('lab-jar'); await p.up(); await p.pg.wait_for_timeout(100)
    assert not any(v['k'] == 3 for v in await p.js('()=>t2d.lab.voices')), 'lift the finger — the jar is quiet'
    j = await p.js('()=>t2d.lab.jar(2)'); await p.pin(j['x'], j['y']); await p.pg.wait_for_timeout(200)
    assert any(v['k'] == 2 and v['latched'] for v in await p.js('()=>t2d.lab.voices')), 'double tap — the jar keeps sounding'
    s0 = await p.js('()=>t2d.lab.jars[4]'); j = await p.js('()=>t2d.lab.jar(4)')
    pid = await p.hold(j['x'], j['y'], ms=60); await p.drag(pid, j['x'], j['y'], j['x'], j['y'] - 30, steps=6); await p.up()
    assert await p.js('()=>t2d.lab.jars[4]') == s0 + 5, 'jar up 30 px — its note five semitones up'
    await p.tap(fb['x'], fb['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.lab.fire'), 'tap the furnace again — it keeps burning (only the jug puts it out)'
    jg = await p.js('()=>t2d.lab.jug()'); await p.tap(jg['x'], jg['y']); await p.pg.wait_for_timeout(700)
    await p.shot('lab-jug'); await p.pg.wait_for_timeout(300)
    assert not await p.js('()=>t2d.lab.fire') and not any(v['latched'] for v in await p.js('()=>t2d.lab.voices')), 'jug — fire out, kept jars quiet'
    await p.js("()=>{t2d.lab.setFx('solve', 0.2); t2d.lab.setFx('coagula', 0)}")
    for k, d in (('solve', 96), ('coagula', 112)):                        # уроборосы у печи: вверх — больше
        q = await p.js(f"()=>t2d.lab.knob('{k}')"); pid = await p.hold(q['x'], q['y'], ms=60)
        await p.drag(pid, q['x'], q['y'], q['x'], q['y'] - d, steps=8)
        if k == 'coagula': await p.shot('lab-knob')
        await p.up(); await p.pg.wait_for_timeout(100)
    v = await p.js('()=>t2d.lab.fx')
    assert abs(v['solve'] - 0.8) < 0.02 and abs(v['coagula'] - 0.7) < 0.02, f'ouroboros knobs set solve and coagula: {v}'
    assert await p.js('()=>t2d.lab.solveOn'), 'coagula up — solve·coagula on'
    await p.shot('lab-solve')
    await p.js("()=>t2d.lab.setFx('coagula', 0)"); await p.pg.wait_for_timeout(100)
    assert not await p.js('()=>t2d.lab.solveOn'), 'coagula at zero — off, no ticking'
    w = await p.js('()=>Array.from(t2d.lab.waveOf(0))'); assert max(w) > 0.9 and min(w) < -0.9, 'flask surface is its waveform'
    await p.shot('lab')


async def sc_natura(p):                           # Natura: лодочка — пуск/темп, кувшинки — посадить/убрать/нота/цветок, мостик — длина, кубик, корзина, отмена
    await p.js('()=>t2d.go(4)'); await p.pg.wait_for_timeout(300)
    b = await p.js('()=>t2d.nat.boat()'); await p.tap(b['x'], b['y']); await p.pg.wait_for_timeout(1600)
    assert await p.js('()=>t2d.nat.seq.playing'), 'tap the boat — the river flows'
    lv = await p.js('()=>T2D.level'); assert lv > 0.01, f'notes are heard: {lv}'
    await p.shot('natura-play')
    b = await p.js('()=>t2d.nat.boat()'); await p.tap(b['x'], b['y']); await p.pg.wait_for_timeout(200)
    assert not await p.js('()=>t2d.nat.seq.playing'), 'tap the boat — it stops'
    t = await p.js('()=>t2d.nat.tree()'); pid = await p.hold(t['x'], t['y'], ms=60)   # тормошим дерево — срез вверх
    for k in range(8):
        await p.drag(pid, t['x'] + (-30 if k % 2 else 30), t['y'], t['x'] + (30 if k % 2 else -30), t['y'], steps=3)
    sh = await p.js('()=>t2d.nat.shake'); await p.shot('natura-shake'); await p.up()
    assert sh > 0.5, f'shaking the tree: {sh}'
    await p.js("()=>t2d.nat.setFx('chorus', 0.8)"); bd = await p.js('()=>t2d.nat.bird()')
    await p.tap(bd['x'], bd['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>performance.now() - t2d.nat.birdsAt') < 1000, 'tap the birds — they scatter (laser)'
    await p.shot('natura-birds')
    await p.js("()=>t2d.nat.setFx('res', 0.95)"); await p.pg.wait_for_timeout(200); await p.shot('natura-res')
    pads0 = await p.js('()=>JSON.stringify(t2d.nat.pads.at)')
    await p.js("()=>{const a=t2d.nat.pads.at; for (let i=0;i<16;i++) a[i]=null; a[5]={note:3,wave:0}; a[6]={note:9,wave:0}}")
    p0 = await p.js('()=>t2d.nat.slot(4, 6)'); p5 = await p.js('()=>t2d.nat.pad(5)'); p6 = await p.js('()=>t2d.nat.pad(6)'); p7 = await p.js('()=>t2d.nat.slot(7, 6)')
    pid = await p.hold(p0['x'], p0['y'], ms=60)
    for a2, b2 in ((p0, p5), (p5, p6), (p6, p7)): await p.drag(pid, a2['x'], a2['y'], b2['x'], b2['y'], steps=5)
    await p.shot('natura-glide-draw'); await p.up(); await p.pg.wait_for_timeout(100)
    g = await p.js('()=>[t2d.nat.pads.at[5].glide, t2d.nat.pads.at[6].glide]')
    assert g == [True, True], f'a stroke on the water through lilies — glide: {g}'
    await p.js(f"()=>{{const v={pads0}; v.forEach((x,i)=>t2d.nat.pads.at[i]=x)}}")
    q = await p.js('()=>t2d.nat.pad(0)'); await p.tap(q['x'], q['y']); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>t2d.nat.pads.at[0]') is None, 'tap a lily — gone'
    q = await p.js('()=>t2d.nat.slot(1, 10)'); await p.tap(q['x'], q['y']); await p.pg.wait_for_timeout(150)
    pd = await p.js('()=>t2d.nat.pads.at[1]'); assert pd and abs(pd['note'] - 10) <= 1, f'tap the water — a lily on that note: {pd}'
    n0 = await p.js('()=>t2d.nat.pads.at[2].note'); q = await p.js('()=>t2d.nat.pad(2)')
    pid = await p.hold(q['x'], q['y'], ms=60); await p.drag(pid, q['x'], q['y'], q['x'] + 40, q['y'], steps=8)
    await p.shot('natura-note'); await p.up(); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.nat.pads.at[2] && t2d.nat.pads.at[2].note') > n0, 'drag a lily across — higher note'
    w0 = await p.js('()=>t2d.nat.pads.at[3].wave'); q = await p.js('()=>t2d.nat.pad(3)')
    await p.hold(q['x'], q['y'], ms=700); await p.up(); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.nat.pads.at[3] && t2d.nat.pads.at[3].wave') == (w0 + 1) % 3, 'hold a lily — next flower'
    l0 = await p.js('()=>t2d.nat.pads.len'); q = await p.js('()=>t2d.nat.bridge()')
    pid = await p.hold(q['x'], q['y'], ms=60); await p.drag(pid, q['x'], q['y'], q['x'], q['y'] - 90, steps=8); await p.up()
    assert await p.js('()=>t2d.nat.pads.len') < l0, 'drag the bridge upstream — shorter loop'
    await p.js('()=>{t2d.nat.pads.len = 16}'); await p.pg.wait_for_timeout(100)   # на 16 запруда видна и тянется обратно
    q = await p.js('()=>t2d.nat.bridge()'); assert 13 < q['x'] < W - 13 and q['y'] < H - 40, f'weir at 16 is on screen: {q}'
    pid = await p.hold(q['x'], q['y'], ms=60); await p.drag(pid, q['x'], q['y'], q['x'] - 60, q['y'] - 60, steps=8); await p.up()
    assert await p.js('()=>t2d.nat.pads.len') < 16, 'from 16 the weir drags back'
    b0 = await p.js('()=>t2d.nat.seq.bpm'); b = await p.js('()=>t2d.nat.boat()')
    pid = await p.hold(b['x'], b['y'], ms=60); await p.drag(pid, b['x'], b['y'], b['x'] + 40, b['y'], steps=6); await p.up()
    assert await p.js('()=>t2d.nat.seq.bpm') == b0 + 20 and not await p.js('()=>t2d.nat.seq.playing'), 'drag the boat — tempo, no start'
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.nat.pads.at.some(Boolean)'), 'dice plants lilies'
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(150)
    assert not await p.js('()=>t2d.nat.pads.at.some(Boolean)'), 'trash clears the river'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>t2d.nat.pads.at.some(Boolean)'), 'undo brings the lilies back'
    assert await p.js('()=>t2d.nat.seq.playing'), 'dice set the river flowing'


SCENARIOS = {'natura': sc_natura, 'lab': sc_lab, 'sketches': sc_sketches, 'handpan': sc_handpan, 'ampoff': sc_ampoff, 'echo': sc_echo, 'scalepinch': sc_scalepinch, 'grid': sc_grid, 'relative': sc_relative, 'entry': sc_entry, 'twist': sc_twist, 'seq': sc_seq, 'orphan': sc_orphan, 'plate': sc_plate, 'hold': sc_hold, 'undo': sc_undo, 'solniger': sc_solniger, 'vol': sc_vol, 'planets': sc_planets, 'ring': sc_ring, 'worlds': sc_worlds, 'sun': sc_sun, 'hole': sc_hole}


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

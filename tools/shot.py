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
    await p.pin(150, 600)                                  # Tenebrae: закреплённая планета
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
    await p.tap(cx, cy); await p.pg.wait_for_timeout(700)                # звук строится — удар ждёт в очереди
    assert await p.js('()=>t2d.cym.ready'), 'worklet ready'
    assert await p.js('()=>Math.max(...t2d.cym.energy)') > 0, 'first strike is heard'
    await p.js('()=>t2d.cym.strike(0, 0)'); await p.pg.wait_for_timeout(150)   # песок уходит в узлы
    s1 = await p.js('()=>t2d.cym.sandSpread()'); await p.pg.wait_for_timeout(1500)
    s2 = await p.js('()=>t2d.cym.sandSpread()'); await p.shot('plate')
    assert s2 < s1, f'sand settles on the nodal lines: {s1} -> {s2}'
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
    assert await p.js('()=>t2d.cym.seq.rhythm.len') == 8, 'drag the end of the rhythm fill'
    ml = await p.js('()=>t2d.cym.seq.melody.len')
    await drag_len(R1, ml - 0.5, 3.5)
    assert await p.js('()=>t2d.cym.seq.melody.len') == 4, 'drag the end of the melody fill'
    b0 = await p.js('()=>t2d.cym.seq.bpm')
    pid = await p.hold(g['playX'], ty, ms=120); await p.drag(pid, g['playX'], ty, g['playX'] + 60, ty, steps=8); await p.up()
    assert await p.js('()=>t2d.cym.seq.bpm') > b0 and await p.js('()=>t2d.cym.seq.playing'), 'drag ▶ sets tempo, keeps playing'
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(600)
    assert await p.js('()=>t2d.cym.seq.rhythm.steps.some(Boolean) && t2d.cym.seq.playing'), 'dice makes a playing pattern'
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


async def sc_twist(p):                             # два пальца крутят кольца (сдвиг узора) и пластину (транспонирование); Shift-мышь
    import math
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)
    await p.js("()=>{const h={x:0.3,y:0,vel:1}; t2d.cym.load({rhythm:{len:16, steps:[h,null,null,null,h]}, melody:{len:7, steps:[12,15]}})}")
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
    await twist(g['R2'], 25, 45)                                           # пальцы на кольце ритма широко — всё равно ритм
    st = await p.js('()=>t2d.cym.seq.rhythm.steps.map(Boolean)')
    assert [i for i, x in enumerate(st) if x] == [2, 6], f'rhythm ring turned by 2: {st}'
    await twist(g['R1'], 25, 45)
    m = await p.js('()=>t2d.cym.seq.melody.steps')
    assert m[2] == 12 and m[3] == 15, f'melody ring turned by 2: {m}'
    await p.js("()=>{const m=t2d.cym.seq.melody.steps; m[5]=13; t2d.cym.load({melody:{len:7, steps:m}})}")   # нота не из лада
    m13 = await p.js('()=>t2d.cym.seq.melody.steps')
    a1, b1 = dict(pt(40, -120), id=85), dict(pt(40, -60), id=86)          # повернул и вернул одним жестом — мелодия прежняя
    await p.T('touchStart', [a1]); await p.T('touchStart', [a1, b1]); await p.pg.wait_for_timeout(30)
    for k in list(range(1, 11)) + list(range(9, -1, -1)):
        a1, b1 = dict(pt(40, -120 + 3 * k), id=85), dict(pt(40, -60 + 3 * k), id=86)
        await p.T('touchMove', [a1, b1]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a1, b1]); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>t2d.cym.seq.melody.steps') == m13, 'twist there and back restores the melody exactly'
    exp = await p.js('()=>t2d.cym.core.transposeMelody(t2d.cym.seq.melody.steps, 2, t2d.cym.core.scaleSemis())')
    await twist(40, 30, 40)
    assert await p.js('()=>t2d.cym.seq.melody.steps') == exp, 'plate twist transposes by 2 scale steps'
    f0, m0 = await p.js('()=>t2d.cym.f0'), await p.js('()=>t2d.cym.seq.melody.steps')
    a, b = {'x': cx - 30, 'y': cy, 'id': 91}, {'x': cx + 30, 'y': cy, 'id': 92}
    await p.T('touchStart', [a]); await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(30)
    for k in range(1, 11):
        a, b = dict(a, x=cx - 30 - 3 * k), dict(b, x=cx + 30 + 3 * k)
        await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a, b]); await p.pg.wait_for_timeout(150)
    m1 = await p.js('()=>t2d.cym.seq.melody.steps'); d = 12 * math.log2(await p.js('()=>t2d.cym.f0') / f0)
    assert d < 0 and all(b2 is None if a2 is None else abs(b2 - a2 - d) < 1e-6 for a2, b2 in zip(m0, m1)), 'pinch sizes the plate and carries the melody along'
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


async def sc_keys(p):                              # клавиши лада: игра, пошаговый ввод с курсором, запись; щипок не пишет; смычок
    import math
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)
    for vw, vh in [(844, 390), (W, H)]:                                    # клавиши на экране в альбоме и портрете
        await p.pg.set_viewport_size({'width': vw, 'height': vh}); await p.pg.wait_for_timeout(300)
        k = await p.js('()=>t2d.cym.keys')
        assert len(k) == 9 and max(q['y'] + q['h'] / 2 for q in k) < vh, f'keys on screen at {vw}x{vh}'
    keys = await p.js('()=>t2d.cym.keys'); f0 = await p.js('()=>t2d.cym.f0')
    await p.tap(keys[0]['x'], keys[0]['y']); await p.pg.wait_for_timeout(500)
    assert await p.js('()=>Math.max(...t2d.cym.energy)') > 0 and await p.js('()=>t2d.cym.f0') == f0, 'key plays, plate size stays'
    g = await p.js('()=>t2d.cym.astro'); a = math.radians(-90 + 3 * 22.5)
    await p.tap(g['cx'] + g['R1'] * math.cos(a), g['cy'] + g['R1'] * math.sin(a)); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.cym.cursor') == 3, 'tap a melody slot — cursor there'
    await p.tap(keys[1]['x'], keys[1]['y']); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.cym.seq.melody.steps[3]') == keys[1]['n'] and await p.js('()=>t2d.cym.cursor') == 4, 'step entry'
    await p.tap(keys[8]['x'], keys[8]['y']); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.cym.seq.melody.steps[4]') is None and await p.js('()=>t2d.cym.cursor') == 5, 'rest key'
    await p.tap(g['playX'], g['ty']); await p.pg.wait_for_timeout(500)    # ▶
    await p.tap(g['recX'], g['ty']); await p.pg.wait_for_timeout(200)    # ●
    n0 = await p.js('()=>t2d.cym.seq.rhythm.steps.filter(Boolean).length')
    await p.tap(keys[2]['x'], keys[2]['y']); await p.pg.wait_for_timeout(200)
    assert keys[2]['n'] in await p.js('()=>t2d.cym.seq.melody.steps'), 'recorded note'
    assert await p.js('()=>t2d.cym.seq.rhythm.steps.filter(Boolean).length') > n0, 'recorded hit'
    assert await p.js('()=>t2d.cym.lastStrike.rec') is True, 'key strike while recording carries rec'
    m0 = await p.js('()=>t2d.cym.seq.melody.steps')
    a1, b1 = {'x': g['cx'] - 20, 'y': g['cy'], 'id': 71}, {'x': g['cx'] + 20, 'y': g['cy'], 'id': 72}
    await p.T('touchStart', [a1]); await p.T('touchStart', [a1, b1]); await p.pg.wait_for_timeout(30)
    for k in range(1, 9):
        a1, b1 = dict(a1, x=g['cx'] - 20 - 6 * k), dict(b1, x=g['cx'] + 20 + 6 * k)
        await p.T('touchMove', [a1, b1]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a1, b1]); await p.pg.wait_for_timeout(150)
    m1 = await p.js('()=>t2d.cym.seq.melody.steps')
    sh = [b2 - a2 for a2, b2 in zip(m0, m1) if a2 is not None]
    assert [x is None for x in m0] == [x is None for x in m1] and max(sh) - min(sh) < 1e-6, 'pinch writes no notes, only shifts the melody'
    await p.tap(g['recX'], g['ty']); await p.tap(g['playX'], g['ty']); await p.pg.wait_for_timeout(200)   # стоп
    await p.pin(g['cx'] + 35, g['cy'] - 20); await p.pg.wait_for_timeout(500)
    await p.shot('keys')


async def sc_relative(p):                          # щипок транспонирует всю мелодию; кольца крутятся с запасом и видно
    import math
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(300)
    await p.js("()=>{const h={x:0.3,y:0,vel:1}; t2d.cym.load({rhythm:{len:16, steps:[h,null,null,null,h]}, melody:{len:7, steps:[12,15]}})}")
    g = await p.js('()=>t2d.cym.astro'); cx, cy = g['cx'], g['cy']
    f0 = await p.js('()=>t2d.cym.f0')
    a, b = {'x': cx - 30, 'y': cy, 'id': 41}, {'x': cx + 30, 'y': cy, 'id': 42}
    await p.T('touchStart', [a]); await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(30)
    for k in range(1, 11):
        a, b = dict(a, x=cx - 30 - 3 * k), dict(b, x=cx + 30 + 3 * k)
        await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a, b]); await p.pg.wait_for_timeout(150)
    f1 = await p.js('()=>t2d.cym.f0'); d = 12 * math.log2(f1 / f0)
    m = await p.js('()=>t2d.cym.seq.melody.steps')
    assert d < -0.5 and abs(m[0] - (12 + d)) < 1e-6 and abs(m[1] - (15 + d)) < 1e-6, f'pinch transposes the melody by {d}: {m[:2]}'
    pt = lambda R, deg, i: {'x': cx + R * math.cos(math.radians(deg)), 'y': cy + R * math.sin(math.radians(deg)), 'id': i}
    R = g['R2'] + 22                                                       # мимо линии кольца ритма — всё равно ритм
    a, b = pt(R, -115, 43), pt(R, -65, 44)
    await p.T('touchStart', [a]); await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(30)
    for k in range(1, 11):
        a, b = pt(R, -115 + 3 * k, 43), pt(R, -65 + 3 * k, 44)
        await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
    turn = await p.js('()=>t2d.cym.ringTurn.rhythm')
    assert abs(turn - 7.5) < 3, f'the ring visibly turns with the fingers: {turn}'
    for k in range(11, 16):
        a, b = pt(R, -115 + 3 * k, 43), pt(R, -65 + 3 * k, 44)
        await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a, b]); await p.pg.wait_for_timeout(150)
    st = await p.js('()=>t2d.cym.seq.rhythm.steps.map(Boolean)')
    assert [i for i, x in enumerate(st) if x] == [2, 6], f'rhythm ring turned by 2: {st}'
    assert await p.js('()=>t2d.cym.ringTurn.rhythm') == 0, 'snaps to a slot on release'
    R = (await p.js('()=>t2d.cym.geo'))['rMax'] + 4                       # между столом и кольцом мелодии — мелодия
    m0 = await p.js('()=>t2d.cym.seq.melody.steps')
    a, b = pt(R, -115, 45), pt(R, -65, 46)
    await p.T('touchStart', [a]); await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(30)
    for k in range(1, 16):
        a, b = pt(R, -115 + 3 * k, 45), pt(R, -65 + 3 * k, 46)
        await p.T('touchMove', [a, b]); await p.pg.wait_for_timeout(16)
    await p.T('touchEnd', [a, b]); await p.pg.wait_for_timeout(150)
    m1 = await p.js('()=>t2d.cym.seq.melody.steps')
    assert m1[2] == m0[0] and m1[3] == m0[1], f'melody ring turned by 2: {m1}'


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
    await p.js("()=>t2d.cym.load({bpm: 40, fx: {time: 1}})"); e = await p.js('()=>t2d.cym.echo')
    assert abs(e['sec'] - 2.25) < 1e-3 and await p.js('()=>t2d.cym.echoMax') > 2.2, f'slow dotted quarter fits the delay line: {e}'


SCENARIOS = {'echo': sc_echo, 'scalepinch': sc_scalepinch, 'grid': sc_grid, 'relative': sc_relative, 'keys': sc_keys, 'twist': sc_twist, 'seq': sc_seq, 'orphan': sc_orphan, 'plate': sc_plate, 'hold': sc_hold, 'undo': sc_undo, 'solniger': sc_solniger, 'vol': sc_vol, 'planets': sc_planets, 'ring': sc_ring, 'worlds': sc_worlds, 'sun': sc_sun, 'hole': sc_hole}


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

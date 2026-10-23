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


async def sc_ring(p):                              # долгое касание планеты — плашка снизу: строки, «~» — LFO, двойной тап — по умолчанию
    await p.pin(200, 300)
    await p.hold(200, 300, ms=600); await p.up(); await p.pg.wait_for_timeout(200)
    e = await p.js("()=>t2d.editor&&{sheet:!!t2d.editor.sheet}"); assert e and e['sheet'], f'hold a planet — its sheet: {e}'
    s = await p.js('()=>t2d.sheetGeo()'); row = lambda k: next(r for r in s['rows'] if r['k'] == k)
    c0 = await p.js('()=>t2d.voices.find(v=>v.pinned).cut'); r = row('cut'); y = r['y'] + r['h'] / 2
    pid = await p.hold(s['tx0'] + 40, y, ms=60); await p.drag(pid, s['tx0'] + 40, y, s['tx0'] + 140, y, steps=8); await p.up(); await p.pg.wait_for_timeout(100)
    c1 = await p.js('()=>t2d.voices.find(v=>v.pinned).cut'); assert c1 > c0 + 0.2, f'drag the cutoff row right — brighter: {c0} -> {c1}'
    await p.tap(s['lfoX'], y); await p.pg.wait_for_timeout(200)       # «~» у cutoff — LFO и его панель
    st = await p.js("()=>({lfo:t2d.editor.lfo, key:t2d.editor.key, has:Object.keys(t2d.voices.find(v=>v.pinned).lfo)})")
    assert st['lfo'] and st['key'] == 'cut' and 'cut' in st['has'], f'tap ~ — LFO on cutoff: {st}'
    await p.pg.wait_for_timeout(300); await p.shot('ring')
    s = await p.js('()=>t2d.sheetGeo()'); r = row('res'); y = r['y'] + r['h'] / 2
    pid = await p.hold(s['tx0'] + 40, y, ms=60); await p.drag(pid, s['tx0'] + 40, y, s['tx0'] + 160, y, steps=6); await p.up(); await p.pg.wait_for_timeout(100)
    await p.tap(s['tx0'] + 60, y); await p.pg.wait_for_timeout(80); await p.tap(s['tx0'] + 60, y); await p.pg.wait_for_timeout(100)
    assert abs(await p.js('()=>t2d.voices.find(v=>v.pinned).res') - 0.21) < 1e-6, 'double tap a row — back to default'
    await p.tap(200, s['top'] - 60); await p.pg.wait_for_timeout(100)
    assert not await p.js('()=>t2d.editor'), 'tap above the sheet — closed'
    print('ring:', st)


async def sc_ampoff(p):                            # строка amp в плашке: левый край — off: планета молчит, но модулирует
    await p.pin(200, 300)
    await p.hold(200, 300, ms=600); await p.up(); await p.pg.wait_for_timeout(200)
    s = await p.js('()=>t2d.sheetGeo()'); r = next(q for q in s['rows'] if q['k'] == 'amp'); y = r['y'] + r['h'] / 2
    pid = await p.hold(s['tx1'] - 10, y, ms=60); await p.drag(pid, s['tx1'] - 10, y, s['tx1'] - 10 - 3 * (s['tx1'] - s['tx0']), y, steps=10); await p.up(); await p.pg.wait_for_timeout(100)
    amp = await p.js('()=>t2d.voices.find(v=>v.pinned).amp')
    await p.shot('ampoff')
    assert amp == 0, f'amp row all the way left is off: {amp}'
    pid = await p.hold(s['tx0'] + 10, y, ms=60); await p.drag(pid, s['tx0'] + 10, y, s['tx0'] + 10 + 0.3 * (s['tx1'] - s['tx0']), y, steps=6); await p.up(); await p.pg.wait_for_timeout(100)
    amp = await p.js('()=>t2d.voices.find(v=>v.pinned).amp')
    assert 0.03 <= amp < 0.5, f'a bit to the right it plays again, quietly: {amp}'


async def sc_worlds(p):                            # карта, Cymatica в четверти II, эскиз Laboratorium в III
    await p.pin(150, 600)                                  # Tenebrae: закреплённая планета
    a, b = {'x': 200, 'y': 450, 'id': 1}, {'x': 10, 'y': H - 8, 'id': 2}
    await p.T('touchStart', [a]); await p.pg.wait_for_timeout(60)        # палец держит новую планету...
    await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(60)     # ...второй — солнце: карта
    await p.T('touchEnd', [b]); await p.pg.wait_for_timeout(800)         # touchEnd перечисляет отпускаемые точки: солнце
    assert await p.js('()=>t2d.view') == 'map', 'sun -> map'
    await p.T('touchEnd', [a]); await p.pg.wait_for_timeout(200)         # палец с планеты отпущен уже на карте — без ошибок
    assert await p.js('()=>t2d.hidden.includes(3) ? !t2d.worlds[3] : !!t2d.worlds[3]'), 'III is switched off — not on the map'
    q = await p.js('()=>t2d.mapPanel(2)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(800)   # четверть II — Cymatica
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
    r = await p.js("()=>t2d.btnPos('rev')"); await p.tap(r['x'], r['y']); await p.pg.wait_for_timeout(100)   # FX — плашка; ещё раз — закрыта
    assert await p.js('()=>t2d.fxSheet'), 'FX opens the sheet'
    await p.tap(r['x'], r['y']); await p.pg.wait_for_timeout(100)
    await p.pg.set_viewport_size({'width': 430, 'height': 900}); await p.pg.wait_for_timeout(300)
    await p.pg.set_viewport_size({'width': W, 'height': H}); await p.pg.wait_for_timeout(300)
    await p.tap(W - 10, H - 8); await p.pg.wait_for_timeout(800)          # резонатор — карта
    assert await p.js('()=>t2d.view') == 'map', 'resonator -> map'
    await p.pg.set_viewport_size({'width': 430, 'height': 900}); await p.pg.wait_for_timeout(300)
    await p.pg.set_viewport_size({'width': W, 'height': H}); await p.pg.wait_for_timeout(300)
    await p.shot('map')
    q = await p.js('()=>t2d.mapPanel(1)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(800)   # карта I
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


async def sc_audiopanel(p):                         # тап по громкости — панель audio: tempo, stop, restart, stable; тянуть громкость — как было
    await p.js('()=>t2d.go(13)'); await p.pg.wait_for_timeout(300)
    b = await p.js("()=>t2d.btnPos('vol')")
    v0 = await p.js('()=>t2d.vol')
    await p.tap(b['x'], b['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.audioPanel'), 'tap the volume — the audio panel'
    assert abs(await p.js('()=>t2d.vol') - v0) < 1e-6, 'a tap does not change the volume'
    P = await p.js('()=>t2d.panelGeo()'); row = {r['k']: r['y'] for r in P['rows']}; cx = P['x'] + P['w'] / 2
    bpm0 = await p.js('()=>t2d.worlds[13].tempo.get()')
    pid = await p.hold(cx, row['tempo'], ms=60); await p.drag(pid, cx, row['tempo'], cx + 40, row['tempo'], steps=6)
    await p.shot('audiopanel'); await p.up(); await p.pg.wait_for_timeout(100)
    bpm1 = await p.js('()=>t2d.worlds[13].tempo.get()'); print('  portus tempo:', bpm0, '->', bpm1)
    assert bpm1 == min(180, bpm0 + 20), f'drag tempo sideways: {bpm0} -> {bpm1}'
    on0 = await p.js('()=>t2d.worlds[13].tempo.playing()')
    await p.tap(cx, row['stop']); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>t2d.worlds[13].tempo.playing()') != on0, 'stop / play toggles the clock'
    await p.tap(cx, row['stop']); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>t2d.worlds[13].tempo.playing()') == on0
    await p.js('()=>{ t2d.link.clock = true }')          # общий темп: у всех миров
    pid = await p.hold(cx, row['tempo'], ms=60); await p.drag(pid, cx, row['tempo'], cx - 40, row['tempo'], steps=6); await p.up(); await p.pg.wait_for_timeout(100)
    b13, b4 = await p.js('()=>[t2d.worlds[13].tempo.get(), t2d.worlds[4].tempo.get()]')
    assert b13 == b4, f'shared tempo — every world: {b13} {b4}'
    await p.js('()=>{ t2d.link.clock = false }')
    await p.tap(30, 500); await p.pg.wait_for_timeout(150)
    assert not await p.js('()=>t2d.audioPanel'), 'tap outside — the panel closes'
    pid = await p.hold(b['x'], b['y'], ms=60); await p.drag(pid, b['x'], b['y'], b['x'], b['y'] + 60, steps=8); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>t2d.vol') < v0 - 0.05 and not await p.js('()=>t2d.audioPanel'), 'drag the volume — the volume, no panel'
    await p.js('()=>t2d.go(10)'); await p.pg.wait_for_timeout(300)   # мир без часов: stop — заглушить, отмена вернёт
    a = await p.js('()=>t2d.firm.at(0.6, 0.2)'); await p.tap(a['x'], a['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.firm.stars.length') == 1
    await p.tap(b['x'], b['y']); await p.pg.wait_for_timeout(200)
    await p.shot('audiopanel-firm')
    await p.tap(cx, row['stop']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.firm.stars.length') == 0, 'stop without a clock — the world goes silent'
    await p.tap(30, 500); await p.pg.wait_for_timeout(150)
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.firm.stars.length') == 1, 'undo brings the world back'


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
    q = await p.js('()=>t2d.mapPanel(2)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(800)              # Cymatica
    s = await p.js("()=>t2d.btnPos('scl')"); await p.tap(s['x'], s['y']); await p.pg.wait_for_timeout(300)   # тап — лад вкл/выкл
    on = await p.js('()=>t2d.scl.on')
    assert await p.js('()=>t2d.hist(2)') == 1, 'scale change is a Cymatica undo step'
    await p.tap(W - 10, H - 8); await p.pg.wait_for_timeout(800)
    q = await p.js('()=>t2d.mapPanel(1)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(800)              # обратно в Tenebrae
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
    await p.tap(rv['x'], rv['y']); await p.pg.wait_for_timeout(100)
    fg = await p.js('()=>t2d.fxGeo()'); r = next(q for q in fg['rows'] if q['k'] == 'structure'); y = r['y'] + r['h'] / 2
    pid = await p.hold(fg['tx0'] + 60, y, ms=60); await p.drag(pid, fg['tx0'] + 60, y, fg['tx0'] + 160, y, steps=8); await p.up()
    assert await p.js('()=>t2d.cym.fx.structure') != s0, 'FX sheet row moves structure'
    await p.tap(rv['x'], rv['y']); await p.pg.wait_for_timeout(100)
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
    rv = await p.js("()=>t2d.btnPos('rev')"); await p.tap(rv['x'], rv['y']); await p.pg.wait_for_timeout(150)   # FX — плашка: строка time вправо до конца
    assert await p.js('()=>t2d.fxSheet'), 'FX opens the sheet'
    fg = await p.js('()=>t2d.fxGeo()'); r = next(q for q in fg['rows'] if q['k'] == 'time'); y = r['y'] + r['h'] / 2
    pid = await p.hold(fg['tx0'] + 10, y, ms=60); await p.drag(pid, fg['tx0'] + 10, y, fg['tx0'] + 10 + 2 * (fg['tx1'] - fg['tx0']), y, steps=10)
    e = await p.js('()=>t2d.cym.echo'); await p.shot('echo'); await p.up()
    await p.tap(200, fg['top'] - 80); await p.pg.wait_for_timeout(100)
    assert not await p.js('()=>t2d.fxSheet'), 'tap outside — FX sheet closed'
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
    await p.js('()=>t2d.go(4)'); await p.pg.wait_for_timeout(900); await p.shot('natura')
    await p.js("()=>Object.assign(t2d.nat.fx,{reverb:1,delay:1,time:1,chorus:1,cutoff:1,env:0.9})"); await p.pg.wait_for_timeout(500); await p.shot('natura-fx')
    await p.js("()=>Object.assign(t2d.nat.fx,{reverb:0,delay:0,time:0,chorus:0,cutoff:0})"); await p.pg.wait_for_timeout(500); await p.shot('natura-clear')
    await p.tap(30, H - 30); await p.pg.wait_for_timeout(300)            # надгробие — пока ни к чему не ведёт
    assert await p.js('()=>t2d.view') == 'play', 'Natura tombstone does nothing yet'
    s = await p.js('()=>t2d.nat.geo().sun'); await p.tap(s['x'] + 25, s['y'] + 25); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'Natura sun -> map'
    await p.shot('map-sketches')


async def sc_lab(p):                              # Laboratorium: огонь — дрон, колба вбок — высота, вверх — уровень, трубки, пеликан, корзина, отмена, кубик
    if 3 in await p.js('()=>t2d.hidden'): print('  switched off — skipped'); return
    await p.js('()=>t2d.go(3)'); await p.pg.wait_for_timeout(300)
    fb = await p.js('()=>t2d.lab.furnace()'); await p.tap(fb['x'], fb['y']); await p.pg.wait_for_timeout(1800)
    assert await p.js('()=>t2d.lab.fire && t2d.lab.live'), 'tap the furnace — fire, drone'
    lv = await p.js('()=>T2D.level'); assert lv > 0.02, f'drone is heard: {lv}'
    assert await p.js('()=>t2d.sounding()'), 'sounding while the fire burns'
    a = await p.js('()=>t2d.lab.at(2)'); await p.pin(a['x'], a['y']); await p.pg.wait_for_timeout(1700)   # двойной тап по колбе — разбить
    assert await p.js('()=>t2d.lab.broken[2]'), 'double tap a flask — it breaks'
    await p.shot('lab-broken')
    await p.pin(a['x'], a['y']); await p.pg.wait_for_timeout(200)
    assert not await p.js('()=>t2d.lab.broken[2]'), 'double tap again — mended'
    a = await p.js('()=>t2d.lab.at(0)'); f0 = await p.js('()=>t2d.lab.OPS[0].f')   # держишь колбу — плашка: высота, уровень, пеликан
    await p.hold(a['x'], a['y'], ms=700); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold a flask — its sheet'
    fg = await p.js('()=>t2d.fxGeo()'); r = next(q for q in fg['rows'] if q['k'] == 'pitch'); y = r['y'] + r['h'] / 2
    pid = await p.hold(fg['tx0'] + 40, y, ms=60); await p.drag(pid, fg['tx0'] + 40, y, fg['tx0'] + 100, y, steps=6); await p.shot('lab-flask-sheet'); await p.up()
    assert await p.js('()=>t2d.lab.OPS[0].f') > f0 * 1.3, 'flask sheet: pitch row up'
    await p.tap(200, fg['top'] - 60); await p.pg.wait_for_timeout(100)
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
    await p.tap(fb['x'], fb['y']); await p.pg.wait_for_timeout(1200)                      # ещё тап по лампе — погасить
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
    e = await p.js('()=>t2d.lab.geo().egg'); await p.tap(e['x'], e['y']); await p.pg.wait_for_timeout(700)   # тап по яйцу — тоже огонь: погасить
    await p.shot('lab-jug'); await p.pg.wait_for_timeout(300)
    assert not await p.js('()=>t2d.lab.fire') and not any(v['latched'] for v in await p.js('()=>t2d.lab.voices')), 'tap the egg while burning — fire out, kept jars quiet'
    await p.js("()=>{t2d.lab.setFx('solve', 0.2); t2d.lab.setFx('coagula', 0)}")
    for k, v in (('solve', 0.8), ('coagula', 0.7)):                       # дуги на кольце: палец идёт по окружности
        q = await p.js(f"()=>t2d.lab.arcPt('{k}', 0.1)"); pid = await p.hold(q['x'], q['y'], ms=60)
        for j in range(1, 9):
            r = await p.js(f"()=>t2d.lab.arcPt('{k}', {0.1 + (v - 0.1) * j / 8})"); await p.drag(pid, q['x'], q['y'], r['x'], r['y'], steps=1); q = r
        if k == 'coagula': await p.shot('lab-knob')
        await p.up(); await p.pg.wait_for_timeout(100)
    v = await p.js('()=>t2d.lab.fx')
    assert abs(v['solve'] - 0.8) < 0.02 and abs(v['coagula'] - 0.7) < 0.02, f'vials set solve and coagula: {v}'
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
    await p.js("()=>{t2d.nat.setFx('chorus', 1); t2d.nat.setFx('rel', 1); t2d.nat.setFx('reverb', 0.8)}"); await p.pg.wait_for_timeout(700); await p.shot('natura-candies')
    s0 = await p.js('()=>t2d.nat.sun().y'); await p.js('()=>{t2d.nat.seq.bpm = 45}'); s1 = await p.js('()=>t2d.nat.sun().y'); await p.js('()=>{t2d.nat.seq.bpm = 96}')
    assert s1 > s0 + 40, f'slow tempo — the sun sinks: {s0} → {s1}'
    b = await p.js('()=>t2d.nat.boat()'); await p.tap(b['x'], b['y']); await p.pg.wait_for_timeout(200)
    assert not await p.js('()=>t2d.nat.seq.playing'), 'tap the boat — it stops'
    await p.pg.wait_for_timeout(500); fr = await p.js('()=>t2d.nat.frog()'); assert fr, 'a frog sits on a lily'
    await p.tap(fr['x'], fr['y']); await p.pg.wait_for_timeout(120)
    assert await p.js('()=>performance.now() - t2d.nat.frog().croak') < 600, f'tap the frog — it croaks {fr}'
    i0 = fr['i']; pd0 = await p.js(f'()=>t2d.nat.pads.at[{i0}].note'); pid = await p.hold(fr['x'], fr['y'], ms=60)   # потянул лягушку — едет её кувшинка
    await p.drag(pid, fr['x'], fr['y'], fr['x'] + 40, fr['y'], steps=8); await p.up(); await p.pg.wait_for_timeout(100)
    assert await p.js(f'()=>t2d.nat.pads.at[{i0}] && t2d.nat.pads.at[{i0}].note') != pd0, 'drag on the frog moves its lily'
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
    k0 = await p.js('()=>t2d.nat.skiff()'); w1 = await p.js('()=>t2d.nat.slot(8, 3)'); w2 = await p.js('()=>t2d.nat.slot(9, 12)')
    pid = await p.hold(k0['x'], k0['y'], ms=60)                           # запасной кораблик: на воду — играет
    await p.drag(pid, k0['x'], k0['y'], w1['x'], w1['y'], steps=10); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.nat.skiff().playing'), 'skiff on the water sounds'
    await p.drag(pid, w1['x'], w1['y'], w2['x'], w2['y'], steps=10); await p.pg.wait_for_timeout(150)
    await p.shot('natura-skiff'); await p.up(); await p.pg.wait_for_timeout(1300)
    sk = await p.js('()=>t2d.nat.skiff()'); assert not sk['playing'] and sk['home'], f'released — quiet, back on the bank: {sk}'
    k0 = await p.js('()=>t2d.nat.skiff()'); pd = await p.js('()=>t2d.nat.pond()')   # кинуть кораблик в уток — улетают, огибающая открыта
    pid = await p.hold(k0['x'], k0['y'], ms=60)
    for i in range(1, 4):
        await p.T('touchMove', [{'x': k0['x'] + (pd['x'] - k0['x']) * 0.15 * i, 'y': k0['y'] + (pd['y'] - k0['y']) * 0.15 * i, 'id': pid}]); await p.pg.wait_for_timeout(16)
    await p.up(); await p.pg.wait_for_timeout(1100); await p.shot('natura-ducks-away')
    assert await p.js('()=>t2d.nat.ducksGone && t2d.nat.envOpen'), 'skiff thrown at the ducks — they fly off, envelope open'
    await p.pg.wait_for_timeout(3600)
    assert not await p.js('()=>t2d.nat.ducksGone'), 'ducks come back'
    for kind, key, dx, dy in (('cloud()', 'cutoff', 0, -60), ("duck('A')", 'att', 0, -50), ("duck('R')", 'rel', 0, -50)):   # туча вверх — ярче; утки вверх — длиннее attack / release
        await p.js(f"()=>t2d.nat.setFx('{key}', 0.3)"); q = await p.js(f'()=>t2d.nat.{kind}')
        pid = await p.hold(q['x'], q['y'], ms=60); await p.drag(pid, q['x'], q['y'], q['x'] + dx, q['y'] + dy, steps=8)
        await p.shot(f'natura-{key}'); await p.up()
        assert await p.js(f'()=>t2d.nat.fx.{key}') > 0.4, f'{kind} drag moves {key}'
    await p.js("()=>t2d.nat.setFx('res', 0.2)"); g = await p.js('()=>t2d.nat.geo()')
    pid = await p.hold(60, g['hor'] - 20, ms=60); await p.drag(pid, 60, g['hor'] - 20, 60, g['hor'] - 80, steps=8); await p.shot('natura-mountains'); await p.up()
    assert await p.js('()=>t2d.nat.fx.res') > 0.4, 'mountains up — more resonance'
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
    await p.js("()=>{t2d.nat.pads.at[3].wave = 0; t2d.nat.setFx('cutoff', 0.4)}")
    q = await p.js('()=>t2d.nat.pad(3)'); await p.hold(q['x'], q['y'], ms=700); await p.up(); await p.pg.wait_for_timeout(150)   # держишь кувшинку — плашка снизу
    assert await p.js('()=>T2D.sheetOpen'), 'hold a lily — its sheet'
    fg = await p.js('()=>t2d.fxGeo()'); row = lambda k: next(q for q in fg['rows'] if q['k'] == k); tw = fg['tx1'] - fg['tx0']
    r = row('form'); y = r['y'] + r['h'] / 2
    pid = await p.hold(fg['tx0'] + 10, y, ms=60); await p.drag(pid, fg['tx0'] + 10, y, fg['tx0'] + 10 + 0.75 * tw, y, steps=8); await p.up(); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.nat.pads.at[3].wave') == 3, 'lily sheet: wave row — saw'
    r = row('cutoff'); y = r['y'] + r['h'] / 2
    pid = await p.hold(fg['tx0'] + 40, y, ms=60); await p.drag(pid, fg['tx0'] + 40, y, fg['tx0'] + 40 + 0.4 * tw, y, steps=8); await p.shot('natura-ring-pinned'); await p.up(); await p.pg.wait_for_timeout(100)
    st = await p.js('()=>[t2d.nat.pads.at[3].lock, t2d.nat.fx.cutoff]')
    assert st[0] and st[0]['cutoff'] > 0.7 and abs(st[1] - 0.4) < 1e-6, f'lily sheet: own cutoff, landscape untouched: {st}'
    await p.tap(fg['tx0'] + 60, y); await p.pg.wait_for_timeout(80); await p.tap(fg['tx0'] + 60, y); await p.pg.wait_for_timeout(100)
    assert not await p.js('()=>t2d.nat.pads.at[3].lock'), 'double tap a row — back to general'
    await p.tap(200, fg['top'] - 60); await p.pg.wait_for_timeout(100)
    assert not await p.js('()=>T2D.sheetOpen'), 'tap outside — sheet closed'
    k0 = await p.js('()=>t2d.nat.skiff()'); await p.hold(k0['x'], k0['y'], ms=700); await p.up(); await p.pg.wait_for_timeout(100)   # кораблик на берегу — тоже меню
    m = await p.js('()=>t2d.nat.menu()'); assert m, 'hold the skiff — wave menu'
    o = m['opts'][3]; await p.tap(o['x'], o['y']); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.nat.skiff().home'), 'skiff stays on the bank'
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


async def sc_cymx(p):                              # Cymatica: запись по шагам, шанс удара, луна качает пластину, созвездия, резонатор отзывается
    import math
    await p.js('()=>t2d.go(2)'); await p.pg.wait_for_timeout(600)
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(200)
    g = await p.js('()=>t2d.cym.astro'); cx, cy, R2, ty = g['cx'], g['cy'], g['R2'], g['ty']
    await p.tap(g['recX'], ty); await p.pg.wait_for_timeout(150)           # часы стоят — ● включает запись по шагам
    assert await p.js('()=>t2d.cym.stepRec') == {'r': 0, 'm': 0}, 'rec while stopped — step recording'
    for dx, dy in [(-40, 0), (30, -30)]:
        await p.tap(cx + dx, cy + dy); await p.pg.wait_for_timeout(150)
    await p.tap(cx + 40, cy - R2 - 30); await p.pg.wait_for_timeout(150)  # мимо стола и колец — пауза
    await p.tap(cx, cy + 40); await p.pg.wait_for_timeout(150)
    sq = await p.js('()=>t2d.cym.seq'); r = [bool(x) for x in sq['rhythm']['steps'][:4]]
    assert r == [True, True, False, True], f'step recording: hit, hit, rest, hit: {r}'
    assert await p.js('()=>t2d.cym.stepRec.r') == 4, 'cursor moved on'
    await p.shot('cym-steprec')
    await p.tap(g['recX'], ty); await p.pg.wait_for_timeout(100)
    assert not await p.js('()=>t2d.cym.stepRec'), 'tap ● again — step recording off'
    x, y = cx + R2 * math.cos(-math.pi / 2), cy + R2 * math.sin(-math.pi / 2)   # удар шага 0 к центру — шанс меньше
    pid = await p.hold(x, y, ms=60); await p.drag(pid, x, y, x, y + 35, steps=8); await p.shot('cym-chance'); await p.up(); await p.pg.wait_for_timeout(100)
    ch = await p.js('()=>t2d.cym.seq.rhythm.steps[0].chance'); assert ch is not None and ch < 0.6, f'drag a hit toward the center — lower chance: {ch}'
    assert await p.js('()=>t2d.cym.sentSeq.rhythm.steps[0].chance') == ch, 'chance goes to the worklet'
    await p.tap(g['driftX'], ty); await p.pg.wait_for_timeout(100)          # луна — качает пластину
    assert await p.js('()=>t2d.cym.drift.on'), 'tap the moon — drift on'
    await p.js('()=>{const s=t2d.cym.seq; t2d.cym.play(true)}'); await p.pg.wait_for_timeout(3500)
    assert await p.js('()=>t2d.cym.stars') > 1, 'played places draw a constellation'
    await p.shot('cym-drift')
    pid = await p.hold(g['driftX'], ty, ms=700)                             # держишь луну — плашка снизу
    await p.up(); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>T2D.sheetOpen'), 'hold the moon — its sheet'
    fg = await p.js('()=>t2d.fxGeo()'); r = next(q for q in fg['rows'] if q['k'] == 'depth'); y = r['y'] + r['h'] / 2
    d0 = await p.js('()=>t2d.cym.drift.depth')
    pid = await p.hold(fg['tx0'] + 20, y, ms=60); await p.drag(pid, fg['tx0'] + 20, y, fg['tx0'] + 120, y, steps=6); await p.shot('cym-luna'); await p.up()
    assert await p.js('()=>t2d.cym.drift.depth') > d0 + 0.2, 'luna sheet: depth row'
    await p.tap(200, fg['top'] - 80); await p.pg.wait_for_timeout(100)
    assert not await p.js('()=>T2D.sheetOpen'), 'tap outside — closed'
    await p.js('()=>t2d.cym.play(false)')
    await p.tap(g['driftX'], ty); await p.pg.wait_for_timeout(100)
    assert not await p.js('()=>t2d.cym.drift.on') and abs(await p.js('()=>t2d.cym.effF0') - await p.js('()=>t2d.cym.f0')) < 0.01, 'moon off — plate back to its size'


async def sc_startmap(p):                          # карта — стартовая; солнце — concordia: общие часы и лад
    assert await p.js('()=>t2d.view') == 'map', 'the app opens on the map'
    await p.shot('startmap')
    q = await p.js('()=>t2d.mapCell(1, 2)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.view') == 'map' and await p.js('()=>t2d.mapPeek()'), 'a face-down card only shivers — nondum'
    await p.shot('map-peek'); await p.pg.wait_for_timeout(300)
    for w in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11):
        q = await p.js(f'()=>t2d.mapPanel({w})'); assert q[0] >= 0 and q[0] + q[2] <= W and q[1] > 0 and q[1] + q[3] < H, f'card {w} on screen {q}'
    sun = await p.js('()=>t2d.mapSun()'); await p.tap(sun['x'], sun['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.nav.settings'), 'tap the sun on the map — concordia'
    c0 = await p.js('()=>t2d.link.clock')
    await p.tap(sun['x'], sun['y'] + 30 + 46); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.link.clock') != c0, 'tap a row — toggled'
    await p.shot('concordia')
    if not await p.js('()=>t2d.link.clock'): await p.tap(sun['x'], sun['y'] + 30 + 46); await p.pg.wait_for_timeout(100)
    await p.tap(20, sun['y'] - 40); await p.pg.wait_for_timeout(100)
    assert not await p.js('()=>t2d.nav.settings'), 'tap outside — closed'
    q = await p.js('()=>t2d.mapPanel(2)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)   # II — Cymatica
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 2], 'quadrant II opens Cymatica'
    g = await p.js('()=>t2d.cym.astro')
    pid = await p.hold(g['playX'], g['ty'], ms=60); await p.drag(pid, g['playX'], g['ty'], g['playX'] + 60, g['ty'], steps=8); await p.up(); await p.pg.wait_for_timeout(100)
    b2 = await p.js('()=>t2d.cym.seq.bpm'); assert b2 > 110, f'tempo up in Cymatica: {b2}'
    assert await p.js('()=>t2d.nat.seq.bpm') == b2, 'shared clock — Natura follows the tempo'
    await p.tap(g['playX'], g['ty']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.cym.seq.playing && !t2d.nat.seq.playing'), 'shared tempo only — play in Cymatica does not start Natura'
    await p.tap(g['playX'], g['ty']); await p.pg.wait_for_timeout(200)
    await p.js('()=>{t2d.link.clock = false}')


async def sc_legenda(p):                           # тап по заголовку мира — легенда жестов; любое касание — закрыть
    for w in (1, 2, 4):
        await p.js(f'()=>t2d.go({w})'); await p.pg.wait_for_timeout(900)
        tw = await p.js('()=>t2d.titleW()')
        await p.tap(46 + tw / 2, await p.js('()=>t2d.scopeY()') + 20); await p.pg.wait_for_timeout(150)
        L = await p.js('()=>t2d.legenda()')
        assert L and len(L['rows']) >= 8, f'world {w}: tap the title — legenda'
        assert L['top'] + L['h'] < H, f'world {w}: legenda fits the screen {L}'
        await p.shot(f'legenda-{w}')
        await p.tap(W / 2, H / 2); await p.pg.wait_for_timeout(100)
        assert not await p.js('()=>t2d.legenda()'), f'world {w}: tap anywhere — legenda closed'
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    sun = await p.js('()=>t2d.mapSun()'); await p.tap(sun['lx'], sun['ly']); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>t2d.nav.settings'), 'tap the concordia label — settings'


async def sc_inferno(p):                           # Inferno: удар, тление, высота вдоль круга, грешник, арфа, плашка круга, FX, кубик, корзина, отмена, тьма — карта
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    await p.shot('map-rows')
    q = await p.js('()=>t2d.mapPanel(5)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 5], 'map quadrant above Tenebrae opens Inferno'
    a = await p.js('()=>t2d.inf.at(4)'); await p.tap(a['x'], a['y']); await p.pg.wait_for_timeout(120)
    assert await p.js('()=>t2d.inf.live && t2d.inf.circ[4].lvl > 0.3'), 'tap a circle — a strike rings'
    a = await p.js('()=>t2d.inf.at(2, 0.3)'); pid = await p.hold(a['x'], a['y'], ms=400)
    assert await p.js('()=>t2d.inf.circ[2].held') == 1, 'hold a circle — it smoulders'
    await p.pg.wait_for_timeout(500); lv = await p.js('()=>T2D.level'); assert lv > 0.005, f'smouldering is heard: {lv}'
    b = await p.js('()=>t2d.inf.at(2, 0.8)'); await p.drag(pid, a['x'], a['y'], b['x'], a['y'], steps=8)
    assert await p.js('()=>t2d.inf.circ[2].pos') > 0.7, 'drag along the circle — pitch'
    await p.shot('inferno-held'); await p.up(); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.inf.circ[2].held') == 0, 'finger up — stops smouldering'
    a = await p.js('()=>t2d.inf.at(6, 0.4)'); await p.pin(a['x'], a['y'])
    assert await p.js('()=>t2d.inf.circ[6].sinner'), 'double tap — a sinner, the circle burns'
    assert await p.js('()=>t2d.sounding()'), 'sounding with a sinner'
    await p.pg.wait_for_timeout(1200); print('  inferno level, one sinner:', round(await p.js('()=>T2D.level'), 3))
    t = await p.js('()=>t2d.inf.at(0, 0.5)'); bt = await p.js('()=>t2d.inf.at(8, 0.5)')
    s0 = await p.js('()=>t2d.inf.strikes')
    pid = await p.hold(t['x'], t['y'], ms=40); await p.drag(pid, t['x'], t['y'], bt['x'], bt['y'], steps=16); await p.up()
    n = await p.js('()=>t2d.inf.strikes') - s0; assert n >= 6, f'swipe down — a cascade: {n} circles struck'
    await p.pg.wait_for_timeout(800)
    a = await p.js('()=>t2d.inf.at(6, 0.4)'); await p.hold(a['x'], a['y'], ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'long hold on a burning circle — its sheet'
    await p.shot('inferno-sheet')
    s = await p.js('()=>t2d.fxGeo()'); r = [q for q in s['rows'] if q['k'] == 'pos'][0]
    await p.tap(s['lfoX'], r['y'] + r['h'] / 2); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>t2d.slOpen()') == 'pos', 'tap ~ on the pitch row — its LFO panel'
    s = await p.js('()=>t2d.fxGeo()'); pid = await p.hold(s['x'] + s['w'] * 0.7, s['bottom'] - 40, ms=60); await p.drag(pid, s['x'] + s['w'] * 0.7, s['bottom'] - 40, s['x'] + s['w'] * 0.75, s['bottom'] - 90, steps=4); await p.up()
    L = await p.js('()=>t2d.sl()'); print('  circle LFO', L); assert any(e['key'] == 'pos' and e['depth'] > 0.1 for e in L), f'drag the pad — rate and depth: {L}'
    p0 = await p.js('()=>t2d.inf.circ[6].pos'); await p.pg.wait_for_timeout(400); p1 = await p.js('()=>t2d.inf.circ[6].pos')
    assert abs(p1 - p0) > 0.001, f'the circle pitch moves with its LFO: {p0} {p1}'
    await p.shot('inferno-sheet-lfo')
    await p.tap(200, 140); await p.pg.wait_for_timeout(100)
    await p.js("()=>{t2d.inf.setFx('ice', 0.7); t2d.inf.setFx('smoke', 0.7)}"); await p.pg.wait_for_timeout(600)
    i1 = await p.js('()=>t2d.inf.ice'); assert 0.02 < i1 < 0.4, f'ice grows slowly, not at once: {i1}'
    await p.pg.wait_for_timeout(4000); i2 = await p.js('()=>t2d.inf.ice'); assert i2 > i1 + 0.15, f'Cocytus keeps freezing: {i1} -> {i2}'
    assert await p.js('()=>t2d.inf.sparks') > 3, 'burning circles throw sparks'
    await p.shot('inferno-fx')
    a = await p.js('()=>t2d.inf.at(1, 0.5)'); await p.pin(a['x'], a['y']); await p.pg.wait_for_timeout(1500)
    st = await p.js('()=>t2d.inf.storm'); assert abs(st) > 0.05, f'the storm of the second circle sways its pitch: {st}'
    await p.shot('inferno-storm')
    await p.js("()=>t2d.inf.setFx('storm', 0)"); await p.pg.wait_for_timeout(1200)
    st = await p.js('()=>t2d.inf.storm'); assert abs(st) < 0.05, f'storm = 0 — the storm is off: {st}'
    await p.js("()=>t2d.inf.setFx('storm', 0.6)")
    await p.pin(a['x'], a['y'])
    await p.js("()=>{t2d.inf.setFx('ice', 0)}")
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(300)
    n = await p.js('()=>t2d.inf.circ.filter(c=>c.sinner).length'); assert 2 <= n <= 3, f'dice — 2–3 sinners: {n}'
    await p.pg.wait_for_timeout(1200); print('  inferno level, dice:', round(await p.js('()=>T2D.level'), 3))
    await p.shot('inferno')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.inf.circ.every(c=>!c.sinner)'), 'trash — no sinners'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.inf.circ.filter(c=>c.sinner).length') == n, 'undo brings the sinners back'
    D = await p.js('()=>t2d.inf.geo().dark'); await p.tap(D['x'] + 30, D['y'] - 30); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the darkness — map'


async def sc_paradisus(p):                         # Paradisus: ангел поёт, гласная вдоль, сфера поперёк, закрепить, плашка, роза, FX, кубик, корзина, отмена, свет — карта
    if 6 in await p.js('()=>t2d.hidden'): print('  switched off — skipped'); return
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    q = await p.js('()=>t2d.mapPanel(6)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 6], 'map quadrant above Cymatica opens Paradisus'
    a = await p.js('()=>t2d.par.at(3, 0)'); pid = await p.hold(a['x'], a['y'], ms=600)
    assert await p.js('()=>t2d.par.angels.length') == 1, 'touch a sphere — an angel sings'
    lv = await p.js('()=>T2D.level'); print('  paradisus level, one angel:', round(lv, 3)); assert lv > 0.05, f'the angel is heard: {lv}'
    assert await p.js('()=>t2d.par.angels[0].k') == 3, 'on the touched sphere'
    b = await p.js('()=>t2d.par.at(3, 1.6)'); await p.drag(pid, a['x'], a['y'], b['x'], b['y'], steps=10)
    v = await p.js('()=>t2d.par.angels[0].v'); assert 1.2 < v < 2.0, f'drag along — the vowel glides: {v}'
    c = await p.js('()=>t2d.par.at(6, 1.6)'); await p.drag(pid, b['x'], b['y'], c['x'], c['y'], steps=6)
    assert await p.js('()=>t2d.par.angels[0].k') == 6, 'drag across — another sphere'
    await p.shot('paradisus-held'); await p.up(); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.par.angels.length') == 0, 'finger up — the angel is gone'
    a = await p.js('()=>t2d.par.at(5, 4.2)'); await p.pin(a['x'], a['y'])
    assert await p.js('()=>t2d.par.angels.filter(a=>a.pinned).length') == 1, 'double tap — the angel stays'
    await p.pg.wait_for_timeout(300); await p.hold(a['x'], a['y'], ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold a staying angel — its sheet'
    await p.shot('paradisus-sheet')
    await p.js("()=>{const a=t2d.par.angels.find(a=>a.pinned); t2d.par.setFx('orbits', 1); t2d.par.orbit((a.v/5 - 0.004 - a.k*0.13 + 2)/(9-a.k));}")
    await p.pg.wait_for_timeout(500)
    assert await p.js('()=>t2d.par.flashes') > 0, 'a planet passes the staying angel — it chimes'
    await p.js("()=>t2d.par.setFx('vibrato', 1)")
    vs = []
    for _ in range(4): vs.append(await p.js('()=>t2d.par.vEff(t2d.par.angels.find(a=>a.pinned))')); await p.pg.wait_for_timeout(900)
    v0, v1 = min(vs), max(vs)
    await p.js("()=>t2d.par.setFx('vibrato', 0.4)")
    assert abs(v1 - v0) > 0.01, f'a staying angel drifts through vowels: {v0} {v1}'
    assert await p.js('()=>t2d.par.open') > 0.2, 'the rose opens with the choir'
    await p.shot('paradisus-orbits')
    await p.js("()=>t2d.par.setFx('orbits', 0)"); g0 = await p.js('()=>t2d.par.glitter'); await p.pg.wait_for_timeout(100)
    await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    g = await p.js('()=>t2d.par.geo()'); await p.tap(g['cx'], g['cy']); await p.pg.wait_for_timeout(250)
    assert await p.js('()=>t2d.par.glitter') > 3, 'tap the rose — grains glitter'
    await p.js("()=>{t2d.par.setFx('shimmer', 0.8); t2d.par.setFx('gloria', 0.6)}"); await p.pg.wait_for_timeout(700)
    await p.shot('paradisus-fx')
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(700)
    assert await p.js('()=>t2d.par.angels.filter(a=>a.pinned).length') == 3, 'dice — a triad of three angels'
    print('  paradisus level, dice:', round(await p.js('()=>T2D.level'), 3))
    await p.shot('paradisus')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.par.angels.length') == 0, 'trash — the choir is silent'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.par.angels.length') == 3, 'undo brings the angels back'
    L = await p.js('()=>t2d.par.geo().light'); await p.tap(L['x'] - 30, L['y'] - 30); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the light — map'
    await p.shot('map-heaven')


async def sc_monochord(p):                         # Monochordum: щипок, смычок, подставка — высота, Эолова струна, плашка, ветер, кубик, корзина, отмена, облако — карта
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    q = await p.js('()=>t2d.mapPanel(7)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 7], 'the card under Laboratorium opens Monochordum'
    for _ in range(30):
        if await p.js('()=>t2d.mono.ready'): break
        await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.mono.ready'), 'string worklet is up'
    a = await p.js('()=>t2d.mono.at(1, 0.3)'); await p.tap(a['x'], a['y']); await p.pg.wait_for_timeout(250)
    e = await p.js('()=>t2d.mono.str[1].en'); lv = await p.js('()=>T2D.level'); print('  monochord pluck: energy', round(e, 4), 'level', round(lv, 3))
    assert e > 0.003, f'tap — the string is plucked: {e}'
    others = await p.js('()=>[0,2,3].map(i=>t2d.mono.str[i].en)'); print('  sympathetic strings', [round(x, 5) for x in others])
    assert max(others) > 0.0003, f'the other strings answer through the shared bridge: {others}'
    await p.shot('monochord-pluck')
    b = await p.js('()=>t2d.mono.at(0, t2d.mono.str[0].r)'); h0 = await p.js('()=>t2d.mono.hz(0)')
    pid = await p.hold(b['x'], b['y'], ms=80); c = await p.js('()=>t2d.mono.at(0, 0.5)'); await p.drag(pid, b['x'], b['y'], c['x'], c['y'] + 2, steps=10)
    await p.shot('monochord-bridge'); await p.up(); await p.pg.wait_for_timeout(100)
    r = await p.js('()=>t2d.mono.str[0].r'); h1 = await p.js('()=>t2d.mono.hz(0)')
    assert r == 0.5 and abs(h1 / h0 - 2) < 0.01, f'drag the bridge up to the middle — it sticks to 1/2, an octave: {r} {h0}->{h1}'
    a = await p.js('()=>t2d.mono.at(2, 0.25)'); pid = await p.hold(a['x'], a['y'], ms=60)
    for k in range(6):
        x0 = a['x'] + (14 if k % 2 else -14); await p.drag(pid, a['x'] + (-14 if k % 2 else 14), a['y'], x0, a['y'], steps=5)
    bow = await p.js('()=>t2d.mono.str[2].bow'); assert bow > 0.05, f'stroke across — bowing: {bow}'
    await p.up(); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.mono.str[2].bow') == 0, 'finger up — the bow lifts'
    await p.pg.wait_for_timeout(1500)
    a = await p.js('()=>{const s=t2d.mono.str[2]; return t2d.mono.at(2, s.r/2)}'); await p.tap(a['x'], a['y']); await p.pg.wait_for_timeout(250)
    hh = await p.js('()=>[t2d.mono.str[2].eh, t2d.mono.str[2].hn]'); print('  harmonic', hh)
    assert hh[0] > 0.003 and hh[1] == 2, f'tap the middle dot — a flageolet an octave up: {hh}'
    await p.shot('monochord-harmonic'); await p.pg.wait_for_timeout(1500)
    e0 = await p.js('()=>t2d.mono.str.map(s=>s.en)')
    g0 = await p.js('()=>t2d.mono.geo()'); y = g0['y0'] + 40
    pid = await p.hold(g0['box']['x0'] - 20, y, ms=40); await p.drag(pid, g0['box']['x0'] - 20, y, g0['box']['x1'] + 10, y, steps=8); await p.up(); await p.pg.wait_for_timeout(200)
    e1 = await p.js('()=>t2d.mono.str.map(s=>s.en)'); print('  strum energies', [round(x, 4) for x in e1])
    assert all(e1[i] > max(0.003, e0[i] * 1.5) for i in range(4)), f'sweep across all strings — strum: {e0} -> {e1}'
    assert await p.js('()=>t2d.mono.str.every(s=>!s.bow)'), 'strum is not a bow'
    a = await p.js('()=>t2d.mono.at(0, 0.2)'); g0 = await p.js('()=>t2d.mono.geo()'); pid = await p.hold(a['x'], a['y'], ms=30)
    await p.drag(pid, a['x'], a['y'], a['x'] + 12, a['y'], steps=2)
    assert await p.js('()=>t2d.mono.str[0].bow') == 0, 'quick start of a strum from a string — no bow yet'
    await p.drag(pid, a['x'] + 12, a['y'], g0['xs'][3] + 10, a['y'], steps=4); await p.up()
    assert await p.js('()=>t2d.mono.str.every(s=>!s.bow)'), 'quick sweep from a string — strum, no bow squeak'
    a = await p.js('()=>t2d.mono.at(3, 0.15)'); await p.pin(a['x'], a['y']); await p.pg.wait_for_timeout(1200)
    assert await p.js('()=>t2d.mono.str[3].sus'), 'double tap — the string sings by itself'
    e = await p.js('()=>t2d.mono.str[3].en'); assert e > 0.001, f'Aeolian string sounds: {e}'
    await p.pg.wait_for_timeout(300); a = await p.js('()=>t2d.mono.at(1, 0.2)'); await p.hold(a['x'], a['y'], ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold a string — its sheet'
    await p.shot('monochord-sheet')
    await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    A = await p.js('()=>t2d.mono.geo().aeolus'); pid = await p.hold(A['x'], A['y'], ms=60); await p.drag(pid, A['x'], A['y'], A['x'], A['y'] - 100, steps=8)
    await p.pg.wait_for_timeout(1200); await p.shot('monochord-wind'); await p.up()
    w = await p.js('()=>t2d.mono.wind'); assert w > 0.6, f'drag the wind head up — wind: {w}'
    print('  monochord level, wind:', round(await p.js('()=>T2D.level'), 3))
    await p.tap(A['x'], A['y']); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.mono.wind') == 0, 'tap the wind head — calm'
    await p.pg.wait_for_timeout(300); await p.tap(A['x'], A['y']); await p.pg.wait_for_timeout(100)
    assert abs(await p.js('()=>t2d.mono.wind') - w) < 0.01, 'tap again — the same wind is back'
    await p.js("()=>t2d.mono.setFx('chorus', 0.7)"); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.mono.chorus'), 'chorus in FX'
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.mono.wind') == 0, 'trash — the wind is part of the patch, it calms down'
    await p.pg.wait_for_timeout(6000)
    lv = await p.js('()=>T2D.level'); print('  monochord level after trash:', round(lv, 4)); assert lv < 0.01, f'after trash it is silent: {lv}'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.mono.wind') > 0.6, 'undo brings the wind back'
    await p.js("()=>t2d.mono.setWind(0)")
    E = await p.js('()=>t2d.mono.earth()'); await p.tap(E['x'], E['y'] - E['r'] + 6); await p.pg.wait_for_timeout(1600)
    assert await p.js('()=>t2d.mono.auto.on'), 'tap the earth — it strums by itself'
    en = await p.js('()=>t2d.mono.str.map(s=>s.en)'); print('  auto strum energies', [round(x, 4) for x in en]); assert sum(1 for x in en if x > 0.002) >= 3, f'the earth strums the strings: {en}'
    await p.shot('monochord-earth')
    await p.hold(E['x'], E['y'] - E['r'] + 6, ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold the earth — its sheet'
    await p.shot('monochord-earth-sheet'); await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    A = await p.js('()=>t2d.mono.geo().aeolus'); await p.hold(A['x'], A['y'], ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold the wind rose — wind sheet'
    await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(400)
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(200)
    assert not await p.js('()=>t2d.mono.str.some(s=>s.sus)'), 'trash — no string sings by itself'
    assert not await p.js('()=>t2d.mono.auto.on'), 'trash — the earth stops'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    await p.shot('monochord')
    h = await p.js('()=>t2d.mono.geo().hand'); await p.tap(h['x'] - h['r'] * 0.5, h['y'] + h['r'] * 0.5); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the cloud — map'


async def sc_oceanus(p):                           # Oceanus: город поёт, двойной тап — остаётся, ведёшь — нота, вода — волны, всплеск, плашка, FX, кубик, корзина, отмена, солнце — карта
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    q = await p.js('()=>t2d.mapPanel(8)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 8], 'the card under Natura opens Oceanus'
    for _ in range(30):
        if await p.js('()=>t2d.ocean.ready'): break
        await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.ocean.ready'), 'ocean worklet is up'
    a = await p.js('()=>t2d.ocean.at(0.3, 0.85)'); pid = await p.hold(a['x'], a['y'], ms=700)
    assert await p.js('()=>t2d.ocean.voices.length') == 1, 'touch the land — a city sings'
    for _ in range(30):                              # ядро (ocean.wasm) поднимается вместе с worklet
        if await p.js("()=>t2d.ocean.core == 'wasm'"): break
        await p.pg.wait_for_timeout(100)
    assert await p.js("()=>t2d.ocean.core") == 'wasm', 'the ocean core is up (ocean.wasm)'
    assert await p.js('()=>Math.max(...t2d.ocean.gains) > 0'), 'the core sounds: a voice has gain'
    lv = await p.js('()=>T2D.level'); print('  oceanus level, one city:', round(lv, 3)); assert lv > 0.03, f'the city is heard: {lv}'
    h0 = await p.js('()=>t2d.ocean.hz(t2d.ocean.voices[0])')
    b = await p.js('()=>t2d.ocean.at(0.3, 0.2)'); await p.drag(pid, a['x'], a['y'], b['x'], b['y'], steps=8)
    h1 = await p.js('()=>t2d.ocean.hz(t2d.ocean.voices[0])'); assert abs(h1 / h0 - 4) < 0.3, f'inland — two octaves up: {h0} -> {h1}'
    await p.shot('oceanus-held'); await p.up(); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.ocean.voices.length') == 0, 'finger up — the city is silent'
    a = await p.js('()=>t2d.ocean.at(1.2, 0.5)'); await p.pin(a['x'], a['y'])
    assert await p.js('()=>t2d.ocean.voices.filter(v=>v.pinned).length') == 1, 'double tap — the city stays'
    await p.pg.wait_for_timeout(600)
    s0 = await p.js('()=>Array.from(t2d.ocean.shape)')
    w = await p.js('()=>t2d.ocean.water(2.5, 0.95)'); w2 = await p.js('()=>t2d.ocean.water(2.9, 0.95)')
    pid = await p.hold(w['x'], w['y'], ms=200); await p.drag(pid, w['x'], w['y'], w2['x'], w2['y'], steps=6); await p.pg.wait_for_timeout(200)
    s1 = await p.js('()=>Array.from(t2d.ocean.shape)')
    dif = max(abs(x - y) for x, y in zip(s0, s1)); print('  ocean shape moved by', round(dif, 3)); assert dif > 0.2, f'touch the water — it follows the finger: {dif}'
    await p.shot('oceanus-water'); await p.up(); await p.pg.wait_for_timeout(100)
    await p.pg.wait_for_timeout(300); a = await p.js('()=>t2d.ocean.at(1.2, 0.5)'); await p.hold(a['x'], a['y'], ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold a staying city — its sheet'
    await p.shot('oceanus-sheet'); await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    m = await p.js('()=>t2d.ocean.moonAt()'); await p.hold(m['x'], m['y'], ms=700); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold the moon — luna sheet'
    await p.js('()=>{t2d.ocean.luna.sway=0.8; t2d.ocean.luna.to=1; t2d.worlds[8].fx.set("tide", t2d.ocean.fx.tide)}')
    await p.shot('oceanus-luna'); await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    w = await p.js('()=>t2d.ocean.water(4.0, 0.9)'); await p.tap(w['x'], w['y']); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.ocean.ripples') > 0, 'quick tap on the water — rings spread'
    await p.js("()=>{const v=t2d.ocean.voices.find(v=>v.pinned); v.path=2; t2d.ocean.send(v)}"); await p.pg.wait_for_timeout(600)
    assert await p.js('()=>t2d.ocean.gains.some(g=>g>0.3)'), 'a city scanning there-and-back still sings'
    await p.shot('oceanus-currents')
    await p.js("()=>{t2d.ocean.setFx('wind', 0.8); t2d.ocean.setFx('tension', 0.8)}"); await p.pg.wait_for_timeout(1500)
    print('  oceanus level, wind:', round(await p.js('()=>T2D.level'), 3)); await p.shot('oceanus-wind')
    await p.js("()=>{t2d.ocean.setFx('wind', 0)}")
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(1200)
    n = await p.js('()=>t2d.ocean.voices.length'); assert 2 <= n <= 3, f'dice — two or three cities: {n}'
    print('  oceanus level, dice:', round(await p.js('()=>T2D.level'), 3)); await p.shot('oceanus')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.ocean.voices.length') == 0, 'trash — no cities'
    await p.pg.wait_for_timeout(3000); lv = await p.js('()=>T2D.level'); assert lv < 0.01, f'after trash it is silent: {lv}'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.ocean.voices.length') == n, 'undo brings the cities back'
    S = await p.js('()=>t2d.ocean.geo().sun'); await p.tap(S['x'] + 20, S['y'] + 20); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the sun — map'
    await p.shot('map-ocean')


async def sc_horologium(p):                        # Horologium Nova: кольца — волшебные числа, ступица — ход, маятник руками, тон за limen, плашки, FX, кубик, корзина, отмена, солнце — карта
    if 9 in await p.js('()=>t2d.hidden'): print('  switched off — skipped'); return
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    q = await p.js('()=>t2d.mapPanel(9)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 9], 'the IX card opens Horologium'
    for _ in range(30):
        if await p.js('()=>t2d.horo.ready'): break
        await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.horo.ratio().a') == 'IV : V : VI', 'rings IV, V, VI at first'
    await p.shot('horologium-still')
    h = await p.js('()=>t2d.horo.hub()'); await p.tap(h['x'], h['y']); await p.pg.wait_for_timeout(2500)
    assert await p.js('()=>t2d.horo.clock.run'), 'tap the hub — the clock runs'
    st = await p.js('()=>t2d.horo.strikes'); lv = await p.js('()=>T2D.level'); print('  strikes in 2.5 s:', st, 'level', round(lv, 3))
    assert st >= 6 and lv > 0.01, f'rings strike: {st} {lv}'
    await p.shot('horologium-run')
    a = await p.js('()=>t2d.horo.ring(0, 1.1)'); await p.tap(a['x'], a['y']); await p.pg.wait_for_timeout(400)
    assert await p.js('()=>t2d.horo.rings[0].on'), 'tap ring II — it joins'
    a = await p.js('()=>t2d.horo.ring(1, 1.1)'); await p.pin(a['x'], a['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.horo.rings[1].under && t2d.horo.rings[1].on'), 'double tap ring III — undertone'
    b0 = await p.js('()=>t2d.horo.ring(2, 0.5)'); b1 = await p.js('()=>t2d.horo.ring(2, 0.9)'); pid = await p.hold(b0['x'], b0['y'], ms=60); await p.drag(pid, b0['x'], b0['y'], b1['x'], b1['y'], steps=6); await p.up(); await p.pg.wait_for_timeout(100)
    ph = await p.js('()=>t2d.horo.rings[2].phi'); assert 0.05 < ph < 0.95, f'drag along ring IV — its phase: {ph}'
    c = await p.js('()=>t2d.horo.ring(3, 1.1)'); await p.hold(c['x'], c['y'], ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold a ring — its sheet'
    await p.shot('horologium-sheet'); await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    b = await p.js('()=>t2d.horo.bob()'); pid = await p.hold(b['x'], b['y'], ms=500); await p.up(); await p.pg.wait_for_timeout(150)
    assert not await p.js('()=>t2d.horo.clock.run'), 'catch the pendulum and hold — it stops'
    G = await p.js('()=>t2d.horo.geo()'); px, py, L = G['piv']['x'], G['piv']['y'], G['L']
    b = await p.js('()=>t2d.horo.bob()'); pid = await p.hold(b['x'], b['y'], ms=60)
    for k in range(3):
        await p.drag(pid, px - 50, py + L * 0.95, px + 50, py + L * 0.95, steps=8); await p.drag(pid, px + 50, py + L * 0.95, px - 50, py + L * 0.95, steps=8)
    hs = await p.js('()=>t2d.horo.handSteps'); print('  steps by hand:', hs); assert hs >= 4, f'swing it by hand — the escapement steps: {hs}'
    await p.drag(pid, px - 50, py + L * 0.95, px + 70, py + L * 0.6, steps=3); await p.up(); await p.pg.wait_for_timeout(600)
    u = await p.js('()=>t2d.horo.clock.u'); print('  thrown: u', round(u, 2)); assert await p.js('()=>t2d.horo.clock.run') and u > 0.5, f'throw the pendulum — faster: {u}'
    await p.js('()=>t2d.horo.run(true, 7.5)'); await p.pg.wait_for_timeout(1200)
    F = await p.js('()=>t2d.horo.F'); r = await p.js('()=>t2d.horo.ratio().b'); print('  over the top: F', round(F, 1), '·', r)
    assert F > 20 and r.startswith('tonus'), f'over the top — a tone: {F} {r}'
    await p.shot('horologium-tonus')
    a = await p.js('()=>t2d.horo.strip(1)'); b = await p.js('()=>t2d.horo.strip(30)'); pid = await p.hold(a['x'], a['y'], ms=60); await p.drag(pid, a['x'], a['y'], b['x'], b['y'], steps=8); await p.up(); await p.pg.wait_for_timeout(3000)
    F = await p.js('()=>t2d.horo.F'); print('  tempus scale to 30 / s, 3 s later:', round(F, 1)); assert 22 < F < 40, f'drag the tempus scale — the speed stays: {F}'
    await p.tap(b['x'], b['y']); await p.pg.wait_for_timeout(90); await p.tap(b['x'], b['y']); await p.pg.wait_for_timeout(1500)
    F = await p.js('()=>t2d.horo.F'); assert F < 1, f'double tap the scale — back to tempo: {F}'
    r = await p.js("()=>t2d.worlds[9].fx.sectors.length"); assert r == 5, 'FX: aequalis, materia, concursus, chance, hall'
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(1500)
    assert await p.js('()=>t2d.horo.rings.some(r=>r.on) && t2d.horo.clock.run'), 'dice — a magic ratio, running'
    await p.shot('horologium')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(2500)
    assert await p.js('()=>t2d.horo.rings.every(r=>!r.on)'), 'trash — no rings'
    lv = await p.js('()=>T2D.level'); assert lv < 0.01, f'after trash it is silent: {lv}'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.horo.rings.some(r=>r.on)'), 'undo brings the rings back'
    await p.js('()=>t2d.horo.run(false)')
    S = await p.js('()=>t2d.horo.geo().sun'); await p.tap(S['x'] - 20, S['y'] + 20); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the sun — map'

async def sc_firmamentum(p):                       # Firmamentum: прокол — звезда пульсирует, вверх — тон, вбок — формант, тап — закрыть, плашка, FX, кубик, корзина, отмена, солнце — карта
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    q = await p.js('()=>t2d.mapPanel(10)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 10], 'the card right of Tenebrae opens Firmamentum'
    for _ in range(30):
        if await p.js('()=>t2d.firm.ready'): break
        await p.pg.wait_for_timeout(100)
    L = await p.js('()=>t2d.firm.LIMEN')
    a = await p.js(f'()=>t2d.firm.at({L * 0.5}, -0.3)'); await p.tap(a['x'], a['y']); await p.pg.wait_for_timeout(300)
    for _ in range(30):                              # ядро SDK (t2d.wasm в t2d-worklet.js) — один узел на контекст, поднимается в build
        if await p.js("()=>t2d.firm.core == 'wasm'"): break
        await p.pg.wait_for_timeout(100)
    assert await p.js("()=>t2d.firm.core") == 'wasm', 'the SDK core is up (t2d.wasm)'
    assert await p.js("()=>performance.getEntriesByType('resource').some(e=>e.name.includes('t2d.wasm')) && !performance.getEntriesByType('resource').some(e=>e.name.includes('pulsar'))"), 'Firmamentum runs from t2d.wasm, pulsar.wasm is gone'
    await p.pg.wait_for_timeout(1200)
    assert await p.js('()=>Math.max(...t2d.firm.gains) > 0'), 'the core sounds: a voice has gain'
    assert await p.js('()=>t2d.firm.stars.length') == 1, 'tap the sky — a star'
    fp = await p.js('()=>t2d.firm.fp(t2d.firm.stars[0])'); c = await p.js('()=>t2d.firm.counts[t2d.firm.stars[0].slot]')
    print('  low star:', round(fp, 2), 'pulses/s, pulsarets so far', c); assert fp < 20 and c >= 1, f'near the horizon — a rhythm: {fp} {c}'
    await p.shot('firmamentum-rhythm')
    b = await p.js('()=>t2d.firm.at(0.75, -0.3)'); pid = await p.hold(a['x'], a['y'], ms=60); await p.drag(pid, a['x'], a['y'], b['x'], b['y'], steps=8)
    fp2 = await p.js('()=>t2d.firm.fp(t2d.firm.stars[0])'); assert fp2 > 40, f'drag up — a tone: {fp2}'
    ff0 = await p.js('()=>t2d.firm.ff(t2d.firm.stars[0])'); b2 = await p.js('()=>t2d.firm.at(0.75, 0.5)'); await p.drag(pid, b['x'], b['y'], b2['x'], b2['y'], steps=6)
    ff1 = await p.js('()=>t2d.firm.ff(t2d.firm.stars[0])'); assert ff1 > ff0 * 1.5, f'drag sideways — formant: {ff0} -> {ff1}'
    await p.shot('firmamentum-held'); await p.up(); await p.pg.wait_for_timeout(1000)
    lv = await p.js('()=>T2D.level'); print('  firmamentum level, one tone:', round(lv, 3)); assert lv > 0.02, f'the star is heard: {lv}'
    s = await p.js('()=>t2d.firm.at(0.75, 0.5)'); await p.hold(s['x'], s['y'], ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold a star — its sheet'
    await p.shot('firmamentum-sheet'); await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    await p.tap(s['x'], s['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.firm.stars.length') == 0, 'tap a star — the hole closes'
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(1500)
    n = await p.js('()=>t2d.firm.stars.length'); assert 3 <= n <= 4, f'dice — a rhythm and tones: {n}'
    await p.js("()=>{t2d.firm.setFx('scintilla', 0.6); t2d.firm.setFx('drift', 0.6); t2d.firm.setFx('cometa', 1); t2d.firm.launch()}"); await p.pg.wait_for_timeout(1800)
    assert await p.js('()=>t2d.firm.comets') >= 1, 'cometa — a comet flies'
    await p.js("()=>{t2d.firm.setFx('crepitus', 0.8); t2d.firm.setFx('fulgur', 1)}"); await p.pg.wait_for_timeout(2500)
    sp, bo = await p.js('()=>[t2d.firm.specks, t2d.firm.bolts]'); print('  crepitus specks:', sp, 'fulgur bolts:', bo); assert sp > 3 and bo > 0, f'crepitus and fulgur: {sp} {bo}'
    r = await p.js("()=>t2d.worlds[10].fx.sectors.length"); assert r == 7, 'FX: scintilla, drift, cometa, crepitus, fulgur, spread, hall'
    await p.shot('firmamentum-dust')
    await p.shot('firmamentum-comet')
    print('  firmamentum level, dice:', round(await p.js('()=>T2D.level'), 3)); await p.shot('firmamentum')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(2500)
    assert await p.js('()=>t2d.firm.stars.length') == 0, 'trash — the firmament is whole'
    lv = await p.js('()=>T2D.level'); assert lv < 0.01, f'after trash it is silent: {lv}'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.firm.stars.length') == n, 'undo brings the stars back'
    S = await p.js('()=>t2d.firm.geo().sun'); await p.tap(S['x'] + 20, S['y'] - 30); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the sun — map'


async def sc_triaenergy(p):                        # Tria: энергия броска сохраняется — тела не слипаются; decay — садятся в клубок
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    q = await p.js('()=>t2d.mapPanel(11)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    for k in range(4):
        d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(2500)
        e0 = await p.js('()=>t2d.tria.energy()'); dm = []
        for _ in range(40):
            await p.pg.wait_for_timeout(500); dm.append(await p.js('()=>t2d.tria.dmin()'))
        e1 = await p.js('()=>t2d.tria.energy()'); close = sum(1 for x in dm if x < 0.12) / len(dm)
        print(f'  dice {k}: energy {e0:.2f} -> {e1:.2f}, closest pair over 20 s', ' '.join(f'{x:.2f}' for x in dm[::4]), f'· in a tight pair {close:.0%}')
        assert abs(e1 - e0) < 0.05 * abs(e0) + 0.05, f'energy is kept: {e0} -> {e1}'
        assert close < 0.5, f'no pair stays stuck: {dm}'
    st0 = await p.js('()=>t2d.tria.strikes'); await p.pg.wait_for_timeout(5000); st1 = await p.js('()=>t2d.tria.strikes')
    print('  aspects: bells in 5 s', st1 - st0); assert 3 <= st1 - st0 <= 120, f'bodies strike notes on circles and rays: {st1 - st0}'
    await p.js("()=>t2d.tria.setFx('aspectus', 0)"); st0 = await p.js('()=>t2d.tria.strikes'); await p.pg.wait_for_timeout(3000); st1 = await p.js('()=>t2d.tria.strikes')
    print('  aspectus 0: bells in 3 s', st1 - st0); await p.js("()=>t2d.tria.setFx('aspectus', 0.6)")
    await p.shot('tria-aspects')
    await p.js("()=>t2d.tria.setFx('decay', 1)"); await p.pg.wait_for_timeout(25000)
    sp = await p.js('()=>t2d.tria.spread()'); print('  decay 100 %, after 25 s spread', round(sp, 3)); assert sp < 0.2, f'decay — they settle: {sp}'
    await p.js("()=>t2d.tria.setFx('decay', 0)")


async def sc_tria(p):                              # Tria corpora: тела молчат, брошенное — хаос и звук, якорь, плашка, Fiat lux, FX, кубик, корзина, отмена, солнце — карта
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    q = await p.js('()=>t2d.mapPanel(11)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 11], 'the card above Firmamentum opens Tria corpora'
    assert await p.js('()=>t2d.tria.still'), 'the bodies rest at first'
    await p.shot('tria-still')
    a = await p.js('()=>t2d.tria.at(1)'); pid = await p.hold(a['x'], a['y'], ms=40)
    for k in range(1, 7): await p.T('touchMove', [{'x': a['x'] + 14 * k, 'y': a['y'] + 6 * k, 'id': pid}]); await p.pg.wait_for_timeout(16)
    await p.up(); await p.pg.wait_for_timeout(1500)
    assert not await p.js('()=>t2d.tria.still'), 'throw a body — they move'
    lv = await p.js('()=>T2D.level'); print('  tria level, thrown:', round(lv, 3)); assert lv > 0.02, f'moving bodies sound: {lv}'
    await p.pg.wait_for_timeout(2500); await p.shot('tria-chaos')
    b = await p.js('()=>t2d.tria.at(0)'); await p.pin(b['x'], b['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.tria.bodies[0].fixed'), 'double tap — anchored'
    b2 = await p.js('()=>t2d.tria.at(0)'); await p.pg.wait_for_timeout(500); b3 = await p.js('()=>t2d.tria.at(0)')
    assert abs(b3['x'] - b2['x']) < 1 and abs(b3['y'] - b2['y']) < 1, 'an anchored body stays'
    await p.pg.wait_for_timeout(300); await p.hold(b2['x'], b2['y'], ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold a body — its sheet'
    await p.shot('tria-sheet'); await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    av = await p.js('()=>t2d.tria.geo().av[1]'); await p.tap(av['x'], av['y']); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'tap a medallion below — that body\'s sheet'
    await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    await p.js("()=>t2d.tria.model.setBody(0, 'fixed', 0)")
    pl = await p.js('()=>t2d.tria.geo().plumb'); await p.tap(pl['x'], pl['y']); await p.pg.wait_for_timeout(4000)
    assert await p.js('()=>t2d.tria.cadit'), 'tap the plumb line — gravity off'
    ys = await p.js('()=>t2d.tria.bodies.map(b=>b.y)'); print('  fallen', [round(y, 2) for y in ys]); assert min(ys) > 0.45, f'everything falls to the bottom: {ys}'
    await p.shot('tria-fall'); await p.tap(pl['x'], pl['y']); await p.pg.wait_for_timeout(200)
    assert not await p.js('()=>t2d.tria.cadit'), 'tap again — gravity back'
    G = await p.js('()=>t2d.tria.geo()'); await p.tap(G['cx'], G['cy']); await p.pg.wait_for_timeout(2500)
    assert await p.js('()=>t2d.tria.lux'), 'tap the sign of earth — Fiat lux'
    r = await p.js('()=>Math.max(...t2d.tria.bodies.map(b=>Math.hypot(b.x,b.y)))'); assert r < 0.8, f'the figure eight holds: {r}'
    await p.shot('tria-lux')
    r = await p.js("()=>t2d.btnPos('rev')"); await p.tap(r['x'], r['y']); await p.pg.wait_for_timeout(150)
    s = await p.js('()=>t2d.fxGeo()'); row = [q for q in s['rows'] if q['k'] == 'gravitas'][0]
    await p.tap(s['lfoX'], row['y'] + row['h'] / 2); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>t2d.slOpen()') == 'gravitas', 'FX: ~ on gravitas — LFO panel'
    s = await p.js('()=>t2d.fxGeo()'); await p.tap(s['x'] + s['w'] * 0.6, s['lfoTop'] + 50); await p.pg.wait_for_timeout(100)   # форма: рампа вниз … плавная
    pid = await p.hold(s['x'] + s['w'] * 0.4, s['bottom'] - 40, ms=60); await p.drag(pid, s['x'] + s['w'] * 0.4, s['bottom'] - 40, s['x'] + s['w'] * 0.45, s['bottom'] - 100, steps=4); await p.up()
    await p.shot('tria-fx-lfo')
    g0 = await p.js("()=>t2d.tria.fx.gravitas"); await p.pg.wait_for_timeout(1200); g1 = await p.js("()=>t2d.tria.fx.gravitas")
    assert abs(g1 - g0) > 0.005, f'gravitas breathes with its LFO: {g0} {g1}'
    await p.tap(r['x'], r['y']); await p.pg.wait_for_timeout(150)
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(2000)
    print('  tria level, dice:', round(await p.js('()=>T2D.level'), 3), 'encounters', await p.js('()=>t2d.tria.encounters')); await p.shot('tria')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(2500)
    assert await p.js('()=>t2d.tria.still'), 'trash — the bodies freeze'
    lv = await p.js('()=>T2D.level'); assert lv < 0.01, f'after trash it is silent: {lv}'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(300)
    assert not await p.js('()=>t2d.tria.still'), 'undo sets them moving again'
    S = await p.js('()=>t2d.tria.geo().sun'); await p.tap(S['x'] + 20, S['y'] + 20); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the sun — map'


async def sc_audio(p):                             # перезапуск звука (смена выхода): патчи живут, звук возвращается; concordia — stable/restart
    await p.pin(150, 600); await p.pg.wait_for_timeout(500)
    await p.js('()=>t2d.go(8)'); await p.pg.wait_for_timeout(1500)
    a = await p.js('()=>t2d.ocean.at(1.0, 0.6)'); await p.pin(a['x'], a['y']); await p.pg.wait_for_timeout(1200)
    await p.js('()=>{ t2d.firm.model.addStar(0.7, 0.2); t2d.firm.setFx("hall", 0.8) }')   # мир SDK (ядро t2d.wasm) тоже переживает перезапуск
    for _ in range(30):
        if await p.js('()=>t2d.firm.ready && Math.max(...t2d.firm.gains) > 0'): break
        await p.pg.wait_for_timeout(100)
    sent0 = await p.js('()=>t2d.core.sent')
    lv0 = await p.js('()=>T2D.level'); id0 = await p.js('()=>t2d.ctxId')
    await p.js('()=>t2d.restartAudio()'); await p.pg.wait_for_timeout(2500)
    id1 = await p.js('()=>t2d.ctxId'); lv1 = await p.js('()=>T2D.level')
    print('  level before / after restart', round(lv0, 3), round(lv1, 3))
    assert id1 != id0, 'a new audio context'
    assert await p.js('()=>t2d.ocean.voices.filter(v=>v.pinned).length') == 1, 'the city survives the restart'
    assert await p.js('()=>t2d.voices.some(v=>v.active&&v.pinned)'), 'the Tenebrae planet survives'
    assert lv1 > 0.02, f'sound comes back after restart: {lv1}'
    assert await p.js('()=>t2d.firm.stars.length') == 1 and await p.js("()=>t2d.firm.fx.hall") == 0.8, 'the Firmamentum star and its hall survive the restart'
    assert await p.js("()=>t2d.firm.core == 'wasm' && t2d.core.ready && t2d.core.sent < 40"), 'a new SDK core node, ready (fresh message count)'   # счёт с нуля: на мир SDK — сцена при bind и снова при restore хоста, плюс лад и фейдеры (семь миров — ~24)
    assert await p.js('()=>Math.max(...t2d.firm.gains) > 0'), 'the star sounds from the new core'
    print('  SDK core messages: before restart', sent0, 'after', await p.js('()=>t2d.core.sent'))
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    sun = await p.js('()=>t2d.mapSun()'); await p.tap(sun['x'], sun['y']); await p.pg.wait_for_timeout(200)
    await p.shot('concordia-audio')
    await p.tap(sun['x'], sun['y'] + 30 + 178); await p.pg.wait_for_timeout(1500)
    assert await p.js('()=>t2d.ctxId') != id1, 'tap restart audio — rebuilt'


async def sc_arcadia(p):                           # Arcadia: странник — петля по рельефу звучит, север — выше, край петли — шире, тап — уходит, плашка, FX, кубик — новая страна, корзина, отмена, солнце — карта
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    q = await p.js('()=>t2d.mapPanel(12)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 12], 'the card left of Monochordum opens Arcadia'
    for _ in range(30):
        if await p.js('()=>t2d.arc.ready'): break
        await p.pg.wait_for_timeout(100)
    await p.shot('arcadia-land')
    a = await p.js('()=>t2d.arc.at(-0.3, -0.5)'); await p.tap(a['x'], a['y']); await p.pg.wait_for_timeout(1500)
    assert await p.js('()=>t2d.arc.travellers.length') == 1, 'tap the land — a wanderer'
    lv = await p.js('()=>T2D.level'); print('  arcadia level, one wanderer:', round(lv, 3)); assert lv > 0.02, f'the wanderer is heard: {lv}'
    f0 = await p.js('()=>t2d.arc.hz(t2d.arc.travellers[0])')
    b = await p.js('()=>t2d.arc.at(-0.3, 0.4)'); pid = await p.hold(a['x'], a['y'], ms=60); await p.drag(pid, a['x'], a['y'], b['x'], b['y'], steps=8)
    f1 = await p.js('()=>t2d.arc.hz(t2d.arc.travellers[0])'); assert f1 > f0 * 1.4, f'drag north — higher: {f0} -> {f1}'
    await p.shot('arcadia-held'); await p.up(); await p.pg.wait_for_timeout(600)
    r0 = await p.js('()=>t2d.arc.travellers[0].r'); e = await p.js('()=>{const h=t2d.arc.at(t2d.arc.travellers[0].u, t2d.arc.travellers[0].v); return t2d.arc.loop(0).filter(q=>q.x>30).sort((a,b)=>Math.hypot(b.x-h.x,b.y-h.y)-Math.hypot(a.x-h.x,a.y-h.y))[0]}')   # точка петли подальше от флажка
    c = await p.js('()=>{const c=t2d.arc.centers[t2d.arc.travellers[0].slot]; return t2d.arc.ground(c[0], c[1])}'); dx, dy = e['x'] - c['x'], e['y'] - c['y']; L = max(1, (dx * dx + dy * dy) ** 0.5)
    pid = await p.hold(e['x'], e['y'], ms=40); await p.drag(pid, e['x'], e['y'], e['x'] + dx / L * 50, e['y'] + dy / L * 50, steps=6); await p.up()
    r1 = await p.js('()=>t2d.arc.travellers[0].r'); assert r1 > r0 + 0.08, f'drag the rim — a wider orbit: {r0} -> {r1}'
    await p.pg.wait_for_timeout(300)
    s = await p.js('()=>t2d.arc.at(t2d.arc.travellers[0].u, t2d.arc.travellers[0].v)'); await p.hold(s['x'], s['y'], ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold a wanderer — its sheet'
    await p.shot('arcadia-sheet'); await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    await p.tap(s['x'], s['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.arc.travellers.length') == 0, 'tap a wanderer — it leaves'
    seed0 = await p.js('()=>t2d.arc.land.seed')
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(2500)
    n = await p.js('()=>t2d.arc.travellers.length'); assert 2 <= n <= 3, f'dice — wanderers: {n}'
    assert await p.js('()=>t2d.arc.land.seed') != seed0, 'dice — a new land'
    await p.js("()=>{t2d.arc.setFx('wind', 0.6); t2d.arc.setFx('pace', 0.8)}"); await p.pg.wait_for_timeout(2500)
    print('  arcadia level, dice:', round(await p.js('()=>T2D.level'), 3)); await p.shot('arcadia')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(2500)
    assert await p.js('()=>t2d.arc.travellers.length') == 0, 'trash — the land is empty'
    lv = await p.js('()=>T2D.level'); assert lv < 0.01, f'after trash it is silent: {lv}'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.arc.travellers.length') == n, 'undo brings the wanderers back'
    S = await p.js('()=>t2d.arc.geo().sun'); await p.tap(S['x'] - 20, S['y'] + 30); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the sun — map'
    await p.shot('arcadia-map')


async def sc_webmidi(p):                          # компьютер / Android: часы по Web MIDI — строка «midi clock» в панели audio; вход подделан, тики с отметками времени
    await p.tap(195, 420); await p.pg.wait_for_timeout(300)           # тап — звук
    await p.js("""()=>{
      const inp = { name: 'Fake Clock', state: 'connected', onmidimessage: null };
      window.__inp = inp;
      window.__send = (b, ts) => inp.onmidimessage && inp.onmidimessage({ data: new Uint8Array([b]), timeStamp: ts, target: inp });
      navigator.requestMIDIAccess = async () => ({ inputs: new Map([['a', inp]]), onstatechange: null });
    }""")
    await p.js('()=>{t2d.go(13); t2d.worlds[13].dice(); t2d.worlds[13].tempo.play(true)}'); await p.pg.wait_for_timeout(300)   # Portus запускали руками
    await p.js('()=>t2d.worlds[13].tempo.play(false)'); await p.pg.wait_for_timeout(300)
    b = await p.js("()=>t2d.btnPos('vol')"); await p.tap(b['x'], b['y']); await p.pg.wait_for_timeout(200)
    P = await p.js('()=>t2d.panelGeo()'); row = {r['k']: r['y'] for r in P['rows']}
    assert 'midi' in row, f'Web MIDI is there — the midi clock row: {list(row)}'
    await p.tap(P['x'] + P['w'] / 2, row['midi']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>!!window.__inp.onmidimessage'), 'midi clock on — the input is listened to'
    await p.shot('webmidi')
    await p.js("""()=>{ const d = 500 / 24; let k = 0;
      __send(0xFA, performance.now());
      window.__mi = setInterval(() => { const now = performance.now(); for (let i = 0; i < 24; i++) __send(0xF8, now - (23 - i) * d); }, 500); }""")
    await p.pg.wait_for_timeout(3000)
    g = await p.js('()=>T2D.midiGrid()'); on = await p.js('()=>t2d.worlds[13].tempo.playing()'); bpm = await p.js('()=>t2d.worlds[13].tempo.get()')
    print('  grid p:', g and round(g['p'], 4), 'portus playing:', on, 'bpm:', bpm)
    assert g and abs(g['p'] - 0.5) < 0.01, f'the grid follows 120 bpm: {g}'
    assert on and abs(bpm - 120) < 1, f'Start runs Portus at the clock tempo: {on} {bpm}'
    await p.js("()=>{clearInterval(window.__mi); __send(0xFC, performance.now())}"); await p.pg.wait_for_timeout(400)
    assert not await p.js('()=>t2d.worlds[13].tempo.playing()'), 'Stop halts Portus'
    await p.tap(P['x'] + P['w'] / 2, row['midi']); await p.pg.wait_for_timeout(200)
    assert not await p.js('()=>!!window.__inp.onmidimessage'), 'midi clock off — the input is let go'
    assert await p.js("()=>JSON.parse(localStorage.getItem('t2d-audio')).midi") is False


async def sc_midi(p):                             # ведомый по MIDI: Start пускает миры, которые запускали руками в этой сессии (и мир на экране, если в нём узор); Natura со стартовым патчем, которую не трогали, молчит; включённая посреди игры — встаёт на сетку; Stop — все стоят, следующий Start возвращает набор
    await p.tap(195, 420); await p.pg.wait_for_timeout(300)           # тап — звук
    await p.js('()=>{for (const n of [13, 2]) t2d.worlds[n].dice(); t2d.worlds[9].clear(); t2d.go(9)}'); await p.pg.wait_for_timeout(300)   # на экране — Horologium без колец
    pl = lambda: p.js('()=>[13, 4, 2, 9, 7].map(n => !!t2d.worlds[n].tempo.playing())')
    await p.js('()=>{for (const n of [13, 2, 7]) t2d.worlds[n].tempo.play(true)}'); await p.pg.wait_for_timeout(300)   # Portus, Cymatica, автострам — руками
    await p.js('()=>{for (const n of [13, 2]) t2d.worlds[n].tempo.play(false)}'); await p.pg.wait_for_timeout(300)   # Portus и Cymatica остановили; автострам играет
    assert await pl() == [False, False, False, False, True], f'before the clock: {await pl()}'
    assert await p.js('()=>t2d.worlds[4].tempo.armed()'), 'Natura has its starting patch (armed) — but nobody touched it'
    await p.js("()=>{window.__mn = 0; t2dMidi({t:'start', ago:0}); window.__mi = setInterval(() => t2dMidi({t:'beat', n: ++window.__mn, bpm: 120, ago: 0}), 500)}")
    await p.pg.wait_for_timeout(3000)
    r = await pl(); print('  playing 13/4/2/9/7:', r)
    assert r == [True, False, True, False, True], f'Start runs Portus, Cymatica (started by hand) and the running autostrum; untouched Natura and the empty Horologium stay silent: {r}'
    await p.js('()=>t2d.worlds[4].tempo.play(true)'); await p.pg.wait_for_timeout(1500)   # Natura включили руками посреди игры
    d = None
    for _ in range(8):                         # оба номера — в одном вычислении; шаги по четыре на долю от одного t0 — совпадают по модулю 4
        d = await p.js('()=>{const a = t2d.portus.stepNow, b = t2d.nat.phase; return b == null ? null : [a, b, (((a - Math.floor(b)) % 4) + 4) % 4, b - Math.floor(b)]}')
        if d and d[2] == 0: break
        await p.pg.wait_for_timeout(137)
    print('  portus step, natura phase, diff mod 4:', d)
    edge = d and (d[3] < 0.1 or d[3] > 0.9)    # на границе шага выборка может разойтись на один
    assert d and (d[2] == 0 or (edge and d[2] in (1, 3))), f'Natura started mid-clock lands on the same grid as Portus: {d}'
    await p.js('()=>t2d.go(13)'); await p.pg.wait_for_timeout(500); await p.shot('midi')   # Portus идёт по чужим часам
    await p.js("()=>{clearInterval(window.__mi); t2dMidi({t:'stop'})}"); await p.pg.wait_for_timeout(600)
    r = await pl(); print('  after Stop:', r)
    assert not any(r), f'Stop halts every world: {r}'
    await p.js('()=>t2d.go(9)')
    await p.js("()=>{window.__mn = 0; t2dMidi({t:'start', ago:0}); window.__mi = setInterval(() => t2dMidi({t:'beat', n: ++window.__mn, bpm: 120, ago: 0}), 500)}")
    await p.pg.wait_for_timeout(2500)
    r = await pl(); print('  second Start:', r)
    assert r == [True, True, True, False, True], f'the next Start brings the whole set back, Natura included: {r}'
    await p.js("()=>{clearInterval(window.__mi); t2dMidi({t:'stop'})}"); await p.pg.wait_for_timeout(400)

async def sc_portus(p):                            # Portus: остров на луче — удар аккорда, дальше — выше; фонарь — остров; маяк — пуск; луна — фильтр; буй — эхо; небо — гасит эхо; туман; плашки; кубик; корзина; отмена; луна — карта
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    q = await p.js('()=>t2d.mapPanel(13)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 13], 'the card right of Oceanus opens Portus'
    await p.shot('portus-empty')
    a = await p.js('()=>t2d.portus.col(2, 0)'); await p.tap(a['x'], a['y']); await p.pg.wait_for_timeout(300)
    b = await p.js('()=>t2d.portus.col(10, 7)'); await p.tap(b['x'], b['y']); await p.pg.wait_for_timeout(300)
    st = await p.js('()=>t2d.portus.isles.map(i=>[i.step, i.p])'); assert st == [[2, 0], [10, 7]], f'tap the fairway — a boat on that step, across — its note: {st}'
    h0, h1 = await p.js('()=>t2d.portus.isles.map(i=>t2d.portus.hz(i))'); print('  roots:', round(h0, 1), round(h1, 1)); assert abs(h0 - 110) < 1 and h1 > h0 * 1.4, f'A2 at octave 0, across — higher: {h0} {h1}'
    await p.js('()=>{t2d.portus.pharos.oct = -2}'); h2 = await p.js('()=>t2d.portus.hz(t2d.portus.isles[0])'); assert abs(h2 - 27.5) < 0.5, f'lighthouse octave −2: {h2}'
    await p.js('()=>{t2d.portus.pharos.oct = -1}')
    L = await p.js('()=>t2d.portus.lantern(6)'); await p.tap(L['x'], L['y']); await p.pg.wait_for_timeout(100)
    assert 6 in await p.js('()=>t2d.portus.steps'), 'tap a marker lamp — a boat on that step'
    ph = await p.js('()=>t2d.portus.geo().ph'); await p.tap(ph['x'], ph['y'] - 40); await p.pg.wait_for_timeout(2500)
    assert await p.js('()=>t2d.portus.seq.playing'), 'tap the lighthouse — it plays'
    assert await p.js('()=>T2D.clockLive'), 'the clock worklet ticks'
    lv = await p.js('()=>T2D.level'); print('  portus level, playing:', round(lv, 3)); assert lv > 0.02, f'chords are heard: {lv}'
    await p.shot('portus-play')
    M = await p.js('()=>t2d.portus.geo().moon'); c0 = await p.js('()=>t2d.portus.luna.cut'); mx = M['x'] + M['r'] * 0.5
    pid = await p.hold(mx, M['y'], ms=60); await p.drag(pid, mx, M['y'], mx + 30, M['y'] - 60, steps=8)
    c1 = await p.js('()=>t2d.portus.luna.cut'); assert c1 > c0 + 0.15, f'drag the moon up — the filter opens: {c0} -> {c1}'
    await p.up()
    B = await p.js('()=>t2d.portus.buoyAt()'); f0 = await p.js('()=>t2d.portus.fb()')
    pid = await p.hold(B['x'], B['y'], ms=60); s2 = await p.js('()=>t2d.portus.col(14, 2)'); await p.drag(pid, B['x'], B['y'], s2['x'], s2['y'], steps=8); await p.up()
    f1 = await p.js('()=>t2d.portus.fb()'); assert f1 > f0, f'buoy out to sea — longer echo: {f0} -> {f1}'
    await p.pg.wait_for_timeout(1500); await p.shot('portus-echo')
    S = await p.js('()=>t2d.portus.sky()'); await p.tap(S['x'], S['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.portus.killed') > 0, 'tap the sky — a falling star kills the echo'
    await p.shot('portus-star')
    G = await p.js('()=>t2d.portus.geo()'); a0 = await p.js('()=>t2d.portus.fog.amt')
    pid = await p.hold(G['cx'] - 60, G['fogTop'], ms=60); await p.drag(pid, G['cx'] - 60, G['fogTop'], G['cx'] - 60, G['fogTop'] - 50, steps=6); await p.up()
    a1 = await p.js('()=>t2d.portus.fog.amt'); assert a1 > a0 + 0.1, f'drag the fog up — more reverb: {a0} -> {a1}'
    M = await p.js('()=>t2d.portus.geo().moon'); await p.hold(M['x'] + M['r'] * 0.5, M['y'], ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold the moon — its sheet'
    assert await p.js("()=>t2d.slAdd('cut')"), 'LFO on the moon cutoff'
    ys, ls = [], []
    for _ in range(12):
        M = await p.js('()=>t2d.portus.geo().moon'); ys.append(M['y']); ls.append(M['lfo']); await p.pg.wait_for_timeout(120)
    print('  moon with LFO: y spread', round(max(ys) - min(ys), 2), 'tint', round(min(ls), 2), '…', round(max(ls), 2))
    assert max(ys) - min(ys) < 1 and max(ls) - min(ls) > 0.2, f'LFO on cutoff — the moon stays, its colour swings: {ys} {ls}'
    await p.shot('portus-bloodmoon')
    await p.js("()=>T2D.lfoClear('portus-luna')")
    await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    ph = await p.js('()=>t2d.portus.geo().ph'); await p.hold(ph['x'], ph['y'] - 40, ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold the lighthouse — its sheet (chord)'
    await p.shot('portus-sheet'); await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    a = await p.js('()=>t2d.portus.col(2, 0)'); await p.tap(a['x'], a['y'] - 4); await p.pg.wait_for_timeout(200)
    assert 2 not in await p.js('()=>t2d.portus.steps'), 'tap an island — it sinks'
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(3000)
    n = await p.js('()=>t2d.portus.isles.length'); assert 3 <= n <= 8, f'dice — a lane of stabs: {n}'
    print('  portus level, dice:', round(await p.js('()=>T2D.level'), 3)); await p.shot('portus')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.portus.isles.length') == 0, 'trash — the bay is empty'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.portus.isles.length') == n, 'undo brings the islands back'
    M = await p.js('()=>t2d.portus.geo().moon'); await p.tap(M['x'] + M['r'] * 0.5, M['y']); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the moon — map'


async def sc_dlc(p):                               # DLC vol. I: 7 тапов по UNIVERSUM — другая колода (Prisma, Harmonica vitrea), свой микшер; ещё 7 — назад
    if await p.js('()=>t2d.hidden.includes(17)'): print('  DLC vol. I closed — skipped'); return
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.deck') == 'main', 'starts on the main deck'
    y = await p.js('()=>t2d.scopeY()') + 11
    for _ in range(6): await p.tap(195, y); await p.pg.wait_for_timeout(120)
    assert await p.js('()=>t2d.deck') == 'main', 'six taps — nothing yet'
    await p.tap(195, y); await p.pg.wait_for_timeout(400)
    assert await p.js('()=>t2d.deck') == 'dlc1', 'seventh tap — DLC vol. I'
    await p.shot('dlc-map')
    q = await p.js('()=>t2d.mapCell(2, 1)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.world') == 18, 'the DLC card opens its world'
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    rows = await p.js('()=>t2d.mixRows()'); assert rows == [17, 18], f'the DLC mixer has its own worlds: {rows}'
    for _ in range(7): await p.tap(195, y); await p.pg.wait_for_timeout(120)
    await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.deck') == 'main', 'seven taps again — back to Universum'
    rows = await p.js('()=>t2d.mixRows()'); assert 1 in rows and 17 not in rows, f'the main mixer: {rows}'


async def sc_prisma(p):                            # Prisma: отверстие — свет и звук, вверх — выше; призма вбок — цвет, вниз — веер (растяжка); тап по лучу — заслонка; плашка; кубик; корзина; отмена; солнце — карта
    if await p.js('()=>t2d.hidden.includes(17)'): print('  DLC vol. I closed — skipped'); return
    await p.js("()=>t2d.setDeck('dlc1')"); await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    q = await p.js('()=>t2d.mapPanel(17)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 17], 'the card opens Prisma'
    G = await p.js('()=>t2d.prisma.geo()')
    await p.tap(G['wallX'], G['holeY']); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.prisma.st.on'), 'tap the hole — light'
    lv = await p.js('()=>T2D.level'); print('  prisma level:', round(lv, 3)); assert lv > 0.02, f'the beam is heard: {lv}'
    f0 = await p.js('()=>t2d.prisma.f0()'); pid = await p.hold(G['wallX'], G['holeY'], ms=60); await p.drag(pid, G['wallX'], G['holeY'], G['wallX'], G['holeY'] - 90, steps=8); await p.up()
    f1 = await p.js('()=>t2d.prisma.f0()'); assert f1 > f0 * 1.2, f'hole up — higher: {f0} -> {f1}'
    a0 = await p.js('()=>t2d.prisma.amps().indexOf(Math.max(...t2d.prisma.amps()))')
    pid = await p.hold(G['px'], G['py'], ms=60); await p.drag(pid, G['px'], G['py'], G['px'] + 110, G['py'], steps=8); await p.up()
    a1 = await p.js('()=>t2d.prisma.amps().indexOf(Math.max(...t2d.prisma.amps()))'); assert a1 > a0, f'prism sideways — brighter harmonics move up: {a0} -> {a1}'
    pid = await p.hold(G['px'], G['py'], ms=60); await p.drag(pid, G['px'], G['py'], G['px'], G['py'] + 110, steps=8); await p.up()
    sx = await p.js('()=>t2d.prisma.st.stretch'); assert sx > 0.5, f'prism down — the fan opens: {sx}'
    await p.pg.wait_for_timeout(300); await p.shot('prisma')
    r = await p.js('()=>t2d.prisma.rays()[4]'); x = r['x0'] + (r['x1'] - r['x0']) * 0.75; y = r['y0'] + (r['y1'] - r['y0']) * 0.75
    await p.tap(x, y); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>t2d.prisma.blocked[4]'), 'tap a ray — its shutter'
    await p.js("()=>t2d.prisma.blocked.fill(false)")
    G = await p.js('()=>t2d.prisma.geo()')
    for u in (-0.5, 0.2, 0.6): await p.tap(G['screenX'] - 12, G['py'] + u * G['band']); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.prisma.pend.length') == 3, 'tap by the wall — crystals hang'
    await p.tap(G['px'], G['py']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.prisma.st.motor'), 'tap the prism — motor'
    await p.js("()=>{t2d.prisma.st.speed=0.8}"); await p.pg.wait_for_timeout(5000)
    rn = await p.js('()=>t2d.prisma.rings'); print('  crystals rung:', rn); assert rn >= 3, f'the sweeping fan rings the crystals: {rn}'
    await p.shot('prisma-motor')
    await p.tap(G['px'], G['py']); await p.pg.wait_for_timeout(200)
    assert not await p.js('()=>t2d.prisma.st.motor'), 'tap again — motor stops'
    await p.hold(G['px'], G['py'], ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold the prism — its sheet'
    await p.shot('prisma-sheet'); await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(1200)
    assert await p.js('()=>t2d.prisma.st.on'), 'dice — light'
    await p.shot('prisma-dice')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(3000)
    assert not await p.js('()=>t2d.prisma.st.on'), 'trash — dark'
    lv = await p.js('()=>T2D.level'); assert lv < 0.01, f'after trash it is silent: {lv}'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.prisma.st.on'), 'undo — light again'
    S = await p.js('()=>t2d.prisma.geo().sun'); await p.tap(S['x'] + 18, S['y'] + 22); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the sun — map'


async def sc_vitrea(p):                            # Harmonica vitrea: трёшь обод — поёт; вода — ниже; тап — звон; двойной тап — поёт сам; плашка; кубик; корзина; отмена; луна — карта
    if await p.js('()=>t2d.hidden.includes(17)'): print('  DLC vol. I closed — skipped'); return
    await p.js("()=>t2d.setDeck('dlc1')"); await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    q = await p.js('()=>t2d.mapPanel(18)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 18], 'the card opens Vitrea'
    G = await p.js('()=>t2d.vitrea.geo()'); x2 = G['gl'][2]['x']; ry = G['rimY']; hw = G['bw'] / 2 - 4
    pid = await p.hold(x2, ry, ms=40)
    for i in range(10): await p.drag(pid, x2 - hw if i % 2 else x2 + hw, ry, x2 + hw if i % 2 else x2 - hw, ry, steps=4)
    en = await p.js('()=>t2d.vitrea.glasses[2].en'); lv = await p.js('()=>T2D.level'); print('  rubbing: energy', round(en, 2), 'level', round(lv, 3))
    assert en > 0.3 and lv > 0.01, f'rub the rim — it sings: {en} {lv}'
    await p.shot('vitrea-rub'); await p.up(); await p.pg.wait_for_timeout(300)
    x3 = G['gl'][3]['x']; f0 = await p.js('()=>t2d.vitrea.freq(t2d.vitrea.glasses[3])')
    yb = G['rimY'] + G['bh'] - 8; pid = await p.hold(x3, yb, ms=40); await p.drag(pid, x3, yb, x3, G['rimY'] + 22, steps=8); await p.up()
    f1 = await p.js('()=>t2d.vitrea.freq(t2d.vitrea.glasses[3])'); assert f1 < f0 * 0.9, f'more water — lower: {f0} -> {f1}'
    await p.tap(x3, G['rimY'] + G['bh'] * 0.6); await p.pg.wait_for_timeout(120)
    assert await p.js('()=>t2d.vitrea.glasses[3].en') > 0.3, 'tap a glass — it rings'
    x4 = G['gl'][4]['x']; await p.tap(x4, ry); await p.pg.wait_for_timeout(90); await p.tap(x4, ry); await p.pg.wait_for_timeout(1500)
    assert await p.js('()=>t2d.vitrea.glasses[4].pin'), 'double-tap a rim — it sings by itself'
    lv = await p.js('()=>T2D.level'); print('  vitrea level, one glass by itself:', round(lv, 3)); assert lv > 0.01, f'pinned glass is heard: {lv}'
    await p.shot('vitrea')
    await p.tap(x4, ry); await p.pg.wait_for_timeout(90); await p.tap(x4, ry); await p.pg.wait_for_timeout(300)
    xs = [G['gl'][k]['x'] for k in (0, 1, 2)]
    pid = await p.hold(xs[0], ry, ms=40)
    for i in range(3):
        for j in range(6): await p.drag(pid, xs[i] - 8 if j % 2 else xs[i] + 8, ry, xs[i] + 8 if j % 2 else xs[i] - 8, ry, steps=3)
        if i < 2: await p.drag(pid, xs[i], ry, xs[i + 1], ry, steps=5)
    await p.up(); await p.pg.wait_for_timeout(200)
    lp = await p.js('()=>t2d.vitrea.loop && t2d.vitrea.loop.seq.map(q=>q.k)'); print('  finger path:', lp); assert lp == [0, 1, 2], f'rub rim to rim — a path loops: {lp}'
    await p.pg.wait_for_timeout(1500); en = await p.js('()=>Math.max(...t2d.vitrea.glasses.slice(0,3).map(g=>g.en))'); assert en > 0.2, f'the ghost rubs the path: {en}'
    await p.tap(195, G['rimY'] - 150); await p.pg.wait_for_timeout(3500)
    dn = await p.js('()=>t2d.vitrea.drops'); print('  raindrops landed:', dn); assert dn >= 2 and await p.js('()=>t2d.vitrea.fx.pluvia') > 0, f'tap the sky — rain: {dn}'
    await p.shot('vitrea-rain')
    await p.tap(195, G['rimY'] - 150); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>t2d.vitrea.fx.pluvia') == 0, 'tap the sky again — rain stops'
    await p.hold(G['gl'][1]['x'], G['rimY'] + G['bh'] * 0.5, ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold a glass — its sheet'
    await p.shot('vitrea-sheet'); await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(1500)
    n = await p.js('()=>t2d.vitrea.glasses.filter(g=>g.pin).length'); assert 1 <= n <= 2, f'dice — one or two glasses sing: {n}'
    print('  vitrea level, dice:', round(await p.js('()=>T2D.level'), 3)); await p.shot('vitrea-dice')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.vitrea.glasses.filter(g=>g.pin).length') == 0, 'trash — fingers off'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.vitrea.glasses.filter(g=>g.pin).length') == n, 'undo — they sing again'
    m = await p.js('()=>t2d.vitrea.geo().moon'); await p.tap(m['x'], m['y']); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the moon — map'
    await p.shot('vitrea-map')


async def sc_goetia(p):                            # Goetia: печать от знака к знаку — дух звучит и встаёт в треугольник; треугольник вверх — выше, влево — удары (release); плашка; тап — изгнать; четвёртый гонит старого; кубик; корзина; отмена; сосуд — карта
    await p.js('()=>t2d.goMap()'); await p.pg.wait_for_timeout(900)
    q = await p.js('()=>t2d.mapPanel(15)'); await p.tap(q[0] + q[2] / 2, q[1] + q[3] / 2); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 15], 'the card opens Goetia'
    for _ in range(30):
        if await p.js('()=>t2d.goe.ready'): break
        await p.pg.wait_for_timeout(100)
    a, b, c = [await p.js(f'()=>t2d.goe.node({k})') for k in (1, 0, 5)]
    for _ in range(30):
        if await p.js('()=>t2d.goe.core') == 'wasm': break
        await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.goe.core') == 'wasm', 'the sound comes from the WASM core'
    pid = await p.hold(a['x'], a['y'], ms=60)
    await p.drag(pid, a['x'], a['y'], b['x'], b['y'], steps=8)
    assert await p.js('()=>t2d.goe.spirits.length') == 1, 'second sign — a spirit answers while you draw'
    await p.drag(pid, b['x'], b['y'], c['x'], c['y'], steps=10); await p.pg.wait_for_timeout(300)
    await p.shot('goetia-drawing'); await p.up(); await p.pg.wait_for_timeout(1200)
    path = await p.js('()=>t2d.goe.spirits[0].path'); assert path == [1, 0, 5], f'the seal is the path: {path}'
    f = await p.js('()=>t2d.goe.formula(t2d.goe.spirits[0].path)'); print('  seal', path, f, '—', await p.js('()=>t2d.goe.name(t2d.goe.spirits[0])'))
    lv = await p.js('()=>T2D.level'); print('  goetia level, one spirit:', round(lv, 3)); assert lv > 0.02, f'the spirit is heard: {lv}'
    await p.shot('goetia-seal')
    r0 = await p.js('()=>t2d.goe.rate(t2d.goe.spirits[0])'); t = await p.js('()=>t2d.goe.tri(0)')
    pid = await p.hold(t['x'], t['y'], ms=60); await p.drag(pid, t['x'], t['y'], t['x'], t['y'] - 64, steps=8); await p.up(); await p.pg.wait_for_timeout(200)
    r1 = await p.js('()=>t2d.goe.rate(t2d.goe.spirits[0])'); assert r1 > r0 * 1.2, f'drag the triangle up — higher: {r0} -> {r1}'
    pid = await p.hold(t['x'], t['y'], ms=60); await p.drag(pid, t['x'], t['y'], t['x'] - 130, t['y'], steps=8); await p.up(); await p.pg.wait_for_timeout(400)
    rel = await p.js('()=>t2d.goe.spirits[0].rel'); assert rel < 0.25, f'drag the triangle left — short release: {rel}'
    gs = []
    for _ in range(14): gs.append(await p.js('()=>t2d.goe.gains[t2d.goe.spirits[0].slot]')); await p.pg.wait_for_timeout(45)
    print('  strikes, voice level min/max:', round(min(gs), 3), round(max(gs), 3)); assert max(gs) > 0.05 and min(gs) < max(gs) * 0.5, f'short release — strikes, not a drone: {gs}'
    await p.shot('goetia-strikes')
    await p.hold(t['x'], t['y'], ms=900); await p.up(); await p.pg.wait_for_timeout(150)
    assert await p.js('()=>T2D.sheetOpen'), 'hold a triangle — its sheet'
    await p.shot('goetia-sheet'); await p.tap(200, 120); await p.pg.wait_for_timeout(150)
    await p.tap(t['x'], t['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.goe.spirits.length') == 0, 'tap the triangle — banished'
    await p.js('()=>{for (const s of [[0,1],[2,3],[4,5],[6,7]]) t2d.goe.seal(s)}')
    sl = await p.js('()=>t2d.goe.spirits.map(s=>s.path[0]).sort()'); assert sl == [2, 4, 6], f'a fourth spirit drives out the oldest: {sl}'
    d = await p.js("()=>t2d.btnPos('dice')"); await p.tap(d['x'], d['y']); await p.pg.wait_for_timeout(1800)
    n = await p.js('()=>t2d.goe.spirits.length'); assert 2 <= n <= 3, f'dice — two or three spirits: {n}'
    assert await p.js("()=>t2d.worlds[15].fx.sectors.length") == 4, 'FX: legio, echo, spread, hall'
    print('  goetia level, dice:', round(await p.js('()=>T2D.level'), 3)); await p.shot('goetia')
    c = await p.js("()=>t2d.btnPos('clr')"); await p.tap(c['x'], c['y']); await p.pg.wait_for_timeout(3000)
    assert await p.js('()=>t2d.goe.spirits.length') == 0, 'trash — every spirit is banished'
    lv = await p.js('()=>T2D.level'); assert lv < 0.01, f'after trash it is silent: {lv}'
    u = await p.js("()=>t2d.btnPos('undo')"); await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(200)
    assert await p.js('()=>t2d.goe.spirits.length') == n, 'undo summons them back'
    v = await p.js('()=>t2d.goe.geo().vessel'); await p.tap(v['x'], v['y']); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the brass vessel — map'
    await p.shot('goetia-map')
    await p.js('()=>t2d.restartAudio()'); await p.pg.wait_for_timeout(2500)
    await p.js('()=>t2d.go(15)'); await p.pg.wait_for_timeout(500)
    for _ in range(30):
        if await p.js('()=>t2d.goe.core') == 'wasm': break
        await p.pg.wait_for_timeout(100)
    await p.pg.wait_for_timeout(1500)
    lv = await p.js('()=>T2D.level'); print('  goetia level after restart audio:', round(lv, 3))
    assert await p.js('()=>t2d.goe.core') == 'wasm' and lv > 0.02, f'after restart audio the core is back: {lv}'


async def sc_nav(p):                               # стрелка у названия — карта; свайп от левого края — карта; на карте звучащий мир в лучах; concordia → микшер: фейдер, mute, мастер
    await p.js('()=>t2d.go(10)'); await p.pg.wait_for_timeout(300)
    B = await p.js('()=>t2d.backPos()'); await p.tap(B['x'], B['y']); await p.pg.wait_for_timeout(900)
    assert await p.js('()=>t2d.view') == 'map', 'tap the back arrow — map'
    await p.js('()=>t2d.go(12)'); await p.pg.wait_for_timeout(300); await p.shot('nav-arrow')
    a = await p.js('()=>t2d.arc.at(0.2, -0.4)'); await p.tap(a['x'], a['y']); await p.pg.wait_for_timeout(1200)
    pid = await p.hold(4, 500, ms=40); await p.drag(pid, 4, 500, 140, 510, steps=8); await p.up(); await p.pg.wait_for_timeout(1500)
    assert await p.js('()=>t2d.view') == 'map', 'swipe from the left edge — map'
    lv = await p.js('()=>t2d.chanLvl[12]'); print('  arcadia channel level on the map:', round(lv or 0, 4)); assert lv and lv > 0.003, f'the sounding world has a level: {lv}'
    await p.shot('nav-map-live')
    S = await p.js('()=>t2d.mapSun()'); await p.tap(S['x'], S['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.nav.settings') is True, 'tap the sun — concordia'
    await p.shot('nav-concordia')
    sy = S['y']
    # найти строку mixer: перебором по высоте, пока не откроется
    opened = False
    for dy in range(150, 330, 8):
        await p.tap(200, sy + dy); await p.pg.wait_for_timeout(80)
        st = await p.js('()=>t2d.nav.settings')
        if st == 'mix': opened = True; break
        if st is not True: await p.tap(S['x'], S['y']); await p.pg.wait_for_timeout(80)
    assert opened, 'concordia → mixer'
    await p.pg.wait_for_timeout(400); await p.shot('nav-mixer')
    g = await p.js('()=>t2d.mixGeo()'); r = next(q for q in g['rows'] if q['n'] == 12)
    x0 = g['tx0'] + (g['tx1'] - g['tx0']) * (36 / 42)
    pid = await p.hold(x0, r['y'], ms=40); await p.drag(pid, x0, r['y'], x0 - 60, r['y'], steps=6); await p.up(); await p.pg.wait_for_timeout(200)
    gn = await p.js('()=>t2d.chanGains[12]'); assert gn < 0.7, f'drag the Arcadia fader left — quieter: {gn}'
    await p.tap(g['mx'], r['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.mix.mute[12]') and await p.js('()=>t2d.chanGains[12]') < 0.01, 'tap mute — silent'
    m = g['mr'][0]; pid = await p.hold(g['tx1'] - 2, m['y'], ms=40); await p.drag(pid, g['tx1'] - 2, m['y'], g['tx1'] - 120, m['y'], steps=6); await p.up()
    assert await p.js('()=>t2d.mix.lpf') < 0.8, 'master low-pass closes'
    await p.shot('nav-mixer-set')
    await p.tap(5, 5); await p.pg.wait_for_timeout(100)
    assert await p.js('()=>t2d.nav.settings') is True, 'tap outside the mixer — back to concordia'


SCENARIOS = {'webmidi': sc_webmidi, 'midi': sc_midi, 'audiopanel': sc_audiopanel, 'dlc': sc_dlc, 'prisma': sc_prisma, 'vitrea': sc_vitrea, 'goetia': sc_goetia, 'nav': sc_nav, 'portus': sc_portus, 'arcadia': sc_arcadia, 'audio': sc_audio, 'tria': sc_tria, 'triaenergy': sc_triaenergy, 'firmamentum': sc_firmamentum, 'horologium': sc_horologium, 'oceanus': sc_oceanus, 'monochord': sc_monochord, 'paradisus': sc_paradisus, 'inferno': sc_inferno, 'legenda': sc_legenda, 'startmap': sc_startmap, 'cymx': sc_cymx, 'natura': sc_natura, 'lab': sc_lab, 'sketches': sc_sketches, 'handpan': sc_handpan, 'ampoff': sc_ampoff, 'echo': sc_echo, 'scalepinch': sc_scalepinch, 'grid': sc_grid, 'relative': sc_relative, 'entry': sc_entry, 'twist': sc_twist, 'seq': sc_seq, 'orphan': sc_orphan, 'plate': sc_plate, 'hold': sc_hold, 'undo': sc_undo, 'solniger': sc_solniger, 'vol': sc_vol, 'planets': sc_planets, 'ring': sc_ring, 'worlds': sc_worlds, 'sun': sc_sun, 'hole': sc_hole}


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
            if n != 'startmap': await pg.evaluate('()=>t2d.go(1)')   # приложение открывается на карте; сценарии начинают в Tenebrae
            try:
                await SCENARIOS[n](Phone(pg, await c.new_cdp_session(pg)))
            except Exception as e:                  # проверка не прошла или сценарий упал
                print(n, 'FAILED:', type(e).__name__, e); failed = True
            print(n, 'errors:', errs)
            if errs: failed = True
            await b.close()
    sys.exit(1 if failed else 0)

asyncio.run(main(sys.argv[1:] or list(SCENARIOS)))

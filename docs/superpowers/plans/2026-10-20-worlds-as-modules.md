# Миры модулями — план реализации (подпроект 1 из 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Карта Universum снова включена; Sol Niger работает как раньше, но через общий интерфейс мира; Cymatica — второй мир в четверти II (пока пустая пластина с резонатором Гельмгольца, без звука); III и IV — бледные гравюры *nondum*, не открываются.

**Architecture:** `app.js` (одна IIFE) становится хозяином: реестр миров, общая верхняя строка, общая отмена/корзина/кубик/FX по текущему миру, карта. Sol Niger оборачивается в объект мира тонким адаптером над существующими функциями (без переписывания). Новый файл `cymatica.js` — отдельная IIFE, регистрирует мир через глобальный `T2D`.

**Tech Stack:** ванильный JS (Web Audio, canvas 2D), без сборки и зависимостей; проверка — `node --check`, Playwright-сценарии `tools/shot.py` (headless Chromium, касания через CDP).

**Spec:** `docs/superpowers/specs/2026-10-20-cymatica-design.md`, часть 1 «Миры модулями».

## Global Constraints

- Одна страница без сборки: `index.html` + обычные скрипты; новые файлы — в `SHELL` (`sw.js`) и с тем же `?v=` в `index.html`.
- При выкладке поднять **вместе** `CACHE` в `sw.js` и `?v=` у всех скриптов в `index.html` (одно число; сейчас 44 → 45).
- На экране — только английский/латынь; заголовок мира — его `title` («Sol Niger», «Cymatica»).
- Мир I — строго ч/б (`INK = 237,237,237` на чёрном); Cymatica пока тоже ч/б.
- Один шрифт — IM Fell English (`MAP`); без `shadowBlur`, без полноэкранных проходов в кадре сверх существующих.
- Звук не прерывается при переходах; все миры звучат одновременно.
- Комментарии в коде — по-русски, в стиле файла; коммиты — по-английски, тело-список, с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `node --check app.js && node --check cymatica.js` перед каждым коммитом.

## Review Focus

1. Палец лёг в одном мире, а мир сменился до того, как его отпустили (второй палец тапнул солнце) — отпускание обрабатывает тот мир, где касание началось, без ошибок (`f.world`). Тест — в Task 2.
2. Сервис-воркер перезагружает страницу «когда ничего не звучит» — проверка должна учитывать все миры, не только голоса Sol Niger (`t2d.sounding()`). Тест — в Task 2.
3. Отмена в Cymatica не трогает Sol Niger (у каждого мира своя история). Тест — в Task 2.
4. Колесо/щипок тачпада в Cymatica не меняет зум Sol Niger. Тест — в Task 2.
5. Смена размера окна, пока открыта карта или Cymatica, — без ошибок, снимки миров масштабируются. Тест — в Task 2.

---

### Task 1: Хозяин миров и адаптер Sol Niger (поведение не меняется)

**Files:**
- Modify: `app.js` — реестр миров, адаптер `solNiger`, разбиение `frame` на `tick`/`draw`, маршрутизация касаний/колеса, общая отмена, `T2D`, `t2d`.
- Modify: `tools/shot.py` — сценарий `solniger` с проверками.

**Interfaces:**
- Produces (в `app.js`):
  - `const worlds = {}`; `function registerWorld(n /* 1..4 */, w)`; `const cur = () => worlds[nav.world]`.
  - Интерфейс мира (поля, которые читает хозяин): `n, title, sub`, `corner: { hit(f) → bool, draw(now) }`, `fx: null | { sectors, get(k), set(k, t), text(k), arc() → 0..1, save() → obj, load(obj) }`, `tick?(now, dt)`, `draw(now, dt)`, `down(f)`, `move(f)`, `up(f)`, `wheel?(e)`, `dice()`, `clear()`, `snapshot() → string`, `restore(string)`, `sounding() → bool`, `enter?()`, `leave?()`.
  - Объект `solNiger` с этим интерфейсом, `registerWorld(1, solNiger)`.
  - Общая отмена: `hists = {}` (n → массив строк), `lasts = {}`; `commit()`, `undo()` работают с `cur()`; `UNDO_MAX = 10`.
  - `window.T2D = { registerWorld, get g(), get W(), get H(), get DPR(), get topY(), get safeBot(), get level(), BG, MAP, ink, ring, dot, text, glowAt, hairBox }` — создаётся до первого кадра; `topY` = `scopeY + 44` (низ верхней строки), `level` = `sunLevel`.
  - `window.t2d` дополняется: `worlds`, `get world() { return nav.world }`, `get view() { return nav.view }`, `hist: (n) => (hists[n] || []).length`, `sounding: () => Object.values(worlds).some((w) => w.sounding())`.

- [ ] **Step 1: Сценарий `solniger` в `tools/shot.py` (пока падает)**

```python
async def sc_solniger(p):                          # Sol Niger через интерфейс мира: всё как раньше
    assert await p.js('()=>t2d.world') == 1
    await p.pin(150, 600)
    assert await p.js('()=>t2d.hist(1)') == 1, 'pin -> one undo step'
    assert await p.js('()=>t2d.sounding()'), 'pinned planet sounds'
    u = await p.js("()=>t2d.btnPos('undo')")
    await p.tap(u['x'], u['y']); await p.pg.wait_for_timeout(300)
    assert await p.js('()=>t2d.voices.filter(v=>v.active&&v.pinned).length') == 0, 'undo removes the pin'
```

Добавить `'solniger': sc_solniger` в `SCENARIOS`. Сделать так, чтобы исключение в сценарии печатало имя сценария и завершало `main` с ненулевым кодом (обернуть вызов сценария: `try/except AssertionError` → `print(f'{n} FAILED: {e}')`, `failed = True`; в конце `sys.exit(1 if failed else 0)`), а непустой список `errors` тоже считался провалом.

- [ ] **Step 2: Прогнать — падает**

Run: `python3 -m http.server 8765 &` (если не запущен), затем `python3 tools/shot.py solniger`
Expected: `solniger FAILED` (нет `t2d.world` / `t2d.hist`), код выхода 1.

- [ ] **Step 3: Реестр, адаптер, общая отмена, маршрутизация в `app.js`**

- Адаптер `solNiger` собирать из существующих функций: `fx.get/set/text` = `fxGet/fxSet/fxText`, `fx.sectors` = `FX_SECTORS`, `fx.arc` = `() => fx.rev`, `fx.save/load` — копия/`Object.assign(fx, o); applyFx()` (это то, что сейчас делает `restore` в `openFx`); `dice` = `rollDice`; `clear` = `clearAll`; `snapshot/restore` — существующие; `sounding` = `() => V.some((v) => v.active)`; `wheel` = `wheelZoom`; `corner.hit` = `(f) => WORLDS_ON && !editor && Math.hypot(f.x - geo.ox, f.y - geo.oy) < 46`; `corner.draw` — пустая (солнце рисует `drawField`).
- `frame`: всё, что сейчас до проверки `drawNav`, — `solNiger.tick(now, dt)`; всё от `drawField()` до `drawHeld`/`drawLfoPanel`/`drawAmpStrip`/`drawCloseChip` включительно — `solNiger.draw(now, dt)`. В `frame` остаются: вызов `tick` у **всех** миров, `drawNav`, `cur().draw(now, dt)`, затем общие `drawUI()`, веер FX, `drawStrain()`, `measureStrain`.
- Касания: в `down` запомнить `f.world = nav.world`; после `navDown` и общего `uiHit` → `worlds[f.world].down(f)`. Нынешнее тело `down` после `uiHit` — это `solNiger.down`. В `move`/`up`: после ветки `f.ui` → `worlds[f.world].move/up(f)`; нынешние тела — `solNiger.move/up`.
- `uiHit`: сначала общие (громкость, кнопки строки), затем `cur().corner.hit(f)` → `{ k: 'corner' }` (в `uiDown`: `goMap()`), затем — только если `nav.world === 1` — нынешние хиты Sol Niger (призрак-булавка, кольца, редактор). Кнопка `rev` хитится, только если `cur().fx`.
- `openFx`: лучи и функции — из `cur().fx`, откат — `fx.load(fx.save())` текущего мира.
- Кнопки: `clr` → `cur().clear()`, `dice` → `cur().dice()`, `undo` → общий `undo()`; точки под отменой — по `hists[nav.world]`.
- Общая отмена: перенести `hist/lastState/commit/undo` на `hists[n]/lasts[n]` с `cur().snapshot()/restore()`; `lasts[n]` инициализировать при `registerWorld`.
- Колесо: `cv` `wheel` → `e.preventDefault()`; если `nav.view === 'play'` → `cur().wheel?.(e)`. `gesturechange` (Safari) зумит только при `nav.world === 1`. Лассо в тулбоксе лада — только при `nav.world === 1`.
- `drawUI`: заголовок — `cur().title`; кнопка FX без `cur().fx` — тусклая (как отмена без истории), без дуги; дуга — `cur().fx.arc()`.
- `T2D` и новые поля `t2d` — как в Interfaces; `index.html` проверку тишины перевести на `t2d.sounding()`.

- [ ] **Step 4: Прогнать всё**

Run: `node --check app.js && python3 tools/shot.py`
Expected: все сценарии (`vol, planets, ring, map, sun, hole, solniger`) без `FAILED`, у каждого `errors: []`, код выхода 0. Скриншоты `.shots/planets.png`, `.shots/ring.png` глазами — как до правки.

- [ ] **Step 5: Commit**

```bash
git add app.js tools/shot.py index.html
git commit -m "Worlds host: registry, Sol Niger adapter, per-world undo"   # тело-список + Co-Authored-By
```

---

### Task 2: Cymatica в четверти II, карта снова включена, выкладка

**Files:**
- Create: `cymatica.js` — мир II.
- Modify: `app.js` — `WORLDS_ON = true`, карта (`WORLDS`, `navDown`, `goMap`, `goWorld`, `drawNav`, `drawMapChrome`, снимки миров), `ART_SRC` без Кирхера.
- Modify: `index.html` — `<script src="cymatica.js?v=45">` после `app.js`, `app.js?v=45`.
- Modify: `sw.js` — `CACHE = 't2d-v45'`, `./cymatica.js` в `SHELL`; в `STATIC` вернуть `./art/leo-viridis.png`, `./art/leo-viridis-wash.png`, `./art/fons-mercurialis.png`, `./art/terra-octobre.jpg` (без Кирхера); массив `ART` убрать.
- Modify: `tools/shot.py` — сценарий `worlds`; сценарий `map` переписать под новую карту.
- Modify: `README.md`, `CLAUDE.md`, `ROADMAP.md`.

**Interfaces:**
- Consumes: `T2D`, `registerWorld`, интерфейс мира, `t2d.world/view/hist/sounding` (Task 1).
- Produces:
  - `cymatica.js`: мир `{ n: 'II', title: 'Cymatica', sub: 'figurae sonorae', fx: null, ... }`, `T2D.registerWorld(2, cymatica)`; `function plateGeo() → { cx, cy, r }` (r = `min(W / 2 - 44, (H - safeBot - topY) / 2 - 44)`, cx = `W / 2`, cy = `topY + (H - safeBot - topY) / 2`); `corner.hit(f)` — `hypot(f.x - W, f.y - (H - safeBot)) < 46`.
  - В `app.js`: `snaps = {}` (n → canvas), `const ENTER = new Set([1, 2])`.

- [ ] **Step 1: Сценарий `worlds` (пока падает)**

```python
async def sc_worlds(p):
    await p.pin(150, 600)                                  # Sol Niger: закреплённая планета
    a, b = {'x': 200, 'y': 450, 'id': 1}, {'x': 10, 'y': 844 - 8, 'id': 2}
    await p.T('touchStart', [a]); await p.pg.wait_for_timeout(60)        # палец держит новую планету...
    await p.T('touchStart', [a, b]); await p.pg.wait_for_timeout(60)     # ...второй — солнце: карта
    await p.T('touchEnd', [a]); await p.pg.wait_for_timeout(800)
    assert await p.js('()=>t2d.view') == 'map'
    await p.T('touchEnd', []); await p.pg.wait_for_timeout(200)          # первый отпущен уже на карте — без ошибок
    await p.tap(100, 600); await p.pg.wait_for_timeout(800)  # четверть III — не открывается
    assert await p.js('()=>t2d.view') == 'map'
    await p.tap(100, 200); await p.pg.wait_for_timeout(800)  # четверть II — Cymatica
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 2]
    await p.shot('cymatica')
    assert await p.js('()=>t2d.voices.some(v=>v.active&&v.pinned&&v.env>0.5)'), 'Sol Niger keeps sounding'
    assert await p.js('()=>t2d.sounding()')
    z = await p.js('()=>t2d.zoom'); await p.pg.mouse.move(200, 400); await p.pg.mouse.wheel(0, -300)
    assert await p.js('()=>t2d.zoom') == z, 'wheel in Cymatica keeps Sol Niger zoom'
    await p.tap(await p.js("()=>t2d.btnPos('undo').x"), await p.js("()=>t2d.btnPos('undo').y"))
    assert await p.js('()=>t2d.voices.some(v=>v.active&&v.pinned)'), 'undo in Cymatica leaves Sol Niger alone'
    await p.tap(await p.js("()=>t2d.btnPos('rev').x"), await p.js("()=>t2d.btnPos('rev').y"))   # FX без набора — ничего
    await p.pg.set_viewport_size({'width': 430, 'height': 900}); await p.pg.wait_for_timeout(300)
    await p.pg.set_viewport_size({'width': 390, 'height': 844}); await p.pg.wait_for_timeout(300)
    await p.tap(390 - 10, 844 - 8); await p.pg.wait_for_timeout(800)   # резонатор — карта
    assert await p.js('()=>t2d.view') == 'map'
    await p.shot('map')
    await p.tap(300, 200); await p.pg.wait_for_timeout(800)             # четверть I
    assert await p.js('()=>[t2d.view, t2d.world]') == ['play', 1]
```

Сценарий `map` заменить на `worlds` (старый сценарий входил в III и IV). `'worlds': sc_worlds` в `SCENARIOS`.

- [ ] **Step 2: Прогнать — падает**

Run: `python3 tools/shot.py worlds`
Expected: `worlds FAILED` (карта выключена: `view` остаётся `'play'`), код 1.

- [ ] **Step 3: `cymatica.js`**

IIFE с `'use strict'`, в стиле `app.js` (секции `// ---------- … ----------`, комментарии по-русски). Мир без звука: `down/move/up/dice/clear/restore` — пустые, `snapshot` → `'{}'`, `sounding` → `false`, `fx: null`. `draw(now)`: фон `T2D.BG`; пластина — двойная гравированная окружность (`ring` r и r + 3, альфы ~0.55 и 0.25) с засечками по внешней через 6°; резонатор Гельмгольца — `corner.draw(now)`: в правом нижнем углу (центр `W, H - safeBot`) видна четверть шара: двойная дуга радиуса 34 и 30, штриховка 5–6 дуг, горлышко — короткая трубка (две линии и кольцо) от шара к центру экрана (угол 225°); яркость линий дышит `T2D.level`, как солнце. Рисовать в `draw` после пластины.

- [ ] **Step 4: Карта в `app.js`**

- `WORLDS_ON = true`; `WORLDS[2] = { n: 'II', title: 'Cymatica', sub: 'figurae sonorae' }` (карта берёт подписи из реестра для 1–2, из `WORLDS` для 3–4).
- `goMap()`: снимок текущего мира в `snaps[nav.world]` (копия `cv`, как сейчас `snapC`), `cur().leave?.()`.
- `navDown` на карте: солнце в центре → обратно в `nav.world`; четверть `w` → `goWorld(w)` только если `ENTER.has(w) && worlds[w]`, иначе ничего.
- `goWorld(w)`: как сейчас; по окончании анимации `nav.view = 'play'`, `nav.world = w`, `worlds[w].enter?.()`. Вида `'world'` (гравюра во весь экран) больше нет.
- `drawNav`: картинка четверти — `snaps[w]` для 1–2 (нет снимка — чёрная), `artFor(w)` для 3–4 с `globalAlpha = 0.35 * out`; `drawMapChrome` для 3–4 добавляет под подписью `nondum` (`mapText`, 13 px, альфа 0.5).
- `ART_SRC` — без `kircher`.

- [ ] **Step 5: Прогнать всё и посмотреть**

Run: `node --check app.js && node --check cymatica.js && python3 tools/shot.py`
Expected: все сценарии без `FAILED`, `errors: []`, код 0. Глазами: `.shots/cymatica.png` — пластина посередине, четверть резонатора справа внизу, заголовок «Cymatica», кнопка FX тусклая; `.shots/map.png` — I и II живые снимки, III и IV бледные с *nondum*.

- [ ] **Step 6: Документация**

- `README.md`: карта Universum снова открывается тапом по солнцу; II · Cymatica — модальный мир (пока пустая пластина, резонатор Гельмгольца в углу открывает карту); III и IV — *nondum*; Cabbala заменена на Cymatica.
- `CLAUDE.md`: раздел «Код: где что» — реестр миров, интерфейс мира, `T2D`, `cymatica.js`; убрать «Сейчас выключена (`WORLDS_ON = false`…)»; сценарий `shot.py worlds`.
- `ROADMAP.md`: II — Cymatica (ссылка на спеку), Cabbala — снята с карты (гравюра остаётся в `art/`).

- [ ] **Step 7: Commit, push, проверить выкладку**

```bash
git add app.js cymatica.js index.html sw.js tools/shot.py README.md CLAUDE.md ROADMAP.md
git commit -m "Universum back on: Cymatica in quadrant II, III and IV nondum"   # тело-список + Co-Authored-By
git push
```

Run: `curl -s https://api.github.com/repos/ai-slopes-hq/touch2decay/commits/$(git rev-parse HEAD)/status | python3 -c "import json,sys;print(json.load(sys.stdin)['state'])"` (повторять, пока `pending`)
Expected: `success`.

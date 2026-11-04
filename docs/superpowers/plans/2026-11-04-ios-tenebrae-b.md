# iOS фаза 4, шаг В — Tenebrae на Swift, план (б): картинка, сцены, включение на карте

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** картинка I · Tenebrae на Swift + CoreGraphics 1:1 с вебом (кеш фона и орбит, солнце, дыра, планеты, волны, нити, мост, кольцо связи, плашка с панелью LFO), сцены `-shot ten*`, мир включён на карте (`view: true`), доки.

**Architecture:** логика мира готова в плане (а) (`ios/app/T2D/Tenebrae/`). Картинка — `extension TenebraeView` в новых файлах: `TenScene` (класс кеша `TenLayers`: звёзды / рамка / край дыры и орбиты полос или лада — `CGImage`), `TenDraw` (солнце, дыра, планета), `TenFrame` (кадр по порядку веба, поле, волны, нити, мост, удержание, отказ), `TenRingDraw` (кольцо связи, булавка, призрак, чип close), `TenSheetDraw` (плашка планеты и панель LFO). Кадр ничего не меняет в состоянии: всё, что веб копит в `draw` (`pk` контура, фаза `bph` двойной звезды, угол удара), считается в `tick`. Случайность картинки — детерминированный хеш `tenHash`, не `Double.random`.

**Tech Stack:** Swift 5 + UIKit / CoreGraphics, XCTest, XcodeGen.

**Spec:** `docs/superpowers/specs/2026-11-04-ios-tenebrae-design.md` — читать целиком перед любой задачей (особенно решения 1, 2, 13, 16, «Проверка → Снимки», «Доки»). Разведка рисования — `~/.claude/handoff/tenebrae-draw-map.md` (§1 — веб с номерами строк `app.js`, §2 — образцы Swift, §3 — что уже есть в `Tenebrae/`). Веб-источник истины — `app.js` (номера строк — в карте), `host/draw.js` (примитивы), `host/sheet.js:10-15` (пад). Образец Swift — `ios/app/T2D/Cymatica/CymScene.swift`, `CymFrame.swift`, `T2DTests/CymaticaDrawTests.swift`; кисть — `T2D/Natura/NatPen.swift`; примитивы — `T2D/Host/Draw.swift`.

## Global Constraints

- Ветка `native`; ветку не менять. Коммиты — по-английски, тело-список, последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `notebooks/*`, `.superpowers/` не коммитить; чужие незакоммиченные файлы не трогать, `git stash` не делать.
- Ядро, `app.js`, `worlds/*`, `host/*` не меняются (миры заморожены). Swift-логика плана (а) меняется только там, где сказано в задаче 1.
- Новые файлы в `T2D/Tenebrae/` попадают в цель сами (`project.yml` уже включает `T2D/Tenebrae` в тесты); после добавления файлов — `xcodegen` в `ios/app`. Комментарии — по-русски, как в `Cymatica/`.
- Тесты — через агента test-runner: `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|failed|passed|SUCCEEDED|FAILED" | tail -30` → `** TEST SUCCEEDED **`. **Тест пишется раньше кода и сначала падает** (красный прогон обязателен; для тестов «не падает на 1e300» красный — ошибка компиляции до появления функции).
- **Любое `Int(Double)`** — только через `tenInt` (`TenMath.swift:189`) или с явным зажимом; у каждой задачи с рисованием — тест с `1e300` в полях зеркала (amp, beat, rate LFO, depth связи).
- В тестах — `Row.x`, `LfoKey.x` полностью.
- Время: `draw(_:now:)` получает секунды; формулы веба в мс — `nowMs = now * 1000`. `dt` в `tick` уже `≤ 0.05`.
- Рисование (решение 16): тема `.base`, только `ink(a)` / `paper(a)` темы (INK 237, чёрный фон), без цвета; **никакого `shadowBlur`** (свечение — `d.glowAt` или широкие штрихи); градиенты — только в построении кеша; полноэкранный проход в кадре — только блит кеша; буферы путей контуров — `CGMutablePath` собирается заново, массивы точек не аллоцируются на кадр (переиспользовать поле вида). Подписи поля — `d.mapText` (IM Fell, курсив); плашка и панель LFO — внутри `d.reading { }` и `d.text` (EB Garamond, прямой). Жирного нет.
- `Draw.glowAt` ставит альфу абсолютно — для планеты над дырой (веб `globalAlpha` на всю планету) множитель `m` передаётся во все альфы явно, в том числе `glowAt(…, a * m)`.
- Порядок кадра — решение 16 спеки и карта §1 «Frame order»; мёртвый код веба и десктоп не переносим (решение 1).

## Review Focus

1. **Кадр до первого тика, пустое зеркало, нет живых голосов (`scope == nil`)** — кадр рисуется, не падает; контур — простой круг. Тест — задача 4 (`testFrameBeforeTick`).
2. **Огромные конечные числа в зеркале** (`amp`, `beat`, `rate` / `depth` LFO, `depth` связи = 1e300) — кадр и плашка не падают (`Int(Double)` и счётчики точек зажаты). Тесты — задача 3 (`testPlanetHuge`), задача 4 (`testLinksHuge`), задача 5 (`testSheetHuge`).
3. **Щипок зума** — орбиты пересобираются не чаще 15 раз в секунду, после остановки — последний кадр с точным зумом. Тест — задача 2 (`testPinchThrottle`).
4. **Кадр не меняет состояние** — два кадра с одним `now` дают одинаковые пиксели; волны, удары, `vw`, пальцы, зум после кадра те же. Тест — задача 4 (`testFramePure`).
5. **Смена размера / DPR 3** — кеш пересобран под новый размер, плотность ≤ 2. Тест — задача 2 (`testResize`, `testDprCap`).

---

### Task 1: Состояние картинки и помощники

Риск: обычный — чистые функции и поля вида под существующими тестами.

**Files:**
- Modify: `ios/app/T2D/Tenebrae/TenMath.swift` (помощники), `TenebraeView.swift` (поля, `tick`, `enter`, `readEvents`), `TenTouch.swift` (`down` → `touchedOnce`), `TenLink.swift` (кривая нити; `sectors`, `closeChip`, `ringR` — из `private` во внутренние)
- Test: `ios/app/T2DTests/TenMathTests.swift`, `TenebraeTests.swift`, `TenLinkTests.swift`

**Interfaces:**
- Produces (TenMath.swift):
  - `func tenNoteName(_ n: Int) -> String` — `app.js:1533`: `m = 33 + n`, `Scales.notes[n % 12] + String(m / 12 − 1)` (n ≥ 0; отрицательное — зажать в 0).
  - `func tenSemiOf(_ hz: Double) -> Double` — `app.js:1532` (`12·log2(hz/55)`).
  - `func tenPlanetR(_ amp: Double) -> Double` — `34·(0.55 + 0.45·amp)`, amp зажат в `[0, Ten.ampMax]` (NaN → 0).
  - `Ten.moonR: [Double]` по `LfoKey.rawValue` (pitch, wave, cut, res, beat, shift, amp, fm) = `[50, 56, 62, 68, 74, 86, 92, 80]` (`app.js:1095`).
  - `Ten.linkDash: [[CGFloat]]` по типу 0…3 = `[[3, 6], [1, 3], [10, 6], [2, 2, 8, 2]]` (`app.js:1218`).
  - `Ten.bands: [(hz: Double, label: String)]` = `[(55, "sub"), (90, "bass"), (250, "low-mid"), (500, "mid"), (1000, "upper")]` (`app.js:1531`).
  - `struct TenCol { let s0, s1: Double; let label: String; let hz: Double; let r0, r1: Double }`
  - `extension TenGeo { func arcEnds(_ r: Double) -> (clean: (x: Double, y: Double), noisy: (x: Double, y: Double)) }` — `app.js:1674-1681`.
  - `func tenHash(_ a: Double, _ b: Double) -> Double` — детерминированный шум в `[0, 1)` (например, дробная часть `sin(a·12.9898 + b·78.233)·43758.5453`, модуль); `NaN` / ∞ → 0.
- Produces (TenebraeView):
  - `TenVW` + `var pk = 0.02, bph = 0.0`; в `tick` (после `stepVoices`): `pk = max(peak|scope_i|, 0.92·pk, 0.02)` по контуру `mirror.scope?[i]` (нет контура — без изменений), `bph = (bph + dt·beat).truncatingRemainder(dividingBy: 1)` (beat не конечный → 0).
  - `strikes: [(i: Int, t0: Double, p: Double, a: Double)]` — `a = atan2(y − oy, x − ox)` позиции планеты в момент удара (`app.js:1853`).
  - `func kick(_ i: Int) -> (x: Double, y: Double)` — `app.js:1600-1605` по последнему удару голоса i, `age` в мс = `(now − t0)·1000`; > 700 мс → (0, 0).
  - `func fieldCols() -> [TenCol]` — `app.js:1534-1549` по `zoom`, `sclPcs`, `sclRoot`, `geo` (лад: октавы от корня, подпись `tenNoteName`; без лада — `Ten.bands`).
  - `var touchedOnce = false` — ставит `down(_:)` (любой палец, дошедший до мира).
  - в `tick`: `refuse` старше 0.6 с → `nil`; `full` — убрать старше 0.6 с.
  - `enter()` зовёт `touchReset()` (запись плана (а)).
- Produces (TenLink.swift): `func linkCurve(dst: Int, src: Int) -> (x0: Double, y0: Double, cx: Double, cy: Double, x1: Double, y1: Double)` (`app.js:527-535`, изгиб `min(0.3L, 64)·(0.5 + 0.5·depth)` к солнцу), `func tenBez(_ c: (x0: Double, y0: Double, cx: Double, cy: Double, x1: Double, y1: Double), _ t: Double) -> (x: Double, y: Double)`; `linkMid` = `tenBez(linkCurve(...), 0.5)`. `ringSectors` (углы `LINK_SECTORS`), `closeChip`, `ringR` — внутренние (без `private`), имена не менять.

- [ ] **Step 1: Эталоны.** Скопировать в scratchpad из `app.js` `noteName`, `semiOf`, `fieldCols` (с `buildGeo`/`rAt`, как в плане (а)), `arcEnds`, `kick`, `linkCurve/bez`; посчитать в node значения для тестов ниже (`W 390, H 844, topY 103, safeBot 34`, зум `zoomDef` и 0.5; лад `[0,2,3,5,7,8,10]` корень 3). Скрипт в репозиторий не кладём.
- [ ] **Step 2: Тесты (красные).**
  - `TenMathTests.testNoteName`: `tenNoteName(0) == "A1"`, `(3) == "C2"`, `(12) == "A2"`, `(-5) == "A1"`; `testSemiOf`: `tenSemiOf(110) == 12` (±1e-9); `testPlanetR`: `tenPlanetR(1) == 34`, `tenPlanetR(1e300) == tenPlanetR(Ten.ampMax)`, `tenPlanetR(.nan) == 34·0.55`; `testArcEnds`: 3 радиуса (меньше `W − 4`, больше, больше высоты поля) — числа из node ±1e-6; `testHash`: 1000 пар в `[0,1)`, повтор той же пары — то же число, `tenHash(.nan, 1) == 0`.
  - `TenebraeTests.testFieldCols`: без лада — 5 колонок, `label` = `["sub","bass","low-mid","mid","upper"]`, `r0 / r1` ±1e-6 из node; с ладом — число колонок, первая подпись и `r0` из node.
  - `TenebraeTests.testStrikeAngle`: голос 0 в зеркале, `heard [2, 0, 0.8]`, тик → `strikes.last!.a` = `atan2` от `screenPos(0)` к (0, `bot`) ±1e-9; `testKick`: тик через 0.014 с после удара — модуль `kick(0)` = `(6+16·0.8)·(1−e^{−1})·e^{−14/130}` ±1e-6, через 0.75 с — (0, 0).
  - `TenebraeTests.testPkBph`: контур голоса 0 с пиком 0.5 → после тика `vw[0].pk == 0.5`; затем пик 0.1 → `0.46`; `beat 1e300` → `bph` конечен.
  - `TenebraeTests.testRefuseExpires`: `refuse = (10, 10, now)`, `full.append`, тик +0.7 с → оба пусты.
  - `TenebraeTests.testEnterResetsTouch`: палец на планете (`down`), `enter()` → `fingers` пусты; `testTouchedOnce`: `false` до `down`, `true` после.
  - `TenLinkTests.testLinkCurve`: две планеты, связь — `linkMid` == `tenBez(linkCurve, 0.5)`, контрольная точка ближе к солнцу, чем середина отрезка; числа из node ±1e-6.
- [ ] **Step 3: Прогон — красный** (не компилируется / падает).
- [ ] **Step 4: Реализация** по Interfaces. Существующие тесты, создающие `strikes`, поправить под новое поле `a`.
- [ ] **Step 5: Прогон — зелёный**, весь `T2DTests`.
- [ ] **Step 6: Commit** `ios/app: Tenebrae picture state - note names, columns, arc ends, kick, link curve, pk/bph in tick`.

---

### Task 2: `TenScene` — кеш фона и орбит

Риск: обычный — рисование в кеш.

**Files:**
- Create: `ios/app/T2D/Tenebrae/TenScene.swift`, `ios/app/T2DTests/TenDrawUtil.swift`, `ios/app/T2DTests/TenSceneTests.swift`
- Modify: `ios/app/T2D/Tenebrae/TenebraeView.swift` (хранимое `let layers = TenLayers()`)

**Interfaces:**
- Consumes: `TenGeo`, `fieldCols()`, `TenCol`, `tenXOf`, `geo.rAt`, `sclPcs / sclRoot`, `NatPen`, `NatLCG` (зерно 7, тот же LCG, что `scan` веба).
- Produces:
  - `final class TenLayers { private(set) var scan: CGImage?; private(set) var orbits: CGImage?; private(set) var bg: CGImage?; private(set) var scanBuilds = 0, orbitBuilds = 0; func update(_ v: TenebraeView, dpr: CGFloat, now: Double) }`
    - `scan` (ключ `W, H, dpr, top, bot`; при смене размера): фон `BG` и всё из `resize()` веба `app.js:1003-1062` — тусклые и яркие звёзды, созвездия, меридианы, двойная рамка, засечки — плюс край дыры из `bgLayer :1713-1736` (два `CGGradient` paper 0.7 → 0 и пунктир `[1,5]` ink 0.14). Список ярких звёзд — `private(set) var stars: [(x: Double, y: Double)]` (для мерцания chaos, задача 4).
    - `orbits` (ключ — `tenInt(zoom·1e4)`, `sclPcs`, `sclRoot`, `W, H, dpr`): `orbitLayer :1684-1711` и `engraved :1658-1672`, обрезка по полю.
    - `bg` = `scan` + `orbits` одним изображением (строится вместе с `orbits`); кадр блитит только `bg`.
    - **Троттлинг:** если ключ орбит сменился, но с прошлой сборки прошло < 1/15 с и `orbits != nil` — оставить старые (флаг «грязно»), собрать на первом `update` после 1/15 с. Смена ключа `scan` — всегда сразу.
    - `dpr` = `min(dpr, 2)`.
- `TenDrawUtil.swift` (общий для задач 2–5):
  - `final class TenRig` — `TRec`-подобный `Core`, `mbuf`, `heardQ`, `level`, `lazy var view = TenebraeView(core:readMirror:readHeard:readLevel:rng: { 0.5 })`, `layout` 390×844 `topY 103 safeBot 34`; `func mirror(_ edit: (inout [Double]) -> Void)` и `func voice(_ b: inout [Double], _ i: Int, …)` — как приватные `mirror / set` в `TenebraeTests.swift:28-45` (перенести, не дублировать: `TenebraeTests` переходит на `TenRig`, если это не ломает его тесты; иначе — копия с пометкой); `func scope(_ b: inout [Double], _ i: Int, peak: Double)` — длина 1161, live 1, синус 3 периода с амплитудой `peak`; `func tick(_ t: Double)`.
  - `func tenShot(_ v: TenebraeView, scale: CGFloat = 1, _ draw: (Draw) -> Void) -> CGImage` — как `shot` в `CymaticaDrawTests.swift:40-49` (чёрный фон, `d.setTheme(v.theme)`), шрифты регистрирует `class func setUp` каждого теста рисования (как `CymaticaDrawTests:10-13`) — вынести в `func tenRegisterFonts()`.
  - `func tenLit(_ img: CGImage, _ r: CGRect, over: UInt8 = 24) -> Int` — число пикселей ярче `over` по любому каналу.

- [ ] **Step 1: Тесты (красные)** — `TenSceneTests`:
  - `testScanOnce`: два `update` с тем же размером → `scanBuilds == 1`, `scan` размером `390×844` при `dpr 1`.
  - `testOrbitKey`: тот же зум → `orbitBuilds` не растёт; `zoomT = zoom = 0.5`, `update(now + 0.1)` → +1.
  - `testPinchThrottle`: 60 `update` с шагом 1/60 с, зум каждый раз новый (0.9 → 0.5) → `orbitBuilds` ≤ 17; затем `update(now + 0.2)` с последним зумом → ключ орбит = текущий (ещё одна сборка, потом — нет).
  - `testResize`: `layout` 430×932 → `scan.width == 430` при `dpr 1`; `testDprCap`: `dpr 3` → `scan.width == 780` для 390.
  - `testBgPixels`: в `bg` есть свет на внешней рамке (`tenLit` в полосе `x 3…6`, `y` середина поля > 0) и на гравированной орбите границы колонки 1 (точка `(r0·cos 45°, bot − r0·sin 45°)`, окно 6×6 > 0); вне поля (над `top − 10`) — 0.
- [ ] **Step 2: Прогон — красный.**
- [ ] **Step 3: Реализация** `TenScene.swift` по Interfaces (образец — `CymScene.swift:8-33`, `Draw.layer`). `layers.update(self, dpr: Draw.scale, now: now)` вызывает кадр (задача 4), не `tick`.
- [ ] **Step 4: Прогон — зелёный.**
- [ ] **Step 5: Commit** `ios/app: Tenebrae scene cache - stars, frame, meridians, hole rim, orbits with pinch throttle`.

---

### Task 3: `TenDraw` — солнце, дыра, планеты

Риск: обычный — рисование.

**Files:**
- Create: `ios/app/T2D/Tenebrae/TenDraw.swift`, `ios/app/T2DTests/TenDrawTests.swift`

**Interfaces:**
- Consumes: `TenRig`, `tenShot`, `tenLit` (задача 2); `kick`, `strikes.a`, `vw[i].pk / bph / vph`, `tenPlanetR`, `Ten.moonR`, `tenHash` (задача 1); `mirror.scope / scopeLive`, `fxValues`, `sunLevel`, `geo.holeAt`, `fingers`, `Waves.morph`.
- Produces (`extension TenebraeView`):
  - `func drawSun(_ p: NatPen, _ d: Draw, nowMs: Double)` — `app.js:1607-1655`: `glowAt`, 28 лучей (видимая четверть), клинья и волны, `jag` при `dirt > 0.2` — `tenHash(k, nowMs)` вместо `Math.random`; молнии по `strikes` моложе 110 мс (пропуск `tenHash(...) < 0.25`), позиция планеты + `kick`; диск. Позиция солнца `(geo.ox, geo.oy)`.
  - `func drawHole(_ p: NatPen, nowMs: Double)` — `app.js:1555-1583` (4 эллипса передняя / задняя половины с пунктиром и `dashOffset`, чёрный диск, два кольца, горизонт `[1,6]`); `near` — по пальцам из `fingers` (`moved`, держат планету).
  - `func drawVoice(_ p: NatPen, _ d: Draw, _ i: Int, nowMs: Double)` — `app.js:1102-1113`: деформация над дырой через `p.g` `translate / rotate / scale`, множитель `m = max(0.07, 1 − 0.8h − 0.2e)`.
  - `func drawPlanet(_ p: NatPen, _ d: Draw, _ i: Int, x: Double, y: Double, m: Double, nowMs: Double)` — `app.js:1114-1176`: хвост кометы у незакреплённой, туманность hall (`glowAt`), подложка `paper 0.82`, Сатурн (задняя половина до контура, передняя после), контур, двойная звезда по `vw[i].bph`, спутники-LFO (орбита, след 41 точка, точка; форма — `Waves.morph(l.morph, q)`). `editing` — `sheetVoice == i` или голос кольца `ring?.dst / src`.
  - `func contour(_ p: NatPen, _ i: Int, x: Double, y: Double, R: Double, a: Double, lw: Double, glow: Bool)` — `app.js:1066-1090`, `k = (10 / vw[i].pk)·min(1, env·1.4)`; нет контура (`scope == nil` или `!scopeLive[i]`) — круг. Нужен и мосту (задача 4).
- [ ] **Step 1: Тесты (красные)** — `TenDrawTests` (рисуют в `tenShot` только проверяемую функцию; голос 0 живой с контуром):
  - `testSunRays`: `drawSun` — свет в окне 10×10 в 40 px от солнца под углом −45° (`(ox + 28, oy − 28)`) > 0; под 135° (вне видимой четверти, за краем) — 0.
  - `testLightning`: удар `strikes = [(0, now, 1, a)]`, `now` того же тика → света вдоль луча к планете на середине пути больше, чем без удара (`nowMs` на 200 мс позже).
  - `testHole`: `drawHole` — свет в окне 8×8 на `holeAt + (0.46R + 1.5, 0)` > 0; в центре дыры (окно 4×4) — 0 (чёрный диск).
  - `testPlanetContour`: `drawVoice` закреплённого голоса — свет на кольце радиуса `tenPlanetR(amp)` вокруг `screenPos(0)` (окно 6×6 справа) > 0; Сатурн — свет в `x + R + 14` > 0; незакреплённый с `envT 0, env 0.3` — свет хвоста дальше `R + 20` от солнца по лучу > 0, у закреплённого там 0.
  - `testPlanetInHole`: тот же голос с `vw[0].hole = 0.9` — суммарный свет меньше, чем при `hole 0`.
  - `testMoons`: LFO cut (`morph 0, rate 1, depth 0.5`) — свет на орбите `Ten.moonR[LfoKey.cut.rawValue]` > 0.
  - `testPlanetHuge`: `amp, beat 1e300`, LFO `rate / depth 1e300` → `drawVoice` и `drawSun` не падают.
- [ ] **Step 2: Прогон — красный.**
- [ ] **Step 3: Реализация** `TenDraw.swift` (кисть — `NatPen(g: d.g, inkC: theme.ink, papC: theme.paper)`; > ~350 строк — вынести спутники и хвост в `TenPlanet.swift`).
- [ ] **Step 4: Прогон — зелёный.**
- [ ] **Step 5: Commit** `ios/app: Tenebrae draw - sun rays and lightning, black hole, planets with contour, Saturn ring, comet tail, moons`.

---

### Task 4: `TenFrame` + `TenRingDraw` — кадр, поле, волны, нити, мост, кольцо

Риск: обычный — рисование.

**Files:**
- Create: `ios/app/T2D/Tenebrae/TenFrame.swift`, `ios/app/T2D/Tenebrae/TenRingDraw.swift`, `ios/app/T2DTests/TenFrameTests.swift`
- Modify: `ios/app/T2D/Tenebrae/TenebraeView.swift` (`draw` / `drawShot` → `drawFrame`)

**Interfaces:**
- Consumes: задачи 1–3; `bridge`, `ring`, `ghost`, `hold`, `refuse`, `full`, `waves`, `zoomShow`, `touchedOnce`, `linkMod`, `linkCurve`, `tenBez`, `Ten.linkDash`, `ringSectors`, `closeChip`, `geo.menuSpan`, `fieldCols`, `layers`.
- Produces:
  - `func drawFrame(_ d: Draw, now: Double)`; `draw` и `drawShot` зовут его (решение 13: `drawShot = draw`). Порядок — карта §1 «Frame order» (решение 16): `layers.update` + блит `bg` → обрезка поля → `drawSun` → `drawHole` → мерцание chaos (`layers.stars`, `n = round(chaos·14)`, выбор и яркость — `tenHash`) → сектор полосы под удерживаемой планетой → орбиты ярче (`d.g.setAlpha` + блит `layers.orbits`) → нота лада → снятие обрезки → подпись зума `55 – N Hz` (`zoomShow`, 0.4 с спада, `top + 76`) → подписи колонок и Гц (только тяга или зум; `arcEnds`) → волны (`ring` с альфой `app.js:1934`, пунктир у эха) → призрак до первого касания (`!touchedOnce`) → нити → планеты (`drawVoice`, без пары моста) → дуга удержания → отказ (`refuse` и `full`, 0.6 с) → мост → закреплённое кольцо (без плашки) → призрак кольца → кольцо на весу → плашка (задача 5; до неё — пусто) → чип close (кольцо закреплено, плашки нет).
  - `func drawLinks(_ p: NatPen, _ d: Draw, nowMs: Double)` — `app.js:1220-1250` (пунктир по типу, `dashOffset −nowMs·0.02`, частицы, ромб с подписью типа у не-авто).
  - `func drawBridge(_ p: NatPen, _ d: Draw, nowMs: Double)` — `app.js:1179-1213` (двойная спираль N 120, перекладины, обе планеты `contour(… 34, 1, 2, true)`, нить до пальца, точка пальца, подпись типа); пальцы — `fingers[bridge.fa / fb]`.
  - `TenRingDraw.swift`: `func drawRing(_ p: NatPen, _ d: Draw, _ r: TenRing, pointer: (x: Double, y: Double)?)` (`app.js:1273-1329`, отсчёт `release to cut` / `${type} · N%`, `readoutAt :1336` — `scopeY` веба = `geo.top + 12`, решение 8), `func drawPin(_ p: NatPen, _ d: Draw, _ x: Double, _ y: Double, on: Bool)` (`:1262-1270`), обёртки: закреплённое (`:1364-1374`, привязь к `linkMid` пунктиром `[2,4]`, ромб), на весу (`:1392-1404`, указатель от пальца `ring.finger`, булавка `overPin`), призрак (альфа `0.85·((until − now)/1.6)^0.6` — через `d.g.beginTransparencyLayer` / `setAlpha`, один слой), `func drawCloseChip(_ d: Draw)` (`:1338-1343`).
- [ ] **Step 1: Тесты (красные)** — `TenFrameTests` (кадр целиком через `tenShot { v.drawFrame($0, now:) }`):
  - `testFrameBeforeTick`: свежий вид без тика и без зеркала → кадр не падает; после тика с зеркалом без живых — не падает.
  - `testFramePure`: два голоса, связь, волна, удар; копия `waves.count`, `strikes.count`, `vw.map(\.pk)`, `zoom`, `fingers.count` → два кадра с одним `now` → пиксели равны (байты `dataProvider`), поля те же.
  - `testGhostFirstTouch`: свет на кольце r 62 вокруг `(0.35W, 0.6H)` > 0 до касания; после `down`/`up` пальца по полю — на том же месте нет света кольца r 146 (окно на `x + 146`) .
  - `testZoomCaption`: `zoomShow = now + 1` → свет в окне `W/2 ± 40, top + 76 ± 10` > 0; `zoomShow = now − 1` → 0.
  - `testLinkDiamond`: связь 1 → 0 (не авто) → свет в окне 12×12 на `linkMid` > 0.
  - `testRingPinned`: `ring` закреплённое у связи → свет на окружности `MENU_DEAD + menuSpan` от центра кольца > 0 и свет у `closeChip` > 0.
  - `testHoldArc`: `hold = (id, now − 0.3)` у удерживаемой несдвинутой планеты → свет на `screenPos + (0, −46)` > 0.
  - `testRefuseExpires`: `refuse = (200, 400, now)` → свет на `(200 + 34, 400)` > 0; тик +0.7 с, кадр → 0.
  - `testLinksHuge`: `depth` связи и `beat` 1e300 → кадр не падает.
- [ ] **Step 2: Прогон — красный.**
- [ ] **Step 3: Реализация** `TenFrame.swift`, `TenRingDraw.swift`; `draw` / `drawShot` в `TenebraeView.swift`.
- [ ] **Step 4: Прогон — зелёный.**
- [ ] **Step 5: Commit** `ios/app: Tenebrae frame - field captions, waves, links with particles, bridge helix, link ring, hold arc, refusals`.

---

### Task 5: `TenSheetDraw` — плашка планеты и панель LFO

Риск: обычный — рисование.

**Files:**
- Create: `ios/app/T2D/Tenebrae/TenSheetDraw.swift`, `ios/app/T2DTests/TenSheetDrawTests.swift`
- Modify: `ios/app/T2D/Tenebrae/TenFrame.swift` (шаг «плашка» кадра), `TenSheet.swift` (только если нужна видимость помощника: `rowValue` → внутренний)

**Interfaces:**
- Consumes: `sheetGeo: TenSheetGeo` (`TenSheet.swift:17-37`), `sheetVoice`, `sheetLfo`, `sheetFingers` (какая строка тянется), `tenSheetRows`, `tenNorm`, `tenValueText`, `tenAmpText`, `tenNoteName`, `tenSemiOf`, `tenFreq(soundX)`, `Waves.morph / Waves.count`, `Pad.rateX / depthY` (`Host/Sheet.swift`), `LFO_RATE_MIN / MAX`, `vw[i].ph`, `contour`.
- Produces:
  - `func drawSheet(_ p: NatPen, _ d: Draw, nowMs: Double)` — `app.js:1982-2024` внутри `d.reading { }`: кольцо вокруг планеты на поле, подложка `paper 0.97`, линия, ручка, мини-контур, заголовок `нота · N Hz`, чипы `~ pitch` и `close`, полоса 9 волн с маркером (`wave + vw.wv`), 6 строк (подпись, линия, засечка shift, полоса качания LFO `liveRange`, ползунок 6.5 / 8 при тяге, точка «сейчас», значение, «~» у всех, кроме amp).
  - `func liveRange(_ i: Int, _ r: Row) -> (lo: Double, hi: Double)?` — `app.js:212-228` (`normAt`, `shiftT`); нет LFO у строки → `nil`.
  - `func drawLfoPanel(_ p: NatPen, _ d: Draw, _ i: Int, _ k: LfoKey, nowMs: Double)` — `app.js:1429-1502` по `sheetGeo.panel` (`SheetGeo.Panel`): подложка `paper 0.9`, заголовок `LFO → label`, `N Hz · M%` и чип off либо `drag the pad`, полоса 9 форм с маркером (кривые `d.drawCurve { Waves.morph(Double(j)/8, $0) }`), пад: сетка 0.1 / 1 / 10 Гц, засечки глубины и лог-засечки, подписи, волна LFO `N = min(600, max(120, round(2·rate·24)))` через `tenInt` с фазы `vw[i].ph[k]`, перекрестье, кольцо и точка.
- [ ] **Step 1: Тесты (красные)** — `TenSheetDrawTests` (плашка голоса 0, `sheetVoice = 0`):
  - `testSheetRows`: кадр → свет на линии каждой строки (`tx0 + 10 … tx1 − 10`, `rowY(i)`) > 0 и в полосе волн > 0; без плашки — в той же полосе только поле (меньше).
  - `testSheetSlider`: строка cut `0.68` → свет в окне 10×10 на `x = tx0 + tenNorm(Row.cut, 0.68)·(tx1 − tx0)`.
  - `testLfoPanel`: LFO cut + `sheetLfo = LfoKey.cut` → свет внутри `panel.pad` > 0; `sheetLfo = nil` → `sheetGeo.panel == nil` и свет в той же области меньше.
  - `testSheetHuge`: LFO `rate 1e300`, `depth 1e300`, `beat 1e300`, `amp 1e300` → кадр не падает.
- [ ] **Step 2: Прогон — красный.**
- [ ] **Step 3: Реализация** `TenSheetDraw.swift`; вызов из `drawFrame` (плашка открыта — после неё ничего, как `return` веба `:1975`).
- [ ] **Step 4: Прогон — зелёный.**
- [ ] **Step 5: Commit** `ios/app: Tenebrae planet sheet drawing - rows, wave strip, LFO panel with shapes and pad`.

---

### Task 6: Включение на карте и сцены `-shot ten*`

Риск: обычный — регистрация и сцены.

**Files:**
- Modify: `ios/app/T2D/Worlds.swift:20` (`view: false → true`; устаревший комментарий `:10` поправить), `ios/app/T2DTests/MapTests.swift:62` (список `[1, 2, 4, 5, 7, 8, 9, 10, 11, 12, 13]`), `ios/app/T2D/App.swift` (шапка сцен, `@State private var ten: TenebraeView`, `init`, `shotScene`, `shotTenebrae`), `ios/app/shot.sh:2` (список сцен)
- Test: `ios/app/T2DTests/TenFrameTests.swift` (`testTenebraeOnMap`: `Worlds.info(1)?.view == true`)

**Interfaces:**
- Consumes: `TenebraeView.spawnAt`, `send`, `down / move / up` (`Finger` из `World.swift:4`), `sheetGeo`, `openPlanetSheet`, `scale(pcs:root:)`, `zoomT / zoomShow`, `touchedOnce`, `Act`.
- Produces: сцены (все — `host.go(TenebraeView.slotN)`, затем `ten.touchedOnce = true`, кроме `ten-empty`; места — точки веба, экран 390×844 тот же; пальцы — `Finger(id: ObjectIdentifier(<объект сцены>), …, t0: ten.now, …)`, шаги — `asyncAfter`; `pin(x, y)` = `spawnAt` + `send(Act.pin, i)` + `send(Act.letGo, i, [0])`, как кубик):

| Натив | Что | Веб-пара |
|---|---|---|
| `tenebrae` | три закреплённые: (110, 640), (250, 560), (120, 380) | `planets` |
| `ten-empty` | пустое поле, призрак первого касания | — (первый кадр веба) |
| `ten-sun` | палец держит планету из (160, 560), ведётся за 14 шагов к (30, 804), не отпущен | `sun` |
| `ten-hole` | закреплена (200, 420); палец тянет её из (200, 420) к `holeAt + (30, 10)` за 16 шагов, не отпущен | `hole-drag` |
| `ten-hold` | закреплена (200, 300); удержание 0.6 с → плашка; `SET amp 0` | `ampoff` |
| `ten-lfo` | закреплена (200, 300); плашка; `SET cut` +0.25; тап по «~» строки cut (касание `sheetDown/Up` в `lfoX`, `rowY(0)`) | `ring` |
| `ten-ring` | закреплены (120, 560) и (260, 420); `LINK 0 [1]`; тап по ромбу (`linkMid`) — закреплённое кольцо | — (сверка по спеке, решение 10) |
| `ten-zoom` | `tenebrae` + `zoomT = 0.5`, `zoomShow = now + 60` | — |
| `ten-scale` | закреплена (150, 560); `host.shotState(scl: …)` — лад включён (тот же лад, что `scales` Firmamentum) | `tenscale` (у веба лад в конце выключен — сверять поле и планету) |

- [ ] **Step 1: Тест (красный)** `testTenebraeOnMap`; `MapTests` — новый список; прогон — красный.
- [ ] **Step 2: Реализация** `Worlds.swift`, `App.swift` (`_ten = State(initialValue: views.compactMap { $0 as? TenebraeView }[0])`, ветка `case "tenebrae", "ten-empty", …: shotTenebrae(T2DApp.shotName)`), `shot.sh`.
- [ ] **Step 3: Прогон — зелёный** (весь `T2DTests`).
- [ ] **Step 4: Сборка сцены** `ios/app/shot.sh tenebrae` — `** BUILD SUCCEEDED **`, `.shots/ios-tenebrae.png` есть (картинку не открывать — снимки смотрит агент `shots`, задача 7).
- [ ] **Step 5: Commit** `ios/app: Tenebrae on the map - view enabled, shot scenes ten*`.

---

### Task 7 (главный поток): снимки, доки, выкладка

- [ ] **Step 1: Снимки** — агент `shots`, один проход: сервер `python3 -m http.server 8765` в корне; натив `ios/app/shot.sh <сцена>` по всем 9 сценам; веб `python3 tools/shot.py planets sun hole ring ampoff tenscale` (если `shot.py` берёт по одному — по одному). Сверить пары таблицы задачи 6 глазами: фон (звёзды, рамка, меридианы, край дыры), солнце и лучи, дыра, контур, Сатурн, хвост, волны, подписи, плашка и панель LFO, кольцо связи (по решению 10 спеки), призрак. Вердикт — текстом. Расхождения — правка в задачах 2–5 (новый коммит), повтор снимка.
- [ ] **Step 2: Финальное ревью** всей ветки от `0532127` — встроенный `/code-review`; находки проверить по коду, правка, полный прогон тестов в главном потоке.
- [ ] **Step 3: Доки** (спека, «Доки»): `docs/native-ios-plan.md` (фаза 4, шаг В сделан, ждёт iPhone), `docs/worlds/tenebrae.md` (раздел «Натив»: файлы, кеш, отличия от веба — троттлинг орбит, `tenHash` вместо `Math.random`, сцена `tenebrae` = пара `planets`), `docs/testing.md` (сцены `ten*`, тесты `Ten*Tests`, пары), `CLAUDE.md` «Сейчас» (одна строка), строка в `docs/tokens.md`. Веб не менялся — `CACHE` / `?v=` трогать, только если хук `guard.py` потребует.
- [ ] **Step 4: Commit + push** `docs: Tenebrae native step V plan (b) done`; `python3 tools/deploy-wait.py` → `success`.

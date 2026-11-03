# iOS фаза 3 — Cymatica на Swift, план (б): картинка, сцены, карта

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** картинка II · Cymatica на CoreGraphics — кеш волн, пластина и клетки, созвездия, астролябия (лимбы, длины, удары, бусины, стрелки, метки, кнопки, луна, подписи, курсоры), подписи высоты и вращения, резонатор; плавная высота `shownF0`; мир включён на карте, сцены `-shot cym*`, снимки против веба, финальное ревью ветки, доки, выкладка.

**Architecture:** логика готова в плане (а) (`ios/app/T2D/Cymatica/`: `CymMath`, `CymMirror`, `CymState`, `CymSheets`, `CymTouch`, `CymaticaView`; коммиты `746c51d…aaa33ba`). Здесь — построчный перенос рисования `worlds/cymatica/view.js:45-661` без новых решений: `CymScene` (кеш волн `CymWaves`), `CymDraw` (пластина, клетки, созвездия, вспышка), `CymAstro` (астролябия), `CymFrame` (курсор, подписи, резонатор, `drawFrame`). Образец — Portus (`PorScene` / `PorDraw` / `PorFrame`). Кадр ничего не меняет: время, вспышки, звёзды двигает тик плана (а).

**Tech Stack:** Swift 5 + UIKit + CoreGraphics, XCTest, XcodeGen; веб-эталон снимков — `python3 tools/shot.py`.

**Spec:** `docs/superpowers/specs/2026-11-03-ios-cymatica-design.md` — особенно «Решения» 1, 5, 13, 16. План (а): `docs/superpowers/plans/2026-11-03-ios-cymatica-a.md` — его Global Constraints действуют и здесь. Образец Swift — `ios/app/T2D/Portus/PorScene.swift` (`PorWall`), `PorFrame.swift`, `PortusView.swift:134-135`, `App.swift` (`shotPortus`), тесты `T2DTests/PortusDrawTests.swift` (шрифты, `shot`), `PorTestUtil.swift` (`litPixels`).

## Global Constraints

- Всё из Global Constraints плана (а) (ветка `native`, коммиты с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, тесты Swift, `Horo.jsRound`, константы). Ядро и веб не трогаются — `t2d.wasm`, `CACHE` / `?v=` не меняются.
- Перенос построчно: альфы, радиусы, толщины, пунктиры, порядок вызовов — из `view.js`, своих чисел не вводить.
- **Время.** Времена `CymState` (`born`, `pulse`, `lastStep.t`, `stars.t`, `answerAt`) и вида (`labelUntil`, `bpmUntil`, `chanceEdit / noteEdit.until`, `twistLabel.until`) — секунды; длительности веба в мс — делить на 1000 (`born` 0.5, мигание 0.22, `hot` 0.16, отзыв 1.4, жизнь звезды 5, затухание подписей 0.4). Шаг — `stepS = 60 / bpm / 4`.
- Цвета — тема `.base`: `INK 237,237,237`, `PAPER = BG 0,0,0` (`d.ink`, `d.paper`, `NatPen(inkC: th.ink, papC: th.paper)`). Чёрные подложки веба `rgba(0,0,0,a)` — `p.fillPap(a)`.
- Тексты на поле — только `d.mapText(…, align: .center)` (курсив IM Fell), размеры и альфы — из веба; жирного нет.
- Производительность: никакого `shadowBlur`, градиентов нет; полноэкранный проход — только `d.blit` волн; в кадре без выделений (вместо `Map` / `split` веба у `litCells` — предвыделенный буфер `[Double]` `3 × 12` по `ring·12 + sector`; строки — только у подписей); пунктиры — статические массивы; холст волн ≤ 2× (`Draw.scale`).
- **Кадр без состояния.** `draw` и `drawShot` — одно `drawFrame(d, now:)`, ничего не меняют (`state`, `fingers`, `pair`, `shownF0`). `drawShot = draw` (у веба нет `mapShot`, спека 13). Смычков нет (`BOWS_ON = false`), кольца-меню `drawRingHeld` нет — луна открывает плашку (план (а)).

## Review Focus

1. **Ключ волн** — пересборка только при смене `W, H, DPR, round(fs(effF0)), topY, safeBot`; щипок внутри полутона и дрейф луны внутри полутона — без пересборки; смена лада — без (волны от лада не зависят). Тест — задача 1 (`testWavesKey`).
2. **`shownF0` против `effF0`** — геометрия (и касания) идут за `shownF0` с τ 0.08 с, волны — за `effF0`; `dt` > 0.1 с зажат. Тест — задача 1 (`testShownF0`).
3. **Кадр до тика и двойной кадр** — `drawFrame` на пустом зеркале не падает; два кадра подряд не меняют `state.stars`, `fingers`, `shownF0`. Тест — задача 4 (`testDrawPure`).
4. **Крайние значения** — `rlen / mlen` 1 и 16 (дуга длины 16 — полный круг, `a1 − 1e-4`), `grid 4`, `cursor 15` при `mlen 7` (`i % len`), голос `hz` за 1760 Гц (клетки нет), `level 0`, шанс 0.05, все fx 0 / 1, `stepRec` с `r, m = 15`: кадр не падает. Тест — задача 3 (`testDrawExtremes`).
5. **Широкий экран** — `layout 1024×1366`: кадр не падает, резонатор у угла `(W, H − safeBot)`. Тест — задача 4 (`testDrawWide`).

---

### Task 1: `shownF0`, кеш волн `CymWaves`; `touchTime` удара по метке

**Files:**
- Create: `ios/app/T2D/Cymatica/CymScene.swift`
- Modify: `ios/app/T2D/Cymatica/CymaticaView.swift` (`var shownF0 = Cym.fDef`; сглаживание в `tick`; `rebuildGeo` — от `shownF0`; `let waves = CymWaves()`), `ios/app/T2D/Cymatica/CymTouch.swift` (`STRIKE` метки — с `touchTime` пальца, спека решение 5)
- Test: `ios/app/T2DTests/CymSceneTests.swift`, `ios/app/T2DTests/CymTouchTests.swift` (`testMark` — проверка `touchTime`)

**Interfaces:**
- Consumes: `CymGeo`, `cymFs`, `effF0()`, `Draw.layer`, `NatPen`, `Theme`.
- Produces:
  - `CymaticaView.shownF0: Double` — в `tick(now:dt:)`: `shownF0 += (effF0() − shownF0)·(1 − exp(−min(dt, 0.1)/0.08))` (`view.js:651`; `dt ≤ 0` → `1/60`), затем `rebuildGeo()` (`geo` — от `shownF0`); `restored()` и `enter()` `shownF0` не трогают; `layout` — `geo` от текущей `shownF0`.
  - `func cymWaveStep(_ fsRound: Int) -> Double` — `24·(55·2^(fsRound/12)/110)^(−1/3)` (`view.js:628`).
  - `final class CymWaves { private(set) var builds = 0; private(set) var img: CGImage?; func update(W: Double, H: Double, dpr: CGFloat, fs: Double, topY: Double, safeBot: Double, ink: RGB, bg: RGB) }` — ключ `view.js:630` полями (`W, H, dpr, jsRound(fs), topY, safeBot`), без `String`; сборка `view.js:631-645`: заливка `bg`, `ink 0.045`, `lineWidth 0.8`, два источника `(W, H − safeBot)` и `(0, topY)`, круги `r = step, 2·step, …` пока `r < hypot(W, H)`, один путь и один `stroke` на источник.

- [ ] **Step 1: тесты** `CymSceneTests` (вид — как `CymaticaTests`, `layout 390×844, topY 50, safeBot 34`):
  - `testShownF0`: старт 110; зеркало `f0 220`; `tick(dt: 0.08)` → `shownF0 ≈ 110 + 110·(1 − e^−1) = 179.53` (±0.01), `geo.r` — от него (`rMax·(55/179.53)^0.25`); `tick(dt: 1.0)` с 110 → как при `dt 0.1`: `110 + 110·(1 − e^−1.25) = 188.48`; 60 тиков по `0.016` → `|shownF0 − 220| < 0.5`.
  - `testWaveStep`: `cymWaveStep(12) == 24` (±1e-9), `cymWaveStep(24) == 24·2^(−1/3)` (±1e-9).
  - `testWavesKey`: `update` дважды с `fs 12.0` → `builds 1`; `fs 12.4` → 1; `fs 12.6` → 2; `H 900` → 3; `dpr 1` → 4; `safeBot 0` → 5.
  - `testWavesDrawn`: `img` `780×1688` (`dpr 2`); пиксели на окружности `r = step` вокруг `(0, topY)` (точка `(step, topY)`, окно 3×3 в пикселях холста) — канал ≥ 6; середина между первыми двумя кругами по той же оси — ≤ 2 (фон `0,0,0`).
  - в `CymTouchTests.testMark`: `STRIKE` метки несёт `touchTime` пальца (`Finger.t0` теста).
- [ ] **Step 2:** падают (нет типов / `touchTime 0`) — красный прогон.
- [ ] **Step 3:** реализация по Interfaces; `CymScene.swift` — `CymWaves` и `cymWaveStep`.
- [ ] **Step 4:** зелёные — весь набор.
- [ ] **Step 5:** коммит `ios/app: Cymatica smooth plate size, wave cache, mark strike touch time`.

### Task 2: `CymDraw` — пластина, клетки, ноты, созвездия, вспышка

**Files:**
- Create: `ios/app/T2D/Cymatica/CymDraw.swift` (`extension CymaticaView`)
- Modify: `ios/app/T2D/Cymatica/CymaticaView.swift` (хранимый буфер `lit = [Double](repeating: 0, count: 36)`)
- Test: `ios/app/T2DTests/CymaticaDrawTests.swift`

**Interfaces:**
- Consumes: задача 1; `geo` (`cx, cy, rMax, r`, `fromPlate`), `mirror.voices`, `noteList`, `base()`, `scl.degPerOct`, `cymCellOf`, `cymCellCenter`, `Cym.noteName`, `state.stars`, `fingers`, `pair`, `labelUntil`, `d.ring / dot / mapText`.
- Produces (`func … (_ p: NatPen, _ d: Draw, now: Double)` в `extension CymaticaView`, кроме оговорённых):
  - `func glowOf(_ lv: Double) -> Double` — `clamp((10·log10(lv + 1e-20) + 50)/40, 0, 1)` (`view.js:381`);
  - `func litCells()` — пишет в `lit[ring·12 + sector]` максимум `glow` по голосам (`view.js:382-393`: нота голоса — индекс в `noteList` с допуском 0.05 полутона от 55 Гц, `cymCellOf(idx, b: base(), n:)`, `glow < 0.02` — пропуск); зовётся из `drawFrame`, не из `tick`;
  - `func showNotes(now: Double) -> Bool` — `view.js:394-396`: `pair != nil || now < labelUntil ||` есть палец `.live`, `.mark` или `.mtick`;
  - `drawPlate` — `view.js:366-378` (стол `rMax .08`, край `r .55`, `r+3 .25`, засечки 6° от `r+3` до `r+7`, `.3`, один путь);
  - `drawCells` — `view.js:397-431` (`RINGS = [1, √(2/3), √(1/3), 0]`; лучи и два круга `.25`; горящие клетки — путь клетки `:398-404`, заливка `.12·gl`, обвод `.3 + .6·gl`, ширина `1 + .6·gl`; ноты при `showNotes` — подложка `fillPap(.6)` r 9 и имя 10 pt `.5`);
  - `drawStars` — `view.js:47-58` (линии `.3·k` ширина 0.8 без совпадающих точек, точки r 1.4 `.55·k`, `k = 1 − (now − t)/5`; звёзды старше 5 с не рисуются — чистит их тик);
  - `func flash(_ d: Draw, _ x: Double, _ y: Double, _ t: Double, now: Double)` — `view.js:455-458` (`k = (now − t)/0.5`, кольцо `5 + 16k`, `.9·(1 − k)`, ширина 1.4, только `0 ≤ k < 1`).

- [ ] **Step 1: тесты** `CymaticaDrawTests` (как `PortusDrawTests`: шрифты в `setUp`, фейковые `Core`, зеркало, `heard`; холст 390×844 scale 1, залит `0,0,0`; `litPixels(…, bg: (0,0,0))`):
  - `testGlowOf`: `glowOf(0.5) == 1` (клип), `glowOf(1e-5) == 0`, `glowOf(1e-3) == 0.5` (±1e-9).
  - `testLitCells`: голос `hz 110, level 0.5` без лада → `lit` в клетке ноты 12 (`cymCellOf(index 12 в noteList)`) `== 1`, прочие 0; голос `hz 2000` (за списком) и `level 0` → все 0.
  - `testShowNotes`: пусто → `false`; `labelUntil = now + 1` → `true`; палец `.mtick` → `true`; палец `.play` → `false`.
  - `testCellGlowPixels`: голос в клетке ноты 12 — `litPixels` в квадрате 10×10 у центра клетки (`cymCellCenter` × `geo.r` + центр) больше, чем без голоса.
  - `testNotesWhileShown`: `labelUntil = now + 1` — свет текста в квадрате 16×12 у центра клетки `(ring 1, sector 1)`; без — меньше.
  - `testStarsFade`: две звезды `(0, −0.5)` и `(0.5, 0)` в `now 1`: кадр `drawStars` при `now 2` — `litPixels` у второй точки > 0; при `now 6.5` (тик их убрал) — 0.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные.
- [ ] **Step 5:** коммит `ios/app: Cymatica plate, cells, note names, constellations`.

### Task 3: `CymAstro` — астролябия

**Files:**
- Create: `ios/app/T2D/Cymatica/CymAstro.swift` (`extension CymaticaView`)
- Test: `ios/app/T2DTests/CymaticaDrawTests.swift`

**Interfaces:**
- Consumes: задачи 1–2 (`flash`); `geo` (`R1, R2, RM, ty, playX, recX, gridX, driftX`, `slotXY`, `CymGeo.slotAng`, `fromPlate`), `ringTurn`, `ringOrn` (градусы → радианы), `step(_:)`, `mark(_:)`, `noteOf`, `rlen`, `mlen`, `grid`, `bpm`, `playing`, `rec`, `stepRec`, `drift`, `Cym.driftDepth`, `state.pulse / born / lastStep`, `fingers` (`.len` и `ring` — «держат длину»), `chanceEdit`, `noteEdit`, `bpmUntil`.
- Produces: `func drawAstro(_ p: NatPen, _ d: Draw, now: Double)` — `view.js:461-580` построчно, части по порядку веба (можно разбить на приватные функции в том же файле):
  - двойные кольца `R1, R2` (`:463`); лимбы с поворотом `ringOrn + ringTurn` и указатель-ромб (`:467-482`); заливка длины, край, число длины (`:483-492`; `held` — палец `.len` на этом кольце);
  - гнёзда 0…15 (`:496-521`): засечка `R2+8` по `grid`, удар (размер и альфа от шанса, кольцо мигания, пунктир `[1.5, 2.5]` при шансе < 1), пустое гнездо в длине, точка за длиной, `flash(born.r[i])`; бусина (`fillPap(.85)` r 11, имя ноты `14 + 4·bm` или точка, кольцо), `flash(born.m[i])`; `blink(t) = max(0, 1 − (now − t)/0.22)`;
  - стрелки шага при `playing` и `lastStep` (`:522-529`, `fr = clamp((now − lastStep.t)/stepS, 0, 1)`);
  - метки мест (`:530-536`, `hot` — `playing`, `lastStep.m == i`, удар `lastStep.r` есть, `now − lastStep.t < 0.16`);
  - 4 кнопки (`:538-541`), луна (`:542-552`, фаза от `drift.k / max(1, driftDepth)`), подписи под кнопками (`:553-559`), курсоры пошаговой записи и `step r · m` (`:560-564`), подпись шанса (`:565-568`), знаки ▶ / ■, ●, число сетки `16/grid`, подпись темпа, кольцо правки ноты (`:569-579`).

- [ ] **Step 1: тесты** (в `CymaticaDrawTests`; холст как в задаче 2):
  - `testLenHeldBrighter`: `rlen 8`; `litPixels` у края заливки (`slotXY(7.5, R2)` ± 6) с пальцем `.len` (ring 0) больше, чем без.
  - `testChanceSmaller`: удар 3 `on` шанс 1 против шанса 0.3 — `litPixels` у `slotXY(3, R2)` (± 8) меньше при 0.3.
  - `testHandsOnlyPlaying`: `lastStep (r 0, m 0, t now)`, `playing` — свет на середине стрелки (`slotXY(fr, (rMax + R2)/2)`); стоят — нет.
  - `testPlayGlyph`: стоят — пиксели треугольника справа от `playX` (`playX + 3, ty`) светятся; играют — свет в углу квадрата `(playX − 4, ty − 4)`, у острия треугольника `(playX + 4.5, ty)` — нет.
  - `testStepRecCursors`: `stepRec (on, r 2, m 5)` — свет на кольце r 12 вокруг `slotXY(2, R2)` (точка `+12` по радиусу ± 2) и r 15 вокруг `slotXY(5, R1)`.
  - `testDrawExtremes`: `rlen 1 / 16`, `mlen 1 / 16` (при 16 свет у `slotAng(−0.5)` на `R1` — круг замкнут), `grid 4`, `cursor 15` при `mlen 7`, голос `hz 2000`, `level 0`, шанс 0.05, fx все 0 и все 1, `stepRec r 15 m 15`, луна `on, shape 1, k 7`: `drawAstro` и задачи 2 подряд не падают.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные.
- [ ] **Step 5:** коммит `ios/app: Cymatica astrolabe - rings, beads, hands, buttons, moon`.

### Task 4: `CymFrame` — кадр, подписи, резонатор; карта и сцены

**Files:**
- Create: `ios/app/T2D/Cymatica/CymFrame.swift` (`extension CymaticaView`)
- Modify: `CymaticaView.swift` (`draw` и `drawShot` → `drawFrame(d, now:)`; шапка — «картинка — CymScene / CymDraw / CymAstro / CymFrame»), `ios/app/T2D/Worlds.swift:21` (`view: true`), `ios/app/T2D/App.swift` (шапка — строка сцен `cym*`; `@State cym` рядом с `por`; `makeView` — `case CymaticaView.slotN`; `_cym` в `init`; `case` сцен; `shotCymatica` рядом с `shotPortus`), `ios/app/shot.sh` (комментарий со списком сцен)
- Test: `ios/app/T2DTests/CymaticaDrawTests.swift`

**Interfaces:**
- Consumes: задачи 1–3; `cursor`, `playing`, `mlen`, `twistLabel`, `labelUntil`, `f0`, `mirror.energy[0]`, `state.answerAt / answerNote`, `area` (`W, H, safeBot`).
- Produces:
  - `drawCursor` — `view.js:139-145` (при `cursor ≥ 0` и стоящих; `i = cursor % mlen`; кольцо r 15 и `step i+1 / len` у `playX − 62`);
  - `drawLabel` — `view.js:585-589` (`f0` — базовая, не `effF0`; `noteName · N Hz`, затухание 0.4 с); текст — `func drawLabelText(now: Double) -> String?` (`nil` при `now ≥ labelUntil`);
  - `drawTwist` — `view.js:581-584`;
  - `drawResonator` — `view.js:601-622` (центр `(W, H − safeBot)`, `L = min(1, √energy[0]·2)`, корпус, 5 штриховок, горло, отзыв 1.4 с с `answerNote`, дуги воздуха при `L ≥ 0.03`);
  - `func drawFrame(_ d: Draw, now: Double)` — порядок `view.js:647-661`: `waves.update(fs: cymFs(effF0()), …)` + `d.blit`, `drawPlate`, `litCells` + `drawCells`, `drawStars`, `drawAstro`, `drawCursor`, `drawLabel`, `drawTwist`, `drawResonator`.
  - сцены `shotCymatica` (`host.go(CymaticaView.slotN)`, действия — `cym.send(…)` кодами `Cym.Act`, поля подписей — прямо, `until` = `now + 60`; кадр `shot.sh` — на +5 с), пары с вебом `tools/shot.py`:
    - `cym-empty` ↔ `cymatica` (`sc_worlds`) — покой;
    - `cym-play` ↔ `astrolabe` (`sc_seq`) — `LEN 0 [8]`, `LEN 1 [3]`, `BPM [120]`, `dice()`;
    - `cym-pinch` ↔ `handpan-held` — без лада, `labelUntil = now + 60`, `STRIKE_AT` в центр клетки `(ring 1, sector 1)`;
    - `cym-steprec` ↔ `cym-steprec` — `CLEAR`, `STEPREC [1, 0, 0]`, `STRIKE_AT` в `(−40, 0)` и `(30, −30)` по пластине (в координатах плиты: `/ geo.r`), `SKIP`, `STRIKE_AT (0, 40)`;
    - `cym-chance` ↔ `cym-chance` — удар 0 (`BEAT 0`), `CHANCE_AT 0 [0.5]`, `chanceEdit = (0, now + 60)`;
    - `cym-drift` ↔ `cym-drift` — `dice()`, `DRIFT_TOGGLE`, `PLAY [1]`;
    - `cym-luna` ↔ `cym-luna` — как `cym-drift` + `host.shotSheet(cym.driftSpec)`;
    - `cymatica` — `dice()` (для карты).

- [ ] **Step 1: тесты** (в `CymaticaDrawTests`):
  - `testDrawPure`: `drawFrame` до первого `tick` не падает; после `tick` со звездой, пальцем на метке и парой — два кадра подряд: `state.stars.count`, `fingers.count`, `pair != nil`, `shownF0` не изменились.
  - `testResonatorAnswer`: `state.heard(.answer(12))` в `now 1`: кадр при `now 1.2` — свет текста у `(W − 18, H − safeBot − 16)` (± 10); при `now 3` — меньше.
  - `testLabelUsesBaseF0`: луна `on, k 3`, `f0 110`, `labelUntil = now + 1` — кадр не падает; `drawLabelText(now:) == "A2 · 110 Hz"`, при `now ≥ labelUntil` — `nil`.
  - `testDrawWide`: `layout 1024×1366`, кадр 1024×1366 не падает; свет у `(1024 − 34, 1366 − 34)` (± 3, корпус резонатора).
  - `testCymaticaOnMap`: `Worlds.info(2)?.view == true`.
- [ ] **Step 2:** падают. **Step 3:** реализация, регистрация и сцены. **Step 4:** зелёные (весь набор); `ios/app/shot.sh cym-play` собирается и даёт png.
- [ ] **Step 5:** коммит `ios/app: Cymatica frame, resonator, map entry, shot scenes`.

### Task 5: Снимки, финальное ревью, доки, выкладка

**Files:**
- Modify: `docs/native-ios-plan.md` (фаза 3: Cymatica сделана, ждёт iPhone), `docs/worlds/cymatica.md` (раздел «Натив»: где код, `STRIKE` метки, `DICE` с зерном, собственные значения, `born` из диффа, пороги касаний веба, два пальца внутри мира, `shownF0` и кеш волн, резонатор-угол, решено без автора), `docs/testing.md` (сцены `cym*` и веб-пары, тесты `CymMathTests / CymStateTests / CymTouchTests / CymaticaTests / CymSceneTests / CymaticaDrawTests`), `docs/tokens.md`

- [ ] **Step 1:** один проход агента `shots`: веб (`python3 -m http.server 8765`) `python3 tools/shot.py cymatica astrolabe handpan cym-steprec cym-chance cym-drift cym-luna`; нативные `ios/app/shot.sh cymatica | cym-empty | cym-play | cym-pinch | cym-steprec | cym-chance | cym-drift | cym-luna`. Сверка глазами по парам задачи 4: волны, стол и край с засечками, лучи и кольца клеток, горящая клетка, имена нот, созвездия, лимбы, заливки длины, удары и бусины, стрелки, метки, кнопки и подписи, луна с орбитой, курсоры записи, подпись шанса, резонатор, плашка `luna`. Расхождения — правка в задачах 1–4, повторный прогон только расходящихся сцен.
- [ ] **Step 2:** финальное ревью всей ветки Cymatica от `0355876` (одно; opus) — обе части; список `minor (deferred)` и `Ruling:` из журналов планов (а) и (б).
- [ ] **Step 3:** доки по списку; строка `docs/tokens.md` (`python3 tools/tokens.py --line` + агенты). Веб не менялся — `CACHE` не трогать.
- [ ] **Step 4:** коммит `docs: iOS phase 3 Cymatica` (отдельно от пуша), пуш, `python3 tools/deploy-wait.py` → `success`.

# iOS фаза 3 — Horologium на Swift: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IX · Horologium (Nova) — четвёртый нативный мир: картинка, касания (кольца, ступица, маятник, шкала tempus), плашки кольца и ступицы, веер FX с LFO, легенда; попутно — `ACT_LFO` и `DICE` в ядре Horologium.

**Architecture:** кольца, FX, ход, колесо и звук — в ядре (`core/worlds/horologium/`); Swift разбирает зеркало и heard и шлёт действия, как Monochordum (`ios/app/T2D/Monochord/`). Маятник — только Swift (жест и картинка): чистая структура `HoroPendulum` отдаёт действия списком. Все LFO — строки мира (`obj −1`). Мир: `ios/app/T2D/Horologium/` — `HoroMath.swift`, `HoroGeo.swift`, `HoroMirror.swift`, `HoroPendulum.swift` (чистый слой), `HorologiumView.swift` (касания, тик), `HoroSheets.swift`, `HoroDraw.swift`.

**Tech Stack:** C++17 (`core/tests/sdk_test.cpp`), Swift 5 + UIKit + CoreGraphics, XCTest, XcodeGen; веб-эталон снимков — `python3 tools/shot.py horologium`.

**Spec:** `docs/superpowers/specs/2026-10-30-ios-horologium-design.md` — читать целиком перед любой задачей. Веб-источник истины — `worlds/horologium/view.js` (геометрия, касания, плашки, рисование, легенда) и `worlds/horologium/model.js` (константы, маятник `:57-90`, `ratio :92`, `dice :106`, `clear :115`).

## Global Constraints

- Ветка `native`; в `main` не идёт. Коммиты — по-английски, тело-список, последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `notebooks/*` и `.superpowers/` не коммитить.
- Ядро: C++17, `-ffp-contract=off`; в `process` — без блокировок и аллокаций. Правка `core/worlds/` → пересобрать `t2d.wasm` (`core/build.sh`) и закоммитить вместе. Комментарии — по-русски, плотность как в соседнем коде.
- Миры заморожены: поведение веба и звук Horologium не меняются (`node --test tools/models/horologium.test.mjs`, `core/build.sh && node --test tools/test-horo-core.mjs` — зелёные до и после).
- Swift: новые файлы в `T2D/` попадают в `T2D` и `T2DTests` сами; после — `xcodegen` в `ios/app`. Комментарии — по-русски, как в `Monochord/`.
- Тесты: ядро — `core/build.sh && core/build/sdk-test` → `0 failed`; Swift — `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|failed|passed|SUCCEEDED|FAILED" | tail -30` → `** TEST SUCCEEDED **`.
- Картинка — перенос `view.js` на `Draw` без новых решений: `d.mapText` (IM Fell, курсив), `d.text` (прямой), плашки внутри `d.reading { }`. Никакого `shadowBlur`, градиентов на кадр, полноэкранных проходов; стена — кеш `CGImage`; свечение — `glowAt`; без аллокаций на кадр в горячих циклах; `dt` картинки ≤ 0.1 с.
- Касания — `Touch.dtapMs = 320`, `Touch.holdMs = 420` (`T2D/Touch.swift`); метки времени — как `MonochordView` (`stamp(f)` для тапов, часы тика для удержаний). Пороги мира — как `view.js`: сдвиг > 8 px, маятник `bob + 24` / при `spin` |d − L| < 30, тап маятника < 300 мс, «поймал» — неподвижно > 120 мс, скорость броска `om = 0.6·om + 0.4·dθ/dt` (dt ≥ 1 мс), шкала |y − S.y| < 24 и x в `[x0 − 14, x1 + 14]`, ступица `r < r0 − 6`, кольцо |d − Rᵢ| < 0.62·dr.
- Horologium: слот 9; `NR = 8` (кольца II…IX, `n = i + 2`); `Z = 4`; `ET = 0.0447`; `OM0 = 2π·0.8`; шкала `FLO 0.05 … FHI 120` об/с; `u ∈ [−8, 8.5]`; тема — `Worlds.info(9)`.
- Ядро Horologium: действия `RING 0, FX 1, RUN 2, HELD 3, STEP 4, BPM 5, SPEED 6, CLEAR 7, DICE 8`; `Fx` — `AEQUALIS 0, MATERIA 1, CONCURSUS 2, CHANCE 3, HALL 4`; `RingKey` — `ON 0, UNDER 1, PHI 2, LVL 3`.
- **Коды LFO** (`ACT_LFO`, всегда `obj −1`, `a = [key, v]`): FX `0…4` = индекс `Fx`; кольцо `i`: `phase` — `5 + 2·i`, `level` — `6 + 2·i` (`5…20`). Тот же код — `SheetRow.code`; строки без LFO (`sounds`, `undertone`, `tempo`) — `code −1`.
- Зеркало (47 чисел): `fx[5]`, `run 5`, `u 6`, `uT 7`, `bpm 8`, `strip 9`, `held 10`, `P 11`, `F 12`, `strikes 13`, `locked 14`, затем кольцо `i` с `15 + 4·i`: `on, under, phi, lvl`. heard — `[удары, P, номера колец…]` или 0 чисел.
- **Отступление от спеки, решение 11:** веб `ratio` тонику не берёт (`noteName(m·F)`) — делаем как веб; `scale(pcs:root:)` мир не переопределяет. Двойной тап — два отдельных трекера, как в вебе: `lastRingTap` (кольцо) и `lastStrip` (шкала).

## Review Focus

1. **Два пальца: один держит маятник, другой тапает кольцо** — кольцо переключается, маятник остаётся в руке (никакого `RUN` / `HELD 0` от тапа кольца). Тест — задача 3 (`testPendulumAndRingTwoFingers`).
2. **Undo, пока палец на маятнике и другой на шкале** — `restored()` шлёт `HELD [0]` и `SPEED [u, uT, 0]` (из зеркала), бросает пальцы; последующий `up` этих пальцев ничего не шлёт. Тест — задача 3 (`testRestoredFreesPendulumAndStrip`).
3. **Тап по кольцу, сразу тап по шкале (и наоборот)** — двойного тапа нет: трекеры раздельные, шкала не сбрасывается, унтертон не включается. Тест — задача 3 (`testDoubleTapTrackersSeparate`).
4. **Бросок через верх, потом ход успокаивается** — при `spin` `th` остаётся в `(−π, π]`; когда `eOfU(u) < 1.95`, маятник переходит в качание без скачка (`ph = asin(sin th / A)`). Тест — задача 2 (`testSpinSettles`).
5. **Фаза: палец ведёт вдоль кольца через 12 часов** — скачок угла ±π развёрнут, `phi` всегда в `[0, 1)`, шаг фазы малый. Тест — задача 3 (`testPhaseDragWraps`).

---

### Task 1: Ядро — LFO строк и кубик у Horologium

**Files:**
- Modify: `core/worlds/horologium/world.hpp` (`Act` + `DICE`, комментарий `action` — коды LFO), `world.cpp` (`prepare` → `model_.reset(seed)`, `action`), `model.hpp` / `model.cpp` (`reset(uint32_t seed = 1)`, `void dice()`, `sdk::Rng rng_{1}`, `MAGIC`; шапку «Своего ГСЧ у модели нет» — поправить), `t2d.wasm`
- Test: `core/tests/sdk_test.cpp` (после `monoDice` ~3221, вызовы — в списке `main()` ~3443)

**Interfaces:**
- Produces: `ACT_LFO` у слота 9 по кодам Global Constraints: `0…4` → `setFx`, `5…20` → `setRing((key − 5) / 2, key % 2 ? PHI : LVL, v)`; `i ≠ −1`, `n < 2`, ключ вне `0…20` — пропуск.
- Produces: `DICE 8` → `Model::dice()`.

- [ ] **Step 1: тесты** (образец — `monoLfo` / `monoDice`; `t2d_app_init(48000, seed, 1e9, 1u << 9)`, зеркало после `t2d_app_render` 128):
  - `horoLfo`: `[1, 0.7]` → `m[1] == 0.7`; `[4, 0.2]` → `m[4] == 0.2`; `[5 + 2·3, 0.25]` → `m[15 + 4·3 + 2] == 0.25`; `[6 + 2·7, 0.3]` → `m[15 + 4·7 + 3] == 0.3` (±1e-9).
  - `horoLfoIgnores`: `ACT_LFO(0, [1, 0.5])`, `(-1, [21, 0.5])`, `(-1, [-1, 0.5])`, `(-1, [1])` — зеркало побайтно как без них (47 чисел).
  - `horoDice`: два мира с одним зерном → `DICE` → одинаковые зеркала; номера звучащих колец (`i + 2`) — ровно один из 12 наборов `MAGIC`; `under` у всех одинаков; `lvl == 0.8` у всех; колец с `phi ≠ 0` не больше одного, оно звучит и `phi ∈ {0.25, 0.5, 0.75}`; `run == 1`, `u == 0`, `uT == 0`; `materia ∈ [0, 1)`. По зёрнам 1…40: `under` бывает и 0 и 1, фаза бывает и есть и нет.
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` — новые тесты падают.
- [ ] **Step 3: реализация.** `case sdk::ACT_LFO` — по образцу `core/worlds/monochord/world.cpp:69-78`. `Model::dice()` — как `model.js:106-114`, тот же порядок вызовов `rng_.next()`: набор `MAGIC[⌊r·12⌋]`, `under = r < 0.25`; всем кольцам `on = n ∈ набор`, `under`, `phi 0`, `lvl 0.8`; если `r < 0.4` — звучащее `[⌊r·k⌋]` получает `[0.25, 0.5, 0.75][⌊r·3⌋]`; `fx_[MATERIA] = r`; `clock_.uT = 0, run = true, u = 0`.
- [ ] **Step 4:** `core/build.sh && core/build/sdk-test` → `0 failed`; `node --test tools/test-horo-core.mjs tools/models/horologium.test.mjs` — зелёные.
- [ ] **Step 5:** коммит `core: ACT_LFO rows and DICE for Horologium` вместе с `t2d.wasm`.

### Task 2: Чистый слой — константы, геометрия, зеркало, маятник

**Files:**
- Create: `ios/app/T2D/Horologium/HoroMath.swift`, `HoroGeo.swift`, `HoroMirror.swift`, `HoroPendulum.swift`
- Test: `ios/app/T2DTests/HoroMathTests.swift`

**Interfaces:**
- Produces: `enum Horo` — `nr = 8`, `z = 4.0`, `et`, `om0`, `flo`, `fhi`, `roman` (`""…"XII"`), `names: [([Double], String)]` (`model.js:14` дословно); `static func uOfE(_ e: Double) -> Double`, `eOfU(_ u: Double) -> Double`, `noteName(_ f: Double) -> String` (round как JS — половина вверх), `num2(_ x: Double) -> String` (как `+x.toFixed(2)`: `2.4`, `1.71`, `4`), `mOf(_ r: HoroRing, aequalis: Double) -> Double` (`model.js:43`), `ratio(_ rings: [HoroRing], F: Double) -> (a: String, b: String)` (`model.js:92-103`).
- Produces: `struct HoroRing { var n: Int; var on, under: Bool; var phi, lvl: Double }`; `struct HoroMirror` — `fx: [Double]` (5), `run, strip, held, locked: Bool`, `u, uT, bpm, P, F, strikes: Double`, `rings: [HoroRing]` (8, `n = i + 2`); `init()` (всё по нулям, кольца молчат) и `init?(_ b: [Double], n: Int)` → nil при `n < 47`.
- Produces: `struct HoroGeo` — `init(W:H:topY:safeBot:)` по `view.js:11-18` (`T.topY` = `topY`); поля `W, H, top, bot, cx, cy, R, r0, dr, Ws, ty, L`, `strip: (x0: CGFloat, x1: CGFloat, y: CGFloat)`, `piv: CGPoint`, `bob: CGFloat = 13`, `sun: (x: CGFloat, y: CGFloat, r: CGFloat)`; `func ringR(_ i: Int) -> CGFloat`, `ringAt(_ x: CGFloat, _ y: CGFloat) -> Int?`, `bobXY(_ th: Double) -> CGPoint`, `stripX(_ F: Double) -> CGFloat`, `uOfX(_ x: CGFloat, Ft: Double) -> Double` (`view.js:24`).
- Produces: `struct HoroPendulum` — `var th = 0.0, ph = 0.0, spin = false, held = false`, `private(set) var handSteps = 0`; `enum Out: Equatable { case held(Bool), step(Double), run(Double), stop }` (`run(u)` → `RUN [1, u]`, `stop` → `RUN [0, mirror.u]`); `mutating func grab(_ th: Double) -> [Out]` (`[.held(true)]`, `spin = false`), `swing(from prev: Double, to th: Double) -> [Out]`, `tap(running: Bool, uT: Double) -> [Out]` (`[.held(false), .stop]` или `[.held(false), .run(uT)]` + `start(u: uT)`), `release(th: Double, om: Double) -> [Out]` (`model.js:73-80`), `start(u: Double)` (фаза под ход, `model.js:57`: `A = acos(1 − min(1.9, eOfU(u)))`), `tick(dt: Double, run: Bool, u: Double, F: Double)` (`model.js:83-90`).

- [ ] **Step 1: тесты.**
  - `testUOfE` (`uOfE(ET) == 0`, `uOfE(1e-6) == −3`, `eOfU(0) == ET`), `testNoteName` (`40 → "D#1"`, `50 → "G1"`, `60 → "B1"`, `55 → "A1"`, `110 → "A2"`), `testNum2` (`2.4`, `1.71` для `12/7`, `4`).
  - `testRatio`: ничего не звучит → `("quies", "tap a ring")`; IV, V, VI, `F 1` → `("IV : V : VI", "rhythmus · 4 · 5 · 6 ictus in circuitu · trias harmonica")`; то же, `F 10` → `b == "tonus — trias harmonica · D#1 G1 B1"`; II под унтертоном + III, `F 1` → `("1/II : III", "rhythmus · 3 · 6 ictus in circuitu · diapason")`; V унтертоном → `b == "rhythmus · 2.4 ictus in circuitu"`.
  - `testGeo` (`W 390, H 844, topY 59, safeBot 34`, ±0.01): `R 169.51`, `cy 260.51`, `r0 28.82`, `dr 16.96`, `strip (39, 351, 532.02)`, `piv (195, 676)`, `L 100`, `sun (390, 61, 42)`; `ringAt(cx, cy − ringR(3)) == 3`, `ringAt(cx, cy) == nil`, `ringAt(cx + R + 20, cy) == nil`; `stripX(0.05) == 39`, `stripX(120) == 351`, `stripX(1e4) == 351`; `uOfX(stripX(2), Ft: 100/240)` = `log2(2 / (100/240))` (±1e-6).
  - `testMirrorParse` (47 чисел → поля, кольцо 3 из `15 + 12…15`; 46 → nil).
  - маятник: `testSwingStep` (`swing(from: 0.1, to: −0.1)` → `[.step(0.25)]`, `handSteps 1`; `0.1 → 0.2` и `3.0 → −3.0` → `[]`); `testReleaseCatch` (`release(th: 0.1, om: 0.1)` и `(0.3, 0)` → `[.held(false), .stop]`); `testReleaseThrow` (`(0.6, 0)` → `[.held(false), .run(u)]`, `u ≈ 1.7696` ±1e-3, `spin == false`); `testReleaseOverTop` (`(0, 15)` → `.run(u)`, `u ∈ (5.9, 6.1)`, `spin == true`); `testTap` (`running: true` → `[.held(false), .stop]`; `false, uT: 0` → `[.held(false), .run(0)]`); `testTickSwing` (`start(u: 0)`, 200 × `tick(0.01, run: true, u: 0, F: 100/240)` → `|th| ≤ acos(1 − ET) + 1e-9`); `testTickHang` (`th 0.5`, `tick(1, run: false, …)` → `0.5·e^−3`); `testSpinSettles` (Review Focus 4).
- [ ] **Step 2:** тесты падают (типов нет).
- [ ] **Step 3: реализация** по `model.js` / `view.js` (строки в Interfaces). `HoroPendulum` — без `Core` и `UIKit`.
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** коммит `ios/app: Horologium math, geometry, mirror, pendulum`.

### Task 3: Horologium — касания, тик, плашки

**Files:**
- Create: `ios/app/T2D/Horologium/HorologiumView.swift`, `HoroSheets.swift`
- Test: `ios/app/T2DTests/HorologiumTests.swift` (образец — `MonochordTests.swift`)

**Interfaces:**
- Consumes: всё из задачи 2; коды Global Constraints.
- Produces: `final class HorologiumView: World` — `init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil)`; `static let slotN = 9`; `enum Act { ring 0, fx 1, run 2, held 3, step 4, bpm 5, speed 6, clear 7, dice 8 }`; `title "Horologium"`, `sub` — из `index.js` мира; `var geo: HoroGeo`, `private(set) var mirror: HoroMirror`, `var pend: HoroPendulum`; `private(set) var ringHit: [Double]` (8), `concAt`, `concA` (луч concursus); `func pVis(now: Double) -> Double` (`P + F·min(0.1, now − t зеркала)`); `func ringSpec(_ i: Int) -> SheetSpec`, `func hubSpec() -> SheetSpec`, `var fx: SheetSpec?` (собран раз, `lazy`, как у Monochordum); `func phaseHeld() -> Int?` (кольцо, вдоль которого тянут — подпись фазы); `objGone`, `rowLfoOff` — хранимые, не используются.

- [ ] **Step 1: тесты** (фейковое ядро пишет действия, фейковое зеркало и heard; геометрия — `HoroGeo(390, 844, 59, 34)`):
  - `testHeardFlash` (heard `[2, 3.25, 2, 4]` в `tick` → `ringHit[2] == ringHit[4] == now`, `concAt == now`, `concA == 0.25·2π` при `fx[2] > 0.05`; одно кольцо — без луча; `idle()` сливает heard без вспышки); `testPVis` (`P 2, F 1`, зеркало в `t 10` → `pVis(10.05) == 2.05`, `pVis(11) == 2.1`).
  - кольцо: `testRingTap` (тап по кольцу 2 → `RING 0, i 2, [0, 1]` при `on 0`, `[0, 0]` при `on 1`); `testRingDoubleTapUnder` (два тапа по кольцу 2 в 320 мс → второй шлёт `[1, 1]` и `[0, 1]`); `testPhaseDrag` (сдвиг вдоль кольца 3 на +0.1 рад → `RING i 3, [2, phi]`, `phi = (phi0 − 0.1/2π·mOf) mod 1`); `testPhaseDragWraps` (RF5); `testRingHoldSheet` (удержание без сдвига > 420 мс → `openSheet` c `title "circulus V"` для `i 3`; `up` после — без `RING`).
  - ступица: `testHubTap` (`run 0` → `RUN [1, uT]`; `run 1` → `RUN [0, u]`), `testHubHoldSheet` (`title "tempus"`, без `RUN`).
  - шкала: `testStripHold` (при `run 0` → `RUN [1, u]`, затем `SPEED [u, u, 1]`, `u = uOfX(x, Ft = bpm/240)`, зажат в `[−8, 8.5]`); `testStripDrag` (`SPEED [u', u', 1]`); `testStripUp` (`SPEED [u', u', 0]`); `testStripDoubleTap` (два тапа в 320 мс → `SPEED [0, 0, 0]`); `testDoubleTapTrackersSeparate` (RF3).
  - маятник: `testPendulumGrab` (палец у груза → `HELD [1]`); `testPendulumTap` (< 300 мс без сдвига → `HELD [0]`, затем `RUN`); `testPendulumSwingByHand` (палец ведёт груз через низ → `STEP [0.25]`, `pend.handSteps 1`); `testPendulumThrow` (быстрый сдвиг и отпуск → `HELD [0]`, `RUN [1, u > 0.5]`); `testPendulumCatch` (держал неподвижно > 120 мс у низа → `RUN [0, u]`); `testPendulumAndRingTwoFingers` (RF1).
  - `testRestoredFreesPendulumAndStrip` (RF2), `testCancelFreesPendulum` (`cancel` пальца на маятнике → `HELD [0]` без `RUN`; на шкале → `SPEED [u, uT, 0]`).
  - плашки: `testRingSheet` (`ringSpec(2)`: строки `on / under / phi / lvl` с подписями `sounds / undertone / phase / level`, коды `−1, −1, 9, 10`, `lfo.obj −1`, `keys {phi, lvl}`, форма classic; тексты `yes / no`, `4 a turn`, `1/4 · 3 a turn`, `90°`, `80%`; `set("under", 0.7)` → `RING i 2, [1, 1]`; `set("lvl", 0.5)` → `[3, 0.5]`); `testHubSheet` (одна строка `tempo`, код `−1`, `lfo nil`; `get` при `bpm 120` = 0.5, `set(0.25)` → `BPM [80]`, текст `120 bpm`); `testFanSheet` (`title "aether"`, коды `0…4`, форма random, `arc` = `fx[4]`; тексты `pure`, `equal`, `40% equal`, `lignum 35%`, `metallum 60%`, `40%`).
  - `testDice` (`DICE 8`, затем `pend.ph` выставлен под `u 0`), `testClear` (только `CLEAR 7`), `testCornerHit` (`(W − 10, 61 + 10)` — да; `(W − 10, 50)` — нет: выше солнца), `testLegend` (8 строк `view.js:257-260` дословно).
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3: реализация** по `view.js:37-119, 251-261` и спеке (решения 5–10). `tick`: прочитать зеркало (время прочтения — для `pVis`), heard (вспышки), удержания → плашки, `pend.tick(min(0.1, dt), run: mirror.run && !pend.held, u: mirror.u, F: mirror.F)`. Своего значения до зеркала не держим (кольца, FX, ход, темп); в удержании пальца — только его жест (`phi0`, угол, `om`, последнее `u` шкалы). Пальцы — по `Finger.id`.
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** коммит `ios/app: Horologium touches, tick, sheets`.

### Task 4: Horologium — рисование, регистрация, снимки

**Files:**
- Create: `ios/app/T2D/Horologium/HoroDraw.swift`
- Modify: `ios/app/T2D/Worlds.swift:26` (слот 9 `view: true`), `ios/app/T2D/App.swift` (`makeView` — ветка 9; `@State horo` и `shotHoro` рядом с `shotMono` ~190; комментарий ~10 со списком сцен)
- Test: `ios/app/T2DTests/HorologiumTests.swift` (рисование), снимки `ios/app/shot.sh`

**Interfaces:**
- Consumes: `HorologiumView`, `HoroGeo`, `HoroMirror`, `HoroPendulum`, `Horo.ratio` (задачи 2–3); `Draw.mapText`, `Draw.text`, `Draw.glowAt`, `Draw.quarterSun` (`Draw.swift:194`).
- Produces: `final class HoroDrawState` (кеш стены, `builds` — счётчик постройки для теста); `draw` и `drawShot` (без солнца — `mapShot` веба) у `HorologiumView`.

- [ ] **Step 1: тесты:** `testWallCached` (два кадра без смены размера → стена строится 1 раз; смена `H` → 2), `testDrawNoCrashEmpty` (зеркала нет — кадр рисуется), `testDrawSpin` (`pend.spin`, `F 30` — кадр рисуется).
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3: реализация** по `view.js:120-250` (спека, решение 12): стена — `CGImage`, ключ `W×H×scale|cy|R|strip.y`; в кадре — кольца (вспышка `ringHit` 260 мс, номер, ровный круг при `F > 4`), часовая стрелка (`pVis/12`, цифра такта, диск при `F/12 > 4`), стрелка-солнце (диск при `F > 4`, луч `concAt` 350 мс), `ratio`, `limen` (`stripX(20/m_ср)`), бегунок `F` на шкале, маятник (веер при частоте > 2.5, расплыв при `spin` и > 3), подпись фазы (`phaseHeld()`), солнце-угол. Регистрация мира; сцены (сид init 7):
  - `horologium` — кольцо II включено, ход `RUN [1, 0]`, кадр через 1.5 с; пара — веб `horologium-run`;
  - `horologium-ring-sheet` — `ringSpec(3)`; пара — веб `horologium-sheet`;
  - `horologium-hub-sheet` — `hubSpec()`;
  - `horologium-fan` — веер, LFO на `materia` (полоса random);
  - `horologium-spin` — `RUN [1, 7.5]`, кадр через 1.5 с; пара — веб `horologium-tonus`.
- [ ] **Step 4:** Swift-тесты зелёные; `ios/app/shot.sh horologium` и остальные четыре против `python3 tools/shot.py horologium` (`.shots/horologium-*.png`) — **сверяет главный поток агентом `shots`** (субагенты его не зовут): раскладка, шрифты, подписи; плашки и веер — заголовки, подписи строк и тексты значений как в вебе.
- [ ] **Step 5:** коммит `ios/app: Horologium drawing, registry, shot scenes`.

### Task 5: Доки, выкладка

**Files:**
- Modify: `docs/native-ios-plan.md` (фаза 3: Horologium сделан, ждёт iPhone), `docs/worlds/horologium.md` (раздел «Натив»: где код, маятник в Swift, LFO — строки мира, кубик в ядре, корзина LFO не снимает, без `tempoFrom` и замка MIDI), `core/README.md` (`ACT_LFO` и `DICE` у Horologium), `docs/testing.md` (сцены `horologium*` и веб-пары), `docs/tokens.md`, `sw.js` / `index.html` (новый `CACHE` = `?v=` — изменился `t2d.wasm`)

- [ ] **Step 1:** доки по списку; строка `docs/tokens.md` (`python3 tools/tokens.py --line`).
- [ ] **Step 2:** `CACHE` в `sw.js` и `?v=` в `index.html` — следующее число (одно и то же).
- [ ] **Step 3:** коммит `docs: iOS phase 3 Horologium`; после финального ревью — пуш `native`, `python3 tools/deploy-wait.py` → `success`.

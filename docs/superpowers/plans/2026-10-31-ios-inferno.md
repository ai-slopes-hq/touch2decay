# iOS фаза 3 — Inferno на Swift: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** V · Inferno — седьмой нативный мир: воронка из девяти кругов, Коцит, надпись, дым, пламя, иней, буря, грешники, угольки, касания (удар, тление, высота, арфа, грешник), плашка круга, веер FX с LFO, легенда; попутно — `ACT_LFO` в ядре Inferno.

**Architecture:** модель и звук — в ядре (`core/worlds/inferno/`, слот 5); Swift разбирает зеркало (81 число) и записи `heard` (номера кругов с ударом → угольки) и шлёт действия, как Tria. Собственные значения до зеркала, `lvl` после удара, вращение и угольки — чистая структура `InfState` (без `Core`). Мир: `ios/app/T2D/Inferno/` — `InfMath`, `InfMirror`, `InfState` (чистый слой), `InfernoView` (касания, тление, тик, плашки), `InfDraw` (стена-кеш и кадр).

**Tech Stack:** C++17 (`core/tests/sdk_test.cpp`), Swift 5 + UIKit + CoreGraphics, XCTest, XcodeGen; веб-эталон снимков — `python3 tools/shot.py inferno`.

**Spec:** `docs/superpowers/specs/2026-10-31-ios-inferno-design.md` — читать целиком перед любой задачей. Веб-источник истины — `worlds/inferno/view.js` (геометрия `:13-28`, угольки `:35-42`, касания `:44-92`, вращение и угольки `:93-104`, плашка `:106-116`, стена `:119-150`, надпись `:151-163`, дым `:164-174`, пламя `:175-184`, грешник `:185-190`, кадр `:191-246`, веер, легенда, угол `:249-266`) и `worlds/inferno/model.js` (константы `:9-20`, начальные круги `:23`, `semiOf :32`, `pin :53-61`, `setCirc :62-66`). Образец Swift — `ios/app/T2D/Tria/` и его тесты.

## Global Constraints

- Ветка `native`; ветку не менять. Коммиты — по-английски, тело-список, последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `notebooks/*` и `.superpowers/` не коммитить.
- Ядро: C++17, `-ffp-contract=off`; правка `core/` → `core/build.sh` и `t2d.wasm` в том же коммите. Комментарии — по-русски, плотность как в соседнем коде.
- Миры заморожены: звук и веб Inferno не меняются — `node --test tools/models/inferno.test.mjs` зелёный до и после.
- Swift: новые файлы в `T2D/` попадают в `T2D` сами, в `T2DTests` — через `project.yml` (источники теста; добавить `T2D/Inferno` рядом с `T2D/Tria`, задача 2); после — `xcodegen` в `ios/app`. Комментарии — по-русски, как в `Tria/`.
- Тесты: ядро — `core/build.sh && core/build/sdk-test` → `0 failed`; Swift — через агента test-runner: `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|failed|passed|SUCCEEDED|FAILED" | tail -30` → `** TEST SUCCEEDED **`; веб — `node --test tools/test-models.mjs tools/models/*.test.mjs`.
- Картинка — перенос `view.js` на `Draw` без новых решений: `d.mapText` (IM Fell: надпись 12.5 прямым с углом, подписи круга 15 и 12 курсивом), `d.text` (EB Garamond), плашки внутри `d.reading { }`. Никакого `shadowBlur`, градиентов нет; полноэкранных проходов нет, кроме `drawImage` стены; без `Array`/замыканий на круг или уголёк в кадре; `dt` картинки ≤ 0.1 с; холст ≤ 2× (`DPR`). Время картинки в формулах веба — `now·1000` (мс).
- Константы Inferno: слот 5; `NAMES = Limbus, Luxuria, Gula, Avaritia, Ira, Haeresis, Violentia, Fraus, Proditio`; `ROMAN I…IX`; `COLORS = white, pink, brown, crackle, grain`; `PIN_MAX 4`; `SPAN = 60/9`; `EMBER (226,99,42)`, `EMBER2 (242,160,74)`, `ICE (185,210,223)`; тема — `Worlds.info(5)` (`ink 207,196,182`, фон `5,4,3`); `FX_KEYS = structure, fire, smoke, ice, storm` (индекс = `Fx` ядра 0…4), `FX_DEF = 0, 0.2, 0.35, 0, 0.6`; `Key` ядра `pos 0, width 1, drive 2, level 3, color 4`; начальные круги — `pos 0.5, sinner false, color (k<3 ? 0 : k<6 ? 1 : k<8 ? 2 : 3), width 0.5, drive 0.15 + 0.08k, level 0.7, lvl 0`; угольков ≤ 160.
- Действия ядра (`world.hpp:12-17`): `STRIKE 0 (k, [vel])`, `POS 1 (k, [pos])`, `HOLD 2 (k, [±1])`, `PIN 3 (k, [pos])`, `CIRC 4 (k, [key, v])`, `FX 5 (i = Fx, [v])`, `CLEAR 6`, `DICE 7`.
- Зеркало (81 число, буфер 96): `time 0, iceE 1, stormSemi 2, stormPh 3`, `fx 4…8`, круг `k` с `9 + 8·k`: `pos 0, sinner 1, held 2, color 3, width 4, drive 5, level 6, lvl 7`. `heard` — записи `[n, k × n]` подряд (пустых движок не кладёт, `engine.cpp:169-171`).
- Касания — пороги `view.js` как есть: круг — `circleAt` (полоса `±dy/2`, `|x − cx| ≤ rx + 18`; в `move` — `loose`, без проверки x), высота — сдвиг по x `> 6`, тление — 160 мс, плашка — `Touch.holdMs 420` и сдвиг `< 10`, двойной тап — `Touch.dtapMs 320` по тому же кругу; угол — `hypot(f − dark) < dark.r`.
- Геометрия (`view.js:13-18`): `top = topY + 6`, `bot = H − safeBot − 8`, `cx = W/2`, `Ws = min(W, (H − safeBot)·0.62)`, `y0 = top + 96`, `yC = bot − 54`, `dy = (yC − y0)/9.3`, `rx0 = Ws·0.46`, `rx8 = Ws·0.13`, круг `k`: `rx = rx0 − (rx0 − rx8)·k/8`, `cy = y0 + k·dy`, `ry = rx·0.13 + 3`; Коцит `(yC, Ws·0.11, 9)`; тьма `(0, H − safeBot, min(110, Ws·0.28))`.
- **Решено без автора** — спека, раздел «Решено без автора» (пять пунктов).

## Review Focus

1. **Отмена (`restored`) с тлеющим пальцем** — ядро получает `HOLD k [−1]` ровно один раз; последующие `move / up` пальца ничего не шлют (иначе `held` уйдёт в минус). Тест — задача 4 (`testRestoredReleasesSmoulder`).
2. **Арфа из тлеющего круга** — один `HOLD −1` старому кругу при выходе, у нового круга тления нет, `up` после арфы ничего не шлёт. Тест — задача 4 (`testHarpFromSmoulder`).
3. **Два пальца на одном круге** — оба тлеют: `held 2`, первый `up` → `HOLD −1`, круг горит дальше (`burning`), второй → `HOLD −1`. Тест — задача 4 (`testTwoFingersOneCircle`).
4. **Пятый грешник** — `PIN` при четырёх грешниках шлётся (ядро решает само), но своё `sinner` не ставится: картинка не мигает лишним грешником. Тест — задача 3 (`testPinMax`).
5. **Плохое `heard` и короткое зеркало** (обрезанная запись, `n ≤ 0`, `k` вне 0…8, NaN; зеркало < 81) — не падает, годное до плохого учтено, прежнее зеркало цело. Тест — задача 2 (`testHeardBad`, `testMirrorShort`).

---

### Task 1: Ядро — `ACT_LFO` Inferno

**Files:**
- Modify: `core/worlds/inferno/world.cpp` (`action`: `case sdk::ACT_LFO`), `world.hpp` (комментарий `action` — коды LFO), `t2d.wasm`
- Test: `core/tests/sdk_test.cpp` (рядом с `triaLfo` ~3339; вызовы — в `main()` ~3748; `lfoForeign` ~3137)

**Interfaces:**
- Produces: `ACT_LFO` у слота 5: `obj −1`, ключ `0…4`, `n ≥ 2` → `model_.setFx(key, v)` (как `case ACT_FX`); `obj 0…8`, ключ `0…3`, `n ≥ 2` → `model_.setCirc(obj, key, v)` (как `case ACT_CIRC`). Прочее — пропуск: `obj −1` с ключом вне `0…4`, круг с ключом `4` (color) или вне `0…3`, `obj ≥ 9`, `obj < −1`, `n < 2`.

- [ ] **Step 1: тесты** (образец — `triaLfo / triaLfoIgnores`; помощники `infStart()` и `infMirror(m, cap)` по образцу `triaStart / triaMirror`; зеркало после `t2d_app_render` 128, `== 81`):
  - `infLfo`: `(−1, [0, 0.7])` → `m[4] == 0.7`; `(−1, [4, 0.25])` → `m[8] == 0.25`; `(3, [0, 0.3])` → `m[9 + 24] == 0.3` (pos круга 3); `(8, [3, 0.2])` → `m[9 + 64 + 6] == 0.2` (level круга 8); `(0, [1, 0.9])` → `m[9 + 4] == 0.9` (±1e-12).
  - `infLfoIgnores`: `(−1, [5, 0.9])`, `(0, [4, 3])` (color), `(0, [5, 0.9])`, `(9, [0, 0.9])`, `(−2, [0, 0.9])`, `(−1, [0])` (`n = 1`) — зеркало побайтно как без них (81 число).
  - `lfoForeign`: в список слотов добавить `5`.
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` — `infLfo` падает.
- [ ] **Step 3: реализация** по Interfaces, по образцу `core/worlds/tria/world.cpp:149-151`.
- [ ] **Step 4:** `core/build.sh && core/build/sdk-test` → `0 failed`; `node --test tools/models/inferno.test.mjs` — зелёный.
- [ ] **Step 5:** коммит `core: ACT_LFO fan and circle rows for Inferno` вместе с `t2d.wasm`.

**Ревью задачи:** да (ядро).

### Task 2: Чистый слой — `InfMath`, `InfMirror`

**Files:**
- Create: `ios/app/T2D/Inferno/InfMath.swift`, `ios/app/T2D/Inferno/InfMirror.swift`
- Modify: `ios/app/project.yml` (источники `T2DTests` — `T2D/Inferno`)
- Test: `ios/app/T2DTests/InfMathTests.swift`

**Interfaces:**
- Produces:
  - `enum Inf` — константы Global Constraints: `slot = 5`, `nc = 9`, `names`, `roman`, `colors`, `pinMax = 4`, `span = 60.0/9`, `fxKeys`, `fxDef: [Double]`, `ember, ember2, ice: RGB`, `sparkMax = 160`, `mirrorN = 81`, `head = 9`, `circN = 8`; `enum Act { static let strike = 0 … dice = 7 }`; `static func color0(_ k: Int) -> Int`, `static func drive0(_ k: Int) -> Double` (начальные круги).
  - `struct InfRing { var cy, rx, ry: Double }`; `struct InfGeo { init(W:H:topY:safeBot: Double); W, H, top, bot, cx, Ws, y0, yC, dy: Double; rings: [InfRing] (9); coc: InfRing; dark: (x: Double, y: Double, r: Double); func circleAt(_ x: Double, _ y: Double, loose: Bool = false) -> Int /* −1 — мимо */; func posAt(_ k: Int, _ x: Double) -> Double /* clamp 0…1 */; func at(_ k: Int, _ pos: Double) -> (x: Double, y: Double) /* для тестов и сцен, как t2d.inf.at */ }`.
  - `func infSnap(_ s: Double, pcs: [Int]) -> Double` (`host/scale.js:17-25`: `n` от `⌊s⌋ − 7` до `⌈s⌉ + 7`, `n ≥ 0`, `pcs` содержит `n mod 12`, строгое `<` — при равенстве нижняя); `func infSemi(_ k: Int, _ pos: Double, pcs: [Int]?) -> Double` (`model.js:32`, округление — `Horo.jsRound`); `func infNote(_ semi: Double) -> String` (`view.js:10`).
  - `enum InfSheet { static func get(_ key: String, _ c: InfCirc) -> Double; static func set(_ key: String, _ v: Double) -> (key: Int, value: Double) /* Key ядра и значение; color — min(4, ⌊5v⌋) */; static func text(_ key: String, _ c: InfCirc, k: Int, pcs: [Int]?) -> String; static func fanText(_ key: String, _ v: Double) -> String; static let rowKeys = ["pos", "color", "width", "drive", "level"], rowLabels = ["pitch", "noise", "width", "drive", "level"], rowCodes = [0, −1, 1, 2, 3] }`.
  - `struct InfCirc { var pos: Double; var sinner: Bool; var held, color: Int; var width, drive, level, lvl: Double }`; `struct InfMirror { var time, iceE, stormSemi, stormPh: Double; var fx: [Double] (5, из fxDef); var circ: [InfCirc] (9, начальные); mutating func load(_ b: [Double], n: Int) -> Bool }` — `n < 81` → `false`, прежнее остаётся.
  - `func infHeard(_ b: [Double], n: Int, into out: inout [Int]) -> Int` — дописывает номера кругов в предвыделенный `out`, возвращает число; запись с `n ≤ 0`, не конечным или ≥ 1e6 счётчиком, выходом за длину — стоп; номер не конечный или вне `0…8` — пропуск (образец — `triaHeard`, `TriaMirror.swift:38-55`).

- [ ] **Step 1: тесты** `InfMathTests`:
  - `testGeo`: `InfGeo(W: 390, H: 844, topY: 50, safeBot: 34)` → `top 56, bot 802, cx 195, Ws 390, y0 152, yC 748, dy 596/9.3`, `rings[0] = (152, 179.4, 26.322)`, `rings[8].rx 50.7`, `rings[4].rx 115.05`, `coc = (748, 42.9, 9)`, `dark = (0, 810, 109.2)` (±1e-9).
  - `testCircleAt`: `(195, 152) → 0`; `(195, 152 + dy·0.6) → 1`; `(195, 100) → −1`; `(195 + 179.4 + 19, 152) → −1`, с `loose` → `0`; `(195, 748 + 40) → −1`. `posAt(0, 195) == 0.5`, `posAt(0, 0) == 0`, `posAt(0, 400) == 1`; `at(4, 0.25).x == 195 − 115.05/2`.
  - `testSemiNote`: `infSemi(8, 0, nil) == 0`, `infSemi(8, 0.5, nil) ≈ 3.3333`, `infSemi(0, 0.5, nil) ≈ 56.6667`; `infNote(0) == "A1"`, `infNote(56.6667) == "F#6"`, `infNote(3) == "C2"`; лад `pcs = [0, 2, 3, 5, 7, 8, 10]`: `infSnap(1, pcs) == 0` (равенство — нижняя), `infSnap(6, pcs) == 5`, `infSemi(8, 0.15, pcs) == 0`.
  - `testSheet`: `InfCirc` с `color 2, width 0.4, pos 0.5` → `get("color") == 0.5`, `get("width") == 0.4`; `set("color", 0.99) == (4, 4)`, `set("color", 0.5) == (4, 2)`, `set("pos", 0.3) == (0, 0.3)`, `set("level", 0.6) == (3, 0.6)`; `text("color") == "brown"`, `text("width") == "40%"`, `text("pos", k: 8, pcs: nil) == infNote(infSemi(8, 0.5, nil))`; `rowCodes == [0, −1, 1, 2, 3]`.
  - `testFanText`: `structure 0.2 → "harmonic"`, `0.5 → "scale"`, `0.9 → "metal"`; `storm 0.01 → "off"`, `storm 0.6 → "60%"`; `fire 0.2 → "20%"`.
  - `testMirror`: буфер 81 с меткой на каждом смещении → поля по раскладке (`fx[2] = b[6]`, `circ[3].level = b[9 + 24 + 6]`, `sinner = b[…] > 0.5`, `held` и `color` — `Int`); `testMirrorShort`: `load(…, n: 80) == false`, прежние значения целы; по умолчанию `circ[7].color == 2`, `circ[8].drive ≈ 0.79`, `fx == fxDef`.
  - `testHeard`: `[1, 4, 2, 0, 8]` (две записи подряд) → `[4, 0, 8]`; `testHeardBad`: `[2, 4]` (обрезана) → 0; `[2, 4, 12, 1, 3]` → `[4, 3]` (12 пропущен, следующая запись читается); `[0, 1, 1]` → стоп, 0; `[1, .nan]` → 0, без падения.
- [ ] **Step 2:** тесты падают (нет типов).
- [ ] **Step 3: реализация** по Interfaces; `xcodegen` после правки `project.yml`.
- [ ] **Step 4:** Swift-тесты зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Inferno math, mirror and heard parsing`.

**Ревью задачи:** нет (одно финальное).

### Task 3: Чистый слой — `InfState`

**Files:**
- Create: `ios/app/T2D/Inferno/InfState.swift`
- Test: `ios/app/T2DTests/InfStateTests.swift`

**Interfaces:**
- Consumes: `InfMirror`, `InfCirc`, `InfGeo`, `Inf.*` (задача 2).
- Produces `struct InfState` (время — аргумент, всё предвыделено):
  - поля круга: `mutating func own(_ k: Int, key: Int, _ v: Double, now: Double)` (`key` — `Key` 0…4), `func value(_ k: Int, key: Int, mirror: InfMirror, now: Double) -> Double` — своё, пока `|Δ| ≥ 1e-9` и `now − t < 0.25`, иначе зеркало; `func circ(_ k: Int, mirror: InfMirror, now: Double) -> InfCirc` — круг для картинки и плашки: свои поля, `sinner`, `lvl`, `held` ниже;
  - грешник: `func pinResult(_ k: Int, mirror: InfMirror, now: Double) -> Bool` — `sinner` после `PIN` по правилу `model.js:53-61` (был — `false`; не был — `true`, если грешников (с учётом своих) меньше `pinMax`, иначе `false`); `mutating func ownSinner(_ k: Int, _ on: Bool, now: Double)`; `mutating func clearSinners(now: Double)` — свои `false` у всех девяти; правило своего — как у полей (0.25 с или сходимость);
  - веер: `mutating func ownFx(_ i: Int, _ v: Double, now: Double)`, `func fx(_ i: Int, mirror: InfMirror, now: Double) -> Double` — то же правило;
  - удар: `mutating func strike(_ k: Int, now: Double)`; `lvl` в `circ(…)` = `max(mirror.lvl, exp(−(now − strikeAt)/0.4))`, без удара — зеркало;
  - тление: `mutating func heldAdd(_ k: Int, _ d: Int)`, `func held(_ k: Int) -> Int`; `func burning(_ k: Int, mirror: InfMirror, now: Double) -> Bool` = `sinner || held > 0`;
  - картинка: `private(set) var rot: [Double]` (9); `mutating func spin(dt: Double, mirror: InfMirror, now: Double)` (`view.js:96`); угольки — `mutating func spark(_ k: Int, _ n: Int, geo: InfGeo, R: () -> Double)` (`view.js:35-41`, порядок вызовов `R`: `a`, затем `vx`, `vy`), `mutating func sparkTick(dt: Double, nowMs: Double, mirror: InfMirror, now: Double, geo: InfGeo, R: () -> Double)` (`view.js:97-103`: на круг с `lvl > 0.05` — `R() < dt·30·lvl` → `spark(k, 1)`; движение, `life`; погасшие — удалить перестановкой с последним), `var sparkCount: Int`, `func sparkAt(_ i: Int) -> (x: Double, y: Double, life: Double)`; всё — `dt ≤ 0.1`;
  - `mutating func reset()` — свои значения, `sinner`, `fx`, удары, `held`; вращение и угольки остаются.

- [ ] **Step 1: тесты** `InfStateTests`:
  - `testOwnField`: `own(2, key: 0, 0.8, now: 1)`, зеркало `pos 0.5` → `value == 0.8` при `now 1.1`; при `now 1.26` → `0.5`; зеркало `0.8` при `now 1.05` → `0.8` (сошлось; смена зеркала на `0.6` при `now 1.1` → `0.6`). То же для `color` (`key 4`) и `fx`.
  - `testPinMax`: зеркало с грешниками на 0, 1, 2 → `pinResult(5) == true`; `ownSinner(5, true)` → `pinResult(6) == false` (четыре); `pinResult(1) == false` (снять).
  - `testClearSinners`: зеркало с грешником 3 → после `clearSinners(now: 1)` `circ(3).sinner == false` до `now 1.25`, потом — зеркало.
  - `testLvlAfterStrike`: зеркало `lvl 0` → `strike(4, now: 1)` → `circ(4).lvl == 1` при `now 1`, `≈ e^(−0.5)` при `now 1.2`; зеркало `0.9` при `now 1.2` → `0.9`.
  - `testHeld`: `heldAdd(2, 1)` дважды → `held 2`, `burning`; `heldAdd(2, −1)` → `burning` ещё да; ещё раз → нет.
  - `testSparks`: ГСЧ по зерну; `spark(4, 10, …)` → `sparkCount 10`, все `y ≥ rings[4].cy` и `x` в `cx ± rx`; 20 раз `spark(0, 10)` → 160; `sparkTick` 2 с шагами 0.1 при `lvl 0` → 0 (гаснут за ≈ 1.43 с); `sparkTick(dt: 0.5)` двигает как `dt 0.1`.
  - `testSpin`: `dt` зажат в 0.1 — `spin(dt: 1)` при `lvl 0` → `rot[0] == −0.004`, `rot[1] == 0.004`; зеркало `lvl 1` у круга 2 → `rot[2] == −0.074` (±1e-12).
  - `testReset`: после всего — свои значения и `held` пусты, угольки целы.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner). **Step 5:** коммит `ios/app: Inferno state - own values, strikes, sparks`.

**Ревью задачи:** нет.

### Task 4: `InfernoView` — мир, касания, тление, плашки

**Files:**
- Create: `ios/app/T2D/Inferno/InfernoView.swift`
- Test: `ios/app/T2DTests/InfernoTests.swift` (фейк `Core` — как в `TriaTests.swift`)

**Interfaces:**
- Consumes: задачи 2–3; `World`, `Finger`, `SheetSpec / SheetRow / SheetLfo`, `Core`, `Touch.dtapMs / holdMs`, `LegendRow / Glyph`.
- Produces `final class InfernoView: World`:
  - `static let slotN = 5`; `init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil, rng: (() -> Double)? = nil)` (по умолчанию — `t2d_app_mirror / t2d_app_heard` слота 5 и системный ГСЧ, как `TriaView.swift:53-59`; буферы 96 и 256);
  - `title "Inferno"`, `sub "circuli novem"`, `legend` — 7 строк `view.js:263-265` (глифы `tap, hold, drag, double, draw, hold, tap`);
  - `fx: SheetSpec?` — веер: `title "aether"`, `hint "FX — tap outside to close"`, строки `fxKeys` (`label` = ключ, `code` = индекс), `lfo: SheetLfo(obj: −1, keys: все пять, shape: 0)`, `arc: { fx(2) }`, `get` — `state.fx`, `set` → `FX i [v]` + `ownFx`, `text` — `InfSheet.fanText`; `func circleSpec(_ k: Int) -> SheetSpec` — `title "\(roman[k]) · \(names[k])"`, `hint "circle — tap outside to close"`, строки `InfSheet.rowKeys / rowLabels / rowCodes`, `lfo: SheetLfo(obj: k, keys: ["pos", "width", "drive", "level"], shape: 0)`, `get / text` — по `state.circ(k)`, `set` → `CIRC k [key, value]` + `own` (для `color` — только если сменился);
  - `private(set) var geo: InfGeo`, `mirror: InfMirror`, `state: InfState`; `func holdShot(_ k: Int, pos: Double)` (тестовый хук сцены: как палец, тлеющий на круге `k` в `pos` — `POS`, `HOLD +1`, подсветка и подписи; без пальца); `func isHeld(_ k: Int) -> Bool` (палец или хук);
  - касания — спека, решение 8: палец `{ kind: none | circle, k, t0, x0, y0, x, y, smoulder, harp, sheet }`; `down` — `STRIKE` и `state.strike`, `POS` и `own(pos)` (не грешник), двойной — `PIN` + `ownSinner(pinResult)` (+ `own(pos)`, если ставится); `move` — арфа и высота; `up` / `cancel` — `HOLD −1` и `heldAdd(−1)`, если тлел;
  - `tick(now:dt:)`: зеркало → `mirror`; `heard` (до 4 чтений, как `TriaView.swift:156-163`) → `state.spark(k, 10)`; пальцы → тление > 0.16 с (`HOLD +1`, `heldAdd`) и плашка (`openSheet(circleSpec(k))`, `sheet = true`); `state.spin`, `state.sparkTick`; `idle()` — слить `heard` без угольков; `restored()` — тлеющим пальцам `HOLD −1`, пальцы и `lastTap` забыты, хук `holdShot` снят, `state.reset()`; `cornerHit` — тьма; `objs = 9`; `dice()` — `DICE`, `clearSinners`; `clear()` — `CLEAR`, `clearSinners`;
  - `draw` / `drawShot` — пока пустые (задача 5).

- [ ] **Step 1: тесты** `InfernoTests` (`layout(W: 390, H: 844, topY: 50, safeBot: 34)`, зеркало по умолчанию; точки — `geo.at(k, pos)`; время пальца — `Finger.t0 / touchTime`, `tick(now:)` двигает часы):
  - `testTapStrikes`: тап по `at(4, 0.3)` → `POS 4 [0.3]`, `STRIKE 4 [1]`; `up` без тления — больше ничего; `state.circ(4).lvl == 1`.
  - `testTapSinnerNoPos`: зеркало — грешник на 6 → тап → только `STRIKE 6 [1]`.
  - `testDoubleTapPin`: два тапа по кругу 6 с разницей 0.2 с → второй — `PIN 6 [pos]` без `STRIKE`; `state.circ(6).sinner == true` сразу; разница 0.4 с → два `STRIKE`.
  - `testMissNothing`: тап между кругами (`circleAt == −1`) и в верхнюю строку — ни одного действия.
  - `testSmoulder`: палец на круге 2, `tick` через 0.15 с — ничего, через 0.17 с → `HOLD 2 [1]`; `up` → `HOLD 2 [−1]`.
  - `testDragAlong`: палец на круге 2, сдвиг по x на 5 — ничего; на 20 → `HOLD 2 [1]`, `POS 2 [posAt]`; ещё сдвиг → `POS` без второго `HOLD`.
  - `testHarp`: палец на `at(0, 0.5)`, сдвиг на `at(1, 0.5)` → `POS 1`, `STRIKE 1 [0.8]`; дальше на `at(3, 0.5)` → `STRIKE 3 [0.8]`; сдвиг вдоль круга 3 — ничего; `up` — ничего.
  - `testHarpFromSmoulder`: палец тлеет на круге 0 (`tick` 0.2 с), сдвиг на круг 1 → `HOLD 0 [−1]`, `STRIKE 1 [0.8]`; `tick` 0.5 с — нового `HOLD` нет; `up` — ничего.
  - `testTwoFingersOneCircle`: f1, f2 на круге 2, `tick` 0.2 с → два `HOLD 2 [1]`, `state.held(2) == 2`; `up(f1)` → `HOLD 2 [−1]`, `burning(2)` да; `up(f2)` → ещё `HOLD 2 [−1]`, нет.
  - `testHoldSinnerSheet`: зеркало — грешник на 6; палец на 6, `tick` 0.43 с → одна плашка `VII · Violentia`; ещё `tick` — без новой; без грешника на круге 5 — плашки нет; сдвиг 12 px до 0.42 с — нет.
  - `testCancel`: тлеющий палец, `cancel` → `HOLD −1`.
  - `testRestoredReleasesSmoulder`: тлеющий палец на 2, `restored()` → `HOLD 2 [−1]`; `move / up` — ни одного действия; `state.held(2) == 0`.
  - `testCircleSheetLfo`: `circleSpec(3)`: коды `[0, −1, 1, 2, 3]`, `lfo.obj == 3`, `shape 0`; `set("width", 0.2)` → `CIRC 3 [1, 0.2]`, `get("width") == 0.2` сразу; `set("color", 0.1)` при `color 0` — без действия, `set("color", 0.5)` → `CIRC 3 [4, 2]`.
  - `testFan`: коды `0…4`, `lfo.obj == −1`, `shape 0`; `set("ice", 0.7)` → `FX 3 [0.7]`; `arc()` == `fx(2)`.
  - `testHeardSparks`: фейковый `heard` `[2, 4, 7]` → `state.sparkCount == 20`; `idle()` — сливает без угольков.
  - `testDiceClear`: `dice()` → `DICE`; `clear()` → `CLEAR`, грешник зеркала не рисуется до 0.25 с.
  - `testCorner`: `(20, 790)` → `cornerHit`; `(120, 810)` → нет.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner). **Step 5:** коммит `ios/app: Inferno view - touches, smoulder, sheets, fan`.

**Ревью задачи:** да (касания).

### Task 5: `InfDraw` — стена и кадр; регистрация и сцены

**Files:**
- Create: `ios/app/T2D/Inferno/InfDraw.swift`
- Modify: `InfernoView.swift` (`draw` / `drawShot` — одно и то же: угол-тьма рисуется стеной), `ios/app/T2D/Draw.swift` (`mapText` — необязательный `col: RGB? = nil`, цвет вместо ink темы; для надписи), `ios/app/T2D/Worlds.swift:23` (`view: true`), `ios/app/T2D/App.swift` (`makeView` — ветка `InfernoView.slotN`; `@State inf` рядом с `tria`; список сцен в комментарии и `case` рядом с `tria…`; `shotInferno` рядом с `shotTria`), `ios/app/shot.sh` (комментарий со списком сцен)
- Test: `ios/app/T2DTests/InfernoTests.swift` (`testWallKey`, `testDrawSmoke`)

**Interfaces:**
- Consumes: задачи 2–4; `Draw` (`mapText`, `dot`), образец стены-кеша — `TriaWall` (`TriaDraw.swift`).
- Produces: `final class InfWall { func image(_ g: InfGeo, dpr: CGFloat, draw: (CGContext) -> Void) -> CGImage?; private(set) var builds: Int }` — пересборка только при смене ключа `W×H×DPR | y0 | yC`; `extension InfernoView { func drawFrame(_ d: Draw, now: Double) }`.
- Сцены `shotInferno` (через `AppCore(slot: 5)`, как `shotTria`): `inferno` — `PIN 6 [0.4]`; `inferno-held` — `holdShot(2, pos: 0.8)` через +3 с; `inferno-sheet` — `PIN 6 [0.4]`, `host.shotSheet(inf.circleSpec(6))` через +1.5 с; `inferno-fx` — `PIN 6 [0.4]`, `PIN 2 [0.3]`, `FX 3 [0.7]`, `FX 2 [0.7]` сразу; `inferno-storm` — `PIN 1 [0.5]`; `inferno-fan` — `host.shotSheet(inf.fx!, lfoKey: "fire"); host.shotLfo(rate: 1, depth: 0.5)` через +1.5 с. Действие сцены — раньше кадра `shot.sh` (+5 с).

- [ ] **Step 1: тесты:** `testWallKey` — два вызова с тем же `InfGeo` → `builds == 1`; смена `H` → 2; смена DPR → 3. `testDrawSmoke` — `drawFrame` в `UIGraphicsImageRenderer` 390×844 с зеркалом: грешники на 1 и 6, `lvl 0.8` у 1–3, `iceE 0.6`, `stormSemi 0.4`, 40 угольков, `holdShot(2, pos: 0.8)` — не падает; на кадре есть непустые пиксели у круга 4 и у Коцита.
- [ ] **Step 2:** падают. **Step 3:** реализация — перенос `view.js:119-246` построчно (стена `:119-150`, надпись `:151-163`, дым `:164-174`, пламя `:175-184`, грешник `:185-190`, кадр `:191-244`); значения альфы, радиусов, шагов — из `view.js`, своих не вводить; плашка в `draw` не открывается (она в `tick`). **Step 4:** зелёные (test-runner); `ios/app/shot.sh inferno` собирается и даёт png.
- [ ] **Step 5:** коммит `ios/app: Inferno drawing, registry, shot scenes`.

**Ревью задачи:** нет.

### Task 6: Снимки, доки, выкладка

**Files:**
- Modify: `docs/native-ios-plan.md` (фаза 3: Inferno сделан, ждёт iPhone), `docs/worlds/inferno.md` (раздел «Натив»: где код, `ACT_LFO`, собственные значения, `lvl` после удара, кубик в ядре, отмена снимает тление, решено без автора), `core/README.md` (`ACT_LFO` Inferno), `docs/testing.md` (сцены `inferno*` и веб-пары, тесты `InfMathTests / InfStateTests / InfernoTests`), `docs/tokens.md`, `sw.js` / `index.html` (новый `CACHE` = `?v=` — изменился `t2d.wasm`)

- [ ] **Step 1:** главный поток — один проход агента `shots`: веб `python3 tools/shot.py inferno` (нужен `python3 -m http.server 8765`; пары `inferno-held, inferno-sheet, inferno-fx, inferno-storm`) и нативные `ios/app/shot.sh inferno | inferno-held | inferno-sheet | inferno-fx | inferno-storm | inferno-fan`; сверка глазами: воронка и стенки, тьма в углу, надпись, дым, круги и засечки, пламя, грешники, иней и трещины Коцита, буря на втором круге, угольки, подписи круга в руке, плашка и веер (заголовки, строки, тексты, полоса LFO). Расхождения — правка в задаче 5, повторный прогон только расходящихся сцен.
- [ ] **Step 2:** финальное ревью всей ветки от `07bfa93` (одно; opus).
- [ ] **Step 3:** доки по списку; `CACHE` в `sw.js` и `?v=` в `index.html` — следующее число (одно и то же); строка `docs/tokens.md` (`python3 tools/tokens.py --line` + агенты).
- [ ] **Step 4:** коммит `docs: iOS phase 3 Inferno` (отдельно от пуша — хук проверяет `git push` до цепочки), пуш, `python3 tools/deploy-wait.py` → `success`.

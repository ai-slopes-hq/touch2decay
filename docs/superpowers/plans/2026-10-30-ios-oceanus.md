# iOS фаза 3 — Oceanus на Swift: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VIII · Oceanus — второй нативный мир: картинка, касания, плашки Луны и города, веер FX с LFO `classic`, легенда; попутно — `ACT_LFO` в ядре Oceanus, полоса `classic` на паде, `World.enter` / `World.scale`, ступени лада из ядра, правило лада для двух миров, повёрнутый курсив.

**Architecture:** модель и звук — в ядре (`core/worlds/oceanus/`); Swift разбирает зеркало и шлёт действия, как Firmamentum (`ios/app/T2D/Firmamentum/`). Ядро: `case sdk::ACT_LFO` для FX-строк и `t2d_app_scale_steps` в C-ABI. Хост: два новых метода протокола мира, лад в `prefs.json`, `perScl` из сцен. Мир: `ios/app/T2D/Oceanus/` — `Mirror.swift`, `Geo.swift`, `Sheets.swift`, `OceanusView.swift` (касания и действия), `OceanusDraw.swift` (рисование).

**Tech Stack:** C++17 (`core/tests/sdk_test.cpp`), Swift 5 + UIKit + CoreGraphics, XCTest, XcodeGen; веб-эталон снимков — `python3 tools/shot.py oceanus`.

**Spec:** `docs/superpowers/specs/2026-10-30-ios-oceanus-design.md` — читать целиком перед любой задачей. Веб-источник истины — `worlds/oceanus/view.js` (картинка, касания, плашки) и `worlds/oceanus/model.js` (только константы и `dirty` / `gone`).

## Global Constraints

- Ветка `native`; в `main` не идёт. Коммиты — по-английски, тело-список, последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `notebooks/*` не трогать.
- Ядро: C++17, `-ffp-contract=off`; в `render` / `process` — без блокировок и аллокаций. Правка `core/worlds/` → пересобрать `t2d.wasm` (`core/build.sh`) и закоммитить вместе; правка только `core/app/` — метка `[no-wasm]`. Комментарии — по-русски, плотность как в соседнем коде.
- Миры заморожены: поведение веба и звук Oceanus не меняются (`node --test tools/models/oceanus.test.mjs`, `core/build.sh && node --test tools/test-ocean-core.mjs` — зелёные до и после).
- Swift: новые файлы в `T2D/` попадают в `T2D` и `T2DTests` сами; после — `xcodegen` в `ios/app`. Комментарии — по-русски, как в `Firmamentum/`.
- Тесты: ядро — `core/build.sh && core/build/sdk-test` → `0 failed`; Swift — `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|failed|passed|SUCCEEDED|FAILED" | tail -30` → `** TEST SUCCEEDED **`.
- Картинка — перенос `view.js` на `Draw` без новых решений: `d.mapText` (IM Fell, курсив), `d.text` (прямой), плашки внутри `d.reading { }`. Никакого `shadowBlur`, градиентов на кадр, полноэкранных проходов; стена — кеш `CGImage`; свечение — кеш спрайтов (`glowAt`); без аллокаций на кадр в горячих циклах (пена, кольцо 64 точки).
- Константы касаний — `Touch.tapMs = 220`, `Touch.tapMove = 14`, `Touch.dtapMs = 320`, `Touch.holdMs = 420` (= `HOLD_MS` веба), `Touch.holdMove = 10` (`T2D/Touch.swift:6`).
- Oceanus: слот 8; `N = 64`, `VMAX = 6`, `PIN_MAX = 4`; цвета — `INK 206,222,226`, фон `#081018` (тема в `Worlds.swift`).
- Порядок FX ядра — `TENSION 0, DAMPING 1, WIND 2, TIDE 3, HALL 4`; `Luna` — `ORBIT 0, STORM 1, SWAY 2, TO 3`; `Key` — `LVL 0, OCT 1, PATH 2, PINNED 3, NKEY 4`. Код FX-строки LFO = `4 + индекс FX ядра`.

## Review Focus

1. **Два пальца: один толкает воду, другой ставит город** — у каждого пальца своё действие (`PUSH` со своим `fingerId`, `RELEASE` по подъёму), город не получает `RELEASE`, вода не получает `ADD`. Тест — задача 4 (`testPushAndTapTwoFingers`).
2. **Город убран здесь (двойной тап), а зеркало ещё старое** — убранный город не рисуется и не ловит касания до следующего зеркала без него; новый id не совпадает с убранным. Тест — задача 4 (`testDroppedHiddenUntilMirror`).
3. **Пятый оставленный город** — двойной тап на пустой суше при 4 оставленных даёт временный город, не оставленный (`PIN_MAX`). Тест — задача 4 (`testPinMax`).
4. **Лад не общий, старт на карте, вход в мир** — первый вход ставит лад этого мира из его сцены (раньше `goWorld` менял лад только при `lastSlot != nil`). Тест — задача 2 (`testUnlinkedFirstEnterAppliesWorldScale`).
5. **Плашка города открыта, город пропал** (кубик / корзина / undo) — плашка закрывается, правки не уходят в чужой id. Тест — задача 4 (`testSheetClosesWhenCityGone`).

---

### Task 1: Ядро — LFO строк FX у Oceanus, ступени лада в C-ABI

**Files:**
- Modify: `core/worlds/oceanus/world.cpp:36-53` (switch `action`), `core/worlds/oceanus/world.hpp:14-26` (комментарий кодов), `core/app/t2d_app.h` (объявление), `core/app/t2d_app.cpp` (реализация), `t2d.wasm` (пересборка)
- Test: `core/tests/sdk_test.cpp` (новые функции рядом с `lfoForeign`, вызов — в строке списка `main()`)

**Interfaces:**
- Produces: `ACT_LFO` у слота 8: `t2d_app_action(8, sdk::ACT_LFO, -1, [4 + Fx, v], 2, 0)` → `setFx(Fx, v)`; `i ≥ 0` и ключ вне `[4, 9)` — пропуск.
- Produces: `int t2d_app_scale_steps(int idx, int* out)` — пишет 7 ступеней лада `idx` (полутоны от тоники, `Scale::stepsOf`), возвращает 7; `idx` вне `0…5` — 0, `out` не трогает.

- [ ] **Step 1: тесты.**
  - `oceanLfo`: `t2d_app_init(48000, 7, 1e9, 1u << 8)`; `WAKE`; `ACT_LFO(-1, [4 + 3, 0.3])` (TIDE); рендер ≥ 1 блока; в зеркале `fx[3] == 0.3` (±1e-9), остальные `fx` — по умолчанию (`FX_DEF`); затем `ACT_LFO(-1, [4 + 2, 0.8])` → `fx[2] == 0.8`, `fx[3]` по-прежнему 0.3.
  - `oceanLfoIgnores`: `ACT_LFO(0, [4, 0.5])` (obj ≥ 0), `ACT_LFO(-1, [9, 0.5])`, `ACT_LFO(-1, [3, 0.5])`, `ACT_LFO(-1, [4])` (`n = 1`) — зеркало побайтно как без них.
  - `appScaleSteps`: для `idx 0…5` — ровно таблица `host/scale.js:2-9` (`major [0,2,4,5,7,9,11]` … `mixolydian`); `idx −1` и `6` → 0, буфер не тронут.
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` — новые тесты падают.
- [ ] **Step 3: реализация.** `case sdk::ACT_LFO` по образцу `core/worlds/firmamentum/world.cpp:43-56`: только ветка FX (`i == -1`, `NKEY ≤ key < NKEY + NFX` → `model_.setFx(key - NKEY, v)`); объектных ключей нет. `t2d_app_scale_steps` — тонкая обёртка над `Scale::stepsOf`.
- [ ] **Step 4:** `core/build.sh && core/build/sdk-test` → `0 failed`; `node --test tools/test-ocean-core.mjs tools/models/oceanus.test.mjs` — зелёные.
- [ ] **Step 5:** коммит `core: ACT_LFO for Oceanus FX rows, t2d_app_scale_steps` вместе с `t2d.wasm` (хук `guard.py` проверит).

### Task 2: Хост — `enter`, `scale` у мира, правило лада

**Files:**
- Modify: `ios/app/T2D/World.swift` (протокол + расширение), `ios/app/T2D/Host/HostCore.swift` (протокол и `AppHostCore`), `ios/app/T2D/Host/Host.swift` (`scl`, `init`, `goWorld:308-317`, `go:102-105`, `reapply:502-523`, `savePrefs:185`), `ios/app/T2D/Host/Store.swift:4-7` (`PrefsFile.scl`)
- Modify (фейки): `ios/app/T2DTests/HostTests.swift` (`HCore`, поддельный мир), `MeterTests.swift` (`NullHostCore`), `UndoTests.swift` (`FakeCore`)
- Test: `ios/app/T2DTests/HostTests.swift`, `StoreTests.swift`

**Interfaces:**
- Consumes: `t2d_app_scale_steps` (задача 1).
- Produces: в `World` — `func enter()` и `func scale(pcs: [Int]?, root: Int)`, оба с пустой реализацией в `extension World`. `pcs` — ноты лада по модулю 12 от A (`(step + root) % 12`, как `scalePCs` в `host/scale.js:28`), `nil` — лад выключен; `root` — `scl.on ? scl.root : 0` (как `root()` в `worlds/oceanus/model.js:36`).
- Produces: в `HostCore` — `func scaleSteps(_ idx: Int) -> [Int]` (7 чисел или `[]`).
- Produces: `PrefsFile.scl: Scl? = nil` (версия файла — 1).

- [ ] **Step 1: тесты** (`HostTests`, поддельный мир записывает вызовы `enter` и `scale`; `HCore.scaleSteps` — таблица веба):
  - `testGoWorldCallsEnter`: `goWorld(10)` → `enter` у мира 10 один раз; `go(10)` — тоже.
  - `testScalePushedToWorlds`: смена лада (`major`, root 3) → у каждого мира `scale(pcs: [3,5,7,8,10,0,2], root: 3)`; выключили → `scale(pcs: nil, root: 0)`; при `init` мир получает текущий лад.
  - `testLinkedScaleFromPrefs`: prefs `scl = minor/5`, сцены миров 10 и 2 со своими ладами; после `reapply` лад — `minor/5`, ядру ушёл он же; `savePrefs` пишет текущий лад.
  - `testUnlinkedSeedsPerSclFromScenes`: `link.scale = false`, сцены 10 (`dorian/2`) и 2 (`lydian/7`); `reapply` на карте → лад из prefs; `goWorld(2)` → `lydian/7`; на карту, `goWorld(10)` → `dorian/2`.
  - `testUnlinkedFirstEnterAppliesWorldScale` (Review Focus 4): как выше, но первый вход сразу `goWorld(10)` при `lastSlot == nil` → `dorian/2`.
  - `testReinitKeepsLiveScale`: второй `reapply` (reinit ядра) не перетирает живой лад сценой.
  - `StoreTests.testPrefsSclOptional`: старый `prefs.json` без `scl` читается, `scl == nil`; запись и чтение с `scl` — равны.
- [ ] **Step 2:** прогон Swift-тестов — новые падают (не компилируются — нет методов).
- [ ] **Step 3: реализация.**
  - `World`: два метода + пустые реализации в расширении; Firmamentum не меняется.
  - `HostCore.scaleSteps` — в `AppHostCore` через `t2d_app_scale_steps`; три фейка — таблица `host/scale.js`.
  - `Host.scl` — `didSet` раздаёт `scale(pcs:root:)` всем `views` (pcs из `core.scaleSteps(scl.idx)`); в конце `init` — один раз.
  - Правило лада: `init` при `link.scale` берёт `prefs.scl ?? .off`. `reapply` при запуске: `link.scale` — лад из сцен не берётся; иначе `perScl[slot] = сцена.scl` для каждого мира, текущий — `perScl[мир]`, если стартуем в мире (`nav.view == .world`), иначе из prefs. Строку `if first { scl = sc.scl }` убрать.
  - `goWorld`: при `!link.scale` — сохранить `perScl[from]`, если `from` есть и другой; поставить `perScl[slot]`, если есть (независимо от `lastSlot`). Затем `views[slot]?.enter()`. `go` тоже зовёт `enter()`.
  - `savePrefs` пишет `scl`.
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** коммит `ios/app: World.enter and scale, scale rule for two native worlds`.

### Task 3: Полоса `classic` на паде, повёрнутый курсив

**Files:**
- Modify: `ios/app/T2D/Host/SheetDraw.swift:66-86` (ветка формы), `ios/app/T2D/Draw.swift:94` (`mapText`)
- Test: `ios/app/T2DTests/SheetTests.swift`, `DrawTests.swift`

**Interfaces:**
- Produces: `Draw.mapText(_ s: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, _ a: CGFloat, align: Align = .left, italic: Bool = true, angle: CGFloat = 0)` — поворот вокруг `(x, y)`, радианы, по часовой (как `ctx.rotate` в вебе).
- Produces: `SheetDraw` рисует по `SheetLfo.shape`: `1` — `random` (как сейчас), `0` — `classic`.

- [ ] **Step 1: тесты.**
  - `SheetTests.testClassicStripNineForms`: плашка с `SheetLfo(shape: 0)` и LFO на строке (`morph = 0.5`) в битмап 390×844; в полосе формы чернила есть в каждой из 9 колонок `p.x + 22 + i/8·(p.w − 44)` (±12 pt), рамка выбора — у `x = p.x + 22 + 0.5·(p.w − 44)` (яркие пиксели рамки ±26 pt); `sample` вызывался с `shape: 0`.
  - `SheetTests.testRandomStripUnchanged`: `shape: 1` — по-прежнему 4 значка (чернила в 4 колонках `(i + 0.5)/4`, нет в колонке `i = 0` classic у самого края).
  - `DrawTests.testMapTextAngle`: `"Mare Magnum"` при `angle: .pi/2` — рамка чернил выше, чем шире (высота > 3× ширины); при `angle: 0` — наоборот.
- [ ] **Step 2:** Swift-тесты — новые падают.
- [ ] **Step 3: реализация.**
  - `classic` — по `host/sheet.js:148-149`: 9 кривых `d.drawCurve({ u in sample(0, Double(i)/8, u, 0) }, p.x + 22 + i/8·(p.w − 44), sh.y + sh.h/2, 24, 16, 0.3, cycles: 1, lw: 1.1)`; выбранная — `hairBox(mx − 24, sh.y + 4, 48, sh.h − 8, 0.9)` и кривая `sample(0, morph, u, 0)` 38×22, `a 1`, `cycles 1.5`, `lw 1.6`; NaN-morph → 0 (как ветка `random`).
  - `mapText(angle:)` — `saveGState`, translate в `(x, y)`, rotate, рисование в `(0, 0)`, `restoreGState`; при `angle == 0` путь прежний.
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** коммит `ios/app: classic LFO strip on the pad, rotated mapText`.

### Task 4: Oceanus — зеркало, геометрия, касания, плашки

**Files:**
- Create: `ios/app/T2D/Oceanus/Mirror.swift`, `ios/app/T2D/Oceanus/Geo.swift`, `ios/app/T2D/Oceanus/Sheets.swift`, `ios/app/T2D/Oceanus/OceanusView.swift`
- Test: `ios/app/T2DTests/OceanusTests.swift` (по образцу `FirmamentumTests`: `Rec: Core`, фейковый `readMirror`)

**Interfaces:**
- Consumes: `World` (с `enter`, `scale` из задачи 2), `Core.action`, `SheetSpec` / `SheetRow` / `SheetLfo` (`Host/Sheet.swift`), `Touch.holdMs`.
- Produces: `struct City { slot, id: Int; ang, rn: Double; pinned: Bool; lvl, oct, path, hz, gain: Double }`, `struct OceanMirror { fx: [Double] /*5*/, luna: [Double] /*4*/, moon: Double, shape: [Double] /*64*/, cities: [City] }` с `static func parse(_ b: ArraySlice<Double>) -> OceanMirror` (раскладка — спека, решение 3; короче шапки 75 — пустое зеркало).
- Produces: `struct OceanGeo` (`init(W:H:topY:safeBot:)`; `cx, cy, Rf, Rd` и др. — как `geo` в `view.js:16`; `polar`, `at`, `surf`, `moonPos` — `view.js:21-24`).
- Produces: `final class OceanusView: World` — `static let slotN = 8`; `init(core: Core, geo: OceanGeo, readMirror: @escaping (inout [Double]) -> Int)`; `var fxSpec: SheetSpec`; `func lunaSpec() -> SheetSpec`, `func citySpec(_ id: Int) -> SheetSpec` (для сцен `-shot`); `var mirror: OceanMirror { get }` и `var ui: OceanUI { get }` — `struct OceanUI { ripples: [Ripple] /* a, r, t0; до 12 */; touching: Bool /* палец на поле — подписи */; heldCity: Int? }`; рисование в задаче 5 читает только `mirror`, `ui` и геометрию.

- [ ] **Step 1: тесты** (`OceanusTests`; зеркало собирается хелпером `setMirror(cities:fx:luna:)`; координаты — через `OceanGeo`):
  - `testParseMirror`: шапка 75 + 2 города → поля по раскладке; `fx` в порядке ядра.
  - `testTapLandAddsTemp`: тап по суше → `ADD 0 [ang, rn, 0, slot, id]` (`slot` — первый свободный из `0…5` среди видимых городов, как `make` в `model.js:44-50`; занято все 6 — тап ничего не шлёт), `id = max(зеркало, выданный) + 1`; отпускание временного — `DROP`.
  - `testDoubleTapPins` / `testDoubleTapUnpins`: двойной тап (`< dtapMs`, ≤ 34 pt) по пустой суше → `ADD` с `pinned 1`; по оставленному — `DROP id`.
  - `testPinMax` (Review Focus 3).
  - `testDragCityMoves`: тянуть город → `MOVE id [ang, rn]`.
  - `testWaterPushRelease`: палец на воде → `PUSH [fingerId, a, d]`, движение — новые `PUSH`, подъём → `RELEASE [fingerId]`.
  - `testQuickTapSplashes`: тап по воде без сдвига `< 220 мс` → `SPLASH [a, amt]` + рябь в `ui.ripples`.
  - `testPushAndTapTwoFingers` (Review Focus 1).
  - `testDroppedHiddenUntilMirror` (Review Focus 2).
  - `testMoonHoldOpensLuna`: палец на Луне (r 26), `tick` после `HOLD_MS·0.6` → `openSheet` с `lunaSpec`; удержание оставленного города `HOLD_MS` → `citySpec(id)`; временного — нет.
  - `testSheetClosesWhenCityGone` (Review Focus 5): плашка города открыта, зеркало без города → `objGone(id)` вызван (хост закрывает плашку по `objGone`, `Host.swift:82-86`).
  - `testLunaRows`: `storm` двоичный (≥ 0.5 → 1), `to` — 3 значения `tension / pitch / damping`, `pull` пишет `FX 3` (TIDE), остальные — `LUNA k`.
  - `testCityRows`: `lvl`, `oct` (−1…1, шаг 1), `path` (`orbis / retro / pendulum`) → `SET id [key, v]`.
  - `testFanCodes`: `fxSpec.rows` — порядок `tension, damping, tide, wind, hall`, коды `4, 5, 7, 6, 8`; `lfo = SheetLfo(obj: -1, keys: все 5, shape: 0)`; `set` шлёт `FX k` по индексу ядра; `arc` — `fx.hall`.
  - `testEnterWakes`: `enter()` → `WAKE 11`; `dice()` → `DICE 10`; `clear()` → `CLEAR 9`.
  - `testCornerHit`: угол — четверть солнца (как `cornerHit` Firmamentum).
- [ ] **Step 2:** Swift-тесты — новые падают (нет типов).
- [ ] **Step 3: реализация** по `view.js:38-112` (касания, `tick` удержаний), `:88-105` (плашки), `:250-262` (веер, легенда — 8 строк с глифами), `model.js:31-35` (`dirty` / `gone`: правленный / убранный здесь город рисуется и ловится по своему, пока зеркало его не догонит). Id городов — как `issued` у Firmamentum (`FirmamentumView.swift:303-312`). `objGone` — по разнице id оставленных городов в зеркале (как `FirmamentumView.swift:71`). `restored()` — бросить пальцы, удержания, рябь, `dirty` / `gone`. `objs` — число городов. `title`, `theme` — из `Worlds.swift`. `draw` пока пустой (задача 5).
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** коммит `ios/app: Oceanus mirror, geometry, touches, sheets`.

### Task 5: Oceanus — рисование, регистрация, сцены `-shot`

**Files:**
- Create: `ios/app/T2D/Oceanus/OceanusDraw.swift`
- Modify: `ios/app/T2D/Oceanus/OceanusView.swift` (`draw`, `drawShot`, `scale`), `ios/app/T2D/Worlds.swift:27` (`view: true`), `ios/app/T2D/App.swift:25-29` (`makeView` — слот 8), `App.swift:59-80` (сцены), `ios/app/shot.sh:2` (список сцен)
- Test: `ios/app/T2DTests/OceanusTests.swift`

**Interfaces:**
- Consumes: `OceanusView.mirror`, `ui`, `OceanGeo` (задача 4); `scale(pcs:root:)` (задача 2); `Draw.mapText(angle:)` (задача 3); `Draw.glowAt` / кеш спрайтов; `d.sunGlyph(x, y, -.pi/2, 0, scale: 1.2, now: now*1000, col:, disc:)` (`FirmamentumView.swift:273`).

- [ ] **Step 1: тесты.**
  - `testWallCachedByKey`: два кадра подряд — стена строится один раз; смена лада (`scale(pcs:root:)`) или размера — перестраивается.
  - `testWallScaleTicks`: стена при `pcs = [0,2,4,5,7,9,11]` — длинные риски ровно на 7 нотах из 12 (пиксели на концах длинных рисок), при `nil` — все 12 короткие.
  - `testFoamDeterministic`: два вида с одним сидом после одинаковых `tick` дают одинаковый кадр (сравнить битмапы).
  - `testLabelsOnlyWhileTouching`: подписи нот / климата — только пока палец на поле (чернила в зоне подписи есть при пальце, нет без него).
- [ ] **Step 2:** Swift-тесты — новые падают.
- [ ] **Step 3: реализация** по `view.js:114-249`: `wall` (румбы, рамка, T-O, «Mare Magnum» и 8 ветров повёрнутым курсивом, 12 рисок нот — длиннее на нотах лада) в `CGImage` с ключом `W×H×scale|cy|pcs|root`; `drawCurrents`, `drawReflection`, `drawOcean` (кольцо 64 точки из `mirror.shape`), `drawVoices` (луч скана — фаза от `now`, `hz`, `path`; свечение при `gain > 0.05`), пена 44 штриха (сидированный rng вместо `Math.random`, `view.js:161`), рябь до 12 по 1.3 с, ореол Луны, подписи нот (`noteName` от `hz`) и климата — пока палец на поле; угол — четверть солнца; `drawShot` — без угла. Регистрация: `Worlds.swift` слот 8 `view: true`, `makeView` — `OceanusView(core: AppCore(slot: 8), geo: OceanGeo(W: 390, H: 844, topY: 59, safeBot: 34))`.
  - Сцены `-shot` (через `host.go(8)` и касания / `openSheet`, как у Firmamentum): `oceanus` (2 оставленных города и временный под пальцем — как веб `oceanus-held`), `oceanus-sheet` (плашка города), `oceanus-luna` (плашка Луны), `oceanus-fan` (веер FX с LFO на `tide`, полоса `classic`). Сиды — фиксированные.
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** агент `shots`: `ios/app/shot.sh oceanus|oceanus-sheet|oceanus-luna|oceanus-fan` против веба `python3 tools/shot.py oceanus` (`.shots/oceanus-held.png`, `oceanus-sheet.png`, `oceanus-luna.png`, `oceanus.png`); вердикт глазами — стена, румбы, надписи, риски, кольцо, города, луч, Луна, плашки и веер на местах, шрифты; отличия только ожидаемые (пена и рябь — другой сид). Расхождения — исправить и повторить.
- [ ] **Step 6:** коммит `ios/app: Oceanus drawing, registry, shot scenes`.

### Task 6: Доки, выкладка

**Files:**
- Modify: `docs/native-ios-plan.md` (фаза 3: порядок без Goetia — «только веб (автор, 30.10)»; Oceanus сделан, ждёт iPhone), `docs/ios-2b-deferred.md` (правило лада и `classic` — закрыто; сброс двойным тапом — остаётся), `docs/worlds/oceanus.md` (раздел «Натив»: где код, LFO на веере через ядро), `docs/architecture.md` или `core/README.md` (`World.enter`, `World.scale`, `t2d_app_scale_steps`, `ACT_LFO` у Oceanus), `docs/testing.md` (сцены `oceanus*` и веб-пары), `docs/tokens.md`, `sw.js` / `index.html` (новый `CACHE` = `?v=` — изменился `t2d.wasm`)

- [ ] **Step 1:** доки по списку; строка `docs/tokens.md` (`python3 tools/tokens.py --line`).
- [ ] **Step 2:** `CACHE` в `sw.js` и `?v=` в `index.html` — следующее число (одно и то же).
- [ ] **Step 3:** коммит `docs: iOS phase 3 Oceanus`; после финального ревью — пуш `native`, `python3 tools/deploy-wait.py` → `success`.

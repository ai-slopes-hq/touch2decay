# iOS фаза 3 — Monochordum на Swift: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VII · Monochordum — третий нативный мир: картинка, касания (щипок, флажолет, смычок, перебор, кобылка, ветер, земля), плашки струны / земли / ветра, веер FX с LFO, легенда; попутно — `ACT_LFO` и `DICE` в ядре Monochordum, снятие LFO строки миром (корзина).

**Architecture:** модель и звук — в ядре (`core/worlds/monochord/`); Swift разбирает зеркало и heard, шлёт действия, как Oceanus (`ios/app/T2D/Oceanus/`). Все LFO Monochordum — строки мира (`obj −1`) с разными ключами, поэтому хост их при restore не гасит (как в вебе: LFO струн переживают undo). Мир: `ios/app/T2D/Monochord/` — `MonoMirror.swift`, `MonoGeo.swift`, `MonoSheets.swift`, `MonochordView.swift` (касания, действия, тик), `MonoDraw.swift` (рисование).

**Tech Stack:** C++17 (`core/tests/sdk_test.cpp`), Swift 5 + UIKit + CoreGraphics, XCTest, XcodeGen; веб-эталон снимков — `python3 tools/shot.py monochord`.

**Spec:** `docs/superpowers/specs/2026-10-30-ios-monochordum-design.md` — читать целиком перед любой задачей. Веб-источник истины — `worlds/monochord/view.js` (картинка, касания, плашки, легенда) и `worlds/monochord/model.js` (только константы, `noteOf`, `dice`).

## Global Constraints

- Ветка `native`; в `main` не идёт. Коммиты — по-английски, тело-список, последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `notebooks/*` и `.superpowers/` не коммитить.
- Ядро: C++17, `-ffp-contract=off`; в `render` / `process` — без блокировок и аллокаций. Правка `core/worlds/` → пересобрать `t2d.wasm` (`core/build.sh`) и закоммитить вместе. Комментарии — по-русски, плотность как в соседнем коде.
- Миры заморожены: поведение веба и звук Monochordum не меняются (`node --test tools/models/monochord.test.mjs`, `core/build.sh && node --test tools/test-mono-core.mjs` — зелёные до и после).
- Swift: новые файлы в `T2D/` попадают в `T2D` и `T2DTests` сами; после — `xcodegen` в `ios/app`. Комментарии — по-русски, как в `Oceanus/`.
- Тесты: ядро — `core/build.sh && core/build/sdk-test` → `0 failed`; Swift — `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|failed|passed|SUCCEEDED|FAILED" | tail -30` → `** TEST SUCCEEDED **`.
- Картинка — перенос `view.js` на `Draw` без новых решений: `d.mapText` (IM Fell, курсив; `angle:` для повёрнутых), `d.text` (прямой), плашки внутри `d.reading { }`. Никакого `shadowBlur`, градиентов на кадр, полноэкранных проходов; стена — кеш `CGImage`; свечение — `glowAt` (кеш спрайтов); без аллокаций на кадр в горячих циклах (волна 40 точек — буфер заранее).
- Константы касаний — `Touch.tapMs = 220`, `Touch.dtapMs = 320`, `Touch.holdMs = 420` (= `HOLD_MS` веба), `Touch.holdMove = 10` (`T2D/Touch.swift`). Пороги мира — как в `view.js`: мёртвая зона ветра 6 px, ветер `/140`, кобылка ±20 px, узел < 7 px, смычок > 8 px и 150 мс, гаснет через 120 мс ×0.8 за кадр.
- Monochordum: слот 7; `N = 4` струны; тема `.base`; `F_OPEN = [55, 82.5, 110, 165]`.
- Ядро Monochordum: действия `PLUCK 0, HARM 1, BOW 2, SUS 3, BRIDGE 4, STRING 5, WIND 6, FX 7, AUTO 8, AUTOPAR 9, CLEAR 10, DICE 11`; `Fx` — `DECAY 0, BRIGHT 1, BODY 2, SYMPATHY 3, CHORUS 4, CHANCE 5, HALL 6`; `Key` — `PITCH 0, KBRIGHT 1, KDECAY 2, LEVEL 3, R 4`; `AutoKey` — `ON 0, BPM 1, DIV 2, PATTERN 3, STRENGTH 4, SWING 5`.
- **Коды LFO** (`ACT_LFO`, всегда `obj −1`, `a = [key, v]`): FX `0…6` = индекс `Fx`; ветер `7`; `strength 8`; `swing 9`; струна `i`, строка `k` (`pitch 0, brightness 1, decay 2, level 3`) — `10 + 4·i + k`. Тот же код — `SheetRow.code`.
- Зеркало (52 числа): `fx[7]`, `wind`, `lastWind`, `auto[6]`, `step`, затем 4 × `r, sus, bright, decay, level, bow, en, eh, hn`. heard — `[удары, шаг]` или 0 чисел.

## Review Focus

1. **Два пальца: один тянет кобылку, другой щиплет соседнюю струну** — у каждого пальца своё действие; кобылка не щиплется, щипок не двигает кобылку. Тест — задача 3 (`testBridgeAndPluckTwoFingers`).
2. **Перебор через струну, у которой палец ниже кобылки** — струна глушёная ниже кобылки: пересечение её x ниже `yb` не щиплет. Тест — задача 3 (`testStrumSkipsBelowBridge`).
3. **Корзина при работающем LFO ветра** — LFO ветра снят до `CLEAR` (одно кольцо: `lfoOff` → `CLEAR`), ветер после корзины 0, LFO струн и FX остались. Тест — задача 2 (`testClearDropsOnlyWindLfo`) и задача 3 (`testClearOrder`).
4. **Удержание земли, потом подъём** — плашка открыта, подъём пальца не переключает автоперебор. Тест — задача 3 (`testEarthHoldNoToggle`).
5. **Двойной тап по разным струнам** — `SUS` только при двух тапах по той же струне в `dtapMs`; тап по I, затем по II — два щипка. Тест — задача 3 (`testDoubleTapOtherString`).

---

### Task 1: Ядро — LFO строк и кубик у Monochordum

**Files:**
- Modify: `core/worlds/monochord/world.hpp` (`Act` + комментарий: `DICE`, коды LFO), `core/worlds/monochord/world.cpp` (`action`), `core/worlds/monochord/model.hpp` / `model.cpp` (`void dice()`), `t2d.wasm` (пересборка)
- Test: `core/tests/sdk_test.cpp` (рядом с `oceanLfo` ~3160, вызов — в списке `main()`)

**Interfaces:**
- Produces: `ACT_LFO` у слота 7 по кодам из Global Constraints: FX → `setFx`, `7` → `setWind`, `8` / `9` → `setAutoPar(STRENGTH / SWING)`, `10…25` → `setString(i, k, v)` (`k = PITCH…LEVEL`, `pitch` без прилипания); `i ≠ −1`, `n < 2`, ключ вне `0…25` — пропуск.
- Produces: `DICE 11` → `Model::dice()`.

- [ ] **Step 1: тесты.**
  - `monoLfo`: `t2d_app_init(48000, 7, 1e9, 1u << 7)`; `ACT_LFO(-1, [4, 0.6])` → зеркало `fx[CHORUS] == 0.6`; `[7, 0.4]` → `wind == 0.4`; `[8, 0.7]` → `auto[STRENGTH] == 0.7`; `[9, 0.2]` → `auto[SWING] == 0.2`; `[10 + 4·2 + 2, 0.3]` → струна 2 `decay == 0.3`; `[10 + 4·1 + 0, 0.5]` → струна 1 `r == 2^(−1)` = 0.5 (±1e-9, без прилипания).
  - `monoLfoIgnores`: `ACT_LFO(0, [4, 0.5])`, `ACT_LFO(-1, [26, 0.5])`, `ACT_LFO(-1, [-1, 0.5])`, `ACT_LFO(-1, [4])` — зеркало побайтно как без них.
  - `monoDice`: два мира с одним зерном → `DICE` → одинаковые зеркала; у каждой струны `r ∈ {1, 3/4, 2/3, 1/2, 4/9, 3/8, 1/3, 8/9}`, `sus ∈ {0, 1}`, `wind == 0` или `∈ [0.15, 0.5]`; с ладом (major, root 0) — `r` равно `snapR` от одного из набора.
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` — новые тесты падают.
- [ ] **Step 3: реализация.** `case sdk::ACT_LFO` в `world.cpp` по образцу `core/worlds/oceanus/world.cpp:51-56`, ветки по кодам выше. `Model::dice()` — как `worlds/monochord/model.js:107-115`: на струну `r = набор[⌊rng·8⌋]` (через `snapR`, если лад есть) → `setString(i, R, r)`, `setSus(i, rng < 0.4)`; затем ветер `rng < 0.3 ? 0.15 + 0.35·rng : 0` → `setWind`. Порядок вызовов rng — как в `model.js`; `rng_` модели.
- [ ] **Step 4:** `core/build.sh && core/build/sdk-test` → `0 failed`; `node --test tools/test-mono-core.mjs tools/models/monochord.test.mjs` — зелёные.
- [ ] **Step 5:** коммит `core: ACT_LFO rows and DICE for Monochordum` вместе с `t2d.wasm`.

### Task 2: Хост — мир снимает LFO своей строки

**Files:**
- Modify: `ios/app/T2D/World.swift` (протокол), `ios/app/T2D/Host/Host.swift` (`init`, рядом с `objGone` ~86-91), `Firmamentum/FirmamentumView.swift`, `Oceanus/OceanusView.swift`, `Map/*` и фейки миров в `T2DTests` (свойство)
- Test: `ios/app/T2DTests/HostTests.swift`

**Interfaces:**
- Produces: в протоколе `World` — `var rowLfoOff: ((Int) -> Void)? { get set }` («ставит хост: снять LFO строки мира (obj −1) по коду, база вернётся»). Хост ставит `{ code in core.lfoOff(slot: slot, obj: -1, key: code) }` и сбрасывает своё `pending` для этого ключа, как при выключении LFO на паде (`Host.swift` ~398-399).

- [ ] **Step 1: тест** `testClearDropsOnlyWindLfo`: поддельный мир на слоте 7 зовёт `rowLfoOff?(7)` в `clear()`; в `HCore` до этого поставлены LFO `(7, −1, 7)`, `(7, −1, 12)`, `(7, −1, 0)`; после `.clr` — `lfoOff` вызван ровно для `(7, −1, 7)`, и раньше, чем действие `CLEAR` мира (порядок вызовов в `HCore`).
- [ ] **Step 2:** тест падает (нет свойства).
- [ ] **Step 3:** свойство в протоколе и у всех миров (хранимое, `nil` по умолчанию), проводка в `Host.init`.
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** коммит `ios/app: World.rowLfoOff for world-row LFOs`.

### Task 3: Monochordum — зеркало, геометрия, касания, плашки

**Files:**
- Create: `ios/app/T2D/Monochord/MonoMirror.swift`, `MonoGeo.swift`, `MonoSheets.swift`, `MonochordView.swift`
- Test: `ios/app/T2DTests/MonochordTests.swift` (образец — `OceanusTests.swift`)

**Interfaces:**
- Consumes: коды из Global Constraints и задачи 1; `World.rowLfoOff` (задача 2); `World.scale(pcs:root:)` — только `root` для подписи ноты.
- Produces: `final class MonochordView: World` — `init(core: Core, readMirror: ((inout [Double]) -> Int)? = nil, readHeard: ((inout [Double]) -> Int)? = nil)` (как `OceanusView` / `FirmamentumView`); `static let slotN = 7`; `var geo: MonoGeo`; `var mirror: MonoMirror`; `func stringSpec(_ i: Int) -> SheetSpec`, `func earthSpec() -> SheetSpec`, `func windSpec() -> SheetSpec`, `var fx: SheetSpec?`; `var hitAt: Double` (вспышка земли по heard). `struct MonoGeo` — поля по `view.js:14-22` (`xs, sp, y0, y1, ye, box, hand, aeolus, earth`), `yOfR`, `rOfY` (0.25…1), `stringAt(x, y) -> Int?`. `struct MonoMirror` — `fx[7]`, `wind`, `lastWind`, `auto[6]`, `step`, `str[4]` (`r, sus, bright, decay, level, bow, en, eh, hn`); `init?(_ b: [Double], n: Int)` → nil при `n < 52`.

- [ ] **Step 1: тесты** (фейковое ядро пишет действия, фейковое зеркало и heard):
  - `testMirrorParse` (52 числа → поля; 51 → nil); `testHeardFlash` (heard `[1, 5]` в `tick` → `hitAt == now`; `idle()` сливает heard без вспышки).
  - касания: `testPluck` (тап выше кобылки струны 1 → `PLUCK 0, i 1, [pos, 0.9]`, `pos = (y − y0)/(yb − y0)`), `testHarmonic` (тап у узла 1/2 → `HARM 1, [2, 0.9]`), `testDoubleTapSus` / `testDoubleTapOtherString` (Review Focus 5), `testBridgeDrag` (`BRIDGE 4, [rOfY(y)]`), `testBridgeAndPluckTwoFingers` (RF1), `testBow` (сдвиг поперёк > 8 px, 150 мс → `BOW 2`; без движения 120 мс → затухание ×0.8 в `tick`), `testStrum` (палец пересекает x струн 2 и 3 выше кобылок → два `PLUCK` с `vel ∈ [0.3, 1]`), `testStrumSkipsBelowBridge` (RF2), `testWindDrag` (сдвиг вверх 70 px → `WIND [w0 + 0.5]`), `testWindTap` (тап → `WIND [lastWind]` при `wind == 0`, `[0]` иначе), `testEarthTap` (`AUTO [1]`), `testEarthHoldNoToggle` (RF4), удержания струны / земли / розы → `openSheet` с нужным `title` (`chorda II`, `terra`, `ventus`), `testCornerHit` (рука `hypot < r·1.1`).
  - плашки: коды строк по Global Constraints (`stringSpec(2)` → `pitch` 18, `level` 21; `earthSpec` → `strength` 8, `swing` 9, `tempo` без LFO; `windSpec` → `wind` 7, `shape 1`; `fx` → `decay` 0 … `hall` 6, `shape 0`); `pitch` get `= log2(1/r)/2`, set → `STRING 5, [0, v]`; `tempo` 0…1 ↔ 40…200 bpm → `AUTOPAR 9, i 1, [bpm]`; `rate` / `pattern` — 4 ступени; текст `pitch` — нота от 55 Гц с тоникой (`root 3` сдвигает подпись).
  - `testDice` (`DICE 11`), `testClearOrder` (RF3: `clear()` → `rowLfoOff(7)`, затем `CLEAR 10`).
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3: реализация** по `view.js:14-135, 280-295` (геометрия, касания, плашки, веер — сектора и `ang` из спеки, решение 7; легенда — 10 строк `view.js:293-295` дословно). Своего значения до зеркала не держим: всё читается из зеркала, как плашки Firmamentum (`Firmamentum/Sheets.swift:13`) — Swift сам ничего не пишет, отставание ≤ кадра, назад не прыгает. `tick` — удержания, затухание смычка, `rot` земли и `roseA` розы (свои часы). `layout` пересчитывает `geo`.
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** коммит `ios/app: Monochordum mirror, geometry, touches, sheets`.

### Task 4: Monochordum — рисование, регистрация, снимки

**Files:**
- Create: `ios/app/T2D/Monochord/MonoDraw.swift`
- Modify: `ios/app/T2D/Worlds.swift` (слот 7 `view: true`), `ios/app/T2D/App.swift` (`makeView` — ветка 7; сцены `-shot monochord*` рядом с `shotOcean` ~164-182; комментарий ~24 со списком сцен)
- Test: `ios/app/T2DTests/MonochordTests.swift` (рисование), снимки `ios/app/shot.sh`

**Interfaces:**
- Consumes: `MonochordView`, `MonoGeo`, `MonoMirror` (задача 3); `Draw.mapText(…, angle:)`, `Draw.glowAt`.

- [ ] **Step 1: тесты:** `testWallCached` (два кадра без смены размера → стена строится 1 раз; смена `H` → 2), `testDrawNoCrashEmpty` (зеркала нет — кадр рисуется), `testWaveBufferReused` (40 точек — один буфер между кадрами).
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3: реализация** по `view.js:136-232`: стена (`CGImage`, ключ `W×H×scale|y0|y1`; подложка, двойная рамка, розетка, 14 ладов `MARKS` с подписями, пунктир на Sol, 5 дуг интервалов с подписями под углом −π/2); в кадре — свечение розетки (`fx.body > 0.05`), струны (колок, глушёная часть, волна 40 точек, флажолет, `sus`, узлы, кобылка, порожек), звезда у горящего лада, подпись `нота · Гц` и интервал, пока тянут кобылку; земля (14 гор, `rot`, вспышка `hitAt` 220 мс), рука Бога (кулак — эллипс под 0.3), Эол (32 румба, `roseA`, 5 струй, `ventus · N%` под пальцем). Регистрация мира; сцены `monochord` (кобылка I на 1/2, `sus` у III, щипок II), `monochord-sheet` (плашка струны II), `monochord-earth-sheet`, `monochord-wind` (плашка ветра, LFO на `wind` — полоса `random`), `monochord-fan` (веер, LFO на `decay` — полоса `classic`).
- [ ] **Step 4:** Swift-тесты зелёные; `ios/app/shot.sh monochord` и остальные четыре против `python3 tools/shot.py monochord` (`.shots/monochord*.png`) — исполнитель смотрит пары сам: раскладка, шрифты, подписи сходятся.
- [ ] **Step 5:** коммит `ios/app: Monochordum drawing, registry, shot scenes`.

### Task 5: Доки, выкладка

**Files:**
- Modify: `docs/native-ios-plan.md` (фаза 3: Monochordum сделан, ждёт iPhone), `docs/worlds/monochordum.md` (раздел «Натив»: где код, LFO как строки мира, кубик в ядре, корзина снимает LFO ветра), `core/README.md` (`ACT_LFO` и `DICE` у Monochordum, `World.rowLfoOff`), `docs/testing.md` (сцены `monochord*` и веб-пара), `docs/tokens.md`, `sw.js` / `index.html` (новый `CACHE` = `?v=` — изменился `t2d.wasm`)

- [ ] **Step 1:** доки по списку; строка `docs/tokens.md` (`python3 tools/tokens.py --line`).
- [ ] **Step 2:** `CACHE` в `sw.js` и `?v=` в `index.html` — следующее число (одно и то же).
- [ ] **Step 3:** коммит `docs: iOS phase 3 Monochordum`; после финального ревью — пуш `native`, `python3 tools/deploy-wait.py` → `success`.

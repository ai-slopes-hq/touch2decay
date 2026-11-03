# iOS фаза 3 — Portus на Swift, план (а): ядро, хост, чистый слой, касания

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** логика XIII · Portus на Swift без картинки: `ACT_LFO` и `DICE` в ядре, `World.goMap / lfoBase` в хосте, общий `scaleSnap`, геометрия бухты, разбор зеркала и `heard`, собственные значения, касания (маяк, луна, вехи, буй, кораблики, туман, небо, вода), пять плашек, веер, легенда. Картинка, сцены и включение на карте — план (б).

**Architecture:** модель и звук — в ядре (`core/worlds/portus/`, слот 13); Swift разбирает зеркало (104 числа) и пары `heard` и шлёт действия. Все действия мира идут через одну обёртку `send(kind, i, a)` в `PortusView`: она зовёт `core.action` и отдаёт то же действие `PorState.own(…)`, который по правилу фасада (`worlds/portus/model.js:59-91`) держит свои значения до зеркала (0.25 с или сходимость). Мир: `ios/app/T2D/Portus/` — `PorMath` (константы, геометрия, ноты, тексты), `PorMirror` (зеркало, `heard`), `PorState` (свои значения, удары, круги эха, аудиция), `PortusView` (связка, тик, плашки, веер), `PorTouch` (`extension PortusView`: касания). Луна — предмет мира, не угол хоста: тап по ней зовёт `goMap` хоста.

**Tech Stack:** C++17 (`core/tests/sdk_test.cpp`), Swift 5 + UIKit, XCTest, XcodeGen.

**Spec:** `docs/superpowers/specs/2026-11-03-ios-portus-design.md` — читать целиком перед любой задачей. Веб-источник истины — `worlds/portus/view.js` (геометрия `:12-39`, удары и звезда `:46-50`, попадания `:54-58`, касания `:59-106`, плашки `:108-143`, удержание `:144-146`, веер и легенда `:362-374`), `worlds/portus/model.js` (константы `:10-36`, `hzOf / nameOf / fcOf / fbOf / buoyU :45-57`, действия фасада `:59-91`, кубик `:107-121`), `worlds/portus/engine.js` (`heard` и аудиция `:20-38`). Образец Swift — `ios/app/T2D/Natura/` и его тесты (`NatTestUtil.swift`).

## Global Constraints

- Ветка `native`; ветку не менять. Коммиты — по-английски, тело-список, последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `notebooks/*`, `.superpowers/` не коммитить.
- Ядро: C++17, `-ffp-contract=off`; правка `core/` → `core/build.sh` и `t2d.wasm` в том же коммите. Комментарии — по-русски, плотность как в соседнем коде.
- Миры заморожены: звук и веб Portus не меняются — `node --test tools/models/portus.test.mjs tools/models/portus-engine.test.mjs` зелёные до и после; `worlds/portus/*` не трогать.
- Swift: новые файлы в `T2D/` попадают в `T2D` сами, в `T2DTests` — через `project.yml:60` (добавить `T2D/Portus` после `T2D/Natura`, задача 3); после — `xcodegen` в `ios/app`. Комментарии — по-русски, как в `Natura/`. Округление как в JS (`Math.round`) — `Horo.jsRound`.
- Тесты: ядро — из корня `core/build.sh && core/build/sdk-test` → `0 failed`; Swift — через агента test-runner: `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|failed|passed|SUCCEEDED|FAILED" | tail -30` → `** TEST SUCCEEDED **`. **Тест пишется раньше кода и сначала падает** — красный прогон обязателен до реализации.
- Мир в плане (а) на карте не включён (`Worlds.swift` — `view: false`), `draw / drawShot` пустые.
- Константы Portus: слот 13; `NSTEP 16`, `PSPAN 12`; `CHORDS` имена `5, sus, m7, m9, m11`; `DT = [2,3,4,6,8]`, `DT_NAME = 1/8, 3/16, 1/4, 3/8, 1/2`; `NOTES = A, A#, B, C, C#, D, D#, E, F, F#, G, G#`; по умолчанию luna `cut 0.42, res 0.35, env 0.45`, echo `time 1, tone 0.45, mix 0.6`, buoy `u 0.35, d 0.45`, fog `amt 0.45, size 0.7`, pharos `chord 2, oct 0, len 0.25, lvl 0.8, swing 0`, fx `wow 0.25, mare 0, drive 0.25, spread 0.6, chance 1`, bpm 120, не играет, мест нет; `K = 2.6`, `Q1 = 1/(1+K)`; `HOLD_MS 420` (`Touch.holdMs`), тап < 0.3 с, сдвиг 8 px, аудиция не чаще 0.14 с.
- Действия ядра (`core/worlds/portus/world.hpp:34`): `PLACE 0 (i, [p, sd]), SINK 1, MOVE 2 (i, [j]), NOTE 3 (i, [p]), ISLE 4 (i, [0 oct | 1 lvl, v]), LUNA 5 (k, [v]), BUOY 6 (0, [u, d]), ECHO 7 (k time/tone/mix/fb, [v]), FOG 8 (k, [v]), PHAROS 9 (k chord/oct/len/lvl/swing, [v]), BPM 10 (0, [bpm]), FX 11 (k, [v]), CLEAR 12, PLAY 13 ([on]), KILL 14, AUDITION 15 (i)`, новый `DICE 16`.
- Зеркало (`MIRROR_N 104`, буфер 128): `0` шаг (`−1` стоит), `1` играет, `2` голосов, `3` bpm, `4–6` luna, `7–9` echo `time, tone, mix`, `10–11` buoy `u, d`, `12–13` fog, `14–18` pharos, `19–23` fx, место `j` с `24 + 5j`: `on, p, oct, lvl, sd`. `heard` — пары `[1, шаг]` (буфер 64).
- Коды LFO (`ACT_LFO`, `obj −1`): fx `0…4` (`wow, mare, drive, spread, chance`), luna `5…7` (`cut, res, env`), echo `8 tone, 9 mix, 10 fb`, fog `11 amt, 12 size`; строки без LFO (`echo.time`, pharos, navicula) — код `−1`.
- **Решено без автора** — спека, раздел «Решено без автора» (семь пунктов).

## Review Focus

1. **Тап по луне против тяги** — короткий тап (< 0.3 с, без сдвига) зовёт `goMap` ровно раз и не шлёт `LUNA`; тяга на 9 px шлёт `LUNA`, на `up` карты нет; удержание 0.42 с — плашка, карты нет. Тест — задача 6 (`testMoonTapDragHold`).
2. **Перенос кораблика через занятое место** — кораблик 3 вдоль через занятое 5 на свободное 7: на 5 `MOVE` не шлётся, на 7 — `MOVE 3 [7]`, следующие `NOTE` — месту 7, открытая плашка `navicula` не путает места. Тест — задача 6 (`testMoveSkipsBusy`).
3. **Кораблик пропал при открытой плашке** (тап, веха, корзина, кубик, отмена, `MOVE` прочь) — `objGone(j)` ровно один раз за пропажу; `MOVE` прочь — `objGone(from)`, плашка закрывается (как Natura; в вебе плашка едет за корабликом — отличие допустимо). Тест — задача 5 (`testObjGone`).
4. **Отмена посреди жеста** — `restored()` при пальцах на кораблике, луне, буе: последующие `move / up` ничего не шлют и `goMap` не зовут. Тест — задача 6 (`testRestoredMidGesture`).
5. **Плохое зеркало, `heard` и LFO-база** (короче 104, NaN, шаг вне 0…15, нечётный хвост, `lfoBase` вернул NaN) — не падает, годное учтено, прежнее зеркало цело, луна без LFO. Тесты — задача 3 (`testMirrorShort`, `testHeardBad`), задача 5 (`testBloodMoon`).

---

### Task 1: Ядро — `ACT_LFO` и `DICE` Portus

**Files:**
- Modify: `core/worlds/portus/model.hpp` / `model.cpp` (`void dice(sdk::Rng& r)`), `core/worlds/portus/world.hpp` (`enum Act` — `DICE` последним; комментарий `action(...)` — `DICE`, `ACT_LFO`), `core/worlds/portus/world.cpp` (`case DICE`, `case sdk::ACT_LFO`), `core/README.md:18` (Portus в списке `ACT_LFO / DICE`), `t2d.wasm`
- Test: `core/tests/sdk_test.cpp` — `portusLfo()`, `portusLfoIgnores()`, `portusDice()` рядом с `portusWorld` (~170); `lfoForeign` (~3189) — слот 13; вызовы в `main()` рядом с `infLfo(); infLfoIgnores();`

**Interfaces:**
- Produces: `portus::DICE == 16`; `ACT_LFO` по кодам Global Constraints через `setFx / setLuna / setEcho(TONE|MIX|FB) / setFog`, затем `pull(); applyState()`; `Model::dice(sdk::Rng& r)` — алгоритм `model.js:107-121` с `R = r.next()` **в том же порядке вызовов** (спека, решение 7): места очищены; `roots[1] = pick(3,5,7,10)`, `roots[2] = pick(0,5,7,12)`, `chord = pick(2,2,3,3,1,4)`; порядок — каждый из 12 по очереди с `R < 0.62`, первые 7; меньше 3 — дописать `2, 10`; без повторов (первое вхождение); на каждое место: нота (`j < 8` → `roots[0]` без вызова `R`, иначе `R < 0.7 ? roots[1] : roots[2]`), затем `sd = R·1000`; `oct 0, lvl 1`; затем `pharos.chord`, `echo.time = ⌊R·5⌋`, `buoy.d = 0.25 + R·0.55`, `buoyFromEcho()`, `pharos.oct = R < 0.6 ? −1 : 0`, `luna.cut = 0.25 + R·0.45`, `luna.res = R·0.6`, `fog.amt = 0.25 + R·0.55`. `pick(a) = a[⌊R·len⌋]`. `playing`, bpm, fx, прочие поля не трогает.

- [ ] **Step 1: тесты.** `portusLfo`: мир как в `portusWorld`; `act(ACT_LFO, −1, {k, 0.3})` для кодов 0…12 → в зеркале поле `0.3` (fx `19 + k`, luna `4 + k − 5`, echo tone `8`, mix `9`, fog `12 + k − 11`); код 10 → `buoy.d` (зеркало `11`) `== 0.03 + 0.3·0.92`. `portusLfoIgnores`: код `−1`, `13`, `obj 0`, `n = 1` — зеркало без изменений. `portusDice`: 20 бросков подряд — мест 3…7, все из `{2,6,10,14,3,11,7,15,0,9,13,5}`, ноты занятых `j < 8` равны общей тонике `0`, прочие ∈ `{0,3,5,7,10,12}`, `oct 0`, `lvl 1`, `sd ∈ [0, 1000)`, `pharos.chord ∈ 1…4`, `echo.time ∈ 0…4`, `buoy.d ∈ [0.25, 0.8]`, `pharos.oct ∈ {−1, 0}`, `luna.cut ∈ [0.25, 0.7]`, `luna.res ≤ 0.6`, `fog.amt ∈ [0.25, 0.8]`; fx и bpm прежние, `playing 0`; хотя бы два броска — разные наборы мест; второй мир с тем же зерном — та же сцена после первого `DICE`. `lfoForeign` — слот 13 в списке.
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` — новые тесты падают.
- [ ] **Step 3: реализация** по Interfaces (образцы — `core/worlds/natura/model.cpp` `dice`, `core/worlds/tria/world.cpp:149`).
- [ ] **Step 4:** `core/build.sh && core/build/sdk-test` → `0 failed`; `node --test tools/models/portus.test.mjs tools/models/portus-engine.test.mjs` — зелёные.
- [ ] **Step 5:** коммит `core: ACT_LFO and DICE for Portus` вместе с `t2d.wasm` и `core/README.md`.

**Ревью задачи:** да (ядро).

### Task 2: Хост — `World.goMap`, `World.lfoBase`, общий `scaleSnap`

**Files:**
- Modify: `ios/app/T2D/World.swift` (протокол и расширение; `scaleSnap`), `ios/app/T2D/Host/Host.swift:84-100` (проводка), `ios/app/T2D/Inferno/InfMath.swift:70-82` (убрать `infSnap`, вызовы → `scaleSnap`), `ios/app/T2DTests/InfMathTests.swift` (имя), `docs/architecture.md` (две строки протокола)
- Test: `ios/app/T2DTests/HostTests.swift`

**Interfaces:**
- Produces:
  - в `protocol World`: `var goMap: (() -> Void)? { get set }` — мир просит уйти на карту (предмет-угол, который сам ведёт касание); `var lfoBase: ((Int, Int) -> Double?)? { get set }` — `(obj, code)` → база LFO строки этого слота или `nil`. В `extension World` — заглушки `get { nil } set {}` (прочие миры не меняются).
  - `Host.init`: `v.goMap = { [weak self] in self?.goMap() }`; `v.lfoBase = { [weak self] obj, code in self?.core.lfoSnap().first { $0.slot == slot && $0.obj == obj && $0.key == code }?.base }` — свежий снимок ядра, не `lfos` плашки; не конечное `base` → `nil`.
  - `func scaleSnap(_ s: Double, pcs: [Int]) -> Double` — тело `infSnap` без изменений (строгое `<`, при равенстве нижняя).
- Заглушки протокола со `{ get set }` в расширении: если компилятор не даёт мирам-классам с хранимым `openSheet` воспользоваться заглушкой — объявить в протоколе, а хранимые поля завести только у `PortusView` и в тестовом мире; прочие миры получают заглушку расширения.

- [ ] **Step 1: тесты** `HostTests` (фейки `HostCore` и мира — как у соседних тестов): `testWorldGoMap` — мир зовёт `goMap?()` → хост на карте (как тест левой полосы `edge`); `testWorldLfoBase` — фейк `lfoSnap` `[LfoSnap(slot: W, obj: −1, key: 5, base: 0.7, …), LfoSnap(slot: другой, obj: −1, key: 5, base: 0.2, …)]` → `lfoBase(−1, 5) == 0.7`, `lfoBase(−1, 6) == nil`, `lfoBase(0, 5) == nil`; без открытой плашки — то же (снимок свежий). `InfMathTests` — `infSnap` → `scaleSnap`, значения прежние.
- [ ] **Step 2:** падают (нет членов протокола).
- [ ] **Step 3: реализация** по Interfaces.
- [ ] **Step 4:** Swift-тесты зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: World.goMap and lfoBase, shared scaleSnap`.

**Ревью задачи:** нет.

### Task 3: Чистый слой — `PorMath`, `PorMirror`

**Files:**
- Create: `ios/app/T2D/Portus/PorMath.swift`, `ios/app/T2D/Portus/PorMirror.swift`
- Modify: `ios/app/project.yml:60` (`T2D/Portus`)
- Test: `ios/app/T2DTests/PorMathTests.swift`

**Interfaces:**
- Produces:
  - `enum Por` — константы Global Constraints: `slot = 13`, `nstep = 16`, `pspan = 12`, `chords = ["5","sus","m7","m9","m11"]`, `dt = [2,3,4,6,8]`, `dtName`, `notes`, `fxKeys = ["wow","mare","drive","spread","chance"]`, `mirrorN = 104`, `head = 24`, `isleN = 5`; `enum Act { static let place = 0 … audition = 15, dice = 16 }`; `enum Lfo { static let fx0 = 0, luna0 = 5, tone = 8, mix = 9, fb = 10, fog0 = 11 }`; `static func edge(_ side: Double, _ d: Double) -> Double` (`model.js:19`, `G` не нужен).
  - `struct PorGeo { init(W: Double, H: Double, topY: Double, safeBot: Double, cut: Double, fogAmt: Double, cutBase: Double?)` — `view.js:13-20` (`moon.lfo = −1` без базы); поля `W, H, top, bot, cx, Ws, fx0, fx1, hor, qy, Wh: Double; moon: (x: Double, y: Double, r: Double, lfo: Double); ph: (x: Double, y: Double); fogTop: Double`; `func P(_ u: Double, _ d: Double) -> (x: Double, y: Double, s: Double, wb: Double)`; `func unP(_ x: Double, _ y: Double) -> (u: Double, d: Double)`; `static func kOf / dOfF / fOf / laneC / laneHW`; `func laneAt(_ f: Double, _ a: Double)`; `func slotPt(_ i: Int, _ p: Double)`; `func slotAt(_ x: Double, _ y: Double) -> (i: Int, p: Int)?`; `func markPt(_ i: Int)`; `func inSea(_ x: Double, _ y: Double) -> Bool` (`view.js:57`); `static func cliffH(_ side: Double, _ d: Double) -> Double` }.
  - `struct PorIsle: Equatable { var on = false; var p = 0.0, oct = 0.0, lvl = 1.0, sd = 0.0 }`.
  - `struct PorScale { var pcs: [Int]?; var root: Int; func semi(_ p: Double, oct: Double, pharosOct: Double) -> Double` (`model.js:49-53`: `a = p + root`, с ладом `scaleSnap(a + 24, pcs) − 24`) `; func hz(…) -> Double` (`110·2^(semi/12)`) `; func name(…, chord: Int) -> String` (`NOTES[semi mod 12] + chords[chord]`) `}`; `func porFc(_ cut: Double) -> Double` (`90·2^(7.2·cut)`), `func porFb(_ d: Double) -> Double` (`clamp(0.15 + 0.84d, 0, 0.985)`), `func porBuoyU(time: Double, d: Double) -> Double` (`model.js:57`), `func porBuoy(u: Double, d: Double) -> (u: Double, d: Double, time: Double)` (`setBuoy`, `model.js:79-83`).
  - `struct PorMirror { var step = −1; var playing = false; var voices = 0; var bpm = 120.0; var luna = [0.42, 0.35, 0.45]; var echo = [1, 0.45, 0.6]; var buoy = (u: 0.35, d: 0.45); var fog = [0.45, 0.7]; var pharos = [2, 0, 0.25, 0.8, 0]; var fx = [0.25, 0, 0.25, 0.6, 1]; var isles = [PorIsle](16); mutating func load(_ b: [Double], n: Int) -> Bool }` — `n < 104` → `false`, прежнее цело; не конечное — поле не меняется; `on` — `> 0.5`, `step` — `Int`.
  - `func porHeard(_ b: [Double], n: Int, into out: inout [Int]) -> Int` — пары подряд, `kind ≤ 0` или шаг не конечный / вне `0…15` — пропуск, хвост без пары — стоп; дописывает шаги.

- [ ] **Step 1: тесты** `PorMathTests` (`PorGeo(W: 390, H: 844, topY: 50, safeBot: 34, cut: 0.42, fogAmt: 0.45, cutBase: nil)`; ±1e-6, эталон посчитан из `view.js`):
  - `testGeo`: `top 56, bot 802, cx 195, Ws 390, fx0 0, fx1 390, hor 279.8, qy 736, Wh 191`, `moon (0, 187.092, 46, −1)`, `ph (350, 686)`, `fogTop 215.903`; `cutBase: 0.8` → `moon.y 117.78`, `lfo 1`; iPad `(1024, 1366, 24, 20)` → `Ws 834.52`, `fx0 94.74`, `moon (94.74, 258.88)`, `ph (889.26, 1222)`.
  - `testProject`: `P(0.35, 0.45) == (251.86871, 395.426728, s 0.460829, wb 162.482028)`, `unP` его — `(0.35, 0.45)`; `slotPt(0, 0) == (132.982116, 699.504, s 0.942222)`, `slotPt(5, 7) == (243.275201, 577.850667)`, `slotPt(15, 12) == (278.15981, 334.544)`; `slotAt(slotPt(5,7)) == (5, 7)`, для всех `i, p ∈ {0, 6, 12}` — туда-обратно; `slotAt(195, 100) == nil`, `slotAt(10, 577.85) == nil`; `markPt(0) == (117.104606, 699.504)`, `markPt(15) == (182.268886, 334.544)`; `edge(−1, 0.45) == −0.962718`, `edge(1, 0.45) == 0.985221`, `edge(−1, 0.2) == −0.371822`, `edge(1, 0.05) == 0.573106`; `inSea(slotPt(5,7))`, не `inSea(195, 270)`.
  - `testScale`: без лада `hz(p 0, oct 0, ph 0) == 110`, `hz(7, …) == 110·2^(7/12)`, `hz(0, oct 1, ph −1) == 110`; `name(3, chord 2) == "Cm7"`; лад `pcs [0,2,3,5,7,8,10], root 0` (минор от A): `semi(1, oct 0, ph 0) == 0` (`scaleSnap(25) == 24`: равенство — нижняя), `semi(4, …) == 3`, `semi(7, …) == 7`; `root 3`, `pcs [3,5,6,8,10,11,1]`: `semi(0, …) == 3`; `porFc(0.42) == 90·2^(3.024)`, `porFb(0.45) == 0.528`, `porFb(1) == 0.985`; `porBuoyU(time: 1, d: 0.45)` — по формуле от `edge`; `porBuoy(u: 0.9, d: 0.99)` → `d 0.95`, `u ≤ edge(1, 0.95) − 0.03`, `time ∈ 0…4`.
  - `testMirror`: буфер 104 с меткой на каждом смещении → поля по раскладке (`fx[2] = b[21]`, `isles[3].lvl = b[24 + 15 + 3]`, `buoy.d = b[11]`); `testMirrorShort`: `load(…, n: 103) == false`, прежнее цело; `NaN` в bpm — bpm прежний; по умолчанию все места пусты, `pharos[0] == 2`.
  - `testHeard`: `[1, 4, 1, 0]` → `[4, 0]`; `testHeardBad`: `[1, 16, 1, 3]` → `[3]`; `[0, 2]` → пусто; `[1]` → пусто; `[1, .nan, 1, 5]` → `[5]`.
- [ ] **Step 2:** падают (нет типов).
- [ ] **Step 3: реализация** по Interfaces; `xcodegen` после правки `project.yml`.
- [ ] **Step 4:** зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Portus math, mirror and heard parsing`.

**Ревью задачи:** нет.

### Task 4: Чистый слой — `PorState`

**Files:**
- Create: `ios/app/T2D/Portus/PorState.swift`
- Test: `ios/app/T2DTests/PorStateTests.swift`

**Interfaces:**
- Consumes: задача 3.
- Produces `struct PorState` (время — секунды, аргумент; буферы предвыделены; `ttl = 0.25`):
  - `mutating func own(_ kind: Int, _ i: Int, _ a: [Double], mirror: PorMirror, now: Double)` — своё по действию, правило фасада `model.js:59-91` и ядра `world.cpp:80-112` поверх текущих (своих или зеркала) значений: `PLACE` (пусто → `on, p a0, oct 0, lvl 1, sd a1`), `SINK`, `MOVE` (`j = a0` свободно и `≠ i` → перенос, иначе ничего), `NOTE`, `ISLE [0|1, v]`, `LUNA k`, `BUOY [u, d]` (через `porBuoy`: `d`, `u`, `echo.time`), `ECHO k` (`time` → `buoy.u = porBuoyU`; `fb` → `buoy.d = 0.03 + 0.92v` и `buoy.u`), `FOG k`, `PHAROS k`, `BPM`, `FX k`, `PLAY [on]`, `CLEAR` (16 пустых); прочие (`KILL, AUDITION, DICE`) — ничего; кораблик на пустом месте (кроме `PLACE`) — ничего;
  - чтение: `func isle(_ j: Int, mirror:, now:) -> PorIsle`, `luna(_ k:)`, `echo(_ k:)` (k 0…2), `buoy(…) -> (u, d)`, `fog(_ k:)`, `pharos(_ k:)`, `fx(_ k:)`, `bpm`, `playing` — своё, пока `≠` зеркала и `now − t < 0.25`, иначе зеркало (кораблик — место целиком; buoy — пара);
  - удары: `mutating func heard(_ step: Int, isleOn: Bool, dt: Double, fb: Double, now: Double)` — только при `isleOn`: `hitT[step] = now`, `lastHit = step`, `lastAt = now`, кольцо `hits` (до 6, старейший уходит) `(t: now, dt, fb)`; `hitT: [Double]` (16, −1e9); MOVE (своё) переносит `hitT[i] → hitT[j]`;
  - звезда: `mutating func kill(x:, y:, now:)` — `killAt = now`, `killXY`, `hits` пусты;
  - аудиция: `mutating func audition(playing: Bool, now: Double) -> Bool` — `true` и запомнить, если не играет и с прошлой ≥ 0.14 с;
  - `mutating func reset()` — свои значения пусты; `hitT`, `hits`, `lastHit`, звезда — остаются (только картинка).

- [ ] **Step 1: тесты** `PorStateTests` (зеркало по умолчанию — пусто):
  - `testOwnIsleNoLag`: `own(PLACE, 1, [4, 300], now: 1)` → `isle(1)` = `on, p 4, sd 300` при `now 1.1`, при `1.26` — зеркало (пусто); зеркало догнало при `1.05` → его. `PLACE` на занятое — ничего.
  - `testOwnMove`: место 0 занято (своё), `MOVE 0 [1]` → `isle(1).p` прежний, `isle(0).on == false`, `hitT` перенесён; на занятое / то же — ничего.
  - `testOwnBuoyEcho`: `BUOY [0.9, 0.99]` → `buoy.d 0.95`, `echo(0)` = `time` по `porBuoy`; `ECHO 3 [0.5]` → `buoy.d 0.49`, `u == porBuoyU(time, 0.49)`; `ECHO 0 [3]` → `time 3`, `u` пересчитан.
  - `testOwnScalars`: `LUNA 0 [0.9]`, `FOG 1 [0.2]`, `PHAROS 0 [4]`, `BPM [150]`, `FX 2 [0.7]`, `PLAY [1]`, `ISLE 0 [1, 0.5]` → свои; `CLEAR` → 16 пустых.
  - `testHeard`: `heard(4, isleOn: true, dt: 0.25, fb: 0.5, now: 3)` → `hitT[4] == 3`, `lastHit 4`, `hits.count 1`; `isleOn: false` — ничего; 8 ударов → `hits.count 6`, первый — третий удар.
  - `testKill`: `kill` → `hits` пусты, `killAt`.
  - `testAudition`: не играет — `true` при `0`, `false` при `0.1`, `true` при `0.15`; играет — `false`.
  - `testReset`: после своих правок `reset()` → всё — зеркало; `hitT` цел.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner). **Step 5:** коммит `ios/app: Portus state - own values, hits, audition`.

**Ревью задачи:** нет.

### Task 5: `PortusView` — мир, тик, плашки, веер, кровавая луна

**Files:**
- Create: `ios/app/T2D/Portus/PortusView.swift`, `ios/app/T2D/Portus/PorSheets.swift` (`extension PortusView`: пять плашек и веер)
- Test: `ios/app/T2DTests/PortusTests.swift` (фейк `Core` — как `NatTestUtil.swift`)

**Interfaces:**
- Consumes: задачи 2–4; `World`, `Finger`, `SheetSpec / SheetRow / SheetLfo`, `Core`, `LegendRow / Glyph`.
- Produces `final class PortusView: World`:
  - `static let slotN = 13`; `init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil, rng: (() -> Double)? = nil)` (как `NaturaView.swift:63-69`; буферы 128 и 64); `theme = Worlds.info(13)`; `title "Portus"`, `sub "pharos · echo · nebula"`; `legend` — 10 строк `view.js:370-373` (глифы — по первому слову строки: `tap, drag, up, hold`); `var goMap`, `var lfoBase` — хранимые;
  - `func send(_ kind: Int, _ i: Int, _ a: [Double] = [])` — `core.action(kind, i, a, touchTime: 0)` и `state.own(…)`; **единственный** путь действий мира; `func audition(_ j: Int)` — `send(AUDITION, j)`, если `state.audition(playing:now:)`;
  - чтение: `private(set) var geo: PorGeo` (пересобирается в `layout` и каждый `tick` от `luna(0)`, `fog(0)` и `lfoBase?(−1, 5)` — не конечное → `nil`), `mirror`, `state`, `scl: PorScale`; `func isle(_ j: Int) -> PorIsle`, `luna(_:)`, `echo(_:)`, `buoy`, `fog(_:)`, `pharos(_:)`, `fx(_:)`, `bpm`, `playing`, `step` (`playing ? mirror.step : −1`), `func hzOf(_ j: Int)`, `func nameOf(_ j: Int)` (через `scl` и `pharos(1)`, `pharos(0)`); `private(set) var now`;
  - плашки (`view.js:108-143`, решение 13 спеки): `lunaSpec`, `echoSpec`, `fogSpec`, `pharosSpec`, `isleSpec(_ j: Int)` — `title / hint / rows (label, code) / get / set / text / lfo` дословно из веба; `set` — через `send` (`LUNA k`, `ECHO k` — `time` `round(v·4)`, `FOG k`, `PHAROS k` — `chord round(v·4)`, `oct round(v·4) − 2`, `ISLE j [0, round(v·4) − 2] | [1, v]`); `lfo`: luna `SheetLfo(obj: −1, keys: [cut, res, env], shape: 0)`, echo `[fb, tone, mix]` shape 1, fog `[amt, size]` shape 1; `isleSpec.obj = j`; кораблика нет — `set` ничего не шлёт;
  - `fx: SheetSpec?` — `title "aether"`, `hint "FX — tap outside to close"`, секторы `wow 180°, mare 150°, drive 130°, chance 110°, spread 90°` (коды 0, 1, 2, 4, 3), `lfo SheetLfo(obj: −1, keys: все пять, shape: 1)`, `text`: `mare < 0.01` → `calm`, иначе `N%`; `arc: { fx(2) }`;
  - `tick(now:dt:)`: зеркало → `mirror`; `heard` (до 4 чтений, как `NaturaView`) → `state.heard(step, isleOn: isle(step).on, dt: Por.dt[time]·stepSec, fb: porFb(buoy.d), now:)`; пропавшие кораблики → `objGone(j)` (было `on` на прошлом тике, сейчас нет); касаниям — `touchTick(now:)` (задача 6); `idle()` — слить `heard` без событий; `restored()` — `touchReset()`, `state.reset()`; `scale(pcs:root:)` → `scl`; `cornerHit` → `false`; `objs` — число занятых мест; `dice()` — `send(DICE)`, затем `send(PLAY, 0, [1])`, если не `playing`; `clear()` — `send(CLEAR)`;
  - `down / move / up / cancel` — пока пустые; `draw / drawShot` — пустые (план (б)).

- [ ] **Step 1: тесты** `PortusTests` (`layout(W: 390, H: 844, topY: 50, safeBot: 34)`):
  - `testSendOwns`: `send(PLACE, 1, [4, 300])` → в фейке `(0, 1, [4, 300])`, `isle(1).on` сразу.
  - `testLunaSheet`: `title "luna"`, строки `cut/cutoff, res/resonance, env/envelope` с кодами `5, 6, 7`, `lfo.obj −1`, `shape 0`; `text("cut") == "\(round(porFc(0.42))) Hz"`, `text("res") == "35%"`; `set("cut", 0.6)` → `LUNA 0 [0.6]`.
  - `testEchoSheet`: строки `time, fb/feedback, tone/dark, mix/send`, коды `−1, 10, 8, 9`; `get("time") == 0.25`, `get("fb") == (0.45 − 0.03)/0.92`; `text("time") == "3/16"`; `set("time", 0.8)` → `ECHO 0 [3]`; `set("fb", 1)` → `text("fb") == "endless"`.
  - `testFogPharosIsleSheets`: fog `text("size") == "6.8 s"`, коды `11, 12`; pharos коды все `−1`, `lfo nil`, `get("chord") == 0.5`, `text("chord") == "m7"`, `set("oct", 0.0)` → `PHAROS 1 [−2]`, `text("oct") == "octave −2"`, `len 0.95` → `endless`, `len 0.25` → `"148 ms"`; isle `obj == j`, `text("oct")` при `oct 0` — `"as lighthouse · " + nameOf(j)`, `set("oct", 1)` → `ISLE j [0, 2]`, `text("lvl") == "100%"`.
  - `testFan`: порядок секторов и коды, `text("mare") == "calm"`, `set("drive", 0.7)` → `FX 2 [0.7]`, `arc() == 0.25`.
  - `testHeard`: кораблик на 5; фейковый `heard` `[1, 5, 1, 6]` → `state.hitT[5] == now`, на 6 (пусто) — ничего, `hits.count 1`, `hits[0].dt == 3·(60/120/4)`; `idle()` сливает без изменений `hitT`.
  - `testObjGone`: `send(SINK, 3)` (был кораблик) → `tick` → `objGone(3)` один раз; ещё `tick` — нет; `send(MOVE, 2, [9])` → `objGone(2)`; зеркало без кораблика 5 → `objGone(5)`; `clear()` → по разу на каждый.
  - `testDiceClear`: стоит → `dice()` → `DICE`, `PLAY [1]`; играет → только `DICE`; `clear()` → `CLEAR`, `isle(0).on == false` сразу.
  - `testBloodMoon`: `lfoBase` фейк → `0.8` при `luna.cut 0.42` → `geo.moon.y == 117.78`, `lfo == 1`; `nil` → `lfo −1`, `y 187.092`; `.nan` → как `nil`.
  - `testCornerNever`: `cornerHit` в центре луны → `false`.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner). **Step 5:** коммит `ios/app: Portus view - state wiring, sheets, fan, blood moon base`.

**Ревью задачи:** нет.

### Task 6: `PorTouch` — касания

**Files:**
- Create: `ios/app/T2D/Portus/PorTouch.swift` (`extension PortusView`; хранимые поля пальцев — в `PortusView.swift`)
- Modify: `ios/app/T2D/Portus/PortusView.swift` (убрать заглушки `down / move / up / cancel`, позвать `touchTick / touchReset`)
- Test: `ios/app/T2DTests/PorTouchTests.swift`

**Interfaces:**
- Consumes: задачи 3–5 (`send`, `audition`, `isle`, `geo`, `state`, `openSheet`, `goMap`, `*Spec`).
- Produces (`view.js:54-106, 144-146`; координаты экрана, сдвига нет):
  - палец `struct PorFinger { kind: none | ph | moon | buoy | isle | fog; j: Int /* место кораблика */; fresh, moved, sheet: Bool; t0, x0, y0: Double; v0, v1: Double /* bpm0 | c0, r0 | a0 */ }`, словарь по `Finger.id`; `var lastP: Int` (0);
  - `func isleAt(_ x: Double, _ y: Double) -> Int?` (`view.js:55`), `func markAt(_ x: Double, _ y: Double) -> Int` (`:56`);
  - `down / move / up / cancel` — порядок попаданий и действия `view.js:59-106` (спека, решение 11); действия — только `send` / `audition` / `goMap`: маяк — тап `PLAY [!playing]`, вбок `BPM [round(clamp(bpm0 + dx/2, 60, 180))]` (только при смене); луна — тап `goMap?()`, тяга `LUNA 0 [clamp(c0 + (y0 − y)/(hor − top − 0.9r))]` и `LUNA 1 [clamp(r0 + dx/(0.5Ws))]`; веха — есть кораблик → `SINK j`, нет → `PLACE j [lastP, rng()·1000]` + `audition(j)`; буй — `BUOY 0 [u, d]` от `unP(x, clamp(y, hor + 6, qy − 10))`; кораблик — `slotAt(x, clamp(y, hor + 4, qy − 6))`: другое место свободно → `MOVE j [i]` (палец едет за ним), нота сменилась → `NOTE i [p]`, `lastP = p`, `audition(i)`; тап (не `fresh`, кораблик жив) → `SINK j`; туман — `FOG 0 [clamp(a0 + (y0 − y)/(0.7(hor − top − 40)))]`; небо — `KILL` + `state.kill(x:y:now:)`; вода — `inSea && slotAt` → `PLACE i [p, rng()·1000]` (занято — `NOTE i [p]`), `lastP = p`, `audition(i)`, палец `isle`, `fresh`;
  - `func touchTick(now: Double)` — удержание 0.42 с без сдвига, не `fresh`, не открыто (`view.js:144-146`) → `openSheet` луны, буя, тумана, маяка, кораблика (`isleSpec(j)`); палец с открытой плашкой больше ничего не шлёт;
  - `func touchReset()` — для `restored()`: пальцы забыты.

- [ ] **Step 1: тесты** `PorTouchTests` (геометрия — как задача 5; точки — `geo.slotPt / markPt / P(buoy) / moon / ph / fogTop`; время — `tick(now:)` и `Finger.t0`):
  - `testTapWaterPlaces`: тап по `slotPt(5, 7)` → `PLACE 5 [7, sd]` и `AUDITION 5`; второй через 0.1 с на `slotPt(6, 3)` — `PLACE`, без `AUDITION`; играет — без `AUDITION`; `up` — без `SINK` (`fresh`).
  - `testTapIsleSinks`: кораблик на 5, тап → `SINK 5`; удержание 0.43 с → плашка `navicula`, на `up` без `SINK`.
  - `testDragIsleNote`: кораблик 5 поперёк до `p 10` → `NOTE 5 [10]`, `AUDITION 5`; сдвиг < 8 px — ничего.
  - `testMoveSkipsBusy`: кораблики 3 и 5; палец с 3 вдоль через 5 на 7 → нет `MOVE 3 [5]`, есть `MOVE 3 [7]`, следующие `NOTE` — месту 7; `isle(5)` цел.
  - `testMarker`: веха 2 (пусто) → `PLACE 2 [lastP, sd]` + `AUDITION`; снова → `SINK 2`.
  - `testPharos`: тап по `ph` → `PLAY [1]`; вбок на 40 px → `BPM [140]`, без `PLAY`; удержание → `pharos`.
  - `testMoonTapDragHold`: тап (0.1 с) → `goMap` один раз, действий ядра нет; тяга вверх 50 → `LUNA 0 [0.42 + 50/(279.8 − 56 − 41.4)]`, вбок 39 → `LUNA 1 [0.35 + 39/195]`, `goMap` не зван; удержание 0.43 с → плашка `luna`, `goMap` не зван.
  - `testBuoyFogSky`: буй вбок → `BUOY 0 [u, d]` (по `unP`); верх тумана вверх 30 → `FOG 0 [0.45 + 30/(0.7·(279.8 − 56 − 40))]`; тап по небу `(195, 120)` → `KILL`, `state.killAt == now`; удержание буя / тумана → `echo` / `nebula`.
  - `testTwoFingers`: два пальца тянут кораблики 0 и 8 поперёк → `NOTE 0` и `NOTE 8`, не путаются.
  - `testRestoredMidGesture`: пальцы на кораблике, луне, буе; `restored()` → `move / up` всех — ни одного действия, `goMap` не зван.
  - `testCancel`: `cancel` пальца на луне — без `goMap`; на кораблике — без `SINK`.
- [ ] **Step 2:** падают. **Step 3:** реализация (перенос `view.js` построчно, пороги и формулы — оттуда; своих не вводить). **Step 4:** зелёные (test-runner). **Step 5:** коммит `ios/app: Portus touches - boats, moon, buoy, fog, sky`.

**Ревью задачи:** да (касания).

---

**Дальше — план (б)** (`docs/superpowers/plans/2026-11-03-ios-portus-b.md`, пишется после (а)): `PorScene` (кеш стены с LCG), `PorDraw` (кадр: луна, вехи, кораблики, буй, туман, маяк, звезда, подписи), включение на карте, сцены `portus*`, снимки против веба, финальное ревью всей ветки (opus), доки, `CACHE`, пуш.

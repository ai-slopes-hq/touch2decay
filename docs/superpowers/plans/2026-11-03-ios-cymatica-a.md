# iOS фаза 3 — Cymatica на Swift, план (а): чистый слой, связка, касания

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** логика II · Cymatica на Swift без картинки: раскладка ханга и геометрия, разбор зеркала и `heard`, собственные значения и вспышки, связка мира (тик, плашка `luna`, веер `aether`, кубик, корзина, отмена, резонатор-угол), касания одним пальцем (кнопки, кольца, метки, удар) и двумя (вращение, щипок). Картинка, сцены и включение на карте — план (б).

**Architecture:** модель и звук — в ядре (`core/worlds/cymatica/`, слот 2), **ядро не меняется**. Swift разбирает зеркало (175 чисел) и записи `heard` по 5 и шлёт действия. Все действия мира идут через одну обёртку `send(kind, i, a, touchTime:)` в `CymaticaView`: она зовёт `core.action` и отдаёт то же действие `CymState.own(…)`, который держит свои значения до зеркала (0.25 с или сходимость). Мир: `ios/app/T2D/Cymatica/` — `CymMath` (константы, ханг, геометрия, тексты), `CymMirror` (зеркало, `heard`), `CymState` (свои значения, `born`, `pulse`, созвездия, отзыв), `CymaticaView` (связка, тик), `CymSheets` (веер, луна), `CymTouch` (`extension CymaticaView`: касания).

**Tech Stack:** Swift 5 + UIKit, XCTest, XcodeGen.

**Spec:** `docs/superpowers/specs/2026-11-03-ios-cymatica-design.md` — читать целиком перед любой задачей. Разведка — `~/.claude/handoff/cymatica-map.md`. Веб-источник истины — `worlds/cymatica/core.js` (весь, 121 строка), `worlds/cymatica/view.js` (`heard / changed :24-41`, созвездия `:45-58`, щипок `:60-67`, геометрия `:71-89`, `astroHit / astroMove / astroUp :90-136`, метки `:145-153`, вращение `:155-199`, `down / move / up :201-287`, плашка луны `:303-321`, удержания `:323-338`, веер `:341-363`, угол `:672`), `worlds/cymatica/model.js` (умолчания `:26-38`, `effF0 / fs / notesOf :49-65`, вспышки `sendSeq :66-80`, действия `:84-205`), `worlds/cymatica/bridge.js` (`FX_KEYS`, `DRIFT_KEYS`, разбор зеркала), `host/legend.js:15-19`. Ядро (только читать): `core/worlds/cymatica/world.hpp:19-47`, `world.cpp:24-65, 164-210`. Образец Swift — `ios/app/T2D/Portus/` и его тесты (`PortusTests.swift` — фейк `Core` и читатели).

## Global Constraints

- Ветка `native`; ветку не менять. Коммиты — по-английски, тело-список, последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `notebooks/*`, `.superpowers/` не коммитить.
- `core/`, `worlds/cymatica/*`, `t2d.wasm` не трогать (миры заморожены, ядро не меняется).
- Swift: новые файлы в `T2D/` попадают в `T2D` сами, в `T2DTests` — через `project.yml:60` (добавить `T2D/Cymatica` после `T2D/Portus`, задача 1); после — `xcodegen` в `ios/app`. Комментарии — по-русски, как в `Portus/`. Округление как в JS (`Math.round`) — `Horo.jsRound`.
- Тесты Swift — через агента test-runner: `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|failed|passed|SUCCEEDED|FAILED" | tail -30` → `** TEST SUCCEEDED **`. **Тест пишется раньше кода и сначала падает** — красный прогон обязателен до реализации.
- Мир в плане (а) на карте не включён (`Worlds.swift` — `view: false`), `draw / drawShot` пустые.
- Константы Cymatica: слот 2; `SLOTS 16`; `F_MIN 55, F_MAX 880, F_DEF 110`; `NOTES = A, A♯, B, C, C♯, D, D♯, E, F, F♯, G, G♯` (знак `♯`); `noteName(hz)`: `s = round(12·log2(hz/55))`, `NOTES[s mod 12] + (1 + ⌊(s + 9)/12⌋)`; `ECHO_DIVS` — 9 пар `core.js:20`; `DRIFT_RATES` — `4 bars, 2 bars, 1 bar, 1/2, 1/4`; `STRUCT` — `string, membrane, plate, bell, bowl, handpan, marimba, kalimba`; `FX_KEYS = structure, damping, brightness, hall, echo, time, chance`; `DRIFT_KEYS = depth, rate, shape`; `RING_R = [0.9, 0.7, 0.33]`; `TAP_MS 0.25 с`, `TAP_MOVE 12 px`, «сдвинут» — от 10 px от `(x0, y0)` (свой порог, не `Finger.moved`), `HOLD 0.42 с` (`Touch.holdMs`); `PX_SEMI 12`, `PX_DEG 18`; кнопки r 22, метка r 11, резонатор r 46.
- Умолчания (`model.js:26-38`, они же — зеркало до первого чтения): f0 110; fx `[2/7, 0.5, 0.5, 0.25, 0.15, 0.75, 1]`; bpm 96, не играет, не пишет, rlen 16, mlen 7, шагов нет; луна `on 0, depth 0.3, rate 0.5, shape 0, k 0`; grid 1, lastHit `(0.3, 0)`, cursor −1, stepRec `0, 0, 0`.
- Действия ядра (`world.hpp:36`): `STRIKE 2 [x, y, hz, vel, hard, rec]`, `STRIKE_AT 7 [x, y]`, `PLAY 8 [on]`, `REC 9 [on]`, `STEPREC 10 [on, r, m]`, `SKIP 11`, `CURSOR 12 [i | −1]`, `GRID 13 [g]`, `BPM 14 [bpm]`, `LEN 15 i(0 ритм, 1 мелодия) [len]`, `CHANCE_AT 16 i [ch]`, `BEAT 17 i`, `NUDGE 18 i [ci, steps]`, `MOVE_MARK 19 i [x, y]`, `DROP_MARK 20 i`, `COMB 21`, `TURN 22 i(0 ритм, 1 мелодия, 2 пластина) [k, исходный узор]`, `DRIFT_TOGGLE 23`, `DRIFT_SET 24 i [t]`, `SET_F0 25 [hz]`, `STEP_SCALE 26 [fromSemi, steps]`, `SET_FX 27 i [t]`, `DICE 29 [seed]`, `CLEAR 30`. Прочие коды натив не шлёт.
- Зеркало (`MIRROR_N 175`, буфер 192): `0–23` энергии мод, `24–31` голоса `(hz, level)×4`, `32` f0, `33–39` fx (порядок `FX_KEYS`), `40–44` bpm, playing, rec, rlen, mlen, `45 + 4i` ритм `on, vel, chance, has`, `109 + 3i` мелодия `on, x, y`, `157–161` луна `on, depth, rate, shape, k`, `162–168` grid, lastHit x, y, cursor, stepRec on, r, m. `heard` (буфер 96) — записи по 5: `[1, r, m, time, hit]`, `[2, semi, 0, 0, 0]`.
- **Решено без автора** — спека, раздел «Решено без автора» (шесть пунктов).

## Review Focus

1. **Второй палец на кнопке во время удара** — палец на пластине бьёт, второй жмёт ▶: пары нет, `PLAY` уходит, первый палец ничего лишнего не шлёт. И наоборот: палец держит ▶ (темп), второй бьёт по пластине — удар, не пара. Тест — задача 4 (`testButtonNotPaired`).
2. **Отмена или корзина посреди жеста** — `restored()` при пальцах на метке, на кольце, в паре (вращение): последующие `move / up` ничего не шлют, `ringTurn` = 0. Тест — задача 5 (`testRestoredMidTwo`), задача 4 (`testRestoredMidDrag`).
3. **Метка утащена за край при открытой записи / курсоре** — при `rec` или курсоре метки не ловятся: тап в точку метки — `STRIKE_AT`, не `STRIKE`. Тест — задача 4 (`testMarkIgnoredWhileRec`).
4. **Тап по луне, открывший плашку** — удержание 0.42 с открывает `luna`, на `up` нет `DRIFT_TOGGLE`; короткий тап — `DRIFT_TOGGLE`, плашки нет. Тест — задача 4 (`testDriftTapHold`).
5. **Плохое зеркало и `heard`** (короче 175, NaN, `r / m` вне 0…15, хвост короче 5, вид записи не 1 / 2) — не падает, годное учтено, прежнее зеркало цело. Тесты — задача 1 (`testMirrorShort`, `testHeardBad`).

---

### Task 1: Чистый слой — `CymMath`, `CymMirror`

**Files:**
- Create: `ios/app/T2D/Cymatica/CymMath.swift`, `ios/app/T2D/Cymatica/CymMirror.swift`
- Modify: `ios/app/project.yml:60` (`T2D/Cymatica` после `T2D/Portus`)
- Test: `ios/app/T2DTests/CymMathTests.swift`

**Interfaces:**
- Produces:
  - `enum Cym` — константы Global Constraints: `slot = 2`, `slots = 16`, `fMin = 55.0, fMax = 880.0, fDef = 110.0`, `notes`, `echoDivs: [(String, Double)]`, `driftRates: [(String, Int)]`, `structs`, `fxKeys`, `driftKeys`, `ringR`, `mirrorN = 175`; `enum Act { static let strike = 2, strikeAt = 7, play = 8, rec = 9, stepRec = 10, skip = 11, cursor = 12, grid = 13, bpm = 14, len = 15, chanceAt = 16, beat = 17, nudge = 18, moveMark = 19, dropMark = 20, comb = 21, turn = 22, driftToggle = 23, driftSet = 24, setF0 = 25, stepScale = 26, setFx = 27, dice = 29, clear = 30 }`; `static func noteName(_ hz: Double) -> String`; `static func echoDiv(_ time: Double) -> (String, Double)` (`ECHO_DIVS[round(time·8)]`); `static func driftRate(_ rate: Double) -> (String, Int)` (`round(rate·4)`); `static func driftDepth(_ depth: Double) -> Int` (`max(1, round(depth·7))`).
  - `struct CymScale { var pcs: [Int]?; var root: Int` — `func noteList() -> [Int]` (0…60: с ладом `pcs.contains(s mod 12)`, без — `{0,3,5,7,10}`), `func semis() -> [Int]` (то же 0…48), `var degPerOct: Int` (`pcs?.count ?? 5`), `func snap(_ s: Double) -> Double` (с ладом `scaleSnap`, без — `s`) `}`; `on` — `pcs != nil`.
  - Ханг (`core.js:9-91`, свободные функции): `cymNearestIdx(_ list: [Int], _ s: Double) -> Int` (строгое `<`, при равенстве — первый), `cymCellIdx(_ x: Double, _ y: Double, b: Int, n: Int) -> Int?`, `cymNoteAt(_ x:, _ y:, b:, n:, list: [Int]) -> Int?`, `cymCellOf(_ idx: Int, b: Int, n: Int) -> (ring: Int, sector: Int)?`, `cymCellCenter(ring: Int, sector: Int, n: Int) -> (x: Double, y: Double)`, `cymTwistOrPinch(a0:, a1:, d0:, d1:) -> CymTwo?` (`enum CymTwo { case twist, pinch }`).
  - Высота (`model.js:49-60`): `func cymEffF0(f0: Double, driftOn: Bool, k: Int, scale: CymScale) -> Double`; `func cymFs(_ eff: Double) -> Double` (`12·log2(eff/55)`); `func cymBase(_ fs: Double, scale:) -> Int` (`cymNearestIdx(noteList, fs)`).
  - `struct CymGeo { init(W: Double, H: Double, topY: Double, safeBot: Double, shownF0: Double)` — `view.js:71-89`; поля `cx, cy, rMax, r, R1, R2, RM, ty, playX, recX, gridX, driftX: Double`; `func toPlate(_ x: Double, _ y: Double) -> (x: Double, y: Double)`, `func fromPlate(_ x: Double, _ y: Double) -> (x: Double, y: Double)`, `static func slotAng(_ i: Int) -> Double`, `func slotXY(_ i: Int, _ R: Double) -> (x: Double, y: Double)`, `func slotOf(_ x: Double, _ y: Double) -> Double` (дробное 0…16) }; `func cymResonatorHit(_ x: Double, _ y: Double, W: Double, H: Double, safeBot: Double) -> Bool` (`view.js:672`, r 46).
  - `struct CymStep: Equatable { var on = false; var vel = 0.0, chance = 1.0, has = false }`, `struct CymMark: Equatable { var on = false; var x = 0.0, y = 0.0 }`.
  - `struct CymMirror { var energy = [Double](24); var voices = [(hz: Double, level: Double)](4); var f0 = 110.0; var fx = […умолчания]; var bpm = 96.0; var playing = false, rec = false; var rlen = 16, mlen = 7; var rhythm = [CymStep](16); var melody = [CymMark](16); var drift = (on: false, depth: 0.3, rate: 0.5, shape: 0.0, k: 0); var grid = 1; var lastHit = (x: 0.3, y: 0.0); var cursor = -1; var stepRec = (on: false, r: 0, m: 0); mutating func load(_ b: [Double], n: Int) -> Bool }` — `n < 175` → `false`, прежнее цело; не конечное — поле не меняется; `on` — `> 0.5`; целые — `Int(jsRound)`.
  - `enum CymHeard { case step(r: Int, m: Int, hit: Bool), answer(semi: Int) }`; `func cymHeard(_ b: [Double], n: Int, into out: inout [CymHeard])` — записи по 5; вид 1 с `r, m ∈ 0…15` → `step`, вид 2 с конечной нотой → `answer`; прочее — пропуск; хвост короче 5 — стоп.

- [ ] **Step 1: тесты** `CymMathTests` (эталон посчитан из `core.js` / `view.js` в node; ±1e-6):
  - `testNoteName`: `noteName(110) == "A2"`, `noteName(55) == "A1"`, `noteName(440·2^(1/12)) == "A♯4"`; `echoDiv(0.75).0 == "1/8d"`; `driftRate(0.5).0 == "1 bar"`; `driftDepth(0.3) == 2`, `driftDepth(0) == 1`.
  - `testNoteList`: без лада — 26 нот, начало `0,3,5,7,10,12,15,17`, последняя 60, `semis().count == 21`; минор `pcs [0,2,3,5,7,8,10]` — 36 нот, начало `0,2,3,5,7,8,10,12,14`, последняя 60, `semis().count == 29`, `degPerOct == 7`.
  - `testCells`: без лада, `b = cymNearestIdx(list, 12) == 5`; `cymCellIdx(0, −0.9, b: 5, n: 5) == 5`, `(0.5, 0) == 16`, `(0, 0) == 15`, `(0.1, 0.1) == 16`, `(1.1, 0) == nil`; `cymNoteAt` тех же точек — `12, 39, 36`; при f0 880: `b == 20`, `cymNoteAt(0, 0, …) == nil` (индекс 30 ≥ 26); `cymCellOf(12, b: 5, n: 5) == (1, 2)`; `cymCellCenter(ring: 1, sector: 2, n: 5) == (0, 0.7)` (x ±1e-9); туда-обратно: для всех `ring 0…2`, `sector 0…4` — `cymCellIdx(center) == b + ring·5 + sector`.
  - `testTwist`: `(0, 0.2, 100, 100) == .twist`, `(0, 0.1, 100, 130) == .pinch`, `(0, 0.1, 100, 105) == nil`, `(0, 0.3, 100, 140) == .pinch`.
  - `testEffF0`: луна выключена — `f0`; `f0 110, on, k 2`, без лада → `55·2^(17/12)` (ступени `semis`: 12 → индекс 5, +2 → 17); `k −9` → `55` (край); с ладом минор `k 1` → `55·2^(14/12)`.
  - `testGeo`: `CymGeo(W: 390, H: 844, topY: 50, safeBot: 34, shownF0: 110)` → `cx 195, cy 410, rMax 131, r 110.157430, R1 153, R2 179, RM 166, ty 623, playX 105, recX 165, gridX 225, driftX 285`; iPad `(1024, 1366, 24, 20, 110)` → `cy 665, rMax 448, r 376.721594, ty 1195`; `slotOf(195, 410 − 160) == 0`, `slotOf(195 + 160, 410) == 4`, `slotOf(195, 570) == 8`; `slotXY(4, 100) == (295, 410)`; `toPlate(fromPlate(0.3, −0.2)) == (0.3, −0.2)`; `cymResonatorHit(380, 800, W: 390, H: 844, safeBot: 34)`, не `(300, 800)`.
  - `testMirror`: буфер 175 с меткой на каждом смещении → поля по раскладке (`fx[5] = b[38]`, `rhythm[3].chance = b[45 + 12 + 2]`, `melody[2].y = b[109 + 6 + 2]`, `drift.k = b[161]`, `cursor = b[165]`, `voices[1].level = b[27]`); `testMirrorShort`: `load(…, n: 174) == false`, прежнее цело; `NaN` в bpm — bpm прежний; по умолчанию шагов нет, `mlen 7`, `cursor −1`.
  - `testHeard`: `[1, 3, 2, 0.5, 1, 2, 7, 0, 0, 0]` → `[.step(3, 2, true), .answer(7)]`; `testHeardBad`: `[1, 16, 2, 0, 1]` → пусто; `[3, 1, 1, 0, 0]` → пусто; `[1, 2, 3, 0]` → пусто (хвост); `[1, .nan, 1, 0, 1, 1, 4, 5, 0, 0]` → `[.step(4, 5, false)]`.
- [ ] **Step 2:** падают (нет типов).
- [ ] **Step 3: реализация** по Interfaces; `xcodegen` после правки `project.yml`.
- [ ] **Step 4:** зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Cymatica math, handpan layout, mirror and heard parsing`.

**Ревью задачи:** нет.

### Task 2: Чистый слой — `CymState`

**Files:**
- Create: `ios/app/T2D/Cymatica/CymState.swift`
- Test: `ios/app/T2DTests/CymStateTests.swift`

**Interfaces:**
- Consumes: задача 1.
- Produces `struct CymState` (время — секунды, аргумент; буферы предвыделены; `ttl = 0.25`):
  - `mutating func own(_ kind: Int, _ i: Int, _ a: [Double], mirror: CymMirror, now: Double)` — своё по действию поверх текущих (своих или зеркала) значений, правило фасада `model.js:84-205`: `PLAY [on]` (`playing`; выкл — `rec` выкл; вкл — `stepRec` выкл), `REC [on]` (`rec`; вкл при стоящих — и `playing`), `STEPREC [on, r, m]` (`stepRec`, `cursor −1`), `CURSOR [i]`, `GRID [g]`, `BPM`, `LEN i [len]` (`rlen | mlen`), `CHANCE_AT i [ch]` (шанс удара `i`), `MOVE_MARK i [x, y]` (место `i`), `DRIFT_TOGGLE` (`on` наоборот), `DRIFT_SET i [t]` (поле и `on`), `SET_F0 [hz]` (`clamp(55·2^(snap(12·log2(hz/55))/12), 55, 880)`, `scale` — аргумент `own`), `STEP_SCALE [from, steps]` (ступень `semis[clamp(nearestIdx(semis, from) + steps)]`), `SET_FX i [t]`; прочие (`STRIKE*`, `SKIP`, `BEAT`, `NUDGE`, `DROP_MARK`, `COMB`, `TURN`, `DICE`, `CLEAR`) — ничего. Подпись: `own(_:_:_:mirror:scale:now:)`.
  - чтение (своё, пока `≠` зеркала и `now − t < 0.25`, иначе зеркало): `f0`, `fx(_ k: Int)`, `bpm`, `playing`, `rec`, `rlen`, `mlen`, `chance(_ i: Int)`, `mark(_ i: Int) -> CymMark` (своё — только `x, y`; `on` — зеркала), `drift(mirror:now:) -> (on: Bool, depth: Double, rate: Double, shape: Double, k: Int)` (`k` — всегда зеркала), `grid`, `cursor`, `stepRec`.
  - вспышки (`model.js:66-80`, спека решение 9): `mutating func diff(_ m: CymMirror, b: Int, n: Int, list: [Int], now: Double)` — первый вызов после `rebase()` — только база; дальше `born.r[i] = now`, если удар `on` и (был выкл или `vel` иной); `born.m[i] = now`, если нота места не `nil` и смещение клетки `cymCellIdx(x, y, b: 0, n: n)` иное, чем было (выкл → `nil`); `mutating func rebase()`; `born: (r: [Double], m: [Double])` (16, −1e9).
  - услышанное (`view.js:24-41`): `mutating func heard(_ e: CymHeard, mirror: CymMirror, list: [Int], now: Double)` — `step`: `lastStep = (r, m, now)`; если удар `r` `on` и `hit` → `pulse.r[r] = now`, место `m` `on` → `pulse.m[m] = now` и `starPush(x, y, now)`; `answer(semi)` → `answerAt = now`, `answerNote = Cym.noteName(55·2^(semi/12))`.
  - созвездия (`view.js:45-58`): `mutating func starPush(_ x: Double, _ y: Double, _ now: Double)` — до 24 (старейшая уходит); `stars: [(x: Double, y: Double, t: Double)]`; `mutating func starsAge(now:)` — старше 5 с уходят.
  - `mutating func reset()` — свои значения пусты; `born`, `pulse`, звёзды, отзыв — остаются; `rebase()`.

- [ ] **Step 1: тесты** `CymStateTests` (зеркало по умолчанию; без лада):
  - `testOwnNoLag`: `own(BPM, 0, [120], now: 1)` → `bpm == 120` при `1.1`, при `1.26` — 96; зеркало догнало (`bpm 120`) при `1.05` → 120 и своё снято.
  - `testOwnPlayRec`: `REC [1]` при стоящих → `rec`, `playing`; `PLAY [0]` → `playing` и `rec` выкл; `STEPREC [1, 0, 0]` → `stepRec.on`, `cursor −1`; `PLAY [1]` → `stepRec.on == false`.
  - `testOwnLenChanceMark`: `LEN 1 [5]` → `mlen 5`, `rlen 16`; `CHANCE_AT 3 [0.4]` → `chance(3) == 0.4`; `MOVE_MARK 2 [0.1, −0.2]` → `mark(2)` `x 0.1, y −0.2`, `on` — зеркала.
  - `testOwnF0`: `SET_F0 [220]` → `f0 == 220`; `SET_F0 [2000]` → 880; минор, `SET_F0 [57]` → `55·2^(0/12) == 55` (`snap(0.6) = 0`); `STEP_SCALE [12, 2]` без лада → `55·2^(17/12)`; с `steps −30` → 55.
  - `testOwnDriftFx`: `DRIFT_TOGGLE` → `on`; `DRIFT_SET 1 [0.9]` → `rate 0.9`, `on`; `SET_FX 5 [0.2]` → `fx(5) == 0.2`; `GRID [4]`, `CURSOR [3]` → свои.
  - `testBorn`: база — пустое зеркало; зеркало с ударом 2 и местом 4 (`x 0, y −0.9`) → `born.r[2] == now`, `born.m[4] == now`; то же зеркало ещё раз — без новых; место 4 сдвинуто внутри клетки (`y −0.85`) — без вспышки; в другую клетку (`x 0.5, y 0`) — вспышка; место в молчащей клетке (f0 880, центр) — без вспышки; после `rebase()` первое зеркало — без вспышек.
  - `testHeard`: удар 3 и место 1 `on`; `.step(3, 1, true)` → `pulse.r[3]`, `pulse.m[1]`, звезда в `(x, y)` места 1, `lastStep`; `hit false` — только `lastStep`; удар выкл — без `pulse`; `.answer(12)` → `answerNote == "A2"`, `answerAt == now`.
  - `testStars`: 30 `starPush` → 24, первая — седьмая; `starsAge(now: t0 + 5.1)` — старые ушли.
  - `testReset`: после своих правок `reset()` → всё — зеркало; звёзды и `pulse` целы.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner). **Step 5:** коммит `ios/app: Cymatica state - own values, born flashes, heard, stars`.

**Ревью задачи:** нет.

### Task 3: `CymaticaView` — мир, тик, плашки, веер

**Files:**
- Create: `ios/app/T2D/Cymatica/CymaticaView.swift`, `ios/app/T2D/Cymatica/CymSheets.swift` (`extension CymaticaView`: веер и плашка луны)
- Test: `ios/app/T2DTests/CymaticaTests.swift` (фейк `Core` и читатели — как `PortusTests.swift:4-21`)

**Interfaces:**
- Consumes: задачи 1–2; `World`, `Finger`, `SheetSpec / SheetRow`, `Core`, `LegendRow / Glyph`, `Worlds.info`.
- Produces `final class CymaticaView: World`:
  - `static let slotN = 2`; `init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil, seed: (() -> UInt32)? = nil)` (как `PortusView.swift:55-60`; буферы 192 и 96; `seed` по умолчанию — `UInt32.random(in:)` системным генератором); `theme = Worlds.info(2)`; `title "Cymatica"`, `sub "figurae sonorae"`; `legend` — 9 строк `host/legend.js:15-19` дословно (глифы по первому полю: `tap, pinch, tap, drag, drag, drag, twist, hold, tap`);
  - `func send(_ kind: Int, _ i: Int = 0, _ a: [Double] = [], touchTime: Double = 0)` — `core.action(kind, i, a, touchTime:)` и `state.own(…, scale: scl, now:)`; **единственный** путь действий мира;
  - чтение: `private(set) var mirror`, `state`, `scl: CymScale`, `now`; `var geo: CymGeo` (от `shownF0`; в плане (а) `shownF0 = effF0`, плавность — план (б)); `func effF0() -> Double` (`cymEffF0` от `state.f0`, луны, `scl`), `func base() -> Int`, `var noteList: [Int]` (кеш, пересчёт в `scale()`), значения `f0, fx(_:), bpm, playing, rec, rlen, mlen, chance(_:), mark(_:), drift, grid, cursor, stepRec` — через `state`; `func step(_ i: Int) -> CymStep` (зеркало + `chance(i)`); `func noteOf(_ x: Double, _ y: Double) -> Int?` (`cymNoteAt` с `base()`, `degPerOct`, `noteList`);
  - `fx: SheetSpec?` — `title "aether"`, `hint "FX — tap outside to close"`, строки в порядке веера `structure, damping, brightness, hall, echo, chance, time` (код −1 у всех), `lfo nil`, `get/set` — `SET_FX` по индексу `FX_KEYS`, `text` — `view.js:351-357` (`structure` — `STRUCT[round(v·7)]`, `time` — `echoDiv`, `damping` — `0.08·150^v` с `toFixed(s < 10 ? 1 : 0) + " s"`, прочее — `N%`), `arc: { fx(3) }`;
  - `var driftSpec: SheetSpec` — `title "luna"`, `hint "plate drift — tap outside to close"`, строки `depth, rate, shape` (код −1), `lfo nil`, `get` — поле луны, `set` — `DRIFT_SET i [t]`, `text` — `±N steps` / `driftRate.0` / `sine | random` (`shape < 0.5`);
  - `tick(now:dt:)`: зеркало → `mirror`; `state.diff(…)`; `heard` (до 4 чтений, пока буфер полный) → `state.heard`; `state.starsAge`; `touchTick(now:)` (задача 4; в этой задаче — пустая заглушка в `CymTouch.swift`); `idle()` — слить `heard` без событий; `restored()` — `touchReset()`, `state.reset()`; `enter()` — `state.rebase()`; `scale(pcs:root:)` → `scl`, `noteList`, `state.rebase()`; `cornerHit` → `cymResonatorHit`; `objs` — число мест мелодии `on`; `dice()` — `send(DICE, 0, [Double(seed())])`; `clear()` — `send(CLEAR)`;
  - `down / move / up / cancel` — пока пустые; `draw / drawShot` — пустые (план (б)).

- [ ] **Step 1: тесты** `CymaticaTests` (`layout(W: 390, H: 844, topY: 50, safeBot: 34)`, `seed: { 7 }`):
  - `testSendOwns`: `send(BPM, 0, [120])` → в фейке `(14, 0, [120], 0)`, `bpm == 120` сразу; `send(STRIKE_AT, 0, [0.1, 0.2], touchTime: 3.5)` → `t == 3.5`.
  - `testFan`: заголовок `aether`, порядок строк, `text("structure") == "plate"` (2/7 → индекс 2), `text("damping") == "1.0 s"` (`0.08·150^0.5 = 0.98`), `text("time") == "1/8d"`, `text("echo") == "15%"`; `set("time", 0.25)` → `SET_FX 5 [0.25]`; `arc() == 0.25`; `lfo == nil`.
  - `testDriftSheet`: `text("depth") == "±2 steps"`, `text("rate") == "1 bar"`, `text("shape") == "sine"`; `set("rate", 1)` → `DRIFT_SET 1 [1]`, `text("rate") == "1/4"`.
  - `testHeardTick`: зеркало с ударом 3 и местом 1; фейковый `heard` `[1, 3, 1, 0, 1, 2, 12, 0, 0, 0]` → `state.pulse.r[3] == now`, звезда, `answerNote == "A2"`; `idle()` сливает без изменений.
  - `testBornViaTick`: первый `tick` — без вспышек; зеркало с новым ударом 5 → `born.r[5] == now`; `restored()` и зеркало с ещё одним ударом — без вспышек на первом `tick` после.
  - `testDiceClear`: `dice()` → `DICE 0 [7]`, больше ничего; `clear()` → `CLEAR`.
  - `testCorner`: `cornerHit(380, 800)` — да, `(195, 410)` — нет.
  - `testScale`: `scale(pcs: [0,2,3,5,7,8,10], root: 0)` → `noteList.count == 36`; `scale(pcs: nil, root: 0)` → 26.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner). **Step 5:** коммит `ios/app: Cymatica view - state wiring, fan, luna sheet, heard`.

**Ревью задачи:** нет.

### Task 4: `CymTouch` — один палец: кнопки, кольца, метки, удар

**Files:**
- Create: `ios/app/T2D/Cymatica/CymTouch.swift` (`extension CymaticaView`; хранимые поля пальцев — в `CymaticaView.swift`)
- Modify: `ios/app/T2D/Cymatica/CymaticaView.swift` (убрать заглушки `down / move / up / cancel`)
- Test: `ios/app/T2DTests/CymTouchTests.swift`

**Interfaces:**
- Consumes: задачи 1–3 (`send`, `geo`, `step`, `mark`, `noteOf`, `state`, `openSheet`, `driftSpec`, `noteList`, `base`).
- Produces (`view.js:90-153, 201-287, 323-338`; координаты экрана):
  - палец `struct CymFinger { kind: none | play | rec | grid | drift | len | rtick | mtick | mark | away | live | two; i: Int; ring: Int /* 0 ритм, 1 мелодия */; r0, c0, bpm0: Double; ci: Int?; menu, combed, two: Bool; t0, x0, y0, x, y: Double }`, словарь по `Finger.id`; `func moved(_ f: CymFinger) -> Bool` (≥ 10 px от `x0, y0`);
  - `func astroHit(_ x: Double, _ y: Double) -> CymFinger?` (`view.js:91-109`; `ci` бусины — `cymCellIdx(место, b: base(), n: degPerOct)`);
  - `down`: кнопка (r 22 у `ty`) → палец кнопки (`bpm0 = bpm`), **в пару не идёт** → есть живой палец не-кнопка и пары нет → пара (задача 5: `startTwo`; здесь — заглушка, возвращает) → `astroHit` → дальше `rMax` от центра — `away` → метка (r 11 по `fromPlate`, только если не `rec` и не (курсор при стоящих)) → `send(STRIKE, 0, [x, y, 55·2^(note/12), 1, 0.5, 0], touchTime:)` (нота места; `nil` — без звука), палец `mark` → вне пластины (`|toPlate| > 1`) — `away` → `noteOf(p) == nil` — ничего (палец не заводится) → `send(STRIKE_AT, 0, [p.x, p.y], touchTime: f.touchTime)`, `state.starPush(p, now)`, палец `live`;
  - `move`: ▶ сдвинут → `BPM [round(clamp(bpm0 + dx·0.5, 40, 200))]` (только при смене), `bpmUntil = now + 1`; `len` → `LEN ring [round(clamp(slotOf + 0.5, 1, 16))]` (только при смене); `rtick` сдвинут, удар `on` → `CHANCE_AT i [round(clamp(c0 + (d − r0)/70, 0.05, 1)·20)/20]` (при смене), `chanceEdit`; `mtick` сдвинут, место `on`, `ci` есть → `NUDGE i [ci, round((d − r0)/6)]`, только если центр новой клетки (`model.js:153-159`) отличен от места, `noteEdit`; `mark` сдвинут → `MOVE_MARK i [p.x, p.y]`;
  - `up`: `grid` — `GRID [1→2→4→1]`, если не `combed`; ▶ не сдвинут → `CURSOR [−1]`, `PLAY [!playing]`; ● → `CURSOR [−1]`, затем играет — `REC [!rec]`, стоит — `STEPREC [stepRec ? 0 : 1, 0, 0]`; `rtick` не сдвинут → `BEAT i`; `drift` не сдвинут, не `menu` → `DRIFT_TOGGLE`; `mtick` не сдвинут, стоит → `CURSOR [i mod mlen]`; `mark` сдвинут и место за 1.05 → `DROP_MARK i`; `away` — `stepRec.on` и сдвиг < 12 → `SKIP`, иначе `CURSOR [−1]`;
  - `func touchTick(now: Double)` — удержание 0.42 с без сдвига: `drift` не `menu` → `menu = true`, `openSheet(driftSpec)`; `grid` не `combed` → `combed = true`, `COMB`;
  - `func touchReset()` — пальцы и пара забыты; `cancel` — палец забыт без действий `up`;
  - подписи-таймеры для картинки (плана (б)): `bpmUntil`, `chanceEdit: (i: Int, until: Double)?`, `noteEdit`, `markHot: (i: Int, at: Double)?` (удар по метке — для `hot < 160 мс`).

- [ ] **Step 1: тесты** `CymTouchTests` (геометрия задачи 1: центр `(195, 410)`, `rMax 131`, `r 110.157`, `R1 153`, `R2 179`, `RM 166`, `ty 623`; время — `tick(now:)` и `Finger.t0`):
  - `testStrike`: тап `(195, 410 − 0.9·r)` → `STRIKE_AT 0 [0, −0.9]` с `touchTime` пальца, звезда; молчащая клетка (`SET_F0` 880 в зеркале, центр) — ничего.
  - `testButtons`: тап ▶ `(105, 623)` → `CURSOR [−1]`, `PLAY [1]`; ▶ вбок 40 px → `BPM [116]`, без `PLAY`; ● стоит → `CURSOR [−1]`, `STEPREC [1, 0, 0]`; ● играет → `REC [1]`; сетка тап → `GRID [2]`; удержание сетки 0.43 с → `COMB`, на `up` без `GRID`.
  - `testDriftTapHold`: тап луны `(285, 623)` → `DRIFT_TOGGLE`; удержание 0.43 с → `openSheet` с `title "luna"`, на `up` без `DRIFT_TOGGLE`.
  - `testRhythmRing`: тап по гнезду 4 ритма `(195 + 172, 410)` → `BEAT 4`; удар 4 `on`, тянуть наружу на 35 px → `CHANCE_AT 4 [1]` нет (уже 1), к центру на 35 → `CHANCE_AT 4 [0.5]`.
  - `testLen`: мелодия `mlen 7`: палец на краю (`slotOf ≈ 6.5`, радиус 160) → тянуть к `slotOf ≈ 9.5` → `LEN 1 [10]`.
  - `testBeadNudge`: место 2 `on` в клетке `ci`; палец на бусине 2 (`R1`), наружу на 13 px → `NUDGE 2 [ci, 2]`; тап при стоящих → `CURSOR [2]`.
  - `testMark`: место 1 `on` в `(0, −0.9)`; тап в его точку → `STRIKE 0 [0, −0.9, 110, 1, 0.5, 0]` (нота 12 → 110 Гц); тянуть → `MOVE_MARK 1 [x, y]`; дотянуть за 1.05 r и отпустить → `DROP_MARK 1`.
  - `testMarkIgnoredWhileRec`: то же место, зеркало `rec 1, playing 1` → тап в точку метки — `STRIKE_AT`, не `STRIKE`.
  - `testAwaySkip`: `stepRec.on`; тап мимо стола `(20, 200)` → `SKIP`; без `stepRec` → `CURSOR [−1]`.
  - `testButtonNotPaired`: палец бьёт пластину, второй — ▶ → `PLAY`, пары нет; палец держит ▶, второй — по пластине → `STRIKE_AT`.
  - `testRestoredMidDrag`: пальцы на метке и на краю длины; `restored()` → `move / up` — ни одного действия.
- [ ] **Step 2:** падают. **Step 3:** реализация (перенос `view.js` построчно, пороги и формулы — оттуда; своих не вводить). **Step 4:** зелёные (test-runner). **Step 5:** коммит `ios/app: Cymatica touches - buttons, rings, marks, strikes`.

**Ревью задачи:** да (касания).

### Task 5: `CymTouch` — два пальца: вращение и щипок

**Files:**
- Modify: `ios/app/T2D/Cymatica/CymTouch.swift` (`startTwo`, `moveTwo`, `endTurn`), `ios/app/T2D/Cymatica/CymaticaView.swift` (поля пары, `ringTurn / ringOrn`)
- Test: `ios/app/T2DTests/CymTouchTests.swift`

**Interfaces:**
- Consumes: задача 4 (пальцы, `send`, `geo`, `mirror`).
- Produces (`view.js:155-199`, `core.js:87-91`):
  - `struct CymPair { a, b: id пальцев; a0, d0: Double /* d0 ≥ 20 */; kind: CymTwo?; target: 0 ритм | 1 мелодия | 2 пластина; f00: Double; fromSemi: Double; orig: [Double] /* узор цели из зеркала на начало: ритм 16×(on, vel, chance, has), мелодия 16×(on, x, y) */; last, deg: Double; k: Int }`;
  - цель — по средней дистанции пальцев от центра: `< rMax` → 2, `< RM` → 1, иначе 0;
  - `moveTwo`: `kind` решается `cymTwistOrPinch` один раз; щипок — без лада `SET_F0 [f00·2^(−dd/12/12)]`, с ладом `STEP_SCALE [12·log2(f00/55), round(−dd/18)]` (`dd = d1 − d0`; шлётся при смене значения), `labelUntil = now + 1`; вращение — `deg += wrapDeg(Δa)`, `k = round(deg / (target == 2 ? 20 : 22.5))`, кольцо — `ringTurn[target] = deg − k·22.5`, при смене `k` → `TURN target [k] + orig`; `twistLabel: (text: String, x: Double, y: Double, until: Double)?` (`"+k" / "k"`);
  - `up` любого пальца пары → `ringOrn[target] = (ringOrn + k·22.5) mod 360` (кольца), `ringTurn = (0, 0)`, пара снята; второй палец пары больше ничего не шлёт;
  - `ringTurn: [Double]` (2), `ringOrn: [Double]` (2) — для картинки (б).

- [ ] **Step 1: тесты** (геометрия задачи 4):
  - `testPinchNoScale`: пальцы `(150, 410)` и `(240, 410)` (средняя дистанция 45 → пластина) разводятся на 60 px → `SET_F0 [110·2^(−60/144)]` (развёл — пластина больше и ниже, `view.js:65`); `TURN` нет.
  - `testPinchScale`: лад минор; развести на 40 px → `STEP_SCALE [12, −2]`.
  - `testTwistPlate`: те же пальцы, поворот на 45° вокруг середины → `TURN 2 [2, …48 чисел мелодии]` (`round(45/20) = 2`); `twistLabel.text == "+2"`.
  - `testTwistRing`: пальцы на кольце ритма (средняя дистанция 175), поворот на 50° → `TURN 0 [2, …64 числа]`, `ringTurn[0] == 50 − 45`; `up` → `ringOrn[0] == 45`, `ringTurn[0] == 0`.
  - `testTwistOrigFromMirror`: удар 0 `on` в зеркале на начало; во время жеста зеркало меняется (ядро повернуло) — следующий `TURN` несёт **исходный** узор (удар в гнезде 0).
  - `testRestoredMidTwo`: пара вращает; `restored()` → `move / up` — ни одного `TURN`, `ringTurn == [0, 0]`.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner). **Step 5:** коммит `ios/app: Cymatica two fingers - twist rings and plate, pinch pitch`.

**Ревью задачи:** да (жесты).

---

**Дальше — план (б)** (`docs/superpowers/plans/2026-11-03-ios-cymatica-b.md`, пишется после (а)): `CymScene` (кеш волн), `CymDraw` / `CymAstro` / `CymFrame` (кадр: пластина, клетки, созвездия, астролябия, кнопки, курсор, подписи, резонатор), `shownF0` с τ 0.08 с, включение на карте, сцены `cym*`, снимки против веба, финальное ревью всей ветки (opus), доки, пуш.

# iOS фаза 3 — Natura на Swift, план (а): ядро, чистый слой, касания

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** логика IV · Natura на Swift без картинки: `DICE` в ядре, геометрия реки и предметов, разбор зеркала и `heard`, собственные значения, касания (кувшинки, вода, glide, пристань, плотина, облако, горы, утки, дерево, птицы, лягушка, челнок с броском и меню цветков), плашка кувшинки, веер, легенда. Картинка, сцены и включение на карте — план (б).

**Architecture:** модель и звук — в ядре (`core/worlds/natura/`, слот 4); Swift разбирает зеркало (160 чисел) и пары `heard` и шлёт действия. Все действия мира идут через одну обёртку `send(kind, i, a)` в `NaturaView`: она зовёт `core.action` и отдаёт то же действие `NatState.own(…)`, который по правилу фасада (`worlds/natura/model.js:83-121`) держит свои значения до зеркала (0.25 с или сходимость). Мир: `ios/app/T2D/Natura/` — `NatMath` (константы, геометрия, ноты, тексты), `NatMirror` (зеркало, `heard`), `NatState` (свои значения, фаза, утки, лягушка), `NaturaView` (связка, тик, плашки, веер), `NatTouch` (`extension NaturaView`: касания).

**Tech Stack:** C++17 (`core/tests/sdk_test.cpp`), Swift 5 + UIKit, XCTest, XcodeGen.

**Spec:** `docs/superpowers/specs/2026-10-31-ios-natura-design.md` — читать целиком перед любой задачей. Разведка (геометрия, касания, развилки) — `.superpowers/natura-explore.md`. Веб-источник истины — `worlds/natura/view.js` (утки и испуг `:15-19`, челнок `:111-135`, `boatXY :136-141`, птицы `:144-152`, `noteName :160-161`, касания `:162-301`, плашка `:302-328`, меню `:330-337`, лягушка `:351-389`, веер `:484-498`), `worlds/natura/scene.js` (`stage / geo / river / across / onRiver :16-43`, `T0, TS, slotT, padXY :45-50`, `sunAt :166`, `LILY :264`, `pondAt, ducksAt :287-295`, `skiffHome, pierXY :369-371`, `bridgeT :380`, `cloudAt :453`), `worlds/natura/model.js` (константы `:11-31`, демо `:36-41`, `noteHz / skiffHz :56-69`, действия фасада `:83-121`, кубик `:125-145`). Образец Swift — `ios/app/T2D/Inferno/` и его тесты.

## Global Constraints

- Ветка `native`; ветку не менять. Коммиты — по-английски, тело-список, последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `notebooks/*` и `.superpowers/` не коммитить.
- Ядро: C++17, `-ffp-contract=off`; правка `core/` → `core/build.sh` и `t2d.wasm` в том же коммите. Комментарии — по-русски, плотность как в соседнем коде.
- Миры заморожены: звук и веб Natura не меняются — `node --test tools/models/natura.test.mjs` зелёный до и после; `worlds/natura/*` не трогать.
- Swift: новые файлы в `T2D/` попадают в `T2D` сами, в `T2DTests` — через `project.yml` (источники теста; добавить `T2D/Natura` рядом с `T2D/Inferno`, задача 2); после — `xcodegen` в `ios/app`. Комментарии — по-русски, как в `Inferno/`. Округление как в JS (`Math.round`) — `Horo.jsRound`.
- Тесты: ядро — из корня `core/build.sh && core/build/sdk-test` → `0 failed`; Swift — через агента test-runner: `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|failed|passed|SUCCEEDED|FAILED" | tail -30` → `** TEST SUCCEEDED **`. **Тест пишется раньше кода и сначала падает** — красный прогон обязателен до реализации.
- Мир в плане (а) на карте не включён (`Worlds.swift` — `view: false`), `draw / drawShot` пустые.
- Константы Natura: слот 4; `WAVES = sine, square, triangle, saw, sharp`; `FX_KEYS = reverb, delay, time, chorus, cutoff, res, att, rel, chance` (индекс = `SETFX i`), по умолчанию `0.4, 0.45, 0.5, 0.4, 0.62, 0.25, 0.08, 0.45, 1`; bpm 96, len 12; демо `место → (note, wave)`: `0 (2,0), 2 (7,1), 3 (5,0), 5 (11,2), 6 (9,0), 8 (4,1), 9 (7,2), 11 (0,0), 13 (12,1)`; `LOCKS = cutoff, res, att, rel` (замок `k` = `PLOCK [k, v]`, `PUNLOCK [4]` — шанс к 1); `NPAD 16`; `GONE_S 4`; `attOf(v) = 0.002 + 0.6v²`, `relOf(v) = 0.05 + 1.85v²`; `DIVS = 1/16 ¼, 1/8 ½, 1/8d ¾, 1/4 1, 1/4d 1.5, 1/2 2`, `div = DIVS[round(time·5)]`; `stepSec = 60/bpm/4`; `T0 0.14`, `TS 0.72`, `LILY 18`; `HOLD_MS 420` (`Touch.holdMs`), сдвиг пальца 8 px.
- Действия ядра (`core/worlds/natura/world.hpp:33-34`): `STATE 0, PLAY 1, HEAR 2, SHAKE 3, SKIFF 4, SKIFF_OFF 5, WAVE 6, CROAK 7, LASER 8, SCARE 9, PLANT 10, REMOVE 11, MOVE 12, NOTE 13, LEN 14, PGLIDE 15, PWAVE 16, PCHANCE 17, PLOCK 18, PUNLOCK 19, SETFX 20, SETBPM 21, SHAKEBY 22, CLEAR 23`, новый `DICE 24`. Аргументы — разведка §5.
- Зеркало (160 чисел, буфер 192): `0` фаза (`−1` — стоит), `1` playing, `2` живые голоса, `3` челноки, `4` bpm, `5` len, `6` shake, `7…15` fx, место `i` с `16 + 9i`: `on, note, wave, glide, chance (−1 — не задан = 1), cutoff, res, att, rel (−1 — замка нет)`. `heard` — пары `[kind, place]`: `2` — нота прозвучала, `1` — шаг сыгран.
- Геометрия (`scene.js:16-25`): сцена `w = min(W, round((H − safeBot)·0.62))`, `ox = round((W − w)/2)`; в `geo` `W` — ширина сцены `w`, `H` — полная; `top = topY + 26`, `bot = H − safeBot − 40`, `h = bot − top`, `hor = top + 0.3h`, `y1 = bot − 6`, `sun = (13, topY + 2, min(70, W·0.18))`, `tree = (0.85W, top + 0.47h)`, `cloudY = top + 0.06h`, Безье `P0 = (0.44W, hor)`, `P1 = (0.12W, hor + 0.66·(top + 0.76h − hor))`, `P2 = (1.12W, top + 0.76h)`. Касания — в координатах сцены (`x − ox`).
- **Решено без автора** — спека, раздел «Решено без автора» (семь пунктов).

## Review Focus

1. **Перенос кувшинки через занятые места** — палец тянет кувшинку 3 вдоль реки через занятое место 5 на свободное 7: на 5 — ничего (`MOVE` не шлётся, кувшинка 5 цела), на 7 — `MOVE 3 [7]`, дальше `NOTE` идёт месту 7; плашка, если открыта, не путает места. Тест — задача 5 (`testMoveSkipsBusy`).
2. **Отмена посреди жеста** — `restored()` при пальце на кувшинке, на челноке на воде и открытом меню: челнок дома, одно `SKIFF_OFF`, меню закрыто, последующие `move / up` пальцев ничего не шлют. Тест — задача 5 (`testRestoredMidGesture`).
3. **Кувшинка пропала при открытой плашке** (тап убрал, корзина, кубик, отмена, `MOVE` прочь) — `objGone(i)` ровно один раз, плашка закрывается хостом; повторный кадр не зовёт снова. Тест — задача 4 (`testObjGone`).
4. **Бросок челнока, пока утки ещё не вернулись** (`envOpen`) — не летит, плывёт домой, `SCARE` не шлётся. Тест — задача 5 (`testThrowWhileGone`).
5. **Плохое зеркало и `heard`** (короче 160, NaN, место вне 0…15, нечётный хвост пары) — не падает, годное учтено, прежнее зеркало цело. Тест — задача 2 (`testMirrorShort`, `testHeardBad`).

---

### Task 1: Ядро — `DICE` Natura

**Files:**
- Modify: `core/worlds/natura/model.hpp` / `model.cpp` (`void dice(sdk::Rng& r)`), `core/worlds/natura/world.hpp` (`enum Act` — `DICE` последним, комментарий), `core/worlds/natura/world.cpp` (`case DICE: model_.dice(rng_); applyFx(); return;`), `t2d.wasm`
- Test: `core/tests/sdk_test.cpp` — `naturaDice()` рядом с `naturaModel` (~1183), вызов в `main()` после `naturaModel();` (~3787)

**Interfaces:**
- Produces: `natura::DICE == 24`; `Model::dice(sdk::Rng& r)` — алгоритм `model.js:126-143` с `R = r.next()` **в том же порядке вызовов**: `n = 8 + ⌊R·9⌋`, `k = 3 + ⌊R·(n−4)⌋`, `note = ⌊R·8⌋`, `len = n`; место `i` пусто, если `i ≥ n || (i·k) % n ≥ k`, иначе `note = clamp(note + [−2,−1,1,2][⌊R·4⌋], 0, 14)`, `wave = ⌊R·5⌋`, `glide = false`; `R < 0.35` → замки (на каждый ключ `cutoff, res, att, rel` по порядку: `R < 0.4` → `res: R·0.85`, `att: R·0.6`, иначе `R`; ни одного — `cutoff = R`), иначе замков нет; `R < 0.2` → `chance = 0.5 + round(R·8)/20`, иначе `−1`; затем fx: `chance = 1`, `cutoff = 0.35 + 0.5R`, `res = 0.6R`, `att = R·R·0.5`, `rel = 0.2 + 0.6R` (в этом порядке вызовов). `playing`, bpm, прочие fx не трогает. `round` — как `Math.round` (`std::floor(x + 0.5)`).

- [ ] **Step 1: тест** `naturaDice` (мир как в `naturaWorld`, `act(DICE, 0, {})`, затем `w.mirror`): 20 бросков подряд — каждый раз `len ∈ 8…16`, места `≥ len` пусты (`on 0`), занятые — `note ∈ 0…14`, `wave ∈ 0…4`, `glide 0`, `chance ∈ {−1} ∪ [0.5, 0.9]`, замки `−1` или `[0, 1]` (`res ≤ 0.85`, `att ≤ 0.6`), fx `chance == 1`, `cutoff ∈ [0.35, 0.85]`, `res ≤ 0.6`, `att ≤ 0.5`, `rel ∈ [0.2, 0.8]`; `reverb, delay, time, chorus` и bpm не изменились; хотя бы два броска дали разные `len` или ноты; ритм — для занятого `i` `(i·k) % n < k` выполняется при каком-то `k ∈ 3…n−2` (проверить перебором); `playing` после `DICE` у стоящего мира — `0`. Второй мир с тем же начальным состоянием — та же петля после первого `DICE` (детерминизм по зерну).
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` — `naturaDice` падает (нет `DICE`).
- [ ] **Step 3: реализация** по Interfaces (образец — `core/worlds/inferno/model.cpp:69-80`).
- [ ] **Step 4:** `core/build.sh && core/build/sdk-test` → `0 failed`; `node --test tools/models/natura.test.mjs` — зелёный.
- [ ] **Step 5:** коммит `core: DICE for Natura` вместе с `t2d.wasm`.

**Ревью задачи:** да (ядро).

### Task 2: Чистый слой — `NatMath`, `NatMirror`

**Files:**
- Create: `ios/app/T2D/Natura/NatMath.swift`, `ios/app/T2D/Natura/NatMirror.swift`
- Modify: `ios/app/project.yml` (источники `T2DTests` — `T2D/Natura`)
- Test: `ios/app/T2DTests/NatMathTests.swift`

**Interfaces:**
- Produces:
  - `enum Nat` — константы Global Constraints: `slot = 4`, `npad = 16`, `waves`, `fxKeys`, `fxDef: [Double]`, `locks`, `demo: [(i: Int, note: Int, wave: Int)]`, `bpm0 = 96.0`, `len0 = 12`, `goneS = 4.0`, `t0 = 0.14`, `ts = 0.72`, `lily = 18.0`, `mirrorN = 160`, `head = 16`, `padN = 9`; `enum Act { static let state = 0 … clear = 23, dice = 24 }`; `static func attOf(_ v: Double) -> Double`, `relOf`, `static func div(_ time: Double) -> (name: String, beats: Double)`.
  - `struct NatRiver { var x, y, w, tx, ty, nx, ny: Double; func across(_ q: Double) -> (x: Double, y: Double) }`;
  - `struct NatGeo { init(W: Double, H: Double, topY: Double, safeBot: Double)` — `W` полный экран; `ox, W /* сцены */, H, top, bot, h, hor, y1: Double; sun: (x: Double, y: Double, r: Double); tree: (x: Double, y: Double); cloudY: Double`; `func river(_ t: Double) -> NatRiver`; `func onRiver(_ x: Double, _ y: Double) -> (t: Double, q: Double)`; `func inRiver(_ x: Double, _ y: Double) -> Bool`; `static func slotT(_ i: Int) -> Double`; `func padXY(_ i: Int, _ note: Int) -> (x: Double, y: Double, s: Double)`; `static func slotOf(_ t: Double) -> Int`; `static func noteOf(_ q: Double) -> Int`; `func bridgeT(len: Int) -> Double`; `func sunAt(bpm: Double) -> (x: Double, y: Double, r: Double)`; `func pond() -> (x: Double, y: Double, rx: Double, ry: Double)`; `func ducks(att: Double, rel: Double, now: Double) -> (a: NatDuck, r: NatDuck)` (`struct NatDuck { x, y, s, dir: Double }`, `scene.js:288-295`); `func skiffHome() -> (x: Double, y: Double)`; `func pier() -> (x: Double, y: Double)`; `func cloud(cutoff: Double) -> (s: Double, cx: Double, cy: Double)`; `func crown() -> (x: Double, y: Double, R: Double)` (`R = min(0.16W, 0.09h)`, `y = tree.y − 0.13h − 0.6R`); `func boat(phase: Double?, len: Int, now: Double) -> (x: Double, y: Double, s: Double)` (`view.js:136-141`); `func birds(chorus: Double, now: Double, birdsAt: Double, into: inout [(x: Double, y: Double, s: Double, i: Int, fast: Double)])` (`view.js:144-152`, `now` и `birdsAt` — секунды, в формулах ·1000) }`.
  - Ноты: `struct NatScale { var pcs: [Int]?; var root: Int; func noteHz(_ n: Int) -> Double; func skiffHz(_ q: Double) -> Double }` (`model.js:56-69`; `pcs nil` — минор `[0,2,3,5,7,8,10]`, `root 0`); `func natNoteName(_ hz: Double) -> String` (`view.js:160-161`); `func natHz(_ hz: Double) -> String` (`hzTxt`), `func natMs(_ s: Double) -> String` (`msTxt`).
  - `struct NatPad: Equatable { var on = false; var note = 0, wave = 0; var glide = false; var chance = -1.0; var lock = SIMD4<Double>(repeating: -1); var chanceV: Double { chance < 0 ? 1 : chance } }`.
  - `struct NatMirror { var phase = −1.0; var playing = false; var voices = 0, skiffs = 0; var bpm = 96.0; var len = 12; var shake = 0.0; var fx: [Double] (fxDef); var pads: [NatPad] (демо); mutating func load(_ b: [Double], n: Int) -> Bool }` — `n < 160` → `false`, прежнее остаётся; не конечные числа — поле не меняется.
  - `func natHeard(_ b: [Double], n: Int, into out: inout [(kind: Int, i: Int)]) -> Int` — пары подряд; хвост без пары, `kind ∉ {1, 2}`, `i` не конечный или вне `0…15` — пара пропущена; возвращает число дописанных.

- [ ] **Step 1: тесты** `NatMathTests` (`NatGeo(W: 390, H: 844, topY: 50, safeBot: 34)`; ±1e-9):
  - `testGeo`: `ox 0, W 390, top 76, bot 770, h 694, hor 284.2, y1 764, sun (13, 52, 70)`, `tree (331.5, 402.18)`, `cloudY 117.64`; `river(0)` = `(171.6, 284.2)`, `w 46.8`; `river(1)` = `(436.8, 603.44)`, `w 241.8`; нормаль `(ty, −tx)`, `|t| = 1`. iPad `NatGeo(W: 1024, H: 1366, topY: 24, safeBot: 20)` → `W = 835` (`round(1346·0.62)`), `ox = 95`.
  - `testRiverRoundTrip`: для `i ∈ 0…15`, `note ∈ {0, 7, 14}`: `p = padXY(i, note)` → `onRiver(p)` даёт `slotOf(t) == i` и `noteOf(q) == note`; `inRiver(p)`; `inRiver(195, 100) == false`; `padXY(0, 7).s == 0.6 + 0.8·slotT(0)`.
  - `testPlaces`: `sunAt(bpm: 96).y == 52`, `sunAt(bpm: 40).y == 52 + (284.2 − 52 − 24.5)`, `sunAt(bpm: 200).y == 52`; `pond() == (140.4, 764 − 79.81, 62.4, 19)`; `bridgeT(len: 12) == slotT(11) + 0.72/16·0.75`; `boat(phase: nil, …)` = `pier() + (16, 3)`, `s 0.8`; `boat(phase: 0, len: 12, now: 0)` = `river(T0).across(0)` с `y − 2`, `s = 0.75 + T0`.
  - `testScale`: без лада `noteHz(0) == 110`, `noteHz(7) == 220`, `noteHz(2) == 110·2^(3/12)`; лад `pcs [3, 5, 7, 8, 10, 0, 2], root 3` → ступени `[0,2,4,5,7,9,11]`, `noteHz(0) == 110·2^(3/12)`; `skiffHz(0) == noteHz(7)` (`d = 7`); `skiffHz(0.1)` (`d = (0.1/0.78 + 0.5)·14 ≈ 8.795`) без лада — `2^(log2 noteHz(8) + 0.795…·(log2 noteHz(9) − log2 noteHz(8)))`, с ладом (`pcs` минора, `root 0`) `== noteHz(9)`; `natNoteName(110) == "A2"`, `natNoteName(261.63) == "C4"`; `natHz(180) == "180 Hz"`, `natHz(1530) == "1.5 kHz"`; `natMs(0.05) == "50 ms"`, `natMs(1.9) == "1.90 s"`; `Nat.div(0.5).name == "1/8d"`, `Nat.div(1).beats == 2`.
  - `testMirror`: буфер 160 с меткой на каждом смещении → поля по раскладке (`fx[3] = b[10]`, `pads[2].lock[1] = b[16 + 18 + 6]`, `on / glide` — `> 0.5`, `note / wave / len` — `Int`); `testMirrorShort`: `load(…, n: 159) == false`, прежнее цело; `NaN` в `bpm` — bpm прежний; по умолчанию `pads[5] == NatPad(on: true, note: 11, wave: 2)`, `pads[1].on == false`, `fx == fxDef`, `len 12`.
  - `testHeard`: `[2, 4, 1, 4, 1, 0]` → `[(2,4), (1,4), (1,0)]`; `testHeardBad`: `[2, 16, 1, 3]` → `[(1,3)]`; `[3, 1]` → 0; `[2]` → 0; `[1, .nan, 2, 5]` → `[(2,5)]`.
- [ ] **Step 2:** тесты падают (нет типов).
- [ ] **Step 3: реализация** по Interfaces; `xcodegen` после правки `project.yml`.
- [ ] **Step 4:** Swift-тесты зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Natura math, mirror and heard parsing`.

**Ревью задачи:** нет (одно финальное).

### Task 3: Чистый слой — `NatState`

**Files:**
- Create: `ios/app/T2D/Natura/NatState.swift`
- Test: `ios/app/T2DTests/NatStateTests.swift`

**Interfaces:**
- Consumes: `NatMirror`, `NatPad`, `NatGeo`, `Nat.*` (задача 2).
- Produces `struct NatState` (время — секунды, аргумент; всё предвыделено; `ttl = 0.25`):
  - `mutating func own(_ kind: Int, _ i: Int, _ a: [Double], mirror: NatMirror, now: Double)` — своё по действию, правило фасада `model.js:83-121` поверх текущих (своих или зеркала) значений: `PLANT` (место пусто → `on, note a0, wave a1`, прочее по умолчанию), `REMOVE` (пусто), `MOVE` (`j = a0` свободно и `j ≠ i` → `j` = кувшинка `i`, `i` пусто; иначе ничего), `NOTE`, `PGLIDE`, `PWAVE` (и `lastWave`), `PCHANCE`, `PLOCK [k, v]`, `PUNLOCK [k]` (`4` → `chance −1`, `0…3` → замок `−1`), `CLEAR` (16 пустых), `LEN`, `SETBPM`, `PLAY [on]`, `SETFX i [v]`, `SHAKEBY [add]` (`min(1, shake + add)`), `SCARE` (`goneAt = now`), `WAVE [k]` (`lastWave`), `LASER` (`birdsAt = now`); прочие — ничего; кувшинка на пустом месте (кроме `PLANT`) — ничего, как ядро;
  - чтение: `func pad(_ i: Int, mirror: NatMirror, now: Double) -> NatPad`, `len(…) -> Int`, `bpm(…) -> Double`, `playing(…) -> Bool`, `fx(_ k: Int, …) -> Double` — своё, пока `≠` зеркала и `now − t < 0.25`, иначе зеркало (поле кувшинки — место целиком, `NatPad ==`);
  - `func shake(mirror: NatMirror, now: Double) -> Double` — после своего `SHAKEBY` в пределах 0.25 с — своё `·e^(−(now − t)/1.4)`, иначе зеркало;
  - `func phase(mirror: NatMirror, mAt: Double, now: Double) -> Double?` — `nil`, если не `playing` (своё) или зеркало стоит (`phase < 0`); иначе `mirror.phase + min(1, (now − mAt)/stepSec)`, `stepSec` по своему bpm;
  - `var lastWave: Int` (0), `goneAt: Double?`, `func envOpen(now: Double) -> Bool` (`now − goneAt < 4`), `var birdsAt: Double` (−1e9);
  - услышанное: `mutating func heard(_ kind: Int, _ i: Int, now: Double)` → `noteAt[i]` (`2`), `playedAt[i]` (`1`); `noteAt, playedAt: [Double]` (16, −1e9);
  - лягушка: `mutating func frog(geo: NatGeo, pads: [NatPad], len: Int, now: Double, R: () -> Double) -> (x: Double, y: Double, s: Double, air: Bool, i: Int)?` — `view.js:351-368` (время ·1000; `quiet` — место с наименьшим `playedAt`, при равенстве — меньший индекс; прыжок `R() < 0.35`); `var frogI: Int`, `var croakAt: Double`;
  - `mutating func reset()` — свои значения пусты; `goneAt`, `lastWave`, `noteAt / playedAt`, лягушка остаются.

- [ ] **Step 1: тесты** `NatStateTests` (зеркало по умолчанию — демо):
  - `testOwnPadNoLag`: `own(PLANT, 1, [4, 2], now: 1)` → `pad(1)` = `on, note 4, wave 2` при `now 1.1`, при `now 1.26` — зеркало (пусто); зеркало догнало при `1.05` → его, смена зеркала при `1.1` → новая. `PLANT` на занятое 0 — ничего.
  - `testOwnMove`: `own(MOVE, 0, [1])` → `pad(1).note == 2`, `pad(0).on == false`; `own(MOVE, 0, [2])` (занято) — ничего; `MOVE` то же место — ничего.
  - `testOwnLockChance`: `PLOCK 3 [1, 0.7]` → `lock[1] == 0.7`; `PUNLOCK 3 [1]` → `−1`; `PCHANCE 3 [0.6]` → `chanceV 0.6`; `PUNLOCK 3 [4]` → `chance −1`, `chanceV 1`; `PWAVE 3 [4]` → `lastWave 4`.
  - `testOwnScalars`: `LEN [5]`, `SETBPM [140]`, `PLAY [1]`, `SETFX 4 [0.9]` → свои; `CLEAR` → 16 пустых.
  - `testShake`: зеркало `0`; `own(SHAKEBY, 0, [0.5], now: 1)` → `shake(now 1) == 0.5`, `(now 1.2) == 0.5·e^(−0.2/1.4)`; при `now 1.3` — зеркало; два `SHAKEBY 0.7` → `1`.
  - `testPhase`: зеркало `phase 3.2, playing`, bpm 96 (`stepSec 0.15625`): `phase(mAt: 1, now: 1.05) == 3.2 + 0.32`; `now 2` → `4.2` (зажато 1); своё `PLAY [0]` → `nil`; зеркало `phase −1` → `nil`.
  - `testScareEnv`: `own(SCARE, …, now: 2)` → `envOpen(now: 5.9)`, не `envOpen(now: 6.1)`.
  - `testHeard`: `heard(2, 4, now: 3)` → `noteAt[4] == 3`; `heard(1, 0, now: 3)` → `playedAt[0] == 3`.
  - `testFrog`: R по зерну; демо — лягушка на самой молчаливой (`playedAt` все −1e9 → наименьший занятый индекс `0`); `playedAt[0] = now` и `R` → 0.1 после 8 с с посадки → прыжок (`air` в пределах 0.7 с), `frogI` — другое место; без кувшинок → `nil`; кувшинка лягушки убрана → новое место без прыжка.
  - `testReset`: после своих правок `reset()` → всё — зеркало; `goneAt`, `lastWave` целы.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner). **Step 5:** коммит `ios/app: Natura state - own values, phase, frog`.

**Ревью задачи:** нет.

### Task 4: `NaturaView` — мир, тик, плашка кувшинки, веер

**Files:**
- Create: `ios/app/T2D/Natura/NaturaView.swift`
- Test: `ios/app/T2DTests/NaturaTests.swift` (фейк `Core` — как в `InfernoTests.swift:1-8`)

**Interfaces:**
- Consumes: задачи 2–3; `World`, `Finger`, `SheetSpec / SheetRow`, `Core`, `LegendRow / Glyph`.
- Produces `final class NaturaView: World`:
  - `static let slotN = 4`; `init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil, rng: (() -> Double)? = nil)` (по умолчанию — `t2d_app_mirror / t2d_app_heard` слота 4 и системный ГСЧ, как `InfernoView.swift:51-57`; буферы 192 и 256); `theme = Worlds.info(4)`; `title "Natura"`, `sub "flumen · nymphaeae"`; `legend` — 10 строк `host/legend.js:25-31` (глифы по веб-строкам);
  - `func send(_ kind: Int, _ i: Int, _ a: [Double] = [])` — `core.action(kind, i, a, touchTime: 0)` и `state.own(kind, i, a, mirror:, now:)`; **единственный** путь действий мира;
  - чтение для картинки, касаний и тестов: `private(set) var geo: NatGeo`, `mirror: NatMirror`, `state: NatState`, `var scl: NatScale`; `func pad(_ i: Int) -> NatPad`, `var len: Int`, `var bpm: Double`, `var playing: Bool`, `func fxv(_ k: Int) -> Double`, `var shake: Double`, `var phase: Double?` — через `state.*` с `now`; `private(set) var now: Double`;
  - `fx: SheetSpec?` — веер `title "aether"`, `hint "FX — tap outside to close"`, строки `reverb, delay, time, chorus, chance` (`label` = ключ, `code` = индекс `fxKeys`), `lfo nil`, `get` — `fxv`, `set` → `send(SETFX, idx, [v])`, `text`: `time` → `Nat.div(v).name`, иначе `N%`; `arc: { fxv(0) }`;
  - `func lilySpec(_ i: Int) -> SheetSpec` — `view.js:302-327`: `title "lily \(i+1) · \(natNoteName(scl.noteHz(note)))"` (на момент открытия), `hint "( ) general · double tap — reset"`, строки `form/wave, cutoff/cutoff, res/res, att/attack, rel/release, chance/chance` (`code −1`), `lfo nil`, `obj: i`; `get / set / text / reset` — как в вебе, через `pad(i)` и `send` (`PWAVE round(v·4)` — только если сменился; `PCHANCE round(v·20)/20`; `PLOCK [k, v]`; после `set` — `HEAR i`, если не `playing` и с прошлого `HEAR` плашки > 0.26 с; reset: `chance` → `PUNLOCK [4]`, замки → `PUNLOCK [k]`, `form` — ничего); кувшинки нет — `set` ничего не шлёт;
  - `tick(now:dt:)`: зеркало → `mirror`, `mAt = now`; `heard` (до 4 чтений, как `InfernoView`) → `state.heard`; пропавшие кувшинки — `objGone(i)`, когда место `i` было занято на прошлом тике и пусто сейчас (по `pad(i)`); касаниям — `touchTick(now:)` (задача 5); `idle()` — слить `heard` без событий; `restored()` — `touchReset()` (задача 5), `state.reset()`; `scale(pcs:root:)` → `scl`; `layout` → `geo`; `cornerHit` — солнце: `y > S.y && hypot(f − S) < S.r + 6` в координатах сцены (`S = geo.sunAt(bpm:)`); `objs` — число занятых мест; `dice()` — `send(DICE)`, затем `send(PLAY, 0, [1])`, если не `playing`; `clear()` — `send(CLEAR)`;
  - `down / move / up / cancel` — пока пустые; `draw / drawShot` — пустые (план (б)).

- [ ] **Step 1: тесты** `NaturaTests` (`layout(W: 390, H: 844, topY: 50, safeBot: 34)`, фейковое зеркало — демо):
  - `testSendOwns`: `send(PLANT, 1, [4, 0])` → в фейке `(10, 1, [4, 0])`, `pad(1).on` сразу.
  - `testLilySheet`: `lilySpec(3)` (`note 5, wave 0`): `title == "lily 4 · " + natNoteName(110·2^(8/12))`, `obj == 3`, `lfo == nil`; `get("form") == 0`, `get("chance") == 1`, `get("cutoff") == 0.62`; `text("cutoff") == "(" + natHz(180·2^(0.62·6.6)) + ")"`; `set("cutoff", 0.4)` → `PLOCK 3 [0, 0.4]` и `HEAR 3`, `text` без скобок; второй `set` через 0.1 с — без `HEAR`; `set("form", 0.75)` → `PWAVE 3 [3]`; `set("form", 0.8)` (то же 3) — без `PWAVE`; `set("chance", 0.52)` → `PCHANCE 3 [0.5]`, `text("chance") == "50%"`; `reset("chance")` → `PUNLOCK 3 [4]`; `reset("cutoff")` → `PUNLOCK 3 [0]`; `reset("form")` — ничего; `text("att") == "(" + natMs(Nat.attOf(0.08)) + ")"`.
  - `testFan`: строки `reverb, delay, time, chorus, chance`, коды `0, 1, 2, 3, 8`, `lfo nil`; `set("chorus", 0.7)` → `SETFX 3 [0.7]`; `text("time")` при `0.5` → `"1/8d"`; `arc() == 0.4`.
  - `testHeard`: фейковый `heard` `[2, 5, 1, 5]` → `state.noteAt[5] == now`, `playedAt[5] == now`; `idle()` сливает без изменений `noteAt`.
  - `testObjGone`: `send(REMOVE, 3)` → `tick` → `objGone(3)` один раз; ещё `tick` — нет; зеркало без кувшинки 5 (отмена) → `objGone(5)`; `clear()` → по разу на каждую занятую.
  - `testDiceClear`: стоит → `dice()` → `DICE`, `PLAY [1]`; играет → только `DICE`; `clear()` → `CLEAR`, `pad(0).on == false` сразу.
  - `testCorner`: солнце `(13, 52, 70)`: `(40, 80)` → да; `(40, 40)` → нет (выше центра); `(120, 120)` → нет.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner). **Step 5:** коммит `ios/app: Natura view - state wiring, lily sheet, fan`.

**Ревью задачи:** нет.

### Task 5: `NatTouch` — касания, челнок, меню цветков

**Files:**
- Create: `ios/app/T2D/Natura/NatTouch.swift` (`extension NaturaView`; хранимые поля — в `NaturaView.swift`: пальцы, челнок, меню, след)
- Modify: `ios/app/T2D/Natura/NaturaView.swift` (убрать заглушки `down / move / up / cancel`, позвать `touchTick / touchReset`)
- Test: `ios/app/T2DTests/NatTouchTests.swift`

**Interfaces:**
- Consumes: задачи 2–4 (`send`, `pad`, `geo`, `state`, `openSheet`, `lilySpec`).
- Produces (`view.js:162-301, 330-337, 111-124`; координаты пальца — минус `geo.ox`):
  - палец `struct NatFinger { kind: none | skiff | pad | plant | boat | bridge | cloud | mountains | duckA | duckR | tree | birds; i: Int; frog: Bool; t0, x0, y0, x, y, lx, ly: Double; v0: Double /* fx или bpm в начале */; moved, cycled: Bool; path: [(Double, Double)] (ёмкость 64); hist: кольцо 8 (x, y, t) }`, словарь по `Finger.id`;
  - челнок `struct NatSkiff { x, y, dx, dy: Double; held, home: Bool; onRiver: Bool; fly: (x0, y0, x1, y1, t0, dur)?; back: (x, y, t0)?; label: String }`, `var skiff: NatSkiff` (картинка читает); меню `struct NatMenu { x, y: Double; held: Bool; hover: Int; owner: ObjectIdentifier? }`, `var menu: NatMenu?`; `func menuOpts() -> [(x: Double, y: Double)]` (`view.js:331-334`), `func menuHit(_ x: Double, _ y: Double) -> Int`; след воды `var wake: (path, at)?`, всплеск `var splash: (x, y, t0)?`; `var frogAt: (x: Double, y: Double, i: Int)?` — ставит тик из `state.frog` (для попадания);
  - `down / move / up / cancel` — порядок попаданий и действия `view.js:180-291` и таблица разведки §3; действия — только `send`: тап по воде → `PLANT i [note, lastWave]` + `HEAR i`; тап по кувшинке → `REMOVE i`; по лягушке → `CROAK [note]` (и `state.croakAt`); перенос → `MOVE i [j]` (если `j` свободно) и `NOTE j [n]` + `HEAR j` при смене ноты; рисование → `PGLIDE` (`on = !все glide`, `view.js:277-286`, `model.js:97-100`); пристань: тап → `PLAY [!playing]`, вбок → `SETBPM [round(clamp(bpm0 + dx/2, 40, 200))]`; плотина → `LEN [clamp(slotOf(t + 0.02) + 1, 2, 16)]`; облако → `SETFX 4 [clamp(v0 − dy/220)]`, горы → `SETFX 5 [clamp(v0 − dy/160)]`, утки → `SETFX 6 / 7 [clamp(v0 − dy/160)]`; дерево → `SHAKEBY [hypot/260]`; птицы тап → `LASER`; челнок: на реке → `SKIFF 0 [q, t, lastWave]`, иначе `SKIFF_OFF` (на каждом сдвиге, как веб), `up` — бросок (`view.js:256-270`) или домой; меню: выбор → `WAVE [k]`;
  - `func touchTick(now: Double)` — удержание 420 мс (`view.js:292-301`: кувшинка → `openSheet(lilySpec(i))`; челнок у берега → меню), полёт челнока (по прилёту — `splash`, `send(SCARE)`, `back` через 0.6 с) и возврат домой за 1.2 с (`e = 1 − (1−k)³`), лягушка → `frogAt`; утки на попадание — `!(state.goneAt` и `now − goneAt < 4)`;
  - `func touchReset()` — для `restored()`: челнок на воде → `SKIFF_OFF` один раз; пальцы, меню, полёт, след забыты, челнок дома.

- [ ] **Step 1: тесты** `NatTouchTests` (геометрия — как задача 4; точки — `geo.padXY / slotT`, `geo.pier()`, `geo.skiffHome()`, `geo.cloud`, `geo.crown()`, `geo.ducks`, `geo.pond()`; время — `tick(now:)` и `Finger.t0`):
  - `testTapWaterPlants`: тап по `padXY(1, 10)` (место 1 пусто) → `PLANT 1 [10, 0]`, `HEAR 1`; после `pickWave` 3 (меню) — `PLANT … [n, 3]`.
  - `testTapLilyRemoves`: тап по `padXY(2, 7)` → `REMOVE 2`; удержание 0.43 с → плашка `lily 3 · …`, без `REMOVE` на `up`.
  - `testDragLilyNote`: кувшинка 2 тянется поперёк до `note 10` → `NOTE 2 [10]` и `HEAR 2` (на каждой смене ноты); сдвиг < 8 px — ничего.
  - `testMoveSkipsBusy`: кувшинка 3 вдоль через место 5 (занято) на 7 → нет `MOVE 3 [5]`, есть `MOVE 3 [7]`, следующие `NOTE` — месту 7; `pad(5)` цел.
  - `testGlideDraw`: путь по воде через кувшинки 5 и 6 → `PGLIDE 5 [1]`, `PGLIDE 6 [1]`; второй такой путь → `[0]`.
  - `testPier`: тап → `PLAY [1]`; вбок на 40 px → `SETBPM [116]`, без `PLAY`.
  - `testWeirCloudMountainsDucksTree`: плотина к месту 5 → `LEN [6]`; облако вверх 60 → `SETFX 4 [clamp(0.62 + 60/220)]`; горы `(60, hor − 20)` вверх 60 → `SETFX 5`; утка A вверх 50 → `SETFX 6 [0.08 + 50/160]`; утка R → `SETFX 7`; дерево — сдвиг 26 px → `SHAKEBY [0.1]`; птицы (`chorus 0.8`, точка из `geo.birds`) тап → `LASER`.
  - `testFrogCroak`: тап по `frogAt` → `CROAK [note]`, без `REMOVE`; сдвиг лягушки → `NOTE` её кувшинки.
  - `testSkiffOnRiver`: челнок дома → тянуть на `padXY(8, 3)` → `SKIFF 0 [q, t, 0]` (q, t — `onRiver`), назад на берег → `SKIFF_OFF`; `up` медленно вне пруда → `back`, через 1.3 с `skiff.home`.
  - `testSkiffThrow`: быстрый бросок к пруду (история 4 точек за 60 мс, `|v| > 0.35`) → `fly`; `tick` после `dur` → `SCARE`, `state.envOpen`; утки до 4 с не ловят касание.
  - `testThrowWhileGone`: после `SCARE` второй бросок в пруд → без `fly`, без `SCARE`, плывёт домой.
  - `testSkiffMenu`: челнок держат 0.43 с без сдвига → `menu` (`held`); `up` над цветком 2 → `WAVE [2]`, `lastWave 2`, меню закрыто; `up` мимо → меню ждёт; тап по цветку 4 → `WAVE [4]`; тап мимо → закрыто, ничего.
  - `testTwoFingers`: два пальца тянут кувшинки 0 и 8 поперёк → `NOTE 0` и `NOTE 8`, не путаются.
  - `testRestoredMidGesture`: палец на кувшинке, челнок на воде, второй — меню; `restored()` → одно `SKIFF_OFF`; `menu == nil`; `skiff.home`; `move / up` всех пальцев — ни одного действия.
  - `testCancel`: `cancel` пальца на челноке на воде → `SKIFF_OFF`, челнок домой; пальца на кувшинке — ничего (без `REMOVE`).
  - `testIPadShift`: `layout(W: 1024, H: 1366, topY: 24, safeBot: 20)`: тап по `padXY(1, 10)` + `ox` → `PLANT 1 [10, …]`.
- [ ] **Step 2:** падают. **Step 3:** реализация (перенос `view.js` построчно, пороги и формулы — оттуда; своих не вводить). **Step 4:** зелёные (test-runner). **Step 5:** коммит `ios/app: Natura touches - lilies, skiff throw, flower menu`.

**Ревью задачи:** да (касания).

---

**Дальше — план (б)** (`docs/superpowers/plans/2026-10-31-ios-natura-b.md`, пишется после (а)): `NatScene` (кеши бумаги и земли с LCG), `NatDraw` (кадр), включение на карте, сцены `natura*`, снимки против веба, финальное ревью всей ветки (opus), доки, `CACHE`, пуш.

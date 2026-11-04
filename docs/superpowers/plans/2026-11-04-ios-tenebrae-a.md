# iOS фаза 4, шаг В — Tenebrae на Swift, план (а): ядро, чистый слой, связка, касания

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** логика I · Tenebrae на Swift без картинки: охрана действий в ядре, поле и зум, таблицы волн, разбор зеркала и `heard`, состояние голосов (`pick`, свои значения), связка мира (тик, кубик, корзина, отмена, лад, веер `aether`, солнце-угол), касания (палец, тяга, двойной тап, удержание, щипок), мост и кольцо связи, плашка планеты с LFO модели. Картинка, сцены и включение на карте — план (б).

**Architecture:** модель и звук — в ядре (`core/worlds/tenebrae/`, слот 1, действия 16–36). Swift разбирает зеркало (387 / 1161) и `heard` (`[1, i]`, `[2, i, p]`) и шлёт действия через одну обёртку `send(kind, i, a, touchTime:)` в `TenebraeView`: она зовёт `core.action` и отдаёт то же действие `TenState.own(…)`, который держит свои значения до зеркала (0.25 с или сходимость) и повторяет синхронные ответы фасада (`pick`, `pin`, `dice`). Мир: `ios/app/T2D/Tenebrae/` — `TenMath`, `TenMirror`, `TenState`, `TenebraeView`, `TenTouch`, `TenLink`, `TenSheet` (все касания — `extension TenebraeView`); `ios/app/T2D/Waves.swift` — общие таблицы волн.

**Tech Stack:** C++17 (ядро, задача 0), Swift 5 + UIKit, XCTest, XcodeGen.

**Spec:** `docs/superpowers/specs/2026-11-04-ios-tenebrae-design.md` — читать целиком перед любой задачей. Разведка — `~/.claude/handoff/tenebrae-map.md` (веб-вид с номерами строк `app.js`), `~/.claude/handoff/tenebrae-native-map.md` (ядро, мост, образцы Swift). Веб-источник истины — `app.js` (Tenebrae-часть, номера в карте §1 и §3), `worlds/tenebrae/model.js` (фасад: `pick :78-88`, `spawn :91-103`, `letGo :109-116`, `pin :140-154`, `dice :221`), `worlds/tenebrae/tone.js` (`quantX :14`, `freqOf :26`, `cutoffOf :32`, `shiftHz :36`), `host/waves.js`, `host/sheet.js:10-15`, `host/legend.js:11-14`. Ядро: `core/worlds/tenebrae/world.hpp:9-53`, `world.cpp:124-162, 307-347`, `model.cpp:86-99, 162-180, 334-362`. Образец Swift — `ios/app/T2D/Cymatica/` и `T2DTests/Cym*Tests.swift`, фейк `Core` и читатели — `T2DTests/PortusTests.swift:4-21`.

## Global Constraints

- Ветка `native`; ветку не менять. Коммиты — по-английски, тело-список, последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `notebooks/*`, `.superpowers/` не коммитить.
- Ядро меняется **только в задаче 0** (`core/worlds/tenebrae/world.cpp`, `core/tests/sdk_test.cpp`, `t2d.wasm`, версия). `app.js`, `worlds/tenebrae/*` не трогать (миры заморожены).
- Выкладка (хук `.claude/hooks/guard.py` на commit / push): `CACHE` в `sw.js` = `?v=` в `index.html` — в задаче 0 `t2d-v217 / ?v=217 → t2d-v218 / ?v=218` (все вхождения `?v=` в `index.html`); `t2d.wasm` — в том же коммите, что правка `core/`.
- Swift: новые файлы в `T2D/` попадают в `T2D` сами, в `T2DTests` — через `project.yml:60` (добавить `T2D/Tenebrae` после `T2D/Cymatica`, задача 1); после — `xcodegen` в `ios/app`. Комментарии — по-русски, как в `Cymatica/`. Округление как в JS (`Math.round`) — `Horo.jsRound`.
- Тесты Swift — через агента test-runner: `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|failed|passed|SUCCEEDED|FAILED" | tail -30` → `** TEST SUCCEEDED **`. Ядро — `core/build.sh && core/build/sdk-test` → `0 failed`. **Тест пишется раньше кода и сначала падает** — красный прогон обязателен до реализации.
- Эталонные числа тестов `TenMath` — из формул `app.js` в node: скопировать нужные функции (`arcSpan`, `buildGeo`, `rOfP / pOfR`, `place / unplace`, `holeDepth`, `outOfHole`, `zoomDef`, нормы строк, `valueText`) в скрипт scratchpad, посчитать, вписать числа в тест (±1e-6). Скрипт в репозиторий не кладём.
- Мир в плане (а) на карте не включён (`Worlds.swift` — `view: false`); `draw / drawShot` пустые; состояние картинки (волны, удары, отказ, призрак, подписи) — только поля, которые читает план (б).
- Константы (`app.js:31-93`, `model.hpp:16-26`): слот 1; `VOICES 6, PIN_MAX 3, TEMP_MAX 3, LINK_NEW 0.5`; `BEAT 0.05…24` (умолч. 0.35), `CUT 0.68, RES 0.21, WAVE 0.125, SHIFT 0.5, FM 0, AMP 1`; `LFO_DEF {morph 0, rate 1.2, depth 0.35}`, частота LFO `0.03…20`; `F_LO 55, SEMIS 60, WARP 1.45, CUT 40…18000`; `GRAB_R 52, HANDLE_R 24, PIN_R 17, GHOST 1.6 с, HOLE_R 84, SUN_R 100, EDGE 26, EDGE_T 64`; солнце-угол `r 46`, удар солнца `t = clamp((124 − d)/70)`; зум `0.35…1`, `ZOOM_DEF = 0.8^(1/1.45)`; `MENU_SPAN = max(90, min(150, min(W, H)/2 − 74))`; пороги касаний `TAP 0.22 с, TAP_MOVE 14, DTAP 0.32 с, HOLD 0.42 с, HOLD_MOVE 10`, «сдвинут» — от 10 px от `(x0, y0)`, свой порог; щипок — второй палец в 0.25 с, `|Δd| > 26` за 0.7 с; мост — отпускание при глубине `< 0.06` → `UNLINK`; LFO — снять при `depth < 0.03`.
- Действия ядра (`world.hpp:15-26`): `SPAWN 16 i [p, c, holeT]`, `GRAB 17 i`, `LETGO 18 i [fade]`, `KEEP 19 0 [i…]`, `UNKEEP 20`, `MOVE 21 i [p, c, holeT]`, `SUN 22 i [t]`, `SET 23 i [key, v]` (key 0 wave, 1 cut, 2 res, 3 beat, 4 fm, 5 shift, 6 amp), `PIN 24 i`, `ATTACK 26 i`, `RELEASE 27 i [τ]`, `LINK 28 dst [src]`, `LINKDEPTH 29 dst [src, d]`, `LINKTYPE 30 dst [src, type]` (0 fm, 1 tzfm, 2 am, 3 rm), `UNLINK 31 dst [src]`, `SETLFO 32 i [key, morph, rate, depth]` (key 0 pitch, 1 wave, 2 cut, 3 res, 4 beat, 5 shift, 6 amp, 7 fm; depth < 0 — снять), `SETFX 33 0 [rev, decay, dly, chaos, dirt]`, `DICE 34`, `WIPE 35`. `REMOVE 25`, `RETUNE 36`, коды 0–8 натив не шлёт.
- Зеркало: заголовок 15 — `[0]` 6, `[1]` time, `[2]` strikes, `[3…7]` rev, decay, dly, chaos, dirt, `[8]` nkept, `[9…14]` kept (−1 пусто); голос с `15 + 62·i`: `[0…16]` active, live, pinned, held, x, y, beat, wave, fm, cut, res, shift, amp, holeT, sunT, env, envT; `[17]` число связей, `[18…37]` 5 × (src, type, depth, auto), `[38…61]` 8 × (morph, rate, depth), depth −1 — нет LFO. Контуры с 387, по 129 (live + 128 точек), только при длине 1161. Буфер зеркала 2048, `heard` — 256.
- **Решено без автора** — спека, раздел «Решено без автора» (шесть пунктов).

## Review Focus

1. **Отмена или корзина посреди жеста** — `restored()` при пальце на планете, в мосте, в щипке, на кольце связи, на строке плашки: последующие `move / up` ничего не шлют, плашка и кольца закрыты. Тесты — задача 4 (`testRestoredMidDrag`, `testRestoredMidPinch`), задача 5 (`testRestoredMidRing`), задача 6 (`testRestoredMidRow`).
2. **Голосов нет** — 3 закреплённых + 3 удерживаемых / не затухающих: касание по пустому — `pick() == −1`, `SPAWN` не уходит, отказ на поле; второй палец по пустому тогда же — тоже ничего. Тест — задача 4 (`testSpawnFull`).
3. **Планета пропала под пальцем** (ядро погасило её в дыре — `holeT > 0.9`, или зеркало показало `active 0`) — тяга дальше не шлёт `MOVE` по чужому голосу, отпускание не шлёт `PIN` / `LETGO` по освободившемуся и заново занятому индексу; плашка и кольцо этой планеты закрываются. Тесты — задача 4 (`testVoiceGoneMidDrag`), задача 6 (`testSheetClosesWhenGone`).
4. **Плохое зеркало и `heard`** (короче 387, `[0] ≠ 6`, NaN, длина между 387 и 1161, индекс вне 0…5, хвост записи обрезан) — не падает, годное учтено, прежнее зеркало цело. Тесты — задача 1 (`testMirrorBad`, `testHeardBad`).
5. **Двойной тап, совпавший с удержанием и щипком** — второй тап после 0.32 с — не двойной; тап, открывший плашку удержанием, на `up` не шлёт `PIN` и `LETGO` с `fade`; палец пары щипка на `up` не закрепляет. Тест — задача 4 (`testTapEdges`).

---

### Task 0: Ядро — охрана действий, тест `pick()`, wasm

Риск: высокий — C++ ядра в аудиопотоке, недоверенный ввод из Swift.

**Files:**
- Modify: `core/worlds/tenebrae/world.cpp:124-127` (`World::action`)
- Modify: `core/tests/sdk_test.cpp` (новые функции рядом с `tenebraeMirror` `:2524`, вызов в `main` `:3917`)
- Modify: `t2d.wasm` (пересборка), `sw.js:4`, `index.html` (`?v=`)

**Interfaces:**
- Produces: `World::action` для `kind ≥ SPAWN (16)` отбрасывает действие, если хоть одно `a[0..n)` не конечно (`std::isfinite`); коды 0–8 — как раньше. Swift (задачи 1–6) полагается на то, что NaN из жеста не доходит до модели.

- [ ] **Step 1: тесты** в `sdk_test.cpp`:
  - `tenebraeModelPick()`: пустая модель — `pick() == 0`; три временных (`spawn` 0–2, `active`, не pinned) — `pick() == −1`, если все `held` или `envT != 0`; среди трёх затухающих (`letGo` с fade, `envT == 0`) — индекс самого тихого (`env` наименьший); затухающий, но `held` / `pinned` / в `kept` — не выбирается; три закреплённых + свободный индекс — `pick()` = первый неактивный. Доступ к `env / envT` — через существующие пути (рендер `tenebraeRender`), как соседние тесты.
  - `tenebraeActionNan()`: `SPAWN 0 [NaN, 0.5, 0]` — голос 0 не активен; `MOVE`, `SET 0 [1, NaN]`, `SETLFO 0 [2, 0, NaN, 0.5]`, `LINKDEPTH`, `SUN [inf]`, `SETFX` с NaN — состояние модели (зеркало `mirror()` до и после) не изменилось; `SPAWN 0 [0.5, 0.5, 0]` после — работает.
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` — новые тесты падают (NaN проходит в модель).
- [ ] **Step 3:** охрана в `World::action` — после `retune()` и ветки `kind <= CLEAR`, до проверки индекса.
- [ ] **Step 4:** `core/build.sh && core/build/sdk-test` → `0 failed`; `node --test tools/test-models.mjs tools/models/*.test.mjs` — зелёные (паритет `tenebrae-parity`).
- [ ] **Step 5:** версия `v218` (`sw.js` `CACHE`, все `?v=` в `index.html`); коммит `core: tenebrae action NaN guard, pick() test, v218` с `t2d.wasm`.

**Ревью задачи:** `sonnet` полное (спека + качество).

### Task 1: Чистый слой — `TenMath`, `Waves`, `TenMirror`

Риск: обычный — чистые функции под тестами.

**Files:**
- Create: `ios/app/T2D/Tenebrae/TenMath.swift`, `ios/app/T2D/Tenebrae/TenMirror.swift`, `ios/app/T2D/Waves.swift`
- Modify: `ios/app/project.yml:60` (`T2D/Tenebrae` после `T2D/Cymatica`; `T2D/Waves.swift`, если источники теста перечислены файлами)
- Test: `ios/app/T2DTests/TenMathTests.swift`, `ios/app/T2DTests/WavesTests.swift`

**Interfaces:**
- Produces:
  - `enum Ten` — константы Global Constraints (`slot = 1, voices = 6, pinMax = 3, tempMax = 3, linkNew = 0.5, beatMin = 0.05, beatMax = 24, …, zoomMin = 0.35, zoomDef = pow(0.8, 1/1.45), mirrorN = 387, mirrorFull = 1161, head = 15, voiceN = 62, scopeN = 129`); `enum Act { static let spawn = 16, grab = 17, letGo = 18, keep = 19, unkeep = 20, move = 21, sun = 22, set = 23, pin = 24, attack = 26, release = 27, link = 28, linkDepth = 29, linkType = 30, unlink = 31, setLfo = 32, setFx = 33, dice = 34, wipe = 35 }`; `enum Row: Int, CaseIterable { case wave = 0, cut, res, beat, fm, shift, amp }` (ключи `SET`); `enum LfoKey: Int { case pitch = 0, wave, cut, res, beat, shift, amp, fm }`; `static let rowDef: [Row: Double]` (`app.js:555`: cut 0.68, res 0.21, wave 0.125, shift 0.5, beat 0.35, fm 0, amp 1); `static let linkTypes = ["fm", "tzfm", "am", "rm"]`.
  - `struct TenGeo` — `init(W: Double, H: Double, topY: Double, safeBot: Double)` (`top = topY − 56`, `bot = H − safeBot − 4`, начало `(0, bot)`; `buildGeo app.js:145`); поля `W, H, top, bot, ox, oy, a` (площадь дуг); `func arcSpan(_ r: Double) -> (lo: Double, hi: Double)?` (`:138`, `nil` при `r ≤ 100` или пустой дуге); `func rOfP(_ p: Double) -> Double`, `func pOfR(_ r: Double) -> Double`; `func place(_ p: Double, _ c: Double, zoom: Double) -> (x: Double, y: Double)`; `func unplace(_ x: Double, _ y: Double, zoom: Double) -> (p: Double, c: Double)`; `func rAt(_ p: Double, zoom: Double) -> Double` (∞ за горизонтом); `var holeAt: (x: Double, y: Double)` (`(0, top + 64)`); `func holeDepth(_ x: Double, _ y: Double) -> Double` (`:126`); `func outOfHole(_ x: Double, _ y: Double) -> (x: Double, y: Double)` (`:131`); `var zoomDef: Double` (`:175`); `var menuSpan: Double`.
  - Звук для вида (`tone.js`): `func tenSemi(_ dx: Double) -> Double`, `func tenXOf(_ semi: Double) -> Double`, `func tenFreq(_ dx: Double) -> Double`, `func tenCutoff(_ v: Double) -> Double`, `func tenShiftHz(_ v: Double) -> Double`, `func tenQuantX(_ dx: Double, pcs: [Int]?, root: Int) -> Double`.
  - Нормы строк (`app.js:189-228, :553-561`): `func tenNorm(_ r: Row, _ v: Double) -> Double`, `func tenSetNorm(_ r: Row, _ t: Double) -> Double` (shift — защёлка 0.5 ± 0.02, beat — лог 0.05…24; amp — лог 0.05…1.8, `t ≤ 0.005 → 0`, |дБ| < 0.6 → 1), `func tenValueText(_ r: Row, _ v: Double) -> String` (`:1252`, amp — `ampText :561`).
  - `Waves.swift`: `enum Waves { static let labels: [String]` (9, порядок `host/waves.js`); `static let samp: [[Float]]` (9 × 1024, нормированные: минус среднее, деление на пик); `static func weight(_ i: Int, _ p: Double) -> Double`; `static func morph(_ p: Double, _ t: Double) -> Double` (= `morphFn(p)(t)`); `static func morphName(_ p: Double) -> String` (`"a → b"` между, края 0.08 / 0.92) }`. `GRAIN` — LCG 16807 зерно 11, 40 точек.
  - `TenMirror.swift`: `struct TenMod: Equatable { var src: Int; var type: Int; var depth: Double; var auto: Bool }`; `struct TenLfo: Equatable { var morph, rate, depth: Double }`; `struct TenVoiceM { var active, live, pinned, held: Bool; var x, y, beat, wave, fm, cut, res, shift, amp, holeT, sunT, env, envT: Double; var mods: [TenMod]; var lfo: [TenLfo?]` (8) `}`; `struct TenMirror { var time = 0.0, strikes = 0; var fx = [0.3, 3.5, 0.3, 0, 0.2]; var kept: [Int] = []; var v: [TenVoiceM]` (6, неактивные); `var scope: [[Float]]?` (6 × 128 или `nil`); `var scopeLive: [Bool]`; `mutating func load(_ b: [Double], n: Int) -> Bool }` — `n < 387` или `b[0] != 6` → `false`, прежнее цело; не конечное поле — поле прежнее; `src` вне 0…5 или `type` вне 0…3 — связь пропущена; `n ≥ 1161` → контуры, иначе `scope = nil`. Буферы предвыделены (без аллокаций на кадр, кроме первого).
  - `enum TenHeard: Equatable { case flash(Int), strike(Int, Double) }`; `func tenHeard(_ b: [Double], n: Int, into out: inout [TenHeard])` — `[1, i]` → `flash`, `[2, i, p]` → `strike`; `i` вне 0…5 или не конечное — запись пропущена; неизвестный вид или обрезанный хвост — стоп.

- [ ] **Step 1: тесты.** `TenMathTests`: `testGeo` (`TenGeo(W: 390, H: 844, topY: 103, safeBot: 34)` и iPad `(1024, 1366, 68, 20)` — `top, bot, a, zoomDef, menuSpan` по node); `testArcSpan` (`r 90 → nil`, `r 200, 400, 700` — `lo, hi`); `testPlaceRoundTrip` (сетка `p ∈ {0.05, 0.3, 0.7, 1}`, `c ∈ {0, 0.5, 1}`, `zoom ∈ {0.35, 0.857, 1}` — `unplace(place) == (p, c)` ±1e-6; три точки — числа node); `testRAtHorizon` (`p > zoom` — `.infinity`); `testHole` (`holeDepth` в центре дыры, на краю 84, у края поля, далеко — числа node; `outOfHole` из центра — точка на границе); `testTone` (`tenFreq(0) == 55`, `tenFreq(1)` по node, `tenCutoff(0) == 40`, `tenCutoff(1) == 18000`, `tenQuantX` с минором); `testNorms` (туда-обратно для каждой `Row`; shift `0.51 → 0.5`; beat `t 0 → 0.05`, `t 1 → 24`; amp `t 0.004 → 0`, `t` при −0.4 дБ → 1; `tenValueText` для 3 значений каждой строки — строки node). `WavesTests`: `testLabels` (`triangle … grain`); `testSamp` (по каждой таблице `samp[i][0], [256], [512], [777]` — числа node, ±1e-5; max |samp| == 1); `testMorph` (`morph(0, 0.3) == samp[0][307]`, `morph(0.0625, 0.3)` — смесь 0.5 / 0.5 таблиц 0 и 1; `morphName(0) == "triangle"`, `morphName(1) == "grain"`, `morphName(0.0625) == "triangle → sharp"`). `testMirror` (буфер 1161 с меткой на каждом смещении → поля по раскладке Global Constraints; `kept` из `[8]` и `[9…]`; 2 связи, LFO ключа 2 с depth 0.4, прочие `nil`; контур голоса 3 — `scope[3][5] == b[387 + 3·129 + 1 + 5]`); `testMirrorBad` (`n 386 → false`, прежнее цело; `b[0] = 5 → false`; NaN в `x` голоса 2 — `x` прежний, прочее обновлено; `n 700` — модель есть, `scope == nil`; `src 9` — связь пропущена); `testHeard` (`[1, 2, 2, 4, 0.7]` → `[.flash(2), .strike(4, 0.7)]`); `testHeardBad` (`[1, 7]` → пусто, `[2, 1]` → пусто (хвост), `[5, 1, 1]` → пусто, `[1, .nan, 1, 3]` → `[.flash(3)]`).
- [ ] **Step 2:** падают (нет типов).
- [ ] **Step 3:** реализация по Interfaces; `xcodegen`.
- [ ] **Step 4:** зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Tenebrae field math, shared wave tables, mirror and heard parsing`.

**Ревью задачи:** `haiku` — только соответствие спеке, качество кода не оценивается.

### Task 2: Чистый слой — `TenState`

Риск: обычный — чистая логика под тестами.

**Files:**
- Create: `ios/app/T2D/Tenebrae/TenState.swift`
- Test: `ios/app/T2DTests/TenStateTests.swift`

**Interfaces:**
- Consumes: задача 1.
- Produces `struct TenState` (время — секунды, аргумент; `ttl = 0.25`):
  - `mutating func own(_ kind: Int, _ i: Int, _ a: [Double], mirror: TenMirror, now: Double)` — своё значение по действию поверх текущих (своих или зеркала), правила фасада `model.js`: `SPAWN` (active, held 0, x / y / holeT, умолчания строк, связи и LFO голоса `i` сняты, и связи других с источником `i`, pinned false), `GRAB` (held +1), `LETGO` (held −1, не ниже 0), `KEEP [i…]` / `UNKEEP` (kept), `MOVE` (x, y, holeT), `SET [key, v]`, `PIN` (по `pinResult`), `LINK [src]` (новая `tzfm 0.5`, не auto, если связи `src → i` нет), `LINKDEPTH`, `LINKTYPE`, `UNLINK`, `SETLFO` (depth < 0 — снять), `SETFX`; прочие — ничего.
  - Чтение (своё, пока `≠` зеркала и `now − t < ttl`, иначе зеркало): `func voice(_ i: Int, mirror: TenMirror, now: Double) -> TenVoiceM` (поля `x, y, holeT, beat … amp, pinned, held, mods, lfo` — свои; `active, live, env, envT, sunT` — всегда зеркала), `func kept(mirror:now:) -> [Int]`, `func fx(mirror:now:) -> [Double]`.
  - Синхронные ответы фасада по текущему виду (свои + зеркало): `func pick(mirror: TenMirror, now: Double) -> Int` (`model.cpp:86-99` дословно); `enum PinResult { case pinned, unpinned, full, none }`, `func pinResult(_ i: Int, mirror:now:) -> PinResult` (`model.cpp:162-180`: неактивный — `none`; закреплён — `unpinned`; закреплённых активных ≥ 3 — `full`); `func anyLive(mirror:now:) -> Bool` (`active && envT > 0`, `model.cpp:336`).
  - `mutating func reset()` — забыть свои значения (после `restored()`).

- [ ] **Step 1: тесты** `TenStateTests` (зеркало собирается помощником теста из `TenVoiceM`):
  - `testOwnNoLag`: `own(MOVE, 2, [0.4, 0.6, 0.1])` → `voice(2).x == 0.4` сразу, при зеркале со старым `x`; через 0.26 с — зеркало; сошлось с зеркалом раньше — зеркало (дальше правка зеркала видна сразу).
  - `testSpawnResets`: у голоса 1 связь от 3 и LFO; у голоса 4 связь от 1; `own(SPAWN, 1, [0.5, 0.5, 0])` → у 1 нет связей и LFO, `cut == 0.68`, `amp == 1`, `pinned == false`; у 4 связи от 1 нет.
  - `testPick` — тот же набор, что `tenebraeModelPick` задачи 0 (пусто → 0; три временных held → −1; самый тихий затухающий; held / pinned / kept не вытесняются; три закреплённых → первый неактивный).
  - `testPinResult`: неактивный → `none`; закреплённый → `unpinned`; 3 закреплённых, четвёртый → `full`; 2 закреплённых → `pinned`; своё `pinned` после `own(PIN)` учитывается сразу (второй `PIN` того же — `unpinned`).
  - `testLinkOwn`: `own(LINK, 0, [3])` → `mods == [TenMod(src: 3, type: 1, depth: 0.5, auto: false)]`; `LINKDEPTH [3, 0.8]`, `LINKTYPE [3, 2]`, `UNLINK [3]` — сразу; повторный `LINK` при существующей — без дубля.
  - `testLfoOwn`: `own(SETLFO, 2, [2, 0, 1.2, 0.35])` → `lfo[2] == TenLfo(0, 1.2, 0.35)`; `[2, 0, 0, −1]` → `nil`.
  - `testAnyLive`, `testFxOwn`, `testKeepOwn`, `testReset`.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Tenebrae state - own values, pick, pin result`.

**Ревью задачи:** `haiku` — только соответствие спеке.

### Task 3: `TenebraeView` — мир, тик, кубик, отмена, веер, солнце-угол; порядок хоста

Риск: обычный — связка под тестами на фейке.

**Files:**
- Create: `ios/app/T2D/Tenebrae/TenebraeView.swift`, `ios/app/T2D/Tenebrae/TenTouch.swift` (пока — пустые `down / move / up / cancel / touchTick / touchReset`)
- Modify: `ios/app/T2D/Host/Host.swift:257-259` (`cornerHit` раньше полосы `x < Host.edgeW`), `ios/app/T2D/App.swift:42-58` (`makeView` — ветка `TenebraeView.slotN`; мир на карте ещё не виден — `view: false`)
- Test: `ios/app/T2DTests/TenebraeTests.swift`, тест порядка хоста — в существующем тесте `Host` (найти файл с `route` / `.edge`; если тестов маршрута нет — `HostRouteTests.swift` с миром-фейком, у которого `cornerHit` = круг r 46 в `(0, bot)`)

**Interfaces:**
- Consumes: задачи 1–2; `World`, `Finger`, `SheetSpec`, `Core`, `LegendRow / Glyph`, `Worlds.info`.
- Produces `final class TenebraeView: World`:
  - `static let slotN = 1`; `typealias Reader = (inout [Double]) -> Int`; `init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil, readLevel: (() -> Double)? = nil, rng: (() -> Double)? = nil)` (буферы 2048 и 256; `readLevel` по умолчанию — √Σ `lv²` из `t2d_app_levels`; `rng` по умолчанию — системный, в тестах и сценах — фиксированный); `title "Tenebrae"`, `sub "orbes · strepitus"`, `theme = Worlds.info(1)`; `legend` — 8 строк `host/legend.js:11-14` дословно (глифы `tap, drag, double, hold, two, pinch, drag, tap`);
  - `func send(_ kind: Int, _ i: Int = 0, _ a: [Double] = [], touchTime: Double = 0)` — **единственный** путь действий мира: `core.action` + `state.own(…, mirror:, now:)`;
  - чтение для касаний и картинки: `private(set) var mirror`, `state`, `geo: TenGeo`, `now`; `func voice(_ i: Int) -> TenVoiceM`; `var zoom` (сглаженный) и `var zoomT` (цель), `zoomShow` (до какого времени видна подпись); `struct TenVW { var dx = 0.0, wob = 0.0, wv = 0.0, hole = 0.0; var ph = [Double](8), vph = [Double](8) }`, `var vw = [TenVW](6)` (вид голоса, `solTick :1857-1904`); `var waves: [(x, y, r, a, sp, dash: Bool)]` (≤ 60), `var strikes: [(i: Int, t0: Double, p: Double)]`, `var sunLevel = 0.0` — поля для плана (б);
  - `fx: SheetSpec?` — `title "aether"`, `hint "FX — tap outside to close"`, строки `hall, decay, delay, chaos, drive` (`FX_SECTORS app.js:87-93`, код −1), `lfo nil`, без reset; `get / set / text` — `app.js:830-840` (decay — `invLog / lerpLog 0.6…14`), `set` → `SETFX 0 [5 чисел]`; `arc: { fx[0] }`;
  - `tick(now:dt:)` (`dt ≤ 0.05`): зеркало → `mirror` (отказ — прежнее); `heard` до 4 чтений, пока буфер полон → волна `flash` (две за тик у одного `i` — одна, `burst :298`: `r 36, a 1.6, sp 420`) и `strike`; `sunLevel` (×2.2, сглаживание 0.08); зум τ 0.06 с; `vw` (`dx → soundX` τ 0.07 при ладе или `now < slideUntil`, иначе `x`; фазы LFO `ph += dt·rate`, `vph += dt·min(rate, 2.5)`; `wob`, `wv`; `hole → holeT` τ 0.15); волны живых планет (`:1911-1936`) — только поля; `touchTick(now:)`;
  - `idle()` — слить `heard` без событий; `enter()` — кеш `sunT` сброшен; `restored()` — `touchReset()`, `state.reset()`, кеш `sunT`, `vw` из зеркала, фазы LFO заново; `scale(pcs:root:)` → лад, `slideUntil = now + 0.5`; `layout` → `geo`, `zoomT = geo.zoomDef`, если размер сменился (ручной зум держится до смены размера); `cornerHit(x, y)` — `hypot(x − 0, y − geo.bot) < 46` и плашки планеты нет (`sheet == nil`, задача 6; до неё — всегда); `objs` — число активных;
  - `dice()`: `state.anyLive` — да: `send(DICE)`; нет: точка `place(…)` по `rollDice :513` (аргументы `0.08 + 0.75·rng()`, `0.1 + 0.6·rng()` с зумом — как в вебе), дальше путь `spawnAt` (`unplace`, `holeDepth`, `pick`): `i ≥ 0` → `send(SPAWN, i, [p, c, h])`, `send(PIN, i)`, `send(DICE)`; `clear()` — `send(WIPE)`;
  - `var sunT = [Double](repeating: -1, count: 6)` — кеш последнего посланного `SUN` (−1 — не слали); `func sendSun(_ i: Int, _ t: Double, touchTime: Double)` — шлёт только при изменении.
  - `draw / drawShot` — пустые (план (б)).

- [ ] **Step 1: тесты** `TenebraeTests` (`layout(W: 390, H: 844, topY: 103, safeBot: 34)`, `rng: { 0.5 }`):
  - `testSendOwns`: `send(MOVE, 2, [0.3, 0.4, 0], touchTime: 1.5)` → фейк `(21, 2, [0.3, 0.4, 0], 1.5)`, `voice(2).x == 0.3` сразу.
  - `testFan`: заголовок, порядок строк, `text` для decay при 3.5 (по node), `set("decay", t)` → `SETFX 0` с decay `lerpLog(0.6, 14, t)` и прочими четырьмя прежними; `arc() == 0.3`; `lfo == nil`.
  - `testHeardTick`: `heard [1, 2, 1, 2, 2, 4, 0.8]` → одна волна-вспышка у планеты 2, удар `(4, now, 0.8)`; `idle()` сливает без событий.
  - `testSunLevel`: `readLevel { 0.1 }` → `sunLevel` растёт к 0.22 со сглаживанием 0.08.
  - `testDiceEmpty`: живых нет → `SPAWN 0 [p, c, 0]` (числа — `place` при `rng 0.5`), `PIN 0`, `DICE`; `testDiceLive`: живая → только `DICE`; `testDiceFull`: `pick == −1` и живых нет → только `DICE`.
  - `testClear` → `WIPE`; `testCorner`: `(10, bot − 10)` — да, `(60, bot)` — нет.
  - `testRestored`: кеш `sunT` сброшен (`sendSun(1, 0.3)` после `restored()` шлёт снова, повтор — нет).
  - `testZoomLayout`: `zoomT == geo.zoomDef`; ручной `zoomT = 0.5`, `layout` того же размера — 0.5; другого — `zoomDef`.
  - Хост: `testCornerBeforeEdge` — палец `(8, bot − 10)` на мире-фейке → `.corner` (до правки — `.edge`); `(8, 300)` — `.edge`.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Tenebrae view - state wiring, tick, dice, fan; host checks corner before edge strip`.

**Ревью задачи:** `haiku` — только соответствие спеке.

### Task 4: `TenTouch` — палец, тяга, солнце, двойной тап, удержание, щипок

Риск: обычный — жесты под тестами на фейке.

**Files:**
- Modify: `ios/app/T2D/Tenebrae/TenTouch.swift`
- Test: `ios/app/T2DTests/TenTouchTests.swift`

**Interfaces:**
- Consumes: задачи 1–3.
- Produces (в `extension TenebraeView`): `struct TenFinger { let id: ObjectIdentifier; var x0, y0, t0: Double; var moved = false; var v: Int?; var ox = 0.0, oy = 0.0; var caught = false; var spawned = false }` и `var fingers: [ObjectIdentifier: TenFinger]`; `struct TenPinch { let a, b: ObjectIdentifier; let d0, z0, t0: Double; var zooming = false }`, `var pinch: TenPinch?`; `var lastTap: (v: Int?, t: Double, x: Double, y: Double)?`; `var refuse: (x: Double, y: Double, t0: Double)?` (отказ «full» и «нет голоса», 0.6 с) и `var hold: (id: ObjectIdentifier, t0: Double)?` — поля для плана (б); `func touchTick(now: Double)` (удержание → `openPlanetSheet(i)` задачи 6; в этой задаче — заглушка `openPlanetSheet` в `TenSheet.swift`, пишет `sheetVoice = i` и шлёт `KEEP 0 [i]`); `func touchReset()`; `down / move / up / cancel`.
- Порядок попаданий и действия — спека, решение 9; в этой задаче — только ветка «поле» (`solDown :393-425`, `solMove :435-445`, `solUp :481-502`, щипок `:412-418, :436-439, :460-470`, `hit :233`, `follow :252`, `spawn :279`). Ветки призрака, булавки, плашки, кольца и ручки нити вызываются из `down` через `func linkDown(_ f: Finger) -> Bool` (задача 5) и `func sheetDown(_ f: Finger) -> Bool` (задача 6) — в этой задаче они возвращают `false`. Мост (второй палец на другой планете) — через `func bridgeDown(_ f: Finger, first: ObjectIdentifier, b: Int) -> Bool` (задача 5; здесь `false`, второй палец тогда — обычный палец).
- `touchTime` пальца — в `SPAWN, MOVE, SUN, ATTACK`; `holeT` для `MOVE` — `geo.holeDepth` точки пальца + смещение `ox, oy`; `SUN` — через `sendSun`. Голос под пальцем пропал (`!voice(v).active` в зеркале, а не своё) — палец забывает `v`, дальше ничего не шлёт.

- [ ] **Step 1: тесты** `TenTouchTests` (фейк, зеркало помощником):
  - `testSpawnDrag`: касание по пустому → `SPAWN 0 [p, c, h]` (числа `unplace` точки, `touchTime`), `GRAB 0`; тяга на 30 px → `MOVE 0`; подъём → `LETGO 0 [1]`.
  - `testCatch`: живая временная в 40 px → `ATTACK i`, `GRAB i`; закреплённая — без `ATTACK`; в 60 px — новая.
  - `testSpawnFull` (Review Focus 2): `pick == −1` → ни `SPAWN`, ни `GRAB`, `refuse` выставлен; второй палец по пустому — тоже ничего.
  - `testDoubleTap`: два тапа по планете в 0.3 с → второй `up` шлёт `LETGO i [0]` и `PIN i`; при `full` — `PIN` не шлётся, `refuse`; через 0.35 с — не двойной; двойной по пустому — вторая планета рождается и закрепляется.
  - `testSun`: тяга планеты к `(20, bot − 20)` → `SUN i [t]` с `t = clamp((124 − d)/70)`; та же точка ещё раз — без повтора; уход — `SUN i [0]`.
  - `testHold`: 0.43 с без сдвига, один палец → `KEEP 0 [i]`; сдвиг 11 px — нет; два пальца — нет; на `up` после открытия — ни `PIN`, ни `LETGO [1]` (`testTapEdges`, Review Focus 5).
  - `testPinch`: два пальца по пустому в 0.2 с, развели на 40 px за 0.5 с → оба `RELEASE i [0.03]` временным, `zoomT == z0·d0/d`, `zoomShow > now`; в 0.3 с — не пара (вторая планета); на `up` пары — ни `PIN`, ни `LETGO [1]`.
  - `testVoiceGoneMidDrag` (Review Focus 3): палец тянет голос 2, зеркало — `active 0` → `move` не шлёт `MOVE 2`; ядро заняло 2 заново — `up` не шлёт `LETGO 2`.
  - `testRestoredMidDrag`, `testRestoredMidPinch` (Review Focus 1): `restored()` посреди — `move / up` ничего не шлют.
  - `testCancel`: `cancel` во время тяги → `LETGO i [1]` (как `forgetFingers`), без `PIN`.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Tenebrae touches - spawn, drag, sun, double tap, hold, pinch zoom`.

**Ревью задачи:** `haiku` — только соответствие спеке.

### Task 5: `TenLink` — мост и кольцо связи

Риск: обычный — жесты под тестами на фейке.

**Files:**
- Create: `ios/app/T2D/Tenebrae/TenLink.swift`
- Modify: `ios/app/T2D/Tenebrae/TenTouch.swift` (заглушки `linkDown / bridgeDown` → реальные)
- Test: `ios/app/T2DTests/TenLinkTests.swift`

**Interfaces:**
- Consumes: задачи 1–4.
- Produces (в `extension TenebraeView`): `struct TenBridge { let a, b: Int; let fa, fb: ObjectIdentifier; let d0, depth0: Double; var depth: Double }`, `var bridge: TenBridge?`; `struct TenRing { let dst, src: Int; let cx, cy: Double; var key: Int?` (0 fm, 1 tzfm, 2 am, 3 rm, 4 cut) `; var t: Double; var overPin: Bool; var cutting: Bool; var pinned: Bool; var finger: ObjectIdentifier? }`, `var ring: TenRing?`, `var ghost: (ring: TenRing, until: Double)?`; `func linkMid(dst: Int, src: Int) -> (x: Double, y: Double)` (`bez(0.5)` кривой `linkCurve :525-540`, прогиб от `sunLevel` — как в вебе); `func ringCenter(_ x: Double, _ y: Double) -> (x: Double, y: Double)` (`:854`); `func linkDown(_ f: Finger) -> Bool`, `func linkMove(_ f: Finger)`, `func linkUp(_ f: Finger)`; `func bridgeDown(_ f: Finger, first: ObjectIdentifier, b: Int) -> Bool`; закрытие кольца в `touchTick`, когда `dst` неактивен или связи `src → dst` нет.
- Порядок в `linkDown` — спека, решение 9: призрак (булавка в `PIN_R + 14`) → булавка кольца на весу другого пальца (< 29) → закреплённое кольцо (close-чип `(W − 80, H − safeBot − 320, 64 × 26)`; `d < ringR = 40 + menuSpan + 34`) → ручка нити (`< 24` от `linkMid`, не auto, источник активен). Лучи: fm −90°, tzfm −18°, am 54°, rm 126°, cut 198°; луч на весу — при `d > 56`, держится до возврата в 40; `t = clamp((d − 40)/menuSpan)`; cut `t > 0.35` — разрез.

- [ ] **Step 1: тесты** `TenLinkTests`:
  - `testBridge`: палец держит A (0), второй на B (3, временная) → `ATTACK 3`, `GRAB 3`, `LINK 0 [3]`; растяжка вдвое → `LINKDEPTH 0 [3, clamp(0.5 + 2 − 1)]`; отпускание при глубине 0.04 → `UNLINK 0 [3]`; при 0.6 — связь остаётся; оставшийся палец ведёт A дальше (`MOVE 0`).
  - `testBridgeNotWhenTwoHeld`: два удерживаемых — третий палец на планете не мост.
  - `testHandleRing`: связь `3 → 0`, палец на ромбе → `ring` на весу, центр `ringCenter`; тяга на луч am на `40 + 0.5·menuSpan` → `LINKTYPE 0 [3, 2]`, `LINKDEPTH 0 [3, 0.5]`; отпускание — `ghost` на 1.6 с, кольцо закрыто.
  - `testRingCut`: луч cut, `t 0.4` → на отпускании `UNLINK 0 [3]`; `t 0.3` — нет.
  - `testRingPin`: отпускание на булавке (< 40) → закреплённое кольцо; тап по призраку-булавке в 1.6 с → закреплённое; через 1.7 с — призрак погас, касание идёт в поле.
  - `testTapHandle`: тап по ромбу (< 0.22 с, < 14 px) → сразу закреплённое.
  - `testPinnedRing`: касание по лучу rm → `LINKTYPE … 3`; close-чип → закрыто; касание дальше `ringR` → закрыто и в поле не идёт.
  - `testRingClosesWhenGone`: связь пропала из зеркала → кольцо закрыто в `touchTick`.
  - `testRestoredMidRing` (Review Focus 1): `restored()` при пальце на кольце — `move / up` ничего не шлют, `ring == nil`, `ghost == nil`.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Tenebrae links - two-finger bridge, link ring, cut, pin, ghost`.

**Ревью задачи:** `haiku` — только соответствие спеке.

### Task 6: `TenSheet` — плашка планеты и LFO модели

Риск: обычный — UI-логика под тестами на фейке.

**Files:**
- Create: `ios/app/T2D/Tenebrae/TenSheet.swift` (заменяет заглушку `openPlanetSheet` задачи 4)
- Test: `ios/app/T2DTests/TenSheetTests.swift`

**Interfaces:**
- Consumes: задачи 1–5; `SheetGeo.Panel`, `Pad.shapeT / rate / depth` (`Host/Sheet.swift:32, 82-90` — те же формулы, что `host/sheet.js:10-15`, которые зовёт веб `app.js:748-749`).
- Produces (в `extension TenebraeView`): `struct TenSheetGeo { init(W: Double, H: Double, safeBot: Double, lfo: Bool)` (`sheetGeo :545`: `bottom = H − safeBot − 8`, `lfoH = 196` при открытой панели, `top = bottom − lfoH − 240 − 102`, волна `y top + 52` h 40, строки `top + 100 + 40·i`, `tx0 = x + 70`, `tx1 = x + w − 112`, `lfoX = x + w − 18`, close `(x + w − 64, top + 12, 64 × 30)`, pitch `(x + w − 140, top + 12, 66 × 30)`; поля `x, w, top, bottom, waveY, tx0, tx1, lfoX, close, pitch, panel: SheetGeo.Panel?` `}`; порядок строк — `app.js:542-569` (`ROW_DEF`); `var sheetVoice: Int?`, `var sheetLfo: LfoKey?` (открытая панель), `func openPlanetSheet(_ i: Int)` (`KEEP 0 [i]`), `func closePlanetSheet()` (`UNKEEP`, LFO с `depth < 0.03` сняты), `func sheetDown(_ f: Finger) -> Bool`, `sheetMove`, `sheetUp`; плашка закрывается в `touchTick`, если голос неактивен.
- Попадания — `uiHit :600-613`: выше `top` или close → закрыть (касание съедено); pitch-чип → панель LFO ключа `pitch`; полоса волн ±4 → `SET i [0, t]`, `t = clamp((x − s.x − 18)/(s.w − 36))`; строка: `x > tx1 + 4` и не amp → «~» (`SETLFO` с `LFO_DEF`, если LFO нет; повторный тап по той же строке сворачивает панель, LFO остаётся), иначе — бегунок (`v0 + dx/(tx1 − tx0)` → `tenSetNorm` → `SET i [key, v]`); двойной тап строки (0.32 с) → `Ten.rowDef`; панель: off-чип → `SETLFO … −1`, полоса форм → `morph = Pad.shapeT`, пад → `rate = Pad.rate`, `depth = Pad.depth`; на `up` при `depth < 0.03` → снять. Соответствие строки и ключа LFO — `LfoKey` (у строки `fm` — `7`, у `beat` — `4`).

- [ ] **Step 1: тесты** `TenSheetTests`:
  - `testGeo`: `TenSheetGeo(W: 390, H: 844, safeBot: 34, lfo: false)` — `bottom 802`, `top 460`, `waveY 512`, строка 0 — `560`; с LFO — `top 264`, `panel` не `nil` (числа выведены из карты; разойдутся с `sheetGeo` веба — прав веб, тест правится по нему).
  - `testOpenClose`: удержание → `KEEP 0 [i]`, `sheetVoice == i`; касание выше `top` → `UNKEEP`, `sheetVoice == nil`, в поле ничего не ушло; `cornerHit` при открытой — `false`.
  - `testRowDrag`: бегунок cut, сдвиг на `0.1·(tx1 − tx0)` → `SET i [1, tenSetNorm(.cut, norm0 + 0.1)]`; двойной тап → `SET i [1, 0.68]`.
  - `testWaveStrip`: касание полосы в середине → `SET i [0, 0.5]`.
  - `testLfo`: «~» у cut → `SETLFO i [2, 0, 1.2, 0.35]`, панель открыта (`sheetLfo == .cut`); пад в точке → `SETLFO i [2, 0, rate, depth]` по `Pad`; отпускание при `depth 0.02` → `SETLFO i [2, 0, 0, −1]`; повторный тап «~» — панель свёрнута, LFO на месте; pitch-чип → ключ 0.
  - `testSheetClosesWhenGone` (Review Focus 3): голос неактивен в зеркале → `touchTick` закрывает плашку и шлёт `UNKEEP`.
  - `testRestoredMidRow` (Review Focus 1): `restored()` при пальце на бегунке — `move / up` ничего не шлют, плашка закрыта.
- [ ] **Step 2:** падают. **Step 3:** реализация. **Step 4:** зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Tenebrae planet sheet - rows, wave strip, model LFO panel`.

**Ревью задачи:** `haiku` — только соответствие спеке.

---

План (б) — `TenScene`, `TenDraw`, `TenFrame`, рисование плашки и кольца, сцены `-shot ten*`, включение на карте (`view: true`), доки — пишется после плана (а).

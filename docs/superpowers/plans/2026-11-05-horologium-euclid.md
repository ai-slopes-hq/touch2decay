# Horologium — Евклид на сетке 16 и длина кольца: план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** кольца Horologium бьют Евклидов рисунок на сетке шестнадцатых (k = min(n, L) ударов на L шагов), у кольца своя длина 1…16 (полиметр); длина — жестом вдоль кольца в iOS, фаза — сдвиг в шагах.

**Architecture:** ядро (`core/worlds/horologium/`) получает поле кольца `len` (ключ `LEN`, снимок, зеркало 63 числа) и новую детекцию удара в `Sound::process`: смена номера шага `floor(P·S)` → шаг рисунка `(q + rot) mod L` → `sdk::euclid`. Веб-фасад и эталон модели повторяют модель (умолчания, кубик, `len`); веб рисует гнёзда, жеста длины в вебе нет. iOS: зеркало, математика гнёзд, рисунок, жест длины.

**Tech Stack:** C++17 → `t2d.wasm` (`core/build.sh`), JS ES-модули + `node --test`, Swift 5 / CoreGraphics + XCTest.

**Spec:** `docs/superpowers/specs/2026-11-05-horologium-euclid-design.md` — читать целиком перед любой задачей. Мир — `docs/worlds/horologium.md`; правила звука — `docs/sdk-rules.md`.

## Global Constraints

- Ветка `native`. Коммиты — по-английски, тело-список, последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `notebooks/*` не трогать и не коммитить, `git stash` не делать, без `commit -a`.
- Хук `.claude/hooks/guard.py` на commit: правка `core/` — вместе с пересобранным `t2d.wasm` (`core/build.sh`); `node --check`. Пуш — только в задаче 6.
- Модель — без `Math.random` / DOM; случайность — `rng` / `sdk::Rng`. `state` фасада правят только методы модели.
- Шаг кольца: шестнадцатая (`S = 16`), унтертон — восьмая (`S = 8`). Рисунок: `hit(j) = (j·k) mod L < k`, `k = min(n, L)`, n — номер кольца (II = 2 … IX = 9). `len` — целое 1…16, умолчание 16. `rot = (floor(phi·L + 0.5) mod L + L) mod L`, нечисло → 0 — одна формула в C++, JS и Swift.
- Кубик — один алгоритм в ядре, фасаде и эталоне, порядок вызовов `rng`: `k = 2 + floor(R()·6)`; `under = R() < 0.25`; все кольца: `on = k ≤ n ≤ k+2`, `under`, `lvl 0.8`, `phi 0`, `len 16`; затем для n = k, k+1, k+2 по возрастанию: `len = LENS[floor(R()·5)]`, `phi = floor(R()·len) / len`; затем `materia = R()`; часы идут (`run`, `u = uT = 0`). `LENS = {16, 16, 12, 8, 6}`. `inst` кубик не трогает.
- Умолчание колец: звучат II, III, IV (индексы 0, 1, 2), `len 16`, `phi 0`. `clear` ставит `len = 16` всем.
- Зеркало: голова 15 чисел как было, на кольцо 6: `on, under, phi, lvl, inst, len`; всего 63.
- Картинка: hairline, без `shadowBlur`, градиенты — через `glowAt`; «не шумно» — засечки пустых гнёзд едва видны, подпись длины — только пока тянешь. Подписи поля — `mapText` (курсив); подпись длины — EB Garamond (`reading`), курсив. Без русского текста на экране.
- Тест пишется раньше кода и сначала красный. Тесты гоняет агент test-runner. Команды:
  - ядро: `core/build.sh && core/build/sdk-test` → без `FAIL`;
  - JS: `node --test tools/test-models.mjs tools/models/*.test.mjs tools/test-horo-core.mjs` → `fail 0`;
  - iOS: `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|failed|SUCCEEDED|FAILED" | tail -30` → `** TEST SUCCEEDED **` (только полный прогон: `-only-testing` падает на шрифте — не баг).
- Swift: никакого `Int(Double)` без проверки `isFinite` и зажима.

## Review Focus

1. **Колесо назад и прыжок замка** (`step` с отрицательным d, замок к такту прыгает назад на ≤ 0.5 оборота) — ударов не больше одного за сэмпл, номер шага в рисунке не уходит в минус. Тест — задача 2 (`horoBackward`).
2. **Фаза от LFO вне 0…1** (−0.25, 1.0, 0.99, NaN, 1e300) — `rot` в 0…L−1, звук и рисунок не падают. Тесты — задача 2 (`horoRot`), задача 3 (`rotOf`), задача 4 (`testRot`).
3. **Длину меняют посреди такта** (16 → 3, когда бегунок на шаге 13) — следующий удар по новому рисунку, без выхода за массив и всплеска. Тест — задача 2 (`horoLenSwitch`).
4. **Жест длины через «6 часов»** — atan2 прыгает на 2π, длина не скачет. Тест — задача 5 (`testLenDragWraps`).
5. **Старая или битая сцена** (нет `len`, `"len": "x"`, 0, 99, 7.6; в зеркале NaN и 1e300) — длина 16 или зажата в 1…16. Тесты — задача 1 (`horoModelLen`, `testMirrorLenGarbage`).

---

### Task 1: модель, снимок и зеркало с `len`

Риск: высокий — публичный контракт зеркала (C++ ↔ веб ↔ Swift), C++.

**Files:**
- Modify: `core/worlds/horologium/model.hpp`, `model.cpp` (Ring, RingKey, reset, clear, setRing, dice, snapshot, restore)
- Modify: `core/worlds/horologium/world.hpp:20-21` (`RING_M = 6`, комментарий раскладки), `world.cpp` (`mirror`, `Sound::R{…, q.len}` в `process` — поле `len` у `Sound::R` добавляется здесь со значением по умолчанию 16, читает его задача 2)
- Modify: `worlds/horologium/model.js` (фасад), `tools/ref/horologium-model.js` (эталон), `tools/horo-scenarios.mjs` (`RING_KEYS`, если по нему считают смещения)
- Modify: `ios/app/T2D/Horologium/HoroMath.swift` (`HoroRing.len`), `HoroMirror.swift`
- Test: `core/tests/sdk_test.cpp` (`horoModelLen`, `horoModelDefaults`, `horoDice`, все `== 55` → 63), `tools/test-horo-core.mjs` (`mirror: head layout`), `tools/models/horologium.test.mjs` (кубик, facade-тест `mirror 55`), `ios/app/T2DTests/HorologiumTests.swift` (`testMirrorParse`, `testMirrorLoadInPlace`, новый `testMirrorLenGarbage`)

**Interfaces:**
- Produces (C++): `struct Ring { …; int len = 16; }`; `enum RingKey { ON, UNDER, PHI, LVL, INST, LEN, NRK }`; `constexpr int LEN_MAX = 16;`; `Sound::R { …; double hz = 110; int len = 16; }`; `RING_M = 6`, `MIRROR_N = 63`; ключ снимка `"len"`.
- Produces (JS): фасад и эталон — `RING_KEYS = ['on', 'under', 'phi', 'lvl', 'inst', 'len']` (у эталона без `inst`), у кольца `len`, `export const LENS = [16, 16, 12, 8, 6]`.
- Produces (Swift): `HoroRing.len: Int = 16`; `HoroMirror.ringN = 6`, `size = 63`.

- [ ] **Step 1: красные тесты ядра.** `horoModelLen`: `setRing(i, LEN, v)` — 12 → 12, 7.6 → 8, 0 → 1, 99 → 16, NaN и ±inf → без изменений (как `INST`); снимок → restore — `len` тот же; снимок без `len` → 16; `"len": "x"` → 16; `clear()` → 16 у всех. `horoModelDefaults`: после `reset` звучат индексы 0, 1, 2, остальные нет, `len` 16. `horoDice`: ровно три соседних кольца, `under` у всех одинаков, у включённых `len ∈ {16, 12, 8, 6}` и `phi·len` — целое в 0…len−1, у выключенных `len 16`, `phi 0`; `inst == i`; одно зерно — одно зеркало (63 числа). Остальные `horoMirror(…) == 55` → 63, смещения колец `15 + 6·i`. Зарегистрировать новые функции в `main()` рядом с `horoDice()`.
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` → новые проверки падают.
- [ ] **Step 3: ядро.** Поля и ключ `LEN` (`setRing`: `if (std::isfinite(v)) r.len = lround(clamp(v, 1, LEN_MAX))`), `reset` (on — индексы 0…2), `clear` (`len = 16`), `dice` (алгоритм — Global Constraints, `static const int LENS[5]`), `snapshot` (`"len"`), `restore` (до чтения — `len = 16` всем, как `inst`; читать через `setRing(i, LEN, …)` только `Num`). Зеркало — `len` шестым числом кольца. Обновить шапки `model.hpp` / `world.hpp`.
- [ ] **Step 4:** `core/build.sh && core/build/sdk-test` → зелёный.
- [ ] **Step 5: красные тесты JS.** `tools/test-horo-core.mjs`, `mirror: head layout`: длина 63, по умолчанию звучат II, III, IV (`m[15 + 6·i]` для i = 0…2), `inst` по `m[15 + 6·i + 4]`, `len` 16 по `m[15 + 6·i + 5]`. `tools/models/horologium.test.mjs`, кубик (оба пути, js и core): три соседних кольца, `len` из `LENS`, `phi·len` целое; facade-тест: зеркало 63, снимок несёт `len`, старая сцена без `len` → 16, `clear` → 16. Прогнать — красные.
- [ ] **Step 6: фасад и эталон.** Умолчания, `len` в кольце, `RING_KEYS` с `'len'`, `sync` читает `m[o + 5]` (смещение через `RING_KEYS.length`), `scene`/`snapshot` с `len`, `restore` — `len: 16` по умолчанию (как `inst`), `clear` — `len = 16`, `dice` — алгоритм Global Constraints. Эталон: то же без `inst`; `strip` в `test-horo-core.mjs` по-прежнему убирает только `inst`. Сверка колеса с эталоном (сценарии `ACTS`) не меняется.
- [ ] **Step 7:** JS-команда → `fail 0`.
- [ ] **Step 8: Swift.** Красные тесты: `testMirrorParse` / `testMirrorLoadInPlace` на 63 числа с `len` 12 у кольца 3; `testMirrorLenGarbage` — `len` в зеркале NaN, 1e300, −5, 0 → 16, 16, 1, 1; 7.6 → 8. Затем `HoroRing.len`, `HoroMirror` (`ringN 6`, `size 63`, разбор `len`: нечисло → 16, иначе `Int(min(16, max(1, x.rounded())))`). Шапка `HoroMirror.swift` — 63. iOS-команда → `** TEST SUCCEEDED **`.
- [ ] **Step 9: commit** (`core/`, `t2d.wasm`, `worlds/horologium/model.js`, `tools/`, `ios/app/T2D/Horologium/`, `ios/app/T2DTests/HorologiumTests.swift`): `core: Horologium ring length, new defaults and dice, mirror 63`.

### Task 2: звук — Евклид на сетке шестнадцатых

Риск: высокий — realtime-аудио, C++.

**Files:**
- Create: `core/sdk/euclid.hpp`
- Modify: `core/worlds/cymatica/model.cpp:338` (та же формула → `sdk::euclid`)
- Modify: `core/worlds/horologium/sound.hpp`, `sound.cpp:88-120` (детекция и concursus)
- Modify: `docs/sdk-inventory.md` (строка про `euclid.hpp`)
- Test: `core/tests/sdk_test.cpp` (новые `sdkEuclid`, `horoOnsets`, `horoBackward`, `horoRot`, `horoLenSwitch`, `horoConcursus`; переставить `horoAttacksPerTurn`, `horoCeiling`; `horoKitPeak`, `horoKitRms`, `horoTailOff`, `horoInstSwitch` — должны пройти без правок или с пересчитанным порогом)

**Interfaces:**
- Consumes: `Sound::R::len` (задача 1).
- Produces: `namespace sdk { inline bool euclid(int j, int k, int n); }` — `n ≥ 1`, `0 ≤ j < n`, `(j·k) % n < k`; `static int Sound::rotOf(double phi, int L)` (формула — Global Constraints; через `std::fmod`, без приведения огромного double к int); `static int Sound::stepsOf(bool under)` → 8 или 16; `double Sound::lastAcc(int i) const` — множитель последнего удара кольца i (для теста concursus).

- [ ] **Step 1: красные тесты.**
  - `sdkEuclid`: для n = 1…16, k = 0…n — ударов ровно k, при k > 0 удар на j = 0; k = n — все.
  - Помощник `horoExpect(P0, P1, S, rot, k, L)` — число шагов q в (floor(P0·S), floor(P1·S)] с `euclid(((q + rot) % L + L) % L, k, L)`.
  - `horoOnsets` (chance 1, F 0.5, 4 такта, `strikes()` против `horoExpect`): II L16 (и удары только на шагах 0 и 8 такта — после блока с новым ударом `floor(P·16) % 16 ∈ {0, 8}`); III L12; IV L8 с `phi = 3/8`; II под унтертоном, L16 (S = 8); IX L6 (k = 6 — каждый шаг).
  - `horoBackward`: II L16, F 0, `step(-0.5)` и 0.2 с — `strikes() == 1` (переход через начало шага 0); затем замок к такту с прыжком назад (`lock` при P ≈ 0.4) — за блок прыжка не больше одного удара на кольцо.
  - `horoRot`: `rotOf(-0.25, 16) == 12`, `rotOf(1.0, 16) == 0`, `rotOf(0.99, 16) == 0`, `rotOf(NaN, 16) == 0`, `rotOf(1e300, 16)` в 0…15, `rotOf(0.5, 1) == 0`.
  - `horoLenSwitch`: II, L16 до P = 0.85 (шаг 13), затем L3 до P = 2 — прирост `strikes()` равен `horoExpect` по L3 на этом отрезке; выход конечен.
  - `horoConcursus`: II и IV, L16, conc 1, lvl 1: на шагах 0 и 8 (оба кольца) `lastAcc` у IV = 1 + 1.2; на шагах 4 и 12 (только IV) — 1 − 0.35.
  - `horoAttacksPerTurn`: V, L16, F 0.5 — `attacks() == strikes() == horoExpect(…)`. `horoCeiling`: IX L16, F 8 — голосов за секунду ≤ 24, ударов ≥ 60 (нижний порог голосов пересчитать под неровные промежутки Евклида и записать, откуда число).
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` → новые падают (до появления функций — ошибка компиляции).
- [ ] **Step 3: `core/sdk/euclid.hpp`** + Cymatica на него (`sdk_test` Cymatica остаётся зелёным — это рефакторинг).
- [ ] **Step 4: детекция в `Sound::process`.** `set` хранит у `O` `len` (зажим 1…16, мусор → 16) и `rot = rotOf(phi, len)`. Каждый сэмпл, проход 1 — для каждого включённого кольца: `S = stepsOf(under)`, `q0 = floor(P0·S)`, `q1 = floor(P_·S)` (double); если различны — начало шага `qb = max(q0, q1)`, `j = ((fmod(qb + rot, L)) + L) mod L`, `fire[a] = euclid(j, min(n, L), L)`. «Раз» — `floor(P0) != floor(P_)`. Проход 2 — для `fire[a]`: `rnd() < chance_` (ГСЧ — только для сработавших, как раньше), concursus — `hitc = раз || есть другое fire[b]`, затем потолок, `hit_`, голос — как было. `mOf` дальше задаёт только высоту. Обновить шапку `sound.hpp` (как бьёт кольцо).
- [ ] **Step 5:** `core/build.sh && core/build/sdk-test` → зелёный. Если `horoKitRms` вышел за ±3 дБ — пересчитать эталон уровня и написать в коммите, на сколько дБ сдвинулся.
- [ ] **Step 6:** JS-команда → `fail 0` (сверка колеса с эталоном не должна измениться).
- [ ] **Step 7: commit** (`core/`, `t2d.wasm`, `docs/sdk-inventory.md`): `core: Horologium Euclidean rings on a 16th grid`.

### Task 3: веб — гнёзда на кольцах, фаза шагами

Риск: обычный — UI.

**Files:**
- Modify: `worlds/horologium/model.js` (чистые функции), `worlds/horologium/view.js:60,80,101-105,152-175,245`
- Test: `tools/models/horologium.test.mjs` (facade-only тест чистых функций)

**Interfaces:**
- Consumes: `len` у кольца фасада (задача 1).
- Produces: `export const euclid = (j, k, L) => boolean`, `rotOf(phi, L) => int`, `stepsOf(r) => 8 | 16`, `slotOf(r, P) => int` (текущее гнездо `(floor(P·S) + rot) mod L`, в 0…L−1; нечисло P → 0).

- [ ] **Step 1: красный тест** `Horologium facade: Euclid helpers`: `euclid` — k ударов на L для L 1…16; `rotOf` — те же случаи, что `horoRot` задачи 2; `slotOf({n: 2, under: false, phi: 0, len: 16}, 0.5) === 8`, `len 12, P 1 → 4`, `under, len 16, P 0.5 → 4`, `phi 3/16, P 0 → 3`, P = −0.01 → 15, P = NaN → 0.
- [ ] **Step 2:** JS-команда → тест падает.
- [ ] **Step 3: функции в `model.js`.**
- [ ] **Step 4: вид.** `marksOf` уходит. Гнёзда: L штук, гнездо j на угле `j / L · TAU` от верха по часовой. Гнездо с ударом — точка (унтертон — ромбик, размеры как у прежних меток), пустое — короткая радиальная засечка ~3 px, `ink(0.12)` у звучащего кольца, `ink(0.06)` у молчащего; бегунок — гнездо `slotOf`: пустое — засечка `ink(0.45)`, с ударом — вспышка по `ringHit` (как прежняя метка `cur`); быстро (`F > 4`) — горят все гнёзда с ударом. Номер кольца — в просвете между гнёздами с ударом (прежний алгоритм по их углам). Вдоль кольца — фаза: `phi = ((phi0 − d / TAU) % 1 + 1) % 1`. Подпись при перетаскивании и строка плашки *phase* — `${rotOf(phi, len)} / ${len}` (подпись — `${ROMAN[n]} · 3 / 12`).
- [ ] **Step 5:** JS-команда → `fail 0`; `node --check worlds/horologium/*.js`.
- [ ] **Step 6: снимки.** Агент `shots`: `python3 -m http.server 8765` в корне, `tools/shot.py horologium`; проверить глазами: на II — 2 точки на 16 гнёздах, на III, IV — 3 и 4; засечки пустых гнёзд едва видны; бегунок есть; номера колец читаются; нет наложений.
- [ ] **Step 7: commit:** `web: Horologium rings draw Euclid slots, phase in steps`.

### Task 4: iOS — математика гнёзд и рисунок

Риск: обычный — UI (Swift без unsafe).

**Files:**
- Modify: `ios/app/T2D/Horologium/HoroMath.swift`, `HoroDraw.swift:8-10,63-114`
- Test: `ios/app/T2DTests/HoroMathTests.swift`, `ios/app/T2DTests/HorologiumTests.swift` (рисунок без падений)

**Interfaces:**
- Consumes: `HoroRing.len` (задача 1); формулы — задача 3 (`euclid`, `rotOf`, `slotOf` — те же числа).
- Produces: `Horo.euclid(_ j: Int, _ k: Int, _ L: Int) -> Bool`, `Horo.rot(_ phi: Double, _ L: Int) -> Int`, `Horo.steps(_ r: HoroRing) -> Int`, `Horo.slot(_ r: HoroRing, P: Double) -> Int` (в 0…L−1; P нечисло или 1e300 — без падения), `Horo.lenAfter(_ len0: Int, turned d: Double) -> Int` = зажим `len0 + floor(d / (2π/16) + 0.5)` в 1…16 (d — накопленный угол в радианах, по часовой — плюс).

- [ ] **Step 1: красные тесты** в `HoroMathTests`: `testEuclid`, `testRot` (случаи `horoRot`), `testSlot` (случаи задачи 3 + P = 1e300 в 0…L−1), `testLenAfter` (8, +2.4 гнезда → 10; 8, −2.6 → 5; 3, −100 → 1; 14, +5 → 16). В `HorologiumTests` — `testDrawSlotsHuge`: зеркало с `len` 1 и 16, `phi` 1e300, P 1e300 — кадр рисуется без падения.
- [ ] **Step 2:** iOS-команда → красные (ошибка компиляции до функций).
- [ ] **Step 3: функции в `HoroMath.swift`.** `slot` и `rot` считают в Double через `fmod`, к Int — только значение уже в 0…L−1.
- [ ] **Step 4: рисунок.** `fillMarks` → `fillSlots`: буфер `dr.slots: [(j: Int, a: Double, hit: Bool)]`, `reserveCapacity(16)`, без выделений в кадре. Вид гнёзд, бегунка, вспышки и номера кольца — как в задаче 3 (Step 4).
- [ ] **Step 5:** iOS-команда → `** TEST SUCCEEDED **`.
- [ ] **Step 6: снимок.** Если у Horologium есть сценарий `-shot` на симуляторе (`docs/testing.md`) — агент `shots` смотрит то же, что в задаче 3, Step 6; нет сценария — пропустить и сказать об этом в отчёте.
- [ ] **Step 7: commit:** `ios: Horologium rings draw Euclid slots`.

### Task 5: iOS — жест длины, подпись, плашка *phase*

Риск: обычный — UI.

**Files:**
- Modify: `ios/app/T2D/Horologium/HorologiumView.swift:51,87-91,177,193-202`, `HoroDraw.swift:225-228`, `HoroSheets.swift:57`
- Test: `ios/app/T2DTests/HorologiumTests.swift` (`testPhaseDrag`, `testPhaseDragWraps` → `testLenDrag`, `testLenDragShorter`, `testLenDragWraps`; новые `testLenLabelOnlyWhileDragging`, `testSheetPhaseSteps`)

**Interfaces:**
- Consumes: `Horo.lenAfter`, `Horo.rot` (задача 4); ключ `LEN` = 5 в `Act.ring` (задача 1).
- Produces: `Hold.len0: Int`, `Hold.turn: Double`; `func lenHeld() -> Int?` вместо `phaseHeld()`.

- [ ] **Step 1: красные тесты.** `testLenDrag`: кольцо с `len` 8, палец по кольцу по часовой на 3 гнезда (угол 3·2π/16) → последнее действие `Act.ring` кольца с `[5, 11]`. `testLenDragShorter`: против часовой на 2 → `[5, 6]`. `testLenDragWraps`: проход через «6 часов» (как `testPhaseDragWraps`) — длина меняется на число пройденных гнёзд, без скачка. `testLenLabelOnlyWhileDragging`: `lenHeld()` — номер кольца, пока тянешь, `nil` после `up`. `testSheetPhaseSteps`: строка *phase* кольца с `phi 0.25`, `len 12` — `"3 / 12"`. Тап, двойной тап и долгое касание кольца — прежние тесты зелёные.
- [ ] **Step 2:** iOS-команда → красные.
- [ ] **Step 3: жест.** В `down` — `len0 = mirror.rings[i].len`, `turn = 0`. В `move` (`.ring where moved`): `turn +=` приращение угла, приведённое в −π…π; `L = Horo.lenAfter(len0, turned: turn)`; действие `[5, L]` — только когда L сменилось с прошлого отправленного; `t.ph = true`. Фазу жест больше не трогает.
- [ ] **Step 4: подпись.** На месте прежней подписи фазы (`HoroDraw.swift:227`), пока `lenHeld()` не nil: `"\(roman[n]) · \(L) / 16"` — `d.reading { d.mapText(…, italic: true) }`. Плашка *phase* — `"\(Horo.rot(r.phi, r.len)) / \(r.len)"`.
- [ ] **Step 5:** iOS-команда → `** TEST SUCCEEDED **`.
- [ ] **Step 6: commit:** `ios: Horologium ring length by dragging along the ring`.

### Task 6: доки и выкладка

Риск: обычный — документация, деплой.

**Files:**
- Modify: `docs/worlds/horologium.md` (как бьёт кольцо, `len`, зеркало 63, кубик, жесты веба и iOS, рисунок гнёзд), `README.md` (раздел Horologium: кольцо бьёт k из L шестнадцатых, длина — в приложении вдоль кольца, фаза — сдвиг в шагах, кубик — три соседних кольца), `CLAUDE.md` (строка IX в таблице миров: Евклид, на iPhone не проверено), `docs/tokens.md` (строка: дата, Horologium, Евклид и длина кольца, токены — `python3 tools/tokens.py --line`), `sw.js` `CACHE` и `index.html` `?v=` — новое число.

- [ ] **Step 1:** правки доков в духе существующего текста (README — по-русски).
- [ ] **Step 2:** все три команды проверки (ядро, JS, iOS) → зелёные.
- [ ] **Step 3: commit** `docs: Horologium Euclid rings and ring length` → `git push` → `python3 tools/deploy-wait.py` → `success v…`.
- [ ] **Step 4:** `ios/app/install.sh` — если iPhone подключён, поставить; нет устройства — сказать автору.

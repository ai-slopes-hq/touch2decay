# Horologium: пэды и фильтр на голос — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** убрать маятник и шкалу tempus, добавить внизу ряд из 8 пэдов (тап — вкл/выкл, удержание — плашка кольца) и фильтр на каждый голос.

**Architecture:** сначала ядро (`core/worlds/horologium`): убрать `u/uT/held/strip`, сжать зеркало, добавить `flt` на кольцо с biquad в `Sound`; затем веб-фасад (только удаление и новые индексы зеркала), затем Swift (удаление, пэды, строка *filtrum*). Номера действий не пересобираем: `HELD=3`, `STEP=4`, `SPEED=6` становятся выведенными из оборота (ядро их игнорирует), остальные не меняются.

**Tech Stack:** C++ (wasm, `core/build.sh`, `sdk_test`), JS (`worlds/horologium`, node-тесты), Swift (`ios/app`, XCTest).

**Spec:** `docs/superpowers/specs/2026-11-05-horologium-pads-filter-design.md`

## Global Constraints

- Зеркало: голова 11 (`fx[5], run, bpm, P, F, strikes, locked`), на кольцо 7 (`on, under, phi, lvl, inst, len, flt`), `MIRROR_N = 67`; буфер в Swift — 72.
- `flt` ∈ [0,1], умолчание 0.5; мёртвая зона 0.47…0.53 = байпас; lowpass 20 кГц→200 Гц (0.47→0), highpass 20 Гц→8 кГц (0.53→1), экспоненциально; Q ≈ 2 дБ; `flt` сглаживается одним полюсом; `Biquad::set` раз в блок.
- LFO-ключи фильтра `21 + i`; `5 + 2i` и `6 + 2i` не двигаются.
- Кубик: новые вызовы `rng` только в конце, после `materia`; максимум один фильтрованный голос; lowpass `flt = 0.30 + 0.17·R()`, highpass `0.53 + 0.12·R()`, знак `R() < 0.5`, применение `R() < 0.5`, кольцо `floor(R()·3)` из трёх звучащих.
- `Fnow = run ? bpm/240 : 0`; замок MIDI: `clk_ && grid.on && grid.p > 0 && run`.
- `RUN` — один аргумент `on`; старые снимки с `u/uT` открываются, лишнее игнорируется; нет или мусорный `flt` → 0.5.
- Пэды: ряд из 8, зона касания ≥ 44 pt, цифры II…IX, имя инструмента курсивом EB Garamond под пэдом; без `shadowBlur`, hairline, без нового текста на русском.
- Любая правка `core/` — пересобрать `t2d.wasm` (`core/build.sh`) в том же коммите; перед выкладкой `CACHE` в `sw.js` = `?v=` в `index.html` (новое число).
- Тесты: `core` — `sdk_test`; `node --test tools/test-models.mjs tools/models/*.test.mjs`, `node tools/test-horo-core.mjs`, `node tools/test-horo.mjs`; iOS — схема тестов `T2D`.

## Review Focus

- `flt` вне 0…1, NaN, строка в снимке/действии → 0.5 без падения.
- Фильтр с экстремальными значениями (0 и 1) на высоких и низких голосах: нет NaN, нет взрыва, хвост выключенного кольца затухает.
- Старый снимок с `u`, `uT`, без `flt` открывается, звучит как раньше.
- Кубик: ни разу не больше одного фильтрованного кольца, остальные ровно 0.5; порядок прежних бросков не изменился.
- Пэды: касание рядом с ободом кольца или ступицей не попадает не туда; удержание пэда не переключает `on` при отпускании.
- Старое действие `HELD/STEP/SPEED`, пришедшее из старого кода, не падает и не меняет часы.

---

### Task 1: Ядро — убрать маятник и tempus, сжать зеркало

Риск: высокий — realtime-аудио и контракт зеркала между слоями.

**Files:**
- Modify: `core/worlds/horologium/world.hpp`, `world.cpp`, `model.hpp`, `model.cpp`, `sound.hpp`, `sound.cpp`
- Modify: `tools/ref/horologium-model.js`, `tools/horo-scenarios.mjs`, `tools/test-horo-core.mjs`, `tools/test-horo.mjs`
- Test: `core/tests/sdk_test.cpp` (≈3614, 4029–4046, 4327, 4346)
- Rebuild: `t2d.wasm` (`core/build.sh`)

**Interfaces:**
- Produces: `Clock {run, bpm}`; `MIRROR_HEAD = 11`, `RING_M = 6` (пока), `MIRROR_N = 59`; индексы головы: `0–4` fx, `5 run, 6 bpm, 7 P, 8 F, 9 strikes, 10 locked`; кольцо `i` с `11 + RING_M·i`. Действия `HELD/STEP/SPEED` — no-op; `RUN` читает только `arg(0)`. Снимок: `{r, fx, bpm, run}`.

- [ ] **Step 1: Обновить тесты на новую раскладку (красные).** `sdk_test`: переписать чтения зеркала (`q + 11 + 6*i`, `q[5]` run), `horoDice` — `run == 1`, без `u/uT`; новый тест `horoRetiredActions`: после `HELD 1`, `STEP 1`, `SPEED …` мир отвечает как прежде (`Fnow` не меняется, `snapshot` без изменений, нет падений); `horoLockNeedsRunOnly`: замок включается при `run && grid.on`.
- [ ] **Step 2: Запустить `sdk_test` — ожидаемо красный** (старые индексы).
- [ ] **Step 3: Реализовать** — убрать `held/strip/u/uT` из `Clock`, `Fnow`, `tick`, `sounding`, `dice`, `snapshot/restore`, `Sound::step` и `glide_`; `world.cpp`: `RUN` одним аргументом, `HELD/STEP/SPEED` игнорируются (enum остаётся, комментарий «выведено»); зеркало и условие замка по Global Constraints.
- [ ] **Step 4: `sdk_test` зелёный**, включая `horoTailOff`, `horoKitPeak`, `horoKitRms`, `horoLfo`, `horoLfoIgnores` без изменений значений.
- [ ] **Step 5: Эталон и узел-тесты.** `tools/ref/horologium-model.js` — те же правки; `horo-scenarios.mjs`: `M`‑индексы, убрать `['speed' …]`, `run` с одним аргументом; `test-horo-core.mjs`, `test-horo.mjs` — индексы и замок без `u`. Запустить `node tools/test-horo-core.mjs`, `node tools/test-horo.mjs` — зелёные (сценарии, где был `speed`, убрать или заменить `bpm`).
- [ ] **Step 6: `core/build.sh`, коммит** `core: horologium drops pendulum/tempus state, mirror 59`.

### Task 2: Ядро — фильтр на голос

Риск: высокий — realtime-аудио, новый параметр в контракте зеркала и LFO.

**Files:**
- Modify: `core/worlds/horologium/model.hpp` (`RingKey::FLT = 6`, `NRK = 7`), `model.cpp` (`RING_KEYS`, `setRing`, `clear`, `dice`, `snapshot`, `restore`), `sound.hpp`, `sound.cpp` (`R.flt`, `O.f`, обработка), `world.hpp` (`RING_M = 7`, `MIRROR_N = 67`), `world.cpp` (зеркало, `Sound::R`, `ACT_LFO`)
- Modify: `tools/ref/horologium-model.js`
- Test: `core/tests/sdk_test.cpp`
- Rebuild: `t2d.wasm`

**Interfaces:**
- Consumes: Task 1.
- Produces: `Sound::R.flt` (float); `static float Sound::filterHz(float flt, bool* hp)` — возвращает частоту среза и тип, `flt` в мёртвой зоне даёт «байпас» (`hp=nullptr` или частота ≤0 — на выбор исполнителя, но один контракт для теста); кольцо в зеркале `[on, under, phi, lvl, inst, len, flt]` с `11 + 7·i`; `ACT_LFO` принимает ключи `0…28`, `21 + i` → `FLT` кольца `i`.

- [ ] **Step 1: Тесты (красные).** `horoFilterMap`: `flt` 0.5, 0.47, 0.53 → байпас; `0` → lowpass 200 Гц ±1 %; `1` → highpass 8 кГц ±1 %; `0.3` между; NaN → байпас. `horoFilterAudio`: ultra (≈10 кГц) при `flt=0` тише ≥ 20 дБ, kick при `flt=1` тише ≥ 20 дБ, при `flt=0.5` выход побитно равен прежнему. `horoFilterTail`: выключенное кольцо с `flt=0/1` доигрывается без NaN. `horoModelFltGarbage`: `setRing(FLT, NaN/-3/9/"x")` → 0.5 или зажато 0…1, без падения; `restore` без `flt` → 0.5. `horoLfoFlt`: ключ `21+i` двигает `flt` кольца `i`, ключи 29+ и отрицательные игнорируются. `horoDiceFlt`: на сетке seed (≥ 200 бросков) прежние поля те же, что у кубика до фильтра; `flt` вне 0.47…0.53 — не более чем у одного кольца и только у звучащих; для lowpass `flt ≥ 0.30`, для highpass `flt ≤ 0.65`; `clear` возвращает 0.5.
- [ ] **Step 2: Запустить — красные.**
- [ ] **Step 3: Реализовать** `Sound::filterHz` (экспонента по Global Constraints), `Biquad` на кольцо в `Sound::O`, коэффициенты раз в блок из сглаженного `flt`, вызов `o.f.step` после `d.step()·KIT` и до панорамы; байпас — без вызова; сброс состояния фильтра при переходе из байпаса и в `O{}`. `Model`: `FLT`, `setRing` (NaN → 0.5, зажим 0…1), снимок/`restore` (нет/мусор → 0.5), `clear`, `dice` (по Global Constraints, после `materia`, прочие кольца ровно 0.5). Зеркало и `Sound::R` в `world.cpp`.
- [ ] **Step 4: `sdk_test` зелёный**; `horoKitRms/Peak` не изменились (фильтр по умолчанию в байпасе). Эталон `horologium-model.js` — те же правила кубика и `flt`.
- [ ] **Step 5: `core/build.sh`, коммит** `core: horologium per-voice DJ filter, mirror 67`.

### Task 3: Веб — убрать маятник и tempus, новые индексы зеркала

Риск: обычный — удаление и переиндексация под существующими тестами.

**Files:**
- Modify: `worlds/horologium/model.js`, `view.js`, `index.js`, `engine.js` (при необходимости), `tools/models/horologium-core.mjs`, `tools/models/horologium.test.mjs`, `tools/shot.py` (`sc_horologium`), `sw.js` + `index.html` (версия кеша)

**Interfaces:**
- Consumes: зеркало 67 из Task 2 (`HEAD = 11`, кольцо — 7 чисел).
- Produces: фасад без `pend`, `grab/swing/tapPendulum/release`, `holdStrip/dragStrip/freeStrip/resetSpeed`, `uOfE/eOfE`, `clock.u/uT/strip`, `handSteps`; `t2d.horo` без `bob/strip/pend`; снимок `{r, fx, bpm, run}` (+ `flt` в `r[i]` хранится и пропускается).

- [ ] **Step 1: Обновить `horologium.test.mjs`** — убрать тесты маятника, шкалы, `uOfE`; ключи снимка `['r','fx','bpm','run']`; кубик — по алгоритму Task 2; добавить: старый снимок с `u/uT` и без `flt` открывается; `flt` мусор → 0.5. Запустить — красные.
- [ ] **Step 2: Реализовать** — удалить код по списку из спеки, §1 «Веб»; `HEAD`/`M`/читатель зеркала на новую раскладку; hub tap = `RUN [on]`; легенда без двух строк; `tools/shot.py sc_horologium` без `bob/strip`.
- [ ] **Step 3: `node --test tools/test-models.mjs tools/models/*.test.mjs`, `node tools/test-horo-core.mjs`** — зелёные; `node --check` на изменённые.
- [ ] **Step 4: Скриншот-проверка** агентом `shots` (`tools/shot.py horologium`): мир рисуется, нет следов маятника и шкалы, кольца и ступица работают.
- [ ] **Step 5: Поднять версию** `CACHE` в `sw.js` и `?v=` в `index.html` (v225), коммит `web: horologium drops pendulum and tempus`.

### Task 4: Swift — убрать маятник и tempus, зеркало 67

Риск: обычный — удаление и переиндексация под существующими тестами.

**Files:**
- Delete: `ios/app/T2D/Horologium/HoroPendulum.swift`
- Modify: `HorologiumView.swift`, `HoroDraw.swift`, `HoroGeo.swift`, `HoroMath.swift`, `HoroMirror.swift`, `ios/app/T2D/App.swift` (`shotHoro`), `ios/app/shot.sh`
- Test: `ios/app/T2DTests/HoroMathTests.swift`, `HorologiumTests.swift`

**Interfaces:**
- Consumes: зеркало 67.
- Produces: `HoroMirror` с полями `run, bpm, P, F, strikes, locked` и кольцо `flt`; `Kind` без `.pend/.strip`; `HoroGeo` без `strip/piv/bob/L`; освобождённая зона `G.ty + 21 … bot` готова под пэды (Task 5); буфер зеркала 72.

- [ ] **Step 1: Тесты:** удалить тесты `HoroPendulum`, шкалы, `uOfE`, `testLenDragWraps` оставить; обновить декодирование зеркала (67) и `setMirror` в `HorologiumTests`; hub tap шлёт `Act.run [on]`; `WorldTempo.play` — один аргумент. Запустить — красные/не собираются.
- [ ] **Step 2: Реализовать** удаление и переиндексацию; убрать сцену `horologium-spin` (`App.swift`, `shot.sh`); легенда без двух строк; `dice()` без `pend.start`.
- [ ] **Step 3: Сборка и тесты** схемы `T2D` (Horo*, Host*, Tempo*, MidiFollow*) зелёные.
- [ ] **Step 4: Сцена `-shot horologium`** агентом `shots` — нет маятника и шкалы; коммит `ios: horologium drops pendulum and tempus`.

### Task 5: Swift — ряд пэдов

Риск: обычный — UI.

**Files:**
- Modify: `HoroGeo.swift` (`pads: [CGRect/центры]`, `padAt(_:)`, пересчёт `R`), `HoroDraw.swift` (`drawPads`), `HorologiumView.swift` (жесты, легенда), `ios/app/T2D/App.swift`, `shot.sh` (сцена `horologium-pads`)
- Test: `HorologiumTests.swift`, `HoroMathTests.swift`

**Interfaces:**
- Consumes: `ringSpec(i)` и `Act.ring [on]` из текущего кода; `Horo.instNames`.
- Produces: `HoroGeo.padAt(_ p: CGPoint) -> Int?` (индекс кольца 0…7 или nil), `Kind.pad(i)` в `Hold`; шаг пэдов ≈ `Ws·0.8/8`, зона ≥ 44 pt.

- [ ] **Step 1: Тесты (красные):** `testPadAtCenters` (8 центров → индексы 0…7, пустое место → nil, зоны не пересекаются на экранах 390×844 и 375×667); `testPadTapTogglesOn` (тап шлёт `Act.ring [i, on=toggle]`, `sheet` не открывается); `testPadHoldOpensSheet` (удержание → `openSheet(ringSpec(i))`, отпускание `on` не меняет); `testPadDoesNotStealRingOrHub` (касания у обода и ступицы идут в кольцо/ступицу); легенда содержит строку про пэды.
- [ ] **Step 2: Реализовать** геометрию (`R` крупнее под освободившееся место, пэды у низа с учётом `safeBot`), рисование (hairline‑кружок, римская цифра, точка у включённого, тусклый у выключенного, имя инструмента курсивом под пэдом; без `shadowBlur`), жесты в `down/up/tick`, как у `Kind.ring` (порог `Touch.holdMs`). Вспышка на удар — только если уже есть сигнал удара по кольцу в Swift; если нет — не делать.
- [ ] **Step 3: Тесты зелёные;** сцена `horologium-pads`: агент `shots` проверяет глазами, что пэды ровные, подписи читаемы, ничего не налезает на кольца и safe area.
- [ ] **Step 4: Коммит** `ios: horologium pad row`.

### Task 6: Swift — строка *filtrum* в плашке кольца

Риск: обычный — UI.

**Files:**
- Modify: `HoroSheets.swift` (`ringKeys` + 6‑я строка, `ringSpec`), `HoroMirror.swift` (чтение `flt`)
- Test: `HorologiumTests.swift`

**Interfaces:**
- Consumes: `RingKey::FLT = 6` через `Act.ring [6, v]`; LFO‑код `21 + i`.
- Produces: `ringKeys = ["on","under","phi","lvl","flt","inst"]` — порядок строк: …*level*, *filtrum*, *instrument*; `Horo.filterText(_ flt: Double) -> String` — `"off"`, `"low 1.2 k"`, `"high 180"` (Гц/кГц, округлённо, граница мёртвой зоны 0.47…0.53 → `off`).

- [ ] **Step 1: Тесты (красные):** `testFilterText` (0.5 → off; 0 → `low 200`; 1 → `high 8.0 k`; 0.3 — между); `testRingSheetHasFilterRow` (6 строк, `flt` шлёт `Act.ring [6, v]`, LFO‑код `21 + i`, `tap` по *instrument* всё ещё листает инструмент); `testSheetFilterLfoKeys`.
- [ ] **Step 2: Реализовать;** индексы `Act.ring` для `inst` и прочих не менять.
- [ ] **Step 3: Тесты зелёные;** сцена `horologium-ring-sheet` обновить, `shots` проверяет, что 6 строк умещаются.
- [ ] **Step 4: Коммит** `ios: horologium filtrum row`.

### Task 7: Документы

Риск: обычный — документация.

**Files:** `docs/worlds/horologium.md`, `README.md`, `CLAUDE.md` (строка Horologium в таблице), `docs/tokens.md`, `docs/testing.md` (если есть упоминания шкалы/маятника)

- [ ] **Step 1:** в `horologium.md` убрать описания маятника и шкалы tempus (абзацы «Мир», «Раскладка», «Натив», `t2d.horo`), добавить раздел «Пэды и фильтр» (жесты, формулы `flt`, ключи LFO, зеркало 67, кубик), пометить «на iPhone не проверено».
- [ ] **Step 2:** `README.md` — жесты Horologium; `CLAUDE.md` — статус; `docs/tokens.md` — строка (`python3 tools/tokens.py --line`).
- [ ] **Step 3:** коммит `docs: horologium pads and filter`. Пуш — отдельно, по просьбе автора.

---

**Самопроверка по спеке:** §1 — задачи 1, 3, 4; §2 — 5; §3 — 2 и 6; §4 — тесты внутри задач; §6 — 7. Пэды и фильтр в вебе вне плана (решение автора 05.11).

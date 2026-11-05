# Мастер-транспорт Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Один BPM и одна фазовая сетка на все секвенсерные миры без MIDI; внешние MIDI-часы подменяют мастер.

**Architecture:** В `Host` (`core/host/`) появляется `sdk::MasterClock` — сетка `Grid`, которая всегда `on`. `clock_.grid` = сетка внешнего `Follower`, если она включена (мастер её перенимает, поэтому после пропажи MIDI фаза не скачет), иначе мастер. Миры уже читают `clk_->grid`, поэтому логика шагов не меняется; Cymatica вместо команды `LOCK` читает `clk_->grid` сама. Темп из интерфейса уходит в хост-действие и во все модели миров как отображаемое значение.

**Tech Stack:** C++ ядро (`core/`, `core/build.sh` → `t2d.wasm`), Web Audio + JS (`host/`, `t2d-worklet.js`), Swift (`ios/app/T2D`), тесты: `core/tests/sdk_test.cpp`, `tools/test-*.mjs`, T2DTests.

**Spec:** `docs/superpowers/specs/2026-11-05-master-transport-design.md`

## Global Constraints

- Мастер: `bpm` зажим 40…200, старт 100, сетка всегда `on`.
- Смена BPM — перепривязка `t0` без смещения текущей доли.
- Внешняя сетка `Follower` приоритетнее; мастер её перенимает (`t0`, `p`).
- `restore` и кубик мира мастер **не** меняют; темп меняют только явные действия (панель audio, строки *tempus*, MIDI).
- `link.clock`, `tempoFrom` (с флагом), `transportFrom` — флаг убрать; пуск и стоп у каждого мира свои.
- Пуск мира мгновенный, шаг берётся из общей фазы (никакого ожидания доли/такта).
- Выкладка: `CACHE` в `sw.js` = `?v=` в `index.html` (новое число), `t2d.wasm` собирать `core/build.sh` вместе с правкой `core/`; коммиты по-английски, тело — список, в конце `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; коммитить только явными путями; `notebooks/*`, `*.webm.part` не трогать.
- Ничего не пушить.

## Review Focus

- Смена BPM во время игры: доля не прыгает, шаги не дублируются и не пропадают (Task 1).
- Пуск мира посреди такта без MIDI: шаг мира совпадает с шагом соседа по `stepTime(grid, k, 4)` (Task 2).
- Внешний MIDI пропал: мастер продолжает с той же фазой и темпом, без скачка и без остановки миров (Task 1).
- Горизонт при `run` без MIDI: `locked = 1` и оборот = 4 доли мастера, без `run` — стоит (Task 2).
- Старые тесты, которые предполагали «сетки нет» (свой темп мира), не сломаны или осознанно переписаны (Task 2).
- Ручная смена темпа при идущем внешнем MIDI не ломает слежение: MIDI главнее (Task 1).

---

### Task 1: MasterClock в ядре и мост

Риск: высокий — realtime-аудио, C++.

**Files:**
- Modify: `core/sdk/transport.hpp` (`MasterClock`), `core/host/host.hpp`, `core/host/host.cpp`, `core/bridge/api.cpp`, `core/bridge/t2d.h`, `core/app/engine.cpp` (хост-действие), `t2d-worklet.js`, `tools/t2d-core.mjs`
- Test: `core/tests/sdk_test.cpp`

**Interfaces:**
- Produces: `struct sdk::MasterClock { double bpm = 100, t0 = 0, p = 0.6; Grid grid() const; void setBpm(double bpm, double now); void adopt(const Grid& g); }`; `void Host::masterBpm(double bpm)` (зажим 40…200, перепривязка по `clock_.now`), `double Host::masterBpmNow() const`; C ABI `void t2d_master_bpm(double bpm)` и `double t2d_master_bpm_get()`; хост-действие `T2D_H_MASTER_BPM` рядом с `T2D_H_SCALE` (`a[0]` — bpm); web-сообщение worklet `{t: 'master', bpm}`; `tools/t2d-core.mjs`: `masterBpm: (bpm) => x.t2d_master_bpm(bpm)`.
- Consumes: `Follower::grid()`, `Host::clock_`.

- [ ] **Step 1: Тесты (красные)** в `sdk_test.cpp`: `masterClockRebase` — при `bpm 100` в момент `now` = 1.234 вызов `setBpm(150, now)` оставляет `(now − t0)/p` тем же (|Δ| < 1e-9), `grid().on` всегда true и `p = 60/bpm`; `masterBpmClamp` — `setBpm(10)` → 40, `setBpm(900)` → 200, NaN → не меняет; `hostGridSelect` — `Host` без MIDI отдаёт мирам `clock.grid.on` = true с `p = 0.6`; после `midiMsg(BEAT…)` с bpm 120 — сетка `Follower`, мастер её перенял (`p = 0.5`); `STOP` и 1 с тишины → мастер идёт дальше с `p = 0.5` и прежней фазой (`t0` не меняется), `clock.grid.on` остаётся true; `masterBpm(90)` при идущем MIDI не меняет сетку мира (MIDI главнее).
- [ ] **Step 2: Собрать и запустить `sdk_test`** (как в `core/README.md`) — новые тесты красные.
- [ ] **Step 3: Реализовать** `MasterClock` в `transport.hpp`: `setBpm` — `n = (now − t0)/p; p = 60/bpm; t0 = now − n·p`; `adopt(g)` — копирует `t0`, `p`, `bpm = 60/p`. В `Host`: поле `master_` (`sdk::MasterClock`), `prepare` сбрасывает его; в `process` после `follower_.tick(...)`: `if (follower_.grid().on) master_.adopt(follower_.grid()); clock_.grid = master_.grid();` (то же в `follow()` вместо `clock_.grid = follower_.grid()`); `masterBpm` игнорирует вызов, пока `follower_.grid().on`. Мост: `t2d_master_bpm`, `t2d_master_bpm_get`; `engine.cpp` — case `T2D_H_MASTER_BPM`; worklet и `t2d-core.mjs`.
- [ ] **Step 4: Тесты зелёные**, остальные тесты ядра (`sdk_test` целиком) — без новых падений; те, что предполагали `grid.on == false` без MIDI, перечислить в отчёте и поправить в Task 2.
- [ ] **Step 5: Коммит** `core: master clock always-on grid, host master bpm` (`t2d.wasm` пересобирать в Task 2, когда ядро стабильно; guard требует его вместе с правкой `core/` — собери `core/build.sh` и добавь `t2d.wasm` в этот коммит).

### Task 2: Миры берут общую сетку

Риск: высокий — realtime-аудио, фазы.

**Files:**
- Modify: `core/worlds/cymatica/world.cpp` (читать `clk_->grid` каждый блок вместо внешнего `LOCK`), при необходимости `core/worlds/{portus,natura,monochord,horologium}/world.cpp`; `core/worlds/cymatica/world.hpp` (комментарий `LOCK` — устарел)
- Test: `core/tests/sdk_test.cpp`, `tools/test-transport.mjs`, `tools/test-horo-core.mjs`, `tools/test-follow.mjs`

**Interfaces:**
- Consumes: `Host::masterBpm`, `Clock::grid` из Task 1.
- Produces: поведение: у Portus, Natura, Monochordum, Cymatica, Horologium без MIDI шаги/колесо привязаны к `master_.grid()`.

- [ ] **Step 1: Тесты (красные)** `hostTwoWorldsSamePhase` (в `sdk_test.cpp`): Portus и Natura в одном `Host`, `PLAY` Portus в t = 0, `PLAY` Natura в t = 1.3 с (без MIDI), в блоках после — все `fire`-времена шагов обоих миров лежат на `stepTime(grid, k, 4)` (|Δ| < 1 сэмпла, `sr = 48000`), т. е. одна сетка; `hostMasterBpmChange` — смена `masterBpm(140)` на ходу: шаги не дублируются, интервал после смены = `60/140/4`; `horoLockNoMidi` — Горизонт при `run = 1` и без MIDI: `locked` в зеркале 1, `P` совпадает с `(now − t0)/(4·p)` по модулю 1 (допуск 0.02), без `run` колесо стоит; `cymaticaGridNoLock` — Cymatica без команды `LOCK` идёт по сетке мастера (узлы `t0 + j·p/4`). Запустить — красные.
- [ ] **Step 2: Реализовать.** Cymatica: в `process` каждого блока `plate_.lock(!(clk_ && clk_->grid.on && clk_->grid.p > 0), g.t0, g.p)` (если ядро без хоста — `off`); `LOCK` оставить как есть и безвредным, но больше не использовать. Остальные миры проверить и поправить только то, что тесты покажут (например, начальный `step_`, `phase_` для вида Natura). Старые тесты с `grid.on == false` без MIDI — переписать на «сетка мастера» или явно создавать мир без хоста (`clk_ == nullptr`).
- [ ] **Step 3: `core/build.sh`**, затем `node --test tools/test-transport.mjs tools/test-horo-core.mjs tools/test-follow.mjs` и `sdk_test` — зелёные.
- [ ] **Step 4: Коммит** `core: worlds follow master grid, cymatica reads clock grid` + `t2d.wasm`.

### Task 3: Веб — один темп, без link.clock

Риск: обычный — UI/JS.

**Files:**
- Modify: `host/concordia.js` (`link.clock`, `tempoFrom`, `transportFrom`), `host/audio-panel.js` (подпись *all worlds*, `tempoFrom` вызов), `app.js` (импорт), `worlds/cymatica/engine.js` (убрать `syncLock` и `LOCK`), `host/midi.js` (политика `tempo`/`beat` оставить, но `setTempo` теперь и в мастер), `worlds/*/index.js` (`tempo.set` → мастер), `host/engine-bus` или где живёт связь с worklet (найти по `t2d-worklet.js` сообщению `scale`), `sw.js`/`index.html` (`CACHE` и `?v=` +1), `README.md`
- Test: `tools/test-follow.mjs`, `tools/test-transport.mjs`, сценарий `shot.py midi` (вердикт агентом `shots`, если playwright недоступен — отметить)

**Interfaces:**
- Consumes: web-сообщение `{t: 'master', bpm}` и `t2d_master_bpm` из Task 1.
- Produces: `setMasterBpm(bpm)` в `host/` (один экспорт), которым пользуются `audio-panel.js` и `MidiFollow`-политика; `tempoFrom(n, bpm)` — всегда ставит мастер и `w.tempo.set(bpm)` у всех миров с `tempo` (без флага `link.clock`).

- [ ] **Step 1: Тест (красный)** в `tools/test-follow.mjs` или новом `tools/test-master-tempo.mjs`: `tempoFrom(3, 133)` шлёт мастеру 133 и вызывает `set(133)` у всех зарегистрированных миров с `tempo`; `restore` мира мастер не трогает; флаг `link.clock` не существует.
- [ ] **Step 2: Реализовать** по списку Files; панель audio — одна подпись `N bpm`, без *all worlds*; `localStorage` `t2d-link` читать безопасно, ключ `clock` игнорировать.
- [ ] **Step 3: Тесты зелёные**, `node --check` изменённых файлов, `CACHE`/`?v=` совпадают.
- [ ] **Step 4: Коммит** `web: one master tempo, drop link.clock` (guard проверит версию).

### Task 4: Swift — один темп

Риск: обычный — UI/Swift под тестами.

**Files:**
- Modify: `ios/app/T2D/World.swift` (`WorldTempo`), `…Concordia.swift:18`, `…Host.swift:197`, `…CymaticaView.swift` (убрать отправку `Act.lock`), `…MidiClock.swift`/`MidiFollow.swift` (`setTempo` → мастер), связующий код хост-действий (найти `T2D_H_SCALE` в `ios/app`), `ios/app/T2D/Tests/TempoTests.swift`
- Test: `TempoTests`, `HostTests`, `MidiFollow*`

**Interfaces:**
- Consumes: C ABI `t2d_master_bpm(double)` / хост-действие `T2D_H_MASTER_BPM` из Task 1.
- Produces: `Host.setMasterBpm(_ bpm: Double)`; `WorldTempo.setBpm` во всех пяти мирах после своей модели зовёт его (через общий хелпер, не по месту).

- [ ] **Step 1: Тесты (красные):** `testSetBpmReachesMaster` (любой мир → мастер получил bpm, и остальные миры получили `setBpm`), `testNoLinkClockToggle` (в `Concordia` нет `link.clock`), `testCymaticaDoesNotSendLock`, `testMidiTempoSetsMaster`.
- [ ] **Step 2: Реализовать** по Files; тумблер *link clock* убрать из Concordia и панели audio.
- [ ] **Step 3: Полный прогон T2DTests на симуляторе iPhone 16** — 0 падений (в T6 было 887).
- [ ] **Step 4: Коммит** `ios: one master tempo`.

### Task 5: Документы

Риск: обычный — документация.

**Files:** `docs/worlds/horologium.md`, `docs/worlds/portus.md`, `docs/worlds/natura.md`, `docs/architecture.md` (раздел о темпе/concordia), `README.md`, `CLAUDE.md` (если строка «Сейчас» упоминает `link.clock`), `docs/tokens.md`

- [ ] **Step 1:** описать мастер-транспорт (сетка всегда on, перенимает MIDI, `MASTER_BPM`, зажим 40…200, пуск по сетке, что `restore`/кубик темп не меняют); убрать `link.clock` и `tempoFrom` с флагом из доков; пометка «на iPhone на слух не проверено».
- [ ] **Step 2:** строка в `docs/tokens.md` (`python3 tools/tokens.py --line`).
- [ ] **Step 3: Коммит** `docs: master transport`. Пуш — отдельно, по просьбе автора.

---

**Самопроверка по спеке:** §1 — T1; §2 — T1; §3 — T2; §4 — T3, T4; §5 — T3, T4; §6 — T1, T2 (краевые) ; §7 — тесты в T1–T4.

# iOS фаза 5 — системное: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** нативное приложение звучит вместе с другими, не гасит экран и ведомо внешними MIDI-часами (USB, Bluetooth, сеть) в фоне.

**Architecture:** байты реального времени CoreMIDI → своё кольцо `core/app` → аудиопоток переводит mach-время в секунды ядра и зовёт
`t2d_midi_byte`; события часов и сетка — обратно кольцом / `Triple`. Политика миров (`MidiFollow`, порт `host/midi.js`) — на таймере
главной очереди 25 мс, миры-секвенсеры — через переходник `WorldTempo`.

**Tech Stack:** C++17 (`core/app`), Swift 5 / UIKit / CoreMIDI / AVFAudio, XcodeGen, XCTest, `core/build.sh` + `sdk-test`.

**Spec:** `docs/superpowers/specs/2026-11-04-ios-phase5-system-design.md`

## Global Constraints

- Миры заморожены: звук и поведение миров не меняются; переходники — только к уже существующим действиям.
- Ядро (`t2d_*`) зовёт только аудиопоток; каждое кольцо `core/app` — один писатель, один читатель (`core/app/engine.hpp`).
- `core/app` в `t2d.wasm` не идёт: коммит только с правкой `core/app` — с `[no-wasm]` в заголовке. `core/sdk/`, `core/host/`, `core/bridge/` не меняются.
- Новый файл верхнего уровня `T2D/X.swift` — в `ios/app/project.yml` `T2DTests.sources` (l.61); `T2D/Host/*` подхватывается сам. После правки `project.yml` — `xcodegen` в `ios/app`.
- Тесты iOS: `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16'` (имя — по `xcrun simctl list devices available`); ядро: `core/build.sh && core/build/sdk-test` → `0 failed`. Гонять через агента test-runner.
- Только байты ≥ 0xF8 (Clock, Start, Continue, Stop); Song Position — нет. `TEMPO_EPS = 0.3` BPM, темп округлён до 0.1.
- `midi clock` по умолчанию выключен. Сессия — `.playback` с `[.mixWithOthers]`; Now Playing / remote commands — не делаем.
- Коммиты — по-английски, тело-список, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Веб не меняется — `CACHE`/`?v=` не трогать.

## Review Focus

1. Время события далеко от блока (`host_time == 0` у блока, mach из другого сеанса, > 1 с от начала блока) — событие идёт временем начала блока, сетка не уезжает в будущее (тест — задача 1).
2. Elektron шлёт часы в остановке и 2–3 Stop подряд — без Start никто не стартует, повтор Stop не стирает «кто играл» (тесты — задача 5).
3. Фон: кадров нет, `now` вида не идёт — переходник с `refresh(now:)` видит свежее зеркало, своё (`own`) значение протухает как на кадрах (тест — задача 4).
4. `midi clock` выключили, пока часы шли — таймер стоит, Cymatica получает `LOCK` выкл., миры играют дальше своим темпом (тест — задача 6).
5. Rytm пропал с USB и вернулся (~6 с после блокировки) — переподключение по уведомлению не плодит двойных подключений одного источника (проверка — задача 3: `connectAll` сначала отключает прежние).

---

### Task 1: ядро приложения — MIDI в ядро, события и сетка обратно

Риск: высокий — realtime-аудио, новое SPSC-кольцо между потоком CoreMIDI и аудиопотоком, C++.

**Files:**
- Modify: `core/app/t2d_app.h` (объявления + `midi_lost` в `t2d_app_stats_t`, строка «кто что зовёт»: поток CoreMIDI — только `t2d_app_midi`)
- Modify: `core/app/engine.hpp`, `core/app/engine.cpp` (`init`, `renderBlock`, `publishSnapshots`, `stats`), `core/app/t2d_app.cpp`
- Test: `core/tests/sdk_test.cpp` (новые `appMidi*`, вызов из `main`)

**Interfaces:**
- Produces (C):
  - `int t2d_app_midi(int src, int status, uint64_t host_time);` — поток CoreMIDI; 1 — принято, 0 — кольцо полно (`midi_lost++`).
  - `int t2d_app_hevents(double* buf, int cap);` — UI: забрать события подряд (пары код, bpm; коды `sdk::Follower::Ev`: 1 START, 2 STOP, 3 TEMPO, 4 BEAT, 5 LAUNCH), длина.
  - `int t2d_app_grid(double* out4);` — UI: последний снимок `t2d_hmirror` (on, t0, p, время блока), 4.
  - `unsigned midi_lost` — новое поле в конце `t2d_app_stats_t`.
- Внутри: `struct Midi { int src, status; uint64_t mach; }`, `Spsc<Midi, 512> midi_`; `Spsc<double, 256> hev_` (теряется — `hev_lost`, отдельно не публикуется); `Triple<Grid> gridSnap_` (`struct Grid { double d[4]; }`).

- [ ] **Step 1: failing tests** в `sdk_test.cpp`:
  - `appMidiClock`: `t2d_app_init(48000,1,1e9,0)`; `t2d_app_midi(0,0xFA,host0)`; затем 0xF8 каждые 0.5/24 с (120 BPM) с mach = нс от `host0`, блоками по 128 сэмплов с `host_time` = нс начала блока; после ≥ 2 долей: `t2d_app_grid` → `on == 1`, `|p − 0.5| < 1e-3`; `t2d_app_hevents` содержит 1 (START), 5 (LAUNCH), 4 (BEAT) с `|bpm − 120| < 0.5`; потом 0xFC → 2 (STOP).
  - `appMidiTime`: событие с mach на 10 мс раньше `host_time` блока даёт `t0` сетки ровно на 10 мс раньше начала блока (±1 сэмпл); `mach == 0` и `host_time == 0` у блока и `|mach − host| > 1 с` — время начала блока.
  - `appMidiOverflow`: 513 записей без рендера → 512 приняты, `midi_lost == 1`; `t2d_app_init` чистит кольцо (после init `hevents` пуст, `grid` on == 0).
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` — новые тесты FAIL (нет символов / ассерты).
- [ ] **Step 3: implement.** В `renderBlock` до `t2d_time`: `while (midi_.pop(m))` → `at = samplesDone_/sr_ + (double(m.mach) − double(host)) / ticksPerSec_`, при `m.mach == 0 || host == 0 || |Δ| > 1 с` — `at = samplesDone_/sr_`; `t2d_midi_byte(m.src, m.status, at)`. После `t2d_process`: `n = t2d_hevents()` → копия из `t2d_mbuf()` в `hev_` сразу (общий буфер). В `publishSnapshots`: `t2d_hmirror()` → `gridSnap_.write()/publish()`. `init` чистит `midi_`, `hev_`, `gridSnap_`.
- [ ] **Step 4:** `core/build.sh && core/build/sdk-test` → `0 failed`.
- [ ] **Step 5: commit** `[no-wasm] core/app: MIDI realtime ring, clock events and grid for the native UI`.

### Task 2: аудиосессия со смешиванием и экран без сна

Риск: обычный — две опции системы, без новых потоков.

**Files:**
- Modify: `ios/app/T2D/Audio.swift` (l.68 и l.129), `ios/app/T2D/App.swift` (l.78–79)
- Test: `ios/app/T2DTests/AudioPlanTests.swift`

**Interfaces:**
- Produces: `extension Audio { static let category: AVAudioSession.Category = .playback; static let options: AVAudioSession.CategoryOptions = [.mixWithOthers] }` — оба `setCategory` берут их.

- [ ] **Step 1: failing test** `testSessionMixesWithOthers`: `XCTAssertEqual(Audio.category, .playback); XCTAssertTrue(Audio.options.contains(.mixWithOthers)); XCTAssertFalse(Audio.options.contains(.duckOthers))`.
- [ ] **Step 2:** тест FAIL (нет `Audio.options`).
- [ ] **Step 3:** оба `setCategory(Audio.category, options: Audio.options)`. `App.swift`: `UIApplication.shared.isIdleTimerDisabled = true` в `.onAppear` и в `.onReceive(UIApplication.didBecomeActiveNotification)`. Комментарий у `observe()`: со смешиваемой сессией старт в фоне не даёт `'!int'`.
- [ ] **Step 4:** тесты iOS зелёные.
- [ ] **Step 5: commit** `ios/app: mixable playback session, screen stays on`.

### Task 3: CoreMIDI-вход

Риск: высокий — поток CoreMIDI, колбэки уведомлений, внешний ввод.

**Files:**
- Create: `ios/app/T2D/Midi.swift`
- Modify: `ios/app/project.yml` (properties l.34–50: `NSBonjourServices: [_apple-midi._udp]`, `NSLocalNetworkUsageDescription` — «Logs to the developer Mac and network MIDI clock»; `T2DTests.sources` + `T2D/Midi.swift`)
- Test: `ios/app/T2DTests/MidiTests.swift`

**Interfaces:**
- Consumes: `t2d_app_midi` (задача 1).
- Produces:
  - `func umpRealtime(_ words: UnsafeBufferPointer<UInt32>) -> [UInt8]` — статусы ≥ 0xF8 из слов UMP типа 1 (`w >> 28 == 1`, `status = (w >> 16) & 0xFF`); прочие типы и статусы < 0xF8 (в т. ч. 0xF2 SPP) — мимо.
  - `final class Midi { init(feed: @escaping (Int, UInt8, UInt64) -> Void); var on: Bool { get set } }` — `on = true`: клиент, вход, `MIDINetworkSession.default()` `isEnabled = true`, `.anyone`, `connectAll()`; `on = false`: отключить источники, `isEnabled = false`. `feed` по умолчанию — `t2d_app_midi(Int32(src), Int32(status), mach)`; mach — `packet.timeStamp`, 0 → `mach_absolute_time()`.
- Bluetooth MIDI: спаренный в системе (или другим приложением) прибор — обычный источник CoreMIDI; своего окна спаривания нет.
- Порт `ios/shell/Shell/Midi.swift` (клиент, сеть, приём) без разбора часов и без `lead`. `refCon` источника — его номер `k % 8` (`UnsafeMutableRawPointer(bitPattern: k + 1)`, 0 у CoreMIDI = nil). Уведомление (`msgSetupChanged`, `msgObjectAdded`, `msgObjectRemoved`) → `connectAll()` на главной очереди; `connectAll()` сначала отключает все прежние подключения (`MIDIPortDisconnectSource`), затем подключает текущие.

- [ ] **Step 1: failing tests** `MidiTests`: `testUmpRealtimeKeepsClockStartStopContinue` (слова `0x10F80000`, `0x10FA0000`, `0x10FB0000`, `0x10FC0000` → `[0xF8,0xFA,0xFB,0xFC]`); `testUmpRealtimeDropsNotesSysexSpp` (`0x20903C7F` нота, `0x10F21000` SPP, `0x30160000` SysEx → `[]`); `testMidiOffByDefault` (`Midi(feed:{_,_,_ in}).on == false`).
- [ ] **Step 2:** тесты FAIL (нет `umpRealtime`, `Midi`).
- [ ] **Step 3:** реализация, как в Interfaces.
- [ ] **Step 4:** тесты iOS зелёные; сборка приложения проходит.
- [ ] **Step 5: commit** `ios/app: CoreMIDI realtime input (USB, Bluetooth, network) into the core ring`.

### Task 4: `WorldTempo` у миров-секвенсеров

Риск: обычный — переходники к существующим действиям, тесты на фейковом ядре.

**Files:**
- Modify: `ios/app/T2D/World.swift` (протокол l.22–50, расширение l.52–61)
- Modify: `ios/app/T2D/Portus/PortusView.swift`, `Natura/NaturaView.swift`, `Cymatica/CymaticaView.swift` (+ `Cymatica/CymMath.swift`: `Act.lock = 4`), `Monochord/MonochordView.swift`, `Horologium/HorologiumView.swift`
- Test: `ios/app/T2DTests/TempoTests.swift`

**Interfaces:**
- Produces:
  ```swift
  struct MidiGrid: Equatable { var t0, p: Double }               // секунды ядра
  protocol WorldTempo: AnyObject {
    func refresh(now: Double)        // вне кадра: свежее зеркало мира и его now (фон — кадров нет)
    var bpm: Double { get }
    func setBpm(_ bpm: Double)
    func play(_ on: Bool)
    var playing: Bool { get }
    var armed: Bool { get }
    func grid(_ g: MidiGrid?)        // сетка часов; по умолчанию ничего (нужна только Cymatica)
  }
  ```
  `World`: `var tempo: WorldTempo? { get }`, по умолчанию `nil`; пять видов — `var tempo: WorldTempo? { self }`.
- По мирам (коды — `Act` вида): Portus — play `13 [on]`, bpm `10 [bpm]`, armed — есть остров (`isle(j).on`, `j < Por.nstep`); Natura — play `1`, bpm `21`, armed — есть пад (`pad(i).on`, `i < Nat.npad`); Cymatica — play `8`, bpm `14`, armed — `rhythm[i].on` для `i < rlen`; `grid(g)` шлёт `Act.lock` `[0, t0, p]` / `[1, 0, 0]` только при смене (как `syncLock` в `worlds/cymatica/engine.js`), время — без перевода; Monochordum — play `Act.auto [on]`, bpm `Act.autopar i=1 [bpm]`, playing — `mirror.auto[0] != 0`, bpm — `mirror.auto[1]`, armed — `false`; Horologium — play(true) `Act.run [1, mirror.u]`, play(false) — то же, что веб `model.stop()` (`worlds/horologium/model.js`), bpm `Act.bpm [bpm]`, playing — `mirror.run`, armed — есть `mirror.rings[i].on`.
- `refresh(now:)` = то, что `tick` делает с зеркалом (`readMirror` → `mirror.load`), плюс `self.now = now`; у Monochord и Horologium — новый внутренний метод `pullMirror()`, его же зовёт `tick`.

- [ ] **Step 1: failing tests** `TempoTests` (фейковый `Core`, пишущий действия, и `Reader`, отдающий заданное зеркало): на каждый мир `play(true)` → ровно одно действие с кодом и `[1]` из списка; `setBpm(97)` → код темпа и `[97]`; `armed` ложно на пустом зеркале и истинно с одним островом / падом / шагом / кольцом; Cymatica `grid` дважды с той же сеткой → один `LOCK`, `nil` → `[1,0,0]`; фон: `play(true)`, затем `refresh(now: now + 5)` с зеркалом `playing = false` → `playing == false` (своё значение протухло).
- [ ] **Step 2:** тесты FAIL.
- [ ] **Step 3:** реализация по Interfaces.
- [ ] **Step 4:** тесты iOS зелёные (в т. ч. прежние тесты пяти миров).
- [ ] **Step 5: commit** `ios/app: WorldTempo adapters for the sequencer worlds`.

### Task 5: `MidiFollow` — политика часов

Риск: обычный — чистая логика без потоков, тесты — зеркало `tools/test-midi.mjs`.

**Files:**
- Create: `ios/app/T2D/Host/MidiFollow.swift`
- Test: `ios/app/T2DTests/MidiFollowTests.swift`

**Interfaces:**
- Consumes: `WorldTempo` (задача 4).
- Produces:
  ```swift
  final class MidiFollow {
    init(worlds: @escaping () -> [WorldTempo], here: @escaping () -> WorldTempo?)
    func events(_ ev: [Double])      // пары (код, bpm), коды 1…5 как t2d_app_hevents
    func scan()                      // мир пошёл не от службы — запускали руками (joined)
    func reset()                     // midi clock выключен: забыть stopped
  }
  ```
- Порт `host/midi.js` `createMidi` (l.25–99) один в один: `joined` / `was` / `stopped` по `ObjectIdentifier`; tempo и beat → `setTempo` (bpm ≤ 0 — ничего; округление до 0.1; `|b − cur| > 0.3` → `setBpm`); stop → `scan`, играющие — `play(false)`, `stopped` заменяется только непустым набором; launch → `scan`, условие `joined || playing || stopped || (w === here && armed)`, играющий — `play(false)` затем `play(true)`, потом `stopped` пуст; start — ничего (ждём launch).

- [ ] **Step 1: failing tests** — по случаю на тест `tools/test-midi.mjs` l.43, 54, 67, 76, 88, 96, 106, 115, 162, 171 (политика; сетка и разбор — в ядре, задача 1), имена — `test` + английское название в camelCase, ожидания — те же вызовы `play` / `setBpm` на фейковых мирах `fake(bpm:playing:armed:)`.
- [ ] **Step 2:** тесты FAIL.
- [ ] **Step 3:** реализация.
- [ ] **Step 4:** тесты iOS зелёные.
- [ ] **Step 5: commit** `ios/app: MidiFollow - clock policy ported from host/midi.js`.

### Task 6: хост, строка `midi clock`, таймер; доки

Риск: обычный — главный поток, настройки и UI; потоки — в задачах 1 и 3.

**Files:**
- Modify: `ios/app/T2D/Host/Mix.swift` (`AudioPref`: `var midi = false`, декодирование старого `prefs.json` без поля — `false`), `Host/HostCore.swift` (+ `hevents() -> [Double]`, `grid() -> MidiGrid?`; `AppHostCore` — через `t2d_app_hevents` / `t2d_app_grid`), три фейка (`UndoTests.swift:5`, `MeterTests.swift:10`, `HostTests.swift:11`)
- Modify: `Host/AudioPanel.swift` (`Key.midi`, строка `"midi clock"` после `stable audio`, рисуется как `stable` — кружок, точка при вкл.), `Host/Host.swift` (`panelDown(.midi)` → `toggleMidi()`; draw передаёт `midi:`), `Host/Concordia.swift` (подпись `clock` → `midi clock`, пока `grid() != nil`)
- Create: `ios/app/T2D/Host/MidiClock.swift` — таймер
- Modify: `ios/app/T2D/App.swift` (создать `Midi`, `h.onMidi = { midi.on = $0 }`, начальное `midi.on = h.audioPref.midi`)
- Modify docs: `docs/native-ios-plan.md` (статус фазы 5), `docs/testing.md` (новые тесты, проверка на iPhone), `docs/ios-2b-deferred.md` (строка `midi clock` больше не скрыта), `docs/tokens.md` (строка)
- Test: `ios/app/T2DTests/HostTests.swift`, `MidiClockTests.swift`

**Interfaces:**
- Consumes: `MidiFollow` (5), `WorldTempo` / `MidiGrid` (4), `t2d_app_hevents` / `t2d_app_grid` (1), `Midi.on` (3).
- Produces:
  - `Host.toggleMidi()` — `audioPref.midi.toggle(); markPrefs(); savePrefs(); onMidi?(audioPref.midi)`; `var onMidi: ((Bool) -> Void)?`.
  - `final class MidiClock { init(core: HostCore, follow: MidiFollow, worlds: @escaping () -> [WorldTempo]); func step(now: Double); var on: Bool { get set } }` — `step`: каждому миру `refresh(now:)`; `follow.events(core.hevents())`; `grid = core.grid()` → `grid(_:)` всем; `follow.scan()`. `on = true` — `DispatchSourceTimer` на главной очереди, 25 мс, зовёт `step(now: Clock.now)`; `on = false` — таймер снят, всем `grid(nil)`, `follow.reset()`. `Host` держит `MidiClock`, `here` — `world?.tempo`.

- [ ] **Step 1: failing tests:** `HostTests.testMidiRowTogglesAndPersists` (тап по строке `midi clock` → `audioPref.midi == true`, `onMidi` позван с `true`, в `prefs.json` `midi: true`; старый `prefs.json` без поля — `false`); `MidiClockTests.testStepFeedsEventsAndGrid` (фейк `HostCore` отдаёт `[1,0, 5,120, 4,120]` и сетку → мир на экране с `armed` получает `play(true)`, `grid` с сеткой); `testOffUnlocksAndForgets` (`on = false` → у мира `grid(nil)`, затем `stop`-набор пуст: следующий launch не запускает прежде остановленный мир, который не свой).
- [ ] **Step 2:** тесты FAIL.
- [ ] **Step 3:** реализация + `App.swift`.
- [ ] **Step 4:** тесты iOS зелёные; `ios/app/shot.sh audio` — строка `midi clock` видна (снимок смотрит агент shots).
- [ ] **Step 5:** доки (см. Files), строка в `docs/tokens.md` (`python3 tools/tokens.py --line`).
- [ ] **Step 6: commit** `ios/app: midi clock row, MidiClock timer, host wiring; docs` → push → `python3 tools/deploy-wait.py`.

---

После задачи 6 — финальный `/code-review` всей ветки от `b5c0609`.

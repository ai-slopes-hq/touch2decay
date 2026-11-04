# iOS-приложение — фаза 5: системное (сессия, экран, MIDI-часы)

Дата: 04.11.2026. Ветка `native`. План фаз — `docs/native-ios-plan.md`, «5. Системное». Решения автора — 04.11 (ниже).

## Цель

Нативное приложение играет как инструмент рядом с железом: звучит вместе с другими приложениями, в фоне и при заблокированном
экране, поднимается само после звонка или Siri, экран не гаснет, миры-секвенсеры ведомы внешними MIDI-часами (Analog Four,
Analog Rytm) по USB, Bluetooth и сети — как веб-оболочка 23.10 (Start / Stop / темп / фаза проверены там на iPhone).

## Решения (автор, 04.11)

- **Звучим всегда вместе с другими** (`.mixWithOthers`). Следствие: нет плашки Now Playing и кнопок экрана блокировки / наушников —
  iOS не отдаёт их смешиваемой сессии. Ответ «пауза = остановить звук» записан на случай, если переключим; в эту фазу кнопок нет.
- **MIDI: все источники CoreMIDI** — USB, Bluetooth, сетевая сессия (Wi-Fi). Только байты реального времени (≥ 0xF8): Clock,
  Start, Continue, Stop. Song Position Pointer — не берём.
- Подход к байтам MIDI — **A**: своё кольцо в `core/app`, разбор часов — в ядре (`ClockParser`, `Follower`), как в вебе.
  Отвергнуты: B — через главный поток и кольцо действий (48 сообщений/с через поток кадра — то, что лагало в оболочке);
  C — разбор в Swift, как в `ios/shell` (второй разбор рядом с ядерным, против «блок есть в ядре — брать его»).

## Ограничения

- Миры заморожены: звук и поведение миров не меняются. Переходники `tempo` в Swift — только к уже существующим действиям миров.
- Ядро (`t2d_*`) трогает только аудиопоток; каждое кольцо `core/app` — один писатель, один читатель (`engine.hpp`).
- `core/app` в `t2d.wasm` не идёт — коммиты с правкой только там помечать `[no-wasm]`. `core/sdk/`, `core/host/` не меняются.
- Новые файлы Swift — в `project.yml` (цель приложения и `T2DTests.sources`).
- iPhone — только у автора; всё, что не снято на iPhone, так и пишем.

## Источник истины

| Что | Где |
|---|---|
| Разбор часов, сетка, события | `core/sdk/transport.hpp`, `core/host/host.cpp:50-81` (`midiByte`, `follow`, `events`) |
| Политика миров (темп, Stop, launch) | `host/midi.js` `createMidi` — эталон для Swift; тесты `tools/test-midi.mjs` |
| Сетка в мирах | ядро: Portus, Natura (`steps_.run(…, clk_->grid, …)`), Monochordum, Horologium (`lock` к такту); Cymatica — `LOCK` из хоста (`worlds/cymatica/engine.js` `syncLock`, `bridge.js` `lock`) |
| CoreMIDI | `ios/shell/Shell/Midi.swift` (клиент, сеть, переподключение) |
| Аудиосессия | `ios/app/T2D/Audio.swift` (`AudioPlan`, наблюдатели) |
| Строка `midi clock` | `host/audio-panel.js:15`, `host/webmidi.js` (`audioPref.midi`), `host/concordia.js:47` |

## Часть 1. Аудиосессия и экран

- `Audio.start()`: `setCategory(.playback, options: [.mixWithOthers])`; остальное как есть (буфер stable, `observe()` после
  активации). `mediaServicesWereReset` — та же категория с опцией.
- Конец прерывания в фоне: ветка `interruptionEnded` уже делает `setActive(true)` и пересборку; со смешиваемой сессией
  `'!int'` не бывает — звук поднимается без возврата в приложение. Проверка — на iPhone (звонок при заблокированном экране).
- Экран не гаснет: `UIApplication.shared.isIdleTimerDisabled = true`, пока приложение активно (ставить на `didBecomeActive`
  и при старте; iOS сама снимает в фоне).

## Часть 2. Ядро приложения: MIDI в ядро и события обратно

Новое в `core/app/t2d_app.h` / `engine.{hpp,cpp}` / `t2d_app.cpp`:

- `int t2d_app_midi(int src, int status, uint64_t host_time)` — **поток CoreMIDI (один!)**: запись `(src, status, mach)` в новое
  кольцо `Spsc<Midi, 512>`; 0 — не влезло (счётчик `midi_lost` в `t2d_app_stats_t`).
- Аудиопоток, `renderBlock`, до `t2d_time`/рендера блока: забрать кольцо MIDI; время события в секундах ядра
  `at = samplesDone_/sr_ + (mach − host_time блока) / ticksPerSec_` (тот же `host_time`, что приходит в `t2d_app_render`;
  событие из прошлого — `at` меньше начала блока, ядро это понимает, как `ago` в вебе); `mach == 0` — время начала блока;
  вызвать `t2d_midi_byte(src, status, at)`.
- После рендера блока: `t2d_hevents()` (пары код, bpm) — в кольцо аудио → UI (`Spsc<double, 256>`, теряется — считается);
  `t2d_hmirror()` (сетка есть, t0, p, время блока) — снимок для UI тем же способом, что зеркала миров.
- UI: `int t2d_app_hevents(double* buf, int cap)` — забрать события подряд, длина; `int t2d_app_grid(double* out4)` — последний
  снимок сетки (on, t0, p, время блока), 4.
- `t2d_app_init` чистит и эти кольца.

## Часть 3. CoreMIDI (`ios/app/T2D/Midi.swift`)

Порт `ios/shell/Shell/Midi.swift` без разбора часов:

- `MIDIClientCreateWithBlock`; по уведомлению (`msgSetupChanged`, добавлен / убран объект) — переподключить все источники
  (Rytm пропадает с USB ~6 с после блокировки и возвращается).
- Вход `MIDIInputPortCreateWithProtocol(._1_0)`; каждый источник подключается с `refCon` = его номер `k % 8` → `src`.
- Сеть: `MIDINetworkSession.default()`, `isEnabled = true`, `connectionPolicy = .anyone`. `project.yml`: `NSBonjourServices`
  `[_apple-midi._udp]`, `NSLocalNetworkUsageDescription` — переписать (логгер и сетевой MIDI).
- Приём (поток CoreMIDI): слова UMP типа 1 (системные), `status = (w >> 16) & 0xFF`, только ≥ 0xF8 → `t2d_app_midi(src,
  status, packet.timeStamp)`. Разбор слов — чистая функция (`umpRealtime(words) -> [UInt8]`), тестируется без CoreMIDI.
- Включение — строкой `midi clock` (часть 5); выключено — клиента нет, сеть выключена (`isEnabled = false`), источники отключены.
  По умолчанию выключено, как в вебе (запрос «локальная сеть» — только когда автор сам включил).

## Часть 4. Политика миров (`ios/app/T2D/Host/MidiFollow.swift`)

- Протокол `WorldTempo` (как `tempo` в вебе): `bpm: Double`, `setBpm(_:)`, `play(_ on: Bool)`, `playing: Bool`, `armed: Bool`;
  у `World` — `var tempo: WorldTempo? { get }` (по умолчанию `nil`). Переходники у Portus, Natura, Cymatica, Monochordum
  (`auto`), Horologium (`run` / `stop`) — на их существующие действия, `armed` — как в `worlds/<мир>/index.js`
  (Portus — острова есть, Natura — пады, Cymatica — ритм не пуст, Horologium — кольцо включено, Monochordum — `false`).
- `MidiFollow` — порт `createMidi` (`events`, `scan`, `setTempo`): `TEMPO_EPS = 0.3`, темп округлён до 0.1; Stop — играющие
  останавливаются и запоминаются, пустой повтор Stop набор не затирает; launch — свои (`joined`: запускали руками в сессии),
  играющие (перезапуск с доли), остановленные прошлым Stop, мир на экране, если `armed`; сбойный мир не мешает остальным.
  Чистый тип (миры — через протокол), тесты — зеркало `tools/test-midi.mjs` по политике.
- Кто зовёт: таймер главной очереди 25 мс (как `T.onTick` в вебе), **не** кадр — `CADisplayLink` в фоне стоит, а часы должны
  работать при заблокированном экране. Шаг таймера: `t2d_app_hevents` → `MidiFollow.events`, затем `scan`. Переходники читают
  свежее зеркало своего мира (в фоне кадров нет, зеркало само не обновится).
- Cymatica: шаг таймера сверяет сетку (`t2d_app_grid`) с отправленной и при смене шлёт `LOCK` (`[0, t0, p]` / `[1, 0, 0]`) —
  как `syncLock`; время `t0` — уже секунды ядра (в вебе — `abs`, перевод контекста; здесь перевода нет). Порядок: сетка
  уходит раньше пуска (в вебе — `model.onAct(syncLock)`).
- Таймер живёт, пока `midi clock` включён; при выключении Cymatica получает `LOCK` выкл. (сетка пропала), `MidiFollow` сбрасывает `stopped`.

## Часть 5. Экран

- Панель audio: строка `midi clock` (вкл / выкл, как `stable audio`), значение в `prefs.json` (`audioPref.midi`).
- Concordia: подпись `clock` → `midi clock`, пока сетка есть (`t2d_app_grid` on), как `host/concordia.js:47`.
- Строка `tempo` панели и общий темп concordia — как есть (отдельный хвост, `docs/ios-2b-deferred.md`).

## Часть 6. Проверка

- Ядро: `EngineTests` — байты 0xF8 с mach-временем через `t2d_app_midi` → после рендера `t2d_app_grid` даёт сетку с периодом
  по темпу (24 тика на долю), Start → событие START в `t2d_app_hevents`, Stop → STOP; перевод mach → секунды ядра (событие из
  прошлого, `mach == 0`); переполнение кольца считается. Тест сначала красный.
- Swift: `umpRealtime` (Clock, Start, Stop, Continue проходят; ноты, SysEx, SPP — нет); `MidiFollow` — случаи `tools/test-midi.mjs`
  про политику (повтор Stop, launch только своих / играющих / остановленных / armed на экране, порог темпа); переходники миров —
  `play` шлёт нужное действие, `armed` по состоянию; Cymatica `LOCK` только при смене сетки; `Audio` — категория с опцией
  (через `AudioPlan` или выделенную чистую функцию).
- Симулятор: CoreMIDI-источников нет — проверить, что приложение стартует, строка `midi clock` переключается, сеть включается
  без падения; тесты 846+ зелёные.
- iPhone (автор): Analog Four по USB и по сети — Start / Stop / темп / фаза в Portus, Natura, Cymatica, Monochordum, Horologium,
  в том числе при заблокированном экране; повторный Stop; звонок при заблокированном экране — звук возвращается сам; другое
  приложение со звуком — звучим вместе; экран не гаснет.

## Вне фазы 5

Now Playing и кнопки экрана блокировки (смешиваемая сессия), многоканальный выход (S-4), ведущий режим, Song Position, общий темп
concordia и строка `tempo` панели, AUv3 (фаза 6).

## Открыто

- Ничего для автора. Подробности путей (`abs` у Cymatica, где держать таймер — `Host` или отдельный объект) — в плане.

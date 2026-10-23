# core — ядро звука на C++

Одно ядро на мир: собирается нативно (render-cli сейчас, iOS-приложение и AUv3 потом) и в WASM — его крутит AudioWorklet в вебе. План — `docs/native-plan.md`, фаза 0а — `docs/superpowers/specs/2026-10-22-native-0a-goetia-wasm-design.md`.

- `worlds/goetia/` — Goetia (bytebeat): звук (`goetia.cpp`, порт прежнего `goetia-worklet.js`), модель (`model.cpp`), мир SDK (`world.cpp`: эхо на `sdk::TapeEcho`, шина); в вебе — внутри `t2d.wasm` (слот 15); эталон звука — `tools/ref/goetia-worklet.js`, модели — `tools/ref/goetia-model.js`, шины и эха — `busRef` в `tools/goetia-scenarios.mjs`.
- `worlds/firmamentum/` — Firmamentum (пульсарный синтез): модель (`model.cpp`), звук (`sound.cpp`), мир SDK (`world.cpp`); в вебе — внутри `t2d.wasm`; эталон звука — `tools/ref/pulsar-worklet.js` (тот же JS, но со своим генератором случайных чисел с зерном — иначе не с чем сверять), эталон модели — `tools/ref/firmamentum-model.js`.
- `worlds/monochord/` — Monochordum (Карплус — Стронг): звук (`sound.cpp`, порт прежнего `monochord-worklet.js`), модель (`model.cpp`), мир SDK (`world.cpp`: дека, хор, посыл, автострам на `sdk::Steps`); в вебе — внутри `t2d.wasm` (слот 7); эталоны — `tools/ref/monochord-worklet.js` (ГСЧ с зерном), `monochord-model.js`, `monochord-engine.js` (шина Web Audio).
- `sdk/` — блоки (фильтры, задержки, эхо `TapeEcho`, струна `KsLoop`, хор `Chorus`, панорамы `panLin` / `panEq` / `PanStereo`, `Rng`, ревербы `room` / `plate` / `hall` / `cathedral`), транспорт (`transport.hpp`: разбор MIDI-часов `ClockParser`, сетка `Follower`, шагомер секвенсера `Steps`) и интерфейс мира `World` (`attach` — часы хоста); `host/` — хост ядра (миры, посылы после фейдера, четыре общих ревербера, лад, время блока, MIDI-часы — одна сетка на все миры, события часов для веба); `bridge/wasm.cpp` — вход `t2d.wasm`. Миры на Web Audio шлют в ревербы хоста через `T.send(rev)` (`host/audio.js`) — своего зала у них нет.
- `worlds/oceanus/` — Oceanus (сканирующий синтез): звук (`ocean.cpp`, порт прежнего `ocean-worklet.js`), модель (`model.cpp`), мир SDK (`world.cpp`); в вебе — внутри `t2d.wasm` (слот 8); эталон звука — `tools/ref/ocean-worklet.js` (тот же JS со своим генератором случайных чисел с зерном), модели — `tools/ref/oceanus-model.js`.
- `render-cli/` — офлайн-рендер по текстовому сценарию (stdin) в float32 (stdout), для сверки с JS.

## Сборка

```
core/build.sh
```

Собирает `core/build/render-cli`, `core/build/sdk-test` и `t2d.wasm` (в корень репозитория, рядом с `t2d-worklet.js`; он лежит в git — страница без сборщика). Нужны Apple clang (Xcode) или любой clang++ с C++17 и emscripten (`brew install emscripten`; на Mac с Rosetta-терминалом — `arch -arm64 brew install emscripten`; в облачной сессии свежий emsdk не скачивается — подходит emscripten 3.1.6 из apt: `build.sh` сам берёт `TOTAL_STACK` вместо `STACK_SIZE`, своя ловушка `_Exit` в мосте не даёт libc++ притянуть импорт WASI). WASM — standalone, без импортов и рантайма emscripten: обёртка зовёт `_initialize`, затем `t2d_*`. Флаг `-ffp-contract=off` обязателен: иначе `a*b+c` склеивается в FMA и звук расходится с JS и WASM.

## Сверка

```
core/build.sh && node --test tools/test-goetia-core.mjs tools/test-firm-core.mjs tools/test-ocean-core.mjs tools/test-mono-core.mjs tools/test-transport.mjs
```

Сценарии — `tools/goetia-scenarios.mjs`: одни и те же сообщения в эталонный JS-worklet и в render-cli (звук), а ниже (`ACTS`) — действия модели в эталонный путь (JS-модель → сообщения прежнего engine → эталонный worklet → шина с эхом) и в `t2d.wasm` (слот 15): допуск 1e-6 на каждый сэмпл, на `t` и громкость духа, снимок — тот же JSON. Firmamentum — `tools/firm-scenarios.mjs`, `tools/test-firm-core.mjs` (эталон звука ↔ render-cli) и `tools/test-sdk.mjs` / `tools/test-t2d-worklet.mjs` (SDK и `t2d.wasm`), допуск 1e-6; случайность (jit, crepitus, fulgur, маска) идёт от зерна, его даёт engine (`processorOptions.seed`). Скорость (60 с, шесть звёзд, crepitus + fulgur): JS 1645 мс, WASM 107 мс — в ~15 раз (замер до переезда в `t2d.wasm`). Тест статистический, идёт около минуты. Oceanus — `tools/ocean-scenarios.mjs`, `tools/test-ocean-core.mjs`: то же, допуск 1e-6 на сэмплы, форму кольца `x` (64), `moon` и уровни голосов; зерно звука — зерно мира от хоста (`^ 0x85EBCA6B`). Скорость до переезда в `t2d.wasm` (60 с звука): JS 6819 мс, WASM 331 мс — в ~20 раз. Monochordum — `tools/mono-scenarios.mjs`, `tools/test-mono-core.mjs`: сухие струны (дека и хор ×0) против эталонного worklet — 1e-6 на сэмпл (на деле бит в бит), энергия струн и флажолетов каждый блок, снимок; автострам ядра — шаги по сэмплу, swing, деления, сетка MIDI. Шина (дека, хор) против прежнего Web Audio — `tools/mono-bus.py` в браузере (OfflineAudioContext): RMS ± 0.0004 дБ. Скорость (6 с): JS-worklet 1.4 с, `t2d.wasm` целиком (хост, 4 мира) 0.33 с. Транспорт — `tools/test-transport.mjs`: одни и те же байты MIDI-часов в прежний JS (`tools/ref/midi.js`) и в ядро — та же сетка (1e-9) после каждого блока и запуск миров на той же доле. Тесты моделей Goetia, Oceanus и Monochordum (`tools/models/*.test.mjs`) идут дважды: против эталонной JS-модели и против ядра через фасад веба (`tools/models/sdk-facade.mjs`).

**Изменил ядро — пересобери `t2d.wasm` и закоммить его вместе с исходником.**

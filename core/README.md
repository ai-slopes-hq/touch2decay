# core — ядро звука на C++

Одно ядро на мир: собирается нативно (render-cli сейчас, iOS-приложение и AUv3 потом) и в WASM — его крутит AudioWorklet в вебе. План — `docs/native-plan.md`, фаза 0а — `docs/superpowers/specs/2026-10-22-native-0a-goetia-wasm-design.md`.

- `worlds/goetia/` — Goetia (bytebeat), порт `goetia-worklet.js`; эталон — `tools/ref/goetia-worklet.js`.
- `worlds/cymatica/` — Cymatica (этап 1): пластина и часы секвенсера (`plate.cpp`), мир SDK (`world.cpp`); эталон — `tools/ref/plate-worklet.js`, сверка — `tools/test-cym-core.mjs`. `build-wasi.sh` — запасная сборка `t2d.wasm` через wasi-sdk (без emscripten).
- `worlds/firmamentum/` — Firmamentum (пульсарный синтез): модель (`model.cpp`), звук (`sound.cpp`), мир SDK (`world.cpp`); в вебе — внутри `t2d.wasm`; эталон звука — `tools/ref/pulsar-worklet.js` (тот же JS, но со своим генератором случайных чисел с зерном — иначе не с чем сверять), эталон модели — `tools/ref/firmamentum-model.js`.
- `sdk/` — блоки (фильтры, задержки, `Rng`, ревербы `room` / `plate` / `hall` / `cathedral`) и интерфейс мира `World`; `host/` — хост ядра (миры, посылы после фейдера, четыре общих ревербера, лад); `bridge/wasm.cpp` — вход `t2d.wasm`. Миры на Web Audio шлют в ревербы хоста через `T.send(rev)` (`host/audio.js`) — своего зала у них нет. Что брать из SDK и что в него класть — `CLAUDE.md`, раздел «SDK звука».
- `worlds/oceanus/` — Oceanus (сканирующий синтез), порт `ocean-worklet.js`; эталон — `tools/ref/ocean-worklet.js` (тот же JS со своим генератором случайных чисел с зерном).
- `render-cli/` — офлайн-рендер по текстовому сценарию (stdin) в float32 (stdout), для сверки с JS.

## Сборка

```
core/build.sh
```

Собирает `core/build/render-cli`, `core/build/sdk-test`, `goetia.wasm`, `ocean.wasm` и `t2d.wasm` (в корень репозитория, рядом с `goetia-worklet.js`, `ocean-worklet.js` и `t2d-worklet.js`; он лежит в git — страница без сборщика). Нужны Apple clang (Xcode) или любой clang++ с C++17 и emscripten (`brew install emscripten`; на Mac с Rosetta-терминалом — `arch -arm64 brew install emscripten`). WASM — standalone, без импортов и рантайма emscripten: обёртка зовёт `_initialize`, затем `gt_*`. Флаг `-ffp-contract=off` обязателен: иначе `a*b+c` склеивается в FMA и звук расходится с JS и WASM.

## Сверка

```
core/build.sh && node --test tools/test-goetia-core.mjs tools/test-firm-core.mjs tools/test-ocean-core.mjs
```

Сценарии — `tools/goetia-scenarios.mjs`: одни и те же сообщения в эталонный JS-worklet, в обёртку над `goetia.wasm` и в render-cli, допуск 1e-6 на каждый сэмпл и метр. Там же замер скорости JS / WASM (Node, V8 — не Safari). Firmamentum — `tools/firm-scenarios.mjs`, `tools/test-firm-core.mjs` (эталон звука ↔ render-cli) и `tools/test-sdk.mjs` / `tools/test-t2d-worklet.mjs` (SDK и `t2d.wasm`), допуск 1e-6; случайность (jit, crepitus, fulgur, маска) идёт от зерна, его даёт engine (`processorOptions.seed`). Скорость (60 с, шесть звёзд, crepitus + fulgur): JS 1645 мс, WASM 107 мс — в ~15 раз (замер до переезда в `t2d.wasm`). Тест статистический, идёт около минуты. Oceanus — `tools/ocean-scenarios.mjs`, `tools/test-ocean-core.mjs`: то же, допуск 1e-6 на сэмплы, форму кольца `x` (64), `moon` и уровни `g`; зерно (начальное кольцо, толчки, порывы) даёт engine. Скорость (60 с звука): JS 6819 мс, WASM 331 мс — в ~20 раз.

**Изменил ядро — пересобери `goetia.wasm` / `ocean.wasm` / `t2d.wasm` и закоммить его вместе с исходником.**

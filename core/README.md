# core — ядро звука на C++

Одно ядро на мир: собирается нативно (render-cli сейчас, iOS-приложение и AUv3 потом) и в WASM — его крутит AudioWorklet в вебе. План — `docs/native-plan.md`, фаза 0а — `docs/superpowers/specs/2026-10-22-native-0a-goetia-wasm-design.md`.

- `worlds/goetia/` — Goetia (bytebeat), порт `goetia-worklet.js`; эталон — `tools/ref/goetia-worklet.js`.
- `worlds/firmamentum/` — Firmamentum (пульсарный синтез), порт `pulsar-worklet.js`; эталон — `tools/ref/pulsar-worklet.js` (тот же JS, но со своим генератором случайных чисел с зерном — иначе не с чем сверять).
- `worlds/oceanus/` — Oceanus (сканирующий синтез), порт `ocean-worklet.js`; эталон — `tools/ref/ocean-worklet.js` (тот же JS со своим генератором случайных чисел с зерном).
- `render-cli/` — офлайн-рендер по текстовому сценарию (stdin) в float32 (stdout), для сверки с JS.

## Сборка

```
core/build.sh
```

Собирает `core/build/render-cli`, `goetia.wasm`, `pulsar.wasm` и `ocean.wasm` (в корень репозитория, рядом с `goetia-worklet.js`, `pulsar-worklet.js` и `ocean-worklet.js`; он лежит в git — страница без сборщика). Нужны Apple clang (Xcode) или любой clang++ с C++17 и emscripten (`brew install emscripten`; на Mac с Rosetta-терминалом — `arch -arm64 brew install emscripten`). WASM — standalone, без импортов и рантайма emscripten: обёртка зовёт `_initialize`, затем `gt_*`. Флаг `-ffp-contract=off` обязателен: иначе `a*b+c` склеивается в FMA и звук расходится с JS и WASM.

## Сверка

```
core/build.sh && node --test tools/test-goetia-core.mjs tools/test-firm-core.mjs tools/test-ocean-core.mjs
```

Сценарии — `tools/goetia-scenarios.mjs`: одни и те же сообщения в эталонный JS-worklet, в обёртку над `goetia.wasm` и в render-cli, допуск 1e-6 на каждый сэмпл и метр. Там же замер скорости JS / WASM (Node, V8 — не Safari). Firmamentum — `tools/firm-scenarios.mjs`, `tools/test-firm-core.mjs`: эталон ↔ render-cli ↔ WASM, допуск 1e-6; случайность (jit, crepitus, fulgur, маска) идёт от зерна, его даёт engine (`processorOptions.seed`). Скорость (60 с, шесть звёзд, crepitus + fulgur): JS 1645 мс, WASM 107 мс — в ~15 раз. Тест статистический, идёт около минуты. Oceanus — `tools/ocean-scenarios.mjs`, `tools/test-ocean-core.mjs`: то же, допуск 1e-6 на сэмплы, форму кольца `x` (64), `moon` и уровни `g`; зерно (начальное кольцо, толчки, порывы) даёт engine. Скорость (60 с звука): JS 6819 мс, WASM 331 мс — в ~20 раз.

**Изменил ядро — пересобери `goetia.wasm` / `pulsar.wasm` / `ocean.wasm` и закоммить его вместе с исходником.**

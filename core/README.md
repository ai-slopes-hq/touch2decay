# core — ядро звука на C++

Одно ядро на мир: собирается нативно (render-cli сейчас, iOS-приложение и AUv3 потом) и в WASM — его крутит AudioWorklet в вебе. План — `docs/native-plan.md`, фаза 0а — `docs/superpowers/specs/2026-10-22-native-0a-goetia-wasm-design.md`.

- `worlds/goetia/` — Goetia (bytebeat), порт `goetia-worklet.js`; эталон — `tools/ref/goetia-worklet.js`.
- `render-cli/` — офлайн-рендер по текстовому сценарию (stdin) в float32 (stdout), для сверки с JS.

## Сборка

```
core/build.sh
```

Собирает `core/build/render-cli` и `goetia.wasm` (в корень репозитория, рядом с `goetia-worklet.js`; он лежит в git — страница без сборщика). Нужны Apple clang (Xcode) или любой clang++ с C++17 и emscripten (`brew install emscripten`; на Mac с Rosetta-терминалом — `arch -arm64 brew install emscripten`). WASM — standalone, без импортов и рантайма emscripten: обёртка зовёт `_initialize`, затем `gt_*`. Флаг `-ffp-contract=off` обязателен: иначе `a*b+c` склеивается в FMA и звук расходится с JS и WASM.

## Сверка

```
core/build.sh && node --test tools/test-goetia-core.mjs
```

Сценарии — `tools/goetia-scenarios.mjs`: одни и те же сообщения в эталонный JS-worklet, в обёртку над `goetia.wasm` и в render-cli, допуск 1e-6 на каждый сэмпл и метр. Там же замер скорости JS / WASM (Node, V8 — не Safari).

**Изменил ядро — пересобери `goetia.wasm` и закоммить его вместе с исходником.**

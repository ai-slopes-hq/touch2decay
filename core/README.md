# core — ядро звука на C++

Одно ядро на мир: собирается нативно (render-cli сейчас, iOS-приложение и AUv3 потом) и в WASM — его крутит AudioWorklet в вебе. План — `docs/native-plan.md`, фаза 0а — `docs/superpowers/specs/2026-10-22-native-0a-goetia-wasm-design.md`.

- `worlds/goetia/` — Goetia (bytebeat), порт `goetia-worklet.js`; эталон — `tools/ref/goetia-worklet.js`.
- `render-cli/` — офлайн-рендер по текстовому сценарию (stdin) в float32 (stdout), для сверки с JS.

## Сборка

```
core/build.sh
```

Нужен Apple clang (Xcode) или любой clang++ с C++17. Флаг `-ffp-contract=off` обязателен: иначе `a*b+c` склеивается в FMA и звук расходится с JS и WASM.

## Сверка

```
core/build.sh && node --test tools/test-goetia-core.mjs
```

Сценарии — `tools/goetia-scenarios.mjs`: одни и те же сообщения в эталонный JS-worklet и в ядро, допуск 1e-6 на каждый сэмпл.

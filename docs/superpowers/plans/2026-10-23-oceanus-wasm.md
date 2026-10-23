# Oceanus на ядре C++ → WASM — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** звук мира VIII (`ocean-worklet.js`) считает ядро `core/worlds/oceanus` (C++17) — в вебе `ocean.wasm`, звук для автора прежний.

**Architecture:** повтор пути Firmamentum один в один: эталон с ГСЧ на зерне → порт на C++ + render-cli → WASM и тонкая обёртка → engine, офлайн, документы. Образцы кода — файлы Firmamentum (ниже «образец»).

**Tech Stack:** C++17 (clang, emscripten standalone WASM), AudioWorklet, Node `node:test` + `vm`, Playwright (`tools/shot.py`).

**Spec:** `docs/superpowers/specs/2026-10-23-oceanus-wasm-design.md` (и через неё — `docs/superpowers/specs/2026-10-23-firmamentum-wasm-design.md`).

## Global Constraints

- Ветка `native`; не пушить — пушит контроллер.
- Только DSP: `worlds/oceanus/model.js`, `view.js` не меняются; Goetia и Firmamentum (`core/worlds/goetia|firmamentum`, их worklet и `.wasm`) — не меняются, их `.wasm` после `core/build.sh` побайтно те же.
- ГСЧ — mulberry32 из `core/common/rng.hpp`; в JS — тот же `rnd()`, что в `tools/ref/pulsar-worklet.js`; зерно — `processorOptions.seed` (нет — 1).
- Float32-хранение `x, v, a, b`: вычисление в `double`, запись `static_cast<float>`; `Math.round` → `jsRound`; пальцы — порядок вставки, обновление на месте, ≤ 16.
- Сборка `-std=c++17 -ffp-contract=off`; WASM — `-sSTANDALONE_WASM --no-entry -fno-exceptions -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0`, без импортов.
- Допуск 1e-6 — сэмплы, `x` (64), `moon`, `g` (6). Допуск не расширять.
- Протокол порта прежний: внутрь `params` / `push` / `splash` / `voice`, наружу `{t:'shape', x, moon, g}` + `ready` / `err`.
- Комментарии и документы — по-русски, в духе соседнего кода; коммиты — по-английски, тело — список, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Долгий статистический тест — в цикле правок пропускать `--test-skip-pattern "old worklet"`, полный прогон — один раз перед коммитом.

## Review Focus

1. Повторный `push` того же id обновляет палец на месте (порядок суммы не меняется) → сценарий `fingers` в задаче 1.
2. `voice` с `f: 0` или без `f` и `params` с частью полей — прежние значения, не `NaN`/0 → сценарии `partial` в задаче 1, тест обёртки в задаче 3.
3. Удар о потолок ±3 (сильный палец) — обнуление скорости, в float → сценарий `ceiling`.
4. Луна качает каждую цель (`swayTo` 0/1/2) при буре — `pm` меняет частоту всех голосов → сценарий `sway`.
5. 44.1 кГц и сообщения до готовности WASM → задача 3.

---

### Task 1: эталон и сценарии

**Files:** Create `tools/ref/ocean-worklet.js` (копия `ocean-worklet.js`: `constructor(options)`, `this.seed = (options?.processorOptions?.seed ?? 1) >>> 0` — **до** создания голосов, `rnd()` как в `tools/ref/pulsar-worklet.js`, все `Math.random()` → `this.rnd()`, шапка — «эталон для сверки ядра»); Create `tools/ocean-scenarios.mjs` (образец — `tools/firm-scenarios.mjs`); Create `tools/test-ocean-core.mjs` (образец — `tools/test-firm-core.mjs`).

**Interfaces — Produces:** `SR`, `BLOCK`, `SEED`, `N = 64`, `SCENARIOS`, `toScript(steps, sr, seed)`, `loadRef(seed, sr)`, `loadOld(i, sr)` (эталон с `proc.rnd` = xorshift32 от `i`, как в `firm-scenarios.mjs`), `play(proc, steps, posted, block)` → `{ L, R, meters: [{x, moon, g}] }` (из сообщений `shape`, массивы скопированы). `toScript` пишет `world oceanus`, `init <sr> <seed>`, `params` (все 9, слитые с прежними; начальные — из конструктора: kt 0.03, damp 0.002, kc 0.004, wind 0, tide 0.5, moonRate 0.04, storm 0, sway 0, swayTo 0), `push <id> <a> <d> <k>` (`k = d.k || 0.08`), `release <id>`, `splash <a> <amt>`, `voice <i> <on 1|0> <f> <lvl> <path>` (слитые: `f` — прежнее, если не истинно; начальные f 110, lvl 0.8, path 0), `run <блоков>`; числа — `toPrecision(17)`.

- [ ] **Step 1: Сценарии** (`PARAMS` как шлёт engine при fx по умолчанию: `{t:'params', kt: 0.004 * 60 ** 0.45, damp: 0.00003 * 300 ** 0.4, kc: 0.0015 + 0.004 * 0.55, wind: 0, tide: 0.55 * 0.9, moonRate: 0.005 * 40 ** 0.3, storm: 0, sway: 0, swayTo: 0}`; `voice(i, o) = {t:'voice', i, on: true, f: 110, lvl: 0.64, path: 0, ...o}`; 375 блоков ≈ 1 с): `one` (750); `six` (f 55…330, 375); `paths` (три голоса path 0/1/2, 375); `stiff` (kt и damp крайние: `0.004 * 60`, `0.00003 * 300`, затем `0.004`, `0.00003`; по 375); `tide` (tide 0.9, moonRate 0.2, 750); `sway` (storm 0.7, sway 0.6, по 375 на swayTo 0, 1, 2); `wind` (wind 0.8, 750); `fingers` (push id 1, затем id 2, затем повторный push id 1 с другим `d`, release 1, по 200); `splash` (два всплеска, 500); `relight` (голос on/off/on, затем 2000 тишины, on); `partial` (`{t:'voice', i:0, on:true}` без `f`, затем `f: 0`, затем `{t:'params', wind: 0.5}` только с одним полем; по 200); `ceiling` (push с `d: 2.5`, `k: 0.5` — до упора, 500); `all` (шесть голосов, storm, wind, sway, пальцы, всплески — 11250, 30 с).
- [ ] **Step 2: Тесты эталона:** `reference sounds` (`one`: RMS L > 0.01); `reference is deterministic` (`all`, первые 1000 блоков: то же зерно — побитово равно, `SEED + 1` — различается); `reference sounds like the old worklet` (`wind` и `sway`: RMS L и R по среднему 8 прогонов в пределах ±0.5 дБ).
- [ ] **Step 3:** `node --test tools/test-ocean-core.mjs` — PASS.
- [ ] **Step 4: Commit** «Oceanus core: seeded reference worklet and scenarios».

### Task 2: ядро C++ и render-cli

**Files:** Create `core/worlds/oceanus/ocean.hpp|.cpp` (образец — `core/worlds/firmamentum/pulsar.hpp|.cpp`); Modify `core/render-cli/main.cpp` (+ `world oceanus` и команды из задачи 1), `core/build.sh` (render-cli += `ocean.cpp`), `tools/test-ocean-core.mjs` (render-cli ↔ эталон по каждому сценарию, L и R, 1e-6; нет бинарника — `t.skip`).

**Interfaces — Produces** (`namespace oceanus`): `constexpr int N = 64, STEP = 16, VMAX = 6, PMAX = 16;` `class Ocean { Ocean(double sr, uint32_t seed); void params(double kt, double damp, double kc, double wind, double tide, double moonRate, double storm, double sway, double swayTo); void push(double id, double a, double d, double k); void release(double id); void splash(double a, double amt); void voice(int i, bool on, double f, double lvl, double path); void process(float* L, float* R, int n); const float* shape() const; double moon() const; double gain(int i) const; }` — номер голоса вне 0…5 — мимо; `R == nullptr` — моно.

- [ ] **Step 1:** тест render-cli; `core/build.sh` падает без `ocean.cpp`.
- [ ] **Step 2: Порт** построчно с `tools/ref/ocean-worklet.js` по разделу спеки «Что повторить явно» (float-хранение, пальцы, `jsRound`, порядок вызовов ГСЧ: шесть фаз в конструкторе, буря до ветра, ветер на каждой массе внутри цикла).
- [ ] **Step 3:** `core/build.sh && node --test tools/test-ocean-core.mjs tools/test-firm-core.mjs tools/test-goetia-core.mjs` — PASS; `git status` — `goetia.wasm`, `pulsar.wasm` не изменились.
- [ ] **Step 4: Commit** «Oceanus core: C++ port of the ocean worklet».

### Task 3: WASM и обёртка

**Files:** Create `core/worlds/oceanus/wasm.cpp` (образец — `core/worlds/firmamentum/wasm.cpp`), `ocean.wasm`; Modify `core/build.sh` (emcc → `ocean.wasm`, экспорт `_oc_init,_oc_params,_oc_push,_oc_release,_oc_splash,_oc_voice,_oc_process,_oc_shape,_oc_moon,_oc_gain`), `ocean-worklet.js` (обёртка по образцу `pulsar-worklet.js`; прежнюю шапку про сканирующий синтез сохранить, добавить строки про ядро), `tools/ocean-scenarios.mjs` (`loadWasm(seed, sr)` → `{proc, posted, ready}`), `tools/test-ocean-core.mjs`.

**Interfaces:** WASM — как в спеке (`oc_*`); обёртка хранит 9 полей `params` и `f/lvl/path` голосов; `on` — `!!d.on`; `f` — прежнее, если не истинно; наружу `{t:'shape', x: Array.from(64 float из oc_shape), moon, g: [6]}`.

- [ ] **Step 1: Тесты:** `wasm matches the reference: <name>` (L, R, метры `x`, `moon`, `g`) для каждого сценария; `wasm has no imports`; `messages before ready keep their order` (`fingers`); `blocks longer than 128 samples` (`one`, блок 256); `a voice index out of range is ignored` (`i: 6`, `i: -1`); `at 44.1 kHz` (`sway` и `all` первые 2000 блоков); `speed: 60 s, six voices, storm and wind` (печать).
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3:** `wasm.cpp`, emcc, обёртка, `loadWasm`, сборка.
- [ ] **Step 4:** `core/build.sh && node --test tools/test-ocean-core.mjs tools/test-firm-core.mjs tools/test-goetia-core.mjs` — PASS; строка скорости — в отчёт.
- [ ] **Step 5: Commit** «Oceanus: ocean worklet runs the C++ core via WASM».

### Task 4: engine, офлайн, сценарий, документы

**Files:** Modify `worlds/oceanus/engine.js` (по образцу `worlds/firmamentum/engine.js`: `fetch('ocean.wasm?v=')` один раз, `buf.slice(0)` на контекст, `processorOptions: { wasm, seed: (Math.random() * 4294967296) >>> 0 }`, `ready`, `core` = `'wasm'` на `{t:'ready'}`, `err` → `console.error`, проверка `c !== actx`), `worlds/oceanus/index.js` (`t2d.ocean.core`), `sw.js` (`WORKLETS` += `./ocean.wasm`, комментарий, `CACHE` → `t2d-v171`), `index.html` (все `?v=170` → `?v=171`), `tools/shot.py` (`sc_oceanus`: после первого голоса — `t2d.ocean.core == 'wasm'` до 3 с и `max(gains) > 0`), `core/README.md`, `docs/worlds/oceanus.md` (`t2d.ocean` += `core`; DSP — ядро, эталон, сверка), `docs/native-plan.md` (фаза 3: Oceanus — звук в ядре, цифра скорости), `CLAUDE.md` (строка VIII в таблице; в «Проверка» — `tools/test-ocean-core.mjs` к сверке ядер).

- [ ] **Step 1:** `shot.py oceanus` падает на `core == 'wasm'`.
- [ ] **Step 2:** правки; `node --check` изменённых JS.
- [ ] **Step 3:** `shot.py oceanus audio firmamentum goetia` — зелёные, без ошибок на странице; скриншоты `oceanus*` — глазами; `node --test tools/test-models.mjs tools/models/*.test.mjs tools/test-ocean-core.mjs tools/test-firm-core.mjs tools/test-goetia-core.mjs` — PASS.
- [ ] **Step 4: Commit** «Oceanus sound from the C++ core (ocean.wasm), v171» (без пуша).

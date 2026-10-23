# Firmamentum на ядре C++ → WASM — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** звук мира X (`pulsar-worklet.js`) считает ядро `core/worlds/firmamentum` (C++17) — в вебе `pulsar.wasm` в AudioWorklet, звук для автора прежний.

**Architecture:** как Goetia (0а): эталон — прежний worklet в `tools/ref/` с ГСЧ mulberry32 вместо `Math.random`; ядро — построчный порт с тем же порядком вызовов ГСЧ; worklet — тонкая обёртка над WASM с прежним протоколом; сверка эталон ↔ render-cli ↔ WASM по сэмплам в Node.

**Tech Stack:** C++17 (Apple clang, emscripten `emcc`, standalone WASM без импортов), AudioWorklet, Node `node:test` + `vm`, Playwright (`tools/shot.py`).

**Spec:** `docs/superpowers/specs/2026-10-23-firmamentum-wasm-design.md` — читать вместе с планом. Образец кода — Goetia: `core/worlds/goetia/*`, `goetia-worklet.js`, `tools/goetia-scenarios.mjs`, `tools/test-goetia-core.mjs`, `worlds/goetia/engine.js`.

## Global Constraints

- Ветка `native`; в `main` — только после «ок» автора на превью.
- Объём — только DSP: `worlds/firmamentum/model.js`, `view.js`, `index.js`, шина и зал в engine не меняются; Goetia (`core/worlds/goetia`, `goetia-worklet.js`, `goetia.wasm`) не меняется.
- ГСЧ — mulberry32, состояние `uint32`, выход `u32 / 4294967296` в [0, 1); в JS — `Math.imul` и `>>> 0`. Зерно в эталоне и обёртке — `processorOptions.seed` (нет — `1`).
- Сборка: `-std=c++17 -ffp-contract=off`, WASM — `-sSTANDALONE_WASM --no-entry -fno-exceptions -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0`, без импортов.
- Без аллокаций в `process`; треск ≤ 10, вспышки ≤ 7, события треска ≤ 12, вспышек ≤ 8; удаление — с сохранением порядка.
- Допуск сверки — 1e-6 на сэмпл, метр и значение события; число событий — равно.
- Протокол порта прежний: внутрь `{t:'voice', i, on?, fp?, ff?, cyc?, win?, mask?, lvl?, pan?}`, `{t:'fx', jit, spread, crep?, fulg?}`; наружу `{t:'p', c, g, k, f}` каждые `round(sampleRate / 30)` сэмплов, плюс `{t:'ready'}` и `{t:'err', msg}`.
- Комментарии и тексты — по-русски, в духе соседнего кода; коммиты — по-английски, тело — список, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `pulsar.wasm` лежит в git: изменил ядро — пересобери (`core/build.sh`) и закоммить вместе.

## Review Focus

1. Неполное `voice` (только `fp`) сразу после зажигания, пока `g < 1e-4`, — фаза **не** сбрасывается (сброс только при явном `on`) → сценарий `dragEarly` в задаче 1, сверка в задачах 2–3.
2. Частота 44.1 кГц (iPhone с USB-интерфейсом) — вспышки `min(F, sr·0.42)`, `every`, длины → тест «at 44.1 kHz» в задаче 3.
3. Сообщения до готовности WASM применяются в прежнем порядке → тест в задаче 3.
4. `restartAudio` — новый контекст, байты не качаются заново, мир снова звучит → `shot.py audio` и проверка в `firmamentum` в задаче 4.
5. Долгий прогон со всем сразу (30 с): ГСЧ и фазы не расходятся → сценарий `all` в задачах 2–3; если разойдётся из-за 1 ULP у порога щелчка — см. спеку, «Тонкое место».

---

### Task 1: эталон с зерном и сценарии сверки

**Files:**
- Create: `tools/ref/pulsar-worklet.js` — копия `pulsar-worklet.js`; отличия: `constructor(options)`, `this.seed = (options?.processorOptions?.seed ?? 1) >>> 0`, метод `rnd()` (mulberry32), все `Math.random()` → `this.rnd()`; шапка-комментарий: «эталон для сверки ядра, ГСЧ с зерном — единственное отличие».
- Create: `tools/firm-scenarios.mjs`
- Create: `tools/test-firm-core.mjs` (пока только эталон)
- Modify: `tools/goetia-scenarios.mjs` — `export` у `sandbox` (больше ничего).

**Interfaces:**
- Produces (`tools/firm-scenarios.mjs`): `SR = 48000`, `BLOCK = 128`, `SCENARIOS` (имя → шаги; шаг — сообщение порта или `{ run: блоков }`), `toScript(steps, sr = SR, seed = SEED)` → текст для render-cli, `SEED = 12345`, `loadRef(seed = SEED, sr = SR)` → `{ proc, posted }`, `loadOld()` — прежний `pulsar-worklet.js` из корня (с `Math.random`), `loadWasm(seed = SEED, sr = SR)` → `{ proc, posted, ready }` (задача 3), `play(proc, steps, posted, block = BLOCK)` → `{ L, R, meters: [{c, g}], events: [{k, f}] }`.
- `toScript` держит последние поля каждого голоса и fx и пишет строки полностью: `world firmamentum`, `init <sr> <seed>`, `voice <i> <on: 1|0|-1> <fp> <ff> <cyc> <win> <mask> <lvl> <pan>`, `fx <jit> <spread> <crep> <fulg>`, `run <блоков>`; числа — `toPrecision(17)`. Начальные поля голоса и fx — как в конструкторе worklet.
- `sandbox` для 44.1 кГц: `sampleRate` берётся из аргумента (добавить параметр в `sandbox(file, extra)` через `extra.sampleRate` — он уже перекрывает).

- [ ] **Step 1: Сценарии.** `FX = {t:'fx', jit:0, spread:0.6, crep:0, fulg:0}`; `star(i, o)` = `{t:'voice', i, on:true, fp:4, ff:600, cyc:2, win:0, mask:0, lvl:0.44, pan:0, ...o}`. Набор (длины в блоках; 375 блоков ≈ 1 с):
  `rhythm` — fp 2, 750; `tone` — fp 110, ff 1200, 375; `windows` — три звезды win 0 / 0.5 / 1, fp 30/45/60, 375; `mask` — fp 40, mask 0.5, 375; `scintilla` — fx jit 0.6, fp 60, 375; `drag` — fp 50, 100, затем `{t:'voice', i:0, fp:200}`, 200, `{t:'voice', i:0, ff:3000}`, 200; `dragEarly` — `star(0,{fp:50})`, сразу `{t:'voice', i:0, fp:80}`, 300; `relight` — 200, `on:false`, 30, `on:true` с fp 90, 200, `on:false`, 3000, `on:true`, 200; `six` — шесть звёзд с pan −1…1 и разными fp/ff, fx spread 1, 375; `crepitus` — одна звезда, crep 0.3, 750, затем crep 1, 750; `fulgur` — fp 8, fulg 1, 1500; `all` — six + jit 0.3, crep 0.6, fulg 0.7, mask 0.2 у двух звёзд, 11250 (30 с).
- [ ] **Step 2: Тесты эталона** (`tools/test-firm-core.mjs`):
  - `reference sounds` — `rms(L)` у `tone` > 0.01;
  - `reference is deterministic` — `all` (первые 1000 блоков) дважды с `SEED` — побитово равны; с `SEED + 1` — различаются;
  - `reference sounds like the old worklet` — для `all` и `crepitus`: RMS L и R эталона и `loadOld()` за весь сценарий — в пределах ±0.5 дБ; число событий `k` и `f` — в пределах ±25 %.
- [ ] **Step 3:** `node --test tools/test-firm-core.mjs` — все PASS (эталон уже есть; если «like the old worklet» падает — ошибка в замене `Math.random`, а не повод расширять допуск).
- [ ] **Step 4: Commit** — `tools/ref/pulsar-worklet.js tools/firm-scenarios.mjs tools/test-firm-core.mjs tools/goetia-scenarios.mjs`, «Firmamentum core: seeded reference worklet and scenarios».

### Task 2: ядро C++ и render-cli

**Files:**
- Create: `core/common/rng.hpp` — `namespace core { struct Rng { uint32_t s; explicit Rng(uint32_t seed); double next(); }; }` (mulberry32, header-only).
- Create: `core/common/dc.hpp` — `struct DcBlock { double x1 = 0, y1 = 0; double step(double x); }` — `y = x − x1 + 0.995·y1`.
- Create: `core/worlds/firmamentum/pulsar.hpp`, `pulsar.cpp`
- Modify: `core/render-cli/main.cpp` — команда `world <goetia|firmamentum>` (по умолчанию goetia, сценарии Goetia не меняются); для firmamentum — `init <sr> <seed>`, `voice …` (9 полей, см. задачу 1), `fx …`, `run`.
- Modify: `core/build.sh` — `render-cli` собирается из `main.cpp`, `goetia.cpp`, `pulsar.cpp`.
- Modify: `tools/test-firm-core.mjs` — блок render-cli.

**Interfaces:**
- Produces (`pulsar.hpp`, `namespace firmamentum`): `constexpr int VMAX = 6, CRMAX = 10, PIPMAX = 7, CKMAX = 12, FLMAX = 8;`
  `class Pulsar { Pulsar(double sr, uint32_t seed); void voice(int i, int on, double fp, double ff, double cyc, double win, double mask, double lvl, double pan); void fx(double jit, double spread, double crep, double fulg); void process(float* L, float* R, int n); double count(int i) const; double gain(int i) const; int ck(double* out); int fl(int* out); }` — `on`: 1 / 0 / −1 (нет в сообщении: поле `on` не меняется и сброса нет); `ck` / `fl` копируют накопленные события (пары `pan, a` / номера голосов) в `out`, возвращают число и очищают; `R == nullptr` — моно.
- Consumes: сценарии и `toScript` из задачи 1.

- [ ] **Step 1: Тест render-cli** — для каждого сценария `render-cli matches the reference: <name>`: L и R `core/build/render-cli` (stdin — `toScript(steps)`) против `loadRef()` — `same(…)` с 1e-6 (функции `same`, `cli` — как в `tools/test-goetia-core.mjs`); бинарника нет — `t.skip`.
- [ ] **Step 2:** `core/build.sh` падает (нет `pulsar.cpp`) — ожидаемо.
- [ ] **Step 3: Порт.** Построчно с `tools/ref/pulsar-worklet.js`: порядок вызовов `rng.next()` — тот же, включая короткие замыкания (`if (jit)`, `fulg > 0 && …`, `c > 0 && act > 0.01`, `r < 0.25` до выбора частоты); `x ** y` — `std::pow`; `Math.sign` — явно; `this.vo.indexOf(o)` — индекс цикла; треск и вспышки — фиксированные массивы, удаление `j` — сдвигом хвоста; `for (const p of pips) p.k0 = 0` в конце `dust`; DC и `tanh(0.7·y)` — по каналу, `DcBlock` из `core/common`.
- [ ] **Step 4:** `core/build.sh && node --test tools/test-firm-core.mjs tools/test-goetia-core.mjs` — всё PASS (Goetia — тоже: render-cli общий). Падает `all` или `crepitus` на сэмпле, где родился или умер щелчок, — это «тонкое место» спеки: порог делается устойчивым одинаково в эталоне и ядре (длина щелчка в сэмплах при рождении), шапка эталона и раздел спеки дополняются, тест `like the old worklet` по-прежнему зелёный.
- [ ] **Step 5: Commit** — `core/common core/worlds/firmamentum core/render-cli/main.cpp core/build.sh tools/test-firm-core.mjs`, «Firmamentum core: C++ port of the pulsar worklet».

### Task 3: WASM и обёртка worklet

**Files:**
- Create: `core/worlds/firmamentum/wasm.cpp`
- Modify: `core/build.sh` — `emcc … -o pulsar.wasm core/worlds/firmamentum/wasm.cpp core/worlds/firmamentum/pulsar.cpp`, экспорт `_pl_init,_pl_voice,_pl_fx,_pl_process,_pl_count,_pl_gain,_pl_ck,_pl_ck_buf,_pl_fl,_pl_fl_buf`, `-sINITIAL_MEMORY=1MB -sSTACK_SIZE=64KB`.
- Modify: `pulsar-worklet.js` — обёртка (шапку про пульсарный синтез сохранить, добавить строку «DSP — ядро core/worlds/firmamentum (C++ → pulsar.wasm)…» как в `goetia-worklet.js`).
- Create: `pulsar.wasm` (сборка)
- Modify: `tools/firm-scenarios.mjs` (`loadWasm`), `tools/test-firm-core.mjs`

**Interfaces:**
- Produces (WASM, как в спеке): `pl_init(double sr, unsigned seed)`, `pl_voice(int i, int on, double fp, double ff, double cyc, double win, double mask, double lvl, double pan)`, `pl_fx(double jit, double spread, double crep, double fulg)`, `float* pl_process(int n)` (n ≤ 128, L затем R), `double pl_count(int i)`, `double pl_gain(int i)`, `int pl_ck()` + `double* pl_ck_buf()` (пары, читать после `pl_ck`), `int pl_fl()` + `int* pl_fl_buf()`. Номер голоса вне 0…5 — мимо.
- Обёртка: `processorOptions.wasm` (ArrayBuffer), `processorOptions.seed`; хранит последние поля голосов и fx; `on` → `d.on == null ? -1 : d.on ? 1 : 0`; сообщение `p`: `c` и `g` — массивы по 6, `k` — массив пар `[pan, a]`, `f` — массив номеров (как прежде).
- Consumes: `Pulsar` из задачи 2, сценарии из задачи 1.

- [ ] **Step 1: Тесты WASM** (по образцу `tools/test-goetia-core.mjs`): `wasm matches the reference: <name>` для каждого сценария — L, R, метры `c`, `g`, события `k`, `f`; `wasm has no imports`; `messages before ready keep their order` (на `six`); `a partial voice message keeps the other fields` (`tone` + `{t:'voice', i:0, ff:2400}`); `blocks longer than 128 samples` (`six`, блок 256); `a voice index out of range is ignored` (`i: 6`, `i: -1`); `at 44.1 kHz` (`fulgur` и `all` первые 2000 блоков, `loadRef(SEED, 44100)` против `loadWasm(SEED, 44100)`); `speed: 60 s, six stars, crepitus and fulgur` — печать времени эталона и WASM.
- [ ] **Step 2:** тесты падают (нет `pulsar.wasm` / обёртка — старая).
- [ ] **Step 3:** `wasm.cpp` (как `core/worlds/goetia/wasm.cpp`: экземпляр в статической памяти, `ok(i)`), строка `emcc` в `build.sh`, обёртка `pulsar-worklet.js` (как `goetia-worklet.js`: очередь, `_initialize`, `ready`/`err`, кусками по 128, вид на память пересоздаётся при смене `memory.buffer`).
- [ ] **Step 4:** `core/build.sh && node --test tools/test-firm-core.mjs tools/test-goetia-core.mjs` — PASS; строку скорости записать для отчёта.
- [ ] **Step 5: Commit** — `core/worlds/firmamentum/wasm.cpp core/build.sh pulsar-worklet.js pulsar.wasm tools/firm-scenarios.mjs tools/test-firm-core.mjs`, «Firmamentum: pulsar worklet runs the C++ core via WASM».

### Task 4: engine, офлайн, сценарий, документы, превью

**Files:**
- Modify: `worlds/firmamentum/engine.js` — `start()`: параллельно `addModule` и `fetch('pulsar.wasm?v=')` (байты — один раз в замыкании, на каждый контекст `buf.slice(0)`), `processorOptions: { wasm, seed: (Math.random() * 4294967296) >>> 0 }`, `err` → `console.error`, `ready` и `core` (`'wasm'` после `{t:'ready'}`) — как в `worlds/goetia/engine.js`; шапку дополнить.
- Modify: `worlds/firmamentum/index.js` — `t2d.firm.core` (геттер `engine.core`).
- Modify: `sw.js` — `WORKLETS` += `'./pulsar.wasm'`, `CACHE` → `t2d-v170`; `index.html` — все `?v=169` → `?v=170`.
- Modify: `tools/shot.py` — `sc_firmamentum`: после первой звезды ждать `t2d.firm.core == 'wasm'` (до 3 с) и `max(t2d.firm.gains) > 0`.
- Modify: `core/README.md` (Firmamentum, `pulsar.wasm`, `node --test tools/test-firm-core.mjs`), `docs/worlds/firmamentum.md` (DSP — ядро, эталон, сверка, зерно), `docs/native-plan.md` (фаза 3: Firmamentum — звук в ядре, цифра скорости; пометка «Web MIDI проверен автором на Mac»), `CLAUDE.md` (строка X в таблице: `pulsar-worklet.js` → обёртка, ядро `core/worlds/firmamentum` → `pulsar.wasm`).

- [ ] **Step 1:** `python3 tools/shot.py firmamentum` — падает на новой проверке `core == 'wasm'` (engine ещё старый).
- [ ] **Step 2:** правки engine, index, sw, index.html, shot.
- [ ] **Step 3:** `node --check` изменённых JS; `python3 tools/shot.py firmamentum audio goetia` — зелёные, без ошибок на странице; скриншоты `firmamentum*` — глазами; `node --test tools/test-models.mjs tools/models/*.test.mjs tools/test-firm-core.mjs tools/test-goetia-core.mjs` — PASS.
- [ ] **Step 4:** документы.
- [ ] **Step 5: Commit и пуш в `native`**, «Firmamentum sound from the C++ core (pulsar.wasm), v170»; дождаться статуса Vercel `success` для коммита (`curl -s https://api.github.com/repos/ai-slopes-hq/touch2decay/commits/<sha>/status`), отдать автору ссылку на превью ветки `native`.

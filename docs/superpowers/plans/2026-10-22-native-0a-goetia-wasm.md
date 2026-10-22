# Native 0а: Goetia DSP в C++ → WASM — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DSP Goetia (`goetia-worklet.js`) переписан на C++, собран в `goetia.wasm` и звучит в вебе из WASM, совпадая с прежним JS по сэмплам (≤ 1e-6).

**Architecture:** `core/worlds/goetia/` — класс `Goetia` (порт worklet) + `extern "C"` интерфейс для WASM; `core/render-cli` — тот же класс нативно, для сверки. `goetia-worklet.js` становится тонкой обёрткой над WASM с прежним протоколом сообщений; эталон — копия старого worklet в `tools/ref/`. engine качает байты `.wasm` и отдаёт их узлу через `processorOptions`.

**Tech Stack:** C++17, emscripten (`emcc`, standalone wasm), Apple clang++ (render-cli), Node 26 (`node --test`, `vm`), Playwright (`tools/shot.py`).

**Spec:** `docs/superpowers/specs/2026-10-22-native-0a-goetia-wasm-design.md`

## Global Constraints

- Ветка `native`; в `main` не коммитить и не сливать.
- C++17, без зависимостей, без аллокаций в `process`; внутренние величины — `double`, выход — `float`.
- И emcc, и clang++ — с `-ffp-contract=off`.
- Семантика JS повторяется явно: `toInt32` для `tf | 0` (обрезка к нулю, по модулю 2³²); `+ - *` через `uint32_t`; `>>` со счётчиком `& 31`; `%` — `a % ((b & 15) + 1)`; `(ti * acc) & 255` через `uint32_t`.
- Коды знаков 0…7 в порядке `| & ^ + * - % >`; неизвестный знак → 0 (`|`).
- Допуск сверки — 1e-6 на каждый сэмпл L/R и на метры `tt`, `g`.
- Протокол порта не меняется: `voice`, `fx` внутрь, `{t:'p', tt, g}` ~30/с наружу; новые — `sett` (только тесты), `ready`, `err` (наружу).
- `CACHE` в `sw.js` и все 16 `?v=` в `index.html` — одно число: **900**.
- Комментарии — по-русски, в духе файлов рядом; коммиты — по-английски, тело-список, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Без запасного JS-пути: WASM не загрузился — тишина и `console.error`.

## Review Focus

1. **Сообщения до готовности WASM.** engine шлёт `fx` и `voice` сразу после создания узла, а `instantiate` асинхронный — порядок очереди должен сохраниться (тест в Task 2: сообщения до `ready` дают тот же звук).
2. **Неполное сообщение `voice`** (например только `rate`) — обёртка подставляет прежние поля голоса, а не нули (тест в Task 2).
3. **Повторный призыв в тот же слот, пока голос не затих** (`g ≥ 1e-4`) — `t` не сбрасывается, как в JS (сценарий `rebanish` в Task 1).
4. **`restartAudio`** — новый контекст: узел создаётся заново из закешированных байтов, звук снова из WASM (проверка в Task 3, `shot.py audio` + `goetia`).
5. **Переход `t` через 2³¹** — обрезка по модулю совпадает с JS (сценарий `wrap` в Task 1).

---

### Task 1: ядро Goetia на C++ и нативная сверка

**Files:**
- Create: `tools/ref/goetia-worklet.js` (копия текущего `goetia-worklet.js` + приём `sett`, см. шаг 1)
- Create: `core/worlds/goetia/goetia.hpp`, `core/worlds/goetia/goetia.cpp`
- Create: `core/render-cli/main.cpp`
- Create: `core/build.sh` (пока только render-cli), `core/README.md`, `core/.gitignore` (`build/`)
- Create: `tools/goetia-scenarios.mjs`, `tools/test-goetia-core.mjs`

**Interfaces:**
- Produces (C++, `namespace goetia`):
  ```cpp
  constexpr int VMAX = 3, LMAX = 4, PMAX = 8;
  int32_t toInt32(double x);
  class Goetia {
   public:
    explicit Goetia(double sampleRate);
    void prog(int i, int n, const int* pairs);   // pairs: n пар (код знака, сдвиг)
    void voice(int i, bool on, double rate, double lp, double lvl, int legio, double pan, double rel, int trig);
    void fx(double spread, double wide);
    void setT(int i, double t);                  // t[j] = t + j·1777
    void process(float* L, float* R, int n);     // R == nullptr — моно
    double t0(int i) const;                      // t[0] голоса
    double gv(int i) const;                      // g · envS[0]
  };
  ```
- Produces (JS, `tools/goetia-scenarios.mjs`): `export const SCENARIOS` — `{ name: steps[] }`, шаг — сообщение порта (`{t:'voice'|'fx'|'sett', …}`) или `{ run: блоков }`; `export function toScript(steps, sr)` → текст для render-cli; `export function loadRef()` → `{ proc, posted }` (эталон в `vm`, как `tools/test-plate.mjs`); `export function play(proc, steps)` → `{ L: Float32Array, R: Float32Array, meters: [{tt, g}] }` (блоки по 128, 48 000 Гц, `posted` с `t:'p'` собираются в `meters`).
- Формат сценария render-cli (stdin, строка — команда): `init <sr>` · `prog <i> <код> <сдвиг> …` · `voice <i> <on 0|1> <rate> <lp> <lvl> <legio> <pan> <rel> <trig>` · `fx <spread> <wide>` · `sett <i> <t>` · `run <блоков>`. Вывод (stdout): на каждый блок 128 float32 L, затем 128 float32 R (little-endian). Числа в скрипте — `toPrecision(17)`.

- [ ] **Step 1: эталон.** Скопировать (не переносить) `goetia-worklet.js` в `tools/ref/goetia-worklet.js` и добавить в `onmessage` ветку `else if (d.t === 'sett') { const o = this.vo[d.i]; for (let j = 0; j < LMAX; j++) o.t[j] = d.t0 + j * 1777; }` (поле времени — `t0`, т.к. `t` занято типом). Больше в эталоне ничего не менять.

- [ ] **Step 2: сценарии и тест (падающий).** В `tools/goetia-scenarios.mjs` — `SCENARIOS` (у всех первым шагом `{t:'fx', spread:0.6, wide:0.35}`; `voice` всегда со всеми полями, `prog` — массив `[знак, сдвиг]`; `lp` — `1 - exp(-2π·fc/48000)` при `fc` 250…12000):
  - `strike` — один дух `[[ '&',5],['|',8],['-',4]]`, `rel 0.2`, `trig 9`, 200 блоков;
  - `drone` — тот же, `rel 1`, 200 блоков;
  - `ops` — два духа: `| & ^ +` и `* - % >` (все восемь знаков), 200 блоков;
  - `legion` — `legio 4`, затем `{t:'fx', spread:1, wide:1}` посередине, 300 блоков;
  - `rebanish` — дух, 100 блоков, `on:false`, 20 блоков (голос ещё звучит), `on:true` с другой печатью, 100 блоков, `on:false`, 2000 блоков (затих), `on:true`, 100 блоков;
  - `glide` — `rate` 7040 → 14080 на ходу, 300 блоков;
  - `three` — три духа, разные `pan` (−0.6, 0, 0.6), `legio` 1/2/3, 300 блоков;
  - `wrap` — дух, `{t:'sett', i:0, t0: 2**31 - 48000}`, 1000 блоков (t переходит 2³¹).

  В `tools/test-goetia-core.mjs`: `test('render-cli matches the JS worklet: <name>')` на каждый сценарий — `spawnSync('core/build/render-cli', {input: toScript(steps, 48000)})`, разбор float32, `assert` `max|L − Lref| ≤ 1e-6` и то же для R; если бинарника нет — `t.skip('core/build/render-cli is not built — core/build.sh')`. Плюс `test('reference sounds')` — у `drone` RMS L > 0.01 (сценарии не пустые).

- [ ] **Step 3: прогнать.** `node --test tools/test-goetia-core.mjs` — `reference sounds` PASS, сверки — SKIP (бинарника ещё нет).

- [ ] **Step 4: ядро.** `core/worlds/goetia/goetia.{hpp,cpp}` — построчный порт `process`/`onmessage` эталона с семантикой из Global Constraints. Сброс `t` при новом духе (`on && g < 1e-4`: `rateS = rate`, `t[0] = 0`, `t[j] = j·1777`) — в `voice`. Состояние голоса — фиксированные массивы `[LMAX]`, программа — `[PMAX]` пар. Метры: `gv` обновляется в цикле сэмплов, как `o.gv` в JS.

- [ ] **Step 5: render-cli и сборка.** `core/render-cli/main.cpp` — разбор формата выше, `Goetia` создаётся на `init`, `run` — `process` блоками по 128 и `fwrite` L, затем R. `core/build.sh`: `set -euo pipefail`; `clang++ -std=c++17 -O2 -ffp-contract=off -o core/build/render-cli core/render-cli/main.cpp core/worlds/goetia/goetia.cpp` (пути — от корня репозитория, скрипт делает `cd` в корень). `core/README.md` — зависимости (`brew install emscripten` — для Task 2), команды сборки и сверки.

- [ ] **Step 6: сверка проходит.** `core/build.sh && node --test tools/test-goetia-core.mjs` — все 8 сравнений PASS. Если расхождение — искать по первому несовпавшему сэмплу (печатать индекс в сообщении `assert`).

- [ ] **Step 7: коммит.**
  ```bash
  git add core tools/ref tools/goetia-scenarios.mjs tools/test-goetia-core.mjs
  git commit   # "Core: Goetia DSP in C++ with a native render-cli matched against the JS worklet"
  ```

### Task 2: WASM и обёртка worklet

**Files:**
- Create: `core/worlds/goetia/wasm.cpp`, `goetia.wasm` (собранный)
- Modify: `core/build.sh` (+ emcc), `core/README.md`
- Modify: `goetia-worklet.js` (целиком — обёртка)
- Modify: `tools/goetia-scenarios.mjs` (+ `loadWasm`), `tools/test-goetia-core.mjs`

**Interfaces:**
- Consumes: `goetia::Goetia` (Task 1), `SCENARIOS`, `play`, `loadRef` (Task 1).
- Produces (экспорты WASM, `extern "C"`): `gt_init(double sr)`, `int* gt_prog_buf()`, `gt_prog(int i, int n)`, `gt_voice(int i, int on, double rate, double lp, double lvl, int legio, double pan, double rel, int trig)`, `gt_fx(double spread, double wide)`, `float* gt_process(int n)` (буфер `[L×n, R×n]`, n ≤ 128), `double gt_t0(int i)`, `double gt_gv(int i)`, `gt_set_t(int i, double t)`; плюс `memory` и, если emscripten его добавит, `_initialize` (звать первым).
- Produces (worklet): процессор `'goetia'`, `processorOptions.wasm: ArrayBuffer`; наружу `{t:'ready'}` после `gt_init`, `{t:'err', msg}` при ошибке, `{t:'p', tt, g}` как раньше; внутрь — `voice`, `fx`, `sett` (`{t:'sett', i, t0}`).
- Produces (JS, `tools/goetia-scenarios.mjs`): `export async function loadWasm()` → `{ proc, posted, ready: Promise }` — обёртка в `vm` с `processorOptions.wasm` из `goetia.wasm`; `ready` разрешается на `{t:'ready'}`.

- [ ] **Step 1: тесты (падающие).** В `tools/test-goetia-core.mjs`:
  - `test('wasm matches the JS worklet: <name>')` на каждый сценарий — `loadWasm`, `await ready`, `play`, сравнение L/R и `meters` (`tt`, `g`) с эталоном, ≤ 1e-6;
  - `test('wasm has no unexpected imports')` — `WebAssembly.Module.imports(new WebAssembly.Module(bytes))` пуст (или только имена из заглушек обёртки — тогда список заглушек в тесте явно);
  - `test('messages before ready keep their order')` — сценарий `ops`: все сообщения до первого `run` отправлены **до** `await ready`; звук совпадает с эталоном;
  - `test('a partial voice message keeps the other fields')` — `drone`, затем `{t:'voice', i:0, rate: 9000}` (без остальных полей) в эталон и в WASM, 100 блоков — совпадает;
  - `test('speed: 60 s, three spirits, legion 4')` — время `process` эталона и WASM (`performance.now()`), `console.log` обоих и отношения; без `assert`.

- [ ] **Step 2: прогнать.** `node --test tools/test-goetia-core.mjs` — новые тесты FAIL (нет `goetia.wasm` / обёртки).

- [ ] **Step 3: `wasm.cpp` и сборка.** Один статический `Goetia` (создаётся в `gt_init` placement-new в статический буфер — без кучи), статические `int progBuf[16]` и `float out[256]`. В `core/build.sh` добавить:
  ```bash
  emcc -O3 -std=c++17 -ffp-contract=off -fno-exceptions -sSTANDALONE_WASM --no-entry \
    -sEXPORTED_FUNCTIONS=_gt_init,_gt_prog_buf,_gt_prog,_gt_voice,_gt_fx,_gt_process,_gt_t0,_gt_gv,_gt_set_t \
    -sFILESYSTEM=0 -sINITIAL_MEMORY=1MB -sSTACK_SIZE=64KB -sALLOW_MEMORY_GROWTH=0 \
    -o goetia.wasm core/worlds/goetia/wasm.cpp core/worlds/goetia/goetia.cpp
  ```
  Если emcc ругается на `INITIAL_MEMORY` ниже минимума — поднять до допустимого и записать значение в README. `brew install emscripten`, если `emcc` нет.

- [ ] **Step 4: обёртка `goetia-worklet.js`.** Шапка-комментарий прежняя (что звучит) + строка «DSP — ядро core/worlds/goetia (C++ → goetia.wasm), здесь только сообщения и копия буфера». Логика:
  - `OPS = ['|','&','^','+','*','-','%','>']`, код знака — `OPS.indexOf(op)`, `-1` → 0;
  - конструктор: `WebAssembly.instantiate(options.processorOptions.wasm, {})` → `_initialize?.()` → `gt_init(sampleRate)` → применить очередь → `post({t:'ready'})`; `catch` → `post({t:'err', msg: String(e)})`;
  - у себя хранит последние поля каждого голоса (`on, rate, lp, lvl, legio, pan, rel, trig`, начальные — как в старом конструкторе: `rate 8000, lp 0.3, lvl 0.7, legio 1, pan 0, rel 1, trig 8`) — неполное `voice` дополняется ими, в `gt_voice` всегда все поля; `prog` — запись пар в `gt_prog_buf()` и `gt_prog(i, n)` **до** `gt_voice` (как в JS: программа ставится раньше `on`);
  - `process`: до готовности — тишина; иначе `gt_process(n)`, копия из `Float32Array(memory.buffer, ptr, 2n)` (вид пересоздаётся, если `memory.buffer` сменился) в `out[0]`, `out[1]` (если канала R нет — только L); счётчик `round(sampleRate/30)` → `{t:'p', tt:[gt_t0(0..2)], g:[gt_gv(0..2)]}`.
  - `sett` → `gt_set_t(i, t0)`.

- [ ] **Step 5: прогнать.** `core/build.sh && node --test tools/test-goetia-core.mjs` — все PASS, в выводе — цифры скорости JS / WASM (записать для Task 4).

- [ ] **Step 6: коммит.**
  ```bash
  git add core goetia.wasm goetia-worklet.js tools/goetia-scenarios.mjs tools/test-goetia-core.mjs
  git commit   # "Goetia: worklet is a thin wrapper over the C++ core built to WASM"
  ```

### Task 3: engine, офлайн, браузер

**Files:**
- Modify: `worlds/goetia/engine.js` (`start`, `return`), `worlds/goetia/index.js` (`t2d.goe.core`)
- Modify: `sw.js` (`CACHE`, `WORKLETS`), `index.html` (все `?v=`)
- Modify: `tools/shot.py` (`sc_goetia`)

**Interfaces:**
- Consumes: процессор `'goetia'` и его сообщения (Task 2).
- Produces: `engine.core` — `'wasm'` после `{t:'ready'}`, иначе `null`; `t2d.goe.core` — геттер на него.

- [ ] **Step 1: проверка в сценарии (падающая).** В `sc_goetia` после ожидания `t2d.goe.ready` — цикл до 3 с ожидания `t2d.goe.core == 'wasm'`, затем `assert ... == 'wasm', 'the sound comes from the WASM core'`. В конце сценария (после карты) — `t2d.restartAudio()`, 2.5 с, назад в мир (`t2d.go(15)`), снова `core == 'wasm'` и `T2D.level > 0.02` (после отмены духи звучат) — `'after restart audio the core is back'`.

- [ ] **Step 2: прогнать.** Сервер `python3 -m http.server 8765` в корне; `python3 tools/shot.py goetia` — FAIL на `core` (нет геттера).

- [ ] **Step 3: engine.** В `start()`: байты — `bytes || fetch(`goetia.wasm?v=${ver}`).then(r => r.arrayBuffer())` (переменная `bytes` в замыкании engine хранит промис, повторно не качается); `Promise.all([addModule, bytes])` → узел с `processorOptions: { wasm: buf.slice(0) }` (копия: буфер передаётся структурным клонированием, исходник остаётся для `restartAudio`). В `onmessage`: `'ready'` → `core = 'wasm'`; `'err'` → `console.error('goetia core:', d.msg)`; `'p'` — как было. В `build` — `core = null`. Добавить `get core()` в возвращаемый объект; в `index.js` — `get core() { return engine.core; }` в `t2d.goe`. Комментарий-шапку engine дополнить: «звук — goetia.wasm (ядро C++) в worklet».

- [ ] **Step 4: офлайн и версия.** `sw.js`: `WORKLETS` += `'./goetia.wasm'`, `CACHE = 't2d-v900'`; `index.html`: все `?v=166` → `?v=900` (замена по `?v=`, 16 штук).

- [ ] **Step 5: прогнать всё.**
  - `node --check worlds/goetia/engine.js worlds/goetia/index.js goetia-worklet.js sw.js`
  - `node --test tools/test-models.mjs tools/models/*.test.mjs tools/test-goetia-core.mjs tools/test-plate.mjs` — PASS
  - `python3 tools/shot.py goetia` и `python3 tools/shot.py audio` — PASS; скриншоты `.shots/goetia*.png` посмотреть (Read) — круг, печать, треугольники как раньше.

- [ ] **Step 6: коммит.**
  ```bash
  git add worlds/goetia sw.js index.html tools/shot.py
  git commit   # "Goetia: engine loads goetia.wasm, offline cache, v900"
  ```

### Task 4: документы и выкладка на превью

**Files:**
- Modify: `docs/worlds/goetia.md`, `docs/native-plan.md`, `CLAUDE.md` (строка Goetia в таблице миров: `goetia.wasm`, `core/worlds/goetia/`)

- [ ] **Step 1: документы.** `docs/worlds/goetia.md` — строка: DSP — ядро `core/worlds/goetia` (C++ → `goetia.wasm`), worklet — обёртка, сверка — `node --test tools/test-goetia-core.mjs`, сборка — `core/build.sh`. `docs/native-plan.md`, фаза 0 — подпункт «0а (ветка native)»: что сделано, цифры скорости JS / WASM из Task 2, что осталось проверить на iPhone (пусто, пока автор не проверил).

- [ ] **Step 2: коммит и пуш.** `git commit` (`"Docs: native phase 0a, Goetia core"`), `git push -u origin native`.

- [ ] **Step 3: превью.** Ждать статус коммита: `gh api repos/ai-slopes-hq/touch2decay/commits/$(git rev-parse HEAD)/status --jq .state` → `success`; адрес превью — `gh api "repos/ai-slopes-hq/touch2decay/deployments?ref=native&per_page=1" --jq '.[0].id'` → `gh api repos/ai-slopes-hq/touch2decay/deployments/<id>/statuses --jq '.[0].environment_url'`. Дать автору ссылку и что проверить: Goetia звучит как в проде, без треска; после первого захода — режим полёта, перезапуск — звучит.

- [ ] **Step 4: итог на iPhone.** После ответа автора — дописать результат в `docs/native-plan.md` (0а), коммит, пуш.

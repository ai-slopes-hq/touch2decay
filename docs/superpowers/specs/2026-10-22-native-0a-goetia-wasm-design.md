# Фаза 0а: ядро Goetia на C++ → WASM в вебе

Утверждено с автором 22.10. Контекст — `docs/native-plan.md`, фаза 0 (разведка). 0а — первая половина: ядро и цикл сборки; 0б (пробная нативная сборка: приложение, AUv3, S-4, Link, фон) — отдельная спека после 0а.

## Цель

Проверить на самом простом мире весь путь «C++ → WASM в AudioWorklet → iPhone»: сборка, загрузка WASM в Safari, совпадение звука с прежним JS по сэмплам, офлайн, первая цифра скорости WASM против JS. Звук Goetia для пользователя не меняется.

## Решения

- **Где:** ветка `native` в этом репозитории; `main` (прод) не трогаем. Проверка — превью Vercel ветки. В `main` не сливаем до конца 0б.
- **Объём:** в C++ — только DSP (`goetia-worklet.js`). `worlds/goetia/model.js`, `view.js`, `index.js` и шина engine (эхо, зал `T.hall()`) остаются в JS без изменений. Перенос модели в ядро проектируется позже, на мире, где модель живёт сама (Firmamentum, фазы 2–3): у Goetia модель без времени, паттерн на ней не проверить.
- **Без запасного JS-пути:** если WASM не загрузился — тишина и сообщение в консоль; в разведке отказ надо увидеть.

## Файлы

```
core/
  README.md                         сборка, зависимости, как сверять
  build.sh                          emcc → ../goetia.wasm; clang++ → core/build/render-cli
  worlds/goetia/goetia.hpp|.cpp     class Goetia — порт goetia-worklet.js
  worlds/goetia/wasm.cpp            extern "C" интерфейс для WASM, один экземпляр Goetia на модуль
  render-cli/main.cpp               сценарий сообщений (текст, stdin) → float32 L,R (stdout)
goetia.wasm                         собранный модуль, в репозитории, рядом с worklet
goetia-worklet.js                   тонкая обёртка над goetia.wasm, протокол сообщений прежний
tools/ref/goetia-worklet.js         прежний JS-worklet без изменений — эталон
tools/test-goetia-core.mjs          сверка эталон ↔ WASM ↔ render-cli, замер скорости
```

Правки существующих файлов: `worlds/goetia/engine.js` (загрузка байтов), `sw.js` (`WORKLETS` += `./goetia.wasm`, `CACHE`), `index.html` (`?v=`), `tools/shot.py` (проверка звука в сценарии `goetia`), `docs/worlds/goetia.md`, `docs/native-plan.md`.

## Ядро (C++)

`class Goetia` повторяет `goetia-worklet.js` построчно: 3 голоса (`VMAX`), легион до 4 (`LMAX`), восемь знаков, удар/дрон, однополюсный lowpass, DC-фильтр, `tanh(x·0.8)` на выходе, метры `t[0]` и `gv` каждого голоса. Стандарт C++17, без зависимостей, без аллокаций в `process`.

Семантика JS, которую надо повторить явно (иначе UB или расхождение):

- `ti = tf | 0` — `toInt32(double)`: обрезка к нулю и приведение по модулю 2³² (как ToInt32 в ECMAScript). `(int32_t)double` вне диапазона — UB, а `t` доходит до 2³¹ примерно за час.
- `+`, `-`, `*` (`Math.imul`) — через `uint32_t`, результат обратно в `int32_t`; знаковое переполнение в C++ — UB.
- `>>` — арифметический сдвиг `int32_t` со счётчиком `& 31`.
- `%` — `a % ((b & 15) + 1)`: делитель 1…16, знак результата — у делимого (совпадает с C++).
- `(ti * acc) & 255` — через `uint32_t`.
- Всё внутреннее — `double`; выход — `float`.
- Сборка с `-ffp-contract=off` (и для WASM, и для натива): без слияния `a*b+c` в FMA.
- `exp`, `pow`, `tanh` libc могут отличаться от JS на 1 ULP — отсюда допуск сверки 1e-6, а не побитовое равенство.

Знак узла в ядро приходит кодом 0…7 в порядке `| & ^ + * - % >`; неизвестный знак — `|` (как `OPS[op] || OPS['|']`).

## Интерфейс WASM (`wasm.cpp`)

```
void   gt_init(double sr)
int*   gt_prog_buf()                                   // 16 int: пары (код знака, сдвиг), до 8 узлов
void   gt_prog(int i, int n)                           // программа голоса i из gt_prog_buf
void   gt_voice(int i, int on, double rate, double lp, double lvl, int legio, double pan, double rel, int trig)
void   gt_fx(double spread, double wide)
float* gt_process(int n)                               // n ≤ 128; буфер: n сэмплов L, затем n сэмплов R
double gt_t0(int i)
double gt_gv(int i)
void   gt_set_t(int i, double t)                       // только для тестов: t[j] = t + j·1777 для всех легионов голоса i
```

Сборка: `emcc -O3 -std=c++17 -ffp-contract=off -sSTANDALONE_WASM --no-entry -sEXPORTED_FUNCTIONS=… -sINITIAL_MEMORY=…` без файловой системы и исключений. Цель — модуль **без импортов**; если emscripten всё же потребует импорт (например `proc_exit`), обёртка даёт заглушки, а тест проверяет список импортов.

Порядок полей в `gt_voice` всегда полный: engine (`sendSpirit`) шлёт все поля в каждом сообщении `voice`. Обёртка для полей, которых в сообщении нет, подставляет прежние значения голоса, которые хранит у себя, — поведение `d[k] != null` сохраняется. Сброс `t` при новом духе (`d.on && g < 1e-4`) — в ядре, внутри `gt_voice`, как в JS.

## Обёртка `goetia-worklet.js`

- `processorOptions.wasm` — `ArrayBuffer` с байтами модуля. В конструкторе — `WebAssembly.instantiate(bytes)` (асинхронно); до готовности `process` пишет тишину, сообщения порта копятся в очереди и применяются после `gt_init(sampleRate)`.
- Сообщения порта прежние: `{t:'voice', i, on, prog, rate, lp, lvl, legio, pan, rel, trig}`, `{t:'fx', spread, wide}`; плюс для тестов `{t:'sett', i, t}` → `gt_set_t`.
- `process`: `gt_process(n)` → копия из памяти WASM в `outputs[0]` (L, R; моно-выход — только L). Вид на память (`Float32Array`) пересоздаётся, если `memory.buffer` сменился.
- Каждые `round(sampleRate / 30)` сэмплов — `{t:'p', tt:[gt_t0(i)…], g:[gt_gv(i)…]}`, как раньше.
- Ошибка загрузки — `{t:'err', msg}` в порт, дальше тишина.

## Engine (`worlds/goetia/engine.js`)

`start()`: параллельно `addModule('goetia-worklet.js?v=')` и `fetch('goetia.wasm?v=').then(r => r.arrayBuffer())`; узел создаётся с `processorOptions: { wasm: bytes }`. Байты кешируются в замыкании engine: после `restartAudio` (новый контекст, `build` → `start`) повторно не качаются. Сообщение `err` — `console.error`. Остальное (шина, эхо, зал, `setLive`, метры) — без изменений.

## Проверка

**Сверка в Node** — `node --test tools/test-goetia-core.mjs`:

- эталон `tools/ref/goetia-worklet.js` и новая обёртка с `goetia.wasm` грузятся в `vm` с заглушками AudioWorklet (как `tools/test-plate.mjs`); оба получают одинаковые сообщения, блоки по 128, 48 кГц;
- сценарии: удар (`rel` 0.2) и дрон (`rel` 1); все восемь знаков, в том числе `%` и `>`; легион 1 и 4 с `spread`/`wide`; изгнание и повторный призыв (сброс `t`); смена `rate` на ходу (сглаживание); три духа сразу; `t` около 2³¹ (через `sett`, в эталон — прямой записью `o.t[j] = t + j·1777`);
- критерий: каждый сэмпл L и R отличается не больше чем на 1e-6; метры `tt`, `g` — тоже;
- модуль без импортов (или только с известными заглушками);
- **render-cli**: те же сценарии текстом (`init`, `prog`, `voice`, `fx`, `sett`, `run <блоков>`) → вывод сравнивается с эталоном тем же критерием; если `core/build/render-cli` не собран — тест пропускается с пометкой;
- **скорость**: 60 с звука, три духа, легион 4 — время `process` эталона и WASM, печатается (не проверяется).

**В браузере:** `python3 tools/shot.py goetia` — сценарий зелёный, без ошибок на странице; новая проверка — после призыва `t2d.goe.ready` и ненулевые `t2d.goe.gains` (звук действительно идёт из WASM). Скриншоты смотреть глазами. Плюс прежние `node --test tools/test-models.mjs tools/models/*.test.mjs` и `node --check` изменённых JS.

**На iPhone (автор):** превью Vercel ветки `native` — Goetia звучит как в проде, без треска; режим полёта после первого захода — звучит офлайн.

## Выкладка

`CACHE` в `sw.js` и все `?v=` в `index.html` — одно число с запасом от `main` (v900), чтобы версии ветки и прода не пересекались. Коммит → пуш в `native` → статус Vercel `success` → ссылка на превью.

## Итог разведки

В `docs/native-plan.md` (фаза 0) — что получилось: сборка, загрузка в Safari, совпадение, офлайн, цифры скорости JS / WASM. В `docs/worlds/goetia.md` — строка: DSP — ядро `core/worlds/goetia`, worklet — обёртка, сверка — `tools/test-goetia-core.mjs`.

## Вне 0а

Модель, шина (эхо, зал) и хост в ядре; JSON-мост с натива; iOS-проект — 0б и дальше.

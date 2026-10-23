# Oceanus: звук на ядре C++ → WASM

Утверждено с автором 23.10. Путь и правила — как у Firmamentum: `docs/superpowers/specs/2026-10-23-firmamentum-wasm-design.md` (читать первой); здесь — только что у Oceanus своё.

## Цель

Звук мира VIII (`ocean-worklet.js`, сканирующий синтез: кольцо из 64 масс, луна, ветер, буря, пальцы, до 6 голосов) считает ядро `core/worlds/oceanus` на C++; в вебе — `ocean.wasm` в AudioWorklet. Для автора мир звучит как раньше.

## Решения

- **Только DSP.** `worlds/oceanus/model.js`, `view.js`, `index.js`, шина и зал — без изменений.
- **ГСЧ** — тот же mulberry32 из `core/common/rng.hpp` (в JS — как в `tools/ref/pulsar-worklet.js`), зерно — `processorOptions.seed`. Вызовы в порядке эталона: шесть начальных фаз голосов в конструкторе (`ph: rnd()`, голоса 0…5), рывок бури (`if (this.storm)`), ветер на каждой массе (`if (this.wind)`).
- **Ветка `native`**, превью, «ок» автора → `main`. Без запасного JS-пути.

## Что повторить явно

1. **Float32-хранение.** `x`, `v`, `a`, `b` — `Float32Array`: JS читает float → считает в double → при записи округляет до float. В ядре — массивы `float`, вычисление выражения в `double`, запись `static_cast<float>`; составные `x[i] += v[i]` — тоже через `double`. Среднее `m` — `double` (как в JS: обычная переменная).
2. **Пальцы — `Map`.** Порядок обхода — порядок вставки; `set` существующего id обновляет значения **на месте**, `delete` удаляет с сохранением порядка остальных. В ядре — массив до 16 пальцев `{id (double), a, d, k}` с этой семантикой; 17-й — мимо. `k` по умолчанию 0.08 (`d.k || 0.08`: 0 и нет поля → 0.08).
3. **`Math.round`** (в `splash` и `step`): `std::floor(x + 0.5)` расходится с JS у `0.49999999999999994` и для отрицательных половин даёт то же, что JS, — повторить JS точно функцией `jsRound(x)`: `r = std::floor(x); return (x - r >= 0.5) ? r + 1 : r;`.
4. **`p | 0`** — для `p ≥ 0` это `static_cast<int>(p)`; `p < N`.
5. **Неполные сообщения.** `params` меняет только присланные поля (`!= null`) — обёртка хранит все девять и шлёт полный набор. `voice`: `on = !!d.on` — всегда; `f` — только если истинно (`if (d.f)`: 0 и нет поля — прежнее); `lvl`, `path` — если `!= null`.
6. **Моно** — `R = out[1] || out[0]`: в ядре `R == nullptr` — пишем только L (как `R === L` в JS).

## Интерфейс WASM

```
void   oc_init(double sr, unsigned seed)
void   oc_params(double kt, double damp, double kc, double wind, double tide, double moonRate, double storm, double sway, double swayTo)
void   oc_push(double id, double a, double d, double k)
void   oc_release(double id)
void   oc_splash(double a, double amt)
void   oc_voice(int i, int on, double f, double lvl, double path)
float* oc_process(int n)                               // n ≤ 128; L, затем R
float* oc_shape(void)                                  // 64 float — x кольца
double oc_moon(void)
double oc_gain(int i)
```

Номер голоса вне 0…5 — мимо (и в `wasm.cpp`, и в классе). Обёртка `ocean-worklet.js` — как `pulsar-worklet.js`: байты и зерно в `processorOptions`, очередь до готовности, `{t:'ready'}` / `{t:'err'}`, кусками по 128, виды на память кешируются и пересоздаются при смене `memory.buffer`; наружу — прежнее `{t:'shape', x: Array(64), moon, g: Array(6)}` каждые `round(sampleRate / 30)` сэмплов. Значения `params` без поля и `f` равное 0 не должны давать `NaN`/0 в ядре — подставляются прежние.

## Файлы

`core/worlds/oceanus/ocean.hpp|.cpp`, `wasm.cpp`; `core/render-cli/main.cpp` (+ `world oceanus`: `init <sr> <seed>`, `params …9`, `push <id> <a> <d> <k>`, `release <id>`, `splash <a> <amt>`, `voice <i> <on> <f> <lvl> <path>`, `run`); `core/build.sh` (+ `ocean.wasm`); `ocean.wasm`; `ocean-worklet.js` (обёртка); `tools/ref/ocean-worklet.js`; `tools/ocean-scenarios.mjs`; `tools/test-ocean-core.mjs`; `worlds/oceanus/engine.js`, `index.js` (`t2d.ocean.core`); `sw.js`, `index.html` (версия); `tools/shot.py` (`oceanus`); `core/README.md`, `docs/worlds/oceanus.md`, `docs/native-plan.md`, `CLAUDE.md`.

## Проверка

`node --test tools/test-ocean-core.mjs` — эталон ↔ render-cli ↔ WASM, 1e-6 на сэмпл, на форму кольца `x`, `moon` и `g`:
- сценарии: один голос, шесть голосов; все три пути скана; натяжение и затухание крайние; прилив и луна (`moonRate` быстрый); `sway` на каждую цель (`swayTo` 0, 1, 2); буря; ветер; палец держит воду, второй палец, повторный `push` того же id (на месте), `release` первого; всплеск; гашение и повторное зажигание голоса; `voice` без `f` и с `f: 0`; `params` с частью полей; удар о потолок ±3 (сильный палец/всплеск); всё сразу — 30 с;
- эталон звучит как прежний worklet: прежняя сторона — тот же код с независимым детерминированным xorshift32 (как у Firmamentum), RMS ±0.5 дБ по среднему N прогонов на сценарии с ветром и бурей;
- без импортов; сообщения до готовности; блок 256 (на одном голосе); номер голоса вне диапазона; 44.1 кГц; скорость JS / WASM (печать).

В браузере — `shot.py oceanus audio` зелёные, `t2d.ocean.core == 'wasm'`, ненулевые `gains`. На iPhone — автор, превью `native`.

**Тонкое место.** Физика линейная и затухающая — расхождение в 1 ULP (`cos`, `exp`, `tanh`) не должно расти. Если долгий сценарий всё же разойдётся — найти первый расходящийся отсчёт и причину (обычно — пропущенное округление до float или порядок суммы); допуск не расширять.

## Выкладка

`CACHE` и `?v=` — следующее число за продом (v171). Остальное — как у Firmamentum.

# Firmamentum: звук на ядре C++ → WASM

Утверждено с автором 23.10. Контекст — `docs/native-plan.md` (фаза 3, миры с worklet; фаза 0 закрыта). Образец — Goetia, `docs/superpowers/specs/2026-10-22-native-0a-goetia-wasm-design.md`: здесь то же, кроме случайности.

## Цель

Звук мира X (пульсары, crepitus, fulgur) считает ядро `core/worlds/firmamentum` на C++; в вебе — `pulsar.wasm` в AudioWorklet. Для автора мир звучит как раньше. Второй мир в ядре и первые общие блоки (`core/common`).

## Решения

- **Объём — только DSP** (`pulsar-worklet.js`). `worlds/firmamentum/model.js`, `view.js`, `index.js`, шина и зал `T.hall()` в engine — без изменений (автор, 23.10: вариант «только звук»; модель в ядре — когда понадобится AUv3 без страницы).
- **Случайность с зерном.** `Math.random` заменяется ГСЧ mulberry32 (только `uint32`-арифметика, в JS — `Math.imul` и `>>> 0`; выход `u32 / 2³²` в [0, 1)) — одинаковым в JS и C++. Эталон — прежний worklet с этой заменой и больше ничем. Ядро зовёт ГСЧ **в том же порядке**, что эталон, строка в строку. В проде зерно случайное: engine передаёт `processorOptions.seed = (Math.random() * 2³²) >>> 0`. На слух — то же самое (та же статистика), иначе только источник случайности.
- **Ветка `native`**, проверка — превью Vercel ветки рядом с продом; после «ок» автора — в `main`.
- **Без запасного JS-пути**, как у Goetia: WASM в Safari уже работает в проде. Не загрузился — тишина и `console.error`.
- Goetia не трогаем.

## Файлы

```
core/
  common/rng.hpp                     mulberry32: next() → double [0, 1)
  common/dc.hpp                      DC-фильтр y = x − x₁ + 0.995·y₁
  worlds/firmamentum/pulsar.hpp|.cpp class Pulsar — порт pulsar-worklet.js
  worlds/firmamentum/wasm.cpp        extern "C" для WASM, один экземпляр на модуль
  render-cli/main.cpp                + команда `world firmamentum` и команды пульсара
  build.sh                           + pulsar.wasm
pulsar.wasm                          собранный модуль, в git, рядом с worklet
pulsar-worklet.js                    тонкая обёртка над pulsar.wasm, протокол прежний
tools/ref/pulsar-worklet.js          эталон: прежний worklet + ГСЧ с зерном (processorOptions.seed)
tools/firm-scenarios.mjs             сценарии и загрузчики (эталон, WASM, текст для render-cli)
tools/test-firm-core.mjs             сверка эталон ↔ WASM ↔ render-cli, замер скорости
```

Правки: `worlds/firmamentum/engine.js` (байты и зерно), `sw.js` (`WORKLETS` += `./pulsar.wasm`, `CACHE`), `index.html` (`?v=`), `tools/shot.py` (сценарий `firmamentum`), `core/README.md`, `docs/worlds/firmamentum.md`, `docs/native-plan.md`, `CLAUDE.md` (строка мира X в таблице).

## Ядро (C++17)

`class Pulsar` повторяет `pulsar-worklet.js` построчно: `VMAX = 6` голосов `{on, fp, ff, cyc, win, mask, lvl, pan, g, fpS, ffS, ph, pt, plen, pf, pa, n}`, сглаживание `g` (0.002 / 0.0008), `fpS`, `ffS` (0.002), новый пульсарет при `ph ≥ 1` (jit, skip по `mask + jit·0.35`, длина `max(8, min(sr/fpS, cyc/ffS·sr))`, `pa`), fulgur при пульсарете, окно (Ханн ↔ удар ↔ прямоугольник), `dust` (crepitus: стайки `burst`, щелчки, шипение; вспышки `pips`), DC-фильтр и `tanh(0.7·y)` на выходе. Метры — `n` и `g` голосов; события — треск `ck` (пары `pan, a`, ≤ 12) и вспышки `fl` (номер голоса, ≤ 8), копятся до чтения.

- Без аллокаций в `process`: треск — массив на 10, вспышки — на 7 (как `pips.length > 6` в JS), события — 12 и 8. Удаление из середины — сдвигом, **порядок сохраняется** (от него зависит порядок вызовов ГСЧ).
- Порядок вызовов ГСЧ — как в JS, включая короткие замыкания: `if (this.jit) …random()`, `fulg > 0 && random() < …`, `c > 0 && act > 0.01`, выбор частоты вспышки после `r < 0.25`.
- Всё внутреннее — `double`, выход — `float`; `-ffp-contract=off`. `x ** y` → `std::pow`, `Math.sign` — явно (0 → 0).
- `R == nullptr` — моно, как ветка `R === L` в JS.

**Тонкое место.** `exp`, `sin`, `tanh`, `pow` в libc и V8 могут отличаться на 1 ULP. Значения это сдвигает на ~1e-16 (допуск 1e-6 покрывает), но порог (`|q.a| < 1e-4` у щелчка) может сработать на сэмпл раньше — тогда число вызовов ГСЧ разъедется и сверка упадёт. Если сверка это покажет — порог делается устойчивым **одинаково в эталоне и ядре** (например, длина щелчка в сэмплах считается при рождении), и это записывается сюда же.

## Интерфейс WASM (`wasm.cpp`)

```
void   pl_init(double sr, unsigned seed)
void   pl_voice(int i, int on, double fp, double ff, double cyc, double win, double mask, double lvl, double pan)
                                                       // on: 1 / 0 / −1 — «нет в сообщении»
void   pl_fx(double jit, double spread, double crep, double fulg)
float* pl_process(int n)                               // n ≤ 128; n сэмплов L, затем n сэмплов R
double pl_count(int i)                                 // n голоса — сколько пульсаретов прозвучало
double pl_gain(int i)                                  // g голоса
int    pl_ck(void) · double* pl_ck_buf(void)          // число событий треска и буфер пар (pan, a); чтение — сбрасывает
int    pl_fl(void) · int* pl_fl_buf(void)             // то же для вспышек
```

Номер голоса вне 0…5 — мимо. Обёртка хранит последние поля голоса и fx и шлёт полный набор (engine шлёт неполные `voice`, например только `fp`); `on` — только если он есть в сообщении, иначе −1: сброс `fpS, ffS, ph` при `on && g < 1e-4` в JS срабатывает лишь на явном `on`. `crep` и `fulg` в JS меняются, только если есть в сообщении, — обёртка подставляет прежние, это то же самое.

## Обёртка `pulsar-worklet.js`

Как у Goetia: `processorOptions.wasm` (байты) и `seed`; `WebAssembly.instantiate` → `_initialize` → `pl_init(sampleRate, seed)` → очередь сообщений → `{t:'ready'}`; ошибка — `{t:'err', msg}` и тишина. `process` — `pl_process` кусками по 128, копия в `outputs[0]`, вид на память пересоздаётся при смене `memory.buffer`. Каждые `round(sampleRate / 30)` сэмплов — `{t:'p', c, g, k, f}`, как раньше (`c` — `pl_count`, `k` — пары из `pl_ck_buf`, `f` — из `pl_fl_buf`).

## Engine (`worlds/firmamentum/engine.js`)

`start()`: параллельно `addModule('pulsar-worklet.js?v=')` и `fetch('pulsar.wasm?v=')` → `arrayBuffer`; узел — с `processorOptions: { wasm, seed }`. Байты кешируются в замыкании engine — после `restartAudio` не качаются заново. `err` — `console.error`. Остальное без изменений.

## Проверка

**Сверка в Node** — `node --test tools/test-firm-core.mjs` (эталон и обёртка — в `vm` с заглушками AudioWorklet, блоки по 128, 48 кГц, одно зерно):

- сценарии: звезда низко (fp 2 Гц, ритм) и высоко (тон); окна 0 / 0.5 / 1; mask 0.5; scintilla; перетаскивание fp и ff на ходу; гашение и повторное зажигание (сброс фазы); шесть звёзд со spread; crepitus 0.3 и 1; fulgur 1; всё сразу — 30 с;
- критерий: каждый сэмпл L и R, метры `c`, `g` и события `k`, `f` — не дальше 1e-6 (события — то же число, те же значения);
- модуль без импортов;
- render-cli (`world firmamentum`, затем `init`, `voice`, `fx`, `run`) — тем же критерием; не собран — пропуск с пометкой;
- скорость: 60 с, шесть звёзд, crepitus и fulgur — время эталона и WASM, печатается.

**В браузере:** `python3 tools/shot.py firmamentum` — зелёный, без ошибок на странице, плюс проверка: после первой звезды `t2d.firm.ready` и ненулевые `t2d.firm.gains`. Скриншоты — глазами. Плюс `node --test tools/test-models.mjs tools/models/*.test.mjs`, `node --test tools/test-goetia-core.mjs` (общий render-cli), `node --check` изменённых JS.

**На iPhone (автор):** превью ветки `native` против прода — Firmamentum звучит так же (ритм, тон, треск, вспышки), без треска от нагрузки; офлайн после первого захода.

## Выкладка

В `native`: `CACHE` и `?v=` — одно число выше прода. Коммит → пуш → Vercel `success` → ссылка на превью. После «ок» автора — `main` (fast-forward или merge), версия — следующая за продом.

## Вне объёма

Модель, комета, drift, шина и зал в ядре; общий хост в ядре; другие миры.

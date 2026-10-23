# SDK, подпроект B: Goetia и Oceanus — миры SDK в `t2d.wasm`

Утверждено с автором 23.10. Основание — `docs/superpowers/specs/2026-10-23-sdk-a-core-design.md` (интерфейс мира, хост, мост, фасад модели; образец — Firmamentum) и `docs/sdk-inventory.md`.

## Решения автора (23.10)

- **Мир целиком в ядре**, как Firmamentum: модель и звук на C++, в JS — фасад модели (прежний API) и картинка. Для AUv3 это нужно всё равно; модели маленькие и без своего времени.
- **Эхо Goetia — внутри мира**, на новом блоке SDK `TapeEcho` (задержка с lowpass в петле). Его же потом возьмёт Natura (та же «моно-лента», `docs/sdk-inventory.md` §2.7). Общим посылом хоста эхо не делаем: у Natura, Portus и Cymatica оно своё по характеру (темп, wow).

## Объём B

1. `core/sdk/echo.hpp` — `TapeEcho`.
2. `core/worlds/goetia/` — мир SDK, слот 15: модель + звук (нынешний `goetia.cpp` без изменений) + эхо + шина.
3. `core/worlds/oceanus/` — мир SDK, слот 8: модель + звук (нынешний `ocean.cpp` без изменений) + шина.
4. Мост `core/bridge/wasm.cpp`: три мира (10, 15, 8). Веб: `SDK_WORLDS = [10, 15, 8]` в `host/audio.js`, фасады `worlds/goetia/model.js` и `worlds/oceanus/model.js`, тонкие `engine.js`.
5. Удаляются: `goetia.wasm`, `ocean.wasm`, `goetia-worklet.js`, `ocean-worklet.js`, `core/worlds/*/wasm.cpp`, их строки в `core/build.sh` и `sw.js`.

**Вне B:** транспорт секвенсеров (с первым секвенсером), AUv3 (C), остальные миры (D), выбор типа реверба в интерфейсе, мастер в ядре.

## Блок `TapeEcho` — `core/sdk/echo.hpp`

Моно-задержка с фильтром в петле, как в Web Audio у Goetia (`worlds/goetia/engine.js`):

```
in · send → Delay(time) → Biquad LP(f, Q) → out
                ↑                    │
                └──────── · fb ──────┘
```

- `TapeEcho{maxSec}`; `prepare(sr)`; `set(time, lpHz, send, fb)`; `process(in, out, n)` — пишет `out` (возврат эха), не прибавляет.
- `send` и `fb` — сглаживание как `setTargetAtTime(·, t, 0.05)` (`OnePole` с `c = 1 − e^(−1/(0.05·sr))` на сэмпл).
- `Biquad` — нынешний `core/sdk/biquad.hpp` (формулы Web Audio, LP с Q в дБ, по умолчанию Q = 1 — как у `BiquadFilterNode`).
- Время задержки у Goetia постоянное (0.375 с): дробное чтение не нужно. Скольжение времени (tau 0.15 у Natura) — параметр блока, когда до неё дойдём.
- В петле Web Audio задержка не короче блока 128 сэмплов — у нас она 18 000, правило не мешает.

## Goetia — `core/worlds/goetia/`

- `model.hpp|.cpp` — порт `worlds/goetia/model.js`: духи `{slot, path, semi, tone, rel, legio, lvl, born}`, `SMAX = 3`, fx `{legio, echo, spread, hall}`, `summon` (все треугольники заняты — уходит самый старый по `born`), `banish`, `setSpirit`, `setFx`, `clear`, `dice` (на `Rng`), снимок — тот же JSON. Чистые функции звука: `progOf`, `trigOf`, `fcOf`, `rate` (лад — у хоста, `snapSemi`, как в JS). Имя духа (`numOf`, `SPIRITS`) и `formula` — только JS (картинка).
- `sound` — нынешний `goetia.cpp` как есть (bytebeat, легион, DC по mid).
- `world.hpp|.cpp` — `class Goetia : sdk::World`; события модели правят голоса, как `sendSpirit` в `engine.js`: `prog`, `rate`, `lp = 1 − e^(−2π·fc/sr)`, `lvl·0.3`, `legio`, `rel`, `trig`, `pan = [−0.6, 0, 0.6][slot]`; новый дух — `t` с нуля; fx → `fx(spread, legio)`.
- **Шина** (как в `engine.js`):
  - сухой выход = (звук + эхо) × 1.6;
  - эхо: вход — звук × `echo·0.8`, обратная связь `echo·0.55`, 0.375 с, LP 2600 — в сухой выход, в зал не идёт;
  - посыл = звук × `hall²·1.5` × 1.6, ревербер — `hall`;
  - ручки шины сглаживаются как `setTargetAtTime(…, 0.05)`.
- Коды `action` (как сделано — `core/worlds/goetia/world.hpp`): `SUMMON` (a = `[slot, born, semi, tone, rel, legio, lvl, узлы…]`), `PATH` (i = born, a = узлы — печать растёт, пока палец ведёт), `BANISH` (i = born), `SET` (i = born, a = `[key, v]`: semi, tone, rel, legio, lvl), `FX` (i = key, a = `[v]`), `CLEAR`, `DICE`, `SETT` (только тесты: стартовое `t`). Дух узнаётся по `born`, а не по слоту: слот после изгнания сразу занимает новый дух, а зеркало приходит позже.
- Зеркало: `fx[4]`, число духов, на духа: `slot, born, semi, tone, rel, legio, lvl, n, узлы[8], t, gain` (`t` — счётчик первого легиона, `gain` — громкость с огибающей: по ним view мигает узлами и ведёт огонёк). Услышанного нет.
- Фасад `worlds/goetia/model.js`: `state.spirits` — живые объекты по `slot`, правятся на месте из зеркала. `summon` / `banish` / `setSpirit` / `clear` применяются сразу и уходят в ядро. Кубик и `restore` считаются здесь (алгоритм прежний, на `rng`) и уходят полными `SUMMON`. Сверка «зеркало догнало действия» — по номеру сообщения, как у Firmamentum. `engine.tt` / `engine.at` / `engine.gains` — из зеркала (60 раз в секунду вместо 30).

## Oceanus — `core/worlds/oceanus/`

- `model.hpp|.cpp` — порт `worlds/oceanus/model.js`: города `{slot, ang, rn, pinned, lvl, oct, path}`, `VMAX = 6`, fx `{tension, damping, wind, tide, hall}`, луна `{orbit, storm, sway, to}`, `semiOf` / `hz` (лад и тоника — у хоста), `addVoice` / `dropVoice` / `moveVoice` / `setVoice` / `setFx` / `setLuna`, `dice` (на `Rng`), снимок — тот же JSON (только `pinned`).
- `sound` — нынешний `ocean.cpp` как есть (кольцо из 64 масс, луна, шторм).
- `world.hpp|.cpp` — `class Oceanus : sdk::World`; перевод fx в параметры кольца переезжает из `engine.js` (`kt = 0.004·60^tension`, `damp = 0.00003·300^damping`, `kc`, `wind²`, `tide·0.9`, `moonRate = 0.005·40^orbit`, `storm`, `sway`, `swayTo`); голос — `hz`, `lvl·0.8`, `path`. Палец по воде: `push(id, a, d, k = 0.06)`, `release(id)`, `splash(a, amt)` — как сейчас.
- **Шина:** сухой выход = звук × 1.6; посыл = звук × `hall²·1.4` × 1.6, ревербер — `hall`; сглаживание — 0.05 с.
- Коды `action` (как сделано — `core/worlds/oceanus/world.hpp`; город узнаётся по `id`, как звезда Firmamentum): `ADD` (a = `[ang, rn, pinned, slot, id]`), `DROP` (i = id), `MOVE` (i = id, a = `[ang, rn]`), `SET` (i = id, a = `[key, v]`: lvl, oct, path, pinned), `FX` (i = key, a = `[v]`), `LUNA` (i = key, a = `[v]`), `PUSH` (a = `[id, a, d]`), `RELEASE` (a = `[id]`), `SPLASH` (a = `[a, amt]`), `CLEAR`, `DICE`.
- Зеркало: `fx[5]`, `luna[4]`, `moon` (доля круга), форма кольца `[64]`, число городов, на город: `slot, id, ang, rn, pinned, lvl, oct, path, hz, gain`. Всего до ~130 чисел (буфер моста — 512). Услышанного нет.
- Фасад `worlds/oceanus/model.js` — так же, как у Goetia; `engine.shape` / `moon` / `gains` — из зеркала.
- **Зерно:** зерно звука = зерно мира от хоста (раньше — `Math.random` страницы при старте узла). Порядок вызовов `Rng` в звуке не меняется — сверка с эталоном по зерну остаётся точной.

## Мост и веб

- `core/bridge/wasm.cpp`: миры 10, 15, 8 в хосте; один `t2d.wasm` без импортов.
- `host/audio.js`: `SDK_WORLDS = [10, 15, 8]` — у каждого мира свой сухой выход узла ядра в его канал микшера (как у Firmamentum); фейдеры — в ядро.
- Узел ядра создаётся всегда в `build` — Goetia и Oceanus больше не грузятся лениво. Ядро считает их каждый блок, даже молча: Goetia без духов почти бесплатна, кольцо Oceanus живёт всегда (~0.5 % одного ядра CPU по замеру V8 — проверить на iPhone). Прежнее «отключить молчащий мир от шины» (`setLive`) уходит.
- `t2d.goe` / `t2d.ocean`: прежний API для `shot.py`; `core` — `'wasm'`, когда ядро готово.

## Проверка

- **Звук без шины, 1e-6:** сухой звук Goetia (эхо и зал 0) и Oceanus из `t2d.wasm` против эталонов `tools/ref/goetia-worklet.js` и `tools/ref/ocean-worklet.js`. Сценарии `tools/goetia-scenarios.mjs` и `tools/ocean-scenarios.mjs` переписываются на действия модели (как `firm-scenarios.mjs` в A); переход `t` через 2³¹ у Goetia остаётся.
- **Шина и эхо — по уровню:** рендер одного состояния прежним `engine.js` (OfflineAudioContext, `tools/render.py`) против ядра — RMS ± 1 дБ, спектр по полосам. По сэмплам здесь не сойдётся: Web Audio сглаживает ручки и считает фильтр в float.
- **`TapeEcho`:** импульс — повторы через 0.375 с, каждый × `fb` и через LP; затухание; без NaN и денормалов на тишине.
- **Модели:** `tools/models/goetia.test.mjs` и `oceanus.test.mjs` проходят против ядра — через фасад над WASM в Node (как `firmamentum-core.mjs`). Плюс сверка «JS-модель ↔ модель ядра»: одно зерно, одни действия — то же состояние.
- **Веб:** `shot.py goetia oceanus firmamentum midi audio` и сценарии всех миров зелёные, без ошибок на странице; `render.py` — время до и после.
- **На iPhone (автор):** превью `native` — Goetia (с эхом) и Oceanus звучат как в проде; несколько миров сразу — не тяжелее, чем v172.

## Сборка

`core/build.sh` собирает `t2d.wasm` через `em++`. В облачной сессии свежий emsdk не скачивается (бинарники лежат на Google Storage, туда нет доступа); есть emscripten 3.1.6 из apt. Отличия: `-sSTACK_SIZE` там называется `-sTOTAL_STACK`, а libc++ тянет импорт WASI `proc_exit`. Первая задача плана — чтобы `build.sh` собирал `t2d.wasm` без импортов обеими версиями, и тесты ядра проходили на сборке 3.1.6. Если не выйдет — сборка на голом clang `--target=wasm32`.

## Выкладка

Ветка `native` (сейчас совпадает с `main`), превью, «ок» автора → `main`. `CACHE` / `?v=` — v173. В `sw.js`: убрать `goetia.wasm`, `ocean.wasm`, `goetia-worklet.js`, `ocean-worklet.js`. Документы: `core/README.md`, `docs/worlds/goetia.md`, `docs/worlds/oceanus.md`, `docs/native-plan.md`, `docs/sdk-inventory.md` (Goetia, Oceanus — на SDK; `TapeEcho`), `CLAUDE.md` (таблица миров и раздел про ядро).

## Риски

- Один узел на хост: сбой ядра глушит теперь три мира (было — один). Ошибка загрузки — `console.error`, миры на Web Audio звучат без реверба (как в A).
- Печать Goetia растёт, пока палец ведёт: `PATH` идёт каждым новым узлом, а зеркало приходит позже. Фасад не перетирает путь из зеркала, пока ядро не применило его сообщение (правило Firmamentum).
- Эхо на слух может чуть отличаться от Web Audio (сглаживание, float). Мерило — RMS ± 1 дБ и слух автора.
- Кольцо Oceanus теперь живёт всегда, а не с первого входа в мир. Картинка этого не видит, CPU — проверить.

# Tenebrae в ядре, этап 1 (звук) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Цель:** звук мира I играет из ядра C++ (слот 1); модель, жесты и рисование остаются в `app.js`.

**Архитектура:** сначала старый звук выносится из `app.js` в модуль `worlds/tenebrae/engine.js` с API «действий» (без смены звучания) и чистые формулы — в `worlds/tenebrae/tone.js`. Потом в ядре строится `tenebrae::World` с теми же действиями, сверяется с этим модулем как с эталоном, и в конце модуль уезжает в `tools/ref/`, а его место занимает тонкий клей к ядру с тем же API.

**Стек:** C++17 (clang++ нативно, em++ → `t2d.wasm`), ES-модули без сборки, Web Audio, Node `node:test`, Python + Playwright для сверки.

**Спека:** `docs/superpowers/specs/2026-10-26-tenebrae-core-design.md` — читать целиком до любой задачи; формулы и константы — оттуда и из `app.js` по указанным строкам.

## Global Constraints

- Мир заморожен: перенос без смены звучания. Отличия от браузера — только неизбежные; каждое записывать в список «что послушать» (`docs/worlds/tenebrae.md`, раздел «Ядро: отличия»).
- Звук: RMS ±1 dB, октавы ±1.5 dB (нижняя ±2 dB, полосы ниже −60 dB от громкой не считаются) против эталона; wasm = нативное до 1e-5 на сэмпл.
- Случайность ядра — только `sdk::Rng` от зерна мира `seed ^ 0x54454eu`. `Math.random` в JS-модели не трогаем.
- C++17, `-fno-exceptions`, без аллокаций в `process`, память wasm 16 МБ (таблицы мира ≤ 1 МБ). Комментарии — по-русски, плотность как в `core/sdk/`.
- Блоки SDK — только заголовки `core/sdk/*.hpp`; тесты ядра — функции `static void x()` в `core/tests/sdk_test.cpp` с `CHECK`/`NEAR`, вызов добавить в `main`; каждый новый `.cpp` — явно во все нужные строки `core/build.sh` и `core/build-wasi.sh` (глобов нет).
- Мост общий: `t2d_action(slot, kind, i, a, n)`, `t2d_mirror(slot)`; своих экспортов у мира нет.
- Импорты `host/` и `worlds/` — без `?v=`. Новые веб-файлы — в списки `sw.js`. Каждый пуш — новая версия (`CACHE` в `sw.js` = `?v=` в `index.html`), `t2d.wasm` — в одном коммите с правкой `core/`. Хук `.claude/hooks/guard.py` это проверяет.
- Ветка `native`, в `main` не пушить. После пуша — `python3 tools/deploy-wait.py`.
- Коммиты — по-английски, тело — список, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Голос, который отцепили и снова включили (`LIVE 0 → 1`), не щёлкает и не стартует со старым состоянием фильтров/петли comb.** Ожидание — как в вебе: узлы сохраняют состояние, но голос молчал (env ≈ 0). Тест — в задаче 6 (`tenebraeVoiceRelive`).
2. **tzfm-связь от источника, у которого сменилась высота, сразу меняет глубину в Гц у приёмника** (в вебе — пометка `dirty` по tzfm). Тест — в задаче 7 (`tenebraeTzfmFollows`).
3. **`LINKS` с пустым списком снимает все связи приёмника и возвращает базу vca к 1.** Тест — в задаче 7 (`tenebraeLinksClear`).
4. **Смена аудиоконтекста (`restartAudio`) в середине игры — звук продолжается теми же голосами, связями и LFO.** Проверка — в задаче 9 (сценарий `shots` с `restartAudio`).
5. **Очень низкая (x = 0, 55 Гц и ниже по ладу) и очень высокая (x = 1) планета: таблица без гармоник выше Найквиста, comb-задержка ≤ 1 с, нет NaN.** Тест — в задаче 4 (`tenebraeWavesNyquist`) и задаче 6 (`tenebraeVoiceExtremes`).

---

## Файлы

| Файл | Отвечает за | Задача |
|---|---|---|
| `worlds/tenebrae/tone.js` | чистые формулы: `freqOf`, `beatHz`, `cutoffOf`, `shiftHz`, `waveCoeffs`, `alignCoeffs` | 1 |
| `worlds/tenebrae/engine.js` | этап A — старый звук на Web Audio с API действий; этап B (задача 9) — клей к ядру с тем же API | 2, 9 |
| `tools/models/tenebrae-tone.test.mjs` | тест формул | 1 |
| `core/sdk/shaper.hpp` | + oversample 4× | 3 |
| `core/worlds/tenebrae/tone.hpp` | те же формулы на C++ | 4 |
| `core/worlds/tenebrae/waves.{hpp,cpp}` | таблицы, мип-уровни, морф | 4 |
| `core/worlds/tenebrae/shifter.hpp` | сдвиг частоты | 5 |
| `core/worlds/tenebrae/voice.{hpp,cpp}` | голос | 6 |
| `core/worlds/tenebrae/world.{hpp,cpp}` | мир: голоса, связи, LFO, шина, эхо, удар, действия, зеркало | 7 |
| `core/tests/tenebrae_cli.cpp` | нативный рендер сцены | 7 |
| `tools/tenebrae-ref-nums.mjs` | печатает эталонные числа из JS для `sdk_test.cpp` | 4, 5 |
| `tools/ref/tenebrae-scenes.js`, `tools/ref/tenebrae-bus.html`, `tools/tenebrae-bus.py`, `tools/test-tenebrae-core.mjs` | сцены и сверки | 8 |
| `tools/ref/tenebrae-engine.js` | эталон — бывший `worlds/tenebrae/engine.js` этапа A | 9 |

## Общие имена (все задачи)

**Коды действий** (C++ `enum Act` в `core/worlds/tenebrae/world.hpp`, те же числа — `ACT` в `worlds/tenebrae/engine.js`):
`VOICE = 0, ON = 1, OFF = 2, LIVE = 3, LINKS = 4, LFO = 5, FX = 6, STRIKE = 7, CLEAR = 8`; `kind = −1` — тик хоста, пропускать.

- `VOICE i` — a = `[x, y, cut, res, wave, beat, fm, shift, amp, holeT, snap]` (11 чисел, как поля `v` в `app.js`; `beat`, `shift`, `cut` — нормированные, как в модели).
- `OFF i` — a = `[tau]`. `LIVE i` — a = `[0|1]`. `FX` — a = `[rev, dly, dirt]`. `STRIKE` — a = `[p]`.
- `LINKS i` — a = `[src, type, depth] × k`, type: `0 fm, 1 tzfm, 2 am, 3 rm` (JS `LINK_TYPES = ['fm','tzfm','am','rm']`).
- `LFO i` — a = `[key, morph, rate, depth]`, key: `0 pitch, 1 wave, 2 cut, 3 res, 4 beat, 5 shift, 6 amp, 7 fm` (JS `LFO_KEYS` в этом порядке); depth 0 — снять.

**Зеркало:** `MIRROR_HEAD = 1` (число голосов, 6), `MIRROR_V = 130` на голос: `[live, env, p0 … p127]`, всего `MIRROR_N = 781`.

**JS API движка** (`createEngine`, обе реализации):

```js
export const ACT = { VOICE: 0, ON: 1, OFF: 2, LIVE: 3, LINKS: 4, LFO: 5, FX: 6, STRIKE: 7, CLEAR: 8 };
export const LINK_TYPES = ['fm', 'tzfm', 'am', 'rm'];
export const LFO_KEYS = ['pitch', 'wave', 'cut', 'res', 'beat', 'shift', 'amp', 'fm'];
export function createEngine({ ctx, out, send, scale }) → {
  voice(i, v),            // v — поля голоса модели (x, y, cut, res, wave, beat, fm, shift, amp, holeT, snap)
  on(i), off(i, tau), live(i, on),
  links(i, mods),         // mods — [{src, type, depth}] приёмника i, целиком
  lfo(i, key, spec),      // spec — {morph, rate, depth} | null
  fx({ rev, dly, dirt }), strike(p), clear(),
  busEnv(sum),            // Σ env активных; клей к ядру — пустой (ядро считает само)
  scope(i),               // Float32Array(128) точек контура | null, если голос не живой
  dispose(),
}
```

---

## Task 1: формулы Tenebrae в `tone.js`

**Files:**
- Create: `worlds/tenebrae/tone.js`, `tools/models/tenebrae-tone.test.mjs`
- Modify: `app.js` (≈ 68-71 `shiftHz`, 112-127 `soundX`/`quantX`/`freq`/`cutoff`, 1196-1226 `makeWave`/`alignWaves`, место расчёта beat в Гц в `apply`), `sw.js` (список файлов)

**Interfaces:**
- Produces (чистые функции, без DOM и Web Audio):
  - `freqOf(x, scale) → Hz` — `soundX`/`quantX` + `55·2^(semi/12)`, `semi = 60·clamp(x)^1.45`;
  - `beatHz(beat) → Hz` — как `apply` переводит `v.beat` в сдвиг c2;
  - `cutoffOf(cut, y, fmOpen) → Hz` — `cutoff` из строки 127;
  - `shiftHz(t) → Hz`;
  - `waveCoeffs(fn) → { re: Float64Array(220), im: Float64Array(220), level }` — математика `makeWave` без `createPeriodicWave`;
  - `alignCoeffs(list) → [{ re, im }]` — математика `alignWaves`.
- В `app.js` старые функции заменяются импортом; `freq(v)` и `cutoff(v)` остаются тонкими обёртками для рисования.

- [ ] **Step 1: Снять эталонные числа старого кода.** До правок запустить в Node маленький скрипт (в scratchpad, не в репозитории), который копирует старые `shiftHz`, `cutoff`, `semi`/`freq` (лад выключен) и `makeWave` (без `createPeriodicWave`) и печатает: `shiftHz` на t = 0, 0.25, 0.49, 0.52, 0.75, 1; `cutoff` на (cut, y, fmOpen) = (0, .5, 0), (1, .5, 0), (.68, 0, 0), (.68, 1, 1); `freq` на x = 0, .5, 1; `level` всех 9 форм; `re[1], im[1], re[7], im[7]` пилы (форма 2). Числа вставить в тест шага 2.
- [ ] **Step 2: Написать тест** `tools/models/tenebrae-tone.test.mjs`:

```js
test('shiftHz: края и мёртвая зона', () => {
  assert.equal(shiftHz(0.5), 0); assert.equal(shiftHz(0.51), 0);
  near(shiftHz(1), 1500, 1e-9); near(shiftHz(0), -1500, 1e-9);
  // + числа шага 1 на всей сетке, 1e-12
});
test('cutoffOf / freqOf / beatHz = старый код', () => { /* числа шага 1, 1e-9 */ });
test('waveCoeffs: level всех форм и гармоники пилы = старый makeWave', () => { /* 1e-12 */ });
test('alignCoeffs: модуль своей гармоники, фаза пилы', () => {
  // для каждой формы i и h = 1…219: hypot(al[i].re[h], al[i].im[h]) ≈ hypot(w[i].re[h], w[i].im[h]) (1e-12),
  // и там, где модуль > 1e-9, atan2 совпадает с пилой (1e-9)
});
```

- [ ] **Step 3:** `node --test tools/models/tenebrae-tone.test.mjs` → FAIL (нет модуля).
- [ ] **Step 4:** создать `tone.js`, перевести `app.js` на импорт (поведение не меняется), добавить файл в `sw.js`.
- [ ] **Step 5:** `node --test tools/test-models.mjs tools/models/*.test.mjs` → всё PASS; `node --check app.js`.
- [ ] **Step 6:** коммит `Tenebrae: pure sound formulas move to worlds/tenebrae/tone.js` (без пуша — пуш после задачи 2).

## Task 2: старый звук — в `worlds/tenebrae/engine.js` (этап A)

**Files:**
- Create: `worlds/tenebrae/engine.js`
- Modify: `app.js` — звук ≈ 1168-1500 (`solBuild`, `voiceNodes`, `apply`, `morphOsc`, `morphPos`, `useTables`, сдвиг, удар), `attack` 311, `release` 322, `linkTargets`/`wire` 335-360, `setLfo` 408, `applyFx` 1307, нормировка шины 2413-2417, подключение/отцепление 315/1362/2409, `contour` 1577-1597; `index.html` / `sw.js` (версия, список)

**Interfaces:**
- Consumes: `tone.js` (задача 1).
- Produces: JS API движка из «Общих имён»; `app.js` больше не создаёт узлов Web Audio для Tenebrae и не держит `v.nodes` (флаг «живой» — `v.live` в модели).

- [ ] **Step 1:** перенести код как есть в `createEngine({ ctx, out, send, scale })`: `voice(i, v)` делает то, что делал `apply(v)` (включая `snap`), `links` — `wire`/`linkTargets` по списку `mods`, `scope(i)` — выборка 128 точек из `vscope` ровно как в `contour` (переход через ноль в первых 480, `span = round(clamp(sr/f·2, 64, 520))`), `busEnv(sum)` — `bus.gain` с τ 0.3. `out` — вход канала микшера 1 (`chans[1].in`), `send` — то, что сейчас `send('hall')`.
- [ ] **Step 2:** в `app.js` заменить все обращения к узлам вызовами движка; `contour` берёт точки из `engine.scope(i)`, масштаб `pk`/`k` и рисование — без изменений. `restartAudio` (особый случай мира 1, `host/audio.js:176`) пересоздаёт движок и шлёт заново все голоса (`voice`, `on`/`live` для активных, `links`, `lfo`, `fx`).
- [ ] **Step 3: Проверка, что звук не изменился.** `python3 tools/render.py` до и после (по 3 прогона, `Math.random` даёт разброс): средний RMS второй половины отличается не больше разброса между прогонами. Агент `shots`: сценарии `planets ring hole sun solniger undo audio` — контуры рисуются и дышат, «дыра» гасит, ошибок в консоли нет.
- [ ] **Step 4:** `node --check app.js worlds/tenebrae/engine.js`; новая версия в `sw.js`/`index.html`; коммит `Tenebrae: Web Audio sound moves out of app.js into worlds/tenebrae/engine.js`; пуш в `native`; `python3 tools/deploy-wait.py` → `success`.

## Task 3: `Shaper` с oversample 4×

**Files:**
- Create: `tools/shaper-os4-ref.py`
- Modify: `core/sdk/shaper.hpp`
- Test: `core/tests/sdk_test.cpp`

**Interfaces:**
- Produces: у `sdk::Shaper<N>` и `sdk::TanhShaper` вместо `bool os2` — `int os` (1, 2, 4); 4× — каскад двух существующих 2× (апсэмпл 2× → 2× → кривая → даунсэмпл 2× → 2×), как Chromium `WaveShaperDSPKernel::ProcessCurve4x`. Старые вызовы с 2× и без oversample дают те же числа.

- [ ] **Step 1: Тест** `shaperOs4()`: кривая `asym(2.4, 0.35)` (как `host/audio.js:11`, 1024 точки, перенести формулу в тест), вход — синус 1 кГц амплитуды 0.8 при 48 кГц, 4800 сэмплов; эталон — те же 4800 сэмплов из Chromium (`WaveShaperNode` с `oversample = '4x'` в OfflineAudioContext; скрипт `tools/shaper-os4-ref.py` на Playwright по образцу `tools/param-check.py` печатает C++-массив, его вставить в тест) — сравнить сэмплы 200…4799 (после задержки FIR) до 1e-5; плюс прежние проверки `shaper()` — без изменений.
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` → FAIL на `shaperOs4`.
- [ ] **Step 3:** реализовать `os` 4×; миры, что зовут 2×, перевести на `os = 2` без смены чисел.
- [ ] **Step 4:** `core/build.sh && core/build/sdk-test` → `0 failed`; сверки миров, что используют `Shaper`/`TanhShaper` (по `grep` в `core/worlds/`; их проверки — `docs/testing.md`), — зелёные.
- [ ] **Step 5:** коммит (с `t2d.wasm`) `sdk: Shaper oversample 4x (cascade of two 2x, as Chromium)`.

## Task 4: формулы и таблицы волн на C++

**Files:**
- Create: `core/worlds/tenebrae/tone.hpp`, `core/worlds/tenebrae/waves.hpp`, `core/worlds/tenebrae/waves.cpp`, `tools/tenebrae-ref-nums.mjs`
- Modify: `core/build.sh`, `core/build-wasi.sh` (`waves.cpp` в sdk-test и wasm)
- Test: `core/tests/sdk_test.cpp`

**Interfaces:**
- Consumes: `tone.js` (числа), функции форм из `core/sdk/lfo.cpp` (`WaveMorph`) — вынести в общий заголовок, если сейчас они `static` в `.cpp`, без смены чисел `WaveMorph`.
- Produces:

```cpp
namespace tenebrae {
double freqOf(double x, const Scale& sc);          // tone.hpp, как freqOf в tone.js
double beatHz(double beat);
double cutoffOf(double cut, double y, double fmOpen);
double shiftHz(double t);

struct Tables {                                     // waves.hpp
  static constexpr int FORMS = 9, HARM = 220, N = 2048, LEVELS = 11;
  float voice[FORMS][LEVELS][N];                    // выровненные фазы, мип по октавам, нормированы по пику полной таблицы
  float lfo[FORMS][N];                              // исходные фазы, один уровень, нормированы так же
  double level[FORMS];                              // 0.24 / RMS исходного цикла
  double re[2][FORMS][HARM], im[2][FORMS][HARM];   // [0] голос (выровнено), [1] LFO
  void build();                                     // в prepare, один раз
  int levelFor(double hz, double sr) const;         // наименьший L: (219 >> L)·hz < sr/2
};
struct Morph {                                      // один генератор (c1, c2 или LFO)
  double ph = 0;
  double voiceStep(const Tables& t, double pos, double hz, double sr);   // Σ w_i^0.85·level_i·voice[i][L], фаза += hz/sr
  double lfoStep(const Tables& t, double pos, double hz, double sr);     // Σ w_i·lfo[i]
};
}
```

- [ ] **Step 1:** `tools/tenebrae-ref-nums.mjs` печатает C++-инициализаторы: `level[9]`; `re/im` для h ∈ {1, 2, 3, 7, 50, 218} всех форм обоих наборов (из `waveCoeffs`/`alignCoeffs`); `freqOf` на x ∈ {0, .3, .5, .8, 1} (лад выключен и лад «минор» от A — как его задают тесты Natura); `beatHz`, `cutoffOf` на сетке задачи 1; `shiftHz` на t ∈ {0, .1, …, 1}. Вывод вставить в `sdk_test.cpp`.
- [ ] **Step 2: Тесты** `tenebraeTone()` (все формулы = JS до 1e-9), `tenebraeWaves()`:

```cpp
static Tables T; T.build();
for (int f = 0; f < 9; f++) NEAR(T.level[f], REF_LEVEL[f], 1e-9);
// re/im на выбранных h, оба набора — 1e-9
// пик |voice[f][0][k]| и |lfo[f][k]| по k = 1 (±1e-6) для каждой формы
```

  `tenebraeWavesNyquist()`: для hz = 27.5 и 4000 при sr 48000 — у уровня `levelFor` в спектре (ДПФ таблицы) нет гармоник выше `sr/2/hz` (энергия < 1e-12); один период `voiceStep` на 4000 Гц — конечный, |y| ≤ Σ level.
  `tenebraeMorph()`: pos = 0 → только форма 0 (сравнить с `voice[0]`·level[0]); pos = 0.0625 → формы 0 и 1 с весами 0.5^0.85.
- [ ] **Step 3:** `core/build.sh && core/build/sdk-test` → FAIL (нет `waves`).
- [ ] **Step 4:** реализовать `tone.hpp`, `waves.{hpp,cpp}`; таблицы — обратное ДПФ по гармоникам `h ≤ 219 >> L` в `N` точек, нормировка — одним множителем `1/max|полная таблица|` на все уровни формы.
- [ ] **Step 5:** `core/build/sdk-test` → `0 failed`.
- [ ] **Step 6:** коммит (с `t2d.wasm`) `Tenebrae core: wave tables and sound formulas`.

## Task 5: сдвиг частоты

**Files:**
- Create: `core/worlds/tenebrae/shifter.hpp`
- Test: `core/tests/sdk_test.cpp`

**Interfaces:**
- Produces:

```cpp
namespace tenebrae {
struct Shifter {
  void reset();
  double step(double x, double hz, double sr);   // I·cos + Q·sin, своя квадратурная фаза; только wet
};
}
```

Коэффициенты Niemitalo, секции `b = [a², 0, −1]`, `a = [1, 0, −a²]`, задержка на сэмпл у I — из спеки. Dry/wet — в голосе (задача 6).

- [ ] **Step 1: Тест** `tenebraeShifter()`: синус 1000 Гц, 48000 сэмплов, `hz = 300` → ДПФ второй половины: пик в бине 1300 Гц, энергия на 700 Гц ≤ пик − 40 dB; `hz = −300` → пик 700 Гц; `hz = 0` → выход — тот же синус со сдвигом фазы (RMS = RMS входа ± 0.1 dB).
- [ ] **Step 2:** FAIL → **Step 3:** реализовать → **Step 4:** `core/build/sdk-test` → `0 failed`.
- [ ] **Step 5:** коммит (с `t2d.wasm`) `Tenebrae core: Hilbert frequency shifter`.

## Task 6: голос

**Files:**
- Create: `core/worlds/tenebrae/voice.hpp`, `core/worlds/tenebrae/voice.cpp`
- Modify: `core/build.sh`, `core/build-wasi.sh`
- Test: `core/tests/sdk_test.cpp`

**Interfaces:**
- Consumes: `Tables`, `Morph`, `Shifter`, `tone.hpp`; SDK: `Param`, `TanhShaper` (os 2), `Shaper`, `Biquad`, `Delay`, `Rng`, `Osc`.
- Produces:

```cpp
namespace tenebrae {
struct ModIn { double fmCents, tzHz, vcaAdd, rmSum; };   // Σ от связей на этот сэмпл (rmSum — глубины, для базы vca)
class Voice {
 public:
  void prepare(double sr, uint32_t seed, const Tables* t, int index);   // index → k = 1 + i·0.137
  void set(const double* a, double f, double fmOpen);  // 11 чисел VOICE; f — уже по ладу; fmOpen — от связей
  void on(); void off(double tau); void live(bool on); bool isLive() const;
  void lfo(int key, double morph, double rate, double depth);
  double modOut() const;                                 // сигнал m этого сэмпла: синус f × огибающая
  void prestep();                                        // считает m и огибающую на сэмпл (до связей)
  void step(const ModIn& in, double& L, double& R);      // выход голоса после панорамы
  double env() const; double freq() const;
  void scope(double* out128) const;                      // 128 точек контура (как contour)
};
}
```

  Значения с τ — `sdk::Param` (τ из `apply`, на `snap` — 0.004); коэффициенты `lp`, `bp`, hiss-HP и петли comb — раз в 16 сэмплов. Кольцо контура — 1024 сэмпла после vca.
- [ ] **Step 1: Тесты:**
  - `tenebraeVoiceSilent()`: `live(false)` → `step` даёт 0, `prestep` не двигает фазы (до и после 48000 сэмплов `freq()`/`env()` те же).
  - `tenebraeVoiceExtremes()`: x = 0 и x = 1, fm = 1, hole = 1, shift = 1, LFO на всех ключах depth 1 — 4 с: все сэмплы конечные, пик < 4, delay comb ≤ 1 с.
  - `tenebraeVoiceRelive()`: ON, 1 с, OFF τ 0.25, 2 с, `live(false)`, 1 с, `live(true)`, ON — первые 256 сэмплов после ON: |y| ≤ |y| сэмплов 256…512 (нет щелчка выше установившегося).
  - Совпадение звука голоса с вебом здесь не проверяется — это задача 8 (сцена `one` и дальше).
- [ ] **Step 2:** FAIL → **Step 3:** реализовать по `voiceNodes`/`apply` (спека, раздел «Голос») → **Step 4:** `core/build/sdk-test` → `0 failed`.
- [ ] **Step 5:** коммит (с `t2d.wasm`) `Tenebrae core: voice`.

## Task 7: мир — связи, LFO, шина, эхо, удар, действия, зеркало, CLI, слот 1

**Files:**
- Create: `core/worlds/tenebrae/world.hpp`, `core/worlds/tenebrae/world.cpp`, `core/tests/tenebrae_cli.cpp`
- Modify: `core/bridge/wasm.cpp` (статический `tenebrae::World ten(host.scale())`, в `t2d_init`: `ten.prepare(sr, seed); worlds[1] = &ten; host.add(1, &ten);`; `mbuf[1024]`), `t2d-worklet.js` (`Float64Array(..., 1024)`), `core/build.sh` (строка `tenebrae-cli`, исходники мира в sdk-test и em++), `core/build-wasi.sh`
- Test: `core/tests/sdk_test.cpp`

**Interfaces:**
- Consumes: `Voice` (задача 6), `sdk::PingPong` (`prepare`, `setLp`, wow через `step(…, mod)`), `Shaper` os 4, `Param`, `Rng`.
- Produces: `class World : public sdk::World` с `explicit World(const Scale&)`, `enum Act` и `MIRROR_*` из «Общих имён». `rev()` — как у других миров с посылом в общий зал (найти, что сейчас даёт `send('hall')` у мира 1 в `host/audio.js`, и вернуть те же настройки). `snapshot()` → `""`, `restore()` — ничего, `heard()` → 0, `sounding()` — есть живой голос с env > 0.004.
  Порядок на сэмпл: `prestep` всех голосов → для каждого приёмника собрать `ModIn` из его связей (глубины — `Param` с τ из `app.js:1476-1484`; tzfm — `depth·5·freq(src)` пересчитывается при смене частоты источника) → `step` голосов → шина `1/√max(1, Σ env)` (τ 0.3, пересчёт раз в блок 128) → pre / asym os 4 / post → эхо → `Out{L, R, sL, sR}`. `STRIKE` — по `app.js:1172-1186` на `Rng`. `CLEAR` — OFF τ 0.25 всем, снять связи и LFO.
  `tenebrae_cli`: stdin — `scale on idx root`, `secs S`, `act t kind i a…` (как `natura_cli.cpp`); `prepare(48000, 1)`, блоки 128; stdout — float32 по 4 канала (L, R, sL, sR); с `--time` — в stderr множитель реального времени.
- [ ] **Step 1: Тесты:**
  - `tenebraeWorldBus()`: 6 голосов VOICE + ON, 3 с → множитель шины = 1/√6 ± 1% (геттер для теста); `LIVE 0` всем → выход затихает до < 1e-6 через эхо-хвост ≤ 6 с.
  - `tenebraeTzfmFollows()`: связь tzfm 0 → 1 depth 0.5; сменить x источника (VOICE) → через 0.2 с глубина в Гц у приёмника = `0.5·5·freq(src_new)` ± 1%.
  - `tenebraeLinksClear()`: `LINKS 1` с rm 0.8 → база vca < 0.3; `LINKS 1` пустой → через 0.5 с база = 1 ± 1e-3.
  - `tenebraeMirror()`: после 1 с одной планеты `mirror()` = 781 число, `[0] = 6`, у живого голоса `live = 1`, 128 точек не все нули; у неживого — `live = 0`.
  - `tenebraeCycleSafe()`: связи 0 → 1 и 1 → 0 tzfm 1 и fm 1 — 4 с конечные, пик < 4.
- [ ] **Step 2:** FAIL → **Step 3:** реализовать мир, CLI, слот 1 в мосте, `mbuf` 1024 → **Step 4:** `core/build.sh && core/build/sdk-test` → `0 failed`; `node --test tools/test-*-core.mjs` других миров — зелёные (мост не сломан).
- [ ] **Step 5:** коммит (с `t2d.wasm`) `Tenebrae core: world in slot 1 (sound only), native cli`.

## Task 8: сверка с эталоном и wasm = нативное

**Files:**
- Create: `tools/ref/tenebrae-scenes.js`, `tools/ref/tenebrae-bus.html`, `tools/tenebrae-bus.py`, `tools/test-tenebrae-core.mjs`
- Modify: `docs/testing.md` (новые сверки)

**Interfaces:**
- Consumes: `worlds/tenebrae/engine.js` этапа A (эталон, пока он ещё там), `ACT`, `LINK_TYPES`, `LFO_KEYS`, `tenebrae-cli`, `tools/t2d-core.mjs` (`loadT2d`).
- Produces: `SCENES = { name: { secs, acts: [[t, kind, i, a]] } }` — сцены спеки (раздел «Проверка») по одной на случай: `one`, `wave5`, `wave9`, `tzfm`, `fm`, `am`, `rm`, `shift`, `hole`, `lfocut`, `full`, `tail`, плюс `strike` (одна планета и два `STRIKE` p = 0.3 и 1). Страница проигрывает `acts` через `createEngine` в OfflineAudioContext 48 кГц, выход и посыл — в `ChannelMerger(4)`, отдаёт `window.__res` как `natura-bus.html`.

- [ ] **Step 1:** сцены, страница, `tenebrae-bus.py` (по образцу `natura-bus.py`: L и R — оба, мир стерео), `test-tenebrae-core.mjs` (по образцу `test-natura-core.mjs`: сухой выход wasm против CLI ≤ 1e-5, зеркало — то же число точек и `live`).
- [ ] **Step 2:** `python3 -m http.server 8765` в фоне, `python3 tools/tenebrae-bus.py` — каждая строка `ok`; при FAIL — `superpowers:systematic-debugging`, разбирать по сцене от простых к сложным; отличие, которое не ошибка (шаг фильтра 16 сэмплов, мип-уровни вместо таблиц браузера, шум на `Rng`), — записать в «Ядро: отличия» `docs/worlds/tenebrae.md` и, только если оно в допуске нельзя уложить, остановиться и спросить автора.
- [ ] **Step 3:** `node --test tools/test-tenebrae-core.mjs` → PASS.
- [ ] **Step 4:** `core/build/tenebrae-cli --time < сцена full` — множитель ≥ 20× реального времени; число записать в `docs/testing.md`.
- [ ] **Step 5:** коммит `Tenebrae core: checks against the Web Audio engine, wasm = native`.

## Task 9: веб играет Tenebrae из ядра (этап B)

**Files:**
- Move: `worlds/tenebrae/engine.js` → `tools/ref/tenebrae-engine.js` (`git mv`; поправить импорт в `tenebrae-bus.html`)
- Create: `worlds/tenebrae/engine.js` — клей к ядру с тем же API
- Modify: `host/audio.js` (слот 1 в `SDK_WORLDS`; `T.core.dry[1]` → `chans[1].in`; особый случай мира 1 в `restartAudio` — повторная отправка через движок), `app.js` (только создание движка, если сигнатура поменялась), `sw.js`, `index.html` (версия, списки)

**Interfaces:**
- Consumes: мост воркера (`{t:'action', slot: 1, kind, i, a}`), зеркало `{t:'m', w:{1:{mirror}}}`, `MIRROR_*`.
- Produces: тот же JS API; `voice(i, v)` → `ACT.VOICE` с 11 числами; `links` → плоский список с кодами типов; `lfo` → код ключа; `busEnv` — пусто; `scope(i)` — 128 точек из последнего зеркала (null, если `live = 0`); `bind()` после смены контекста шлёт заново всё, что знает (держит последние значения каждого действия по голосу).

- [ ] **Step 1:** клей + подключение слота 1; удалить из `app.js` остатки, ставшие ненужными.
- [ ] **Step 2:** `node --check` всех правленых JS; `node --test tools/test-models.mjs tools/models/*.test.mjs` → PASS; `python3 tools/tenebrae-bus.py` → всё `ok` (эталон теперь из `tools/ref/`).
- [ ] **Step 3:** агент `shots`: `planets ring hole sun solniger undo audio` + смена аудиоконтекста посреди игры (Review Focus 4) — контуры рисуются и дышат, звук идёт (уровень мастера > −60 dB), ошибок нет; другие миры (`worlds`) не сломаны.
- [ ] **Step 4:** новая версия, коммит `Tenebrae: sound plays from the C++ core (slot 1)`, пуш в `native`, `python3 tools/deploy-wait.py` → `success`.

## Task 10: доки

**Files:**
- Modify: `docs/worlds/tenebrae.md` (звук в ядре: файлы, действия, зеркало, «Ядро: отличия» — список «что послушать»), `core/README.md`, `docs/sdk-inventory.md` (§10 и кандидаты comb 1/f, FM-связи), `docs/sdk-rules.md` (`Shaper` os 4), `docs/native-ios-plan.md` (фаза 4: этап 1 сделан), `docs/testing.md`, `docs/tokens.md` (строка: дата, Tenebrae / звук в ядро, токены — `python3 tools/tokens.py --line`), `CLAUDE.md` (таблица миров: I — «ядро, слот 1 (звук)»)

- [ ] **Step 1:** обновить доки; `README.md` — только если видимое поведение поменялось (не должно).
- [ ] **Step 2:** коммит `docs: Tenebrae sound in the core (stage 1)`, пуш, `deploy-wait`.
- [ ] **Step 3:** автору — коротко: что поменялось, ссылка на превью ветки, список «что послушать», честно: на iPhone не проверено.

# IX · Horologium → ударные — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** кольца II…IX звучат ударными (FM и шум) вместо резонаторов; у кольца — `inst`, в нативе — строка *instrument* и подпись при касании.

**Architecture:** голоса ударных — новый файл мира `core/worlds/horologium/drums.hpp/.cpp` (класс `Drum`, один голос на кольцо). Модель получает `inst` и считает высоту тонального голоса (`Model::pitch(i)`: гармоника тоники → ступень лада → октава в диапазон инструмента) и окраску шума (`Model::tint()`). `Sound` оставляет колесо и обнаружение удара, вместо молоточка и резонатора запускает `Drum` с потолком 24 перезапуска в секунду. Зеркало — 55 (кольцо: `on, under, phi, lvl, inst`). Веб — только фасад; натив — плашка, подпись, без `limen`.

**Tech Stack:** C++17 (ядро, `core/build.sh`: `sdk-test`, `t2d.wasm`, `mix-cli`), JS (фасад, `node --test`), Swift + CoreGraphics (XCTest, `xcodegen`).

**Spec:** `docs/superpowers/specs/2026-11-04-horologium-drums-design.md`

## Global Constraints

- Ветка `native`; коммиты — по-английски, тело списком; `notebooks/*` не коммитить (чужие).
- Голоса — в мире (`core/worlds/horologium/`), не в `core/sdk/`. Из SDK — `sdk::Biquad`, `sdk::Rng`, `Scale::snapSemi`.
- Шум — ГСЧ звука (`rng_` в `Sound`, `rng.next() * 2 - 1`); никакого `Math.random` / `rand()`.
- `inst` 0…7: 0 kick, 1 tom, 2 snare, 3 clap, 4 rim, 5 hat, 6 bell, 7 open hat; умолчание кольца `i` (II = 0 … IX = 7) = `i`.
- `RingKey::INST = 4`; `RING_KEYS` — `on, under, phi, lvl, inst`; зеркало `15 + 5 × 8 = 55`.
- `MIN_GAP = 1/24 с` на кольцо: удар раньше — счётчик удара и вспышка идут, голос нет.
- Выход: DC-блок и `tanh(0.9x)` остаются; пик до `tanh` ≤ 0.9 ⇔ `|out| ≤ tanh(0.81) ≈ 0.6696`.
- Скорость колеса `Fe` на высоту не влияет.
- Кубик (`DICE`) `inst` не трогает; корзина (`CLEAR`) и `reset()` — кит по умолчанию; снимок без `inst` → умолчание.
- Натив: названия на экране — kick, tom, snare, clap, rim, hat, bell, open hat; строка плашки — *instrument*; FX `materia` — `corium` / `metallum`; без русского в интерфейсе; без `shadowBlur`.
- Веб-вид (`view.js`) не трогаем.
- Коммит с правкой `core/` — вместе с пересобранным `t2d.wasm` (`core/build.sh`), иначе хук `guard.py` остановит. Версия (`CACHE` в `sw.js` = `?v=` в `index.html`) — поднимается один раз, в последней задаче перед пушем.
- Тесты гонять через агента `test-runner`; скриншоты — агентом `shots`.

## Review Focus

1. Кольцо выключили, пока хвост звучит — хвост доигрывает без щелчка, затем мир уходит в тишину-короткий путь (нули, без счёта голосов). Тест `horoTailOff` (задача 3).
2. Смена `inst` посреди хвоста — текущий хвост доигрывает своим инструментом, новый звучит со следующего удара; без NaN. Тест `horoInstSwitch` (задача 3).
3. Частота 44.1 кГц (iPhone бывает и на ней) — потолок и спады в секундах, не в сэмплах. `horoCeiling` на 44100 и 48000 (задача 3).
4. Унтертоны (`m = 12/n`, дробные) при ладе с высокой тоникой — высота всё равно на ступени и в диапазоне. `horoModelPitch` с `under` (задача 2).
5. `inst` из действия вне диапазона или не число (9, −1, 2.6, NaN) — зажим и округление, NaN игнорируется. `horoModelInst` (задача 2).

---

### Task 1: Голоса ударных `Drum`

Риск: высокий — C++, realtime-аудио (звуковой поток).

**Files:**
- Create: `core/worlds/horologium/drums.hpp`, `core/worlds/horologium/drums.cpp`
- Modify: `core/build.sh:15,30,42` (добавить `core/worlds/horologium/drums.cpp` во все три списка рядом с `sound.cpp`)
- Test: `core/tests/sdk_test.cpp` (подключить `#include "../worlds/horologium/drums.hpp"`; вызовы — в строку вызовов `:4133` рядом с `horoLfo()`)

**Interfaces:**
- Produces (namespace `horologium`):
  - `enum Inst { KICK, TOM, SNARE, CLAP, RIM, HAT, BELL, OHAT, NINST };`
  - `struct Range { double lo, hi; };` и `Range pitchRange(int inst);` — тональные: kick `{40, 80}`, tom `{80, 250}`, snare (тело) `{150, 300}`, rim `{300, 900}`, bell `{400, 1200}`; clap, hat, open hat — `{0, 0}`. `bool tonal(int inst)` — `pitchRange(inst).hi > 0`.
  - `constexpr double KIT = 0.25;` — нормировка кита (стартовое; задача 3 подбирает).
  - `class Drum { void prepare(double sr); void hit(int inst, double hz, double tint, double mat, double amp); double step(sdk::Rng& rng); bool active() const; int inst() const; };` — моно-сэмпл до `KIT` и панорамы. `hit` перезапускает голос (фазы, огибающие, `Biquad::reset()` и `set()` — только здесь, не в `step`). `active()` — ложь, когда огибающая < 1e-4 (−80 дБ).

- [ ] **Step 1: Написать падающие тесты**

В `sdk_test.cpp` — `drumVoices()`, `drumHatMateria()`:

```cpp
static double drumRun(int inst, double mat, double sr, double secs, double* peak, double* tail, int* activeN) {
  horologium::Drum d; d.prepare(sr); sdk::Rng rng(3);
  d.hit(inst, horologium::tonal(inst) ? horologium::pitchRange(inst).lo * 1.3 : 0, 1, mat, 2.2);   // 2.2 — concursus 1, lvl 1
  const int n = static_cast<int>(secs * sr), t0 = static_cast<int>((secs - 0.1) * sr);
  *peak = *tail = 0; *activeN = 0; double t60 = -1;
  for (int k = 0; k < n; k++) {
    const double x = d.step(rng);
    CHECK(std::isfinite(x));
    *peak = std::fmax(*peak, std::fabs(x));
    if (k >= t0) *tail = std::fmax(*tail, std::fabs(x));
    if (d.active()) (*activeN)++;
    if (std::fabs(x) > 1e-3 * *peak) t60 = k / sr;      // последний сэмпл выше −60 дБ от пика
  }
  return t60;
}
static void drumVoices() {
  for (double sr : {44100.0, 48000.0})
    for (int inst = 0; inst < horologium::NINST; inst++) {
      double peak, tail; int act;
      drumRun(inst, 0.5, sr, 2, &peak, &tail, &act);
      CHECK(peak > 1e-3);                                 // звучит
      CHECK(peak * horologium::KIT <= 0.9);               // пик до tanh
      CHECK(tail < 1e-4 * peak);                          // за 2 с — ниже −80 дБ
      CHECK(act < static_cast<int>(2 * sr));              // голос сам гаснет
    }
}
static void drumHatMateria() {
  double p, t; int a;
  const double soft = drumRun(horologium::HAT, 0, 48000, 2, &p, &t, &a), hard = drumRun(horologium::HAT, 1, 48000, 2, &p, &t, &a);
  CHECK(hard > 1.5 * soft);                               // metallum — хвост hat длиннее
  const double o0 = drumRun(horologium::OHAT, 0, 48000, 2, &p, &t, &a), h0 = drumRun(horologium::HAT, 0, 48000, 2, &p, &t, &a);
  CHECK(o0 > 3 * h0);                                     // open hat — длиннее hat
}
```

- [ ] **Step 2: Убедиться, что не собирается / падает**

Run: `core/build.sh && core/build/sdk-test | tail -3`
Expected: ошибка компиляции — `drums.hpp` не найден.

- [ ] **Step 3: Реализовать `Drum` в `drums.hpp/.cpp`**

Шапка `drums.hpp` — по-русски, как у соседей: что за голоса, что `materia` делает, ловушки. Спад — T60 (`10^(-3/(T60·sr))` на сэмпл); длительности ниже — T60 при `mat = 0.5`. Шкалы `materia` (`mat` 0…1): кожа (kick, tom, snare, clap) — длительность × `(0.7 + 0.6·mat)`; металл (rim, hat, bell, open hat) — × `(0.6 + 1.4·mat)`; FM-индекс — × `(0.5 + mat)`; центр шумового фильтра — × `(0.8 + 0.4·mat) · tint`. Стартовые рецепты (подбор на слух — потом, по словам автора):

| inst | рецепт |
|---|---|
| kick | синус; частота `hz·(1 + 2·p)`, `p` спадает с τ 10 мс (×3 → f за ~30 мс); T60 250 мс |
| tom | синус, FM: модулятор `1.5·hz`, индекс 0.3; частота `hz·(1 + 0.5·p)`, τ 15 мс; T60 180 мс |
| snare | тело — синус `hz`, T60 80 мс, ×0.5; шум → `Biquad::bandpass` 2000 Гц, Q 1, T60 120 мс, ×0.7 |
| clap | шум → `bandpass` 1200 Гц, Q 2; огибающая — три пачки через 10 мс (τ 3 мс каждая), с 30 мс — хвост T60 150 мс |
| rim | FM: несущая `hz`, модулятор `1.71·hz`, индекс 2; T60 25 мс |
| hat | две FM-пары: несущие 540 и 800 Гц × `tint`, модулятор × `(1.41 + 0.33·mat)`, индекс 3; + шум ×0.3; → `Biquad::highpass` 7000 Гц, Q 0 дБ; T60 40 мс |
| bell | два FM-партиала `hz` и `hz·(1.48 + 0.12·(mat − 0.35))`, модулятор каждого ×3.5, индекс 1; → `bandpass` `1.48·hz`, Q 0.7; T60 200 мс |
| open hat | как hat, T60 300 мс |

Частоты фильтров зажимать в `(20, 0.45·sr)`. Усиление голосов — своё у каждого так, чтобы громкость на слух была близкой; итог — `amp ·` огибающая.

- [ ] **Step 4: Тесты проходят**

Run: `core/build.sh && core/build/sdk-test | tail -3`
Expected: `0 failed`

- [ ] **Step 5: Коммит**

```bash
git add core/worlds/horologium/drums.hpp core/worlds/horologium/drums.cpp core/build.sh core/tests/sdk_test.cpp t2d.wasm
git commit -m "core: Horologium drum voices (Drum, 8 instruments)" -m "- FM and noise voices, T60 decays, materia scales
- tests: finite, peak, -80 dB in 2 s, open hat and materia tails"
```

---

### Task 2: Модель — `inst`, высота из лада, окраска шума

Риск: высокий — C++ и контракт снимка сцены (старые сцены).

**Files:**
- Modify: `core/worlds/horologium/model.hpp:14,18,26-31,37`, `core/worlds/horologium/model.cpp:15,17-22,32-42,67-72,79-111`
- Test: `core/tests/sdk_test.cpp` (`#include "../worlds/horologium/model.hpp"`)

**Interfaces:**
- Consumes: `pitchRange(int)`, `tonal(int)`, `NINST` (Task 1).
- Produces:
  - `struct Ring { …; int inst = 0; };`, `enum RingKey { ON, UNDER, PHI, LVL, INST, NRK };`
  - `void Model::setRing(int i, int key, double v)` — `INST`: не число → игнор; иначе `inst = clamp(lround(v), 0, NINST − 1)`.
  - `double Model::pitch(int i) const` — Гц тонального голоса кольца `i` (для нетональных `inst` — 0).
  - `double Model::tint() const` — множитель центров шумовых фильтров.
  - `reset()` и `clear()` ставят `inst = i`; `dice()` `inst` не трогает. Снимок: у кольца `"inst"` (число); `restore` — сначала `inst = i`, затем из JSON, с тем же зажимом.

`pitch(i)`: `f = baseB() · mOf(r)`; `s = 12·log2(f/55)`; при `scale_.on` — `s = scale_.snapSemi(std::round(s))`; `f = 55·2^(s/12)`; затем октавами в `[lo, hi)` диапазона `inst`. `tint()`: при выключенном ладе — 1; иначе `r = root ≤ 6 ? root : root − 12`, `2^(r/12)`.

- [ ] **Step 1: Написать падающие тесты** `horoModelInst()`, `horoModelPitch()`

```cpp
static void horoModelInst() {
  Scale sc; horologium::Model m(sc);
  for (int i = 0; i < 8; i++) CHECK(m.ring(i).inst == i);
  m.setRing(2, horologium::INST, 6); CHECK(m.ring(2).inst == 6);
  m.setRing(2, horologium::INST, 9); CHECK(m.ring(2).inst == 7);
  m.setRing(2, horologium::INST, -1); CHECK(m.ring(2).inst == 0);
  m.setRing(2, horologium::INST, 2.6); CHECK(m.ring(2).inst == 3);
  m.setRing(2, horologium::INST, NAN); CHECK(m.ring(2).inst == 3);
  m.setRing(5, horologium::INST, 1);
  m.dice(); CHECK(m.ring(2).inst == 3 && m.ring(5).inst == 1);          // кубик кит не трогает
  const std::string js = m.snapshot();
  CHECK(js.find("\"inst\":3") != std::string::npos);
  horologium::Model b(sc); b.restore(js);
  for (int i = 0; i < 8; i++) CHECK(b.ring(i).inst == m.ring(i).inst);
  b.restore(R"({"r":[{"on":true,"under":false,"phi":0,"lvl":0.8},{"on":true,"under":false,"phi":0,"lvl":0.8}],"fx":{},"bpm":120,"run":true})");
  CHECK(b.ring(0).inst == 0 && b.ring(1).inst == 1 && b.ring(2).inst == 3);  // старая сцена: кольца из JSON — умолчание, прочие не тронуты
  m.clear(); for (int i = 0; i < 8; i++) CHECK(m.ring(i).inst == i);   // корзина — кит по умолчанию
}
static void horoModelPitch() {
  const int tonalI[5] = {horologium::KICK, horologium::TOM, horologium::SNARE, horologium::RIM, horologium::BELL};
  for (int pass = 0; pass < 3; pass++) {
    Scale sc; if (pass == 2) { sc.on = true; sc.idx = 1; sc.root = 9; }
    horologium::Model m(sc);
    if (pass == 1) m.setFx(horologium::AEQUALIS, 1);
    for (int i = 0; i < 8; i++) for (int under = 0; under < 2; under++) for (int t : tonalI) {
      m.setRing(i, horologium::UNDER, under); m.setRing(i, horologium::INST, t);
      const double f = m.pitch(i); const horologium::Range rg = horologium::pitchRange(t);
      CHECK(f >= rg.lo && f < rg.hi);
      if (pass < 2) { const double o = std::log2(f / (m.baseB() * m.mOf(m.ring(i)))); NEAR(o, std::round(o), 1e-9); }   // гармоника, сдвинутая октавами
      else { const double s = 12 * std::log2(f / 55); NEAR(s, std::round(s), 1e-9); CHECK(sc.inScale(static_cast<int>(std::lround(s)))); }
    }
    for (int i = 0; i < 8; i++) { m.setRing(i, horologium::INST, horologium::HAT); CHECK(m.pitch(i) == 0); }
  }
  Scale sc; horologium::Model m(sc); NEAR(m.tint(), 1, 1e-12);
  sc.on = true; sc.root = 3; NEAR(m.tint(), std::pow(2.0, 3 / 12.0), 1e-12);
  sc.root = 9; NEAR(m.tint(), std::pow(2.0, -3 / 12.0), 1e-12);
}
```

`Scale::inScale(n)` понимает и отрицательные ноты (kick ниже 55 Гц) — класс ноты берётся по модулю 12 (`core/host/scale.cpp:16-20`).

- [ ] **Step 2: Убедиться, что падают**

Run: `core/build.sh && core/build/sdk-test | tail -5`
Expected: ошибка компиляции — нет `INST`, `pitch`, `tint`.

- [ ] **Step 3: Реализовать** по Interfaces выше; `RING_KEYS` в `model.cpp` — пять имён; шапку `model.hpp` дополнить (`inst`, `pitch`, `tint`).

- [ ] **Step 4: Тесты проходят**

Run: `core/build.sh && core/build/sdk-test | tail -3`
Expected: `0 failed`

- [ ] **Step 5: Коммит**

```bash
git add core/worlds/horologium/model.hpp core/worlds/horologium/model.cpp core/tests/sdk_test.cpp t2d.wasm
git commit -m "core: Horologium ring instrument and pitch from the scale" -m "- Ring.inst (0..7, default = ring), RingKey INST, snapshot and restore
- pitch(i): harmonic of the tonic, snapped to the scale, folded into the instrument range
- tint(): noise filter shift from the tonic; dice keeps the kit, clear resets it"
```

---

### Task 3: Звук и мир — голоса вместо резонаторов, потолок, зеркало 55

Риск: высокий — realtime-аудио, C++, контракт зеркала (веб и натив его читают).

**Files:**
- Modify: `core/worlds/horologium/sound.hpp` (весь: `R`, `set`, `O`, новые поля), `core/worlds/horologium/sound.cpp:12-17,19-22,47-135`, `core/worlds/horologium/world.hpp:1-4,13-20`, `core/worlds/horologium/world.cpp:58-60,77-78`
- Test: `core/tests/sdk_test.cpp:3610-3640,3907-3955` (+ `#include "../worlds/horologium/sound.hpp"`), `tools/test-horo-core.mjs:17-25,78-84`

**Interfaces:**
- Consumes: `Drum`, `KIT` (Task 1); `Ring.inst`, `Model::pitch`, `Model::tint` (Task 2).
- Produces:
  - `struct Sound::R { bool on = false, under = false; double phi = 0, lvl = 0.8; int inst = 0; double hz = 110; };`
  - `void Sound::set(const R* rings, double Ft, double mat, double conc, double chance, double aeq, double tint);` (`B` уходит)
  - `static constexpr double Sound::MIN_GAP = 1.0 / 24;` `long Sound::attacks() const;` (запусков голоса всего) `const Drum& Sound::voice(int i) const;`
  - `world.hpp`: `RING_M = 5`, `MIRROR_N = 55`; кольцо в зеркале — `on, under, phi, lvl, inst`.

Устройство `process`: колесо, `Fe`, обнаружение удара, `chance`, `concursus` (`acc`) — как сейчас. На удар: `strikes_++`, номер — в `hit_`; если с прошлого запуска голоса кольца прошло ≥ `ceil(MIN_GAP·sr)` сэмплов (счётчик сэмплов звука) — `o.d.hit(o.inst, o.hz, tint_, mat_, acc·o.lvl)`, `attacks_++`. Голоса звучат у всех восьми колец, пока `active()` (выключенное кольцо доигрывает хвост; удары ищутся только у включённых). Выход — `Σ step·KIT·pan`, затем DC-блок и `tanh(0.9x)`. Тишина-короткий путь: `(na == 0 || still)`, ни одного `active()` голоса и DC ≈ 0. Уходят `y1/y2`, молоточек, шорох, кеш коэффициентов, `og`. `world.cpp` передаёт `Sound::R{q.on, q.under, q.phi, q.lvl, q.inst, model_.pitch(i)}` и `model_.tint()`.

- [ ] **Step 1: Замерить прежний RMS** (до правки звука)

Добавить в `sdk_test.cpp` помощник и временно — печать:

```cpp
// сцена tick: IV, V, VI (кольца 2…4), lvl 0.8, 100 BPM (Ft = 100/240), fx по умолчанию, 8 с, 48 кГц
static double horoTickRms() {
  horologium::Sound s; s.prepare(48000, 910);
  horologium::Sound::R r[8];
  for (int i = 0; i < 8; i++) { r[i].on = i >= 2 && i <= 4; r[i].inst = i; r[i].hz = horologium::tonal(i) ? horologium::pitchRange(i).lo * 1.2 : 0; }
  float L[128], R[128]; double e = 0; long n = 0;
  for (int b = 0; b < 8 * 48000 / 128; b++) {
    s.set(r, 100.0 / 240, 0.35, 0.4, 1, 0, 1);            // после правки; до неё — прежняя сигнатура с B = 55 (r без inst/hz)
    s.process(L, R, 128, b * 128 / 48000.0);
    for (int k = 0; k < 128; k++) { e += L[k] * L[k] + R[k] * R[k]; n += 2; }
  }
  return std::sqrt(e / n);
}
```

Сначала — на текущем `sound.hpp`: без строк `r[i].inst`, с прежней сигнатурой `set(r, Ft, 55, 0.35, 0.4, 1, 0)`; `std::printf("horo tick rms %.6f\n", horoTickRms());` → записать число в константу `HORO_OLD_RMS` у теста. Печать убрать.

- [ ] **Step 2: Написать падающие тесты**

Обновить под 55: `horoLfo` (`== 55`, кольца — `m[15 + 5 * 3 + 2]`, `m[15 + 5 * 7 + 3]`), `horoLfoIgnores` (`n0 == 55`), `horoDice` (`== 55`, шаг кольца `15 + 5 * i`, `under` — `q[15 + 1]`; плюс `CHECK(r[4] == i)` — кубик кит не трогает). Новые:

```cpp
static void horoSoundRun(horologium::Sound& s, horologium::Sound::R* r, double Ft, double secs, double sr, double* peak) {
  float L[128], R[128];
  for (int b = 0, nb = static_cast<int>(secs * sr / 128); b < nb; b++) {
    s.set(r, Ft, 0.35, 1, 1, 0, 1); s.process(L, R, 128, b * 128 / sr);
    for (int k = 0; k < 128; k++) { CHECK(std::isfinite(L[k]) && std::isfinite(R[k])); if (peak) *peak = std::fmax(*peak, std::fmax(std::fabs(L[k]), std::fabs(R[k]))); }
  }
}
static void horoAttacksPerTurn() {                        // V (m = 5), F = 0.5: ниже потолка — голос на каждый удар
  horologium::Sound s; s.prepare(48000, 1);
  horologium::Sound::R r[8]; r[3].on = true; r[3].inst = 1; r[3].hz = 120;
  horoSoundRun(s, r, 0.5, 4, 48000, nullptr);
  CHECK(s.attacks() == s.strikes() && s.attacks() == static_cast<long>(std::floor(5 * s.P())));
}
static void horoCeiling() {                               // IX (m = 9), F = 8: 72 удара/с — голосов ≤ 24/с
  for (double sr : {44100.0, 48000.0}) {
    horologium::Sound s; s.prepare(sr, 1);
    horologium::Sound::R r[8]; r[7].on = true; r[7].inst = 5;
    double pk = 0;
    horoSoundRun(s, r, 8, 0.5, sr, &pk);
    const long a0 = s.attacks(), s0 = s.strikes();
    horoSoundRun(s, r, 8, 1, sr, &pk);
    CHECK(s.attacks() - a0 <= 24 && s.attacks() - a0 >= 16);    // 72 удара/с: голос — каждый 3-й или 4-й (шаг удара — целые сэмплы)
    CHECK(s.strikes() - s0 >= 60);
    CHECK(pk <= std::tanh(0.81));
  }
}
static void horoKitPeak() {                               // восемь колец, lvl 1, concursus 1 — пик до tanh ≤ 0.9
  for (double Ft : {100.0 / 240, 4 * 100.0 / 240, 16 * 100.0 / 240}) {
    horologium::Sound s; s.prepare(48000, 2);
    horologium::Sound::R r[8];
    for (int i = 0; i < 8; i++) { r[i].on = true; r[i].lvl = 1; r[i].inst = i; r[i].hz = horologium::tonal(i) ? horologium::pitchRange(i).lo * 1.2 : 0; }
    double pk = 0; horoSoundRun(s, r, Ft, 6, 48000, &pk);
    CHECK(pk <= std::tanh(0.81));
  }
}
static void horoKitRms() {
  const double rms = horoTickRms();
  CHECK(rms > HORO_OLD_RMS * std::pow(10, -4 / 20.0) && rms < HORO_OLD_RMS * std::pow(10, 4 / 20.0));   // ± 4 дБ к прежнему миру
}
static void horoTailOff() {                               // кольцо выключили — хвост доигрывает, затем тишина-короткий путь
  horologium::Sound s; s.prepare(48000, 1);
  horologium::Sound::R r[8]; r[2].on = true; r[2].inst = 7;
  horoSoundRun(s, r, 0.5, 1, 48000, nullptr);
  r[2].on = false;
  float L[128], R[128]; s.set(r, 0.5, 0.35, 1, 1, 0, 1); s.process(L, R, 128, 1);
  horoSoundRun(s, r, 0.5, 2, 48000, nullptr);
  s.set(r, 0.5, 0.35, 1, 1, 0, 1); s.process(L, R, 128, 3);
  for (int k = 0; k < 128; k++) CHECK(L[k] == 0 && R[k] == 0);
  CHECK(!s.voice(2).active());
}
static void horoInstSwitch() {                            // смена inst посреди хвоста — со следующего удара
  horologium::Sound s; s.prepare(48000, 1);
  horologium::Sound::R r[8]; r[0].on = true; r[0].inst = 0; r[0].hz = 50;   // II: 2 удара за оборот; F = 2 — удары ≈ 0.31 с и ≈ 0.56 с
  horoSoundRun(s, r, 2, 0.4, 48000, nullptr);
  CHECK(s.attacks() == 1 && s.voice(0).inst() == 0);
  r[0].inst = 5;
  horoSoundRun(s, r, 2, 0.05, 48000, nullptr);            // до второго удара — хвост прежнего
  CHECK(s.attacks() == 1 && s.voice(0).inst() == 0);
  horoSoundRun(s, r, 2, 0.3, 48000, nullptr);
  CHECK(s.attacks() == 2 && s.voice(0).inst() == 5);
}
```

`tools/test-horo-core.mjs`: в цикле `ACTS` — убрать сверку сэмплов (`same`, `rms`), оставить колесо `(P, F)` и снимок, сравнивая без `inst` (`const strip = (js) => { const o = JSON.parse(js); o.r.forEach((q) => delete q.inst); return o; }`); имя теста — `sdk: Horologium wheel and snapshot match the reference: ${name}`; шапку файла поправить. `mirror: head layout` — `15 + 8 * 5`, `[2, 3, 4].map((i) => m[15 + i * 5])`, и `assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => m[15 + i * 5 + 4]), [0, 1, 2, 3, 4, 5, 6, 7])`.

- [ ] **Step 3: Убедиться, что падают**

Run: `core/build.sh && core/build/sdk-test | tail -5`
Expected: ошибка компиляции (`attacks`, `voice`, новая `set`) или FAIL на `== 55`.

- [ ] **Step 4: Реализовать** по Interfaces; шапки `sound.hpp/.cpp`, `world.hpp` — переписать под ударные (без «молоточек», «резонатор», «порт worklet один в один»: колесо — по-прежнему как в эталоне, звук — свой). `KIT` в `drums.hpp` подобрать так, чтобы прошли `horoKitPeak` и `horoKitRms`; если оба сразу не сходятся — сначала пик, RMS — ближе к нижней границе, записать в шапку замер.

- [ ] **Step 5: Тесты проходят**

Run: `core/build.sh && core/build/sdk-test | tail -3 && node --test tools/test-horo-core.mjs`
Expected: `0 failed`; node — все `ok`.

- [ ] **Step 6: Коммит**

```bash
git add core/worlds/horologium core/tests/sdk_test.cpp tools/test-horo-core.mjs t2d.wasm
git commit -m "core: Horologium rings play drums instead of resonators" -m "- one Drum per ring, retrigger at most 24/s (MIN_GAP), tails ring out
- pitch and tint from the model each block; wheel speed no longer sets pitch
- mirror 55: inst per ring; KIT normalisation (peak <= 0.9 before tanh)
- reference check: wheel and snapshot only (no sound reference now)"
```

---

### Task 4: Веб-фасад — `inst` в зеркале и снимке

Риск: обычный — JS-фасад под тестами, вид не меняется.

**Files:**
- Modify: `worlds/horologium/model.js:21-22,27,104,121-127,129-137`, `worlds/horologium/index.js:7` (комментарий: «щелчок в резонатор» → «удар — голос ударного»), `tools/test-models.mjs` или `tools/models/horologium.test.mjs` (где сравнивается снимок фасада с эталоном `tools/ref/horologium-model.js`)
- Test: `tools/models/horologium.test.mjs`

**Interfaces:**
- Consumes: зеркало 55 (Task 3), ключ `RING` `[4, v]`.
- Produces: `RING_KEYS = ['on', 'under', 'phi', 'lvl', 'inst']`; кольцо фасада — `{ n, on, under, phi, lvl, inst }`, `inst` по умолчанию `i`; `scene()` пишет `inst`; `restore` без `inst` → `i`; `clear()` ставит `inst = i`; `sync` читает `m[o + 4]`.

- [ ] **Step 1: Падающий тест** — в `horologium.test.mjs`, только для фасада (не в цикле `FACTORIES`):

```js
test('Horologium facade: inst — default kit, mirror 55, snapshot, old scene, clear', () => {
  const m = FACTORIES.facade();                    // имя фабрики фасада — как в файле
  assert.deepEqual(m.state.rings.map((r) => r.inst), [0, 1, 2, 3, 4, 5, 6, 7]);
  const js = JSON.parse(m.snapshot()); assert.equal(js.r[3].inst, 3);
  m.state.rings[3].inst = 6;
  m.restore(JSON.stringify({ ...js, r: js.r.map(({ inst, ...q }) => q) }));
  assert.equal(m.state.rings[3].inst, 3, 'старая сцена без inst — умолчание');
  const mir = new Array(55).fill(0); mir[15 + 5 * 2 + 4] = 7;   // кольцо IV — open hat
  m.sync(mir, 1e9); assert.equal(m.state.rings[2].inst, 7);
  m.clear(); assert.equal(m.state.rings[2].inst, 2);
});
```

Сравнения снимка фасада с эталоном (`tools/ref/horologium-model.js`) — убирать `inst` перед `deepEqual`. Если `sync` не наружу — проверить зеркало через тот путь, которым его кормят соседние тесты файла.

- [ ] **Step 2:** Run: `node --test tools/test-models.mjs tools/models/*.test.mjs` — Expected: FAIL в новом тесте.
- [ ] **Step 3:** Реализовать по Interfaces.
- [ ] **Step 4:** Run: `node --test tools/test-models.mjs tools/models/*.test.mjs && node --test tools/test-horo-core.mjs && node --check worlds/horologium/model.js` — Expected: всё `ok`.
- [ ] **Step 5: Проверить, что веб живой:** агент `shots` — `python3 -m http.server 8765` в корне, `~/.cache/t2d-pw/bin/python tools/shot.py horologium-run horologium-sheet`; вердикт: кольца на месте, плашка кольца прежняя (4 строки), ошибок в консоли нет.
- [ ] **Step 6: Коммит**

```bash
git add worlds/horologium/model.js worlds/horologium/index.js tools/models/horologium.test.mjs
git commit -m "web: Horologium facade reads inst (mirror 55)" -m "- RING_KEYS with inst; scene, restore (old scene -> default kit), clear
- view unchanged: the web plays the default kit"
```

---

### Task 5: Натив — зеркало, строка *instrument*, подпись, без `limen`, `corium`

Риск: обычный — UI под XCTest; правка роутера плашки хоста — маленькая и с тестом.

**Files:**
- Modify: `ios/app/T2D/Horologium/HoroMath.swift:4-6` (`HoroRing.inst: Int = 0`; `Horo.instNames`), `HoroMirror.swift:3-6,22-23`, `HoroSheets.swift:6,22,31-62`, `HorologiumView.swift:87-90` (рядом — `ringHeld()`), `HoroDraw.swift:105-107,213-220`, `ios/app/T2D/Host/Sheet.swift:9-19`, `ios/app/T2D/Host/Host.swift:464-469`, `ios/app/T2D/Draw.swift:10,89` (тестовый журнал строк)
- Test: `ios/app/T2DTests/HorologiumTests.swift:23-28,45-60,322-336,348-356`, `ios/app/T2DTests/HoroMathTests.swift:71-75`, `ios/app/T2DTests/HostTests.swift`

**Interfaces:**
- Consumes: зеркало 55, `RING` `[4, inst]`.
- Produces:
  - `Horo.instNames = ["kick", "tom", "snare", "clap", "rim", "hat", "bell", "open hat"]`
  - `HoroMirror.ringN = 5`, `size = 55`; `inst = min(7, max(0, Int(b[s + 4])))`.
  - `SheetSpec.tap: ((String) -> Void)? = nil` — тап по строке (палец не сдвинулся дальше `Touch.tapMove` и короче `Touch.tapMs`, как в `Host.swift:241`). `Host.sheetUp`: при `h == .row(k)`, своём `rowF` и тапе — `spec.tap?(k)` (до `releaseSheet`).
  - `Draw.said: [String]? = nil` — если не `nil`, `drawString` дописывает строку (только для тестов).
  - `HorologiumView.ringHeld() -> Int?` — кольцо любого удержания `kind == .ring`.
  - `ringSpec(i)`: ключи `on, under, phi, lvl, inst`; метки `sounds, undertone, phase, level, instrument`; коды `[-1, -1, 5 + 2i, 6 + 2i, -1]`; `get("inst") = Double(inst) / 7`; `set("inst", v)` → `Act.ring, i, [4, (v * 7).rounded()]`; `text("inst") = Horo.instNames[inst]`; `tap = { "inst" → [4, (inst + 1) % 8] }`, прочие ключи — ничего.
  - Подпись: в `drawRings` для `i == ringHeld()` — `d.mapText(Horo.instNames[r.inst], lx, ly + 13, 10.5, 0.85, align: .center)` (курсив по умолчанию), с подложкой как у метки кольца.
  - `HoroDraw.frame`: метка и пунктир `limen` и расчёт `mSum/mCnt/mAvg` — убрать.
  - `fxSpec` `materia`: `"\(v < 0.5 ? "corium" : "metallum") \(pct(v))"`.

- [ ] **Step 1: Падающие тесты**

`HorologiumTests`: `setMirror` — пятым числом кольца `inst` (параметр `inst: [Int] = Array(0..<8)`); `testMirrorParse` / `testMirrorLoadInPlace` — буфер с `inst` (кольцо `i` → `7 − i`), `n: 55`, `XCTAssertEqual(m.rings[2].inst, 5)`, `XCTAssertNil(HoroMirror(b, n: 54))`; `HoroMathTests:71-75` — 55. `testRingSheet` — пять ключей и меток, коды `[-1, -1, 9, 10, -1]`, `text("inst") == "snare"`. Новые:

```swift
func testRingSheetInstrument() {
  setMirror(on: [2], inst: [0, 1, 7, 3, 4, 5, 6, 7])
  let s = view.ringSpec(2)
  XCTAssertEqual(s.text("inst"), "open hat"); XCTAssertEqual(s.get("inst"), 1)
  s.tap?("inst"); XCTAssertEqual(rec.acts.last?.a, [4, 0], "тап — следующий по кругу")
  s.set("inst", 0.3); XCTAssertEqual(rec.acts.last?.a, [4, 2])
  s.tap?("phi"); XCTAssertEqual(rec.acts.count, 2, "тап по другой строке — ничего")
}
func testInstCaptionOnlyWhileHeld() {                    // кольцо V (i = 3) — inst 3, clap
  setMirror(on: [3])
  XCTAssertFalse(said(now: 1).contains("clap"))
  view.down(finger(f1, onRing(3, 0.3), t0: 1, now: 1))
  XCTAssertTrue(said(now: 1.1).contains("clap"))
  view.up(finger(f1, onRing(3, 0.3), t0: 1, now: 1.15))
  XCTAssertFalse(said(now: 1.2).contains("clap"))
}
func testNoLimen() { setMirror(run: true, F: 2, on: [0, 1]); XCTAssertFalse(said(now: 1).contains("limen")) }
```

(`said(now:)` — вариант `render`, который ставит `d.said = []` и возвращает журнал.) `testFanSheet` — `"corium 35%"`. `HostTests`: `testSheetRowTapCallsTap` (открыть плашку со `spec.tap`, тап по строке → замыкание получило ключ) и `testSheetRowDragNoTap` (ведение на 40 pt → `tap` не вызван, `set` вызван) — по образцу соседних тестов плашки в файле.

- [ ] **Step 2:** Run: `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16 Pro'` — Expected: ошибки компиляции / FAIL новых тестов.
- [ ] **Step 3:** Реализовать по Interfaces.
- [ ] **Step 4:** Run: та же команда — Expected: `** TEST SUCCEEDED **`, число тестов ≥ 881 + новые.
- [ ] **Step 5: Снимки** — агент `shots`: `ios/app/shot.sh horologium` и `ios/app/shot.sh horologium-ring-sheet`; вердикт: на поле нет `limen`, плашка кольца — пять строк, последняя `instrument` со значением-названием, ничего не наезжает на нижний край; веер — `corium`.
- [ ] **Step 6: Коммит**

```bash
git add ios/app/T2D ios/app/T2DTests
git commit -m "ios: Horologium instrument row, caption while held, no limen" -m "- mirror 55 (inst per ring)
- ring sheet: instrument row, tap = next, drag = scroll (SheetSpec.tap in the host router)
- instrument name next to the ring only while it is held
- limen mark removed; materia reads corium / metallum"
```

---

### Task 6: Звук на слух, доки, выкладка

Риск: обычный — документация, версия, проверка.

**Files:**
- Modify: `docs/worlds/horologium.md`, `docs/sdk-inventory.md:219,273` (строка IX: `Resonator` уходит; `Biquad`, `Rng`, `Scale`), `core/README.md`, `docs/testing.md:8,15` (строка сверки Horologium: колесо и снимок, без звука; тесты `sdk_test` — новые имена), `README.md` (раздел Horologium: звук ударный; *instrument* — только в приложении), `CLAUDE.md` (строка IX: статус — «ударные»), `docs/tokens.md`, `sw.js` (`CACHE`), `index.html` (`?v=`)

- [ ] **Step 1: Рендер кита** — скрипт в scratchpad: `core/build/mix-cli` со stdin `seed 1`, `secs 8`, восемь `act 0 9 0 <i> 0 1` (RING on), `act 0 9 2 0 1 0` (RUN), выход float32 × 4 канала → WAV (микс L, R) в scratchpad, печать RMS, пика, `NaN`. Expected: NaN нет, пик < 1, RMS > 0.01. Путь WAV — автору в итоге.
- [ ] **Step 2: Полный прогон** — агент `test-runner`: `core/build.sh && core/build/sdk-test`, `node --test tools/test-models.mjs tools/models/*.test.mjs`, сверки из `docs/testing.md:8`, `xcodebuild test …`. Expected: всё зелёное; упавшее — в отчёт с выводом.
- [ ] **Step 3: Доки** — по списку Files, по-русски, в духе текста; в `horologium.md` план «→ ударные» — в «сделано», зеркало 55, `inst`, потолок 24/с, `corium / metallum`, натив-только для *instrument*; «на iPhone не проверено».
- [ ] **Step 4: Версия** — `CACHE` в `sw.js` и `?v=` в `index.html` → следующее число.
- [ ] **Step 5: Финальное ревью** — `/code-review` всей ветки (по правилам автора); находки проверить по коду, подтверждённые — исправить отдельным коммитом.
- [ ] **Step 6: Коммит, пуш, деплой**

```bash
python3 tools/tokens.py --line                    # строка в docs/tokens.md
git add docs README.md CLAUDE.md sw.js index.html
git commit -m "docs: Horologium drums" -m "- world doc, sdk inventory, testing, README, CLAUDE.md
- version bump"
git push
python3 tools/deploy-wait.py
```

Expected: `success v…`. Автору: что поменялось, путь WAV, что проверить на iPhone (кит, *instrument*, подпись, нагрузка в панели замеров).

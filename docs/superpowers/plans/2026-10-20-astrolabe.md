# Секвенсер-астролябия — план реализации (подпроект 3 из 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вокруг пластины Cymatica — два кольца астролябии: внешнее — ритм (16 шагов), внутреннее — мелодия (7), разной длины (полиметрия); узор записывается игрой, правится на кольцах и метками на пластине, часы — точно в звуковом потоке.

**Architecture:** Часы и узор живут в `plate-worklet.js`: на каждом тике (шестнадцатая) worklet сам бьёт удар нужной нотой и шлёт `step`. Основной поток (`cymatica.js`) держит модель узора, пишет её игрой, рисует астролябию и шлёт узор в worklet целиком при каждом изменении. Чистые помощники секвенсера основного потока (`euclid`, `nearestStep`, `walkMelody`) открыты тестам через `t2d.cym.core`.

**Tech Stack:** ванильный JS, AudioWorklet, canvas 2D; тесты — `node --test tools/test-plate.mjs tools/test-seq.mjs` (через `vm`, без зависимостей), `tools/shot.py`, `tools/render.py`.

**Spec:** `docs/superpowers/specs/2026-10-20-cymatica-design.md`, часть 3 «Секвенсер-астролябия».

## Global Constraints

- Шаг часов — шестнадцатая: `stepSamples = round(fs · 60 / bpm / 4)`; темп 40–200, по умолчанию 96.
- Ритм — по умолчанию 16 шагов, мелодия — 7; длины 1–16; на каждом тике обе стрелки сдвигаются на шаг; удар — если шаг ритма не пустой, нотой текущего шага мелодии (`null` — текущий размер пластины).
- Узор: `seq = { bpm, playing, rec, rhythm: { len, steps: [{ x, y, vel } | null ×16] }, melody: { len, steps: [semi | null ×16] } }`, `semi` — полутоны от 55 Гц.
- Сообщения: в worklet `{ t: 'seq', bpm, playing, rhythm, melody }` при каждом изменении; из worklet на каждом тике `{ t: 'step', r, m, time }` (`time` — секунды звуковых часов).
- Запись: тап по пластине при `rec` — в ближайший по времени шаг ритма (с местом удара); щипок при `rec` — нота в текущий шаг мелодии (с ладом — по нотам).
- Кубик: ритм — Евклид (k ударов на n шагов), места ударов случайные, мелодия — случайное блуждание по ладу (без лада — по пентатонике), случайные длины колец. Корзина — узор и закреплённые смычки, часы идут. Отмена — узор, смычки, параметры пластины, размер, темп, длины.
- Эхо — восьмая с точкой по темпу: `0.75 · 60 / bpm` с.
- Картинка — ч/б гравюра, `INK`, шрифт `MAP`, без `shadowBlur`; подписи (BPM, нота) — только во время правки.
- Версия 48 → 49 (`CACHE`, все `?v=`); комментарии — по-русски; коммиты — по-английски, тело-список, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `node --check` для всех `.js`.

## Review Focus

1. Тап при записи чуть раньше доли — удар уже прозвучал вживую, тот же шаг не должен тут же ударить второй раз (флэм). Тест — Task 1 (`no double hit after a live strike`).
2. Смена темпа или длины кольца на ходу — без сбоя: следующий тик через новый `stepSamples`, индекс шага не выходит за новую длину. Тест — Task 1.
3. Пустой узор при включённых часах — тишина, стрелки идут, ошибок нет. Тест — Task 1.
4. Корзина при игре — часы продолжают идти (`playing` остаётся), узор пуст. Тест — Task 3.
5. Уход в Sol Niger при игре — узор продолжает звучать, `t2d.sounding()` истинно. Тест — Task 3.

---

### Task 1: Часы и узор в `plate-worklet.js`

**Files:** Modify `plate-worklet.js`, `tools/test-plate.mjs`

**Interfaces:**
- Produces: `stepSamples(bpm, fs) → int`; в процессоре — `this.seq = { bpm: 96, playing: false, rhythm, melody }`, счётчики `this.r`, `this.m`, `this.toNext` (отсчётов до следующего тика); сообщение `seq` (заменяет узор целиком; при переходе `playing` false → true счётчики в начало, первый тик — сразу); `step { r, m, time }`; удар секвенсера — та же механика, что `strike`, с `hz = 55 · 2^(semi/12)` или `this.f0`; живой удар запоминает время (`this.lastLive`), и тик ритма пропускается, если живой удар был меньше половины шага назад.

- [ ] **Step 1: Тесты (падают)** в `tools/test-plate.mjs`:
  - `stepSamples`: `stepSamples(120, 48000) === 6000`, `stepSamples(96, 48000) === 7500`.
  - `steps on time`: `seq {bpm: 120, playing: true, rhythm: {len: 16, steps: [ {x: 0.3, y: 0, vel: 1}, null ×15 ]}, melody: {len: 7, steps: null ×16}}`; 1 с звука → сообщения `step` пришли с `time` ровно `0, 0.125, 0.25 …` (разность соседних — `0.125` ±1/48000), 8 штук.
  - `polymeter`: `rhythm.len = 16`, `melody.len = 7`; пар `(r, m)` за 112 тиков — 112 разных, 113-я совпадает с первой.
  - `melody note`: `melody.steps[0] = 12` → после первого тика голос с `hz ≈ 110` (±0.5); `null` → голос на `f0`.
  - `empty pattern`: все шаги `null`, `playing: true`, 0.5 с → выход нули, `step` приходят.
  - `tempo change mid-run`: после 3 тиков на 120 прислать `bpm: 60` → следующий интервал `0.25` с; `rhythm.len` с 16 на 4 при `r = 10` → следующий `r` в `[0, 4)`.
  - `no double hit after a live strike`: часы на 120, шаги 0 и 1 не пустые; прогнать до 0.03 с перед тиком шага 1 (живой удар длится < 3 мс и к тику уже закончен); прислать живой `strike`, прогнать до 2 мс после тика → `proc.strikes.length === 0`; тот же прогон без живого удара → `proc.strikes.length === 1`.
- [ ] **Step 2:** `node --test tools/test-plate.mjs` → новые FAIL.
- [ ] **Step 3: Код.** Счёт тиков по отсчётам внутри блока (тик может прийти в середине блока); `seq` хранит готовые `strikeGains` для каждого шага ритма (без выделений в звуковом цикле); при `playing: false` счётчики стоят.
- [ ] **Step 4:** `node --test tools/test-plate.mjs` → всё PASS.
- [ ] **Step 5: Commit** «Plate worklet: sample-accurate sequencer clock, polymeter».

---

### Task 2: Модель узора, запись игрой, кубик, отмена — `cymatica.js`

**Files:** Modify `cymatica.js`; Create `tools/test-seq.mjs`

**Interfaces:**
- Consumes: `seq`/`step` (Task 1), `T2D.snapSemi`, `T2D.scaleOn`.
- Produces (в `cymatica.js`, открыто как `t2d.cym.core`):
  - `euclid(k, n) → boolean[n]` — Бьорклунд, первый шаг — удар.
  - `nearestStep(nowMs, stepAtMs, idx, stepMs, len) → int` — шаг ритма, ближайший ко времени касания: `idx`, если с последнего тика прошло меньше половины шага, иначе `(idx + 1) % len`.
  - `walkMelody(len, startSemi, scaleSemis) → int[len]` — шаги ±1–2 ступени по `scaleSemis` (возрастающий список допустимых полутонов), в пределах 0–48.
  - Модель `seq` (как в Global Constraints) в `plate`; `sendSeq()`; последний `step` → `lastStep = { r, m, atMs }`.
  - `t2d.cym`: `get seq` (копия), `play()`, `rec()`, `get lastStep`.
- [ ] **Step 1: Тесты (падают)** — `tools/test-seq.mjs`: грузит `cymatica.js` в `vm` с заглушками (`window = { t2d: {}, T2D: { registerWorld() {}, snapSemi: (s) => s } }`, `document = { currentScript: null }`, `location = { href: 'http://x/' }`), берёт `window.t2d.cym.core`:
  - `euclid(3, 8)` → `[1,0,0,1,0,0,1,0]` (в булевых); `euclid(5, 8)` содержит 5 ударов, первый — удар; `euclid(0, 4)` — все пустые; `euclid(4, 4)` — все удары.
  - `nearestStep(1000 + 0.4 * 125, 1000, 3, 125, 16) === 3`; `nearestStep(1000 + 0.6 * 125, 1000, 3, 125, 16) === 4`; `nearestStep(1000 + 0.6 * 125, 1000, 15, 125, 16) === 0`.
  - `walkMelody(7, 12, [0,2,4,7,9,12,14,16,19,21,24])` — длина 7, все значения из списка, соседние отличаются не больше чем на 2 позиции в списке.
- [ ] **Step 2:** `node --test tools/test-seq.mjs` → FAIL (нет `core`).
- [ ] **Step 3: Код.**
  - Запись: тап по пластине при `seq.rec && seq.playing` → `rhythm.steps[nearestStep(…)] = { x, y, vel: 1 }`, `sendSeq()`; щипок при `rec` → `melody.steps[lastStep.m] = round(semi)` (после `snapSemi`).
  - Кубик: `n = 8–16`, `k = 3–n−2`, `euclid(k, n)`, места — случайные точки внутри пластины (`r ≤ 0.85`), мелодия `walkMelody(3–9, полутон текущего f0, ступени лада 0–48 или пентатоника [0,3,5,7,10]+12·oct)`, длины колец — `n` и длина мелодии; часы — `playing: true`.
  - Корзина: узор и смычки пустые (`len` прежние), `playing` не трогать. Отмена: `snapshot`/`restore` с `seq` (`bpm`, `rhythm`, `melody`; без `playing`/`rec`).
  - Эхо: `delayTime` обеих линий — `0.75 · 60 / bpm` при каждой смене темпа.
  - `sounding()` — ещё и `seq.playing` с непустым ритмом.
- [ ] **Step 4:** `node --test tools/test-seq.mjs tools/test-plate.mjs` → PASS; `python3 tools/shot.py plate orphan` → без `FAILED`.
- [ ] **Step 5: Commit** «Cymatica: pattern model, record by playing, euclidean dice, undo».

---

### Task 3: Астролябия — кольца, правка, пуск/запись/темп; проверка и выкладка

**Files:** Modify `cymatica.js`, `tools/shot.py`, `tools/render.py`, `index.html`, `sw.js`, `README.md`, `CLAUDE.md`, `ROADMAP.md`

**Interfaces:**
- Consumes: всё из Task 2.
- Produces: геометрия `astro(g) → { R1, R2, ty }` — радиус кольца мелодии `R1 = g.rMax + 12`, ритма `R2 = g.rMax + 30`, кнопки ▶ и ● — `(g.cx ∓ 30, g.cy + g.rMax + 64)`, радиус 17. Шаг `i` кольца — угол `−90° + i · 22.5°` (16 гнёзд всегда; активны первые `len`, остальные тусклые); выступ длины — на гнезде `len`.
- [ ] **Step 1: Тесты (падают).**
  - Сценарий `seq` в `tools/shot.py` (через `t2d.go(2)`): тап по ▶ → `t2d.cym.seq.playing`; тап по ● → `rec`; три тапа по пластине с паузой 300 мс → в `seq.rhythm.steps` ≥ 2 непустых; тап по засечке ритма (гнездо 8: `(cx + R2·cos(−90°+180°), cy + R2·sin(…))`) переключает его; перетаскивание выступа ритма с гнезда 16 на гнездо 8 → `rhythm.len === 8`; зажал ▶ и повёл вправо на 60 px → `bpm` вырос; кубик → `rhythm` непустой, `playing`; корзина при игре → ритм пуст, `playing` остаётся (Review Focus 4); с играющим узором уйти на карту и в Sol Niger → `t2d.sounding()` (Review Focus 5); отмена корзины → ритм вернулся. Скриншот `.shots/astrolabe.png`.
  - `tools/render.py --world 2 --onsets`: узор из 4 ударов подряд на 120 BPM; печатать интервалы между ударами (по пикам огибающей) и их разброс; ожидание — средний 0.125 с, разброс < 2 мс.
- [ ] **Step 2:** `python3 tools/shot.py seq` → FAILED.
- [ ] **Step 3: Код.**
  - Рисование: два кольца — двойная гравированная линия, засечки гнёзд; у ритма непустое гнездо — точка, у мелодии — засечка внутрь длиной `3 + (semi % 24)·0.5` px (пустое — короткая); стрелки — тонкие лучи от центра к текущему гнезду каждого кольца (`lastStep` + интерполяция по времени); метки записанных ударов на пластине — маленькие точки, вспыхивают на своём шаге; ▶/■ и ● — кружки как кнопки строки, ● заливается при записи; подпись BPM — пока тянешь ▶, 1 с после.
  - Касания (раньше пластины и смычков): ▶ — тап пуск/стоп, удержание + ведёшь влево-вправо — темп (1 px = 0.5 BPM, 40–200); ● — тап запись (на остановленных часах — пуск + запись); выступ длины кольца — перетаскивание по кругу (`len = 1–16`); засечка ритма — тап включить/выключить (новый удар — в место последнего удара или `(0.3, 0)`); засечка мелодии — тап очистить, перетаскивание к центру/от центра — нота (6 px = ступень лада или полутон); метка удара на пластине — перетаскивание (место), за край — удалить.
  - Документация: README — как играть с астролябией; CLAUDE.md — часы в worklet, `seq`/`step`, `t2d.cym.core`, `test-seq.mjs`, `--onsets`; ROADMAP — Cymatica сделана (LFO смычков, цвет, гравюры Хладни — дальше).
  - Версия 49 в `sw.js`/`index.html`.
- [ ] **Step 4:** `node --test tools/test-plate.mjs tools/test-seq.mjs && python3 tools/shot.py && python3 tools/render.py --world 2 --onsets` → всё зелёное, разброс < 2 мс; `.shots/astrolabe.png` глазами.
- [ ] **Step 5: Commit, push, проверить выкладку** (`success`).

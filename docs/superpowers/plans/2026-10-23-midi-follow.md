# Ведомый по MIDI-часам — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** одна внешняя машина (Analog Four по MIDI через оболочку) ведёт все миры-секвенсеры: общий Start / Stop, общий темп, шаги на одних долях.

**Architecture:** `host/midi.js` принимает `window.t2dMidi` от оболочки и держит одну сетку долей во времени `ctx` (`{t0, p}`); раздаёт темп и транспорт через `w.tempo`. Миры сохраняют свои часы и, пока сетка включена, берут время шага k из `stepTime(grid, k, perBeat)`; Cymatica и Horologium получают сетку сообщением в worklet.

**Tech Stack:** ES-модули без сборки, Web Audio, AudioWorklet; тесты — `node --test` (подделки `AudioContext`, worklet через `vm`), сценарии — `tools/shot.py` (Playwright).

**Spec:** `docs/superpowers/specs/2026-10-23-midi-follow-design.md`

## Global Constraints

- Ветка `native`; `?v=` в `index.html` и `CACHE` в `sw.js` не трогаем (в `main` не идёт).
- Протокол оболочки не меняется: `{t:'start'|'stop', ago}`, `{t:'beat', n, bpm, ago}`, `{t:'tempo', bpm}`; время события = `ctx.currentTime − ago`.
- Значения из спеки: прыжок сетки — |e| > **0.05** с принять сразу, иначе e/2; порог темпа — **0.3** BPM, темп округляется до 0.1; часы пропали — **1** с без долей; первый шаг после Start, опоздавший < **0.03** с, играет сразу (в `now + 0.005`).
- Импорты `host/` — без `?v=`; миры берут всё через `window.T2D`; изменяемое состояние модуля меняет только сам модуль.
- Worklet-ы ничего не импортируют; их чистые функции тестируются через `vm` (как `tools/test-plate.mjs`).
- Модели (`model.js`) — без Web Audio и `window`; сетка — только в engine.
- Код и комментарии — в стиле соседнего кода (русские комментарии в строку, плотно); коммиты — по-английски, с телом-списком и строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `node --check` для изменённых `.js` перед коммитом.

## Review Focus

1. **Мир уже играет, когда пришёл Start** — должен перезапуститься с шага 0 на доле 0, а не продолжить со своего шага (тест — задача 1, `start restarts a playing world`).
2. **Темп крутят руками, пока идут часы** — через ≤ 1 долю темп снова темп часов, а сетка шаги не теряет (тест — задача 1, `tempo knob is overridden at the next beat`).
3. **Сетка прыгнула назад (> 50 мс)** — шаг, уже поставленный, не должен прозвучать второй раз (тест — задача 2, `a backward grid jump does not repeat a step`).
4. **Часы пропали посреди игры** — миры играют дальше в последнем темпе, без тишины и пачки нот (тест — задача 2, `grid off: the world keeps its tempo`).
5. **Без MIDI вообще** (Safari, нет оболочки) — всё как раньше: `T.midiGrid()` → `null`, старые сценарии зелёные (задача 6).

---

### Task 1: `host/midi.js` — сетка и раздача

**Files:**
- Create: `host/midi.js`, `tools/test-midi.mjs`
- Modify: `app.js` (импорт; `window.T2D`: `midiGrid`, `stepTime`, `due`; вызов `midi.tick` из `onTick`), `host/concordia.js` (подпись `midi` у строки *shared tempo*), `worlds/portus/index.js` (убрать `window.t2dMidi = …`; лог пробы — через `onMidi`)

**Interfaces:**
- Produces (экспорт `host/midi.js`):
  - `JUMP = 0.05, TEMPO_EPS = 0.3, LOST = 1, LATE_FIRST = 0.03`
  - `nextBeat(grid, n, at, bpm) → grid` — чистая; `grid = {t0, p, last}` (`last` — время последней доли); `null` на входе → `{t0: at − n·p, p: 60/bpm, last: at}`
  - `stepTime(grid, k, perBeat) → number` — `t0 + (k / perBeat)·p`
  - `due(t, now, first) → number | null` — `t > now + 0.003` → `t`; `first && now − t < LATE_FIRST` → `now + 0.005`; иначе `null`
  - `createMidi({ worlds, now }) → { message(m), tick(), grid(), listen(fn) }` — `worlds()` → массив миров с `tempo`; `now()` → `ctx.currentTime` или `null`; `grid()` → сетка или `null`; `listen(fn)` — каждое входящее сообщение (для лога пробы)
  - `midiOn() → boolean` — сетка включена (для concordia; `createMidi` запоминает свой экземпляр в модуле)
- Миры (задачи 2–5) получают: `T.midiGrid()`, `T.stepTime`, `T.due`; от `w.tempo` служба зовёт `get()`, `set(bpm)`, `play(on)`, `playing()`, `armed?.()`.

- [ ] **Step 1: Тесты в `tools/test-midi.mjs`** (подделки миров: `{ tempo: { set, play, playing, armed } }` со счётчиками; `now` — переменная теста)
  - `smooths a beat 20 ms late back within 3 beats` — доли по 0.5 с, одна на +0.02: `t0` смещается ≤ 0.01 и через 3 доли |ошибка| < 0.003
  - `takes a jump over 50 ms at once` — доля на +0.08: `stepTime(g, 4n, 4)` = время этой доли ± 1e-9
  - `start waits for the first beat` — после `start` `grid()` → `null`, ни один `play` не позван; после `beat n=0` — `t0` = время доли, `play(true)` у `armed`
  - `start runs armed, playing and stopped-by-midi worlds only` — миры: armed; не armed, но играет; не armed, стоял; не armed, остановлен прошлым MIDI Stop → `play(true)` у 1, 2, 4, не у 3
  - `start restarts a playing world` — у играющего порядок вызовов `play(false)`, `play(true)`
  - `stop stops every sequencer` — `play(false)` у всех, кто `playing()`; `grid()` → `null`
  - `tempo goes to every world over 0.3 BPM` — `beat bpm 120.2` при 120 — `set` не зван; `120.4` — `set(120.4)` у всех
  - `tempo knob is overridden at the next beat` — мир сам поставил 100 (`playing`, его `get` = 100), доля с 120 → `set(120)`
  - `beats return without start` — после потери доля n=9 (транспорт не останавливали) → `t0 = at − 9·p`, `play` не звался
  - `clock lost after 1 s` — `tick()` при `now = last + 1.01` → `grid()` → `null`, `play` не звался
  - `due plays the first late step now, skips others` — `due(0.98, 1, true)` = 1.005; `due(0.98, 1, false)` = `null`; `due(0.96, 1, true)` = `null`
- [ ] **Step 2:** `node --test tools/test-midi.mjs` — FAIL (нет модуля)
- [ ] **Step 3:** реализовать `host/midi.js` по интерфейсу. Сглаживание `p`: среднее по интервалам долей (последние 4), не по `bpm` из сообщения; `bpm` — только для темпа миров. Темп мира сверять с `w.tempo.get()`. `start`: `cue = true`, запомнить `stopped` (кого остановил прошлый Stop) до первой доли.
- [ ] **Step 4:** подключить: `app.js` — `const midi = createMidi({ worlds: () => Object.values(worlds).filter((w) => w.tempo), now: () => (ctx ? ctx.currentTime : null) })`, `window.t2dMidi = midi.message`, `onTick(midi.tick)`, в `window.T2D`: `midiGrid: () => midi.grid()`, `stepTime`, `due`, `onMidi: midi.listen`; `concordia.js` — у строки `clock` подпись `midi clock` вместо `sub`, пока `midiOn()`; `worlds/portus/index.js` — лог входящих через `T.onMidi((m) => …)`.
- [ ] **Step 5:** `node --test tools/test-midi.mjs` — PASS; `node --check app.js host/*.js worlds/portus/index.js`
- [ ] **Step 6: Commit** — `Host MIDI clock: one beat grid, tempo and transport for every sequencer`

### Task 2: Portus и Natura по сетке

**Files:**
- Modify: `worlds/portus/engine.js` (удалить `sync`, `cue`, `midiPlay`, `trace` и их вызовы; планировщик — по сетке), `worlds/portus/index.js` (`tempo.armed`; `engine.trace` из лога убрать), `worlds/natura/engine.js` (планировщик — по сетке), `worlds/natura/index.js` (`tempo.armed`)
- Test: `tools/test-portus-sync.mjs` → переименовать в `tools/test-follow.mjs` (общий риг движков на подделке `AudioContext`; тесты `sync` удалить — их работа в задаче 1; тесты `pulse` оставить)

**Interfaces:**
- Consumes: `T.midiGrid()`, `T.stepTime(grid, k, perBeat)`, `T.due(t, now, first)` (задача 1)
- Produces: `tempo.armed()` — Portus `isles.length > 0`, Natura `pads.at.some(Boolean)`; риг `rig(world, T)` в `tools/test-follow.mjs` для задачи 3

- [ ] **Step 1: Тесты в `tools/test-follow.mjs`** (у `T` в риге — `midiGrid` возвращает сетку теста или `null`, `stepTime`/`due` — импорт из `host/midi.js`)
  - `portus: with a grid, step k lands on stepTime ±1 ms` — сетка `{t0: 1, p: 0.5}`, `play(true)`, прогнать до 3 с; `lastSteps` (через `engine.step` в моменты) / записанные времена `stab` — на `1 + k·0.125`
  - `natura: with a grid, step k lands on stepTime ±1 ms` — то же для Natura (время `playNote` — через подделку осциллятора: записывать `start(t)`)
  - `the first step 20 ms late plays now` — сетка `t0 = now − 0.02`, `play(true)`: шаг 0 звучит в `now + 0.005`
  - `a backward grid jump does not repeat a step` — после 1 с сдвинуть `t0` на −0.08: номера сыгранных шагов строго растут, без повторов
  - `grid off: the world keeps its tempo` — сетка `null` посреди игры: следующие шаги через `stepSec`, без пачки и без паузы > `stepSec`
  - `pulse` — существующие 4 теста ведущего — PASS без изменений смысла
- [ ] **Step 2:** `node --test tools/test-follow.mjs` — FAIL
- [ ] **Step 3:** в обоих планировщиках: в начале каждой итерации `const grid = T.midiGrid(); if (grid) clock.next = T.stepTime(grid, clock.step, 4);` проверку «опоздал» заменить на `T.due(clock.next + sw, now, clock.step === 0)` (Portus — со swing, Natura — без); шаг, уже ушедший (`clock.step` < последнего поставленного), не ставить повторно — хранить `played` (номер последнего поставленного шага).
- [ ] **Step 4:** `node --test tools/test-follow.mjs` — PASS; `node --test tools/test-models.mjs tools/models/*.test.mjs` — PASS
- [ ] **Step 5: Commit** — `Portus and Natura take step times from the MIDI grid`

### Task 3: Monochordum (автострам) по сетке

**Files:**
- Modify: `worlds/monochord/model.js` (экспорт `perBeat()` = `DIVS[auto.div][0]`, `swingAt(step)` — сдвиг нечётного шага `auto.swing·0.5·stepSec()`, чётного — 0), `worlds/monochord/engine.js` (`autoSchedule` — по сетке), `worlds/monochord/index.js` (`tempo.armed: () => false`)
- Test: `tools/test-follow.mjs`, `tools/models/monochord.test.mjs`

**Interfaces:**
- Consumes: риг из задачи 2; `T.midiGrid/stepTime/due`
- Produces: `model.perBeat()`, `model.swingAt(step)`

- [ ] **Step 1: Тесты**
  - `tools/models/monochord.test.mjs`: `swingAt matches stepDur` — для swing 0.4, div 1/8: `swingAt(1) = stepDur(0) − stepSec`, `swingAt(0) = 0`
  - `tools/test-follow.mjs`: `monochord 1/8T with swing on the grid` — div 1/8T (3 на долю), swing 0.3, сетка `{t0: 1, p: 0.5}`: время `pluck at` шага k = `1 + (k/3)·0.5 + swingAt(k)` ± 1 мс
- [ ] **Step 2:** оба — FAIL
- [ ] **Step 3:** `autoSchedule`: `if (grid) clock.next = T.stepTime(grid, clock.step, model.perBeat()) + model.swingAt(clock.step)`; `due(…, clock.step === 0)`; без сетки — как сейчас (`stepDur`).
- [ ] **Step 4:** PASS обоих + `node --test tools/models/*.test.mjs`
- [ ] **Step 5: Commit** — `Monochordum autostrum follows the MIDI grid (divisions, swing)`

### Task 4: Cymatica — сетка в worklet

**Files:**
- Modify: `plate-worklet.js` (функция `nextTickFrame`, сообщение `lock`, тик по сетке), `worlds/cymatica/engine.js` (на `T.onTick` слать сетку при смене), `worlds/cymatica/index.js` (`tempo.armed: () => seq.rhythm.steps.slice(0, seq.rhythm.len).some(Boolean)`)
- Test: `tools/test-plate.mjs`

**Interfaces:**
- Consumes: `T.midiGrid()` (задача 1)
- Produces: worklet-сообщение `{t:'lock', t0, p}` / `{t:'lock', off: true}`; `nextTickFrame(t, t0, p, fs) → int` — сколько отсчётов от момента `t` до следующей шестнадцатой сетки (`t0 + j·p/4`, строго после `t`, ≥ 1)

- [ ] **Step 1: Тесты в `tools/test-plate.mjs`**
  - `nextTickFrame lands on the grid` — `t0 = 1, p = 0.5, fs = 48000`: при `t = 1.1` → `round(0.025·fs)`; при `t = 1.125` → `round(0.125·fs)`
  - `locked ticks follow the grid` — процессор, `seq` playing с bpm 120, `lock {t0: currentTime + 0.01, p: 0.5}`: времена `step` (поле `time`) после первого — на сетке ± 1 отсчёт
  - `polyrhythm 5 × 7 repeats every 35 steps under the lock` — ритм len 5, мелодия len 7, lock включён, второй lock со сдвигом `t0` на +0.08 посреди: пары `(r, m)` шагов 0…69 — первые 35 и вторые 35 совпадают, счёт не обнулялся
- [ ] **Step 2:** `node --test tools/test-plate.mjs` — FAIL
- [ ] **Step 3:** worklet: `msg` — `lock` хранит `{t0, p}` или `null`; в `process` — время отсчёта `currentTime + (n − blockStart)/fs`; после `tick()` при lock — `toNext = nextTickFrame(tNow, …) − 1`, без lock — как сейчас; пуск (`playing` false → true) — как сейчас (первый тик сразу, `r = m = −1`). Engine: подписка `T.onTick` — сетка изменилась (другой объект или `null`) → `send({t:'lock', …})`.
- [ ] **Step 4:** PASS + `node --test tools/models/cymatica.test.mjs`
- [ ] **Step 5: Commit** — `Cymatica: the plate worklet ticks on the MIDI grid; polyrhythm kept`

### Task 5: Horologium — фаза колеса к такту

**Files:**
- Modify: `horo-worklet.js` (функция `lockRate`, сообщение `lock`), `worlds/horologium/engine.js` (на `T.onTick` слать сетку, пока `clock.run && clock.u === 0 && !pend.held`, иначе `off`), `worlds/horologium/index.js` (`tempo.armed: () => rings.some((r) => r.on)`)
- Test: `tools/test-horo.mjs` (новый, `vm` как `tools/test-plate.mjs`)

**Interfaces:**
- Consumes: `T.midiGrid()`
- Produces: `{t:'lock', t0, bar}` / `{t:'lock', off: true}` в `horo`; `lockRate(P, t, lock) → number` — множитель скорости колеса в [0.97, 1.03]: `1 + clamp(wrap(((t − t0)/bar) − P), −0.03, 0.03)`, `wrap` → [−0.5, 0.5)

- [ ] **Step 1: Тесты в `tools/test-horo.mjs`**
  - `lockRate pulls the wheel phase to the bar` — `P` отстаёт на 0.02 оборота → множитель > 1; опережает → < 1; на фазе → 1
  - `a new lock snaps the phase once` — первое `lock` с новым `t0` (отличие > 1 мс от прежнего): дробная часть `P` = фаза такта ± 1e-3; следующее `lock` с тем же `t0` — без скачка
  - `ring ratios hold under the lock` — кольца 2, 3, 5, 7 и унтертон 12/4, `F` = 0.5 об/с, lock `bar = 2`, 8 с: ударов у кольца n — `n · 4 ± 1`, у 12/4 — `3 · 4 ± 1`; сдвиги `phi` целы
- [ ] **Step 2:** FAIL
- [ ] **Step 3:** в цикле отсчётов: `dP = F/sr · (lock ? lockRate(P, tNow, lock) : 1)`; приём `lock` с новым `t0` — `P = floor(P) + фаза` (ближайший оборот). Engine — подписка `T.onTick`, условие из Files.
- [ ] **Step 4:** PASS + `node --test tools/models/horologium.test.mjs`
- [ ] **Step 5: Commit** — `Horologium: the wheel locks to the bar while tempus is at zero`

### Task 6: Сценарий, документы, превью

**Files:**
- Modify: `tools/shot.py` (`sc_midi`, в `SCENARIOS`), `docs/native-plan.md`, `docs/worlds/portus.md`, `natura.md`, `monochordum.md`, `cymatica.md`, `horologium.md` (по строке: «ведомый по MIDI: …»), `CLAUDE.md` (в список `host/` — `midi.js`)

- [ ] **Step 1: `sc_midi`** — тап (звук), `t2d.worlds[n].dice()` для 13, 4, 2, `t2d.worlds[9].clear()`, все остановить; в странице `t2dMidi({t:'start', ago:0})` и доли каждые 500 мс (`n++`, bpm 120, ago 0) через `setInterval`; через 3 с: Portus, Natura, Cymatica `playing`, Horologium — нет; номера шагов Portus (`t2d.portus.stepNow`) и Natura (`phase()` engine; если в `t2d.nat` его нет — добавить геттер) в один момент совпадают по модулю 4; `t2dMidi({t:'stop'})` — все стоят; скриншот `midi`
- [ ] **Step 2:** `python3 tools/shot.py midi portus natura monochord seq plate horologium` — все зелёные (Review Focus 5); `node --test tools/test-models.mjs tools/models/*.test.mjs tools/test-*.mjs` — PASS
- [ ] **Step 3:** документы (по строке в каждый файл мира: как идёт за часами; `native-plan.md` — статус «ведомый для всех миров — собран»)
- [ ] **Step 4: Commit, push** `native`; статус превью `success` (curl к GitHub API, как раньше)
- [ ] **Step 5:** автору на iPhone с Analog Four: Start — идут все миры с узором, в такт; Stop — встают; tempus Horologium на нуле — колесо на такте; то же при заблокированном экране

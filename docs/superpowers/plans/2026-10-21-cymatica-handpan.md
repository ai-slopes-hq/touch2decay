# Cymatica: нота от места удара — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** нота удара Cymatica задаётся клеткой пластины (сектор = ступень лада, 3 кольца = октавы), кольцо мелодии показывает и правит ноты самих ударов, клавиш лада больше нет.

**Architecture:** вся логика — в `cymatica.js`; worklet не меняется (мелодия той же длины, что ритм, считается из мест в `sendSeq`). Чистые функции раскладки — в `t2d.cym.core`, тесты в Node; жесты и рисунок — сценарии `tools/shot.py`.

**Tech Stack:** ванильный JS (Web Audio, canvas 2D), Node `--test` + `vm`, Python Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-cymatica-handpan-design.md`

## Global Constraints

- Текст на экране — только по-английски/латынью; один шрифт (`T.mapText` курсив / `T.text`).
- Не шумно: сетка клеток `ink 0.07`; подписи нот — только во время касания/жеста.
- Производительность: без `shadowBlur`, без новых полноэкранных проходов в кадре; подписи клеток (≤36 текстов) — только пока видны.
- Диапазон нот — 0…60 полутонов от 55 Гц (55–1760 Гц); за пределом — тишина.
- Выкладка: поднять `CACHE` в `sw.js` и все `?v=` в `index.html` одним числом; `node --check` всех .js; README по-русски; коммиты по-английски с телом-списком и `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Проверка: `node --test tools/test-plate.mjs tools/test-seq.mjs`; `$V tools/shot.py` (все сценарии, код выхода 0); честно — headless, не iPhone.

## Review Focus

1. Лад включили/сменили при готовом узоре (5 → 7 секторов) — ноты пересчитались из мест, ничего не падает (тест: Task 1 `noteAt n=7`; Task 2 shot `handpan` переключает лад).
2. Пластина у верха (880 Гц) — внутренние кольца за 1760 Гц: клетки молчат, удар такого шага уходит в worklet пустым, бусина — тусклая точка (Task 1 `null beyond`, Task 2 `sendSeq` проверка).
3. Тап в самый центр (`r = 0`) — кольцо 2, сектор 0; тап за краем пластины — не звучит (Task 1).
4. Отмена после правки бусиной / поворота пластины возвращает места ударов (Task 2 shot).
5. Длину укоротили — удары за длиной остаются, но молчат и гаснут на обоих кольцах (Task 2 shot).

---

### Task 1: раскладка — чистые функции

**Files:** Modify `cymatica.js` (секция секвенсера, рядом с `scaleSemis`); Test `tools/test-seq.mjs`.

**Interfaces — Produces** (все в `t2d.cym.core`):
- `noteList(): number[]` — ступени лада (лад включён — `T.snapSemi(s) === s`, иначе пентатоника `[0,3,5,7,10]` по `s % 12`) в 0…60.
- `degPerOct(): number` — `T.scaleOn ? T.scalePCs.length : 5`.
- `cellIdx(x, y, b, n): number | null` — `null`, если `r > 1`; кольцо `ring = r > √(2/3) ? 0 : r > √(1/3) ? 1 : 2`; угол от верха по часовой `atan2(x, −y)` → `sector = floor(a / 2π · n) mod n`; индекс `b + ring·n + sector`.
- `noteAt(x, y, b, n, list): number | null` — `list[cellIdx]` или `null` (за пределом списка или пластины).
- `cellOf(idx, b, n): {ring, sector} | null` — `null`, если `idx − b` вне `[0, 3n)`.
- `cellCenter(ring, sector, n): {x, y}` — радиус `[0.9, 0.7, 0.33][ring]`, угол — середина сектора (от верха по часовой).
- `transposeHits(steps, k, b, n, list): steps` — каждый удар: его индекс + `k`, упор в `[b, min(b+3n, list.length) − 1]`, место — `cellCenter` новой клетки (`vel` сохраняется, `null` остаётся `null`).
- Удаляется `keyNotes` (и его тест).

- [ ] **Step 1: тесты** в `tools/test-seq.mjs` (`list5 = [0,3,5,7,10,12,…,60]` из пентатоники, `b = 2`, `n = 5`):
  - `cellIdx(0, -0.95, 2, 5) === 2` (верх, край — кольцо 0, сектор 0); `cellIdx(0.95, 0, 2, 5) === 3` (справа = 90° → сектор 1); `cellIdx(0, 0, 2, 5) === 12` (центр — кольцо 2); `cellIdx(0, 1.2, 2, 5) === null`.
  - `noteAt(0, -0.95, 2, 5, list5) === list5[2]`; при `b = list5.length − 3` центр — `null`.
  - туда-обратно: для всех `idx` в `[b, b+15)` — `const c = cellOf(idx,b,n), p = cellCenter(c.ring, c.sector, n); cellIdx(p.x, p.y, b, n) === idx`; то же при `n = 7`.
  - `cellOf(b − 1, b, n) === null`, `cellOf(b + 15, b, n) === null`.
  - `transposeHits([{x:0,y:-0.95,vel:1}, null], 2, 2, 5, list5)`: первый — в клетке индекса 4, второй `null`; `k = 99` — упор в `b+14`.
  - удалить тест `keyNotes` и `keyNotes never below 55 Hz`.
- [ ] **Step 2:** `node --test tools/test-seq.mjs` — Expected: FAIL (`C.cellIdx is not a function`).
- [ ] **Step 3:** реализовать функции, добавить в `core`, удалить `keyNotes`.
- [ ] **Step 4:** `node --test tools/test-plate.mjs tools/test-seq.mjs` — Expected: PASS.
- [ ] **Step 5:** commit `Cymatica: handpan layout helpers (cell of a point, cell centre, transpose hits)`.

### Task 2: модель — одна последовательность, ноты из мест

**Files:** Modify `cymatica.js` (`seq`, `sendSeq`, `onMsg`, `astroHit/Move/Up`, `twistTo`, `down/move/up`, `dice`, `clear`, `snapshot/restore`, `t2d.cym`); Test `tools/shot.py`.

**Interfaces — Consumes:** Task 1. **Produces:**
- `seq` без `melody`: `{ bpm, playing, rec, rhythm: { len, steps } }`; одна длина `seq.rhythm.len`.
- `base(): number` — `nearestIdx(noteList(), fs())`; `noteOf(st): number | null` — `noteAt(st.x, st.y, base(), degPerOct(), noteList())`.
- `sendSeq`: в worklet `rhythm.steps[i]` = удар или `null`, если `noteOf` = `null`; `melody = { len: rhythm.len, steps: notes }`.
- живой тап: `strike` с `hz: F_MIN·2^(note/12)`; `note = null` — без звука (запись тоже не пишет).
- `t2d.cym.seq` — `{ bpm, playing, rec, rhythm, melody: { len, steps: noteOf каждого (абсолютные) } }` (для тестов); `t2d.cym.load({ rhythm, bpm, fx })` (melody игнорируется); `t2d.cym.lastStrike` — последний живой `strike`.
- Правка бусины (`mtick` с движением): `steps = round((d − r0)/6)`, индекс удара + steps с упором в `[b, b+3n−1]`, удар → `cellCenter`; без удара в гнезде — ничего.
- `len` на любом кольце меняет `seq.rhythm.len`; поворот любого кольца — `rotateSteps(rhythm)`, `ringTurn`/`ringOrn` у обоих колец одинаковы.
- Поворот пластины: `seq.rhythm.steps = k ? transposeHits(orig.r, k, …) : orig.r.slice()`.
- `dice`: Евклид как сейчас; ноты — `walkMelody(len, list[b], list.slice(b, b + 2n))`; место — `cellCenter` + сдвиг: угол ±0.3 ширины сектора, радиус ±0.05.
- `snapshot`/`restore` — без `melody`.

- [ ] **Step 1: тесты** — новый сценарий `sc_handpan` в `tools/shot.py` (и в `SCENARIOS`), без лада (`t2d.scl.on = false`), пластина по умолчанию:
  - тапы в `cellCenter(0,0)` и `cellCenter(2,0)` (экранные координаты: `geo.cx + x·geo.r`) → `lastStrike.hz` отличаются ровно на 2 октавы (×4 ± 0.5 %).
  - лад включить (`t2d.scl.on = true`) — тап в центр звучит, `noteOf` в списке лада (`seq.melody.steps` ⊂ `core.noteList()`), ошибок страницы нет.
  - `load` узора из 2 ударов в клетках `idx b` и `b+1`; тянуть бусину гнезда 0 от центра на +13 px → `seq.melody.steps[0]` = ноте `b+2`, удар 0 стоит в `cellCenter` её клетки.
  - тащить метку удара 1 на пластине в клетку кольца 2 → `seq.melody.steps[1]` сменилась, выше на ≥ 1 октаву.
  - отмена → ноты как до тасканий (Review Focus 4).
  - длина: тянуть край заливки кольца мелодии до 4 → `seq.rhythm.len == 4` и `seq.melody.len == 4`.
  - щипок разведением на 60 px → все ноты сдвинулись на одно и то же число ступеней вниз.
  - `t2d.cym.load({rhythm:{len:2, steps:[h_center, h_edge]}})` при `f0 = 880` (через колесо до упора вверх) → в последнем отправленном `seq` (экспонировать `t2d.cym.sentSeq`) удар центра — `null` (Review Focus 2).
  - Переписать: `sc_twist` (кольца крутятся вместе: поворот ритма сдвигает и ноты; поворот пластины = `core.transposeHits`; туда-обратно — места прежние; щипок — ноты сдвигаются, места нет), `sc_relative` (щипок двигает ноты; кольцо ритма крутится с запасом; «мимо колец — мелодия» сдвигает тот же узор), `sc_seq` (одна длина: `drag_len(R2…)` → обе длины 8, затем `R1` → обе 4), `sc_grid` (без изменений по смыслу — запуск).
- [ ] **Step 2:** `$V tools/shot.py handpan twist relative seq grid` — Expected: FAIL (handpan: `hz` не различаются).
- [ ] **Step 3:** реализовать по Interfaces; `absM/relM`, `transposeMelody` и хранение мелодии удалить (`transposeMelody` — и из `core` и тестов).
- [ ] **Step 4:** `node --test …` и `$V tools/shot.py handpan twist relative seq grid plate echo scalepinch` — Expected: PASS.
- [ ] **Step 5:** commit `Cymatica: notes come from where the plate is struck`.

### Task 3: ввод — без клавиш, курсор по тапу

**Files:** Modify `cymatica.js` (`keys`, `keyAt`, `pressKey`, `drawKeys`, `keyFlash` — удалить; `plateGeo`: `224 → 168`, `216 → 160`; `cursor = null`; `down/up`; рисунок курсора и `step k / len`); Test `tools/shot.py` (`sc_keys` → `sc_entry`).

**Interfaces — Produces:** `t2d.cym.cursor: number | null`; без `t2d.cym.keys`.

- [ ] **Step 1: тест** `sc_entry` вместо `sc_keys`: в портрете и альбоме `ty + 18 < vh`; часы стоят, `cursor is None`; тап по пластине — звучит, `seq.rhythm.steps` не меняются; тап по гнезду 3 кольца мелодии → `cursor == 3`; тап по пластине → в гнезде 3 удар (`melody.steps[3]` — нота клетки), `cursor == 4`; тап мимо пластины и колец → `cursor is None`; ▶ при курсоре → `cursor is None`; запись: ▶ ●, тап по пластине → удар в ритме, `lastStrike.rec is True`. Скриншот `entry`.
- [ ] **Step 2:** `$V tools/shot.py entry` — Expected: FAIL (`cursor` = 0).
- [ ] **Step 3:** реализовать; курсор рисуется (кольцо у гнезда R1 и `step k / len`) только при `cursor != null && !seq.playing`.
- [ ] **Step 4:** `$V tools/shot.py entry seq` — Expected: PASS.
- [ ] **Step 5:** commit `Cymatica: no scale keys; step entry by tapping the plate at the cursor`.

### Task 4: рисунок клеток

**Files:** Modify `cymatica.js` (`drawPlate`, `drawAstro` — бусины из `noteOf`, `onMsg`/`down` — вспышка клетки, `draw`); Test `tools/shot.py` (`sc_handpan` — скриншоты).

**Interfaces — Produces:** `cellFlash: Map<idx, ms>`; `showNotes(now): boolean` — палец на пластине (`f.live`/`f.mk`/бусина `mtick`), `two`, или `now < labelUntil`; `t2d.cym.showNotes`.

- [ ] **Step 1: тест** в `sc_handpan`: без касаний `showNotes` = false; пока держишь палец на пластине — true (скриншот `handpan-held`: подписи в клетках видны); после щипка 1 с — true, через 1.5 с — false; скриншот `handpan` (покой: только тонкая сетка).
- [ ] **Step 2:** `$V tools/shot.py handpan` — Expected: FAIL (`showNotes` undefined).
- [ ] **Step 3:** в `drawPlate`: `n` лучей от центра до `g.r` и окружности `g.r·√(1/3)`, `g.r·√(2/3)` — `ink 0.07`, одним `beginPath`; при `showNotes` — `noteName` в `cellCenter` каждой клетки (10 px, 0.5; `null` — без подписи); вспышка — дуги клетки `ink 0.8·(1 − t/200)`. Бусина: нота удара (`null` или нет удара — тусклая точка).
- [ ] **Step 4:** весь набор: `node --test …` и `$V tools/shot.py` — Expected: PASS; скриншоты `handpan`, `handpan-held`, `entry`, `astrolabe` — посмотреть глазами.
- [ ] **Step 5:** README (раздел Cymatica: клетки, кольца, бусины, курсор, без клавиш), CLAUDE.md (секвенсер Cymatica), `v` +1; commit `Cymatica: handpan cells on the plate, notes shown while playing`; push; дождаться `success`.

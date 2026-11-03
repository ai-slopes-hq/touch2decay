# Tenebrae · шаг А — модель в `worlds/tenebrae/model.js` · план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** модель мира I (голоса, связи, LFO, хаос, кубик, удары солнца, undo) переезжает из `app.js` в чистый модуль `worlds/tenebrae/model.js`; веб звучит и выглядит так же.

**Architecture:** `createModel({ rng, engine, wake })` держит `state` (голоса без картинных полей, `fx`, `kept`, время) и методы — будущие действия ядра (шаг Б). Клей `worlds/tenebrae/engine.js` модель зовёт через геттер `engine()`. `app.js` остаётся view: жесты, рисование, картинные поля в массиве `W[i]`; модель меняет только через методы. Проверка «веб не изменился» — трасса действий слота 1 до и после.

**Tech Stack:** ES-модули без сборки, `node --test`, Playwright (`tools/shot.py`).

**Spec:** `docs/superpowers/specs/2026-11-03-tenebrae-model-extract-design.md` — читать вместе с планом.

## Global Constraints

- Ветка `native`. Ядро `core/`, клей `worlds/tenebrae/engine.js`, `t2d.wasm` — не меняются.
- Поведение веба не меняется: звук, жесты, картинка. README не трогать.
- Модель — без DOM, Web Audio, `performance.now`, `Math.random` (только `rng`). Импортировать можно только `./engine.js` (константы), `../../host/util.js`, `../../host/sl.js`.
- `snapshot()` синхронный и возвращает **ту же строку JSON**, что сейчас (`app.js:741-753`) — от этого зависит `host/undo.js`.
- Импорты `host/` — без `?v=`. Новый файл `worlds/tenebrae/model.js` — сразу в `MODULES` `sw.js:12` (иначе хук `guard.py` не даст коммит).
- Числа модели (`TAIL 1.6`, `UNPIN_TAIL 0.8`, `LINK_NEW 0.5`, `PIN_MAX 3`, `TEMP_MAX 3`, `VOICES 6`, `BEAT_MIN 0.05`, `BEAT_MAX 24`, `BEAT_DEF 0.35`, `CUT_DEF 0.68`, `RES_DEF 0.21`, `WAVE_DEF 0.125`, `SHIFT_DEF 0.5`, LFO по умолчанию `{morph:0, rate:1.2, depth:0.35}`) — как в `app.js:34-63`, `:811`.
- Коммиты — по-английски, с телом-списком.

## Отклонения от спеки (решено при планировании)

1. `grab(i)` — только счётчик `held`; `attack` голоса view зовёт сам (`model.attack(i)`): иначе при `spawn` пальцем `engine.on` уходил бы дважды.
2. `letGo(i, fade = true)`: двойной тап зовёт `letGo(i, false)`, затем `pin(i)` — иначе отпускание затирало бы `UNPIN_TAIL` хвостом `TAIL` или гасило только что закреплённый голос.
3. Глубина солнца — отдельный `sun(i, t)`, который view зовёт каждый кадр для всех шести голосов (0 — нет пальца на солнце), а не параметр `move`: палец может стоять на солнце неподвижно, а условия `parked/menu/bridge` меняются без движения.
4. Связи: `link(dst, src)` (есть — `auto = false`, глубина та же; нет — `LINK_NEW`, `'tzfm'`) + `linkDepth` + `linkType` + `unlink` вместо `link(dst, src, depth, type)` — так их зовут мост, нить и кольцо связи.
5. `fx(o)` принимает частичный объект (`{decay: 3}`) — `fx.load` шлёт все пять разом одним `engine.fx`, как сейчас.
6. Добавлены `attack(i)`, `release(i, tau)`, `retune()` (все `dirty`, для `setRetune` / `undo`), `sounding()`.
7. `lastTap` после `spawn` view сбрасывает, если `lastTap.v` — этот голос (сейчас — только при вытеснении; разница — только в пределах `DTAP_MS` после смерти голоса).
8. `mods[].src` остаётся ссылкой на голос модели (view рисует по ней); номер — `src.i`.

## Review Focus

1. **`kept` расходится с `editor`.** Плашку закрывают не только `closeEditor`, но и `deleteVoice`, `restore`, `clearAll`, авто-закрытие в `solTick` — если `model.keep` не позвали, голоса плашки не гаснут и не вытесняются. Ожидание: `kept` пуст ⇔ нет плашки голоса. Тест — Task 6, шаг 5 (проверка в `sc_plate`).
2. **Палец на голосе после `remove` / `restore` / `clear`.** Модель обнулила `held`, а палец ещё держит голос — следующий `letGo` уводит `held` в минус. Ожидание: `letGo` при `held = 0` ничего не делает. Тест — Task 1 `letGo at zero`.
3. **Двойной тап по затухающему незакреплённому голосу** должен оставить его закреплённым и звучащим (`envT 1`). Тест — Task 1 `double tap on fading voice`.
4. **`restore`, пока палец держит временный голос**, которого нет в снимке: голос остаётся, `held` не трогается. Тест — Task 3 `restore keeps held temp`.
5. **Первый кадр `dt = 0` и длинный `dt` (вкладка в фоне):** без `NaN`, хаос — не больше одного раза за тик. Тест — Task 2 `tick dt 0 and long`.

---

## Файлы

- Create `worlds/tenebrae/model.js` — модель (Task 1–3).
- Create `tools/models/tenebrae.test.mjs` — тесты модели.
- Modify `tools/shot.py` — трасса (`T2D_TRACE`), Task 4; проверка `kept`, Task 6.
- Create `tools/trace-diff.py` — сравнение трасс.
- Modify `app.js` — картинные поля → `W` (Task 5), модель → `model.js` (Task 6).
- Modify `sw.js`, `index.html`, `tools/render.py` (докстрока), доки (Task 7).

---

### Task 1: модель — голоса, пальцы, плашка, закрепление

**Files:**
- Create: `worlds/tenebrae/model.js`
- Create: `tools/models/tenebrae.test.mjs`
- Modify: `sw.js:12` (добавить `'./worlds/tenebrae/model.js'`)

**Interfaces:**
- Produces (экспорт): `VOICES, PIN_MAX, TEMP_MAX, TAIL, UNPIN_TAIL, LINK_NEW, BEAT_MIN, BEAT_MAX, BEAT_DEF, CUT_DEF, RES_DEF, WAVE_DEF, SHIFT_DEF, LFO_DEF, LINK_TYPES` (реэкспорт из `./engine.js`), `createModel({ rng = Math.random, engine = () => null, wake = () => {} } = {})`.
- Модель: `state = { voices, fx: {rev:0.3, decay:3.5, dly:0.3, chaos:0, dirt:0.2}, kept: number[], time: 0, strikes: 0 }`.
- Голос: `{ i, x:0.35, y:0.22, beat, wave, fm:0, cut, res, shift, amp:1, holeT:0, mods:[], lfo:{}, pinned:false, active:false, live:false, env:0, envT:0, envTau:0.05, held:0, snap:true, dirty:true, sunT:0, strikeNext:0 }`.
- Методы этой задачи: `attack(i)`, `release(i, tau)`, `spawn(p, c, holeT) → i | -1`, `grab(i)`, `letGo(i, fade = true)`, `keep(ids)`, `unkeep()`, `move(i, p, c, holeT)`, `set(i, key, v)`, `pin(i) → 'pinned' | 'unpinned' | 'full'`, `remove(i)`, `retune()`, `load() → number`, `sounding() → bool`, `events() → [{t:'burst', i} | {t:'strike', i, p}]` (отдаёт и очищает). `remove` зовёт внутренний `unlinkAll(v)` — его пишем здесь же (`app.js:332-340`).

| Метод | Как сейчас |
|---|---|
| `attack` | `app.js:298-305`; `wake()` вместо глобального |
| `release` | `:307-310` |
| `spawn` | `:275-296` без пикселей: `x = p, y = c, holeT`; `snap = env < 0.02`; кандидат вытеснения — активный, не закреплён, `held 0`, не в `kept`, `envT === 0`, минимум `env`; `held = 0`, `unlinkAll`, снять все LFO, поля к умолчаниям, `attack` |
| `letGo` | `held = max(0, held − 1)`; при `fade`, `held 0`, не закреплён, не в `kept` → `release(TAIL)` |
| `unkeep` | `:439-443`: у бывших `kept` — активный, не закреплён, `held 0` → `release(TAIL)`; `kept = []` |
| `move` | `:262-270` без пикселей, `dirty` |
| `pin` | `:559-566`, всегда событие `burst`; `'full'` — закреплённых активных ≥ `PIN_MAX`, гаснет `TAIL`, если `held 0` и не в `kept` |
| `remove` | `:427-436` модельная часть: `pinned false`, `held 0`, `unlinkAll`, `release(0.25)`, `burst`; из `kept` убрать |
| `load` | `:739` |

- [ ] **Step 1: Написать тесты**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, PIN_MAX, TAIL, UNPIN_TAIL } from '../../worlds/tenebrae/model.js';
import { seeded } from './util.mjs';

const GLUE = ['voice', 'on', 'off', 'live', 'links', 'lfo', 'fx', 'strike', 'clear', 'busEnv'];
function rig(seed = 1) {
  const calls = [];
  const glue = Object.fromEntries(GLUE.map((n) => [n, (...a) => calls.push([n, ...a])]));
  const m = createModel({ rng: seeded(seed), engine: () => glue });
  return { m, V: m.state.voices, calls, names: () => calls.map((c) => c[0]) };
}
const pinned = (m, n) => { const out = []; for (let k = 0; k < n; k++) { const i = m.spawn(0.1 * k, 0.5, 0); m.pin(i); out.push(i); } return out; };
```

Тесты (имя → утверждения):
- `spawn takes a free voice`: `spawn(0.4, 0.3, 0.2)` → `0`; `V[0]` `active, envT 1, x 0.4, y 0.3, holeT 0.2`; в `calls` есть `['live', 0, true]`, `['on', 0]`.
- `spawn temps limit and eviction`: 3 временных, `letGo` их не держали; `release(1, TAIL)`, `V[1].env = 0.1`, `release(2, TAIL)`, `V[2].env = 0.05` → `spawn` → `2` (самый тихий затухающий). Если все 3 временных звучат (`envT 1`) → `-1`.
- `spawn never evicts pinned, held or kept`: 3 временных с `envT 0`: один `grab`, один в `keep([..])`, третий — тот, что вытесняется; закреплённых 3 + временные заняты → `-1`.
- `pin cycle`: `pin` → `'pinned'`; второй `pin` → `'unpinned'`, `envT 0`, последний `off` с `UNPIN_TAIL`; каждый `pin` даёт `{t:'burst', i}` в `events()`, второй вызов `events()` пуст.
- `pin full`: `pinned(m, PIN_MAX)`, четвёртый голос `pin` → `'full'`, `pinned false`, `off` с `TAIL`.
- `letGo fades free voice only`: временный `grab, letGo` → `off` с `TAIL`; закреплённый — нет `off`; в `keep([i])` — нет `off`; `grab, grab, letGo` — нет `off`.
- `letGo at zero`: `letGo(i)` при `held 0` → `held 0`, ни одного нового вызова клея.
- `double tap on fading voice`: `spawn`, `grab`, `letGo` (гаснет), `attack`, `grab`, `letGo(i, false)`, `pin` → `'pinned'`, `envT 1`, `held 0`.
- `unkeep fades only free`: `keep([a, b])`, `b` закреплён, `unkeep()` → `off` только у `a`, `kept` пуст.
- `remove`: `pinned false`, `held 0`, `envT 0`, `off` с `0.25`, событие `burst`, `i` нет в `kept`.
- `load`: два активных, у одного 2 LFO (`V[i].lfo` заполнить напрямую в тесте) → `(2 + 0.15·2) / 6`.

- [ ] **Step 2:** `node --test tools/models/tenebrae.test.mjs` — FAIL (модуля нет).
- [ ] **Step 3:** написать `worlds/tenebrae/model.js` по таблице; `sw.js:12` — добавить файл в `MODULES`.
- [ ] **Step 4:** `node --test tools/models/tenebrae.test.mjs` — PASS; `node --test tools/test-models.mjs tools/models/*.test.mjs` — PASS.
- [ ] **Step 5:** commit `tenebrae: model module - voices, fingers, plate, pin`.

---

### Task 2: модель — связи, LFO, хаос, тик, удары солнца

**Files:** Modify `worlds/tenebrae/model.js`, `tools/models/tenebrae.test.mjs`.

**Interfaces:**
- Consumes: Task 1.
- Produces: `link(dst, src) → mod`, `linkDepth(dst, src, d)`, `linkType(dst, src, type)`, `unlink(dst, src)`, `lfo(i, key, spec | null)`, `sun(i, t)`, `tick(dt)`; `state.strikes` растёт на каждый удар.

| Что | Как сейчас |
|---|---|
| `link` | `:318-323` + `:921-926`: есть связь от `src` → `auto = false`, `dirty`; нет → `{src, type:'tzfm', depth:LINK_NEW, auto:false}`. Возвращает объект связи |
| `linkDepth / linkType` | правка найденной связи на месте + `dst.dirty` (`:405`, `:1103-1105`); нет связи — ничего |
| `unlink` | `:325-330` |
| `lfo` | новый ключ — как `setLfo` `:362-367` без `spec.ph`; есть — `Object.assign` в имеющийся spec (клей не зовётся, только `dirty`; так правит `lfoStrip` `:864-874`); `null` — `removeLfo` `:369-373` + `dirty` |
| хаос | `:343-359`; время — `state.time` в секундах: `if (time > chaosAt) { chaosAt = time + 0.4; chaos() }`, `chaosAt` с 0; `until = time + 3 + rng()·7`; порядок `rng`: порог, кандидат, тип, `k`, `until` |
| удары | `:1724-1737` без геометрии: голос с `held > 0`, `sunT > 0`, `time ≥ strikeNext` → `strikeNext = time + (0.44 − 0.32·t)·(0.6 + 0.8·rng())`, `engine.strike(t)`, `strikes++`, событие `{t:'strike', i, p:t}` |
| `tick(dt)` | `time += dt`; хаос; удары; по голосам — `:2032` (`dirty` → `sync`: `syncMods` `:1112`, `voice`, `snap false`), `:2033` env, `:2035` смерть в дыре, `:2036-2041` затухание; затем `engine.busEnv(Σ env активных)` (`:2045`) |

- [ ] **Step 1: Тесты** (имя → утверждения)
- `remove drops links everywhere`: `a, b, c` активны; `link(b, a)`, `link(c, a)`; `remove(a)` → `V[b].mods`, `V[c].mods` пусты, `dirty` у обоих.
- `link keeps depth`: `linkDepth(a, b, 0.8)`, `link(a, b)` → одна связь, `depth 0.8`, `auto false`; `linkType(a, b, 'am')` → `type 'am'`; `unlink(a, b)` → пусто.
- `lfo edit in place`: `lfo(i, 'cut', {...LFO_DEF})` → 1 вызов `['lfo', i, 'cut', spec]`; `lfo(i, 'cut', {rate: 3})` → тот же объект, `rate 3`, новых `lfo` нет; `lfo(i, 'cut', null)` → `['lfo', i, 'cut', null]`, ключа нет.
- `chaos seeded`: `fx({chaos: 0.5})`, два активных; тик по `0.1` с 50 раз → у каждой авто-связи `auto true`, `src` активен, `depth === 0.5·k`, `0.15 ≤ k < 0.55`; два прогона с одним зерном дают одинаковые `mods` (`JSON` от `{src: src.i, type, depth, until}`).
- `chaos off`: после авто-связей `fx({chaos: 0})`, тик `0.5` → авто-связей нет; один активный голос — авто-связей нет.
- `chaos expiry`: авто-связь с `until`; тик до `time > until` → эта связь снята или заменена другой (`until` новый).
- `tick sync order`: `dirty` голос, `tick(0.016)` → среди его вызовов `links` и все 8 `lfo` раньше `voice`; `snap false`, `dirty false`.
- `hole death`: закреплённый, `move(i, p, c, 0.95)`, `held 0`, тик → `pinned false`, `off` с `0.4`.
- `fade out`: временный, `release(i, 0.05)`, тики по `0.1` до `env < 0.004` → `active false`, `live false`, `['live', i, false]`, `mods` и `lfo` пусты.
- `sun strikes`: `grab(i)`, `sun(i, 1)`, 100 тиков по `0.01` → интервалы между `strike` в `[0.12·0.6, 0.12·1.4]`; `state.strikes` = числу вызовов `strike`; события `strike` с `p 1`. `sun(i, 0)` или `held 0` — ударов нет.
- `tick dt 0 and long`: `tick(0)` — `env` без изменений, без `NaN`; `tick(30)` — хаос сработал один раз (не больше одной новой авто-связи на голос).

- [ ] **Step 2:** тесты — FAIL. **Step 3:** реализовать. **Step 4:** все модельные тесты — PASS.
- [ ] **Step 5:** commit `tenebrae: model - links, lfo, chaos, tick, sun strikes`.

---

### Task 3: модель — кубик, снимок, очистка, сборка, FX

**Files:** Modify `worlds/tenebrae/model.js`, `tools/models/tenebrae.test.mjs`.

**Interfaces:**
- Consumes: Task 1–2.
- Produces: `fx(o)`, `dice() → bool`, `clear()`, `snapshot() → string`, `restore(js)`, `build()`.

| Что | Как сейчас |
|---|---|
| `fx(o)` | `Object.assign(state.fx, o)`; `engine.fx(state.fx)` (`applyFx` `:1110`) |
| `dice` | `:589-618` без пустого поля: живые (`active && envT > 0`) — нет → `false`, `rng` не тронут; формулы и порядок `rng` те же; `burst` каждому; `true` |
| `clear` | `:780-785` модельная часть: `remove` активных, `engine.clear()`, `kept = []` |
| `snapshot` | `:741-753` — побайтно та же строка |
| `restore` | `:754-777` модельная часть: лишние закреплённые — `remove`; по `d`: `held 0`, `unlinkAll`, снять LFO, `snap`, поля, `holeT = d.hole \|\| 0`, `amp = d.amp ?? 1`, `pinned`, `dirty`, `attack` если `!active \|\| envT === 0`, `burst`; затем связи (`depth`, `type` из снимка) и LFO (`{...sp}`); `fx(st.fx)`; `kept = []` |
| `build` | `:1124-1134` после `createEngine`: `fx`; `live`; связи и LFO; `voice` со `snap`; `on` для `active && envT === 1` |

- [ ] **Step 1: Тесты** (имя → утверждения)
- `dice ranges`: 2 живых голоса с LFO и связью → `true`; `0 ≤ wave < 1`, `0.3 ≤ cut < 0.92`, `0 ≤ res < 0.75`, `BEAT_MIN ≤ beat ≤ lerpLog(BEAT_MIN, BEAT_MAX, 0.85)`, `fm === 0 || fm < 0.7`, `shift === SHIFT_DEF || shift < 1`, у связи `depth ∈ [0.15, 0.9)`, `type ∈ LINK_TYPES`; авто-связь не тронута; `burst` у каждого.
- `dice empty`: нет живых → `false`; `rng` не вызывался (модель с `rng`, который бросает).
- `dice seeded`: два рига с одним зерном и одинаковой расстановкой → одинаковые поля.
- `snapshot roundtrip`: 2 закреплённых со связью и LFO, 1 временный, авто-связь; `s = snapshot()`; новый риг `restore(s)`; `snapshot()` нового === `s`; в `JSON.parse(s).v` нет временного, нет авто-связи; `fx` — все пять ключей.
- `snapshot format`: строка совпадает с образцом, собранным по `app.js:741-753` руками для одного голоса (зафиксировать литерал в тесте).
- `restore removes extra pinned`: 3 закреплённых, снимок с двумя → третий `remove` (`off 0.25`).
- `restore order`: вызовы `links/lfo` голоса — раньше его `voice` в первом `tick`; `fx` вызван.
- `restore keeps held temp`: временный с `held 1` не в снимке → после `restore` `active`, `held 1`.
- `clear`: все активные `remove`, есть `['clear']`, `kept` пуст.
- `build order`: 2 активных, `build()` → имена вызовов по группам: `fx`, затем `live`, затем `links/lfo`, затем `voice`, затем `on`.

- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** PASS.
- [ ] **Step 5:** commit `tenebrae: model - dice, snapshot/restore, clear, build, fx`.

---

### Task 4: трасса клея и эталон до правки `app.js`

**Files:** Modify `tools/shot.py`; Create `tools/trace-diff.py`.

**Interfaces:**
- Produces: `T2D_TRACE=<папка> python3 tools/shot.py <сценарии>` пишет `<папка>/<сценарий>.json` — список `[кадр, kind, i, a]` для `postMessage` с `t === 'action' && slot === 1` (кадр — счётчик `requestAnimationFrame` из init-скрипта). `python3 tools/trace-diff.py A B` — по каждому сценарию: свернуть подряд идущие `kind 0` (VOICE) одного `i` в последний, числа — до `1e-3`, кадр не сравнивать; печатает первое расхождение (с кадрами) или `ok <сценарий>`; код выхода 1 при расхождении.

- [ ] **Step 1:** в `shot.py` — init-скрипт через `add_init_script` в `main()` (`:1915`), только при `T2D_TRACE`; после сценария выгрузить `window.__trace` в файл. Цепочку с хуком `sc_tenscale` (`:66-72`) не ломать — тот оборачивает `postMessage` поверх.
- [ ] **Step 2:** эталон: `git worktree add <scratchpad>/t2d-base HEAD`; в ней `python3 -m http.server 8766`; `T2D_URL=http://localhost:8766/index.html T2D_TRACE=.trace/base python3 tools/shot.py planets tenscale ring ampoff hold undo solniger worlds` — два раза (`base`, `base2`).
- [ ] **Step 3:** `python3 tools/trace-diff.py .trace/base .trace/base2` — все `ok`. Не `ok` — подправить нормализацию в `trace-diff.py` (не сценарии), пока эталон не сходится сам с собой; что пришлось нормализовать — записать в докстроку.
- [ ] **Step 4:** `.trace/` — в `.gitignore`. Commit `tools: glue action trace for shot.py, trace-diff`.

---

### Task 5: картинные поля голоса → `W[i]` (`app.js`)

**Files:** Modify `app.js`.

**Interfaces:**
- Produces: `const W` — 6 объектов `{ dx, wob, wv, ox, oy, hole, strike, emit, fingers: [], ph: {}, vph: {} }` по номеру голоса; `window.t2d.view = W`.

Механическая правка, поведение то же: `v.dx / wob / wv / ox / oy / hole / strike / emit` → `W[v.i].…`; `spec.ph` / `spec.vph` → `W[v.i].ph[key]` / `.vph[key]` (новый ключ — с 0; при снятии LFO ключ удалить, чтобы повторный начинал с 0, как `:363`); поле `t` удалить (не читается). `fingers` пока остаётся на `V` (уходит в Task 6). В `V` — только модельные поля + `fingers`.

- [ ] **Step 1:** правка; `grep -nE '\.(dx|wob|wv|ox|oy|emit|strike|ph|vph)\b' app.js` — остались только `W[...]` и чужие объекты (`f.`, `e.` и т. п.); `\.hole\b` — только `W[..].hole` (`holeT` — модель).
- [ ] **Step 2:** `node --check app.js`; сервер на 8765; `T2D_TRACE=.trace/w python3 tools/shot.py planets tenscale ring ampoff hold undo solniger worlds`; `python3 tools/trace-diff.py .trace/base .trace/w` — все `ok`.
- [ ] **Step 3:** `python3 tools/shot.py sun hole plate orphan` — без ошибок.
- [ ] **Step 4:** commit `tenebrae: picture fields of voices into view array W`.

---

### Task 6: `app.js` на модели

**Files:** Modify `app.js`, `tools/shot.py`.

**Interfaces:**
- Consumes: всё из Task 1–3, `W` из Task 5.
- Produces: `window.t2d.voices = model.state.voices`, `t2d.fx = model.state.fx`, `t2d.model = model`, `t2d.strikes` → `model.state.strikes`, `t2d.applyFx = () => model.fx({})`.

Правило: **ни одной записи в поле голоса, `fx` или `kept` вне `model.js`** — только методы. Что куда:

| Место в `app.js` | Становится |
|---|---|
| константы `:34-63`, `LINK_TYPES` | импорт из `./worlds/tenebrae/model.js` (кроме картинных: `GRAB_R`, `HOLE_R`, `SUN_R`, `AMP_*`, `DECAY_*`, `CUT_LO/HI`) |
| `V`, `fx`, `spawn/attack/release/addLink/dropLink/unlinkAll/chaosTick/setLfo/removeLfo/clearLfos/applyFx/syncMods/sync`, `allDirty` | `const model = createModel({ engine: () => engine, wake })`; `V = model.state.voices`; функции удалить; `setRetune` / `undo` → `model.retune` |
| `editor =` (везде) | `setEditor(e)`: `editor = e; model.keep(e && e.kind === 'voice' ? e.group.map((u) => u.i) : [])`; `closeEditor` → `model.unkeep()`, затем `setEditor(null)` |
| `v.fingers` | `W[i].fingers` (id) + `model.grab / letGo`; проверки «держат» — `v.held` |
| пойманный голос `:478`, мост `:391` | `if (!v.pinned) model.attack(i); model.grab(i)`; новый голос — `spawn`, затем `grab` |
| `solUp :554-578` | двойной тап: `model.letGo(i, false); r = model.pin(i)`; `'full'` → `full.push(...)`; иначе `model.letGo(i)` |
| `follow`, `startZoom`, призрак `:818`, сеттеры `setNorm/setAmpT/ampSet/rowDefault/sheetWave/fxSet/lfoStrip` | `move`, `release(i, 0.03)` при тех же условиях, `attack`, `set`, `fx({...})`, `lfo` |
| мост / нить / кольцо связи | `link` (возвращает связь — `depth0`), `linkDepth`, `linkType`, `unlink` |
| `deleteVoice / restore / clearAll` | view: `setEditor(null)` при тех же условиях, `ghost = null`, `lastTap = null` где было; `model.remove / restore / clear`; затем у пальцев, чей голос получил `held 0`, — `f.voice = null; f.menu = null`, `W[i].fingers = []`; у восстановленных `W[i].dx = x`, `W[i].hole = holeT` |
| `rollDice` | `if (!model.dice())` — пустое поле: `place(...)` на `Math.random` view, `outOfHole/unplace/holeDepth`, `i = model.spawn(...)`, `i < 0` → выход, `model.pin(i)`, `model.dice()`; `markDice()` |
| `sunStrikes` | геометрия → `model.sun(i, t)` для всех 6 (макс. `t` по годным пальцам, иначе 0) — каждый кадр до `model.tick` |
| `solTick` | `chaosTick`, `dirty/env/смерть/затухание`, `busEnv` → `model.tick(dt)`; затем `model.events()`: `burst` → `rings` (`:312`), `strike` → `W[i].strike = {t0: performance.now(), p, a: atan2(...)}`; остальное (картинка, авто-закрытие плашки — через `setEditor(null)`) — как было |
| `solBuild` | `if (engine) { engine.bind(...); return } engine = createEngine(...); model.build()` |
| `solNiger` | `clear: clearAll`, `snapshot: model.snapshot`, `restore`, `sounding: model.sounding`, `fx.save: () => ({ ...model.state.fx })`, `fx.load: (o) => model.fx(o)` |
| нагрузка `:739` | `setGraphLoad(model.load)` |

- [ ] **Step 1:** правка. Проверка «никаких записей мимо модели»: `grep -nE '\bv\.(x|y|beat|wave|fm|cut|res|shift|amp|holeT|pinned|active|live|env|envT|envTau|held|snap|dirty|mods|lfo)\s*(=[^=]|\+\+|--|\+=|-=)' app.js` и то же для `u.`, `A.`, `B.`, `m\.(depth|type|auto)\s*=`, `spec\.(morph|rate|depth)\s*=`, `fx\.\w+\s*=` — пусто.
- [ ] **Step 2:** `node --check app.js`; модельные тесты — PASS.
- [ ] **Step 3:** трасса: `T2D_TRACE=.trace/new python3 tools/shot.py planets tenscale ring ampoff hold undo solniger worlds`; `trace-diff.py .trace/base .trace/new` — все `ok`. Расхождение — разобрать по одному (`superpowers:systematic-debugging`); допустимы только следствия «Отклонений» 1–8 — каждое записать в отчёт задачи.
- [ ] **Step 4:** все сценарии `python3 tools/shot.py` — без ошибок (`sun` — `t2d.strikes` растёт; `hole` — голос умирает).
- [ ] **Step 5:** в конец `sc_plate` (и `sc_orphan`, если там плашка голоса закрывается удалением) — `assert await p.js("()=>!(t2d.editor&&t2d.editor.kind==='voice') === (t2d.model.state.kept.length===0)")`; прогнать.
- [ ] **Step 6:** `tools/render.py:5` — докстрока на `t2d.model.set(v.i,'wave',0.75)`.
- [ ] **Step 7:** commit `tenebrae: app.js drives worlds/tenebrae/model.js`.

---

### Task 7: проверка глазами, выкладка, доки

**Files:** Modify `sw.js:4`, `index.html:42-57`, `docs/worlds/tenebrae.md`, `docs/refactor-plan.md`, `docs/testing.md`, `docs/native-ios-plan.md`, `docs/tokens.md`.

- [ ] **Step 1:** агент `shots`: сценарии `planets ring sun hole undo solniger` — картинка как раньше (планеты, кольца, молнии, дыра, undo), без пустых кадров.
- [ ] **Step 2:** `node --test tools/test-models.mjs tools/models/*.test.mjs` и `node tools/test-tenebrae-core.mjs` — зелёные.
- [ ] **Step 3:** `sw.js` `CACHE = 't2d-v216'`, `index.html` все `?v=216` (число — следующее за текущим, если уже не 215).
- [ ] **Step 4:** доки: `tenebrae.md` — раскладка кода (что в `model.js`, что в `app.js`, `W`, события); `refactor-plan.md` шаг 8 — модель вынесена, view — нет; `testing.md` — `tenebrae.test.mjs`, `T2D_TRACE` и `trace-diff.py`; `native-ios-plan.md` фаза 4 — шаг А сделан; строка `docs/tokens.md` (`python3 tools/tokens.py --line`).
- [ ] **Step 5:** commit `tenebrae: phase 4 step A docs, v216`; `git push origin native`; `python3 tools/deploy-wait.py` → `success`.
- [ ] **Step 6:** `git worktree remove <scratchpad>/t2d-base`.

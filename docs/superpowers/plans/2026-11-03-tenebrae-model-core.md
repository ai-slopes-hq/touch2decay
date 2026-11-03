# Tenebrae · шаг Б — модель в ядро C++ · план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** модель мира I (`worlds/tenebrae/model.js`) живёт в `core/worlds/tenebrae/` и ведёт голоса сама; веб ходит в неё через фасад (действия → ядро, зеркало и `heard` → `state`), в ядре появляются `snapshot` / `restore` Tenebrae; веб ведёт себя так же.

**Architecture:** порт модели один в один в `model.hpp/.cpp`; модель шлёт миру те же низкоуровневые команды 0–8, что раньше слал клей `engine.js` (мир исполняет их прежним кодом). Фасад по образцу `worlds/firmamentum/model.js`: синхронные ответы (`spawn`, `pin`, `dice`) — своей копией правил эталона, остальное — из зеркала с правилами гонок по номерам сообщений. Веб переключается на фасад последним коммитом кода (задача 5); до него сайт работает на JS-модели шага А.

**Tech Stack:** C++17 → `t2d.wasm` (`core/build.sh`), ES-модули без сборки, `node --test`, Playwright (`tools/shot.py`).

**Spec:** `docs/superpowers/specs/2026-11-03-tenebrae-model-core-design.md`

## Global Constraints

- Ветка `native`; мерж в `main` не делать. Пушить только в задаче 6 (`git push origin native`) — Vercel выкатывает каждый пуш.
- Коммиты — по-английски, тело — список, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Без `commit -a`: `notebooks/` — файлы автора, не трогать.
- Правка `core/` — `core/build.sh` и `t2d.wasm` в том же коммите (хук `guard.py`).
- Коды действий 0–8 (`VOICE … CLEAR`) и их раскладки не меняются; ими пользуются `tools/test-tenebrae-core.mjs`, `render-cli`, `tenebrae-cli`.
- В модели и фасаде — без DOM, Web Audio и `Math.random`; случайность (кубик, хаос, удары) — только `sdk::Rng` модели ядра.
- Звук голосов, шины, эха, ударов — нынешнее ядро; формулы звука не меняются.
- Фасад правит `state` на месте, без новых объектов в кадре: связи и спеки LFO переиспользуются по ключу, контуры — в заранее созданных `Float32Array(128)`.
- Тесты гонять агентом `test-runner`; скриншоты смотрит только агент `shots`.
- Выкладка: `CACHE` в `sw.js` = `?v=` в `index.html`, одно новое число — **v217**.

### Решено при планировании (спека это допускает, автор не нужен)

1. Начальные голоса модели — `dirty: false` (и в JS, и в C++): ядро не шлёт шесть «пустых» `VOICE` в первом блоке (иначе до задачи 5 модель ядра затирала бы поля, которые шлёт клей). В вебе ничего не меняется: `build()` и так сбрасывал `dirty`.
2. `lfo(i, key, …)` с ключом не из `LFO_KEYS` — ничего (как `set` с чужим ключом).
3. В зеркале «нет LFO» — `depth = −1`, а не 0: LFO с глубиной 0 у пользователя бывает, фасад не должен его терять.
4. `LINK` — `a = [src]` (у эталона `link(dst, src)` нет глубины и типа).
5. Шаг модели — в начале `process`, до звука: действия кадра применяются к голосам до блока (как раньше `tick` в вебе слал всё до рендера).
6. Фасад до задачи 5 живёт в `worlds/tenebrae/facade.js` (веб его не грузит; хук предупредит «нет в sw.js» — ожидаемо); в задаче 5 `git mv` поверх `model.js`.
7. `restartAudio` по общему пути теряет временные (не закреплённые) кружки — они и так гаснут; закреплённые, связи, LFO, FX восстанавливаются снимком.

### Числа ядра (фиксирует план)

**Действия** (`enum Act` в `core/worlds/tenebrae/world.hpp`; JS — `ACT` фасада):

| Код | C++ | JS | i | a |
|---|---|---|---|---|
| 16 | SPAWN | spawn | голос | `[p, c, holeT]` |
| 17 | GRAB | grab | голос | — |
| 18 | LETGO | letGo | голос | `[fade 0/1]` |
| 19 | KEEP | keep | 0 | `[i…]` |
| 20 | UNKEEP | unkeep | 0 | — |
| 21 | MOVE | move | голос | `[p, c, holeT]` |
| 22 | SUN | sun | голос | `[t]` |
| 23 | SET | set | голос | `[key, v]`, key: 0 wave, 1 cut, 2 res, 3 beat, 4 fm, 5 shift, 6 amp |
| 24 | PIN | pin | голос | — |
| 25 | REMOVE | remove | голос | — |
| 26 | ATTACK | attack | голос | — |
| 27 | RELEASE | release | голос | `[τ]` |
| 28 | LINK | link | dst | `[src]` |
| 29 | LINKDEPTH | linkDepth | dst | `[src, depth]` |
| 30 | LINKTYPE | linkType | dst | `[src, type 0–3]` |
| 31 | UNLINK | unlink | dst | `[src]` |
| 32 | SETLFO | lfo | голос | `[key 0–7, morph, rate, depth]`, `depth < 0` — снять |
| 33 | SETFX | fx | 0 | `[rev, decay, dly, chaos, dirt]` |
| 34 | DICE | dice | 0 | — |
| 35 | WIPE | clear | 0 | — |
| 36 | RETUNE | retune | 0 | — |

Короче нужного `a` или `i` вне 0…5 — ничего. Зерно модели — `seed ^ 0x4d4f44` (`MODEL_SEED`; у шума `0x54454e`).

**Зеркало** (`MIRROR_*` в `world.hpp`, те же числа — в фасаде):

- заголовок `MODEL_HEAD = 15`: `[0] 6, [1] time, [2] strikes, [3…7] rev, decay, dly, chaos, dirt, [8] число kept, [9…14] номера kept (остальные −1)`;
- голос `MVOICE = 62`, с `15 + i·62`: поля `0…16` — `active, live, pinned, held, x, y, beat, wave, fm, cut, res, shift, amp, holeT, sunT, env, envT` (bool — 0/1); `17` — число связей, `18…37` — 5 × `src, type, depth, auto`; `38…61` — 8 × `morph, rate, depth` по `LFO_KEYS`, `depth −1` — нет;
- `MODEL_N = 15 + 6·62 = 387`;
- контуры — только если хоть один голос звука живой (`Voice::isLive`): с `387`, на голос `SCOPE_V = 129` — `live` звука, 128 точек (у неживого или без полей — нули). Длина `MIRROR_N = 387 + 6·129 = 1161`; ни одного живого — `MODEL_N`.

**`heard`:** плоско подряд `[1, i]` — burst, `[2, i, p]` — strike; пусто — 0. Очередь модели — до 64 записей, лишние отбрасываются.

## Review Focus

1. **Гонка тяги:** кружок тянут (MOVE каждые 16 мс), а хаос в ядре правит его связи — поля под пальцем не прыгают назад от устаревшего зеркала; после отпускания связи догоняют. Тест — задача 4, «touched voice survives stale mirrors».
2. **Spawn при полном поле:** фасад выбирает жертву по `env` из зеркала, отставшего на кадр; ядро берёт тот же номер, даже если сам выбрал бы другой, и голос заводится заново. Тест — задача 4, «spawn index is the caller's».
3. **Отмена сразу после кубика:** в историю уходит сцена до кубика, а следующий снимок — уже с результатом из зеркала. Тест — задача 4 (`busy()`), задача 6 (`undo`, `dice` в `shot.py`).
4. **Снимок символ в символ:** LFO в порядке добавления (`cut`, потом `pitch` → тот же порядок ключей), числа с 5+ знаками (`0.123456` → `0.1235`), связь на временный голос в снимок не попадает. Тест — задача 2, «snapshot string equals the reference».
5. **Зеркало длиннее 1024:** все четыре лимита подняты одним коммитом, `t2d_mirror` отдаёт 1161 числа, ворклет копирует их целиком. Тест — задача 2 (длина в Node) и `tools/test-t2d-worklet.mjs`.

---

### Task 1: JS-модель — защиты, связи по номеру, `mod(dst, src)` (Б.0)

**Files:**
- Modify: `worlds/tenebrae/model.js` (весь файл ~385 строк; правки в `makeVoice`, `addLink` … `unlinkAll`, `grab`, `move`, `set`, `pin`, `remove`, `link`/`find`, `lfo`, `chaos`, `syncMods`, `snapshot`, `restore`)
- Modify: `app.js` — связи: `:103` (`fmOpen`), `:332`, `:525-537` (`linkCurve`/`linkMid`), `:630-631`, `:703`, `:815`, `:884-900` (`openLink`), `:931`, `:946`, `:975-976`, `:1219-1224`, `:1386-1391`, `:1891`
- Test: `tools/models/tenebrae.test.mjs`

**Interfaces:**
- Produces: `mods[k] = { src: <номер голоса>, type: 'fm'|'tzfm'|'am'|'rm', depth, auto?, k?, until? }`; `model.mod(dst: number, src: number) → mod | undefined`; `pin(i)` на неактивном → `null`.

- [ ] **Step 1: Тесты (красные)** — в `tenebrae.test.mjs`, на `rig()`:

```js
test('set ignores keys outside the list', () => {
  const { m, V } = rig(); const i = m.spawn(0.4, 0.3, 0); m.tick(0.01);
  m.set(i, 'active', false); m.set(i, 'x', 0.9); m.set(i, 'cut', 0.1);
  assert.ok(V[i].active); assert.equal(V[i].x, 0.4); assert.equal(V[i].cut, 0.1);
});
test('inactive voice ignores grab, pin, remove, move, set, lfo', () => {
  const { m, V, calls } = rig(); const v = V[3], before = JSON.stringify(v);
  m.grab(3); m.move(3, 0.9, 0.9, 0.5); m.set(3, 'cut', 0.1); m.lfo(3, 'cut', { depth: 0.5 }); m.remove(3);
  assert.equal(m.pin(3), null);
  assert.equal(JSON.stringify(v), before); assert.equal(calls.length, 0); assert.equal(m.events().length, 0);
});
test('new lfo merges LFO_DEF and writes no ph', () => {
  const { m, V } = rig(); const i = m.spawn(0.4, 0.3, 0), spec = { depth: 0.8 };
  m.lfo(i, 'cut', spec); m.lfo(i, 'nope', { depth: 1 });
  assert.deepEqual(V[i].lfo, { cut: { morph: 0, rate: 1.2, depth: 0.8 } });
  assert.deepEqual(spec, { depth: 0.8 });   // переданный объект не тронут
});
test('links hold voice numbers; mod(dst, src) finds them', () => {
  const { m, V } = rig(); const [a, b] = two(m);
  const x = m.link(a, b);
  assert.equal(V[a].mods[0].src, b); assert.equal(m.mod(a, b), x); assert.equal(m.mod(b, a), undefined);
});
test('fresh voices are clean: first tick sends no voice', () => {
  const { m, names } = rig(); m.tick(0.01); assert.ok(!names().includes('voice'));
});
```

Поправить существующие тесты под номера: `snapshot`-хелпер `:137` (`x.src.i` → `x.src`) и все `m.src === V[..]`.

- [ ] **Step 2:** `node --test tools/models/tenebrae.test.mjs` — новые падают.
- [ ] **Step 3: Модель.** Защиты — первой строкой метода: `SET_KEYS = ['wave','cut','res','beat','fm','shift','amp']` (экспорт); `grab`, `pin`, `remove`, `move`, `set`, `lfo` — `if (!V[i].active) return` (`pin` → `null`); `lfo` с ключом не из `LFO_KEYS` — return; новый ключ — `v.lfo[key] = { ...LFO_DEF, ...spec }` (без `ph`), в движок уходит этот новый объект. `makeVoice`: `dirty: false`. Связи: `addLink(dst, srcIndex, depth, type)`, везде `m.src` — номер (`unlinkAll`: `m.src === v.i`; `chaos`: `V[auto.src].active`, кандидаты по `m.src === u.i`, `addLink(v, cand.i, …)`; `syncMods`: `src: m.src`; `snapshot`: `ids.has(m.src)`, `src: m.src`; `restore`: `addLink(v, m.src, …)`). `find` → экспорт `mod`.
- [ ] **Step 4: `app.js`.** Где нужен голос-источник — `V[m.src]` (`linkCurve`, ручка `:630`, рисование `:1220`, `fmOpen` не меняется). Объект связи дольше кадра не хранить: `f.hit`, `f.menu`, `editor` держат `{ dst: <голос>, src: <номер> }`, связь берётся `model.mod(dst.i, src)` в момент чтения (`openLink(f, dst, src)`: `get`/`text`/`restore` читают `model.mod(...)`; `orig` — копия чисел). Проверки «связь удалена» (`:946`, `:1891`) — `!model.mod(dst.i, src)`; `editor.m === m` (`:1223`) — сравнение пары. Осторожно: `src` бывает 0 — проверять `!= null`, не по truthy.
- [ ] **Step 5:** `node --check app.js && node --test tools/test-models.mjs tools/models/*.test.mjs` — зелёные.
- [ ] **Step 6:** агент `shots`: `ring planets solniger` — кольцо связи открывается, тянется, режется; нити рисуются.
- [ ] **Step 7: Commit** `tenebrae: model guards, links by voice number` (model.js, app.js, test).

---

### Task 2: Модель в ядре C++ — порт, действия от 16, зеркало, `heard`, снимок, лимит 2048

**Files:**
- Create: `tools/ref/tenebrae-model.js` — копия `worlds/tenebrae/model.js` после задачи 1; `LINK_TYPES`, `LFO_KEYS` вписать константами (эталон не тянет `engine.js`), импорты `host/` — путями `../../host/…`; шапка — «эталон шага Б, не править».
- Create: `core/worlds/tenebrae/model.hpp`, `core/worlds/tenebrae/model.cpp`
- Modify: `core/worlds/tenebrae/world.hpp`, `world.cpp` — `action` делится на `cmd` (коды 0–8, прежнее тело) и действия модели; `process`, `mirror`, `heard`, `snapshot`, `restore`, `prepare`
- Modify: `core/build.sh` (все 4 списка с `tenebrae/world.cpp`, включая `tenebrae-cli`), `core/build-wasi.sh` — `+ core/worlds/tenebrae/model.cpp`
- Modify (лимит 1024 → 2048, одним коммитом): `core/bridge/api.cpp:48` `MBUF` (и комментарий `:10`, `:49` — «Tenebrae — до 1161»), `core/app/engine.hpp:41` `MIRROR_CAP`, `t2d-worklet.js:91` `Float64Array(…, 2048)`, `core/bridge/t2d.h:5` (комментарий)
- Modify: `tools/test-tenebrae-core.mjs` — только разбор зеркала: контуры с `387`, по `129` на голос, длина `1161` (звук не трогать)
- Modify: `worlds/tenebrae/engine.js` — `scope(i)` читает контур по новой раскладке (веб до задачи 5 ещё на клее): `M_HEAD = 387`, `M_V = 129`, точки с `b + 1`; зеркало короче 387+ — `null`
- Create: `tools/models/tenebrae-core.mjs` — сырой доступ к ядру для сверки (без фасада)
- Create: `tools/models/tenebrae-parity.test.mjs`

**Interfaces:**
- Consumes: эталон (задача 1).
- Produces (C++, `namespace tenebrae`, `model.hpp`):
  - константы эталона (`VOICES 6, PIN_MAX 3, TEMP_MAX 3, TAIL 1.6, UNPIN_TAIL 0.8, LINK_NEW 0.5, BEAT_MIN 0.05, BEAT_MAX 24, BEAT_DEF 0.35, CUT_DEF 0.68, RES_DEF 0.21, WAVE_DEF 0.125, SHIFT_DEF 0.5`, `LFO_DEF {0, 1.2, 0.35}`, `LFO_RATE_MIN 0.03, LFO_RATE_MAX 20`), `MAXMOD 5`, `NLFO 8`, `MODEL_SEED 0x4d4f44u`; `VOICES` переезжает сюда из `world.hpp`;
  - `struct Mod { int src, type; double depth, k, until; bool autoLink; }`, `struct LfoSpec { bool on; double morph, rate, depth; }`, `struct MVoice` — поля эталона (`x, y, beat, wave, fm, cut, res, shift, amp, holeT, sunT, env, envT, envTau, strikeNext`, `held`, `pinned, active, live, snap, dirty`), `Mod mods[MAXMOD]; int nmods; LfoSpec lfo[NLFO]; int lfoOrder[NLFO], nlfo` (порядок добавления — для снимка);
  - `class Model`: `void reset(uint32_t seed)`; `void listen(void (*fn)(void*, int kind, int i, const double* a, int n), void* ctx)` — kind = коды 0–8, раскладки как в комментарии `world.hpp`; `int pick() const` (выбор голоса `spawn` эталона, −1 — нет); `void spawn(int i, double p, double c, double holeT)` (тело `spawn` эталона в голос `i`, без выбора); `grab, letGo(i, bool fade), keep(const int*, int), unkeep(), move, set(i, int key, double), int pin(i)` (0 null, 1 pinned, 2 unpinned, 3 full), `remove, attack, release(i, tau), link, linkDepth, linkType(dst, src, int type), unlink, lfo(i, int key, const double* spec)` (`nullptr` — снять), `sun, fx(const double v[5]), bool dice(), clear(), retune(), tick(double dt)`; `std::string snapshot() const; void restore(const std::string&)`; `int heard(double* buf, int cap)`; доступ `const MVoice& voice(int)`, `double fx(int)`, `time()`, `strikes()`, `int kept(int* out) const`.
- Produces (JS, `tools/models/tenebrae-core.mjs`): `MODEL_SEED`, `ACT` (таблица выше, имена JS), `MIRROR = { HEAD: 15, VOICE: 62, MODEL_N: 387, SCOPE_V: 129, N: 1161 }`, `parseMirror(m) → { time, strikes, fx, kept, voices: [{ …17 полей, mods: [{src, type: 'fm'…, depth, auto}], lfo: {key: {morph, rate, depth}} }], scope: [Float64Array(128) | null] }`, `parseHeard(h) → [{t:'burst', i} | {t:'strike', i, p}]`, `coreRig(seed) → { act(name, i, a), restore(js), snapshot(), tick(dt), state(), events(), core }` (`tick` — `process` кусками ≤ 128, `events` — `core.heard(1)`).

- [ ] **Step 1: Сверка (красная)** — `tenebrae-parity.test.mjs`: эталон `createModel({ rng: seeded(seed ^ MODEL_SEED), engine: () => null })` и `coreRig(seed)` получают одни шаги; после каждого шага `same(ref, core)`: все 17 полей голоса, связи (src, type, depth, auto), LFO, fx, kept, time, strikes — до 1e-9; `ref.events()` ≡ события ядра; в конце сценария `ref.snapshot() === core.snapshot()`. Шаг драйвера: `['spawn', p, c, h]` → `i = ref.spawn(...)`, ядру `act('spawn', i, …)` при `i ≥ 0`; `['run', сек]` → по 128 сэмплов `ref.tick(128/48000)`, `core.tick(128/48000)`; остальные — тем же методом / кодом. Тесты:
  - `pin cycle, full, keep and unkeep` (4 кружка, пин трёх, отказ четвёртому, unpin, keep/unkeep, run 3 с);
  - `chaos and death` (`fx chaos 0.8`, 3 кружка, run 12 с — авто-связи появляются и истекают; `assert` что авто-связи были);
  - `sun strikes` (grab + `sun 0.8`, run 3 с; strikes > 3);
  - `dice, snapshot, restore, clear` (2 закреплённых + связь + LFO; dice; `restore(ref.snapshot())` обоим; clear; run 1 с);
  - `hole death` (`move` в `holeT 0.95` без пальца, run 1 с — голос умер);
  - `snapshot string equals the reference` — LFO `cut`, потом `pitch`; `set cut 0.123456`; связь закреплённого на временный (в снимке её нет);
  - `fuzz 600 seeded steps` — `seeded(7)` выбирает действие и аргументы из всего API, номера голосов 0…5 (неактивные — тоже; вне диапазона эталон падает на `V[i]`, поэтому не генерировать), `keep` — подмножества 0…5, ключи `set` и `lfo` — и чужие (ядру чужой ключ `set` = код 7+, `lfo` = 8+ — ничего);
  - `mirror length`: без живых — 387; с живым — 1161 (`core.mirror(1).length`).
- [ ] **Step 2:** `core/build.sh && node --test tools/models/tenebrae-parity.test.mjs` — падают (нет модели / действий).
- [ ] **Step 3: `model.hpp/.cpp`.** Порт эталона построчно, тот же порядок `rng_.next()` и команд слушателю. События эталона → команды: `attack` → `LIVE [1]` (если не live), `ON`; `release` → `OFF [τ]`; `removeLfo` → `LFO [key,0,0,0]`; `syncMods` → `LINKS [src,type,depth]×k`, затем по 8 ключам `LFO [key, morph, rate, depth]` или `[key,0,0,0]`; `sync` → `VOICE [x,y,cut,res,wave,beat,fm,shift,amp,holeT,snap]`; `fx` → `FX [rev, dly, dirt]`; `strike` → `STRIKE [p]`; `clear` → `CLEAR`; смерть → `LIVE [0]`. `busEnv` не шлётся. `exp` — `std::exp`; `lerpLog(lo, hi, t) = lo * std::pow(hi / lo, t)`; `Math.floor` — `std::floor`; `r4` снимка — `sdk::jsRound(x * 1e4) / 1e4`; JSON — `sdk::Json` (порядок ключей: `i,x,y,amp,wave,cut,res,beat,fm,shift,hole,lfo,mods`; `fx`: `rev,decay,dly,chaos,dirt`; тип связи — строкой). Без аллокаций вне `snapshot`/`restore`. Если сверка 1e-9 разъедется из-за последнего бита `exp`/`pow` — порт V8-алгоритма в `core/sdk/jsmath.hpp` (`jsExp` / `jsPow`), как `jsHypot`.
- [ ] **Step 4: `world.hpp/.cpp`.** Комментарий шапки — раскладки действий, зеркала, `heard` (числа — раздел «Числа ядра»). `prepare`: прежнее, затем `model_.reset(seed ^ MODEL_SEED)` и `cmd(FX, …)` с FX модели по умолчанию (как `build` веба). `action`: `retune()`; `kind ≤ 8` или −1 → `cmd`; 16…36 → модель (проверки длины `a`, `SET` — ключ 0…6, `SETLFO` — `depth < 0` → `lfo(i, key, nullptr)`). Слушатель модели → `cmd`. `process`: после `retune()` — `model_.tick(n / sr_)`, затем прежний звук. `mirror`/`heard`/`snapshot`/`restore` — по разделу «Числа ядра»; `sounding()` не менять.
- [ ] **Step 5: Лимиты и сборка** — 4 места `1024 → 2048`, `model.cpp` в списки сборки; `test-tenebrae-core.mjs` и `scope` в `engine.js` — на новую раскладку.
- [ ] **Step 6:** `core/build.sh && node --test tools/models/tenebrae-parity.test.mjs && node --test tools/test-tenebrae-core.mjs tools/test-t2d-worklet.mjs && node --test tools/test-models.mjs tools/models/*.test.mjs` — всё зелёное (звук кодов 0–8 — те же 1e-5).
- [ ] **Step 7: Commit** `tenebrae: model in the core, actions from 16, mirror cap 2048` (+ `t2d.wasm`).

---

### Task 3: Сверка звука действиями — `tools/tenebrae-scenarios.mjs`

**Files:**
- Create: `tools/tenebrae-scenarios.mjs`
- Modify: `tools/test-tenebrae-core.mjs` — блок «sdk: dry output matches the reference» (как `tools/test-firm-core.mjs:70-96`)

**Interfaces:**
- Consumes: `tools/ref/tenebrae-model.js`, `coreRig`/`ACT`/`MODEL_SEED`/`parseHeard` из `tools/models/tenebrae-core.mjs`, `loadT2d` из `tools/t2d-core.mjs`.
- Produces: `export const ACTS` (имя → шаги в формате драйвера задачи 2), `refPath(steps, { seed }) → { L, R, heard }`, `corePath(steps, { seed }) → { L, R, heard }`; `SR = 48000, BLOCK = 128, SEED = 12345`.

- [ ] **Step 1: Тест (красный).** Для каждого `ACTS[name]`: `rms(r.L)+rms(r.R) > 1e-3`; `same(c.L, r.L)`, `same(c.R, r.R)` по сэмплу до 1e-6; `c.heard` ≡ `r.heard` (по блокам, тем же порядком). Санитарные: `sun` — есть strike, `chaos` — авто-связи были (из `refPath` вернуть счётчик), `dice` — burst-ы.
- [ ] **Step 2:** запуск — падает (нет модуля).
- [ ] **Step 3: `refPath`** — эталон с `rng: seeded(seed ^ MODEL_SEED)` и клеем-переводчиком в `t2d` слота 1 кодами 0–8 (`voice/on/off/live/links/lfo/fx/strike/clear` → `core.action(1, код, i, a)`, `lfo(…, null)` → `[key,0,0,0]`, `busEnv` — пусто; без памяти и сравнений — ядро само пропускает одинаковое). Перед шагами — только `glue.fx(model.state.fx)` (как `prepare` ядра; `build()` не звать). Блок: `model.tick(128/SR)`, потом `core.process(128)`, сухой выход `core.dry(1, 0|1)`, `heard` — `model.events()`. **`corePath`** — тот же `t2d`, только действия от 16 и `restore`, `heard` — `parseHeard(core.heard(1))` после блока. Сценарии `ACTS`: `pluck`, `pinned` (3 закреплённых + связи fm/am + LFO), `chaos` (0.8, 10 с), `sun`, `dice`, `restore`, `clear`, `hole`, `dirt` (fx dirt 0.9, rev 0.8).
- [ ] **Step 4:** `core/build.sh && node --test tools/test-tenebrae-core.mjs` — зелёный.
- [ ] **Step 5: Commit** `tenebrae: action scenarios, core vs reference sound`.

---

### Task 4: Фасад — `worlds/tenebrae/facade.js` и тесты на эталоне и ядре

**Files:**
- Create: `worlds/tenebrae/facade.js` (в задаче 5 станет `model.js`)
- Modify: `tools/models/tenebrae-core.mjs` — `+ createModel({ seed, async })` = `sdkFacade(facade, 1, ACTIONS, { seed, async, heard: true })` из `tools/models/sdk-facade.mjs`; `coreVoice(i)` — голос из зеркала ядра сейчас (для гонок)
- Modify: `tools/models/tenebrae.test.mjs` — `FACTORIES = { ref, core }`, как `tools/models/firmamentum.test.mjs:18-25`

**Interfaces:**
- Consumes: `ACT`, `MIRROR`, `parseHeard` (задача 2) — фасад держит свои копии чисел (веб не тянет `tools/`), тест сверяет их с `tenebrae-core.mjs`.
- Produces: `createModel({ send = () => 0, wake = () => {} })` → API эталона без `build` и `engine`: `state` (`voices, fx, kept, time, strikes`), `spawn, grab, letGo, keep, unkeep, move, set, pin, remove, attack, release, link, linkDepth, linkType, unlink, mod, lfo, sun, fx, dice, clear, retune, snapshot, restore, load, sounding, events, tick` (пустой) + `sync(mirror, applied, heard = [])`, `bind(send)`, `scope(i) → Float32Array(128) | null`, `busy() → boolean`. Экспорты констант эталона (`VOICES, PIN_MAX, TEMP_MAX, TAIL, UNPIN_TAIL, LINK_NEW, BEAT_*, CUT_DEF, RES_DEF, WAVE_DEF, SHIFT_DEF, LFO_DEF, LINK_TYPES, LFO_KEYS, SET_KEYS`), `SLOT = 1`, `ACT`, `MIRROR`.

Правила фасада:
- Действие: применить к `state` правилами эталона (без движка; `attack` зовёт `wake()`), отправить `post({ t: 'action', slot: 1, kind, i, a })`, номер сообщения — в `dirty[u]` каждого тронутого голоса. `spawn`, `remove`, `unkeep`, `clear`, `restore` трогают все 6; остальные — свой `i` (связи — `dst`). `keep`/`unkeep`/`remove`/`clear`/`restore` — ещё `keptAt`; `fx`/`restore` — `fxAt`. `spawn` — `pick()` эталона по своему `state` (`env` — из зеркала), ядру `SPAWN i`. `lfo` шлёт полную слитую спеку `[key, morph, rate, depth]` или `depth −1`. `fx` шлёт все пять. `restore` — эталонный алгоритм локально + `post({ t: 'restore', slot: 1, js })`.
- `dice()`: ответ — есть ли `active && envT > 0` по своему `state`; есть — `DICE`, `waitAt = номер`; `state` не трогать (результат — из зеркала). `clear()` — локально как эталон, `WIPE`, `waitAt`. `busy() = applied < waitAt`.
- `sync(m, applied, heard)`: `time`, `strikes`, `env` всех голосов — всегда; fx — при `applied ≥ fxAt`; kept — при `applied ≥ keptAt`; голос целиком (поля, связи по `src` с переиспользованием объектов, LFO по ключу с переиспользованием спеки, тип связи — строкой) — при `applied ≥ dirty[i]`; контуры — в `Float32Array` голоса, `scope(i)` → `null`, если зеркало короткое или `live` звука 0; `heard` → очередь `events()`.
- `bind(send)`: `post = send`; `dirty[*] = fxAt = keptAt = waitAt = post({ t: 'restore', slot: 1, js: snapshot() })`.

- [ ] **Step 1: Тесты (красные).** Перевести `tenebrae.test.mjs` на `for (const [name, make] of Object.entries(FACTORIES))`: проверки — по `state`, `events()` и ответам методов; без записи в `state` из теста (жертву `spawn` готовить временем: отпустить кружки в разные моменты, `tick`). Проверки команд клея (`tick sync order`, `build order`, `restore order`) — только `ref` (`test('ref: …')`). Новые, только `core`:
  - `touched voice survives stale mirrors` (async): `spawn`, `flush`, `deliver`; 20 раз `move(i, …)` без `flush`, после каждого `deliver()` — `V[i].x` равен последнему своему; `flush`, `deliver` — равен и в `coreVoice(i)`;
  - `spawn index is the caller's` (async): 3 временных отпущены в разные моменты, `tick`; `spawn` до `deliver` → номер = эталону на тех же шагах; после `flush`/`deliver` голос этого номера в ядре активен, на новом месте, без связей;
  - `dice arrives by mirror` (async): 2 закреплённых, `flush`, `deliver`; `dice()` → `true`, `wave` не изменился, `busy()`; `flush`, `tick(0.01)` → `wave` другие, `!busy()`; на пустом поле `dice()` → `false`, `!busy()`;
  - `heard becomes events`: `pin` → `flush`, `tick` → `events()` содержит `{ t: 'burst', i }`; `sun` + `grab` → `{ t: 'strike', i, p }`;
  - `kept survives a stale mirror` (async): `keep([i])`, `deliver()` до `flush` → `state.kept` = `[i]`;
  - `rebind sends the pinned scene`: 2 закреплённых со связью и LFO + 1 временный; `rebind()` → в ядре закреплённые с той же связью и LFO, временного нет; `snapshot()` не изменился;
  - `numbers match the core`: `ACT`, `MIRROR` фасада ≡ `tenebrae-core.mjs`.
- [ ] **Step 2:** `node --test tools/models/tenebrae.test.mjs` — `core` падает.
- [ ] **Step 3: `facade.js`** по правилам выше; шапка — как у `worlds/firmamentum/model.js` (что откуда приходит).
- [ ] **Step 4:** `core/build.sh && node --test tools/test-models.mjs tools/models/*.test.mjs` — зелёные.
- [ ] **Step 5: Commit** `tenebrae: core model facade with race rules` (хук предупредит про `facade.js` вне `sw.js` — ожидаемо, файл уйдёт в задаче 5).

---

### Task 5: Веб на фасаде — `model.js`, тонкий `engine.js`, `app.js`, `restartAudio`, отмена после кубика

**Files:**
- Move: `git mv -f worlds/tenebrae/facade.js worlds/tenebrae/model.js`; импорт в `tools/models/tenebrae-core.mjs` → `model.js`
- Rewrite: `worlds/tenebrae/engine.js` — как `worlds/firmamentum/engine.js`
- Modify: `app.js:25-26, 69-70` (создание модели), `:979-985` (`solBuild`), `:1064` (`engine.scope` → `model.scope`), `:2019-2020` (commit), `solTick` (~`:1880`), хук `strikeSound` (`:2098`)
- Modify: `host/audio.js:3, 172-176` — `restartAudio` без исключения мира 1, комментарии
- Modify: `tools/models/tenebrae.test.mjs` — импорт `ref` теперь `tools/ref/tenebrae-model.js`, `LFO_KEYS`/`LINK_TYPES` — из фасада

**Interfaces:**
- Consumes: фасад задачи 4.
- Produces: `createEngine({ model })` → `{ build(core, out), dispose() }`; `build`: сухой `core.dry[1]` → `out`, `model.bind(core.send)`, `core.listen(d => { const w = d.w && d.w[1]; if (w) model.sync(w.mirror, d.n, w.heard); })`. Экспорты `engine.js`: `createEngine`, `RES_MAX`, `DLY_REPEATS`, реэкспорт `LINK_TYPES`, `LFO_KEYS` из `model.js`. Старый `ACT` 0–8 из `engine.js` убрать (его копия — `tools/ref/tenebrae-scenes.js`).

- [ ] **Step 1: Тест (красный)** в `tenebrae.test.mjs`, `core`: `engine build wires the facade` — фейковый `core { dry: [, { connect(o) { … } }], send, listen(fn) }`: после `build` сухой выход подключён к `out`, `send` получил `restore`, вызов `fn({ n, w: { 1: { mirror, heard } } })` доходит до `model.sync` (`state.time` из зеркала).
- [ ] **Step 2:** запуск — падает.
- [ ] **Step 3: Переключение.** `git mv`; `engine.js` по интерфейсу; `app.js`: `const model = createModel({ wake })`, `engine = createEngine({ model })` один раз, `solBuild(_, chanIn)` → `engine.build(core, chanIn)` каждый раз (без `model.build()`); `model.scope(v.i)`; `strikeSound: (p) => core && core.send({ t: 'action', slot: 1, kind: 7, i: 0, a: [p] })`. Отмена: на `pointerup`/`pointercancel` вместо `commit()` — `settle()`: `nav.world === 1 && model.busy()` → `commitWait = true`, иначе `commit()`; в `solTick` после `model.events()` — `if (commitWait && !model.busy()) { commitWait = false; commit(); }`. `host/audio.js`: снимок и `restore` для всех миров со `snapshot`, мир 1 — тоже.
- [ ] **Step 4:** `node --check app.js host/audio.js worlds/tenebrae/*.js && node --test tools/test-models.mjs tools/models/*.test.mjs && node --test tools/test-tenebrae-core.mjs tools/test-t2d-worklet.mjs` — зелёные; `git grep -n "engine\.\(bind\|voice\|links\|scope\)\|model\.build" -- app.js host` — пусто.
- [ ] **Step 5: Commit** `tenebrae: web runs on the core model facade`.

---

### Task 6: Проверка глазами, доки, выкладка

**Files:**
- Modify: `sw.js` (`CACHE` → `t2d-v217`), `index.html` (`?v=217`)
- Modify: `docs/worlds/tenebrae.md` (раскладка кода, действия, зеркало, `heard`, снимок в ядре), `docs/native-ios-plan.md` (фаза 4, этап 2 сделан), `docs/architecture.md` (особый случай мира I в `restartAudio` убран), `docs/testing.md` (`tenebrae-parity.test.mjs`, сценарии действиями, `facade` на эталоне и ядре), `docs/tokens.md` (строка: дата, «Tenebrae · шаг Б», что сделано, токены — `python3 tools/tokens.py --line`), `core/README.md` / `docs/sdk-inventory.md` — если там перечислены файлы мира I
- Memory: закрыть `tenebrae-step-b-todo` (удалить файл и строку в `MEMORY.md`)

- [ ] **Step 1:** агент `shots`: `planets ring sun hole undo solniger dice` — кружки звучат и рисуются с контурами, кольцо связи, удары солнца, смерть в дыре, отмена после кубика возвращает сцену до кубика, корзина. Трассу `T2D_TRACE` не сравнивать.
- [ ] **Step 2:** финальное ревью всей ветки от `38d70ff` (opus, по SDD); замечания проверить по коду до правки.
- [ ] **Step 3:** доки и бамп; `node --test tools/test-models.mjs tools/models/*.test.mjs` ещё раз.
- [ ] **Step 4: Commit** `tenebrae: step B docs, v217`; `git push origin native`; `python3 tools/deploy-wait.py` → `success v217 …`.
- [ ] **Step 5:** автору — коротко, что поменялось, и что на iPhone не проверено.

---

**Исполнение:** реализация — субагенты `sonnet` (`effort: "medium"`; задачи 2 и 4 — самые связные), ревью задач — `sonnet`, финальное ревью ветки — `opus`.

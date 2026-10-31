# iOS фаза 3 — Arcadia на Swift: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** XII · Arcadia — пятый нативный мир: гравированная карта холмистой страны, странники с петлями по рельефу, касания, плашка `viator`, веер FX с LFO, легенда; попутно — `ACT_LFO` в ядре Arcadia и картина страны из ядра (`t2d_app_arc_pic / _route / _name`).

**Architecture:** страна, странники, пути, звук и шина — в ядре (`core/worlds/arcadia/`); Swift разбирает зеркало (65 чисел) и шлёт действия, как Horologium (`ios/app/T2D/Horologium/`). Рельеф для картинки и касаний берётся из ядра чистой функцией (`LandGen` с необязательным `Pic*`), Swift `genLand` не портирует. Слоты, ожидающие ответа слоты, собственные значения и след — чистая структура `ArcState` (без `Core`). Мир: `ios/app/T2D/Arcadia/` — `ArcMath`, `ArcGeo`, `ArcMirror`, `ArcPic`, `ArcState` (чистый слой), `ArcadiaView` (касания, тик, кубик), `ArcSheets`, `ArcWall` (стена-кеш), `ArcDraw`.

**Tech Stack:** C++17 (`core/tests/sdk_test.cpp`), Node (фикстура и сверка с `genLand`), Swift 5 + UIKit + CoreGraphics, XCTest, XcodeGen; веб-эталон снимков — `python3 tools/shot.py arcadia`, `arcadia-fixed`.

**Spec:** `docs/superpowers/specs/2026-10-31-ios-arcadia-design.md` — читать целиком перед любой задачей. Веб-источник истины — `worlds/arcadia/view.js` (геометрия `:12-31`, касания `:41-96`, плашка `:84-93`, стена и рисование `:98-268`, веер, легенда, угол `:270-282`) и `worlds/arcadia/model.js` (константы `:10-16`, `genLand :30-123`, `figPt`, `depthOf :124-125`, `routeOf :146`, `dice :206`, след `:200-205`).

## Global Constraints

- Ветка `native`; в `main` не идёт, ветку не менять. Коммиты — по-английски, тело-список, последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `notebooks/*` и `.superpowers/` не коммитить, не пушить.
- Ядро: C++17, `-ffp-contract=off`; в `process` — без блокировок и аллокаций (`LandGen` со `Pic == nullptr` не платит ни такта). Правка `core/` → `core/build.sh` и `t2d.wasm` в том же коммите. Комментарии — по-русски, плотность как в соседнем коде.
- Миры заморожены: звук и поведение веба Arcadia не меняются — `node --test tools/test-arcadia-core.mjs tools/models/arcadia.test.mjs` зелёные до и после (звук бит в бит, 1e-6; тайминг-тест «land … stays cheap» при параллельном прогоне краснеет — гонять файл отдельно, `docs/testing.md`).
- Swift: новые файлы в `T2D/` попадают в `T2D` сами, в `T2DTests` — через `project.yml:60` (добавить `T2D/Arcadia`, задача 4); после — `xcodegen` в `ios/app`. Комментарии — по-русски, как в `Horologium/`.
- Тесты: ядро — `core/build.sh && core/build/sdk-test` → `0 failed`; Swift — `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|failed|passed|SUCCEEDED|FAILED" | tail -30` → `** TEST SUCCEEDED **`; веб — `node --test tools/test-models.mjs tools/models/*.test.mjs`.
- Картинка — перенос `view.js` на `Draw` без новых решений: `d.mapText` (IM Fell, курсив: имена на стене курсивом 10.5, подписи странника), `d.mapText(..., italic: false)` («A R C A D I A» прямым 15), `d.text` (EB Garamond), плашки внутри `d.reading { }`. Никакого `shadowBlur`, градиентов на кадр, полноэкранных проходов кроме `drawImage` стены; стена — кеш `CGImage` в фоне; без `Array`/замыканий на странника в кадре (буферы на слот предвыделены); `dt` картинки ≤ 0.1 с; холст ≤ 2× (`DPR`).
- Касания — пороги `view.js` как есть, не общие `Touch.tapMs`: сдвиг > 8 px, тап < 300 мс, `HOLD_MS = Touch.holdMs = 420`, `homeAt` радиус 24 по двум точкам `(x, y)` и `(x − 4, y + 14)`, `rimAt` 12 px (`loopPts` 48, `r < 0.06` пропуск), край важнее флажка при `hd > 12`, угол — `y > sun.y && hypot < sun.r + 12`.
- Константы Arcadia: слот 12; `GX 80, GY 160, ASP 3.2, VMAX 4, SEMIS 24, K 2.4, Q1 = 1/(1+K)`; `SEED0 = 20261021`; `T_KEYS = u, v, oct, r, fig, mode, sp, lvl`; `FIGS = circle, eight, knot`; `PATHS = still, circuit, wander, river, summit`; `WATER = 46,86,104`; тема — `Worlds.info(12)` (`ink 40,46,32`, бумага `224,221,198`); `LAND_BLOCKS = MAX_STEPS = 59`; `RMAX_PTS = 182`. Умолчания `ADD`: `r 0.16, fig 0, mode 2, sp 0.22, lvl 0.8, oct 0`; `v` в `ADD`/`MOVE` зажат в `±0.98`.
- Действия ядра (`world.hpp:22`): `ADD 0 (i = слот, [u, v, oct, r, fig, mode, sp, lvl])`, `DROP 1`, `MOVE 2 (i, [u, v])`, `SET 3 (i, [key, v, route 0/1])`, `FX 4 (i = индекс Fx 0…6, [v])`, `LAND 5 ([seed])`, `CLEAR 6`. **Индекс Fx — позиция в 7-элементном массиве** (`relief 0, pace 1, wind 2, chorus 3, phaser 4, spread 5, hall 6`): у `hall` — 6, `spread` в веере нет.
- Зеркало (65 чисел, буфер ≥ 80): `fx[7]` (0…6), `seed` (7), `pending` (8), затем слот `s` с `9 + 14·s`: `on, u, v, oct, r, fig, mode, sp, lvl, f, cx, cy, rs, gain` (смещения 0…13). `heard` пуст.
- **Коды LFO** (`ACT_LFO`: `action(ACT_LFO, obj, [key, v], 2)`, `v` 0…1): веер — `obj −1`, `relief 0, pace 1, wind 2, chorus 3, phaser 4, hall 6`; плашка `viator` — `obj = слот`, `orbit 3, range 6, level 7` (значения `Key`: `R 3, SP 6, LVL 7`), строки `octave, figure, path` — `code −1`. Тот же код — `SheetRow.code`.
- **Решено без автора** (развилок нет, зафиксировано для ревью): (1) фикстура `arcadia-pic.json` хранит `z / lake` как FNV-1a 32 по байтам float32 (little-endian) — битовое равенство `genLand ↔ ядро` уже держит `test-arcadia-core.mjs`, все числа в файле не нужны; (2) снимок `arcadia` — те четыре странника, что в спеке (`still / circuit / river / summit`), без блуждающего: след проверяют юнит-тесты, а не картинка; (3) до первой готовой `ArcPic` рельеф плоский (`zAt = 0`, `lake = 0`), касания и `ADD` работают, пути `mode ≥ 3` пусты; (4) в веб `t2d.arc` добавляется `addT: model.addT` (только отладочный вход для сцены `arcadia-fixed`, поведение не меняется); (5) сид тестов `ACT_LFO`: `t2d_app_init(48000, 7, 1e9, 1u << 12)`.

## Review Focus

1. **Два пальца: один держит флажок, второй ставит нового странника** — обоим верные слоты и действия, флажок остаётся в руке. Тест — задача 6 (`testTwoFingersHomeAndAdd`).
2. **Кубик сразу после корзины или `DROP`, и два кубика подряд** — слоты `0…n−1`, одна `CLEAR`, одна `LAND`, устаревшая страна отброшена; потерянное `ADD` (`Core.action == false`) слот не занимает. Тест — задачи 5 (`testReusedSlotAfterClear`, `testAddFailedFreesSlot`) и 6 (`testDiceStaleDiscarded`).
3. **Undo (`restored`), пока палец на флажке и плашка открыта** — `objGone` для всех слотов, пальцы и следы сброшены, последующий `up` ничего не шлёт, странники из зеркала берутся заново по возрастанию слота. Тест — задача 6 (`testRestoredResets`).
4. **Касание до готовой страны (`ArcPic` ещё нет) и пятый странник** — не падает: земля плоская, `ADD` работает; мест нет (4 живых) — палец `none` и ни одного действия; небо (`pick == nil`) — ничего. Тест — задача 6 (`testTouchBeforePic`, `testNoFreeSlot`, `testSkyTap`).
5. **Странник пропал при открытой плашке (отмена, чужой `DROP`)** — плашка закрывается хостом (`objGone`), `set` по мёртвому слоту действий не шлёт; значения строк при тяге — собственные, без отставания на кадр. Тест — задача 7 (`testViatorDeadSlot`, `testViatorOwnValues`).

---

### Task 1: Ядро — `ACT_LFO` Arcadia

**Files:**
- Modify: `core/worlds/arcadia/world.cpp` (`action`: `case sdk::ACT_LFO`), `world.hpp` (комментарий `action` — коды LFO), `t2d.wasm`
- Test: `core/tests/sdk_test.cpp` (после `horoDice`, вызовы — в `main()` ~3519; `lfoForeign` ~3136)

**Interfaces:**
- Produces: `ACT_LFO` у слота 12 по кодам Global Constraints. `obj −1`: `key 0…6` → `model_.setFx(key, v); applyFx()` (включая `spread` 5). `obj 0…3`, слот жив: `key 3` → `r = 0.03 + 0.57·v`, `key 6` → `sp = 0.6·v`, `key 7` → `lvl = v` (через `model_.set(obj, key, …)`), затем `sendT(obj, true, false)`. Всё прочее — пропуск: ключи `0, 1, 2, 4, 5` у странника, мёртвый слот, `obj ≥ VMAX`, `obj < −1`, `n < 2`.

- [ ] **Step 1: тесты** (образец — `horoLfo` / `horoLfoIgnores`; `t2d_app_init(48000, 7, 1e9, 1u << 12)`, зеркало после `t2d_app_render` 128, `t2d_app_mirror(12, m, 80) == 65`):
  - `arcLfo`: `ADD` слот 0 `[0.1, 0.2]`; затем `(−1,[0,0.7])` → `m[0] == 0.7`; `(−1,[3,0.25])` → `m[3] == 0.25`; `(−1,[5,0.9])` → `m[5] == 0.9` (spread); `(−1,[6,0.2])` → `m[6] == 0.2`; `(0,[3,0.5])` → `m[9+4] == 0.315`; `(0,[6,0.5])` → `m[9+7] == 0.3`; `(0,[7,0.5])` → `m[9+8] == 0.5` (±1e-9).
  - `arcLfoIgnores`: тот же `ADD`, затем `(0,[0..2,4,5 по очереди, 0.5])`, `(1,[3,0.5])` (мёртвый слот), `(4,[3,0.5])`, `(−2,[3,0.5])`, `(0,[3])` (`n = 1`) — зеркало побайтно как без них (65 чисел).
  - `lfoForeign`: в список слотов `{1, 2}` добавить `12`, посылаемая тройка `(0, [0, 0.5])` (ключ `u` у странника — пропуск) — энергия выхода та же.
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` — новые тесты падают.
- [ ] **Step 3: реализация** по образцу `core/worlds/horologium/world.cpp:29-35` и `firmamentum/world.cpp:43-55`; формулы те же, что `get / set` плашки (`view.js:89-90`).
- [ ] **Step 4:** `core/build.sh && core/build/sdk-test` → `0 failed`; `node --test tools/test-arcadia-core.mjs tools/models/arcadia.test.mjs` — зелёные.
- [ ] **Step 5:** коммит `core: ACT_LFO rows and wanderer keys for Arcadia` вместе с `t2d.wasm`.

### Task 2: Ядро — картина страны из ядра (`Pic`, `routeOf`, мост)

**Files:**
- Modify: `core/worlds/arcadia/land.hpp` / `land.cpp` (`Pic`, таблицы имён, `LandGen::start(seed, out, Pic* pic = nullptr)`, `routeOf`; `RMAX_PTS` переезжает из `model.hpp` в `land.hpp`; `LMAX / RMAX / PMAX` — в видимые константы), `model.hpp` / `model.cpp` (`Model::route` вызывает `routeOf`), `core/app/t2d_app.h` / `t2d_app.cpp` (три функции моста), `t2d.wasm`
- Test: `core/tests/sdk_test.cpp`

**Interfaces:**
- Produces (`land.hpp`): `extern const char* const MONTES[8], LACUS[4], FLUMINA[6]` (строки из `model.js:12-14`); `struct Pic { struct Peak {double u, v, h; int name;}; struct Lake {double u, v, w, level; bool pond; int name;}; struct River {int name, n; double pts[PMAX][2];}; int np, nl, nr; Peak peaks[8]; Lake lakes[LMAX]; River rivers[RMAX]; }` (`name` — индекс в таблице, `−1` — без имени); `int routeOf(const float* z, const float* lake, double u, double v, double mode, double* out)` — число чисел в `out` (пары `u, v`, как `Trav.n`), `0` при `!(mode >= 3)`; `out` вмещает `RMAX_PTS = 182`.
- Produces (`t2d_app.h`, ABI Swift; в `core/bridge/api.cpp` ничего не добавляется): `int t2d_app_arc_pic(unsigned seed, float* z, float* lake, double* meta, int cap)`, `const char* t2d_app_arc_name(int kind, int idx)` (`0 горы, 1 озёра, 2 реки`; вне диапазона и `−1` — `nullptr`), `int t2d_app_arc_route(const float* z, const float* lake, double u, double v, int mode, double* out, int cap)` (`cap < 182` — 0). `meta` (doubles): `np, nl, nr`, затем `np × (u, v, h, имя)`, `nl × (u, v, w, level, pond 0/1, имя)`, на реку `(n, имя, n × (u, v))`; возврат — длина `meta`, `cap` мал — 0; `z / lake` — по 12800 float. Страна строится в своей `Land` и `Pic` на куче, без общего состояния с аудио.

- [ ] **Step 1: тесты** (`sdk_test.cpp`, рядом с Arcadia-блоком):
  - `arcPicSame`: зёрна `SEED0, 1, 4242`: `z / lake` из `t2d_app_arc_pic` побайтно равны `LandGen` без `Pic` (`Land` + `run()`); возврат > 0; `cap = 10` → 0.
  - `arcPicMeta`: `SEED0` → `np ≥ 1`, `nl ≥ 2`, `nr ≥ 2`; у всех `np ≤ 8`, `h` не возрастает, попарно `dist > 0.25`, имена первых трёх вершин ≥ 0, остальных `−1`; `pond` без имён; имена основных озёр `(seed + k) % 4`, вершин `(seed + 5k) % 8`; все `u, v` в `[−1, 1]`; озёра с `level` из `lake(k)`.
  - `arcPicRiverName`: зёрна `82` и `98` (имя реки идёт от номера цикла `k`, а не от места в массиве; JS-эталон: `82 → Alpheus`, `98 → Erymanthus`) — имя реки в `meta` совпадает с `FLUMINA[(seed + 3k) % 6]` для её `k` (уцелевшая река `82` — `k = 1`); `t2d_app_arc_name(2, idx)` отдаёт эти строки.
  - `arcName`: `(0,0) == "Cyllene"`, `(1,3) == "Lacus Clitorius"`, `(2,5) == "Erymanthus"`, `(0,8)`, `(3,0)`, `(1,−1)` — `nullptr`.
  - `arcRouteSame`: на `SEED0` и сетке домов (`u` ∈ `−0.8, 0, 0.8`, `v` ∈ `−0.5, 0.3`, `mode 3` и `4`) `t2d_app_arc_route` по `z / lake` из `t2d_app_arc_pic` равен `Model::route` (`World` с `ADD` и зеркалом пути не отдаёт — взять `Model` напрямую: `Scale`, `reset()`, `add`, `route(slot)`, `t(slot).route / .n`), `mode 0…2` → 0, `cap 100` → 0.
  - звук не менялся: `node --test tools/test-arcadia-core.mjs` зелёный (то же `1e-6`).
- [ ] **Step 2:** `core/build.sh && core/build/sdk-test` — тесты падают (функций нет).
- [ ] **Step 3: реализация.**
  - `Pic*` в `LandGen` (поле `pic_`, `start` его запоминает; при `nullptr` — ни одной лишней операции). Заполнение — в `norm()` после нормировки, по готовым `lakes_` (`level` уже поставлен `lake(k)`), `pts_` и номерам циклов: в `trace()` рядом с `np_[nr_]` писать `rk_[nr_] = k`.
  - **Подводные камни** (спека, решение 5): (а) имена — арифметика от зерна и **`uint64`** (`seed + k·5`, `seed + k·3`), `rng` не тратят; (б) имя реки — по `k`, отброшенные (`n ≤ 12`) реки `k` не сдвигают; (в) пруды (`pond`) — после основных озёр, `name −1`; (г) вершины — скан готовой `z` (`float` в `double`), `j, i ∈ 1…GY−2 / 1…GX−2`, порог `h < 0.4` — пропуск, локальный максимум по 8 соседям (`>`, не `≥`), порядок скана как в JS, `std::stable_sort` по убыванию `h`, оставляем с `dist > 0.25` ко всем уже оставленным (`jsHypot`-`dist`), не больше 8; имя только у первых трёх.
  - `routeOf` — вынос тела `Model::route` (`model.cpp:52-70`) без изменения порядка операций; `Model::route` = `t.n = routeOf(cur_->z, cur_->lake, k[U], k[V], k[MODE], t.route)`.
  - Мост — по описанию Interfaces; `cap` проверять до записи.
- [ ] **Step 4:** `core/build.sh && core/build/sdk-test` → `0 failed`; `node --test tools/test-arcadia-core.mjs tools/models/arcadia.test.mjs` — зелёные.
- [ ] **Step 5:** коммит `core: Arcadia land picture for native — Pic, routeOf, t2d_app_arc_*` вместе с `t2d.wasm`.

### Task 3: Сверка страны ядра с JS-эталоном (фикстура)

**Files:**
- Create: `tools/arcadia-pic-ref.mjs`, `tools/test-arcadia-pic.mjs`, `core/tests/data/arcadia-pic.json`
- Modify: `core/tests/sdk_test.cpp` (тест `arcPicFixture`)

**Interfaces:**
- Produces: `export function build(): object` в `tools/arcadia-pic-ref.mjs`; запуск `node tools/arcadia-pic-ref.mjs` пишет `core/tests/data/arcadia-pic.json`. Формат: `{ "seeds": [ { "seed", "zHash", "lakeHash", "peaks": [{u, v, h, name}], "lakes": [{u, v, w, level, pond, name}], "rivers": [{name, pts: [[u, v], …]}], "routes": [{u, v, mode, pts: [u, v, …]}] } ] }`; имя — строка, `""` без имени; хеш — FNV-1a 32 по байтам float32 (little-endian), число.
- Consumes: `genLand`, `createModel` из `worlds/arcadia/model.js` (`createModel().newLand(seed)` + `routeOf({u, v, mode})`).

- [ ] **Step 1: фикстура и сверки.** Зёрна: `SEED0, 1, 4242, 777, 2147483000, 31337, 82, 98` (последние два — имя реки по `k`). Маршруты: `u` ∈ `−0.8, −0.4, 0, 0.4, 0.8` × `v` ∈ `−0.8, −0.3, 0.2, 0.7` × `mode` 3 и 4 (по эталонному `routeOf`). `tools/test-arcadia-pic.mjs` (`node:test`): `build()` пересчитывается и сравнивается с файлом через `assert.deepEqual` — устаревший файл или правка `genLand` ломают тест; плюс `genLand` озёра `LACUS[(seed + k) % 4]` у основных, пруды без имени.
- [ ] **Step 2:** `node tools/arcadia-pic-ref.mjs`; `node --test tools/test-arcadia-pic.mjs` — зелёный. `arcPicFixture` в `sdk_test.cpp` (файл читать из корня репозитория, `sdk/json.hpp`, путь `core/tests/data/arcadia-pic.json`; нет файла — `CHECK(false)`): по каждому зерну `t2d_app_arc_pic` → хеши, числа вершин / озёр / рек, `u, v, h, w, level` с допуском `1e-12`, `pond` и имена (через `t2d_app_arc_name`) точно, точки рек, `t2d_app_arc_route` по `z / lake` из `pic` против `routes` (число чисел точно, значения `1e-12`).
- [ ] **Step 3:** `core/build.sh && core/build/sdk-test` — если `arcPicFixture` красный, чинить реализацию из задачи 2 (не фикстуру) по расхождению; `0 failed`.
- [ ] **Step 4:** `node --test tools/test-models.mjs tools/models/*.test.mjs tools/test-arcadia-pic.mjs` — зелёные.
- [ ] **Step 5:** коммит `tools: Arcadia land fixture from genLand, core cross-check` (при правке ядра — вместе с `t2d.wasm`).

### Task 4: Swift, чистый слой — константы, геометрия, зеркало, страна

**Files:**
- Create: `ios/app/T2D/Arcadia/ArcMath.swift`, `ArcGeo.swift`, `ArcMirror.swift`, `ArcPic.swift`
- Modify: `ios/app/project.yml:60` (источники `T2DTests` + `T2D/Arcadia`)
- Test: `ios/app/T2DTests/ArcMathTests.swift`

**Interfaces:**
- Produces: `enum Arc` — `gx = 80, gy = 160, asp = 3.2, vmax = 4, k = 2.4, q1`, `seed0: UInt32 = 20261021`, `tKeys`, `figs`, `paths`, `waterRGB`; `static func bil(_ a: [Float], _ u: Double, _ v: Double) -> Double` (как `model.js:21-24`, прижим `GX − 1.001`), `dist(_:_:_:_:) -> Double` (`hypot(du, dv·ASP)`), `figPt(_ fig: Int, _ a: Double) -> (Double, Double)`, `depthOf(_ v: Double) -> Double`, `noteName(_ f: Double) -> String` (`view.js:10`: `m = round(12·log2(f/55))`, JS-`round` — половина вверх, `NOTES` от `A`).
- Produces: `struct ArcGeo` — `init(W:H:topY:safeBot:)` по `view.js:12-19` (`top = topY + 6`, `bot = H − safeBot − 8`, `Ws`, `cx`, `fx0, fx1`, `Wh`, `hor`, `gb`, `EL`, `sun: (x, y, r)`); `func proj(_ u: Double, _ v: Double) -> (x: CGFloat, y: CGFloat, s: CGFloat)`, `unproj(_ x: CGFloat, _ y: CGFloat) -> (u: Double, v: Double)`, `at(_ zAt: (Double, Double) -> Double, _ u: Double, _ v: Double) -> CGPoint`, `pick(_ zAt: …, _ x: CGFloat, _ y: CGFloat) -> (u: Double, v: Double)?` (300 шагов, `nil` — небо), `loopPts(_ zAt: …, fig: Int, u: Double, v: Double, r: Double, n: Int, into buf: inout [CGPoint]) -> Int` (пишет в предвыделенный буфер, возвращает `n + 1`; центр `u, v` и радиус `r` — из зеркала). `zAt` — хранимое замыкание, не создаётся в кадре.
- Produces: `struct ArcSlot { var on: Bool; var u, v, oct, r, fig, mode, sp, lvl, f, cx, cy, rs, gain: Double }`; `struct ArcMirror` — `fx: [Double]` (7), `seed: UInt32`, `pending: Bool`, `slots: [ArcSlot]` (4); `init()` (всё нули, `fx` — умолчания веба `relief 0.3, pace 0.35, wind 0, chorus 0.35, phaser 0, spread 0.6, hall 0.4`) и `init?(_ b: [Double], n: Int)` → `nil` при `n < 65`.
- Produces (`ArcPic.swift`): `final class ArcPic` — `seed: UInt32`, `z: [Float]`, `lake: [Float]`, `peaks: [(u, v, h: Double, name: String?)]`, `lakes: [(u, v, w, level: Double, pond: Bool, name: String?)]`, `rivers: [(name: String?, pts: [(Double, Double)])]`; `func zAt(_ u: Double, _ v: Double) -> Double`, `lakeAt(...)`; `typealias Builder = (UInt32) -> ArcPic?`; `static let core: Builder` (вызов `t2d_app_arc_pic`, `cap` 1400, имена — `t2d_app_arc_name`); `typealias Router = (ArcPic, Double, Double, Int) -> [Double]`; `static let coreRoute: Router`; `final class ArcPicLoader { init(build: @escaping Builder = ArcPic.core, queue: DispatchQueue? = DispatchQueue.global(qos: .userInitiated)); func load(seed: UInt32, done: @escaping (ArcPic) -> Void) }` — `queue == nil` строит синхронно (тесты), иначе в фоне, `done` — в главном потоке.

- [ ] **Step 1: тесты** (`ArcMathTests`; геометрия `ArcGeo(390, 844, 59, 34)`, ±0.01):
  - `testGeo`: `top 65, bot 802, cx 195, fx0 7, fx1 383, Wh 178, hor 190.29, gb 762, EL 80.04, sun (390, 61, 42)`; `proj(0, −1) == (195, 762, 1)`, `proj(0, 1) == (195, 190.29, 0.2941)`, `proj(0.5, 0) == (284, 320.22, 0.4545)`, `proj(−1, 0.5) == (17, 241.34, 0.3571)`; `unproj(284, 500)` → `u 0.5, v −0.6015` (±1e-3), обратимость `unproj(proj(u, v))` для сетки `u ∈ ±0.7`, `v ∈ −0.9…0.9` (±1e-9); `pick` на плоской земле (`zAt = 0`) `(195, 500)` → `u 0, v −0.6`, `(195, 100)` → `nil`; `at` с `zAt = 0.5` на `EL·s·0.5` выше `proj`.
  - `testLoopPts`: `fig 0, r 0.2` → 49 точек, замкнута (первая == последняя ±1e-9), на плоской земле эллипс в `proj`; буфер не растёт; `fig 1` и `2` — другая форма (`figPt(1, π/2) == (1, 0)`, `figPt(2, 0.3)` по `model.js:122`).
  - `testBilDepthNote`: `bil` на `z = [Float](repeating: 0.5)` → 0.5 на краях и в центре; `depthOf(−1) == 0`, `depthOf(1) == 1` (±1e-12); `noteName`: `55 → "A1"`, `110 → "A2"`, `220 → "A3"`, `440 → "A4"`, `65.41 → "C2"`, `82.41 → "E2"`, `27.5 → "A0"`, `233.08 → "A#3"`.
  - `testMirrorParse` (65 чисел → поля слота 2 из `9 + 28…41`; 64 → `nil`; нули → пустое зеркало, умолчания `fx`).
  - `testPicBridge`: `ArcPicLoader(queue: nil).load(seed: Arc.seed0)` → `z.count == 12800`, `peaks.count ≥ 1`, `lakes.count ≥ 2`, `rivers.count ≥ 2`, имена непустые у первых трёх вершин, основных озёр и рек; `Router` на `SEED0` `(0.1, 0.5, mode 3)` → непустой массив чётной длины, `[0] == 0.1`; `mode 1` → пусто.
- [ ] **Step 2:** `xcodegen` + тесты падают (типов нет).
- [ ] **Step 3: реализация** по `model.js` / `view.js` (строки в Interfaces); `ArcPic.core` — единственное место, где Swift зовёт `t2d_app_arc_*`.
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** коммит `ios/app: Arcadia math, geometry, mirror, land picture`.

### Task 5: Swift, `ArcState` — слоты, ожидание, свои значения, след

**Files:**
- Create: `ios/app/T2D/Arcadia/ArcState.swift`
- Test: `ios/app/T2DTests/ArcStateTests.swift`

**Interfaces:**
- Consumes: `ArcMirror`, `ArcSlot` (задача 4).
- Produces: `struct ArcState` (чистый, без `Core`; время приходит параметром) — `static let ttl = 0.25, trailEvery = 0.12, trailMax = 40`; `private(set) var order: [Int]` (порядок добавления: живые — в зеркале `on` или ожидают `ADD`); `func isAlive(_ s: Int) -> Bool`; `mutating func add(u: Double, v: Double, mirror: ArcMirror, now: Double) -> Int?` (первый слот `0…3`, не живой логически, без ожидающего `ADD`, свободный в зеркале **или** с ожидающим `DROP`; `nil` — мест нет; ставит ожидание `ADD(u, v)` и дописывает в `order`); `mutating func addFailed(_ s: Int)` (`Core.action == false`: слот освобождён, из `order` убран); `mutating func drop(_ s: Int, now: Double)` (ожидание `DROP`, слот сразу не живой); `mutating func dropAll(now: Double) -> [Int]` (все живые по `order`, возвращает их); `mutating func setOwn(_ s: Int, key: Int, _ v: Double, now: Double)` (`key` — индекс `T_KEYS`; `u / v` обновляют и цель ожидающего `ADD`); `mutating func setOwnFx(_ i: Int, _ v: Double, now: Double)`; `func value(_ s: Int, key: Int, mirror: ArcMirror) -> Double` и `func fx(_ i: Int, mirror: ArcMirror) -> Double` (своё, пока не снято, иначе зеркало); `mutating func sync(_ m: ArcMirror, now: Double) -> [Int]` (снимает ожидания и свои значения; возвращает слоты, пропавшие без нашего `DROP`, по возрастанию); `mutating func reset()` (`restored()`: `order`, ожидания, свои значения, следы очищены); `mutating func tickTrail(dt: Double, mirror: ArcMirror)`, `trailCount(_ s: Int) -> Int`, `trailPoint(_ s: Int, _ k: Int) -> (u: Double, v: Double)` (`k = 0` — старейшая), `mutating func clearTrail(_ s: Int)`. Следы — кольцевые буферы на слот, выделены в `init`.
- Правила `sync` (спека, решение 7): ожидание `ADD` снимается, когда зеркало показало `on` **и** `u, v` цели (`|Δ| < 1e-9`), или через `ttl` (слот не `on` — убирается из `order`); ожидание `DROP` — когда зеркало `off`, или через `ttl`; слот `on` в зеркале, которого нет в `order` и нет ожидания, дописывается по возрастанию слота (отмена, `restore` ядра `world.cpp:88`); слот в `order` без ожидания, которого нет в зеркале, убирается и возвращается; свои значения (слот и fx) снимаются при `|Δ| < 1e-9` с зеркалом или через `ttl` после последнего `setOwn`.
- След (`model.js:200-205`): `tickTrail` копит время (`min(dt, 0.1)`), раз в `trailEvery` (по `time − trailAt > 0.12`) каждому живому слоту с `mode == 2` (через `value`) и `on` в зеркале дописывает `(cx, cy)` (кольцо ≤ 40); `mode ≠ 2` — буфер пуст.

- [ ] **Step 1: тесты** (`ArcStateTests`, зеркала — вспомогательная `mirror(on: [Int], …)`):
  - `testAddPicksFirstFree`: два `add` подряд (одно зеркало, без ответа) → слоты 0 и 1, `order == [0, 1]`; пятый при 4 живых → `nil`.
  - `testReusedSlotAfterClear` (RF2): три `add`, зеркало их показало; `dropAll` → `[0, 1, 2]`; сразу `add` ×2 → слоты 0 и 1 (не 3); `sync` по устаревшему зеркалу (все три `on`, старые `u, v`) → слоты 0 и 1 живы, ничего не `gone`; зеркало с новыми `u, v` у 0, 1 и `off` у 2 → ожидания сняты.
  - `testAddFailedFreesSlot`: `add` → 0, `addFailed(0)` → `order` пуст, следующий `add` → 0.
  - `testPendingTimeout`: `add` без ответа, `sync(пустое, now + 0.3)` → слот свободен, возвращён в `gone`; `drop` без ответа (зеркало всё ещё `on`) → через 0.3 с слот снова в `order` (дописан по возрастанию).
  - `testRestoreOrder`: зеркало показало `on` у слотов 3 и 1, которых не добавлял Swift → `order == [1, 3]`; `gone` у слота, исчезнувшего из зеркала без `drop`.
  - `testOwnValues`: `setOwn(0, key 0, 0.4)` — `value == 0.4`, пока зеркало 0.1 (при `now` +0.1); зеркало сошлось (0.4) → своё снято; другой случай — через 0.3 с без сходимости зеркало берёт верх; `setOwn(u/v)` у ожидающего `ADD` меняет цель; `setOwnFx(6, 0.7)` аналогично.
  - `testTrail`: зеркало с `mode 2`, `tickTrail(dt: 0.1)` ×20 → `trailCount == 10` (метка — на каждом втором тике: `time − trailAt > 0.12`, на 0.2, 0.4, …), `trailPoint(0)` — `(cx, cy)` первой метки; ×100 тиков → ровно 40, старейшая вытеснена; `mode 1` → пуст; `clearTrail` → пуст; один `tickTrail(dt: 5)` считается как 0.1 (метка не ставится: 0.1 ≤ 0.12).
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3: реализация** — чистая структура, массивы фиксированной длины на слот.
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** коммит `ios/app: Arcadia state — slots, pending, own values, trail`.

### Task 6: Arcadia — касания, тик, кубик, корзина, отмена

**Files:**
- Create: `ios/app/T2D/Arcadia/ArcadiaView.swift`; заглушки `ArcSheets.swift` (`extension ArcadiaView { var fxSpec: SheetSpec; func viatorSpec(_ slot: Int) -> SheetSpec }` — пустые `SheetSpec`, заменяются в задаче 7) и `ArcDraw.swift` (`extension ArcadiaView { func drawFrame(_ d: Draw, now: Double, shot: Bool) {} }`, заполняется в задачах 8–9)
- Test: `ios/app/T2DTests/ArcadiaTests.swift` (образец — `HorologiumTests.swift`: фейковое ядро `Rec`, зеркало и `ArcPicLoader(queue: nil)` с подменённым `Builder`)

**Interfaces:**
- Consumes: всё из задач 4–5; коды Global Constraints.
- Produces: `final class ArcadiaView: World` — `static let slotN = 12`; `enum Act { static let add = 0, drop = 1, move = 2, set = 3, fx = 4, land = 5, clear = 6 }`; `init(core: Core, readMirror: Reader? = nil, rng: (() -> Double)? = nil, loader: ArcPicLoader? = nil, router: ArcPic.Router? = nil)` (`Reader = (inout [Double]) -> Int`, буфер ≥ 80; по умолчанию `t2d_app_mirror(12, …)`, `SystemRandomNumberGenerator`, `ArcPicLoader()`, `ArcPic.coreRoute`); `title "Arcadia"`, `sub "montes · lacus · flumina"`; `legend` — 7 строк `view.js:279-281` (`tap, up, drag, tap, hold, tap, tap`; тексты дословно); `var geo: ArcGeo`; `private(set) var mirror: ArcMirror`; `private(set) var state: ArcState`; `private(set) var pic: ArcPic?`; `private(set) var holds`; `func value(_ slot: Int, key: Int) -> Double` и `fxValue(_ i: Int) -> Double` (из `state` + зеркало); `func holdShot(_ slot: Int, rim: Bool)` (тестовый хук: подпись ноты / края без пальца, как `host.shotSheet`); `func scale(pcs: [Int]?, root: Int)` — хранит для стены; `func dice()`, `clear()`, `restored()`, `cornerHit`, `layout`, `tick`, `idle`, `down / move / up / cancel`; `objGone`, `openSheet`, `rowLfoOff` — хостовые замыкания.
- Поведение: `tick(now, dt)` — читает зеркало, `state.sync` (пропавшие → `objGone`, следы, плашка закрывается хостом), `tickTrail`, удержания → плашка `viatorSpec(slot)`; зерно зеркала сменилось (и не ждём своё `LAND`) → `loader.load(seed)`; `pic` — подставляется по готовности, `zAt`-замыкание хранится. Касания — спека, решение 8 (порядок `down`: край → флажок → земля; `Finger.id`; подпись `held` по слоту, последний палец побеждает; при тяге — `state.setOwn`, `state.clearTrail` на `MOVE`). `clear()` — `DROP` каждого живого по `order` + `objGone`. `dice()` — спека, решение 10 (порядок вызовов ГСЧ тот же, что `model.js:206-216`): зерно → `loader.load`, по готовности в главном потоке (счётчик поколений — устаревшее отброшено): `CLEAR`, `LAND seed`, `state.dropAll` (+ `objGone` каждому), `ADD` n раз через `state.add` (`lake(u, v) < 0.2` — по **новой** `pic`). `restored()` — спека, решение 11.

- [ ] **Step 1: тесты** (`ArcadiaTests`; геометрия `ArcGeo(390, 844, 59, 34)`, плоская страна, пока не подставлена `pic`; кадр зеркала — вспомогательная `setMirror(slots: [...], seed:, now:)` и `tick`):
  - зеркало и слоты: `testDownLandAdds` (тап по земле → `ADD 0, i 0, [u, v, 0, 0.16, 0, 2, 0.22, 0.8]`, `v` зажат в `±0.98`; палец сразу `home` и `fresh`, тап подъёмом не убирает); `testTouchBeforePic` (RF4: `pic == nil`, тап → `ADD`, без падения); `testSkyTap` (RF4: `y < hor` — нет действий); `testNoFreeSlot` (RF4: 4 живых → пятый палец `none`, действий нет).
  - флажок: `testHomeMove` (сдвиг > 8 px → `MOVE i, [u, v]` по `pick(clamp(x, fx0, fx1), max(y, hor − 30))` или `unproj(x, hor)`; свои `u, v` — без отставания); `testHomeTapDrops` (< 300 мс без сдвига, не `fresh`, плашка не открыта → `DROP`; `objGone(slot)`); `testHomeHoldSheet` (удержание 420 мс без сдвига → `openSheet` с `title "viator"`; `up` — без `DROP`).
  - край: `testRimDrag` (палец на точке петли, `hd > 12` → `SET i, [3, r', 0]`, `r' = clamp(dist(центр из зеркала cx/cy, unproj), 0.03, 0.6)`; прямо во флажок — флажок важнее; `r < 0.06` — край пропущен).
  - `testTwoFingersHomeAndAdd` (RF1): один палец держит флажок слота 0 (сдвиг → `MOVE 0`), второй тапает землю → `ADD` в слот 1; оба `up` без лишнего `DROP`; подпись `held` — по слоту, последний палец побеждает.
  - `testPendingSlotsSameFrame`: два тапа по земле в одном кадре (без ответа зеркала) → слоты 0 и 1; `Rec` с `action == false` на `ADD` → слот не занят.
  - след: `testTrailTicks` (`mode 2` в зеркале, `tick` ×… → `state.trailCount` растёт раз в 0.12 с; `MOVE` касанием обнуляет).
  - угол и легенда: `testCornerHit` (`(W − 10, 61 + 10)` — да; `(W − 10, 50)` — нет, выше солнца; радиус `sun.r + 12`); `testLegend` (7 строк дословно `view.js:279-281`).
  - кубик: `testDiceOrder` (ГСЧ по зерну: порядок `seed`, `n`, затем на странника до 20 попыток точки вне озера **новой** страны, затем `r, fig, mode, sp, oct`; одна `CLEAR`, одна `LAND seed`, `n` `ADD` в слоты `0…n−1`; `objGone` для живых до кубика); `testDiceStaleDiscarded` (RF2: два `dice()` подряд с отложенным загрузчиком — применяется только второй результат); `testDiceAfterClear` (`clear()` и сразу `dice()` в одном кадре → слоты `0…n−1`, конфликтов нет).
  - `testClear` (`DROP` каждого по `order` и `objGone`); `testRestoredResets` (RF3: пальцы на флажке, плашка открыта; `restored()` → `objGone` всех 4 слотов, `holds` пуст, следы пусты, ожидания и свои значения очищены; последующий `up` — без действий; зеркало с `on` у слотов → странники по возрастанию).
- [ ] **Step 2:** тесты падают (типа нет).
- [ ] **Step 3: реализация** по `view.js:41-96`, спеке (решения 7, 8, 10, 11, 12) и образцу `HorologiumView.swift`: `Hold` с видом `home / rim / none`, часы тика для удержаний, метки касаний для тапов; в кадре тика ни одного `Array` на странника.
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** коммит `ios/app: Arcadia touches, tick, dice, undo`.

### Task 7: Arcadia — плашка `viator` и веер FX

**Files:**
- Modify: `ios/app/T2D/Arcadia/ArcSheets.swift` (заменить заглушки задачи 6)
- Test: `ios/app/T2DTests/ArcadiaTests.swift`

**Interfaces:**
- Consumes: `ArcadiaView.value(_:key:)`, `fxValue(_:)`, `state`, `core` (задача 6).
- Produces: `extension ArcadiaView` — `var fxSpec: SheetSpec` (веер `aether`: заголовок `aether`, hint `FX — tap outside to close`; секторы `relief 190°, pace 160°, wind 140°, chorus 120°, phaser 100°, hall 80°` (порядок и углы — `view.js:272`, где их читает рисование веера хоста; в `SheetSpec` — строки с кодами `0, 1, 2, 3, 4, 6`), `arc: fxValue(6)`, `lfo: SheetLfo(obj −1, keys всех шести, shape 1)`); `func viatorSpec(_ slot: Int) -> SheetSpec` (`title "viator"`, hint `wanderer — tap outside to close`, строки `octave, orbit, figure, path, range, level` с ключами `oct, r, fig, mode, sp, lvl` и кодами `−1, 3, −1, −1, 6, 7`; `lfo: SheetLfo(obj: slot, keys {r, sp, lvl}, shape 1)`; `obj: slot`). `get` / `set` / `text` — спека, решение 9; чтение — `value(slot, key:)` (свои значения), запись — `Core.action(Act.set, slot, [key, v, route])` (`route 1` только для `mode`) и `state.setOwn`; веер — `Core.action(Act.fx, idx, [v])` (`idx` — индекс Fx: `hall` — 6) и `state.setOwnFx`.

- [ ] **Step 1: тесты:**
  - `testViatorRows`: коды `[−1, 3, −1, −1, 6, 7]`, подписи `octave / orbit / figure / path / range / level`, `lfo.obj == slot`, `keys == {r, sp, lvl}`, `shape == 1`, `obj == slot`.
  - `testViatorGetSet` (круг `set → get` на значениях зеркала по всем шести ключам): `get`: `oct −1 → 0`, `0 → 0.5`; `r 0.315 → 0.5`; `fig 2 → 1`; `mode 4 → 1`; `sp 0.3 → 0.5`; `lvl 0.8 → 0.8`; `set("oct", 0.5)` → `SET [2, 0, 0]`, `set("oct", 0)` → `[2, −1, 0]`; `set("r", 0.5)` → `[3, 0.315, 0]`; `set("fig", 0.5)` → `[4, 1, 0]`; `set("mode", 0.75)` → `[5, 3, 1]` (`route 1`); `set("sp", 0.5)` → `[6, 0.3, 0]`; `set("lvl", 0.4)` → `[7, 0.4, 0]`.
  - `testViatorText`: `octave −1 / octave 0 / octave +1`; `circle / eight / knot`; `still / circuit / wander / river / summit`; `r 0.315 → "32%"` (JS-round), `sp 0.3 → "50%"`, `lvl 0.8 → "80%"`.
  - `testViatorOwnValues` (RF5): `set("r", 0.5)` → `get("r") == 0.5` сразу, пока зеркало ещё старое; зеркало сошлось (или прошло 0.25 с) — зеркало берёт верх.
  - `testViatorDeadSlot` (RF5): слот не живой в `state` → `set` действий не шлёт; плашка открыта, слот пропал из зеркала → `objGone(slot)` вызван.
  - `testFanSheet`: заголовок `aether`; коды `0, 1, 2, 3, 4, 6`; `lfo.obj −1`, форма random; `arc` = `fx[6]` (0.4 по умолчанию); тексты: `pace 0.35` → `"N s"` по `1/(0.01·40^0.35)` (целое: `28 s`), `wind 0` → `calm`, `wind 0.4` → `40%`, `chorus 0` → `off`, `phaser 0.005` → `off`, `chorus 0.35` → `35%`, `relief 0.3` → `30%`, `hall 0.4` → `40%`; `set("hall", 0.7)` → `FX i 6, [0.7]`; `set("pace", 0.2)` → `FX i 1, [0.2]`; `spread` в веере строки не имеет, `fxValue(5)` читает зеркало (0.6).
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3: реализация** по `view.js:84-93, 272-278` и образцу `HoroSheets.swift`.
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** коммит `ios/app: Arcadia viator sheet and FX fan`.

### Task 8: Arcadia — стена (кеш `CGImage` в фоне)

**Files:**
- Create: `ios/app/T2D/Arcadia/ArcWall.swift`
- Test: `ios/app/T2DTests/ArcWallTests.swift`

**Interfaces:**
- Consumes: `ArcGeo`, `ArcPic`, `Draw` (шрифты и рисование строк через тот же `Draw`, что у `HoroDraw`), тема мира.
- Produces: `struct ArcWallKey: Equatable` — `W, H, dpr, hor, gb, Wh, seed, pcs: [Int]?, root` (`view.js:137`; размеры — как числа веба, `Double`); `struct ArcLcg { init(seed: Int); mutating func next() -> Double }` (`s = s·16807 % 2147483647` в `Int64`, значение `s / 2147483647`; стена — `seed % 2147483646 + 1`, хребты — начало `5`); `final class ArcWall { private(set) var builds: Int; var image: CGImage? { get }; func request(_ key: ArcWallKey, geo: ArcGeo, pic: ArcPic, build: DispatchQueue? = global(.userInitiated)) }` — старый образ остаётся, пока новый не готов; `build == nil` — синхронно (тесты); результат подставляется в главном потоке; повторный `request` с тем же ключом — нет работы; новый ключ при незавершённой постройке отбрасывает прежнюю (поколение).
- Содержимое — 1:1 `view.js:136-233` (спека, решение 13): крап (260), облака, дальние хребты (`rs = 5`), борозды, штриховка озёр, берег по экранной сетке (`SC 3`, дважды: `0.5` и `0.15`), реки, ряды значков рельефа (`mountain / hill / tree / tuft`, функции `view.js:100-135`, `forest :134`; порядок вызовов `rnd()` как в JS), имена без наложений (`mapText` курсив 10.5), рамка Таро, горизонт, подпись «A R C A D I A» (прямым 15), деления лада по левой рамке (`on = !pcs || pcs.contains((k + root) % 12)`, длина 6 / 3, яркость 0.6 / 0.25), заливка бумагой до первого образа — в `draw` (задача 9).

- [ ] **Step 1: тесты:**
  - `testLcg`: `ArcLcg(seed: 4242 % 2147483646 + 1)` — первые три значения `0.033207284767742866, 0.1148350914543658, 0.03338207352598294` (±1e-15; эталон — формула `view.js:137`, посчитана в Node).
  - `testWallKey`: смена `W`, `hor`, `seed`, `pcs` (`nil` ↔ `[0, 2, 4, 5, 7, 9, 11]`), `root` — другой ключ; тот же — равный.
  - `testWallCached`: синхронный `request` ×2 с одним ключом → `builds == 1`; со сменой `seed` → 2; смена `pcs` → 3.
  - `testWallBackgroundKeepsOld`: асинхронный `request` нового ключа — `image` остаётся прежним, пока постройка не вернулась; второй `request` с третьим ключом, пока идёт первый, — применяется только последний.
  - `testWallNotBlank`: на `SEED0` (`ArcPicLoader(queue: nil)`), `W 390, H 844`, DPR 1 — размер образа `390×844`, в нём не все пиксели цвета бумаги (есть чернила в зоне `fx0…fx1`, `hor…gb`) и у левой рамки есть засечки лада.
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3: реализация** — перенос функций `view.js:100-233` на `CGContext` (`Draw`), без `shadowBlur` и градиентов; постройка — один проход, никаких кадров.
- [ ] **Step 4:** Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 5:** коммит `ios/app: Arcadia engraved wall cache`.

### Task 9: Arcadia — кадр, регистрация, снимки

**Files:**
- Modify: `ios/app/T2D/Arcadia/ArcDraw.swift` (кадр), `ArcadiaView.swift` (`draw` и `drawShot` → `drawFrame`), `ios/app/T2D/Worlds.swift:29` (слот 12 `view: true`), `ios/app/T2D/App.swift` (`makeView` — ветка `ArcadiaView.slotN`; `@State arc` рядом с `horo`; список сцен в комментарии `:78`; `shotArc` рядом с `shotHoro`), `ios/app/shot.sh` (комментарий со списком сцен), `worlds/arcadia/index.js` (`addT: model.addT` в `t2d.arc`), `tools/shot.py` (`sc_arcadia_fixed`, запись в `SCENARIOS`)
- Test: `ios/app/T2DTests/ArcadiaTests.swift` (рисование)

**Interfaces:**
- Consumes: `ArcadiaView`, `ArcWall`, `ArcGeo`, `ArcState`, `ArcPic` (задачи 4–8); `Draw.mapText`, `Draw.text`, `Draw.quarterSun`, `Draw.ring / dot`.
- Produces: `ArcadiaView.drawFrame(_ d: Draw, now: Double, shot: Bool)` (`shot` — без солнца-угла, `mapShot` веба); `draw` и `drawShot` зовут его; кеш путей на слот с ключом `(seed, u, v, mode)` (пересчёт через `router` при `ADD`, `MOVE`, смене `mode`, новой стране; `mode 1` — эллипс `sp`, `mode 2` — след); предвыделенные буферы петель (120 точек), теней (61), пути на слот; `private(set) var routeCalls: Int` (счётчик вызовов `router`, для теста).

- [ ] **Step 1: тесты:** `testDrawNoCrashEmpty` (зеркала нет, `pic == nil` — кадр рисуется бумагой); `testDrawFourWanderers` (по одному `still / circuit / wander / river / summit` в зеркале, `pic` готова, стена построена синхронно — кадр рисуется, при `held` на слоте — подпись `noteName · Hz` и `orbit N%` / `path · figure`); `testRoutesCached` (`mode 3`: два кадра — `routeCalls == 1`; `MOVE` → 2; смена `mode` на 4 → 3; новая страна → 4); `testDrawShotNoSun`; `testDrawFarFirst` (порядок — по `v` убыв.: порядок вызовов отрисовки слотов записан тестовой подменой счётчика).
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3: реализация** по `view.js:234-268` (`drawT`), спека — решение 13: путь пунктиром (по `mode`), привязь, петля поднята холмами и её тень, сканер (`ph = (now·0.00022·√(f/55)) mod 1`, `f` из зеркала), флажок с волной, подпись при касании, засечка своей ноты на левой шкале; дальние странники раньше, солнце-угол (`quarterSun`) — последним. Регистрация мира и сцены (сид init 7; кадр через 5 с; точки — по зерну `4242`):
  - `arcadia` — `LAND 4242`, затем 4 `ADD` (`still (−0.5, −0.55, mode 0)`, `circuit (0.45, −0.2, mode 1, fig 1, r 0.22)`, `river (0.1, 0.45, mode 3, fig 2, r 0.16)`, `summit (−0.4, 0.25, mode 4, oct −1, sp 0.4)`); пара — веб `arcadia-fixed` (`t2d.arc.newLand(4242)` и `t2d.arc.addT(u, v, {...})` с теми же значениями; в `node --test` не входит);
  - `arcadia-land` — пустая `SEED0`; пара — веб `arcadia-land` (`sc_arcadia`, `tools/shot.py:1524-1562`);
  - `arcadia-held` — один странник (`mode 1`), `holdShot(slot, rim: false)` — подпись `noteName · Hz` и `orbit N%`; пара — веб `arcadia-held`; вариант с краем — `-shot arcadia-held-rim` (`holdShot(slot, rim: true)`, подпись `orbit N%` и засечка), без веб-пары;
  - `arcadia-sheet` — `host.shotSheet(arc.viatorSpec(0))`; `arcadia-fan` — веер с LFO на `wind` (полоса random), `host.shotSheet(arc.fx!, lfoKey: "wind"); host.shotLfo(rate: 1, depth: 0.5)`.
- [ ] **Step 4:** Swift-тесты зелёные; `python3 tools/shot.py arcadia-fixed` (веб; нужен `python3 -m http.server 8765`), `ios/app/shot.sh arcadia` и остальные четыре — **сверяет главный поток агентом `shots`** (субагенты его не зовут): стена (значки, имена, берег, реки, горизонт, рамка), петли, флажки, шкала, плашка и веер (заголовки, подписи строк, тексты значений) как в вебе.
- [ ] **Step 5:** коммит `ios/app: Arcadia drawing, registry, shot scenes` (вместе с `index.js` и `tools/shot.py`).

### Task 10: Доки, выкладка

**Files:**
- Modify: `docs/native-ios-plan.md` (фаза 3: Arcadia сделан, ждёт iPhone), `docs/worlds/arcadia.md` (раздел «Натив»: где код, страна из ядра — не порт `genLand`, слоты и ожидание, кубик в Swift (ГСЧ системный, страна не совпадёт с вебом при том же зерне), LFO странников при отмене не переживают, `semiOf` не портирован), `core/README.md` (`ACT_LFO` Arcadia; `t2d_app_arc_pic / _route / _name`; `LandGen::start(…, Pic*)`; `routeOf`), `docs/testing.md` (сцены `arcadia*` и веб-пары, фикстура `arcadia-pic.json`, `tools/arcadia-pic-ref.mjs`, `tools/test-arcadia-pic.mjs`, тесты `ArcMathTests / ArcStateTests / ArcadiaTests / ArcWallTests`), `docs/tokens.md`, `sw.js` / `index.html` (новый `CACHE` = `?v=` — изменился `t2d.wasm`)

- [ ] **Step 1:** доки по списку, в `docs/worlds/arcadia.md` и спеке — пункт «решено без автора» (Global Constraints); строка `docs/tokens.md` (`python3 tools/tokens.py --line`).
- [ ] **Step 2:** `CACHE` в `sw.js` и `?v=` в `index.html` — следующее число (одно и то же).
- [ ] **Step 3:** итоговая проверка: `core/build.sh && core/build/sdk-test` → `0 failed`; `node --test tools/test-models.mjs tools/models/*.test.mjs tools/test-arcadia-pic.mjs`; `node --test tools/test-arcadia-core.mjs` (отдельно); Swift-тесты → `** TEST SUCCEEDED **`.
- [ ] **Step 4:** коммит `docs: iOS phase 3 Arcadia`; после финального ревью — пуш `native`, `python3 tools/deploy-wait.py` → `success` (только если задача пуша дана явно).

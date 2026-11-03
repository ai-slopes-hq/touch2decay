# iOS фаза 3 — Portus на Swift, план (б): картинка, сцены, карта

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** картинка XIII · Portus на CoreGraphics — кеш стены (звёзды, волны, фарватер, мысы, набережная), луна (и кровавая), вехи, кораблики, буй с кругами, туман, маяк, падающая звезда, подписи; мир включён на карте, сцены `-shot portus*`, снимки против веба, доки, выкладка.

**Architecture:** логика готова в плане (а) (`ios/app/T2D/Portus/`: `PorMath`, `PorMirror`, `PorState`, `PorSheets`, `PorTouch`, `PortusView`; коммиты `4de2545…4881aad`). Здесь — только рисование, построчный перенос `worlds/portus/view.js:140-348` без новых решений: `PorScene` (кеш стены `PorWall`), `PorDraw` (предметы), `PorFrame` (звезда, подписи, `drawFrame`). Кисть и LCG — общие с Natura (`NatPen`, `NatLCG`), кеш-холст и вывод слоя — общие помощники `Draw`. Кадр ничего не меняет: всё состояние (удары, круги, звезда) уже двигает тик плана (а).

**Tech Stack:** Swift 5 + UIKit + CoreGraphics, XCTest, XcodeGen; веб-эталон снимков — `python3 tools/shot.py portus`.

**Spec:** `docs/superpowers/specs/2026-11-03-ios-portus-design.md` — читать целиком (особенно «Решения» 1, 2, 8, 9, 15). План (а): `docs/superpowers/plans/2026-11-03-ios-portus-a.md` — Global Constraints оттуда действуют и здесь. Образец Swift — `ios/app/T2D/Natura/NatScene.swift` (`NatLayers`), `NatFrame.swift` (`drawFrame`, `drawLayer`), `App.swift` (`shotNatura`), тесты `T2DTests/NaturaDrawTests.swift` (помощник `shot`, регистрация шрифтов).

## Global Constraints

- Всё из Global Constraints плана (а) (ветка `native`, коммиты, тесты Swift через test-runner, `project.yml` уже содержит `T2D/Portus`, `Horo.jsRound`, константы). Ядро в плане (б) не трогается — `t2d.wasm` не меняется.
- Перенос построчно: альфы, радиусы, шаги, пунктиры, порядок вызовов — из `view.js`, своих чисел не вводить. Время: `now` Swift — секунды, в формулах веба — `nowMs = now·1000`; времена из `PorState` (`hitT`, `hits.t / dt`, `killAt`, `lastAt`) — секунды, переводить так же.
- Цвета: `INK = 196,208,216` (`theme.ink`), `PAPER = BGC = 6,9,13` (`theme.paper`), `LIGHT = 238,198,126` — свой цвет Portus (`Por.light`), не тема.
- Тексты на поле — только `d.mapText` (курсив IM Fell), размеры и альфы — из `view.js:333-347`; жирного нет.
- Производительность: никакого `shadowBlur`, градиентов нет (ореолы — `d.glowAt`); полноэкранный проход — только вывод стены; в кадре без выделений (`Array`, замыкания, `String` вне подписей у пальца; сортировка корабликов — в предвыделенный буфер); пунктиры — статические массивы; холст стены ≤ 2× (`Draw.scale`).
- **Кадр без состояния.** `draw` и `drawShot` — одно `drawFrame`, ничего не меняют (ни `state`, ни `fingers`). `drawShot` — без луны (`noSun` веба, `view.js:199-205`: путь дорожки рисуется, диск, ореол и кольца — нет).
- Веер-дуга рисует хост по `fan`, мир её не рисует (`view.js:349-355`).

## Review Focus

1. **Ключ стены** — пересборка только при смене `W×H×DPR|hor|qy|Ws|pcs|root`; смена лада пересобирает (засечки ступеней), смена `fog` / `cut` (двигает луну, не `hor`) — нет; две сборки с нуля бит в бит равны (LCG 13, `continue` тоже тратит `rnd`). Тест — задача 1 (`testWallKey`, `testWallSame`).
2. **Кровавая луна и `lfoBase`** — при базе LFO луна стоит на базе, цвет краснеет при `lfo` ниже базы; `lfoBase` вернул `nil` / NaN — обычная луна, не падает. Тест — задача 2 (`testBloodMoonColor`).
3. **Кадр без тика и двойной кадр** — `drawFrame` до первого `tick` (пустое зеркало) не падает; два кадра подряд не меняют `state.hits`, `killAt`, `fingers`. Тест — задача 3 (`testDrawPure`).
4. **Снимок для карты** — `drawShot` без диска луны; `draw` — с диском. Тест — задача 3 (`testShotNoMoon`).
5. **Крайние значения** — fx все 0 и все 1, `fog.amt 0 / 1`, `res 0 / 1`, 16 корабликов, `playing` с шагом 15, удар старше 1.4 с, звезда старше 0.9 с: кадр не падает, кругов и звезды нет. Тест — задача 2 (`testDrawExtremes`), задача 3 (`testStarFades`).

---

### Task 1: Общая кисть и холст; `PorScene` — кеш стены

**Files:**
- Modify: `ios/app/T2D/Natura/NatPen.swift` (два метода цвета, комментарий шапки «кисть Natura и Portus»), `ios/app/T2D/Draw.swift` (два помощника ниже), `ios/app/T2D/Natura/NatScene.swift` и `NatFrame.swift` (на общие помощники вместо своих `canvas` / `drawLayer`), `ios/app/T2D/Portus/PorMath.swift` (`Por.light`)
- Create: `ios/app/T2D/Portus/PorScene.swift`
- Test: `ios/app/T2DTests/PorSceneTests.swift`, помощник `litPixels` — `ios/app/T2DTests/PorTestUtil.swift`

**Interfaces:**
- Consumes: `PorGeo` (`W, H, top, bot, cx, Ws, fx0, fx1, hor, qy`, `P`, `fOf`, `laneC`, `laneHW`, `slotPt`, `cliffH`, `Por.edge`), `PorScale` (`pcs`, `root`), `NatPen`, `NatLCG`.
- Produces:
  - `NatPen`: `func fill(_ c: RGB, _ a: Double)`, `func stroke(_ c: RGB, _ a: Double)` (цвет без темы — `LIGHT`, `BGC`).
  - `Draw`: `static func layer(_ size: CGSize, _ dpr: CGFloat, _ draw: (CGContext) -> Void) -> CGImage?` (перенос `NatLayers.canvas` без изменений) и `func blit(_ img: CGImage?)` (перенос `drawLayer` из `NatFrame.swift:255`). Natura — на них, её тесты зелёные без правок.
  - `Por.light: RGB = (238, 198, 126)`.
  - `final class PorWall { private(set) var builds = 0; private(set) var img: CGImage?; func update(_ G: PorGeo, size: CGSize, dpr: CGFloat, scl: PorScale, ink: RGB, bg: RGB) }` — ключ `view.js:144` (`W, H, dpr, hor, qy, Ws, pcs, root`; сравнение полей, без `String` в кадре).
  - `enum PorScene { static func paint(_ p: NatPen, _ G: PorGeo, scl: PorScale) }` — `wall()` `view.js:145-197` построчно: заливка `BGC`, `rnd = NatLCG(seed: 13)`, 110 звёзд, 700 штрихов волн (`inWater` `:163`), края фарватера (тройки `:164-170`), 16 поперечных черт, 13 засечек (ступень лада — `scl.pcs` содержит класс высоты), два мыса (`:177-185`), горизонт, набережная. Каждый `rnd()` — в том же месте и порядке, что в вебе, включая пропущенные `continue` итерации.

- [ ] **Step 1: тесты** `PorSceneTests` (`PorGeo` из `PortusView` после `layout(W: 390, H: 844, topY: 50, safeBot: 34)`; `size 390×844`, `dpr 2`):
  - `testLCG13` — `NatLCG(seed: 13)`: первые два `next()` = `218491 / 2147483647` и `1524694590 / 2147483647` (±1e-15);
  - `testWallKey` — два `update` с тем же → `builds 1`; другой `fog.amt` у вида (`fogTop` меняется, ключ нет) → `1`; другой `scl` (`pcs` мажор → минор) → `2`; другой `size.height` → `3`; `dpr 1` → `4`;
  - `testWallSame` — два `PorWall` с одинаковым входом: байты `img` (`dataProvider.data`) равны; при другом `pcs` — различны;
  - `testWallDrawn` — `img` размера `780×1688`; в точке воды без штрихов фон `6,9,13` (±3; медиана 9 пикселей у `G.P(0, 0.5)`); `litPixels > 0` в полосе горизонта `y = hor ± 1` и у края мыса (`G.P(Por.edge(-1, 0.5), 0.5)` ± 4 px).
  - `litPixels(_ img: CGImage | UIImage, in: CGRect, bg: RGB) -> Int` — пиксели светлее `bg` на 20+ (тёмная бумага Portus; `inkPixels` Natura считает темнее).
- [ ] **Step 2:** тесты падают (нет типов) — красный прогон через test-runner.
- [ ] **Step 3: реализация** по Interfaces; Natura — на `Draw.layer` / `blit` (поведение то же).
- [ ] **Step 4:** зелёные — `PorSceneTests`, все `Nat*Tests`, `NaturaDrawTests` (test-runner, весь набор).
- [ ] **Step 5:** коммит `ios/app: shared pen and layer helpers, Portus wall cache`.

### Task 2: `PorDraw` — луна, вехи, кораблики, буй, туман, маяк

**Files:**
- Create: `ios/app/T2D/Portus/PorDraw.swift` (`extension PortusView`)
- Test: `ios/app/T2DTests/PortusDrawTests.swift`

**Interfaces:**
- Consumes: задача 1; из `PortusView` — `geo`, `theme`, `luna(_:)`, `buoy`, `fog(_:)`, `fx(_:)`, `isle(_:)`, `playing`, `step`, `state` (`hitT`, `hits`, `lastHit`, `lastAt`); `d.glowAt`.
- Produces (все `func … (_ p: NatPen, _ d: Draw, nowMs: Double)` в `extension PortusView`, кроме оговорённых):
  - `drawMoon(…, sun: Bool)` — `view.js:199-226`: путь дорожки (36 строк) всегда, при `sun == false` дальше не рисует; клип, ореол `glowAt`, кольца `res` (пунктир `[1.5, 3.5]`), цвет `mc` по `geo.moon.lfo` (кровавая), край, кратеры, лицо;
  - `drawQuay(…, cs: Int)` — `:310-324`: полоса света шага при `cs ≥ 0 && playing`, 16 шестов от 15 к 0, фонарь горит у занятого места;
  - `drawIsle(…, j: Int, cur: Bool)` — `:227-248`: `hit` от `state.hitT[j]` за 500 мс, качание от `sd`, ореол только у текущего при `playing`, 3 штриха отражения, корпус, сгибы, тень паруса;
  - `drawBuoy` — `:249-269`: качка от `fx.wow`, круги повторов из `state.hits` (`k = 1…14`, обрыв `a < 0.04` или ещё не наступил, живёт 1400 мс), тело буя;
  - `drawFog` — `:270-290`: 3 пелены, `rows = jsRound(10 + 22·amt)`, своя LCG строки `NatLCG(seed: j·97 + 5)`, пунктир верха `[3, 5]`;
  - `drawPharos(…, cs: Int)` — `:291-309`: текущий = `state.lastHit`, если `nowMs − lastAt·1000 < 600`; вспышка 260 мс; луч к кораблику только при `playing` и занятом месте; башня, полосы, лампа (`glowAt` при `playing`), крыша, знак пуска при стоящих часах.

- [ ] **Step 1: тесты** `PortusDrawTests` (`PortusView` на фейковом `Core` и зеркале — как `PortusTests`; `layout 390×844, topY 50, safeBot 34`; холст 390×844 `UIGraphicsImageRenderer` scale 1, залит `6,9,13`; шрифты — как `NaturaDrawTests.setUp`; `litPixels` из задачи 1; помощник `lightCentroidY(img, in: CGRect) -> Double`):
  - `testMoonFollowsCut` — `luna.cut 0.1` и `0.9`: центр масс света в полосе луны (`geo.moon.x ± geo.moon.r·3`) выше (меньше y) при `0.9` больше чем на 20 px;
  - `testBloodMoonColor` — `lfoBase` даёт `0.8`, зеркало `cut 0.3` (ниже базы): в центре диска `geo.moon` красный канал превышает зелёный на 40+; `lfoBase` → `nil` и → `.nan` (через `rebuildGeo`) — цвет `LIGHT` (±12), не падает;
  - `testEchoRings` — `state.heard(…)` с `dt 0.25, fb 0.9` в `now 1.0`; `drawBuoy` при `now 1.6` — `litPixels` в кольце вокруг буя (вне тела ±12 px, внутри `(6+70)·s·1.4`) больше, чем при `now 3.0` (круги отжили);
  - `testIsleFlash` — кораблик в месте 3, `playing`, шаг 3, удар `hitT[3] = now`: `drawIsle(cur: true)` — у корабля золото (пиксели с `r − b > 60`); через 0.6 с и при `cur: false` — нет;
  - `testFogRows` — `drawFog` при `amt 0` и `1`: `litPixels` ниже `geo.fogTop` растёт (больше строк);
  - `testDrawExtremes` — все fx 0, потом 1; `fog 0 / 1`; `res 0 / 1`; 16 корабликов; `playing`, шаг 15; удар в `now − 2`: все функции задачи подряд не падают; при ударе старше 1.4 с кругов нет (`litPixels` кольца = как без ударов).
- [ ] **Step 2:** падают. **Step 3:** реализация по Interfaces. **Step 4:** зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Portus moon, poles, boats, buoy, fog, lighthouse`.

### Task 3: `PorFrame` — кадр, звезда, подписи; карта и сцены

**Files:**
- Create: `ios/app/T2D/Portus/PorFrame.swift` (`extension PortusView`)
- Modify: `PortusView.swift` (хранимые `wall = PorWall()`, `order = [Int](repeating: 0, count: Por.nstep)`; `draw` → `drawFrame(d, now:)`, `drawShot` → `drawFrame(d, now:, sun: false)`; комментарий шапки — «картинка — PorScene / PorDraw / PorFrame»), `ios/app/T2D/Worlds.swift:30` (`view: true`), `ios/app/T2D/App.swift` (`makeView` — ветка `PortusView.slotN`; `@State por` рядом с `nat`; список сцен в комментарии шапки; `case` сцен; `shotPortus` рядом с `shotNatura`), `ios/app/shot.sh` (комментарий со списком сцен)
- Test: `ios/app/T2DTests/PortusDrawTests.swift`

**Interfaces:**
- Consumes: задачи 1–2; `fingers` (`PorFinger.kind / j / moved`), `state.killAt / killXY`, `hzOf(_:)`, `nameOf(_:)`, `porFc`, `porFb`, `Por.dtName`, `bpm`.
- Produces:
  - `func drawStar(_ p: NatPen, _ d: Draw, nowMs: Double)` — `view.js:329-331` (900 мс, хвост, `glowAt`);
  - `func drawCaptions(_ d: Draw)` — `:333-347`, только пока палец держит предмет: кораблик (две строки), луна (только `moved`), буй (`endless` при `porFb > 0.95`), туман, маяк; тексты и размеры — из веба;
  - `func drawFrame(_ d: Draw, now: Double, sun: Bool = true)` — порядок `view.js:325-348`: `wall.update` + `d.blit`, луна, звезда, вехи, кораблики от дальних к ближним (`order` — места с корабликом, по убыванию шага; текущий — `step % 16`), буй, туман, маяк, подписи.
  - сцены `shotPortus` (`host.go(13)`, действия — `por.send(…)` кодами `Por.Act`; кадр `shot.sh` — на +5 с), по образцу `sc_portus` (`tools/shot.py:1643-1700`): `portus-empty` — пусто; `portus-play` — `PLACE` мест 2 и 10 (ноты как в вебе), веха 6, `PLAY [1]`; `portus-echo` — как `play` + `LUNA` (cut 0.8), `BUOY` к морю; `portus-star` — `KILL` с `state.kill` в точке неба; `portus-bloodmoon` — `FOG amt 0.8`, через +1 с `host.shotSheet(por.lunaSpec, lfoKey: "cut")` и `host.shotLfo(rate: 1, depth: 0.5)` (как `openStarSheet(lfo:)` в `App.swift:127`; веб — `slAdd('cut')`); `portus-sheet` — `host.shotSheet(por.pharosSpec)`; `portus` — `dice()`.

- [ ] **Step 1: тесты** (в `PortusDrawTests`):
  - `testDrawPure` — `drawFrame` до первого `tick` не падает; после `tick` с ударом, звездой (`state.kill`), пальцем на кораблике два кадра подряд — `state.hits.count`, `state.killAt`, `fingers.count` не изменились;
  - `testShotNoMoon` — `drawFrame(sun: false)`: в центре диска `geo.moon` фон (±6); `sun: true` — свет;
  - `testStarFades` — `state.kill(x: 200, y: 120, now: 1)`: кадр при `now 1.3` — `litPixels` у хвоста > 0; при `now 2.0` — как без звезды;
  - `testCaptionsOnlyWhileHeld` — палец на кораблике 3 (`down` как в `PorTouchTests`): у кораблика есть свет текста в полосе `p.y − 30 − 22s ± 8`; после `up` — нет;
  - `testDrawWide` — `layout 1024×1366`, кадр 1024×1366: не падает, горизонт светлый на всю ширину фарватера.
- [ ] **Step 2:** падают. **Step 3:** реализация по Interfaces; регистрация на карте и сцены. **Step 4:** зелёные (test-runner, весь набор); `ios/app/shot.sh portus` собирается и даёт png.
- [ ] **Step 5:** коммит `ios/app: Portus frame, map entry, shot scenes`.

### Task 4: Снимки, финальное ревью, доки, выкладка

**Files:**
- Modify: `docs/native-ios-plan.md` (фаза 3: Portus сделан, ждёт iPhone), `docs/worlds/portus.md` (раздел «Натив»: где код, `ACT_LFO` и `DICE` в ядре, `goMap` и `lfoBase`, собственные значения, удержания в тике, стена и LCG, кадр без состояния, решено без автора), `docs/testing.md` (сцены `portus*` и веб-пары, тесты `PorMathTests / PorStateTests / PorTouchTests / PortusTests / PorSceneTests / PortusDrawTests`), `docs/architecture.md` (`World.goMap`, `World.lfoBase`, `Draw.layer / blit` — если план (а) не добавил), `docs/tokens.md`, `sw.js` / `index.html` (новый `CACHE` = `?v=` — изменился `t2d.wasm` в плане (а))

- [ ] **Step 1:** один проход агента `shots`: веб (`python3 -m http.server 8765`) `python3 tools/shot.py portus` (все 7 сцен); нативные `ios/app/shot.sh portus | portus-empty | portus-play | portus-echo | portus-star | portus-bloodmoon | portus-sheet`. Сверка глазами: небо и звёзды, волны, фарватер пунктиром, засечки лада, мысы с кипарисами, горизонт, набережная, луна (лицо, кратеры, кольца, дорожка; кровавая), вехи и фонари, кораблики (золотой текущий), буй с кругами, туман, маяк с лучом, звезда, плашка `pharos`, плашки `XIII` и `P O R T V S`, веер. Расхождения — правка в задачах 1–3, повторный прогон только расходящихся сцен.
- [ ] **Step 2:** финальное ревью всей ветки Portus от `88014cc` (одно; opus) — обе части; список `minor (deferred)` из журнала плана (а) и этого плана.
- [ ] **Step 3:** доки по списку; `CACHE` в `sw.js` и `?v=` в `index.html` — следующее число (одно и то же); строка `docs/tokens.md` (`python3 tools/tokens.py --line` + агенты).
- [ ] **Step 4:** коммит `docs: iOS phase 3 Portus` (отдельно от пуша), пуш, `python3 tools/deploy-wait.py` → `success`.

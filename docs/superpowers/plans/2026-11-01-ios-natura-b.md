# iOS фаза 3 — Natura на Swift, план (б): картинка, сцены, карта

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** картинка IV · Natura на CoreGraphics — кеши бумаги и земли, пейзаж, жизнь реки, руки; мир включён на карте, сцены `-shot natura*`, снимки против веба, доки, выкладка.

**Architecture:** логика готова в плане (а) (`ios/app/T2D/Natura/`: `NatMath`, `NatMirror`, `NatState`, `NaturaView`, `NatTouch`; коммиты `092a710…8427b8d`). Здесь — только рисование, построчный перенос `worlds/natura/scene.js` и `view.js` без новых решений: `NatPen` (кисть с семантикой canvas поверх `CGContext`), `NatScene` (два `CGImage`-кеша), `NatArt` (формы без состояния мира), `NatDraw` (пейзаж в кадре), `NatFrame` (жизнь реки, руки, `drawFrame`). Состояние картинки (рыба, стрекозы) двигает тик, кадр только читает.

**Tech Stack:** Swift 5 + UIKit + CoreGraphics, XCTest, XcodeGen; веб-эталон снимков — `python3 tools/shot.py sketches | natura`.

**Spec:** `docs/superpowers/specs/2026-10-31-ios-natura-design.md` — читать целиком (особенно «Решения» 1, 2, 12). План (а): `docs/superpowers/plans/2026-10-31-ios-natura-a.md` — Global Constraints оттуда действуют и здесь. Образец Swift — `ios/app/T2D/Inferno/InfDraw.swift` (кеш `InfWall`, помощники `CGContext`, `drawFrame`) и `App.swift` (`shotInferno`).

## Global Constraints

- Всё из Global Constraints плана (а) (ветка `native`, коммиты, тесты Swift через test-runner, `project.yml` уже содержит `T2D/Natura`, `Horo.jsRound`, константы, геометрия). Ядро в плане (б) не трогается — `t2d.wasm` не меняется.
- Перенос построчно: альфы, радиусы, шаги, порядок вызовов — из `scene.js` / `view.js`, своих чисел не вводить. Время в формулах веба — `now·1000` (мс). Цвета — тема `Worlds.info(4)`: `ink(a)` = `38,26,16`, `pap(a)` = `226,211,174`.
- Тексты: подписи на поле — `d.mapText` курсивом (IM Fell), как `ctx.font` в `view.js`; жирного нет.
- Производительность: никакого `shadowBlur`, градиентов нет; полноэкранные проходы — только два `draw(CGImage)` кешей (и заливка бумагой по бокам при `ox > 0`); в кадре без выделений (`Array`, замыкания, `String` на кувшинку / птицу / стрекозу; подписи — только у пальца); буферы предвыделены (`birdBuf`, `padBuf` уже есть); `dt` картинки ≤ 0.1 с; холст ≤ 2× (`DPR`).
- **Состояние — в тике, не в кадре.** `draw` и `drawShot` — одно и то же `drawFrame`, ничего не меняют. Челнок, всплеск, удержания уже в `touchTick` (план (а)). Рыба и стрекозы (в вебе меняются в `drawFish` / `drawFlies` на `Math.random`) — в новом `artTick(now:dt:)` на `rng` мира (решение плана (б): кадр рисуется дважды — `draw` и `drawShot` — и не должен двигать состояние).
- Надгробие `drawStone` рисуется в кадре, как в вебе (`view.js:528`), касаний не имеет.

## Review Focus

1. **Широкий экран (iPad, `ox > 0`)** — по бокам бумага, сцена по центру, кеши и предметы в координатах сцены. Тест — задача 4 (`testDrawWide`).
2. **Тяга гор (`res`)** — пересобирается только земля; земля после смены `res` бит в бит та же, что собранная с нуля при этом `res` (счёт LCG продолжается после бумаги). Тест — задача 1 (`testLandSameAfterResChange`).
3. **Кадр без тика и двойной кадр** — `drawFrame` до первого `tick` (пустое зеркало) не падает; два `drawFrame` подряд не меняют рыбу, стрекоз, челнок. Тест — задача 4 (`testDrawPure`).
4. **Стрекоза над пропавшей кувшинкой** (корзина, кубик, отмена, `REMOVE`) — на следующем `artTick` цель меняется, как в вебе (`!pads.at[F.i]`). Тест — задача 4 (`testFliesRetargetGone`).
5. **Крайние значения** — все fx 0 и все 1, `len 1` и `16`, `bpm 45`: кадр не падает, плотина на реке. Тест — задача 3 (`testDrawExtremes`).

---

### Task 1: `NatPen` и `NatScene` — кисть и кеши бумаги и земли

**Files:**
- Create: `ios/app/T2D/Natura/NatPen.swift`, `ios/app/T2D/Natura/NatScene.swift`
- Test: `ios/app/T2DTests/NatSceneTests.swift`

**Interfaces:**
- Consumes: `NatGeo` (`W` — ширина сцены, `H`, `top`, `bot`, `h`, `hor`, `y1`, `river(_:)`, `slotT`), `RGB`.
- Produces:
  - `struct NatPen { let g: CGContext; let inkC: RGB; let papC: RGB }` — методы с семантикой canvas (y вниз, углы как `InfDraw.swift:31`): `line(_ a: Double, _ w: Double)` (= `line()` веба: цвет штриха `ink(a)` и толщина), `fillInk(_ a: Double)`, `fillPap(_ a: Double)`, `strokeInk(_ a: Double)`, `move / to / quad(_ cx, _ cy, _ x, _ y) / bez(...)`, `arc(_ x, _ y, _ r, _ a0, _ a1, ccw: Bool = false)`, `ellipse(_ x, _ y, _ rx, _ ry, rot: Double, _ a0, _ a1, ccw: Bool = false)` (путь через `CGAffineTransform`, без масштаба толщины), `dash(_ pattern: [CGFloat])` — массив паттерна статический, не в кадре. Все `Double`, без выделений.
  - `struct NatLCG { var seed: Int64 = 11; mutating func next() -> Double }` — `seed = seed·16807 % 2147483647`, возврат `seed / 2147483647`.
  - `final class NatLayers { private(set) var skyBuilds = 0, landBuilds = 0; private(set) var sky: CGImage?, land: CGImage?; func update(_ G: NatGeo, size: CGSize, dpr: CGFloat, res: Double, ink: RGB, pap: RGB) }` — ключ бумаги `W×H×DPR` (по `size` всего вида, как `canvas()` веба), ключ земли `W×H×DPR|top|bot|round(res·24)` (`Horo.jsRound`). Смена ключа бумаги пересобирает обе; смена только ключа земли — землю, а счёт LCG перед ней прокручивается на 260·3 вызова без рисования.
  - `enum NatScene { static func paintSky(_ p: NatPen, w: Double, h: Double, rnd: inout NatLCG); static func paintLand(_ p: NatPen, _ G: NatGeo, res: Double, rnd: inout NatLCG) }` — `paintLand` = `drawLand` (`scene.js:108-139`) с `ridge :86-107`, `hatchIn :75-85`, `tuft :70-74`, `drawCard :140-164`; холст земли прозрачный.

- [ ] **Step 1: тесты** `NatSceneTests` (`NatGeo(W: 390, H: 844, topY: 50, safeBot: 34)`, `size 390×844`, `dpr 2`):
  - `testLCG` — первые два `next()` дают `184877 / 2147483647` и `959744092 / 2147483647` (±1e-15);
  - `testLayersKey` — два `update` с тем же → `skyBuilds 1, landBuilds 1`; `res 0.25 → 0.26` (тот же `round(res·24)`) → без пересборки; `res → 0.5` → `skyBuilds 1, landBuilds 2`; смена `size.height` → `2, 3`; смена `dpr` → `3, 4`;
  - `testLandSameAfterResChange` — слои A: `update(res 0.25)`, затем `update(res 0.5)`; слои B: сразу `update(res 0.5)`; байты `A.land` и `B.land` (`dataProvider.data`) равны;
  - `testSkyPaper` — пиксель `sky` в (195, 400) — бумага `226,211,174` (±3 на канал, крап может лечь — взять медиану 9 пикселей), размер образа `780×1688`;
  - `testLandDrawn` — у `land` непрозрачные пиксели есть вдоль оси реки (`G.river(0.5)` ± 3 px) и у рамки (x 13…16), в небе над горами (`y = top + 5`, середина) — прозрачно.
- [ ] **Step 2:** тесты падают (нет типов) — красный прогон через test-runner.
- [ ] **Step 3: реализация** по Interfaces; перенос `scene.js:53-164` построчно, порядок вызовов `rnd()` — точно как в вебе.
- [ ] **Step 4:** зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Natura pen, paper and land caches`.

**Ревью задачи:** да (порядок LCG, ключи).

### Task 2: `NatArt` — формы без состояния мира

**Files:**
- Create: `ios/app/T2D/Natura/NatArt.swift`
- Test: `ios/app/T2DTests/NatArtTests.swift`

**Interfaces:**
- Consumes: `NatPen` (задача 1), `NatDuck`, `NatGeo`.
- Produces: `enum NatArt` со статическими функциями — сигнатуры как в вебе, первым параметром `NatPen`, время `nowMs: Double`:
  `leafPath(_ p, x, y, ang, s)` (`scene.js:165`), `leaf(_ p, x, y, ang, s, a, fill: Bool = true)` (`:182-193`), `cloud(_ p, x, y, s, a, heavy: Double = 0)` (`:194-211`), `rain(_ p, x, y, w, toY, a, nowMs, dens)` (`:212-221`), `flower(_ p, x, y, wave: Int, s, a)` (`:222-252`, 5 форм по `WAVES`), `lily(_ p, x, y, s, wave: Int, open: Double, a, locked: Bool, chance: Double = 1)` (`:265-275`), `boatShape(_ p, bx, by, s, tilt, paused: Bool)` (`:276-287`), `duck(_ p, _ d: NatDuck, nod: Double)` (`:296-318`), `flyer(_ p, x, y, s, dir, flap)` (`:336-360`), `ducklings(_ p, _ G: NatGeo, nowMs, _ D: (a: NatDuck, r: NatDuck))` (`:361-371`).

- [ ] **Step 1: тесты** `NatArtTests` — холст 200×200 через `UIGraphicsImageRenderer`, помощник `inkPixels(in: CGRect) -> Int` (пиксели темнее бумаги на 20+):
  - `testFlowerForms` — `flower` для `wave 0…4` в (100,100), `s 1`, `a 1`: у каждой формы `inkPixels > 0` в квадрате ±20, и пять картинок попарно различны (байты);
  - `testRainDeterministic` — `rain` с тем же `nowMs` дважды → одинаковые байты; `nowMs + 300` → другие;
  - `testShapesDraw` — `leaf`, `cloud` (`heavy 0` и `1`), `lily` (`locked` да / нет, `chance 0.5`), `boatShape` (`paused` да / нет), `duck`, `flyer`, `ducklings` — каждая оставляет `inkPixels > 0` возле своей точки;
  - `testCloudHeavy` — `cloud` с `heavy 1` темнее (`inkPixels` больше), чем с `heavy 0`.
- [ ] **Step 2:** падают. **Step 3:** реализация — перенос строк из Interfaces; `save / restore` вокруг `translate / rotate`, как в вебе. **Step 4:** зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Natura shapes - flowers, lilies, ducks, clouds`.

**Ревью задачи:** нет.

### Task 3: `NatDraw` — пейзаж в кадре

**Files:**
- Create: `ios/app/T2D/Natura/NatDraw.swift` (`extension NaturaView`)
- Test: `ios/app/T2DTests/NaturaDrawTests.swift`

**Interfaces:**
- Consumes: задачи 1–2; из `NaturaView` — `geo`, `fxv(_:)`, `len`, `bpm`, `shake`, `phase`, `state` (`goneAt`, `birdsAt`, `noteAt`), `birdBuf`, `now`; `NatGeo.sunAt / pond / ducks / pier / cloud / crown / bridgeT / birds`; `d.quarterSun`.
- Produces (все `func … (_ p: NatPen, nowMs: Double)`, внутри `extension NaturaView`): `drawSun` (`view.js:30`: `d.quarterSun` с `top` = верх рамки; садится при `bpm < 96` — через `sunAt`), `drawBirds` (`:153-169`, из `birdBuf`), `drawFog` (`scene.js:167-181`), `drawRainRings` (`:382-393`), `drawPier` (`:372-381`), `drawBridge` (`:253-264`), `drawReeds` (`:394-409`), `drawTree` (`:410-441`, качание — `shake`), `drawCloud` (`:442-454`, клип объединением кругов, дождь `NatArt.rain`), `drawPond` (`:319-335`, клип эллипсом, отражения `scale(1,−1)`, `α 0.16/n`), `drawDucks` (`view.js:59-111`: утки, кивок от `noteAt`, улёт и возврат от `goneAt` с `GONE`, утята, рябь), `drawStone` (`scene.js:455-470`).

- [ ] **Step 1: тесты** `NaturaDrawTests` (`NaturaView` на фейковом `Core` и фейковом зеркале — как `NaturaTests`; `layout 390×844, topY 50, safeBot 34`; холст 390×844 `UIGraphicsImageRenderer`; `inkPixels` из задачи 2 — общий помощник в тестах):
  - `testSunSets` — `drawSun` при `bpm 96` и `bpm 45`: у второго нижняя граница чернил солнца ниже (по `sunAt`);
  - `testDucksAway` — `send(scare)`; `drawDucks` через 0.1 с и через 2 с — у пруда (`geo.pond()` ± rx) чернил меньше во втором (утки улетели); через 6 с — снова как до испуга (±10 %);
  - `testCloudCutoff` — `drawCloud` при `cutoff 0` и `1`: облако на разной высоте (центр масс чернил по y отличается > 5 px);
  - `testDrawExtremes` — все fx 0, потом все 1; `len 1` и `16`; `bpm 45`: все функции задачи подряд не падают; точка плотины `geo.river(geo.bridgeT(len:))` внутри `0…W × top…bot`.
- [ ] **Step 2:** падают. **Step 3:** реализация — перенос строк из Interfaces; `GONE` (фазы улёта) — из `view.js` рядом с `drawDucks`. **Step 4:** зелёные (test-runner).
- [ ] **Step 5:** коммит `ios/app: Natura landscape - sun, birds, tree, cloud, pond, ducks`.

**Ревью задачи:** нет.

### Task 4: `NatFrame` — жизнь реки, руки, кадр; карта и сцены

**Files:**
- Create: `ios/app/T2D/Natura/NatFrame.swift` (`extension NaturaView`)
- Modify: `NaturaView.swift` (хранимые `layers = NatLayers()`, `fish: NatFish?`, `fishStep = -1`, `flies = [NatFly](repeating: NatFly(), count: 3)`; `tick` зовёт `artTick` после `touchTick`; `draw / drawShot` → `drawFrame`; комментарий шапки — «картинка — NatScene / NatArt / NatDraw / NatFrame»), `NatTouch.swift` (тестовые хуки ниже), `ios/app/T2D/Worlds.swift:22` (`view: true`), `ios/app/T2D/App.swift` (`makeView` — ветка `NaturaView.slotN`; `@State nat` рядом с `inf`; список сцен в комментарии шапки; `case` сцен; `shotNatura` рядом с `shotInferno`), `ios/app/shot.sh` (комментарий со списком сцен)
- Test: `ios/app/T2DTests/NaturaDrawTests.swift`

**Interfaces:**
- Consumes: задачи 1–3; `NatSkiff`, `NatMenu`, `menuOpts()`, `wake`, `splash`, `frogAt`, `fingers`, `state.noteAt / playedAt / croakAt`, `Nat.attOf / relOf`, `scl`, `natNoteName / natHz / natMs`.
- Produces:
  - `struct NatFish { var x, y, t0, dir, s: Double }`, `struct NatFly { var x = 0.0, y = 0.0; var ok = false; var i = -1; var until = 0.0 }`;
  - `func artTick(now: Double, dt: Double)` — рыба (`view.js:392-397`: при смене целого шага фазы и `step % len == 0` — новая, `t = 0.25 + R·0.5`, `q = (R − 0.5)·0.5`, `dir`, `s = 0.7 + 0.6t`; гаснет при `k > 1.6`) и стрекозы (`:423-436`: число от `chorus`, цели по `playedAt`, `until = now + 6…12 с`, смена цели, если кувшинки нет; сглаживание `min(1, dt·0.8)`; `ok = false` у лишних) на `rng`;
  - `func envAt(_ ms: Double, _ p: NatPad) -> Double` (`view.js:21`) — если ещё нет в `NatMath`;
  - рисование: `drawPads` (`:31-58`, с `drawBridge` и `boatShape` лодочки по `geo.boat`), `drawGlides` (`:449-469`), `drawFish` (`:398-421`, только рисунок), `drawFrog` (`:369-383`, по `frogAt`), `drawSkiff` (`:112-135`, только рисунок и след; всплеск `splash`), `drawFlies` (`:437-446`, только рисунок), `drawTouches` (`:470-499`), `drawMenu` (`:338-351`);
  - `func drawFrame(_ d: Draw, now: Double)` — порядок `view.js:504-532`: `layers.update`, бумага по бокам при `ox > 0`, `translate(ox)`, `sky`, клип рамки `(13, 13, W − 26, H − safeBot − 26)` → солнце, птицы; `land`; туман, кольца дождя, пристань, glide, рыба, кувшинки, лягушка, камыши, дерево, облако, утки (с прудом), челнок, стрекозы, камень, подписи, меню. DPR — как в `InfernoView.drawFrame`.
  - хуки сцен в `NatTouch.swift`: `func skiffShot(_ i: Int, note: Int)` — челнок «в руке» (`held = true, home = false`) в `geo.padXY(i, note)`, `skiffTo(geo.onRiver(...))`; `func menuShot()` — `menu = NatMenu(x: skiff.x, y: skiff.y, held: false, owner: nil)`.
  - сцены `shotNatura` (`host.go(4)`, действия — `nat.send(…)`; кадр `shot.sh` — на +5 с): `natura` — демо; `natura-play` — `PLAY [1]`; `natura-fx` — `SETFX` 0, 1, 2, 3, 4 = 1; `natura-res` — `SETFX 5 [0.95]`; `natura-skiff` — `PLAY [1]`, через +1.5 с `skiffShot(9, note: 12)`; `natura-ducks-away` — через +3.9 с `SCARE`; `natura-sheet` — через +1.5 с `host.shotSheet(nat.lilySpec(3))`; `natura-menu` — через +1.5 с `menuShot()`.

- [ ] **Step 1: тесты** (в `NaturaDrawTests`):
  - `testFishSpawnsOnLoop` — фейковый `rng` (0.5 по кругу), зеркало `playing 1`, `len 12`: `artTick` при фазе 11.9 → `fish == nil`; при 12.1 → рыба, `x, y` = `geo.river(0.5).across(0)`, `s = 1.0`; через 1.7 с `artTick` → `nil`;
  - `testFliesRetargetGone` — `chorus 1` (три стрекозы), `playedAt` свежий у места 3; `artTick` → `flies[0].i == 3`; своё `REMOVE 3` → следующий `artTick` → `flies[0].i != 3`; `chorus 0.1` → все `ok == false`;
  - `testDrawPure` — `drawFrame` до первого `tick` (пустое зеркало) не падает; после `tick` с рыбой, стрекозами, челноком на воде (`skiffShot(9, note: 12)`) два `drawFrame` подряд — `fish`, `flies`, `skiff.x/y`, `skiff.trail.count` не изменились;
  - `testDrawWide` — `layout 1024×1366`; кадр 1024×1366: пиксели в x 0…`ox − 1` — бумага (±3), у `ox + 14` на середине высоты — чернила рамки;
  - `testDrawSmoke` — демо, `playing`, `chorus 1`, `cutoff 1`, `res 0.95`, открытое меню (`menuShot`), палец на кувшинке 3 (`down` через `Finger` как в `NatTouchTests`): `drawFrame` 390×844 не падает; чернила есть у кувшинки 3 (`geo.padXY`), у пристани, у челнока, у меню;
  - `testShotHooks` — `skiffShot(9, note: 12)` → в фейковом `Core` последнее действие `SKIFF` с `q, t` из `geo.onRiver` точки `padXY(9, 12)`; `menuShot()` → `menu?.held == false`.
- [ ] **Step 2:** падают. **Step 3:** реализация по Interfaces; регистрация на карте и сцены; плашка и меню в `draw` не открываются (они в `touchTick`). **Step 4:** зелёные (test-runner); `ios/app/shot.sh natura` собирается и даёт png.
- [ ] **Step 5:** коммит `ios/app: Natura frame, map entry, shot scenes`.

**Ревью задачи:** да (кадр без состояния, хуки, регистрация).

### Task 5: Снимки, доки, выкладка

**Files:**
- Modify: `docs/native-ios-plan.md` (фаза 3: Natura сделана, ждёт iPhone; статус наверху — убрать устаревшее «следующий — Goetia», дальше — Portus), `docs/worlds/natura.md` (раздел «Натив»: где код, `DICE` в ядре, собственные значения, челнок и удержания в тике, рыба и стрекозы в `artTick`, кеши и LCG, решено без автора), `core/README.md` (`DICE` Natura — если план (а) не добавил), `docs/testing.md` (сцены `natura*` и веб-пары, тесты `NatMathTests / NatStateTests / NatTouchTests / NaturaTests / NatSceneTests / NatArtTests / NaturaDrawTests`), `docs/tokens.md`, `sw.js` / `index.html` (новый `CACHE` = `?v=` — изменился `t2d.wasm` в плане (а))

- [ ] **Step 1:** главный поток — один проход агента `shots`: веб (`python3 -m http.server 8765`) `python3 tools/shot.py sketches` (`natura`, `natura-fx`) и `python3 tools/shot.py natura` (`natura-play`, `natura-res`, `natura-skiff`, `natura-ducks-away`); нативные `ios/app/shot.sh natura | natura-play | natura-fx | natura-res | natura-skiff | natura-ducks-away | natura-sheet | natura-menu`. Сверка глазами: бумага и крап, рамка, плашки `IV` и `N A T V R A`, горы (выше при `res 0.95`), река и засечки, солнце в углу, кувшинки с цветками, лодочка, плотина, пристань и `BPM`, дерево, облако с дождём, утки и утята (улетают), пруд с отражениями, челнок и нота, стрекозы, птицы, туман; плашка кувшинки и меню цветков (без пары — по смыслу). Расхождения — правка в задачах 2–4, повторный прогон только расходящихся сцен.
- [ ] **Step 2:** финальное ревью всей ветки от `f235cf4` (одно; opus) — обе части Natura.
- [ ] **Step 3:** доки по списку; `CACHE` в `sw.js` и `?v=` в `index.html` — следующее число (одно и то же); строка `docs/tokens.md` (`python3 tools/tokens.py --line` + агенты).
- [ ] **Step 4:** коммит `docs: iOS phase 3 Natura` (отдельно от пуша — хук проверяет `git push` до цепочки), пуш, `python3 tools/deploy-wait.py` → `success`.

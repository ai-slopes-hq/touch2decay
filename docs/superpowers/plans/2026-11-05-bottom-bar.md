# Нижний бар и единые плашки Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Бар переезжает вниз, плашка всплывает над ним; vol, bpm, dice, undo, recycle живут в плашках в стиле fx.

**Architecture:** `TopBar` сжимается до пяти кнопок внизу экрана (`barH`). Плашка получает вкладку `transport` и якорь над баром. Хост отдаёт мирам `safeBot + barH`, их геометрия не меняется. Жесты vol и bpm-drag удаляются: vol открывает mix у мастера или текущего мира, bpm — фейдер в transport.

**Tech Stack:** Swift, CoreGraphics (`Draw`), XCTest, xcodegen, `ios/app/shot.sh`.

**Spec:** `docs/superpowers/specs/2026-11-05-bottom-bar-design.md`

## Global Constraints

- Только `ios/app/T2D/Host` и тесты; веб, миры, звук, ядро не трогаем.
- Стиль — гравюра: hairline, без теней, градиентов, жирного; шрифт плашек — EB Garamond (`reading`), текст `text()`.
- `barH` = 52pt; плашка: `bottom = H − safeBot − barH − 8`.
- bpm: карта 40…200, мир — `tempoRange`. Dice на карте погашен.
- Тесты: `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16' > /tmp/claude-501/x.log 2>&1`, затем `grep -E "error:|Fatal error|Test Case.*failed" log | grep -v mkstemp` и `grep -c "Test Case.*passed"` (сейчас 910 + новые).
- Коммиты — по-английски, с телом-списком, без пуша без «да» автора.

## Review Focus

- Левый свайп-край (`x < edgeW`) и `back` внизу слева: тап по `back` не должен уходить в свайп.
- Tenebrae: солнце в нижнем углу не закрыто баром (`safeBot + barH`).
- Узкий экран: пять кнопок бара помещаются, заголовок сверху не наезжает на вырез.
- vol на карте и в мире открывает mix, прокрученный к нужной строке; повторный тап по `vol` не сбрасывает прокрутку.
- bpm-фейдер в мире без часов (`tempo == nil`) погашен и не ловит касания.

---

### Task 1: Нижний бар

Риск: обычный — UI-раскладка под существующими тестами.

**Files:**
- Modify: `ios/app/T2D/Host/TopBar.swift`
- Test: `ios/app/T2DTests/TopBarTests.swift`

**Interfaces:**
- Produces: `enum Btn { back, play, transport, vol, fx }`; `TopBar.barH: CGFloat = 52`; `TopBar(W:top:H:safeBot:)`; `pos(_:)` — y = `H − safeBot − barH/2`, справа налево fx, vol, transport, play, `back` слева; `State` без `sclOpen`, `canUndo`, `fxArc`, `diceHeld`, `diceAt`, `bpmShown`, `vol*`; `draw` рисует кнопки и подпись названия сверху (без подложки, без имени лада).

- [ ] **Step 1:** Переписать `TopBarTests`: `pos` каждой кнопки на `y = H − safeBot − 26`, `back` слева и остальные не пересекаются на ширине 320; `hit` по центрам кнопок возвращает `.btn(b)`, погашенные пропускаются; тап в верхней строке — `.none`, не `.title`.
- [ ] **Step 2:** Запустить `TopBarTests` — падает (нет `transport`, `barH`).
- [ ] **Step 3:** Реализовать новый `Btn`, `barH`, `pos`, `hit`, `draw`; удалить `drawVol`, `fxArc`, дугу, кость, `bpmShown`, `sclList`, `sclPick`, `SclPick`, `dimT`. Значок transport — три тонкие горизонтальные черты с точкой (`drawTransportGlyph`).
- [ ] **Step 4:** `TopBarTests` зелёные.
- [ ] **Step 5:** Commit `ios: bottom bar geometry`.

### Task 2: Вкладка transport и якорь плашки

Риск: обычный — UI.

**Files:**
- Modify: `ios/app/T2D/Host/Plate.swift`, `Mixer.swift` (прокрутка к строке)
- Test: `ios/app/T2DTests/PlateTests.swift`

**Interfaces:**
- Consumes: `TopBar.barH`.
- Produces: `PlateTab.transport` (первая); `Plate.tabs(hasFx:onMap:)` включает его всегда; `PlateGeo.make(..., barH:)` с `bottom = H − safeBot − barH − 8`; `enum TransportRow: CaseIterable { play, bpm, dice, undo, recycle }`; `Plate.transportHit(_ g: PlateGeo, x:y:) -> TransportRow?`; `PlateDraw` рисует вкладку (строки 46pt, bpm — горизонтальный фейдер как в mix); `Plate.scrollTo(key: Mixer.Key, keys: [Mixer.Key]) -> CGFloat`.

- [ ] **Step 1:** Тесты: `Plate.tabs` на карте = `[.transport, .scale, .mix, .sys]`, в мире с fx — с `.fx`; `PlateGeo.make` кладёт низ плашки на `H − safeBot − barH − 8`; `transportHit` по центрам строк возвращает строки по порядку, мимо — `nil`; `scrollTo` ставит строку внутрь окна и не выходит за `maxScroll`.
- [ ] **Step 2:** Запустить `PlateTests` — падают.
- [ ] **Step 3:** Реализовать перечисленное; тело вкладки transport рисуется тонкой рамкой как fx (`SheetDraw`-стиль).
- [ ] **Step 4:** `PlateTests` зелёные.
- [ ] **Step 5:** Commit `ios: transport tab and plate anchor`.

### Task 3: Хост: раскладка, маршруты, жесты

Риск: обычный — UI-маршруты под тестами.

**Files:**
- Modify: `ios/app/T2D/Host/Host.swift`
- Test: `ios/app/T2DTests/HostTests.swift`

**Interfaces:**
- Consumes: Task 1 (`Btn`, `TopBar.barH`), Task 2 (`PlateTab.transport`, `TransportRow`, `Plate.scrollTo`).
- Produces: `layout(...)` строит `bar = TopBar(W:top:H:safeBot:)`, мирам и карте — `safeBot + TopBar.barH`; `Host.openPlate(tab:)`; `.vol` → `mix`-вкладка у мастера (карта) или у текущего мира; `.transport` → вкладка transport; `.play` — старт/стоп (в мире без часов — ничего); строки transport: play, bpm (фейдер, диапазоны по Global Constraints), dice (карта — нет), undo, recycle.

- [ ] **Step 1:** Тесты `HostTests`: тап по `vol` в мире открывает `mix` со строкой текущего мира в окне, на карте — мастера; повторный тап по `vol` прокрутку не сбрасывает; тап по `transport` открывает transport; строки transport вызывают dice/undo/recycle (dice на карте не вызывается); drag по фейдеру bpm меняет темп в диапазоне, в мире без часов — нет; drag по `play` темп не меняет; тап по `back` рядом с краем не уходит в свайп; мир получает `safeBot + barH`.
- [ ] **Step 2:** Запустить `HostTests` — падают.
- [ ] **Step 3:** Реализовать; удалить `volF`, `playF` drag, `setVol`/`volInWorld` для жеста (мастер и каналы — через mix), `mapEnabled` под новый набор. Приоритет маршрутов: плашка → sheet → бар → угол → левый край (край начинается выше бара).
- [ ] **Step 4:** Полный прогон; все зелёные.
- [ ] **Step 5:** Commit `ios: wire bottom bar, transport and vol to plates`.

### Task 4: Мелочи раскладки и снимки

Риск: обычный — UI.

**Files:**
- Modify: `ios/app/T2D/Host/Stage.swift`, `ios/app/shot.sh` (сцены)

- [ ] **Step 1:** Подпись сборки и панель meter поднять над баром (`H − safeBot − barH − 14`).
- [ ] **Step 2:** Сцены `shot.sh`: `bar` (мир), `transport`, `vol-mix`, `tenebrae-bottom`, `map-bar`; прогнать агентом `shots`, он смотрит солнце Tenebrae, свайп-край, узкий экран.
- [ ] **Step 3:** Полный прогон тестов зелёный.
- [ ] **Step 4:** Commit `ios: meter above bar, shot scenes`.

### Task 5: Доки

Риск: обычный — документация.

**Files:**
- Modify: `docs/architecture.md`, `docs/worlds/map.md`, `docs/ios-2b-deferred.md`, `ROADMAP.md` (если упоминает), `docs/tokens.md`

- [ ] **Step 1:** Убрать упоминания Concordia, AudioPanel и верхнего бара; описать нижний бар, плашки и вкладку transport.
- [ ] **Step 2:** Строка в `docs/tokens.md` (`python3 tools/tokens.py --line`).
- [ ] **Step 3:** Commit `docs: bottom bar`.

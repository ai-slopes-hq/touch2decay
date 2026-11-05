# Сквозной хедер и плашка с вкладками (iOS) — план реализации

> **Для исполнителя:** REQUIRED SUB-SKILL: `superpowers:executing-plans` (рекомендуется, задачи сильно связаны через `Host.swift`) или `superpowers:subagent-driven-development`. Шаги — чекбоксы.

**Цель:** один хедер на карте и в мирах и одна плашка с вкладками `fx · scale · mix · sys` вместо панели audio, concordia, кнопок scl / rev и тапа по солнцу.

**Архитектура:** `TopBar` получает новый состав кнопок и флаги активности; новый `Plate` (модель, геометрия, отрисовка вкладок) встраивает существующий `Sheet` как вкладку fx и забирает логику `Mixer`, `Concordia`, `AudioPanel`, список ладов. Состояние остаётся в ядре и в `Mix` / `Link` / `AudioPref`; вид только читает и шлёт действия.

**Стек:** Swift, CoreGraphics, XCTest (`ios/app/T2DTests`), xcodegen. Ядро C++ не меняется.

**Спека:** `docs/superpowers/specs/2026-11-05-top-header-design.md`. Веб — отдельным планом после приёмки на iPhone.

## Global Constraints

- Только iPhone, портрет; текст в интерфейсе — по-английски, русского нет.
- Гравюра: hairline, никаких заливок и градиентов, **никакого `shadowBlur`**, в кадр никаких полноэкранных проходов.
- Шрифты: вкладки и строки плашки — EB Garamond (`READ`), названия — IM Fell English. Жирного нет, акцент яркостью.
- Хедер: `play/pause, vol, undo, dice, recycle, fx` справа, стрелка и название слева; неактивные кнопки притушены на своих местах.
- Громкость в мире — канал мира (`Mix.g[slot]` через `core.fader`), на карте — мастер (`core.vol`).
- Солнце — только картинка; выход из мира — стрелка и свайп от левого края (`Host.edgeW = 14`).
- Тесты: `cd ios/app && xcodegen && xcodebuild test -project T2D.xcodeproj -scheme T2D -destination 'platform=iOS Simulator,name=iPhone 16'`.
- Новые файлы под `T2D/Host` попадают в проект сами; каждый коммит — зелёные тесты.

## Review Focus

- recycle на карте дважды подряд, затем undo: отменяет только последний, повторный undo ничего не ломает.
- play/pause в мире без часов: тап заглушает, undo возвращает; в мире с часами — не трогает звук мира, только часы.
- Два пальца: один на vol, второй на поле или на фейдере (`volF` — один слот).
- Узкий экран (iPhone SE, W = 320): шесть кнопок, стрелка и длинное название (Tria corpora) не наезжают друг на друга.
- Плашка открыта: тапы не проваливаются в поле; `goMap` / смена мира закрывают плашку; в мире без `fx` она открывается на `scale`.

---

### Task 1: Хедер — состав, флаги, отрисовка

Риск: обычный — вид и геометрия, под существующими тестами `TopBarTests`.

**Files:**
- Modify: `ios/app/T2D/Host/TopBar.swift`
- Test: `ios/app/T2DTests/TopBarTests.swift`

**Interfaces:**
- Produces: `enum Btn { case back, play, vol, undo, dice, recycle, fx }`; `TopBar.State` расширяется полями `playing: Bool`, `enabled: Set<Btn>`, `title: String` (на карте `"Universum"`); `TopBar.pos(_ b: Btn) -> (x, y, r)` — прежние правила (правый край `W-27`, шаг как у текущих кнопок, `back` x = 26); `TopBar.hit(_:_:titleW:) -> Hit?` возвращает `nil` для неактивных кнопок; `struct Hit { case btn(Btn), title }` без изменений.
- Убирает: `Btn.scl`, `Btn.rev`, `Btn.clr`, `SclList`, `sclPick`, `Hit`-ветки списка лада (список переезжает в Task 4).

- [ ] **Step 1: Failing tests** в `TopBarTests`: `testButtonOrderRightToLeft` (fx правее всех, затем recycle, dice, undo, vol, play), `testDisabledButtonHasNoHit` (`enabled` без `.undo` → `hit` на её позиции `nil`), `testSixButtonsDoNotOverlapAtW320` (расстояние между центрами соседних кнопок ≥ 2·`btnR`; длинное название обрезается по `tmax` и не заходит на `play`), `testPlayIconSwitches` (пиксель в центре play отличается при `playing` true / false).
- [ ] **Step 2: Run** — FAIL (нет `Btn.play`).
- [ ] **Step 3: Реализовать** новый `Btn`, `pos`, `hit` с учётом `enabled`, иконки play / pause / recycle / fx (тонкие круги), притушенный цвет неактивных. Название ограничить `tmax = pos(.play).x - btnR - 8`.
- [ ] **Step 4: Run** — PASS; поправить старые тесты, ссылавшиеся на `scl` / `rev` / `clr`.
- [ ] **Step 5: Commit** `ios: unified header buttons`.

### Task 2: Действия хедера в мире

Риск: обычный — маршрутизация касаний и вызовы существующих действий хоста.

**Files:**
- Modify: `ios/app/T2D/Host/Host.swift`, `ios/app/T2D/Host/HostConst.swift`
- Test: `ios/app/T2DTests/HostTests.swift`

**Interfaces:**
- Consumes: `Btn`, `TopBar.State` (Task 1); `Mix.fader(slot)`, `applyMix()`, `World.tempo: WorldTempo?`, `core.setMasterBpm`.
- Produces: `Host.worldVol(slot) -> Double`; `Host.playPause()` (тап); `Host.playDrag(dx:)` (bpm вбок через `tempoFrom(slot:_:)`); `Host.barState(_ w:) -> TopBar.State` заполняет `enabled` и `playing`.

- [ ] **Step 1: Failing tests** в `HostTests`: `testVolDragChangesWorldChannelNotMaster` (после вертикального drag по vol `mix.fader(slot)` изменился, `core.vol` — нет), `testVolTapOpensNothing`, `testPlayTapTogglesClockForClockWorld` (мир с `WorldTempo`: `tempo.playing` инвертировался, `clear` не вызывался), `testPlayTapSilencesWorldWithoutClock` (мир без часов: вызван `w.clear()`, `undoStep()` восстанавливает), `testPlayDragSetsBpm` (`core.setMasterBpm` получил значение внутри `tempoRange`), `testRecycleClearsWorld`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Реализовать** в `route` / `press`: vol-drag пишет `mix.g[slot]` и зовёт `applyMix()` вместо `core.vol`; вызов `volTap` и `audioPanel` из этого пути убрать; `press(.play)` / `press(.recycle)` по таблице спеки. В мире без часов тап — прежнее поведение `stop` (`press(.clr)` → `w.clear()` с коммитом снимка для undo; убедиться, что undo действительно возвращает — иначе добавить `undo.commit` перед очисткой).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `ios: header actions in worlds`.

### Task 3: Хедер на карте, глобальные play и recycle, солнце неактивно

Риск: высокий — recycle удаляет состояние всех миров; снимки ядра асинхронны (`Undo`, `core.snap`).

**Files:**
- Modify: `ios/app/T2D/Host/Host.swift`, `ios/app/T2D/Map/Map.swift`, `ios/app/T2D/Map/MapDraw.swift`, `ios/app/T2D/Host/Undo.swift`
- Test: `ios/app/T2DTests/HostTests.swift`, `ios/app/T2DTests/MapTests.swift`

**Interfaces:**
- Consumes: Task 1–2.
- Produces: `Undo.snapshotAll(slots: [Int])` и `Undo.restoreAll() -> Bool` (один слот отката для recycle, повторный recycle затирает прошлый); `Host.recycleAll()`; `Host.playAll(_ on: Bool)`; `MapGeo.hit` больше не возвращает `.sun` (метка «concordia» убрана).

- [ ] **Step 1: Failing tests:** `testMapHeaderEnabledSet` (на карте активны play, vol, recycle, fx; undo — только после recycle; dice — никогда), `testMapVolDragChangesMaster`, `testMapPlayTogglesAllClocks`, `testRecycleAllThenUndoRestoresAllWorlds`, `testRecycleTwiceUndoRestoresOnlyLast`, `testUndoOnMapWithoutRecycleIsDisabled`, `testSunTapDoesNothing`, `testBackSwipeStillGoesToMap`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Реализовать.** `recycleAll`: запросить `core.snap` для каждого слота `Worlds.all`, дождаться готовности через `pollAll()` (или хранить снимок до очистки синхронно, если API позволяет), затем `w.clear()` у каждого; если снимок не получен — **не очищать**. Убрать `settings = .concordia`, метку и тап по солнцу. Заголовок на карте — `"Universum"` без действия.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `ios: map header, recycle all, inert sun`.
- [ ] **Step 6:** отдельное ревью задачи (sonnet): гонка снимка и очистки, утечка снимков, повторный recycle.

### Task 4: Плашка — каркас, fx и scale

Риск: обычный — вид и маршрутизация, логика ладов уже есть.

**Files:**
- Create: `ios/app/T2D/Host/Plate.swift`
- Modify: `ios/app/T2D/Host/Host.swift`, `ios/app/T2D/Host/Sheet.swift`
- Test: `ios/app/T2DTests/PlateTests.swift`

**Interfaces:**
- Produces: `enum PlateTab: CaseIterable { case fx, scale, mix, sys }`; `struct Plate { var tab: PlateTab; var scroll: CGFloat }`; `Plate.tabs(hasFx: Bool, onMap: Bool) -> [PlateTab]` (на карте без fx); `PlateGeo.make(_ p: Plate, W:, H:, safeBot:, rows: Int) -> PlateGeo`; `Plate.hit(_ g: PlateGeo, x:, y:) -> PlateHit` (`tab(PlateTab)`, `content(...)`, `close`, `none`); `Host.plate: Plate?` и `Host.lastTab` (помнит вкладку).
- Consumes: `SheetSpec` / `SheetGeo` для вкладки fx, список ладов и `core.scale(_:)` для вкладки scale.

- [ ] **Step 1: Failing tests:** `testTabsWithoutFxOpenOnScale`, `testMapTabsExcludeFx`, `testPlateRemembersLastTab`, `testTapOutsideClosesPlate`, `testTouchesDoNotReachFieldWhilePlateOpen`, `testScalePickSetsCoreScale`, `testFxTabRowDragUsesSheetValue`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Реализовать** `Plate` и роутинг (новый `Route.plate`, приоритет выше поля и ниже легенды); fx-вкладка делегирует `Sheet`, scale-вкладка — список ладов и тоник из бывшего `TopBar.SclList`; плашка закрывается при `goMap`, `goWorld`, `closeOverlays`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `ios: tabbed plate with fx and scale`.

### Task 5: Вкладка mix

Риск: обычный — перенос готовой логики микшера в прокручиваемый список.

**Files:**
- Modify: `ios/app/T2D/Host/Plate.swift`, `ios/app/T2D/Host/Mixer.swift`
- Test: `ios/app/T2DTests/MixTests.swift`, `ios/app/T2DTests/PlateTests.swift`

**Interfaces:**
- Produces: `Mixer.rows(current: Int?) -> [Mixer.Key]` (текущий мир первым, затем остальные по порядку, затем `master(.lpf/.thr/.ratio/.ceil)`); `Mixer.visibleRows = 6`; прокрутка вертикальная, фейдер тянется горизонтально.

- [ ] **Step 1: Failing tests:** `testMixRowsCurrentFirst`, `testMixRowsOnMapKeepOrder`, `testVerticalDragScrollsHorizontalDragMovesFader`, `testDoubleTapFaderResetsDefault`, `testMuteRingSendsZeroFader`, `testMasterSectionReachableByScroll`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Реализовать** вкладку на `Mixer.value`, `Mixer.draw` и `Mix`; жест решается по первому смещению (порог `Touch.slop`): вертикаль — скролл, горизонталь — фейдер.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `ios: mix tab`.

### Task 6: Вкладка sys

Риск: обычный — три переключателя на готовых действиях.

**Files:**
- Modify: `ios/app/T2D/Host/Plate.swift`, `ios/app/T2D/Host/Host.swift`
- Test: `ios/app/T2DTests/PlateTests.swift`

**Interfaces:**
- Consumes: `restartAudio()`, `toggleStable()`, `toggleMidi()` (из бывших `panelDown`).
- Produces: строки `stable audio`, `restart audio`, `midi clock`, `shared tempo` (неактивна, как сейчас).

- [ ] **Step 1: Failing tests:** `testSysStableToggles`, `testSysRestartCallsCallback`, `testSysMidiToggles`, `testSysSharedTempoDisabled`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `ios: sys tab`.

### Task 7: Удаление старого и документы

Риск: обычный — удаление мёртвого кода под тестами, документация.

**Files:**
- Delete: `Host/AudioPanel.swift`, `Host/Concordia.swift`, страница микшера, их тесты в `HostTests.swift` (:837–922, :1133–1238 и экранные тесты микшера)
- Modify: `docs/native-ios-plan.md`, `ROADMAP.md` (бэклог микшера → сделано / заменено), `docs/ios-2b-deferred.md`, `CLAUDE.md` (Horologium принят автором), `README.md` (только если описывает нативное меню), `docs/tokens.md`; сцены `ios/app/shot.sh`: `header`, `plate-fx`, `plate-mix`.

- [ ] **Step 1:** удалить файлы, убрать `Settings`, `settings`, `audioPanel`, `volTap`; `xcodegen` + полный прогон тестов — PASS.
- [ ] **Step 2:** `ios/app/shot.sh header`, `plate-mix` — посмотреть агентом `shots`.
- [ ] **Step 3:** обновить доки, строка в `docs/tokens.md`.
- [ ] **Step 4: Commit** `ios: remove concordia and audio panel; docs`.

### Task 8: Приёмка автором

- [ ] `ios/app/install.sh`; автор проверяет на iPhone: хедер в мире и на карте, vol канала мира и мастера, play (тап / вбок), recycle + undo на карте, плашка (fx, scale, mix со скроллом, sys), солнце неактивно, выход свайпом. После приёмки — план для веба.

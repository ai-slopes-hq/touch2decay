# touch2decay — заметки для Claude

Эзотерический дрон/нойз-синтезатор для мобильного Safari (iPhone), одна страница без сборки: `index.html` + `app.js` и `host/` (Web Audio + canvas 2D, без зависимостей) + `sw.js` (офлайн) + `fonts/`. Референс по духу — SOMA Lyra-8 и Forge TME Vhikk X. Пользовательская документация — `README.md` (по-русски), планы — `ROADMAP.md`.

Деплой: GitHub `ai-slopes-hq/touch2decay`, ветка `main` → Vercel выкатывает сам. Статус деплоя: `gh api repos/ai-slopes-hq/touch2decay/commits/$(git rev-parse HEAD)/status --jq .state`.

## Как работать с автором

- Пишет по-русски, коротко, с опечатками; отвечать по-русски, кратко и по делу. Названия на экране — по-английски или латынью (миры), без русского текста в интерфейсе.
- Проверяет всё сам на iPhone по продовому адресу Vercel. **Не делать превью-артефакты** — он смотрит деплой. После правки: коммит → пуш → дождаться `success` → коротко рассказать, что поменялось.
- Любит, когда сразу делают; спрашивать только когда развилка действительно его (дизайн-решение, которое легко сделать «не так»). Предложения — списком из нескольких вариантов с рекомендацией.
- Важно ему: «не шумно», красиво и информативно одновременно, удобно одной рукой, не лагает.
- Я ни разу не видел, как это работает на реальном iPhone, — всё проверено в headless Chromium. Говорить об этом честно.

## Дизайн-принципы

- **Стиль — гравюра со старой звёздной карты.** Тонкие линии (hairline), двойные рамки, засечки, звёзды-гравюры, созвездия, меридианы. Без заливок «по-приложенчески», без градиентов ради градиентов.
- **Мир I · Tenebrae — строго ч/б** (`INK = 237,237,237` на чёрном). Цвет — только у других миров (`theme`) и у индикатора нагрузки (красный).
- **Два шрифта** (`fonts/`, SIL OFL): красивое — поле, карта, названия миров — **IM Fell English**; где читают — легенда, плашки, панель LFO, concordia, микшер — **EB Garamond** (автор; `READ`, переключатель `face`, обёртка `reading(fn)` у функций рисования панелей). В интерфейсе прямой (`text()`), в подписях — курсив (`mapText()`). Жирного нет — акцент яркостью. Моноширинные шрифты не возвращать.
- **Картинка = информация.** Всё, что рисуется, что-то значит: контур планеты — её звук (осциллограмма по кругу), двойная звезда внутри — биения detune, спутники — LFO (орбита по параметру, размер — глубина, след — форма), нити связей — модуляция (частицы бегут от источника, скорость — частота), солнце дышит громкостью, туманности/эхо/жар — общие FX.
- **Не шумно.** Новые эффекты — по умолчанию едва заметны, проявляются при действии (перетаскивание, зум, выкрученные FX). Подписи на поле — только пока тянешь кружок или щиплешь зум.
- Кнопки — тонкие кружки на тёмной подложке в верхней строке. Корзина = убрать всё (не крестик — путался с «закрыть»).

## Миры — подробности в `docs/worlds/`

**Перед работой с миром прочитай его файл** (там жесты, звук, функции, тесты). Меняешь поведение мира — обновляй его файл, а не этот.

| № | Мир | Код | Заметки |
|---|---|---|---|
| I | Tenebrae — планеты вокруг солнца, морф-таблицы, связи, LFO | `app.js` | `docs/worlds/tenebrae.md` |
| II | Cymatica — пластина/ханг, полиритм ритм × места | `worlds/cymatica/`, звук и часы — ядро C++ `core/worlds/cymatica` → `t2d.wasm` (слот 2) | `docs/worlds/cymatica.md` |
| III | **выключен** (`HIDDEN` в `app.js`) · Laboratorium — FM-дрон как Lyra-8, колбы и трубки | `laboratorium.js` | `docs/worlds/laboratorium.md` |
| IV | Natura — секвенсер-река, кувшинки | `worlds/natura/` | `docs/worlds/natura.md` |
| V | Inferno — шумы + резонаторы, девять кругов | `worlds/inferno/` | `docs/worlds/inferno.md` |
| VI | Paradisus — хор ангелов, форманты, собор | `worlds/paradisus/` | `docs/worlds/paradisus.md` |
| VII | Monochordum — Карплус — Стронг, страм, ветер, автострам | `worlds/monochord/`, `monochord-worklet.js` | `docs/worlds/monochordum.md` |
| VIII | Oceanus — сканирующий синтез, карта T-O, луна | `worlds/oceanus/`, `ocean-worklet.js` (обёртка), ядро C++ `core/worlds/oceanus` → `ocean.wasm` | `docs/worlds/oceanus.md` |
| IX | Horologium (Nova) — волшебные числа: кольца II…IX, n ударов за оборот на n-й гармонике (Rhythmicon), унтертоны, фаза, маятник руками, ритм → аккорд за limen | `worlds/horologium/`, `horo-worklet.js` | `docs/worlds/horologium.md` |
| X | Firmamentum — пульсарный синтез, свод (**образец model / engine / view**) | `worlds/firmamentum/` (model.js — фасад, engine.js — склейка), модель и звук — ядро SDK C++ `core/worlds/firmamentum` → `t2d.wasm` (слот 10 в `t2d-worklet.js`; Cymatica — слот 2) | `docs/worlds/firmamentum.md` |
| XI | Tria corpora — задача трёх тел, FM по кругу | `worlds/tria/` | `docs/worlds/tria.md` |
| XII | Arcadia — wave terrain, страна в псевдоперспективе, кубик — новая страна | `worlds/arcadia/`, `terrain-worklet.js` | `docs/worlds/arcadia.md` |
| XIII | Portus — dub techno: одна дорожка-фарватер на 16 шагов (кораблик — удар, поперёк — нота), аккорд и октава −2…+2 у маяка, луна-фильтр, буй-эхо, туман-ревер, небо гасит эхо | `worlds/portus/` | `docs/worlds/portus.md` |
| XV | **выключен** (`HIDDEN`, 30.10) · Goetia — bytebeat: печать от знака к знаку — формула, дух встаёт в треугольник (до трёх), медный сосуд — карта | `worlds/goetia/`, `goetia-worklet.js`; в ветке `native` DSP — ядро C++ `core/worlds/goetia` → `goetia.wasm` | `docs/worlds/goetia.md` |
| XVII | **в бэклоге** (`HIDDEN`, вход в DLC закрыт `DLC_ON = false`) · Prisma (**DLC vol. I**) — аддитивный: луч сквозь призму, 16 лучей-гармоник | `prisma.js` | `docs/worlds/prisma.md` |
| XVIII | **в бэклоге** (`HIDDEN`) · Vitrea — Harmonica vitrea (**DLC vol. I**): трение по ободу бокалов, вода — высота | `vitrea.js` | `docs/worlds/vitrea.md` |

Карта Universum (поле 4 × 4, 13 миров и три рубашки; **вторая колода — DLC vol. I** (XVII, XVIII; сейчас закрыта: `DLC_ON = false`, миры в `HIDDEN`), переключение — 7 тапов по UNIVERSUM, свой микшер, `CELL`, эмблемы `emblemFor`, звучащие карты в лучах, concordia — общий лад, темп и микшер), выход стрелкой и свайпом от левого края — `docs/worlds/map.md`. Миры I–IV автор считает законченными.

## Устройство (общее)

- **Выключенные миры** — `HIDDEN` (сейчас III, XV, XVII, XVIII — III, XVII, XVIII с 22.10, XV с 30.10; IX вернулся как Horologium Nova): `registerWorld` их не регистрирует (`hiddenW`), на карте рубашки, нет в микшере, звуке, легенде; `t2d.go(n)` для них — `false`, сценарии `lab`, `horologium`, `goetia` пропускаются (`t2d.hidden`). Номера не отдавать. Вернуть — убрать номер из `HIDDEN`.

- **Все файлы миров и `app.js` — ES-модули** (без IIFE, `<script type="module">` в `index.html`; выполняются по порядку тегов, после разбора страницы). `window.T2D` / `window.t2d` пока глобальные. Версия для `addModule` worklet-ов — `VER` из `import.meta.url` (`document.currentScript` в модулях нет). Переход на model / engine / view — `docs/refactor-plan.md`.
- `host/` — сервисы и экраны хоста (шаги 2–3 рефакторинга), импортирует их только `app.js` (и они друг друга, без циклов), миры по-прежнему берут всё через `window.T2D`: `util.js` (`clamp`, `lerpLog`, `inBox`, `$`), `fonts.js` (`MAP`, `READ`, `face`, `reading`), `draw.js` (холст `cv`/`g`, `W/H/DPR`, `scopeY`/`safeBot` и `fitCanvas()`, тема `INK/BG/PAPER` и `setTheme`, `ink`, `ring`, `dot`, `text`, `mapText`, `hairBox`, `glowAt`, `drawCurve`, `sunGlyph`, `quarterSun`), `scale.js` (`SCALES`, `scl`, `NOTES`, `inScale`, `snapSemi`, `scalePCs`, `retune` — мир I перестраивает высоты, ставит `setRetune`), `registry.js` (`worlds`, `nav`, `cur`, `registerWorld`, `HIDDEN`, `ENTER`, `onRegister`), `undo.js` (`hists`, `lasts`, `commit`, `undo(retune)`), `audio.js` (контекст `ctx`, `build()` — мастер и каналы `chans`, затем `w.build(ctx, chanIn)` каждого мира, Tenebrae первым — `solBuild`; микшер `mix`, громкость `vol`/`setVol`, `hall`, `restartAudio`, `unlock`, узлы `gainNode`/`filter`/`lfo`), `touch.js` (пальцы `F`, `TAP_MS`, `DTAP_MS`, `HOLD_MS`), `waves.js` (`WAVES`, `morphFn`, `morphName` — таблицы волн для звука Tenebrae, рисования и LFO).
  Экраны (шаг 3): `ui-top.js` (верхняя строка: `btnPos`, `backPos`, `sclList`, `drawUI`, `drawVol`, `headHit`/`btnHit`, `titleW`, `markDice`), `sl.js` (модель LFO строк, без DOM), `sheet.js` (плашка FX / мира: `fxSheet`/`setFxSheet`, `fxGeo`, `sheetHit`/`sheetDown`/`sheetMove`/`sheetUp`, `drawFxSheet`, `drawSlPanel`, пад `PAD_IN`/`shapeT`/`padRate`/`padDepth`), `legend.js` (`LEGEND`, `legenda`/`setLegenda`, `drawLegenda`), `strain.js` (нагрузка; живость графа даёт мир I — `setGraphLoad`), `deck.js` (колоды `DECKS`, `CELL`, `field`, `cellRect`, `mapWorlds`), `concordia.js` (`link`, `perScl`, `tempoFrom`, `settingsBox`/`drawSettings`/`settingsDown`), `mixer.js` (`mixGeo`, `drawMixer`, `mixDown`/`mixMove`), `map.js` (`WORLDS`, `goMap`, `goWorld`, `navDown`, `emblemFor`, `cardBack`, `drawNav`), `midi.js` (внешние MIDI-часы: сетка долей, `T.midiGrid`, `stepTime`/`due`, пуск/стоп и темп мирам с `tempo`; оболочка зовёт `window.t2dMidi`; разбор байтов часов — `clockParser`), `webmidi.js` (компьютер, Android: Web MIDI → те же сообщения, строка *midi clock* в панели audio, `audioPref.midi`; на iPhone Web MIDI нет), `clock.js` (метроном секвенсоров: `onTick` — подписчиков зовут таймер 25 мс и `clock-worklet.js` из звукового потока, `startClock(ctx)` в `build`, `clockLive`), `audio-panel.js` (тап по громкости — панель audio: `audioPanel`, `panelHit/Down/Move`, `volTap`, `drawAudioPanel`; *stable* — `toggleStable` из concordia). Изменяемые `let` (`ctx`, `W`, `INK`, `face`, `vol`, `undoAt`, `fxSheet`, `legenda`, `titleW`…) меняет только их модуль — снаружи импорт только читается (менять — `setFxSheet`, `setLegenda`…).
- `app.js` — роутер касаний (`down`/`move`/`up`, `uiHit`/`uiDown`/`uiMove`/`uiUp`: хостовые ветки зовут `headHit`, `btnHit`, `sheet*` и т. п.), кадр `frame`, события, `window.T2D`/`window.t2d` — и весь мир I. Секции помечены `// ---------- … ----------`.
- **Ядро SDK и общие ревербы (23.10):** `t2d.wasm` (C++, `core/bridge` + `core/host` + `core/sdk` + миры SDK; пока только Firmamentum) крутит один узел `t2d-worklet.js` на `AudioContext` (`buildCore` в `host/audio.js`, на каждый новый контекст — новый узел; всегда, не лениво). В нём **четыре общих ревербера — room, plate, hall, cathedral**: у миров своего `hall()` больше нет (раньше до 16 залов в Web Audio, на этом висел iPhone). Мир на Web Audio шлёт в них через `T.send(rev)` → `GainNode`, усиление = фейдер мира (`applyMix` ведёт его, `restartAudio` пересобирает); посыл идёт **после** фейдера, возврат ядра (×0.9) — в мастер до компрессора. Тип по умолчанию: Cymatica — plate, Paradisus — cathedral, Portus — по `fog.size` (room / hall / cathedral, смена перекрёстным затуханием ~50 мс), остальные — hall; длина хвоста у типа фиксированная (ручек «decay / size / aether» на звук не осталось — они только рисуют). Коэффициент посыла — прежний `rev²·K` с учётом `out` мира **после** возврата зала (у Firmamentum ×2.5, Monochordum ×2.2…): так баланс сухого и мокрого не поплыл. Новый мир на Web Audio: `T.send('hall')` в `build`, `T.hall()` нет.
- **Реестр миров:** `worlds`, `registerWorld(n, w)`, `cur()`; интерфейс мира — `title, sub, corner {hit, draw}, fx | null {sectors, get, set, text, arc, save, load}, tick?, draw, down, move, up, wheel?, dice, clear, snapshot, restore, sounding, enter?, leave?, tempo? {get, set, play?, playing?, min?, max?}` (часы мира: общий темп concordia и панель audio; есть у Cymatica, Natura, Horologium, Monochordum, Portus). Tenebrae — объект `solNiger` поверх своих функций (`solTick`, `solDraw`, `solDown/Move/Up`). Касание принадлежит миру, где началось (`f.world`). У каждого мира своя отмена (`hists`, `lasts`). Миры из других файлов получают `window.T2D` (регистрация, `g`, `W/H/DPR`, `topY`, `safeBot`, `level`, `ink`, `ring`, `dot`, `text`, `glowAt`, `hairBox`). Карта: снимок мира при уходе (`snaps`); у мира с `mapShot(on)` (III, IV) снимок перерисовывается без солнца — на карте солнце одно, в центре. **Предмет в углу каждого мира — участник сцены, не ярлык** (солнце, резонатор Гельмгольца).
- **Тема мира** — `theme: { ink, bg, paper }` (`setTheme` в `frame`; подложки — `paper()` вместо чёрного), у Natura — сепия.
- Новый мир: папка `worlds/<мир>/` по контракту ниже (или, по-старому, файл `.js` с `T2D.registerWorld`), `<script type="module">` на `index.js` в `index.html`, файлы в `MODULES` (worklet — в `WORKLETS`) в `sw.js`, клетка в `CELL` и `EMB_LINE`, эмблема — ветка в `emblemFor`, сценарий в `tools/shot.py`, заметки — `docs/worlds/<мир>.md`, строка в таблице выше.
- Плашки: `T2D.openSheet({title, hint, rows, get, set, text, lfo?})`; FX мира — `world.fx` (плашка FX — `fxSheet`).
- **Портретная сцена на широком экране:** Natura (`stage()`, `sh(f)` — сдвиг касаний, рисование с `translate(ox)`, по бокам бумага), Inferno и Paradisus (ширина `Ws = min(W, 0.62·H)`, всё по центру `cx`) — на iPad и компьютере не растягиваются. Проверять: Playwright 1280×800 и 820×1180. `tools/render.py --world 3…6` — касание мимо всего включает звук, дальше js (например `t2d.par.dice()`).
- Отладка из консоли: `window.t2d` — `go(n)` (в мир без касаний), у миров свои: `t2d.cym`, `t2d.lab`, `t2d.nat`, `t2d.inf`, `t2d.par`, `t2d.mono`, `t2d.ocean`, `t2d.horo`, `t2d.firm`, `t2d.tria`, `t2d.arc`, `t2d.portus`, `t2d.goe`, `t2d.prisma`, `t2d.vitrea`.

## Мир из модулей: model / engine / view (утверждено на шаге 4, образец — `worlds/firmamentum/`)

Миры переезжают из одного файла в `worlds/<мир>/` (порядок — `docs/refactor-plan.md`). Зачем: под нативный iOS алгоритм, звук и картинка должны лежать отдельно.
- **`model.js`** — `createModel({ scale, rng, …метрики })` → `{ state, действия (addStar, moveStar, setFx, dice, clear…), tick(dt), snapshot(), restore(js), sounding(), listen(fn) }`. Только данные и алгоритм: **нет DOM, холста, Web Audio, `window.T2D`, `performance.now()`, `Math.random` напрямую**. Время — секунды через `tick(dt)` (склейка считает `dt` из `now` кадра, без обрезки), случайность — `rng`, лад — `scale { on, snap }`. Если алгоритму нужна экранная мера (комета задевает звёзды в 90 px), её даёт склейка чистой функцией (`place(sky) → {x, y}`). Что должно прозвучать — **синхронные события** слушателям: `{ t: 'star', s, on, added? }`, `'fp'`, `'ff'`, `'fx'` (у секвенсеров — расписание шагов, см. ниже). `state` — живые объекты (`t2d.<мир>` и view читают их напрямую), меняет их только модель. Снимок — тот же JSON, что был.
- **`engine.js`** — `createEngine(T, model, ver)` → `{ build(ctx, chanIn), start(), on(event), listen(fn), ready, …метры }`. Единственное место с Web Audio: шина, посыл в общий зал `T.send('hall')` (ядро), worklet (`addModule('…?v=' + ver)`, `ver` — из `import.meta.url` у `index.js`). `build` хост зовёт на каждом новом `AudioContext` (`restartAudio`), `start` — лениво (первая звезда, вход в мир). `on(event)` — событие модели → узлы / сообщение worklet (без опроса каждый кадр). Обратно — метры (`gains`, `counts`) для чтения и `listen` — что услышано (вспышки, пылинки) для view. `model.state` только читает.
- **`view.js`** — `createView(T, model, engine)` → `{ theme, corner, fx, legend, down, move, up, tick(now), draw(now), heard(e), mapShot }`; геометрия — чистые функции модуля (`geo(T)`, `fromSky`). Касание → действие модели, **никогда не трогает звук**; от engine — только метры. Плашки (`T.openSheet`), FX-веер, легенда — здесь; `get/set` идут в модель.
- **`index.js`** — склейка: `model.listen(engine.on)`, `engine.listen(view.heard)`, побочное для хоста (`T.lfoClear` при закрытии звезды — слушатель модели), `T.registerWorld(n, {…})` (методы — замыкания, без `this`), `window.t2d.<мир>` (тот же набор, что был, плюс `model`). В `index.html` — тег на `index.js?v=`, части — без `?v=` (одна строка адреса на модуль), в `MODULES` в `sw.js`. Worklet пока лежит в корне (путь `addModule` — от страницы).
- **Тесты модели** — `tools/models/<мир>.test.mjs` (Node, импорт `model.js` как есть; `seeded(n)`, `near` — `tools/models/util.mjs`). У каждого мира — его алгоритм (Firmamentum: слоты, fp/ff и limen, лад, комета, drift; Arcadia: одно зерно — одна страна; Goetia: печать → программа; Monochordum: узор автострама; Tria: восьмёрка держится, энергия; Oceanus: слоты, высота, лад; Inferno: высота кругов, лёд τ 6 / 3 с, буря, грешники; Paradisus: высота, форманты, chime планет, зёрна gloria), плюс снимок → restore и кубик с зерном.
- **Отклонения, принятые на шаге 5:** у мира без «услышанного» engine может не иметь `listen` (Goetia, Oceanus — view читает метры); что пришло из worklet и нужно модели (энергия струн Monochordum, центры петель Arcadia), кладёт в модель **склейка** (`engine.listen(h => model.…)`), а не engine; состояние касания (рисуемая печать Goetia) — во view, склейка сбрасывает его в `clear` / `restore`.
- **Миры на узлах (шаг 6, Inferno, Paradisus):** узлы — только в engine (`N[k]`, `Map` голосов), не в состоянии модели; «голос собран» модель узнаёт от склейки (Paradisus: `a.sung` через `model.voiced` — от него Gloria, chime, свечение). Где мир шагал по `dt` кадра с обрезкой 0.05 с, так и осталось (иначе после паузы Gloria сыпала бы пачку зёрен). То, что раньше пересчитывалось раз в N мс каждый кадр (буря, лёд Inferno, дрейф гласной Paradisus), — событие модели раз в N с её времени.
- **Секвенсеры (шаг 7, Horologium, Portus, Natura, Cymatica):** модель говорит, *что* играет шаг и *сколько* он длится (как автострам Monochordum: `autoStep(step)` / `stepDur(step)`; Portus — `nextGap`, swing; Natura — `stepNote(step)`, `voice(pd)`; шанс — через `rng`), **часы — в engine** (`ctx.currentTime`, `T.onTick` — таймер 25 мс и метроном из worklet, запас 200 мс, опоздавший шаг пропускается) или **в worklet**, где они уже были (Cymatica — узор целиком сообщением `seq`, его собирает чистая `seqMessage` в `worlds/cymatica/core.js`; Horologium — колесо). `seq.next` / `seq.step` — в engine (`t2d.<мир>.seq` — геттеры), бегунок на экране — метр engine. Сыгранный шаг (`step` из worklet, `{note, at}`, удар эха) — «услышано» → view (вспышки, утки, лягушка); время касания для записи игрой (`recordHit`, `nearestStep`) view передаёт в модель параметром.

## SDK звука: что взять, что положить (лукап перед работой со звуком)

Перед любой работой со звуком мира (перенос в C++, баг в DSP, новый блок) — сверка с SDK, до кода:
1. **Что уже есть** — `core/sdk/` (список ниже) и `core/host/`. Решения автора и вопросы — `docs/sdk-inventory.md` §8–9.
2. **Что у мира** — строка мира в матрице `docs/sdk-inventory.md` §6 и его блоки в §2 (колонка «один блок?»).
3. В ответе автору — коротко: **берём** из SDK …, **кладём** в SDK …, **остаётся** в мире ….

**Брать** (не копировать формулу в мир): блок есть в `core/sdk/` — использовать его; близкие константы мира — параметрами блока, звук не меняется (решение 4). Зал — только посыл в общий ревербер хоста (`Out.sL/sR` + `rev()` у мира SDK, `T.send(rev)` на Web Audio), своего `hall()` нет. Лад — `const Scale&` хоста. Случайность — `sdk::Rng` от зерна (`prepare(sr, seed)`), никакого `Math.random`/`rand()`.

**Класть** в SDK: блок помечен в инвентаризации «да» / «да·п», нужен 2+ мирам (или общий для хоста), в `core/sdk/` его нет. Правила блока: header в `core/sdk/`, `namespace sdk`, без аллокаций в `process` (память — внешний буфер или внутри объекта), без DOM / Web Audio / UI; константы — параметры конструктора, умолчание — как у первого мира; тест в `core/tests/sdk_test.cpp`; миры, которые на него переходят, проходят свою сверку 1e-6 без изменений. Потом — строка в список ниже и в `core/README.md`.

**Не класть**: «нет» / «своё» из §6 (пластина Cymatica, bytebeat, окна пульсаров, мост струн…) — в `core/worlds/<мир>/`; паритет-хелперы (`jsRound`, `f32()`) — не в блоки (§7); картинку и раскладку `mirror` — у мира; блоки выключенных миров (III, XVII, XVIII) — отложены (решение 8). Сомнение «блок или мир» — спросить автора вариантами.

**В `core/sdk/` сейчас (23.10):** `Biquad` (семантика Web Audio, Q в дБ у LP/HP), `DcBlock{R}`, `OnePole` (сглаживание / гейн голоса вверх-вниз), `softclip(x, k)` = tanh, `panLin(p, spread)`, `Delay` + `Allpass` (внешний буфер, линейная интерполяция), `Rng` (mulberry32, бит в бит с эталоном JS), `Reverb` = `Fdn4` (room / hall / cathedral) + `Plate` (Dattorro), `Resonator` (двухполюсный, `ResCoef` по T60 / τ), `Knee` (колено выхода), `StepClock` (часы секвенсера в сэмплах: шаг, MIDI-замок, пропуск), `Json` (снимки, не для `process`), интерфейс `World` (`prepare / action / process / rev / mirror / heard / snapshot / restore / sounding`). Хост (`core/host/`): миры по слотам, посыл × фейдер → четыре ревербера, `Scale`. **Ещё нет** (кандидаты из инвентаризации): модальный банк, `BpBank`, `Phasor` и чтение таблиц, `WaveTables` (морф 9 таблиц), `DetuneStack`, `Shaper`, `AD`/`Param` (таймлайн AudioParam), `PingPong`/лента/хорус, `KsLoop`, `EnergyMeter`/`BlockTimer`, `Transport`, `RowLfo`. Добавил или убрал блок — поправь этот список.

## LFO в плашках миров (хост: модель — `host/sl.js`, плашка и панель — `host/sheet.js`)

`SL` — список LFO строк `{id, key, base, spec {morph, rate, depth, ph}, u, sd, get, set, shapes}`; плашка с `spec.lfo {id, keys, shapes: 'classic' | 'random'}` (FX — `world.fx.lfo {keys, shapes}`, id `fx<n>`; свои плашки — `T.openSheet({…, lfo})`) показывает у строк из `keys` «~» (как `slfo` у планеты). `slTick` — фаза каждый кадр, `set(key, base ± depth/2·fn)` ~30 Гц; classic — `morphFn` (таблицы WAVES), random — `RND_SHAPES` (ramp up/down, steps, smooth; случайное — `hash(sd + номер периода)`). Касания: `sllfo` (тап по «~»: панель `fxSheet.lfoKey`), `slstrip` (полоса форм / пад: `shapeT`, `padRate`, `padDepth`), `sloff`; тянешь строку с LFO — двигаешь `base`. Рисование: «~», размах и точка на строке, `drawSlPanel` (копия панели планеты). `T.lfoClear(prefix)` — снять LFO предмета (корзина ветра Monochordum, закрытая звезда). Тесты: `t2d.sl()`, `t2d.slOpen()`, `t2d.slAdd(key)` (LFO на строку открытой плашки), `t2d.fxGeo()`. `T.lfoBase(id, key)` — база LFO строки или `null` (предмет стоит на базе, качание — другим признаком). Тест модели — `node --test tools/test-models.mjs`. **chance в веере** — во всех мирах с шагами: Cymatica, Natura, Monochordum (автострам), Horologium, Portus.

## Телефон: экран, выход звука

- Экран держит общий сторож (`setInterval` 1 с): звучит любой мир — `wake()` (Wake Lock), минута тишины — отпустить; ещё `wake()` на каждом `touchstart` (Safari хочет касание). Раньше лок снимался каждый кадр, если в Tenebrae тихо, — в других мирах экран гас. `mediaSession.metadata` — имя мира.
- `restartAudio()`: снимки миров (кроме Tenebrae) → `build()` (новый `AudioContext`, голоса Tenebrae пересобираются) → `old.close()` → `restore` снимков → `enter()` текущего и звучащих миров (модули worklet заводятся заново; в `build` Cymatica — `started = false`). Зовётся на `mediaDevices.devicechange` (800 мс) и из concordia (*restart audio*). `audioPref.stable` (localStorage `t2d-audio`) — `latencyHint: 'playback'`. Сценарий `shot.py audio`.

## Производительность (важно — на iPhone лагало)

- Молчащий мир отцеплен от выхода (`setLive` в `laboratorium.js` и engine Natura, через 7–9 с тишины): его хор и задержка не считаются — меньше нагрузки и треска (зал — общий, в ядре; он считается всегда). Анализатор (`AnalyserNode`) держит цепь живой — цеплять его только вместе с выходом.
- Ноты по расписанию: огибающая доходит до тишины (`exponentialRampToValueAtTime` + линейно в 0) раньше `stop`; опоздавшие ноты пропускать — задним числом щёлкают; запас планировщика 200 мс. Планировщик будит `T.onTick`, не свой `setInterval`: в фоне (экран заблокирован, другое приложение) iOS будит таймеры раз в секунду — шаги пропадали; звук и метроном `clock-worklet.js` в фоне идут.

- Холст не плотнее 2× (`DPR`). **Никакого `shadowBlur`** — свечение широким бледным штрихом. Градиенты — не каждый кадр: спрайт `glowSprite` + `glowAt`.
- Фон, звёзды, рамка и орбиты — одна непрозрачная картинка `bgLayer`, пересобирается только при смене зума/лада/размера. Не добавлять в кадр полноэкранных проходов.
- Громкость без перегруза: потолок мастера — `knee(k, 0.6, 0.98)` (прямая до колена, выше мягко), выход пластины — `outKnee` в worklet (прямая до 0.8). Сплошной tanh на выходе давал хрип Cymatica (искажения до −16 дБ на нижних нотах у края). Мерить: офлайн-рендер, энергия вне линий спектра пластины.
- Звук: не держать подключёнными генераторы, которые не слышны (см. `useTables`, `shifterOn`). Неактивные голоса отцеплены от шины (`n.live`).
- Мерить: `tools/render.py` (время офлайн-рендера — сравнивать версии), headless fps не равен iPhone (там программная растеризация).

## Выкладка — обязательно

- При каждой выкладке поднимать **вместе** `CACHE` в `sw.js` и `?v=` у всех модулей в `index.html` (одно число; у всех тегов — заменой по `?v=`). Иначе на телефоне залипнет старая версия. Сервис-воркер: страница и код — сначала из сети, кеш — без сети; новая версия подхватывается при возврате в приложение, страница перезагружается, когда ничего не звучит.
- Новые файлы, нужные офлайн, — в списки `HOST` / `MODULES` / `WORKLETS` / `STATIC` в `sw.js`. Импорты `host/` — без `?v=` (одна строка адреса на модуль, иначе два экземпляра состояния); свежесть даёт сервис-воркер (код — из сети мимо HTTP-кеша).
- README обновлять вместе с поведением (по-русски, в духе существующего текста). Коммиты — по-английски, по делу, с телом-списком.
- `node --check app.js` и `host/*.js` перед коммитом.
- В конце чата — строка в `docs/tokens.md` (дата, мир / задача, что сделано, токены ≈), в том же коммите, что и итоговые доки.

## Проверка

`python3 -m http.server 8765` в корне, затем:

- `core/build.sh && node --test tools/test-goetia-core.mjs tools/test-firm-core.mjs tools/test-ocean-core.mjs` — сверка ядер с эталоном (render-cli и WASM, 1e-6), около минуты.
- `python3 tools/shot.py <сценарий>` (solniger, vol, planets, ring, worlds, sun, hole, legenda, startmap, audio и по сценарию на мир, в том числе arcadia и portus — см. `docs/worlds/`) — сценарии касаний (CDP touch, 390×844) с проверками (провал или ошибка на странице — код выхода 1), скриншоты в `.shots/` — **смотреть их глазами** (Read на png).
- `python3 tools/render.py ["()=>{…}"] [--world 2] [--onsets]` — офлайн-рендер звука (Tenebrae или удар по пластине Cymatica), RMS и время расчёта; `--onsets` — узор из 4 ударов на 120 BPM, интервалы между ударами и разброс (было 0.68 мс).
- `node --test tools/test-plate.mjs` — тесты звука пластины в Node (через `vm`, без зависимостей). Помощники секвенсера Cymatica (бывший `test-seq.mjs`) — в `tools/models/cymatica.test.mjs`.
- `node --test tools/test-models.mjs tools/models/*.test.mjs` — тесты моделей: хоста (LFO строк) и миров из `worlds/` (с шага 4 рефакторинга).
- Нужен Playwright: `pip install playwright && playwright install chromium`. В системном python его нет — временный venv в scratchpad (`/opt/homebrew/bin/python3 -m venv pw && pw/bin/pip install playwright`), браузеры уже в `~/Library/Caches/ms-playwright`.
- Нестабильно само по себе (и до модулей): сценарий `tria` проходит лишь в 20–50 % прогонов (двойной тап по летящему телу; LFO *steps* на gravitas — окно 1.2 с против периода ~2.5 с), `triaenergy` изредка (кубик сводит тела в тесную пару) — сравнивать вперемежку со старой версией, по 10 прогонов; `render.py` для секвенсеров (Portus) и Firmamentum гуляет на ±5–20 % от прогона к прогону — сравнивать по нескольким прогонам, состояние задавать `restore(снимок)`, а не `dice()`.

## Уже решено и отвергнуто (не возвращать без запроса)

- Тап = постоянный кружок + корзина сверху для удаления — неудобно; вернули «касание = звук, двойной тап = закрепить».
- Кольцо, которое надо держать двумя пальцами, — заменено булавкой в центре кольца.
- Щипок по планете для громкости — «не поймать»; громкость — полоса amp в опциях.
- Карманы/зоны для LFO на поле, отдельные слайдеры LFO — заменены панелью с XY-падом.
- Глаза-индикатор нагрузки — «слишком смешные»; теперь маленький Сатурн.
- Осциллограф сверху — «дешевит», убран (уровень для солнца считается без рисования).
- Волны-строки на фоне как оси — некрасиво; теперь орбиты, звёзды, подписи при перетаскивании.
- HUD с частотой и надписи на поле в покое — нет.
- Cymatica: одна длина на ритм и мелодию (нота = место удара) — убило полиритм; ритм и мелодия-места снова раздельной длины.
- Arcadia: рельеф изолиниями сверху, как топокарта, — «инфузория под микроскопом»; теперь гравюра в псевдоперспективе, как Natura. Portus: солнца ночью нет — луна в углу; острова по очереди (прогрессия по тактам) — «одни и те же ноты по кругу», потом 16 лучей от фонарей — «не понимаю»; теперь один фарватер, как река Natura; аккорд только у маяка, кораблик — нота.
- Защита нагрузки по частоте кадров — путала энергосбережение (30 к/с) с перегрузкой, урезала голоса; убрана.

## Дальше

**С 22.10 миры заморожены** (автор): новых не делаем, имеющиеся не меняем — только баги и рефакторинг. **Цель — нативное iOS-приложение** (AUv3, Link, фон, MIDI, многоканально в USB-интерфейс, Torso S-4): миры по одному переносятся в C++, веб остаётся главным, пока не перенесены все. План — **`docs/native-plan.md`**.

Рефакторинг веба (`docs/refactor-plan.md`): шаги 1–7 сделаны (v165) — все миры, кроме Tenebrae и выключенных, лежат в `worlds/<мир>/` как model / engine / view, это и есть шов «ядро ↔ view» для переноса; шаг 8 (Tenebrae) и 9 — по мере надобности переносу (см. `docs/native-plan.md`).

См. `ROADMAP.md`: наполнить миры II–IV (Cabbala — модальный синтез: 10 сфирот = 10 мод, 22 пути = связи; Rosarium — FM на 4 операторах-стихиях; Regnum — VA + ревербы/делеи), сохранение сцен, запись, второй хостинг (GitHub Pages / Yandex Object Storage). Первым делом — узнать у автора, как оно на iPhone после оптимизации.

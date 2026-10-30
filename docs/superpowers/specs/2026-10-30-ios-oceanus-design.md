# iOS-приложение — фаза 3: Oceanus на Swift

**Дата:** 2026-10-30 · **Статус:** дизайн согласован с автором («go»), ждёт ревью файла · **Фаза:** `docs/native-ios-plan.md`, фаза 3 (миры по одному) · **Образец:** `ios/app/T2D/Firmamentum/`, спеки 2b — `2026-10-30-ios-2b3a-map-design.md`, `2026-10-30-ios-2b3b-concordia-design.md`

## Цель

Второй нативный мир — VIII · Oceanus: картинка, касания, плашки, веер FX с LFO и легенда на Swift + CoreGraphics; модель и звук — уже в ядре (`core/worlds/oceanus/`), Swift только разбирает зеркало и шлёт действия. Попутно — то, без чего второй мир не встаёт: LFO строк FX в ядре Oceanus, форма `classic` на паде, вход в мир (`enter`), ступени лада для картинки, правило лада для двух миров, повёрнутый курсив.

**Goetia в натив не переносим** (автор, 30.10): остаётся только в вебе; в `docs/native-ios-plan.md` порядок фазы 3 — без неё.

Готово, когда: на iPhone автора Oceanus открывается с карты, звучит при входе, касания и плашки работают как в вебе, LFO на веере FX слышно и видно (полоса `classic` на паде); пары снимков симулятор ↔ веб (`sc_oceanus`) сходятся; лад после перезапуска приложения — по правилу ниже; проверки ниже зелёные.

## Решения

1. **Всё как в вебе** (`worlds/oceanus/view.js`, `model.js` — только картиночные константы): геометрия, подписи, числа, жесты, пороги. Новых решений в картинке нет. Шрифты — как в вебе (`mapText` — IM Fell курсив, `text` — EB Garamond, плашки в `reading`).
2. **Где код:** `ios/app/T2D/Oceanus/` — `Mirror.swift` (разбор зеркала), `Geo.swift` (`geo`, `polar`, `at`, `surf`, `moonPos`), `OceanusView.swift` (класс `World`: тема, легенда, касания, рисование), `Sheets.swift` (плашки Луны и города, веер FX). Регистрация: `Worlds.swift` слот 8 `view: true`, `App.makeView` — ветка `8`.
3. **Зеркало** (`core/worlds/oceanus/world.hpp:28-30`, `world.cpp:71-87`): `fx[5]` (порядок ядра `TENSION, DAMPING, WIND, TIDE, HALL`), `luna[4]` (`ORBIT, STORM, SWAY, TO`), `moon` (доля круга), `shape[64]`, число городов, затем по 10 чисел на город: `slot, id, ang, rn, pinned, lvl, oct, path, hz, gain`. Кольца heard нет (`heard()` = 0). Читатель зеркала — внедряемый, как у Firmamentum (тесты — на фейке).
4. **Действия** (`world.hpp:14-26`) — через `Core.action(slot 8, …)`: `ADD 0 [ang, rn, pinned, slot, id]`, `DROP 1`, `MOVE 2`, `SET 3 (i=id, [key, v])`, `FX 4 (i=key)`, `LUNA 5 (i=key)`, `PUSH 6 [fingerId, a, d]`, `RELEASE 7`, `SPLASH 8 [a, amt]`, `CLEAR 9`, `DICE 10`, `WAKE 11`. Id новых городов выдаёт Swift: `max(id в зеркале, выданный) + 1`, как `issued` у Firmamentum (`FirmamentumView.swift:303-312`). Город, правленный или убранный здесь, но ещё не увиденный в зеркале, рисуется по своему, а не по зеркалу (аналог `dirty` / `gone` в `model.js:31`).
5. **Касания** (`view.js:38-112`):
   - тап по суше — временный город; двойной тап (`DTAP_MS`, ≤ 34 px) по пустой суше — оставленный город (до `PIN_MAX` 4); двойной тап по оставленному — отпустить (`DROP`);
   - город тянется — нота (`MOVE`);
   - вода — толкнуть (`PUSH` / `RELEASE`); не сдвинул и < 220 мс — всплеск (`SPLASH`) и рябь;
   - удержание Луны (r 26) `HOLD_MS·0.6` — плашка Луны; удержание оставленного города `HOLD_MS` — его плашка;
   - угол — четверть солнца (`sunGlyph(-π/2, 0)`, как `FirmamentumView.swift:273`), ведёт на карту.
6. **Плашки и веер** (`view.js:88-105, 250-258`):
   - Луна: `orbit`, `storm` (двоичный), `pull` (= `fx.tide`), `sway`, `to` (3 значения: `tension / pitch / damping`) — без LFO, как в вебе;
   - город: `lvl`, `oct` (−1…1), `path` (`orbis / retro / pendulum`) — без LFO, как в вебе;
   - веер FX: порядок секторов `tension, damping, tide, wind, hall`, `arc: fx.hall`, LFO на всех пяти, шейпы `classic`. **Код строки LFO — по индексу FX ядра, не по порядку на веере** (tide → `TIDE`, wind → `WIND`); у Firmamentum FX-строки — `code: NKEY + idx` (`Firmamentum/Sheets.swift:12`), у Oceanus — так же от `NKEY = 4`.
7. **LFO в ядре Oceanus** — `case sdk::ACT_LFO` в `core/worlds/oceanus/world.cpp` по образцу `firmamentum/world.cpp:43-56`: `i == −1`, `key ∈ [NKEY, NKEY + 5)` → `setFx(key − NKEY, v)`; прочее (объекты, чужие ключи) — пропуск. Веб это не задевает (там LFO Oceanus идёт через JS `model.setFx`), но правка `core/` → пересобрать `t2d.wasm` (`core/build.sh`, хук проверит). Объектных LFO у Oceanus нет — `objGone` не нужен.
8. **Форма `classic` на паде** (`Host/SheetDraw.swift`) — по `host/sheet.js:143-150`: полоса из 9 форм `WAVES` во всю ширину (кривые — `lfoSample(shape: 0, morph: i/8)` или `Draw.drawCurve`), рамка выбора по непрерывному `morph`. Ветка `random` (4 значка) — как есть. Звук `classic` ядро уже умеет (`core/sdk/lfo.hpp`), `SheetLfo.shape` уже пробрасывается.
9. **Вход в мир** — в протокол `World` добавляется `func enter()` (по умолчанию пусто); хост зовёт его в `goWorld` после смены мира и при старте прямо в мире. Oceanus шлёт `WAKE` — иначе кольцо спит до первого города или касания (`world.cpp:26, 50, 57`), как веб `enter: model.wake`.
10. **Лад для картинки.** Стене нужны ступени лада (длинные риски на нотах лада) и тоника. Новый вызов C-ABI `t2d_app_scale_steps(idx, out[7])` поверх `Scale::stepsOf` (`core/host/scale.hpp:8`) — таблицы ладов в Swift не дублируем. Мир получает текущий лад от хоста: в протокол `World` — `func scale(_ s: Scl)` (по умолчанию пусто), хост зовёт при каждой смене лада и при входе. Код только в `core/app/` → коммит с `[no-wasm]`.
11. **Правило лада для двух нативных миров** (закрывает `docs/ios-2b-deferred.md:107`; веб сцен и лада не хранит — копировать нечего):
    - `link.scale == true` (по умолчанию): лад один на всё — хранится в `prefs.json` (необязательное поле `scl`, версия остаётся 1); на старте берётся оттуда; лад из файлов сцен игнорируется;
    - `link.scale == false`: при старте `perScl[слот]` заполняется из сцены каждого мира; текущий лад — лад мира, в котором стартуем (на карте — из prefs);
    - «последний восстановленный мир побеждает» (`Host.swift:502-517`) уходит.
12. **Повёрнутый курсив** — `Draw.mapText(…, angle:)` (по умолчанию 0) через `CGContext` translate/rotate: «Mare Magnum» и 8 ветров на стене.
13. **Производительность** (правила `CLAUDE.md`):
    - стена (румбы, рамка, T-O, надписи, риски нот) — `CGImage`, ключ `W×H×scale|cy|ступени|root`;
    - свечение голосов — кеш спрайтов glow (как `glowAt`), только при `gain > 0.05`;
    - пена — 44 штриха, сидированный `rng` (в вебе `Math.random`, `view.js:161`) — картинка детерминирована для снимков;
    - рябь — до 12, 1.3 с; подписи нот и климата — только пока палец на поле;
    - никакого `shadowBlur`, никаких полноэкранных проходов в кадре.
14. **Не делаем:** LFO на плашках Луны и города (их нет в вебе), сброс двойным тапом на строке плашки (`SheetSpec.reset` — нужен только Natura, остаётся в `docs/ios-2b-deferred.md`), Goetia.

## Проверка

- **Ядро:** C++ тест на `ACT_LFO` Oceanus (FX-строка меняет `fx` и зеркало; obj ≥ 0 и чужой ключ — без изменений; порядок tide / wind); `core/tests` зелёные; `core/build.sh && node --test tools/test-ocean-core.mjs` и `node --test tools/models/oceanus.test.mjs` — зелёные (веб не меняется).
- **C-ABI:** `t2d_scale_steps` — тест на все 6 ладов против `host/scale.js`.
- **Swift** (`ios/app/T2DTests/OceanusTests.swift` на фейковом зеркале, по образцу `FirmamentumTests`): разбор зеркала; касания → действия (тап, двойной тап, перенос, толчок, всплеск, удержания); выдача id; коды строк веера по индексу ядра; `enter` шлёт `WAKE`. В `HostTests`: правило лада (связан / не связан, старт в мире / на карте), `enter` и `scale` зовутся хостом.
- **Снимки:** сцены `-shot oceanus`, `oceanus-sheet`, `oceanus-luna`, `oceanus-fan` (веер с полосой `classic`) против веба `sc_oceanus` (`tools/shot.py:1259`) — агент `shots`.
- **iPhone:** автор ставит `ios/app/install.sh`.

## Ограничения

- Снимки — симулятор; звук и производительность проверяет только автор на iPhone.
- `classic` на паде появится и у Firmamentum, если у его строк выбрать эту форму (сейчас у него `random`) — поведение не меняется.

## Доки

`docs/native-ios-plan.md` (фаза 3: Goetia — только веб, Oceanus сделан), `docs/ios-2b-deferred.md` (правило лада — закрыто, `classic` — сделан), `docs/worlds/oceanus.md` (раздел про натив), `docs/architecture.md` / `core/README.md` (`enter`, `scale`, `t2d_app_scale_steps`), строка в `docs/tokens.md`.

# Миры: таблица и карта

Полная таблица миров (вынесена из `CLAUDE.md`, 26.10). Сменился статус, код или файл мира — правь здесь и короткую таблицу в `CLAUDE.md`.

**Перед работой с миром прочитай его файл** (там жесты, звук, функции, тесты). Меняешь поведение мира — обновляй его файл.

| № | Мир | Код | Заметки |
|---|---|---|---|
| I | Tenebrae — планеты вокруг солнца, морф-таблицы, связи, LFO | `app.js` | `docs/worlds/tenebrae.md` |
| II | Cymatica — пластина/ханг, полиритм ритм × места | `worlds/cymatica/` (model.js — фасад), модель, смычки, звук пластины, часы, эхо и гул резонатора — ядро SDK C++ `core/worlds/cymatica` → `t2d.wasm` (слот 2; в вебе остались касания и картинка) | `docs/worlds/cymatica.md` |
| III | **выключен** (`HIDDEN` в `app.js`) · Laboratorium — FM-дрон как Lyra-8, колбы и трубки | `laboratorium.js` | `docs/worlds/laboratorium.md` |
| IV | Natura — секвенсер-река, кувшинки | `worlds/natura/` (model.js — фасад над моделью в ядре, этап 2 · v186: действия — в ядро по одному, зеркало ~60/с, state правят только методы), звук (пять band-limited волн, фильтр с огибающей, шина: срез дерева → хор `sdk::Chorus` моно → лента `sdk::TapeEcho` → зал hall, кораблик, лазер, лягушка, шелест) и часы шагов (`sdk::Steps`, свой темп или сетка MIDI) — ядро SDK C++ `core/worlds/natura` → `t2d.wasm` (слот 4); engine.js — тонкая склейка; эталон прежней JS-модели и движка — `tools/ref/natura-model.js`, `natura-engine.js` | `docs/worlds/natura.md` |
| V | Inferno — шумы + резонаторы, девять кругов | `worlds/inferno/` (model.js — фасад, engine.js — сухой выход и зеркало), модель и звук — ядро SDK C++ `core/worlds/inferno` → `t2d.wasm` (слот 5) | `docs/worlds/inferno.md` |
| VI | **в архиве** (`HIDDEN`, 23.10: нужен хороший шиммер и гранулярный ревербер — потом, дотошно) · Paradisus — хор ангелов, форманты, собор | `worlds/paradisus/` | `docs/worlds/paradisus.md` |
| VII | Monochordum — Карплус — Стронг, страм, ветер, автострам | `worlds/monochord/` (model.js — фасад), модель, струны и автострам — ядро SDK C++ `core/worlds/monochord` → `t2d.wasm` (слот 7) | `docs/worlds/monochordum.md` |
| VIII | Oceanus — сканирующий синтез, карта T-O, луна | `worlds/oceanus/` (model.js — фасад), модель и звук — ядро SDK C++ `core/worlds/oceanus` → `t2d.wasm` (слот 8) | `docs/worlds/oceanus.md` |
| IX | Horologium (Nova) — волшебные числа: кольца II…IX, n ударов за оборот на n-й гармонике (Rhythmicon), унтертоны, фаза, маятник руками, ритм → аккорд за limen | `worlds/horologium/` (model.js — фасад с маятником), колесо, кольца, ход и замок к такту — ядро SDK C++ `core/worlds/horologium` → `t2d.wasm` (слот 9) | `docs/worlds/horologium.md` |
| X | Firmamentum — пульсарный синтез, свод (**образец model / engine / view**) | `worlds/firmamentum/` (model.js — фасад, engine.js — склейка), модель и звук — ядро SDK C++ `core/worlds/firmamentum` → `t2d.wasm` (слот 10 в `t2d-worklet.js`) | `docs/worlds/firmamentum.md` |
| XI | Tria corpora — задача трёх тел, FM по кругу | `worlds/tria/` (model.js — фасад: следы, вспышки, кубик), физика (шаг — блок звука), аспекты, дрон и колокола на `sdk::Param` — ядро SDK C++ `core/worlds/tria` → `t2d.wasm` (слот 11; первый мир на узлах Web Audio) | `docs/worlds/tria.md` |
| XII | Arcadia — wave terrain, страна в псевдоперспективе, кубик — новая страна | `worlds/arcadia/` (model.js — фасад, своя `genLand` для картинки), страна, странники, звук и шина — ядро SDK C++ `core/worlds/arcadia` → `t2d.wasm` (слот 12) | `docs/worlds/arcadia.md` |
| XIII | Portus — dub techno: одна дорожка-фарватер на 16 шагов (кораблик — удар, поперёк — нота), аккорд и октава −2…+2 у маяка, луна-фильтр, буй-эхо, туман-ревер, небо гасит эхо | `worlds/portus/` (model.js — фасад), модель (кораблики, луна, эхо, буй, туман, маяк, лад), звук (стабы на `sdk::Saw`, шина, эхо `sdk::PingPong`, туман, море) и часы шагов (`sdk::Steps`, свой темп или сетка MIDI) — ядро SDK C++ `core/worlds/portus` → `t2d.wasm` (слот 13); engine.js — тонкая склейка | `docs/worlds/portus.md` |
| XV | Goetia — bytebeat: печать от знака к знаку — формула, дух встаёт в треугольник (до трёх), медный сосуд — карта | `worlds/goetia/` (model.js — фасад), модель, звук и эхо — ядро SDK C++ `core/worlds/goetia` → `t2d.wasm` (слот 15) | `docs/worlds/goetia.md` |
| XVII | **в бэклоге** (`HIDDEN`, вход в DLC закрыт `DLC_ON = false`) · Prisma (**DLC vol. I**) — аддитивный: луч сквозь призму, 16 лучей-гармоник | `prisma.js` | `docs/worlds/prisma.md` |
| XVIII | **в бэклоге** (`HIDDEN`) · Vitrea — Harmonica vitrea (**DLC vol. I**): трение по ободу бокалов, вода — высота | `vitrea.js` | `docs/worlds/vitrea.md` |

Карта Universum (поле 4 × 4, 14 миров и две рубашки — сейчас видно 13: VI в архиве; **вторая колода — DLC vol. I** (XVII, XVIII; сейчас закрыта: `DLC_ON = false`, миры в `HIDDEN`), переключение — 7 тапов по UNIVERSUM, свой микшер, `CELL`, эмблемы `emblemFor`, звучащие карты в лучах, concordia — общий лад, темп и микшер), выход стрелкой и свайпом от левого края — `docs/worlds/map.md`. Миры I–IV автор считает законченными.

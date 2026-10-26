# Universum — имя, иконка, описание (App Store)

Решено с автором 26.10.2026: имя **Universum**, иконка — солнце. Описание — не «дрон и нойз», а набор миров разного синтеза.

## Имя

- Под иконкой (`CFBundleDisplayName`): **Universum**.
- В App Store: **Universum Synth** (для поиска; одно слово «Universum» — слишком общее). Свободно ли — видно только в App Store Connect при создании записи, не проверено.
- Подзаголовок (≤ 30 знаков): **Esoteric synthesis worlds** (25). Запасной: *A map of playable sound worlds* (30).
- Категория: Music. Возраст: 4+.
- Ключевые слова (≤ 100 знаков, 92): `synth,synthesizer,drone,ambient,noise,generative,modular,dub techno,fm,midi,experimental,sequencer,wavetable`

## Иконка

Солнце из `host/draw.js` (`sunGlyph`): двойной диск, 28 лучей, прямые и волнистые через один, тонкое кольцо-рамка. Строго ч/б (как Tenebrae), 1024 × 1024, без прозрачности и скруглений (маску ставит iOS). Линии толще, чем в приложении (11 px против 7): на 60 pt hairline пропадает.

- Исходник: `ios/icon/make-icon.py` → `ios/icon/icon.svg`, `ios/icon/AppIcon-1024.png`.
- Отвергнуты: планета-осциллограмма (знак одного мира); орбиты с засечками (на малом размере сливаются в мишень, как прежняя иконка веба).
- Тёмный и тонированный варианты iOS 18+: иконка уже монохромная, отдельных ресурсов не нужно (проверить на устройстве).
- Веб-иконки (`icon-180/192/512.png`, манифест) пока прежние — менять только по просьбе автора: веб остаётся сайтом.

## Описание (English)

> Universum is a deck of playable worlds, each one a different kind of sound. Drones and noise, strings and bells, polyrhythms, dub techno, bytebeat — laid out on a map like a Tarot spread and drawn as engravings from an old star chart.
>
> Touch to sound. Hold to pin. Drag to bend. Nothing is labelled until you reach for it.
>
> • Tenebrae — planets circle a black sun: wavetable drones, FM bridges, LFO moons
> • Cymatica — a Chladni plate struck by a polyrhythmic astrolabe
> • Natura — a river of water lilies: a step sequencer
> • Inferno — noise through resonators, nine circles deep
> • Monochordum — plucked and bowed strings, an Aeolian wind
> • Oceanus — a scanning-synthesis sea on a medieval map
> • Horologium — clockwork gears: n beats on the n-th harmonic
> • Firmamentum — pulsar synthesis under a vault of stars
> • Tria corpora — three bodies in an FM orbit
> • Arcadia — wave terrain: walkers on a living landscape
> • Portus — a harbour of dub techno: echo, fog, a lighthouse
> • Goetia — bytebeat, written in sigils
>
> Worlds keep playing while you wander the map; one shared scale, tempo and mixer tie them together. Follows external MIDI clock. Plays in the background and through USB audio interfaces.

## Описание (по-русски)

> Universum — колода играбельных миров, и у каждого свой звук. Дроны и шум, струны и колокола, полиритмы, дабтехно, bytebeat — всё на карте, как расклад Таро, и нарисовано гравюрами со старой звёздной карты.
>
> Касание — звук. Удержание — закрепить. Тяни — гни. Подписей нет, пока не потянешься.
>
> Двенадцать миров: Tenebrae (планеты вокруг чёрного солнца), Cymatica (пластина Хладни и астролябия), Natura (река-секвенсер), Inferno (шум сквозь резонаторы), Monochordum (струны и Эолов ветер), Oceanus (сканирующий синтез), Horologium (часовой механизм), Firmamentum (пульсарный синтез), Tria corpora (три тела), Arcadia (wave terrain), Portus (дабтехно-гавань), Goetia (bytebeat).
>
> Миры звучат, пока ты бродишь по карте; общий лад, темп и микшер. Ведомый по MIDI-часам, звук в фоне, USB-аудиоинтерфейсы.

## Проверить перед релизом

- «Twelve»: посчитано по таблице миров в `CLAUDE.md` (I, II, IV, V, VII–XIII, XV; III, VI, XVII, XVIII выключены). Если число изменится — поправить.
- Последний абзац обещает MIDI-ведомого, фон и USB: убирать пункт, который не войдёт в релиз.
- Скриншоты для App Store — по готовому приложению, не раньше.

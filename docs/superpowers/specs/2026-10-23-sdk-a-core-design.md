# SDK, подпроект A: ядро — интерфейс мира, блоки, хост, ревербы, мост; пилот — Firmamentum

Утверждено с автором 23.10. Основание — `docs/sdk-inventory.md` (инвентаризация блоков и раздел 9 «Решения автора»). Цель всего SDK: AUv3 для AUM (у заинтересованных Torso и Elektron, хотят нормальный синк), ядро DRY/KISS, новые миры собираются из блоков SDK, а не пишутся с нуля на JS-аудио.

## Решения автора (23.10), на которых стоит A

- AUv3 — один мир на экземпляр; синк — ведомые от хоста; мастера в AUv3 нет; параметры хосту не отдаём (только снимок состояния в проект).
- **Мир = модель + звук на C++.** Модель живёт в ядре (с закрытым окном AUv3 комета, drift, LFO не замирают); JS только рисует и шлёт касания.
- Близкие константы — параметры одного блока, звук миров не меняется.
- **Ревербы — send FX в хосте, а не на мир:** четыре типа — `room` (~0.8 с), `plate` (~2 с, Dattorro), `hall` (~3.5 с, нынешний `hall()`), `cathedral` (~8 с, тёмный). Мир выбирает тип и шлёт посыл; в приложении ревербов всегда 4, в экземпляре AUv3 — свой (подпроект C). Paradisus — на `cathedral` (свёртка уходит). Позже — пятый тип `shimmer` (октава вверх в петле), Paradisus просится на него.
- Случайность — `Rng` с зерном везде, в игре зерно случайное.

## Объём A

1. `core/sdk/` — блоки, нужные пилоту и ревербам.
2. `core/sdk/world.hpp` — интерфейс мира.
3. `core/host/` — хост: миры, посылы после фейдера, четыре ревербера, лад.
4. `core/worlds/firmamentum/` — пилот: модель и звук на SDK.
5. `core/bridge/wasm.cpp` → **`t2d.wasm`** (один модуль на хост и все миры SDK) + `t2d-worklet.js` (один worklet) + фасад модели в JS.
6. Веб: все миры, ещё живущие на Web Audio, вместо своего `T.hall()` шлют посыл в ревербы ядра — 16 залов в Web Audio исчезают (сейчас на этом виснет iPhone).

**Вне A:** Goetia и Oceanus на SDK (B; их `goetia.wasm` / `ocean.wasm` пока живут как есть), транспорт секвенсеров (с первым секвенсером), AUv3 (C), остальные миры (D), мастер в ядре, выбор типа реверба в интерфейсе (пока — тип по умолчанию у мира).

## Блоки `core/sdk/` (C++17, header-only, без аллокаций в `process`, `-ffp-contract=off`)

| файл | что | откуда (инвентаризация) |
|---|---|---|
| `rng.hpp` | `Rng` mulberry32 (переезжает из `core/common`) | все |
| `smooth.hpp` | `OnePole{c}` (`y += (x−y)·c`), `Smooth{up, down}` (разные коэффициенты на подъём и спад) | все worklet |
| `dc.hpp` | `DcBlock{R}` — `R` параметр (было жёстко 0.995) | X, XII, IX, XV |
| `clip.hpp` | `softclip(x, k) = tanh(k·x)` | 6 worklet |
| `pan.hpp` | `panLin(p, spread)` → `(1−p)/2, (1+p)/2` | 5 миров |
| `delay.hpp` | `Delay` (кольцевой буфер, дробное чтение — линейно), `Allpass` | ревербы, дальше — эхо, KS |
| `biquad.hpp` | `Biquad` по формулам Web Audio (lowpass, highpass, allpass, bandpass; Q в дБ у LP/HP, как в браузере) | ревербы, дальше — 12 миров |
| `reverb.hpp` | `Fdn4` (Householder, 4 линии, модуляция задержек, демпфирование, входные HP/LP и allpass-ы — как `host/audio.js` `hall()`), `Plate` (Dattorro); `Reverb` — тип + параметры | хост |
| `json.hpp` | минимальный JSON (объект, массив, число, строка) — снимки | все миры |

`core/common/` упраздняется: `rng.hpp`, `dc.hpp` переезжают в `core/sdk/` (Goetia и Oceanus — правка путей `#include`, звук не трогаем).

Параметры ревербов (стартовые, дальше — на слух автора): `room` — `Fdn4`, размер 0.9, T60 0.8 с, демпфирование ярче; `hall` — `Fdn4` ровно как нынешний `hall()` (длины `0.0297/0.0371/0.0411/0.0437 × 2.4`, вход HP 280 / LP 7500, allpass 430 / 1150 / 2400 / 4300, демпфирование `6000 − i·500`, модуляция `0.13 + 0.07·i` Гц на 0.9 мс), T60 3.5 с; `cathedral` — `Fdn4`, размер 2.4 × 1.8, T60 8 с, темнее, предзадержка 40 мс; `plate` — Dattorro (параметры статьи, decay ~2 с). Возврат каждого — с усилением 0.9 (как у миров сейчас).

## Интерфейс мира — `core/sdk/world.hpp`

```cpp
namespace sdk {
enum class Rev { room, plate, hall, cathedral };
struct Out { float* L; float* R; float* sL; float* sR; };   // сухое стерео и посыл (в ревербер rev())
class World {
 public:
  virtual ~World() = default;
  virtual void prepare(double sr, uint32_t seed) = 0;
  virtual void action(int kind, int i, const double* a, int n) = 0;   // касания и ручки от UI (коды — у мира)
  virtual void process(const Out& out, int n) = 0;                     // n ≤ 128; время модели идёт здесь
  virtual Rev rev() const = 0;                                          // куда идёт посыл
  virtual int mirror(double* buf, int cap) const = 0;                   // зеркало состояния для UI; раскладка — у мира
  virtual int heard(double* buf, int cap) = 0;                          // что услышано (вспышки) с прошлого вызова; очищает
  virtual std::string snapshot() const = 0;                             // JSON — тот же, что был у model.js
  virtual void restore(const std::string& js) = 0;
  virtual bool sounding() const = 0;
};
}
```

Правила: `process` пишет `out.*` целиком (не прибавляет); посыл — уже с ручкой мира (у Firmamentum — `hall² · 1.5`), фейдер микшера применяет хост. Время модели — в сэмплах `process`, шаг модели — раз в блок (128 сэмплов, 2.7 мс при 48 кГц): там, где JS-модель шагала по кадрам, пороги времени (`> 0.1 с` у drift) работают так же. `action` и `process` — в одном потоке (в вебе — worklet; в натив — звуковой поток через очередь, C). `snapshot` / `restore` в вебе — в потоке worklet (редко); в натив — разбор вне звукового потока (C).

## Хост — `core/host/host.hpp`

`Host { prepare(sr, seed); add(slot, World*); action(slot, kind, i, a, n); process(n) → выходы; fader(slot, g); scale(on, idx, root); }`:
- для каждого мира — сухой выход отдельно (в вебе — в его канал микшера, как сейчас); посыл × фейдер мира (посыл после фейдера: заглушил мир — хвост дозвучит) → в `Reverb` по `rev()`;
- четыре `Reverb` (room, plate, hall, cathedral) → один стереовыход возврата;
- внешние посылы (веб, переходный период): четыре стереовхода — по одному на тип — для миров на Web Audio, суммируются с посылами миров SDK;
- лад: `scale(on, idx, root)` и `snapSemi(s)` — порт `host/scale.js` (`SCALES`, `inScale`, `snapSemi` — один в один); миры читают лад у хоста.

## Пилот — Firmamentum на SDK

`core/worlds/firmamentum/`: `model.hpp|.cpp` (порт `worlds/firmamentum/model.js`: звёзды, слоты, `fp`/`ff` с ладом хоста, drift, комета, кубик, снимок — тот же JSON), `sound.hpp|.cpp` (нынешний `pulsar.cpp` на блоках SDK: `Smooth`, `DcBlock{0.995}`, `softclip(·, 0.7)`, `panLin`), `world.cpp` (`class Firmamentum : sdk::World`).

- **Комета без экрана:** расстояние до звезды — в координатах свода `place(s) = {x: s.u, y: −s.h · K}`, порог `R`; `K` и `R` подобраны так, что на 390×844 (`geo(T)` Firmamentum) это те же 90 px. На других экранах радиус кометы — чуть другой (принято).
- `rev()` — `hall`; посыл — `fx.hall² · 1.5`; прежняя подстройка хвоста `1.5 + hall·5` уходит (решение «send FX»).
- Коды `action`: `add(h, u, slot, id)`, `close(id)`, `move(id, h, u)`, `set(id, key, v)` (cyc, win, mask, lvl, h, u), `fx(key, v)`, `clear`, `dice`, `launch`. Раскладка зеркала: `time, comets, comet{a.h, a.u, b.h, b.u, t0, dur | none}`, затем на звезду `slot, id, h, u, cyc, win, mask, lvl, dr, cm, fp, ff`. События: пульсареты (`slot`), треск (`pan, a`), вспышки (`slot`) — как нынешнее `{pulsed, dust, bolts}`.

## Мост и веб

- **`t2d.wasm`** — хост, блоки, Firmamentum; экспорты на все миры: `t2d_init(sr, seed)`, `t2d_action(slot, kind, i, ptr, n)`, `t2d_process(n)`, буферы выходов, `t2d_mirror(slot)`, `t2d_heard(slot)`, `t2d_snapshot(slot)` / `t2d_restore(slot)` (строка через буфер), `t2d_fader(slot, g)`, `t2d_scale(on, idx, root)`. Без импортов, как `goetia.wasm`.
- **`t2d-worklet.js`** — один узел: выход на каждый мир SDK (сейчас — один, Firmamentum) и выход возврата ревербов; четыре стереовхода внешних посылов. Порт: внутрь `action`, `fader`, `scale`, `snapshot?`, `restore`; наружу ~60 раз в секунду — зеркала и события миров. Очередь до готовности, `ready` / `err` — как у обёрток сейчас.
- **Хост в JS (`host/audio.js`):** узел ядра создаётся в `build()` (на каждом новом контексте); возврат ревербов — в мастер (до компрессора); `T.hall()` заменяется на `T.send(rev)` → вход ядра нужного типа, через усиление = фейдер мира (посыл после фейдера); `applyMix` шлёт фейдеры и в ядро (миры SDK). `pulsar-worklet.js` и `pulsar.wasm` удаляются.
- **Фасад модели `worlds/firmamentum/model.js`** — прежний API (`state`, `fp`, `ff`, `LIMEN`, `cometAt`, `addStar` … `listen`): `state.stars` — те же живые объекты (по `id`, правятся на месте из зеркала — view держит ссылку на звезду под пальцем); `addStar` сразу кладёт звезду в зеркало (слот — первый свободный, как в ядре) и шлёт `add` со слотом и `id`; `snapshot` — из зеркала синхронно (нужно `restartAudio`), `restore` — в ядро. `engine.js` Firmamentum становится тонким: события ядра → `view.heard`, метры `counts`/`gains` — из зеркала.
- **Миры на Web Audio** (Tenebrae `app.js`, Cymatica, Natura, Inferno, Paradisus, Monochordum, Horologium, Tria, Arcadia, Portus, Goetia, Oceanus; выключенные — тоже, чтобы не ломались): `T.hall()` → `T.send(rev)`; посыл — прежняя формула (`hall² · K`), подстройка хвоста `lines[].g` убирается. Тип по умолчанию: Cymatica — `plate`; Paradisus — `cathedral` (свёртка и её обратная связь уходят); Portus — по `fog.size` (< 0.33 `room`, < 0.66 `hall`, иначе `cathedral`); остальные — `hall`.

## Проверка

- **Блоки:** тесты в Node против WASM-сборки тестового модуля или нативно через render-cli: `Biquad` — против формул Web Audio (АЧХ в точках), `Fdn4` в режиме `hall` — устойчивость (энергия затухает, T60 ± 10 %), `Plate` — T60, без `NaN`/денормалов на тишине.
- **Звук пилота:** сухой выход Firmamentum из `t2d.wasm` против эталона `tools/ref/pulsar-worklet.js` — 1e-6 на все сценарии `tools/firm-scenarios.mjs` (звук не поменялся при переходе на блоки и на модель в ядре: сценарии гонят звук через `action`, а не через прежние `voice`-сообщения — переписываются под действия модели).
- **Модель:** `tools/models/firmamentum.test.mjs` проходит против ядра (через фасад над WASM в Node, `tick(dt)` → `process` на `dt·sr` сэмплов); плюс сверка «JS-модель ↔ модель ядра»: одно зерно, одна последовательность действий, шаг 128 сэмплов — состояние (звёзды, `dr`, `cm`, комета) совпадает до 1e-9 (JS-модель — с той же функцией `place` в координатах свода).
- **Веб:** `shot.py firmamentum audio` и сценарии всех миров зелёные (посыл вместо зала не ломает их), без ошибок на странице; `render.py` — время офлайн-рендера до/после (ожидание — меньше: 4 ревербера вместо 16).
- **На iPhone (автор):** превью `native` — Firmamentum звучит как раньше (кроме зала), несколько миров с ревербом сразу — не виснет.

## Выкладка

Ветка `native`, превью, «ок» автора → `main`. `CACHE` / `?v=` — следующее число за продом. В `sw.js`: `t2d.wasm`, `t2d-worklet.js` — в `WORKLETS`; `pulsar.wasm`, `pulsar-worklet.js` — убрать. Документы: `core/README.md`, `docs/worlds/firmamentum.md`, `docs/native-plan.md` (новый порядок фаз: SDK → B → AUv3 → остальные миры), `CLAUDE.md` (раздел про ядро и `T.send`).

## Риски

- Фасад модели: view держит ссылки на звёзды и ждёт синхронного ответа — решено зеркалом с живыми объектами по `id`; гонка «касание — зеркало» (звезда закрыта в ядре, пока палец её держит) — фасад сверяет по `id`, как сейчас `stars.includes`.
- Звук залов меняется у всех миров (решено автором); первый отзыв — на слух.
- Один worklet на хост: сбой ядра глушит все миры SDK (сейчас — один). Ошибка загрузки — `console.error`, миры на Web Audio продолжают звучать без реверба.

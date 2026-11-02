// LFO строк плашек — медленные модуляторы, которые вешают на строку плашки (объект мира или его FX).
// Порт host/sl.js. Хост держит таблицу из LFO_MAX ячеек RowLfo; фаза u бежит каждый блок, независимо
// от кадров UI, значение считается по форме в момент запроса (RowLfo::value).
//
//   WaveMorph CLASSIC — 9 форм-таблиц (waveforms.hpp: triangle, sharp, saw, pulse, fold, sync, crush, metal,
//                       grain); morph 0…1 перетекает между соседними формами треугольными весами
//                       (host/waves.js: weight / morphFn).
//   WaveMorph RANDOM  — 4 формы без таблиц: рампа вверх, рампа вниз, ступени, сглаженные ступени.
//                       Ступени — от зерна и номера периода (host/sl.js: RND_SHAPES): при том же seed те же.
//
// ЛОВУШКИ:
//   - u — фаза в периодах БЕЗ обрезки, растёт всё время: random берёт номер ступени из целой части.
//     Обрежешь u — ступени станут другими.
//   - value зажимает результат в [0, 1]: base у края и большая depth — LFO «упирается» в край.
//   - WaveMorph CLASSIC при создании строит таблицы (9 × 1024 float, ~37 КБ): создавай один раз, не в process.
// Цена sample: classic — одно-два чтения таблиц; random — fmod, у ступеней ещё sin-хеш, у сглаженных — cos.
#pragma once
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace sdk {

constexpr int LFO_MAX = 64;                               // ячеек в таблице LFO хоста (фиксированная, без аллокаций)
constexpr int LFO_REC = 10;                               // чисел на один LFO в снимке (Host::lfoState)
constexpr int LFO_OBJS = -2;                              // obj ≥ 0 — объект мира, −1 — строка мира (FX), −2 — «все объекты» (Host::lfoDrop)

class WaveMorph {
 public:
  enum Shape { CLASSIC, RANDOM };
  WaveMorph(Shape s = CLASSIC);
  double sample(double morph, double phase, int seed = 0) const;   // −1…1; phase — u без обрезки, seed — для random

 private:
  Shape shape_;
  static constexpr int N = 1024;                        // сэмплов на цикл формы
  float tables_[9][N]{};
  void initClassic();
  static double hash(int n);                            // псевдослучайное −1…1 от целого (sin-хеш, как в шейдерах)
};

// Ячейка таблицы LFO хоста. Значение модулятора — clamp(base + depth·0.5·форма(u), 0, 1), как slTick в вебе.
struct RowLfo {
  bool on = false;                                      // ячейка занята
  int slot = 0;                                         // мир (слот ядра)
  int obj = LFO_OBJS;                                   // объект мира (звезда …), −1 — строка мира, LFO_OBJS — все объекты
  int key = 0;                                          // какая строка плашки (параметр)
  int shape = WaveMorph::CLASSIC;
  double base = 0.5;                                    // центр, 0…1 — положение ручки
  double morph = 0;                                     // форма, 0…1
  double rate = 0.8;                                    // периодов в секунду
  double depth = 0.3;                                   // размах: от base ± depth/2
  double u = 0;                                         // фаза в периодах, без обрезки
  int seed = 0;                                         // зерно ступеней random

  double value(const WaveMorph& w) const;
};

}  // namespace sdk

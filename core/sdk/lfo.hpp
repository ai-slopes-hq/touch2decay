// LFO на строках плашек миров — порт host/sl.js. Живут независимо от кадров UI: фаза бежит каждый блок, значение
// считается по форме в момент запроса. Морфинг classic — треугольные веса (host/waves.js: weight/morphFn);
// random — рампы, шаги и сглаживание от зерна по периоду (host/sl.js: RND_SHAPES).
#pragma once
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace sdk {

constexpr int LFO_MAX = 64;                               // таблица LFO хоста (фиксированная, без аллокаций)
constexpr int LFO_OBJS = -2;                              // obj ≥ 0 — объект мира, −1 — строка мира (FX); −2 — «все объекты» (Host::lfoDrop)

// Морфинг волн для LFO: 9 форм (triangle, sharp, saw, pulse, fold, sync, crush, metal, grain), morph 0…1.
class WaveMorph {
 public:
  enum Shape { CLASSIC, RANDOM };
  WaveMorph(Shape s = CLASSIC);
  double sample(double morph, double phase, int seed = 0) const;   // phase = u без обрезки (периоды), seed — для random
 private:
  Shape shape_;
  static constexpr int N = 1024;
  float tables_[9][N];                                  // 9 циклов × 1024 сэмпла
  void initClassic();
  void initRandom();
  static double hash(int n);
};

// LFO строки: ячейка таблицы хоста. on=false — пустая. obj — объект мира (звезда), −1 — строка мира.
struct RowLfo {
  bool on = false;
  int slot = 0, obj = LFO_OBJS, key = 0, shape = WaveMorph::CLASSIC;
  double base = 0.5, morph = 0, rate = 0.8, depth = 0.3, u = 0;
  int seed = 0;

  double value(const WaveMorph& w) const;               // clamp(base + depth·0.5·форма(u)), как slTick
};

}  // namespace sdk

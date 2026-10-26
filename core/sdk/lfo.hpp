// LFO на строках плашек миров — порт host/sl.js. Живут независимо от кадров UI: фаза бежит каждый блок process, значение
// считается по форме в момент запроса. Морфинг форм — как в host/waves.js: треугольная интерполяция между 9 циклами.
#pragma once
#include <cmath>
#include <string>

namespace sdk {

// Морфинг волн для LFO: 9 форм (triangle, sharp, saw, pulse, fold, sync, crush, metal, grain), morph 0…1 — плавный переход.
// Для классических форм (sine → saw → square → triangle) — см. morphFn; для random (ramp up/down, steps, smooth) — rndFn.
class WaveMorph {
 public:
  enum Shape { CLASSIC, RANDOM };
  WaveMorph(Shape s = CLASSIC);
  double sample(double morph, double phase, int seed = 0) const;   // phase 0…1, seed — для random
 private:
  Shape shape_;
  static constexpr int N = 1024;
  float tables_[9][N];                                  // 9 циклов × 1024 сэмпла
  void initClassic();
  void initRandom();
  static double hash(int n);
};

// LFO строки: идентификатор { world, key }, базовое значение, параметры { morph, rate, depth, phase }, фаза без обрезки, зерно.
// Создаётся add, убирается remove; tick сдвигает фазу, get возвращает текущее значение.
struct RowLfo {
  int world = 0;                                        // номер мира
  std::string key;                                      // ключ строки (например, "cutoff")
  double base = 0.5;                                    // значение без LFO
  double morph = 0, rate = 0.8, depth = 0.3, phase = 0;   // параметры: 0…1
  double u = 0;                                         // фаза без обрезки (для random — номер периода)
  int seed = 0;                                         // зерно случайности
  WaveMorph::Shape shape = WaveMorph::CLASSIC;

  double value(const WaveMorph& w) const;               // текущее значение с LFO
  void tick(double dt, const WaveMorph& morph);       // сдвиг фазы (раз в блок)
};

}  // namespace sdk

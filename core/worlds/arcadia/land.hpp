// Arcadia — страна из зерна: порт genLand (tools/ref/arcadia-model.js; в вебе та же функция рисует картинку — worlds/arcadia/model.js).
// Горные цепи, холмы, складки, озёра в котловинах, реки с гор вниз, русла; сетка высот z и маска воды lake, GX × GY, float — как Float32Array.
// Вершины и имена — только картинке, здесь их нет. Числа — как в JS: те же операции в том же порядке, Math.hypot — алгоритмом V8 (jsHypot),
// хранение — во float. В звуковом потоке страна считается по кускам (LandGen::step — кусок на блок): целиком это ~20 мс, щелчок у всех миров.
#pragma once
#include <cmath>
#include <cstdint>
#include "../../sdk/rng.hpp"

namespace arcadia {

constexpr int GX = 80, GY = 160, NG = GX * GY;
constexpr double ASP = 3.2;                             // страна вглубь в 3.2 раза длиннее, чем вширь
constexpr double TAU = 6.283185307179586;               // Math.PI * 2

// Math.hypot(a, b) как в V8 (Kahan по нормированным): обычный sqrt(a² + b²) расходится в последнем бите на трети чисел
inline double jsHypot(double a, double b) {
  a = std::fabs(a); b = std::fabs(b);
  if (a != a || b != b) return (a == INFINITY || b == INFINITY) ? INFINITY : NAN;
  double m = 0;
  if (a > m) m = a;
  if (b > m) m = b;
  if (m == INFINITY) return INFINITY;
  if (m == 0) return 0;
  double sum = 0, comp = 0;
  const double xs[2] = {a, b};
  for (double x : xs) { const double n = x / m, s = n * n - comp, p = sum + s; comp = (p - sum) - s; sum = p; }
  return std::sqrt(sum) * m;
}
inline double clampd(double x, double a = 0, double b = 1) { return x < a ? a : x > b ? b : x; }   // Math.min(b, Math.max(a, x))
inline double dist(double u0, double v0, double u1, double v1) { return jsHypot(u1 - u0, (v1 - v0) * ASP); }
double bil(const float* arr, double u, double v);       // билинейно по сетке, края прижаты
void gradOf(const float* arr, double u, double v, double& gx, double& gy, double e = 0.03);   // уклон на местности

struct Land { uint32_t seed = 0; float z[NG] = {}; float lake[NG] = {}; };

// Новая страна по кускам: start, затем step() раз в блок, пока не вернёт true. Число кусков — не больше MAX_STEPS при любом зерне.
class LandGen {
 public:
  static constexpr int ROWS_RELIEF = 8, ROWS = 16;     // строк сетки за кусок: рельеф (дороже — гауссианы) и русла; ~0.2 мс на кусок
  static constexpr int MAX_STEPS = 1 + GY / ROWS_RELIEF + 1 + 3 * (GY / ROWS) + 6 + 1;   // 59: настройка, рельеф, реки, русла, озёра, нормировка
  void start(uint32_t seed, Land* out);
  bool step();                                          // кусок работы; true — страна готова
  bool busy() const { return out_ && phase_ != DONE; }
  void run() { while (!step()) {} }                     // целиком (prepare)

 private:
  enum Phase { SETUP, RELIEF, TRACE, CARVE, LAKES, NORM, DONE };
  struct G { double u, v, h, s; };
  struct W { double fx, fy, ph, amp; };
  struct L { double u, v, w, level; bool pond; };
  static constexpr int GMAX = 64, LMAX = 8, RMAX = 3, PMAX = 192;
  void setup();
  void relief(int j0, int j1);
  void trace();
  void carve(int r, int j0, int j1);
  void lake(int k);
  void norm();
  Land* out_ = nullptr;
  Phase phase_ = DONE;
  int row_ = 0, item_ = 0;
  sdk::Rng R_{0};
  G gs_[GMAX]; int ng_ = 0;
  W waves_[6];
  L lakes_[LMAX]; int nl_ = 0;
  double pts_[RMAX][PMAX][2]; int np_[RMAX] = {}; int nr_ = 0;
};

}  // namespace arcadia

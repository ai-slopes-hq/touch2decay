// Arcadia — страна из зерна: порт genLand (tools/ref/arcadia-model.js; в вебе та же функция рисует картинку — worlds/arcadia/model.js).
// Горные цепи, холмы, складки, озёра в котловинах, реки с гор вниз, русла; сетка высот z и маска воды lake, GX × GY, float — как Float32Array.
// Вершины, озёра, реки и их имена — картинке (необязательный Pic*: без него — ни такта лишней работы). Числа — как в JS: те же операции в том же порядке, Math.hypot — алгоритмом V8 (jsHypot),
// хранение — во float. В звуковом потоке страна считается по кускам (LandGen::step — кусок на блок): целиком это ~20 мс, щелчок у всех миров.
#pragma once
#include <cmath>
#include <cstdint>
#include "../../sdk/jsmath.hpp"
#include "../../sdk/rng.hpp"

namespace arcadia {

constexpr int GX = 80, GY = 160, NG = GX * GY;
constexpr double ASP = 3.2;                             // страна вглубь в 3.2 раза длиннее, чем вширь
constexpr double TAU = 6.283185307179586;               // Math.PI * 2

using sdk::jsHypot;                                     // Math.hypot V8 — core/sdk/jsmath.hpp
inline double clampd(double x, double a = 0, double b = 1) { return x < a ? a : x > b ? b : x; }   // Math.min(b, Math.max(a, x))
inline double dist(double u0, double v0, double u1, double v1) { return jsHypot(u1 - u0, (v1 - v0) * ASP); }
double bil(const float* arr, double u, double v);       // билинейно по сетке, края прижаты
void gradOf(const float* arr, double u, double v, double& gx, double& gy, double e = 0.03);   // уклон на местности

struct Land { uint32_t seed = 0; float z[NG] = {}; float lake[NG] = {}; };

constexpr int LMAX = 8, RMAX = 3, PMAX = 192;           // озёр (с прудами), рек, точек реки — запас генератора
constexpr int RMAX_PTS = 2 + 2 * 90;                    // путь routeOf: дом + до 90 шагов (пары u, v)
extern const char* const MONTES[8];                     // имена для картинки (model.js:12-14); в Pic — индексы, -1 — без имени
extern const char* const LACUS[4];
extern const char* const FLUMINA[6];

// Картина страны — то, что в вебе лежит в объекте genLand рядом с z / lake. Заполняет LandGen (только если дали Pic*).
struct Pic {
  struct Peak { double u, v, h; int name; };
  struct Lake { double u, v, w, level; bool pond; int name; };
  struct River { int name, n; double pts[PMAX][2]; };
  int np = 0, nl = 0, nr = 0;
  Peak peaks[8];
  Lake lakes[LMAX];
  River rivers[RMAX];
};

// Путь вниз (mode 3, к воде) или вверх (mode 4, к вершине) по склону от дома; пары u, v в out (RMAX_PTS), число чисел. mode < 3 (и NaN) — 0.
int routeOf(const float* z, const float* lake, double u, double v, double mode, double* out);

// Новая страна по кускам: start, затем step() раз в блок, пока не вернёт true. Число кусков — не больше MAX_STEPS при любом зерне.
class LandGen {
 public:
  static constexpr int ROWS_RELIEF = 8, ROWS = 16;     // строк сетки за кусок: рельеф (дороже — гауссианы) и русла; ~0.2 мс на кусок
  static constexpr int MAX_STEPS = 1 + GY / ROWS_RELIEF + 1 + 3 * (GY / ROWS) + 6 + 1;   // 59: настройка, рельеф, реки, русла, озёра, нормировка
  void start(uint32_t seed, Land* out, Pic* pic = nullptr);   // pic — заодно собрать картину (не в звуковом потоке)
  bool step();                                          // кусок работы; true — страна готова
  bool busy() const { return out_ && phase_ != DONE; }
  void run() { while (!step()) {} }                     // целиком (prepare)

 private:
  enum Phase { SETUP, RELIEF, TRACE, CARVE, LAKES, NORM, DONE };
  struct G { double u, v, h, s; };
  struct W { double fx, fy, ph, amp; };
  struct L { double u, v, w, level; bool pond; };
  static constexpr int GMAX = 64;
  void setup();
  void relief(int j0, int j1);
  void trace();
  void carve(int r, int j0, int j1);
  void lake(int k);
  void norm();
  void fillPic();
  Land* out_ = nullptr;
  Pic* pic_ = nullptr;
  Phase phase_ = DONE;
  int row_ = 0, item_ = 0;
  sdk::Rng R_{0};
  G gs_[GMAX]; int ng_ = 0;
  W waves_[6];
  L lakes_[LMAX]; int nl_ = 0;
  double pts_[RMAX][PMAX][2]; int np_[RMAX] = {}; int rk_[RMAX] = {}; int nr_ = 0;   // rk_ — номер цикла реки (имя идёт от него, а не от места в массиве)
};

}  // namespace arcadia

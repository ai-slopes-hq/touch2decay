// Horologium — колесо и кольца: порт horo-worklet.js (эталон — tools/ref/horo-worklet.js, ГСЧ с зерном) один в один.
// Колесо-«единица»: положение P (обороты), скорость F (к Ft со сглаживанием 60 мс), спуск руками — доворот на d за 40 мс. Кольцо даёт
// m ударов за оборот; удар — когда floor(P·m + phi) сменился (и chance): молоточек sin² (металл 0.5 мс … дерево 1.6 мс, у дерева — шорох)
// в двухполюсный резонатор на m·max(B, Fe); concursus — удар сильнее, где кольца совпали (или «раз»). Выход — DC-блок и tanh(0.9x).
// Замок к такту: колесо тянется к фазе такта (t − t0)/bar скоростью ±3 %, прыжок — при включении замка или ошибке больше 0.1 оборота.
// Отличие от worklet: параметры (кольца, fx, Ft, B, замок) задаёт мир перед каждым блоком; время блока — от часов хоста.
#pragma once
#include <cstdint>
#include "../../sdk/rng.hpp"
#include "model.hpp"

namespace horologium {

class Sound {
 public:
  static constexpr int HMAX = 32;
  void prepare(double sr, uint32_t seed);
  struct R { bool on = false, under = false; double phi = 0, lvl = 0.8; };
  void set(const R* rings, double Ft, double B, double mat, double conc, double chance, double aeq);
  void step(double d);                                  // спуск руками: доворот на d оборота за 40 мс
  void lock(double t0, double bar);                     // замок к такту (новый — фаза прыгнет к обороту)
  void unlock() { lockOn_ = false; }
  void process(float* L, float* R, int n, double now);  // пишет L, R
  double P() const { return P_; }
  double F() const { return F_; }
  int hits(int* buf, int cap);                           // номера колец (n − 2), ударивших с прошлого раза; очищает
  long strikes() const { return strikes_; }

 private:
  struct O {
    int n = 2; bool on = false, under = false; double phi = 0, lvl = 0.8;
    double y1 = 0, y2 = 0, ea = 0, pan = 0, m = 2, rate = 0;
    int nz = 0, ek = 0, eN = 1;
  };
  double mOf(const O& o) const;
  double rnd() { return rng_.next(); }

  O r_[NR];
  double sr_ = 48000, P_ = 0, F_ = 0, Ft_ = 0, glide_ = 0, B_ = 55, mat_ = 0.35, conc_ = 0.4, chance_ = 1, aeq_ = 0;
  int glideN_ = 0;
  bool lockOn_ = false, snap_ = false;
  double t0_ = 0, bar_ = 0;
  double dc_[2] = {}, dx_[2] = {};
  int hit_[HMAX] = {}, nh_ = 0;
  long strikes_ = 0;
  sdk::Rng rng_{1};
};

}  // namespace horologium

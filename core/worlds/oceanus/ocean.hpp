// Oceanus — ядро звука: сканирующий синтез, порт ocean-worklet.js (эталон — tools/ref/ocean-worklet.js) один в один.
// Кольцо из N масс на пружинах — вода; физика раз в STEP отсчётов, голоса читают форму кольца по кругу со звуковой частотой.
// x, v, a, b — float (как Float32Array в JS): читаем, считаем в double, пишем обратно во float. ГСЧ — mulberry32 (core/sdk/rng.hpp),
// вызовы в том же порядке, что в эталоне: шесть фаз в конструкторе, буря до ветра, ветер на каждой массе внутри цикла.
#pragma once
#include <cstdint>

#include "../../sdk/rng.hpp"

namespace oceanus {

constexpr int N = 64, STEP = 16, VMAX = 6, PMAX = 16;

class Ocean {
 public:
  Ocean(double sr, uint32_t seed);
  // все девять значений — полным набором (обёртка хранит слитые)
  void params(double kt, double damp, double kc, double wind, double tide, double moonRate, double storm, double sway, double swayTo);
  void push(double id, double a, double d, double k);   // палец: новый id — в конец, тот же id — на месте; 17-й — мимо
  void release(double id);                              // убрать палец, порядок остальных сохраняется
  void splash(double a, double amt);
  void voice(int i, bool on, double f, double lvl, double path);   // f == 0 — прежняя частота; номер вне 0…5 — мимо
  void process(float* L, float* R, int n);              // R == nullptr — моно
  const float* shape() const { return x_; }
  double moon() const { return moon_; }
  double gain(int i) const { return i < 0 || i >= VMAX ? 0 : vo_[i].g; }

 private:
  struct Voice { bool on = false; double f = 110, ph = 0, g = 0, lvl = 0.8, lp = 0, path = 0; };
  struct Finger { double id, a, d, k; };

  void step();

  double sr_;
  sdk::Rng rng_;
  float x_[N], v_[N], a_[N], b_[N];
  double kt_ = 0.03, damp_ = 0.002, kc_ = 0.004, wind_ = 0, tide_ = 0.5, moon_ = 0, moonRate_ = 0.04, storm_ = 0, sway_ = 0, swayTo_ = 0, sm_ = 1, pm_ = 1;
  Finger fingers_[PMAX]; int nf_ = 0;
  Voice vo_[VMAX];
  int k_ = 0;
};

}  // namespace oceanus

// Перкуссионная огибающая AD — как цепочка AudioParam у гула Cymatica, зёрен Paradisus, Tria, Natura:
//   0 → linearRamp(peak, A) → exponentialRamp(floor, A + D) → linearRamp(0, A + D + tail)
// Время идёт по сэмплам от start(): кадр k звучит значением в k/sr. Закончилась (active() == false) — всегда 0.
#pragma once
#include <cmath>

namespace sdk {

class AD {
 public:
  void start(double sr, double peak, double A, double D, double floor, double tail) {
    sr_ = sr > 0 ? sr : 48000; peak_ = peak; a_ = A; d_ = D; floor_ = floor; tail_ = tail; n_ = 0; on_ = true;
  }
  bool active() const { return on_; }
  double step() {
    if (!on_) return 0;
    const double t = n_++ / sr_;
    if (t < a_) return a_ > 0 ? peak_ * t / a_ : peak_;
    if (t < a_ + d_) return peak_ * std::pow(floor_ / peak_, (t - a_) / d_);
    if (t < a_ + d_ + tail_) return floor_ * (1 - (t - a_ - d_) / tail_);
    on_ = false;
    return 0;
  }

 private:
  double sr_ = 48000, peak_ = 1, a_ = 0, d_ = 0, floor_ = 0, tail_ = 0, n_ = 0;
  bool on_ = false;
};

}  // namespace sdk

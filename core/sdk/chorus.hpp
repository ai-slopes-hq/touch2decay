// Хор: NL плавающих стерео-задержек, у каждой своя база d0, синус-LFO на времени (частота rate, глубина depth, с) и панорама —
// как цепочка Web Audio у Monochordum (DelayNode ← OscillatorNode × GainNode на delayTime → StereoPannerNode → wet).
//   выход = wet · Σ panStereo(линия i, задержка d0_i + depth·sin(2π·rate_i·t))
// wet и depth сглаживаются как setTargetAtTime(·, 0.05); feed = false — на вход линиям идёт тишина (хор отцеплен от mix),
// хвост задержек дозвучивает. Совсем пусто (вход молчит дольше всей задержки и сглаживания) — блок не считается, выход — 0.
// Чтение задержки — линейное между соседними (как DelayNode в Chromium). Память — внутри объекта; в process аллокаций нет.
#pragma once
#include <cmath>
#include "pan.hpp"

namespace sdk {

template <int NL, int SIZE>
class Chorus {
 public:
  struct Line { double d0, rate, pan; };
  void prepare(double sr, const Line* lines, double depth0) {
    sr_ = sr; c_ = 1 - std::exp(-1 / (0.05 * sr));
    for (int i = 0; i < NL; i++) {
      ln_[i] = lines[i]; ph_[i] = 0; ps_[i].set(lines[i].pan);
      for (int k = 0; k < SIZE; k++) bL_[i][k] = bR_[i][k] = 0;
    }
    w_ = 0; wet_ = 0; depth_ = depth0; wetTo_ = 0; depthTo_ = depth0; quiet_ = SIZE;
  }
  void set(double wet, double depth) { wetTo_ = wet; depthTo_ = depth; }
  void process(const float* inL, const float* inR, bool feed, float* outL, float* outR, int n) {
    if (!feed && quiet_ >= SIZE && std::fabs(wet_ - wetTo_) < 1e-9) {   // хвост дозвучал — не считаем, но время LFO идёт
      for (int k = 0; k < n; k++) outL[k] = outR[k] = 0;
      for (int i = 0; i < NL; i++) advance(i, n);
      depth_ = depthTo_;
      return;
    }
    for (int k = 0; k < n; k++) {
      wet_ += (wetTo_ - wet_) * c_; depth_ += (depthTo_ - depth_) * c_;
      const double xl = feed ? inL[k] : 0, xr = feed ? inR[k] : 0;
      double sl = 0, sr = 0;
      for (int i = 0; i < NL; i++) {
        double d = (ln_[i].d0 + depth_ * std::sin(2 * M_PI * ph_[i])) * sr_;
        if (d < 1) d = 1;
        if (d > SIZE - 2) d = SIZE - 2;
        double l, r;
        ps_[i].step(read(bL_[i], d), read(bR_[i], d), l, r);
        sl += l; sr += r;
        bL_[i][w_] = static_cast<float>(xl); bR_[i][w_] = static_cast<float>(xr);
        advance(i, 1);
      }
      w_ = (w_ + 1) % SIZE;
      outL[k] = static_cast<float>(sl * wet_); outR[k] = static_cast<float>(sr * wet_);
    }
    if (feed) quiet_ = 0; else if (quiet_ < SIZE) quiet_ += n;
  }

 private:
  double read(const float* b, double d) const {        // d отсчётов назад от следующей записи: d = 1 — последняя записанная
    const int i = static_cast<int>(d);
    const double f = d - i;
    int k0 = w_ - i, k1 = w_ - i - 1;
    if (k0 < 0) k0 += SIZE;
    if (k1 < 0) k1 += SIZE;
    return b[k0] + (b[k1] - b[k0]) * f;
  }
  void advance(int i, int n) { ph_[i] += ln_[i].rate * n / sr_; ph_[i] -= std::floor(ph_[i]); }
  Line ln_[NL] = {};
  PanStereo ps_[NL];
  double ph_[NL] = {};
  float bL_[NL][SIZE] = {}, bR_[NL][SIZE] = {};
  int w_ = 0, quiet_ = SIZE;
  double sr_ = 48000, c_ = 0, wet_ = 0, depth_ = 0, wetTo_ = 0, depthTo_ = 0;
};

}  // namespace sdk

// Chorus — хор: NL плавающих задержек. У каждой линии своя база d0 (с), синус-LFO на времени (частота rate,
// доля глубины k) и панорама — как цепочка Web Audio у Monochordum
// (DelayNode ← OscillatorNode × GainNode на delayTime → StereoPannerNode → wet):
//
//   выход = wet · Σ panStereo(линия i с задержкой d0_i + depth·k_i·sin(2π·rate_i·t))
//
//   chorus.prepare(sr, lines, depth0);             // lines — NL штук {d0, rate, pan, k}
//   chorus.set(wet, depth);                        // когда угодно; оба плывут как setTargetAtTime(·, 0.05)
//   chorus.process(inL, inR, feed, outL, outR, n); // блок
//
// mono = true (Natura): линии берут только inL, без панорамы, outL = outR = wet · Σ линий — как DelayNode → общий
// GainNode без StereoPannerNode; правый буфер не пишется и не читается.
//
// ЛОВУШКИ:
//   - d0 и depth — в секундах. Задержка зажимается в 1 … SIZE − 2 сэмплов: d0 + depth не должна вылезать за SIZE/sr.
//   - Отдаёт только мокрое; сухое складывает мир.
//   - feed = false — на вход идёт тишина (хор отцеплен от микса), хвост дозвучивает. Вход молчит дольше
//     всей задержки и сглаживание дошло — блок не считается, выход 0; время LFO идёт и тогда.
//   - Чтение — линейное между соседними, как DelayNode в Chromium: на быстром LFO верха чуть гаснут.
// Цена — NL синусов и 2·NL чтений с интерполяцией на сэмпл. Память — 2·NL·SIZE float внутри объекта,
// в process аллокаций нет.
#pragma once
#include <cmath>
#include "pan.hpp"

namespace sdk {

template <int NL, int SIZE>
class Chorus {
 public:
  struct Line { double d0, rate, pan, k = 1; };        // база (с), частота LFO (Гц), панорама −1…1, доля глубины
  void prepare(double sr, const Line* lines, double depth0, bool mono = false) {
    sampleRate_ = sr; smoothCoef_ = 1 - std::exp(-1 / (0.05 * sr)); mono_ = mono;
    for (int i = 0; i < NL; i++) {
      lines_[i] = lines[i]; lfoPhase_[i] = 0; pans_[i].set(lines[i].pan);
      for (int k = 0; k < SIZE; k++) bufL_[i][k] = bufR_[i][k] = 0;
    }
    writePos_ = 0; wet_ = 0; depth_ = depth0; wetTarget_ = 0; depthTarget_ = depth0; quietSamples_ = SIZE;
  }
  void set(double wet, double depth) { wetTarget_ = wet; depthTarget_ = depth; }
  void process(const float* inL, const float* inR, bool feed, float* outL, float* outR, int n) {
    if (!feed && quietSamples_ >= SIZE && std::fabs(wet_ - wetTarget_) < 1e-9) {   // хвост дозвучал — не считаем, но время LFO идёт
      for (int k = 0; k < n; k++) outL[k] = outR[k] = 0;
      for (int i = 0; i < NL; i++) advance(i, n);
      depth_ = depthTarget_;
      return;
    }
    for (int k = 0; k < n; k++) {
      wet_ += (wetTarget_ - wet_) * smoothCoef_; depth_ += (depthTarget_ - depth_) * smoothCoef_;
      const double xl = feed ? inL[k] : 0, xr = feed ? inR[k] : 0;
      double sumL = 0, sumR = 0;
      for (int i = 0; i < NL; i++) {
        double d = (lines_[i].d0 + depth_ * lines_[i].k * std::sin(2 * M_PI * lfoPhase_[i])) * sampleRate_;
        if (d < 1) d = 1;
        if (d > SIZE - 2) d = SIZE - 2;
        if (mono_) {
          sumL += read(bufL_[i], d);
          bufL_[i][writePos_] = static_cast<float>(xl);
        } else {
          double l, r;
          pans_[i].step(read(bufL_[i], d), read(bufR_[i], d), l, r);
          sumL += l; sumR += r;
          bufL_[i][writePos_] = static_cast<float>(xl); bufR_[i][writePos_] = static_cast<float>(xr);
        }
        advance(i, 1);
      }
      writePos_ = (writePos_ + 1) % SIZE;
      if (mono_) sumR = sumL;
      outL[k] = static_cast<float>(sumL * wet_); outR[k] = static_cast<float>(sumR * wet_);
    }
    if (feed) quietSamples_ = 0; else if (quietSamples_ < SIZE) quietSamples_ += n;
  }

 private:
  // d отсчётов назад от следующей записи: d = 1 — последняя записанная; читается до записи этого сэмпла
  double read(const float* b, double d) const {
    const int i = static_cast<int>(d);
    const double f = d - i;
    int k0 = writePos_ - i, k1 = writePos_ - i - 1;
    if (k0 < 0) k0 += SIZE;
    if (k1 < 0) k1 += SIZE;
    return b[k0] + (b[k1] - b[k0]) * f;
  }
  void advance(int i, int n) { lfoPhase_[i] += lines_[i].rate * n / sampleRate_; lfoPhase_[i] -= std::floor(lfoPhase_[i]); }
  Line lines_[NL] = {};
  PanStereo pans_[NL];
  double lfoPhase_[NL] = {};
  float bufL_[NL][SIZE] = {}, bufR_[NL][SIZE] = {};
  int writePos_ = 0;
  int quietSamples_ = SIZE;                             // сколько сэмплов подряд вход молчит
  bool mono_ = false;
  double sampleRate_ = 48000, smoothCoef_ = 0, wet_ = 0, depth_ = 0, wetTarget_ = 0, depthTarget_ = 0;
};

}  // namespace sdk

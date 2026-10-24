// Пинг-понг с перекрёстной связью: две линии задержки крест-накрест, lowpass в каждой петле — как пара DelayNode у Cymatica
// (worlds/cymatica/engine.js до этапа 3; у Portus и Tenebrae та же схема с насыщением и wow — они подключат их параметрами позже):
//   in → dL ──→ выход L            dL → LP → fb → dR
//         ↑                        dR → LP → fb → dL
//         └── LP ← fb ← dR ──→ выход R
// Выход — сами линии (до фильтров), как ChannelMerger у Web Audio. Время — дробное число сэмплов (линейная интерполяция, как у DelayNode),
// не короче блока (128): в петле Web Audio короче не бывает. fb идёт к цели за ~0.05 с (setTargetAtTime(·, t, 0.05)), начальное значение — сразу.
// Память линий — внутри объекта (MAX сэмплов на линию), в step аллокаций нет.
#pragma once
#include <cmath>
#include "biquad.hpp"
#include "delay.hpp"
#include "smooth.hpp"

namespace sdk {

template <int MAX>
class PingPong {
 public:
  void prepare(double sr, double sec, double lpHz, double q, double fb) {
    sr_ = sr > 0 ? sr : 48000;
    l_ = Delay(memL_, MAX + 2); r_ = Delay(memR_, MAX + 2);
    lpL_ = Biquad(); lpR_ = Biquad();
    lpL_.set(Biquad::lowpass, lpHz, q, sr_); lpR_.set(Biquad::lowpass, lpHz, q, sr_);
    c_ = 1 - std::exp(-1 / (0.05 * sr_));
    fb_ = OnePole(); fb_.y = fb; fbTo_ = fb;
    const double d = sec * sr_;
    d_ = d < 128 ? 128 : d > MAX ? MAX : d;
  }
  void setFb(double target) { fbTo_ = target; }
  double sec() const { return d_ / sr_; }
  double fb() const { return fb_.y; }
  void step(double in, double& outL, double& outR) {
    const double yl = l_.read(d_), yr = r_.read(d_);
    const double f = fb_.step(fbTo_, c_);
    const double fl = lpL_.step(yl), fr = lpR_.step(yr);
    double wl = in + fr * f, wr = fl * f;
    if (std::fabs(wl) < 1e-12) wl = 0;                    // хвост гаснет в ровный 0, без денормалов
    if (std::fabs(wr) < 1e-12) wr = 0;
    l_.write(wl); r_.write(wr);
    outL = yl; outR = yr;
  }

 private:
  float memL_[MAX + 2], memR_[MAX + 2];
  Delay l_, r_;
  Biquad lpL_, lpR_;
  OnePole fb_;
  double sr_ = 48000, c_ = 0, d_ = 128, fbTo_ = 0;
};

}  // namespace sdk

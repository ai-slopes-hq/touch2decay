// Пинг-понг с перекрёстной связью: две линии задержки крест-накрест, lowpass в каждой петле — как пара DelayNode у Cymatica
// (worlds/cymatica/engine.js до этапа 3; у Portus и Tenebrae та же схема с насыщением и wow — они подключат их параметрами позже):
//   in → dL ──→ выход L            dL → LP → fb → dR
//         ↑                        dR → LP → fb → dL
//         └── LP ← fb ← dR ──→ выход R
// Выход — сами линии (до фильтров), как ChannelMerger у Web Audio. Время — дробное число сэмплов (линейная интерполяция, как у DelayNode),
// не короче блока (128): в петле Web Audio короче не бывает. fb идёт к цели за ~0.05 с (setTargetAtTime(·, t, 0.05)), начальное значение — сразу.
// Tenebrae: свои времена у линий (setSec(secL, secR): 0.37 / 0.53 с) и свой wow у каждой (step(…, modL, modR)).
// Что нужно Portus (всё выключено по умолчанию — Cymatica и прежние пары звучат как были):
//   setSec — время «лентой»: скользит снаружи (setTargetAtTime τ 0.08), блок берёт готовое число; step(…, mod) — wow: добавка к времени, секунды;
//   setHp — highpass в обеих петлях до lowpass (срез низа повторов); setLp — свои срезы у левой и правой петли;
//   setSat — кривая насыщения в петле L → R (WaveShaperNode без oversample: у Portus tanh(1.4x)/tanh(1.4) только на одной ноге).
// Память линий — внутри объекта (MAX сэмплов на линию), в step аллокаций нет.
#pragma once
#include <cmath>
#include "biquad.hpp"
#include "delay.hpp"
#include "shaper.hpp"
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
    dl_ = dr_ = clampD(sec * sr_);
  }
  void setFb(double target, double tau = 0.05) { fbTo_ = target; c_ = 1 - std::exp(-1 / (tau * sr_)); }   // tau — setTargetAtTime: 0.05 с у прежних пар, 0.02 — у killEcho Portus
  void setSec(double sec) { dl_ = dr_ = clampD(sec * sr_); }
  void setSec(double secL, double secR) { dl_ = clampD(secL * sr_); dr_ = clampD(secR * sr_); }
  void setHp(double hz, double q) { hp_ = hz > 0; if (hp_) { hpL_.set(Biquad::highpass, hz, q, sr_); hpR_.set(Biquad::highpass, hz, q, sr_); } }
  void setLp(double hzL, double hzR, double q) { lpL_.set(Biquad::lowpass, hzL, q, sr_); lpR_.set(Biquad::lowpass, hzR, q, sr_); }
  void setSat(const Shaper<1024>* sat) { sat_ = sat; }
  double sec() const { return dl_ / sr_; }
  double fb() const { return fb_.y; }
  void step(double in, double& outL, double& outR, double mod = 0) { step(in, outL, outR, mod, mod); }
  void step(double in, double& outL, double& outR, double modL, double modR) {
    // wow: дробная добавка к времени, секунды; в петле Web Audio не бывает короче блока
    const double yl = l_.read(clampD(dl_ + modL * sr_)), yr = r_.read(clampD(dr_ + modR * sr_));
    const double f = fb_.step(fbTo_, c_);
    double fl = lpL_.step(hp_ ? hpL_.step(yl) : yl), fr = lpR_.step(hp_ ? hpR_.step(yr) : yr);
    if (sat_) fl = sat_->step(fl);
    double wl = in + fr * f, wr = fl * f;
    if (std::fabs(wl) < 1e-12) wl = 0;                    // хвост гаснет в ровный 0, без денормалов
    if (std::fabs(wr) < 1e-12) wr = 0;
    l_.write(wl); r_.write(wr);
    outL = yl; outR = yr;
  }

 private:
  float memL_[MAX + 2], memR_[MAX + 2];
  Delay l_, r_;
  Biquad lpL_, lpR_, hpL_, hpR_;
  const Shaper<1024>* sat_ = nullptr;
  bool hp_ = false;
  static double clampD(double d) { return d < 128 ? 128 : d > MAX ? MAX : d; }
  OnePole fb_;
  double sr_ = 48000, c_ = 0, dl_ = 128, dr_ = 128, fbTo_ = 0;
};

}  // namespace sdk

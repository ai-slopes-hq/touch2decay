// PingPong — пинг-понг эхо: две линии задержки крест-накрест, в каждой петле lowpass, повторы скачут
// L → R → L … Как пара DelayNode у Cymatica (worlds/cymatica/engine.js до этапа 3); Portus и Tenebrae —
// та же схема со своими настройками (ниже).
//
//   in → линия L ──→ выход L          линия L → [HP] → LP → [sat] → ·fb → линия R
//          ↑                          линия R → [HP] → LP →         ·fb → линия L
//          └── ·fb ← LP ← линия R ──→ выход R
//
// Выход — сами линии, до фильтров (как ChannelMerger в Web Audio). Время — дробное число сэмплов, чтение
// линейное (как DelayNode). fb идёт к цели как setTargetAtTime(·, t, 0.05); в prepare — сразу.
//
// Что включают миры (по умолчанию выключено — Cymatica звучит как была):
//   Tenebrae — свои времена линий (setSec(secL, secR): 0.37 / 0.53 с) и свой wow у каждой (step(…, modL, modR));
//   Portus   — setSec каждый блок: время «лентой» скользит снаружи (setTargetAtTime τ 0.08), блок берёт готовое число;
//              step(…, mod) — wow, добавка к времени в секундах;
//              setHp — highpass в обеих петлях до lowpass (срез низа повторов); setLp — свои срезы у левой и правой;
//              setSat — кривая насыщения в петле L → R (WaveShaperNode без oversample: у Portus tanh(1.4x)/tanh(1.4)
//              только на одной ноге).
//
// ЛОВУШКИ:
//   - Время не короче 128 сэмплов (блок: в петле Web Audio короче не бывает) и не длиннее MAX — зажимается молча.
//   - setHp(0, …) выключает highpass; setLp и setHp пересчитывают фильтры, но не сбрасывают их память.
//   - Кривую setSat блок не копирует — она должна жить дольше PingPong.
//   - fb ≥ 1 — повторы не гаснут и растут.
// Цена — два чтения линий, 2–4 биквада и запись на сэмпл. Память — 2 × (MAX + 2) float внутри объекта,
// в step аллокаций нет.
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
  // sec — время обеих линий, lpHz и q — lowpass в петлях, fb — обратная связь (ставится сразу)
  void prepare(double sr, double sec, double lpHz, double q, double fb) {
    sampleRate_ = sr > 0 ? sr : 48000;
    lineL_ = Delay(memoryL_, MAX + 2); lineR_ = Delay(memoryR_, MAX + 2);
    lowpassL_ = Biquad(); lowpassR_ = Biquad();
    lowpassL_.set(Biquad::lowpass, lpHz, q, sampleRate_); lowpassR_.set(Biquad::lowpass, lpHz, q, sampleRate_);
    feedbackCoef_ = 1 - std::exp(-1 / (0.05 * sampleRate_));
    feedback_ = OnePole(); feedback_.y = fb; feedbackTarget_ = fb;
    delayL_ = delayR_ = clampDelay(sec * sampleRate_);
  }
  // tau — как у setTargetAtTime: 0.05 с у прежних пар, 0.02 — у killEcho Portus
  void setFb(double target, double tau = 0.05) { feedbackTarget_ = target; feedbackCoef_ = 1 - std::exp(-1 / (tau * sampleRate_)); }
  void setSec(double sec) { delayL_ = delayR_ = clampDelay(sec * sampleRate_); }
  void setSec(double secL, double secR) { delayL_ = clampDelay(secL * sampleRate_); delayR_ = clampDelay(secR * sampleRate_); }
  void setHp(double hz, double q) {
    highpassOn_ = hz > 0;
    if (highpassOn_) { highpassL_.set(Biquad::highpass, hz, q, sampleRate_); highpassR_.set(Biquad::highpass, hz, q, sampleRate_); }
  }
  void setLp(double hzL, double hzR, double q) { lowpassL_.set(Biquad::lowpass, hzL, q, sampleRate_); lowpassR_.set(Biquad::lowpass, hzR, q, sampleRate_); }
  void setSat(const Shaper<1024>* sat) { saturation_ = sat; }
  double sec() const { return delayL_ / sampleRate_; }  // время левой линии, без wow
  double fb() const { return feedback_.y; }             // обратная связь сейчас (на пути к цели)

  void step(double in, double& outL, double& outR, double mod = 0) { step(in, outL, outR, mod, mod); }
  void step(double in, double& outL, double& outR, double modL, double modR) {
    const double yl = lineL_.read(clampDelay(delayL_ + modL * sampleRate_)), yr = lineR_.read(clampDelay(delayR_ + modR * sampleRate_));
    const double f = feedback_.step(feedbackTarget_, feedbackCoef_);
    double fl = lowpassL_.step(highpassOn_ ? highpassL_.step(yl) : yl), fr = lowpassR_.step(highpassOn_ ? highpassR_.step(yr) : yr);
    if (saturation_) fl = saturation_->step(fl);
    double wl = in + fr * f, wr = fl * f;
    if (std::fabs(wl) < 1e-12) wl = 0;                  // хвост гаснет в ровный 0, без денормалов
    if (std::fabs(wr) < 1e-12) wr = 0;
    lineL_.write(wl); lineR_.write(wr);
    outL = yl; outR = yr;
  }

 private:
  float memoryL_[MAX + 2], memoryR_[MAX + 2];
  Delay lineL_, lineR_;
  Biquad lowpassL_, lowpassR_, highpassL_, highpassR_;
  const Shaper<1024>* saturation_ = nullptr;
  bool highpassOn_ = false;
  static double clampDelay(double d) { return d < 128 ? 128 : d > MAX ? MAX : d; }
  OnePole feedback_;
  double sampleRate_ = 48000, feedbackCoef_ = 0, feedbackTarget_ = 0;
  double delayL_ = 128, delayR_ = 128;                  // время линий, сэмплов
};

}  // namespace sdk

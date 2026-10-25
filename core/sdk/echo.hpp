// Моно-«лента»: задержка с lowpass в петле — как цепочка Web Audio у Goetia (worlds/goetia/engine.js до SDK B; та же у Natura):
//   in · send → DelayNode(time) → Biquad LP(f, Q) → выход эха
//                    ↑                  │
//                    └────── · fb ──────┘
// По сэмплам: выход задержки — вход time назад; он через LP — выход эха; в задержку пишется in·send + выход·fb.
// В Web Audio задержка в петле не короче блока (128) — у наших времён (сотни мс) правило не мешает.
// send и fb — как GainNode с setTargetAtTime(·, t, 0.05): на каждом сэмпле y += (цель − y)·c, c = 1 − e^(−1/(0.05·sr)),
// начало — 0 (новый GainNode). Память линии — внутри объекта (MAX float), в process аллокаций нет.
// Время «лентой» (Natura): glideTo(sec, τ) — как delayTime.setTargetAtTime(sec, t, τ): a-rate, дробное (чтение линейное, как DelayNode), не короче
// блока (128 — в петле Web Audio короче не бывает); начало — 0 (новый DelayNode). setTime (Goetia) — целое число сэмплов, как было.
#pragma once
#include <cmath>
#include "biquad.hpp"
#include "delay.hpp"
#include "smooth.hpp"

namespace sdk {

template <int MAX>
class TapeEcho {
 public:
  void prepare(double sr, double time, double lpHz, double q = 1) {
    sr_ = sr > 0 ? sr : 48000;
    line_ = Delay(mem_, MAX);
    lp_ = Biquad();
    lp_.set(Biquad::lowpass, lpHz, q, sr_);
    c_ = 1 - std::exp(-1 / (0.05 * sr_));
    send_ = OnePole(); fb_ = OnePole();
    sendTo_ = fbTo_ = 0;
    zeros_ = MAX;
    glide_ = false;
    setTime(time);
  }
  void setTime(double sec) {                            // сразу, без скольжения (у Goetia время постоянное)
    double d = std::round(sec * sr_);
    d_ = d < 1 ? 1 : d > MAX ? MAX : d;
  }
  void glideTo(double sec, double tau) {                // время идёт к sec с постоянной τ; первый вызов включает режим «лента» (с нуля)
    if (!glide_) { glide_ = true; d_ = 0; }
    dTo_ = sec * sr_; cd_ = 1 - std::exp(-1 / (tau * sr_));
    if (dTo_ > MAX - 2) dTo_ = MAX - 2;
  }
  double timeSec() const { return d_ / sr_; }
  void set(double send, double fb) { sendTo_ = send; fbTo_ = fb; }   // цели; ручки идут к ним за ~0.05 с
  // out — возврат эха (пишется, не прибавляется); in и out могут совпадать.
  // Тишина на входе и в петле (последние time записей — нули, фильтр в нуле): блок не считается — выход 0, ручки доходят к цели
  // за n сэмплов разом ((1 − c)^n) — то же, что посэмпльно, с точностью до округления
  void process(const float* in, float* out, int n) {
    if (zeros_ >= (glide_ ? (d_ < 128 ? 128 : d_) : d_) && lp_.y1 == 0 && lp_.y2 == 0 && lp_.x1 == 0 && lp_.x2 == 0) {
      bool quiet = true;
      for (int k = 0; k < n && quiet; k++) quiet = in[k] == 0;
      if (quiet) {
        const double q = std::pow(1 - c_, n);
        send_.y = sendTo_ + (send_.y - sendTo_) * q; fb_.y = fbTo_ + (fb_.y - fbTo_) * q;
        if (glide_) d_ = dTo_ + (d_ - dTo_) * std::pow(1 - cd_, n);   // и время доходит к цели, пока тихо
        for (int k = 0; k < n; k++) { line_.write(0); out[k] = 0; }
        return;
      }
    }
    for (int k = 0; k < n; k++) {
      const double s = send_.step(sendTo_, c_), f = fb_.step(fbTo_, c_);
      double d = d_;
      if (glide_) { d_ += (dTo_ - d_) * cd_; d = d_ < 128 ? 128 : d_; }
      const double y = lp_.step(line_.read(d));
      double w = in[k] * s + y * f;
      if (std::fabs(w) < 1e-12) w = 0;                    // хвост гаснет в ровный 0, без денормалов
      zeros_ = w == 0 ? zeros_ + 1 : 0;
      line_.write(w);
      out[k] = static_cast<float>(y);
    }
    if (std::fabs(lp_.y1) < 1e-12 && std::fabs(lp_.y2) < 1e-12) lp_.y1 = lp_.y2 = 0;
  }
  double send() const { return send_.y; }
  double fb() const { return fb_.y; }

 private:
  float mem_[MAX];
  Delay line_;
  Biquad lp_;
  OnePole send_, fb_;
  double sr_ = 48000, c_ = 0, d_ = 1, sendTo_ = 0, fbTo_ = 0, dTo_ = 0, cd_ = 0;
  bool glide_ = false;
  double zeros_ = MAX;                                  // сколько нулей подряд записано в линию
};

}  // namespace sdk

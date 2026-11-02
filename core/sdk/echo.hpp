// TapeEcho — моно-эхо «как на ленте»: задержка, у которой в петле обратной связи стоит lowpass,
// поэтому каждый следующий повтор тусклее предыдущего.
//
//   вход · send → задержка (time) → lowpass → выход эха
//                     ↑                  │
//                     └──── · feedback ──┘
//
// Повторяет цепочку Web Audio, на которой Goetia и Natura звучали в браузере
// (DelayNode → BiquadFilterNode → GainNode обратной связи), и ведёт себя так же, вплоть
// до мелочей ниже. Если поведение уедет, это поймают сверки ядра с вебом
// (tools/test-goetia-core.mjs, tools/test-natura-core.mjs) и тесты в core/tests/sdk_test.cpp.
//
// Два режима времени задержки:
//   setTime(sec)       — Goetia: время задаётся сразу и округляется до целого сэмпла.
//   glideTo(sec, tau)  — Natura: время плавно ползёт к цели, как лента, которую разгоняют
//                        или тормозят, поэтому высота повторов «плывёт». Первый вызов включает
//                        этот режим насовсем, и время стартует с нуля (как у нового DelayNode).
//
// Ручки send и feedback не прыгают: каждая доходит до новой цели примерно за 0.05 с
// (как setTargetAtTime у GainNode). После prepare() обе стоят на нуле, так что эхо
// вступает плавно.
//
// ЛОВУШКИ:
//   - MAX — длина памяти в сэмплах, задаётся при компиляции. Время больше MAX / sampleRate
//     молча обрезается. Считай с запасом под 96 кГц (Goetia: 0.375 с × 96000 = 36000 → MAX 36864).
//   - Объект большой (MAX float внутри): держи его членом мира или глобальным, не на стеке.
//   - В режиме «лента» задержка не короче 128 сэмплов: в Web Audio петля с задержкой
//     не бывает короче одного блока. На наших временах (сотни мс) это не слышно.
//   - feedback ≥ 1 — эхо нарастает без конца. Блок это не ограничивает.
//
// Экономия: когда на входе тишина и в петле уже ничего не звучит, блок не считается
// сэмпл за сэмплом — ручки и время доводятся до цели одной формулой.

#pragma once

#include <cmath>
#include "biquad.hpp"
#include "delay.hpp"
#include "smooth.hpp"

namespace sdk {

template <int MAX>
class TapeEcho {
 public:
  // Сбросить всё и настроить заново. lpHz и q — lowpass в петле (q в дБ, см. biquad.hpp).
  void prepare(double sampleRate, double timeSec, double lpHz, double q = 1) {
    sampleRate_ = sampleRate > 0 ? sampleRate : 48000;
    line_ = Delay(memory_, MAX);
    loopFilter_ = Biquad();
    loopFilter_.set(Biquad::lowpass, lpHz, q, sampleRate_);
    knobCoef_ = 1 - std::exp(-1 / (kKnobTau * sampleRate_));
    sendGain_ = OnePole();
    feedbackGain_ = OnePole();
    sendTarget_ = feedbackTarget_ = 0;
    zerosInLine_ = MAX;
    tapeMode_ = false;
    setTime(timeSec);
  }

  // Время задержки сразу, без скольжения. Округляется до сэмпла и зажимается в [1, MAX].
  void setTime(double sec) {
    double samples = std::round(sec * sampleRate_);
    delay_ = samples < 1 ? 1 : samples > MAX ? MAX : samples;
  }

  // Режим «лента»: время ползёт к sec с постоянной времени tau (за tau проходит ~63 % пути).
  // Звать можно хоть каждый блок — двигается только цель.
  void glideTo(double sec, double tau) {
    if (!tapeMode_) { tapeMode_ = true; delay_ = 0; }
    delayTarget_ = sec * sampleRate_;
    delayCoef_ = 1 - std::exp(-1 / (tau * sampleRate_));
    if (delayTarget_ > MAX - 2) delayTarget_ = MAX - 2;  // −2: дробному чтению нужен соседний сэмпл
  }

  // Время задержки сейчас, с (в режиме «лента» — где оно сейчас, а не цель).
  double timeSec() const { return delay_ / sampleRate_; }

  // Новые цели ручек: send — сколько входа уходит в эхо, feedback — сколько эха возвращается в петлю.
  void set(double send, double feedback) { sendTarget_ = send; feedbackTarget_ = feedback; }

  // Посчитать n сэмплов. В out пишется только эхо, без сухого сигнала (пишется, а не прибавляется).
  // in и out могут быть одним буфером.
  void process(const float* in, float* out, int n) {
    if (loopIsSilent() && inputIsSilent(in, n)) {
      skipSilentBlock(out, n);
      return;
    }
    for (int k = 0; k < n; k++) {
      const double send = sendGain_.step(sendTarget_, knobCoef_);
      const double feedback = feedbackGain_.step(feedbackTarget_, knobCoef_);

      double readAt = delay_;
      if (tapeMode_) {
        delay_ += (delayTarget_ - delay_) * delayCoef_;
        readAt = delay_ < kMinLoop ? kMinLoop : delay_;
      }

      const double echo = loopFilter_.step(line_.read(readAt));
      double written = in[k] * send + echo * feedback;
      if (std::fabs(written) < kTiny) written = 0;  // хвост гаснет в ровный 0: и денормалов нет, и тишину видно
      zerosInLine_ = written == 0 ? zerosInLine_ + 1 : 0;
      line_.write(written);
      out[k] = static_cast<float>(echo);
    }
    loopFilter_.flushTiny(kTiny);  // и память фильтра — в ровный 0, иначе loopIsSilent() не дождётся тишины
  }

  // Где ручки сейчас (не цели) — для картинки и тестов.
  double send() const { return sendGain_.y; }
  double fb() const { return feedbackGain_.y; }

 private:
  static constexpr double kKnobTau = 0.05;  // с: постоянная времени ручек send и feedback
  static constexpr double kMinLoop = 128;   // сэмплов: самая короткая петля в режиме «лента»
  static constexpr double kTiny = 1e-12;    // −240 дБ: всё, что тише, считаем нулём

  // В петле ничего не звучит: та часть линии, которую сейчас слышно, — сплошные нули, и фильтр затих.
  bool loopIsSilent() const {
    const double heard = tapeMode_ ? (delay_ < kMinLoop ? kMinLoop : delay_) : delay_;
    return zerosInLine_ >= heard && loopFilter_.silent();
  }

  static bool inputIsSilent(const float* in, int n) {
    for (int k = 0; k < n; k++) if (in[k] != 0) return false;
    return true;
  }

  // Тихий блок: на выход и в линию — нули, а ручки и время доходят до целей за n сэмплов разом:
  // y → цель + (y − цель)·(1 − c)^n — то же, что n шагов по одному, с точностью до округления.
  void skipSilentBlock(float* out, int n) {
    const double knobLeft = std::pow(1 - knobCoef_, n);
    sendGain_.y = sendTarget_ + (sendGain_.y - sendTarget_) * knobLeft;
    feedbackGain_.y = feedbackTarget_ + (feedbackGain_.y - feedbackTarget_) * knobLeft;
    if (tapeMode_) delay_ = delayTarget_ + (delay_ - delayTarget_) * std::pow(1 - delayCoef_, n);
    for (int k = 0; k < n; k++) { line_.write(0); out[k] = 0; }
  }

  float memory_[MAX];
  Delay line_;
  Biquad loopFilter_;

  OnePole sendGain_, feedbackGain_;  // где ручки сейчас
  double sendTarget_ = 0, feedbackTarget_ = 0;
  double knobCoef_ = 0;              // доля пути ручки к цели за один сэмпл

  double sampleRate_ = 48000;
  double delay_ = 1;                 // время задержки сейчас, сэмплов (в режиме «лента» — дробное)
  double delayTarget_ = 0;           // куда ползёт время в режиме «лента», сэмплов
  double delayCoef_ = 0;             // доля пути времени к цели за один сэмпл
  bool tapeMode_ = false;            // был вызван glideTo()

  double zerosInLine_ = MAX;         // сколько нулей подряд записано в линию
};

}  // namespace sdk

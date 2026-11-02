// Phaser — фейзер: NS всепропускающих фильтров подряд (как цепочка BiquadFilterNode 'allpass' в Web Audio),
// их частоты плывут от одного синус-LFO (OscillatorNode × GainNode на frequency каждого фильтра):
//
//   f_i(t) = base_i + depth·sin(2π·rate·t),   выход = wet · allpass_NS(… allpass_1(вход))
//
// Отдаёт только мокрое: бегущие провалы появляются, когда мир складывает его с сухим.
//
//   phaser.prepare(sr, baseHz, q, rate, depth0);   // baseHz — массив из NS частот
//   phaser.set(wet, depth);                        // когда угодно; оба плывут как setTargetAtTime(·, 0.05)
//   phaser.process(inL, inR, feed, outL, outR, n); // блок
//
// ЛОВУШКИ:
//   - Q линейный, как у allpass в Web Audio (не дБ). q ≤ 0 — фильтры пропускают как есть.
//   - f ≤ 0 или ≥ Найквиста — фильтр пропускает как есть (так делает Chromium; формула RBJ там дала бы
//     двойной полюс в 1). Глубина больше базы — часть периода фильтр «выключен».
//   - Коэффициенты считаются раз в STEP = 16 сэмплов (Web Audio — каждый сэмпл; LFO медленный, разницы не слышно).
//   - feed = false — на вход идёт тишина (фейзер отцеплен), хвост дозвучивает. Через QUIET сэмплов тишины
//     блок не считается и обнуляет память фильтров; время LFO идёт и тогда.
// Цена — 2·NS биквадов на сэмпл и NS расчётов коэффициентов (sin, cos) раз в 16 сэмплов.
// Состояние внутри объекта, в process аллокаций нет.
#pragma once
#include <cmath>

namespace sdk {

template <int NS>
class Phaser {
 public:
  static constexpr int STEP = 16, QUIET = 4096;        // хвост allpass на 320 Гц и Q 0.6 гаснет за единицы мс
  void prepare(double sr, const double* base, double q, double rate, double depth0 = 0) {
    sampleRate_ = sr > 0 ? sr : 48000; q_ = q; rate_ = rate; smoothCoef_ = 1 - std::exp(-1 / (0.05 * sampleRate_));
    for (int i = 0; i < NS; i++) { baseHz_[i] = base[i]; for (int c = 0; c < 2; c++) state_[i][c] = State{}; coefs_[i] = Coefs{}; }
    lfoPhase_ = 0; wet_ = wetTarget_ = 0; depth_ = depthTarget_ = depth0; quietSamples_ = QUIET; sinceCoefs_ = 0;
  }
  void set(double wet, double depth) { wetTarget_ = wet; depthTarget_ = depth; }
  void process(const float* inL, const float* inR, bool feed, float* outL, float* outR, int n) {
    if (!feed && quietSamples_ >= QUIET && std::fabs(wet_ - wetTarget_) < 1e-9) {   // хвост отзвучал — не считаем, LFO идёт
      for (int k = 0; k < n; k++) outL[k] = outR[k] = 0;
      advance(n);
      depth_ = depthTarget_;
      sinceCoefs_ = 0;
      return;
    }
    for (int k = 0; k < n; k++) {
      wet_ += (wetTarget_ - wet_) * smoothCoef_; depth_ += (depthTarget_ - depth_) * smoothCoef_;
      if (sinceCoefs_ == 0) updateCoefs();
      sinceCoefs_ = (sinceCoefs_ + 1) % STEP;
      double l = feed ? inL[k] : 0, r = feed ? inR[k] : 0;
      for (int i = 0; i < NS; i++) { l = state_[i][0].step(coefs_[i], l); r = state_[i][1].step(coefs_[i], r); }
      outL[k] = static_cast<float>(l * wet_); outR[k] = static_cast<float>(r * wet_);
      advance(1);
    }
    if (feed) quietSamples_ = 0;
    else if (quietSamples_ < QUIET) {
      quietSamples_ += n;
      if (quietSamples_ >= QUIET) for (auto& s : state_) for (auto& q : s) q = State{};   // уснул — с чистого листа
    }
  }

 private:
  struct Coefs { double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0; };   // по умолчанию — провод
  struct State {                                        // память одного allpass одного канала
    double previousInput = 0, inputBeforePrevious = 0, previousOutput = 0, outputBeforePrevious = 0;
    double step(const Coefs& c, double x) {
      const double y = c.b0 * x + c.b1 * previousInput + c.b2 * inputBeforePrevious - c.a1 * previousOutput - c.a2 * outputBeforePrevious;
      inputBeforePrevious = previousInput; previousInput = x; outputBeforePrevious = previousOutput; previousOutput = y;
      return y;
    }
  };
  void updateCoefs() {                                  // allpass RBJ: b — зеркало a
    const double lfo = depth_ * std::sin(2 * M_PI * lfoPhase_);
    for (int i = 0; i < NS; i++) {
      const double f = baseHz_[i] + lfo, nf = f / (sampleRate_ / 2);
      Coefs& c = coefs_[i];
      if (!(nf > 0 && nf < 1) || q_ <= 0) { c = Coefs{}; continue; }
      const double w = M_PI * nf, al = std::sin(w) / (2 * q_), k = std::cos(w), a0 = 1 + al;
      c.b0 = (1 - al) / a0; c.b1 = -2 * k / a0; c.b2 = (1 + al) / a0; c.a1 = -2 * k / a0; c.a2 = (1 - al) / a0;
    }
  }
  void advance(int n) { lfoPhase_ += rate_ * n / sampleRate_; lfoPhase_ -= std::floor(lfoPhase_); }
  double baseHz_[NS] = {};
  Coefs coefs_[NS];
  State state_[NS][2];                                  // [фильтр][L, R]
  double sampleRate_ = 48000, q_ = 0.6, rate_ = 0.1, smoothCoef_ = 0, lfoPhase_ = 0;
  double wet_ = 0, wetTarget_ = 0, depth_ = 0, depthTarget_ = 0;
  int quietSamples_ = QUIET;                            // сколько сэмплов подряд вход молчит
  int sinceCoefs_ = 0;                                  // сэмплов с последнего пересчёта коэффициентов (по модулю STEP)
};

}  // namespace sdk

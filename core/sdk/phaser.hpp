// Фейзер: NS всепропускающих фильтров подряд (как цепочка BiquadFilterNode 'allpass' в Web Audio), их частоты плывут от одного
// синус-LFO (OscillatorNode × GainNode на frequency каждого фильтра):
//   f_i(t) = clamp(base_i + depth·sin(2π·rate·t), 0, sr/2),   выход = wet · allpass_NS(…allpass_1(вход))
// Только мокрое — сухое с ним складывает мир (бегущие провалы и есть сумма). Q — линейный, как у allpass в Web Audio.
// f ≤ 0 или ≥ Найквиста — фильтр пропускает как есть (так делает Chromium; формула RBJ там дала бы двойной полюс в 1).
// wet и depth сглаживаются как setTargetAtTime(·, 0.05); коэффициенты — раз в STEP сэмплов (в Web Audio — каждый сэмпл; LFO медленный,
// разницы не слышно). feed = false — на вход идёт тишина (фейзер отцеплен), хвост дозвучивает; совсем тихо — блок не считается
// (время LFO идёт). Состояние — внутри объекта, в process аллокаций нет.
#pragma once
#include <cmath>

namespace sdk {

template <int NS>
class Phaser {
 public:
  static constexpr int STEP = 16, QUIET = 4096;        // хвост allpass на 320 Гц и Q 0.6 гаснет за единицы мс
  void prepare(double sr, const double* base, double q, double rate, double depth0 = 0) {
    sr_ = sr > 0 ? sr : 48000; q_ = q; rate_ = rate; c_ = 1 - std::exp(-1 / (0.05 * sr_));
    for (int i = 0; i < NS; i++) { base_[i] = base[i]; for (int c = 0; c < 2; c++) st_[i][c] = St{}; co_[i] = Co{}; }
    ph_ = 0; wet_ = wetTo_ = 0; depth_ = depthTo_ = depth0; quiet_ = QUIET; k_ = 0;
  }
  void set(double wet, double depth) { wetTo_ = wet; depthTo_ = depth; }
  void process(const float* inL, const float* inR, bool feed, float* outL, float* outR, int n) {
    if (!feed && quiet_ >= QUIET && std::fabs(wet_ - wetTo_) < 1e-9) {   // хвост отзвучал — не считаем, LFO идёт
      for (int k = 0; k < n; k++) outL[k] = outR[k] = 0;
      advance(n);
      depth_ = depthTo_;
      k_ = 0;
      return;
    }
    for (int k = 0; k < n; k++) {
      wet_ += (wetTo_ - wet_) * c_; depth_ += (depthTo_ - depth_) * c_;
      if (k_ == 0) coefs();
      k_ = (k_ + 1) % STEP;
      double l = feed ? inL[k] : 0, r = feed ? inR[k] : 0;
      for (int i = 0; i < NS; i++) { l = st_[i][0].step(co_[i], l); r = st_[i][1].step(co_[i], r); }
      outL[k] = static_cast<float>(l * wet_); outR[k] = static_cast<float>(r * wet_);
      advance(1);
    }
    if (feed) quiet_ = 0;
    else if (quiet_ < QUIET) {
      quiet_ += n;
      if (quiet_ >= QUIET) for (auto& s : st_) for (auto& q : s) q = St{};   // уснул — с чистого листа
    }
  }

 private:
  struct Co { double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0; };
  struct St {
    double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    double step(const Co& c, double x) {
      const double y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      return y;
    }
  };
  void coefs() {
    const double lfo = depth_ * std::sin(2 * M_PI * ph_);
    for (int i = 0; i < NS; i++) {
      const double f = base_[i] + lfo, nf = f / (sr_ / 2);
      Co& c = co_[i];
      if (!(nf > 0 && nf < 1) || q_ <= 0) { c = Co{}; continue; }
      const double w = M_PI * nf, al = std::sin(w) / (2 * q_), k = std::cos(w), a0 = 1 + al;
      c.b0 = (1 - al) / a0; c.b1 = -2 * k / a0; c.b2 = (1 + al) / a0; c.a1 = -2 * k / a0; c.a2 = (1 - al) / a0;
    }
  }
  void advance(int n) { ph_ += rate_ * n / sr_; ph_ -= std::floor(ph_); }
  double base_[NS] = {};
  Co co_[NS];
  St st_[NS][2];
  double sr_ = 48000, q_ = 0.6, rate_ = 0.1, c_ = 0, ph_ = 0, wet_ = 0, wetTo_ = 0, depth_ = 0, depthTo_ = 0;
  int quiet_ = QUIET, k_ = 0;
};

}  // namespace sdk

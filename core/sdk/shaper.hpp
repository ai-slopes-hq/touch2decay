// Нормированный tanh: y = tanh(k·x) / tanh(k) на [−1, 1], вне — край (±1), как WaveShaperNode с такой кривой (в вебе — 1024 точки).
// os2 — oversample 2×, как у WaveShaperNode '2x': апсэмпл полуполосным FIR, кривая на удвоенной частоте, даунсэмпл тем же FIR (47 отводов,
// задержка ≈ 23 сэмпла основной частоты). Без аллокаций; k и os2 — параметры блока (Inferno: круг k = 1 + 6·drive без os, шина fire k = 1 + 8·fire, os 2×).
#pragma once
#include <cmath>

namespace sdk {

struct Shaper {
  bool os2 = false;
  void set(double k) { k_ = k < 1e-3 ? 1e-3 : k; norm_ = 1.0 / std::tanh(k_); }
  double k() const { return k_; }
  double shape(double x) const { x = x > 1 ? 1 : x < -1 ? -1 : x; return std::tanh(k_ * x) * norm_; }
  double step(double x) {
    if (!os2) return shape(x);
    const double* h = taps();
    for (int p = 0; p < 2; p++) {                       // два отсчёта удвоенной частоты: x·2 (нули между — вставка) и 0
      up_[ui_] = p == 0 ? 2 * x : 0; 
      double u = 0;
      for (int j = 0, i = ui_; j < N; j++) { u += h[j] * up_[i]; if (--i < 0) i = N - 1; }
      ui_ = ui_ + 1 == N ? 0 : ui_ + 1;
      dn_[di_] = shape(u);
      if (p == 1) {
        double y = 0;
        for (int j = 0, i = di_; j < N; j++) { y += h[j] * dn_[i]; if (--i < 0) i = N - 1; }
        di_ = di_ + 1 == N ? 0 : di_ + 1;
        return y;
      }
      di_ = di_ + 1 == N ? 0 : di_ + 1;
    }
    return 0;                                           // недостижимо
  }
  void reset() { for (double& v : up_) v = 0; for (double& v : dn_) v = 0; ui_ = di_ = 0; }

 private:
  static constexpr int N = 47;
  static const double* taps() {                         // полуполосный sinc (fc = ¼ частоты удвоенной), окно Блэкмана, сумма = 1
    static double h[N];
    static bool ready = false;
    if (!ready) {
      const int M = (N - 1) / 2;
      double s = 0;
      for (int n = 0; n < N; n++) {
        const double t = n - M, a = M_PI * 0.5 * t;
        const double sinc = t == 0 ? 1.0 : std::sin(a) / a;
        const double w = 0.42 - 0.5 * std::cos(2 * M_PI * n / (N - 1)) + 0.08 * std::cos(4 * M_PI * n / (N - 1));
        h[n] = 0.5 * sinc * w; s += h[n];
      }
      for (int n = 0; n < N; n++) h[n] /= s;
      ready = true;
    }
    return h;
  }
  double k_ = 1, norm_ = 1 / std::tanh(1.0);
  double up_[N] = {}, dn_[N] = {};
  int ui_ = 0, di_ = 0;
};

}  // namespace sdk

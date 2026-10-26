// Shaper<N> — WaveShaperNode: кривая из N точек (float, как Float32Array), v = (N − 1)·(x + 1)/2, линейная интерполяция между соседними;
// v < 0 — первая точка, v ≥ N − 1 — последняя. step() — кривая без oversample (const, без задержки); run() — с oversample по `os`.
// TanhShaper — нормированный tanh: y = tanh(k·x) / tanh(k) на [−1, 1], вне — край (±1), как WaveShaperNode с такой кривой (в вебе — 1024 точки).
// os — oversample, как у WaveShaperNode: 1 — нет; 2 — '2x': апсэмпл полуполосным FIR, кривая на удвоенной частоте, даунсэмпл тем же FIR
// (47 отводов, задержка ≈ 23 сэмпла основной частоты, приблизительно как у браузера); 4 — '4x': каскад двух ступеней, как Chromium
// (WaveShaperDSPKernel::ProcessCurve4x: апсэмпл 2× → 2× → кривая → даунсэмпл 2× → 2×), ступени — ядра Chromium (UpSampler 128 отводов,
// DownSampler 256), сверено с ним по сэмплам (tools/shaper-os4-ref.py); задержка 192 сэмпла. Без аллокаций; k и os — параметры блока
// (Inferno: круг k = 1 + 6·drive без os, шина fire k = 1 + 8·fire, os = 2; Tenebrae: drive asym, os = 4).
#pragma once
#include <cmath>

namespace sdk {

// Одна ступень 2×: вход основной частоты → два отсчёта удвоенной → g на каждом → один отсчёт основной. g — кривая (или вложенная ступень).
struct Os2 {
  template <class G>
  double step(double x, G&& g) {
    const double* h = taps();
    for (int p = 0; p < 2; p++) {                       // два отсчёта удвоенной частоты: x·2 (нули между — вставка) и 0
      up_[ui_] = p == 0 ? 2 * x : 0;
      double u = 0;
      for (int j = 0, i = ui_; j < N; j++) { u += h[j] * up_[i]; if (--i < 0) i = N - 1; }
      ui_ = ui_ + 1 == N ? 0 : ui_ + 1;
      dn_[di_] = g(u);
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
  double up_[N] = {}, dn_[N] = {};
  int ui_ = 0, di_ = 0;
};

// Ступень 2× из Chromium (UpSampler / DownSampler): апсэмпл — чётные отсчёты = вход, задержанный на 64, нечётные — свёртка с 128-точечным
// sinc (сдвиг на полсэмпла, окно Блэкмана α = 0.16); даунсэмпл — 256-точечный полуполосный sinc·½ с тем же окном, берутся чётные отсчёты
// (у полуполосного ядра нули на чётных смещениях, кроме центра, — их не считаем). Задержка ступени: 64 + 64 = 128 отсчётов основной частоты.
struct OsChromium {
  template <class G>
  double step(double x, G&& g) {
    const Kernels& k = kernels();
    ux_.push(x);
    const double* xp = ux_.at();
    double u1 = 0;
    for (int i = 0; i < UP; i++) u1 += k.up[i] * xp[i];
    const double v0 = g(xp[UP / 2]);                    // чётный отсчёт удвоенной частоты
    de_.push(v0);
    double y = k.dn[DN / 2] * de_.at()[DN / 4];         // центр ядра: v[2m − 128]
    const double* op = do_.at();
    for (int t = 0; t < DN / 2; t++) y += k.dn[2 * t + 1] * op[t];   // нечётные смещения: v[2m − 1 − 2t]
    do_.push(g(u1));
    return y;
  }
  void reset() { ux_ = Hist<UP>(); de_ = Hist<DN / 4 + 1>(); do_ = Hist<DN / 2>(); }

 private:
  static constexpr int UP = 128, DN = 256;
  template <int L>
  struct Hist {                                         // история: at()[0] — новейший, at()[k] — k шагов назад (двойной буфер — без деления по модулю)
    double b[2 * L] = {};
    int p = 0;
    void push(double v) { p = p == 0 ? L - 1 : p - 1; b[p] = b[p + L] = v; }
    const double* at() const { return b + p; }
  };
  struct Kernels {
    double up[UP], dn[DN];
    Kernels() {
      const double a0 = 0.5 * (1 - 0.16), a1 = 0.5, a2 = 0.5 * 0.16;
      for (int i = 0; i < UP; i++) {
        const double s = M_PI * (i - UP / 2 + 0.5), x = (i + 0.5) / UP;
        up[i] = (s == 0 ? 1.0 : std::sin(s) / s) * (a0 - a1 * std::cos(2 * M_PI * x) + a2 * std::cos(4 * M_PI * x));
      }
      for (int i = 0; i < DN; i++) {
        const double s = M_PI * (i - DN / 2) * 0.5, x = static_cast<double>(i) / DN;
        dn[i] = 0.5 * (s == 0 ? 1.0 : std::sin(s) / s) * (a0 - a1 * std::cos(2 * M_PI * x) + a2 * std::cos(4 * M_PI * x));
      }
    }
  };
  static const Kernels& kernels() { static const Kernels k; return k; }
  Hist<UP> ux_;
  Hist<DN / 4 + 1> de_;
  Hist<DN / 2> do_;
};

// Oversample по os (1, 2, 4): a — ступень 2× (при 4 — внешняя), b, c — внешняя и внутренняя ступени Chromium.
template <class G>
inline double oversample(int os, Os2& a, OsChromium& b, OsChromium& c, double x, G&& g) {
  if (os >= 4) return b.step(x, [&](double u) { return c.step(u, g); });
  if (os >= 2) return a.step(x, g);
  return g(x);
}

template <int N>
struct Shaper {
  float c[N] = {};
  template <class F>
  void build(F fn) { for (int i = 0; i < N; i++) c[i] = static_cast<float>(fn(static_cast<double>(i) / (N - 1) * 2 - 1)); }   // x = i/(N−1)·2 − 1
  double step(double x) const {
    const double v = (N - 1) * (x + 1) * 0.5;
    if (!(v > 0)) return c[0];
    if (v >= N - 1) return c[N - 1];
    const int k = static_cast<int>(v);
    const double f = v - k;
    return (1 - f) * c[k] + f * c[k + 1];
  }
  double run(double x) { return oversample(os, a_, b_, c_, x, [this](double u) { return step(u); }); }
  void reset() { a_.reset(); b_.reset(); c_.reset(); }
  int os = 1;

 private:
  Os2 a_;
  OsChromium b_, c_;
};

struct TanhShaper {
  int os = 1;
  void set(double k) { k_ = k < 1e-3 ? 1e-3 : k; norm_ = 1.0 / std::tanh(k_); }
  double k() const { return k_; }
  double shape(double x) const { x = x > 1 ? 1 : x < -1 ? -1 : x; return std::tanh(k_ * x) * norm_; }
  double step(double x) { return oversample(os, a_, b_, c_, x, [this](double u) { return shape(u); }); }
  void reset() { a_.reset(); b_.reset(); c_.reset(); }

 private:
  double k_ = 1, norm_ = 1 / std::tanh(1.0);
  Os2 a_;
  OsChromium b_, c_;
};

}  // namespace sdk

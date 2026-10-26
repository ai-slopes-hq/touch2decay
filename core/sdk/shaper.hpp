// Shaper<N> — WaveShaperNode: кривая из N точек (float, как Float32Array), v = (N − 1)·(x + 1)/2, линейная интерполяция между соседними;
// v < 0 — первая точка, v ≥ N − 1 — последняя. step() — кривая без oversample (const, без задержки); run() — с oversample по `os`.
// TanhShaper — нормированный tanh: y = tanh(k·x) / tanh(k) на [−1, 1], вне — край (±1), как WaveShaperNode с такой кривой (в вебе — 1024 точки).
// os — oversample, как у WaveShaperNode: 1 — нет; 2 — '2x': апсэмпл полуполосным FIR, кривая на удвоенной частоте, даунсэмпл тем же FIR
// (47 отводов, задержка ≈ 23 сэмпла основной частоты, приблизительно как у браузера); 4 — '4x': каскад двух ступеней, как Chromium
// (WaveShaperDSPKernel::ProcessCurve4x: апсэмпл 2× → 2× → кривая → даунсэмпл 2× → 2×), ступени — ядра Chromium (UpSampler 128 отводов,
// DownSampler 256), сверено с ним по сэмплам (tools/shaper-os4-ref.py); задержка 192 сэмпла. Без аллокаций; k и os — параметры блока
// (Inferno: круг k = 1 + 6·drive без os, шина fire k = 1 + 8·fire, os = 2; Tenebrae: drive asym, os = 4).
// Shaper2<N>, TanhShaper2 — то же для пары каналов (L, R) с одной кривой: ступени oversample считают оба канала одной SIMD-операцией
// (V2 — два double), каждая дорожка — те же умножения и сложения в том же порядке, что у моно, — выход до бита как у двух моно.
#pragma once
#include <cmath>

namespace sdk {

// два double одной операцией (NEON / SSE2 / wasm simd128; без SIMD компилятор разложит на скаляры). Без FMA (-ffp-contract=off) — до бита
typedef double V2 __attribute__((vector_size(16)));

// история отсчётов: at()[0] — новейший, at()[k] — k шагов назад (двойной буфер — без деления по модулю и ветвления в свёртке)
template <class T, int L>
struct Hist {
  T b[2 * L] = {};
  int p = 0;
  void push(T v) { p = p == 0 ? L - 1 : p - 1; b[p] = b[p + L] = v; }
  const T* at() const { return b + p; }
};

// Одна ступень 2×: вход основной частоты → два отсчёта удвоенной → g на каждом → один отсчёт основной. g — кривая (или вложенная ступень).
// Апсэмпл — полифазно: вход с нулями между отсчётами, слагаемые h·0 пропущены (прибавить точный ноль — ни одного бита), порядок остальных —
// прежний (j по возрастанию). Отсчёт удвоенной p = 0 — чётные отводы по x[0], x[1] …; p = 1 — нечётные. T — double (моно) или V2 (пара).
template <class T>
struct Os2T {
  template <class G>
  T step(T x, G&& g) {
    const double* h = taps();
    up_.push(2 * x);
    const T* xp = up_.at();
    T u0 = T(), u1 = T();
    for (int m = 0; m < NU - 1; m++) { u0 += h[2 * m] * xp[m]; u1 += h[2 * m + 1] * xp[m]; }   // две независимые цепочки
    u0 += h[2 * (NU - 1)] * xp[NU - 1];
    dn_.push(g(u0));
    dn_.push(g(u1));
    const T* dp = dn_.at();
    T y = T();
    for (int j = 0; j < N; j++) y += h[j] * dp[j];
    return y;
  }
  // K ступеней за раз (голоса мира): у каждой — те же суммы в том же порядке, что в step, до бита; цепочки сложений K ступеней идут
  // вперемешку — процессор считает их параллельно, а не ждёт каждую. g(v, u) — кривая ступени v
  template <int K, class G>
  static void stepK(Os2T* const* s, T* x, G&& g) {
    const double* h = taps();
    const T* xp[K];
    for (int v = 0; v < K; v++) { s[v]->up_.push(2 * x[v]); xp[v] = s[v]->up_.at(); }
    T u0[K], u1[K];
    for (int v = 0; v < K; v++) u0[v] = u1[v] = T();
    for (int m = 0; m < NU - 1; m++)
      for (int v = 0; v < K; v++) { u0[v] += h[2 * m] * xp[v][m]; u1[v] += h[2 * m + 1] * xp[v][m]; }
    for (int v = 0; v < K; v++) u0[v] += h[2 * (NU - 1)] * xp[v][NU - 1];
    const T* dp[K];
    for (int v = 0; v < K; v++) { s[v]->dn_.push(g(v, u0[v])); s[v]->dn_.push(g(v, u1[v])); dp[v] = s[v]->dn_.at(); }
    T y[K];
    for (int v = 0; v < K; v++) y[v] = T();
    for (int j = 0; j < N; j++)
      for (int v = 0; v < K; v++) y[v] += h[j] * dp[v][j];
    for (int v = 0; v < K; v++) x[v] = y[v];
  }
  void reset() { up_ = Hist<T, NU>(); dn_ = Hist<T, N>(); }

 private:
  static constexpr int N = 47, NU = (N + 1) / 2;       // NU — отсчётов входа под ядром: 24
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
  Hist<T, NU> up_;
  Hist<T, N> dn_;
};

// Ступень 2× из Chromium (UpSampler / DownSampler): апсэмпл — чётные отсчёты = вход, задержанный на 64, нечётные — свёртка с 128-точечным
// sinc (сдвиг на полсэмпла, окно Блэкмана α = 0.16); даунсэмпл — 256-точечный полуполосный sinc·½ с тем же окном, берутся чётные отсчёты
// (у полуполосного ядра нули на чётных смещениях, кроме центра, — их не считаем). Задержка ступени: 64 + 64 = 128 отсчётов основной частоты.
template <class T>
struct OsChromiumT {
  template <class G>
  T step(T x, G&& g) {
    const Kernels& k = kernels();
    ux_.push(x);
    const T* xp = ux_.at();
    de_.push(g(xp[UP / 2]));                            // чётный отсчёт удвоенной частоты (g — до g(u1), как всегда)
    T u1 = T(), y = k.dn[DN / 2] * de_.at()[DN / 4];    // центр ядра: v[2m − 128]
    const T* op = do_.at();
    static_assert(UP == DN / 2, "одна петля на обе свёртки");
    for (int t = 0; t < UP; t++) { u1 += k.up[t] * xp[t]; y += k.dn[2 * t + 1] * op[t]; }   // апсэмпл и нечётные смещения v[2m − 1 − 2t]
    do_.push(g(u1));
    return y;
  }
  // каскад 4× (o — внешняя ступень, i — внутренняя), до бита как o.step(x, [&](T u) { return i.step(u, g); }): те же суммы в том же порядке
  // и та же очередь вызовов g, но свёртка внешней ступени и первого прохода внутренней — в одной петле (цепочки независимы: внешней
  // нужен только вход и её история, внутренней — задержанный вход внешней), так у процессора вдвое больше цепочек сложений в работе
  template <class G>
  static T step4(OsChromiumT& o, OsChromiumT& i, T x, G&& g) {
    const Kernels& k = kernels();
    o.ux_.push(x);
    const T* xp = o.ux_.at();
    i.ux_.push(xp[UP / 2]);                             // внутренняя, первый проход: вход — чётный отсчёт внешней
    const T* ip = i.ux_.at();
    i.de_.push(g(ip[UP / 2]));
    T iu = T(), iy = k.dn[DN / 2] * i.de_.at()[DN / 4];
    T ou = T(), oy = k.dn[DN / 2] * o.de_.at()[DN / 4 - 1];   // у внешней push(v0) ещё впереди: at()[DN/4] после него — at()[DN/4 − 1] сейчас
    const T *iop = i.do_.at(), *oop = o.do_.at();
    for (int t = 0; t < UP; t++) {
      iu += k.up[t] * ip[t]; iy += k.dn[2 * t + 1] * iop[t];
      ou += k.up[t] * xp[t]; oy += k.dn[2 * t + 1] * oop[t];
    }
    i.do_.push(g(iu));
    o.de_.push(iy);                                     // v0 внешней = выход первого прохода внутренней
    o.do_.push(i.step(ou, g));                          // второй проход внутренней — по апсэмплу внешней
    return oy;
  }
  void reset() { ux_ = Hist<T, UP>(); de_ = Hist<T, DN / 4 + 1>(); do_ = Hist<T, DN / 2>(); }

 private:
  static constexpr int UP = 128, DN = 256;
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
  Hist<T, UP> ux_;
  Hist<T, DN / 4 + 1> de_;
  Hist<T, DN / 2> do_;
};

using Os2 = Os2T<double>;
using OsChromium = OsChromiumT<double>;

// Oversample по os (1, 2, 4): a — ступень 2× (при 4 — внешняя), b, c — внешняя и внутренняя ступени Chromium.
template <class T, class G>
inline T oversample(int os, Os2T<T>& a, OsChromiumT<T>& b, OsChromiumT<T>& c, T x, G&& g) {
  if (os >= 4) return OsChromiumT<T>::step4(b, c, x, g);
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
  double run(double x) { return oversample<double>(os, a_, b_, c_, x, [this](double u) { return step(u); }); }
  void reset() { a_.reset(); b_.reset(); c_.reset(); }
  int os = 1;

 private:
  Os2 a_;
  OsChromium b_, c_;
};

// пара каналов одной кривой: run(l, r) — до бита как run у двух Shaper<N> с той же кривой
template <int N>
struct Shaper2 {
  Shaper<N> curve;                                      // кривая (c, build, step); её собственный oversample не используется
  int os = 1;
  void run(double& l, double& r) {
    const V2 y = oversample<V2>(os, a_, b_, c_, V2{l, r}, [this](V2 u) { return V2{curve.step(u[0]), curve.step(u[1])}; });
    l = y[0]; r = y[1];
  }
  void reset() { a_.reset(); b_.reset(); c_.reset(); }

 private:
  Os2T<V2> a_;
  OsChromiumT<V2> b_, c_;
};

struct TanhShaper {
  int os = 1;
  void set(double k) { k_ = k < 1e-3 ? 1e-3 : k; norm_ = 1.0 / std::tanh(k_); }
  double k() const { return k_; }
  double shape(double x) const { x = x > 1 ? 1 : x < -1 ? -1 : x; return std::tanh(k_ * x) * norm_; }
  double step(double x) { return oversample<double>(os, a_, b_, c_, x, [this](double u) { return shape(u); }); }
  void reset() { a_.reset(); b_.reset(); c_.reset(); }

 private:
  double k_ = 1, norm_ = 1 / std::tanh(1.0);
  Os2 a_;
  OsChromium b_, c_;
};

// пара каналов с одним k: step(l, r) — до бита как step у двух TanhShaper с тем же k
struct TanhShaper2 {
  int os = 1;
  void set(double k) { t_.set(k); }
  void step(double& l, double& r) {
    const V2 y = oversample<V2>(os, a_, b_, c_, V2{l, r}, [this](V2 u) { return V2{t_.shape(u[0]), t_.shape(u[1])}; });
    l = y[0]; r = y[1];
  }
  // n пар за раз (у каждой свой k): до бита как sh[v]->step(io[2v], io[2v + 1]) по очереди; при os 2 — ступени пачками до 6
  static void stepN(TanhShaper2* const* sh, double* io, int n) {
    while (n > 0) {
      const int m = n < 6 ? n : 6;
      bool os2 = true;
      for (int v = 0; v < m; v++) os2 = os2 && sh[v]->os == 2;
      if (!os2) { for (int v = 0; v < m; v++) sh[v]->step(io[2 * v], io[2 * v + 1]); }
      else {
        V2 x[6];
        Os2T<V2>* a[6];
        for (int v = 0; v < m; v++) { x[v] = V2{io[2 * v], io[2 * v + 1]}; a[v] = &sh[v]->a_; }
        const auto g = [sh](int v, V2 u) { return V2{sh[v]->t_.shape(u[0]), sh[v]->t_.shape(u[1])}; };
        switch (m) {
          case 1: Os2T<V2>::stepK<1>(a, x, g); break;
          case 2: Os2T<V2>::stepK<2>(a, x, g); break;
          case 3: Os2T<V2>::stepK<3>(a, x, g); break;
          case 4: Os2T<V2>::stepK<4>(a, x, g); break;
          case 5: Os2T<V2>::stepK<5>(a, x, g); break;
          default: Os2T<V2>::stepK<6>(a, x, g); break;
        }
        for (int v = 0; v < m; v++) { io[2 * v] = x[v][0]; io[2 * v + 1] = x[v][1]; }
      }
      sh += m; io += 2 * m; n -= m;
    }
  }
  void reset() { a_.reset(); b_.reset(); c_.reset(); }

 private:
  TanhShaper t_;                                        // кривая (k, shape); её собственный oversample не используется
  Os2T<V2> a_;
  OsChromiumT<V2> b_, c_;
};

}  // namespace sdk

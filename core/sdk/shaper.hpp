// Перегруз по кривой — то же, что WaveShaperNode в Web Audio: каждый сэмпл x из [−1, 1]
// заменяется значением кривой в этой точке. Здесь живут:
//
//   Shaper<N>     — произвольная кривая из N точек (Portus, Tria, Tenebrae, потолок хоста).
//   TanhShaper    — готовая кривая tanh(k·x) / tanh(k): k — сила перегруза, ±1 остаётся ±1 (Inferno).
//   Shaper2<N>, TanhShaper2 — то же для пары каналов L и R с одной кривой: считают оба канала разом
//                   (SIMD), а результат — до бита как у двух моно.
//
// ЗАЧЕМ OVERSAMPLE. Кривая рождает гармоники выше половины частоты дискретизации, а они
// «заворачиваются» обратно в слышимый диапазон грязью, не кратной ноте. Oversample считает
// кривую на удвоенной (учетверённой) частоте и отфильтровывает лишнее до возврата обратно.
// Поле os: 1 — без него, 2 — '2x', 4 — '4x', как у WaveShaperNode.
//
// Три способа, и у каждого своя задержка:
//   os 1          — без oversample, без задержки.
//   os 2          — наш полуполосный FIR на 47 отводов: задержка ≈ 23 сэмпла, около 95 умножений
//                   на сэмпл. Звучит почти как браузер, но не до сэмпла (Inferno, шина fire).
//   os 2 Chromium — TanhShaper2 с chromium = true: ступень ровно как у Chromium, задержка 128,
//                   около 260 умножений (голоса Tenebrae).
//   os 4          — каскад двух ступеней Chromium, сверен с ним по сэмплам (tools/shaper-os4-ref.py):
//                   задержка 192, около 770 умножений на сэмпл — дорого (Tenebrae drive, потолок хоста).
//
// ЛОВУШКИ:
//   - Задержка зависит от os. Смешиваешь сухой сигнал с перегруженным — задержи сухой на столько же,
//     иначе получится гребёнка.
//   - Меняешь os на ходу — зови reset(): у ступени, которая включается, в истории лежит старый звук.
//   - Кривая хранится во float (как Float32Array в вебе), точки строит build().
//   - Вход за пределами [−1, 1]: Shaper держит крайнюю точку, TanhShaper зажимает в ±1.
//   - Пары (…2) и пачки (stepK, step4, stepN) обязаны давать то же до бита, что моно по одному сэмплу:
//     это проверяют тесты в core/tests/sdk_test.cpp. Меняешь порядок сложений в одной версии —
//     меняй во всех.
//   - Код ступеней написан ради скорости (на iPhone лагало): несколько независимых цепочек
//     сложений в одной петле, чтобы процессор считал их параллельно. Не «упрощай» в одну цепочку
//     без замера.
//
// Аллокаций нет, вся история — внутри объектов.

#pragma once

#include <cmath>

namespace sdk {

// Два double одной операцией (NEON / SSE2 / wasm simd128; без SIMD компилятор разложит на скаляры).
// Сборка идёт без FMA (-ffp-contract=off) — поэтому каждая дорожка совпадает с моно до бита.
typedef double V2 __attribute__((vector_size(16)));

// Последние L отсчётов. recent()[0] — самый новый, recent()[k] — k шагов назад.
// Каждый отсчёт пишется дважды (буфер 2·L), чтобы recent() всегда давал L подряд идущих
// значений — свёртке не нужны ни деление по модулю, ни проверки края.
template <class T, int L>
struct History {
  T buf[2 * L] = {};
  int head = 0;
  void push(T v) { head = head == 0 ? L - 1 : head - 1; buf[head] = buf[head + L] = v; }
  const T* recent() const { return buf + head; }
};

// ---- Ступень 2× на нашем FIR (47 отводов) ----
//
// Один шаг: сэмпл основной частоты → два сэмпла удвоенной → curve на каждом → обратно один сэмпл.
// curve — кривая или вложенная ступень. T — double (моно) или V2 (пара каналов).
//
// Апсэмпл полифазный: «вход с нулями между отсчётами» не строим, а сразу берём чётные отводы
// для первого сэмпла удвоенной частоты и нечётные — для второго. Пропущенные слагаемые — это h·0,
// точный ноль, так что результат тот же до бита.
template <class T>
struct Os2T {
  template <class Curve>
  T step(T x, Curve&& curve) {
    const double* h = taps();
    upHistory_.push(2 * x);  // ×2 — компенсация нулей между отсчётами
    const T* in = upHistory_.recent();
    T even = T(), odd = T();
    for (int m = 0; m < UP_TAPS - 1; m++) { even += h[2 * m] * in[m]; odd += h[2 * m + 1] * in[m]; }  // две независимые цепочки
    even += h[2 * (UP_TAPS - 1)] * in[UP_TAPS - 1];
    downHistory_.push(curve(even));
    downHistory_.push(curve(odd));
    const T* high = downHistory_.recent();
    T out = T();
    for (int j = 0; j < TAPS; j++) out += h[j] * high[j];
    return out;
  }

  // K ступеней за раз (голоса мира). У каждой — те же суммы в том же порядке, что в step, до бита;
  // цепочки K ступеней идут вперемешку, и процессор считает их параллельно. curve(v, u) — кривая ступени v.
  template <int K, class Curve>
  static void stepK(Os2T* const* stage, T* x, Curve&& curve) {
    const double* h = taps();
    const T* in[K];
    for (int v = 0; v < K; v++) { stage[v]->upHistory_.push(2 * x[v]); in[v] = stage[v]->upHistory_.recent(); }
    T even[K], odd[K];
    for (int v = 0; v < K; v++) even[v] = odd[v] = T();
    for (int m = 0; m < UP_TAPS - 1; m++)
      for (int v = 0; v < K; v++) { even[v] += h[2 * m] * in[v][m]; odd[v] += h[2 * m + 1] * in[v][m]; }
    for (int v = 0; v < K; v++) even[v] += h[2 * (UP_TAPS - 1)] * in[v][UP_TAPS - 1];
    const T* high[K];
    for (int v = 0; v < K; v++) {
      stage[v]->downHistory_.push(curve(v, even[v]));
      stage[v]->downHistory_.push(curve(v, odd[v]));
      high[v] = stage[v]->downHistory_.recent();
    }
    T out[K];
    for (int v = 0; v < K; v++) out[v] = T();
    for (int j = 0; j < TAPS; j++)
      for (int v = 0; v < K; v++) out[v] += h[j] * high[v][j];
    for (int v = 0; v < K; v++) x[v] = out[v];
  }

  void reset() { upHistory_ = History<T, UP_TAPS>(); downHistory_ = History<T, TAPS>(); }

 private:
  static constexpr int TAPS = 47;
  static constexpr int UP_TAPS = (TAPS + 1) / 2;  // сколько входных отсчётов попадает под ядро апсэмпла: 24

  // Полуполосный sinc (срез — ¼ удвоенной частоты, то есть прежний Найквист), окно Блэкмана,
  // сумма отводов = 1. Считается один раз на всю программу.
  static const double* taps() {
    static double h[TAPS];
    static bool ready = false;
    if (!ready) {
      const int M = (TAPS - 1) / 2;
      double s = 0;
      for (int n = 0; n < TAPS; n++) {
        const double t = n - M, a = M_PI * 0.5 * t;
        const double sinc = t == 0 ? 1.0 : std::sin(a) / a;
        const double w = 0.42 - 0.5 * std::cos(2 * M_PI * n / (TAPS - 1)) + 0.08 * std::cos(4 * M_PI * n / (TAPS - 1));
        h[n] = 0.5 * sinc * w;
        s += h[n];
      }
      for (int n = 0; n < TAPS; n++) h[n] /= s;
      ready = true;
    }
    return h;
  }

  History<T, UP_TAPS> upHistory_;  // вход основной частоты (×2)
  History<T, TAPS> downHistory_;   // после кривой, удвоенная частота
};

// ---- Ступень 2× как в Chromium (UpSampler / DownSampler) ----
//
// Апсэмпл: чётные отсчёты удвоенной частоты — просто вход, задержанный на 64; нечётные — свёртка
// со 128-точечным sinc, сдвинутым на полсэмпла (окно Блэкмана α = 0.16).
// Даунсэмпл: 256-точечный полуполосный sinc·½ с тем же окном, берутся чётные отсчёты. У полуполосного
// ядра на чётных смещениях нули (кроме центра) — их не считаем.
// Задержка ступени: 64 + 64 = 128 сэмплов основной частоты.
template <class T>
struct OsChromiumT {
  template <class Curve>
  T step(T x, Curve&& curve) {
    const Kernels& k = kernels();
    input_.push(x);
    const T* in = input_.recent();
    evenHigh_.push(curve(in[UP_TAPS / 2]));  // чётный отсчёт удвоенной частоты (кривая на нём — раньше, чем на нечётном)
    T odd = T(), out = k.down[DOWN_TAPS / 2] * evenHigh_.recent()[DOWN_TAPS / 4];  // центр ядра даунсэмпла
    const T* oddHist = oddHigh_.recent();
    static_assert(UP_TAPS == DOWN_TAPS / 2, "обе свёртки — в одной петле");
    for (int t = 0; t < UP_TAPS; t++) {
      odd += k.up[t] * in[t];                    // апсэмпл: нечётный отсчёт
      out += k.down[2 * t + 1] * oddHist[t];     // даунсэмпл: нечётные смещения
    }
    oddHigh_.push(curve(odd));
    return out;
  }

  // Каскад 4×: outer — внешняя ступень, inner — внутренняя. Даёт до бита то же, что
  //   outer.step(x, [&](T u) { return inner.step(u, curve); })
  // — те же суммы в том же порядке и та же очередь вызовов curve. Разница только в скорости:
  // свёртка внешней ступени и первый проход внутренней идут в одной петле (они друг от друга
  // не зависят), так у процессора вдвое больше цепочек сложений в работе.
  template <class Curve>
  static T step4(OsChromiumT& outer, OsChromiumT& inner, T x, Curve&& curve) {
    const Kernels& k = kernels();
    outer.input_.push(x);
    const T* outerIn = outer.input_.recent();
    inner.input_.push(outerIn[UP_TAPS / 2]);  // первый проход внутренней: её вход — чётный отсчёт внешней
    const T* innerIn = inner.input_.recent();
    inner.evenHigh_.push(curve(innerIn[UP_TAPS / 2]));
    T innerOdd = T(), innerOut = k.down[DOWN_TAPS / 2] * inner.evenHigh_.recent()[DOWN_TAPS / 4];
    // У внешней push чётного ещё впереди (ниже), поэтому центр её ядра сейчас — на шаг ближе: [DOWN_TAPS/4 − 1].
    T outerOdd = T(), outerOut = k.down[DOWN_TAPS / 2] * outer.evenHigh_.recent()[DOWN_TAPS / 4 - 1];
    const T *innerOddHist = inner.oddHigh_.recent(), *outerOddHist = outer.oddHigh_.recent();
    for (int t = 0; t < UP_TAPS; t++) {
      innerOdd += k.up[t] * innerIn[t]; innerOut += k.down[2 * t + 1] * innerOddHist[t];
      outerOdd += k.up[t] * outerIn[t]; outerOut += k.down[2 * t + 1] * outerOddHist[t];
    }
    inner.oddHigh_.push(curve(innerOdd));
    outer.evenHigh_.push(innerOut);                    // чётный отсчёт внешней = выход первого прохода внутренней
    outer.oddHigh_.push(inner.step(outerOdd, curve));  // второй проход внутренней — по нечётному отсчёту внешней
    return outerOut;
  }

  // K ступеней 2× за раз (голоса мира). У каждой — те же суммы в том же порядке, что в step, до бита.
  // Кривая зовётся сперва на чётных отсчётах всех ступеней, потом на нечётных: у каждой ступени
  // своя кривая curve(v, u) и без памяти, так что на результат порядок не влияет.
  template <int K, class Curve>
  static void stepK(OsChromiumT* const* stage, T* x, Curve&& curve) {
    const Kernels& k = kernels();
    const T *in[K], *oddHist[K];
    T odd[K], out[K];
    for (int v = 0; v < K; v++) {
      stage[v]->input_.push(x[v]);
      in[v] = stage[v]->input_.recent();
      stage[v]->evenHigh_.push(curve(v, in[v][UP_TAPS / 2]));
      odd[v] = T();
      out[v] = k.down[DOWN_TAPS / 2] * stage[v]->evenHigh_.recent()[DOWN_TAPS / 4];
      oddHist[v] = stage[v]->oddHigh_.recent();
    }
    for (int t = 0; t < UP_TAPS; t++)
      for (int v = 0; v < K; v++) { odd[v] += k.up[t] * in[v][t]; out[v] += k.down[2 * t + 1] * oddHist[v][t]; }
    for (int v = 0; v < K; v++) { stage[v]->oddHigh_.push(curve(v, odd[v])); x[v] = out[v]; }
  }

  void reset() { input_ = History<T, UP_TAPS>(); evenHigh_ = History<T, DOWN_TAPS / 4 + 1>(); oddHigh_ = History<T, DOWN_TAPS / 2>(); }

 private:
  static constexpr int UP_TAPS = 128, DOWN_TAPS = 256;

  // Ядра Chromium, считаются один раз на всю программу.
  struct Kernels {
    double up[UP_TAPS], down[DOWN_TAPS];
    Kernels() {
      const double a0 = 0.5 * (1 - 0.16), a1 = 0.5, a2 = 0.5 * 0.16;  // окно Блэкмана, α = 0.16
      for (int i = 0; i < UP_TAPS; i++) {
        const double s = M_PI * (i - UP_TAPS / 2 + 0.5), x = (i + 0.5) / UP_TAPS;
        up[i] = (s == 0 ? 1.0 : std::sin(s) / s) * (a0 - a1 * std::cos(2 * M_PI * x) + a2 * std::cos(4 * M_PI * x));
      }
      for (int i = 0; i < DOWN_TAPS; i++) {
        const double s = M_PI * (i - DOWN_TAPS / 2) * 0.5, x = static_cast<double>(i) / DOWN_TAPS;
        down[i] = 0.5 * (s == 0 ? 1.0 : std::sin(s) / s) * (a0 - a1 * std::cos(2 * M_PI * x) + a2 * std::cos(4 * M_PI * x));
      }
    }
  };
  static const Kernels& kernels() { static const Kernels k; return k; }

  History<T, UP_TAPS> input_;                 // вход основной частоты
  History<T, DOWN_TAPS / 4 + 1> evenHigh_;    // чётные отсчёты удвоенной частоты после кривой
  History<T, DOWN_TAPS / 2> oddHigh_;         // нечётные — после кривой
};

using Os2 = Os2T<double>;
using OsChromium = OsChromiumT<double>;

// Выбрать способ по os (1, 2, 4). fir2x — наша ступень для os 2; outer и inner — ступени Chromium для os 4.
template <class T, class Curve>
inline T oversample(int os, Os2T<T>& fir2x, OsChromiumT<T>& outer, OsChromiumT<T>& inner, T x, Curve&& curve) {
  if (os >= 4) return OsChromiumT<T>::step4(outer, inner, x, curve);
  if (os >= 2) return fir2x.step(x, curve);
  return curve(x);
}

// ---- Кривые ----

template <int N>
struct Shaper {
  // Точки кривой: c[0] — значение при x = −1, c[N − 1] — при x = +1, между ними — равномерно.
  // Можно заполнить руками (Tenebrae так нормирует кривую по пику) или через build().
  float c[N] = {};

  // Построить кривую из функции fn(x) на [−1, 1].
  template <class F>
  void build(F fn) { for (int i = 0; i < N; i++) c[i] = static_cast<float>(fn(static_cast<double>(i) / (N - 1) * 2 - 1)); }

  // Кривая в точке x, без oversample и без задержки. Между точками — линейно, как WaveShaperNode.
  double step(double x) const {
    const double v = (N - 1) * (x + 1) * 0.5;  // x → номер точки (дробный)
    if (!(v > 0)) return c[0];                  // !(v > 0), а не v <= 0: NaN тоже уходит в край
    if (v >= N - 1) return c[N - 1];
    const int k = static_cast<int>(v);
    const double f = v - k;
    return (1 - f) * c[k] + f * c[k + 1];
  }

  // Кривая с oversample по os (см. шапку). Зовётся на каждый сэмпл подряд — у ступеней есть память.
  double run(double x) { return oversample<double>(os, fir2x_, outer_, inner_, x, [this](double u) { return step(u); }); }
  void reset() { fir2x_.reset(); outer_.reset(); inner_.reset(); }
  int os = 1;

 private:
  Os2 fir2x_;
  OsChromium outer_, inner_;
};

// Пара каналов с одной кривой: run(l, r) — до бита как run у двух Shaper<N> с той же кривой.
template <int N>
struct Shaper2 {
  Shaper<N> curve;  // кривая (c, build, step); собственный oversample у неё не используется
  int os = 1;
  void run(double& l, double& r) {
    const V2 y = oversample<V2>(os, fir2x_, outer_, inner_, V2{l, r}, [this](V2 u) { return V2{curve.step(u[0]), curve.step(u[1])}; });
    l = y[0];
    r = y[1];
  }
  void reset() { fir2x_.reset(); outer_.reset(); inner_.reset(); }

 private:
  Os2T<V2> fir2x_;
  OsChromiumT<V2> outer_, inner_;
};

struct TanhShaper {
  int os = 1;
  // Сила перегруза: около 0 — почти прямая, 1 — мягко, 5 и больше — почти квадрат. Меньше 0.001 не бывает
  // (иначе tanh(k) → 0 и деление на него).
  void set(double k) { k_ = k < 1e-3 ? 1e-3 : k; norm_ = 1.0 / std::tanh(k_); }
  double k() const { return k_; }
  // Сама кривая, без oversample: tanh(k·x) / tanh(k), вход зажат в [−1, 1].
  double shape(double x) const { x = x > 1 ? 1 : x < -1 ? -1 : x; return std::tanh(k_ * x) * norm_; }
  // Кривая с oversample по os. Зовётся на каждый сэмпл подряд.
  double step(double x) { return oversample<double>(os, fir2x_, outer_, inner_, x, [this](double u) { return shape(u); }); }
  void reset() { fir2x_.reset(); outer_.reset(); inner_.reset(); }

 private:
  double k_ = 1, norm_ = 1 / std::tanh(1.0);  // norm_ = 1 / tanh(k): чтобы ±1 на входе давало ±1 на выходе
  Os2 fir2x_;
  OsChromium outer_, inner_;
};

// Пара каналов с одним k: step(l, r) — до бита как step у двух TanhShaper с тем же k.
struct TanhShaper2 {
  int os = 1;
  bool chromium = false;  // при os 2 — ступень Chromium (как '2x' WaveShaperNode до сэмпла, задержка 128) вместо нашего FIR
  void set(double k) { tanh_.set(k); }
  void step(double& l, double& r) {
    const auto curve = [this](V2 u) { return V2{tanh_.shape(u[0]), tanh_.shape(u[1])}; };
    const V2 y = os == 2 && chromium ? outer_.step(V2{l, r}, curve) : oversample<V2>(os, fir2x_, outer_, inner_, V2{l, r}, curve);
    l = y[0];
    r = y[1];
  }

  // n пар за раз, у каждой свой k (голоса Tenebrae). io — L, R, L, R, …, пишется на место.
  // До бита как sh[v]->step(io[2v], io[2v + 1]) по очереди. Если в пачке все с os 2 и одним способом —
  // ступени считаются пачками до 6 (stepK), иначе — по одной.
  static void stepN(TanhShaper2* const* sh, double* io, int n) {
    while (n > 0) {
      const int m = n < 6 ? n : 6;
      bool allFir2x = true, allChromium2x = true;
      for (int v = 0; v < m; v++) {
        allFir2x = allFir2x && sh[v]->os == 2 && !sh[v]->chromium;
        allChromium2x = allChromium2x && sh[v]->os == 2 && sh[v]->chromium;
      }
      const auto curve = [sh](int v, V2 u) { return V2{sh[v]->tanh_.shape(u[0]), sh[v]->tanh_.shape(u[1])}; };
      if (allChromium2x) {
        V2 x[6];
        OsChromiumT<V2>* stage[6];
        for (int v = 0; v < m; v++) { x[v] = V2{io[2 * v], io[2 * v + 1]}; stage[v] = &sh[v]->outer_; }
        switch (m) {  // K — параметр шаблона, поэтому switch, а не переменная
          case 1: OsChromiumT<V2>::stepK<1>(stage, x, curve); break;
          case 2: OsChromiumT<V2>::stepK<2>(stage, x, curve); break;
          case 3: OsChromiumT<V2>::stepK<3>(stage, x, curve); break;
          case 4: OsChromiumT<V2>::stepK<4>(stage, x, curve); break;
          case 5: OsChromiumT<V2>::stepK<5>(stage, x, curve); break;
          default: OsChromiumT<V2>::stepK<6>(stage, x, curve); break;
        }
        for (int v = 0; v < m; v++) { io[2 * v] = x[v][0]; io[2 * v + 1] = x[v][1]; }
      } else if (!allFir2x) {
        for (int v = 0; v < m; v++) sh[v]->step(io[2 * v], io[2 * v + 1]);
      } else {
        V2 x[6];
        Os2T<V2>* stage[6];
        for (int v = 0; v < m; v++) { x[v] = V2{io[2 * v], io[2 * v + 1]}; stage[v] = &sh[v]->fir2x_; }
        switch (m) {
          case 1: Os2T<V2>::stepK<1>(stage, x, curve); break;
          case 2: Os2T<V2>::stepK<2>(stage, x, curve); break;
          case 3: Os2T<V2>::stepK<3>(stage, x, curve); break;
          case 4: Os2T<V2>::stepK<4>(stage, x, curve); break;
          case 5: Os2T<V2>::stepK<5>(stage, x, curve); break;
          default: Os2T<V2>::stepK<6>(stage, x, curve); break;
        }
        for (int v = 0; v < m; v++) { io[2 * v] = x[v][0]; io[2 * v + 1] = x[v][1]; }
      }
      sh += m;
      io += 2 * m;
      n -= m;
    }
  }
  void reset() { fir2x_.reset(); outer_.reset(); inner_.reset(); }

 private:
  TanhShaper tanh_;  // кривая (k, shape); собственный oversample у неё не используется
  Os2T<V2> fir2x_;
  OsChromiumT<V2> outer_, inner_;
};

}  // namespace sdk

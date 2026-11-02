// Saw — пила с ограниченной полосой (band-limited): наивная пила 2·(phase − round(phase)) плюс поправка у каждого
// разрыва — остаток BLEP, то есть (ступень, пропущенная через оконный sinc) − (идеальная ступень). Без поправки
// резкий разрыв даёт гармоники выше половины частоты дискретизации, и они заворачиваются вниз грязью.
// Это не копия PeriodicWave браузера (там таблицы на октаву и подгонка): задача — чистый спектр,
// как у хороших синтезаторов (Brandt, minBLEP).
//
//   ступень:  sinc с обрезкой FC = 0.40 частоты дискретизации, окно Блэкмана — Харриса, ±16 сэмплов. Таблица
//             остатка — 64 отсчёта на сэмпл, между ними линейно; общая на все пилы, строится один раз (Saw::init).
//   фаза:     от 0, в периодах; значение 0 → 1 на первой половине периода, разрыв +1 → −1 при phase = 0.5
//             (как sawtooth в Web Audio: тот же знак и уровень — первая гармоника 2/π).
//   частота:  dt = f/sr в каждый step, можно менять на ходу; вне 1e-9 … 0.499 прижимается.
//
// ЛОВУШКИ:
//   - Выход отстаёт на latency() = 16 сэмплов (0.33 мс при 48 кГц): поправке нужны сэмплы «до» разрыва.
//     Голосу на огибающей это не слышно, у всех пил одинаково; смешиваешь с другим генератором в фазе — учти.
//   - Таблица общая (static) и строится при первом reset или step (~65 тыс. sin и cos) — зови Saw::init()
//     в prepare, чтобы это не случилось в process и не из двух потоков разом.
// Цена: обычный сэмпл — несколько операций; сэмпл с разрывом — ещё 32 чтения таблицы. Память — кольцо 32 float
// внутри объекта, аллокаций нет.
#pragma once
#include <cmath>
namespace sdk {
class Saw {
 public:
  static constexpr int D = 16;                           // половина ядра, сэмплов
  static constexpr int OS = 64;                          // отсчётов таблицы на сэмпл
  static constexpr double FC = 0.40;                     // обрезка ядра, доли частоты дискретизации
  static int latency() { return D; }

  // таблица остатка R(x) = blstep(x) − 1 для x ∈ [0, D]; для отрицательных — по симметрии blstep(−x) = 1 − blstep(x)
  static void init() {
    if (ready_) return;
    const int SUB = 16, N = D * OS * SUB;                // тонкая сетка для интеграла (трапеции)
    auto h = [](int i) {                                  // ядро: sin(2π·fc·u)/(π·u) · окно Блэкмана — Харриса, u = i/(OS·SUB) ∈ [0, D]
      const double u = static_cast<double>(i) / (OS * SUB), a = M_PI * u / D;
      const double w = 0.35875 + 0.48829 * std::cos(a) + 0.14128 * std::cos(2 * a) + 0.01168 * std::cos(3 * a);
      return (i == 0 ? 2 * FC : std::sin(2 * M_PI * FC * u) / (M_PI * u)) * w;
    };
    double half = 0;                                       // интеграл 0 … D; вся площадь ядра — вдвое больше
    for (int i = 0; i < N; i++) half += 0.5 * (h(i) + h(i + 1)) / (OS * SUB);
    double acc = 0.5;                                      // blstep(0) = 1/2
    residual_[0] = static_cast<float>(acc - 1);
    for (int k = 1; k <= D * OS; k++) {
      for (int j = 0; j < SUB; j++) { const int i = (k - 1) * SUB + j; acc += 0.5 * (h(i) + h(i + 1)) / (OS * SUB) / (2 * half); }
      residual_[k] = static_cast<float>(acc - 1);
    }
    residual_[D * OS] = 0;                                 // на краю ядра поправки нет
    ready_ = true;
  }

  void reset(double ph = 0) {                            // начать с фазы ph и пустой истории
    init();
    phase_ = ph - std::floor(ph); ringPos_ = 0;
    for (int i = 0; i < 2 * D; i++) ring_[i] = 0;
  }
  double step(double dt) {
    if (!ready_) reset(phase_);
    dt = dt < 1e-9 ? 1e-9 : dt > 0.499 ? 0.499 : dt;
    const double p = phase_;
    ring_[ringPos_] += 2 * (p - std::floor(p + 0.5)) ;     // наивная пила: 2·(ph − round(ph)), round(0.5) = 1 — как C
    const int out = (ringPos_ + D) % (2 * D);              // самый старый сэмпл, n − D: поправки от будущих разрывов его уже не трогают
    const double y = ring_[out];
    ring_[out] = 0;
    double q = p + dt;
    if (p < 0.5 && q >= 0.5) {                             // разрыв +1 → −1 между этим сэмплом и следующим
      const double tj = (0.5 - p) / dt;                    // в какой доле сэмпла после этого он случился: 0 < tj ≤ 1
      for (int m = -D + 1; m <= D; m++) {                  // сэмпл n + m: расстояние до разрыва x = m − tj
        const double x = m - tj;
        const double ax = x < 0 ? -x : x;
        if (ax >= D) continue;
        const double f = ax * OS, k = std::floor(f), fr = f - k;
        const int ik = static_cast<int>(k);
        const double r = (1 - fr) * residual_[ik] + fr * residual_[ik + 1];
        ring_[(ringPos_ + m + 2 * D) % (2 * D)] += -2 * (x < 0 ? -r : r);
      }
    }
    phase_ = q - std::floor(q);
    ringPos_ = (ringPos_ + 1) % (2 * D);
    return y;
  }
  double phase() const { return phase_; }

 private:
  double phase_ = 0;
  int ringPos_ = 0;                                      // куда в кольце ложится текущий сэмпл
  float ring_[2 * D] = {};                               // сэмплы n − D … n + D − 1: копят поправки, пока не выйдут
  inline static float residual_[D * OS + 1] = {};
  inline static bool ready_ = false;
};
}  // namespace sdk

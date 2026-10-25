// Пила с ограниченной полосой (band-limited): наивная пила 2·(ph − round(ph)) плюс поправка у каждого разрыва — остаток
// BLEP, то есть (ступень, пропущенная через оконный sinc) − (идеальная ступень). Это не копия PeriodicWave браузера
// (там таблицы на октаву и подгонка): задача — чистый спектр, как у хороших синтезаторов (Brandt, minBLEP).
//   ступень:  sinc с обрезкой fc = 0.40 частоты дискретизации, окно Блэкмана — Харриса, ±16 сэмплов; таблица остатка
//             с 64 отсчётами на сэмпл и линейной интерполяцией (общая на все пилы, строится один раз — Saw::init()).
//   фаза:     ph от 0 в периодах, значение 0 → 1 на первой половине периода, разрыв +1 → −1 при ph = 0.5 (как Web Audio:
//             у sawtooth тот же знак и тот же уровень — первая гармоника 2/π).
//   задержка: выход отстаёт на 16 сэмплов (0.33 мс при 48 кГц) — поправке нужны сэмплы «до» разрыва; для голоса на огибающей
//             это не слышно, одинакова у всех пил.
//   частота:  dt = f / sr на каждый сэмпл (можно менять на ходу), 0 < dt < 0.5; вне диапазона dt прижимается.
// Память — внутри объекта (кольцо 32 float), в step аллокаций нет.
#pragma once
#include <cmath>
namespace sdk {
class Saw {
 public:
  static constexpr int D = 16;                           // половина ядра, сэмплов
  static constexpr int OS = 64;                          // отсчётов таблицы на сэмпл
  static constexpr double FC = 0.40;                     // обрезка ядра, доли частоты дискретизации
  static int latency() { return D; }

  static void init() {                                    // таблица остатка R(x) = blstep(x) − 1 для x ∈ [0, D]; blstep(−x) = 1 − blstep(x)
    if (ready_) return;
    const int SUB = 16, N = D * OS * SUB;                // тонкая сетка для интеграла (трапеции)
    auto h = [](int i) {                                  // ядро: sin(2π·fc·u)/(π·u) · окно Блэкмана — Харриса, u = i / (OS·SUB) ∈ [0, D]
      const double u = static_cast<double>(i) / (OS * SUB), a = M_PI * u / D;
      const double w = 0.35875 + 0.48829 * std::cos(a) + 0.14128 * std::cos(2 * a) + 0.01168 * std::cos(3 * a);
      return (i == 0 ? 2 * FC : std::sin(2 * M_PI * FC * u) / (M_PI * u)) * w;
    };
    double half = 0;                                       // интеграл 0 … D; вся площадь ядра — вдвое больше
    for (int i = 0; i < N; i++) half += 0.5 * (h(i) + h(i + 1)) / (OS * SUB);
    double acc = 0.5;                                      // blstep(0) = 1/2
    r_[0] = static_cast<float>(acc - 1);
    for (int k = 1; k <= D * OS; k++) {
      for (int j = 0; j < SUB; j++) { const int i = (k - 1) * SUB + j; acc += 0.5 * (h(i) + h(i + 1)) / (OS * SUB) / (2 * half); }
      r_[k] = static_cast<float>(acc - 1);
    }
    r_[D * OS] = 0;                                        // на краю ядра поправки нет
    ready_ = true;
  }

  void reset(double ph = 0) {
    init();
    ph_ = ph - std::floor(ph); pos_ = 0;
    for (int i = 0; i < 2 * D; i++) v_[i] = 0;
  }
  double step(double dt) {
    if (!ready_) reset(ph_);
    dt = dt < 1e-9 ? 1e-9 : dt > 0.499 ? 0.499 : dt;
    const double p = ph_;
    v_[pos_] += 2 * (p - std::floor(p + 0.5)) ;           // наивная пила: 2·(ph − round(ph)), round(0.5) = 1 — как C
    const int out = (pos_ + D) % (2 * D);                  // самый старый сэмпл: n − D (окончательный — поправки от будущих разрывов его не трогают)
    const double y = v_[out];
    v_[out] = 0;
    double q = p + dt;
    if (p < 0.5 && q >= 0.5) {                             // разрыв +1 → −1 между этим сэмплом и следующим
      const double tj = (0.5 - p) / dt;                    // доля сэмпла после этого, когда он случился: 0 < tj ≤ 1
      for (int m = -D + 1; m <= D; m++) {                  // сэмпл n + m: расстояние до разрыва x = m − tj
        const double x = m - tj;
        const double ax = x < 0 ? -x : x;
        if (ax >= D) continue;
        const double f = ax * OS, k = std::floor(f), fr = f - k;
        const int ik = static_cast<int>(k);
        const double r = (1 - fr) * r_[ik] + fr * r_[ik + 1];
        v_[(pos_ + m + 2 * D) % (2 * D)] += -2 * (x < 0 ? -r : r);
      }
    }
    ph_ = q - std::floor(q);
    pos_ = (pos_ + 1) % (2 * D);
    return y;
  }
  double phase() const { return ph_; }

 private:
  double ph_ = 0;
  int pos_ = 0;
  float v_[2 * D] = {};
  inline static float r_[D * OS + 1] = {};
  inline static bool ready_ = false;
};
}  // namespace sdk

// Девять форм волны — функции из host/waves.js (WAVES): triangle, sharp, saw, pulse, fold, sync, crush, metal, grain.
// Общие у WaveMorph (LFO строк, lfo.cpp) и у таблиц голосов Tenebrae (worlds/tenebrae/waves.cpp).
//
//   form(idx, t) — значение формы idx (0…8, порядок как выше) в фазе t ∈ [0, 1).
//
// ЛОВУШКИ:
//   - Формы сырые: со средним и пиком как получилось. Убрать среднее и нормировать по пику — у вызывающего
//     (так делают и WaveMorph, и Tenebrae).
//   - Числа — как в JS до последнего бита (jsRound у crush, double у LCG зерна): по ним сверяется Tenebrae.
//     Менять формулу — значит менять звук и LFO во всех мирах.
// Цена — одна-две трансцендентные функции на точку; зовут при построении таблиц, не в process.
#pragma once
#include "jsmath.hpp"
#include <cmath>

namespace sdk {
namespace waveform {

constexpr int COUNT = 9;

inline double tri(double t) {                           // треугольник в фазе синуса: 0 → 1 → −1 → 0
  t = std::fmod(t + 0.25, 1.0);
  if (t < 0) t += 1.0;
  return 1.0 - 4.0 * std::fabs(t - 0.5);
}

// grain: застывший кусок шума — 40 точек от LCG s = 11, s·16807 mod 2147483647, через tanh(3·x) (в double, как в JS)
struct Grain {
  static constexpr int N = 40;
  double v[N];
  Grain() {
    long long s = 11;
    for (int i = 0; i < N; i++) { s = (s * 16807) % 2147483647; v[i] = std::tanh(3.0 * ((s / 2147483647.0) * 2.0 - 1.0)); }
  }
};
inline const Grain& grain() { static const Grain g; return g; }

inline double form(int idx, double t) {
  switch (idx) {
    case 0: { const double x = tri(t); return x + 0.1 * x * x; }                                 // triangle, чуть несимметричный
    case 1: return std::tanh(2.6 * tri(t) + 0.35);                                                // sharp: пережатый треугольник
    case 2: { const double k = 1.4; return (2.0 * (1.0 - std::exp(-k * t))) / (1.0 - std::exp(-k)) - 1.0; }   // saw, выпуклый подъём
    case 3: return std::tanh(9.0 * (std::sin(2.0 * M_PI * t) - 0.35));                            // pulse, узкий
    case 4: return std::sin(2.8 * std::sin(2.0 * M_PI * t) + 0.4);                                // fold: синус, завёрнутый сам в себя
    case 5: return (2.0 * std::fmod(t * 2.63, 1.0) - 1.0) * (1.0 - 0.35 * t);                     // sync: 2.63 пилы на цикл, затихая
    case 6: return jsRound(std::sin(2.0 * M_PI * (std::floor(t * 8) + 0.5) / 8.0) * 2.5) / 2.5;   // crush: синус, 8 шагов × 5 уровней
    case 7: return std::sin(2.0 * M_PI * t + 2.2 * std::sin(2.0 * M_PI * 7.0 * t));               // metal: FM 1:7
    default: {                                                                                    // grain, линейно между точками
      const Grain& g = grain();
      const double x = t * Grain::N;
      const int i = static_cast<int>(std::floor(x)) % Grain::N;
      const double fr = x - std::floor(x);
      return g.v[i] + (g.v[(i + 1) % Grain::N] - g.v[i]) * fr;
    }
  }
}

}  // namespace waveform
}  // namespace sdk

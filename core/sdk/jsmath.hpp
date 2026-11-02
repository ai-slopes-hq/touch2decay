// Числа как в JS (V8) — там, где libm расходится с ним в последнем бите.
//
// Зачем: часть миров сверяется с прежним JS до 1e-9, а хаотичная модель разводит любой бит
// в заметную разницу за секунды. Где сверки с JS нет — бери обычные std::hypot, std::round.
//
//   jsHypot(a, b)       — Math.hypot: алгоритм V8 (сумма Кахана по нормированным). Обычный
//                         sqrt(a² + b²) расходится с ним в последнем бите на трети чисел.
//   jsRound(x)          — Math.round: половина — всегда вверх (−2.5 → −2), а std::round — от нуля (→ −3).
//   jsClamp(x, lo, hi)  — Math.min(hi, Math.max(lo, x)); по умолчанию в [0, 1].
#pragma once
#include <cmath>

namespace sdk {

inline double jsHypot(double a, double b) {
  a = std::fabs(a); b = std::fabs(b);
  if (a != a || b != b) return (a == INFINITY || b == INFINITY) ? INFINITY : NAN;   // NaN, но бесконечность сильнее
  double largest = 0;
  if (a > largest) largest = a;
  if (b > largest) largest = b;
  if (largest == INFINITY) return INFINITY;
  if (largest == 0) return 0;
  double sum = 0, compensation = 0;                     // делим на наибольшее, чтобы квадраты не переполнились
  const double xs[2] = {a, b};
  for (double x : xs) {
    const double scaled = x / largest, s = scaled * scaled - compensation, p = sum + s;
    compensation = (p - sum) - s;                       // что потерялось при сложении — вычтем в следующем
    sum = p;
  }
  return std::sqrt(sum) * largest;
}

inline double jsRound(double x) { const double r = std::floor(x); return x - r >= 0.5 ? r + 1 : r; }
inline double jsClamp(double x, double lo = 0, double hi = 1) { return x < lo ? lo : x > hi ? hi : x; }

}  // namespace sdk

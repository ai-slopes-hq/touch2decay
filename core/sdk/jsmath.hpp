// Числа как в JS (V8), где libm расходится в последнем бите, а мир сверяется с прежним JS до 1e-9 (хаос разводит любой бит).
#pragma once
#include <cmath>

namespace sdk {

// Math.hypot(a, b) как в V8 (Kahan по нормированным): обычный sqrt(a² + b²) расходится в последнем бите на трети чисел
inline double jsHypot(double a, double b) {
  a = std::fabs(a); b = std::fabs(b);
  if (a != a || b != b) return (a == INFINITY || b == INFINITY) ? INFINITY : NAN;
  double m = 0;
  if (a > m) m = a;
  if (b > m) m = b;
  if (m == INFINITY) return INFINITY;
  if (m == 0) return 0;
  double sum = 0, comp = 0;
  const double xs[2] = {a, b};
  for (double x : xs) { const double n = x / m, s = n * n - comp, p = sum + s; comp = (p - sum) - s; sum = p; }
  return std::sqrt(sum) * m;
}

inline double jsClamp(double x, double a = 0, double b = 1) { return x < a ? a : x > b ? b : x; }   // Math.min(b, Math.max(a, x))

}  // namespace sdk

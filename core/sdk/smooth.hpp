// Однополюсное сглаживание: y += (x − y)·c. Громкость голоса «вверх/вниз» — тот же OnePole, коэффициент выбирает вызывающий (как в worklet-ах: on ? 0.002 : 0.0008).
#pragma once
#include <cmath>

namespace sdk {

struct OnePole {
  double y = 0;
  double step(double x, double c) { y += (x - y) * c; return y; }
};

// setTargetAtTime(v, t, τ) на каждом сэмпле: y идёт к цели по экспоненте с постоянной τ (с); jump — сразу. Portus и Natura.
struct Glide {
  double y = 0, to = 0, c = 0;
  void set(double v, double tau, double sr) { to = v; c = 1 - std::exp(-1 / (tau * sr)); }
  void jump(double v) { y = to = v; }
  double step() { y += (to - y) * c; return y; }
};

}  // namespace sdk

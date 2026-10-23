// Однополюсное сглаживание: y += (x − y)·c. Громкость голоса «вверх/вниз» — тот же OnePole, коэффициент выбирает вызывающий (как в worklet-ах: on ? 0.002 : 0.0008).
#pragma once

namespace sdk {

struct OnePole {
  double y = 0;
  double step(double x, double c) { y += (x - y) * c; return y; }
};

}  // namespace sdk

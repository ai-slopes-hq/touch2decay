// Мягкое колено: до kn — прямая (с усилением k), выше — kn + room·tanh((y − kn)/room), нечётное.
// Мастер хоста (host/audio.js knee): k = 2.6/tanh 2.6, kn 0.6, room = top − kn = 0.38. Выход пластины Cymatica (outKnee): k 1, kn 0.8, room 0.8.
// Не заменять сплошным tanh: он давал хрип (искажения до −16 дБ на нижних нотах).
#pragma once
#include <cmath>

namespace sdk {

struct Knee {
  double k = 1, kn = 0.8, room = 0.8;
  double operator()(double x) const {
    const double y = std::fabs(k * x);
    const double s = x < 0 ? -1 : x > 0 ? 1 : 0;
    return s * (y < kn ? y : kn + room * std::tanh((y - kn) / room));
  }
};

}  // namespace sdk

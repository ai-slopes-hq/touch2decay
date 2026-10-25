// Шумы-цвета, на лету от Rng (без буферов): white, pink (Kellet, 3 полюса), brown (интеграл с утечкой), crackle (редкие импульсы с затуханием),
// grain (короткие всплески белого шума 10–40 мс с плавной огибающей). Уровни и константы — как буферы engine.js Inferno (решение автора 24.10:
// шумы — в SDK). Состояние у каждого генератора своё; случайность — Rng вызывающего (зерно мира).
#pragma once
#include <cmath>
#include "rng.hpp"

namespace sdk {

struct Noise {
  enum Color { white, pink, brown, crackle, grain, NCOLORS };
  int color = white;
  double b0 = 0, b1 = 0, b2 = 0, br = 0, cr = 0, env = 0;
  int on = 0;                                           // grain: сколько сэмплов осталось у текущего всплеска
  void set(int c) { color = c < 0 ? 0 : c >= NCOLORS ? NCOLORS - 1 : c; b0 = b1 = b2 = br = cr = env = 0; on = 0; }
  double next(Rng& r, double sr) {
    const double x = r.next() * 2 - 1;
    switch (color) {
      case pink:
        b0 = 0.99765 * b0 + x * 0.099046; b1 = 0.963 * b1 + x * 0.2965164; b2 = 0.57 * b2 + x * 1.0526913;
        return (b0 + b1 + b2 + x * 0.1848) * 0.11;
      case brown:
        br = (br + x * 0.02 > 1 ? 1 : br + x * 0.02 < -1 ? -1 : br + x * 0.02) * 0.998;
        return br * 1.6;
      case crackle:
        if (r.next() < 0.0015) cr = (r.next() < 0.5 ? -1 : 1) * (0.4 + r.next() * 0.6);
        cr *= 0.9;
        return cr;
      case grain:
        if (on <= 0 && r.next() < 0.0004) on = static_cast<int>(std::floor(sr * (0.01 + r.next() * 0.03) + 0.5));
        env += ((on > 0 ? 1 : 0) - env) * 0.01;
        if (on > 0) on--;
        return x * env * 0.8;
      default: return x * 0.5;
    }
  }
};

}  // namespace sdk

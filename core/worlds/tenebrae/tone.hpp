// Чистые формулы звука Tenebrae — порт worlds/tenebrae/tone.js (числа сверены до 1e-9).
#pragma once
#include "../../host/scale.hpp"
#include <algorithm>
#include <cmath>

namespace tenebrae {

constexpr double F_LO = 55, SEMIS = 60, WARP = 1.45;    // A1, пять октав, растяжка низа
constexpr double CUT_LO = 40, CUT_HI = 18000, SHIFT_MAX = 1500;

inline double clamp01(double v) { return std::min(1.0, std::max(0.0, v)); }
inline double semiOf(double x) { return SEMIS * std::pow(clamp01(x), WARP); }
inline double xOf(double s) { return std::pow(std::min(SEMIS, std::max(0.0, s)) / SEMIS, 1 / WARP); }

// x поля → x ближайшей ноты лада (при равенстве — нижняя, как в JS)
inline double quantX(double x, const Scale& sc) {
  const double s = semiOf(x);
  double best = s, bd = 99;
  const int lo = static_cast<int>(std::floor(s)) - 7, hi = static_cast<int>(std::ceil(s)) + 7;
  for (int n = lo; n <= hi; n++) {
    if (n < 0 || n > SEMIS || !sc.inScale(n)) continue;
    const double d = std::fabs(n - s);
    if (d < bd) { bd = d; best = n; }
  }
  return xOf(best);
}

// высота кружка в Гц: x поля (с ладом — к ноте) → полутоны от A1
inline double freqOf(double x, const Scale& sc) { return F_LO * std::pow(2.0, semiOf(sc.on ? quantX(x, sc) : x) / 12); }

// detune: в модели beat уже в Гц, c2 = f + beat
inline double beatHz(double beat) { return beat; }

// cutoff кружка — на весь диапазон; ось Y ведёт его ещё на ±2.25 октавы; открытая FM приоткрывает фильтр (fmOpen 0…1)
inline double cutoffOf(double cut, double y, double fmOpen) {
  const double v = CUT_LO * std::pow(CUT_HI / CUT_LO, cut) * std::pow(2.0, (y - 0.5) * 4.5) * std::pow(2.0, 1.5 * fmOpen);
  return std::min(20000.0, std::max(20.0, v));
}

// сдвиг частоты: середина луча — ноль, дальше вверх, ближе к центру — вниз; до ±1.5 кГц, у нуля — медленно
inline double shiftHz(double t) {
  const double u = 2 * t - 1, a = std::fabs(u);
  return a < 0.04 ? 0.0 : (u < 0 ? -1.0 : 1.0) * (std::pow(2.0, ((a - 0.04) / 0.96) * 11) - 1) * (SHIFT_MAX / 2047);
}

}  // namespace tenebrae

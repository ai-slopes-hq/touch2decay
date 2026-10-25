// Банк полос-резонаторов от общего возбуждения: N полос BP (Biquad, семантика Web Audio, Q линейный), частота — hz·ratio, у каждой свой вес.
// Цели (частота, Q, гейн) плавно подтягиваются к значениям, как setTargetAtTime у AudioParam: шаг сглаживания — вызывающему (glide), биквады
// пересчитываются раз в блок (update). Закон Q и нормировка гейна — снаружи (у Inferno гейн полосы = √Q·0.5·вес, у Vitrea — 1/√bw): блок их не знает.
// Без аллокаций.
#pragma once
#include <cmath>
#include "biquad.hpp"

namespace sdk {

template <int N>
struct BpBank {
  struct Band {
    Biquad f;
    double hz = 1000, q = 4, g = 0;                     // текущие
    double thz = 1000, tq = 4, tg = 0;                  // цели
  };
  Band b[N];
  void target(int i, double hz, double q, double g) { b[i].thz = hz; b[i].tq = q; b[i].tg = g; }
  void snap() { for (Band& x : b) { x.hz = x.thz; x.q = x.tq; x.g = x.tg; } }
  void glide(double chz, double cq, double cg) {        // c — доля пути к цели за блок: 1 − exp(−n / (τ·sr))
    for (Band& x : b) { x.hz += (x.thz - x.hz) * chz; x.q += (x.tq - x.q) * cq; x.g += (x.tg - x.g) * cg; }
  }
  void update(double sr) {                              // коэффициенты биквадов по текущим hz, q (выше Найквиста — ниже Найквиста)
    const double top = sr * 0.499;
    for (Band& x : b) x.f.set(Biquad::bandpass, x.hz < top ? x.hz : top, x.q < 1e-3 ? 1e-3 : x.q, sr);
  }
  double step(double x) { double y = 0; for (Band& v : b) y += v.g * v.f.step(x); return y; }
  void reset() { for (Band& v : b) v.f.x1 = v.f.x2 = v.f.y1 = v.f.y2 = 0; }
};

}  // namespace sdk

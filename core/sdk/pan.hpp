// Панорамы.
//   panLin    — линейная, как в worklet-ах: pan = p·spread, gl = (1 − pan)/2, gr = (1 + pan)/2 (p = 0 — по 0.5).
//   panEq     — равномощная StereoPannerNode для моно-входа: x = (p + 1)/2, L = cos(xπ/2), R = sin(xπ/2).
//   panStereo — StereoPannerNode для стерео-входа (спецификация Web Audio): p ≤ 0 — правый канал частью уходит влево,
//               p > 0 — левый вправо; на месте ничего не теряется.
#pragma once
#include <cmath>

namespace sdk {

inline void panLin(double p, double spread, double& gl, double& gr) {
  double pan = p * spread;
  gl = (1 - pan) * 0.5;
  gr = (1 + pan) * 0.5;
}

inline void panEq(double p, double& gl, double& gr) {
  const double x = (p + 1) * 0.5;
  gl = std::cos(x * M_PI / 2);
  gr = std::sin(x * M_PI / 2);
}

struct PanStereo {                                      // коэффициенты считаются раз — на смену p
  double p = 0, a = 1, c = 0;
  void set(double pan) {
    p = pan < -1 ? -1 : pan > 1 ? 1 : pan;
    const double x = p <= 0 ? p + 1 : p;
    a = std::cos(x * M_PI / 2); c = std::sin(x * M_PI / 2);
  }
  void step(double inL, double inR, double& outL, double& outR) const {
    if (p <= 0) { outL = inL + inR * a; outR = inR * c; }
    else { outL = inL * a; outR = inR + inL * c; }
  }
};

}  // namespace sdk

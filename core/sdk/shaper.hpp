// WaveShaperNode без oversample (спецификация Web Audio): кривая из N точек (float, как Float32Array), v = (N − 1)·(x + 1)/2,
// линейная интерполяция между соседними; v < 0 — первая точка, v ≥ N − 1 — последняя.
#pragma once
#include <cmath>

namespace sdk {

template <int N>
struct Shaper {
  float c[N] = {};
  template <class F>
  void build(F fn) { for (int i = 0; i < N; i++) c[i] = static_cast<float>(fn(static_cast<double>(i) / (N - 1) * 2 - 1)); }   // x = i/(N−1)·2 − 1
  double step(double x) const {
    const double v = (N - 1) * (x + 1) * 0.5;
    if (!(v > 0)) return c[0];
    if (v >= N - 1) return c[N - 1];
    const int k = static_cast<int>(v);
    const double f = v - k;
    return (1 - f) * c[k] + f * c[k + 1];
  }
};

}  // namespace sdk

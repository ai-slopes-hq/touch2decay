// Биквад по спецификации Web Audio (BiquadFilterNode): у lowpass/highpass Q в дБ, у bandpass/allpass — линейный.
// Прямая форма I, коэффициенты нормированы на a0.
#pragma once
#include <cmath>

namespace sdk {

struct Biquad {
  enum Type { lowpass, highpass, bandpass, allpass };
  double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;        // нормированные
  double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  void set(Type t, double f, double q, double sr) {
    double w = 2 * M_PI * f / sr, c = std::cos(w), s = std::sin(w);
    double al = (t == lowpass || t == highpass) ? s / (2 * std::pow(10.0, q / 20)) : s / (2 * q);
    double B0, B1, B2;
    switch (t) {
      case lowpass:  B0 = (1 - c) / 2; B1 = 1 - c; B2 = B0; break;
      case highpass: B0 = (1 + c) / 2; B1 = -(1 + c); B2 = B0; break;
      case bandpass: B0 = al; B1 = 0; B2 = -al; break;
      default:       B0 = 1 - al; B1 = -2 * c; B2 = 1 + al; break;
    }
    double a0 = 1 + al;
    b0 = B0 / a0; b1 = B1 / a0; b2 = B2 / a0;
    a1 = -2 * c / a0; a2 = (1 - al) / a0;
  }
  double step(double x) {
    double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  }
};

}  // namespace sdk

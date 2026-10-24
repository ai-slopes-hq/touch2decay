// Двухполюсный резонатор: y = b1·y1 + b2·y2 + g·x, полюса R·e^{±iω}. Коэффициенты — отдельно от состояния: у мира их много (моды × голоса),
// пересчитываются при смене высоты, а не каждый сэмпл. Затухание — по T60 (Cymatica: 10^(−3/(T60·fs))) или по tau (Horologium: e^(−1/(τ·fs))).
// Усиление g — у вызывающего (Cymatica: sin ω, чтобы импульс давал амплитуду ~1).
#pragma once
#include <cmath>

namespace sdk {

struct ResCoef {
  double b1 = 0, b2 = 0;
  static ResCoef fromR(double hz, double R, double fs) {
    const double w = (2 * 3.141592653589793 * hz) / fs;
    return {2 * R * std::cos(w), -R * R};
  }
  static ResCoef t60(double hz, double t60, double fs) { return fromR(hz, std::pow(10.0, -3 / (t60 * fs)), fs); }
  static ResCoef tau(double hz, double tau, double fs) { return fromR(hz, std::exp(-1 / (tau * fs)), fs); }
};

struct Resonator {
  double y1 = 0, y2 = 0;
  double step(const ResCoef& c, double g, double x) {
    const double y = c.b1 * y1 + c.b2 * y2 + g * x;
    y2 = y1; y1 = y;
    return y;
  }
  void reset() { y1 = y2 = 0; }
};

}  // namespace sdk

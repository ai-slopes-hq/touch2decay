// Генератор как OscillatorNode: фаза от 0 (в периодах), частота — на каждый сэмпл (a-rate, с FM), кадр k звучит фазой до шага k
// (как Chromium: читает таблицу, потом прибавляет f[k]/sr). Отрицательная частота — фаза идёт назад.
//   sine     — синус (у браузера — таблица с интерполяцией; разница ниже −120 дБ);
//   triangle — треугольник с фазой синуса (0 → 1 на четверти → −1 → 0), углы скруглены PolyBLAMP: у браузера — свои таблицы по октавам,
//              бит в бит нельзя; верх спектра — тот же порядок (гармоники 1/n², алиасинг — ниже −60 дБ до ~2 кГц при 48 кГц).
#pragma once
#include <cmath>

namespace sdk {

struct Osc {
  double ph = 0;                                        // [0, 1)
  void reset() { ph = 0; }
  void adv(double dt) { ph += dt; ph -= std::floor(ph); }
  double sine(double dt) { const double y = std::sin(2 * M_PI * ph); adv(dt); return y; }   // dt = f/sr
  double triangle(double dt) {
    const double p = ph;
    double y = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
    const double a = std::fabs(dt);
    if (a > 0 && a < 0.25) {                            // PolyBLAMP: излом наклона ∓8·dt на 1/4 и 3/4 периода, окно ±1 сэмпл
      y += corner(p, 0.25, a) * (-8 * a) + corner(p, 0.75, a) * (8 * a);
    }
    adv(dt);
    return y;
  }

 private:
  static double corner(double p, double c, double a) {  // (1 − |t|)³/6, t — расстояние до угла в сэмплах
    double d = p - c;
    d -= std::floor(d + 0.5);
    const double t = std::fabs(d / a);
    if (t >= 1) return 0;
    const double u = 1 - t;
    return u * u * u / 6;
  }
};

}  // namespace sdk

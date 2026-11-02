// Osc — генератор, как OscillatorNode в Web Audio: синус и треугольник.
//
// Фаза phase — в периодах, [0, 1), с нуля. Частота приходит в каждый вызов как dt = f/sr, её можно
// менять каждый сэмпл (так делается FM). Как в Chromium: сэмпл звучит фазой ДО шага, потом фаза
// прибавляет dt. Отрицательная dt — фаза идёт назад.
//
//   sine(dt)     — синус. У браузера — таблица с интерполяцией; разница ниже −120 дБ.
//   triangle(dt) — треугольник в фазе синуса: 0 → 1 на четверти → −1 на трёх четвертях → 0.
//                  Углы скруглены PolyBLAMP — иначе острые изломы заворачивают верх спектра в грязь.
//                  У браузера свои таблицы по октавам, бит в бит с ним не совпасть; верх спектра того же
//                  порядка (гармоники 1/n², алиасинг ниже −60 дБ до ~2 кГц при 48 кГц).
//   advance(dt)  — только шагнуть фазой, без звука: медленный LFO, который считают раз в блок (dt = f·n/sr).
//
// ЛОВУШКИ:
//   - dt — доля периода за сэмпл, не герцы.
//   - Скругление углов работает при |dt| < 0.25 (нота ниже sr/4); выше треугольник острый.
// Цена: sine — один sin на сэмпл; triangle — несколько умножений, у углов — ещё пара.
#pragma once
#include <cmath>

namespace sdk {

struct Osc {
  double phase = 0;
  void reset() { phase = 0; }
  void advance(double dt) { phase += dt; phase -= std::floor(phase); }
  double sine(double dt) { const double y = std::sin(2 * M_PI * phase); advance(dt); return y; }
  double triangle(double dt) {
    const double p = phase;
    double y = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
    const double a = std::fabs(dt);
    if (a > 0 && a < 0.25) {                            // на 1/4 и 3/4 периода наклон ломается на ∓8·dt; окно ±1 сэмпл
      y += corner(p, 0.25, a) * (-8 * a) + corner(p, 0.75, a) * (8 * a);
    }
    advance(dt);
    return y;
  }

 private:
  // поправка PolyBLAMP у угла c: (1 − |t|)³/6, t — расстояние от фазы до угла в сэмплах (dt = a)
  static double corner(double p, double c, double a) {
    double d = p - c;
    d -= std::floor(d + 0.5);                           // ближайший такой угол — в этом периоде или соседнем
    const double t = std::fabs(d / a);
    if (t >= 1) return 0;
    const double u = 1 - t;
    return u * u * u / 6;
  }
};

}  // namespace sdk

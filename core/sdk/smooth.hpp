// Плавное движение к значению — чтобы смена громкости или частоты не щёлкала.
//
//   OnePole — однополюсное сглаживание: y += (x − y)·c. Цель x и долю пути c передают в каждый step.
//             Громкость голоса «вверх/вниз» — тот же OnePole, c выбирает вызывающий
//             (как в worklet-ах: on ? 0.002 : 0.0008).
//   Glide   — то же, что setTargetAtTime(v, t, τ) у AudioParam, по сэмплам: y идёт к цели
//             по экспоненте с постоянной τ секунд; jump — сразу. Portus и Natura.
//
// ЛОВУШКИ:
//   - c — доля пути за ОДИН сэмпл, а не время: при другой частоте дискретизации скорость другая.
//     Из постоянной τ (с): c = 1 − e^(−1/(τ·sr)) — так считает Glide::set.
//   - За τ проходится ≈ 63 % пути, за 5τ — 99 %. Ровно цели экспонента не достигает.
//   - Glide::set меняет цель и скорость, текущее y не трогает: движение продолжается от него.
// Цена — умножение и два сложения на сэмпл; exp — только в Glide::set.
#pragma once
#include <cmath>

namespace sdk {

struct OnePole {
  double y = 0;
  double step(double x, double c) { y += (x - y) * c; return y; }
};

struct Glide {
  double y = 0, target = 0, coef = 0;                   // coef — доля пути к цели за сэмпл
  void set(double v, double tau, double sr) { target = v; coef = 1 - std::exp(-1 / (tau * sr)); }
  void jump(double v) { y = target = v; }
  double step() { y += (target - y) * coef; return y; }
  // мир молчал n сэмплов и не считал: встать туда, где Glide был бы после n шагов (Tenebrae)
  void skip(int n) { y = target + (y - target) * std::pow(1 - coef, n); }
};

}  // namespace sdk

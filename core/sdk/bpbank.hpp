// BpBank — банк полос-резонаторов от общего возбуждения: N полосовых фильтров (Biquad, как
// BiquadFilterNode 'bandpass' в Web Audio, Q линейный), у каждой своя частота, добротность и гейн.
// Выход — сумма полос. Inferno, Vitrea.
//
// Значения не прыгают, а плавно подтягиваются к целям, как setTargetAtTime у AudioParam:
//   bank.target(i, hz, q, gain);     // куда идти (когда угодно)
//   bank.glide(cHz, cQ, cGain);      // раз в блок: шаг к целям
//   bank.update(sr);                 // раз в блок: пересчитать биквады по текущим значениям
//   y = bank.step(x);                // каждый сэмпл
// snap() — сразу встать в цели (старт, смена пресета).
//
// ЛОВУШКИ:
//   - glide принимает долю пути за БЛОК: c = 1 − e^(−n/(τ·sr)), n — длина блока. Считает вызывающий.
//   - Закон Q и нормировка гейна — снаружи (у Inferno гейн полосы = √Q·0.5·вес, у Vitrea — 1/√bw):
//     блок их не знает. Узкая полоса без нормировки звучит громко.
//   - Частота выше 0.499·sr зажимается, Q — не меньше 1e-3.
//   - Без update после glide биквады звучат по старым значениям.
// Цена — N биквадов на сэмпл; update — N расчётов коэффициентов (sin, cos) на блок. Без аллокаций.
#pragma once
#include <cmath>
#include "biquad.hpp"

namespace sdk {

template <int N>
struct BpBank {
  struct Band {
    Biquad filter;
    double hz = 1000, q = 4, gain = 0;                  // где сейчас
    double targetHz = 1000, targetQ = 4, targetGain = 0;
  };
  Band bands[N];

  void target(int i, double hz, double q, double gain) { bands[i].targetHz = hz; bands[i].targetQ = q; bands[i].targetGain = gain; }
  void snap() { for (Band& x : bands) { x.hz = x.targetHz; x.q = x.targetQ; x.gain = x.targetGain; } }
  void glide(double cHz, double cQ, double cGain) {
    for (Band& x : bands) { x.hz += (x.targetHz - x.hz) * cHz; x.q += (x.targetQ - x.q) * cQ; x.gain += (x.targetGain - x.gain) * cGain; }
  }
  void update(double sr) {
    const double top = sr * 0.499;                      // выше Найквиста биквад не построить
    for (Band& x : bands) x.filter.set(Biquad::bandpass, x.hz < top ? x.hz : top, x.q < 1e-3 ? 1e-3 : x.q, sr);
  }
  double step(double x) { double y = 0; for (Band& v : bands) y += v.gain * v.filter.step(x); return y; }
  void reset() { for (Band& v : bands) v.filter.reset(); }   // заглушить звон, цели и значения не трогать
};

}  // namespace sdk

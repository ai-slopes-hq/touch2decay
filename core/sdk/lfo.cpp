// LFO строк: таблицы и морфинг форм (как host/waves.js), random — как host/sl.js. Устройство — в lfo.hpp.
#include "lfo.hpp"
#include "waveforms.hpp"
#include <algorithm>
#include <cmath>

namespace sdk {

double WaveMorph::hash(int n) {
  const double x = std::sin(n * 12.9898) * 43758.5453;
  return (x - std::floor(x)) * 2.0 - 1.0;
}

WaveMorph::WaveMorph(Shape s) : shape_(s) {
  if (shape_ == CLASSIC) initClassic();                 // RANDOM считается формулой в sample(), таблицы не нужны
}

void WaveMorph::initClassic() {
  // каждая форма — без среднего (LFO не сдвигает base) и с пиком 1 (depth значит одно и то же у всех форм)
  auto fill = [&](int idx, auto fn) {
    double mean = 0, peak = 0;
    for (int i = 0; i < N; i++) { tables_[idx][i] = static_cast<float>(fn(i / double(N))); mean += tables_[idx][i] / N; }
    for (int i = 0; i < N; i++) { tables_[idx][i] -= static_cast<float>(mean); peak = std::max(peak, std::fabs(static_cast<double>(tables_[idx][i]))); }
    if (peak > 0) for (int i = 0; i < N; i++) tables_[idx][i] /= static_cast<float>(peak);
  };
  for (int idx = 0; idx < waveform::COUNT; idx++) fill(idx, [idx](double t) { return waveform::form(idx, t); });
}

double WaveMorph::sample(double morph, double phase, int seed) const {
  morph = std::max(0.0, std::min(1.0, morph));
  if (shape_ == RANDOM) {
    auto frac = [](double u) { double f = std::fmod(u, 1.0); return f < 0 ? f + 1.0 : f; };
    const int idx = std::min(3, static_cast<int>(std::floor(morph * 4.0)));   // morph делится на 4 равные части
    if (idx == 0) return 2.0 * frac(phase) - 1.0;                             // рампа вверх
    if (idx == 1) return 1.0 - 2.0 * frac(phase);                             // рампа вниз
    const int period = static_cast<int>(std::floor(phase));
    if (idx == 2) return hash(seed + period);                                 // ступени
    const double a = hash(seed + period), b = hash(seed + period + 1);        // сглаженные: косинусом к следующей ступени
    return a + (b - a) * (0.5 - 0.5 * std::cos(M_PI * frac(phase)));
  }

  // classic: у формы i вес 1 − |morph·8 − i| (не меньше 0) — ненулевые только у одной-двух соседних
  phase = std::fmod(phase, 1.0); if (phase < 0) phase += 1.0;
  double y = 0.0;
  const int si = static_cast<int>(phase * N) % N;       // ближайшая точка снизу, без интерполяции
  for (int i = 0; i < 9; i++) {
    const double k = std::max(0.0, 1.0 - std::fabs(morph * 8.0 - i));
    if (k > 0) y += k * tables_[i][si];
  }
  return y;
}

double RowLfo::value(const WaveMorph& w) const {
  const double offset = depth * 0.5 * w.sample(morph, u, seed);   // u без обрезки, как в sl.js
  return std::max(0.0, std::min(1.0, base + offset));
}

}  // namespace sdk

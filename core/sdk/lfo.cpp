// LFO строк: морфинг волн и тик фазы. Расчёт форм — как в host/waves.js; random — как в host/sl.js.
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
  if (shape_ == CLASSIC) initClassic();   // RANDOM считается аналитически в sample(), таблиц не нужно
}

void WaveMorph::initClassic() {
  // 9 форм из host/waves.js: triangle, sharp, saw, pulse, fold, sync, crush, metal, grain
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
    // random: 4 формы, фаза — u без обрезки (host/sl.js RND_SHAPES); зерно — для steps/smooth
    auto fr = [](double u) { double f = std::fmod(u, 1.0); return f < 0 ? f + 1.0 : f; };
    const int idx = std::min(3, static_cast<int>(std::floor(morph * 4.0)));
    if (idx == 0) return 2.0 * fr(phase) - 1.0;
    if (idx == 1) return 1.0 - 2.0 * fr(phase);
    const int per = static_cast<int>(std::floor(phase));
    if (idx == 2) return hash(seed + per);
    const double a = hash(seed + per), b = hash(seed + per + 1);
    return a + (b - a) * (0.5 - 0.5 * std::cos(M_PI * fr(phase)));
  }

  // classic: треугольные веса таблиц (host/waves.js weight), морфинг — взвешенная сумма
  phase = std::fmod(phase, 1.0); if (phase < 0) phase += 1.0;
  double y = 0.0;
  const int si = static_cast<int>(phase * N) % N;
  for (int i = 0; i < 9; i++) {
    const double k = std::max(0.0, 1.0 - std::fabs(morph * 8.0 - i));
    if (k > 0) y += k * tables_[i][si];
  }
  return y;
}

double RowLfo::value(const WaveMorph& w) const {
  const double offset = depth * 0.5 * w.sample(morph, u, seed);   // веб: u без обрезки (sl.js)
  return std::max(0.0, std::min(1.0, base + offset));
}


}  // namespace sdk

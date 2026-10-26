// LFO строк: морфинг волн и тик фазы. Расчёт форм — как в host/waves.js; random — как в host/sl.js.
#include "lfo.hpp"
#include <algorithm>
#include <cmath>

namespace sdk {

double WaveMorph::tri(double t) {
  t = std::fmod(t + 0.25, 1.0);
  if (t < 0) t += 1.0;
  return 1.0 - 4.0 * std::fabs(t - 0.5);
}

double WaveMorph::hash(int n) {
  const double x = std::sin(n * 12.9898) * 43758.5453;
  return (x - std::floor(x)) * 2.0 - 1.0;
}

WaveMorph::WaveMorph(Shape s) : shape_(s) {
  if (shape_ == CLASSIC) initClassic();
  else initRandom();
}

void WaveMorph::initClassic() {
  // 9 форм из host/waves.js: triangle, sharp, saw, pulse, fold, sync, crush, metal, grain
  auto fill = [&](int idx, auto fn) {
    double mean = 0, peak = 0;
    for (int i = 0; i < N; i++) { tables_[idx][i] = static_cast<float>(fn(i / double(N))); mean += tables_[idx][i] / N; }
    for (int i = 0; i < N; i++) { tables_[idx][i] -= static_cast<float>(mean); peak = std::max(peak, std::fabs(static_cast<double>(tables_[idx][i]))); }
    if (peak > 0) for (int i = 0; i < N; i++) tables_[idx][i] /= static_cast<float>(peak);
  };
  fill(0, [](double t) { double x = tri(t); return x + 0.1 * x * x; });   // triangle
  fill(1, [](double t) { return std::tanh(2.6 * tri(t) + 0.35); });       // sharp
  fill(2, [](double t) { const double k = 1.4; return (2.0 * (1.0 - std::exp(-k * t))) / (1.0 - std::exp(-k)) - 1.0; });   // saw
  fill(3, [](double t) { return std::tanh(9.0 * (std::sin(2.0 * M_PI * t) - 0.35)); });   // pulse
  fill(4, [](double t) { return std::sin(2.8 * std::sin(2.0 * M_PI * t) + 0.4); });   // fold
  fill(5, [](double t) { return (2.0 * std::fmod(t * 2.63, 1.0) - 1.0) * (1.0 - 0.35 * t); });   // sync
  fill(6, [](double t) { return std::round(std::sin(2.0 * M_PI * (std::floor(t * 8) + 0.5) / 8.0) * 2.5) / 2.5; });   // crush
  fill(7, [](double t) { return std::sin(2.0 * M_PI * t + 2.2 * std::sin(2.0 * M_PI * 7.0 * t)); });   // metal
  // grain: застывший кусок шума (40 сэмплов)
  int seed = 11;
  float grain[40];
  for (int i = 0; i < 40; i++) { seed = (seed * 16807) % 2147483647; grain[i] = std::tanh(3.0 * ((seed / 2147483647.0) * 2.0 - 1.0)); }
  fill(8, [&](double t) {
    const double x = t * 40.0;
    const int i = static_cast<int>(std::floor(x)) % 40;
    const double fr = x - std::floor(x);
    return grain[i] + (grain[(i + 1) % 40] - grain[i]) * fr;
  });
}

void WaveMorph::initRandom() {
  // 4 формы random из host/sl.js: ramp up, ramp down, steps, smooth
  auto fr = [](double u) { double f = std::fmod(u, 1.0); return f < 0 ? f + 1.0 : f; };
  for (int idx = 0; idx < 4; idx++) {
    for (int i = 0; i < N; i++) {
      const double t = i / double(N);
      if (idx == 0) tables_[idx][i] = static_cast<float>(2.0 * fr(t) - 1.0);   // ramp up
      else if (idx == 1) tables_[idx][i] = static_cast<float>(1.0 - 2.0 * fr(t));   // ramp down
      else if (idx == 2) tables_[idx][i] = static_cast<float>(hash(static_cast<int>(std::floor(t))));   // steps (один сэмпл на период, тут — из 0)
      else {   // smooth
        const double a = hash(static_cast<int>(std::floor(t)));
        const double b = hash(static_cast<int>(std::floor(t)) + 1);
        tables_[idx][i] = static_cast<float>(a + (b - a) * (0.5 - 0.5 * std::cos(M_PI * fr(t))));
      }
    }
  }
  for (int idx = 4; idx < 9; idx++) for (int i = 0; i < N; i++) tables_[idx][i] = 0;   // остальные пустые
}

double WaveMorph::sample(double morph, double phase, int seed) const {
  morph = std::max(0.0, std::min(1.0, morph));
  phase = std::fmod(phase, 1.0); if (phase < 0) phase += 1.0;

  if (shape_ == RANDOM) {
    // random: 4 формы (morph → индекс), но steps и smooth берут seed
    const int idx = std::min(3, static_cast<int>(std::floor(morph * 4.0)));
    if (idx <= 1) {   // ramp up / down — не зависят от seed
      const int i = static_cast<int>(phase * N) % N;
      return tables_[idx][i];
    }
    // steps / smooth: зерно seed + номер периода
    const int per = static_cast<int>(std::floor(phase * N / double(N)));   // для steps всегда 0 (один сэмпл на период)
    if (idx == 2) return hash(seed + per);   // steps
    const double a = hash(seed + per), b = hash(seed + per + 1);
    const double fr = std::fmod(phase, 1.0);
    return a + (b - a) * (0.5 - 0.5 * std::cos(M_PI * fr));
  }

  // classic: треугольная интерполяция между 9 формами
  const double x = morph * 8.0;   // 9 форм → 0…8
  const int i0 = std::max(0, std::min(8, static_cast<int>(std::floor(x))));
  const int i1 = std::min(8, i0 + 1);
  const double fr = x - std::floor(x);
  const int si = static_cast<int>(phase * N) % N;
  if (i0 == i1) return tables_[i0][si];
  return tables_[i0][si] * (1.0 - fr) + tables_[i1][si] * fr;
}

double RowLfo::value(const WaveMorph& w) const {
  const double ph = u - std::floor(u);
  const double offset = depth * 0.5 * w.sample(morph, ph, seed);
  return std::max(0.0, std::min(1.0, base + offset));
}

void RowLfo::tick(double dt, const WaveMorph& /*morph*/) {
  u += dt * rate;
  phase = u - std::floor(u);
}

}  // namespace sdk

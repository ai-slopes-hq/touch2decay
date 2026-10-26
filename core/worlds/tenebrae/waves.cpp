#include "waves.hpp"
#include "../../sdk/waveforms.hpp"
#include <algorithm>
#include <cmath>

namespace tenebrae {

namespace {
constexpr int SRC_N = 1024;                             // длина исходного цикла для гармоник — как N в tone.js

// waveCoeffs: цикл минус среднее, на пик, ДПФ; level по RMS (в double, как в JS)
void coeffs(int form, double* re, double* im, double& level) {
  static double smp[SRC_N];
  double mean = 0;
  for (int i = 0; i < SRC_N; i++) { smp[i] = sdk::waveform::form(form, i / double(SRC_N)); mean += smp[i] / SRC_N; }
  double peak = 0;
  for (int i = 0; i < SRC_N; i++) { smp[i] -= mean; peak = std::max(peak, std::fabs(smp[i])); }
  double rms = 0;
  for (int i = 0; i < SRC_N; i++) { smp[i] /= peak; rms += (smp[i] * smp[i]) / SRC_N; }
  re[0] = im[0] = 0;
  for (int h = 1; h < Tables::HARM; h++) {
    double a = 0, b = 0;
    for (int i = 0; i < SRC_N; i++) { const double ph = (2 * M_PI * h * i) / SRC_N; a += smp[i] * std::cos(ph); b += smp[i] * std::sin(ph); }
    re[h] = (2 * a) / SRC_N; im[h] = (2 * b) / SRC_N;
  }
  level = 0.24 / std::sqrt(rms);
}

// обратное ДПФ гармоник h ≤ hmax в N точек; cs/sn — таблицы cos/sin на N точек
void synth(const double* re, const double* im, int hmax, const double* cs, const double* sn, double* out) {
  for (int k = 0; k < Tables::N; k++) {
    double y = 0;
    for (int h = 1; h <= hmax; h++) { const int j = (h * k) & (Tables::N - 1); y += re[h] * cs[j] + im[h] * sn[j]; }
    out[k] = y;
  }
}
}  // namespace

void Tables::build() {
  static double cs[N], sn[N], buf[N];
  for (int j = 0; j < N; j++) { cs[j] = std::cos(2 * M_PI * j / N); sn[j] = std::sin(2 * M_PI * j / N); }
  for (int f = 0; f < FORMS; f++) coeffs(f, re[1][f], im[1][f], level[f]);
  // голос: модуль своей гармоники, фаза — пилы (alignCoeffs)
  for (int f = 0; f < FORMS; f++) {
    re[0][f][0] = im[0][f][0] = 0;
    for (int h = 1; h < HARM; h++) {
      const double m = std::hypot(re[1][f][h], im[1][f][h]), th = std::atan2(im[1][SAW][h], re[1][SAW][h]);
      re[0][f][h] = m * std::cos(th); im[0][f][h] = m * std::sin(th);
    }
  }
  for (int f = 0; f < FORMS; f++) {
    synth(re[0][f], im[0][f], HARM - 1, cs, sn, buf);                  // полная таблица — для пика
    double peak = 0;
    for (int k = 0; k < N; k++) peak = std::max(peak, std::fabs(buf[k]));
    const double g = peak > 0 ? 1.0 / peak : 1.0;
    for (int L = 0; L < LEVELS; L++) {
      synth(re[0][f], im[0][f], (HARM - 1) >> L, cs, sn, buf);
      for (int k = 0; k < N; k++) voice[f][L][k] = static_cast<float>(buf[k] * g);
    }
    synth(re[1][f], im[1][f], HARM - 1, cs, sn, buf);
    peak = 0;
    for (int k = 0; k < N; k++) peak = std::max(peak, std::fabs(buf[k]));
    const double gl = peak > 0 ? 1.0 / peak : 1.0;
    for (int k = 0; k < N; k++) lfo[f][k] = static_cast<float>(buf[k] * gl);
  }
}

int Tables::levelFor(double hz, double sr) const {
  const double a = std::fabs(hz);
  for (int L = 0; L < LEVELS; L++) if (((HARM - 1) >> L) * a < sr * 0.5) return L;
  return LEVELS - 1;
}

double formWeight(int i, double p) {
  const double q = std::min(1.0, std::max(0.0, p)) * (Tables::FORMS - 1);
  return std::max(0.0, 1.0 - std::fabs(q - i));
}

namespace {
inline double read(const float* tab, double ph) {       // линейная интерполяция по циклу
  const double x = ph * Tables::N;
  const int i = static_cast<int>(x);
  const double fr = x - i;
  const int i0 = i & (Tables::N - 1), i1 = (i + 1) & (Tables::N - 1);
  return tab[i0] + (tab[i1] - tab[i0]) * fr;
}
inline double advance(double ph, double hz, double sr) {
  ph += hz / sr;
  ph -= std::floor(ph);
  return ph;
}
}  // namespace

void Mix::voice(const Tables& t, double pos) {
  n = 0;
  for (int i = 0; i < Tables::FORMS && n < 2; i++) {
    const double w = formWeight(i, pos);
    if (w > 0) { form[n] = i; g[n] = std::pow(w, 0.85) * t.level[i]; n++; }
  }
}

void Mix::lfo(double pos) {
  n = 0;
  for (int i = 0; i < Tables::FORMS && n < 2; i++) {
    const double w = formWeight(i, pos);
    if (w > 0) { form[n] = i; g[n] = w; n++; }
  }
}

double Morph::voiceRun(const Tables& t, const Mix& m, double hz, double sr) {
  const int L = t.levelFor(hz, sr);
  double y = 0;
  for (int k = 0; k < m.n; k++) y += m.g[k] * read(t.voice[m.form[k]][L], ph);
  ph = advance(ph, hz, sr);
  return y;
}

double Morph::lfoRun(const Tables& t, const Mix& m, double hz, double sr) {
  double y = 0;
  for (int k = 0; k < m.n; k++) y += m.g[k] * read(t.lfo[m.form[k]], ph);
  ph = advance(ph, hz, sr);
  return y;
}

double Morph::voiceStep(const Tables& t, double pos, double hz, double sr) {
  Mix m;
  m.voice(t, pos);
  return voiceRun(t, m, hz, sr);
}

double Morph::lfoStep(const Tables& t, double pos, double hz, double sr) {
  Mix m;
  m.lfo(pos);
  return lfoRun(t, m, hz, sr);
}

}  // namespace tenebrae

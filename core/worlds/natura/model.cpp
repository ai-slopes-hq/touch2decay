// Natura — модель, см. model.hpp.
#include "model.hpp"

namespace natura {

static double clampd(double x, double a, double b) { return x < a ? a : x > b ? b : x; }
static double attOf(double v) { return 0.002 + v * v * 0.6; }                 // attack 2 мс … 0.6 с
static double relOf(double v) { return 0.05 + v * v * 1.85; }                 // release 50 мс … 1.9 с
static const double DIVS[6] = {1.0 / 4, 1.0 / 2, 3.0 / 4, 1, 1.5, 2};         // 1/16, 1/8, 1/8d, 1/4, 1/4d, 1/2 — в долях
static const int MINOR[7] = {0, 2, 3, 5, 7, 8, 10};                           // без лада — ля минор

void Model::reset() {
  const double f[NFX] = {0.4, 0.45, 0.5, 0.4, 0.62, 0.25, 0.08, 0.45, 1};
  for (int k = 0; k < NFX; k++) fx_[k] = f[k];
  bpm_ = 96; len_ = 12; prevHz_ = 0; time_ = 0; goneAt_ = 0; hasGone_ = false;
  for (auto& p : pad_) p = Pad();
  const int demo[NPAD][2] = {{2, 0}, {-1, 0}, {7, 1}, {5, 0}, {-1, 0}, {11, 2}, {9, 0}, {-1, 0}, {4, 1}, {7, 2}, {-1, 0}, {0, 0}, {-1, 0}, {12, 1}, {-1, 0}, {-1, 0}};
  for (int i = 0; i < NPAD; i++) if (demo[i][0] >= 0) { pad_[i].on = true; pad_[i].note = demo[i][0]; pad_[i].wave = demo[i][1]; }
}

bool Model::setState(const double* a, int n) {
  if (!a || n < STATE_N) return false;
  bpm_ = clampd(a[0], 20, 400);
  len_ = static_cast<int>(clampd(std::floor(a[1] + 0.5), 1, NPAD));
  for (int k = 0; k < NFX; k++) fx_[k] = a[2 + k];
  for (int i = 0; i < NPAD; i++) {
    const double* q = a + 2 + NFX + i * 9;
    Pad& p = pad_[i];
    p.on = q[0] != 0; p.note = static_cast<int>(clampd(std::floor(q[1] + 0.5), 0, 14)); p.wave = static_cast<int>(clampd(std::floor(q[2] + 0.5), 0, 4));
    p.glide = q[3] != 0; p.chance = q[4];
    for (int l = 0; l < NLOCK; l++) p.lock[l] = q[5 + l];
  }
  return true;
}

bool Model::any() const {
  for (int i = 0; i < len_; i++) if (pad_[i].on) return true;
  return false;
}

double Model::delaySec() const {
  const int d = static_cast<int>(std::floor(fx_[TIME] * 5 + 0.5));            // Math.round
  return DIVS[d < 0 ? 0 : d > 5 ? 5 : d] * 60 / bpm_;
}

double Model::noteHz(int n) const {
  const int root = scale_.on ? scale_.root : 0;
  const int* steps = scale_.on ? Scale::stepsOf(scale_.idx) : MINOR;
  if (n < 0) n = 0;
  const int semis = steps[n % 7] + 12 * (n / 7);
  return 110 * std::pow(2.0, (root + semis) / 12.0);
}

double Model::skiffHz(double q) const {
  const double d = clampd((q / 0.78 + 0.5) * 14, 0, 14);
  if (scale_.on) return noteHz(static_cast<int>(std::floor(d + 0.5)));
  const int lo = static_cast<int>(std::floor(d)), hi = lo + 1 < 14 ? lo + 1 : 14;
  const double a = std::log2(noteHz(lo)), b = std::log2(noteHz(hi));
  return std::pow(2.0, a + (b - a) * (d - lo));
}

Note Model::voice(const Pad& p) {
  Note v;
  const double hz = noteHz(p.note);
  v.wave = p.wave; v.hz = hz;
  v.from = (p.glide && prevHz_ > 0) ? prevHz_ : 0;                             // глайд из прошлой ноты
  prevHz_ = hz;
  v.glide = stepSec() * 0.8;
  v.cutoff = val(p, CUTOFF); v.res = val(p, RES);
  v.att = attOf(envOpen() ? 0 : val(p, ATT)); v.rel = relOf(envOpen() ? 1 : val(p, REL));
  return v;
}

bool Model::stepNote(long step, sdk::Rng& rng, Note& out, int& idx) {
  const int i = static_cast<int>(((step % len_) + len_) % len_);
  const Pad& p = pad_[i];
  if (!p.on) return false;
  const double ch = (p.chance < 0 ? 1 : p.chance) * fx_[CHANCE];
  if (!(rng.next() < ch)) return false;
  idx = i; out = voice(p);
  return true;
}

}  // namespace natura

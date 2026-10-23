#include "pulsar.hpp"

#include <algorithm>
#include <cmath>

namespace firmamentum {

namespace {
constexpr double PI = 3.14159265358979323846, TAU = PI * 2;
double sgn(double x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }   // Math.sign
double jsRound(double x) { return std::floor(x + 0.5); }      // Math.round
}  // namespace

Pulsar::Pulsar(double sr, uint32_t seed) : sr_(sr), rng_(seed) {}

void Pulsar::voice(int i, int on, double fp, double ff, double cyc, double win, double mask, double lvl, double pan) {
  Voice& o = vo_[i];
  if (on != -1) o.on = on != 0;
  o.fp = fp; o.ff = ff; o.cyc = cyc; o.win = win; o.mask = mask; o.lvl = lvl; o.pan = pan;
  if (on == 1 && o.g < 1e-4) { o.fpS = o.fp; o.ffS = o.ff; o.ph = 1; }   // голос вступает с тишины — без глайда
}

void Pulsar::fx(double jit, double spread, double crep, double fulg) {
  jit_ = jit; spread_ = spread; crep_ = crep; fulg_ = fulg;
}

int Pulsar::ck(double* out) {
  int n = nck_;
  for (int k = 0; k < n * 2; k++) out[k] = ck_[k];
  nck_ = 0;
  return n;
}

int Pulsar::fl(int* out) {
  int n = nfl_;
  for (int k = 0; k < n; k++) out[k] = fl_[k];
  nfl_ = 0;
  return n;
}

void Pulsar::process(float* L, float* R, int n) {
  float* Rw = R ? R : L;                                // моно: R === L
  const bool stereo = R != nullptr;
  for (int k = 0; k < n; k++) { L[k] = 0; if (stereo) R[k] = 0; }
  for (int vi = 0; vi < VMAX; vi++) {
    Voice& o = vo_[vi];
    if (!o.on && o.g < 1e-5) continue;
    const double pan = o.pan * spread_, gl = (1 - pan) * 0.5, gr = (1 + pan) * 0.5;
    for (int k = 0; k < n; k++) {
      o.g += ((o.on ? o.lvl : 0) - o.g) * (o.on ? 0.002 : 0.0008);
      o.fpS += (o.fp - o.fpS) * 0.002; o.ffS += (o.ff - o.ffS) * 0.002;
      o.ph += o.fpS / sr_;
      if (o.ph >= 1) {                                  // новый пульсарет
        o.ph -= 1;
        if (jit_) o.ph -= rng_.next() * jit_ * 0.3;     // scintilla: пульсы чуть не в такт
        const bool skip = rng_.next() < std::min(0.95, o.mask + jit_ * 0.35);
        o.plen = std::max(8.0, std::min(sr_ / o.fpS, (o.cyc / o.ffS) * sr_)); o.pf = o.ffS; o.pt = skip ? -1 : 0;
        o.pa = 0.75 + 0.25 * rng_.next();
        if (!skip) { o.n++; if (fulg_ > 0 && rng_.next() < fulg_ * std::min(0.25, 4 / o.fpS)) flash(vi, k); }
      }
      if (o.pt >= 0) {
        const double x = o.pt / o.plen, s = std::sin(PI * x), w0 = std::pow(s, 2), w1 = std::min(1.0, x * 40) * std::exp(-x * 5);
        const double w = o.win < 0.5 ? w0 + (w1 - w0) * o.win * 2 : w1 + (1 - w1) * (o.win - 0.5) * 2;
        const double y = std::sin((TAU * o.pf * o.pt) / sr_) * w * o.g * o.pa;
        L[k] += y * gl; if (stereo) R[k] += y * gr;
        if (++o.pt >= o.plen) o.pt = -1;
      }
    }
  }
  if (crep_ > 0 || npips_ || ncr_) dust(L, R, n);
  for (int k = 0; k < n; k++) {                         // без постоянной составляющей, мягкий потолок
    L[k] = static_cast<float>(std::tanh(dc_[0].step(L[k]) * 0.7));
    if (stereo) Rw[k] = static_cast<float>(std::tanh(dc_[1].step(Rw[k]) * 0.7));
  }
}

void Pulsar::flash(int i, int k0) {                     // fulgur: чистый высокий синус в один канал или цифровой щелчок
  const double r = rng_.next();
  const int side = rng_.next() < 0.5 ? -1 : 1;
  if (npips_ > 6) return;
  if (r < 0.25) {
    pips_[npips_++] = {k0, 1, 0, side, 0.5 * (0.6 + 0.4 * fulg_), 0};
  } else {
    static const double F[5] = {10500, 12800, 14000, 15600, 17200};
    const double f = std::min(F[static_cast<int>(std::floor(rng_.next() * 5))], sr_ * 0.42);
    const double u = rng_.next();
    pips_[npips_++] = {k0, jsRound((0.006 + 0.054 * std::pow(u, 2)) * sr_), f, side, 0.06 + 0.1 * fulg_, 0};
  }
  if (nfl_ < FLMAX) fl_[nfl_++] = i;
}

void Pulsar::dust(float* L, float* R, int n) {          // crepitus + fulgur поверх пульсаров
  const bool stereo = R != nullptr;
  bool on = false;
  for (int v = 0; v < VMAX; v++) if (vo_[v].on) on = true;
  const double c = crep_;
  for (int k = 0; k < n; k++) {
    act_ += ((on ? 1 : 0) - act_) * 0.0005;
    if (c > 0 && act_ > 0.01) {
      if (--burstT_ <= 0) {                             // треск идёт стайками
        burstT_ = jsRound((0.3 + 2.5 * rng_.next()) * sr_);
        burst_ = rng_.next() < 0.25 ? 3 + 5 * rng_.next() : 0.4 + 0.8 * rng_.next();
      }
      const double rate = (2 + 90 * std::pow(c, 2.2)) * burst_;
      if (rng_.next() < rate / sr_ && ncr_ < CRMAX) {
        const double a = c * act_ * (0.04 + 0.7 * std::pow(rng_.next(), 5)), pan = rng_.next() * 2 - 1;
        const double sa = rng_.next() < 0.5 ? a : -a;
        const double d = std::exp(-1 / ((0.0002 + 0.0018 * rng_.next()) * sr_));
        cr_[ncr_++] = {sa, d, pan, 0, 0};
        if (nck_ < CKMAX) { ck_[nck_ * 2] = pan; ck_[nck_ * 2 + 1] = a; nck_++; }
      }
      double* h = hiss_;
      const double w = (rng_.next() * 2 - 1) * c * c * 0.012 * act_;   // тёплое шипение пластинки
      const double w2 = (rng_.next() * 2 - 1) * c * c * 0.012 * act_;
      h[0] += (w - h[0]) * 0.18; h[1] += (w2 - h[1]) * 0.18;
      L[k] += h[0]; if (stereo) R[k] += h[1];
    }
    for (int j = ncr_ - 1; j >= 0; j--) {               // щелчок: короткий всплеск шума, сверху — без низа
      Crackle& q = cr_[j];
      const double nz = (rng_.next() * 2 - 1) * 0.5 + 0.5 * sgn(q.a), v = nz * q.a, y = v - q.x;
      q.x = v;
      L[k] += y * (1 - q.pan) * 0.5; if (stereo) R[k] += y * (1 + q.pan) * 0.5;
      q.a *= q.d;
      if (std::fabs(q.a) < 1e-4) { for (int m = j; m < ncr_ - 1; m++) cr_[m] = cr_[m + 1]; ncr_--; }
    }
    for (int j = npips_ - 1; j >= 0; j--) {
      Pip& p = pips_[j];
      if (k < p.k0 && p.t == 0) continue;
      double y;
      if (!p.f) y = p.t == 0 ? p.a : 0;
      else {
        const double fade = std::min({1.0, p.t / (0.0004 * sr_), (p.len - p.t) / (0.0004 * sr_)});
        y = std::sin((TAU * p.f * p.t) / sr_) * p.a * fade;
      }
      if (p.side < 0) L[k] += y; else if (stereo) R[k] += y; else L[k] += y;
      if (++p.t >= p.len) { for (int m = j; m < npips_ - 1; m++) pips_[m] = pips_[m + 1]; npips_--; }
    }
  }
  for (int j = 0; j < npips_; j++) pips_[j].k0 = 0;
}

}  // namespace firmamentum

#include "ocean.hpp"

#include <algorithm>
#include <cmath>

namespace oceanus {

namespace {
constexpr double PI = 3.14159265358979323846;
inline double jsRound(double x) { double r = std::floor(x); return (x - r >= 0.5) ? r + 1 : r; }   // Math.round: половина — вверх
inline float f32(double x) { return static_cast<float>(x); }
}  // namespace

Ocean::Ocean(double sr, uint32_t seed) : sr_(sr), rng_(seed) {
  for (int j = 0; j < VMAX; j++) vo_[j].ph = rng_.next();
  for (int i = 0; i < N; i++) {
    double th = (static_cast<double>(i) / N) * 2 * PI;
    x_[i] = b_[i] = a_[i] = f32(0.5 * std::cos(th));
    v_[i] = 0;
  }
}

void Ocean::params(double kt, double damp, double kc, double wind, double tide, double moonRate, double storm, double sway, double swayTo) {
  kt_ = kt; damp_ = damp; kc_ = kc; wind_ = wind; tide_ = tide; moonRate_ = moonRate; storm_ = storm; sway_ = sway; swayTo_ = swayTo;
}

void Ocean::push(double id, double a, double d, double k) {
  for (int i = 0; i < nf_; i++) if (fingers_[i].id == id) { fingers_[i] = {id, a, d, k}; return; }
  if (nf_ < PMAX) fingers_[nf_++] = {id, a, d, k};
}

void Ocean::release(double id) {
  for (int i = 0; i < nf_; i++) if (fingers_[i].id == id) {
    for (int j = i; j + 1 < nf_; j++) fingers_[j] = fingers_[j + 1];
    nf_--;
    return;
  }
}

void Ocean::splash(double a, double amt) {                // толчок скорости колоколом вокруг места
  for (int i = 0; i < N; i++) {
    double u = static_cast<double>(i) / N - a;
    u -= jsRound(u);
    v_[i] = f32(static_cast<double>(v_[i]) + amt * std::exp(-(u * u) / (2 * 0.025 * 0.025)));
  }
}

void Ocean::voice(int i, bool on, double f, double lvl, double path) {
  if (i < 0 || i >= VMAX) return;
  Voice& o = vo_[i];
  o.on = on;
  if (f != 0) o.f = f;
  o.lvl = lvl; o.path = path;
}

void Ocean::step() {                                       // соседи тянут, луна держит горб, трение, ветер, пальцы
  const double th0 = moon_ * 2 * PI, ls = std::sin(th0), sw = sway_ * ls;
  if (storm_ != 0) {
    sm_ += (rng_.next() - 0.5) * 0.08;
    sm_ = std::max(0.0, std::min(4.0, sm_ + (1 - sm_) * 0.002));
  } else sm_ = 1;
  moon_ = std::fmod(moon_ + (moonRate_ * sm_ * STEP) / sr_, 1.0);
  pm_ = swayTo_ == 1 ? std::pow(2.0, (2 * sw) / 12) : 1;
  const double kt = kt_ * (swayTo_ == 0 ? std::max(0.05, 1 + 0.9 * sw) : 1), kc = kc_;
  const double dm = 1 - damp_ * (swayTo_ == 2 ? std::max(0.05, 1 + 0.9 * sw) : 1), tide = tide_;
  for (int i = 0; i < N; i++) {
    const double l = x_[(i + N - 1) % N], r = x_[(i + 1) % N], rest = tide * std::cos((static_cast<double>(i) / N) * 2 * PI - th0);
    double f = kt * (l + r - 2 * static_cast<double>(x_[i])) - kc * (static_cast<double>(x_[i]) - rest);
    if (wind_ != 0) f += wind_ * 0.004 * (rng_.next() * 2 - 1);
    v_[i] = f32((static_cast<double>(v_[i]) + f) * dm);
  }
  for (int q = 0; q < nf_; q++) {                          // палец тянет воду к своей глубине, колоколом
    const Finger& p = fingers_[q];
    for (int i = 0; i < N; i++) {
      double u = static_cast<double>(i) / N - p.a;
      u -= jsRound(u);
      const double w = std::exp(-(u * u) / (2 * 0.03 * 0.03));
      v_[i] = f32(static_cast<double>(v_[i]) + (p.k * w * (p.d - static_cast<double>(x_[i])) - 0.1 * w * static_cast<double>(v_[i])));   // v += A − B: разность в скобках, как в JS
    }
  }
  double m = 0;
  for (int i = 0; i < N; i++) {
    x_[i] = f32(static_cast<double>(x_[i]) + static_cast<double>(v_[i]));
    if (x_[i] > 3) { x_[i] = 3; v_[i] = 0; } else if (x_[i] < -3) { x_[i] = -3; v_[i] = 0; }
    m += x_[i];
  }
  m /= N;
  for (int i = 0; i < N; i++) a_[i] = b_[i];
  for (int i = 0; i < N; i++) b_[i] = f32(static_cast<double>(x_[i]) - m);   // без постоянной составляющей
}

void Ocean::process(float* L, float* R, int n) {
  const double sr = sr_;
  for (int s = 0; s < n; s++) {
    if (k_ == 0) step();
    const double fr = static_cast<double>(k_) / STEP;
    k_ = (k_ + 1) % STEP;
    double yl = 0, yr = 0;
    for (int j = 0; j < VMAX; j++) {
      Voice& o = vo_[j];
      o.g += ((o.on ? o.lvl : 0) - o.g) * (o.on ? 0.0015 : 0.0006);
      if (o.g < 1e-5 && !o.on) continue;
      o.ph += (o.f * pm_) / sr; if (o.ph >= 1) o.ph -= 1;
      const double q = o.path == 1 ? 1 - o.ph : o.path == 2 ? (o.ph < 0.5 ? 2 * o.ph : 2 - 2 * o.ph) : o.ph;
      const double p = std::min(N - 1e-6, q * N);
      const int i0 = static_cast<int>(p), i1 = (i0 + 1) % N;
      const double u = p - i0;
      const double a0 = a_[i0], b0 = b_[i0], a1 = a_[i1], b1 = b_[i1];
      const double y0 = a0 + (b0 - a0) * fr, y1 = a1 + (b1 - a1) * fr;
      double y = (y0 + (y1 - y0) * u) * o.g;
      const double c = std::min(0.9, (2 * PI * 6000) / sr);
      o.lp += c * (y - o.lp); y = o.lp;
      const double pan = (j % 3 - 1) * 0.35;
      yl += y * (1 - pan); yr += y * (1 + pan);
    }
    L[s] = static_cast<float>(std::tanh(yl * 0.45));
    if (R) R[s] = static_cast<float>(std::tanh(yr * 0.45));
  }
}

}  // namespace oceanus

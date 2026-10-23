// Horologium — колесо и кольца, см. sound.hpp. Порядок операций — как в tools/ref/horo-worklet.js.
#include "sound.hpp"

#include <cmath>

namespace horologium {

static double wrap1(double x) { return x - std::floor(x + 0.5); }   // в [−0.5, 0.5)
static double lockRate(double err) { return 1 + std::fmax(-0.03, std::fmin(0.03, err)); }

void Sound::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  rng_ = sdk::Rng(seed);
  for (int i = 0; i < NR; i++) { r_[i] = O{}; r_[i].n = i + 2; r_[i].pan = -0.7 + (1.4 * i) / (NR - 1); r_[i].m = i + 2; }
  P_ = F_ = Ft_ = glide_ = 0; glideN_ = 0; B_ = 55; mat_ = 0.35; conc_ = 0.4; chance_ = 1; aeq_ = 0;
  lockOn_ = snap_ = false; dc_[0] = dc_[1] = dx_[0] = dx_[1] = 0; nh_ = 0; strikes_ = 0;
}

void Sound::set(const R* rings, double Ft, double B, double mat, double conc, double chance, double aeq) {
  for (int i = 0; i < NR; i++) { O& o = r_[i]; o.on = rings[i].on; o.under = rings[i].under; o.phi = rings[i].phi; o.lvl = rings[i].lvl; }
  Ft_ = Ft; B_ = B; mat_ = mat; conc_ = conc; chance_ = chance; aeq_ = aeq;
}

void Sound::step(double d) { glide_ += d; glideN_ = static_cast<int>(std::floor(0.04 * sr_ + 0.5)); }

void Sound::lock(double t0, double bar) {
  if (!(bar > 0)) { lockOn_ = false; return; }
  if (!lockOn_) snap_ = true;
  lockOn_ = true; t0_ = t0; bar_ = bar;
}

double Sound::mOf(const O& o) const {
  const double m = o.under ? 12.0 / o.n : o.n;
  if (aeq_ <= 0) return m;
  const double et = std::pow(2.0, std::floor(12 * std::log2(m) + 0.5) / 12);
  return m * std::pow(et / m, aeq_);
}

int Sound::hits(int* buf, int cap) {
  int k = 0;
  for (; k < nh_ && k < cap; k++) buf[k] = hit_[k];
  nh_ = 0;
  return k;
}

void Sound::process(float* L, float* R, int n, double now) {
  const double sr = sr_, TAU = M_PI * 2;
  O* act[NR];
  int na = 0;
  for (O& o : r_) if (o.on) { o.m = mOf(o); act[na++] = &o; }
  const double kF = 1 - std::exp(-1 / (0.06 * sr));
  bool quiet = na == 0 && std::fabs(dc_[0]) < 1e-9 && std::fabs(dc_[1]) < 1e-9;
  for (const O& o : r_) if (std::fabs(o.y1) > 1e-12 || std::fabs(o.y2) > 1e-12 || o.ek > 0) quiet = false;
  if (quiet) {                                          // колец нет, всё отзвучало: идёт только колесо (его видно и по нему — замок)
    for (int k = 0; k < n; k++) {
      F_ += (Ft_ - F_) * kF;
      double dP = F_ / sr;
      if (lockOn_) {
        const double t = now + k / sr, err = wrap1((t - t0_) / bar_ - P_);
        if (snap_ || std::fabs(err) > 0.1) { P_ += err; snap_ = false; }
        else dP *= lockRate(err);
      }
      if (glideN_ > 0) { const double g = glide_ / glideN_; dP += g; glide_ -= g; glideN_--; }
      P_ += dP;
      L[k] = R[k] = 0;
    }
    for (O& o : r_) o.y1 = o.y2 = 0;
    dc_[0] = dc_[1] = dx_[0] = dx_[1] = 0;
    return;
  }
  for (int k = 0; k < n; k++) {
    F_ += (Ft_ - F_) * kF;
    double dP = F_ / sr;
    if (lockOn_) {
      const double t = now + k / sr, err = wrap1((t - t0_) / bar_ - P_);
      if (snap_ || std::fabs(err) > 0.1) { P_ += err; snap_ = false; }
      else dP *= lockRate(err);
    }
    if (glideN_ > 0) { const double g = glide_ / glideN_; dP += g; glide_ -= g; glideN_--; }
    const double P0 = P_;
    P_ += dP;
    const double Fe = std::fabs(dP) * sr;               // мгновенная скорость (и при спуске руками)
    double yl = 0, yr = 0;
    for (int a = 0; a < na; a++) {
      O& o = *act[a];
      const double x0 = P0 * o.m + o.phi, x1 = P_ * o.m + o.phi;
      double ex = 0;
      if (std::floor(x1) != std::floor(x0) && rnd() < chance_) {   // удар
        const double rate = std::fmax(1e-3, Fe * o.m);
        double acc = 1;
        if (conc_ > 0) {                                // concursus: совпал с ударом другого кольца или с «раз»
          const double w = std::fmin(0.05, 0.006 * Fe);
          bool hitc = std::fabs(P_ - std::floor(P_ + 0.5)) < w;
          for (int b = 0; b < na && !hitc; b++) {
            const O& q = *act[b];
            if (&q == &o) continue;
            const double xq = P_ * q.m + q.phi;
            if (std::fabs(xq - std::floor(xq + 0.5)) < w * q.m) hitc = true;
          }
          if (hitc) acc += conc_ * 1.2; else acc *= 1 - 0.35 * conc_;
        }
        o.ea = acc * o.lvl;                             // молоточек sin²: дерево — 1.6 мс, металл — 0.5 мс
        o.eN = static_cast<int>(std::fmax(4, std::floor((0.0005 + 0.0011 * (1 - mat_)) * sr + 0.5))); o.ek = o.eN;
        o.nz = static_cast<int>(std::floor(0.0015 * sr * (1 - mat_) + 0.5));   // дерево — с шорохом
        o.rate = rate;
        strikes_++;
        if (nh_ < HMAX) hit_[nh_++] = o.n - 2;
      }
      const double f = std::fmin(sr * 0.42, o.m * std::fmax(B_, std::fmin(Fe, 400)));
      const double T = 0.012 * std::pow(50.0, mat_) * std::sqrt(std::fmin(4, 220 / f));
      const double rr = std::exp(-1 / (T * sr)), w = (TAU * f) / sr, sw = std::sin(w);
      const double norm = 1 - std::exp(-1 / (T * std::fmax(1, o.rate != 0 ? o.rate : 1)));   // часто — сумма не растёт без меры
      if (o.ek > 0) { const int j = o.eN - o.ek; const double w2 = std::sin((M_PI * (j + 0.5)) / o.eN); ex = (o.ea * 2 * w2 * w2) / o.eN; o.ek--; }
      double xin = ex * sw * norm * 0.55;
      if (o.nz > 0) { xin += (rnd() * 2 - 1) * 0.02 * sw * o.lvl * norm * (o.nz / 72.0); o.nz--; }
      const double y = 2 * rr * std::cos(w) * o.y1 - rr * rr * o.y2 + xin;
      o.y2 = o.y1; o.y1 = y;
      const double pl = (1 - o.pan) * 0.5, pr = (1 + o.pan) * 0.5;
      yl += y * pl; yr += y * pr;
    }
    const double og = (0.8 + 0.6 * (1 - mat_)) / std::sqrt(1 + Fe / 8);
    L[k] = static_cast<float>(yl * og); R[k] = static_cast<float>(yr * og);
  }
  for (O& o : r_) if (!o.on) { o.y1 *= 0.9; o.y2 *= 0.9; }
  for (int k = 0; k < n; k++) {
    double x = L[k], y = x - dx_[0] + 0.997 * dc_[0]; dx_[0] = x; dc_[0] = y; L[k] = static_cast<float>(std::tanh(y * 0.9));
    x = R[k]; y = x - dx_[1] + 0.997 * dc_[1]; dx_[1] = x; dc_[1] = y; R[k] = static_cast<float>(std::tanh(y * 0.9));
  }
}

}  // namespace horologium

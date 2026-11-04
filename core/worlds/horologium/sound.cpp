// Horologium — колесо и ударные кольца, см. sound.hpp. Колесо и обнаружение удара — в порядке эталона tools/ref/horo-worklet.js.
#include "sound.hpp"

#include <cmath>

namespace horologium {

static double wrap1(double x) { return x - std::floor(x + 0.5); }   // в [−0.5, 0.5)
static double lockRate(double err) { return 1 + std::fmax(-0.03, std::fmin(0.03, err)); }

void Sound::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  rng_ = sdk::Rng(seed);
  gap_ = static_cast<int64_t>(std::ceil(MIN_GAP * sr_));
  for (int i = 0; i < NR; i++) { r_[i] = O{}; r_[i].n = i + 2; r_[i].pan = -0.7 + (1.4 * i) / (NR - 1); r_[i].m = i + 2; r_[i].inst = i; r_[i].d.prepare(sr_); }
  P_ = F_ = Ft_ = glide_ = 0; glideN_ = 0; mat_ = 0.35; conc_ = 0.4; chance_ = 1; aeq_ = 0; tint_ = 1;
  lockOn_ = snap_ = false; dc_[0] = dc_[1] = dx_[0] = dx_[1] = 0; nh_ = 0; strikes_ = attacks_ = smp_ = 0;
}

void Sound::set(const R* rings, double Ft, double mat, double conc, double chance, double aeq, double tint) {
  for (int i = 0; i < NR; i++) {
    O& o = r_[i];
    o.on = rings[i].on; o.under = rings[i].under; o.phi = rings[i].phi; o.lvl = rings[i].lvl;
    o.inst = rings[i].inst >= 0 && rings[i].inst < NINST ? rings[i].inst : i;   // голос не терпит мусора: чужой номер — кит по умолчанию
    o.hz = std::isfinite(rings[i].hz) ? rings[i].hz : 0;
  }
  Ft_ = Ft; mat_ = mat; conc_ = conc; chance_ = chance; aeq_ = aeq;
  tint_ = std::isfinite(tint) && tint > 0 ? tint : 1;
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
  const double sr = sr_;
  O* act[NR];
  int na = 0;
  for (O& o : r_) if (o.on) { o.m = mOf(o); act[na++] = &o; }
  const double kF = 1 - std::exp(-1 / (0.06 * sr));
  const bool still = Ft_ == 0 && std::fabs(F_) < 1e-12 && glideN_ == 0 && !lockOn_;   // колесо стоит — ударов не будет
  bool quiet = (na == 0 || still) && std::fabs(dc_[0]) < 1e-9 && std::fabs(dc_[1]) < 1e-9;
  for (const O& o : r_) if (o.d.active()) quiet = false;
  if (quiet) {                                          // колец нет или колесо стоит, голоса отзвучали: идёт только колесо (его видно и по нему — замок)
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
    smp_ += n;
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
      if (std::floor(x1) != std::floor(x0) && rnd() < chance_) {   // удар
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
        strikes_++;
        if (nh_ < HMAX) hit_[nh_++] = o.n - 2;
        if (smp_ - o.last >= gap_) {                    // потолок: между запусками голоса кольца — не меньше MIN_GAP
          o.d.hit(o.inst, o.hz, tint_, mat_, acc * o.lvl);
          o.last = smp_; attacks_++;
        }
      }
    }
    for (O& o : r_) {                                   // голоса звучат и у выключенных колец — хвост доигрывает
      if (!o.d.active()) continue;
      const double y = o.d.step(rng_) * KIT;
      yl += y * (1 - o.pan) * 0.5; yr += y * (1 + o.pan) * 0.5;
    }
    L[k] = static_cast<float>(yl); R[k] = static_cast<float>(yr);
    smp_++;
  }
  for (int k = 0; k < n; k++) {
    double x = L[k], y = x - dx_[0] + 0.997 * dc_[0]; dx_[0] = x; dc_[0] = y; L[k] = static_cast<float>(std::tanh(y * 0.9));
    x = R[k]; y = x - dx_[1] + 0.997 * dc_[1]; dx_[1] = x; dc_[1] = y; R[k] = static_cast<float>(std::tanh(y * 0.9));
  }
}

}  // namespace horologium

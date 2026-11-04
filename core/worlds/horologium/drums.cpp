#include "drums.hpp"
#include <algorithm>
#include <cmath>

namespace horologium {

namespace {
const double TAU = 6.283185307179586;
double decay(double t60, double sr) { return std::pow(10.0, -3.0 / (std::max(t60, 1e-4) * sr)); }
double expo(double tau, double sr) { return std::exp(-1.0 / (tau * sr)); }
double clampHz(double f, double sr) { return std::min(std::max(f, 20.0), 0.45 * sr); }
inline double wrap(double p) { return p >= 1.0 ? p - 1.0 : p; }
inline double sinTurns(double p) { return std::sin(TAU * p); }
}  // namespace

Range pitchRange(int inst) {
  switch (inst) {
    case KICK: return {40, 80};
    case TOM: return {80, 250};
    case SNARE: return {150, 300};
    case RIM: return {300, 900};
    case BELL: return {400, 1200};
    default: return {0, 0};
  }
}

void Drum::prepare(double sr) { sr_ = sr; on_ = false; f_.reset(); }

void Drum::hit(int inst, double hz, double tint, double mat, double amp) {
  inst_ = inst; amp_ = amp; hz_ = hz;
  const double skin = 0.7 + 0.6 * mat, metal = 0.6 + 1.4 * mat, fm = 0.5 + mat;
  const double fc = (0.8 + 0.4 * mat) * tint;
  e1_ = e2_ = 1; p_ = 1; t_ = 0; burst_ = 1;
  for (int i = 0; i < 4; i++) ph_[i] = 0;
  f_.reset();
  idx_ = fm;
  switch (inst) {
    case KICK: g1_ = decay(0.25 * skin, sr_); gp_ = expo(0.010, sr_); break;
    case TOM: g1_ = decay(0.18 * skin, sr_); gp_ = expo(0.015, sr_); idx_ = 0.3 * fm; break;
    case SNARE:
      g1_ = decay(0.08 * skin, sr_); g2_ = decay(0.12 * skin, sr_);
      f_.set(sdk::Biquad::bandpass, clampHz(2000 * fc, sr_), 1, sr_); break;
    case CLAP:
      g1_ = decay(0.15 * skin, sr_); gb_ = expo(0.003, sr_);
      gap_ = static_cast<long>(0.010 * sr_); tailAt_ = static_cast<long>(0.030 * sr_);
      e1_ = 0;                                    // хвост включается после трёх пачек
      f_.set(sdk::Biquad::bandpass, clampHz(1200 * fc, sr_), 2, sr_); break;
    case RIM: g1_ = decay(0.025 * metal, sr_); idx_ = 2 * fm; break;
    case HAT: case OHAT:
      g1_ = decay((inst == HAT ? 0.04 : 0.30) * metal, sr_); idx_ = 3 * fm;
      fr_[0] = 540 * tint; fr_[1] = 800 * tint;
      fr_[2] = fr_[0] * (1.41 + 0.33 * mat); fr_[3] = fr_[1] * (1.41 + 0.33 * mat);
      f_.set(sdk::Biquad::highpass, clampHz(7000 * fc, sr_), 0, sr_); break;
    case BELL:
      g1_ = decay(0.20 * metal, sr_); idx_ = fm;
      fr_[0] = hz; fr_[1] = hz * (1.48 + 0.12 * (mat - 0.35));
      f_.set(sdk::Biquad::bandpass, clampHz(1.48 * hz, sr_), 0.7, sr_); break;
    default: break;
  }
  on_ = true;
}

// Выравнивание пика голоса до ~1.0 при amp 1 (замер — в drums.hpp).
static const double GAIN[NINST] = {1.05, 1.18, 1.48, 2.8, 1.16, 3.4, 0.99, 2.6};

double Drum::step(sdk::Rng& rng) {
  if (!on_) return 0;
  const double inv = 1.0 / sr_;
  double y = 0;
  switch (inst_) {
    case KICK: {
      ph_[0] = wrap(ph_[0] + hz_ * (1 + 2 * p_) * inv);
      y = 1.0 * sinTurns(ph_[0]) * e1_; p_ *= gp_; e1_ *= g1_; break;
    }
    case TOM: {
      const double f = hz_ * (1 + 0.5 * p_);
      ph_[0] = wrap(ph_[0] + f * inv); ph_[1] = wrap(ph_[1] + 1.5 * f * inv);
      y = 0.9 * std::sin(TAU * ph_[0] + idx_ * sinTurns(ph_[1])) * e1_; p_ *= gp_; e1_ *= g1_; break;
    }
    case SNARE: {
      ph_[0] = wrap(ph_[0] + hz_ * inv);
      const double n = f_.step(rng.next() * 2 - 1);
      y = 0.5 * sinTurns(ph_[0]) * e1_ + 0.7 * n * e2_ * 1.2; e1_ *= g1_; e2_ *= g2_; break;
    }
    case CLAP: {
      const double n = f_.step(rng.next() * 2 - 1);
      double env;
      if (t_ < tailAt_) {
        if (t_ > 0 && t_ % gap_ == 0) burst_ = 1;
        env = burst_; burst_ *= gb_;
        if (t_ + 1 == tailAt_) e1_ = 1;
      } else { env = e1_; e1_ *= g1_; }
      t_++; y = 1.4 * n * env; break;
    }
    case RIM: {
      ph_[0] = wrap(ph_[0] + hz_ * inv); ph_[1] = wrap(ph_[1] + 1.71 * hz_ * inv);
      y = 0.9 * std::sin(TAU * ph_[0] + idx_ * sinTurns(ph_[1])) * e1_; e1_ *= g1_; break;
    }
    case HAT: case OHAT: {
      for (int i = 0; i < 4; i++) ph_[i] = wrap(ph_[i] + fr_[i] * inv);
      const double a = std::sin(TAU * ph_[0] + idx_ * sinTurns(ph_[2]));
      const double b = std::sin(TAU * ph_[1] + idx_ * sinTurns(ph_[3]));
      y = f_.step(0.35 * (a + b) + 0.3 * (rng.next() * 2 - 1)) * e1_; e1_ *= g1_; break;
    }
    case BELL: {
      ph_[0] = wrap(ph_[0] + fr_[0] * inv); ph_[1] = wrap(ph_[1] + fr_[1] * inv);
      ph_[2] = wrap(ph_[2] + 3.5 * fr_[0] * inv); ph_[3] = wrap(ph_[3] + 3.5 * fr_[1] * inv);
      const double a = std::sin(TAU * ph_[0] + idx_ * sinTurns(ph_[2]));
      const double b = std::sin(TAU * ph_[1] + idx_ * sinTurns(ph_[3]));
      y = f_.step(0.45 * (a + b)) * e1_ * 1.5; e1_ *= g1_; break;
    }
    default: break;
  }
  const bool clapHead = inst_ == CLAP && t_ < tailAt_;
  if (!clapHead && std::max(e1_, inst_ == SNARE ? e2_ : 0.0) < 1e-4) { on_ = false; f_.reset(); }
  return amp_ * GAIN[inst_] * y;
}

}  // namespace horologium

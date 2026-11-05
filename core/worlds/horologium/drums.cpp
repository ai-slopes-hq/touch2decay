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
    case BLIP: return {1000, 4000};
    case CLICK: return {1500, 6000};
    case ULTRA: return {8000, 16000};
    default: return {0, 0};
  }
}

void Drum::prepare(double sr) { sr_ = sr; on_ = false; f_.reset(); }

void Drum::hit(int inst, double hz, double tint, double mat, double amp) {
  inst_ = inst; amp_ = amp; hz_ = clampHz(hz, sr_);
  tint_ = std::min(std::max(tint, 0.5), 2.0);
  const double len = 0.6 + 1.4 * mat;
  e1_ = 1; g1_ = gr_ = 1; p_ = 1; gp_ = 1; t_ = 0; n_ = 0; k_ = 0;
  ph_[0] = ph_[1] = 0; y1_ = y2_ = 0; held_ = 0; hc_ = 0; hold_ = 1;
  f_.reset();
  switch (inst) {
    case KICK:                                    // синус, высота падает с ~25·hz за ~3 мс — щелчок в голове
      g1_ = decay(0.06 * len, sr_); gp_ = expo(0.0008, sr_); break;
    case BLIP:                                    // ворота 4…20 мс, резкий край
      n_ = static_cast<long>((0.004 + 0.016 * mat) * sr_); gr_ = expo(0.0004, sr_); break;
    case CLICK: {                                 // импульс в двухполюсный резонатор на hz; metallum — дольше звенит
      const double w = TAU * hz_ / sr_, r = expo(0.0006 + 0.0035 * mat, sr_);
      c1_ = 2 * r * std::cos(w); c2_ = -r * r; x0_ = std::sin(w); g1_ = r; break;
    }
    case STATIC:                                  // пачка 3…25 мс; частота выборки — на первом step()
      n_ = static_cast<long>((0.003 + 0.022 * mat) * sr_); gr_ = expo(0.0005, sr_); break;
    case ULTRA:                                   // ультразвук: синус на hz, за удар опускается к 0.6·hz
      g1_ = decay((0.005 + 0.025 * mat) * 1.5, sr_); gp_ = expo((0.005 + 0.025 * mat) * 0.5, sr_); break;
    case ZAP:                                     // спуск 8 кГц·tint → 80 Гц
      g1_ = decay(0.03 * len, sr_); gp_ = expo(0.003 + 0.009 * mat, sr_); break;
    case BIT:                                     // 1-битный шум, удержание ~10 кГц·tint, выше 6 кГц
      g1_ = decay(0.015 * len, sr_);
      hold_ = std::max(1L, std::lround(sr_ / (10000 * tint_)));
      f_.set(sdk::Biquad::highpass, clampHz(6000 * tint_, sr_), 0, sr_); break;
    case STUTTER:                                 // 3…6 гранов по ~2 мс, промежуток ×0.7 к следующему
      reps_ = 3 + static_cast<int>(std::lround(3 * mat)); gap_ = (0.010 + 0.010 * mat) * sr_;
      g1_ = expo(0.0007, sr_); e1_ = 0; n_ = 0; break;
    default: break;
  }
  on_ = true;
}

// Выравнивание пика голоса до ~1.0 при amp 1 (замер — в drums.hpp).
static const double GAIN[NINST] = {1.06, 0.75, 1.07, 0.8, 0.5, 1.0, 0.64, 1.1};

double Drum::step(sdk::Rng& rng) {
  if (!on_) return 0;
  const double inv = 1.0 / sr_;
  double y = 0; bool done = false;
  switch (inst_) {
    case KICK: {
      ph_[0] = wrap(ph_[0] + hz_ * (1 + 24 * p_) * inv);
      y = std::tanh(2 * sinTurns(ph_[0])) * e1_; p_ *= gp_; e1_ *= g1_; done = e1_ < 1e-4; break;
    }
    case BLIP: case ULTRA: {
      const double f = inst_ == ULTRA ? hz_ * (0.6 + 0.4 * p_) : hz_;
      ph_[0] = wrap(ph_[0] + f * inv);
      y = sinTurns(ph_[0]) * e1_;
      if (inst_ == ULTRA) { p_ *= gp_; e1_ *= g1_; } else if (t_ >= n_) e1_ *= gr_;
      t_++; done = e1_ < 1e-4; break;
    }
    case CLICK: {
      const double x = t_ == 0 ? x0_ : 0;
      const double r = c1_ * y1_ + c2_ * y2_ + x; y2_ = y1_; y1_ = r;
      y = r + (t_ == 0 ? 0.6 : t_ == 1 ? -0.6 : 0);         // голый щелчок в два отсчёта поверх звона
      e1_ *= g1_; t_++; done = t_ > 2 && e1_ < 1e-4; break;
    }
    case STATIC: {
      if (t_ == 0) hold_ = std::max(1L, std::lround(sr_ / ((1500 + 9000 * rng.next()) * tint_)));
      if (hc_-- <= 0) { held_ = rng.next() * 2 - 1; hc_ = hold_ - 1; }
      y = held_ * e1_;
      if (t_ >= n_) e1_ *= gr_;
      t_++; done = e1_ < 1e-4; break;
    }
    case ZAP: {
      const double f = 80 + (8000 * tint_ - 80) * p_;
      ph_[0] = wrap(ph_[0] + std::min(f, 0.45 * sr_) * inv);
      y = std::tanh(1.5 * sinTurns(ph_[0])) * e1_; p_ *= gp_; e1_ *= g1_; done = e1_ < 1e-4; break;
    }
    case BIT: {
      if (hc_-- <= 0) { held_ = rng.next() < 0.5 ? -1 : 1; hc_ = hold_ - 1; }
      y = f_.step(held_) * e1_; e1_ *= g1_; done = e1_ < 1e-4; break;
    }
    case STUTTER: {
      if (k_ < reps_ && t_ >= n_) {                       // новый гран: громкость ×0.8, высота выше, промежуток ×0.7
        e1_ = std::pow(0.8, k_); ph_[0] = ph_[1] = 0;
        n_ += std::max(1L, std::lround(gap_ * std::pow(0.7, k_))); k_++;
      }
      const double f = 1800 * tint_ * (1 + 0.25 * (k_ - 1));
      ph_[0] = wrap(ph_[0] + f * inv); ph_[1] = wrap(ph_[1] + 1.37 * f * inv);
      y = (0.7 * std::sin(TAU * ph_[0] + 3 * sinTurns(ph_[1])) + 0.3 * (rng.next() * 2 - 1)) * e1_;
      e1_ *= g1_; t_++; done = k_ >= reps_ && e1_ < 1e-4; break;
    }
    default: done = true; break;
  }
  if (done) { on_ = false; f_.reset(); }
  return amp_ * GAIN[inst_] * y;
}

}  // namespace horologium

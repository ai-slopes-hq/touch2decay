// Inferno — звук, см. sound.hpp.
#include "sound.hpp"
#include <cmath>
#include <cstring>

namespace inferno {


static double coef(int n, double tau, double sr) { return 1 - std::exp(-n / (tau * sr)); }   // доля пути к цели за блок (setTargetAtTime)

void Sound::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  rng_ = sdk::Rng(seed);
  const int len = static_cast<int>(std::floor(sr_ * 0.03 + 0.5));
  burst_.assign(static_cast<size_t>(len), 0.f);
  for (int i = 0; i < len; i++) burst_[i] = static_cast<float>((rng_.next() * 2 - 1) * std::exp(-i / (len * 0.25)));
  for (Voice& v : v_) v = Voice();
  fire_ = sdk::TanhShaper(); fire_.os2 = true; fire_.set(1 + fx_fire_ * 8);
  smLP_ = sdk::Biquad(); smLP_.set(sdk::Biquad::lowpass, 1400, 1, sr_);
  outG_ = smokeG_ = 0; busInit_ = false; live_ = 0; tail_ = 0; strikes_ = 0; nheard_ = 0;
  fx(0.2, 0.35);
}

void Sound::fx(double fire, double smoke) {
  fx_fire_ = fire; fx_smoke_ = smoke;
  fire_.set(1 + fire * 8);
  tOut_ = 3 / (1 + fire * 1.5);
  tSmoke_ = smoke * smoke * 1.4;
  if (!busInit_) { outG_ = tOut_; smokeG_ = tSmoke_; busInit_ = true; }
}

void Sound::wake(int k) {                               // как circleNodes(k): круг начинает считаться; параметры — сразу
  Voice& v = v_[k];
  if (v.live) return;
  v.live = true; v.snapNext = true; v.quiet = 0; live_++;
  v.bank.reset(); v.lp = sdk::Biquad();
  v.lp.set(sdk::Biquad::lowpass, 9000 / (1 + k * 0.6), 1, sr_);
  v.sh.reset();
  v.bank.snap();
  v.vca = v.level;
  tail_ = static_cast<int>(sr_);
}

void Sound::tune(int k, const double hz[3], double q, double level, double drive) {
  Voice& v = v_[k];
  const double g = std::sqrt(q) * 0.5;
  for (int j = 0; j < 3; j++) v.bank.target(j, hz[j] < 18000 ? hz[j] : 18000, q, g * WEIGHT[j]);
  v.level = level; v.drive = drive;
  v.sh.set(1 + drive * 6);
  if (!v.live) { v.bank.snap(); v.vca = level; }        // нет узлов — сразу в цель, когда появятся
}

void Sound::strike(int k, double vel) {
  wake(k);
  Voice& v = v_[k];
  int slot = 0, oldest = 1 << 30;
  for (int i = 0; i < NBURST; i++) {                    // свободный всплеск, иначе самый давний
    if (v.burst[i].pos < 0) { slot = i; break; }
    if (v.burst[i].pos < oldest) { oldest = v.burst[i].pos; slot = i; }
  }
  v.burst[slot].pos = 0; v.burst[slot].g = vel * 1.4;
  strikes_++;
  if (nheard_ < 64) heard_[nheard_++] = k;
  tail_ = static_cast<int>(sr_);
}

void Sound::smoulder(int k, bool on, int color) {
  if (!on && !v_[k].live) return;                       // гасить нечего — круг молчит
  wake(k);
  Voice& v = v_[k];
  if (on) {
    for (const Src& s : v.src) if (s.on && s.hold) return;
    int slot = -1;
    for (int i = 0; i < NSRC; i++) if (!v.src[i].on) { slot = i; break; }
    if (slot < 0) { slot = 0; for (int i = 1; i < NSRC; i++) if (v.src[i].g < v.src[slot].g) slot = i; }   // все заняты — вытеснить тишайший
    Src& s = v.src[slot];
    s = Src();
    s.on = true; s.hold = true; s.n.set(color); s.g = 0; s.tg = 0.5; s.tau = 0.12;
    tail_ = static_cast<int>(sr_);
  } else {
    for (Src& s : v.src) if (s.on && s.hold) { s.hold = false; s.tg = 0; s.tau = 0.15; s.ttl = 1.0; }
  }
}

void Sound::recolor(int k, int color) {
  Voice& v = v_[k];
  bool burning = false;
  for (const Src& s : v.src) if (s.on && s.hold) burning = true;
  if (!burning) return;
  smoulder(k, false, color);
  smoulder(k, true, color);
}

int Sound::drain(double* buf, int cap) {
  int n = 0;
  for (; n < nheard_ && n < cap; n++) buf[n] = heard_[n];
  nheard_ = 0;
  return n;
}

void Sound::process(float* L, float* R, float* sL, float* sR, int n) {
  if (n > MAXBLOCK) n = MAXBLOCK;
  if (n <= 0) return;
  if (live_ == 0 && tail_ <= 0) {                       // молчит: шина стоит, ничего не считаем
    for (int i = 0; i < n; i++) L[i] = R[i] = sL[i] = sR[i] = 0.f;
    return;
  }
  for (int i = 0; i < n; i++) mix_[i] = 0;
  const double cF = coef(n, 0.03, sr_), cQ = coef(n, 0.05, sr_);
  for (int k = 0; k < NC; k++) {
    Voice& v = v_[k];
    if (!v.live) continue;
    v.bank.glide(cF, cQ, cQ);
    v.bank.update(sr_);
    const double vca0 = v.vca;
    v.vca += (v.level - v.vca) * cQ;
    double gain0[NSRC], gain1[NSRC];
    bool anySrc = false;
    for (int s = 0; s < NSRC; s++) {
      Src& x = v.src[s];
      gain0[s] = x.g;
      if (x.on) { x.g += (x.tg - x.g) * coef(n, x.tau, sr_); anySrc = true; }
      gain1[s] = x.g;
    }
    bool anyBurst = false;
    double pk = 0;
    for (int i = 0; i < n; i++) {
      const double a = static_cast<double>(i + 1) / n;
      double exc = 0;
      for (Burst& b : v.burst) {
        if (b.pos < 0) continue;
        anyBurst = true;
        exc += burst_[b.pos] * b.g;
        if (++b.pos >= static_cast<int>(burst_.size())) b.pos = -1;
      }
      if (anySrc) for (int s = 0; s < NSRC; s++) if (v.src[s].on) exc += v.src[s].n.next(rng_, sr_) * (gain0[s] + (gain1[s] - gain0[s]) * a);
      double y = v.bank.step(exc);
      y = v.sh.step(y);
      y = v.lp.step(y);
      y *= vca0 + (v.vca - vca0) * a;
      mix_[i] += y;
      const double ay = std::fabs(y);
      if (ay > pk) pk = ay;
    }
    for (Src& x : v.src) {                              // погасший источник — убрать
      if (!x.on || x.hold) continue;
      x.ttl -= static_cast<double>(n) / sr_;
      if (x.ttl <= 0 || x.g < 1e-6) x.on = false;
    }
    if (!anySrc && !anyBurst && pk < 1e-7) { if (++v.quiet > 8) { v.live = false; v.bank.reset(); v.sh.reset(); live_--; } }
    else v.quiet = 0;
    if (v.live) tail_ = static_cast<int>(sr_);
  }
  const double cG = coef(n, 0.05, sr_), og0 = outG_, sg0 = smokeG_;
  outG_ += (tOut_ - outG_) * cG; smokeG_ += (tSmoke_ - smokeG_) * cG;
  for (int i = 0; i < n; i++) {
    const double a = static_cast<double>(i + 1) / n;
    const double f = fire_.step(mix_[i] * 0.6);
    const double og = og0 + (outG_ - og0) * a, sg = sg0 + (smokeG_ - sg0) * a;
    L[i] = R[i] = static_cast<float>(f * og);
    sL[i] = sR[i] = static_cast<float>(smLP_.step(f * sg) * og);   // smRet повторяет out
  }
  if (live_ == 0) tail_ -= n;
}

}  // namespace inferno

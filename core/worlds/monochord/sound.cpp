// Monochordum — звук струн, см. sound.hpp. Комментарии к формулам — в tools/ref/monochord-worklet.js (порядок операций тот же).
#include "sound.hpp"

#include <cmath>

namespace monochord {

static double clamp01(double x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
static int jsRound(double x) { return static_cast<int>(std::floor(x + 0.5)); }   // Math.round

void Sound::prepare(double fs, uint32_t seed) {
  fs_ = fs > 0 ? fs : 48000;
  rng_ = sdk::Rng(seed);
  for (int i = 0; i < NS; i++) {
    S& s = s_[i];
    s.k.clear(); s.h.clear();
    s.k.len = 400; s.k.b = 0.5; s.k.g = 0.996;
    s.h.len = 100; s.h.g = 0.99;
    s.exn = s.exi = s.hexn = s.hexi = 0;
    s.level = 0.8; s.pan = (i - 1.5) / 2.2; s.bow = s.bowS = s.sus = s.en = s.nz = 0; s.f = 110; s.t60 = 5; s.y = 0; s.e2 = 0;
    s.hen = s.he2 = 0; s.hn = 2;
  }
  nq_ = 0; cpl_ = 0.0004; wind_ = 0;
}

void Sound::tune(int i, double f0, double bright, double decay, double level) {
  if (!ok(i)) return;
  S& s = s_[i];
  const double f = std::fmax(20, std::fmin(2000, f0));
  s.k.b = 0.15 + 0.83 * clamp01(bright);
  const double dc = clamp01(decay);
  const double t60 = 0.3 + 14 * (dc * dc);
  s.k.g = sdk::KsLoop<BUF>::lossOf(t60, f);
  s.k.len = sdk::KsLoop<BUF>::lenOf(fs_, f, s.k.b);
  s.f = f; s.t60 = t60;
  if (level >= 0) s.level = level;
}

void Sound::harm(int i, int n, double vel) {           // флажолет: палец на узле 1/n — петля в n раз короче
  if (!ok(i)) return;
  S& s = s_[i];
  const double f = std::fmin(4000, s.f * n);
  s.hn = n; s.h.len = sdk::KsLoop<HBUF>::lenOf(fs_, f, s.k.b); s.h.g = std::pow(10.0, -3 / (s.t60 * 0.8 * f)); s.h.lp = 0;
  int L = jsRound(s.h.len);
  if (L > HBUF) L = HBUF;
  double y = 0;
  for (int k = 0; k < L; k++) { y += 0.5 * (rnd() * 2 - 1 - y); s.hex[k] = static_cast<float>(y * vel * 0.8); }
  s.hexn = L; s.hexi = 0;
}

void Sound::pluck(int i, double pos, double vel) {     // шум с мягким срезом по силе, гребёнка по месту щипка
  if (!ok(i)) return;
  S& s = s_[i];
  int L = jsRound(s.k.len);
  if (L > BUF) L = BUF;
  int d = jsRound(L * std::fmax(0.04, std::fmin(0.5, pos)));
  if (d < 1) d = 1;
  float* ex = s.ex;
  double y = 0;
  const double a = 0.25 + 0.7 * vel;
  for (int k = 0; k < L; k++) { y += a * (rnd() * 2 - 1 - y); ex[k] = static_cast<float>(y); }
  for (int k = L - 1; k >= d; k--) ex[k] = static_cast<float>(static_cast<double>(ex[k]) - ex[k - d]);
  const double g = vel * 0.9;
  for (int k = 0; k < L; k++) ex[k] = static_cast<float>(ex[k] * g);
  s.exn = L; s.exi = 0;
}

void Sound::at(double t, int i, double pos, double vel) {
  if (!ok(i)) return;
  if (nq_ == QMAX) { for (int k = 1; k < QMAX; k++) q_[k - 1] = q_[k]; nq_--; }   // переполнено — старый уходит
  q_[nq_++] = Q{t, i, pos, vel};
}

bool Sound::silent() const {
  if (wind_ != 0) return false;
  for (const S& s : s_)
    if (!(s.en < 1e-9 && s.hen < 1e-9 && !s.exn && !s.hexn && !s.bow && !s.bowS && !s.sus)) return false;
  return true;
}

bool Sound::process(float* L, float* R, int n, double now) {
  for (int k = 0; k < n; k++) L[k] = R[k] = 0;
  const double end = now + n / fs_;
  bool due = false;                                     // щипок по времени в этом блоке — блок считается
  for (int j = 0; j < nq_; j++) if (q_[j].t < end) { due = true; break; }
  if (!due && silent()) return false;
  const double c = cpl_, own = 1 - 3 * c;
  for (S& s : s_) { s.e2 = 0; s.he2 = 0; }
  for (int k = 0; k < n; k++) {
    if (nq_) {                                          // щипки, чьё время пришло к этому сэмплу
      const double t = now + k / fs_;
      int w = 0;
      for (int j = 0; j < nq_; j++) { if (q_[j].t <= t) pluck(q_[j].i, q_[j].pos, q_[j].vel); else q_[w++] = q_[j]; }
      nq_ = w;
    }
    double bridge = 0;
    for (const S& s : s_) bridge += s.y;
    for (S& s : s_) {
      s.bowS += (s.bow - s.bowS) * 0.002;
      const double y = s.k.read();
      s.k.lp += s.k.b * (y - s.k.lp);
      double v = s.k.lp * s.k.g * own + c * (bridge - s.y);
      if (s.exn) { v += s.ex[s.exi++]; if (s.exi >= s.exn) s.exn = 0; }
      const double drive = s.bowS * 0.06 + s.sus * 0.012 + wind_ * 0.01;
      if (drive > 1e-5) { s.nz += 0.3 * (rnd() * 2 - 1 - s.nz); v += s.nz * drive; }
      s.k.write(v);
      s.y = y;
      double out = y;
      if (s.hexn || s.hen > 1e-9) {                     // флажолет
        const double yh = s.h.read();
        s.h.lp += s.k.b * (yh - s.h.lp);
        double vh = s.h.lp * s.h.g;
        if (s.hexn) { vh += s.hex[s.hexi++]; if (s.hexi >= s.hexn) s.hexn = 0; }
        s.h.write(vh);
        out += yh; s.he2 += yh * yh;
      }
      L[k] = static_cast<float>(L[k] + out * s.level * (1 - s.pan) * 0.5);
      R[k] = static_cast<float>(R[k] + out * s.level * (1 + s.pan) * 0.5);
      s.e2 += y * y;
    }
  }
  for (S& s : s_) { s.en += (s.e2 / n - s.en) * 0.3; s.hen += (s.he2 / n - s.hen) * 0.3; }
  for (int k = 0; k < n; k++) { L[k] = static_cast<float>(std::tanh(L[k] * 0.8)); R[k] = static_cast<float>(std::tanh(R[k] * 0.8)); }
  return true;
}

}  // namespace monochord

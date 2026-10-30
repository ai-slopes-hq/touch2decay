// Horologium — мир SDK, см. world.hpp.
#include "world.hpp"

#include <cmath>

namespace horologium {

void World::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  model_.reset(seed);                                   // ГСЧ кубика — зерно мира
  sound_.prepare(sr_, seed + 1);                        // ГСЧ колец (chance, шорох дерева)
  hallG_ = sdk::OnePole();
  hallC_ = 1 - std::exp(-1 / (0.05 * sr_));
  now_ = 0; locked_ = false; nh_ = 0;
}

void World::action(int kind, int i, const double* a, int n) {
  const auto arg = [&](int k, double d) { return (a && k < n) ? a[k] : d; };
  switch (kind) {
    case RING: if (n >= 2) model_.setRing(i, static_cast<int>(a[0]), a[1]); break;
    case FX: if (n >= 1) model_.setFx(i, a[0]); break;
    case RUN: model_.setRun(arg(0, 0) != 0, arg(1, model_.clock().uT)); break;
    case HELD: model_.setHeld(arg(0, 0) != 0); break;
    case STEP: sound_.step(arg(0, 0)); break;
    case BPM: if (n >= 1 && a[0] > 0) model_.setBpm(a[0]); break;
    case SPEED: model_.setSpeed(arg(0, 0), arg(1, 0), arg(2, 0) != 0); break;
    case CLEAR: model_.clear(); break;
    case DICE: model_.dice(); break;
    case sdk::ACT_LFO: {                                // LFO плашек: Fx 0…4, кольца 5 + 2·i (phi) и 6 + 2·i (lvl) (i == -1 у плашек мира)
      if (n < 2 || i != -1) break;
      const int key = static_cast<int>(a[0]);
      if (key >= 0 && key < NFX) model_.setFx(key, a[1]);
      else if (key >= NFX && key < NFX + 2 * NR) model_.setRing((key - NFX) / 2, key % 2 ? PHI : LVL, a[1]);
      break;
    }
    default: break;
  }
}

void World::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  if (n > 128) n = 128;
  const double now = clk_ ? clk_->now : now_;
  now_ = now + n / sr_;
  model_.tick(n / sr_);
  Sound::R r[NR];
  for (int i = 0; i < NR; i++) { const Ring& q = model_.ring(i); r[i] = Sound::R{q.on, q.under, q.phi, q.lvl}; }
  sound_.set(r, model_.Fnow(), model_.baseB(), model_.fx(MATERIA), model_.fx(CONCURSUS), model_.fx(CHANCE), model_.fx(AEQUALIS));
  const Clock& c = model_.clock();
  const bool want = clk_ && clk_->grid.on && clk_->grid.p > 0 && c.run && c.u == 0 && !c.held;   // замок к такту: оборот = 4 доли
  if (want) sound_.lock(clk_->grid.t0, 4 * clk_->grid.p); else if (locked_) sound_.unlock();
  locked_ = want;
  sound_.process(out.L, out.R, n, now);
  const double h = model_.fx(HALL), to = h * h * HALL_K;
  for (int k = 0; k < n; k++) {
    const double g = hallG_.step(to, hallC_) * OUT;     // посыл стоит до out мира, а прежний out ×2.4 был и за возвратом зала
    const double l = out.L[k], rr = out.R[k];
    out.sL[k] = static_cast<float>(l * g); out.sR[k] = static_cast<float>(rr * g);
    out.L[k] = static_cast<float>(l * OUT); out.R[k] = static_cast<float>(rr * OUT);
  }
  int buf[Sound::HMAX];
  const int k = sound_.hits(buf, Sound::HMAX);
  for (int j = 0; j < k && nh_ < Sound::HMAX; j++) hit_[nh_++] = buf[j];
}

int World::mirror(double* buf, int cap) const {
  if (!buf || cap < MIRROR_N) return 0;
  double* p = buf;
  const Clock& c = model_.clock();
  for (int k = 0; k < NFX; k++) *p++ = model_.fx(k);
  *p++ = c.run; *p++ = c.u; *p++ = c.uT; *p++ = c.bpm; *p++ = c.strip; *p++ = c.held;
  *p++ = sound_.P(); *p++ = sound_.F(); *p++ = static_cast<double>(sound_.strikes()); *p++ = locked_;
  for (int i = 0; i < NR; i++) { const Ring& q = model_.ring(i); *p++ = q.on; *p++ = q.under; *p++ = q.phi; *p++ = q.lvl; }
  return MIRROR_N;
}

int World::heard(double* buf, int cap) {
  if (!nh_ || !buf || cap < 2 + nh_) return 0;
  buf[0] = nh_; buf[1] = sound_.P();
  for (int j = 0; j < nh_; j++) buf[2 + j] = hit_[j];
  const int k = 2 + nh_;
  nh_ = 0;
  return k;
}

}  // namespace horologium

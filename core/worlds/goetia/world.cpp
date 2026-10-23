// Goetia — мир SDK, см. world.hpp.
#include "world.hpp"

#include <cmath>

namespace goetia {

static const double PAN[SMAX] = {-0.6, 0, 0.6};

void World::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  model_.reset(seed);
  sound_ = Goetia(sr_);
  for (auto& e : echo_) e.prepare(sr_, ECHO_TIME, ECHO_LP);
  c_ = 1 - std::exp(-1 / (0.05 * sr_));
  hall_ = sdk::OnePole();
  applyFx();                                            // как build у engine.js: шина и fx — до первого духа
}

void World::applyFx() {
  const double e = model_.fx(ECHO), h = model_.fx(HALL);
  for (auto& x : echo_) x.set(e * 0.8, e * 0.55);
  hallTo_ = h * h * HALL_K;
  sound_.fx(model_.fx(SPREAD), model_.fx(LEGIO));
}

void World::on(const Ev& e) {
  if (e.t == Ev::FX) { applyFx(); return; }
  const Spirit& s = *e.s;
  int prog[2 * SEAL_MAX];
  for (int q = 0; q < s.np; q++) { prog[2 * q] = NODE_OP[s.path[q]]; prog[2 * q + 1] = NODE_SH[s.path[q]]; }
  sound_.prog(s.slot, s.np, prog);                      // программа — раньше полей голоса, как в прежнем worklet
  const double lp = 1 - std::exp((-2 * M_PI * Model::fc(s)) / sr_);
  sound_.voice(s.slot, e.on, model_.rate(s), lp, s.lvl * 0.3, s.legio, PAN[s.slot], s.rel, Model::trig(s));
}

void World::action(int kind, int i, const double* a, int n) {
  const auto arg = [&](int k, double d) { return (a && k < n) ? a[k] : d; };
  int p[SEAL_MAX], np = 0;
  switch (kind) {
    case SUMMON:
      if (n < 7) break;
      for (int k = 7; k < n && np < SEAL_MAX; k++) p[np++] = static_cast<int>(a[k]);
      model_.summon(p, np, a[2], a[3], a[4], static_cast<int>(a[5]), a[6], static_cast<int>(a[0]), static_cast<int>(a[1]));
      break;
    case PATH:
      for (int k = 0; k < n && np < SEAL_MAX; k++) p[np++] = static_cast<int>(a[k]);
      model_.setPath(i, p, np);
      break;
    case BANISH: model_.banish(i); break;
    case SET: if (n >= 2) model_.set(i, static_cast<int>(a[0]), a[1]); break;
    case FX: if (n >= 1) model_.setFx(i, a[0]); break;
    case CLEAR: model_.clear(); break;
    case DICE: model_.dice(); break;
    case SETT: if (i >= 0 && i < SMAX) sound_.setT(i, arg(0, 0)); break;
    default: break;
  }
}

void World::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  if (n > 128) n = 128;
  sound_.process(out.L, out.R, n);
  echo_[0].process(out.L, eL_, n);
  echo_[1].process(out.R, eR_, n);
  for (int k = 0; k < n; k++) {
    const double g = hall_.step(hallTo_, c_) * OUT;     // посыл стоит до out мира, а прежний out ×1.6 был и за возвратом зала
    const double l = out.L[k], r = out.R[k];
    out.sL[k] = static_cast<float>(l * g); out.sR[k] = static_cast<float>(r * g);
    out.L[k] = static_cast<float>((l + eL_[k]) * OUT); out.R[k] = static_cast<float>((r + eR_[k]) * OUT);
  }
}

int World::mirror(double* buf, int cap) const {
  const int ns = model_.count(), need = MIRROR_HEAD + ns * SPIRIT_N;
  if (!buf || cap < need) return 0;
  double* p = buf;
  for (int k = 0; k < NFX; k++) *p++ = model_.fx(k);
  *p++ = ns;
  for (int i = 0; i < ns; i++) {
    const Spirit& s = model_.spirit(i);
    *p++ = s.slot; *p++ = s.born; *p++ = s.semi; *p++ = s.tone; *p++ = s.rel; *p++ = s.legio; *p++ = s.lvl; *p++ = s.np;
    for (int q = 0; q < SEAL_MAX; q++) *p++ = q < s.np ? s.path[q] : -1;
    *p++ = sound_.t0(s.slot); *p++ = sound_.gv(s.slot);
  }
  return need;
}

}  // namespace goetia

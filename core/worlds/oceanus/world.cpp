// Oceanus — мир SDK, см. world.hpp.
#include "world.hpp"

#include <cmath>

namespace oceanus {

void Oceanus::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  model_.reset(seed);
  sound_ = Ocean(sr_, seed ^ SOUND_SEED);
  c_ = 1 - std::exp(-1 / (0.05 * sr_));
  hall_ = sdk::OnePole();
  awake_ = false;
  applyFx();                                            // как build у engine.js: параметры кольца и посыл — до первого города
}

void Oceanus::applyFx() {                               // sendParams + посыл в зал (engine.js)
  const double t = model_.fx(TENSION), d = model_.fx(DAMPING), w = model_.fx(WIND), ti = model_.fx(TIDE), h = model_.fx(HALL);
  sound_.params(0.004 * std::pow(60.0, t), 0.00003 * std::pow(300.0, d), 0.0015 + 0.004 * ti, w * w, ti * 0.9,
                0.005 * std::pow(40.0, model_.luna(ORBIT)), model_.luna(STORM), model_.luna(SWAY), model_.luna(TO));
  hallTo_ = h * h * HALL_K;
}

void Oceanus::on(const Ev& e) {
  if (e.t != Ev::FX) awake_ = true;                     // город, палец, всплеск — кольцо оживает (FX сами не будят)
  switch (e.t) {
    case Ev::VOICE: sound_.voice(e.v->slot, e.on, model_.hz(*e.v), e.v->lvl * 0.8, e.v->path); break;
    case Ev::FX: applyFx(); break;
    case Ev::PUSH: sound_.push(e.id, e.a, e.d, 0.06); break;
    case Ev::RELEASE: sound_.release(e.id); break;
    case Ev::SPLASH: sound_.splash(e.a, e.d); break;
  }
}

void Oceanus::action(int kind, int i, const double* a, int n) {
  const auto arg = [&](int k, double d) { return (a && k < n) ? a[k] : d; };
  switch (kind) {
    case ADD: if (n >= 2) model_.add(a[0], a[1], arg(2, 0) != 0, static_cast<int>(arg(3, -1)), static_cast<int>(arg(4, 0))); break;
    case DROP: model_.drop(i); break;
    case MOVE: if (n >= 2) model_.move(i, a[0], a[1]); break;
    case SET: if (n >= 2) model_.set(i, static_cast<int>(a[0]), a[1]); break;
    case FX: if (n >= 1) model_.setFx(i, a[0]); break;
    case LUNA: if (n >= 1) model_.setLuna(i, a[0]); break;
    case PUSH: if (n >= 3) model_.push(a[0], a[1], a[2]); break;
    case RELEASE: if (n >= 1) model_.release(a[0]); break;
    case SPLASH: if (n >= 2) model_.splash(a[0], a[1]); break;
    case CLEAR: model_.clear(); break;
    case DICE: model_.dice(); break;
    case WAKE: awake_ = true; break;
    default: break;
  }
}

void Oceanus::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  if (!awake_) {                                        // спит: тишина, кольцо и луна стоят, посыл — сразу у цели
    for (int k = 0; k < n; k++) out.L[k] = out.R[k] = out.sL[k] = out.sR[k] = 0;
    hall_.y = hallTo_;
    return;
  }
  sound_.process(out.L, out.R, n);
  for (int k = 0; k < n; k++) {
    const double g = hall_.step(hallTo_, c_) * OUT;     // посыл после out мира: прежний out ×1.6 стоял и за возвратом зала
    const double l = out.L[k], r = out.R[k];
    out.sL[k] = static_cast<float>(l * g); out.sR[k] = static_cast<float>(r * g);
    out.L[k] = static_cast<float>(l * OUT); out.R[k] = static_cast<float>(r * OUT);
  }
}

int Oceanus::mirror(double* buf, int cap) const {
  const int nv = model_.count(), need = MIRROR_HEAD + nv * VOICE_N;
  if (!buf || cap < need) return 0;
  double* p = buf;
  for (int k = 0; k < NFX; k++) *p++ = model_.fx(k);
  for (int k = 0; k < NLUNA; k++) *p++ = model_.luna(k);
  *p++ = sound_.moon();
  const float* x = sound_.shape();
  for (int i = 0; i < N; i++) *p++ = x[i];
  *p++ = nv;
  for (int i = 0; i < nv; i++) {
    const Voice& v = model_.voice(i);
    *p++ = v.slot; *p++ = v.id; *p++ = v.ang; *p++ = v.rn; *p++ = v.pinned ? 1 : 0; *p++ = v.lvl; *p++ = v.oct; *p++ = v.path;
    *p++ = model_.hz(v); *p++ = sound_.gain(v.slot);
  }
  return need;
}

}  // namespace oceanus

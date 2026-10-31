// Inferno — мир SDK, см. world.hpp.
#include "world.hpp"

namespace inferno {

void Inferno::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  model_.reset(seed);
  sound_.prepare(sr_, seed ^ SOUND_SEED);
  applyFx();                                            // как build у engine.js: fx — до первого удара
}

void Inferno::retune(int k) {
  double r[3], hz[3];
  model_.ratios(k, r);
  const double f0 = model_.hzOf(k);
  for (int j = 0; j < 3; j++) hz[j] = f0 * r[j];
  const Circ& c = model_.circ(k);
  sound_.tune(k, hz, model_.Qof(c), c.level, c.drive);
}

void Inferno::applyFx() {
  sound_.fx(model_.fx(FIRE), model_.fx(SMOKE));
  for (int k = 0; k < NC; k++) retune(k);
}

void Inferno::on(const Ev& e) {
  switch (e.t) {
    case Ev::STRIKE: sound_.strike(e.k, e.vel); break;
    case Ev::BURN: sound_.smoulder(e.k, model_.burning(e.k), model_.circ(e.k).color); break;
    case Ev::TUNE: retune(e.k); break;
    case Ev::COLOR: sound_.recolor(e.k, model_.circ(e.k).color); break;
    case Ev::ICE: for (int k = 0; k < NC; k++) retune(k); break;
    case Ev::FX: applyFx(); break;
  }
}

void Inferno::action(int kind, int i, const double* a, int n) {
  const auto arg = [&](int k, double d) { return (a && k < n) ? a[k] : d; };
  const bool ok = i >= 0 && i < NC;
  switch (kind) {
    case ACT_STRIKE: if (ok) model_.strike(i, arg(0, 1)); break;
    case ACT_POS: if (ok) model_.setPos(i, arg(0, 0.5)); break;
    case ACT_HOLD: if (ok) model_.hold(i, static_cast<int>(arg(0, 1))); break;
    case ACT_PIN: if (ok) model_.pin(i, arg(0, 0.5)); break;
    case ACT_CIRC: if (ok && n >= 2) model_.setCirc(i, static_cast<int>(a[0]), a[1]); break;
    case ACT_FX: if (n >= 1) model_.setFx(i, a[0]); break;
    case ACT_CLEAR: model_.clear(); break;
    case ACT_DICE: model_.dice(); break;
    case sdk::ACT_LFO:                                   // LFO плашек: веер (i == -1, ключ 0…4) и строки круга (ключ 0…3, цвет не трогаем)
      if (n >= 2) {
        const int key = static_cast<int>(a[0]);
        if (i == -1 && key >= 0 && key < NFX) model_.setFx(key, a[1]);
        else if (ok && key >= 0 && key < COLOR) model_.setCirc(i, key, a[1]);
      }
      break;
    default: break;
  }
}

void Inferno::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  sound_.process(out.L, out.R, out.sL, out.sR, n);
  model_.tick(n / sr_);                                 // шаг модели — раз в блок, после звука: события — к следующему блоку
}

int Inferno::mirror(double* buf, int cap) const {
  if (!buf || cap < MIRROR_MAX) return 0;
  double* p = buf;
  *p++ = model_.time(); *p++ = model_.iceE(); *p++ = model_.stormSemi(); *p++ = model_.stormPh();
  for (int i = 0; i < NFX; i++) *p++ = model_.fx(i);
  for (int k = 0; k < NC; k++) {
    const Circ& c = model_.circ(k);
    *p++ = c.pos; *p++ = c.sinner ? 1 : 0; *p++ = c.held; *p++ = c.color; *p++ = c.width; *p++ = c.drive; *p++ = c.level; *p++ = c.lvl;
  }
  return MIRROR_MAX;
}

int Inferno::heard(double* buf, int cap) {
  if (!buf || cap < HEARD_MAX) return 0;
  const int n = sound_.drain(buf + 1, 64);
  buf[0] = n;
  return 1 + n;
}

}  // namespace inferno

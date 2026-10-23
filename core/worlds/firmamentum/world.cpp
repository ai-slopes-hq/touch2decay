// Firmamentum — мир SDK, см. world.hpp.
#include "world.hpp"
#include <cstring>

namespace firmamentum {

void Firmamentum::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  model_.reset(seed);
}

void Firmamentum::action(int kind, int i, const double* a, int n) {
  const auto arg = [&](int k, double d) { return (a && k < n) ? a[k] : d; };
  switch (kind) {
    case ADD: if (n >= 2) model_.add(a[0], a[1], static_cast<int>(arg(2, -1)), static_cast<int>(arg(3, 0))); break;
    case CLOSE: model_.close(i); break;
    case MOVE: if (n >= 2) model_.move(i, a[0], a[1]); break;
    case SET: if (n >= 2) model_.set(i, static_cast<int>(a[0]), a[1]); break;
    case FX: if (n >= 1) model_.setFx(i, a[0]); break;
    case CLEAR: model_.clear(); break;
    case DICE: model_.dice(); break;
    case LAUNCH: model_.launch(); break;
    default: break;
  }
}

void Firmamentum::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  const size_t bytes = sizeof(float) * static_cast<size_t>(n);
  std::memset(out.L, 0, bytes); std::memset(out.R, 0, bytes);   // звук — в задаче 5; пока тишина
  std::memset(out.sL, 0, bytes); std::memset(out.sR, 0, bytes);
  model_.tick(n / sr_);                                 // шаг модели — раз в блок
}

int Firmamentum::mirror(double* buf, int cap) const {
  const int ns = model_.count(), need = MIRROR_HEAD + ns * STAR_N;
  if (!buf || cap < need) return 0;
  double* p = buf;
  *p++ = model_.time();
  *p++ = model_.comets();
  const Comet* c = model_.comet();
  *p++ = c ? 1 : 0;
  *p++ = c ? c->a.h : 0; *p++ = c ? c->a.u : 0; *p++ = c ? c->b.h : 0; *p++ = c ? c->b.u : 0;
  *p++ = c ? c->t0 : 0; *p++ = c ? c->dur : 0;
  for (int k = 0; k < NFX; k++) *p++ = model_.fx(k);
  *p++ = ns;
  for (int i = 0; i < ns; i++) {
    const Star& s = model_.star(i);
    *p++ = s.slot; *p++ = s.id; *p++ = s.h; *p++ = s.u; *p++ = s.cyc; *p++ = s.win; *p++ = s.mask; *p++ = s.lvl;
    *p++ = s.dr; *p++ = s.cm; *p++ = model_.fp(s); *p++ = model_.ff(s);
  }
  return need;
}

int Firmamentum::heard(double*, int) { return 0; }      // пульсареты, треск, вспышки — со звуком (задача 5)

}  // namespace firmamentum

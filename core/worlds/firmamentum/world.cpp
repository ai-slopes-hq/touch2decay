// Firmamentum — мир SDK, см. world.hpp.
#include "world.hpp"

namespace firmamentum {

void Firmamentum::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  model_.reset(seed);
  sound_.prepare(sr_, seed ^ SOUND_SEED);
  for (double& c : counts_) c = 0;
  applyFx();                                            // как build у engine.js: fx — до первой звезды
}

void Firmamentum::applyFx() {
  sound_.fx(model_.fx(SCINTILLA), model_.fx(SPREAD), model_.fx(CREPITUS), model_.fx(FULGUR));
}

void Firmamentum::on(const Ev& e) {
  switch (e.t) {
    case Ev::STAR: {
      const Star& s = *e.s;
      sound_.voice(s.slot, e.on ? 1 : 0, model_.fp(s), model_.ff(s), s.cyc, s.win, s.mask, s.lvl * 0.55, s.u * 0.8);
      break;
    }
    case Ev::FP: sound_.fp(e.s->slot, model_.fp(*e.s)); break;
    case Ev::FF: sound_.ff(e.s->slot, model_.ff(*e.s)); break;
    case Ev::FX: applyFx(); break;
  }
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
  sound_.process(out.L, out.R, n);
  // посыл в зал: hall²·1.5, как было, и ещё ×2.5 — в прежней цепочке engine.js ×2.5 стоял после сухого и после возврата зала;
  // сухой ×2.5 остался в вебе (engine.js), а возврат ревербов общий — поэтому ×2.5 возврата переехал сюда, в посыл: баланс тот же
  const double h = model_.fx(HALL), g = h * h * 1.5 * 2.5;
  for (int k = 0; k < n; k++) { out.sL[k] = static_cast<float>(out.L[k] * g); out.sR[k] = static_cast<float>(out.R[k] * g); }
  model_.tick(n / sr_);                                 // шаг модели — раз в блок, после звука: события — к следующему блоку
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
    *p++ = s.dr; *p++ = s.cm; *p++ = model_.fp(s); *p++ = model_.ff(s); *p++ = sound_.gain(s.slot); *p++ = sound_.count(s.slot);
  }
  return need;
}

int Firmamentum::heard(double* buf, int cap) {
  if (!buf || cap < HEARD_MAX) return 0;
  double* p = buf;
  double* np = p++;
  *np = 0;
  for (int i = 0; i < model_.count(); i++) {            // звезда вспыхнет: у её голоса прибавились пульсареты (как pulsed в engine.js)
    const int slot = model_.star(i).slot;
    if (sound_.count(slot) != counts_[slot]) { *p++ = slot; (*np)++; }
  }
  for (int v = 0; v < SMAX; v++) counts_[v] = sound_.count(v);
  const int nd = sound_.ck(p + 1);
  *p = nd; p += 1 + nd * 2;
  const int nb = sound_.fl(p + 1);
  *p = nb; p += 1 + nb;
  return static_cast<int>(p - buf);
}

}  // namespace firmamentum

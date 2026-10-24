// Cymatica — мир SDK, см. world.hpp.
#include "world.hpp"

#include <cmath>

namespace cymatica {

void Cymatica::prepare(double sr, uint32_t seed) {
  plate_.prepare(sr, seed);
  send_ = sdk::OnePole();
  hall_ = 0.25;
  sendC_ = 1 - std::exp(-1 / (SEND_TAU * (sr > 0 ? sr : 48000)));
}

void Cymatica::action(int kind, int i, const double* a, int n) {
  const auto arg = [&](int k) { return (a && k < n) ? a[k] : std::nan(""); };
  switch (kind) {
    case PARAMS: plate_.params(arg(0), arg(1), arg(2)); break;
    case F0: if (n >= 1) plate_.f0(a[0]); break;
    case STRIKE: if (n >= 2) { const double rec = arg(5); plate_.strike(a[0], a[1], arg(2), arg(3), arg(4), !std::isnan(rec) && rec != 0); } break;
    case SEQ: plate_.seq(a, n); break;
    case LOCK: if (n >= 3) plate_.lock(a[0] != 0, a[1], a[2]); break;
    case BOW: if (n >= 1) plate_.bow(i, a[0] != 0, arg(1), arg(2), arg(3), arg(4), arg(5)); break;
    case FX: if (n >= 1) hall_ = a[0]; break;
    default: break;
  }
}

void Cymatica::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  plate_.process(out.L, out.R, n);
  const double target = hall_ * hall_ * SEND_K;
  for (int k = 0; k < n; k++) {
    const double g = send_.step(target, sendC_);
    out.sL[k] = static_cast<float>(out.L[k] * g);
    out.sR[k] = static_cast<float>(out.R[k] * g);
  }
}

int Cymatica::mirror(double* buf, int cap) const {
  if (!buf || cap < MIRROR_N) return 0;
  const double* e = plate_.energy();
  for (int k = 0; k < NM; k++) buf[k] = e[k];
  for (int v = 0; v < NV; v++) { buf[NM + 2 * v] = plate_.voiceHz(v); buf[NM + 2 * v + 1] = plate_.voiceLevel(v); }
  return MIRROR_N;
}

int Cymatica::heard(double* buf, int cap) {
  if (!buf || cap < HEARD_MAX) return 0;
  StepEvent ev[HEARD_CAP];
  const int n = plate_.events(ev, HEARD_CAP);
  double* p = buf;
  for (int i = 0; i < n; i++) { *p++ = 1; *p++ = ev[i].r; *p++ = ev[i].m; *p++ = ev[i].time; *p++ = ev[i].hit ? 1 : 0; }
  return static_cast<int>(p - buf);
}

}  // namespace cymatica

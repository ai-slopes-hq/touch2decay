#include "goetia.hpp"

#include <algorithm>
#include <cmath>

namespace goetia {

int32_t toInt32(double x) {
  if (x >= -2147483648.0 && x < 2147483648.0) return static_cast<int32_t>(x);
  if (!std::isfinite(x)) return 0;
  double m = std::fmod(std::trunc(x), 4294967296.0);
  if (m < 0) m += 4294967296.0;
  return static_cast<int32_t>(static_cast<uint32_t>(m));
}

static inline int32_t apply(int op, int32_t a, int32_t b) {
  const uint32_t ua = static_cast<uint32_t>(a), ub = static_cast<uint32_t>(b);
  switch (op) {
    case AND: return a & b;
    case XOR: return a ^ b;
    case ADD: return static_cast<int32_t>(ua + ub);
    case SUB: return static_cast<int32_t>(ua - ub);
    case MUL: return static_cast<int32_t>(ua * ub);     // Math.imul
    case MOD: return a % ((b & 15) + 1);
    case SHR: return a >> (b & 7);
    default: return a | b;
  }
}

Goetia::Goetia(double sampleRate) : sr_(sampleRate) {}

void Goetia::prog(int i, int n, const int* pairs) {
  Voice& o = vo_[i];
  o.np = std::max(0, std::min(PMAX, n));
  for (int q = 0; q < o.np; q++) {
    const int c = pairs[2 * q];
    o.op[q] = c >= OR && c <= SHR ? c : OR;
    o.sh[q] = pairs[2 * q + 1];
  }
}

void Goetia::voice(int i, bool on, double rate, double lp, double lvl, int legio, double pan, double rel, int trig) {
  Voice& o = vo_[i];
  o.on = on; o.rate = rate; o.lp = lp; o.lvl = lvl; o.legio = legio; o.pan = pan; o.rel = rel; o.trig = trig;
  if (on && o.g < 1e-4) {                               // новый дух — с начала; легионы чуть вразнобой
    o.rateS = o.rate;
    for (int j = 0; j < LMAX; j++) o.t[j] = j * 1777;
  }
}

void Goetia::fx(double spread, double wide) { spread_ = spread; wide_ = wide; }

void Goetia::setT(int i, double t) {
  for (int j = 0; j < LMAX; j++) vo_[i].t[j] = t + j * 1777;
}

void Goetia::process(float* L, float* R, int n) {
  const double sr = sr_;
  for (int k = 0; k < n; k++) { L[k] = 0; if (R) R[k] = 0; }
  for (Voice& o : vo_) {
    if ((!o.on && o.g < 1e-5) || !o.np) { if (!o.on) o.g = 0; continue; }
    const int nl = std::max(1, std::min(LMAX, o.legio));
    const double norm = 1 / std::sqrt(static_cast<double>(nl));
    const bool drone = o.rel >= 0.97;
    const double dec = drone ? 1 : std::exp(-1 / (0.004 * std::pow(500.0, o.rel) * sr));
    double dets[LMAX], panL[LMAX], panR[LMAX];
    for (int j = 0; j < nl; j++) {
      const double u = nl == 1 ? 0 : (static_cast<double>(j) / (nl - 1)) * 2 - 1;
      dets[j] = 1 + u * wide_ * 0.006;                  // легион: скорость ±0.6 % при legio 100 %
      const double p = std::max(-1.0, std::min(1.0, o.pan * spread_ + u * 0.6 * spread_));
      panL[j] = (1 - p) * 0.5; panR[j] = (1 + p) * 0.5;
    }
    for (int k = 0; k < n; k++) {
      o.g += ((o.on ? o.lvl : 0) - o.g) * (o.on ? 0.0015 : 0.0006);
      o.rateS += (o.rate - o.rateS) * 0.0015;
      double sl = 0, sr2 = 0;
      for (int j = 0; j < nl; j++) {
        const double tf = (o.t[j] += (o.rateS * dets[j]) / sr);
        const int32_t ti = toInt32(tf);
        int32_t acc = ti >> (o.sh[0] & 31);
        for (int q = 1; q < o.np; q++) acc = apply(o.op[q], acc, ti >> (o.sh[q] & 31));
        const double v = static_cast<double>((static_cast<uint32_t>(ti) * static_cast<uint32_t>(acc)) & 255u) / 127.5 - 1;
        const double y = (o.y[j] += (v - o.y[j]) * o.lp);
        const bool b = (ti >> (o.trig & 31)) & 1;
        if (drone) o.env[j] = 1; else { if (b && !o.lb[j]) o.env[j] = 1; else o.env[j] *= dec; }   // подъём бита — удар
        o.lb[j] = b;
        const double e = (o.envS[j] += (o.env[j] - o.envS[j]) * 0.06);   // фронт ~0.3 мс — без щелчка
        sl += y * e * panL[j]; sr2 += y * e * panR[j];
      }
      const double m = (sl + sr2) * 0.5, dcy = m - o.dx + 0.997 * o.dc;   // постоянную составляющую — вон
      o.dx = m; o.dc = dcy;
      const double off = dcy - m, gg = o.g * norm;
      o.gv = o.g * o.envS[0];
      L[k] += (sl + off) * gg; if (R) R[k] += (sr2 + off) * gg;   // сумма — во float, как Float32Array в worklet
    }
  }
  for (int k = 0; k < n; k++) { L[k] = std::tanh(L[k] * 0.8); if (R) R[k] = std::tanh(R[k] * 0.8); }
}

}  // namespace goetia

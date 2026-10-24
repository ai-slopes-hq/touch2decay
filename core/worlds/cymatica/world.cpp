// Cymatica — мир SDK, см. world.hpp.
#include "world.hpp"

#include <cmath>

namespace cymatica {

void Cymatica::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  plate_.prepare(sr, seed);
  model_.reset(seed + 1);                               // ГСЧ модели (луна random) — своё, у пластины (шанс удара, шум смычка) — зерно мира
  nAns_ = 0;
  send_ = sdk::OnePole();
  hall_ = 0.25;
  sendC_ = 1 - std::exp(-1 / (SEND_TAU * sr_));
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
    case STRIKE_AT: if (n >= 2) { Phase ph; ph.valid = plate_.phase(ph.r, ph.m, ph.steps); model_.strikeAt(a[0], a[1], ph); } break;
    case PLAY: if (n >= 1) model_.play(a[0] != 0); break;
    case REC: if (n >= 1) model_.setRec(a[0] != 0); break;
    case STEPREC: if (n >= 3) model_.setStepRec(a[0] != 0, static_cast<int>(a[1]), static_cast<int>(a[2])); else model_.stepRecToggle(); break;
    case SKIP: model_.skipStep(); break;
    case CURSOR: if (n >= 1) model_.setCursor(static_cast<int>(a[0])); break;
    case GRID: if (n >= 1) model_.setGrid(static_cast<int>(a[0])); else model_.cycleGrid(); break;
    case BPM: if (n >= 1) model_.setBpm(a[0]); break;
    case LEN: if (n >= 1) model_.setLen(i != 0 ? 1 : 0, static_cast<int>(a[0])); break;
    case CHANCE_AT: if (n >= 1) model_.setChance(i, a[0]); break;
    case BEAT: model_.toggleBeat(i); break;
    case NUDGE: if (n >= 2) model_.nudgeNote(i, static_cast<int>(a[0]), static_cast<int>(a[1])); break;
    case MOVE_MARK: if (n >= 2) model_.moveMark(i, a[0], a[1]); break;
    case DROP_MARK: model_.dropMark(i); break;
    case COMB: model_.comb(); break;
    case TURN: if (n >= 1 + SLOTS * (i == 0 ? 4 : 3)) model_.turn(i == 0 ? 0 : i == 1 ? 1 : 2, a + 1, static_cast<int>(a[0])); break;
    case DRIFT_TOGGLE: model_.toggleDrift(); break;
    case DRIFT_SET: if (n >= 1 && i >= 0 && i <= D_SHAPE) model_.setDrift(i, a[0]); break;
    case SET_F0: if (n >= 1) model_.setF0(a[0]); break;
    case STEP_SCALE: if (n >= 2) model_.stepScale(a[0], static_cast<int>(a[1])); break;
    case SET_FX: if (n >= 1) model_.setFx(i, a[0]); break;
    case LOAD_FX: if (n >= NFX) model_.loadFx(a); break;
    case DICE: if (n >= 1) model_.dice(static_cast<uint32_t>(a[0])); break;
    case CLEAR: model_.clear(); break;
    case LOAD: if (n >= 3 + SLOTS * 7) model_.load(a); break;
    default: break;
  }
}

void Cymatica::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  model_.tick(n / sr_);                                 // время модели — звуковой поток: луна и запись игрой идут и без окна
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
  const Model& m = model_;
  buf[M_F0] = m.f0();
  for (int k = 0; k < NFX; k++) buf[M_FX + k] = m.fx(k);
  buf[M_SEQ] = m.bpm(); buf[M_SEQ + 1] = m.playing() ? 1 : 0; buf[M_SEQ + 2] = m.rec() ? 1 : 0; buf[M_SEQ + 3] = m.rlen(); buf[M_SEQ + 4] = m.mlen();
  for (int i = 0; i < SLOTS; i++) {
    const RStep& s = m.rhythm(i);
    double* p = buf + M_RHY + i * 4;
    p[0] = s.on ? 1 : 0; p[1] = s.vel; p[2] = s.chance; p[3] = s.hasChance ? 1 : 0;
    const MStep& q = m.melody(i);
    double* r = buf + M_MEL + i * 3;
    r[0] = q.on ? 1 : 0; r[1] = q.x; r[2] = q.y;
  }
  buf[M_DRIFT] = m.driftOn() ? 1 : 0; buf[M_DRIFT + 1] = m.driftPar(D_DEPTH); buf[M_DRIFT + 2] = m.driftPar(D_RATE); buf[M_DRIFT + 3] = m.driftPar(D_SHAPE);
  buf[M_DRIFT + 4] = m.driftK();
  buf[M_MISC] = m.grid(); buf[M_MISC + 1] = m.lastHitX(); buf[M_MISC + 2] = m.lastHitY(); buf[M_MISC + 3] = m.cursor();
  buf[M_MISC + 4] = m.stepRec() ? 1 : 0; buf[M_MISC + 5] = m.stepRecR(); buf[M_MISC + 6] = m.stepRecM();
  return MIRROR_N;
}

int Cymatica::heard(double* buf, int cap) {
  if (!buf || cap < HEARD_MAX) return 0;
  StepEvent ev[HEARD_CAP];
  const int n = plate_.events(ev, HEARD_CAP);
  for (int i = 0; i < n; i++) if (!std::isnan(ev[i].note)) model_.answerCheck(static_cast<int>(ev[i].note));   // нота шага — резонатор отзовётся
  double* p = buf;
  for (int i = 0; i < n; i++) { *p++ = 1; *p++ = ev[i].r; *p++ = ev[i].m; *p++ = ev[i].time; *p++ = ev[i].hit ? 1 : 0; }
  for (int i = 0; i < nAns_; i++) { *p++ = 2; *p++ = ans_[i]; *p++ = 0; *p++ = 0; *p++ = 0; }
  nAns_ = 0;
  return static_cast<int>(p - buf);
}

}  // namespace cymatica

// Cymatica — мир SDK, см. world.hpp.
#include "world.hpp"

#include <cmath>

namespace cymatica {

void Cymatica::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  plate_.prepare(sr, seed);
  model_.reset(seed + 1);                               // ГСЧ модели (луна random) — своё, у пластины (шанс удара, шум смычка) — зерно мира
  nAns_ = 0;
  humOn_ = true;
  time_ = 0; echoAt_ = -1e9; humAt_ = -1e9; pairSerial_ = 0;
  gateC_ = 1 - std::exp(-1 / (0.01 * sr_));
  echoSend_ = sdk::OnePole();
  for (Pair& p : pairs_) { p.used = p.live = false; }
  for (Hum& h : hum_) h.env = sdk::AD();
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
    case BOW_ADD: if (n >= 2) model_.addBow(a[0], a[1]); break;
    case BOW_SET: if (n >= 5) model_.setBow(i, a[0], a[1], a[2], a[3], a[4]); break;
    case BOW_DROP: model_.dropBow(i); break;
    case HUM: humOn_ = n < 1 || a[0] != 0; break;
    default: break;
  }
}

// ---------- эхо: на каждую долю — своя пара линий; сменил долю или темп — звук идёт в новую пару с точным временем, старая не принимает ----------
// и дозванивает своим (время не едет — нет скрежета); живёт до 6 с, не больше 4 живых пар; смена доли не чаще 11 раз в секунду
double Cymatica::echoSec() const {
  static const double DIV[9] = {1.0 / 6, 1.0 / 4, 1.0 / 3, 3.0 / 8, 1.0 / 2, 2.0 / 3, 3.0 / 4, 1, 3.0 / 2};   // ECHO_DIVS в core.js
  const int i = static_cast<int>(sdk::jsRound(model_.fx(TIME) * 8));
  return DIV[i < 0 ? 0 : i > 8 ? 8 : i] * 60 / model_.bpm();
}
Cymatica::Pair* Cymatica::curPair() {
  Pair* c = nullptr;
  for (Pair& p : pairs_) if (p.used && p.live && (!c || p.serial > c->serial)) c = &p;
  return c;
}
void Cymatica::dropPair(Pair& p, double fade) {
  if (!p.live) return;
  p.live = false;
  p.gateTo = 0; p.outTo = 0; p.outC = 1 - std::exp(-1 / (fade * sr_));
  p.dieAt = time_ + fade * 6;
}
void Cymatica::retime() {
  const double sec = echoSec();
  Pair* cur = curPair();
  if (cur && std::fabs(cur->sec - sec) < 1e-4) return;
  if (cur && time_ - echoAt_ < 0.09) return;
  echoAt_ = time_;
  if (cur) { cur->gateTo = 0; cur->retireAt = time_ + 6; }
  for (;;) {
    int live = 0;
    Pair* oldest = nullptr;
    for (Pair& p : pairs_) if (p.used && p.live) { live++; if (!oldest || p.serial < oldest->serial) oldest = &p; }
    if (live < ECHO_LIVE) break;
    dropPair(*oldest, 0.02);
  }
  Pair* slot = nullptr;
  for (Pair& p : pairs_) if (!p.used) { slot = &p; break; }
  if (!slot) for (Pair& p : pairs_) if (!p.live && (!slot || p.dieAt < slot->dieAt)) slot = &p;   // пул занят затухающими — вытесняем ближайшую к концу
  if (!slot) return;
  slot->pp.prepare(sr_, sec, 3000, 1, echoFb());
  slot->gate = sdk::OnePole(); slot->gateTo = 1;
  slot->out.y = 1; slot->outTo = 1; slot->outC = 0;
  slot->sec = sec; slot->retireAt = -1; slot->dieAt = -1; slot->serial = ++pairSerial_;
  slot->used = slot->live = true;
}

// ---------- гул резонатора: две синусоиды (f/2 и f, detune 4 цента) под AD 0.15 с вверх, до 1.6 с вниз; не чаще раза в 0.25 с ----------
void Cymatica::answer(int semi) {
  if (nAns_ < ANSWER_CAP) ans_[nAns_++] = semi;           // подпись ноты и вспышка — у картинки
  if (!humOn_ || time_ - humAt_ < 0.25) return;
  Hum* h = nullptr;
  for (Hum& v : hum_) if (!v.env.active()) { h = &v; break; }
  if (!h) return;
  humAt_ = time_;
  const double hz = F_MIN * std::pow(2.0, sdk::jsRound(model_.fs()) / 12);
  h->f1 = hz / 2; h->f2 = hz * std::pow(2.0, 4.0 / 1200);
  h->a.reset(); h->b.reset();
  h->env.start(sr_, 0.05, 0.15, 1.45, 0.0001, 0.02);
}

bool Cymatica::sounding() const {
  if (plate_.sounding()) return true;
  for (const Hum& h : hum_) if (h.env.active()) return true;
  return false;
}

void Cymatica::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  model_.tick(n / sr_);                                 // время модели — звуковой поток: луна и запись игрой идут и без окна
  plate_.process(out.L, out.R, n);
  retime();
  for (Pair& p : pairs_) {
    if (!p.used) continue;
    if (p.live && p.retireAt >= 0 && time_ >= p.retireAt) dropPair(p, 0.3);
    if (!p.live && time_ >= p.dieAt) p.used = false;
  }
  if (Pair* c = curPair()) c->pp.setFb(echoFb());
  const double target = hall_ * hall_ * SEND_K, echoTo = model_.fx(ECHO) * 0.8;
  for (int k = 0; k < n; k++) {
    const double g = send_.step(target, sendC_);
    const double pl = out.L[k], pr = out.R[k];
    double h = 0;
    for (Hum& v : hum_) if (v.env.active()) h += (v.a.sine(v.f1 / sr_) + v.b.sine(v.f2 / sr_)) * v.env.step();
    out.sL[k] = static_cast<float>(pl * g + h * g / 2.5);   // гул — в зал с прежним hall²·1.4 (сухой идёт ×2.5 в канале, посыл гула — без)
    out.sR[k] = static_cast<float>(pr * g + h * g / 2.5);
    const double in = 0.5 * (pl + pr) * echoSend_.step(echoTo, sendC_);   // сухой — ChannelMerger у Web Audio сводил стерео в моно
    double el = 0, er = 0;
    for (Pair& p : pairs_) {
      if (!p.used) continue;
      const double gt = p.gate.step(p.gateTo, gateC_), og = p.out.step(p.outTo, p.live ? gateC_ : p.outC);
      double yl, yr;
      p.pp.step(in * gt, yl, yr);
      el += yl * og; er += yr * og;
    }
    out.L[k] = static_cast<float>(pl + el + h);
    out.R[k] = static_cast<float>(pr + er + h);
  }
  time_ += n / sr_;
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
  int ne = 0;
  double secs[ECHO_LIVE] = {};
  long ser[ECHO_LIVE] = {};
  for (const Pair& p : pairs_) {                      // живые пары — по рождению
    if (!p.used || !p.live || ne >= ECHO_LIVE) continue;
    int at = ne++;
    while (at > 0 && ser[at - 1] > p.serial) { secs[at] = secs[at - 1]; ser[at] = ser[at - 1]; at--; }
    secs[at] = p.pp.sec(); ser[at] = p.serial;
  }
  buf[M_ECHO] = ne;
  for (int k = 0; k < ECHO_LIVE; k++) buf[M_ECHO + 1 + k] = k < ne ? secs[k] : 0;
  buf[M_ECHO + 1 + ECHO_LIVE] = ECHO_MAXD / sr_;
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

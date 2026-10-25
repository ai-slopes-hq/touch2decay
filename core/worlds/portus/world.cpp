// Portus — мир SDK, см. world.hpp.
#include "world.hpp"

#include <algorithm>
#include <cmath>

namespace portus {

static const int IV[5][MAXIV] = {{0, 7, 12, 19, 0, 0}, {0, 5, 10, 14, 0, 0}, {0, 7, 10, 15, 0, 0}, {0, 7, 10, 14, 15, 0}, {0, 7, 10, 14, 15, 17}};
static const int NIV[5] = {4, 4, 4, 5, 6};
// sawtooth браузера нормирован на пик ≈ 1 (PeriodicWave): на низких нотах его RMS на 1.43 дБ ниже идеальной пилы ±1, на высоких — ещё ниже (мало гармоник);
// наш Saw — идеальный band-limited, и громкость, подобранная автором на слух, держим этим множителем (замер в Chromium: tools/portus-bus.py)
constexpr double SAWK = 0.848;
constexpr double OUTK = 1.6, DRYK = 0.85, WET = 0.9, REVK = 1.6 / 0.9;   // out(1.6) · ×0.85 · wet 0.9; посыл 1.6/0.9 — у ядра возврат ×0.9

static double clampd(double x, double a, double b) { return x < a ? a : x > b ? b : x; }

void World::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  rng_ = sdk::Rng(seed ^ 0x5047u);                       // шанс удара и шум моря — от зерна мира
  steps_.reset(); npend_ = 0; nHeard_ = 0; cur_ = -1; now_ = 0;
  playing_ = false; got_ = false; killed_ = false; killUntil_ = -1; driveK_ = -1; seaOn_ = false;
  for (auto& v : voices_) v.on = false;
  for (auto& s : slots_) s = Slot();
  for (int i = 0; i < S_HEAD; i++) st_[i] = 0;
  st_[S_BPM] = 120; st_[S_CHANCE] = 1; st_[S_CHORD] = 2; st_[S_LVL] = 0.8; st_[S_LEN] = 0.25; st_[S_FC] = 2000; st_[S_DT] = 3; st_[S_TONE] = 0.45; st_[S_FB] = 0.4;
  st_[S_FOG] = 0.45; st_[S_SIZE] = 0.7; st_[S_DRIVE] = 0.25; st_[S_WOW] = 0.25; st_[S_SPREAD] = 0.6; st_[S_ENV] = 0.45; st_[S_RES] = 0.35; st_[S_MIX] = 0.6;
  sat_.build([](double x) { return std::tanh(1.4 * x) / std::tanh(1.4); });
  bp_ = sdk::Biquad(); lpSea_ = sdk::Biquad();
  bp_.set(sdk::Biquad::bandpass, 380, 0.5, sr_);
  lpSea_.set(sdk::Biquad::lowpass, 1600, 0.7, sr_);
  wow_.reset(); swell_.reset();
  rev_ = wantRev_ = sdk::Rev::hall;
  applyState();
  got_ = false;                                          // первый настоящий STATE (из веба) ставит всё сразу заново
}

// первый STATE после prepare ставит всё сразу (эхо и шина не «разгоняются» из нуля); дальше — плавно, как setTargetAtTime прежнего applyAll
void World::applyState() {
  const bool first = !got_;
  bpm_ = clampd(st_[S_BPM], 20, 400); swing_ = st_[S_SWING];
  const double drive = st_[S_DRIVE], k = 1 + 5 * drive;
  if (std::fabs(k - driveK_) > 1e-9) { driveK_ = k; drive_.build([k](double x) { return std::tanh(k * x) / std::tanh(k); }); }
  gPost_.set(1 / (1 + drive * 0.8), 0.05, sr_);
  gTime_.set(st_[S_DT] * stepSec(), 0.08, sr_);          // время меняется скольжением — как лента
  gLpL_.set(700 * std::pow(2.0, 3.2 * (1 - st_[S_TONE])), 0.05, sr_);
  gLpR_.set(600 * std::pow(2.0, 3.2 * (1 - st_[S_TONE])), 0.05, sr_);
  gWow_.set(0.0035 * st_[S_WOW] * st_[S_WOW] + 0.0002, 0.05, sr_);
  gRSend_.set(st_[S_FOG] * st_[S_FOG] * 1.6, 0.05, sr_);
  gMare_.set(st_[S_MARE] * st_[S_MARE] * 0.09, 0.05, sr_);
  seaOn_ = st_[S_MARE] > 0.01;
  const double sz = st_[S_SIZE];
  wantRev_ = sz < 0.33 ? sdk::Rev::room : sz < 0.66 ? sdk::Rev::hall : sdk::Rev::cathedral;
  if (!killed_) {                                        // пока звезда гасит эхо, посыл и обратную связь не трогаем
    gSend_.set(st_[S_MIX] * 0.75, 0.05, sr_);
    gWet_.set(WET, 0.05, sr_);
    echo_.setFb(clampd(st_[S_FB], 0, 0.985));
  }
  if (first) {
    echo_.prepare(sr_, gTime_.to, gLpL_.to, 0.7, clampd(st_[S_FB], 0, 0.985));
    echo_.setHp(240, 0.7); echo_.setSat(&sat_); echo_.setLp(gLpL_.to, gLpR_.to, 0.7);
    for (Glide* g : {&gPost_, &gSend_, &gWet_, &gTime_, &gWow_, &gRSend_, &gMare_, &gLpL_, &gLpR_}) g->jump(g->to);
    rev_ = wantRev_;
    gRev_.jump(REVK);
    got_ = true;
  }
}

double World::gapFrom(int j) const {                     // до следующего звучащего места по кругу; пусто — круг целиком
  for (int k = 1; k <= NSTEP; k++) if (slots_[(j + k) % NSTEP].on) return k * stepSec();
  return NSTEP * stepSec();
}

void World::action(int kind, int, const double* a, int n) {
  const auto arg = [&](int k, double d) { return (a && k < n) ? a[k] : d; };
  switch (kind) {
    case STATE: {
      if (n < STATE_N) break;
      for (int i = 0; i < S_HEAD; i++) st_[i] = a[i];
      for (int j = 0; j < NSTEP; j++) {
        const double* s = a + S_HEAD + 4 * j;
        slots_[j].on = s[0] != 0; slots_[j].hz = s[1]; slots_[j].p = s[2]; slots_[j].lvl = s[3];
      }
      applyState();
      break;
    }
    case PLAY:
      playing_ = arg(0, 0) != 0;
      steps_.reset();                                    // часы — с начала (по сетке — к нынешней доле)
      if (!playing_) cur_ = -1;
      break;
    case KILL:                                           // эхо гаснет за ~20 мс, через 350 мс — снова слушает
      killed_ = true; killUntil_ = (clk_ ? clk_->now : now_) + 0.35;
      echo_.setFb(0, 0.02);
      gWet_.set(0, 0.02, sr_); gSend_.set(0, 0.02, sr_);
      break;
    case AUDITION:                                       // часы стоят — услышать аккорд, пока ставишь (JS решает, звучать ли)
      stab((clk_ ? clk_->now : now_) + 0.02, arg(0, 110), arg(1, 0), arg(2, 1), 1, 0.6, static_cast<int>(arg(3, -1)));
      break;
    default: break;
  }
}

void World::voiceCoefs(Voice& v, double tr) {            // срез идёт от пика к fc: setValueAtTime(peak, t) → setTargetAtTime(fc, t + A, 0.04 + 0.3τ)
  const double f = tr < v.A ? v.peak : v.fc + (v.peak - v.fc) * std::exp(-(tr - v.A) / v.tauF);
  v.lp1.set(sdk::Biquad::lowpass, f, v.q, sr_);
  v.lp2.set(sdk::Biquad::lowpass, f, 0.6, sr_);
}

void World::stab(double t, double hz, double p, double lvl, double vel, double gap, int step) {
  Voice* v = nullptr;
  for (auto& x : voices_) if (!x.on) { v = &x; break; }
  if (!v) { v = &voices_[0]; for (auto& x : voices_) if (x.n > v->n) v = &x; }   // все заняты — самый старый уступает
  const int ch = static_cast<int>(clampd(st_[S_CHORD], 0, 4)), ni = NIV[ch];
  v->on = true; v->started = false; v->ts = t; v->step = step; v->n = 0;
  v->nosc = 2 * ni;
  for (int k = 0; k < ni; k++)
    for (int s = 0; s < 2; s++) {
      const int o = 2 * k + s;
      const double cents = (s ? 1 : -1) * (5 + 3 * (k % 2));
      v->dt[o] = hz * std::pow(2.0, IV[ch][k] / 12.0) * std::pow(2.0, cents / 1200.0) / sr_;
      v->saw[o].reset(0);
    }
  const double len = st_[S_LEN];
  v->tau = 0.035 + len * len * 1.8; v->A = 0.004; v->tauF = 0.04 + v->tau * 0.3;
  v->fc = st_[S_FC]; v->peak = std::min(16000.0, v->fc * std::pow(2.0, st_[S_ENV] * 4.2 * vel));
  v->q = 0.7 + 13 * st_[S_RES] * st_[S_RES];
  v->amp = 0.16 * st_[S_LVL] * lvl * (0.75 + 0.25 * vel) / std::sqrt(static_cast<double>(ni));
  const double span = std::min(v->tau * 5, gap + 0.06), end = v->A + span;   // не дольше, чем до следующего удара: голоса не копятся
  v->e0 = (gap + 0.06 < v->tau * 5) ? end - 0.05 : -1;
  v->life = end + 0.03;
  sdk::panEq((p / PSPAN - 0.5) * 0.5 * st_[S_SPREAD], v->pl, v->pr);
  v->lp1 = sdk::Biquad(); v->lp2 = sdk::Biquad();
  voiceCoefs(*v, 0);
  if (step >= 0) {
    if (npend_ == 16) { for (int j = 1; j < 16; j++) pend_[j - 1] = pend_[j]; npend_--; }
    pend_[npend_++] = Pend{t, step};
  }
}

void World::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  if (n > 128) n = 128;
  const double now = clk_ ? clk_->now : now_, end = now + n / sr_;
  now_ = end;
  if (killed_ && now >= killUntil_) { killed_ = false; gWet_.set(WET, 0.05, sr_); applyState(); }
  if (playing_) {
    static const sdk::Grid none;
    steps_.run(now, end, clk_ ? clk_->grid : none, 4,
               [&](long k) { return stepSec() + swingAt(k + 1) - swingAt(k); },    // свой темп: сдвиг нечётных — в длине шага
               [&](long k) { return swingAt(k); },                                 // по сетке MIDI-часов — сдвиг от сетки
               [&](long k, double t) {
                 const int j = static_cast<int>(k % NSTEP);
                 cur_ = j;
                 if (!slots_[j].on || !(rng_.next() < st_[S_CHANCE])) return;      // chance — от зерна
                 stab(t, slots_[j].hz, slots_[j].p, slots_[j].lvl, j % 4 == 2 ? 1 : 0.85, gapFrom(j), j);
               });
  }
  if (npend_) {                                          // удары, чьё время пришло в этом блоке, — «услышаны» (вспышка кораблика, луч маяка, круги эха)
    int w = 0;
    for (int j = 0; j < npend_; j++) {
      if (pend_[j].t < end) { if (nHeard_ < 32) heardSteps_[nHeard_++] = pend_[j].step; } else pend_[w++] = pend_[j];
    }
    npend_ = w;
  }
  if (wantRev_ != rev_) {                                // смена зала: посыл гаснет, потом растёт уже в новом (≈50 мс + 50 мс)
    gRev_.set(0, 0.017, sr_);
    if (gRev_.y < 0.02) { rev_ = wantRev_; gRev_.set(REVK, 0.017, sr_); }
  } else gRev_.set(REVK, 0.017, sr_);
  for (auto& v : voices_) if (v.on && v.started) voiceCoefs(v, v.n / sr_);              // срез — раз в блок (k-rate, как у BiquadFilterNode)
  echo_.setSec(gTime_.y);
  echo_.setLp(gLpL_.y, gLpR_.y, 0.7);
  for (int k = 0; k < n; k++) {
    const double tk = now + k / sr_;
    double sl = 0, sr = 0;
    for (auto& v : voices_) {
      if (!v.on) continue;
      if (!v.started) {
        if (tk + 0.5 / sr_ < v.ts) continue;
        v.started = true; v.n = 0; voiceCoefs(v, 0);
      }
      const double t = v.n / sr_;
      double s = 0;
      for (int o = 0; o < v.nosc; o++) s += v.saw[o].step(v.dt[o]);
      s *= SAWK;
      s = v.lp2.step(v.lp1.step(s));
      double env;
      if (t < v.A) env = v.amp * t / v.A;
      else if (v.e0 < 0 || t < v.e0) env = v.amp * std::exp(-(t - v.A) / v.tau);
      else env = v.amp * std::exp(-(v.e0 - v.A) / v.tau) * std::exp(-(t - v.e0) / 0.012);   // setTargetAtTime(0, e0, 0.012) — от того, что было
      s *= env;
      sl += s * v.pl; sr += s * v.pr;
      if (++v.n > v.life * sr_) v.on = false;
    }
    const double post = gPost_.step();
    const double pl = drive_.step(sl) * post, pr = drive_.step(sr) * post;
    gTime_.step(); gLpL_.step(); gLpR_.step();
    const double wowAmp = gWow_.step();
    double eL, eR;
    echo_.step((pl + pr) * 0.5 * gSend_.step(), eL, eR, wowAmp * wow_.sine(0.55 / sr_));
    const double wet = gWet_.step(), wl = eL * wet, wr = eR * wet;
    double sea = 0;
    const double mg = gMare_.step();
    if (seaOn_ || mg > 1e-7) {                           // море: шум в полосе, накатывает волнами (0.09 Гц); подключено, только пока mare > 0
      const double nz = rng_.next() * 2 - 1;
      sea = lpSea_.step(bp_.step(nz)) * (0.55 + 0.45 * swell_.sine(0.09 / sr_)) * mg;
    }
    out.L[k] = static_cast<float>((DRYK * pl + wl + sea) * OUTK);
    out.R[k] = static_cast<float>((DRYK * pr + wr + sea) * OUTK);
    const double g = gRSend_.step() * gRev_.step();      // туман слышит и аккорды, и эхо
    out.sL[k] = static_cast<float>((pl + wl) * g);
    out.sR[k] = static_cast<float>((pr + wr) * g);
  }
}

int World::mirror(double* buf, int cap) const {
  if (!buf || cap < MIRROR_N) return 0;
  int live = 0;
  for (const auto& v : voices_) live += v.on ? 1 : 0;
  buf[0] = playing_ ? cur_ : -1; buf[1] = playing_ ? 1 : 0; buf[2] = live;
  return MIRROR_N;
}

int World::heard(double* buf, int cap) {
  if (!nHeard_ || !buf) return 0;
  int w = 0;
  for (int i = 0; i < nHeard_ && w + 2 <= cap; i++) { buf[w++] = 1; buf[w++] = heardSteps_[i]; }
  nHeard_ = 0;
  return w;
}

bool World::sounding() const {
  if (playing_) for (const auto& s : slots_) if (s.on) return true;
  for (const auto& v : voices_) if (v.on) return true;
  return false;
}

}  // namespace portus

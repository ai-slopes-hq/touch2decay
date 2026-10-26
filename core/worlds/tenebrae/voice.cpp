#include "voice.hpp"
#include "tone.hpp"
#include <algorithm>
#include <cmath>

namespace tenebrae {

namespace {
constexpr double G = 0.14;                              // τ высоты (как G в apply)
constexpr double FB_BASE = 0.3, RES_MAX = 24, FM_MAX = 1.4;

// петля comb: soft(1.6, false) — tanh(1.6x)/1.6, кривая 4096 точек без oversample (одна на все голоса)
const sdk::Shaper<4096>& loopSat() {
  static const sdk::Shaper<4096> s = [] {
    sdk::Shaper<4096> q;
    q.build([](double x) { return std::tanh(1.6 * x) / 1.6; });
    return q;
  }();
  return s;
}

// lowpass как BiquadFilterNode: на Найквисте и выше — насквозь, на нуле и ниже — тишина
void lpSet(sdk::Biquad& q, double f, double qdb, double sr) {
  if (f >= sr * 0.5) { q.b0 = 1; q.b1 = q.b2 = q.a1 = q.a2 = 0; return; }
  if (f <= 0) { q.b0 = q.b1 = q.b2 = q.a1 = q.a2 = 0; return; }
  q.set(sdk::Biquad::lowpass, f, qdb, sr);
}
void coefs(sdk::Biquad& dst, const sdk::Biquad& src) { dst.b0 = src.b0; dst.b1 = src.b1; dst.b2 = src.b2; dst.a1 = src.a1; dst.a2 = src.a2; }
}  // namespace

void Voice::prepare(double sr, uint32_t seed, const Tables* t, int index) {
  sr_ = sr; T_ = t; k_ = 1 + index * 0.137;             // у каждого кружка свои скорости дыхания
  now_ = 0; blk_ = 0; live_ = false; has_ = false;
  // значения узлов при создании (voiceNodes): частоты c1/c2 — 0, sub и m — 440 (OscillatorNode), позиция морфа — 0.125
  static const double INIT[NP] = {0, 0, 440, 440, 2 * 0.125 - 1, 0, 0, 1, 0.5, 1, 800, 5, 0, 400, 6, 0, 0.45, 0, 0, 0, 1, 0.55, 0};
  for (int i = 0; i < NP; i++) { p_[i].init(INIT[i]); for (double& v : b_[i]) v = INIT[i]; }
  for (Lfo& l : lfo_) { l.on = false; l.die = 0; l.v = 0; }
  f_ = 0; amp_ = 0; alive_ = 1; rm_ = 0; shHz_ = 0; shOn_ = false; shTail_ = 0;
  c1_.ph = c2_.ph = 0; sub_.reset(); m_.reset();
  for (sdk::Osc& o : dr_) o.reset();
  drift1_ = drift2_ = lpDrift_ = 0; breath_ = 1; mRaw_ = mOut_ = env_ = 0;
  mix_.voice(*t, 0.125);
  rj_ = sdk::Rng(seed ^ (0x9E3779B9u * (index + 1u)));
  jit1_ = jit2_ = bp_ = hp_ = sdk::Biquad{};
  jit1_.set(sdk::Biquad::lowpass, 23 * k_, -3, sr);     // джиттер: шум до десятков герц, ±140 ц
  jit2_.set(sdk::Biquad::lowpass, 31 * k_, -3, sr);
  bp_.set(sdk::Biquad::bandpass, 400, 6, sr);
  hp_.set(sdk::Biquad::highpass, 3000, 1, sr);          // Q по умолчанию у BiquadFilterNode — 1 (у highpass — дБ)
  sdk::panEq(-0.5, g1L_, g1R_);
  sdk::panEq(0.5, g2L_, g2R_);
  sat_.set(3); sat_.os = 2; sat_.reset();               // soft(3, true), oversample '2x'
  for (int c = 0; c < 2; c++) {
    sh_[c].reset();
    lp_[c] = loop_[c] = sdk::Biquad{};
    lp_[c].set(sdk::Biquad::lowpass, 800, 5, sr);
    loop_[c].set(sdk::Biquad::lowpass, 3000, -3, sr);
    dl_[c] = sdk::Delay(dbuf_[c], DMAX);
  }
  dSamp_ = 128; dSec_ = 0;
  pan_.set(0);
  for (float& v : ring_) v = 0;
  ringW_ = 0;
  loopSat();
}

void Voice::to(P& q, double v, double tau) {
  q.tgt = v;
  if (live_) q.p.target(v, now_, tau * sr_);
}

// apply(): значения голоса с их τ; на snap все τ — 0.004
void Voice::set(const double* a, double f, double fmOpen) {
  const double x = a[0], y = a[1], cut = a[2], res = a[3], wave = a[4], beat = a[5], fm = a[6], shift = a[7], amp = a[8], h = a[9];
  const bool s = a[10] != 0;
  const auto T = [&](int i, double v, double tau) { to(p_[i], v, s ? 0.004 : tau); };
  has_ = true; f_ = f; amp_ = amp;
  T(F1, f, G);
  T(F2, f + beatHz(beat), G);
  T(SUB, f / 2, G);
  T(MF, f, G);
  T(POS, 2 * wave - 1, 0.04);
  shHz_ = shiftHz(shift);
  shiftAim(s ? 0.004 : 0.06, s ? 0.004 : 0.02);
  // ось Y: внизу чистые колебания, вверху перегруз и шум, вытесняющий тон; в чёрной дыре (h) — широкий шум, глубже, темнее
  T(DRIVE, 0.22 + 3.6 * y * y, 0.1);
  T(TONE, (1 - 0.65 * std::pow(y, 1.5)) * (1 - h), 0.15);
  T(LPF, cutoffOf(cut, y, fmOpen), 0.1);
  T(LPQ, res * RES_MAX, 0.1);
  T(NZ, 0.95 * std::pow(y, 1.8) * (1 - h) + 0.9 * h, 0.15);
  T(BPF, std::pow(std::min(f * 3 * std::pow(2.0, y * 2), 9000.0), 1 - h) * std::pow(600.0, h), 0.15);
  T(BPQ, (9 - 6 * y) * (1 - h) + 0.5 * h, 0.15);
  T(HISS, 0.25 * y * y * y * (1 - h), 0.15);
  T(COMB, 0.45 * (1 - h), 0.15);
  double d = f > 0 ? 1 / f : 1;
  while (d < 0.006) d *= 2;
  T(DL, d, G);
  T(PAN, (x - 0.5) * 0.6, 0.2);
  T(SFM, f * FM_MAX * fm, 0.08);
  T(VCA, std::max(0.0, 1 - rm_), 0.08);
  alive_ = 1 - clamp01((h - 0.5) / 0.45);               // в глубине дыры звук умирает
  T(LVL, 0.55 * amp * alive_, 0.15);
  for (int key = 0; key < LFO_N; key++) if (lfo_[key].on) lfoAim(key);
}

// сдвиг включён, когда shiftHz ≠ 0 или есть LFO shift; выключенный считается ещё 150 мс (пока dry/wet доезжает), потом стоит
void Voice::shiftAim(double tauHz, double tauMix) {
  const bool on = shHz_ != 0 || lfo_[L_SHIFT].on;
  if (on != shOn_) { shOn_ = on; shTail_ = on ? 0 : static_cast<int>(std::lround(0.15 * sr_)); }
  to(p_[SHZ], shHz_, tauHz);
  to(p_[WET], on ? 1 : 0, tauMix);
  to(p_[DRY], on ? 0 : 1, tauMix);
}

void Voice::on() { to(p_[ENV], 1, 0.12); }
void Voice::off(double tau) { to(p_[ENV], 0, tau); }

void Voice::live(bool on) {
  if (on == live_) return;
  live_ = on;
  if (!on) return;
  // время в вебе шло — setTargetAtTime дошли до целей; снятые LFO и выключенный сдвиг уже отцеплены
  for (P& q : p_) q.land();
  for (Lfo& l : lfo_) { l.pos.land(); l.hz.land(); l.out.land(); if (!l.on) { l.die = 0; l.v = 0; } }
  if (!shOn_) shTail_ = 0;
}

double Voice::lfoDepth(int key, double d) const {         // глубина в единицах своей цели
  switch (key) {
    case L_PITCH: return d * 700;                       // ц: c1, c2, саб
    case L_WAVE: return d * 2;                          // позиция морфа (−1…1)
    case L_CUT: return d * 4800;                        // ц: lp
    case L_RES: return d * 20;                          // lp.Q, дБ
    case L_BEAT: return d * 16;                         // Гц: c2
    case L_SHIFT: return d * 300;                       // Гц: сдвиг
    case L_AMP: return d * 0.55 * amp_ * alive_;        // lvl
    default: return d * f_ * FM_MAX;                    // self-FM, Гц на единицу m
  }
}

void Voice::lfoAim(int key) {
  Lfo& l = lfo_[key];
  to(l.hz, l.rate, 0.05);
  to(l.pos, 2 * l.morph - 1, 0.05);
  to(l.out, lfoDepth(key, l.depth), 0.05);
}

void Voice::lfo(int key, double morph, double rate, double depth) {
  if (key < 0 || key >= LFO_N) return;
  Lfo& l = lfo_[key];
  if (depth == 0) {                                     // снять: глубина к нулю за 0.05, отцепить через 400 мс
    if (!l.on) return;
    l.on = false;
    to(l.out, 0, 0.05);
    l.die = static_cast<int>(std::lround(0.4 * sr_));
    if (has_ && key == L_SHIFT) shiftAim(0.06, 0.02);
    return;
  }
  if (l.on && l.morph == morph && l.rate == rate && l.depth == depth) return;
  if (!l.on && l.die == 0) {                            // новый генератор: фаза 0, частота от 0, глубина от 0
    l.mo.ph = 0;
    l.pos.init(2 * morph - 1); l.hz.init(0); l.out.init(0);
    for (int k = 0; k < BLOCK; k++) { l.b[0][k] = 2 * morph - 1; l.b[1][k] = 0; l.b[2][k] = 0; }
    l.mix.lfo(morph);
    l.v = 0;
  }
  l.on = true; l.die = 0;
  l.morph = morph; l.rate = rate; l.depth = depth;
  if (!has_) return;                                    // как в вебе: до первого voice() apply не идёт
  if (key == L_SHIFT) shiftAim(0.06, 0.02);
  lfoAim(key);
}

// раз в 16 сэмплов: значения Param на блок, коэффициенты фильтров, задержка comb, панорама, веса морфа, медленный дрейф
void Voice::block() {
  for (int i = 0; i < NP; i++) p_[i].p.fill(b_[i], BLOCK, now_);
  for (Lfo& l : lfo_) {
    if (!l.on && l.die <= 0) continue;
    l.pos.p.fill(l.b[0], BLOCK, now_); l.hz.p.fill(l.b[1], BLOCK, now_); l.out.p.fill(l.b[2], BLOCK, now_);
    l.mix.lfo((l.b[0][0] + 1) * 0.5);
  }
  const double dt = BLOCK / sr_, k = k_;
  drift1_ = 5 * dr_[0].sine(0.071 * k * dt) + 2.5 * dr_[1].sine(0.19 * k * dt);
  drift2_ = 6 * dr_[2].sine(0.053 * k * dt) + 2 * dr_[3].sine(0.23 * k * dt);
  lpDrift_ = 280 * dr_[4].sine(0.043 * k * dt);
  breath_ = 1 + 0.13 * dr_[5].sine(0.09 * k * dt);
  mix_.voice(*T_, (b_[POS][0] + lfo_[L_WAVE].v + 1) * 0.5);
  lpSet(lp_[0], b_[LPF][0] * std::exp2((lpDrift_ + lfo_[L_CUT].v) / 1200), b_[LPQ][0] + lfo_[L_RES].v, sr_);
  coefs(lp_[1], lp_[0]);
  bp_.set(sdk::Biquad::bandpass, b_[BPF][0], b_[BPQ][0], sr_);
  dSec_ = std::min(b_[DL][0], 1.0);                     // DelayNode(1): не больше секунды
  dSamp_ = std::min(std::max(dSec_ * sr_, 128.0), DMAX - 2.0);   // в петле Web Audio — не меньше кванта (128)
  pan_.set(b_[PAN][0]);
}

void Voice::prestep() {
  if (!live_) return;
  if (blk_ == 0) block();
  env_ = b_[ENV][blk_];
  mRaw_ = m_.sine(b_[MF][blk_] / sr_);
  mOut_ = mRaw_ * env_;
}

void Voice::step(const ModIn& in, double& L, double& R) {
  if (!live_) { L = R = 0; return; }
  double s[2];
  pre(in, s);
  sat_.step(s[0], s[1]);
  post(s, L, R);
}

void Voice::pre(const ModIn& in, double* s) {
  const int k = blk_;
  for (Lfo& l : lfo_) {
    if (!l.on && l.die <= 0) { l.v = 0; continue; }
    l.v = l.mo.lfoRun(*T_, l.mix, l.b[1][k], sr_) * l.b[2][k];
    if (!l.on && --l.die <= 0) l.v = 0;
  }
  if (in.rmSum != rm_) { rm_ = in.rmSum; to(p_[VCA], std::max(0.0, 1 - rm_), 0.08); }   // rm забирает долю прямого сигнала

  // генераторы: Гц — частота + self-FM + tzfm, ц — дрейф + джиттер + fm-связи + LFO pitch
  const double pitch = lfo_[L_PITCH].v, j = rj_.next() * 2 - 1;
  const double det1 = drift1_ + 140 * jit1_.step(j) + in.fmCents + pitch;
  const double det2 = drift2_ - 140 * jit2_.step(j) + in.fmCents + pitch;
  const double sfm = (b_[SFM][k] + lfo_[L_FM].v) * mRaw_;
  const double h1 = (b_[F1][k] + sfm + in.tzHz) * std::exp2(det1 / 1200);
  const double h2 = (b_[F2][k] + lfo_[L_BEAT].v + sfm + in.tzHz) * std::exp2(det2 / 1200);
  const double o1 = c1_.voiceRun(*T_, mix_, h1, sr_), o2 = c2_.voiceRun(*T_, mix_, h2, sr_);
  const double so = 0.28 * sub_.sine((pitch == 0 ? b_[SUB][k] : b_[SUB][k] * std::exp2(pitch / 1200)) / sr_);   // exp2(0) = 1 ровно — без вызова
  const double tg = b_[TONE][k];
  double x[2] = {(g1L_ * o1 + g2L_ * o2 + so) * tg, (g1R_ * o1 + g2R_ * o2 + so) * tg};

  // сдвиг частоты — до перегруза и фильтра
  if (shOn_ || shTail_ > 0) {
    const double hz = b_[SHZ][k] + lfo_[L_SHIFT].v;
    for (int c = 0; c < 2; c++) x[c] = b_[DRY][k] * x[c] + b_[WET][k] * sh_[c].step(x[c], hz, sr_);
    if (!shOn_) shTail_--;
  } else {
    for (double& v : x) v *= b_[DRY][k];
  }

  // дыхание шумом: полоса на гармонике кружка, вверху поля — шипение; шум общий на все голоса (от мира)
  const double n = in.noise;
  nz_ = b_[NZ][k] * (2.4 * bp_.step(n) + b_[HISS][k] * hp_.step(n));
  const double drive = b_[DRIVE][k];
  comb_ = b_[COMB][k]; vca_ = b_[VCA][k] + in.vcaAdd;
  lv_ = breath_ * (b_[LVL][k] + lfo_[L_AMP].v);
  s[0] = x[0] * drive; s[1] = x[1] * drive;
}

void Voice::post(const double* s, double& L, double& R) {
  const sdk::Shaper<4096>& sat = loopSat();
  double v[2];
  for (int c = 0; c < 2; c++) {
    const double e = env_ * (lp_[c].step(s[c]) + nz_);
    const double d = dl_[c].read(dSamp_);               // гребёнка на высоте: тихая постоянная окраска
    dl_[c].write(e + FB_BASE * sat.step(loop_[c].step(d)));
    v[c] = (e + comb_ * d) * vca_;
  }
  ring_[ringW_] = static_cast<float>(0.5 * (v[0] + v[1]));   // AnalyserNode сводит стерео в моно
  ringW_ = (ringW_ + 1) & (SCOPE - 1);
  pan_.step(v[0] * lv_, v[1] * lv_, L, R);
  if (++blk_ == BLOCK) blk_ = 0;
  now_ += 1;
}

// контур кружка: 128 точек — два периода сигнала после vca от первого перехода через ноль снизу вверх
void Voice::scope(double* out) const {
  const auto at = [this](int j) { return static_cast<double>(ring_[(ringW_ + j) & (SCOPE - 1)]); };   // от старого к новому
  int s0 = 0;
  for (int j = 1; j < 480; j++) if (at(j - 1) < 0 && at(j) >= 0) { s0 = j; break; }
  const double per = f_ > 0 ? sr_ / f_ * 2 : 520;
  const int span = static_cast<int>(std::lround(std::min(520.0, std::max(64.0, per))));
  for (int j = 0; j < 128; j++) out[j] = at(s0 + static_cast<int>(std::floor(j / 128.0 * span)));
}

}  // namespace tenebrae

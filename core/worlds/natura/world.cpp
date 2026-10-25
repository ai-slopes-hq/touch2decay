// Natura — мир SDK, см. world.hpp.
#include "world.hpp"

#include <algorithm>
#include <cmath>

namespace natura {

static const double LVL[5] = {0.32, 0.13, 0.3, 0.15, 0.2};                  // громкость волны (WAVES в model.js)
// sawtooth браузера нормирован на пик ≈ 1 (PeriodicWave), наш Saw — идеальный band-limited; громкость, подобранная автором на слух,
// держим множителями (замер в Chromium: tools/natura-bus.py). Остальные волны — пик 1, как у браузера
static const double WK[5] = {1, 0.849, 1, 0.848, 1};
constexpr double OUTK = 1.2;                                                // out после шины и посыл в зал (прежний out после возврата зала)

static double clampd(double x, double a, double b) { return x < a ? a : x > b ? b : x; }

void World::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  rng_ = sdk::Rng(seed ^ 0x4e41u);                       // chance шага — от зерна мира
  nz_ = sdk::Rng(seed ^ 0x5253u);                        // шелест
  steps_.reset(); npend_ = 0; nHeard_ = 0; now_ = 0; phase_ = -1; tick_ = 0; lastSound_ = -1e9;
  playing_ = false; rustle_ = false;
  for (auto& v : notes_) v.on = false;
  for (auto& v : sk_) v.on = false;
  for (auto& v : cr_) v.on = false;
  for (auto& v : ls_) v.on = false;
  model_.reset();                                        // сцена по умолчанию, как у новой model.js
  Wave::prepare(sr_);
  echo_.prepare(sr_, 0, 2800, 1);                        // lowpass задержки 2800 Гц, Q 1 дБ; время плывёт с нуля (новый DelayNode)
  const sdk::Chorus<2, 4096>::Line lines[2] = {{0.012, 0.31, 0}, {0.019, 0.48, 0}};
  chorus_.prepare(sr_, lines, 0, true);                  // две плавающие задержки, моно
  hp_ = sdk::Biquad(); hp_.set(sdk::Biquad::highpass, 20, 0.9, sr_);
  hpG_ = Glide(); hpG_.jump(20); hpG_.set(20, 0.05, sr_);
  rbp_ = sdk::Biquad(); rbp_.set(sdk::Biquad::bandpass, 3500, 0.6, sr_);
  rg_ = Glide(); rs_ = Glide();
  applyFx();
}

void World::applyFx() {
  const double d = model_.fx(DELAY), c = model_.fx(CHORUS), r = model_.fx(REVERB);
  chorus_.set(c * 0.8, 0.0015 + 0.0045 * c);
  echo_.set(d * 0.7, 0.2 + 0.55 * d);
  echo_.glideTo(std::min(model_.delaySec(), 4.0), 0.15);   // DelayNode(4)
  rs_.set(r * r * 1.3, 0.05, sr_);
}

void World::noteCoefs(NoteV& v, double tr) {             // срез: от base к пику за attack, дальше к base с τ
  const double f = tr < v.A ? v.base + (v.peak - v.base) * tr / v.A : v.base + (v.peak - v.base) * std::exp(-(tr - v.A) / v.tauF);
  v.lp.set(sdk::Biquad::lowpass, f, v.q, sr_);
}

void World::laserCoefs(LaserV& v, double t) {            // срез лазера падает 9000 → 260 Гц за 0.42 с
  const double fc = t < 0.42 ? 9000 * std::pow(260.0 / 9000, t / 0.42) : 260;
  v.lp.set(sdk::Biquad::lowpass, std::min(fc, 0.45 * sr_), 22, sr_);
}

void World::startNote(double t, const Note& nv, int pad, bool played) {
  NoteV* v = nullptr;
  for (auto& x : notes_) if (!x.on) { v = &x; break; }
  if (!v) { v = &notes_[0]; for (auto& x : notes_) if (x.n > v->n) v = &x; }   // все заняты — самый старый уступает
  v->on = true; v->started = false; v->ts = t; v->n = 0; v->v = nv; v->pad = pad; v->played = played;
  v->w.restart(nv.wave);
  const int w = nv.wave < 0 ? 0 : nv.wave > 4 ? 4 : nv.wave;
  if (nv.from > 0 && nv.glide > 0) {                     // глайд из прошлой ноты: экспонента from → hz за glide
    v->gl = std::max(1L, static_cast<long>(nv.glide * sr_ + 0.5));
    v->f = nv.from; v->r = std::pow(nv.hz / nv.from, 1.0 / v->gl);
  } else { v->gl = 0; v->f = nv.hz; v->r = 1; }
  v->base = 180 * std::pow(2.0, nv.cutoff * 6.6); v->peak = std::min(16000.0, v->base * 6);
  v->A = nv.att; const double dec = nv.rel / 2.5;
  v->tauF = 0.03 + dec * 0.6; v->q = 0.7 + nv.res * 16;
  v->lp = sdk::Biquad();
  v->env.start(sr_, LVL[w] * WK[w], v->A, dec * 5, 0.0001, 0.01);
  noteCoefs(*v, 0);
  if (npend_ >= 30) { for (int j = 2; j < npend_; j++) pend_[j - 2] = pend_[j]; npend_ -= 2; }
  pend_[npend_++] = Pend{t, 2, pad};
  if (played) pend_[npend_++] = Pend{t, 1, pad};
  lastSound_ = t;
}

void World::action(int kind, int i, const double* a, int n) {
  const auto arg = [&](int k, double d) { return (a && k < n) ? a[k] : d; };
  const double now = nowT();
  switch (kind) {
    case STATE:
      if (model_.setState(a, n)) applyFx();
      return;
    case PLAY:
      playing_ = arg(0, 0) != 0;
      steps_.reset();                                    // часы — с начала (по сетке — к нынешней доле)
      if (!playing_) phase_ = -1;
      return;
    case HEAR:                                           // послушать кувшинку сейчас
      if (i >= 0 && i < NPAD && model_.pad(i).on) startNote(now, model_.voice(model_.pad(i)), i, false);
      return;
    case SHAKE: {                                        // дерево: срез вверх + шелест листвы
      const double v = arg(0, 0);
      hpG_.set(20 * std::pow(2.0, v * 9), 0.05, sr_);
      if (v > 0.03 && !rustle_) { rustle_ = true; rbp_ = sdk::Biquad(); rbp_.set(sdk::Biquad::bandpass, 3500, 0.6, sr_); rg_.jump(0); }
      if (rustle_) {
        rg_.set(std::min(0.06, v * 0.06), 0.05, sr_);
        if (v < 0.01) rustle_ = false; else lastSound_ = now;
      }
      return;
    }
    case SKIFF: {                                        // a = [q, t, wave]: поперёк — высота, вниз по течению — ярче
      const double q = arg(0, 0), t = arg(1, 0);
      const int w = static_cast<int>(clampd(std::floor(arg(2, 0) + 0.5), 0, 4));
      SkiffV* s = nullptr;
      for (auto& x : sk_) if (x.on && x.held) { s = &x; break; }
      const double hz = model_.skiffHz(q);
      if (!s) {
        for (auto& x : sk_) if (!x.on) { s = &x; break; }
        if (!s) { s = &sk_[0]; for (auto& x : sk_) if (x.rel > s->rel) s = &x; }
        s->on = true; s->held = true; s->n = 0; s->rel = 0;
        s->w.restart(w); s->lvl = LVL[w] * 0.82 * WK[w];
        s->lp = sdk::Biquad();
        s->f.jump(hz); s->fc.jump(350); s->g.jump(0); s->g.set(s->lvl, 0.04, sr_);
      }
      s->f.set(hz, model_.scaleOn() ? 0.015 : 0.03, sr_);
      s->q = 0.7 + model_.fx(RES) * 10;
      s->fc.set(180 * std::pow(2.0, model_.fx(CUTOFF) * 6.6) * (0.5 + 1.8 * t), 0.05, sr_);
      lastSound_ = now;
      return;
    }
    case SKIFF_OFF:                                      // с воды: гаснет за ~1 с, голос живёт ещё 2 с
      for (auto& x : sk_) if (x.on && x.held) { x.held = false; x.rel = 0; x.g.set(0, 0.25, sr_); }
      return;
    case WAVE:
      for (auto& x : sk_) if (x.on && x.held) x.w.set(static_cast<int>(clampd(std::floor(arg(0, 0) + 0.5), 0, 4)));
      return;
    case CROAK: {                                        // лягушка квакает нотой своей кувшинки
      CroakV* c = nullptr;
      for (auto& x : cr_) if (!x.on) { c = &x; break; }
      if (!c) { c = &cr_[0]; for (auto& x : cr_) if (x.n > c->n) c = &x; }
      c->on = true; c->started = false; c->ts = now; c->n = 0;
      c->hz = model_.noteHz(static_cast<int>(clampd(std::floor(arg(0, 0) + 0.5), 0, 14)));
      c->w.restart(SAW);
      c->bp = sdk::Biquad(); c->bp.set(sdk::Biquad::bandpass, c->hz * 3, 4, sr_);
      c->env.start(sr_, 0.22 * WK[SAW], 0.02, 0.30, 0.0001, 0.01);
      lastSound_ = now;
      return;
    }
    case LASER: {                                        // спугнули птиц: меандр с падающим тоном сквозь падающий резонанс
      LaserV* l = nullptr;
      for (auto& x : ls_) if (!x.on) { l = &x; break; }
      if (!l) { l = &ls_[0]; for (auto& x : ls_) if (x.n > l->n) l = &x; }
      l->on = true; l->started = false; l->ts = now; l->n = 0;
      l->w.restart(SQUARE);
      l->lp = sdk::Biquad();
      l->env.start(sr_, 0.16 * WK[SQUARE], 0.004, 0.476, 0.0001, 0.02);
      lastSound_ = now;
      return;
    }
    case SCARE: model_.scare(); return;
    default: return;
  }
}

void World::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  if (n > 128) n = 128;
  const double now = nowT(), end = now + n / sr_;
  now_ = end;
  model_.advance(n / sr_);
  if (playing_) {
    static const sdk::Grid none;
    steps_.run(now, end, clk_ ? clk_->grid : none, 4,
               [&](long) { return stepSec(); },
               [&](long) { return 0.0; },
               [&](long k, double t) {
                 Note v; int idx = 0;
                 if (model_.stepNote(k, rng_, v, idx)) startNote(t, v, idx, true);
               });
    phase_ = std::max(0.0, static_cast<double>(steps_.step()) - (steps_.next() - end) / stepSec());
  }
  if (npend_) {                                          // удары, чьё время пришло в этом блоке, — «услышаны» (утки, лягушка, стрекозы)
    int w = 0;
    for (int j = 0; j < npend_; j++) {
      if (pend_[j].t < end) { if (nHeard_ < 64) { heardK_[nHeard_] = pend_[j].kind; heardP_[nHeard_++] = pend_[j].pad; } }
      else pend_[w++] = pend_[j];
    }
    npend_ = w;
  }
  float hpo[128], cl[128], cr[128], pre[128], ec[128], lsr[128], rst[128];
  bool feed = false;
  // срез и срез дерева — раз в блок (k-rate, как у BiquadFilterNode): по времени голоса на начало блока
  for (auto& v : notes_) if (v.on && v.started) noteCoefs(v, v.n / sr_);
  for (auto& v : sk_) if (v.on) v.lp.set(sdk::Biquad::lowpass, std::min(v.fc.y, 0.45 * sr_), v.q, sr_);
  for (auto& v : ls_) if (v.on && v.started) laserCoefs(v, v.n / sr_);
  hp_.set(sdk::Biquad::highpass, std::min(hpG_.y, 0.45 * sr_), 0.9, sr_);
  for (int k = 0; k < n; k++) {
    const double tk = now + k / sr_;
    double s = 0, lz = 0;
    for (auto& v : notes_) {
      if (!v.on) continue;
      if (!v.started) {
        if (tk + 0.5 / sr_ < v.ts) continue;
        v.started = true; v.n = 0; noteCoefs(v, 0);
      }
      feed = true;
      double y = v.w.step(v.f / sr_);
      y = v.lp.step(y) * v.env.step();
      s += y;
      if (v.gl > 0) { if (v.n + 1 >= v.gl) { v.f = v.v.hz; v.gl = 0; } else v.f *= v.r; }
      v.n++;
      if (!v.env.active()) v.on = false;
    }
    for (auto& v : sk_) {
      if (!v.on) continue;
      feed = true;
      const double f = v.f.step(), g = v.g.step();
      v.fc.step();
      s += v.lp.step(v.w.step(f / sr_)) * g;
      v.n++;
      if (!v.held && ++v.rel > static_cast<long>(2 * sr_)) v.on = false;
    }
    for (auto& v : cr_) {
      if (!v.on) continue;
      if (!v.started) {
        if (tk + 0.5 / sr_ < v.ts) continue;
        v.started = true; v.n = 0;
      }
      feed = true;
      const double t = v.n / sr_;
      const double f = v.hz * (1 - 0.08 * std::min(t / 0.3, 1.0));   // hz → 0.92·hz за 0.3 с
      double y = v.bp.step(v.w.step(f / sr_)) * v.env.step();
      y *= 0.5 + std::sin(2 * M_PI * 28 * t);            // дрожь громкости ~28 Гц
      s += y;
      v.n++;
      if (!v.env.active() || t > 0.35) v.on = false;
    }
    for (auto& v : ls_) {
      if (!v.on) continue;
      if (!v.started) {
        if (tk + 0.5 / sr_ < v.ts) continue;
        v.started = true; v.n = 0; laserCoefs(v, 0);
      }
      const double t = v.n / sr_;
      const double f = t < 0.38 ? 2400 * std::pow(70.0 / 2400, t / 0.38) : 70;
      lz += v.lp.step(v.w.step(f / sr_)) * v.env.step();
      v.n++;
      if (!v.env.active() || t > 0.52) v.on = false;
    }
    lsr[k] = static_cast<float>(lz);
    hpG_.step();
    hpo[k] = static_cast<float>(hp_.step(s));
    double r = 0;
    if (rustle_) r = rbp_.step(nz_.next() * 2 - 1) * rg_.step();   // шелест листвы — мимо среза дерева, в хор не идёт
    rst[k] = static_cast<float>(r);
  }
  tick_ += n;
  chorus_.process(hpo, hpo, feed, cl, cr, n);
  for (int k = 0; k < n; k++) pre[k] = hpo[k] + cl[k] + lsr[k] + rst[k];
  echo_.process(pre, ec, n);
  for (int k = 0; k < n; k++) {
    const double m = pre[k] + ec[k];
    out.L[k] = out.R[k] = static_cast<float>(m * OUTK);
    out.sL[k] = out.sR[k] = static_cast<float>(m * rs_.step() * OUTK);
  }
  (void)cr;
}

int World::mirror(double* buf, int cap) const {
  if (!buf || cap < MIRROR_N) return 0;
  int live = 0, held = 0;
  for (const auto& v : notes_) live += v.on ? 1 : 0;
  for (const auto& v : sk_) held += (v.on && v.held) ? 1 : 0;
  buf[0] = playing_ ? phase_ : -1; buf[1] = playing_ ? 1 : 0; buf[2] = live; buf[3] = held;
  return MIRROR_N;
}

int World::heard(double* buf, int cap) {
  if (!nHeard_ || !buf) return 0;
  int w = 0;
  for (int i = 0; i < nHeard_ && w + 2 <= cap; i++) { buf[w++] = heardK_[i]; buf[w++] = heardP_[i]; }
  nHeard_ = 0;
  return w;
}

bool World::sounding() const {
  if (playing_ && model_.any()) return true;
  for (const auto& v : notes_) if (v.on) return true;
  for (const auto& v : sk_) if (v.on) return true;
  for (const auto& v : cr_) if (v.on) return true;
  for (const auto& v : ls_) if (v.on) return true;
  return now_ - lastSound_ < 9;                          // хвост эха и зала: как прежний setLive — 9 с после последнего звука
}

}  // namespace natura

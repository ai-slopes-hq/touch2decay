// Tria corpora — мир SDK, см. world.hpp.
#include "world.hpp"

#include <cmath>
#include "../../sdk/jsmath.hpp"
#include "../../sdk/pan.hpp"

namespace tria {

using sdk::jsClamp;
using sdk::jsHypot;

struct BellSpec { double ratio, idx, dec, amp; };
// колокол тела: у каждого начала свой металл — соль: дерево, сера: колокол, ртуть: стекло
static const BellSpec BELL[NB] = {{1, 1.2, 0.45, 0.5}, {3.5, 2.2, 1.4, 0.32}, {2.01, 1.6, 2.2, 0.26}};

void World::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  t_ = 0;
  model_.reset();
  rng_ = sdk::Rng(seed ^ 0x7121A11u);                   // шум шороха — свой
  shaper_.build([](double x) { return std::tanh(1.4 * x) / std::tanh(1.4); });
  dl_ = 128 + 0.002 * sr_;
  hall_.reset(0);                                        // посыл — GainNode 0 до первого target
  vo_ = false; voStop_ = -1; quiet_ = 0;
  for (Note& no : notes_) no.on = false;
  for (Burst& b : bursts_) b.on = false;
  liveNotes_ = 0; strikes_ = encounters_ = 0; hn_ = 0;
  applyFx();
}

void World::applyFx() {
  const double h = model_.fx(HALL);
  hall_.target(h * h * HALL_K, t_, 0.05 * sr_);
}

void World::startVoices() {                              // три генератора, по кругу модулируют друг друга
  quiet_ = 0;
  if (vo_ && voStop_ < 0) return;
  vo_ = true; voStop_ = -1;
  for (int i = 0; i < NB; i++) {
    dFreq_[i].reset(model_.hzOf(model_.body(i)));       // frequency.value = hzOf — до первого target
    dVca_[i].reset(0); dPan_[i].reset(0); dMg_[i].reset(0);
    dOsc_[i].reset();
  }
  for (float& x : h2_) x = 0;
  h2At_ = 0;
}

void World::drone() {                                    // громкость и пульс — из модели; FM по кругу — ближе источник, глубже
  if (!vo_ || voStop_ >= 0) return;
  const double t = t_, nexus = model_.fx(NEXUS);
  for (int i = 0; i < NB; i++) {
    const Body& b = model_.body(i);
    const Body& src = model_.body((i + 2) % NB);
    const double d = jsHypot(b.x - src.x, b.y - src.y), f = model_.baseHz(b), idx = nexus * f * 2 * jsClamp(0.12 / std::fmax(0.03, d), 0, 3);
    dFreq_[i].target(f, t, 0.05 * sr_);
    const double tr = 1 - 0.7 * model_.pairK(i) * (0.5 + 0.5 * std::sin(model_.trem(i)));
    dVca_[i].target(b.amp * 0.2 * tr, t, 0.012 * sr_);
    dPan_[i].target(jsClamp(b.x, -1, 1) * 0.8, t, 0.05 * sr_);
    dMg_[(i + 2) % NB].target(idx, t, 0.04 * sr_);
  }
}

void World::bell(int i, double f, double vel, double pan) {
  if (liveNotes_ > 18) return;
  Note* no = nullptr;
  for (Note& x : notes_) if (!x.on) { no = &x; break; }
  if (!no) return;
  const BellSpec& B = BELL[i];
  const Body& b = model_.body(i);
  const double t = t_ + 0.005 * sr_;
  const double dec = B.dec * (0.7 + 0.6 * vel), ix = f * B.ratio * B.idx * (0.3 + 1.4 * model_.fx(NEXUS)) * vel, pk = B.amp * b.level * (0.35 + 0.65 * vel);
  no->on = true; no->tri = false; no->t0 = t; no->end = t + (dec + 0.03) * sr_; no->f = f; no->ratio = B.ratio;
  sdk::panEq(pan, no->gl, no->gr);
  no->car.reset(); no->mod.reset();
  no->mg.reset(1); no->mg.set(ix, t); no->mg.exp(std::fmax(1, ix * 0.04), t + dec * 0.6 * sr_);
  no->vca.reset(1); no->vca.set(0, t); no->vca.lin(pk, t + 0.003 * sr_); no->vca.exp(0.0004, t + dec * sr_); no->vca.lin(0, t + (dec + 0.01) * sr_);
  liveNotes_++; strikes_++;
  quiet_ = 0;
}

void World::thud(int i, double vn) {                    // удар о край — низкий тимпан: основной тон тела октавой ниже, высота падает
  if (liveNotes_ > 18) return;
  Note* no = nullptr;
  for (Note& x : notes_) if (!x.on) { no = &x; break; }
  if (!no) return;
  const Body& b = model_.body(i);
  const double t = t_ + 0.005 * sr_, f = model_.baseHz(b), k = jsClamp(vn / 2.5);
  no->on = true; no->tri = true; no->t0 = t; no->end = t + 0.38 * sr_;
  sdk::panEq(jsClamp(b.x, -1, 1) * 0.7, no->gl, no->gr);
  no->car.reset();
  no->fr.reset(440); no->fr.set(f * 2, t); no->fr.exp(f, t + 0.06 * sr_);
  no->vca.reset(1); no->vca.set(0, t); no->vca.lin(0.5 * k * b.level, t + 0.002 * sr_); no->vca.exp(0.0004, t + 0.35 * sr_); no->vca.lin(0, t + 0.36 * sr_);
  liveNotes_++;
}

void World::burst(double f, double pan, double k) {     // близкий пролёт — шорох: шум сквозь узкую полосу
  Burst* bu = nullptr;
  for (Burst& x : bursts_) if (!x.on) { bu = &x; break; }
  if (!bu) return;
  const double t = t_;
  bu->on = true; bu->t0 = t; bu->end = t + 0.33 * sr_;
  sdk::panEq(pan, bu->gl, bu->gr);
  bu->bp = sdk::Biquad();
  bu->bp.set(sdk::Biquad::bandpass, std::fmin(9000, f), 14, sr_);
  bu->g.reset(1); bu->g.set(0, t); bu->g.lin(0.45 * k, t + 0.004 * sr_); bu->g.exp(0.0005, t + 0.3 * sr_); bu->g.lin(0, t + 0.31 * sr_);
  encounters_++;
}

void World::events() {
  for (int k = 0; k < model_.nev(); k++) {
    const Ev& e = model_.ev(k);
    switch (e.t) {
      case Ev::BELL: bell(e.i, e.f, e.vel, e.pan); break;
      case Ev::THUD: thud(e.i, e.vel); break;
      case Ev::BURST: burst(e.f, e.pan, e.k); break;
      case Ev::START: startVoices(); break;
      case Ev::FXCH: applyFx(); break;
    }
  }
  const int nf = model_.nflash();                        // вспышки — в услышанное
  if (nf && hn_ + 1 + FLASH_M * nf <= HMAX) {
    if (hn_ == 0) hbuf_[hn_++] = 0;
    for (int k = 0; k < nf; k++) {
      const Flash& f = model_.flash(k);
      double* p = hbuf_ + hn_;
      p[0] = f.i; p[1] = f.kind; p[2] = f.x; p[3] = f.y; p[4] = f.q;
      hn_ += FLASH_M; hbuf_[0] += 1;
    }
  }
  model_.clearEvents();
}

void World::action(int kind, int i, const double* a, int n) {
  const auto arg = [&](int k, double d) { return (a && k < n) ? a[k] : d; };
  switch (kind) {
    case GRAB: model_.grab(i); break;
    case DROP: model_.drop(i); break;
    case DRAG: if (n >= 2) model_.drag(i, a[0], a[1]); break;
    case RELEASE: model_.release(i, n >= 2, arg(0, 0), arg(1, 0)); break;
    case ANCHOR: model_.anchor(i); break;
    case SET: if (n >= 2) model_.setBody(i, static_cast<int>(a[0]), a[1]); break;
    case FX: if (n >= 1) model_.setFx(i, a[0]); break;
    case LUX: model_.fiatLux(); break;
    case PLUMB: model_.plumb(); break;
    case DICE: if (n >= 6 * NB) model_.dice(a); break;
    case CLEAR: model_.clear(); break;
    case sdk::ACT_LFO:                                   // LFO плашек: только веер (i == -1), ключ — Fx 0…5
      if (n >= 2 && i == -1 && static_cast<int>(a[0]) >= 0 && static_cast<int>(a[0]) < NFX) model_.setFx(static_cast<int>(a[0]), a[1]);
      break;
    default: break;
  }
  events();
}

void World::restore(const std::string& js) {
  model_.restore(js);
  events();
}

void World::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  if (n > 128) n = 128;
  model_.step(n / sr_);                                  // шаг модели — раз в блок
  bool loud = !model_.still();
  for (int i = 0; i < NB; i++) if (model_.body(i).amp > 0.01) loud = true;
  quiet_ = loud ? 0 : quiet_ + n / sr_;
  events();
  drone();
  if (vo_ && voStop_ < 0 && quiet_ > 6) voStop_ = t_ + 0.05 * sr_;   // 6 с тишины — генераторы гаснут (ещё 50 мс звучат)
  bool any = vo_;
  for (const Note& no : notes_) any = any || no.on;
  for (const Burst& b : bursts_) any = any || b.on;
  if (!any) {                                            // ничего не звучит — блок не считается
    for (int k = 0; k < n; k++) out.L[k] = out.R[k] = out.sL[k] = out.sR[k] = 0;
    t_ += n;
    return;
  }
  double* L = pre_[0];
  double* R = pre_[1];
  for (int k = 0; k < n; k++) L[k] = R[k] = 0;
  if (vo_) {                                             // дрон: FM по кругу, сэмпл за сэмплом
    double (&fq)[NB][128] = dfq_, (&vc)[NB][128] = dvc_, (&pn)[NB][128] = dpn_, (&mg)[NB][128] = dmg_;
    for (int i = 0; i < NB; i++) { dFreq_[i].fill(fq[i], n, t_); dVca_[i].fill(vc[i], n, t_); dPan_[i].fill(pn[i], n, t_); dMg_[i].fill(mg[i], n, t_); }
    for (int k = 0; k < n; k++) {
      if (voStop_ >= 0 && t_ + k >= voStop_) break;
      const double rp = h2At_ - dl_, i0 = std::floor(rp), fr = rp - i0;   // 2 → 0: квант + 2 мс (по прямой между сэмплами)
      const int j = static_cast<int>(i0) & 1023;
      const double d2 = (1 - fr) * h2_[j] + fr * h2_[(j + 1) & 1023];
      const double y0 = dOsc_[0].sine((fq[0][k] + mg[2][k] * d2) / sr_);
      const double y1 = dOsc_[1].sine((fq[1][k] + mg[0][k] * y0) / sr_);
      const double y2 = dOsc_[2].sine((fq[2][k] + mg[1][k] * y1) / sr_);
      h2_[h2At_] = static_cast<float>(y2); h2At_ = (h2At_ + 1) & 1023;
      const double ys[NB] = {y0, y1, y2};
      for (int i = 0; i < NB; i++) {
        double gl, gr;
        sdk::panEq(pn[i][k], gl, gr);
        const double s = ys[i] * vc[i][k];
        L[k] += s * gl; R[k] += s * gr;
      }
    }
    if (voStop_ >= 0 && t_ + n >= voStop_) vo_ = false;  // погасли — следующий START заводит новые (фазы с нуля)
  }
  for (Note& no : notes_) {
    if (!no.on) continue;
    double* vc = tmpA_;
    double* p2 = tmpB_;
    no.vca.fill(vc, n, t_);
    if (no.tri) no.fr.fill(p2, n, t_); else no.mg.fill(p2, n, t_);
    double mh[128];                                      // вход FM несущей (индекс × модулятор) по кадрам блока
    const double s0 = std::ceil(no.t0);
    const bool first = s0 >= t_ && s0 < t_ + n;          // блок, где нота стартует
    for (int k = 0; k < n; k++) {
      const double f = t_ + k;
      mh[k] = 0;
      if (f < no.t0 || f >= no.end) continue;           // до start и после stop генератор молчит
      double y;
      if (no.tri) y = no.car.triangle(p2[k] / sr_);
      else {
        const double m = no.mod.sine(no.f * no.ratio / sr_);
        mh[k] = p2[k] * m;
        double fm = mh[k];
        if (first) { const int j = static_cast<int>(f - s0); fm = mh[j]; }   // как браузер: в кванте старта — вход с начала кванта
        y = no.car.sine((no.f + fm) / sr_);
      }
      const double s = y * vc[k];
      L[k] += s * no.gl; R[k] += s * no.gr;
    }
    if (t_ + n >= no.end) { no.on = false; liveNotes_--; }
  }
  for (Burst& bu : bursts_) {
    if (!bu.on) continue;
    double* g = tmpA_;
    bu.g.fill(g, n, t_);
    for (int k = 0; k < n; k++) {
      const double f = t_ + k;
      if (f < bu.t0 || f >= bu.end) continue;
      const double s = bu.bp.step(rng_.next() * 2 - 1) * g[k];
      L[k] += s * bu.gl; R[k] += s * bu.gr;
    }
    if (t_ + n >= bu.end) bu.on = false;
  }
  double* hs = tmpC_;
  hall_.fill(hs, n, t_);
  for (int k = 0; k < n; k++) {                          // шина: tanh → сухо ×1.6; → посыл hall ×1.6
    const double l = shaper_.step(L[k]), r = shaper_.step(R[k]);
    out.L[k] = static_cast<float>(l * OUT); out.R[k] = static_cast<float>(r * OUT);
    out.sL[k] = static_cast<float>(l * hs[k] * OUT); out.sR[k] = static_cast<float>(r * hs[k] * OUT);
  }
  t_ += n;
}

int World::mirror(double* buf, int cap) const {
  if (!buf || cap < MIRROR_N) return 0;
  double* p = buf;
  for (int k = 0; k < NFX; k++) *p++ = model_.fx(k);
  *p++ = model_.still() ? 1 : 0; *p++ = model_.lux() ? 1 : 0; *p++ = model_.cadit() ? 1 : 0;
  *p++ = strikes_; *p++ = encounters_;
  for (int i = 0; i < NB; i++) {
    const Body& b = model_.body(i);
    *p++ = b.x; *p++ = b.y; *p++ = b.vx; *p++ = b.vy; *p++ = b.m; *p++ = b.fixed ? 1 : 0; *p++ = b.semi; *p++ = b.level;
    *p++ = b.amp; *p++ = b.hz; *p++ = model_.pairK(i); *p++ = model_.trem(i);
  }
  return MIRROR_N;
}

int World::heard(double* buf, int cap) {
  if (!buf || hn_ == 0) return 0;
  const int n = hn_ <= cap ? hn_ : 0;
  for (int k = 0; k < n; k++) buf[k] = hbuf_[k];
  hn_ = 0;
  return n;
}

}  // namespace tria

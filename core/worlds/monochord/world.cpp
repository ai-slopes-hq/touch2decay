// Monochordum — мир SDK, см. world.hpp.
#include "world.hpp"

#include <cmath>

namespace monochord {

static double clamp01(double x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
static const sdk::Chorus<2, 8192>::Line LINES[2] = {{0.012, 0.31, -0.7}, {0.019, 0.47, 0.7}};
static const double BANDS[3][2] = {{190, 3}, {420, 4}, {1100, 5}};

void World::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  model_.reset(seed);                                   // ГСЧ модели (chance, узор random) — зерно мира
  sound_.prepare(sr_, seed + 1);                        // ГСЧ струн (шум щипка, смычка, ветра) — своё
  for (auto& b : body_) for (int c = 0; c < 2; c++) { b[c] = sdk::Biquad(); }
  for (int k = 0; k < 3; k++) for (int c = 0; c < 2; c++) body_[k][c].set(sdk::Biquad::bandpass, BANDS[k][0], BANDS[k][1], sr_);
  chorus_.prepare(sr_, LINES, 0.002);
  c_ = 1 - std::exp(-1 / (0.05 * sr_));
  bodyG_ = sdk::OnePole(); hallG_ = sdk::OnePole();
  steps_.reset(); npend_ = 0; quiet_ = 0; hits_ = 0; lastStep_ = 0; now_ = 0; chorusOn_ = false;
  applyFx();                                            // как build + ready прежнего engine.js: шина, связь и строй струн
  for (int i = 0; i < N; i++) if (model_.str(i).sus) sound_.sus(i, true);
}

void World::retune(int i) {
  const Str& s = model_.str(i);
  sound_.tune(i, model_.hzOf(i), clamp01(s.bright * 0.5 + model_.fx(BRIGHT) * 0.5), clamp01(s.decay * 0.5 + model_.fx(DECAY) * 0.5), s.level);
}

void World::applyFx() {
  const double ch = model_.fx(CHORUS), h = model_.fx(HALL);
  chorusOn_ = ch > 0.01;
  chorus_.set(ch * 0.9, 0.001 + 0.004 * ch);
  bodyTo_ = model_.fx(BODY) * 2.5;
  sound_.couple(0.0015 * model_.fx(SYMPATHY));
  hallTo_ = h * h * HALL_K;
  for (int i = 0; i < N; i++) retune(i);
}

void World::on(const Ev& e) {
  switch (e.t) {
    case Ev::TUNE: retune(e.i); break;
    case Ev::PLUCK: sound_.pluck(e.i, e.a, e.b); break;
    case Ev::HARM: sound_.harm(e.i, static_cast<int>(e.a), e.b); break;
    case Ev::BOW: sound_.bow(e.i, e.a); break;
    case Ev::SUS: sound_.sus(e.i, e.a != 0); break;
    case Ev::WIND: sound_.wind(e.a); break;
    case Ev::AUTO: steps_.reset(); npend_ = 0; break;              // часы автострама — с начала (по сетке — к нынешней доле)
    case Ev::FX: applyFx(); break;
  }
}

void World::action(int kind, int i, const double* a, int n) {
  const auto arg = [&](int k, double d) { return (a && k < n) ? a[k] : d; };
  switch (kind) {
    case PLUCK: model_.pluck(i, arg(0, 0.3), arg(1, 0.9)); break;
    case HARM: model_.harm(i, static_cast<int>(arg(0, 2)), arg(1, 0.9)); break;
    case BOW: model_.bow(i, arg(0, 0)); break;
    case SUS: model_.setSus(i, arg(0, 0) != 0); break;
    case BRIDGE: if (n >= 1) model_.setBridge(i, a[0]); break;
    case STRING: if (n >= 2) model_.setString(i, static_cast<int>(a[0]), a[1]); break;
    case WIND: model_.setWind(arg(0, 0)); break;
    case FX: if (n >= 1) model_.setFx(i, a[0]); break;
    case AUTO: model_.setAuto(arg(0, 0) != 0); break;
    case AUTOPAR: if (n >= 1) model_.setAutoPar(i, a[0]); break;
    case CLEAR: model_.clear(); break;
    default: break;
  }
}

void World::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  if (n > 128) n = 128;
  const double now = clk_ ? clk_->now : now_;
  now_ = now + n / sr_;
  if (model_.autoOn()) {
    static const sdk::Grid none;
    Hit h[N];
    steps_.run(now, now + n / sr_, clk_ ? clk_->grid : none, model_.perBeat(),
               [&](long k) { return model_.stepDur(k); }, [&](long k) { return model_.swingAt(k); },
               [&](long k, double t) {
                 const int m = model_.autoStep(k, h);   // chance — в модели
                 if (m < 0) return;
                 for (int j = 0; j < m; j++) sound_.at(t + h[j].dt, h[j].i, h[j].pos, h[j].vel);
                 if (npend_ == 16) { for (int j = 1; j < 16; j++) pend_[j - 1] = pend_[j]; npend_--; }
                 pend_[npend_++] = Pend{t, k};
               });
  }
  if (npend_) {                                          // удары, чьё время пришло в этом блоке
    const double end = now + n / sr_;
    int w = 0;
    for (int j = 0; j < npend_; j++) { if (pend_[j].t < end) { hits_++; lastStep_ = pend_[j].step; } else pend_[w++] = pend_[j]; }
    npend_ = w;
  }
  const bool live = sound_.process(pL_, pR_, n, now);
  quiet_ = live ? 0 : quiet_ + n;
  if (quiet_ > sr_ / 2) {                               // полсекунды тишины: дека отзвучала — шина не считается
    for (auto& b : body_) for (auto& q : b) q.x1 = q.x2 = q.y1 = q.y2 = 0;
    bodyG_.y = bodyTo_; hallG_.y = hallTo_;
    chorus_.process(pL_, pR_, false, cL_, cR_, n);      // хвост хора дозвучивает и засыпает сам
    for (int k = 0; k < n; k++) {
      const double l = cL_[k], r = cR_[k], g = hallG_.y * OUT;
      out.L[k] = static_cast<float>(l * OUT); out.R[k] = static_cast<float>(r * OUT);
      out.sL[k] = static_cast<float>(l * g); out.sR[k] = static_cast<float>(r * g);
    }
    return;
  }
  for (int k = 0; k < n; k++) {                         // pre → mix (сухо + дека) — на месте в pL_/pR_
    const double bg = bodyG_.step(bodyTo_, c_);
    const double xl = pL_[k], xr = pR_[k];
    double bl = 0, br = 0;
    for (int b = 0; b < 3; b++) { bl += body_[b][0].step(xl); br += body_[b][1].step(xr); }
    pL_[k] = static_cast<float>(xl + bl * bg); pR_[k] = static_cast<float>(xr + br * bg);
  }
  chorus_.process(pL_, pR_, chorusOn_, cL_, cR_, n);
  for (int k = 0; k < n; k++) {                         // post → выход и посыл
    const double l = static_cast<double>(pL_[k]) + cL_[k], r = static_cast<double>(pR_[k]) + cR_[k];
    const double g = hallG_.step(hallTo_, c_) * OUT;    // посыл стоит до out мира, а прежний out ×2.2 был и за возвратом зала
    out.L[k] = static_cast<float>(l * OUT); out.R[k] = static_cast<float>(r * OUT);
    out.sL[k] = static_cast<float>(l * g); out.sR[k] = static_cast<float>(r * g);
  }
}

int World::mirror(double* buf, int cap) const {
  if (!buf || cap < MIRROR_N) return 0;
  double* p = buf;
  for (int k = 0; k < NFX; k++) *p++ = model_.fx(k);
  *p++ = model_.wind(); *p++ = model_.lastWind();
  for (int k = 0; k < NAUTO; k++) *p++ = model_.autoPar(k);
  *p++ = static_cast<double>(steps_.step());
  for (int i = 0; i < N; i++) {
    const Str& s = model_.str(i);
    *p++ = s.r; *p++ = s.sus ? 1 : 0; *p++ = s.bright; *p++ = s.decay; *p++ = s.level; *p++ = s.bow;
    *p++ = sound_.en(i); *p++ = sound_.eh(i); *p++ = sound_.hn(i);
  }
  return MIRROR_N;
}

int World::heard(double* buf, int cap) {
  if (!hits_ || !buf || cap < 2) return 0;
  buf[0] = hits_; buf[1] = static_cast<double>(lastStep_);
  hits_ = 0;
  return 2;
}

}  // namespace monochord

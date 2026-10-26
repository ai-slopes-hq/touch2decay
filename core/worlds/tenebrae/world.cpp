#include "world.hpp"
#include "tone.hpp"
#include <algorithm>
#include <cmath>

namespace tenebrae {

namespace {
constexpr double DLY_REPEATS = 0.46;                    // обратная связь эха
// тише этого (без живых голосов и ударов) 0.5 с — блок не считается; −120 дБ: у asym в нуле постоянка ~1e-8, через эхо — ~1e-7
constexpr double QUIET = 1e-6;

// setTargetAtTime, прошедший n сэмплов без расчёта (мир молчит): y — туда, где он был бы
void skip(sdk::Glide& g, int n) { g.y = g.to + (g.y - g.to) * std::pow(1 - g.c, n); }
}  // namespace

void World::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  if (!built_) { T_.build(); built_ = true; }           // таблицы не зависят от частоты — один раз
  const uint32_t ws = seed ^ 0x54454eu;                 // зерно мира
  nz_ = sdk::Rng(ws);
  rs_ = sdk::Rng(ws ^ 0x53545249u);
  for (int i = 0; i < VOICES; i++) {
    v_[i].prepare(sr_, ws, &T_, i);
    has_[i] = false; rm_[i] = 0; nl_[i] = 0;
    for (double& x : a_[i]) x = 0;
  }
  // узлы шины при создании (createEngine): bus 1, pre 0.8, post 1, посылы эха и зала — 0
  bus_.set(1, 0.3, sr_); bus_.jump(1);
  pre_.set(0.8, 0.05, sr_); pre_.jump(0.8);
  post_.set(1, 0.05, sr_); post_.jump(1);
  dly_.set(0, 0.05, sr_); dly_.jump(0);
  rev_.set(0, 0.05, sr_); rev_.jump(0);
  // asym(2.4, 0.35) — как host/audio.js: Float32Array tanh(k·x + bias) − tanh(bias), потом деление на пик
  {
    sdk::Shaper<4096>& d = drv_.curve;
    const double o = std::tanh(0.35);
    double peak = 0;
    for (int i = 0; i < 4096; i++) {
      const double x = static_cast<double>(i) / 4095 * 2 - 1;
      d.c[i] = static_cast<float>(std::tanh(2.4 * x + 0.35) - o);
      peak = std::max(peak, std::fabs(static_cast<double>(d.c[i])));
    }
    for (float& c : d.c) c = static_cast<float>(c / peak);
    drv_.os = 4; drv_.reset();
  }
  echo_.prepare(sr_, 0.37, 2600, -3, DLY_REPEATS);
  // Chromium рвёт цикл пинг-понга на звене dL → dR (тянут dL, он же — вход dR): правая нога на квант позже
  // (замер: dL 300 + dR 500 → правый повтор через 928) — в ядре это +128 сэмплов к времени dR
  echo_.setSec(0.37, 0.53 + 128 / sr_);
  echo_.setLp(2600, 2100, -3);
  wowL_.reset(); wowR_.reset();
  for (Strike& s : st_) s.on = false;
  scApplied_ = sc_;
  now_ = 0;
  quiet_ = std::lround(0.5 * sr_);                      // пока ничего не прислали — не считается
}

// linkDepth: fm — до ±2 октав (ц); tzfm — индекс до 5 от частоты источника (Гц); am — полная; rm — громкий
double World::depthOf(const Link& l) const {
  switch (l.type) {
    case FM: return l.depth * 2400;
    case TZFM: return l.depth * 5 * (has_[l.src] ? freqOf(a_[l.src][0], sc_) : 0);
    case AM: return l.depth;
    default: return l.depth * 1.6;
  }
}

// apply(i, snap): поля голоса; fmOpen и база vca — от связей; глубины связей приёмника — к своим целям
void World::applyVoice(int i, bool snap) {
  if (!has_[i]) return;                                 // как в вебе: до первого voice() apply не идёт
  double a[NFIELD];
  for (int k = 0; k < NFIELD; k++) a[k] = a_[i][k];
  a[10] = snap ? 1 : 0;
  double fmo = a[6], rm = 0;
  for (int k = 0; k < nl_[i]; k++) {
    const Link& l = L_[i][k];
    if (l.type == FM || l.type == TZFM) fmo += l.depth;
    else if (l.type == RM) rm += l.depth;
  }
  rm_[i] = rm;
  v_[i].rm(rm);
  v_[i].set(a, freqOf(a[0], sc_), std::min(1.0, fmo));
  const double tau = (snap ? 0.004 : 0.08) * sr_;
  for (int k = 0; k < nl_[i]; k++) L_[i][k].g.target(depthOf(L_[i][k]), now_, tau);
}

// лад меняют без VOICE (лад мог прийти после голосов кадра, хост натива меняет его сам): частоты по новому ладу, τ apply;
// apply приёмника пересчитывает и его глубины tzfm (Гц от частоты источника). Сверка — в начале action и process:
// VOICE после смены лада ляжет поверх (его snap не перебьётся медленным apply). Без аллокаций
void World::retune() {
  if (sc_.on == scApplied_.on && sc_.idx == scApplied_.idx && sc_.root == scApplied_.root) return;
  scApplied_ = sc_;
  for (int i = 0; i < VOICES; i++) applyVoice(i, false);
}

// весь список связей приёмника: та же пара источник + тип сохраняет свою глубину (узел), новая — от нуля, пропавшая — снята
void World::setLinks(int i, const double* a, int n) {
  static Link next[MAXLINK];                            // не на стек (~32 КБ); не в process
  bool used[MAXLINK] = {};
  int m = 0;
  bool changed = false;
  for (int q = 0; q + 3 <= n && m < MAXLINK; q += 3) {
    const int src = static_cast<int>(a[q]), type = static_cast<int>(a[q + 1]);
    if (src < 0 || src >= VOICES || type < FM || type > RM) continue;
    int j = -1;
    for (int k = 0; k < nl_[i]; k++) if (!used[k] && L_[i][k].src == src && L_[i][k].type == type) { j = k; break; }
    Link& l = next[m++];
    if (j >= 0) { used[j] = true; l.g = L_[i][j].g; if (L_[i][j].depth != a[q + 2]) changed = true; }
    else { changed = true; l.g.reset(0); }
    l.src = src; l.type = type; l.depth = a[q + 2];
  }
  for (int k = 0; k < nl_[i]; k++) if (!used[k]) changed = true;
  for (int k = 0; k < m; k++) { L_[i][k].src = next[k].src; L_[i][k].type = next[k].type; L_[i][k].depth = next[k].depth; L_[i][k].g = next[k].g; }
  nl_[i] = m;
  if (changed) applyVoice(i, false);
}

void World::action(int kind, int i, const double* a, int n) {
  retune();
  if (kind == FX) {
    if (n < 3) return;
    const double rev = a[0], dly = a[1], dirt = std::max(0.0, a[2]);
    rev_.set(rev * rev * 1.4, 0.05, sr_);
    dly_.set(dly * 0.7, 0.05, sr_);
    pre_.set(0.45 + std::pow(dirt, 1.4) * 14, 0.05, sr_);   // до ~15× в перегруз
    post_.set(2.2 / (1 + 4 * std::pow(dirt, 0.8)), 0.05, sr_);   // громкость примерно ровная по всему ходу
    return;
  }
  if (kind == STRIKE) { if (n >= 1) strike(a[0]); return; }
  if (kind == CLEAR) {
    for (int k = 0; k < VOICES; k++) {
      setLinks(k, nullptr, 0);
      if (v_[k].isLive()) v_[k].off(0.25);
    }
    return;
  }
  if (i < 0 || i >= VOICES) return;
  switch (kind) {
    case VOICE: {
      if (n < NFIELD) return;
      for (int k = 0; k < NFIELD; k++) a_[i][k] = a[k];
      has_[i] = true;
      applyVoice(i, a[10] != 0);
      // tzfm от этого голоса: глубина в Гц идёт за его частотой — у приёмников пересчитать только её
      for (int u = 0; u < VOICES; u++) {
        if (u == i || !has_[u]) continue;
        for (int k = 0; k < nl_[u]; k++) {
          Link& l = L_[u][k];
          if (l.src == i && l.type == TZFM) l.g.target(depthOf(l), now_, 0.08 * sr_);
        }
      }
      break;
    }
    case ON: v_[i].on(); break;
    case OFF: v_[i].off(n >= 1 ? a[0] : 0.25); break;
    case LIVE: v_[i].live(n >= 1 && a[0] != 0); break;
    case LINKS: setLinks(i, a, n); break;
    case LFO: if (n >= 4) v_[i].lfo(static_cast<int>(a[0]), a[1], a[2], a[3]); break;
    default: break;                                     // −1 — тик хоста
  }
}

// удар по солнцу: треск — шум в полосе 1800…4400 Гц двумя щелчками; глухой толчок — синус 140 → 45 Гц. Всё — в шину
void World::strike(double p) {
  p = clamp01(p);
  Strike* s = &st_[0];
  for (Strike& q : st_) { if (!q.on) { s = &q; break; } if (q.t0 < s->t0) s = &q; }
  const double t = now_, lvl = 0.05 + 0.1 * p;
  const double f = 1800 + 2600 * rs_.next();
  const double t2 = t + (0.012 + 0.02 * rs_.next()) * sr_;
  s->bp = sdk::Biquad{};
  s->bp.set(sdk::Biquad::bandpass, f, 1.2, sr_);
  s->ng.reset(0);
  s->ng.set(lvl, t); s->ng.exp(lvl * 0.08, t2);
  s->ng.set(lvl * 0.7, t2); s->ng.exp(0.0005, t2 + (0.04 + 0.06 * p) * sr_);
  s->nEnd = t2 + 0.12 * sr_;
  s->o.reset();
  s->of.reset(440); s->of.set(140, t); s->of.exp(45, t + 0.08 * sr_);
  s->og.reset(0); s->og.set(lvl * 1.4, t); s->og.exp(0.0005, t + 0.12 * sr_);
  s->oEnd = t + 0.14 * sr_;
  s->t0 = t;
  s->on = true;
}

double World::strikeStep(double t) {
  double y = 0;
  for (Strike& s : st_) {
    if (!s.on) continue;
    if (t < s.nEnd) y += s.bp.step(rs_.next() * 2 - 1) * s.ng.step(t);
    if (t < s.oEnd) y += s.o.sine(s.of.step(t) / sr_) * s.og.step(t);
    if (t + 1 >= s.nEnd && t + 1 >= s.oEnd) s.on = false;
  }
  return y;
}

void World::process(const sdk::Out& out, int n) {
  if (n <= 0) return;
  if (n > 128) n = 128;
  retune();
  bool live = false, strk = false;
  double envSum = 0;
  for (const Voice& v : v_) if (v.isLive()) { live = true; envSum += v.env(); }
  for (const Strike& s : st_) strk = strk || s.on;
  for (int r = 0; r < VOICES; r++) for (int k = 0; k < nl_[r]; k++) L_[r][k].g.fill(L_[r][k].b, n, now_);   // время связей идёт всегда
  bus_.to = 1 / std::sqrt(std::max(1.0, envSum));      // чем больше кружков, тем тише каждый (огибающие ядра, раз в блок)

  if (!live && !strk && quiet_ >= std::lround(0.5 * sr_)) {   // тишина: не считать, только время
    for (int k = 0; k < n; k++) out.L[k] = out.R[k] = out.sL[k] = out.sR[k] = 0;
    for (sdk::Glide* g : {&bus_, &pre_, &post_, &dly_, &rev_}) skip(*g, n);
    wowL_.adv(0.13 * n / sr_); wowR_.adv(0.087 * n / sr_);
    now_ += n;
    return;
  }

  double peak = 0;
  for (int k = 0; k < n; k++) {
    const double noise = nz_.next() * 2 - 1;            // общий шум голосов на этот сэмпл
    for (Voice& v : v_) v.prestep();
    double sL = 0, sR = 0;
    // голоса: всё до перегруза, перегруз всех живых одной пачкой (цепочки FIR параллельно), остальное — по голосу; до бита как v.step
    int nv = 0, idx[VOICES];
    double io[2 * VOICES];
    sdk::TanhShaper2* sat[VOICES];
    for (int r = 0; r < VOICES; r++) {
      Voice& v = v_[r];
      if (!v.isLive()) continue;
      ModIn in{0, 0, 0, rm_[r], noise};
      for (int j = 0; j < nl_[r]; j++) {
        const Link& l = L_[r][j];
        const double m = v_[l.src].modOut() * l.b[k];
        if (l.type == FM) in.fmCents += m;
        else if (l.type == TZFM) in.tzHz += m;
        else in.vcaAdd += m;
      }
      v.pre(in, io + 2 * nv);
      sat[nv] = &v.sat();
      idx[nv++] = r;
    }
    sdk::TanhShaper2::stepN(sat, io, nv);
    for (int q = 0; q < nv; q++) {
      double L, R;
      v_[idx[q]].post(io + 2 * q, L, R);
      sL += L; sR += R;
    }
    if (strk) { const double s = strikeStep(now_ + k); sL += s; sR += s; }   // моно в стерео-шину
    const double g = bus_.step() * pre_.step(), po = post_.step();
    double dL = sL * g, dR = sR * g;
    drv_.run(dL, dR);                                   // L и R вместе — до бита как два Shaper::run
    const double yL = dL * po, yR = dR * po;
    double eL, eR;
    echo_.step(0.5 * (yL + yR) * dly_.step(), eL, eR, 0.004 * wowL_.sine(0.13 / sr_), 0.005 * wowR_.sine(0.087 / sr_));
    const double oL = yL + eL, oR = yR + eR, rv = rev_.step();
    out.L[k] = static_cast<float>(oL); out.R[k] = static_cast<float>(oR);
    out.sL[k] = static_cast<float>(oL * rv); out.sR[k] = static_cast<float>(oR * rv);
    peak = std::max(peak, std::max(std::fabs(oL), std::fabs(oR)));
  }
  now_ += n;
  quiet_ = (!live && !strk && peak < QUIET) ? quiet_ + n : 0;
}

int World::mirror(double* buf, int cap) const {
  if (!buf || cap < MIRROR_N) return 0;
  buf[0] = VOICES;
  bool any = false;
  for (const Voice& v : v_) any = any || v.isLive();
  if (!any) return MIRROR_HEAD;                         // ни одного живого — контуров нет: ворклет не копирует и не шлёт 781 число 60 раз в с
  for (int i = 0; i < VOICES; i++) {
    double* m = buf + MIRROR_HEAD + i * MIRROR_V;
    const Voice& v = v_[i];
    m[0] = v.isLive() ? 1 : 0;
    m[1] = v.env();
    if (v.isLive() && has_[i]) v.scope(m + 2);
    else for (int j = 0; j < 128; j++) m[2 + j] = 0;
  }
  return MIRROR_N;
}

bool World::sounding() const {
  for (const Voice& v : v_) if (v.isLive() && v.env() > 0.004) return true;
  return false;
}

}  // namespace tenebrae

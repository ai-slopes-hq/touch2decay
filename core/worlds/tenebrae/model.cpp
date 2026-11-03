#include "model.hpp"
#include <cmath>
#include "../../sdk/jsmath.hpp"
#include "../../sdk/json.hpp"

namespace tenebrae {

namespace {
const char* const LINK_NAMES[4] = {"fm", "tzfm", "am", "rm"};
const char* const LFO_NAMES[NLFO] = {"pitch", "wave", "cut", "res", "beat", "shift", "amp", "fm"};
double lerpLog(double lo, double hi, double t) { return lo * std::pow(hi / lo, t); }
double r4(double x) { return sdk::jsRound(x * 1e4) / 1e4; }
bool okIdx(int i) { return i >= 0 && i < VOICES; }
}  // namespace

void Model::reset(uint32_t seed) {
  rng_ = sdk::Rng(seed);
  for (MVoice& v : V_) v = MVoice();
  const double d[5] = {0.3, 3.5, 0.3, 0, 0.2};
  for (int k = 0; k < 5; k++) fx_[k] = d[k];
  nkept_ = 0; nq_ = 0; strikes_ = 0;
  time_ = chaosAt_ = 0;
}

void Model::attack(int i) {
  MVoice& v = V_[i];
  v.active = true; v.envT = 1; v.envTau = 0.12;
  if (!v.live) { v.live = true; const double one = 1; emit(3, i, &one, 1); }   // LIVE: молчащий кружок отключён от графа
  emit(1, i);                                           // ON
}

void Model::release(int i, double tau) {
  MVoice& v = V_[i];
  v.envT = 0; v.envTau = tau;
  emit(2, i, &tau, 1);                                  // OFF
}

void Model::removeLfo(MVoice& v, int key) {
  if (!v.lfo[key].on) return;
  v.lfo[key].on = false;
  int w = 0;
  for (int k = 0; k < v.nlfo; k++) if (v.lfoOrder[k] != key) v.lfoOrder[w++] = v.lfoOrder[k];
  v.nlfo = w;
  const double a[4] = {static_cast<double>(key), 0, 0, 0};
  emit(5, static_cast<int>(&v - V_), a, 4);
}

void Model::clearLfos(MVoice& v) {
  while (v.nlfo > 0) removeLfo(v, v.lfoOrder[0]);       // по порядку добавления, как Object.keys
}

Mod* Model::addLink(MVoice& dst, int src, double depth, int type) {
  if (dst.nmods >= MAXMOD) return nullptr;
  Mod& m = dst.mods[dst.nmods++];
  m = Mod();
  m.src = src; m.type = type; m.depth = depth;
  dst.dirty = true;
  return &m;
}

void Model::dropLink(MVoice& dst, int k) {
  for (int j = k; j + 1 < dst.nmods; j++) dst.mods[j] = dst.mods[j + 1];
  dst.nmods--;
  dst.dirty = true;
}

Mod* Model::findMod(MVoice& v, int src) {
  for (int k = 0; k < v.nmods; k++) if (v.mods[k].src == src) return &v.mods[k];
  return nullptr;
}

void Model::unlinkAll(MVoice& v) {
  const int id = static_cast<int>(&v - V_);
  v.nmods = 0;
  v.dirty = true;
  for (MVoice& u : V_) {
    int w = 0;
    for (int k = 0; k < u.nmods; k++) {
      if (u.mods[k].src == id) u.dirty = true;
      else u.mods[w++] = u.mods[k];
    }
    u.nmods = w;
  }
}

int Model::pick() const {
  int temps = 0;
  for (const MVoice& u : V_) if (u.active && !u.pinned) temps++;
  int v = -1;
  if (temps < TEMP_MAX) for (int k = 0; k < VOICES; k++) if (!V_[k].active) { v = k; break; }
  if (v < 0) {
    for (int k = 0; k < VOICES; k++) {                  // мест нет — уступает только затухающий временный (самый тихий)
      const MVoice& u = V_[k];
      if (!u.active || u.pinned || u.held || isKept(k) || u.envT != 0) continue;
      if (v < 0 || u.env < V_[v].env) v = k;
    }
  }
  return v;
}

void Model::spawn(int i, double p, double c, double holeT) {
  if (!okIdx(i)) return;
  MVoice& v = V_[i];
  v.held = 0;
  unlinkAll(v);
  clearLfos(v);
  v.x = p; v.y = c; v.holeT = holeT;
  v.beat = BEAT_DEF; v.wave = WAVE_DEF; v.fm = 0; v.cut = CUT_DEF; v.res = RES_DEF; v.shift = SHIFT_DEF; v.amp = 1;
  v.pinned = false;
  v.snap = v.env < 0.02; v.dirty = true;
  attack(i);
}

void Model::grab(int i) { if (okIdx(i) && V_[i].active) V_[i].held++; }

void Model::letGo(int i, bool fade) {
  if (!okIdx(i)) return;
  MVoice& v = V_[i];
  if (!v.held) return;
  v.held--;
  if (fade && !v.held && !v.pinned && !isKept(i)) release(i, TAIL);
}

void Model::keep(const int* ids, int n) {
  nkept_ = 0;
  for (int k = 0; k < n && nkept_ < NKEPT; k++) if (okIdx(ids[k])) kept_[nkept_++] = ids[k];
}

void Model::unkeep() {
  int old[NKEPT], n = nkept_;
  for (int k = 0; k < n; k++) old[k] = kept_[k];
  nkept_ = 0;
  for (int k = 0; k < n; k++) {
    const MVoice& v = V_[old[k]];
    if (v.active && !v.pinned && !v.held) release(old[k], TAIL);
  }
}

void Model::move(int i, double p, double c, double holeT) {
  if (!okIdx(i) || !V_[i].active) return;
  MVoice& v = V_[i];
  v.x = p; v.y = c; v.holeT = holeT;
  v.dirty = true;
}

void Model::set(int i, int key, double val) {
  if (!okIdx(i) || !V_[i].active) return;
  MVoice& v = V_[i];
  switch (key) {
    case 0: v.wave = val; break;
    case 1: v.cut = val; break;
    case 2: v.res = val; break;
    case 3: v.beat = val; break;
    case 4: v.fm = val; break;
    case 5: v.shift = val; break;
    case 6: v.amp = val; break;
    default: return;
  }
  v.dirty = true;
}

int Model::pin(int i) {
  if (!okIdx(i) || !V_[i].active) return 0;
  MVoice& v = V_[i];
  push(1, i);
  if (v.pinned) {
    v.pinned = false;
    if (!v.held && !isKept(i)) release(i, UNPIN_TAIL);
    return 2;
  }
  int pins = 0;
  for (const MVoice& u : V_) if (u.active && u.pinned) pins++;
  if (pins >= PIN_MAX) {                                // закреплённых уже три — отказ
    if (!v.held && !isKept(i)) release(i, TAIL);
    return 3;
  }
  v.pinned = true;
  return 1;
}

void Model::remove(int i) {
  if (!okIdx(i) || !V_[i].active) return;
  MVoice& v = V_[i];
  v.pinned = false; v.held = 0;
  unlinkAll(v);
  release(i, 0.25);
  push(1, i);
  int w = 0;
  for (int k = 0; k < nkept_; k++) if (kept_[k] != i) kept_[w++] = kept_[k];
  nkept_ = w;
}

void Model::link(int dst, int src) {
  if (!okIdx(dst) || !okIdx(src) || dst == src) return;
  MVoice& d = V_[dst];
  Mod* m = findMod(d, src);
  if (!m) m = addLink(d, src, LINK_NEW, 1);
  if (!m) return;
  m->autoLink = false; d.dirty = true;
}

void Model::linkDepth(int dst, int src, double depth) {
  if (!okIdx(dst)) return;
  Mod* m = findMod(V_[dst], src);
  if (!m) return;
  m->depth = depth; V_[dst].dirty = true;
}

void Model::linkType(int dst, int src, int type) {
  if (!okIdx(dst) || type < 0 || type > 3) return;
  Mod* m = findMod(V_[dst], src);
  if (!m) return;
  m->type = type; V_[dst].dirty = true;
}

void Model::unlink(int dst, int src) {
  if (!okIdx(dst)) return;
  MVoice& d = V_[dst];
  for (int k = 0; k < d.nmods; k++) if (d.mods[k].src == src) { dropLink(d, k); return; }
}

void Model::lfo(int i, int key, const double* spec) {
  if (!okIdx(i) || !V_[i].active || key < 0 || key >= NLFO) return;
  MVoice& v = V_[i];
  if (!spec) {
    removeLfo(v, key);
    v.dirty = true;
    return;
  }
  LfoSpec& s = v.lfo[key];
  const bool isNew = !s.on;
  s.morph = spec[0]; s.rate = spec[1]; s.depth = spec[2];
  if (isNew) {
    s.on = true;
    v.lfoOrder[v.nlfo++] = key;
    const double a[4] = {static_cast<double>(key), s.morph, s.rate, s.depth};
    emit(5, i, a, 4);
  }
  v.dirty = true;
}

void Model::emitFx() {
  const double a[3] = {fx_[0], fx_[2], fx_[4]};
  emit(6, 0, a, 3);
}

void Model::fx(const double v[5]) {
  for (int k = 0; k < 5; k++) fx_[k] = v[k];
  emitFx();
}

// хаос: слабые случайные связи между звучащими кружками, которые сами меняются
void Model::chaos() {
  int act[VOICES], na = 0;
  for (int k = 0; k < VOICES; k++) if (V_[k].active) act[na++] = k;
  const double c = fx_[3];
  for (int i = 0; i < VOICES; i++) {
    MVoice& v = V_[i];
    int au = -1;
    for (int k = 0; k < v.nmods; k++) if (v.mods[k].autoLink) { au = k; break; }
    if (!v.active || c < 0.02 || na < 2) { if (au >= 0) dropLink(v, au); continue; }
    if (au >= 0 && time_ < v.mods[au].until && V_[v.mods[au].src].active) { v.mods[au].depth = c * v.mods[au].k; v.dirty = true; continue; }
    if (au >= 0) dropLink(v, au);
    if (rng_.next() > 0.35) continue;                   // не все сразу
    int cands[VOICES], nc = 0;
    for (int q = 0; q < na; q++) {
      const int u = act[q];
      if (u == i) continue;
      bool has = false;
      for (int k = 0; k < v.nmods; k++) if (v.mods[k].src == u) has = true;
      if (!has) cands[nc++] = u;
    }
    if (!nc) continue;
    const int src = cands[static_cast<int>(std::floor(rng_.next() * nc))];
    const int type = static_cast<int>(std::floor(rng_.next() * 4));
    Mod* m = addLink(v, src, 0, type);
    if (!m) continue;
    m->autoLink = true;
    m->k = 0.15 + rng_.next() * 0.4;
    m->depth = c * m->k;
    m->until = time_ + 3 + rng_.next() * 7;
  }
}

// планету держат на солнце — оно бьёт: чем глубже, тем чаще
void Model::strikesStep() {
  for (int i = 0; i < VOICES; i++) {
    MVoice& v = V_[i];
    if (v.held <= 0 || v.sunT <= 0 || time_ < v.strikeNext) continue;
    const double t = v.sunT;
    v.strikeNext = time_ + (0.44 - 0.32 * t) * (0.6 + 0.8 * rng_.next());
    emit(7, 0, &t, 1);                                  // STRIKE
    strikes_++;
    push(2, i, t);
  }
}

// голос изменился: связи и LFO — до полей, чтобы голос применился один раз (и со snap)
void Model::sync(MVoice& v, int i) {
  double a[MAXMOD * 3];
  for (int k = 0; k < v.nmods; k++) { a[3 * k] = v.mods[k].src; a[3 * k + 1] = v.mods[k].type; a[3 * k + 2] = v.mods[k].depth; }
  emit(4, i, a, 3 * v.nmods);
  for (int key = 0; key < NLFO; key++) {
    const LfoSpec& s = v.lfo[key];
    const double l[4] = {static_cast<double>(key), s.on ? s.morph : 0, s.on ? s.rate : 0, s.on ? s.depth : 0};
    emit(5, i, l, 4);
  }
  const double f[11] = {v.x, v.y, v.cut, v.res, v.wave, v.beat, v.fm, v.shift, v.amp, v.holeT, v.snap ? 1.0 : 0.0};
  emit(0, i, f, 11);
  v.snap = false;
}

void Model::tick(double dt) {
  time_ += dt;
  if (time_ > chaosAt_) { chaosAt_ = time_ + 0.4; chaos(); }
  strikesStep();
  for (int i = 0; i < VOICES; i++) {
    MVoice& v = V_[i];
    if (v.dirty) { v.dirty = false; sync(v, i); }
    v.env += (v.envT - v.env) * (1 - std::exp(-dt / v.envTau));
    if (v.active && v.holeT > 0.9 && !v.held && v.envT != 0) { v.pinned = false; release(i, 0.4); }   // отпущена в глубине дыры — умирает
    if (v.active && !v.pinned && !v.held && v.envT == 0 && v.env < 0.004) {
      v.active = false;
      unlinkAll(v);
      clearLfos(v);
      if (v.live) { v.live = false; const double zero = 0; emit(3, i, &zero, 1); }
    }
  }
}

void Model::retune() { for (MVoice& v : V_) v.dirty = true; }

// кубик: случайный тембр живым (не гаснущим) голосам, их ручным связям и LFO; пусто — false, rng не тронут
bool Model::dice() {
  bool any = false;
  for (const MVoice& v : V_) if (v.active && v.envT > 0) any = true;
  if (!any) return false;
  for (int i = 0; i < VOICES; i++) {
    MVoice& v = V_[i];
    if (!(v.active && v.envT > 0)) continue;
    v.wave = rng_.next();
    v.cut = 0.3 + 0.62 * rng_.next();
    v.res = 0.75 * std::pow(rng_.next(), 1.5);
    v.beat = lerpLog(BEAT_MIN, BEAT_MAX, 0.85 * rng_.next());
    v.fm = rng_.next() < 0.45 ? 0 : 0.7 * rng_.next();
    v.shift = rng_.next() < 0.5 ? SHIFT_DEF : rng_.next();
    for (int k = 0; k < v.nmods; k++) {
      Mod& m = v.mods[k];
      if (m.autoLink) continue;
      m.type = static_cast<int>(std::floor(rng_.next() * 4));
      m.depth = 0.15 + 0.75 * rng_.next();
    }
    for (int k = 0; k < v.nlfo; k++) {
      LfoSpec& s = v.lfo[v.lfoOrder[k]];
      s.morph = rng_.next();
      s.rate = lerpLog(LFO_RATE_MIN, LFO_RATE_MAX, 0.15 + 0.7 * rng_.next());
    }
    v.dirty = true;
    push(1, i);
  }
  return true;
}

// все активные гаснут за 0.25 с; движок забывает связи и LFO
void Model::clear() {
  for (int i = 0; i < VOICES; i++) if (V_[i].active) remove(i);
  emit(8, 0);
  nkept_ = 0;
}

std::string Model::snapshot() const {
  bool inSnap[VOICES] = {};
  for (int i = 0; i < VOICES; i++) inSnap[i] = V_[i].active && V_[i].pinned;
  sdk::Json vs = sdk::Json::array();
  for (int i = 0; i < VOICES; i++) {
    if (!inSnap[i]) continue;
    const MVoice& v = V_[i];
    sdk::Json o = sdk::Json::object();
    o.set("i", sdk::Json::num(i));
    o.set("x", sdk::Json::num(r4(v.x)));
    o.set("y", sdk::Json::num(r4(v.y)));
    o.set("amp", sdk::Json::num(r4(v.amp)));
    o.set("wave", sdk::Json::num(r4(v.wave)));
    o.set("cut", sdk::Json::num(r4(v.cut)));
    o.set("res", sdk::Json::num(r4(v.res)));
    o.set("beat", sdk::Json::num(r4(v.beat)));
    o.set("fm", sdk::Json::num(r4(v.fm)));
    o.set("shift", sdk::Json::num(r4(v.shift)));
    o.set("hole", sdk::Json::num(r4(v.holeT)));
    sdk::Json l = sdk::Json::object();
    for (int k = 0; k < v.nlfo; k++) {
      const int key = v.lfoOrder[k];
      const LfoSpec& s = v.lfo[key];
      sdk::Json e = sdk::Json::object();
      e.set("morph", sdk::Json::num(r4(s.morph)));
      e.set("rate", sdk::Json::num(r4(s.rate)));
      e.set("depth", sdk::Json::num(r4(s.depth)));
      l.set(LFO_NAMES[key], e);
    }
    o.set("lfo", l);
    sdk::Json ms = sdk::Json::array();
    for (int k = 0; k < v.nmods; k++) {
      const Mod& m = v.mods[k];
      if (m.autoLink || !inSnap[m.src]) continue;
      sdk::Json e = sdk::Json::object();
      e.set("src", sdk::Json::num(m.src));
      e.set("type", sdk::Json::str(LINK_NAMES[m.type]));
      e.set("depth", sdk::Json::num(r4(m.depth)));
      ms.push(e);
    }
    o.set("mods", ms);
    vs.push(o);
  }
  sdk::Json f = sdk::Json::object();
  static const char* const FX_NAMES[5] = {"rev", "decay", "dly", "chaos", "dirt"};
  for (int k = 0; k < 5; k++) f.set(FX_NAMES[k], sdk::Json::num(r4(fx_[k])));
  sdk::Json root = sdk::Json::object();
  root.set("v", vs);
  root.set("fx", f);
  return root.dump();
}

void Model::restore(const std::string& js) {
  bool ok = false;
  const sdk::Json st = sdk::Json::parse(js, &ok);
  const sdk::Json* arr = ok ? st.get("v") : nullptr;
  if (!arr || arr->type != sdk::Json::Arr) return;
  auto num = [](const sdk::Json& d, const char* k, double def) {
    const sdk::Json* p = d.get(k);
    return p && p->type == sdk::Json::Num ? p->n : def;
  };
  bool inSnap[VOICES] = {};
  for (const sdk::Json& d : arr->a) { const int i = static_cast<int>(num(d, "i", -1)); if (okIdx(i)) inSnap[i] = true; }
  for (int i = 0; i < VOICES; i++) if (V_[i].active && V_[i].pinned && !inSnap[i]) remove(i);
  for (const sdk::Json& d : arr->a) {
    const int i = static_cast<int>(num(d, "i", -1));
    if (!okIdx(i)) continue;
    MVoice& v = V_[i];
    v.held = 0;
    unlinkAll(v);
    clearLfos(v);
    v.snap = !v.active || v.env < 0.02;
    v.x = num(d, "x", v.x); v.y = num(d, "y", v.y);
    v.amp = num(d, "amp", 1);
    v.wave = num(d, "wave", v.wave); v.cut = num(d, "cut", v.cut); v.res = num(d, "res", v.res);
    v.beat = num(d, "beat", v.beat); v.fm = num(d, "fm", v.fm); v.shift = num(d, "shift", v.shift);
    const double h = num(d, "hole", 0);
    v.holeT = h == h ? h : 0;
    v.pinned = true; v.dirty = true;
    if (!v.active || v.envT == 0) attack(i);
    push(1, i);
  }
  for (const sdk::Json& d : arr->a) {
    const int i = static_cast<int>(num(d, "i", -1));
    if (!okIdx(i)) continue;
    if (const sdk::Json* ms = d.get("mods")) {
      for (const sdk::Json& m : ms->a) {
        int type = 1;
        if (const sdk::Json* t = m.get("type")) for (int q = 0; q < 4; q++) if (t->s == LINK_NAMES[q]) type = q;
        const int src = static_cast<int>(num(m, "src", -1));
        if (okIdx(src)) addLink(V_[i], src, num(m, "depth", 0), type);
      }
    }
    if (const sdk::Json* ls = d.get("lfo")) {
      for (const auto& e : ls->o) {
        for (int key = 0; key < NLFO; key++) {
          if (e.first != LFO_NAMES[key]) continue;
          const double sp[3] = {num(e.second, "morph", LFO_DEF_MORPH), num(e.second, "rate", LFO_DEF_RATE), num(e.second, "depth", LFO_DEF_DEPTH)};
          lfo(i, key, sp);
        }
      }
    }
  }
  if (const sdk::Json* f = st.get("fx")) {
    static const char* const FX_NAMES[5] = {"rev", "decay", "dly", "chaos", "dirt"};
    for (int k = 0; k < 5; k++) fx_[k] = num(*f, FX_NAMES[k], fx_[k]);
    emitFx();
  }
  nkept_ = 0;
}

int Model::heard(double* buf, int cap) {
  int n = 0;
  if (buf) {
    for (int k = 0; k < nq_; k++) {
      const Ev& e = q_[k];
      const int need = e.t == 1 ? 2 : 3;
      if (n + need > cap) break;
      buf[n++] = e.t; buf[n++] = e.i;
      if (e.t == 2) buf[n++] = e.p;
    }
  }
  nq_ = 0;
  return n;
}

}  // namespace tenebrae

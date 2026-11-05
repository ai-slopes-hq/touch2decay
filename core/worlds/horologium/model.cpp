// Horologium — модель в ядре, см. model.hpp.
#include "model.hpp"
#include "drums.hpp"

#include <algorithm>
#include <cmath>
#include "../../sdk/json.hpp"

namespace horologium {

const char* const FX_NAMES[NFX] = {"aequalis", "materia", "concursus", "chance", "hall"};
const double FX_DEF[NFX] = {0, 0.35, 0.4, 1, 0};   // hall 0 по умолчанию (автор, 05.11)
static const int LENS[5] = {16, 16, 12, 8, 6};          // длины колец кубика — LENS в model.js
static const char* const RING_KEYS[NRK] = {"on", "under", "phi", "lvl", "inst", "len", "flt"};

void Model::reset(uint32_t seed) {
  rng_ = sdk::Rng(seed);
  for (int i = 0; i < NR; i++) { r_[i] = Ring{}; r_[i].n = i + 2; r_[i].inst = i; r_[i].on = i < 3; }   // звучат II, III, IV
  for (int k = 0; k < NFX; k++) fx_[k] = FX_DEF[k];
  clock_ = Clock{};
}

double Model::Fnow() const { return clock_.run ? Ft() : 0; }

double Model::mOf(const Ring& r) const {
  const double m = r.under == 1 ? 12.0 / r.n : r.n;
  if (fx_[AEQUALIS] <= 0) return m;
  const double et = std::pow(2.0, std::floor(12 * std::log2(m) + 0.5) / 12);
  return m * std::pow(et / m, fx_[AEQUALIS]);
}

double Model::baseB() const { return 55 * std::pow(2.0, (scale_.on ? scale_.root : 0) / 12.0); }

double Model::pitch(int i) const {
  if (i < 0 || i >= NR || !tonal(r_[i].inst)) return 0;
  const Range rg = pitchRange(r_[i].inst);
  const double f0 = baseB() * mOf(r_[i]);
  if (!std::isfinite(f0) || f0 <= 0) return rg.lo;          // мусорный aequalis: pow ушёл в inf или 0 — иначе циклы октав не кончатся
  double s = 12 * std::log2(f0 / 55);
  if (scale_.on) s = scale_.snapSemi(std::round(s));
  double f = 55 * std::pow(2.0, s / 12);
  if (!std::isfinite(f) || f <= 0) return rg.lo;
  while (f >= rg.hi) f /= 2;
  while (f < rg.lo) f *= 2;
  return f;
}

double Model::tint() const {
  if (!scale_.on) return 1;
  const int r = scale_.root <= 6 ? scale_.root : scale_.root - 12;
  return std::pow(2.0, r / 12.0);
}

void Model::clear() {
  for (int i = 0; i < NR; i++) { r_[i].on = false; r_[i].inst = i; r_[i].len = 16; r_[i].flt = 0.5; }
  clock_.run = false;
}

void Model::setRing(int i, int key, double v) {
  if (i < 0 || i >= NR) return;
  Ring& r = r_[i];
  switch (key) {
    case ON: r.on = v >= 0.5; break;
    case UNDER: r.under = std::isfinite(v) ? (v < 0.5 ? 0 : v < 1.5 ? 1 : 2) : 0; break;
    case PHI: r.phi = v; break;
    case LVL: r.lvl = v; break;
    case INST: if (std::isfinite(v)) r.inst = static_cast<int>(std::lround(std::clamp(v, 0.0, NINST - 1.0))); break;
    case LEN: if (std::isfinite(v)) r.len = static_cast<int>(std::lround(std::clamp(v, 1.0, static_cast<double>(LEN_MAX)))); break;
    case FLT: r.flt = std::isnan(v) ? 0.5 : std::clamp(v, 0.0, 1.0); break;
    default: break;
  }
}

void Model::dice() {                                    // порядок вызовов rng_ — как в model.js
  const int k = 2 + static_cast<int>(rng_.next() * 6);
  const int under = rng_.next() < 0.25 ? 1 : 0;
  for (Ring& r : r_) {
    r.on = r.n >= k && r.n <= k + 2;
    r.under = under; r.lvl = 0.8; r.phi = 0; r.len = 16; r.flt = 0.5;
  }
  for (int n = k; n <= k + 2; n++) {                    // тройка по возрастанию: длина, затем сдвиг в шагах
    Ring& r = r_[n - 2];
    r.len = LENS[static_cast<int>(rng_.next() * 5)];
    r.phi = static_cast<int>(rng_.next() * r.len) / static_cast<double>(r.len);
  }
  fx_[MATERIA] = rng_.next();
  const int pick = static_cast<int>(rng_.next() * 3);   // фильтр — броски только после materia (порядок прежних не меняется): кольцо из трёх, применять ли, знак, глубина
  const bool apply = rng_.next() < 0.5, low = rng_.next() < 0.5;
  const double q = rng_.next();
  if (apply) r_[k - 2 + std::min(pick, 2)].flt = low ? 0.30 + 0.17 * q : 0.53 + 0.12 * q;
  clock_.run = true;
}

bool Model::sounding() const {
  if (!clock_.run) return false;
  for (const Ring& r : r_) if (r.on) return true;
  return false;
}

std::string Model::snapshot() const {
  using sdk::Json;
  Json st = Json::object(), arr = Json::array(), fx = Json::object();
  for (const Ring& r : r_) {
    Json o = Json::object();
    o.set("on", Json::boolean(r.on)); o.set("under", Json::num(r.under)); o.set("phi", Json::num(r.phi)); o.set("lvl", Json::num(r.lvl)); o.set("inst", Json::num(r.inst)); o.set("len", Json::num(r.len)); o.set("flt", Json::num(r.flt));
    arr.push(std::move(o));
  }
  for (int k = 0; k < NFX; k++) fx.set(FX_NAMES[k], Json::num(fx_[k]));
  st.set("r", std::move(arr)); st.set("fx", std::move(fx));
  st.set("bpm", Json::num(clock_.bpm)); st.set("run", Json::boolean(clock_.run));
  return st.dump();
}

void Model::restore(const std::string& js) {
  using sdk::Json;
  bool ok = false;
  const Json st = Json::parse(js, &ok);
  if (!ok || st.type != Json::Obj) return;
  const Json* arr = st.get("r");
  if (!arr || arr->type != Json::Arr) return;           // снимок старого Horologium — не наш
  const auto num = [](const Json& o, const char* k, double& v) { const Json* x = o.get(k); if (x && x->type == Json::Num) v = x->n; };
  const auto flag = [](const Json& o, const char* k, bool& v) { const Json* x = o.get(k); if (x && x->type == Json::Bool) v = x->b; };
  for (int i = 0; i < NR; i++) { r_[i].inst = i; r_[i].len = 16; r_[i].flt = 0.5; }   // старая сцена без inst / len / flt, короткий массив, null — кит и длина по умолчанию
  for (int i = 0; i < NR && i < static_cast<int>(arr->a.size()); i++) {
    const Json& q = arr->a[i];
    if (q.type != Json::Obj) continue;
    if (const Json* x = q.get(RING_KEYS[INST]); x && x->type == Json::Num && std::isfinite(x->n)) setRing(i, INST, x->n);
    if (const Json* x = q.get(RING_KEYS[LEN]); x && x->type == Json::Num) setRing(i, LEN, x->n);
    if (const Json* x = q.get(RING_KEYS[FLT]); x && x->type == Json::Num) setRing(i, FLT, x->n);   // нет или не число — 0.5
    flag(q, RING_KEYS[ON], r_[i].on); if (const Json* x = q.get(RING_KEYS[UNDER])) { if (x->type == Json::Bool) setRing(i, UNDER, x->b ? 1 : 0); else if (x->type == Json::Num) setRing(i, UNDER, x->n); }   // старые сцены: true / false
    num(q, RING_KEYS[PHI], r_[i].phi); num(q, RING_KEYS[LVL], r_[i].lvl);
  }
  if (const Json* fx = st.get("fx"); fx && fx->type == Json::Obj) for (int k = 0; k < NFX; k++) { double v = fx_[k]; num(*fx, FX_NAMES[k], v); setFx(k, v); }
  num(st, "bpm", clock_.bpm); flag(st, "run", clock_.run);
}

}  // namespace horologium

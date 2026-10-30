// Horologium — модель в ядре, см. model.hpp.
#include "model.hpp"

#include <cmath>
#include "../../sdk/json.hpp"

namespace horologium {

const char* const FX_NAMES[NFX] = {"aequalis", "materia", "concursus", "chance", "hall"};
const double FX_DEF[NFX] = {0, 0.35, 0.4, 1, 0.35};
// волшебные наборы колец (n) — MAGIC в model.js
static const int MAGIC[][5] = {{2, 3}, {3, 4}, {4, 5, 6}, {3, 4, 5}, {2, 3, 5}, {4, 5, 6, 7}, {5, 7, 9}, {6, 7, 8, 9}, {8, 9}, {2, 3, 4, 5, 6}, {5, 6}, {4, 5}};
static const int MAGIC_N[] = {2, 2, 3, 3, 3, 4, 3, 4, 2, 5, 2, 2};
static const int NMAGIC = 12;
static const char* const RING_KEYS[NRK] = {"on", "under", "phi", "lvl"};

void Model::reset(uint32_t seed) {
  rng_ = sdk::Rng(seed);
  for (int i = 0; i < NR; i++) { r_[i] = Ring{}; r_[i].n = i + 2; r_[i].on = (i + 2 >= 4 && i + 2 <= 6); }
  for (int k = 0; k < NFX; k++) fx_[k] = FX_DEF[k];
  clock_ = Clock{};
}

double Model::Fnow() const { return clock_.run && !clock_.held ? Ft() * std::pow(2.0, clock_.u) : 0; }

double Model::mOf(const Ring& r) const {
  const double m = r.under ? 12.0 / r.n : r.n;
  if (fx_[AEQUALIS] <= 0) return m;
  const double et = std::pow(2.0, std::floor(12 * std::log2(m) + 0.5) / 12);
  return m * std::pow(et / m, fx_[AEQUALIS]);
}

double Model::baseB() const { return 55 * std::pow(2.0, (scale_.on ? scale_.root : 0) / 12.0); }

void Model::setRing(int i, int key, double v) {
  if (i < 0 || i >= NR) return;
  Ring& r = r_[i];
  switch (key) {
    case ON: r.on = v >= 0.5; break;
    case UNDER: r.under = v >= 0.5; break;
    case PHI: r.phi = v; break;
    case LVL: r.lvl = v; break;
    default: break;
  }
}

void Model::dice() {                                    // порядок вызовов rng_ — как в model.js
  const int s = static_cast<int>(rng_.next() * NMAGIC);
  const bool under = rng_.next() < 0.25;
  for (Ring& r : r_) {
    r.on = false;
    for (int j = 0; j < MAGIC_N[s]; j++) if (MAGIC[s][j] == r.n) r.on = true;
    r.under = under; r.phi = 0; r.lvl = 0.8;
  }
  if (rng_.next() < 0.4) {
    Ring* on[NR]; int k = 0;
    for (Ring& r : r_) if (r.on) on[k++] = &r;
    on[static_cast<int>(rng_.next() * k)]->phi = 0.25 * (1 + static_cast<int>(rng_.next() * 3));
  }
  fx_[MATERIA] = rng_.next();
  clock_.uT = 0; clock_.run = true; clock_.u = 0;
}

void Model::tick(double dt) {
  Clock& c = clock_;
  if (!c.run || c.held || c.strip) return;
  const double d = c.u - c.uT;
  if (d > 0) c.u -= d * dt / 6;                         // раскачанный — медленно успокаивается к своей скорости
  else c.u -= d * dt / 1.5;                             // слабый — спуск подталкивает
  if (std::fabs(c.u - c.uT) < 1e-3) c.u = c.uT;         // иначе u = 0 (замок к такту MIDI) не наступил бы и за час
}

bool Model::sounding() const {
  if (!clock_.run && !clock_.held) return false;
  for (const Ring& r : r_) if (r.on) return true;
  return false;
}

std::string Model::snapshot() const {
  using sdk::Json;
  Json st = Json::object(), arr = Json::array(), fx = Json::object();
  for (const Ring& r : r_) {
    Json o = Json::object();
    o.set("on", Json::boolean(r.on)); o.set("under", Json::boolean(r.under)); o.set("phi", Json::num(r.phi)); o.set("lvl", Json::num(r.lvl));
    arr.push(std::move(o));
  }
  for (int k = 0; k < NFX; k++) fx.set(FX_NAMES[k], Json::num(fx_[k]));
  st.set("r", std::move(arr)); st.set("fx", std::move(fx));
  st.set("bpm", Json::num(clock_.bpm)); st.set("run", Json::boolean(clock_.run)); st.set("u", Json::num(clock_.u)); st.set("uT", Json::num(clock_.uT));
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
  for (int i = 0; i < NR && i < static_cast<int>(arr->a.size()); i++) {
    const Json& q = arr->a[i];
    if (q.type != Json::Obj) continue;
    flag(q, RING_KEYS[ON], r_[i].on); flag(q, RING_KEYS[UNDER], r_[i].under); num(q, RING_KEYS[PHI], r_[i].phi); num(q, RING_KEYS[LVL], r_[i].lvl);
  }
  if (const Json* fx = st.get("fx"); fx && fx->type == Json::Obj) for (int k = 0; k < NFX; k++) num(*fx, FX_NAMES[k], fx_[k]);
  num(st, "bpm", clock_.bpm); flag(st, "run", clock_.run);
  clock_.u = 0; clock_.uT = 0;
  num(st, "u", clock_.u); num(st, "uT", clock_.uT);
}

}  // namespace horologium

// Arcadia — модель в ядре, см. model.hpp.
#include "model.hpp"

#include <cmath>
#include "../../sdk/json.hpp"

namespace arcadia {

const char* const FX_NAMES[NFX] = {"relief", "pace", "wind", "chorus", "phaser", "spread", "hall"};
const char* const KEY_NAMES[NKEY] = {"u", "v", "oct", "r", "fig", "mode", "sp", "lvl"};
const double FX_DEF[NFX] = {0.3, 0.35, 0, 0.35, 0, 0.6, 0.4};
const double KEY_DEF[NKEY] = {0, 0, 0, 0.16, 0, 2, 0.22, 0.8};

static double jsRound(double x) { const double r = std::floor(x); return x - r >= 0.5 ? r + 1 : r; }   // Math.round

double depthOf(double v) {
  const double q1 = 1 / (1 + K), q = 1 / (1 + K * (v + 1) / 2);
  return 1 - (q - q1) / (1 - q1);
}

void Model::reset() {
  for (auto& t : t_) t = Trav{};
  nord_ = 0;
  for (int k = 0; k < NFX; k++) fx_[k] = FX_DEF[k];
  cur_ = &a_; want_ = SEED0; waiting_ = false; blocks_ = 0;
  gen_.start(SEED0, &a_); gen_.run();                   // первая страна — сразу
}

int Model::freeSlot() const { for (int s = 0; s < VMAX; s++) if (!t_[s].on) return s; return -1; }

bool Model::add(int slot, const double* k) {
  if (slot < 0 || slot >= VMAX || t_[slot].on) return false;
  Trav& t = t_[slot];
  t.on = true;
  for (int j = 0; j < NKEY; j++) t.k[j] = k[j];
  t.n = 0;
  ord_[nord_++] = slot;
  return true;
}

void Model::drop(int slot) {
  if (slot < 0 || slot >= VMAX || !t_[slot].on) return;
  t_[slot].on = false; t_[slot].n = 0;
  int w = 0;
  for (int j = 0; j < nord_; j++) if (ord_[j] != slot) ord_[w++] = ord_[j];
  nord_ = w;
}

void Model::move(int slot, double u, double v) { if (slot >= 0 && slot < VMAX && t_[slot].on) { t_[slot].k[U] = u; t_[slot].k[V] = v; } }
void Model::set(int slot, int key, double v) { if (slot >= 0 && slot < VMAX && t_[slot].on && key >= 0 && key < NKEY) t_[slot].k[key] = v; }

void Model::route(int slot) {                           // путь вниз (к воде) или вверх (к вершине) по склону от дома
  Trav& t = t_[slot];
  t.n = routeOf(cur_->z, cur_->lake, t.k[U], t.k[V], t.k[MODE], t.route);
}

void Model::newLand(uint32_t seed) {
  want_ = seed;
  gen_.start(seed, cur_ == &a_ ? &b_ : &a_);           // в другую половину; звучащая не трогается
  waiting_ = false; blocks_ = 0;
}

bool Model::stepLand() {
  if (!gen_.busy() && !waiting_) return false;
  blocks_++;
  if (gen_.busy() && gen_.step()) waiting_ = true;
  if (waiting_ && blocks_ >= LAND_BLOCKS) {
    waiting_ = false;
    cur_ = cur_ == &a_ ? &b_ : &a_;
    return true;
  }
  return false;
}

double Model::hzOf(int slot) const {                    // вглубь — выше: две октавы от нижней рамки до горизонта; с ладом — ступени
  const Trav& t = t_[slot];
  double s = jsRound(depthOf(t.k[V]) * SEMIS) + (scale_.on ? scale_.root : 0);
  if (scale_.on) s = scale_.snapSemi(s + 12) - 12;
  return 110 * std::pow(2.0, s / 12) * std::pow(2.0, t.k[OCT]);
}

std::string Model::snapshot() const {
  using sdk::Json;
  Json st = Json::object(), arr = Json::array(), fx = Json::object();
  for (int j = 0; j < nord_; j++) {
    const Trav& t = t_[ord_[j]];
    Json o = Json::object();
    for (int k = 0; k < NKEY; k++) o.set(KEY_NAMES[k], Json::num(t.k[k]));
    arr.push(std::move(o));
  }
  for (int k = 0; k < NFX; k++) fx.set(FX_NAMES[k], Json::num(fx_[k]));
  st.set("seed", Json::num(want_)); st.set("t", std::move(arr)); st.set("fx", std::move(fx));
  return st.dump();
}

}  // namespace arcadia

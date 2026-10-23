// Oceanus — модель в ядре, см. model.hpp.
#include "model.hpp"

#include <cmath>
#include "../../sdk/json.hpp"

namespace oceanus {

namespace {
constexpr double TAU = 6.283185307179586;
inline double jsRound(double x) { double r = std::floor(x); return (x - r >= 0.5) ? r + 1 : r; }   // Math.round
}  // namespace

const char* const FX_NAMES[NFX] = {"tension", "damping", "wind", "tide", "hall"};
const char* const LUNA_NAMES[NLUNA] = {"orbit", "storm", "sway", "to"};
const double FX_DEF[NFX] = {0.45, 0.4, 0, 0.55, 0.4};
const double LUNA_DEF[NLUNA] = {0.45, 0, 0, 0};
static const char* const VOICE_KEYS[] = {"ang", "rn", "lvl", "oct", "path"};

void Model::reset(uint32_t seed) {
  rng_ = sdk::Rng(seed);
  n_ = 0; serial_ = 0;
  for (int k = 0; k < NFX; k++) fx_[k] = FX_DEF[k];
  for (int k = 0; k < NLUNA; k++) luna_[k] = LUNA_DEF[k];
}

double Model::semiOf(const Voice& v) const {
  const int zone = v.rn > 2.0 / 3 ? 0 : v.rn > 1.0 / 3 ? 1 : 2;
  double s = zone * 12 + (v.ang / TAU) * 12 + (scale_.on ? scale_.root : 0);
  if (scale_.on) s = scale_.snapSemi(jsRound(s));
  return s;
}

double Model::hz(const Voice& v) const { return 55 * std::pow(2.0, semiOf(v) / 12) * std::pow(2.0, v.oct); }

Voice* Model::find(int id) {
  for (int i = 0; i < n_; i++) if (vs_[i].id == id) return &vs_[i];
  return nullptr;
}

Voice* Model::add(double ang, double rn, bool pinned, int slot, int id) {
  if (n_ >= VMAX_M) return nullptr;
  bool used[VMAX_M] = {};
  for (int i = 0; i < n_; i++) used[vs_[i].slot] = true;
  if (slot < 0 || slot >= VMAX_M || used[slot]) {
    slot = -1;
    for (int k = 0; k < VMAX_M; k++) if (!used[k]) { slot = k; break; }
  }
  if (id <= 0 || find(id)) id = serial_ + 1;
  if (id > serial_) serial_ = id;
  Voice& v = vs_[n_++];
  v = Voice{};
  v.slot = slot; v.id = id; v.ang = ang; v.rn = rn; v.pinned = pinned;
  voiceEv(&v, true, true);
  return &v;
}

void Model::dropAt(int i) {                             // как dropVoice: событие — до того, как город ушёл из списка
  voiceEv(&vs_[i], false);
  for (int j = i; j + 1 < n_; j++) vs_[j] = vs_[j + 1];
  n_--;
}

void Model::drop(int id) {
  for (int i = 0; i < n_; i++) if (vs_[i].id == id) { dropAt(i); return; }
}

void Model::move(int id, double ang, double rn) {
  Voice* v = find(id);
  if (!v) return;
  v->ang = ang; v->rn = rn;
  voiceEv(v, true);
}

void Model::set(int id, int key, double x) {
  Voice* v = find(id);
  if (!v) return;
  switch (key) {
    case LVL: v->lvl = x; break;
    case OCT: v->oct = static_cast<int>(x); break;
    case PATH: v->path = static_cast<int>(x); break;
    case PINNED: v->pinned = x != 0; break;
    default: return;
  }
  voiceEv(v, true);
}

void Model::setFx(int k, double v) { if (k < 0 || k >= NFX) return; fx_[k] = v; fxEv(); }
void Model::setLuna(int k, double v) { if (k < 0 || k >= NLUNA) return; luna_[k] = v; fxEv(); }

void Model::clear() { while (n_) dropAt(0); }

void Model::dice() {                                    // два-три города на ступенях лада, натяжение и затухание — вразброс, всплеск
  clear();
  const int n = 2 + static_cast<int>(std::floor(rng_.next() * 2));
  static const double RN[3] = {0.84, 0.5, 0.18};
  for (int k = 0; k < n; k++) {
    const double ang = std::floor(rng_.next() * 12) / 12 * TAU + 0.01;
    add(ang, RN[static_cast<int>(std::floor(rng_.next() * 3))], true);
  }
  fx_[TENSION] = 0.2 + 0.6 * rng_.next(); fx_[DAMPING] = 0.15 + 0.6 * rng_.next(); fxEv();
  splash(rng_.next(), 0.4);
  for (int i = 0; i < n_; i++) { vs_[i].path = static_cast<int>(std::floor(rng_.next() * 3)); voiceEv(&vs_[i], true); }
}

std::string Model::snapshot() const {
  using sdk::Json;
  Json st = Json::object(), arr = Json::array(), fx = Json::object(), lu = Json::object();
  for (int i = 0; i < n_; i++) {
    const Voice& v = vs_[i];
    if (!v.pinned) continue;
    const double x[] = {v.ang, v.rn, v.lvl, static_cast<double>(v.oct), static_cast<double>(v.path)};
    Json o = Json::object();
    for (int k = 0; k < 5; k++) o.set(VOICE_KEYS[k], Json::num(x[k]));
    arr.push(std::move(o));
  }
  for (int k = 0; k < NFX; k++) fx.set(FX_NAMES[k], Json::num(fx_[k]));
  for (int k = 0; k < NLUNA; k++) lu.set(LUNA_NAMES[k], Json::num(luna_[k]));
  st.set("v", std::move(arr));
  st.set("fx", std::move(fx));
  st.set("luna", std::move(lu));
  return st.dump();
}

void Model::restore(const std::string& js) {
  using sdk::Json;
  bool ok = false;
  const Json st = Json::parse(js, &ok);
  if (!ok || st.type != Json::Obj) return;
  clear();
  const auto num = [](const Json& o, const char* k, double& v) { const Json* x = o.get(k); if (x && x->type == Json::Num) { v = x->n; return true; } return false; };
  if (const Json* arr = st.get("v"); arr && arr->type == Json::Arr) {
    for (const Json& q : arr->a) {
      if (q.type != Json::Obj) continue;
      double ang = 0, rn = 0, lvl = 0.8, oct = 0, path = 0, slot = -1, id = 0;
      num(q, "ang", ang); num(q, "rn", rn); num(q, "lvl", lvl); num(q, "oct", oct); num(q, "path", path);
      num(q, "slot", slot); num(q, "id", id);           // необязательные: фасад в вебе шлёт свои слоты, id и pinned (в снимке — только закреплённые)
      const Json* pin = q.get("pinned");
      const bool pinned = !pin || (pin->type == Json::Bool ? pin->b : pin->type != Json::Num || pin->n != 0);
      Voice* v = add(ang, rn, pinned, static_cast<int>(slot), static_cast<int>(id));
      if (!v) continue;
      v->lvl = lvl; v->oct = static_cast<int>(oct); v->path = static_cast<int>(path);
      voiceEv(v, true);                                 // как setVoice после addVoice в эталоне
    }
  }
  if (const Json* fx = st.get("fx"); fx && fx->type == Json::Obj)
    for (int k = 0; k < NFX; k++) num(*fx, FX_NAMES[k], fx_[k]);
  if (const Json* lu = st.get("luna"); lu && lu->type == Json::Obj)
    for (int k = 0; k < NLUNA; k++) num(*lu, LUNA_NAMES[k], luna_[k]);
  fxEv();
}

}  // namespace oceanus

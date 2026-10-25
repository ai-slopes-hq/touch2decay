// Portus — модель в ядре, см. model.hpp.
#include "model.hpp"

#include <cmath>
#include "../../sdk/json.hpp"

namespace portus {

const double DT[5] = {2, 3, 4, 6, 8};
static const char* const LUNA_K[NLUNA] = {"cut", "res", "env"};
static const char* const ECHO_K[3] = {"time", "tone", "mix"};
static const char* const FOG_K[NFOG] = {"amt", "size"};
static const char* const PHAROS_K[NPHAROS] = {"chord", "oct", "len", "lvl", "swing"};
static const char* const FX_K[NFX] = {"wow", "mare", "drive", "spread", "chance"};
static const double LUNA_DEF[NLUNA] = {0.42, 0.35, 0.45}, ECHO_DEF[3] = {1, 0.45, 0.6}, FOG_DEF[NFOG] = {0.45, 0.7};
static const double PHAROS_DEF[NPHAROS] = {2, 0, 0.25, 0.8, 0}, FX_DEF[NFX] = {0.25, 0, 0.25, 0.6, 1};

static double clamp(double x, double a = 0, double b = 1) { return x < a ? a : x > b ? b : x; }
static double jsRound(double x) { return std::floor(x + 0.5); }   // Math.round
static double gs(double d, double c, double w) { const double z = (d - c) / w; return std::exp(-(z * z)); }

double edge(int side, double d) {
  const double s = side;
  const double land = side < 0 ? 0.62 * gs(d, 0.2, 0.13) + 0.3 * gs(d, 0.58, 0.08) + 0.12 * gs(d, 0.86, 0.05) : 0.42 * gs(d, 0.05, 0.12) + 0.32 * gs(d, 0.72, 0.07);
  return s * (1 - land - 0.022 * std::sin(d * 17 + s) * (0.3 + d) - 0.012 * std::sin(d * 43 + 2 * s) * d);
}

void Model::reset() {
  for (auto& s : s_) s = Isle{};
  for (int k = 0; k < NLUNA; k++) luna_[k] = LUNA_DEF[k];
  for (int k = 0; k < 3; k++) echo_[k] = ECHO_DEF[k];
  for (int k = 0; k < NFOG; k++) fog_[k] = FOG_DEF[k];
  for (int k = 0; k < NPHAROS; k++) pharos_[k] = PHAROS_DEF[k];
  for (int k = 0; k < NFX; k++) fx_[k] = FX_DEF[k];
  buoyU_ = 0.35; buoyD_ = 0.45; bpm_ = 120;
}

int Model::count() const { int n = 0; for (const auto& s : s_) n += s.on ? 1 : 0; return n; }

// ---------- кораблики ----------
void Model::place(int i, double p, double sd) {
  if (i < 0 || i >= NSTEP) return;
  Isle& s = s_[i];
  if (s.on) { s.p = p; return; }
  s = Isle{true, p, 0, 1, sd};
}
void Model::sink(int i) { if (i >= 0 && i < NSTEP) s_[i] = Isle{}; }
void Model::move(int from, int to) {
  if (from < 0 || from >= NSTEP || to < 0 || to >= NSTEP || from == to || !s_[from].on || s_[to].on) return;
  s_[to] = s_[from]; s_[from] = Isle{};
}
void Model::setNote(int i, double p) { if (i >= 0 && i < NSTEP && s_[i].on) s_[i].p = p; }
void Model::setIsle(int i, int key, double v) {
  if (i < 0 || i >= NSTEP || !s_[i].on) return;
  if (key == IOCT) s_[i].oct = v; else s_[i].lvl = v;
}
void Model::clearIsles() { for (auto& s : s_) s = Isle{}; }

// ---------- сцена ----------
void Model::setLuna(int k, double v) { if (k >= 0 && k < NLUNA) luna_[k] = v; }
void Model::buoyFromEcho() {
  const double a = edge(-1, buoyD_), b = edge(1, buoyD_);
  buoyU_ = a + 0.03 + (echo_[TIME] / 4) * (b - a - 0.06);
}
void Model::setBuoy(double u, double d) {
  buoyD_ = clamp(d, 0.03, 0.95);
  const double a = edge(-1, buoyD_), b = edge(1, buoyD_);
  buoyU_ = clamp(u, a + 0.03, b - 0.03);
  echo_[TIME] = clamp(jsRound(((buoyU_ - a) / (b - a)) * 4), 0, 4);
}
void Model::setEcho(int k, double v) {
  if (k == TIME) echo_[TIME] = v;
  else if (k == FB) buoyD_ = 0.03 + v * 0.92;
  else if (k == TONE || k == MIX) echo_[k] = v;
  else return;
  buoyFromEcho();
}
void Model::setFog(int k, double v) { if (k >= 0 && k < NFOG) fog_[k] = v; }
void Model::setPharos(int k, double v) { if (k >= 0 && k < NPHAROS) pharos_[k] = v; }
void Model::setFx(int k, double v) { if (k >= 0 && k < NFX) fx_[k] = v; }

// ---------- высота и шина ----------
double Model::semiOf(int i) const {
  double a = s_[i].p + (scale_.on ? scale_.root : 0);
  if (scale_.on) a = scale_.snapSemi(a + 24) - 24;
  return a + 12 * (pharos_[OCT] + s_[i].oct);
}
double Model::hzOf(int i) const { return 110 * std::pow(2.0, semiOf(i) / 12); }
double Model::fcOf() const { return 90 * std::pow(2.0, 7.2 * luna_[CUT]); }
double Model::fbOf() const { return clamp(0.15 + buoyD_ * 0.84, 0, 0.985); }

// ---------- снимок ----------
std::string Model::snapshot() const {
  using sdk::Json;
  Json st = Json::object(), arr = Json::array();
  for (int j = 0; j < NSTEP; j++) {
    if (!s_[j].on) continue;
    Json o = Json::object();
    o.set("step", Json::num(j)); o.set("p", Json::num(s_[j].p)); o.set("oct", Json::num(s_[j].oct)); o.set("lvl", Json::num(s_[j].lvl)); o.set("sd", Json::num(s_[j].sd));
    arr.push(std::move(o));
  }
  const auto group = [&](const char* const* keys, const double* v, int n) { Json o = Json::object(); for (int k = 0; k < n; k++) o.set(keys[k], Json::num(v[k])); return o; };
  st.set("isles", std::move(arr));
  st.set("luna", group(LUNA_K, luna_, NLUNA)); st.set("echo", group(ECHO_K, echo_, 3));
  Json b = Json::object(); b.set("u", Json::num(buoyU_)); b.set("d", Json::num(buoyD_)); st.set("buoy", std::move(b));
  st.set("fog", group(FOG_K, fog_, NFOG)); st.set("pharos", group(PHAROS_K, pharos_, NPHAROS)); st.set("fx", group(FX_K, fx_, NFX));
  st.set("bpm", Json::num(bpm_));
  return st.dump();
}

void Model::restore(const std::string& js) {
  using sdk::Json;
  bool ok = false;
  const Json st = Json::parse(js, &ok);
  if (!ok || st.type != Json::Obj) return;
  const auto num = [](const Json& o, const char* k, double& v) { const Json* x = o.get(k); if (x && x->type == Json::Num) v = x->n; };
  const auto group = [&](const char* name, const char* const* keys, double* v, int n) {
    if (const Json* g = st.get(name); g && g->type == Json::Obj) for (int k = 0; k < n; k++) num(*g, keys[k], v[k]);
  };
  if (const Json* arr = st.get("isles"); arr && arr->type == Json::Arr) {
    clearIsles();
    for (const Json& q : arr->a) {
      if (q.type != Json::Obj) continue;
      const Json* sp = q.get("step");
      if (!sp || sp->type != Json::Num) continue;
      const int j = static_cast<int>(sp->n);
      if (j < 0 || j >= NSTEP) continue;
      Isle s{true, 0, 0, 1, 0};
      num(q, "p", s.p); num(q, "oct", s.oct); num(q, "lvl", s.lvl); num(q, "sd", s.sd);
      s_[j] = s;
    }
  }
  group("luna", LUNA_K, luna_, NLUNA); group("echo", ECHO_K, echo_, 3); group("fog", FOG_K, fog_, NFOG);
  group("pharos", PHAROS_K, pharos_, NPHAROS); group("fx", FX_K, fx_, NFX);
  if (const Json* b = st.get("buoy"); b && b->type == Json::Obj) { num(*b, "u", buoyU_); num(*b, "d", buoyD_); }
  num(st, "bpm", bpm_);
}

}  // namespace portus

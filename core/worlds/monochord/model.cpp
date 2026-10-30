// Monochordum — модель в ядре, см. model.hpp.
#include "model.hpp"

#include <cmath>
#include "../../sdk/json.hpp"

namespace monochord {

const double F_OPEN[N] = {55, 82.5, 110, 165};
const double MARKS[NMARKS] = {1, 8.0 / 9, 64.0 / 81, 3.0 / 4, 2.0 / 3, 16.0 / 27, 128.0 / 243, 1.0 / 2,
                              4.0 / 9, 32.0 / 81, 3.0 / 8, 1.0 / 3, 8.0 / 27, 1.0 / 4};
const int DIVS[4] = {1, 2, 3, 4};
const char* const FX_NAMES[NFX] = {"decay", "bright", "body", "sympathy", "chorus", "chance", "hall"};
const double FX_DEF[NFX] = {0.55, 0.55, 0.4, 0.4, 0, 1, 0.35};
static const char* const STR_KEYS[5] = {"r", "sus", "bright", "decay", "level"};
static const char* const AUTO_KEYS[NAUTO] = {"on", "bpm", "div", "pattern", "strength", "swing"};
static const double AUTO_DEF[NAUTO] = {0, 90, 1, 1, 0.6, 0};

static double clamp(double x, double a = 0, double b = 1) { return x < a ? a : x > b ? b : x; }
static double jsRound(double x) { return std::floor(x + 0.5); }   // Math.round

void Model::reset(uint32_t seed) {
  rng_ = sdk::Rng(seed);
  const double r0[N] = {1, 2.0 / 3, 1.0 / 2, 1.0 / 3};
  for (int i = 0; i < N; i++) { s_[i] = Str{}; s_[i].r = r0[i]; }
  for (int k = 0; k < NFX; k++) fx_[k] = FX_DEF[k];
  for (int k = 0; k < NAUTO; k++) auto_[k] = AUTO_DEF[k];
  wind_ = 0; lastWind_ = 0.5;
}

double Model::hzOf(int i) const {
  const double tonic = scale_.on ? std::pow(2.0, scale_.root / 12.0) : 1;
  return (F_OPEN[i] * tonic) / s_[i].r;
}

double Model::snapR(double r) const {                  // с ладом — к ступеням лада; без — прилипает к пифагоровым ладам
  if (scale_.on) {
    const double s0 = -12 * std::log2(r), s = scale_.snapSemi(jsRound(s0));
    return clamp(std::pow(2.0, -s / 12), 0.25, 1);
  }
  for (double m : MARKS) if (std::fabs(std::log2(r / m)) < 0.025) return m;
  return r;
}

void Model::bow(int i, double amp) { if (i < 0 || i >= N) return; s_[i].bow = amp; emit(Ev::BOW, i, amp); }
void Model::setSus(int i, bool on) { if (i < 0 || i >= N) return; s_[i].sus = on; emit(Ev::SUS, i, on); }
void Model::setBridge(int i, double r) { if (i < 0 || i >= N) return; s_[i].r = snapR(r); emit(Ev::TUNE, i); }
void Model::setString(int i, int key, double v) {
  if (i < 0 || i >= N) return;
  Str& s = s_[i];
  switch (key) {
    case PITCH: s.r = clamp(std::pow(2.0, -2 * v), 0.25, 1); break;   // r без прилипания: 0.5 — октава
    case KBRIGHT: s.bright = v; break;
    case KDECAY: s.decay = v; break;
    case LEVEL: s.level = v; break;
    case R: s.r = v; break;
    default: return;
  }
  emit(Ev::TUNE, i);
}
void Model::setWind(double v) { wind_ = clamp(v); if (wind_ > 0.01) lastWind_ = wind_; emit(Ev::WIND, 0, wind_); }
void Model::setFx(int k, double v) { if (k < 0 || k >= NFX) return; fx_[k] = v; emit(Ev::FX); }
void Model::setAuto(bool on) { auto_[ON] = on ? 1 : 0; emit(Ev::AUTO, 0, on); }
void Model::setAutoPar(int k, double v) { if (k > ON && k < NAUTO) auto_[k] = v; }

double Model::stepDur(long step) const {
  const double sw = auto_[SWING];
  return stepSec() * (step % 2 == 0 ? 1 + sw * 0.5 : 1 - sw * 0.5);   // swing: чётные длиннее
}
double Model::swingAt(long step) const { return step % 2 ? auto_[SWING] * 0.5 * stepSec() : 0; }

int Model::autoStep(long step, Hit* out) {              // одно касание Земли: струны по очереди, с промежутком
  if (!(rng_.next() < fx_[CHANCE])) return -1;
  const int p = static_cast<int>(auto_[PATTERN]);
  const bool up = p == 1 && step % 2 == 1;
  const double acc = step % (DIVS[div()] * 4) == 0 ? 1.15 : 1, vel = clamp(auto_[STRENGTH] * acc, 0.15, 1);
  int order[N], n = 0;
  if (p == 2) order[n++] = static_cast<int>(step % 4);
  else if (p == 3) { for (int i = 0; i < N; i++) if (rng_.next() < 0.55) order[n++] = i; }
  else for (int i = 0; i < N; i++) order[n++] = up ? N - 1 - i : i;
  const double gap = 0.006 + 0.018 * (1 - auto_[STRENGTH]);
  for (int k = 0; k < n; k++) {
    const double pos = 0.12 + 0.1 * rng_.next();       // порядок rng — как в литерале объекта эталона: pos, потом vel
    const double v = vel * (0.85 + 0.15 * rng_.next());
    out[k] = Hit{order[k], pos, v, k * gap};
  }
  return n;
}

bool Model::sounding() const {
  if (wind_ > 0.01 || autoOn()) return true;
  for (const Str& s : s_) if (s.sus || s.bow > 0) return true;
  return false;
}

void Model::clear() {
  for (int i = 0; i < N; i++) { s_[i].sus = false; s_[i].bow = 0; emit(Ev::SUS, i, 0); emit(Ev::BOW, i, 0); }
  setWind(0);
  setAuto(false);
}

void Model::dice() {                                    // порядок rng — как dice() эталона: на струну набор, sus; затем ветер
  static const double PICK[8] = {1, 3.0 / 4, 2.0 / 3, 1.0 / 2, 4.0 / 9, 3.0 / 8, 1.0 / 3, 8.0 / 9};
  for (int i = 0; i < N; i++) {
    const double p = PICK[static_cast<int>(std::floor(rng_.next() * 8))];
    setString(i, R, scale_.on ? snapR(p) : p);
    setSus(i, rng_.next() < 0.4);
  }
  setWind(rng_.next() < 0.3 ? 0.15 + 0.35 * rng_.next() : 0);
}

std::string Model::snapshot() const {
  using sdk::Json;
  Json st = Json::object(), arr = Json::array(), fx = Json::object(), au = Json::object();
  for (const Str& s : s_) {
    Json o = Json::object();
    o.set(STR_KEYS[0], Json::num(s.r)); o.set(STR_KEYS[1], Json::boolean(s.sus));
    o.set(STR_KEYS[2], Json::num(s.bright)); o.set(STR_KEYS[3], Json::num(s.decay)); o.set(STR_KEYS[4], Json::num(s.level));
    arr.push(std::move(o));
  }
  for (int k = 0; k < NFX; k++) fx.set(FX_NAMES[k], Json::num(fx_[k]));
  au.set(AUTO_KEYS[ON], Json::boolean(autoOn()));
  for (int k = ON + 1; k < NAUTO; k++) au.set(AUTO_KEYS[k], Json::num(auto_[k]));
  st.set("str", std::move(arr)); st.set("fx", std::move(fx)); st.set("wind", Json::num(wind_)); st.set("auto", std::move(au));
  return st.dump();
}

void Model::restore(const std::string& js) {
  using sdk::Json;
  bool ok = false;
  const Json st = Json::parse(js, &ok);
  if (!ok || st.type != Json::Obj) return;
  const auto num = [](const Json& o, const char* k, double& v) { const Json* x = o.get(k); if (x && x->type == Json::Num) v = x->n; };
  const auto flag = [](const Json& o, const char* k, bool& v) { const Json* x = o.get(k); if (x && x->type == Json::Bool) v = x->b; };
  if (const Json* arr = st.get("str"); arr && arr->type == Json::Arr) {
    for (int i = 0; i < N && i < static_cast<int>(arr->a.size()); i++) {
      const Json& q = arr->a[i];
      if (q.type != Json::Obj) continue;
      Str& s = s_[i];
      num(q, "r", s.r); flag(q, "sus", s.sus); num(q, "bright", s.bright); num(q, "decay", s.decay); num(q, "level", s.level);
      num(q, "bow", s.bow);
      emit(Ev::SUS, i, s.sus);
    }
  }
  if (const Json* fx = st.get("fx"); fx && fx->type == Json::Obj)
    for (int k = 0; k < NFX; k++) num(*fx, FX_NAMES[k], fx_[k]);
  emit(Ev::FX);                                         // fx перестраивает и струны (как applyFx прежнего engine.js)
  double w = 0;
  if (const Json* x = st.get("wind"); x && x->type == Json::Num) w = x->n;
  setWind(w);
  if (const Json* au = st.get("auto"); au && au->type == Json::Obj) {
    bool on = false;
    flag(*au, "on", on);
    for (int k = ON + 1; k < NAUTO; k++) num(*au, AUTO_KEYS[k], auto_[k]);
    setAuto(on);
  }
}

}  // namespace monochord

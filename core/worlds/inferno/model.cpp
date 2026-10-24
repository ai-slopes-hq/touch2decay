// Inferno — модель, см. model.hpp. Порт worlds/inferno/model.js (эталон — tools/ref/inferno-model.js).
#include "model.hpp"
#include <cmath>
#include "../../sdk/json.hpp"

namespace inferno {

const char* const FX_NAMES[NFX] = {"structure", "fire", "smoke", "ice", "storm"};
const double FX_DEF[NFX] = {0, 0.2, 0.35, 0, 0.6};

static double jsRound(double x) { return std::floor(x + 0.5); }   // Math.round: половинки — вверх

void Model::reset(uint32_t seed) {
  rng_ = sdk::Rng(seed);
  for (int k = 0; k < NC; k++) c_[k] = Circ{0.5, false, 0, k < 3 ? 0 : k < 6 ? 1 : k < 8 ? 2 : 3, 0.5, 0.15 + k * 0.08, 0.7, 0};
  for (int i = 0; i < NFX; i++) fx_[i] = FX_DEF[i];
  iceE_ = stormSemi_ = stormPh_ = time_ = iceSet_ = stormAt_ = 0;
}

double Model::semiOf(int k, double pos) const {
  double s = (8 - k) * SPAN + pos * SPAN;
  if (scale_.on) s = scale_.snapSemi(jsRound(s));
  return s;
}
double Model::hzOf(int k) const { return 55 * std::pow(2.0, (semiOf(k, c_[k].pos) + (k == 1 ? stormSemi_ : 0)) / 12); }
double Model::Qof(const Circ& c) const { return (4 + (1 - c.width) * 60) * (1 + iceE_ * 8); }

void Model::ratios(int k, double r[3]) const {
  r[0] = 1;
  if (fx_[STRUCTURE] < 1.0 / 3) { r[1] = 2; r[2] = 3; return; }            // гармоники: шум поёт нотой
  if (fx_[STRUCTURE] < 2.0 / 3) {                                          // лад: нота, ступень через одну и ещё через одну вверх
    if (!scale_.on) { r[1] = std::pow(2.0, 3 / 12.0); r[2] = std::pow(2.0, 7 / 12.0); return; }
    const int s = static_cast<int>(jsRound(semiOf(k, c_[k].pos)));
    int up[4], n = 0;
    for (int d = 1; d <= 12 && n < 4; d++) if (scale_.inScale(s + d)) up[n++] = d;
    r[1] = std::pow(2.0, (n > 1 ? up[1] : 3) / 12.0);
    r[2] = std::pow(2.0, (n > 3 ? up[3] : 7) / 12.0);
    return;
  }
  r[1] = 2.76; r[2] = 5.4;                                                 // металл: брусок
}

bool Model::sounding() const { for (const Circ& c : c_) if (c.sinner || c.held > 0) return true; return false; }

void Model::strike(int k, double vel) { c_[k].lvl = 1; emit(Ev::STRIKE, k, vel); }
void Model::setPos(int k, double pos) { c_[k].pos = pos; emit(Ev::TUNE, k); }
void Model::hold(int k, int d) { c_[k].held += d; emit(Ev::BURN, k); }
bool Model::pin(int k, double pos) {
  Circ& c = c_[k];
  if (c.sinner) c.sinner = false;
  else {
    int n = 0;
    for (const Circ& q : c_) if (q.sinner) n++;
    if (n < PIN_MAX) { c.sinner = true; setPos(k, pos); }
  }
  emit(Ev::BURN, k);
  return c.sinner;
}
void Model::setCirc(int k, int key, double v) {
  Circ& c = c_[k];
  if (key == COLOR) { const int col = static_cast<int>(v); if (col != c.color) { c.color = col; emit(Ev::COLOR, k); } return; }
  if (key == POS) c.pos = v; else if (key == WIDTH) c.width = v; else if (key == DRIVE) c.drive = v; else if (key == LEVEL) c.level = v; else return;
  emit(Ev::TUNE, k);
}
void Model::setFx(int i, double v) { if (i < 0 || i >= NFX) return; fx_[i] = v; emit(Ev::FX); }
void Model::clear() { for (int k = 0; k < NC; k++) { c_[k].sinner = false; emit(Ev::BURN, k); } }

void Model::dice() {                                    // 2–3 грешника на случайных кругах, случайная structure (перемешивание — Фишер–Йетс, не sort V8)
  for (int k = 0; k < NC; k++) if (c_[k].sinner) { c_[k].sinner = false; emit(Ev::BURN, k); }
  static const double st[3] = {0.15, 0.5, 0.85};
  fx_[STRUCTURE] = st[static_cast<int>(rng_.next() * 3)];
  const int n = 2 + static_cast<int>(rng_.next() * 2);
  int ks[NC];
  for (int k = 0; k < NC; k++) ks[k] = k;
  for (int i = NC - 1; i > 0; i--) { const int j = static_cast<int>(rng_.next() * (i + 1)); const int t = ks[i]; ks[i] = ks[j]; ks[j] = t; }
  for (int i = 0; i < n; i++) {
    Circ& c = c_[ks[i]];
    c.sinner = true; c.pos = rng_.next(); c.color = static_cast<int>(rng_.next() * NCOLOR);
    emit(Ev::COLOR, ks[i]);
  }
  emit(Ev::FX);
  for (int i = 0; i < n; i++) emit(Ev::BURN, ks[i]);
}

void Model::tick(double dt) {
  time_ += dt;
  for (Circ& c : c_) {                                  // уровень круга: вспыхивает быстро, гаснет медленнее, со льдом — дольше
    const double target = (c.sinner || c.held > 0) ? c.level : 0;
    c.lvl += (target - c.lvl) * (1 - std::exp(-dt / (target > c.lvl ? 0.08 : 0.4 + iceE_ * 3)));
  }
  iceE_ += (fx_[ICE] - iceE_) * (1 - std::exp(-dt / (fx_[ICE] > iceE_ ? 6 : 3)));   // Коцит замерзает медленно, оттаивает быстрее
  if (std::fabs(iceE_ - iceSet_) > 0.02) { iceSet_ = iceE_; emit(Ev::ICE); }
  if (burning(1) && fx_[STORM] > 0.01) {                // буря второго круга: ветер сам качает его высоту
    const double TAU = 2 * M_PI;
    stormPh_ += dt * (0.11 + 0.06 * std::sin(time_ * 0.31));
    stormSemi_ = fx_[STORM] * (5.8 * std::sin(stormPh_ * TAU) + 2 * std::sin(stormPh_ * TAU * 2.7 + 1));
    if (time_ - stormAt_ > 0.05) { stormAt_ = time_; emit(Ev::TUNE, 1); }
  } else stormSemi_ *= std::pow(0.9, dt * 60);          // в вебе — ×0.9 за кадр (60 к/с)
}

std::string Model::snapshot() const {
  using sdk::Json;
  Json st = Json::object(), arr = Json::array(), fx = Json::object();
  for (const Circ& c : c_) {
    Json o = Json::object();
    o.set("pos", Json::num(c.pos)); o.set("sinner", Json::boolean(c.sinner)); o.set("color", Json::num(c.color));
    o.set("width", Json::num(c.width)); o.set("drive", Json::num(c.drive)); o.set("level", Json::num(c.level));
    arr.push(std::move(o));
  }
  for (int i = 0; i < NFX; i++) fx.set(FX_NAMES[i], Json::num(fx_[i]));
  st.set("circ", std::move(arr)); st.set("fx", std::move(fx));
  return st.dump();
}

void Model::restore(const std::string& js) {
  using sdk::Json;
  bool ok = false;
  const Json st = Json::parse(js, &ok);
  if (!ok || st.type != Json::Obj) return;
  const auto num = [](const Json& o, const char* k, double& v) { const Json* x = o.get(k); if (x && x->type == Json::Num) { v = x->n; return true; } return false; };
  if (const Json* arr = st.get("circ"); arr && arr->type == Json::Arr) {
    for (int k = 0; k < NC && k < static_cast<int>(arr->a.size()); k++) {
      const Json& q = arr->a[k];
      if (q.type != Json::Obj) continue;
      Circ& c = c_[k];
      const int was = c.color;
      double v = 0;
      if (num(q, "pos", v)) c.pos = v;
      if (const Json* s = q.get("sinner"); s && s->type == Json::Bool) c.sinner = s->b;
      if (num(q, "color", v)) c.color = static_cast<int>(v);
      if (num(q, "width", v)) c.width = v;
      if (num(q, "drive", v)) c.drive = v;
      if (num(q, "level", v)) c.level = v;
      if (was != c.color) emit(Ev::COLOR, k);
    }
  }
  if (const Json* fx = st.get("fx"); fx && fx->type == Json::Obj)
    for (int i = 0; i < NFX; i++) { double v = 0; if (num(*fx, FX_NAMES[i], v)) fx_[i] = v; }
  emit(Ev::FX);
  for (int k = 0; k < NC; k++) emit(Ev::BURN, k);
}

}  // namespace inferno

// Firmamentum — модель в ядре, см. model.hpp. Каждая строка — как в worlds/firmamentum/model.js: тот же порядок rng и арифметики
// (a·b·c слева направо), иначе сверка JS ↔ ядро до 1e-9 разойдётся. Аргументы со случайностью — в отдельных переменных:
// порядок вычисления аргументов функции в C++ не задан.
#include "model.hpp"
#include <cmath>
#include "../../sdk/json.hpp"

namespace firmamentum {

static const double TAU = M_PI * 2;
static const double LIMEN = std::log(20 / FP_LO) / std::log(FP_HI / FP_LO);   // высота, где ритм становится тоном
const char* const FX_NAMES[NFX] = {"scintilla", "drift", "cometa", "crepitus", "fulgur", "spread", "hall"};
const double FX_DEF[NFX] = {0.1, 0.2, 0, 0, 0, 0.6, 0.45};
static const char* const STAR_KEYS[] = {"h", "u", "cyc", "win", "mask", "lvl"};   // что звезды сохраняется в снимке

static double jsRound(double x) { const double r = std::floor(x); return x - r >= 0.5 ? r + 1 : r; }   // Math.round: половина — вверх
static double orOne(double x) { return (x == 0 || std::isnan(x)) ? 1 : x; }   // x || 1
static double orZero(double x) { return std::isnan(x) ? 0 : x; }               // x || 0
struct XY { double x, y; };
static XY place(double h, double u) { return {u, -h * K}; }                    // свод: x — по своду, y — высота (вверх — минус, как на экране)

void Model::reset(uint32_t seed) {
  rng_ = sdk::Rng(seed);
  n_ = serial_ = comets_ = 0;
  for (int k = 0; k < NFX; k++) fx_[k] = FX_DEF[k];
  time_ = cometNext_ = cometSent_ = driftAt_ = 0;
  hasComet_ = false;
  comet_ = Comet();
}

double Model::fp(const Star& s) const {
  double f = FP_LO * std::pow(FP_HI / FP_LO, s.h);
  if (scale_.on && f > 27.5) {
    const double st = 12 * std::log2(f / 55);
    f = 55 * std::pow(2.0, (scale_.snapSemi(jsRound(st) + 24) - 24) / 12);
  }
  return f * orOne(s.cm);
}

double Model::ff(const Star& s) const { return FF_LO * std::pow(FF_HI / FF_LO, (s.u + 1) / 2) * std::pow(2.0, orZero(s.dr)); }

Star* Model::find(int id) {
  for (int i = 0; i < n_; i++) if (stars_[i].id == id) return &stars_[i];
  return nullptr;
}

Star* Model::add(double h, double u, int slot, int id) {
  bool used[SMAX] = {};
  for (int i = 0; i < n_; i++) used[stars_[i].slot] = true;
  if (slot < 0 || slot >= SMAX || used[slot]) {         // первый свободный, как в JS
    slot = -1;
    for (int k = 0; k < SMAX; k++) if (!used[k]) { slot = k; break; }
  }
  if (slot < 0) return nullptr;
  if (id <= 0 || find(id)) id = serial_ + 1;            // id от UI — любой не живой; нет или занят — следующий свой (выше всех виденных — не живой)
  if (id > serial_) serial_ = id;
  Star& s = stars_[n_++];
  s = Star();
  s.slot = slot; s.id = id; s.h = h; s.u = u;
  s.ph = rng_.next() * TAU;
  emit(Ev::STAR, &s, true, true);
  return &s;
}

void Model::closeAt(int i) {
  emit(Ev::STAR, &stars_[i], false);
  for (int k = i + 1; k < n_; k++) stars_[k - 1] = stars_[k];
  n_--;
}

void Model::close(int id) {
  for (int i = 0; i < n_; i++) if (stars_[i].id == id) { closeAt(i); return; }
}

void Model::move(int id, double h, double u) {
  Star* s = find(id);
  if (!s) return;
  s->h = h; s->u = u;
  emit(Ev::STAR, s);
}

static void put(Star& s, int key, double v) {
  switch (key) {
    case CYC: s.cyc = v; break;
    case WIN: s.win = v; break;
    case MASK: s.mask = v; break;
    case LVL: s.lvl = v; break;
    case H: s.h = v; break;
    case U: s.u = v; break;
    default: break;
  }
}

void Model::set(int id, int key, double v) {
  Star* s = find(id);
  if (!s || key < 0 || key >= NKEY) return;
  put(*s, key, v);
  emit(Ev::STAR, s);
}

void Model::setFx(int k, double v) {
  if (k < 0 || k >= NFX) return;
  fx_[k] = v;
  emit(Ev::FX, nullptr);
}

void Model::clear() { while (n_) closeAt(0); }

void Model::tick(double dt) {
  const double now = (time_ += dt);
  if (fx_[DRIFT] > 0.01 && now - driftAt_ > 0.1) {      // drift: форманты медленно плывут, у каждой звезды своя фаза
    driftAt_ = now;
    for (int i = 0; i < n_; i++) {
      Star& s = stars_[i];
      s.dr = 0.6 * fx_[DRIFT] * std::sin(now * 0.21 + s.ph) + 0.25 * fx_[DRIFT] * std::sin(now * 0.57 + s.ph * 2);
      emit(Ev::FF, &s);
    }
  }
  cometTick(now);
}

// комета — рампа: пролетает по своду и разгоняет пульсацию звёзд, мимо которых летит
void Model::cometTick(double now) {
  if (!hasComet_ && fx_[COMETA] > 0.01 && n_) {         // новая комета: от края свода вниз через небо, раз в 4…24 с (чаще с cometa)
    if (!cometNext_) cometNext_ = now + 1.5;
    if (now > cometNext_) {
      const double dir = rng_.next() < 0.5 ? -1 : 1;
      Comet c;
      c.a.h = 0.55 + rng_.next() * 0.4; c.a.u = -0.9 * dir;
      c.b.h = 0.05 + rng_.next() * 0.35; c.b.u = 0.9 * dir;
      c.t0 = now; c.dur = 3.5 + rng_.next() * 3;
      comet_ = c; hasComet_ = true; comets_++;
    }
  }
  const bool on = hasComet_;
  XY at{0, 0};
  if (on) {                                             // где комета: доля пути k, точка — линейно между концами
    const double k = std::fmin(1, (now - comet_.t0) / comet_.dur);
    const XY A = place(comet_.a.h, comet_.a.u), B = place(comet_.b.h, comet_.b.u);
    at = {A.x + (B.x - A.x) * k, A.y + (B.y - A.y) * k};
  }
  bool changed = false;
  for (int i = 0; i < n_; i++) {                        // звезда рядом с кометой — пульсация разгоняется (до двух октав), потом отпускает
    Star& s = stars_[i];
    double cm = 1;
    if (on) {
      const XY p = place(s.h, s.u);
      const double d = std::hypot(p.x - at.x, p.y - at.y);
      cm = std::pow(2.0, 2 * fx_[COMETA] * std::fmax(0, 1 - d / R));
    }
    if (std::fabs(cm - orOne(s.cm)) > 0.01) { s.cm = cm; changed = true; }
  }
  if (changed && now - cometSent_ > 0.033) { cometSent_ = now; for (int i = 0; i < n_; i++) emit(Ev::FP, &stars_[i]); }
  if (on && now - comet_.t0 > comet_.dur) {
    hasComet_ = false;
    const double r = rng_.next();
    cometNext_ = now + (24 - 20 * fx_[COMETA]) * (0.6 + 0.8 * r);
    for (int i = 0; i < n_; i++) { stars_[i].cm = 1; emit(Ev::FP, &stars_[i]); }
  }
}

void Model::dice() {                                    // одна звезда — ритм у горизонта, две-три — тоны выше; окна и циклы вразброс
  clear();
  {
    const double h = 0.08 + rng_.next() * (LIMEN - 0.12);
    const double u = rng_.next() * 1.6 - 0.8;
    Star* s0 = add(h, u);
    if (s0) {
      const double cyc = 1 + std::floor(rng_.next() * 3);
      const double win = 0.4 + rng_.next() * 0.3;
      s0->cyc = cyc; s0->win = win;
      emit(Ev::STAR, s0);
    }
  }
  const int n = 2 + static_cast<int>(std::floor(rng_.next() * 2));
  for (int k = 0; k < n; k++) {
    const double h = LIMEN + 0.08 + rng_.next() * 0.45;
    const double u = rng_.next() * 1.8 - 0.9;
    Star* s = add(h, u);
    if (!s) continue;
    const double cyc = 2 + std::floor(rng_.next() * 6);
    const double win = rng_.next() * 0.6;
    const double mask = rng_.next() < 0.3 ? 0.3 : 0;
    s->cyc = cyc; s->win = win; s->mask = mask;
    emit(Ev::STAR, s);
  }
}

std::string Model::snapshot() const {
  using sdk::Json;
  Json st = Json::object(), arr = Json::array(), fx = Json::object();
  for (int i = 0; i < n_; i++) {
    const Star& s = stars_[i];
    const double v[] = {s.h, s.u, s.cyc, s.win, s.mask, s.lvl};
    Json o = Json::object();
    for (int k = 0; k < 6; k++) o.set(STAR_KEYS[k], Json::num(v[k]));
    arr.push(std::move(o));
  }
  for (int k = 0; k < NFX; k++) fx.set(FX_NAMES[k], Json::num(fx_[k]));
  st.set("s", std::move(arr));
  st.set("fx", std::move(fx));
  return st.dump();
}

void Model::restore(const std::string& js) {
  using sdk::Json;
  bool ok = false;
  const Json st = Json::parse(js, &ok);
  if (!ok || st.type != Json::Obj) return;
  clear();
  const auto num = [](const Json& o, const char* k, double& v) { const Json* x = o.get(k); if (x && x->type == Json::Num) { v = x->n; return true; } return false; };
  if (const Json* arr = st.get("s"); arr && arr->type == Json::Arr) {
    for (const Json& q : arr->a) {
      if (q.type != Json::Obj) continue;
      double h = 0, u = 0, slot = -1, id = 0;
      num(q, "h", h); num(q, "u", u);
      num(q, "slot", slot); num(q, "id", id);           // необязательные: фасад в вебе шлёт свои слоты и id (в снимке их нет)
      Star* s = add(h, u, static_cast<int>(slot), static_cast<int>(id));
      if (!s) continue;
      const int keys[] = {H, U, CYC, WIN, MASK, LVL};
      for (int k = 0; k < 6; k++) { double v; if (num(q, STAR_KEYS[k], v)) put(*s, keys[k], v); }
      emit(Ev::STAR, s);
    }
  }
  if (const Json* fx = st.get("fx"); fx && fx->type == Json::Obj)
    for (int k = 0; k < NFX; k++) num(*fx, FX_NAMES[k], fx_[k]);
  emit(Ev::FX, nullptr);
}

}  // namespace firmamentum

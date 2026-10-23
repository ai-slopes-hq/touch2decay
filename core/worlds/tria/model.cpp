// Tria corpora — модель в ядре, см. model.hpp. Порядок операций — как в tools/ref/tria-model.js (сверка до 1e-9 на хаосе).
#include "model.hpp"

#include <cmath>
#include "../../sdk/json.hpp"
#include "../../sdk/jsmath.hpp"

namespace tria {

using sdk::jsClamp;
using sdk::jsHypot;
using sdk::jsRound;

const char* const FX_NAMES[NFX] = {"gravitas", "flux", "nexus", "aspectus", "decay", "hall"};
const double FX_DEF[NFX] = {0.5, 0.5, 0.35, 0.6, 0, 0.35};
static constexpr double TAU = 6.283185307179586, PI = 3.141592653589793, NEVER = -1e300;
static const double RINGS[3] = {0.25, 0.5, 0.75};
static const int PENTA[6] = {0, 2, 4, 7, 9, 12};       // без лада — пентатоника от тоники (и октава)
static const char* const BODY_KEYS[8] = {"x", "y", "vx", "vy", "m", "fixed", "semi", "level"};

bool Model::Key::operator==(const Key& o) const {
  if (g != o.g || lux != o.lux) return false;
  for (int i = 0; i < NB; i++) if (m[i] != o.m[i] || fixed[i] != o.fixed[i] || held[i] != o.held[i]) return false;
  return true;
}

void Model::reset() {
  for (int i = 0; i < NB; i++) {                        // rest(): треугольник радиусом 0.5, первое тело сверху
    const double a = -PI / 2 + (i * TAU) / 3;
    Body& b = b_[i];
    b = Body();
    b.x = std::cos(a) * 0.5; b.y = std::sin(a) * 0.5;
    b.semi = i == 0 ? 0 : i == 1 ? 7 : 12;
    pairK_[i] = trem_[i] = rims_[i] = 0;
    hasPrev_[i] = false; prevR_[i] = prevA_[i] = 0; lastHit_[i] = conjAt_[i] = NEVER; near_[i] = false;
  }
  for (int k = 0; k < NFX; k++) fx_[k] = FX_DEF[k];
  still_ = true; lux_ = false; cadit_ = false; time_ = 0;
  hasE0_ = false; eDirty_ = true; fresh_ = true; E0_ = 0; eKey_ = Key();
  nev_ = nfl_ = 0;
}

double Model::snap(double s) const {
  if (scale_.on) return scale_.snapSemi(jsRound(s) + 24) - 24;
  const double r = jsRound(s), o = std::floor(r / 12), pc = r - 12 * o;
  double best = 0;
  for (int q : PENTA) if (std::fabs(q - pc) < std::fabs(best - pc)) best = q;
  return 12 * o + best;
}

static double omega(const Body& b) {                    // угловая скорость вокруг земли
  const double r2 = std::fmax(0.01, b.x * b.x + b.y * b.y);
  return std::fabs(b.x * b.vy - b.y * b.vx) / r2;
}

double Model::hzOf(const Body& b) const {               // Кеплер: быстрее обходит землю — выше (flux — сколько октав); по ступеням
  const double w = jsClamp(omega(b), 0.15, 40);
  const double s = b.semi + tonic() + 12 + jsClamp(12 * std::log2(w / 3) * (0.4 + 1.2 * fx_[FLUX]), -24, 24);
  return 110 * std::pow(2.0, snap(s) / 12);
}
double Model::baseHz(const Body& b) const { return 110 * std::pow(2.0, snap(b.semi + tonic() - 12) / 12); }

// ---------- физика ----------
void Model::accel(int i, double& ax, double& ay) const {
  const Body& b = b_[i];
  if (cadit_) { ax = 0; ay = 1.4; return; }
  ax = -KC * b.x * (lux_ ? 0 : 1); ay = -KC * b.y * (lux_ ? 0 : 1);
  const double eps2 = lux_ ? 1e-6 : EPS * EPS, g = Gc();
  for (int j = 0; j < NB; j++) {
    if (j == i) continue;
    const double dx = b_[j].x - b.x, dy = b_[j].y - b.y, d2 = dx * dx + dy * dy + eps2, k = (g * b_[j].m) / (d2 * std::sqrt(d2));
    ax += dx * k; ay += dy * k;
  }
}

void Model::energyKU(double& K, double& U) const {
  const double eps2 = lux_ ? 1e-6 : EPS * EPS, g = Gc();
  K = 0; U = 0;
  for (int i = 0; i < NB; i++) {
    const Body& b = b_[i];
    if (!b.fixed) K += (b.m * (b.vx * b.vx + b.vy * b.vy)) / 2;
    if (!lux_) U += (b.m * KC * (b.x * b.x + b.y * b.y)) / 2;
    for (int j = i + 1; j < NB; j++) {
      const Body& q = b_[j];
      const double dx = q.x - b.x, dy = q.y - b.y, d2 = dx * dx + dy * dy + eps2;
      U -= (g * b.m * q.m) / std::sqrt(d2);
    }
  }
}
double Model::energy() const { double K, U; energyKU(K, U); return K + U; }

void Model::keepEnergy(double dt) {
  if (cadit_) { hasE0_ = false; return; }
  Key key;
  key.g = Gc(); key.lux = lux_;
  bool any = false;
  for (int i = 0; i < NB; i++) { key.m[i] = b_[i].m; key.fixed[i] = b_[i].fixed; key.held[i] = b_[i].held; any = any || b_[i].held; }
  if (fx_[DECAY] > 0.005 && !any) {                     // decay: трение
    const double f = std::exp(-0.3 * fx_[DECAY] * fx_[DECAY] * dt);
    for (Body& b : b_) { b.vx *= f; b.vy *= f; }
    eDirty_ = true;
  }
  double K, U;
  energyKU(K, U);
  if (eDirty_ || any || !(key == eKey_) || !hasE0_) {
    E0_ = K + U; hasE0_ = true; eKey_ = key; eDirty_ = false;
    if (fresh_ && !any && !lux_) {
      fresh_ = false;
      double sm = 0;
      for (const Body& b : b_) sm = sm + b.m;
      E0_ = std::fmax(E0_, (EMIN * Gc() / 0.625) * sm);
    }
    if (std::fabs(E0_ - K - U) < 1e-9) return;
  }
  const double Kt = E0_ - U;
  if (K > 1e-6) {
    const double k = std::fmin(1.04, std::fmax(0.97, std::sqrt(std::fmax(0, Kt) / K)));
    for (Body& b : b_) if (!b.fixed) { b.vx *= k; b.vy *= k; }
  }
}

void Model::physics(double dt) {                         // leapfrog, 8…64 подшагов; блюдо держит тела
  if (still_) return;
  const bool cadit = cadit_;
  double dmin = 9, vmax = 0;
  for (int i = 0; i < NB; i++) {
    const Body& a = b_[i];
    vmax = std::fmax(vmax, jsHypot(a.vx, a.vy));
    for (int j = i + 1; j < NB; j++) dmin = std::fmin(dmin, jsHypot(b_[j].x - a.x, b_[j].y - a.y));
  }
  const double T0 = dt * (0.5 + fx_[GRAVITAS]);
  const int n = static_cast<int>(std::fmin(64, std::fmax(8, std::ceil((T0 * (vmax + 1) * 12) / std::fmax(dmin, lux_ ? 0.02 : EPS)))));
  const double h = T0 / n;
  for (int s = 0; s < n; s++) {
    for (int i = 0; i < NB; i++) { Body& b = b_[i]; if (b.fixed || b.held) continue; double ax, ay; accel(i, ax, ay); b.vx += ax * h / 2; b.vy += ay * h / 2; }
    for (Body& b : b_) { if (b.fixed || b.held) continue; b.x += b.vx * h; b.y += b.vy * h; }
    for (int i = 0; i < NB; i++) { Body& b = b_[i]; if (b.fixed || b.held) continue; double ax, ay; accel(i, ax, ay); b.vx += ax * h / 2; b.vy += ay * h / 2; }
    if (cadit) for (int i = 0; i < NB; i++) for (int j = i + 1; j < NB; j++) {   // на дне тела не проходят друг сквозь друга
      Body& a = b_[i]; Body& b = b_[j];
      const double dx = b.x - a.x, dy = b.y - a.y, m = 0.19;
      double d = jsHypot(dx, dy);
      if (d == 0) d = 1e-4;
      if (d < m) {
        const double push = (m - d) / 2, ux = dx / d, uy = dy / d;
        if (!a.fixed && !a.held) { a.x -= ux * push; a.y -= uy * push; }
        if (!b.fixed && !b.held) { b.x += ux * push; b.y += uy * push; }
        const double rv = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
        if (rv < 0) { a.vx += rv * ux * 0.5; a.vy += rv * uy * 0.5; b.vx -= rv * ux * 0.5; b.vy -= rv * uy * 0.5; }
      }
    }
    for (int i = 0; i < NB; i++) {                      // край блюда: отскок; слишком быстрые — притормаживают
      Body& b = b_[i];
      const double r = jsHypot(b.x, b.y);
      if (r > 0.97) {
        const double nx = b.x / r, ny = b.y / r, vn = b.vx * nx + b.vy * ny, k = cadit ? 1.35 : 2;
        if (vn > 0.25) rims_[i] = std::fmax(rims_[i], vn);
        if (vn > 0) { b.vx -= k * vn * nx; b.vy -= k * vn * ny; }
        if (cadit) { b.vx *= 0.985; b.vy *= 0.985; }
        b.x = nx * 0.97; b.y = ny * 0.97;
      }
      const double v = jsHypot(b.vx, b.vy);
      if (v > 14) { b.vx *= 14 / v; b.vy *= 14 / v; eDirty_ = true; }
    }
  }
  keepEnergy(T0);
}

void Model::fiatLux() {                                  // восьмёрка Шенсине — Монтгомери
  const double s = 0.55, g = Gc(), k = std::sqrt(g / s), x1[2] = {-0.97000436, 0.24308753}, v3[2] = {-0.93240737, -0.86473146};
  const double P[3][2] = {{x1[0], x1[1]}, {-x1[0], -x1[1]}, {0, 0}}, V[3][2] = {{-v3[0] / 2, -v3[1] / 2}, {-v3[0] / 2, -v3[1] / 2}, {v3[0], v3[1]}};
  for (int i = 0; i < NB; i++) { Body& b = b_[i]; b.x = P[i][0] * s; b.y = P[i][1] * s; b.vx = V[i][0] * k; b.vy = V[i][1] * k; b.m = 1; b.fixed = false; }
  lux_ = true; cadit_ = false; still_ = false; eDirty_ = true; start();
}

// ---------- аспекты, соединения, дрон пары ----------
void Model::aspects(double now) {
  const double asp = fx_[ASPECTUS];
  const int nr = asp < 0.01 ? 0 : asp < 0.34 ? 1 : 3;
  const double* rings = nr == 1 ? RINGS + 1 : RINGS;
  for (int i = 0; i < NB; i++) {
    const Body& b = b_[i];
    const double r = jsHypot(b.x, b.y), a = std::atan2(b.y, b.x);
    const bool had = hasPrev_[i];
    const double pr = prevR_[i], pa = prevA_[i];
    hasPrev_[i] = true; prevR_[i] = r; prevA_[i] = a;
    if (!had || still_ || b.held || b.fixed || now - lastHit_[i] < 0.12) continue;
    int kind = -1;
    double q = 0;
    for (int k = 0; k < nr; k++) if ((pr - rings[k]) * (r - rings[k]) < 0) { kind = 0; q = rings[k]; break; }
    const int n = rays();
    if (kind < 0 && n) {
      const double k0 = std::floor((pa + PI / 4) / (TAU / n)), k1 = std::floor((a + PI / 4) / (TAU / n));
      if (k0 != k1 && std::fabs(a - pa) < PI) { kind = 1; q = jsRound((a + PI / 4) / (TAU / n)) * (TAU / n) - PI / 4; }
    }
    if (kind < 0) continue;
    lastHit_[i] = now;
    const double v = jsHypot(b.vx, b.vy);
    Ev e{Ev::BELL};
    e.i = i; e.f = hzOf(b); e.vel = jsClamp(0.25 + v * 0.3); e.pan = jsClamp(b.x, -1, 1) * 0.8;
    emit(e);
    flash(i, kind, b.x, b.y, q);
  }
  for (int i = 0; i < NB; i++) {
    const double vn = rims_[i];
    if (vn > 0 && !still_) { Ev e{Ev::THUD}; e.i = i; e.vel = vn; emit(e); flash(i, 2, b_[i].x, b_[i].y); }
    rims_[i] = 0;
  }
}

void Model::voice(double dt, double now) {
  aspects(now);
  const bool still = still_;
  for (int i = 0; i < NB; i++) {
    Body& b = b_[i];
    double dm = 9;
    int jm = -1;
    for (int j = 0; j < NB; j++) if (j != i) { const double d = jsHypot(b.x - b_[j].x, b.y - b_[j].y); if (d < dm) { dm = d; jm = j; } }
    const Body& q = b_[jm];
    const double rx = q.x - b.x, ry = q.y - b.y, w = std::fabs(rx * (q.vy - b.vy) - ry * (q.vx - b.vx)) / std::fmax(0.004, dm * dm);
    const double rate = jsClamp(w / TAU, 0.3, 9);
    const double pk = still ? 0 : jsClamp((0.32 - dm) / 0.22);
    pairK_[i] += (pk - pairK_[i]) * (1 - std::exp(-dt / 0.4));
    trem_[i] += rate * dt * TAU;
    const double v = jsHypot(b.vx, b.vy), target = still ? 0 : b.level * (0.05 + 0.55 * pairK_[i]) * jsClamp(0.3 + v * 0.4);
    b.amp += (target - b.amp) * (1 - std::exp(-dt / 0.08)); b.hz = hzOf(b);
  }
  for (int i = 0; i < NB; i++) {                         // близкий пролёт пары — соединение: обе ноты разом и шорох
    const Body& a = b_[i];
    const int j = (i + 1) % NB;
    const Body& b = b_[j];
    const double d = jsHypot(a.x - b.x, a.y - b.y);
    const bool cl = d < 0.1;
    if (cl && !near_[i] && !still && now - conjAt_[i] > 0.4) {
      conjAt_[i] = now;
      const double pan = jsClamp((a.x + b.x) / 2, -1, 1);
      Ev e{Ev::BELL}; e.i = i; e.f = a.hz; e.vel = 1; e.pan = pan; emit(e);
      Ev e2{Ev::BELL}; e2.i = j; e2.f = b.hz; e2.vel = 1; e2.pan = pan; emit(e2);
      Ev e3{Ev::BURST}; e3.f = std::sqrt(a.hz * b.hz) * 2; e3.pan = pan; e3.k = 0.6; emit(e3);
      flash(i, 3, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    near_[i] = cl;
  }
}

void Model::step(double dt) {
  clearEvents();
  const double now = (time_ += dt), h = dt;
  physics(h);
  voice(h, now);
}

// ---------- действия ----------
void Model::plumb() { cadit_ = !cadit_; lux_ = false; if (still_) { still_ = false; start(); } }
void Model::anchor(int i) { if (i < 0 || i >= NB) return; Body& b = b_[i]; b.fixed = !b.fixed; b.vx = b.vy = 0; }
void Model::grab(int i) { if (i < 0 || i >= NB) return; b_[i].held = true; lux_ = false; }
void Model::drop(int i) { if (i < 0 || i >= NB) return; b_[i].held = false; }
void Model::drag(int i, double x, double y) {
  if (i < 0 || i >= NB) return;
  Body& b = b_[i];
  b.x = x; b.y = y; b.vx = b.vy = 0;
  if (still_) { still_ = false; start(); }
}
void Model::release(int i, bool thrown, double vx, double vy) {
  if (i < 0 || i >= NB) return;
  Body& b = b_[i];
  b.held = false; eDirty_ = true;
  if (thrown) fresh_ = true;
  if (thrown && !b.fixed) { b.vx = vx; b.vy = vy; }
  if (still_ && thrown) { still_ = false; start(); }
}
void Model::setBody(int i, int key, double v) {
  if (i < 0 || i >= NB) return;
  Body& b = b_[i];
  if (key == 0) b.m = 0.3 + v * 2.7;
  else if (key == 1) b.semi = jsRound(v * 36) - 12;
  else if (key == 2) { b.fixed = v >= 0.5; if (b.fixed) b.vx = b.vy = 0; }
  else b.level = v;
}
void Model::setFx(int k, double v) { if (k < 0 || k >= NFX) return; fx_[k] = v; emit({Ev::FXCH}); }
void Model::dice(const double* a) {
  for (int i = 0; i < NB; i++) {
    Body& b = b_[i];
    const double* q = a + 6 * i;
    b.x = q[0]; b.y = q[1]; b.vx = q[2]; b.vy = q[3]; b.m = q[4]; b.semi = q[5]; b.fixed = false;
  }
  lux_ = false; cadit_ = false; still_ = false; eDirty_ = true; fresh_ = true; start();
}
void Model::clear() { still_ = true; lux_ = false; cadit_ = false; for (Body& b : b_) b.vx = b.vy = 0; }

std::string Model::snapshot() const {
  using sdk::Json;
  Json st = Json::object(), arr = Json::array(), fx = Json::object();
  for (const Body& b : b_) {
    Json o = Json::object();
    o.set("x", Json::num(b.x)); o.set("y", Json::num(b.y)); o.set("vx", Json::num(b.vx)); o.set("vy", Json::num(b.vy));
    o.set("m", Json::num(b.m)); o.set("fixed", Json::boolean(b.fixed)); o.set("semi", Json::num(b.semi)); o.set("level", Json::num(b.level));
    arr.push(std::move(o));
  }
  for (int k = 0; k < NFX; k++) fx.set(FX_NAMES[k], Json::num(fx_[k]));
  st.set("b", std::move(arr)); st.set("fx", std::move(fx));
  st.set("still", Json::boolean(still_)); st.set("lux", Json::boolean(lux_)); st.set("cadit", Json::boolean(cadit_));
  return st.dump();
}

bool Model::restore(const std::string& js) {             // как restore модели: что есть в снимке — в тела и fx; eDirty, событие fx, пуск
  using sdk::Json;
  bool ok = false;
  const Json st = Json::parse(js, &ok);
  if (!ok || st.type != Json::Obj) return false;
  if (const Json* arr = st.get("b"); arr && arr->type == Json::Arr) {
    for (int i = 0; i < NB && i < static_cast<int>(arr->a.size()); i++) {
      const Json& q = arr->a[i];
      if (q.type != Json::Obj) continue;
      Body& b = b_[i];
      double* num[8] = {&b.x, &b.y, &b.vx, &b.vy, &b.m, nullptr, &b.semi, &b.level};
      for (int k = 0; k < 8; k++) {
        const Json* x = q.get(BODY_KEYS[k]);
        if (!x) continue;
        if (k == 5) b.fixed = x->type == Json::Bool ? x->b : (x->type == Json::Num && x->n != 0);
        else if (x->type == Json::Num) *num[k] = x->n;
      }
    }
  }
  if (const Json* fx = st.get("fx"); fx && fx->type == Json::Obj)
    for (int k = 0; k < NFX; k++) { const Json* x = fx->get(FX_NAMES[k]); if (x && x->type == Json::Num) fx_[k] = x->n; }
  const auto flag = [&](const char* k, bool d) { const Json* x = st.get(k); return x ? (x->type == Json::Bool ? x->b : (x->type == Json::Num && x->n != 0)) : d; };
  still_ = flag("still", still_); lux_ = flag("lux", lux_); cadit_ = flag("cadit", false);
  eDirty_ = true;
  emit({Ev::FXCH});
  if (!still_) start();
  return true;
}

}  // namespace tria

// Arcadia — страна из зерна, см. land.hpp. Порядок вызовов R() и арифметика — как в genLand (tools/ref/arcadia-model.js).
#include "land.hpp"

#include <algorithm>
#include <vector>

namespace arcadia {

double bil(const float* arr, double u, double v) {
  const double gx = clampd((u + 1) * 0.5 * (GX - 1), 0, GX - 1.001), gy = clampd((v + 1) * 0.5 * (GY - 1), 0, GY - 1.001);
  const int i = static_cast<int>(gx), j = static_cast<int>(gy);
  const double fx = gx - i, fy = gy - j;
  return (arr[j * GX + i] * (1 - fx) + arr[j * GX + i + 1] * fx) * (1 - fy) + (arr[(j + 1) * GX + i] * (1 - fx) + arr[(j + 1) * GX + i + 1] * fx) * fy;
}

void gradOf(const float* arr, double u, double v, double& gx, double& gy, double e) {
  gx = (bil(arr, u + e, v) - bil(arr, u - e, v)) / (2 * e);
  gy = (bil(arr, u, v + e / ASP) - bil(arr, u, v - e / ASP)) / (2 * e);
}

static inline double cellU(int i) { return (static_cast<double>(i) / (GX - 1)) * 2 - 1; }
static inline double cellV(int j) { return (static_cast<double>(j) / (GY - 1)) * 2 - 1; }

const char* const MONTES[8] = {"Cyllene", "Maenalus", "Lycaeus", "Erymanthus", "Parthenius", "Aroania", "Artemisius", "Ostracina"};
const char* const LACUS[4] = {"Lacus Stymphalis", "Lacus Pheneus", "Lacus Orchomenius", "Lacus Clitorius"};
const char* const FLUMINA[6] = {"Ladon", "Alpheus", "Styx", "Helisson", "Tragus", "Erymanthus"};

int routeOf(const float* z, const float* lake, double u, double v, double mode, double* out) {
  if (!(mode >= 3)) return 0;
  const double dir = mode == 3 ? -1 : 1;
  int n = 0;
  out[n++] = u; out[n++] = v;
  for (int k = 0; k < 90; k++) {
    double gx, gy;
    gradOf(z, u, v, gx, gy);
    const double gl = jsHypot(gx, gy);
    if (gl < 0.04) break;
    u += (dir * 0.024 * gx) / gl; v += (dir * 0.024 * gy) / gl / ASP;
    if (std::fabs(u) > 0.96 || std::fabs(v) > 0.96) break;
    out[n++] = u; out[n++] = v;
    if (dir < 0 && bil(lake, u, v) > 0.5) break;
  }
  return n;
}

void LandGen::start(uint32_t seed, Land* out, Pic* pic) {
  pic_ = pic;
  out_ = out; out_->seed = seed;
  R_ = sdk::Rng(seed);
  phase_ = SETUP; row_ = 0; item_ = 0; ng_ = 0; nl_ = 0; nr_ = 0;
}

void LandGen::setup() {
  sdk::Rng& R = R_;
  const int ranges = 3 + static_cast<int>(std::floor(R.next() * 2));
  for (int r = 0; r < ranges; r++) {                    // горная цепь: несколько вершин вдоль изогнутой линии
    double u = R.next() * 1.2 - 0.6;
    double v = (static_cast<double>(r) / ranges) * 1.7 - 0.85 + R.next() * 0.25;
    double a = R.next() * TAU;
    const int n = 3 + static_cast<int>(std::floor(R.next() * 3));
    for (int k = 0; k < n; k++) {
      const double h = 0.55 + 0.45 * R.next(), s = 0.075 + 0.07 * R.next();
      gs_[ng_++] = G{u, v, h, s};
      const double st = 0.12 + 0.07 * R.next();
      u = clampd(u + std::cos(a) * st, -0.9, 0.9); v = clampd(v + (std::sin(a) * st) / ASP, -0.92, 0.92); a += (R.next() - 0.5) * 1.1;
    }
  }
  const int hills = 16 + static_cast<int>(std::floor(R.next() * 8));
  for (int k = 0; k < hills; k++) {                     // холмов больше ближе к нам
    const double u = R.next() * 1.9 - 0.95, v = std::pow(R.next(), 1.6) * 1.9 - 0.95, h = 0.08 + 0.26 * R.next(), s = 0.07 + 0.16 * R.next();
    gs_[ng_++] = G{u, v, h, s};
  }
  for (int k = 0; k < 6; k++) {                         // пологие складки
    const double a = R.next() * TAU, f = 2.2 + k * 1.3 + R.next();
    const double ph = R.next() * TAU;
    waves_[k] = W{std::cos(a) * f, std::sin(a) * f, ph, 0.07 / (1 + k * 0.45)};
  }
  const int nl = 2 + (R.next() < 0.5 ? 1 : 0);
  for (int k = 0; k < nl; k++) {                        // озеро — котловина подальше от гор
    bool have = false; double bu = 0, bv = 0, bd = 0;
    for (int tries = 0; tries < 24; tries++) {
      const double u = R.next() * 1.4 - 0.7, v = R.next() * 1.7 - 0.85;
      double d = INFINITY;                              // Math.min(...) — пустой даёт Infinity
      for (int g = 0; g < ng_; g++) if (gs_[g].h > 0.5) { const double x = dist(gs_[g].u, gs_[g].v, u, v); if (x < d) d = x; }
      for (int l = 0; l < nl_; l++) { const double x = dist(lakes_[l].u, lakes_[l].v, u, v) * 0.8; if (x < d) d = x; }
      if (!have || d > bd) { have = true; bu = u; bv = v; bd = d; }
    }
    const double w = 0.16 + 0.1 * R.next();
    lakes_[nl_++] = L{bu, bv, w, 0, false};
    gs_[ng_++] = G{bu, bv, -0.5, w * 0.8};
    for (int j = 0; j < 2; j++) { const double a = R.next() * TAU; const double s = w * (0.45 + 0.25 * R.next()); gs_[ng_++] = G{bu + std::cos(a) * w * 0.55, bv + (std::sin(a) * w * 0.55) / ASP, -0.3, s}; }
  }
}

void LandGen::relief(int j0, int j1) {
  float* z = out_->z;
  for (int j = j0; j < j1; j++) for (int i = 0; i < GX; i++) {
    const double u = cellU(i), v = cellV(j);
    double h = 0;
    for (const W& w : waves_) h += w.amp * std::sin(w.fx * u + w.fy * v * ASP + w.ph);
    for (int k = 0; k < ng_; k++) {
      const G& g = gs_[k];
      const double du = u - g.u, dv = (v - g.v) * ASP, d2 = du * du + dv * dv;
      if (d2 < 18 * g.s * g.s) h += g.h * std::exp(-d2 / (2 * g.s * g.s));
    }
    z[j * GX + i] = static_cast<float>(h);
    out_->lake[j * GX + i] = 0;
  }
}

void LandGen::trace() {
  sdk::Rng& R = R_;
  const float* z = out_->z;
  int tops[GMAX], nt = 0;                               // вершины выше 0.5 по убыванию (сортировка в JS устойчивая)
  for (int g = 0; g < ng_; g++) if (gs_[g].h > 0.5) {
    int k = nt++;
    while (k > 0 && gs_[tops[k - 1]].h < gs_[g].h) { tops[k] = tops[k - 1]; k--; }
    tops[k] = g;
  }
  const int nr = 2 + (R.next() < 0.4 ? 1 : 0);
  for (int k = 0; k < (nr < nt ? nr : nt); k++) {      // река: с горы вниз по склону, с излучинами, до озера или края
    int si = 0;
    if (k) { const int x = 2 + static_cast<int>(std::floor(R.next() * 2)); si = x < nt - 1 ? x : nt - 1; }
    const G& src = gs_[tops[si]];
    double u = src.u + (R.next() - 0.5) * 0.08;
    double v = src.v + (R.next() - 0.5) * 0.08;
    double du = 0, dv = 0;
    const double ph = R.next() * TAU;
    double (*P)[2] = pts_[nr_];
    int n = 0;
    P[n][0] = u; P[n][1] = v; n++;
    bool pond = false;
    for (int s = 0; s < 190; s++) {
      double gx, gy;
      gradOf(z, u, v, gx, gy);
      double gl = jsHypot(gx, gy); if (gl == 0) gl = 1;
      double nx = -gx / gl, ny = -gy / gl;
      if (s) { nx = du * 0.6 + nx * 0.4; ny = dv * 0.6 + ny * 0.4; }
      const double m = std::sin(s * 0.42 + ph) * 0.45;   // излучины
      double mx = nx - ny * m, my = ny + nx * m;
      double ml = jsHypot(mx, my); if (ml == 0) ml = 1;
      mx /= ml; my /= ml;
      u += mx * 0.022; v += (my * 0.022) / ASP; du = mx; dv = my;
      P[n][0] = u; P[n][1] = v; n++;
      if (std::fabs(u) > 0.99 || std::fabs(v) > 0.99) break;
      bool inLake = false;
      for (int l = 0; l < nl_ && !inLake; l++) if (dist(u, v, lakes_[l].u, lakes_[l].v) < lakes_[l].w * 0.6) inLake = true;
      if (inLake) break;
      if (s > 14) { const double* b = P[n - 13]; if (dist(u, v, b[0], b[1]) < 0.11) { pond = true; break; } }   // застряла в ложбине — пруд
    }
    if (pond) {
      const double eu = P[n - 1][0], ev = P[n - 1][1];
      int cut = -1;
      for (int q = 0; q < n; q++) if (dist(P[q][0], P[q][1], eu, ev) < 0.06) { cut = q; break; }
      if (cut < 1) cut = n - 1;
      n = cut + 1;
      lakes_[nl_++] = L{eu, ev, 0.07, 0, true};
    }
    if (n > 12) { np_[nr_] = n; rk_[nr_] = k; nr_++; }
  }
}

void LandGen::carve(int r, int j0, int j1) {             // русло: долина вдоль реки, к устью глубже и шире
  float* z = out_->z;
  const double (*P)[2] = pts_[r];
  const int n = np_[r];
  for (int j = j0; j < j1; j++) for (int i = 0; i < GX; i++) {
    const double u = cellU(i), v = cellV(j);
    double bd = 9; int bk = 0;
    for (int k = 0; k < n; k += 2) { const double du = u - P[k][0], dv = (v - P[k][1]) * ASP, d = du * du + dv * dv; if (d < bd) { bd = d; bk = k; } }
    const double t = static_cast<double>(bk) / (n - 1), s = 0.028 + 0.02 * t;
    float& c = z[j * GX + i];
    c = static_cast<float>(c - (0.08 + 0.12 * t) * std::exp(-bd / (2 * s * s)));
  }
}

void LandGen::lake(int k) {                              // вода в котловине — до уровня берега
  float* z = out_->z; float* lk = out_->lake;
  L& l = lakes_[k];
  double lev = 0;
  for (int q = 0; q < 16; q++) { const double a = (static_cast<double>(q) / 16) * TAU; lev += bil(z, l.u + std::cos(a) * l.w, l.v + (std::sin(a) * l.w) / ASP); }
  lev = lev / 16 - 0.03; l.level = lev;
  const double R = l.w * 1.5;
  for (int j = 0; j < GY; j++) {
    const double v = cellV(j);
    if (std::fabs((v - l.v) * ASP) > R) continue;      // hypot ≥ любой из катетов (и у V8) — дальше берега: в JS тот же return
    for (int i = 0; i < GX; i++) {
      const double u = cellU(i);
      if (std::fabs(u - l.u) > R) continue;
      const double d = dist(u, v, l.u, l.v);
      if (d > R) continue;
      const int q = j * GX + i;
      const double m = clampd((lev - z[q]) / 0.035) * clampd((R - d) / (l.w * 0.3));
      if (m > lk[q]) { lk[q] = static_cast<float>(m); z[q] = static_cast<float>(z[q] * (1 - m) + lev * m); }
    }
  }
}

void LandGen::norm() {                                   // нормировка в −1…1
  float* z = out_->z;
  double mean = 0, mx = 1e-6;
  for (int q = 0; q < NG; q++) mean += z[q];
  mean /= NG;
  for (int q = 0; q < NG; q++) { z[q] = static_cast<float>(z[q] - mean); const double a = std::fabs(static_cast<double>(z[q])); if (a > mx) mx = a; }
  for (int q = 0; q < NG; q++) z[q] = static_cast<float>(z[q] / mx);
  if (pic_) fillPic();
}

void LandGen::fillPic() {                                // картина: вершины со скана готовой z, озёра и реки из генератора, имена от зерна
  Pic& p = *pic_;
  const uint64_t seed = out_->seed;
  const float* z = out_->z;
  p.nl = nl_; p.nr = nr_;
  for (int k = 0; k < nl_; k++) {                        // пруды идут после основных озёр, имени нет
    const L& l = lakes_[k];
    p.lakes[k] = Pic::Lake{l.u, l.v, l.w, l.level, l.pond, l.pond ? -1 : static_cast<int>((seed + k) % 4)};
  }
  for (int r = 0; r < nr_; r++) {
    Pic::River& rv = p.rivers[r];
    rv.name = static_cast<int>((seed + static_cast<uint64_t>(rk_[r]) * 3) % 6); rv.n = np_[r];
    for (int q = 0; q < rv.n; q++) { rv.pts[q][0] = pts_[r][q][0]; rv.pts[q][1] = pts_[r][q][1]; }
  }
  struct C { double u, v, h; };
  std::vector<C> cand;                                   // локальные максимумы повыше 0.4 (>, не ≥), порядок скана как в JS
  for (int j = 1; j < GY - 1; j++) for (int i = 1; i < GX - 1; i++) {
    const int q = j * GX + i;
    const double h = z[q];
    if (h < 0.4) continue;
    bool top = true;
    for (int dj = -1; dj <= 1 && top; dj++) for (int di = -1; di <= 1; di++) if ((di || dj) && static_cast<double>(z[q + dj * GX + di]) > h) { top = false; break; }
    if (top) cand.push_back(C{cellU(i), cellV(j), h});
  }
  std::stable_sort(cand.begin(), cand.end(), [](const C& a, const C& b) { return a.h > b.h; });
  p.np = 0;
  for (const C& c : cand) {                              // не теснее 0.25 к уже оставленным, не больше 8
    bool ok = true;
    for (int k = 0; k < p.np && ok; k++) if (!(dist(p.peaks[k].u, p.peaks[k].v, c.u, c.v) > 0.25)) ok = false;
    if (!ok) continue;
    if (p.np >= 8) break;
    const int k = p.np++;
    p.peaks[k] = Pic::Peak{c.u, c.v, c.h, k < 3 ? static_cast<int>((seed + static_cast<uint64_t>(k) * 5) % 8) : -1};
  }
}

bool LandGen::step() {
  if (!out_) return true;
  for (;;) {
    switch (phase_) {
      case SETUP: setup(); phase_ = RELIEF; row_ = 0; return false;
      case RELIEF: {
        const int j1 = row_ + ROWS_RELIEF < GY ? row_ + ROWS_RELIEF : GY;
        relief(row_, j1); row_ = j1;
        if (row_ >= GY) phase_ = TRACE;
        return false;
      }
      case TRACE: trace(); phase_ = CARVE; item_ = 0; row_ = 0; return false;
      case CARVE: {
        if (item_ >= nr_) { phase_ = LAKES; item_ = 0; continue; }
        const int j1 = row_ + ROWS < GY ? row_ + ROWS : GY;
        carve(item_, row_, j1); row_ = j1;
        if (row_ >= GY) { row_ = 0; item_++; }
        return false;
      }
      case LAKES:
        if (item_ >= nl_) { phase_ = NORM; continue; }
        lake(item_++);
        return false;
      case NORM: norm(); phase_ = DONE; return true;
      case DONE: return true;
    }
  }
}

}  // namespace arcadia

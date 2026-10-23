// Arcadia — звук, см. sound.hpp. Арифметика и порядок вызовов ГСЧ — как в tools/ref/terrain-worklet.js.
#include "sound.hpp"

#include <cmath>
#include <cstring>

namespace arcadia {

static double reflect(double x) { x = std::fmod(std::fmod(x + 1, 4.0) + 4, 4.0); return (x > 2 ? 4 - x : x) - 1; }   // за краем — зеркало

void Sound::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  rng_ = sdk::Rng(seed);
  for (int i = 0; i < NV; i++) {                        // как конструктор worklet: wp, затем seed[0..3] — голос за голосом
    vo_[i] = V{};
    vo_[i].wp = rng_.next() * 6.28;
    for (double& s : vo_[i].seed) s = rng_.next() * 6.28;
  }
  std::memset(z0_, 0, sizeof z0_);
  z_ = lake_ = nullptr;
  xf_ = 1; relief_ = 0.3; speed_ = 0.05; wind_ = 0; spread_ = 0.6; t_ = 0;
}

void Sound::land(const Land& l, bool now) {
  if (z_) std::memcpy(z0_, z_, sizeof z0_);
  else std::memset(z0_, 0, sizeof z0_);
  z_ = l.z; lake_ = l.lake;
  xf_ = now ? 1 : 0;
}

void Sound::voice(int i, const Msg& d) {
  if (i < 0 || i >= NV) return;
  V& o = vo_[i];
  const bool fresh = d.on && !o.on && o.g < 1e-4;
  o.on = d.on; o.f = d.f; o.hx = d.hx; o.hy = d.hy; o.r = d.r; o.fig = d.fig; o.lvl = d.lvl; o.mode = d.mode; o.sp = d.sp; o.pan = d.pan;
  if (d.hasRoute) {                                     // путь: ломаная от дома (float, как Float32Array.from), накопленные длины
    o.rn = d.route && d.n >= 4 ? d.n : 0;
    if (o.rn) {
      for (int k = 0; k < o.rn; k++) o.route[k] = static_cast<float>(d.route[k]);
      const int n = o.rn / 2;
      o.cum[0] = 0;
      for (int k = 1; k < n; k++) o.cum[k] = static_cast<float>(o.cum[k - 1] + jsHypot(static_cast<double>(o.route[2 * k]) - o.route[2 * k - 2], static_cast<double>(o.route[2 * k + 1]) - o.route[2 * k - 1]));
      o.rl = o.cum[n - 1];
    }
  }
  if (fresh) { target(o); o.cx = o.tx; o.cy = o.ty; o.rs = o.r; o.env = 0.01; o.ag = 1; }
}

void Sound::target(V& o) const {                         // куда идёт центр петли: стоит, кругом, наугад, по ломаной туда-обратно
  const double w = o.wp, sp = o.sp, a = ASP;
  if (o.mode == 1) { o.tx = o.hx + sp * std::cos(w); o.ty = o.hy + (sp * std::sin(w)) / a; }
  else if (o.mode == 2) {
    const double* s = o.seed;
    o.tx = o.hx + sp * (0.62 * std::sin(0.73 * w + s[0]) + 0.38 * std::sin(1.91 * w + s[1]));
    o.ty = o.hy + (sp * (0.6 * std::sin(0.89 * w + s[2]) + 0.4 * std::sin(1.37 * w + s[3]))) / a;
  } else if ((o.mode == 3 || o.mode == 4) && o.rn && o.rl > 0.02) {
    const double q = (0.5 - 0.5 * std::cos(w * 0.5)) * o.rl;
    const float* c = o.cum;
    const int n = o.rn / 2;
    int k = 1;
    while (k < n - 1 && c[k] < q) k++;
    const double d = static_cast<double>(c[k]) - c[k - 1];
    const double u = (q - c[k - 1]) / (d > 1e-6 ? d : 1e-6);
    const float* r = o.route;
    o.tx = r[2 * k - 2] + (static_cast<double>(r[2 * k]) - r[2 * k - 2]) * u;
    o.ty = r[2 * k - 1] + (static_cast<double>(r[2 * k + 1]) - r[2 * k - 1]) * u;
  } else { o.tx = o.hx; o.ty = o.hy; }
}

double Sound::cub(const float* z, double gx, double gy) const {   // Catmull — Rom по 4 × 4 узлам
  const int ix = static_cast<int>(std::floor(gx)), iy = static_cast<int>(std::floor(gy));
  const double fx = gx - ix, fy = gy - iy;
  const double wx0 = ((-0.5 * fx + 1) * fx - 0.5) * fx, wx1 = (1.5 * fx - 2.5) * fx * fx + 1, wx2 = ((-1.5 * fx + 2) * fx + 0.5) * fx, wx3 = (0.5 * fx - 0.5) * fx * fx;
  const double wy[4] = {((-0.5 * fy + 1) * fy - 0.5) * fy, (1.5 * fy - 2.5) * fy * fy + 1, ((-1.5 * fy + 2) * fy + 0.5) * fy, (0.5 * fy - 0.5) * fy * fy};
  const auto mn = [](int a, int b) { return a < b ? a : b; };
  const auto mx = [](int a, int b) { return a > b ? a : b; };
  const int x0 = mx(0, ix - 1), x1 = mx(0, mn(GX - 1, ix)), x2 = mn(GX - 1, ix + 1), x3 = mn(GX - 1, ix + 2);
  double s = 0;
  for (int j = 0; j < 4; j++) {
    const int yy = mn(GY - 1, mx(0, iy - 1 + j)) * GX;
    s += wy[j] * (z[yy + x0] * wx0 + z[yy + x1] * wx1 + z[yy + x2] * wx2 + z[yy + x3] * wx3);
  }
  return s;
}

double Sound::height(double u, double v) const {
  u = reflect(u); v = reflect(v);
  const double gx = (u + 1) * 0.5 * (GX - 1), gy = (v + 1) * 0.5 * (GY - 1);
  double h = cub(z_, gx, gy);
  if (xf_ < 1) h = cub(z0_, gx, gy) * (1 - xf_) + h * xf_;
  if (wind_ > 0.01) {                                   // озеро: ветер рябит воду
    const int gxi = static_cast<int>(gx), gyi = static_cast<int>(gy);
    const int i = GX - 2 < gxi ? GX - 2 : gxi, j = GY - 2 < gyi ? GY - 2 : gyi;
    const double fx = gx - i, fy = gy - j;
    const float* L = lake_;
    const double m = (L[j * GX + i] * (1 - fx) + L[j * GX + i + 1] * fx) * (1 - fy) + (L[(j + 1) * GX + i] * (1 - fx) + L[(j + 1) * GX + i + 1] * fx) * fy;
    if (m > 0.01) h += m * wind_ * 0.16 * std::sin(29 * u + t_ * 2.3) * std::sin(23 * v * ASP - t_ * 1.7);
  }
  return h;
}

bool Sound::process(float* L, float* R, int n) {
  for (int k = 0; k < n; k++) L[k] = R[k] = 0;
  const double sr = sr_, fold = 1.5708 * (1 + 3 * relief_), dt = n / sr;
  t_ += dt;
  if (xf_ < 1) { xf_ += dt / 0.5; if (xf_ > 1) xf_ = 1; }
  bool any = false;
  for (V& o : vo_) {
    if (!o.on && o.g < 1e-5) continue;
    any = true;
    o.wp += TAU * speed_ * dt;
    target(o);
    o.nzT += dt * 7;
    if (o.nzT > 1) { o.nzT -= 1; o.nzN = rng_.next() * 2 - 1; }   // ветер: петля дрожит
    const double pan = o.pan * spread_, gl = (1 - pan) * 0.5, gr = (1 + pan) * 0.5;
    for (int k = 0; k < n; k++) {
      o.g += ((o.on ? o.lvl : 0) - o.g) * (o.on ? 0.0015 : 0.0006);
      o.cx += (o.tx - o.cx) * 0.0008; o.cy += (o.ty - o.cy) * 0.0008; o.rs += (o.r - o.rs) * 0.001;
      o.nz += (o.nzN - o.nz) * 0.0004;
      o.ph += o.f / sr;
      if (o.ph >= 1) o.ph -= 1;
      const double a = TAU * o.ph, r = o.rs * (1 + wind_ * 0.25 * o.nz);
      double du, dv;
      if (o.fig == 1) { du = std::sin(a); dv = 0.55 * std::sin(2 * a); }                 // восьмёрка
      else if (o.fig == 2) { du = std::sin(2 * a); dv = 0.8 * std::sin(3 * a + 0.7); }   // узел 2 : 3
      else { du = std::cos(a); dv = std::sin(a); }                                         // круг
      double y = std::sin(fold * height(o.cx + r * du, o.cy + (r * dv) / ASP));
      const double yd = y - o.dx + 0.996 * o.dy;                                           // без постоянной составляющей
      o.dx = y; o.dy = yd; y = yd;
      o.env += (y * y - o.env) * 0.00006;                                                  // ровная громкость (АРУ)
      const double agT = 0.32 / std::sqrt(o.env + 1e-5);
      o.ag += ((agT < 4 ? agT : 4) - o.ag) * 0.00005;
      o.lp += 0.55 * (y - o.lp);                                                           // мягкий срез верха
      const double s = o.lp * o.ag * o.g;
      L[k] = static_cast<float>(L[k] + s * gl); R[k] = static_cast<float>(R[k] + s * gr);
    }
  }
  if (!any) return false;
  for (int k = 0; k < n; k++) { L[k] = static_cast<float>(std::tanh(L[k] * 0.7)); R[k] = static_cast<float>(std::tanh(R[k] * 0.7)); }
  return true;
}

double Sound::gain(int i) const {
  const V& o = vo_[i];
  const double e = std::sqrt(o.env) * o.ag * 2.2;
  return o.g * (e < 1 ? e : 1);
}

}  // namespace arcadia

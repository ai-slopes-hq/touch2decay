// C-обёртка над Engine (один статический экземпляр: кольца и снимки ~3 МБ — не на стек).
#include "t2d_app.h"
#include "engine.hpp"
#include "../bridge/t2d.h"
#include "../host/scale.hpp"
#include "../worlds/arcadia/land.hpp"
#include <cstring>
#include <memory>

static Engine engine;

void t2d_app_init(double sr, unsigned seed, double ticks_per_sec, unsigned watch) { engine.init(sr, seed, ticks_per_sec, watch); }
void t2d_app_render(float* L, float* R, int n, uint64_t host_time) { engine.render(L, R, n, host_time); }
int t2d_app_action(int slot, int kind, int i, const double* a, int n, uint64_t touch_time) { return engine.action(slot, kind, i, a, n, touch_time) ? 1 : 0; }
int t2d_app_scale_steps(int idx, int* out) {
  if (idx < 0 || idx >= Scale::kScales) return 0;
  const int* s = Scale::stepsOf(idx);
  for (int k = 0; k < 7; k++) out[k] = s[k];
  return 7;
}
int t2d_app_mirror(int slot, double* buf, int cap) { return engine.mirror(slot, buf, cap); }
int t2d_app_heard(int slot, double* buf, int cap) { return engine.heard(slot, buf, cap); }
int t2d_app_restore(int slot, const char* s, int len, uint64_t touch_time) { return engine.restore(slot, s, len, touch_time) ? 1 : 0; }
int t2d_app_snap_take(int* id, int* slot, char* buf, int cap) { return engine.snapTake(id, slot, buf, cap); }
void t2d_app_stats(t2d_app_stats_t* out) { engine.stats(out); }
int t2d_app_levels(float* out, int n) { return engine.levels(out, n); }
int t2d_app_lfo(double* buf, int cap) { return engine.lfo(buf, cap); }
double t2d_app_lfo_sample(int shape, double morph, double u, int seed) { return t2d_lfo_sample(shape, morph, u, seed); }

int t2d_app_arc_pic(unsigned seed, float* z, float* lake, double* meta, int cap) {
  auto land = std::make_unique<arcadia::Land>();         // на куче: Land ~100 КБ, LandGen ~9 КБ, Pic ~10 КБ
  auto pic = std::make_unique<arcadia::Pic>();
  auto gen = std::make_unique<arcadia::LandGen>();
  gen->start(seed, land.get(), pic.get()); gen->run();
  int len = 3 + 4 * pic->np + 6 * pic->nl;
  for (int r = 0; r < pic->nr; r++) len += 2 + 2 * pic->rivers[r].n;
  if (len > cap) return 0;
  std::memcpy(z, land->z, sizeof land->z);
  std::memcpy(lake, land->lake, sizeof land->lake);
  int w = 0;
  meta[w++] = pic->np; meta[w++] = pic->nl; meta[w++] = pic->nr;
  for (int k = 0; k < pic->np; k++) { const auto& p = pic->peaks[k]; meta[w++] = p.u; meta[w++] = p.v; meta[w++] = p.h; meta[w++] = p.name; }
  for (int k = 0; k < pic->nl; k++) { const auto& l = pic->lakes[k]; meta[w++] = l.u; meta[w++] = l.v; meta[w++] = l.w; meta[w++] = l.level; meta[w++] = l.pond ? 1 : 0; meta[w++] = l.name; }
  for (int r = 0; r < pic->nr; r++) {
    const auto& rv = pic->rivers[r];
    meta[w++] = rv.n; meta[w++] = rv.name;
    for (int q = 0; q < rv.n; q++) { meta[w++] = rv.pts[q][0]; meta[w++] = rv.pts[q][1]; }
  }
  return w;
}
const char* t2d_app_arc_name(int kind, int idx) {
  if (idx < 0) return nullptr;
  if (kind == 0 && idx < 8) return arcadia::MONTES[idx];
  if (kind == 1 && idx < 4) return arcadia::LACUS[idx];
  if (kind == 2 && idx < 6) return arcadia::FLUMINA[idx];
  return nullptr;
}
int t2d_app_arc_route(const float* z, const float* lake, double u, double v, int mode, double* out, int cap) {
  if (cap < arcadia::RMAX_PTS) return 0;
  return arcadia::routeOf(z, lake, u, v, mode, out);
}

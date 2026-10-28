// C-обёртка над Engine (один статический экземпляр: кольца и снимки ~3 МБ — не на стек).
#include "t2d_app.h"
#include "engine.hpp"

static Engine engine;

void t2d_app_init(double sr, unsigned seed, double ticks_per_sec, unsigned watch) { engine.init(sr, seed, ticks_per_sec, watch); }
void t2d_app_render(float* L, float* R, int n, uint64_t host_time) { engine.render(L, R, n, host_time); }
int t2d_app_action(int slot, int kind, int i, const double* a, int n, uint64_t touch_time) { return engine.action(slot, kind, i, a, n, touch_time) ? 1 : 0; }
int t2d_app_mirror(int slot, double* buf, int cap) { return engine.mirror(slot, buf, cap); }
int t2d_app_heard(int slot, double* buf, int cap) { return engine.heard(slot, buf, cap); }
void t2d_app_stats(t2d_app_stats_t* out) { engine.stats(out); }

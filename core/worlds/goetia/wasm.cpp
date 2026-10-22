// Goetia — интерфейс ядра для WASM (goetia.wasm), его зовёт goetia-worklet.js. Один экземпляр на модуль, без кучи.
#include <new>

#include "goetia.hpp"

using goetia::Goetia;

alignas(Goetia) static unsigned char mem[sizeof(Goetia)];
static Goetia* core = nullptr;
static int progBuf[2 * goetia::PMAX];                   // пары (код знака, сдвиг) — пишет обёртка
static float out[2 * 128];                              // n сэмплов L, затем n сэмплов R

#define API extern "C" __attribute__((used))

API void gt_init(double sr) { core = new (mem) Goetia(sr); }
API int* gt_prog_buf() { return progBuf; }
API void gt_prog(int i, int n) { core->prog(i, n, progBuf); }
API void gt_voice(int i, int on, double rate, double lp, double lvl, int legio, double pan, double rel, int trig) {
  core->voice(i, on != 0, rate, lp, lvl, legio, pan, rel, trig);
}
API void gt_fx(double spread, double wide) { core->fx(spread, wide); }
API float* gt_process(int n) {
  if (n > 128) n = 128;
  core->process(out, out + n, n);
  return out;
}
API double gt_t0(int i) { return core->t0(i); }
API double gt_gv(int i) { return core->gv(i); }
API void gt_set_t(int i, double t) { core->setT(i, t); }

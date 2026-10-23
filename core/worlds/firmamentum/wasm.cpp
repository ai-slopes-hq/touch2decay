// Firmamentum — интерфейс ядра для WASM (pulsar.wasm), его зовёт pulsar-worklet.js. Один экземпляр на модуль, без кучи.
#include <new>

#include "pulsar.hpp"

using firmamentum::Pulsar;

alignas(Pulsar) static unsigned char mem[sizeof(Pulsar)];
static Pulsar* eng = nullptr;
static float out[2 * 128];                              // n сэмплов L, затем n сэмплов R
static double ckBuf[2 * firmamentum::CKMAX];            // пары (pan, a) щелчков
static int flBuf[firmamentum::FLMAX];                   // номера голосов вспышек

#define API extern "C" __attribute__((used))
static bool ok(int i) { return eng && i >= 0 && i < firmamentum::VMAX; }   // номер голоса — только 0…5, иначе мимо

API void pl_init(double sr, unsigned seed) { eng = new (mem) Pulsar(sr, seed); }
API void pl_voice(int i, int on, double fp, double ff, double cyc, double win, double mask, double lvl, double pan) {
  if (ok(i)) eng->voice(i, on, fp, ff, cyc, win, mask, lvl, pan);
}
API void pl_fx(double jit, double spread, double crep, double fulg) { if (eng) eng->fx(jit, spread, crep, fulg); }
API float* pl_process(int n) {
  if (n > 128) n = 128;
  eng->process(out, out + n, n);
  return out;
}
API double pl_count(int i) { return ok(i) ? eng->count(i) : 0; }
API double pl_gain(int i) { return ok(i) ? eng->gain(i) : 0; }
API int pl_ck() { return eng ? eng->ck(ckBuf) : 0; }
API double* pl_ck_buf() { return ckBuf; }
API int pl_fl() { return eng ? eng->fl(flBuf) : 0; }
API int* pl_fl_buf() { return flBuf; }

// Oceanus — интерфейс ядра для WASM (ocean.wasm), его зовёт ocean-worklet.js. Один экземпляр на модуль, без кучи.
#include <new>

#include "ocean.hpp"

using oceanus::Ocean;

alignas(Ocean) static unsigned char mem[sizeof(Ocean)];
static Ocean* eng = nullptr;
static float out[2 * 128];                              // n сэмплов L, затем n сэмплов R

#define API extern "C" __attribute__((used))
static bool ok(int i) { return eng && i >= 0 && i < oceanus::VMAX; }   // номер голоса — только 0…5, иначе мимо

API void oc_init(double sr, unsigned seed) { eng = new (mem) Ocean(sr, seed); }
API void oc_params(double kt, double damp, double kc, double wind, double tide, double moonRate, double storm, double sway, double swayTo) {
  if (eng) eng->params(kt, damp, kc, wind, tide, moonRate, storm, sway, swayTo);
}
API void oc_push(double id, double a, double d, double k) { if (eng) eng->push(id, a, d, k); }
API void oc_release(double id) { if (eng) eng->release(id); }
API void oc_splash(double a, double amt) { if (eng) eng->splash(a, amt); }
API void oc_voice(int i, int on, double f, double lvl, double path) { if (ok(i)) eng->voice(i, on != 0, f, lvl, path); }
API float* oc_process(int n) {
  if (n > 128) n = 128;
  eng->process(out, out + n, n);
  return out;
}
API const float* oc_shape() { return eng ? eng->shape() : nullptr; }
API double oc_moon() { return eng ? eng->moon() : 0; }
API double oc_gain(int i) { return ok(i) ? eng->gain(i) : 0; }

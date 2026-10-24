// Мост ядра SDK для WASM (t2d.wasm): хост и все миры SDK в одном модуле, его крутит t2d-worklet.js (в Node — tools/t2d-core.mjs).
// Один экземпляр на модуль, всё статическое (хост ~1.2 МБ — не на стек). Миры — по слотам хоста (номер мира): Cymatica — 2, Firmamentum — 10.
// Обмен — через буферы ядра: аргументы action (t2d_args), зеркало и услышанное (t2d_mbuf), строка снимка (t2d_str_buf + длина).
#include <cstring>
#include <string>

#include "../host/host.hpp"
#include "../worlds/cymatica/world.hpp"
#include "../worlds/firmamentum/world.hpp"

static Host host;
static firmamentum::Firmamentum firm(host.scale());
static cymatica::Cymatica cym;
static sdk::World* worlds[Host::SLOTS] = {};
static constexpr int ARGS_CAP = 256;                    // узор Cymatica — 117 чисел
static double args[ARGS_CAP];
static double mbuf[512];                                // зеркало Firmamentum — до 101 числа
static constexpr int STR_CAP = 1 << 16;
static char str[STR_CAP];

// libc++ при сбое (нет памяти под строку снимка) печатает в stderr — это тянуло бы импорты WASI (fd_write …); у нас — просто ловушка.
// Только для emscripten (inline-пространство __2 у его libc++); без него (core/build-wasi.sh) то же — в core/bridge/wasi.cpp
#ifdef __EMSCRIPTEN__
namespace std { inline namespace __2 {
[[noreturn]] void __libcpp_verbose_abort(const char*, ...) noexcept { __builtin_trap(); }
} }
#endif

#define API extern "C" __attribute__((used))
static sdk::World* at(int slot) { return (slot >= 0 && slot < Host::SLOTS) ? worlds[slot] : nullptr; }

API void t2d_init(double sr, unsigned seed) {
  host.prepare(sr, seed);
  firm.prepare(sr, seed);                               // зерно мира — то же (Rng модели; у ревербов — seed + тип)
  cym.prepare(sr, seed);                                // Cymatica: шанс удара и шум смычка — от зерна
  worlds[2] = &cym;
  host.add(2, &cym);
  worlds[10] = &firm;
  host.add(10, &firm);
}
API double* t2d_args() { return args; }
API void t2d_action(int slot, int kind, int i, const double* a, int n) {
  if (n < 0) n = 0;
  if (n > ARGS_CAP) n = ARGS_CAP;
  host.action(slot, kind, i, a, n);
}
API void t2d_process(int n) { host.process(n); }
API const float* t2d_dry(int slot, int ch) { return host.dry(slot, ch); }
API const float* t2d_ret(int ch) { return host.ret(ch); }
API float* t2d_ext(int rev, int ch) { return host.ext(static_cast<sdk::Rev>(rev < 0 ? 0 : rev > 3 ? 3 : rev), ch); }
API double* t2d_mbuf() { return mbuf; }
API int t2d_mirror(int slot) { sdk::World* w = at(slot); return w ? w->mirror(mbuf, 512) : 0; }
API int t2d_heard(int slot) { sdk::World* w = at(slot); return w ? w->heard(mbuf, 512) : 0; }
API char* t2d_str_buf() { return str; }
API int t2d_str_cap() { return STR_CAP; }
API int t2d_snapshot(int slot) {                        // длина строки в t2d_str_buf; не влезла — 0
  sdk::World* w = at(slot);
  if (!w) return 0;
  const std::string s = w->snapshot();
  if (s.size() > static_cast<size_t>(STR_CAP)) return 0;
  std::memcpy(str, s.data(), s.size());
  return static_cast<int>(s.size());
}
API void t2d_restore(int slot, int len) {
  sdk::World* w = at(slot);
  if (w && len >= 0 && len <= STR_CAP) w->restore(std::string(str, static_cast<size_t>(len)));
}
API void t2d_fader(int slot, double g) { host.fader(slot, g); }
API void t2d_scale(int on, int idx, int root) { host.scale(on != 0, idx, root); }

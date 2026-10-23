// Мост ядра SDK для WASM (t2d.wasm): хост и все миры SDK в одном модуле, его крутит t2d-worklet.js (в Node — tools/t2d-core.mjs).
// Один экземпляр на модуль, всё статическое (хост ~1.2 МБ — не на стек). Миры — по слотам хоста (номер мира): Oceanus — 8, Firmamentum — 10, Goetia — 15.
// Обмен — через буферы ядра: аргументы action (t2d_args), зеркало и услышанное (t2d_mbuf), строка снимка (t2d_str_buf + длина).
#include <cstring>
#include <string>

#include "../host/host.hpp"
#include "../worlds/firmamentum/world.hpp"
#include "../worlds/oceanus/world.hpp"
#include "../worlds/goetia/world.hpp"
#include "../worlds/monochord/world.hpp"
#include "../worlds/horologium/world.hpp"

static Host host;
static firmamentum::Firmamentum firm(host.scale());
static oceanus::Oceanus ocean(host.scale());
static goetia::World goe(host.scale());
static monochord::World mono(host.scale());
static horologium::World horo(host.scale());
static sdk::World* worlds[Host::SLOTS] = {};
static double args[64];
static double mbuf[512];                                // зеркало: Firmamentum — до 101 числа, Oceanus — до 135, Goetia — до 59, Monochordum — 52, Horologium — 47
static constexpr int STR_CAP = 1 << 16;
static char str[STR_CAP];

// libc++ при сбое (нет памяти под строку снимка) печатает в stderr — это тянуло бы импорты WASI (fd_write …); у нас — просто ловушка
namespace std { inline namespace __2 {
[[noreturn]] void __libcpp_verbose_abort(const char*, ...) noexcept { __builtin_trap(); }
} }
// старый emscripten (3.1.6): abort → _Exit → импорт WASI proc_exit; модуль без импортов — тоже ловушка
extern "C" void _Exit(int) { __builtin_trap(); }

#define API extern "C" __attribute__((used))
static sdk::World* at(int slot) { return (slot >= 0 && slot < Host::SLOTS) ? worlds[slot] : nullptr; }

API void t2d_init(double sr, unsigned seed) {
  host.prepare(sr, seed);
  firm.prepare(sr, seed);                               // зерно мира — то же (Rng модели; у ревербов — seed + тип)
  worlds[10] = &firm;
  host.add(10, &firm);
  ocean.prepare(sr, seed);
  worlds[8] = &ocean;
  host.add(8, &ocean);
  goe.prepare(sr, seed);
  worlds[15] = &goe;
  host.add(15, &goe);
  mono.prepare(sr, seed);
  worlds[7] = &mono;
  host.add(7, &mono);
  horo.prepare(sr, seed);
  worlds[9] = &horo;
  host.add(9, &horo);
}
API double* t2d_args() { return args; }
API void t2d_action(int slot, int kind, int i, const double* a, int n) {
  if (n < 0) n = 0;
  if (n > 64) n = 64;
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
// часы: время начала следующего блока (секунды контекста), MIDI — байт от входа src или разобранное сообщение (оболочка iOS)
API void t2d_time(double t) { host.time(t); }
API void t2d_midi_byte(int src, int status, double at) { host.midiByte(src, status, at); }
API void t2d_midi_msg(int kind, double n, double bpm, double at) { host.midiMsg(kind, n, bpm, at); }
API int t2d_hmirror() {                                 // зеркало хоста: сетка есть, t0, p, время блока
  const sdk::Clock& c = host.clock();
  mbuf[0] = c.grid.on ? 1 : 0; mbuf[1] = c.grid.t0; mbuf[2] = c.grid.p; mbuf[3] = c.now;
  return 4;
}
API int t2d_hevents() { return host.events(mbuf, 512); }   // события часов: по 2 числа — код, bpm

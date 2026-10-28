// Общий мост ядра SDK (C-ABI, объявлен в t2d.h): wasm (t2d.wasm) и нативные цели (iOS, sdk-test). Хост и все миры SDK в одном модуле, его крутит t2d-worklet.js (в Node — tools/t2d-core.mjs).
// Один экземпляр на модуль, всё статическое (хост ~1.2 МБ — не на стек). Миры — по слотам хоста (номер мира): Tenebrae — 1 (этап 1: только звук), Cymatica — 2, Natura — 4, Inferno — 5, Monochordum — 7, Oceanus — 8, Horologium — 9, Firmamentum — 10, Tria — 11, Arcadia — 12, Portus — 13, Goetia — 15.
// Обмен — через буферы ядра: аргументы action (t2d_args), зеркало и услышанное (t2d_mbuf), строка снимка (t2d_str_buf + длина).
#include <cstring>
#include <string>

#include "t2d.h"
#include "../host/host.hpp"
#include "../worlds/cymatica/world.hpp"
#include "../worlds/firmamentum/world.hpp"
#include "../worlds/oceanus/world.hpp"
#include "../worlds/goetia/world.hpp"
#include "../worlds/monochord/world.hpp"
#include "../worlds/horologium/world.hpp"
#include "../worlds/arcadia/world.hpp"
#include "../worlds/tria/world.hpp"
#include "../worlds/portus/world.hpp"
#include "../worlds/natura/world.hpp"
#include "../worlds/inferno/world.hpp"
#include "../worlds/tenebrae/world.hpp"

static Host host;
static firmamentum::Firmamentum firm(host.scale());
static cymatica::Cymatica cym(host.scale());
static oceanus::Oceanus ocean(host.scale());
static goetia::World goe(host.scale());
static monochord::World mono(host.scale());
static horologium::World horo(host.scale());
static arcadia::World arc(host.scale());
static tria::World tria3(host.scale());
static portus::World port(host.scale());
static natura::World nat(host.scale());
static inferno::Inferno inf(host.scale());
static tenebrae::World ten(host.scale());              // таблицы волн ~0.95 МБ и 6 голосов — статика
static sdk::World* worlds[Host::SLOTS] = {};
static constexpr int ARGS_CAP = 256;                    // узор Cymatica — 117 чисел
static double args[ARGS_CAP];
static constexpr int MBUF = 1024;
static double mbuf[MBUF];                               // зеркало: Tenebrae — 781 число, Firmamentum — до 101, Oceanus — до 135, Goetia — до 59, Monochordum — 52, Horologium — 47, Tria — 47, Arcadia — 65
static constexpr int STR_CAP = 1 << 16;
static char str[STR_CAP];

// libc++ при сбое (нет памяти под строку снимка) печатает в stderr — это тянуло бы импорты WASI (fd_write …); у нас — просто ловушка.

#define T2D_API extern "C" __attribute__((used))
static sdk::World* at(int slot) { return (slot >= 0 && slot < Host::SLOTS) ? worlds[slot] : nullptr; }

T2D_API void t2d_init(double sr, unsigned seed) {
  host.prepare(sr, seed);
  firm.prepare(sr, seed);                               // зерно мира — то же (Rng модели; у ревербов — seed + тип)
  worlds[10] = &firm;
  host.add(10, &firm);
  cym.prepare(sr, seed);                                // Cymatica: шанс удара и шум смычка — от зерна
  worlds[2] = &cym;
  host.add(2, &cym);
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
  arc.prepare(sr, seed);
  worlds[12] = &arc;
  host.add(12, &arc);
  tria3.prepare(sr, seed);
  worlds[11] = &tria3;
  host.add(11, &tria3);
  port.prepare(sr, seed);
  worlds[13] = &port;
  host.add(13, &port);
  nat.prepare(sr, seed);                                // Natura: шанс шага и шелест — от зерна
  worlds[4] = &nat;
  host.add(4, &nat);
  inf.prepare(sr, seed);                                // Inferno — слот 5
  worlds[5] = &inf;
  host.add(5, &inf);
  ten.prepare(sr, seed);                                // Tenebrae — слот 1: шум голосов и удары — от зерна
  worlds[1] = &ten;
  host.add(1, &ten);
}
T2D_API double* t2d_args() { return args; }
T2D_API void t2d_action(int slot, int kind, int i, const double* a, int n) {
  if (n < 0) n = 0;
  if (n > ARGS_CAP) n = ARGS_CAP;
  host.action(slot, kind, i, a, n);
}
T2D_API void t2d_process(int n) { host.process(n); }
T2D_API const float* t2d_dry(int slot, int ch) { return host.dry(slot, ch); }
T2D_API const float* t2d_ret(int ch) { return host.ret(ch); }
T2D_API float* t2d_ext(int rev, int ch) { return host.ext(static_cast<sdk::Rev>(rev < 0 ? 0 : rev > 3 ? 3 : rev), ch); }
T2D_API double* t2d_mbuf() { return mbuf; }
T2D_API int t2d_mirror(int slot) { sdk::World* w = at(slot); return w ? w->mirror(mbuf, MBUF) : 0; }
T2D_API int t2d_heard(int slot) { sdk::World* w = at(slot); return w ? w->heard(mbuf, MBUF) : 0; }
T2D_API char* t2d_str_buf() { return str; }
T2D_API int t2d_str_cap() { return STR_CAP; }
T2D_API int t2d_snapshot(int slot) {                        // длина строки в t2d_str_buf; не влезла — 0
  sdk::World* w = at(slot);
  if (!w) return 0;
  const std::string s = w->snapshot();
  if (s.size() > static_cast<size_t>(STR_CAP)) return 0;
  std::memcpy(str, s.data(), s.size());
  return static_cast<int>(s.size());
}
T2D_API void t2d_restore(int slot, int len) {
  sdk::World* w = at(slot);
  if (w && len >= 0 && len <= STR_CAP) w->restore(std::string(str, static_cast<size_t>(len)));
}
T2D_API void t2d_fader(int slot, double g) { host.fader(slot, g); }
T2D_API void t2d_scale(int on, int idx, int root) { host.scale(on != 0, idx, root); }
// часы: время начала следующего блока (секунды контекста), MIDI — байт от входа src или разобранное сообщение (оболочка iOS)
T2D_API void t2d_time(double t) { host.time(t); }
T2D_API void t2d_midi_byte(int src, int status, double at) { host.midiByte(src, status, at); }
T2D_API void t2d_midi_msg(int kind, double n, double bpm, double at) { host.midiMsg(kind, n, bpm, at); }
T2D_API int t2d_hmirror() {                                 // зеркало хоста: сетка есть, t0, p, время блока
  const sdk::Clock& c = host.clock();
  mbuf[0] = c.grid.on ? 1 : 0; mbuf[1] = c.grid.t0; mbuf[2] = c.grid.p; mbuf[3] = c.now;
  return 4;
}
T2D_API int t2d_hevents() { return host.events(mbuf, MBUF); }   // события часов: по 2 числа — код, bpm
// звучащая страна Arcadia (сетка 80 × 160, float): which 0 — высоты z, 1 — маска воды; для тестов и картинки натива
T2D_API const float* t2d_arc_land(int which) { return which ? arc.land().lake : arc.land().z; }

// мастер-цепь: LPF, компрессор, потолок, выход
T2D_API void t2d_master_lpf(double hz) { host.masterLpf(hz); }
T2D_API void t2d_master_comp(double thr, double ratio) { host.masterComp(thr, ratio); }
T2D_API void t2d_master_ceil(double db) { host.masterCeil(db); }
T2D_API void t2d_sum(float* L, float* R, int n) { host.sum(L, R, n); }
T2D_API void t2d_master_run(float* L, float* R, int n) { host.masterRun(L, R, n); }
T2D_API void t2d_mix(float* L, float* R, int n) { host.sum(L, R, n); host.masterRun(L, R, n); }
T2D_API double t2d_master_makeup(void) { return host.masterMakeup(); }

// LFO: world — слот, key — ключ параметра, base — базовое значение, shape — форма (0=classic, 1=random)
// spec: morph/rate/depth — по два числа (начало, конец), value — текущее значение
T2D_API int t2d_add_lfo(int world, const char* key, double base, int shape) { 
  return host.addLfo(world, key, base, shape); 
}
T2D_API void t2d_remove_lfo(int idx) { host.removeLfo(idx); }
T2D_API void t2d_lfo_spec(int idx, double m0, double m1, double r0, double r1, double d0, double d1) { 
  host.lfoSpec(idx, m0, m1, r0, r1, d0, d1); 
}
T2D_API double t2d_lfo_value(int idx) { return host.lfoValue(idx); }
T2D_API void t2d_lfo_tick(double dt) { host.lfoTick(dt); }

// model tick — обновление модели вне аудио-потока
T2D_API void t2d_model_tick(double dt) { host.modelTick(dt); }

// Мост ядра — реализация C-ABI из t2d.h, общая для wasm (t2d.wasm: его крутит t2d-worklet.js, в Node — tools/t2d-core.mjs)
// и нативных целей (iOS, sdk-test). Почти всё — тонкая обёртка над Host (core/host/host.hpp); здесь только то, чего у хоста нет:
// какие миры в каких слотах, общие буферы обмена и проверки границ.
//
// Один экземпляр на модуль, всё статическое: хост ~1.2 МБ и миры (Tenebrae ~0.95 МБ таблиц) — не на стек.
// Обмен — через буферы: аргументы action (t2d_args), зеркало и услышанное (t2d_mbuf), строка снимка (t2d_str_buf + длина).
//
// ЛОВУШКИ:
//   - Новый мир ядра: объект ниже и строка в kSlots (t2d_init); в вебе — ещё SDK_WORLDS (host/audio.js).
//   - Зеркало мира не длиннее MBUF (2048), аргументы action — ARGS_CAP (256), снимок — STR_CAP (64 КБ); длиннее — обрезается
//     (action) или 0 (snapshot).
#include <cmath>
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
static firmamentum::Firmamentum firm(host.scale());     // лад у всех миров — хоста
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
static sdk::World* worlds[Host::SLOTS] = {};            // слот → мир (для mirror / heard / snapshot); пустые — nullptr

static constexpr int ARGS_CAP = 256;                    // узор Cymatica — 117 чисел
static double args[ARGS_CAP];
static constexpr int MBUF = 2048;
static double mbuf[MBUF];                               // зеркало: Tenebrae — до 1161 числа, Firmamentum — до 101, Oceanus — до 135, Goetia — до 59, Monochordum — 52, Horologium — 47, Tria — 47, Arcadia — 65
static constexpr int STR_CAP = 1 << 16;
static char str[STR_CAP];                               // JSON снимка: snapshot пишет, restore читает

#define T2D_API extern "C" __attribute__((used))
static sdk::World* worldAt(int slot) { return (slot >= 0 && slot < Host::SLOTS) ? worlds[slot] : nullptr; }

// Хост и все миры с нуля; слот = номер мира. Зерно у всех одно (Rng моделей; у ревербераторов — seed + тип).
T2D_API void t2d_init(double sr, unsigned seed) {
  struct Put { int slot; sdk::World* w; };
  const Put kSlots[] = {
    {10, &firm},                                        // Firmamentum
    {2, &cym},                                          // Cymatica: шанс удара и шум смычка — от зерна
    {8, &ocean},                                        // Oceanus
    {15, &goe},                                         // Goetia
    {7, &mono},                                         // Monochordum
    {9, &horo},                                         // Horologium
    {12, &arc},                                         // Arcadia
    {11, &tria3},                                       // Tria corpora
    {13, &port},                                        // Portus
    {4, &nat},                                          // Natura: шанс шага и шелест — от зерна
    {5, &inf},                                          // Inferno
    {1, &ten},                                          // Tenebrae: шум голосов и удары — от зерна
  };
  host.prepare(sr, seed);
  for (const Put& p : kSlots) { p.w->prepare(sr, seed); worlds[p.slot] = p.w; host.add(p.slot, p.w); }
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
T2D_API float* t2d_ext(int rev, int ch) { return host.ext(static_cast<sdk::Rev>(rev < 0 ? 0 : rev > 3 ? 3 : rev), ch); }   // тип зажат в 0…3
T2D_API double* t2d_mbuf() { return mbuf; }
T2D_API int t2d_mirror(int slot) { sdk::World* w = worldAt(slot); return w ? w->mirror(mbuf, MBUF) : 0; }
T2D_API int t2d_heard(int slot) { sdk::World* w = worldAt(slot); return w ? w->heard(mbuf, MBUF) : 0; }
T2D_API char* t2d_str_buf() { return str; }
T2D_API int t2d_str_cap() { return STR_CAP; }
T2D_API int t2d_snapshot(int slot) {                    // длина строки в t2d_str_buf; не влезла — 0
  sdk::World* w = worldAt(slot);
  if (!w) return 0;
  const std::string s = w->snapshot();
  if (s.size() > static_cast<size_t>(STR_CAP)) return 0;
  std::memcpy(str, s.data(), s.size());
  return static_cast<int>(s.size());
}
T2D_API void t2d_restore(int slot, int len) {
  sdk::World* w = worldAt(slot);
  host.lfoDrop(slot, Host::LFO_OBJS);                   // LFO звёзд слота не переживают restore (FX остаются)
  if (w && len >= 0 && len <= STR_CAP) w->restore(std::string(str, static_cast<size_t>(len)));
}
T2D_API void t2d_fader(int slot, double g) { host.fader(slot, g); }
T2D_API void t2d_scale(int on, int idx, int root) { host.scale(on != 0, idx, root); }
T2D_API void t2d_vol(double g) { host.vol(g); }

// часы: время начала следующего блока (секунды контекста), MIDI — байт от входа src или разобранное сообщение (оболочка iOS)
T2D_API void t2d_time(double t) { host.time(t); }
T2D_API void t2d_midi_byte(int src, int status, double at) { host.midiByte(src, status, at); }
T2D_API void t2d_midi_msg(int kind, double n, double bpm, double at) { host.midiMsg(kind, n, bpm, at); }
T2D_API int t2d_hmirror() {                             // зеркало хоста: сетка есть, t0, p, время блока
  const sdk::Clock& c = host.clock();
  mbuf[0] = c.grid.on ? 1 : 0; mbuf[1] = c.grid.t0; mbuf[2] = c.grid.p; mbuf[3] = c.now;
  return 4;
}
T2D_API int t2d_hevents() { return host.events(mbuf, MBUF); }   // события часов: по 2 числа — код, bpm

// звучащая страна Arcadia (сетка 80 × 160, float): which 0 — высоты z, 1 — маска воды; для тестов и картинки натива
T2D_API const float* t2d_arc_land(int which) { return which ? arc.land().lake : arc.land().z; }

// мастер: LPF, компрессор, потолок, выход (веб не зовёт — его мастер на Web Audio)
T2D_API void t2d_master_lpf(double hz) { host.masterLpf(hz); }
T2D_API void t2d_master_comp(double thr, double ratio) { host.masterComp(thr, ratio); }
T2D_API void t2d_master_ceil(double db) { host.masterCeil(db); }
T2D_API void t2d_sum(float* L, float* R, int n) { host.sum(L, R, n); }
T2D_API void t2d_master_run(float* L, float* R, int n) { host.masterRun(L, R, n); }
T2D_API void t2d_mix(float* L, float* R, int n) { host.sum(L, R, n); host.masterRun(L, R, n); }
T2D_API double t2d_master_makeup(void) { return host.masterMakeup(); }

// LFO строк: таблица хоста (64), зовёт только аудиопоток (core/app); в wasm не экспортируется — веб держит свои LFO в sl.js
T2D_API int t2d_lfo_add(int slot, int obj, int key, double base, int shape) { return host.lfoAdd(slot, obj, key, base, shape) ? 1 : 0; }
T2D_API void t2d_lfo_spec(int slot, int obj, int key, double morph, double rate, double depth) { host.lfoSpec(slot, obj, key, morph, rate, depth); }
T2D_API void t2d_lfo_base(int slot, int obj, int key, double base) { host.lfoBase(slot, obj, key, base); }
T2D_API void t2d_lfo_off(int slot, int obj, int key) { host.lfoOff(slot, obj, key); }
T2D_API void t2d_lfo_drop(int slot, int obj) { host.lfoDrop(slot, obj); }
T2D_API void t2d_lfo_tick(double dt) { host.lfoTick(dt); }
T2D_API int t2d_lfo_state(void) { return host.lfoState(mbuf, MBUF); }
T2D_API unsigned t2d_lfo_lost(void) { return host.lfoLost(); }
T2D_API double t2d_lfo_sample(int shape, double morph, double u, int seed) { return host.lfoSample(shape, morph, u, seed); }

// тик моделей: раз в блок, dt — время блока, с; каждому миру action(−1, 0, [dt], 1)
T2D_API void t2d_model_tick(double dt) { host.modelTick(dt); }

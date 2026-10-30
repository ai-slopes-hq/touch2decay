#include "engine.hpp"
#include <algorithm>
#include <chrono>
#include <cstring>
#include "../bridge/t2d.h"
#include "../sdk/lfo.hpp"

static_assert(T2D_APP_LFO_MAX == sdk::LFO_MAX, "снимок LFO: ёмкость = таблица хоста");
static_assert(T2D_APP_LFO_REC == 10, "Host::lfoState пишет 10 чисел на LFO");

void Engine::init(double sr, unsigned seed, double ticksPerSec, unsigned watch) {
  sr_ = sr; ticks_ = ticksPerSec; watch_ = watch;
  samples_ = 0; remOff_ = remN_ = 0;
  acts_.clear(); ustr_.clear(); snaps_.clear();
  lfoMir_.clear(); lastLfo_.len = 0;
  for (int s = 0; s < SLOTS; s++) { mir_[s].clear(); last_[s].len = 0; heard_[s].clear(); }
  loadSum_ = loadMax_ = loadN_ = latSum_ = latMax_ = latN_ = snapSum_ = snapMax_ = snapN_ = 0;
  frames_ = 0; dropped_ = 0; heardLost_ = 0; snapLost_ = 0; lfoLost_ = 0;
  t2d_init(sr, seed);
}

bool Engine::action(int slot, int kind, int i, const double* a, int n, uint64_t touch) {
  Act act;
  if (n < 0 || n > ACT_ARGS || (n > 0 && !a)) { dropped_.fetch_add(1, std::memory_order_relaxed); return false; }
  act.slot = slot; act.kind = kind; act.i = i; act.n = n; act.touch = touch;
  if (n > 0) std::memcpy(act.a, a, static_cast<size_t>(n) * sizeof(double));
  if (!acts_.push(act)) { dropped_.fetch_add(1, std::memory_order_relaxed); return false; }
  return true;
}

bool Engine::restore(int slot, const char* s, int len, uint64_t touch) {
  if (len < 0 || len > STR || (len > 0 && !s) || acts_.full()) { dropped_.fetch_add(1, std::memory_order_relaxed); return false; }
  Str* w = ustr_.reserve();
  if (!w) { dropped_.fetch_add(1, std::memory_order_relaxed); return false; }
  w->slot = slot; w->len = len;
  if (len > 0) std::memcpy(w->d, s, static_cast<size_t>(len));
  ustr_.commit();                                           // строка раньше действия; место в acts_ проверено (потребитель только освобождает)
  return action(T2D_HOST, RESTORE, slot, nullptr, 0, touch);
}

int Engine::snapTake(int* id, int* slot, char* buf, int cap) {
  const Str* r = snaps_.peek();
  if (!r) return 0;
  const int len = r->len;
  int n = 0;
  if (buf && len <= cap) {
    std::memcpy(buf, r->d, static_cast<size_t>(len));
    if (id) *id = r->id;
    if (slot) *slot = r->slot;
    n = len;
  } else snapLost_.fetch_add(1, std::memory_order_relaxed);
  snaps_.drop();
  return n;
}

void Engine::addMax(std::atomic<uint64_t>& m, uint64_t v) {
  uint64_t cur = m.load(std::memory_order_relaxed);
  while (v > cur && !m.compare_exchange_weak(cur, v, std::memory_order_relaxed)) {}
}

void Engine::hostAction(const Act& act) {
  switch (act.kind) {
    case T2D_H_VOL: if (act.n >= 1) t2d_vol(act.a[0]); break;
    case T2D_H_SCALE: if (act.n >= 3) t2d_scale(act.a[0] != 0, static_cast<int>(act.a[1]), static_cast<int>(act.a[2])); break;
    case T2D_H_LFO_ADD:                                     // a = [obj, key, base, shape]; i = слот
      if (act.n >= 4) t2d_lfo_add(act.i, static_cast<int>(act.a[0]), static_cast<int>(act.a[1]), act.a[2], static_cast<int>(act.a[3]));
      break;                                                // нет места — хост считает lfo_lost
    case T2D_H_LFO_SPEC:
      if (act.n >= 5) t2d_lfo_spec(act.i, static_cast<int>(act.a[0]), static_cast<int>(act.a[1]), act.a[2], act.a[3], act.a[4]);
      break;
    case T2D_H_LFO_BASE: if (act.n >= 3) t2d_lfo_base(act.i, static_cast<int>(act.a[0]), static_cast<int>(act.a[1]), act.a[2]); break;
    case T2D_H_LFO_OFF: if (act.n >= 2) t2d_lfo_off(act.i, static_cast<int>(act.a[0]), static_cast<int>(act.a[1])); break;
    case T2D_H_LFO_DROP: if (act.n >= 1) t2d_lfo_drop(act.i, static_cast<int>(act.a[0])); break;
    case T2D_H_SNAP: {
      const auto t0 = std::chrono::steady_clock::now();
      const int len = t2d_snapshot(act.i);
      const double dt = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      const uint64_t ns = dt > 0 ? static_cast<uint64_t>(dt * 1e9) : 0;
      snapSum_.fetch_add(ns, std::memory_order_relaxed);
      snapN_.fetch_add(1, std::memory_order_relaxed);
      addMax(snapMax_, ns);
      Str* w = len > 0 ? snaps_.reserve() : nullptr;
      if (!w) { snapLost_.fetch_add(1, std::memory_order_relaxed); break; }   // мир не ответил / кольцо полно (UI не забирает)
      w->slot = act.i; w->id = act.n >= 1 ? static_cast<int>(act.a[0]) : 0; w->len = len;
      std::memcpy(w->d, t2d_str_buf(), static_cast<size_t>(len));
      snaps_.commit();
      break;
    }
    case RESTORE: {
      const Str* r = ustr_.peek();
      if (!r) break;
      std::memcpy(t2d_str_buf(), r->d, static_cast<size_t>(r->len));
      t2d_restore(r->slot, r->len);
      ustr_.drop();
      break;
    }
  }
}

// offset — сколько сэмплов уже отдано в выход до этого блока (остаток и прошлые блоки этого render): блок прозвучит на столько позже начала буфера
void Engine::block(uint64_t host, int offset) {
  Act act;
  while (acts_.pop(act)) {
    if (act.n > 0) std::memcpy(t2d_args(), act.a, static_cast<size_t>(act.n) * sizeof(double));
    if (act.slot == T2D_HOST) hostAction(act);
    else t2d_action(act.slot, act.kind, act.i, t2d_args(), act.n);
    if (act.touch) {                                        // lat = host + offset/sr·ticks − touch (в тиках), → секунды
      const double lat = static_cast<double>(static_cast<int64_t>(host - act.touch)) / ticks_ + offset / sr_;
      const uint64_t ns = lat > 0 ? static_cast<uint64_t>(lat * 1e9) : 0;
      latSum_.fetch_add(ns, std::memory_order_relaxed);
      latN_.fetch_add(1, std::memory_order_relaxed);
      addMax(latMax_, ns);
    }
  }
  t2d_time(samples_ / sr_);
  t2d_lfo_tick(BLOCK / sr_);                        // LFO строк: после кольца, до process (раз в блок; веб шлёт ~30/с — звучит глаже)
  t2d_process(BLOCK);
  samples_ += BLOCK;
  for (int s = 0; s < SLOTS; s++) {
    if (!(watch_ >> s & 1)) continue;
    const int len = t2d_heard(s);
    if (len <= 0) continue;
    const double* m = t2d_mbuf();
    bool any = false;
    for (int k = 0; k < len && !any; k++) any = m[k] != 0;
    if (!any) continue;                                     // пустая запись (мир всегда пишет нули)
    Rec rec;
    if (len > HEARD_REC) { heardLost_.fetch_add(1, std::memory_order_relaxed); continue; }
    rec.len = len;
    std::memcpy(rec.d, m, static_cast<size_t>(len) * sizeof(double));
    if (!heard_[s].push(rec)) heardLost_.fetch_add(1, std::memory_order_relaxed);
  }
  t2d_mix(blkL_, blkR_, BLOCK);
}

void Engine::publishMirrors() {
  for (int s = 0; s < SLOTS; s++) {
    if (!(watch_ >> s & 1)) continue;
    Mir& w = mir_[s].write();
    const int len = t2d_mirror(s);
    if (len <= 0 || len > MIRROR_CAP) continue;
    w.len = len;
    std::memcpy(w.d, t2d_mbuf(), static_cast<size_t>(len) * sizeof(double));
    mir_[s].publish();
  }
  Lfo& l = lfoMir_.write();                                 // снимок LFO публикуем и пустым: погасший LFO должен исчезнуть из UI
  l.len = t2d_lfo_state();
  std::memcpy(l.d, t2d_mbuf(), static_cast<size_t>(l.len) * sizeof(double));
  lfoMir_.publish();
  lfoLost_.store(t2d_lfo_lost(), std::memory_order_relaxed);
}

void Engine::render(float* L, float* R, int n, uint64_t host) {
  if (n <= 0) return;
  const auto t0 = std::chrono::steady_clock::now();
  frames_.store(n, std::memory_order_relaxed);
  int pos = 0;
  if (remN_ > 0) {                                          // остаток прошлого куска — первым
    const int k = std::min(remN_, n);
    std::memcpy(L, blkL_ + remOff_, static_cast<size_t>(k) * sizeof(float));
    std::memcpy(R, blkR_ + remOff_, static_cast<size_t>(k) * sizeof(float));
    remOff_ += k; remN_ -= k; pos = k;
  }
  while (pos < n) {
    block(host, pos);
    const int k = std::min(BLOCK, n - pos);
    std::memcpy(L + pos, blkL_, static_cast<size_t>(k) * sizeof(float));
    std::memcpy(R + pos, blkR_, static_cast<size_t>(k) * sizeof(float));
    pos += k;
    if (k < BLOCK) { remOff_ = k; remN_ = BLOCK - k; }
  }
  publishMirrors();
  const double dt = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  const double load = dt / (n / sr_);
  const uint64_t q = load > 0 ? static_cast<uint64_t>(load * 1e9) : 0;
  loadSum_.fetch_add(q, std::memory_order_relaxed);
  loadN_.fetch_add(1, std::memory_order_relaxed);
  addMax(loadMax_, q);
}

int Engine::mirror(int slot, double* buf, int cap) {
  if (slot < 0 || slot >= SLOTS || !(watch_ >> slot & 1)) return 0;
  mir_[slot].read(last_[slot]);                             // новее — подменит last_
  const Mir& m = last_[slot];
  if (m.len <= 0 || cap < m.len || !buf) return 0;
  std::memcpy(buf, m.d, static_cast<size_t>(m.len) * sizeof(double));
  return m.len;
}

int Engine::lfo(double* buf, int cap) {
  lfoMir_.read(lastLfo_);
  if (!buf || cap < lastLfo_.len) return 0;
  std::memcpy(buf, lastLfo_.d, static_cast<size_t>(lastLfo_.len) * sizeof(double));
  return lastLfo_.len;
}

// забирает записи подряд, пока влезают в cap; запись длиннее cap остаётся в кольце
int Engine::heard(int slot, double* buf, int cap) {
  if (slot < 0 || slot >= SLOTS || !buf) return 0;
  int total = 0;
  while (const Rec* r = heard_[slot].peek()) {
    if (total + r->len > cap) break;
    std::memcpy(buf + total, r->d, static_cast<size_t>(r->len) * sizeof(double));
    total += r->len;
    heard_[slot].drop();
  }
  return total;
}

void Engine::stats(t2d_app_stats_t* out) {
  const uint64_t ls = loadSum_.exchange(0), lm = loadMax_.exchange(0), ln = loadN_.exchange(0);
  const uint64_t ts = latSum_.exchange(0), tm = latMax_.exchange(0), tn = latN_.exchange(0);
  out->load_avg = ln ? ls * 1e-9 / ln : 0;
  out->load_max = lm * 1e-9;
  out->lat_avg = tn ? ts * 1e-9 / tn : 0;
  out->lat_max = tm * 1e-9;
  out->lat_n = static_cast<int>(tn);
  out->frames = frames_.load(std::memory_order_relaxed);
  out->dropped = dropped_.load(std::memory_order_relaxed);
  const uint64_t ss = snapSum_.exchange(0), sm = snapMax_.exchange(0), sn = snapN_.exchange(0);
  out->snap_avg = sn ? ss * 1e-9 / sn : 0;
  out->snap_max = sm * 1e-9;
  out->snap_n = static_cast<int>(sn);
  out->snap_lost = snapLost_.load(std::memory_order_relaxed);
  out->lfo_lost = lfoLost_.load(std::memory_order_relaxed);
  out->heard_lost = heardLost_.load(std::memory_order_relaxed);
}

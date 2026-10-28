#include "engine.hpp"
#include <algorithm>
#include <chrono>
#include <cstring>
#include "../bridge/t2d.h"

void Engine::init(double sr, unsigned seed, double ticksPerSec, unsigned watch) {
  sr_ = sr; ticks_ = ticksPerSec; watch_ = watch;
  samples_ = 0; remOff_ = remN_ = 0;
  acts_.clear();
  for (int s = 0; s < SLOTS; s++) { mir_[s].clear(); last_[s].len = 0; heard_[s].clear(); }
  loadSum_ = loadMax_ = loadN_ = latSum_ = latMax_ = latN_ = 0;
  frames_ = 0; dropped_ = 0; heardLost_ = 0;
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

void Engine::addMax(std::atomic<uint64_t>& m, uint64_t v) {
  uint64_t cur = m.load(std::memory_order_relaxed);
  while (v > cur && !m.compare_exchange_weak(cur, v, std::memory_order_relaxed)) {}
}

// offset — сколько сэмплов уже отдано в выход до этого блока (остаток и прошлые блоки этого render): блок прозвучит на столько позже начала буфера
void Engine::block(uint64_t host, int offset) {
  Act act;
  while (acts_.pop(act)) {
    if (act.n > 0) std::memcpy(t2d_args(), act.a, static_cast<size_t>(act.n) * sizeof(double));
    t2d_action(act.slot, act.kind, act.i, t2d_args(), act.n);
    if (act.touch) {                                        // lat = host + offset/sr·ticks − touch (в тиках), → секунды
      const double lat = static_cast<double>(static_cast<int64_t>(host - act.touch)) / ticks_ + offset / sr_;
      const uint64_t ns = lat > 0 ? static_cast<uint64_t>(lat * 1e9) : 0;
      latSum_.fetch_add(ns, std::memory_order_relaxed);
      latN_.fetch_add(1, std::memory_order_relaxed);
      addMax(latMax_, ns);
    }
  }
  t2d_time(samples_ / sr_);
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
  out->heard_lost = heardLost_.load(std::memory_order_relaxed);
}

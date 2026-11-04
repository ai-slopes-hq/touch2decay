// Engine: схема потоков, порядок блока и ловушки — в шапке engine.hpp.
#include "engine.hpp"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include "../bridge/t2d.h"
#include "../sdk/lfo.hpp"

static_assert(T2D_APP_LFO_MAX == sdk::LFO_MAX, "снимок LFO: ёмкость = таблица хоста");
static_assert(T2D_APP_LFO_REC == sdk::LFO_REC, "снимок LFO: запись = Host::lfoState");

void Engine::init(double sr, unsigned seed, double ticksPerSec, unsigned watch) {
  sr_ = sr; ticksPerSec_ = ticksPerSec; watch_ = watch;
  samplesDone_ = 0; restOff_ = restN_ = 0;
  actions_.clear(); restoreText_.clear(); snapText_.clear();
  midi_.clear(); hev_.clear(); gridSnap_.clear(); gridRead_ = Grid{};
  lfoSnap_.clear(); lfoRead_.len = 0;
  levelSnap_.clear(); levelRead_ = Levels{};
  for (int s = 0; s < SLOTS; s++) energyNow_[s] = energyPrev_[s] = 0;
  for (int s = 0; s < SLOTS; s++) { mirrors_[s].clear(); mirrorRead_[s].len = 0; heard_[s].clear(); }
  loadSum_ = loadMax_ = loadN_ = latSum_ = latMax_ = latN_ = snapSum_ = snapMax_ = snapN_ = 0;
  frames_ = 0; dropped_ = 0; heardLost_ = 0; snapLost_ = 0; lfoLost_ = 0; midiLost_ = 0; hevLost_ = 0;
  for (int s = 0; s < SLOTS; s++) faderTarget_[s] = faderNow_[s] = 1.0;
  masterTarget_[LPF_LOG] = masterNow_[LPF_LOG] = std::log(22000.0);
  masterTarget_[THRESHOLD_DB] = masterNow_[THRESHOLD_DB] = -10;
  masterTarget_[RATIO] = masterNow_[RATIO] = 2.5;
  masterTarget_[CEIL_DB] = masterNow_[CEIL_DB] = 0;
  t2d_init(sr, seed);
}

bool Engine::action(int slot, int kind, int i, const double* a, int n, uint64_t touch) {
  Action act;
  if (n < 0 || n > ACT_ARGS || (n > 0 && !a)) { dropped_.fetch_add(1, std::memory_order_relaxed); return false; }
  act.slot = slot; act.kind = kind; act.i = i; act.n = n; act.touch = touch;
  if (n > 0) std::memcpy(act.a, a, static_cast<size_t>(n) * sizeof(double));
  if (!actions_.push(act)) { dropped_.fetch_add(1, std::memory_order_relaxed); return false; }
  return true;
}

bool Engine::restore(int slot, const char* s, int len, uint64_t touch) {
  // место в кольце действий проверяем заранее: строку без парного RESTORE потом не забрать
  if (len < 0 || len > STR || (len > 0 && !s) || actions_.full()) { dropped_.fetch_add(1, std::memory_order_relaxed); return false; }
  Text* w = restoreText_.reserve();
  if (!w) { dropped_.fetch_add(1, std::memory_order_relaxed); return false; }
  w->slot = slot; w->len = len;
  if (len > 0) std::memcpy(w->d, s, static_cast<size_t>(len));
  // строка — раньше действия; место в actions_ не пропадёт: аудиопоток его только освобождает
  restoreText_.commit();
  return action(T2D_HOST, RESTORE, slot, nullptr, 0, touch);
}

int Engine::snapTake(int* id, int* slot, char* buf, int cap) {
  const Text* r = snapText_.peek();
  if (!r) return 0;
  const int len = r->len;
  int n = 0;
  if (buf && len <= cap) {
    std::memcpy(buf, r->d, static_cast<size_t>(len));
    if (id) *id = r->id;
    if (slot) *slot = r->slot;
    n = len;
  } else snapLost_.fetch_add(1, std::memory_order_relaxed);   // не влез — выбрасываем, иначе он заткнёт кольцо навсегда
  snapText_.drop();
  return n;
}

void Engine::addMax(std::atomic<uint64_t>& m, uint64_t v) {
  uint64_t cur = m.load(std::memory_order_relaxed);
  while (v > cur && !m.compare_exchange_weak(cur, v, std::memory_order_relaxed)) {}
}

// Аудиопоток. Короткие действия (n меньше нужного) молча пропускаются.
void Engine::hostAction(const Action& act) {
  switch (act.kind) {
    case T2D_H_VOL: if (act.n >= 1) t2d_vol(act.a[0]); break;             // VOL сглаживает сам хост
    case T2D_H_FADER: if (act.n >= 1 && act.i >= 0 && act.i < SLOTS) faderTarget_[act.i] = act.a[0]; break;
    case T2D_H_MASTER:                                      // a = [lpfHz, thrDb, ratio, ceilDb] — цели, ход — stepSmooth
      if (act.n >= 4) {
        masterTarget_[LPF_LOG] = std::log(std::max(act.a[0], 1.0));
        masterTarget_[THRESHOLD_DB] = act.a[1]; masterTarget_[RATIO] = act.a[2]; masterTarget_[CEIL_DB] = act.a[3];
      }
      break;
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
    case T2D_H_SNAP: {                                      // снимок мира слота i в кольцо UI; время снимка — в статистику
      const auto t0 = std::chrono::steady_clock::now();
      const int len = t2d_snapshot(act.i);
      const double dt = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      const uint64_t ns = dt > 0 ? static_cast<uint64_t>(dt * 1e9) : 0;
      snapSum_.fetch_add(ns, std::memory_order_relaxed);
      snapN_.fetch_add(1, std::memory_order_relaxed);
      addMax(snapMax_, ns);
      Text* w = len > 0 ? snapText_.reserve() : nullptr;
      if (!w) { snapLost_.fetch_add(1, std::memory_order_relaxed); break; }   // мир не ответил / кольцо полно (UI не забирает)
      w->slot = act.i; w->id = act.n >= 1 ? static_cast<int>(act.a[0]) : 0; w->len = len;
      std::memcpy(w->d, t2d_str_buf(), static_cast<size_t>(len));
      snapText_.commit();
      break;
    }
    case RESTORE: {                                         // строку положил restore() перед этим действием
      const Text* r = restoreText_.peek();
      if (!r) break;
      std::memcpy(t2d_str_buf(), r->d, static_cast<size_t>(r->len));
      t2d_restore(r->slot, r->len);
      restoreText_.drop();
      break;
    }
  }
}

// Раз в блок: значение += (цель − значение)·(1 − exp(−BLOCK / (0.03·sr))) — τ 30 мс, как VOL в хосте. Ближе 1e-5 к цели —
// ставим ровно цель, и дальше слот не трогаем (ядро зовём, только пока идёт ход).
void Engine::stepSmooth() {
  const double k = 1 - std::exp(-BLOCK / (0.03 * sr_));
  for (int s = 0; s < SLOTS; s++) {
    if (faderNow_[s] == faderTarget_[s]) continue;
    faderNow_[s] += (faderTarget_[s] - faderNow_[s]) * k;
    if (std::fabs(faderTarget_[s] - faderNow_[s]) < 1e-5) faderNow_[s] = faderTarget_[s];
    t2d_fader(s, faderNow_[s]);
  }
  bool moved[MASTER_N];
  for (int j = 0; j < MASTER_N; j++) {
    moved[j] = masterNow_[j] != masterTarget_[j];
    if (!moved[j]) continue;
    masterNow_[j] += (masterTarget_[j] - masterNow_[j]) * k;
    if (std::fabs(masterTarget_[j] - masterNow_[j]) < 1e-5) masterNow_[j] = masterTarget_[j];
  }
  if (moved[LPF_LOG]) t2d_master_lpf(std::exp(masterNow_[LPF_LOG]));
  if (moved[THRESHOLD_DB] || moved[RATIO]) t2d_master_comp(masterNow_[THRESHOLD_DB], masterNow_[RATIO]);
  if (moved[CEIL_DB]) t2d_master_ceil(masterNow_[CEIL_DB]);
}

// offset — сколько сэмплов этого буфера уже отдано до блока (остаток и прошлые блоки этого render): блок прозвучит
// на offset сэмплов позже начала буфера (host).
void Engine::renderBlock(uint64_t host, int offset) {
  Action act;
  while (actions_.pop(act)) {
    if (act.n > 0) std::memcpy(t2d_args(), act.a, static_cast<size_t>(act.n) * sizeof(double));
    if (act.slot == T2D_HOST) hostAction(act);
    else t2d_action(act.slot, act.kind, act.i, t2d_args(), act.n);
    if (act.touch) {                                        // задержка = (host − touch)/тактов в секунду + offset/sr, секунды
      const double lat = static_cast<double>(static_cast<int64_t>(host - act.touch)) / ticksPerSec_ + offset / sr_;
      const uint64_t ns = lat > 0 ? static_cast<uint64_t>(lat * 1e9) : 0;
      latSum_.fetch_add(ns, std::memory_order_relaxed);
      latN_.fetch_add(1, std::memory_order_relaxed);
      addMax(latMax_, ns);
    }
  }
  Midi m;                                                   // MIDI — до t2d_time: события часов этого блока видят сетку на его начало
  while (midi_.pop(m)) {
    double at = samplesDone_ / sr_;                         // нет метки — считаем, что пришло в начало блока
    if (m.mach != 0 && host != 0) {                         // блок звучит на offset сэмплов позже начала буфера (host)
      const double d = static_cast<double>(static_cast<int64_t>(m.mach - host)) / ticksPerSec_ - offset / sr_;
      if (std::fabs(d) <= 1.0) at += d;                     // метка в пределах секунды от блока — иначе часы не те, не верим
    }
    t2d_midi_byte(m.src, m.status, at);
  }
  stepSmooth();                                             // после кольца: цели от действий этого блока, до process
  t2d_time(samplesDone_ / sr_);
  t2d_lfo_tick(BLOCK / sr_);                                // LFO строк: после кольца, до process (раз в блок; веб шлёт ~30/с — звучит глаже)
  t2d_process(BLOCK);
  samplesDone_ += BLOCK;
  {                                                         // t2d_hevents пишет в общий mbuf — копируем сразу, до следующего вызова ядра
    const int n = t2d_hevents();
    const double* e = t2d_mbuf();
    for (int k = 0; k + 1 < n; k += 2)
      if (!hev_.push(HEv{e[k], e[k + 1]})) hevLost_.fetch_add(1, std::memory_order_relaxed);
  }
  // уровень слота — сухой выход до фейдера и без trim, как chans[n].in в вебе; для всех слотов, независимо от watch
  for (int s = 0; s < SLOTS; s++) {
    const float* l = t2d_dry(s, 0);
    const float* r = t2d_dry(s, 1);
    float sq = 0;
    for (int i = 0; i < BLOCK; i++) {
      const float m = ((l ? l[i] : 0.f) + (r ? r[i] : 0.f)) * 0.5f;
      sq += m * m;
    }
    energyPrev_[s] = energyNow_[s];
    energyNow_[s] = sq;
  }
  for (int s = 0; s < SLOTS; s++) {
    if (!(watch_ >> s & 1)) continue;
    const int len = t2d_heard(s);
    if (len <= 0) continue;
    const double* m = t2d_mbuf();
    bool any = false;
    for (int k = 0; k < len && !any; k++) any = m[k] != 0;
    if (!any) continue;                                     // пустая запись (мир пишет нули, когда ничего не услышано)
    HeardRec rec;
    if (len > HEARD_REC) { heardLost_.fetch_add(1, std::memory_order_relaxed); continue; }
    rec.len = len;
    std::memcpy(rec.d, m, static_cast<size_t>(len) * sizeof(double));
    if (!heard_[s].push(rec)) heardLost_.fetch_add(1, std::memory_order_relaxed);
  }
  t2d_mix(blockL_, blockR_, BLOCK);
}

void Engine::publishSnapshots() {
  for (int s = 0; s < SLOTS; s++) {
    if (!(watch_ >> s & 1)) continue;
    Mirror& w = mirrors_[s].write();
    const int len = t2d_mirror(s);
    if (len <= 0 || len > MIRROR_CAP) continue;
    w.len = len;
    std::memcpy(w.d, t2d_mbuf(), static_cast<size_t>(len) * sizeof(double));
    mirrors_[s].publish();
  }
  LfoTable& l = lfoSnap_.write();                           // снимок LFO публикуем и пустым: погасший LFO должен исчезнуть из UI
  l.len = t2d_lfo_state();
  std::memcpy(l.d, t2d_mbuf(), static_cast<size_t>(l.len) * sizeof(double));
  lfoSnap_.publish();
  Levels& v = levelSnap_.write();
  for (int s = 0; s < SLOTS; s++) v.rms[s] = std::sqrt((energyNow_[s] + energyPrev_[s]) / 256.f);
  levelSnap_.publish();
  lfoLost_.store(t2d_lfo_lost(), std::memory_order_relaxed);
  Grid& g = gridSnap_.write();
  if (t2d_hmirror() >= 4) { std::memcpy(g.d, t2d_mbuf(), sizeof g.d); gridSnap_.publish(); }
}

void Engine::render(float* L, float* R, int n, uint64_t host) {
  if (n <= 0) return;
  const auto t0 = std::chrono::steady_clock::now();
  frames_.store(n, std::memory_order_relaxed);
  int pos = 0;
  if (restN_ > 0) {                                         // хвост прошлого блока — первым
    const int k = std::min(restN_, n);
    std::memcpy(L, blockL_ + restOff_, static_cast<size_t>(k) * sizeof(float));
    std::memcpy(R, blockR_ + restOff_, static_cast<size_t>(k) * sizeof(float));
    restOff_ += k; restN_ -= k; pos = k;
  }
  while (pos < n) {
    renderBlock(host, pos);
    const int k = std::min(BLOCK, n - pos);
    std::memcpy(L + pos, blockL_, static_cast<size_t>(k) * sizeof(float));
    std::memcpy(R + pos, blockR_, static_cast<size_t>(k) * sizeof(float));
    pos += k;
    if (k < BLOCK) { restOff_ = k; restN_ = BLOCK - k; }
  }
  publishSnapshots();
  // нагрузка — доля длительности буфера, ушедшая на расчёт (1 — впритык, больше — щелчки)
  const double dt = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  const double load = dt / (n / sr_);
  const uint64_t q = load > 0 ? static_cast<uint64_t>(load * 1e9) : 0;
  loadSum_.fetch_add(q, std::memory_order_relaxed);
  loadN_.fetch_add(1, std::memory_order_relaxed);
  addMax(loadMax_, q);
}

int Engine::mirror(int slot, double* buf, int cap) {
  if (slot < 0 || slot >= SLOTS || !(watch_ >> slot & 1)) return 0;
  mirrors_[slot].read(mirrorRead_[slot]);                   // есть новее — подменит mirrorRead_
  const Mirror& m = mirrorRead_[slot];
  if (m.len <= 0 || cap < m.len || !buf) return 0;
  std::memcpy(buf, m.d, static_cast<size_t>(m.len) * sizeof(double));
  return m.len;
}

int Engine::levels(float* out, int n) {
  const bool fresh = levelSnap_.read(levelRead_);
  if (out && n > 0) std::memcpy(out, levelRead_.rms, static_cast<size_t>(std::min(n, SLOTS)) * sizeof(float));
  return fresh ? 1 : 0;
}

int Engine::lfo(double* buf, int cap) {
  lfoSnap_.read(lfoRead_);
  if (!buf || cap < lfoRead_.len) return 0;
  std::memcpy(buf, lfoRead_.d, static_cast<size_t>(lfoRead_.len) * sizeof(double));
  return lfoRead_.len;
}

// Забирает записи подряд, пока влезают в cap; запись, которая не влезла, остаётся в кольце до следующего вызова.
int Engine::heard(int slot, double* buf, int cap) {
  if (slot < 0 || slot >= SLOTS || !buf) return 0;
  int total = 0;
  while (const HeardRec* r = heard_[slot].peek()) {
    if (total + r->len > cap) break;
    std::memcpy(buf + total, r->d, static_cast<size_t>(r->len) * sizeof(double));
    total += r->len;
    heard_[slot].drop();
  }
  return total;
}

bool Engine::midi(int src, int status, uint64_t mach) {
  if (!midi_.push(Midi{src, status, mach})) { midiLost_.fetch_add(1, std::memory_order_relaxed); return false; }
  return true;
}

int Engine::hevents(double* buf, int cap) {
  if (!buf) return 0;
  int total = 0;
  while (total + 2 <= cap) {
    const HEv* e = hev_.peek();
    if (!e) break;
    buf[total++] = e->code; buf[total++] = e->bpm;
    hev_.drop();
  }
  return total;
}

int Engine::grid(double* out4) {
  gridSnap_.read(gridRead_);
  if (out4) std::memcpy(out4, gridRead_.d, sizeof gridRead_.d);
  return 4;
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
  out->midi_lost = midiLost_.load(std::memory_order_relaxed);
}

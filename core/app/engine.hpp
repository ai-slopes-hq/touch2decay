// Движок приложения: render для аудиопотока (128-блоки ядра на любом размере буфера устройства), кольцо действий UI → аудио,
// зеркало (Triple) и записи heard (Spsc) аудио → UI, статистика нагрузки и задержки. Потоки: действия — один производитель (UI),
// один потребитель (аудио); зеркало и heard — наоборот. Ядро (mbuf, t2d_*) трогает только аудиопоток. Без блокировок и аллокаций в render.
#pragma once
#include <atomic>
#include <cstdint>
#include "spsc.hpp"
#include "triple.hpp"
#include "t2d_app.h"

class Engine {
 public:
  static constexpr int BLOCK = 128, SLOTS = 16;
  static constexpr int ACT_CAP = 256, ACT_ARGS = 128;       // кольцо действий; чисел в действии (узор Cymatica — 117)
  static constexpr int HEARD_RECS = 64, HEARD_REC = 256;    // записей heard на слот; чисел в записи (Cymatica ≤ 200)
  static constexpr int MIRROR_CAP = 1024;                   // = MBUF ядра
  static constexpr int STR = 1 << 16;                       // строка снимка, = t2d_str_cap()
  enum { RESTORE = 3 };                                     // внутренний kind слота хоста (после T2D_H_*): строка из кольца UI → аудио

  // полный сброс (кольца, остаток, статистика) + t2d_init; только пока аудио стоит
  void init(double sr, unsigned seed, double ticksPerSec, unsigned watch);
  void render(float* L, float* R, int n, uint64_t host);    // аудиопоток
  bool action(int slot, int kind, int i, const double* a, int n, uint64_t touch);  // UI; false — отброшено
  int mirror(int slot, double* buf, int cap);               // UI
  bool restore(int slot, const char* s, int len, uint64_t touch);  // UI: строка в кольцо + действие; false — отброшено
  int snapTake(int* id, int* slot, char* buf, int cap);     // UI: готовый снимок; длина, 0 — нет (не влез в cap — потерян)
  int heard(int slot, double* buf, int cap);                // UI
  void stats(t2d_app_stats_t* out);                         // UI: снимает окно

 private:
  struct Act { int slot, kind, i, n; uint64_t touch; double a[ACT_ARGS]; };
  struct Str { int slot, id, len; char d[STR]; };
  struct Mir { int len; double d[MIRROR_CAP]; };
  struct Rec { int len; double d[HEARD_REC]; };

  void hostAction(const Act& act);                                // действие слота хоста
  void block(uint64_t host, int offset);                    // один 128-блок в blk_
  void publishMirrors();
  static void addMax(std::atomic<uint64_t>& m, uint64_t v);

  double sr_ = 48000, ticks_ = 1e9;
  unsigned watch_ = 0;
  double samples_ = 0;                                      // обработано сэмплов с init (для t2d_time)
  float blkL_[BLOCK], blkR_[BLOCK];
  int remOff_ = 0, remN_ = 0;                               // остаток блока: blk_[remOff_ .. remOff_ + remN_)

  Spsc<Act, ACT_CAP> acts_;
  Triple<Mir> mir_[SLOTS];
  Mir last_[SLOTS];                                         // последнее прочитанное UI
  Spsc<Rec, HEARD_RECS> heard_[SLOTS];
  Spsc<Str, 2> ustr_, snaps_;                               // строки UI → аудио (restore) и аудио → UI (снимки)

  // статистика окна: суммы в целых (нс, 1e-9 доли), чтобы снимать атомарным exchange
  std::atomic<uint64_t> loadSum_{0}, loadMax_{0}, loadN_{0}, latSum_{0}, latMax_{0}, latN_{0}, snapSum_{0}, snapMax_{0}, snapN_{0};
  std::atomic<int> frames_{0};
  std::atomic<unsigned> dropped_{0}, heardLost_{0}, snapLost_{0};
};

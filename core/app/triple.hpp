// Тройной буфер «последний снимок»: писатель (аудио) никогда не ждёт, читатель (UI) берёт самое новое целиком, без разрывов.
// Три ячейки: писателя (w_), читателя (r_) и средняя; в mid_ — её номер и бит новизны. publish и read меняются с mid_ местами
// через exchange(acq_rel): данные ячейки видны тому, кто её получил. clear() — не потокобезопасен.
#pragma once
#include <atomic>

template <class T>
class Triple {
 public:
  T& write() { return buf_[w_]; }                          // ячейка писателя, до publish()
  void publish() { w_ = mid_.exchange(w_ | NEW, std::memory_order_acq_rel) & 3; }
  // true — пришёл снимок новее прочитанного, он скопирован в out
  bool read(T& out) {
    if (!(mid_.load(std::memory_order_relaxed) & NEW)) return false;
    r_ = mid_.exchange(r_, std::memory_order_acq_rel) & 3;
    out = buf_[r_];
    return true;
  }
  void clear() { w_ = 0; r_ = 1; mid_.store(2, std::memory_order_relaxed); }

 private:
  static constexpr int NEW = 4;
  T buf_[3];
  int w_ = 0, r_ = 1;                                      // свои у каждой стороны
  std::atomic<int> mid_{2};
};

// Кольцо «один производитель — один потребитель» без блокировок и аллокаций: действия UI → аудио, записи heard аудио → UI.
// Память на N+1 элемент (одна ячейка всегда пуста) — в кольцо влезает ровно N. Порядок: данные пишутся до release-store индекса,
// читаются после acquire-load чужого индекса. clear() — не потокобезопасен (только пока другая сторона стоит).
#pragma once
#include <atomic>
#include <cstddef>

template <class T, int N>
class Spsc {
 public:
  bool push(const T& v) {
    const size_t h = head_.load(std::memory_order_relaxed), nx = next(h);
    if (nx == tail_.load(std::memory_order_acquire)) return false;   // полно
    buf_[h] = v;
    head_.store(nx, std::memory_order_release);
    return true;
  }
  bool pop(T& v) {
    const T* p = peek();
    if (!p) return false;
    v = *p;
    drop();
    return true;
  }
  // заглянуть в голову без извлечения (потребитель): потом drop(), если запись пригодилась
  const T* peek() const {
    const size_t t = tail_.load(std::memory_order_relaxed);
    if (t == head_.load(std::memory_order_acquire)) return nullptr;
    return &buf_[t];
  }
  void drop() { tail_.store(next(tail_.load(std::memory_order_relaxed)), std::memory_order_release); }
  void clear() { head_.store(0, std::memory_order_relaxed); tail_.store(0, std::memory_order_relaxed); }

 private:
  static size_t next(size_t i) { return i + 1 == static_cast<size_t>(N) + 1 ? 0 : i + 1; }
  T buf_[N + 1];
  std::atomic<size_t> head_{0}, tail_{0};
};

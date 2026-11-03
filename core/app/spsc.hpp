// Spsc — кольцо «один производитель — один потребитель» без блокировок и аллокаций. В Engine: действия и строки restore
// UI → аудио, записи heard и снимки аудио → UI.
//
//   производитель: push(v)  или  reserve() → заполнить ячейку → commit()      (двигает head_)
//   потребитель:   pop(v)   или  peek() → прочитать → drop()                  (двигает tail_)
//
// Ячеек N+1, одна всегда пустая (иначе «полно» и «пусто» не различить), — влезает ровно N. Сторона пишет данные, потом
// release-store своего индекса; другая читает чужой индекс acquire-load и только потом данные — так она видит их целиком.
//
// ЛОВУШКИ:
//   - Писатель и читатель — ровно по одному потоку. push, reserve, commit, full — только производитель; pop, peek, drop —
//     только потребитель.
//   - Полно — push / reserve отказывают, а не ждут: что делать с потерей, решает вызывающий (Engine считает её).
//   - После peek ячейка твоя до drop; после reserve — до commit. Указатель после этого не хранить.
//   - clear() не потокобезопасен: только пока обе стороны стоят (Engine::init).
// Цена: push / pop — копия T (у действия ~1 КБ); для больших T (строки 64 КБ) — reserve / peek без копии всего элемента.
#pragma once
#include <atomic>
#include <cstddef>

template <class T, int N>
class Spsc {
 public:
  bool push(const T& v) {                                   // false — полно
    const size_t head = head_.load(std::memory_order_relaxed), after = next(head);
    if (after == tail_.load(std::memory_order_acquire)) return false;
    cells_[head] = v;
    head_.store(after, std::memory_order_release);
    return true;
  }
  // ячейка под запись или nullptr, если полно; заполнить, затем commit()
  T* reserve() {
    const size_t head = head_.load(std::memory_order_relaxed);
    return next(head) == tail_.load(std::memory_order_acquire) ? nullptr : &cells_[head];
  }
  void commit() { head_.store(next(head_.load(std::memory_order_relaxed)), std::memory_order_release); }
  bool full() const { return next(head_.load(std::memory_order_relaxed)) == tail_.load(std::memory_order_acquire); }
  bool pop(T& v) {                                          // false — пусто
    const T* p = peek();
    if (!p) return false;
    v = *p;
    drop();
    return true;
  }
  // самая старая запись без извлечения или nullptr, если пусто; потом drop()
  const T* peek() const {
    const size_t tail = tail_.load(std::memory_order_relaxed);
    if (tail == head_.load(std::memory_order_acquire)) return nullptr;
    return &cells_[tail];
  }
  void drop() { tail_.store(next(tail_.load(std::memory_order_relaxed)), std::memory_order_release); }
  void clear() { head_.store(0, std::memory_order_relaxed); tail_.store(0, std::memory_order_relaxed); }

 private:
  static size_t next(size_t i) { return i + 1 == static_cast<size_t>(N) + 1 ? 0 : i + 1; }
  T cells_[N + 1];
  std::atomic<size_t> head_{0};                             // куда пишет производитель
  std::atomic<size_t> tail_{0};                             // откуда читает потребитель
};

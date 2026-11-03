// Triple — тройной буфер «последний снимок»: писатель (аудио) никогда не ждёт, читатель (UI) берёт самое новое целиком, без
// разрывов. В Engine — зеркала слотов, таблица LFO, уровни.
//
//   писатель: write() → заполнить → publish()        читатель: read(out) — true, если пришло новее
//
// Три ячейки: писателя, читателя и средняя. publish отдаёт свою ячейку в середину и забирает оттуда старую; read забирает
// среднюю (если в ней новое), отдавая свою. Обмен — exchange(acq_rel) над middle_, где номер ячейки и бит FRESH: ячейку
// получает только один из двоих, и её данные он видит целиком.
//
// ЛОВУШКИ:
//   - Писатель и читатель — по одному потоку.
//   - Между снимками пропадают промежуточные: читателю нужен только последний (это не очередь — для очереди Spsc).
//   - write() отдаёт ячейку со старым снимком, а не пустую: перед publish заполнить всё, что читатель смотрит.
//   - Не опубликовал (continue до publish) — читатель видит прошлое: так Engine оставляет зеркало, когда мир его не дал.
//   - clear() не потокобезопасен: только пока обе стороны стоят.
// Цена: publish — один exchange; read — exchange и копия T, только если пришло новое.
#pragma once
#include <atomic>

template <class T>
class Triple {
 public:
  T& write() { return cells_[writeCell_]; }                 // ячейка писателя, до publish()
  void publish() { writeCell_ = middle_.exchange(writeCell_ | FRESH, std::memory_order_acq_rel) & CELL; }
  // true — пришёл снимок новее прочитанного, он скопирован в out; false — out не тронут
  bool read(T& out) {
    if (!(middle_.load(std::memory_order_relaxed) & FRESH)) return false;
    readCell_ = middle_.exchange(readCell_, std::memory_order_acq_rel) & CELL;
    out = cells_[readCell_];
    return true;
  }
  void clear() { writeCell_ = 0; readCell_ = 1; middle_.store(2, std::memory_order_relaxed); }

 private:
  static constexpr int CELL = 3, FRESH = 4;                 // middle_: биты 0–1 — номер ячейки, бит 2 — «писатель положил новое»
  T cells_[3];
  int writeCell_ = 0, readCell_ = 1;                        // свои у каждой стороны
  std::atomic<int> middle_{2};
};

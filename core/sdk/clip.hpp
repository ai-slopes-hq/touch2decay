// softclip — мягкий ограничитель: tanh(k·x).
//
// k — крутизна у нуля: тихий сигнал выходит ≈ k·x, громкий плавно прижимается к ±1 и выше не идёт.
// Кривая нечётная (минус на входе — зеркально на выходе), постоянной составляющей не добавляет.
//
// ЛОВУШКА: в отличие от TanhShaper (shaper.hpp) не делит на tanh(k) — вход ±1 даёт ±tanh(k), а не ±1.
// Цена — один tanh на сэмпл, состояния нет.
#pragma once
#include <cmath>

namespace sdk {

inline double softclip(double x, double k) { return std::tanh(k * x); }

}  // namespace sdk

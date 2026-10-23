// Мягкий ограничитель: tanh(k·x), нечётный, k — крутизна у нуля.
#pragma once
#include <cmath>

namespace sdk {

inline double softclip(double x, double k) { return std::tanh(k * x); }

}  // namespace sdk

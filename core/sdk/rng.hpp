// Общий ГСЧ ядра: mulberry32, бит в бит как rnd() в tools/ref/pulsar-worklet.js (Math.imul — обычное умножение uint32).
#pragma once
#include <cstdint>

namespace sdk {

struct Rng {
  uint32_t s;
  explicit Rng(uint32_t seed) : s(seed) {}
  double next() {                                       // [0, 1)
    s += 0x6D2B79F5u;
    uint32_t t = s;
    t = (t ^ (t >> 15)) * (t | 1u);
    t ^= t + (t ^ (t >> 7)) * (t | 61u);
    return (t ^ (t >> 14)) / 4294967296.0;
  }
};

}  // namespace sdk

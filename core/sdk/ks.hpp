// Петля Карплуса — Стронга (как струна и флажолет в monochord-worklet.js): линия задержки с дробной длиной (линейное чтение),
// однополюсный lowpass в петле (яркость b) и потеря за проход g (из t60). Длина — с поправкой на задержку lowpass на низких
// ((1 − b)/b отсчётов), чтобы строй не уезжал. Связь петель (общая подставка) и возбуждение — у мира: петля даёт read / damp / write.
// Буфер — float, как Float32Array в worklet; остальное — double. SIZE — длина буфера (4096 — струна, 2048 — флажолет).
#pragma once
#include <cmath>

namespace sdk {

template <int SIZE>
struct KsLoop {
  float buf[SIZE] = {};
  int w = 0;
  double len = 400, lp = 0, b = 0.5, g = 0.996;

  void clear() { for (int i = 0; i < SIZE; i++) buf[i] = 0; w = 0; lp = 0; }
  static double lossOf(double t60, double f) { return std::pow(10.0, -3 / (t60 * f)); }   // потеря за проход: −60 дБ за t60
  // длина петли под частоту f при яркости b (lowpass задерживает низкие на (1 − b)/b отсчётов); не короче 4
  static double lenOf(double fs, double f, double b) { double d = fs / f - (1 - b) / b; return d < 4 ? 4 : d; }
  double read() const {                                 // выход петли: len отсчётов назад, линейно между соседними
    double r = w - len;
    while (r < 0) r += SIZE;
    const int i0 = static_cast<int>(std::floor(r));
    const double fr = r - i0;
    return buf[i0 % SIZE] * (1 - fr) + buf[(i0 + 1) % SIZE] * fr;
  }
  double damp(double y, double bb) { lp += bb * (y - lp); return lp; }   // lowpass в петле (яркость — снаружи: у флажолета — струны)
  void write(double v) { buf[w] = static_cast<float>(v); w = (w + 1) % SIZE; }
};

}  // namespace sdk

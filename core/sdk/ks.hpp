// KsLoop — петля Карплуса — Стронга: струна из линии задержки. Длина петли задаёт высоту,
// lowpass в петле — как быстро гаснут верха (яркость), потеря за проход — как долго звенит.
// Так звучат струна и флажолет Monochordum (бывший monochord-worklet.js).
//
// Петля сама не крутится: проход собирает мир из трёх шагов, вмешиваясь между ними
// (общая подставка связывает петли, возбуждение добавляется к записи):
//
//   const double y = loop.read();                        // что вернулось через length отсчётов
//   const double v = loop.damp(y, brightness) * loop.loss + excitation;
//   loop.write(v);
//
// Вспомогательное:
//   lossOf(t60, f)   — потеря за проход, чтобы на частоте f звон стих на 60 дБ за t60 секунд;
//   lenOf(fs, f, b)  — длина петли под частоту f с поправкой на задержку lowpass ((1 − b)/b отсчётов
//                      на низких), чтобы строй не уезжал; не короче 4.
//
// ЛОВУШКИ:
//   - length дробная и читается линейно между соседними отсчётами — на нецелых длинах верха гаснут чуть быстрее.
//   - length < SIZE, иначе читает перезаписанное. SIZE — длина буфера: 4096 — струна, 2048 — флажолет;
//     4096 при 48 кГц — нота не ниже ≈ 12 Гц.
//   - Буфер — float, как Float32Array в worklet; остальное — double. Сверка с вебом держится на этом.
//   - brightness и loss блок только хранит для мира: сам он их не применяет.
// Цена — несколько операций на сэмпл.
#pragma once
#include <cmath>

namespace sdk {

template <int SIZE>
struct KsLoop {
  float buf[SIZE] = {};
  int writePos = 0;
  double length = 400;                                  // длина петли, отсчётов (дробная)
  double brightness = 0.5;                              // доля пути lowpass за отсчёт: 1 — без фильтра
  double loss = 0.996;                                  // множитель за проход
  double lowpass = 0;                                   // состояние lowpass в петле

  void clear() { for (int i = 0; i < SIZE; i++) buf[i] = 0; writePos = 0; lowpass = 0; }
  void clearDamp() { lowpass = 0; }                     // новый звук в той же петле: lowpass с нуля, буфер не трогать

  static double lossOf(double t60, double f) { return std::pow(10.0, -3 / (t60 * f)); }
  static double lenOf(double fs, double f, double b) { double d = fs / f - (1 - b) / b; return d < 4 ? 4 : d; }

  double read() const {                                 // length отсчётов назад, линейно между соседними
    double r = writePos - length;
    while (r < 0) r += SIZE;
    const int i0 = static_cast<int>(std::floor(r));
    const double fr = r - i0;
    return buf[i0 % SIZE] * (1 - fr) + buf[(i0 + 1) % SIZE] * fr;
  }
  // lowpass в петле; яркость — параметром: флажолет берёт яркость своей струны
  double damp(double y, double bright) { lowpass += bright * (y - lowpass); return lowpass; }
  void write(double v) { buf[writePos] = static_cast<float>(v); writePos = (writePos + 1) % SIZE; }
};

}  // namespace sdk

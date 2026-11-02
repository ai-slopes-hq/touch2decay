// Delay — линия задержки на чужом буфере: память выделяет владелец (в prepare), в process аллокаций нет.
// Allpass — allpass Шрёдера на такой линии: все частоты проходят одинаково громко, но фаза размазана
// по времени — кирпичик диффузии ревербера (щелчок расплывается в облачко).
//
//   sdk::Delay line(buf, len);   // буфер обнуляется
//   line.write(x);               // каждый сэмпл
//   y = line.read(d);            // d записей назад: 1 — последняя записанная, максимум len;
//                                // дробное d — линейно между соседними
//
//   Allpass: d = задержанное на всю длину буфера, в линию пишется w = x + g·d, выход — d − g·w.
//
// ЛОВУШКИ:
//   - d — в сэмплах, от 1 до len. Меньше 1 или больше len — смешивает с самым старым сэмплом, то есть мусор.
//   - Буфер — float (как Float32Array в вебе), чтение отдаёт double.
//   - Delay() без буфера — заготовка до prepare: read и write на ней падают (длина 0).
//   - У Allpass |g| < 1, иначе он неустойчив.
// Цена: write — одна запись; read — два чтения и интерполяция; Allpass::step — read + write.
#pragma once

namespace sdk {

class Delay {
 public:
  Delay() = default;
  Delay(float* buf, int len) : buffer_(buf), length_(len) { for (int i = 0; i < length_; i++) buffer_[i] = 0; }

  void write(double x) { buffer_[writePos_] = static_cast<float>(x); if (++writePos_ >= length_) writePos_ = 0; }
  double read(double d) const {
    int i = static_cast<int>(d);
    double f = d - i;
    double a = at(i), c = at(i + 1);
    return a + (c - a) * f;
  }
  int len() const { return length_; }

 private:
  double at(int d) const { int k = writePos_ - d; while (k < 0) k += length_; return buffer_[k % length_]; }   // d целых записей назад
  float* buffer_ = nullptr;
  int length_ = 0, writePos_ = 0;
};

class Allpass {
 public:
  Allpass(float* buf, int len, double g) : g(g), line_(buf, len) {}
  double step(double x) {
    double d = line_.read(line_.len());
    double w = x + g * d;
    line_.write(w);
    return d - g * w;
  }
  double g;                                             // коэффициент, |g| < 1; можно менять на ходу

 private:
  Delay line_;
};

}  // namespace sdk

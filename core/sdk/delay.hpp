// Линия задержки на внешнем буфере (без аллокаций в process) и allpass на ней. Чтение — линейная интерполяция.
#pragma once

namespace sdk {

class Delay {
 public:
  Delay(float* buf, int len) : b_(buf), n_(len) { for (int i = 0; i < n_; i++) b_[i] = 0; }
  void write(double x) { b_[w_] = static_cast<float>(x); if (++w_ >= n_) w_ = 0; }
  // d — сколько записей назад: 1 — последняя записанная, до len включительно; дробное — линейно между соседними.
  double read(double d) const {
    int i = static_cast<int>(d);
    double f = d - i;
    double a = at(i), c = at(i + 1);
    return a + (c - a) * f;
  }
  int len() const { return n_; }

 private:
  double at(int d) const { int k = w_ - d; while (k < 0) k += n_; return b_[k % n_]; }
  float* b_;
  int n_, w_ = 0;
};

// Schroeder-allpass: d = задержанное, w = x + g·d, y = d − g·w. Задержка — вся длина буфера.
class Allpass {
 public:
  Allpass(float* buf, int len, double g) : g_(g), d_(buf, len) {}
  double step(double x) {
    double d = d_.read(d_.len());
    double w = x + g_ * d;
    d_.write(w);
    return d - g_ * w;
  }
  double g_;

 private:
  Delay d_;
};

}  // namespace sdk

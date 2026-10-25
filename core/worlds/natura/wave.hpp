// Пять волн Natura — sine, square, triangle, saw, sharp — настоящие band-limited, не копии PeriodicWave браузера
// (решение автора 25.10, «как у Saw в Portus»: в JS шли на компромиссы — таблицы на октаву и подгонку).
//   sine      — Osc.sine;
//   triangle  — Osc.triangle (углы скруглены PolyBLAMP);
//   saw       — sdk::Saw (остаток BLEP, задержка 16 сэмплов);
//   square    — разность двух пил, сдвинутых на полпериода: saw(ph) − saw(ph + ½) = +1 на первой половине, −1 на второй;
//   sharp     — tanh(2.6·tri(u) + 0.35), u — фаза, tri(u) = 1 − 4·|((u + ¼) mod 1) − ½| (треугольник в насыщение, как у Лиры).
//               Ряд Фурье этой кривой гладкий (гармоники падают как 1/h²), поэтому таблица на октаву: гармоники до 0.46·fs
//               при самой высокой частоте октавы, 2048 точек, кубическая интерполяция (Catmull — Rom). Без постоянной составляющей
//               (в PeriodicWave её нет), уровень — пик 1 по ряду из 47 гармоник, как нормирует браузер.
// Таблицы sharp строятся один раз на частоту дискретизации (SharpTable::init), общие на все голоса.
// Память — внутри объектов; в step аллокаций нет.
#pragma once
#include <cmath>
#include <utility>
#include "../../sdk/osc.hpp"
#include "../../sdk/saw.hpp"

namespace natura {

enum WaveType { SINE, SQUARE, TRIANGLE, SAW, SHARP, NWAVES };

class SharpTable {
 public:
  static constexpr int N = 2048, LV = 9, HMAX = 256;     // точек на период, октав (с 27.5 Гц), гармоник не больше
  static void init(double sr) {
    if (sr_ == sr) return;
    sr_ = sr;
    static double re[N], im[N];
    const auto shape = [](int i) {
      const double u = static_cast<double>(i) / N, w = u + 0.25 - std::floor(u + 0.25);
      return std::tanh(2.6 * (1 - 4 * std::fabs(w - 0.5)) + 0.35);
    };
    for (int i = 0; i < N; i++) { re[i] = shape(i); im[i] = 0; }
    fft(re, im, false);                                   // re/im — спектр: бин h — гармоника h
    static double sr2[N], si2[N];
    for (int i = 0; i < N; i++) { sr2[i] = re[i]; si2[i] = im[i]; }
    double peak = 0;                                      // пик ряда из 47 гармоник (без h = 0) — по нему нормирует браузер
    build(sr2, si2, 47, tmp_);
    for (int i = 0; i < N; i++) peak = std::fmax(peak, std::fabs(tmp_[i]));
    const double norm = peak > 0 ? 1 / peak : 1;
    for (int l = 0; l < LV; l++) {
      const double fhi = 27.5 * std::pow(2.0, l + 1);
      int h = static_cast<int>(std::floor(0.46 * sr / fhi));
      h = h < 1 ? 1 : h > HMAX ? HMAX : h;
      build(sr2, si2, h, tmp_);
      for (int i = 0; i < N; i++) t_[l][i + 1] = static_cast<float>(tmp_[i] * norm);
      t_[l][0] = t_[l][N]; t_[l][N + 1] = t_[l][1]; t_[l][N + 2] = t_[l][2];   // охранные точки для кубической интерполяции
    }
  }
  static int level(double f) {                            // октава 27.5·2^l … 27.5·2^(l+1)
    if (f < 27.5) return 0;
    const int l = static_cast<int>(std::floor(std::log2(f / 27.5)));
    return l >= LV ? LV - 1 : l;
  }
  static double at(int l, double ph) {                    // ph ∈ [0, 1)
    const double x = ph * N;
    const int i = static_cast<int>(x);
    const double f = x - i;
    const float* t = t_[l] + i;                           // t[0] — точка i − 1
    const double a = t[0], b = t[1], c = t[2], d = t[3];
    return b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
  }

 private:
  static void fft(double* re, double* im, bool inv) {     // N = 2^k, по основанию 2 с перестановкой
    for (int i = 1, j = 0; i < N; i++) {
      int bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); }
    }
    for (int len = 2; len <= N; len <<= 1) {
      const double ang = 2 * M_PI / len * (inv ? 1 : -1);
      const double wr = std::cos(ang), wi = std::sin(ang);
      for (int i = 0; i < N; i += len) {
        double cr = 1, ci = 0;
        for (int k = 0; k < len / 2; k++) {
          const int a = i + k, b = i + k + len / 2;
          const double xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const double nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  static void build(const double* sre, const double* sim, int h, double* out) {   // гармоники 1…h (и зеркальные), без постоянной
    static double re[N], im[N];
    for (int i = 0; i < N; i++) { re[i] = im[i] = 0; }
    for (int k = 1; k <= h && k < N / 2; k++) { re[k] = sre[k]; im[k] = sim[k]; re[N - k] = sre[N - k]; im[N - k] = sim[N - k]; }
    fft(re, im, true);
    for (int i = 0; i < N; i++) out[i] = re[i] / N;
  }
  inline static double sr_ = 0;
  inline static float t_[LV][N + 3] = {};
  inline static double tmp_[N] = {};
};

class Wave {
 public:
  void set(int type) {
    if (type == type_) return;
    type_ = type;
    a_.reset(0); b_.reset(0.5); o_.reset(); ph_ = 0;
  }
  void restart(int type) { type_ = -1; set(type); }      // новый генератор: фаза с нуля, даже если волна та же
  int type() const { return type_; }
  double step(double dt) {                               // dt = f/sr
    switch (type_) {
      case SINE: return o_.sine(dt);
      case TRIANGLE: return o_.triangle(dt);
      case SAW: return a_.step(dt);
      case SQUARE: return a_.step(dt) - b_.step(dt);
      default: {
        const double y = SharpTable::at(SharpTable::level(dt * sr_), ph_);
        ph_ += dt; ph_ -= std::floor(ph_);
        return y;
      }
    }
  }
  static void prepare(double sr) { SharpTable::init(sr); sr_ = sr; }

 private:
  int type_ = -1;
  sdk::Osc o_;
  sdk::Saw a_, b_;
  double ph_ = 0;
  inline static double sr_ = 48000;
};

}  // namespace natura

// Firmamentum — ядро звука: пульсарный синтез, порт pulsar-worklet.js (эталон — tools/ref/pulsar-worklet.js) один в один.
// Каждый период 1/fp начинается пульсарет — окно с синусом на форманте ff; щелчки (crepitus) и вспышки (fulgur) — поверх.
// ГСЧ — mulberry32 (core/common/rng.hpp), вызовы в том же порядке, что в эталоне, включая короткие замыкания.
#pragma once
#include <cstdint>

#include "../../common/dc.hpp"
#include "../../common/rng.hpp"

namespace firmamentum {

constexpr int VMAX = 6, CRMAX = 10, PIPMAX = 7, CKMAX = 12, FLMAX = 8;

class Pulsar {
 public:
  Pulsar(double sr, uint32_t seed);
  // on: 1 / 0 / −1 («нет в сообщении»: поле on не меняется, сброса нет)
  void voice(int i, int on, double fp, double ff, double cyc, double win, double mask, double lvl, double pan);
  void fx(double jit, double spread, double crep, double fulg);
  void process(float* L, float* R, int n);              // R == nullptr — моно
  double count(int i) const { return i < 0 || i >= VMAX ? 0 : vo_[i].n; }
  double gain(int i) const { return i < 0 || i >= VMAX ? 0 : vo_[i].g; }
  int ck(double* out);                                  // пары (pan, a) накопленных щелчков; возвращает число пар, очищает
  int fl(int* out);                                     // номера голосов накопленных вспышек; возвращает число, очищает

 private:
  struct Voice {
    bool on = false;
    double fp = 4, ff = 600, cyc = 2, win = 0, mask = 0, lvl = 0.8, pan = 0, g = 0, fpS = 4, ffS = 600, ph = 1;
    double pt = -1, plen = 0, pf = 600, pa = 1, n = 0;
  };
  struct Crackle { double a, d, pan, hp, x; };
  struct Pip { int k0; double len, f; int side; double a, t; };

  void flash(int i, int k0);
  void dust(float* L, float* R, int n);

  double sr_;
  core::Rng rng_;
  Voice vo_[VMAX];
  double jit_ = 0, spread_ = 0.6, crep_ = 0, fulg_ = 0, act_ = 0, burst_ = 0, burstT_ = 0, hiss_[2] = {0, 0};
  core::DcBlock dc_[2];
  Crackle cr_[CRMAX]; int ncr_ = 0;
  Pip pips_[PIPMAX]; int npips_ = 0;
  double ck_[CKMAX * 2]; int nck_ = 0;
  int fl_[FLMAX]; int nfl_ = 0;
};

}  // namespace firmamentum

// Firmamentum — звук мира SDK: пульсарный синтез на блоках core/sdk (OnePole, DcBlock, softclip, panLin). Порт pulsar.cpp
// (эталон — tools/ref/pulsar-worklet.js) один в один: каждый период 1/fp начинается пульсарет — окно с синусом на форманте ff;
// щелчки (crepitus) и вспышки (fulgur) — поверх. ГСЧ — mulberry32, вызовы в том же порядке, что в эталоне. Только стерео.
// Голоса правит мир по событиям модели (world.cpp — как sendStar в worlds/firmamentum/engine.js).
#pragma once
#include <cstdint>

#include "../../sdk/dc.hpp"
#include "../../sdk/rng.hpp"
#include "../../sdk/smooth.hpp"

namespace firmamentum {

class Sound {
 public:
  static constexpr int VMAX = 6, CRMAX = 10, PIPMAX = 7, CKMAX = 12, FLMAX = 8;

  void prepare(double sr, uint32_t seed);               // всё с нуля: голоса молчат, fx — как у эталона до первого сообщения
  // голос целиком; on: 1 / 0 (−1 — не трогать). Вступает с тишины (on и g < 1e-4) — без глайда
  void voice(int i, int on, double fp, double ff, double cyc, double win, double mask, double lvl, double pan);
  void fp(int i, double fp);                            // одна частота — без сброса (комета, drift)
  void ff(int i, double ff);
  void fx(double jit, double spread, double crep, double fulg);
  void process(float* L, float* R, int n);              // пишет L, R целиком
  double count(int i) const { return ok(i) ? vo_[i].n : 0; }   // сколько пульсаретов прозвучало
  double gain(int i) const { return ok(i) ? vo_[i].g.y : 0; }
  int ck(double* out);                                  // пары (pan, a) накопленных щелчков (до CKMAX); число пар, очищает
  int fl(double* out);                                  // номера голосов накопленных вспышек (до FLMAX); число, очищает

 private:
  struct Voice {
    bool on = false;
    double fp = 4, ff = 600, cyc = 2, win = 0, mask = 0, lvl = 0.8, pan = 0;
    sdk::OnePole g, fpS{4}, ffS{600};                   // громкость (вверх 0.002, вниз 0.0008) и глайд частот (0.002)
    double ph = 1, pt = -1, plen = 0, pf = 600, pa = 1, n = 0;
  };
  struct Crackle { double a, d, pan, hp, x; };
  struct Pip { int k0; double len, f; int side; double a, t; };

  static bool ok(int i) { return i >= 0 && i < VMAX; }
  void flash(int i, int k0);
  void dust(float* L, float* R, int n);

  double sr_ = 48000;
  sdk::Rng rng_{1};
  Voice vo_[VMAX];
  double jit_ = 0, spread_ = 0.6, crep_ = 0, fulg_ = 0, act_ = 0, burst_ = 0, burstT_ = 0, hiss_[2] = {0, 0};
  sdk::DcBlock dc_[2];
  Crackle cr_[CRMAX]; int ncr_ = 0;
  Pip pips_[PIPMAX]; int npips_ = 0;
  double ck_[CKMAX * 2]; int nck_ = 0;
  int fl_[FLMAX]; int nfl_ = 0;
};

}  // namespace firmamentum

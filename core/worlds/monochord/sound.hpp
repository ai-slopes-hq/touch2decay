// Monochordum — звук струн: порт monochord-worklet.js (эталон — tools/ref/monochord-worklet.js, ГСЧ с зерном) один в один.
// 4 струны на sdk::KsLoop<4096> + флажолет на sdk::KsLoop<2048>; общая подставка — симпатический резонанс (bridge = Σy, каждая
// берёт cpl·(bridge − свой y) и отдаёт own = 1 − 3cpl); щипок — шум с мягким срезом и гребёнкой по месту; смычок, Эолова струна и
// ветер — непрерывный шум. Всё молчит — блок не считается. Отличие от worklet: щипки по времени (автострам) играют с точностью до
// сэмпла (в worklet — с начала блока, где наступило их время). Буферы — float, как Float32Array; выход копится во float (как L[k] +=).
#pragma once
#include <cstdint>
#include "../../sdk/ks.hpp"
#include "../../sdk/rng.hpp"

namespace monochord {

class Sound {
 public:
  static constexpr int NS = 4, BUF = 4096, HBUF = 2048, QMAX = 64;
  void prepare(double fs, uint32_t seed);
  void tune(int i, double f, double bright, double decay, double level);   // level < 0 — не менять
  void pluck(int i, double pos, double vel);
  void harm(int i, int n, double vel);
  void bow(int i, double amp) { if (ok(i)) s_[i].bow = amp < 0 ? 0 : amp > 1 ? 1 : amp; }
  void sus(int i, bool on) { if (ok(i)) s_[i].sus = on ? 1 : 0; }
  void wind(double amt) { wind_ = amt; }
  void couple(double amt) { cpl_ = amt; }
  void at(double t, int i, double pos, double vel);     // щипок в момент t (секунды часов блока)
  void clearQueue() { nq_ = 0; }
  // блок n сэмплов, начинается в now (с): пишет L, R (не прибавляет); false — всё молчало, L и R — нули
  bool process(float* L, float* R, int n, double now);
  double en(int i) const { return __builtin_sqrt(s_[i].en); }   // энергия струны и флажолета (RMS) — для картинки
  double eh(int i) const { return __builtin_sqrt(s_[i].hen); }
  int hn(int i) const { return s_[i].hn; }
  bool silent() const;

 private:
  struct S {
    sdk::KsLoop<BUF> k;
    sdk::KsLoop<HBUF> h;                                // флажолет: своя короткая петля, яркость — струны
    float ex[BUF] = {}, hex[HBUF] = {};
    int exn = 0, exi = 0, hexn = 0, hexi = 0;           // exn = 0 — возбуждения нет (s.ex = null)
    double level = 0.8, pan = 0, bow = 0, bowS = 0, sus = 0, en = 0, nz = 0, f = 110, t60 = 5, y = 0, e2 = 0;
    double hen = 0, he2 = 0;
    int hn = 2;
  };
  struct Q { double t; int i; double pos, vel; };
  bool ok(int i) const { return i >= 0 && i < NS; }
  double rnd() { return rng_.next(); }

  S s_[NS];
  Q q_[QMAX];
  int nq_ = 0;
  double fs_ = 48000, cpl_ = 0.0004, wind_ = 0;
  sdk::Rng rng_{1};
};

}  // namespace monochord

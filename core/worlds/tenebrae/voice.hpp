// Голос Tenebrae — порт voiceNodes/apply из worlds/tenebrae/engine.js, схема один в один (стерео, как узлы в вебе):
//   c1 (пан −0.5) и c2 (+0.5) — морф голосового набора, саб f/2 × 0.28 → tone → сдвиг (dry/wet) → drive → soft(3) os 2× → lowpass
//   → + шум (bandpass ×2.4, hiss — HP 3000) → env → сумма + comb (delay 1/f, петля LP 3000 → soft(1.6) → ×0.3) → vca → кольцо контура
//   → дыхание → lvl → панорама. Модулятор m = синус f: self-FM в Гц (sfm), наружу для связей — m × огибающая.
// Значения с τ — sdk::Param (τ из apply, на snap — 0.004), считаются fill-ом раз в 16 сэмплов (у сошедшихся — без расчёта);
// коэффициенты lp, bp, задержка comb, панорама, веса морфа и медленный дрейф строя — раз в 16 сэмплов, остальное — на сэмпл.
// live = false — голос не считается вовсе: фазы, фильтры и время стоят. Снова живой — значения сразу в своих целях
// (в вебе время шло, setTargetAtTime дошёл), состояние фильтров и петли — как было (узлы в вебе его хранят).
// Связи считает мир: Σ от источников на сэмпл приходит в step (ModIn), сигнал m источника — modOut() после prestep().
#pragma once
#include "../../sdk/biquad.hpp"
#include "../../sdk/delay.hpp"
#include "../../sdk/osc.hpp"
#include "../../sdk/pan.hpp"
#include "../../sdk/param.hpp"
#include "../../sdk/rng.hpp"
#include "../../sdk/shaper.hpp"
#include "shifter.hpp"
#include "waves.hpp"
#include <cstdint>

namespace tenebrae {

// Σ от связей на этот сэмпл (rmSum — глубины, для базы vca); noise — общий шум мира −1…1 на сэмпл (в вебе bp и hiss всех голосов
// питает один буфер: в дыре голоса складываются когерентно, ×N, а не ×√N)
struct ModIn { double fmCents, tzHz, vcaAdd, rmSum, noise; };

// ключи LFO — порядок LFO_KEYS в engine.js
enum LfoKey { L_PITCH, L_WAVE, L_CUT, L_RES, L_BEAT, L_SHIFT, L_AMP, L_FM, LFO_N };

class Voice {
 public:
  static constexpr int BLOCK = 16, SCOPE = 1024, DMAX = 4096;   // DMAX — буфер comb: 1/55 Гц ≈ 18 мс до 192 кГц с запасом

  void prepare(double sr, uint32_t seed, const Tables* t, int index);   // index → k = 1 + i·0.137
  void set(const double* a, double f, double fmOpen);  // 11 чисел VOICE; f — уже по ладу; fmOpen — от связей
  void rm(double sum) { rm_ = sum; }                    // Σ глубин rm-связей — до set (базу vca ставит set, с его τ)
  void on();
  void off(double tau);
  void live(bool on);
  bool isLive() const { return live_; }
  void lfo(int key, double morph, double rate, double depth);   // depth 0 — снять
  double modOut() const { return live_ ? mOut_ : 0; }  // сигнал m этого сэмпла: синус f × огибающая
  void prestep();                                       // считает m и огибающую на сэмпл (до связей)
  void step(const ModIn& in, double& L, double& R);     // выход голоса после панорамы: pre → sat → post
  // тот же step по частям — мир считает перегруз (soft 2×) всех живых голосов одной пачкой (sdk::TanhShaper2::stepN), до бита как step
  void pre(const ModIn& in, double* s);                 // всё до перегруза: s[2] — его вход (L, R)
  sdk::TanhShaper2& sat() { return sat_; }
  void post(const double* s, double& L, double& R);     // s[2] — выход перегруза; дальше lowpass, шум, огибающая, comb, vca, панорама
  double env() const { return env_; }
  double freq() const { return f_; }
  double combDelay() const { return dSec_; }            // задержка comb, с (на текущем блоке)
  double vcaBase() const { return p_[VCA].p.value(); }  // база vca (1 − Σ rm), последнее значение
  void scope(double* out128) const;                     // 128 точек контура (как scope в engine.js)

 private:
  // Param и его последняя цель: пока голос не живой, события не ставятся — на live(true) значение встаёт в цель
  struct P {
    sdk::Param p;
    double tgt = 0;
    void init(double v) { p.reset(v); tgt = v; }
    void land() { p.reset(tgt); }
  };
  enum { F1, F2, SUB, MF, POS, SHZ, WET, DRY, DRIVE, TONE, LPF, LPQ, NZ, BPF, BPQ, HISS, COMB, DL, PAN, SFM, VCA, LVL, ENV, NP };
  struct Lfo {
    bool on = false;                                    // есть спека
    int die = 0;                                        // сэмплов до отцепления после снятия (в вебе — 400 мс)
    double morph = 0, rate = 0, depth = 0;
    Morph mo;
    Mix mix;
    P pos, hz, out;
    double b[3][BLOCK];
    double v = 0;                                       // значение этого сэмпла (уже × глубина)
  };

  void to(P& q, double v, double tau);                  // setTargetAtTime: tau — в секундах
  void block();
  void shiftAim(double tauHz, double tauMix);         // вкл/выкл сдвига и его частота
  double lfoDepth(int key, double d) const;
  void lfoAim(int key);

  const Tables* T_ = nullptr;
  double sr_ = 48000, k_ = 1, now_ = 0;
  int blk_ = 0;
  bool live_ = false, has_ = false;

  P p_[NP];
  double b_[NP][BLOCK];
  Lfo lfo_[LFO_N];

  // последние поля от модели
  double f_ = 0, amp_ = 0, alive_ = 1, rm_ = 0, shHz_ = 0;
  bool shOn_ = false;
  int shTail_ = 0;                                      // сэмплов до отцепления сдвига после выключения (в вебе — 150 мс)

  // генераторы
  Morph c1_, c2_;
  Mix mix_;
  sdk::Osc sub_, m_, dr_[6];                            // дрейф: c1 ×2, c2 ×2, lp, дыхание
  double drift1_ = 0, drift2_ = 0, lpDrift_ = 0, breath_ = 1, mRaw_ = 0, mOut_ = 0, env_ = 0;
  sdk::Rng rj_{2};                                      // джиттер строя (в вебе — свой случайный сдвиг по буферу)
  sdk::Biquad jit1_, jit2_, bp_, hp_;
  double g1L_ = 0, g1R_ = 0, g2L_ = 0, g2R_ = 0;        // панорамы c1, c2 (StereoPanner на моно-входе)

  // стерео-цепь
  Shifter sh_[2];
  sdk::TanhShaper2 sat_;                                // L и R — ступени oversample парой
  sdk::Biquad lp_[2], loop_[2];
  sdk::Delay dl_[2];
  float dbuf_[2][DMAX];
  double dSamp_ = 128, dSec_ = 0;
  double fbq_[2][128] = {};                             // петля comb: выход обратной связи на квант позже (как цикл в Chromium)
  int fbi_ = 0;
  double nz_ = 0, comb_ = 0, vca_ = 0, lv_ = 0;         // от pre к post этого сэмпла
  sdk::PanStereo pan_;

  float ring_[SCOPE] = {};
  int ringW_ = 0;
};

}  // namespace tenebrae

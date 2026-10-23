// Ревербы хоста — четыре общих посыла: room, plate, hall, cathedral (вместо Web Audio hall() у каждого мира).
//   Fdn4  — четыре линии с матрицей Хаусхолдера, топология и числа host/audio.js hall(); room и cathedral — те же линии
//           другого размера. Обратная связь каждой линии — из T60: g = 10^(−3·len / (T60·fit)).
//   Plate — Dattorro, «Effect Design Part 1» (1997): входная диффузия, «танк» из двух веток, отводы на выход по статье.
// Вход — моно (L+R)/2, выход — стерео. Память линий — внутри объекта (kRevMem float, хватает на cathedral и plate
// при 96 кГц), в process ни одной аллокации. Денормалы: всё, что пишется в линии и состояния фильтров, мельче kFlush, — 0.
#pragma once
#include <cstdint>
#include "biquad.hpp"
#include "delay.hpp"

namespace sdk {

enum class Rev { room, plate, hall, cathedral };

constexpr int kRevMem = 76000;                          // float на ревербер: plate при 96 кГц — ~72.8 тыс., cathedral — ~67 тыс.
constexpr double kRevMaxSr = 96000;                     // выше — длины считаются как при 96 кГц
constexpr double kFlush = 1e-10;                        // −200 дБ: ниже 24 бит и слуха; хвост гаснет в ровный 0

struct FdnSpec {                                        // параметры Fdn4 одного типа
  double size, t60;                                     // множитель длин линий, время спада, с
  double fit;                                           // поправка: демпфирование съедает ~10 % хвоста — g считается от t60·fit (замерено тестом)
  double damp, dampStep;                                // демпфирование линии i: lowpass damp − i·dampStep, Гц
  double pre;                                           // предзадержка, с
};

class Fdn4 {
 public:
  int prepare(double sr, const FdnSpec& s, uint32_t seed, float* mem);   // → сколько float из mem занято
  void process(const float* inL, const float* inR, float* outL, float* outR, int n);
  double g(int i) const { return g_[i]; }

 private:
  static constexpr int N = 4;
  Delay pre_, line_[N];
  int preLen_ = 0;
  double len_[N] = {}, g_[N] = {}, depth_ = 0;
  Biquad hp_, lp_, ap_[4], damp_[N];
  double lc_[N] = {}, ls_[N] = {}, wc_[N] = {}, ws_[N] = {};   // LFO линий: фазор и его поворот за сэмпл
};

class Plate {
 public:
  int prepare(double sr, double t60, uint32_t seed, float* mem);
  void process(const float* inL, const float* inR, float* outL, float* outR, int n);
  double decay() const { return decay_; }

 private:
  Delay in_[4], apL_, apR_, dL1_, dL2_, dR1_, dR2_, mL_, mR_;   // диффузия, allpass танка, задержки танка, модулированные allpass
  int inLen_[4] = {}, apLLen_ = 0, apRLen_ = 0, dL1Len_ = 0, dL2Len_ = 0, dR1Len_ = 0, dR2Len_ = 0;
  double mLen_ = 0, mRLen_ = 0, exc_ = 0;
  int tapL_[7] = {}, tapR_[7] = {};
  double decay_ = 0.5, bw_ = 0, damp_ = 0;               // bw_, damp_ — полюса однополюсников, пересчитаны к sr
  double bwY_ = 0, dampL_ = 0, dampR_ = 0;
  double lc_ = 1, ls_ = 0, wc_ = 1, ws_ = 0;            // LFO танка: левая ветка — sin, правая — cos
};

class Reverb {
 public:
  void prepare(double sr, Rev t, uint32_t seed);
  void process(const float* inL, const float* inR, float* outL, float* outR, int n);
  Rev type() const { return t_; }
  int used() const { return used_; }                    // сколько памяти линий занято (тест: ≤ kRevMem)
  const Fdn4& fdn() const { return fdn_; }
  const Plate& plate() const { return plate_; }

 private:
  Rev t_ = Rev::hall;
  int used_ = 0;
  Fdn4 fdn_;
  Plate plate_;
  float mem_[kRevMem];
};

}  // namespace sdk

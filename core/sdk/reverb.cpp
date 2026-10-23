// Ревербы хоста: Fdn4 (room, hall, cathedral) и Plate (Dattorro). Описание — в reverb.hpp.
#include "reverb.hpp"
#include <cmath>
#include "rng.hpp"

namespace sdk {

namespace {

inline double flush(double x) { return std::fabs(x) < kFlush ? 0.0 : x; }
inline void flush(Biquad& b) { b.x1 = flush(b.x1); b.x2 = flush(b.x2); b.y1 = flush(b.y1); b.y2 = flush(b.y2); }

// allpass на линии с дробным чтением (для модуляции): w = x + g·d, y = d − g·w — как sdk::Allpass, но с явным сбросом
inline double allpass(Delay& l, double d_len, double g, double x) {
  double d = l.read(d_len);
  double w = flush(x + g * d);
  l.write(w);
  return d - g * w;
}

// размеры hall() (host/audio.js): линии 0.0297…0.0437 с, модуляция ±0.9 мс
const double kBase[4] = {0.0297, 0.0371, 0.0411, 0.0437};
const double kDepth = 0.0009;

const FdnSpec kRoom = {0.9, 0.8, 1.09, 8000, 500, 0};                // короче, ярче
const FdnSpec kHall = {2.4, 3.5, 1.10, 6000, 500, 0};               // ровно hall(), кроме g — из T60
const FdnSpec kCathedral = {2.4 * 1.8, 8, 1.12, 4000, 400, 0.04};    // длиннее, темнее, предзадержка 40 мс

}  // namespace

int Fdn4::prepare(double sr, const FdnSpec& s, uint32_t seed, float* mem) {
  double lsr = sr > kRevMaxSr ? kRevMaxSr : sr;              // длины в сэмплах — не больше, чем при 96 кГц
  int used = 0;
  preLen_ = static_cast<int>(std::lround(s.pre * lsr));
  if (preLen_ > 0) { pre_ = Delay(mem + used, preLen_); used += preLen_; }
  depth_ = kDepth * lsr;
  Rng rng(seed);
  for (int i = 0; i < N; i++) {
    double sec = kBase[i] * s.size;
    len_[i] = sec * lsr;
    int cap = static_cast<int>(std::ceil(len_[i] + depth_)) + 2;
    line_[i] = Delay(mem + used, cap); used += cap;
    g_[i] = std::pow(10.0, -3 * sec / (s.t60 * s.fit));
    damp_[i] = Biquad(); damp_[i].set(Biquad::lowpass, s.damp - i * s.dampStep, -3, sr);
    double w = 2 * M_PI * (0.13 + 0.07 * i) / sr, ph = 2 * M_PI * rng.next();
    wc_[i] = std::cos(w); ws_[i] = std::sin(w);
    lc_[i] = std::cos(ph); ls_[i] = std::sin(ph);
  }
  hp_ = Biquad(); hp_.set(Biquad::highpass, 280, -3, sr);
  lp_ = Biquad(); lp_.set(Biquad::lowpass, 7500, -3, sr);
  const double apf[4] = {430, 1150, 2400, 4300};
  for (int k = 0; k < 4; k++) { ap_[k] = Biquad(); ap_[k].set(Biquad::allpass, apf[k], 0.7, sr); }
  return used;
}

void Fdn4::process(const float* inL, const float* inR, float* outL, float* outR, int n) {
  for (int t = 0; t < n; t++) {
    double x = 0.5 * (double(inL[t]) + inR[t]);
    if (preLen_ > 0) { double d = pre_.read(preLen_); pre_.write(flush(x)); x = d; }
    x = lp_.step(hp_.step(x));
    for (int k = 0; k < 4; k++) x = ap_[k].step(x);
    double o[N], gn[N], sum = 0;
    for (int i = 0; i < N; i++) {
      o[i] = line_[i].read(len_[i] + depth_ * ls_[i]);         // лёгкое плавание — хвост не звенит металлом
      gn[i] = g_[i] * damp_[i].step(o[i]);
      sum += gn[i];
      double c = lc_[i] * wc_[i] - ls_[i] * ws_[i];
      ls_[i] = ls_[i] * wc_[i] + lc_[i] * ws_[i]; lc_[i] = c;
    }
    double m = -2.0 / N * sum;                                  // Хаусхолдер: I − 2/N·11ᵀ
    for (int i = 0; i < N; i++) line_[i].write(flush((i % 2 ? -x : x) + gn[i] + m));   // нечётные — в противофазе
    outL[t] = static_cast<float>(o[0] + o[2]);                  // чётные линии — влево, нечётные — вправо
    outR[t] = static_cast<float>(o[1] + o[3]);
  }
  // раз в блок: фазоры LFO — на единичную окружность, состояния фильтров — без денормалов
  for (int i = 0; i < N; i++) {
    double r = 1 / std::sqrt(lc_[i] * lc_[i] + ls_[i] * ls_[i]);
    lc_[i] *= r; ls_[i] *= r;
    flush(damp_[i]);
  }
  flush(hp_); flush(lp_);
  for (int k = 0; k < 4; k++) flush(ap_[k]);
}

// Dattorro: длины — в сэмплах при 29761 Гц, пересчитываются к sr
namespace {
const double kDsr = 29761;
const int kIn[4] = {142, 107, 379, 277};
const double kInG[4] = {0.75, 0.75, 0.625, 0.625};            // input diffusion 1, 2
const int kML = 672, kMR = 908, kExc = 16;                     // модулированные allpass (decay diffusion 1), размах
const int kDL1 = 4453, kAPL = 1800, kDL2 = 3720;              // левая ветка танка
const int kDR1 = 4217, kAPR = 2656, kDR2 = 3163;              // правая
const double kDd1 = 0.70, kDd2 = 0.50;
const double kBandwidth = 0.9995, kDamping = 0.0005;          // параметры статьи
// отводы (таблица 2 статьи): yL — из 48_54, 48_54, 55_59, 59_63, 24_30, 31_33, 33_39; yR — зеркально
const int kTapL[7] = {266, 2974, 1913, 1996, 1990, 187, 1066};
const int kTapR[7] = {353, 3627, 1228, 2673, 2111, 335, 121};
}  // namespace

int Plate::prepare(double sr, double t60, uint32_t seed, float* mem) {
  double lsr = sr > kRevMaxSr ? kRevMaxSr : sr;
  double k = lsr / kDsr;
  int used = 0;
  auto len = [&](int d) { return static_cast<int>(std::lround(d * k)) > 0 ? static_cast<int>(std::lround(d * k)) : 1; };
  auto take = [&](Delay& l, int cap) { l = Delay(mem + used, cap); used += cap; };
  for (int i = 0; i < 4; i++) { inLen_[i] = len(kIn[i]); take(in_[i], inLen_[i]); }
  exc_ = kExc * k;
  mLen_ = kML * k; mRLen_ = kMR * k;
  take(mL_, static_cast<int>(std::ceil(mLen_ + exc_)) + 2);
  take(mR_, static_cast<int>(std::ceil(mRLen_ + exc_)) + 2);
  dL1Len_ = len(kDL1); take(dL1_, dL1Len_);
  apLLen_ = len(kAPL); take(apL_, apLLen_);
  dL2Len_ = len(kDL2); take(dL2_, dL2Len_);
  dR1Len_ = len(kDR1); take(dR1_, dR1Len_);
  apRLen_ = len(kAPR); take(apR_, apRLen_);
  dR2Len_ = len(kDR2); take(dR2_, dR2Len_);
  for (int i = 0; i < 7; i++) { tapL_[i] = len(kTapL[i]); tapR_[i] = len(kTapR[i]); }
  // полный круг танка (обе ветки) — 4 умножения на decay; длины в секундах не зависят от sr
  double loop = (kML + kDL1 + kAPL + kDL2 + kMR + kDR1 + kAPR + kDR2) / kDsr;
  decay_ = std::pow(10.0, -3 * loop / (4 * t60));
  // однополюсники статьи (y = (1−p)·x + p·y): та же постоянная времени в секундах при другом sr
  bw_ = std::pow(1 - kBandwidth, kDsr / sr);
  damp_ = std::pow(kDamping, kDsr / sr);
  bwY_ = dampL_ = dampR_ = 0;
  Rng rng(seed);
  double w = 2 * M_PI * 1.0 / sr, ph = 2 * M_PI * rng.next();    // ~1 Гц
  wc_ = std::cos(w); ws_ = std::sin(w); lc_ = std::cos(ph); ls_ = std::sin(ph);
  return used;
}

void Plate::process(const float* inL, const float* inR, float* outL, float* outR, int n) {
  for (int t = 0; t < n; t++) {
    double x = 0.5 * (double(inL[t]) + inR[t]);
    bwY_ = flush((1 - bw_) * x + bw_ * bwY_);
    x = bwY_;
    for (int i = 0; i < 4; i++) x = allpass(in_[i], inLen_[i], kInG[i], x);
    double lOut = dL2_.read(dL2Len_), rOut = dR2_.read(dR2Len_);    // выходы веток с прошлого круга
    // левая ветка: вход + правый выход → модулированный allpass → задержка → демпфирование → ×decay → allpass → задержка
    double a = allpass(mL_, mLen_ + exc_ * ls_, -kDd1, x + decay_ * rOut);
    double b = dL1_.read(dL1Len_); dL1_.write(flush(a));
    dampL_ = flush((1 - damp_) * b + damp_ * dampL_);
    b = allpass(apL_, apLLen_, kDd2, decay_ * dampL_);
    dL2_.write(flush(b));
    // правая — зеркально, вход — левый выход
    double c = allpass(mR_, mRLen_ + exc_ * lc_, -kDd1, x + decay_ * lOut);
    double d = dR1_.read(dR1Len_); dR1_.write(flush(c));
    dampR_ = flush((1 - damp_) * d + damp_ * dampR_);
    d = allpass(apR_, apRLen_, kDd2, decay_ * dampR_);
    dR2_.write(flush(d));
    double cc = lc_ * wc_ - ls_ * ws_;
    ls_ = ls_ * wc_ + lc_ * ws_; lc_ = cc;
    // отводы: 24_30 — dL1, 31_33 — apL, 33_39 — dL2, 48_54 — dR1, 55_59 — apR, 59_63 — dR2
    double yl = dR1_.read(tapL_[0]) + dR1_.read(tapL_[1]) - apR_.read(tapL_[2]) + dR2_.read(tapL_[3])
              - dL1_.read(tapL_[4]) - apL_.read(tapL_[5]) - dL2_.read(tapL_[6]);
    double yr = dL1_.read(tapR_[0]) + dL1_.read(tapR_[1]) - apL_.read(tapR_[2]) + dL2_.read(tapR_[3])
              - dR1_.read(tapR_[4]) - apR_.read(tapR_[5]) - dR2_.read(tapR_[6]);
    outL[t] = static_cast<float>(0.6 * yl);
    outR[t] = static_cast<float>(0.6 * yr);
  }
  double r = 1 / std::sqrt(lc_ * lc_ + ls_ * ls_);
  lc_ *= r; ls_ *= r;
}

void Reverb::prepare(double sr, Rev t, uint32_t seed) {
  t_ = t;
  switch (t) {
    case Rev::plate: used_ = plate_.prepare(sr, 2, seed, mem_); break;
    case Rev::room: used_ = fdn_.prepare(sr, kRoom, seed, mem_); break;
    case Rev::cathedral: used_ = fdn_.prepare(sr, kCathedral, seed, mem_); break;
    default: used_ = fdn_.prepare(sr, kHall, seed, mem_); break;
  }
}

void Reverb::process(const float* inL, const float* inR, float* outL, float* outR, int n) {
  if (t_ == Rev::plate) plate_.process(inL, inR, outL, outR, n);
  else fdn_.process(inL, inR, outL, outR, n);
}

}  // namespace sdk

// Horologium — колесо и ударные кольца, см. sound.hpp. Колесо и обнаружение удара — в порядке эталона tools/ref/horo-worklet.js.
#include "sound.hpp"

#include <algorithm>
#include <cmath>

#include "../../sdk/euclid.hpp"

namespace horologium {

static double wrap1(double x) { return x - std::floor(x + 0.5); }   // в [−0.5, 0.5)
static double lockRate(double err) { return 1 + std::fmax(-0.03, std::fmin(0.03, err)); }

void Sound::prepare(double sr, uint32_t seed) {
  sr_ = sr > 0 ? sr : 48000;
  rng_ = sdk::Rng(seed);
  gap_ = static_cast<int64_t>(std::ceil(MIN_GAP * sr_));
  for (int i = 0; i < NR; i++) { r_[i] = O{}; r_[i].n = i + 2; r_[i].pan = -0.7 + (1.4 * i) / (NR - 1); r_[i].inst = i; r_[i].d.prepare(sr_); }
  P_ = F_ = Ft_ = 0; mat_ = 0.35; conc_ = 0.4; chance_ = 1; tint_ = 1;
  lockOn_ = snap_ = false; dc_[0] = dc_[1] = dx_[0] = dx_[1] = 0; nh_ = 0; strikes_ = attacks_ = smp_ = 0;
}

int Sound::rotOf(double phi, int L) {
  if (L < 1) return 0;
  const double x = std::fmod(std::floor(phi * L + 0.5), L);   // без приведения огромного double к int
  if (!std::isfinite(x)) return 0;
  const int r = static_cast<int>(x);
  return (r % L + L) % L;
}

void Sound::set(const R* rings, double Ft, double mat, double conc, double chance, double tint) {
  const auto unit = [](double v, double d) { return std::isnan(v) ? d : v < 0 ? 0 : v > 1 ? 1 : v; };   // второй заслон: голос не терпит NaN и бесконечного хвоста
  for (int i = 0; i < NR; i++) {
    O& o = r_[i];
    o.on = rings[i].on; o.under = rings[i].under; o.phi = rings[i].phi; o.lvl = unit(rings[i].lvl, 0.8);
    o.inst = rings[i].inst >= 0 && rings[i].inst < NINST ? rings[i].inst : i;   // голос не терпит мусора: чужой номер — кит по умолчанию
    o.hz = std::isfinite(rings[i].hz) ? rings[i].hz : 0;
    o.len = rings[i].len >= 1 && rings[i].len <= 16 ? rings[i].len : 16;
    o.rot = rotOf(o.phi, o.len);
    o.fltT = std::isnan(rings[i].flt) ? 0.5f : rings[i].flt < 0 ? 0.f : rings[i].flt > 1 ? 1.f : rings[i].flt;
  }
  Ft_ = std::isfinite(Ft) ? Ft : 0; mat_ = unit(mat, 0.35); conc_ = unit(conc, 0.4); chance_ = unit(chance, 1);
  tint_ = std::isfinite(tint) && tint > 0 ? tint : 1;
}

double Sound::filterHz(float flt, bool* hp) {
  if (hp) *hp = false;
  if (std::isnan(flt)) return 0;
  if (flt < 0.47f) return 200.0 * std::pow(100.0, flt / 0.47);   // 0 → 200 Гц, 0.47 → 20 кГц
  if (flt > 0.53f) { if (hp) *hp = true; return 20.0 * std::pow(400.0, (flt - 0.53) / 0.47); }   // 0.53 → 20 Гц, 1 → 8 кГц
  return 0;
}

// Доля фильтра в звуке: 0 в мёртвой зоне, плавно до 1 за 0.03 от её краёв — вход в фильтр и выход из байпаса без скачка.
float Sound::filterWet(float flt) {
  if (std::isnan(flt)) return 0;
  const float w = flt < 0.5f ? (0.47f - flt) / 0.03f : (flt - 0.53f) / 0.03f;
  return w < 0 ? 0 : w > 1 ? 1 : w;
}

void Sound::lock(double t0, double bar) {
  if (!(bar > 0)) { lockOn_ = false; return; }
  if (!lockOn_) snap_ = true;
  lockOn_ = true; t0_ = t0; bar_ = bar;
}

int Sound::hits(int* buf, int cap) {
  int k = 0;
  for (; k < nh_ && k < cap; k++) buf[k] = hit_[k];
  nh_ = 0;
  return k;
}

void Sound::process(float* L, float* R, int n, double now) {
  const double sr = sr_;
  O* act[NR];
  int na = 0;
  for (O& o : r_) if (o.on) act[na++] = &o;
  const double kF = 1 - std::exp(-1 / (0.06 * sr));
  const bool still = Ft_ == 0 && std::fabs(F_) < 1e-12 && !lockOn_;   // колесо стоит — ударов не будет
  bool quiet = (na == 0 || still) && std::fabs(dc_[0]) < 1e-9 && std::fabs(dc_[1]) < 1e-9;
  for (const O& o : r_) if (o.d.active()) quiet = false;
  if (quiet) {                                          // колец нет или колесо стоит, голоса отзвучали: идёт только колесо (его видно и по нему — замок)
    for (int k = 0; k < n; k++) {
      F_ += (Ft_ - F_) * kF;
      double dP = F_ / sr;
      if (lockOn_) {
        const double t = now + k / sr, err = wrap1((t - t0_) / bar_ - P_);
        if (snap_ || std::fabs(err) > 0.1) { P_ += err; snap_ = false; }
        else dP *= lockRate(err);
      }
      P_ += dP;
      L[k] = R[k] = 0;
    }
    smp_ += n;
    dc_[0] = dc_[1] = dx_[0] = dx_[1] = 0;
    for (O& o : r_) { o.f.reset(); o.fmode = 0; o.flt = o.fltT; }   // фильтры спят: состояние забыто, flt догнал цель
    return;
  }
  const double kFlt = 1 - std::exp(-n / (0.02 * sr));   // сглаживание flt: 20 мс на блок
  for (O& o : r_) {                                     // коэффициенты DJ-фильтров — раз в блок
    o.flt += (o.fltT - o.flt) * static_cast<float>(kFlt);
    bool hp = false;
    const double hz = filterHz(o.flt, &hp);
    const int mode = hz > 0 ? (hp ? 2 : 1) : 0;
    if (mode == 0) { o.fmode = 0; o.wet = 0; continue; }
    o.wet = filterWet(o.flt);
    if (o.fmode == 0) o.f.reset();                      // вход из байпаса: память устарела
    o.fmode = mode;
    o.f.set(hp ? sdk::Biquad::highpass : sdk::Biquad::lowpass, std::fmin(hz, 0.45 * sr), 2, sr);
  }
  for (int k = 0; k < n; k++) {
    F_ += (Ft_ - F_) * kF;
    double dP = F_ / sr;
    if (lockOn_) {
      const double t = now + k / sr, err = wrap1((t - t0_) / bar_ - P_);
      if (snap_ || std::fabs(err) > 0.1) { P_ += err; snap_ = false; }
      else dP *= lockRate(err);
    }
    const double P0 = P_;
    P_ += dP;
    double yl = 0, yr = 0;
    bool fire[NR] = {};                                 // проход 1: какие кольца бьют на этом сэмпле
    for (int a = 0; a < na; a++) {
      const O& o = *act[a];
      const int S = stepsOf(o.under);
      const double q0 = std::floor(P0 * S), q1 = std::floor(P_ * S);
      if (q0 == q1 || !std::isfinite(q0) || !std::isfinite(q1)) continue;   // NaN в колесе — не бить (приведение к int было бы UB)
      const double qb = std::fmax(q0, q1);              // начало пересечённого шага (и вперёд, и назад)
      double jd = std::fmod(qb + o.rot, o.len);
      if (jd < 0) jd += o.len;
      const int j = static_cast<int>(jd);
      fire[a] = sdk::euclid(j, std::min(o.n, o.len), o.len);
    }
    const bool once = std::floor(P0) != std::floor(P_);   // «раз»: оборот сменился
    for (int a = 0; a < na; a++) {
      if (!fire[a] || !(rnd() < chance_)) continue;     // ГСЧ — только для сработавших
      O& o = *act[a];
      double acc = 1;
      if (conc_ > 0) {                                  // concursus: совпал с ударом другого кольца или с «раз»
        bool hitc = once;
        for (int b = 0; b < na && !hitc; b++) if (b != a && fire[b]) hitc = true;
        if (hitc) acc += conc_ * 1.2; else acc *= 1 - 0.35 * conc_;
      }
      o.acc = acc;
      strikes_++;
      if (nh_ < HMAX) hit_[nh_++] = o.n - 2;
      if (smp_ - o.last >= gap_) {                      // потолок: между запусками голоса кольца — не меньше MIN_GAP
        o.d.hit(o.inst, o.hz, tint_, mat_, acc * o.lvl);
        o.last = smp_; attacks_++;
      }
    }
    for (O& o : r_) {                                   // голоса звучат и у выключенных колец — хвост доигрывает
      const bool act = o.d.active();
      if (!act && (o.fmode == 0 || o.f.silent())) continue;   // голос отзвучал, фильтр дозвучал
      double y = act ? o.d.step(rng_) * KIT : 0;
      if (o.fmode) { y += (o.f.step(y) - y) * o.wet; if ((k & 31) == 0) o.f.flushTiny(1e-12); }   // DJ-фильтр: после голоса, до панорамы
      yl += y * (1 - o.pan) * 0.5; yr += y * (1 + o.pan) * 0.5;
    }
    L[k] = static_cast<float>(yl); R[k] = static_cast<float>(yr);
    smp_++;
  }
  for (int k = 0; k < n; k++) {
    double x = L[k], y = x - dx_[0] + 0.997 * dc_[0]; dx_[0] = x; dc_[0] = y; L[k] = static_cast<float>(std::tanh(y * 0.9));
    x = R[k]; y = x - dx_[1] + 0.997 * dc_[1]; dx_[1] = x; dc_[1] = y; R[k] = static_cast<float>(std::tanh(y * 0.9));
  }
}

}  // namespace horologium

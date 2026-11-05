// Horologium — колесо и ударные кольца. Колесо — как в эталоне (tools/ref/horo-worklet.js, ГСЧ с зерном): положение P (обороты),
// скорость F (к Ft со сглаживанием 60 мс), спуск руками — доворот на d за 40 мс; замок к такту — колесо тянется к фазе такта
// (t − t0)/bar скоростью ±3 %, прыжок — при включении замка или ошибке больше 0.1 оборота. Звук — свой: у каждого из восьми колец
// голос Drum (drums.hpp), инструмент и высоту задаёт мир перед каждым блоком. Оборот — 16 шагов (шестнадцатых; под унтертоном
// кольцо считает восьмыми, S = 8). Кольцо n бьёт Евклидов рисунок: k = min(n, len) ударов на len шагов, шаг j = (q + rot) mod len,
// удар — когда q = floor(P·S) сменился и euclid(j, k, len) (и chance); rot = rotOf(phi, len) сдвигает рисунок. Колесо назад — тот же
// шаг, начало которого пересекли. concursus — удар сильнее, где кольца бьют на одном шаге (или «раз»).
// Голос запускается не чаще 24 раз в секунду на кольцо (MIN_GAP): на быстром колесе лишние удары считаются (strikes), но голос
// не перезапускают — иначе щелчки. Хвост доигрывает и после выключения кольца. Выход — сумма голосов × KIT × панорама,
// DC-блок и tanh(0.9x). DJ-фильтр на голос (flt): свой Biquad на кольцо после голоса и до панорамы, 0.5 — байпас без вызова. Тишина (колец нет или колесо стоит, голоса отзвучали) — нули без шагов голосов; идёт только колесо.
// Параметры (кольца, fx, Ft, замок) задаёт мир перед каждым блоком; время блока — от часов хоста.
#pragma once
#include <cstdint>
#include "../../sdk/biquad.hpp"
#include "../../sdk/rng.hpp"
#include "drums.hpp"
#include "model.hpp"

namespace horologium {

class Sound {
 public:
  static constexpr int HMAX = 32;
  void prepare(double sr, uint32_t seed);
  static constexpr double MIN_GAP = 1.0 / 24;           // секунд между запусками голоса одного кольца
  static int rotOf(double phi, int L);                  // сдвиг рисунка: (floor(phi·L + 0.5) mod L + L) mod L; нечисло → 0
  // срез DJ-фильтра по flt: lowpass 20 кГц→200 Гц при flt 0.47→0, highpass 20 Гц→8 кГц при 0.53→1 (экспонента). Мёртвая зона и нечисло — байпас: возвращает 0.
  // *hp (если не nullptr) — highpass; в байпасе false. Частоту под sr/2 зажимает process.
  static double filterHz(float flt, bool* hp);
  static float filterWet(float flt);                                // доля фильтра 0…1: 0 в мёртвой зоне
  static int stepsOf(int under) { return under == 1 ? 8 : under == 2 ? 32 : 16; }   // шагов на оборот: обычное — шестнадцатые, унтертон ÷2 — восьмые, ×2 — тридцать вторые
  struct R { bool on = false; int under = 0; double phi = 0, lvl = 0.8; int inst = 0; double hz = 110; int len = 16; float flt = 0.5f; };   // len — длина кольца в шагах 1…16; flt — DJ-фильтр 0…1, 0.5 (мёртвая зона 0.47…0.53) — выкл
  // tint — окраска шумовых и металлических голосов (Model::tint()); hz кольца — Model::pitch(i)
  void set(const R* rings, double Ft, double mat, double conc, double chance, double tint);
  void lock(double t0, double bar);                     // замок к такту (новый — фаза прыгнет к обороту)
  void unlock() { lockOn_ = false; }
  void process(float* L, float* R, int n, double now);  // пишет L, R
  double P() const { return P_; }
  double F() const { return F_; }
  int hits(int* buf, int cap);                           // номера колец (n − 2), ударивших с прошлого раза; очищает
  double lastAcc(int i) const { return r_[i].acc; }      // множитель силы последнего удара кольца i (concursus)
  long strikes() const { return strikes_; }
  long attacks() const { return attacks_; }              // запусков голоса всего (≤ ударов: потолок MIN_GAP)
  const Drum& voice(int i) const { return r_[i].d; }

 private:
  struct O {
    int n = 2; bool on = false; int under = 0; double phi = 0, lvl = 0.8;
    int inst = 0; double hz = 110;
    double pan = 0, acc = 1;
    int len = 16, rot = 0;
    float fltT = 0.5f, flt = 0.5f;                                  // flt цель и сглаженный (один полюс, раз в блок)
    float wet = 0;                                                   // доля фильтра в звуке (кроссфейд у краёв мёртвой зоны)
    int fmode = 0;                                                   // 0 байпас, 1 lowpass, 2 highpass
    sdk::Biquad f;                                                   // DJ-фильтр голоса
    int64_t last = -(int64_t(1) << 40);                             // номер сэмпла последнего запуска голоса
    Drum d;
  };
  double rnd() { return rng_.next(); }

  O r_[NR];
  double sr_ = 48000, P_ = 0, F_ = 0, Ft_ = 0, mat_ = 0.35, conc_ = 0.4, chance_ = 1, tint_ = 1;
  bool lockOn_ = false, snap_ = false;
  double t0_ = 0, bar_ = 0;
  double dc_[2] = {}, dx_[2] = {};
  int hit_[HMAX] = {}, nh_ = 0;
  long strikes_ = 0, attacks_ = 0;
  int64_t smp_ = 0, gap_ = 0;   // smp_ — сэмплов отыграно, gap_ — MIN_GAP в сэмплах
  sdk::Rng rng_{1};
};

}  // namespace horologium

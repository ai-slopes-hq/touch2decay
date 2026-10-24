// Cymatica — звук пластины и часы секвенсера: порт plate-worklet.js (эталон со случайностью от зерна — tools/ref/plate-worklet.js).
// 24 моды круглой пластины (Бессель), 4 голоса-пластины на двухполюсных резонаторах SDK, удар / смычок, выход — Knee SDK;
// секвенсер: узор целиком (ритм и места разной длины — полиритм), часы — StepClock SDK, шанс удара — Rng SDK от зерна.
// Песок (сетка форм мод для картинки) не переносился — на ханге он не нужен. Старые сообщения seq со «старым» местом в шаге ритма
// и мелодией числами (полутоны) ядро не принимает — модель их не шлёт (seqMessage).
#pragma once
#include <cstdint>

#include "../../sdk/knee.hpp"
#include "../../sdk/resonator.hpp"
#include "../../sdk/rng.hpp"
#include "../../sdk/stepclock.hpp"
#include "model.hpp"

namespace cymatica {

constexpr int NM = 24, NV = 4, MAX_STRIKES = 16, MAX_BOWS = 8, HEARD_CAP = 8;   // SLOTS и SEQ_N — в model.hpp
// узор — плоский массив чисел (сообщение action SEQ): bpm, playing, chance, rhythm.len, melody.len,
// затем SLOTS шагов ритма (on, vel, chance) и SLOTS шагов мелодии (on, s, x, y); пустое поле (NaN) — по умолчанию

struct StepEvent { int r, m; double time; bool hit; double note; };   // note — нота (полутоны от 55 Гц) удара шага мелодии, NaN — удара нет или место молчит

class Plate {
 public:
  void prepare(double sr, uint32_t seed);
  void params(double structure, double damping, double brightness);
  void f0(double hz);
  void strike(double x, double y, double hz, double vel, double hard, bool rec);   // NaN в hz / vel / hard — по умолчанию
  void seq(const double* a, int n);
  void lock(bool off, double t0, double p);                // t0 — время ядра, секунды
  void bow(int id, bool on, double x, double y, double exciter, double pressure, double amp);   // NaN — как было
  void process(float* L, float* R, int n);                 // n ≤ 128

  bool sounding() const;
  const double* energy() const { return energy_; }         // сумма энергий мод по голосам, как сообщение energy (~30 раз в секунду)
  double voiceHz(int i) const { return v_[i].hz; }
  double voiceLevel(int i) const { return v_[i].level; }
  int events(StepEvent* out, int cap);                     // шаги, сыгранные с прошлого вызова; очищает
  // последний тик часов: шаги ритма и мелодии и сколько шагов прошло с него (дробно) — модель привязывает к нему удар при записи игрой
  bool phase(int& r, int& m, double& steps) const;

 private:
  struct Voice {
    double hz = 110, level = 0;
    bool awake = false;
    sdk::Resonator res[NM];
    sdk::ResCoef coef[NM];
    double gs[NM] = {}, wb[NM] = {}, en[NM] = {}, x[NM] = {};
  };
  struct Strike { int v; double g[NM]; int n, len; double a; };
  struct Bow { int id; double x, y, exciter, pressure, amp; double g[NM]; };
  struct RStep { bool on = false; double vel = 1, chance = 1; };
  struct MStep { bool on = false; double s = 0, x = 0, y = 0; double g[NM] = {}; };

  void retune();
  void tune(Voice& v, double hz);
  void strikeGains(double x, double y, double* g) const;
  int pickVoice(double hz) const;
  void doStrike(const double* g, double hz, double vel, double hard);
  void tick();
  void report();

  double fs_ = 48000, f0_ = 110, lp_ = 0, enA_ = 0, lastLive_ = -1e12;
  double structure_ = 0.66, damping_ = 0.5, brightness_ = 0.5;
  double ratios_[NM] = {}, t60_[NM] = {};
  Voice v_[NV];
  Strike strikes_[MAX_STRIKES];
  int nStrikes_ = 0;
  Bow bows_[MAX_BOWS];
  int nBows_ = 0;
  int count_ = 0, every_ = 0;
  double energy_[NM] = {};
  // секвенсер
  sdk::StepClock clock_;
  sdk::Rng rng_{1};
  double chance_ = 1;
  int rlen_ = 16, mlen_ = 7, r_ = -1, m_ = -1;
  RStep rhythm_[SLOTS];
  MStep melody_[SLOTS];
  StepEvent ev_[HEARD_CAP];
  int nEv_ = 0;
};

}  // namespace cymatica

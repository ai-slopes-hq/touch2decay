// Horologium — модель в ядре: кольца II…IX (у каждого len — длина 1…16, по умолчанию звучат II…IV), fx, ход часов. Порт tools/ref/horologium-model.js (worlds/horologium/model.js до SDK D2)
// без маятника и шкалы tempus: ход колеса — пуск и bpm. Скорость колеса F = bpm/240 (0 — стоит),
// тоника B — 55 Гц × лад хоста. Кольцо играет ударным голосом inst (кит по умолчанию — inst = номер кольца; кубик кит не трогает). Кубик (dice) — на ГСЧ ядра (зерно мира), только для нативной стороны: веб бросает его сам, в фасаде.
#pragma once
#include <cmath>
#include <string>
#include "../../host/scale.hpp"
#include "../../sdk/rng.hpp"

namespace horologium {

constexpr int NR = 8;                                   // кольца II…IX
enum Fx { AEQUALIS, MATERIA, CONCURSUS, CHANCE, HALL, NFX };   // порядок — fx в model.js
enum RingKey { ON, UNDER, PHI, LVL, INST, LEN, FLT, NRK };
constexpr int LEN_MAX = 16;                             // гнёзд в кольце: 1…16 (шестнадцатые), по умолчанию 16
extern const char* const FX_NAMES[NFX];
extern const double FX_DEF[NFX];

struct Ring { int n = 2; bool on = false, under = false; double phi = 0, lvl = 0.8; int inst = 0, len = 16; double flt = 0.5; };   // flt — DJ-фильтр голоса 0…1: 0.5 выкл, влево lowpass, вправо highpass; inst — голос кольца (Inst из drums.hpp), по умолчанию — номер кольца; len — длина кольца в шагах 1…16
struct Clock { bool run = false; double bpm = 100; };

class Model {
 public:
  explicit Model(const Scale& scale) : scale_(scale) { reset(); }
  void reset(uint32_t seed = 1);

  double Ft() const { return clock_.bpm / 240; }
  double Fnow() const;
  double mOf(const Ring& r) const;                      // ударов за оборот: обертон n, унтертон 12/n; aequalis тянет к полутону
  double baseB() const;
  double pitch(int i) const;                            // Гц тонального голоса кольца i: гармоника тоники, по ладу хоста, октавами в диапазон inst; нетональный — 0
  double tint() const;                                  // множитель центров шумовых фильтров: 1 без лада, иначе 2^(тоника/12), тоника в −5…+6

  void setRing(int i, int key, double v);
  void setFx(int k, double v) { if (k >= 0 && k < NFX && !std::isnan(v)) fx_[k] = v < 0 ? 0 : v > 1 ? 1 : v; }   // все fx — 0…1; NaN игнорируется, ±inf зажимается
  void setRun(bool on) { clock_.run = on; }
  void setBpm(double bpm) { clock_.bpm = bpm; }
  void clear();                                         // всё в тишину; кит — по умолчанию (inst = номер кольца)
  void dice();                                          // три соседних кольца k…k+2 (k = 2…7), у каждого len и фаза-сдвиг; under общий; часы идут; в конце — не более одного фильтра (flt) на звучащем кольце (как dice в model.js)

  std::string snapshot() const;                         // тот же JSON, что у model.js: {r: [{on, under, phi, lvl, inst, len, flt}], fx, bpm, run}
  void restore(const std::string& js);
  bool sounding() const;

  const Ring& ring(int i) const { return r_[i]; }
  double fx(int k) const { return fx_[k]; }
  const Clock& clock() const { return clock_; }

 private:
  const Scale& scale_;
  Ring r_[NR];
  double fx_[NFX] = {};
  Clock clock_;
  sdk::Rng rng_{1};
};

}  // namespace horologium

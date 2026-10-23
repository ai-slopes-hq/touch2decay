// Horologium — модель в ядре: кольца II…IX, fx, ход часов. Порт tools/ref/horologium-model.js (worlds/horologium/model.js до SDK D2)
// без маятника: где груз, бросок и проход через низ — касание и картинка, они в фасаде веба; сюда приходят итоги (пуск, u, «в руке»,
// спуск). Ход успокаивается здесь, каждый блок (tick) — и в фоне без кадров. Скорость колеса F = bpm/240 · 2^u (0 — стоит или в руке),
// тоника B — 55 Гц × лад хоста. Своего ГСЧ у модели нет: кубик — в фасаде.
#pragma once
#include <string>
#include "../../host/scale.hpp"

namespace horologium {

constexpr int NR = 8;                                   // кольца II…IX
enum Fx { AEQUALIS, MATERIA, CONCURSUS, CHANCE, HALL, NFX };   // порядок — fx в model.js
enum RingKey { ON, UNDER, PHI, LVL, NRK };
extern const char* const FX_NAMES[NFX];
extern const double FX_DEF[NFX];

struct Ring { int n = 2; bool on = false, under = false; double phi = 0, lvl = 0.8; };
struct Clock { bool run = false, strip = false, held = false; double u = 0, uT = 0, bpm = 100; };

class Model {
 public:
  explicit Model(const Scale& scale) : scale_(scale) { reset(); }
  void reset();

  double Ft() const { return clock_.bpm / 240; }
  double Fnow() const;
  double mOf(const Ring& r) const;                      // ударов за оборот: обертон n, унтертон 12/n; aequalis тянет к полутону
  double baseB() const;

  void setRing(int i, int key, double v);
  void setFx(int k, double v) { if (k >= 0 && k < NFX) fx_[k] = v; }
  void setRun(bool on, double u) { clock_.run = on; clock_.u = u; }
  void setHeld(bool on) { clock_.held = on; }
  void setBpm(double bpm) { clock_.bpm = bpm; }
  void setSpeed(double u, double uT, bool strip) { clock_.u = u; clock_.uT = uT; clock_.strip = strip; }
  void clear() { for (Ring& r : r_) r.on = false; clock_.run = false; }
  void tick(double dt);                                 // ход успокаивается к uT: сверху τ 6 с, снизу τ 1.5 с; палец на шкале — стоит

  std::string snapshot() const;                         // тот же JSON, что у model.js: {r: [{on, under, phi, lvl}], fx, bpm, run, u, uT}
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
};

}  // namespace horologium
